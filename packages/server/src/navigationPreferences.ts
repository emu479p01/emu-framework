import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthUser } from './auth.js';
import type { Kernel, MenuItemMeta, SecurityPolicy } from '@emu/core';

interface NavigationKey { menuName: string; itemId: string; app?: string }

/** Parses SQLite 'YYYY-MM-DD HH:MM:SS' (UTC) and ISO timestamps consistently. */
function parseTimestamp(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  const text = String(value);
  return Date.parse(text.includes('T') ? text : `${text.replace(' ', 'T')}Z`);
}

export function registerNavigationPreferenceRoutes(app: FastifyInstance, kernel: Kernel, deps: {
  requireUser: (request: FastifyRequest) => AuthUser;
  policyOf: (username: string) => SecurityPolicy;
  isFrameworkAdmin: (username: string) => boolean;
  openApps: (username: string) => Set<string>;
}): void {
  const userId = (username: string): number => {
    const row = kernel.db.prepare('SELECT id FROM "FW_User" WHERE username=?').get(username) as { id: number } | undefined;
    if (!row) throw Object.assign(new Error('User no longer exists'), { statusCode: 401 });
    return row.id;
  };

  const catalog = (username: string): Set<string> => {
    const allowed = new Set<string>();
    const policy = deps.policyOf(username);
    const forms = policy.accessibleForms();
    const admin = deps.isFrameworkAdmin(username);
    const openApps = deps.openApps(username);
    const visit = (menuName: string, items: MenuItemMeta[], system: boolean): void => {
      for (const item of items) {
        if (!(item.visible ?? item.hidden !== true)) continue;
        if (item.items?.length) { visit(menuName, item.items, system); continue; }
        if (!item.id) continue;
        let permitted = false;
        const type = item.target?.type ?? (item.form ? 'form' : item.action ? 'function' : undefined);
        const name = item.target && 'name' in item.target ? item.target.name : item.form ?? item.action ?? '';
        if (type === 'form') {
          try {
            const form = kernel.registry.getForm(name);
            permitted = (forms === 'all' || forms.has(name)) && policy.can(form.table, 'read') && (form.lines ?? []).every((line) => policy.can(line.table, 'read'));
          } catch { permitted = false; }
        } else if (type === 'function') permitted = policy.canFunction(name);
        else if (type === 'report') {
          try { permitted = policy.canReport(name) && policy.can(kernel.registry.getReport(name).dataSource, 'read'); } catch { permitted = false; }
        } else if (item.route) {
          permitted = item.route === '/account/password' || admin || (item.route === '/designer' && openApps.size > 0);
        }
        if (system && item.route !== '/account/password' && item.route !== '/designer' && !admin) permitted = false;
        if (permitted) allowed.add(`${menuName}\0${item.id}`);
      }
    };
    for (const menu of kernel.registry.allMenus()) {
      const owner = kernel.appForArtifact(menu.name);
      if (owner !== 'system' && !admin && (!owner || !openApps.has(owner))) continue;
      visit(menu.name, menu.items, owner === 'system');
    }
    return allowed;
  };

  const assertAllowed = (username: string, key: NavigationKey): void => {
    if (key.app && kernel.appForArtifact(key.menuName) !== key.app) throw Object.assign(new Error('Navigation app mismatch'), { statusCode: 404 });
    if (!catalog(username).has(`${key.menuName}\0${key.itemId}`)) throw Object.assign(new Error('Navigation item is unavailable'), { statusCode: 404 });
  };

  app.get('/api/navigation/preferences', (request) => {
    const user = deps.requireUser(request); const id = userId(user.username); const allowed = catalog(user.username);
    const rows = kernel.db.prepare('SELECT id,menuName,itemId,favorite,lastOpenedAt FROM "FW_NavigationItem" WHERE userId=? ORDER BY lastOpenedAt DESC').all(id) as Array<{ id: number; menuName: string; itemId: string; favorite: number; lastOpenedAt?: string }>;
    const visible = rows.filter((row) => {
      if (allowed.has(`${row.menuName}\0${row.itemId}`)) return true;
      kernel.db.prepare('DELETE FROM "FW_NavigationItem" WHERE id=?').run(row.id);
      return false;
    });
    const shape = (row: typeof visible[number]) => ({ app: kernel.appForArtifact(row.menuName), menuName: row.menuName, itemId: row.itemId, lastOpenedAt: row.lastOpenedAt ?? null });
    const byRecent = (a: typeof visible[number], b: typeof visible[number]) => (parseTimestamp(b.lastOpenedAt) || 0) - (parseTimestamp(a.lastOpenedAt) || 0);
    const counts = new Map<string, number>();
    return {
      favorites: visible.filter((row) => Boolean(row.favorite)).map(shape),
      recent: visible.filter((row) => row.lastOpenedAt).sort(byRecent).filter((row) => { const owner = kernel.appForArtifact(row.menuName) ?? 'system'; const count = (counts.get(owner) ?? 0) + 1; counts.set(owner, count); return count <= 10; }).map(shape),
    };
  });

  app.post<{ Body: NavigationKey }>('/api/navigation/recent', (request) => {
    const user = deps.requireUser(request); const key = request.body; assertAllowed(user.username, key); const id = userId(user.username);
    // Millisecond precision with a strict "greater than the user's previous
    // maximum" rule keeps ordering deterministic even when several menus are
    // opened within the same second or the clock steps backwards.
    kernel.db.exec('BEGIN');
    try {
      const maxRow = kernel.db.prepare('SELECT MAX(lastOpenedAt) m FROM "FW_NavigationItem" WHERE userId=?').get(id) as { m?: string | null };
      const maxMs = parseTimestamp(maxRow?.m ?? null);
      const stamp = new Date(Math.max(Date.now(), (Number.isFinite(maxMs) ? maxMs : 0) + 1)).toISOString();
      kernel.db.prepare(`INSERT INTO "FW_NavigationItem" (createdAt,createdBy,modifiedAt,modifiedBy,userId,menuName,itemId,favorite,lastOpenedAt)
        VALUES (CURRENT_TIMESTAMP,?,CURRENT_TIMESTAMP,?,?,?,?,0,?)
        ON CONFLICT(userId,menuName,itemId) DO UPDATE SET lastOpenedAt=excluded.lastOpenedAt,modifiedAt=CURRENT_TIMESTAMP,modifiedBy=excluded.modifiedBy`)
        .run(user.username, user.username, id, key.menuName, key.itemId, stamp);
      const stale = (kernel.db.prepare('SELECT id,menuName,favorite,lastOpenedAt FROM "FW_NavigationItem" WHERE userId=? AND lastOpenedAt IS NOT NULL').all(id) as Array<{ id: number; menuName: string; favorite: number; lastOpenedAt: string }>).filter((row) => kernel.appForArtifact(row.menuName) === kernel.appForArtifact(key.menuName));
      stale.sort((a, b) => parseTimestamp(b.lastOpenedAt) - parseTimestamp(a.lastOpenedAt));
      for (const row of stale.slice(10)) {
        if (row.favorite) kernel.db.prepare('UPDATE "FW_NavigationItem" SET lastOpenedAt=NULL WHERE id=?').run(row.id);
        else kernel.db.prepare('DELETE FROM "FW_NavigationItem" WHERE id=?').run(row.id);
      }
      kernel.db.exec('COMMIT');
    } catch (error) {
      kernel.db.exec('ROLLBACK');
      throw error;
    }
    return { ok: true };
  });

  app.put<{ Params: NavigationKey; Body: { favorite?: boolean } }>('/api/navigation/favorites/:menuName/:itemId', (request) => {
    const user = deps.requireUser(request); const key = request.params; assertAllowed(user.username, key); const id = userId(user.username);
    const favorite = request.body?.favorite === true ? 1 : 0;
    kernel.db.prepare(`INSERT INTO "FW_NavigationItem" (createdAt,createdBy,modifiedAt,modifiedBy,userId,menuName,itemId,favorite)
      VALUES (CURRENT_TIMESTAMP,?,CURRENT_TIMESTAMP,?,?,?,?,?)
      ON CONFLICT(userId,menuName,itemId) DO UPDATE SET favorite=excluded.favorite,modifiedAt=CURRENT_TIMESTAMP,modifiedBy=excluded.modifiedBy`)
      .run(user.username, user.username, id, key.menuName, key.itemId, favorite);
    kernel.db.prepare('DELETE FROM "FW_NavigationItem" WHERE userId=? AND menuName=? AND itemId=? AND favorite=0 AND lastOpenedAt IS NULL').run(id, key.menuName, key.itemId);
    return { ok: true, favorite: Boolean(favorite) };
  });
}
