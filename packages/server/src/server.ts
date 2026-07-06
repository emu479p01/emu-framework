import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import {
  Kernel,
  MetadataError,
  ValidationError,
  DataEventCancelled,
  SecurityError,
  allowAll,
  buildRolePolicy,
  type DataContext,
  type FieldValue,
  type SecurityPolicy,
} from '@emu/core';
import { registerSystemApp, registerSystemHooks } from './systemApp.js';
import { login, logout, resolveSession, seedAdmin, type AuthUser } from './auth.js';
import { bootWebArtifacts, registerDesignerRoutes } from './designer.js';
import { seedDesignerDb } from './seeder.js';

export interface ServerOptions {
  dbPath?: string;
  /** Path to the designer SQLite file (default: <dbPath>.designer.sqlite). */
  designerDbPath?: string;
  /** Directories of metadata apps to load, in dependency order. */
  appDirs?: string[];
  /** Register business logic (hooks/event handlers) on the kernel at boot. */
  registerLogic?: (kernel: Kernel) => void;
  /** Display title for branding (login page, sidebar, etc). Default "EmuFramework". */
  appTitle?: string;
}

const COOKIE_NAME = 'nf_session';
const SECURE_COOKIES = process.env.NODE_ENV === 'production' || process.env.EMU_SECURE_COOKIES === 'true';
/** Auth/system tables are never exposed through the generic data API. */
const PROTECTED_TABLES = new Set(['FW_Session', 'FW_WebArtifact']);
/** Users whose sessions bypass role checks (dev/admin). */
const ADMIN_USERS = new Set(['admin']);

interface ListQuery {
  limit?: string;
  offset?: string;
  sort?: string;
  [key: `filter.${string}`]: string | undefined;
}

function tableExists(db: { prepare: (sql: string) => any }, name: string): boolean {
  return Boolean(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name));
}

function migrateLegacyCoreTables(kernel: Kernel): void {
  if (tableExists(kernel.db, 'SystemUser') && tableExists(kernel.db, 'FW_User')) {
    kernel.db.exec(`
      INSERT OR IGNORE INTO "FW_User" (id, createdAt, createdBy, modifiedAt, modifiedBy, username, displayName, passwordHash, password, enabled)
      SELECT id, createdAt, createdBy, modifiedAt, modifiedBy, username, displayName, passwordHash, password, enabled
      FROM "SystemUser"
    `);
    // one-time migration: drop the legacy table so deleted users don't resurrect on the next boot
    kernel.db.exec(`DROP TABLE "SystemUser"`);
  }
  if (tableExists(kernel.db, 'SystemSession') && tableExists(kernel.db, 'FW_Session')) {
    kernel.db.exec(`
      INSERT OR IGNORE INTO "FW_Session" (id, createdAt, createdBy, modifiedAt, modifiedBy, token, username, expiresAt)
      SELECT id, createdAt, createdBy, modifiedAt, modifiedBy, token, username, expiresAt
      FROM "SystemSession"
    `);
    kernel.db.exec(`DROP TABLE "SystemSession"`);
  }
}

function migrateLegacyRoleTables(kernel: Kernel): void {
  if (!tableExists(kernel.db, 'SystemUserRole') || !tableExists(kernel.db, 'FW_UserRole')) return;
  const roleMap = new Map([
    [0, 0], // FrameworkUser -> FW_FrameworkUser
    [1, 1], // Admin -> ERP_Admin
    [2, 2], // SystemAdminRole -> FW_SystemAdminRole
    [3, 3], // SalesManager -> ERP_SalesManager
    [4, 4], // SalesClerk -> ERP_SalesClerk
  ]);
  const rows = kernel.db.prepare('SELECT userId, username, role FROM "SystemUserRole"').all() as { userId: number; username?: string; role: number }[];
  const insert = kernel.db.prepare('INSERT OR IGNORE INTO "FW_UserRole" (userId, username, role) VALUES (?, ?, ?)');
  for (const row of rows) {
    insert.run(row.userId, row.username ?? null, roleMap.get(row.role) ?? row.role);
  }
  // one-time migration — never re-import deleted assignments
  kernel.db.exec(`DROP TABLE "SystemUserRole"`);
}

function migrateLegacyDesignerArtifacts(kernel: Kernel): void {
  if (!tableExists(kernel.designerDb, 'SystemWebArtifact') || !tableExists(kernel.designerDb, 'FW_WebArtifact')) return;
  const existing = new Set((kernel.designerDb.prepare('SELECT name FROM "FW_WebArtifact"').all() as { name: string }[]).map((r) => r.name));
  const rows = kernel.designerDb.prepare('SELECT kind, name, json FROM "SystemWebArtifact"').all() as { kind: string; name: string; json: string }[];
  const insert = kernel.designerDb.prepare('INSERT OR IGNORE INTO "FW_WebArtifact" (kind, name, json) VALUES (?, ?, ?)');
  for (const row of rows) {
    const converted = convertLegacyArtifact(row);
    if (existing.has(converted.name)) continue;
    insert.run(converted.kind, converted.name, converted.json);
  }
  // one-time migration — deleted artifacts must not resurrect on the next boot
  kernel.designerDb.exec(`DROP TABLE "SystemWebArtifact"`);
}

function convertLegacyArtifact(row: { kind: string; name: string; json: string }): { kind: string; name: string; json: string } {
  const replacements: [RegExp, string][] = [
    [/\bSystemUserRole\b/g, 'FW_UserRole'],
    [/\bSystemUserForm\b/g, 'FW_UserForm'],
    [/\bSystemUser\b/g, 'FW_User'],
    [/\bSystemSession\b/g, 'FW_Session'],
    [/\bSystemWebArtifact\b/g, 'FW_WebArtifact'],
    [/\bSystemRole\b/g, 'FW_Role'],
    [/\bFrameworkUserPrivilege\b/g, 'FW_FrameworkUserPrivilege'],
    [/\bFrameworkUserDuty\b/g, 'FW_FrameworkUserDuty'],
    [/\bFrameworkUser\b/g, 'FW_FrameworkUser'],
    [/\bSystemAdminDuty\b/g, 'FW_SystemAdminDuty'],
    [/\bSystemAdminRole\b/g, 'FW_SystemAdminRole'],
    [/\bSystemAdmin\b/g, 'FW_SystemAdmin'],
    [/\bSalesOrderProcessing\b/g, 'ERP_SalesOrderProcessing'],
    [/\bSalesOrderProcess\b/g, 'ERP_SalesOrderProcess'],
    [/\bMasterDataMaintenance\b/g, 'ERP_MasterDataMaintenance'],
    [/\bMasterDataMaintain\b/g, 'ERP_MasterDataMaintain'],
    [/\bSalesManager\b/g, 'ERP_SalesManager'],
    [/\bSalesClerk\b/g, 'ERP_SalesClerk'],
    [/\bAdmin\b/g, 'ERP_Admin'],
    [/\bMainMenu\b/g, 'ERP_MainMenu'],
    [/\bSalesStatus\b/g, 'ERP_SalesStatus'],
    [/\bDirPartyType\b/g, 'ERP_DirPartyType'],
    [/\bDirPartyTableForm\b/g, 'ERP_DirPartyTableForm'],
    [/\bSalesTableForm\b/g, 'ERP_SalesTableForm'],
    [/\bInventItemForm\b/g, 'ERP_InventItemForm'],
    [/\bCustTableForm\b/g, 'ERP_CustTableForm'],
    [/\bVendTableForm\b/g, 'ERP_VendTableForm'],
    [/\berp\.credit\.Logic\b/g, 'ERP_Logic_Extension'],
    [/\berp\.Logic\b/g, 'ERP_Logic'],
  ];
  let name = row.name;
  let json = row.json;
  for (const [from, to] of replacements) {
    name = name.replace(from, to);
    json = json.replace(from, to);
  }
  return { kind: row.kind === 'script' && name.endsWith('_Extension') ? 'scriptExtension' : row.kind, name, json };
}

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const kernel = new Kernel(options.dbPath ?? ':memory:', options.designerDbPath);
  registerSystemApp(kernel);
  kernel.registerNativeLogic(registerSystemHooks);
  const appDirs = [...(options.appDirs ?? [])];
  for (const dir of appDirs) kernel.loadAppFromDir(dir);
  kernel.sync();
  kernel.syncDesigner();
  migrateLegacyCoreTables(kernel);
  // boot-time only (seed-style logic isn't idempotent) — persistent hooks
  // belong in kernel.registerNativeLogic or script artifacts
  options.registerLogic?.(kernel);
  seedAdmin(kernel.context());

  // First-boot: seed designer.db with all metadata if empty
  seedDesignerDb(kernel);
  migrateLegacyDesignerArtifacts(kernel);

  // merge web-designer artifacts from designer.db into the registry
  bootWebArtifacts(kernel);
  migrateLegacyRoleTables(kernel);

  // Assign admin roles now that SystemRole enum + SystemUserRole table exist
  (function seedAdminRoles() {
    const ctx = kernel.context();
    const admin = ctx.select('FW_User').whereEq({ username: 'admin' }).firstOnly();
    if (!admin || !admin.f.id) return;
    const uid = admin.f.id as number;
    try {
      const roleEnum = kernel.registry.getEnum('FW_Role');
      for (const roleName of ['FW_FrameworkUser', 'FW_SystemAdminRole']) {
        const val = roleEnum.values.find((v) => v.name === roleName);
        if (!val) continue;
        const exists = ctx
          .select('FW_UserRole')
          .whereEq({ userId: uid })
          .where('role', '=', val.value)
          .firstOnly();
        if (!exists) {
          ctx.newRecord('FW_UserRole').setMany({ userId: uid, username: 'admin', role: val.value }).insert();
        }
      }
    } catch {
      // FW_Role enum or FW_UserRole table not yet available - skip
    }
  })();

  const app = Fastify({ logger: false });
  app.register(cookie);

  // Serve the built client (packages/client/dist) as static files when it exists.
  // In local dev, the client runs its own Vite dev server (5199) and this dist folder
  // won't exist yet - skip silently so `pnpm --filter @emu/server dev` alone still works.
  const clientDist = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');
  if (existsSync(clientDist)) {
    app.register(fastifyStatic, { root: clientDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith('/api/')) {
        return reply.status(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html', clientDist);
    });
  }

  app.decorate('kernel', kernel);

  const systemCtx = () => kernel.context({ user: 'system' });

  const currentUser = (req: FastifyRequest): AuthUser | null =>
    resolveSession(systemCtx(), req.cookies[COOKIE_NAME]);

  const requireUser = (req: FastifyRequest): AuthUser => {
    const user = currentUser(req);
    if (!user) throw Object.assign(new Error('Not authenticated'), { statusCode: 401 });
    return user;
  };

  const rolesOf = (username: string): string[] => {
    const ctx = systemCtx();
    const user = ctx.select('FW_User').whereEq({ username }).firstOnly();
    if (!user || !user.f.id) return [];
    try {
      const roleEnum = kernel.registry.getEnum('FW_Role');
      return ctx
        .select('FW_UserRole')
        .whereEq({ userId: user.f.id as number })
        .toArray()
        .map((r) => {
          const val = roleEnum.values.find((v) => v.value === (r.f.role as number));
          return val?.name ?? String(r.f.role);
        });
    } catch {
      return [];
    }
  };

  const appAccessOf = (username: string): { openApps: Set<string>; customizeApps: Set<string>; hasRows: boolean } => {
    const ctx = systemCtx();
    const user = ctx.select('FW_User').whereEq({ username }).firstOnly();
    const openApps = new Set<string>();
    const customizeApps = new Set<string>();
    if (!user || !user.f.id || !kernel.registry.hasTable('FW_AppAccess')) {
      return { openApps, customizeApps, hasRows: false };
    }
    const rows = ctx.select('FW_AppAccess').whereEq({ userId: user.f.id as number }).toArray();
    for (const row of rows) {
      const appName = row.f.appName as string;
      if (row.f.canOpen) openApps.add(appName);
      if (row.f.canCustomize) customizeApps.add(appName);
    }
    return { openApps, customizeApps, hasRows: rows.length > 0 };
  };

  const policyOf = (username: string): SecurityPolicy =>
    ADMIN_USERS.has(username) ? allowAll : buildRolePolicy(kernel.registry, rolesOf(username));

  const userCtx = (req: FastifyRequest): DataContext => {
    const { username } = requireUser(req);
    return kernel.context({ user: username }, policyOf(username));
  };

  const dataTable = (name: string, req?: FastifyRequest) => {
    const user = req ? currentUser(req) : null;
    const isAdmin = user !== null && ADMIN_USERS.has(user.username);
    if (!isAdmin && PROTECTED_TABLES.has(name)) {
      throw Object.assign(new Error(`Unknown table '${name}'`), { statusCode: 404 });
    }
    if (!kernel.registry.hasTable(name)) {
      throw Object.assign(new Error(`Unknown table '${name}'`), { statusCode: 404 });
    }
    return kernel.registry.getTable(name);
  };

  /** Query-string values arrive as strings; coerce to the field's storage type. */
  const coerce = (tableName: string, field: string, value: string): FieldValue => {
    const meta = kernel.registry.getTable(tableName).fields.find((f) => f.name === field);
    if (!meta) return value; // system fields (id) — numeric below
    switch (meta.type) {
      case 'int':
      case 'real':
      case 'enum':
      case 'reference':
        return Number(value);
      case 'boolean':
        return value === 'true' || value === '1' ? 1 : 0;
      default:
        return value;
    }
  };

  /** Writes may only touch metadata-defined, non-readOnly fields — never system columns. */
  const writableBody = (tableName: string, body: { [field: string]: FieldValue }) => {
    const allowed = new Set(
      kernel.registry
        .getTable(tableName)
        .fields.filter((f) => !f.readOnly)
        .map((f) => f.name),
    );
    return Object.fromEntries(Object.entries(body ?? {}).filter(([k]) => allowed.has(k)));
  };

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ValidationError || err instanceof DataEventCancelled) {
      return reply.status(422).send({ error: err.message });
    }
    if (err instanceof SecurityError) {
      return reply.status(403).send({ error: err.message });
    }
    if (err instanceof MetadataError) {
      return reply.status(404).send({ error: err.message });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return reply.status(status).send({ error: err.message });
  });

  // ---- auth ----

  app.post<{ Body: { username?: string; password?: string } }>('/api/login', (req, reply) => {
    const { username, password } = req.body ?? {};
    const token = username && password ? login(systemCtx(), username, password) : null;
    if (!token) return reply.status(401).send({ error: 'Invalid credentials' });
    reply.setCookie(COOKIE_NAME, token, { path: '/', httpOnly: true, sameSite: 'lax', secure: SECURE_COOKIES });
    return { ok: true };
  });

  app.post('/api/logout', (req, reply) => {
    const token = req.cookies[COOKIE_NAME];
    if (token) logout(systemCtx(), token);
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', (req) => {
    const user = requireUser(req);
    return { ...user, roles: rolesOf(user.username) };
  });

  // ---- metadata (filtered by the caller's security policy) ----

  app.get('/api/metadata', (req) => {
    const user = requireUser(req);
    const policy = policyOf(user.username);
    const formAccess = policy.accessibleForms();
    const canOpen = (form: string) => formAccess === 'all' || formAccess.has(form);

    const forms = kernel.registry.allForms().filter((f) => canOpen(f.name));
    const usedTables = new Set(forms.flatMap((f) => [f.table, ...(f.lines ?? []).map((l) => l.table)]));

    // Recursively filter menu items by security
    const filterItems = (
      items: { label?: string; form?: string; route?: string; items?: typeof items }[] | undefined,
      allowRoutes = false,
    ): typeof items => {
      if (!items) return items;
      return items
        .map((item) => {
          if (item.items) {
            const children = filterItems(item.items, allowRoutes);
            // keep container if it has visible children or a visible form
            if ((children && children.length > 0) || (item.form && canOpen(item.form)) || (allowRoutes && item.route)) {
              return { ...item, items: children };
            }
            return null;
          }
          if (allowRoutes && item.route) return item;
          return item.form && canOpen(item.form) ? item : null;
        })
        .filter(Boolean) as typeof items;
    };

    // Build per-app grouping
    const allMenus = kernel.registry.allMenus();
    const userRoles = rolesOf(user.username);
    const isFrameworkUser =
      ADMIN_USERS.has(user.username) ||
      userRoles.includes('FW_FrameworkUser') ||
      userRoles.includes('FW_SystemAdminRole');
    const access = appAccessOf(user.username);
    const frameworkMenus: typeof allMenus = [];
    const appMap = new Map<string, { name: string; label: string; modules: string[]; menus: typeof allMenus }>();
    for (const app of kernel.registry.loadedApps()) {
      appMap.set(app.name, {
        name: app.name,
        label: app.label ?? app.name,
        modules: kernel.modulesForApp(app.name),
        menus: [],
      });
    }

    for (const menu of allMenus) {
      const appName = kernel.appForArtifact(menu.name);
      if (appName === 'system') {
        if (isFrameworkUser) {
          const filtered = { ...menu, items: filterItems(menu.items, true) ?? [] };
          if (filtered.items.length > 0) frameworkMenus.push(filtered);
        }
      } else if (appName && appMap.has(appName)) {
        const filtered = { ...menu, items: filterItems(menu.items) ?? [] };
        if (filtered.items.length > 0) {
          appMap.get(appName)!.menus.push(filtered);
        }
      } else {
        // Fallback: menu from unknown app (shouldn't happen)
        const filtered = { ...menu, items: filterItems(menu.items) ?? [] };
        if (filtered.items.length > 0) {
          frameworkMenus.push(filtered);
        }
      }
    }

    return {
      branding: { title: options.appTitle ?? 'EmuFramework' },
      tables: kernel.registry
        .allTables()
        .filter((t) => !PROTECTED_TABLES.has(t.name))
        .filter((t) => policy.can(t.name, 'read') || usedTables.has(t.name)),
      enums: kernel.registry.allEnums(),
      forms,
      privileges: kernel.registry.allPrivileges(),
      duties: kernel.registry.allDuties(),
      roles: kernel.registry.allRoles(),
      frameworkMenus,
      apps: [...appMap.values()].filter((a) => {
        if (a.menus.length === 0) return false;
        if (a.name === 'system') return false;
        if (ADMIN_USERS.has(user.username)) return true;
        // App access is explicit: no FW_AppAccess row with canOpen = the app is invisible.
        // (Framework admins keep full visibility so they can manage everything.)
        if (isFrameworkUser) return !access.hasRows || access.openApps.has(a.name);
        return access.openApps.has(a.name);
      }),
    };
  });

  // ---- web designer ----

  const requireDesigner = (req: FastifyRequest): void => {
    const user = requireUser(req);
    const access = appAccessOf(user.username);
    const allowed =
      ADMIN_USERS.has(user.username) ||
      rolesOf(user.username).some((r) => r === 'FW_SystemAdminRole' || r === 'FW_FrameworkUser') ||
      access.customizeApps.size > 0;
    if (!allowed) {
      throw Object.assign(new Error('Designer requires an administrator role'), { statusCode: 403 });
    }
  };

  /** Which apps this user may customize in the Designer ('all' for framework admins). */
  const designerScope = (req: FastifyRequest): 'all' | Set<string> => {
    const user = requireUser(req);
    if (
      ADMIN_USERS.has(user.username) ||
      rolesOf(user.username).some((r) => r === 'FW_SystemAdminRole' || r === 'FW_FrameworkUser')
    ) {
      return 'all';
    }
    return appAccessOf(user.username).customizeApps;
  };
  registerDesignerRoutes(app, kernel, requireDesigner, designerScope);

  // ---- actions (named server-side operations, e.g. SalesOrderPost) ----

  app.post<{ Params: { name: string }; Body: { [key: string]: unknown } }>(
    '/api/action/:name',
    (req) => {
      const handler = kernel.actions.get(req.params.name);
      if (!handler) throw Object.assign(new Error(`Unknown action '${req.params.name}'`), { statusCode: 404 });
      return handler(userCtx(req), req.body ?? {}) ?? { ok: true };
    },
  );

  // ---- generic data API ----

  app.get<{ Params: { table: string }; Querystring: ListQuery }>(
    '/api/data/:table',
    (req) => {
      const table = dataTable(req.params.table, req);
      const ctx = userCtx(req);
      const q = ctx.select(table.name);
      const countQ = ctx.select(table.name);
      for (const [key, value] of Object.entries(req.query)) {
        if (key.startsWith('filter.') && value !== undefined) {
          const field = key.slice('filter.'.length);
          const coerced = coerce(table.name, field, value);
          q.where(field, '=', coerced);
          countQ.where(field, '=', coerced);
        }
      }
      if (req.query.sort) {
        const [field, dir] = req.query.sort.split(':');
        q.orderBy(field, dir === 'desc' ? 'desc' : 'asc');
      }
      const limit = Math.min(Number(req.query.limit ?? 50), 500);
      const offset = Number(req.query.offset ?? 0);
      q.limit(limit, offset);
      return { data: q.toArray().map((r) => r.toObject()), total: countQ.count() };
    },
  );

  app.get<{ Params: { table: string; id: string } }>('/api/data/:table/:id', (req) => {
    const table = dataTable(req.params.table, req);
    const rec = userCtx(req).find(table.name, Number(req.params.id));
    if (!rec) throw Object.assign(new Error('Not found'), { statusCode: 404 });
    return rec.toObject();
  });

  app.post<{ Params: { table: string }; Body: { [field: string]: FieldValue } }>(
    '/api/data/:table',
    (req, reply) => {
      const table = dataTable(req.params.table, req);
      const rec = userCtx(req).newRecord(table.name);
      rec.setMany(writableBody(table.name, req.body));
      rec.insert();
      reply.status(201);
      return rec.toObject();
    },
  );

  app.patch<{ Params: { table: string; id: string }; Body: { [field: string]: FieldValue } }>(
    '/api/data/:table/:id',
    (req) => {
      const table = dataTable(req.params.table, req);
      const ctx = userCtx(req);
      const rec = ctx.find(table.name, Number(req.params.id));
      if (!rec) throw Object.assign(new Error('Not found'), { statusCode: 404 });
      rec.setMany(writableBody(table.name, req.body));
      rec.update();
      return rec.toObject();
    },
  );

  app.delete<{ Params: { table: string; id: string } }>('/api/data/:table/:id', (req) => {
    const table = dataTable(req.params.table, req);
    const rec = userCtx(req).find(table.name, Number(req.params.id));
    if (!rec) throw Object.assign(new Error('Not found'), { statusCode: 404 });
    rec.delete();
    return { ok: true };
  });

  return app;
}
