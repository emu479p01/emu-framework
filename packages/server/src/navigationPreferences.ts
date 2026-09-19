import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthUser } from './auth.js';
import type { Kernel, MenuItemMeta, SecurityPolicy } from '@emu/core';

interface NavigationKey { menuName: string; itemId: string }

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
        if (item.hidden || item.visible === false) continue;
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
    const shape = (row: typeof visible[number]) => ({ menuName: row.menuName, itemId: row.itemId, lastOpenedAt: row.lastOpenedAt ?? null });
    return { favorites: visible.filter((row) => Boolean(row.favorite)).map(shape), recent: visible.filter((row) => row.lastOpenedAt).slice(0, 10).map(shape) };
  });

  app.post<{ Body: NavigationKey }>('/api/navigation/recent', (request) => {
    const user = deps.requireUser(request); const key = request.body; assertAllowed(user.username, key); const id = userId(user.username);
    kernel.db.prepare(`INSERT INTO "FW_NavigationItem" (createdAt,createdBy,modifiedAt,modifiedBy,userId,menuName,itemId,favorite,lastOpenedAt)
      VALUES (CURRENT_TIMESTAMP,?,CURRENT_TIMESTAMP,?,?,?,?,0,CURRENT_TIMESTAMP)
      ON CONFLICT(userId,menuName,itemId) DO UPDATE SET lastOpenedAt=CURRENT_TIMESTAMP,modifiedAt=CURRENT_TIMESTAMP,modifiedBy=excluded.modifiedBy`)
      .run(user.username, user.username, id, key.menuName, key.itemId);
    const stale = kernel.db.prepare('SELECT id,favorite FROM "FW_NavigationItem" WHERE userId=? AND lastOpenedAt IS NOT NULL ORDER BY lastOpenedAt DESC LIMIT -1 OFFSET 10').all(id) as Array<{ id: number; favorite: number }>;
    for (const row of stale) {
      if (row.favorite) kernel.db.prepare('UPDATE "FW_NavigationItem" SET lastOpenedAt=NULL WHERE id=?').run(row.id);
      else kernel.db.prepare('DELETE FROM "FW_NavigationItem" WHERE id=?').run(row.id);
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
