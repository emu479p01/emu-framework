import { existsSync } from 'node:fs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
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
  type MenuItemMeta,
  type SecurityPolicy,
} from '@emu/core';
import { registerSystemApp, registerSystemHooks } from './systemApp.js';
import { hashPassword, login, logout, resolveSession, verifyPassword, type AuthUser } from './auth.js';
import { bootWebArtifacts, registerDesignerRoutes } from './designer.js';
import { seedDesignerDb } from './seeder.js';
import { buildFilteredQuery, registerImportExportRoutes } from './importExport.js';
import { registerReportRoutes } from './reports.js';
import { registerFontRoutes } from './fontManager.js';
import { registerSystemMaintenanceRoutes } from './systemMaintenance.js';
import { createIntegrationManager, registerIntegrationRoutes } from './integrationServices.js';
import { registerUserSecurityRoutes } from './userSecurity.js';
import { registerViewRoutes } from './views.js';

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
  /** Deterministic first-setup code for automated tests. Production generates one. */
  setupCode?: string;
  /** Maximum rows returned by a View CSV export. Default 100,000. */
  viewCsvMaxRows?: number;
}

const COOKIE_NAME = 'nf_session';
const SECURE_COOKIES = process.env.NODE_ENV === 'production' || process.env.EMU_SECURE_COOKIES === 'true';
/** Auth/system tables are never exposed through the generic data API. */
const PROTECTED_TABLES = new Set([
  'FW_User', 'FW_UserRole', 'FW_AppAccess', 'FW_Session', 'FW_WebArtifact',
  'FW_Migration', 'FW_ViewToken', 'FW_ViewTokenScope',
]);
const SETUP_TTL_MS = 15 * 60 * 1000;
const SETUP_MAX_FAILURES = 10;

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

const LEGACY_ROLE_NAMES = new Map<number, string>([
  [0, 'FW_FrameworkUser'],
  [1, 'ERP_Admin'],
  [2, 'FW_SystemAdminRole'],
  [3, 'ERP_SalesManager'],
  [4, 'ERP_SalesClerk'],
]);

function migrateLegacyRoleTables(kernel: Kernel): void {
  if (!tableExists(kernel.db, 'SystemUserRole') || !tableExists(kernel.db, 'FW_UserRole')) return;
  const rows = kernel.db.prepare('SELECT userId, username, role FROM "SystemUserRole"').all() as { userId: number; username?: string; role: number }[];
  const insert = kernel.db.prepare('INSERT OR IGNORE INTO "FW_UserRole" (userId, username, role) VALUES (?, ?, ?)');
  for (const row of rows) {
    insert.run(row.userId, row.username ?? null, LEGACY_ROLE_NAMES.get(row.role) ?? String(row.role));
  }
  // one-time migration — never re-import deleted assignments
  kernel.db.exec(`DROP TABLE "SystemUserRole"`);
}

/** One-time migration: FW_UserRole.role used to store the FW_Role enum's numeric code — rewrite to the role's string name. */
function migrateRoleValuesToNames(kernel: Kernel): void {
  if (!tableExists(kernel.db, 'FW_UserRole')) return;
  const rows = kernel.db.prepare('SELECT id, role FROM "FW_UserRole"').all() as { id: number; role: unknown }[];
  const update = kernel.db.prepare('UPDATE "FW_UserRole" SET role = ? WHERE id = ?');
  for (const row of rows) {
    if (typeof row.role !== 'number') continue;
    update.run(LEGACY_ROLE_NAMES.get(row.role) ?? String(row.role), row.id);
  }
}

function migrateLegacyDesignerArtifacts(kernel: Kernel): void {
  if (!tableExists(kernel.designerDb, 'SystemWebArtifact') || !tableExists(kernel.designerDb, 'FW_WebArtifact')) return;
  const existing = new Set((kernel.designerDb.prepare('SELECT name FROM "FW_WebArtifact"').all() as { name: string }[]).map((r) => r.name));
  const rows = kernel.designerDb.prepare('SELECT kind, name, json FROM "SystemWebArtifact"').all() as { kind: string; name: string; json: string }[];
  const insert = kernel.designerDb.prepare('INSERT OR IGNORE INTO "FW_WebArtifact" (kind, name, json) VALUES (?, ?, ?)');
  for (const row of rows) {
    const converted = convertLegacyArtifact(row);
    if (existing.has(converted.name)) continue;
    // the old SystemRole/FW_Role enum is obsolete — role names now come from the FW_Role list (kind: 'role') artifacts only
    if (converted.kind === 'enum' && converted.name === 'FW_Role') continue;
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

/**
 * Older releases auto-injected a default 'ClientCustom' model into every app
 * manifest, so designer-created apps were stored without a `models` array.
 * Now that user apps start with no models, patch stored manifests by
 * harvesting the model names their own artifacts reference — otherwise those
 * artifacts fail "unknown model" at boot and get skipped.
 */
function migrationApplied(kernel: Kernel, migration: string): boolean {
  return Boolean(kernel.db.prepare('SELECT 1 FROM "FW_Migration" WHERE migration=?').get(migration));
}

function markMigration(kernel: Kernel, migration: string): void {
  kernel.db.prepare(`INSERT OR IGNORE INTO "FW_Migration" (createdAt,createdBy,modifiedAt,modifiedBy,migration,appliedAt) VALUES (CURRENT_TIMESTAMP,'migration',CURRENT_TIMESTAMP,'migration',?,CURRENT_TIMESTAMP)`).run(migration);
}

function migrateManifestModels(kernel: Kernel): void {
  const migration = 'v0.1.1.0-explicit-models';
  if (migrationApplied(kernel, migration)) return;
  if (!tableExists(kernel.designerDb, 'FW_WebArtifact')) return;
  const rows = kernel.designerDb.prepare('SELECT name, json FROM "FW_WebArtifact"').all() as { name: string; json: string }[];
  const artifacts: ({ kind: string; name: string; app?: string; model?: string; layer?: string; models?: Array<{ name: string; label?: string; layer: string }> } & { rowName: string })[] = [];
  for (const row of rows) {
    try { artifacts.push({ ...JSON.parse(row.json), rowName: row.name }); } catch { /* skipped at boot anyway */ }
  }
  const update = kernel.designerDb.prepare('UPDATE "FW_WebArtifact" SET json = ?, modifiedAt = CURRENT_TIMESTAMP, modifiedBy = ? WHERE name = ?');
  kernel.designerDb.transaction(() => {
    for (const manifest of artifacts) {
      if (manifest.kind !== 'app') continue;
      const children = artifacts.filter((artifact) => artifact.kind !== 'app' && artifact.app === manifest.name);
      const models = new Map<string, string>((manifest.models ?? []).map((model) => [model.name, model.layer]));
      for (const artifact of children) if (artifact.model && !models.has(artifact.model)) models.set(artifact.model, artifact.layer ?? 'CUS');
      const legacyDefaults: Record<string, { name: string; layer: string }> = {
        erp: { name: 'MiniERPApplication', layer: 'SYS' },
        'erp.credit': { name: 'MiniERPCredit', layer: 'DEV' },
        web: { name: 'ClientCustom', layer: 'CUS' },
      };
      if (models.size === 0 && legacyDefaults[manifest.name]) {
        const legacy = legacyDefaults[manifest.name]!;
        models.set(legacy.name, legacy.layer);
      }
      if (models.size === 0) continue;
      if (!manifest.models?.length) {
        const { rowName: _rowName, ...wire } = manifest;
        update.run(JSON.stringify({ ...wire, models: [...models.entries()].map(([name, layer]) => ({ name, label: name, layer })) }), 'migration', manifest.rowName);
      }
      if (models.size === 1) {
        const [modelName, modelLayer] = [...models.entries()][0]!;
        for (const child of children.filter((artifact) => !artifact.model)) {
          const { rowName: _rowName, ...wire } = child;
          update.run(JSON.stringify({ ...wire, model: modelName, layer: modelLayer }), 'migration', child.rowName);
        }
      }
    }
    const appLess = artifacts.filter((artifact) => artifact.kind !== 'app' && !artifact.app);
    if (appLess.length) {
      const modelName = 'ClientCustom';
      for (const artifact of appLess) {
        const { rowName: _rowName, ...wire } = artifact;
        update.run(JSON.stringify({ ...wire, app: 'web', model: artifact.model ?? modelName, layer: artifact.layer ?? 'CUS' }), 'migration', artifact.rowName);
      }
      if (!artifacts.some((artifact) => artifact.kind === 'app' && artifact.name === 'web')) {
        const manifest = { kind: 'app', name: 'web', label: 'Legacy Web', models: [{ name: modelName, label: 'Client Custom', layer: 'CUS' }] };
        kernel.designerDb.prepare(`INSERT INTO "FW_WebArtifact" (createdAt,createdBy,modifiedAt,modifiedBy,kind,name,json) VALUES (CURRENT_TIMESTAMP,'migration',CURRENT_TIMESTAMP,'migration','app','web',?)`).run(JSON.stringify(manifest));
      }
    }
  })();
  markMigration(kernel, migration);
}

function migrateFrameworkUserCustomization(kernel: Kernel): void {
  const migration = 'v0.1.1.0-framework-user-customize';
  if (migrationApplied(kernel, migration)) return;
  const apps = kernel.registry.loadedApps().filter((entry) => entry.name !== 'system').map((entry) => entry.name);
  kernel.db.transaction(() => {
    const users = kernel.db.prepare(`SELECT DISTINCT userId FROM "FW_UserRole" WHERE role='FW_FrameworkUser'`).all() as { userId: number }[];
    const existing = kernel.db.prepare('SELECT id,canOpen FROM "FW_AppAccess" WHERE userId=? AND appName=?');
    const insert = kernel.db.prepare(`INSERT INTO "FW_AppAccess" (createdAt,createdBy,modifiedAt,modifiedBy,userId,appName,canOpen,canCustomize) VALUES (CURRENT_TIMESTAMP,'migration',CURRENT_TIMESTAMP,'migration',?,?,0,1)`);
    const update = kernel.db.prepare(`UPDATE "FW_AppAccess" SET canCustomize=1, modifiedAt=CURRENT_TIMESTAMP, modifiedBy='migration' WHERE id=?`);
    for (const user of users) for (const appName of apps) {
      const row = existing.get(user.userId, appName) as { id: number; canOpen: number } | undefined;
      if (row) update.run(row.id);
      else insert.run(user.userId, appName);
    }
    markMigration(kernel, migration);
  })();
}

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const dbPath = options.dbPath ?? ':memory:';
  const designerDbPath = options.designerDbPath ?? (dbPath === ':memory:' ? undefined : dbPath.replace(/\.sqlite$|\.db$/i, '.designer.sqlite'));
  const kernel = new Kernel(dbPath, designerDbPath);
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
  // First-boot: seed designer.db with all metadata if empty
  seedDesignerDb(kernel);
  migrateLegacyDesignerArtifacts(kernel);
  migrateManifestModels(kernel);

  // merge web-designer artifacts from designer.db into the registry
  bootWebArtifacts(kernel);
  migrateLegacyRoleTables(kernel);
  migrateRoleValuesToNames(kernel);
  migrateFrameworkUserCustomization(kernel);

  const initialCtx = kernel.context();
  const legacyAdmin = initialCtx.select('FW_User').whereEq({ username: 'admin' }).firstOnly();
  const legacyDefaultPassword = Boolean(
    legacyAdmin?.f.passwordHash && verifyPassword('admin', legacyAdmin.f.passwordHash as string),
  );
  if (legacyDefaultPassword) {
    for (const session of initialCtx.select('FW_Session').whereEq({ username: 'admin' }).toArray()) session.delete();
  }

  const hasEnabledSystemAdmin = (): boolean => {
    try {
      const roleRows = kernel.context().select('FW_UserRole').whereEq({ role: 'FW_SystemAdminRole' }).toArray();
      return roleRows.some((row) => {
        const user = kernel.context().find('FW_User', row.f.userId as number);
        return Boolean(user?.f.enabled) && !(user?.f.username === 'admin' && legacyDefaultPassword);
      });
    } catch { return false; }
  };

  let setupRequired = legacyDefaultPassword || !hasEnabledSystemAdmin();
  let setupCompleting = false;
  let setupFailures = 0;
  let setupExpiresAt = Date.now() + SETUP_TTL_MS;
  const setupCode = options.setupCode ?? randomBytes(6).toString('hex').toUpperCase();
  const setupCodeHash = createHash('sha256').update(setupCode).digest();
  if (setupRequired) {
    console.log(`[Setup] Administrator setup required. One-time code: ${setupCode} (expires in 15 minutes)`);
  }

  const app = Fastify({ logger: false });
  const integrations = createIntegrationManager(kernel, designerDbPath);
  app.register(cookie);
  app.register(multipart);

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
  app.get('/api/health', () => ({ ok: true }));

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
      return ctx
        .select('FW_UserRole')
        .whereEq({ userId: user.f.id as number })
        .toArray()
        .map((r) => r.f.role as string);
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

  const policyOf = (username: string): SecurityPolicy => {
    const roles = rolesOf(username);
    if (roles.includes('FW_SystemAdminRole')) return allowAll;
    const base = buildRolePolicy(kernel.registry, roles);
    const access = appAccessOf(username);
    const canOpenArtifact = (name: string) => {
      const owner = kernel.appForArtifact(name);
      return Boolean(owner && owner !== 'system' && access.openApps.has(owner));
    };
    const formAccess = base.accessibleForms();
    return {
      can: (table, op) => base.can(table, op) && canOpenArtifact(table),
      accessibleForms: () => new Set(
        (formAccess === 'all' ? kernel.registry.allForms().map((form) => form.name) : [...formAccess])
          .filter(canOpenArtifact),
      ),
      canFunction: (name) => base.canFunction(name) && canOpenArtifact(name),
      canReport: (name) => base.canReport(name) && canOpenArtifact(name),
      canView: (name) => base.canView(name) && canOpenArtifact(name),
      canChart: (name) => base.canChart(name) && canOpenArtifact(name),
      canPrivilege: (name) => base.canPrivilege(name) && canOpenArtifact(name),
      rowScope: base.rowScope,
    };
  };

  const userCtx = (req: FastifyRequest): DataContext => {
    const { username } = requireUser(req);
    return kernel.context({ user: username }, policyOf(username));
  };

  const dataTable = (name: string, req?: FastifyRequest) => {
    void req;
    if (PROTECTED_TABLES.has(name)) {
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
  const writableBody = (tableName: string, body: { [field: string]: FieldValue }, operation: 'create' | 'update' = 'create') => {
    const table = kernel.registry.getTable(tableName);
    const fields = new Map(table.fields.map((f) => [f.name, f]));
    const output: { [field: string]: FieldValue } = {};
    for (const [name, value] of Object.entries(body ?? {})) {
      if (['id', 'createdAt', 'createdBy', 'modifiedAt', 'modifiedBy'].includes(name)) continue;
      const field = fields.get(name);
      if (!field) throw new ValidationError(`${tableName}: unknown field '${name}'`);
      const editable = !field.readOnly && (operation === 'create' ? field.allowEditOnCreate !== false : field.allowEdit !== false);
      if (!editable) throw new ValidationError(`${tableName}.${name} cannot be edited ${operation === 'create' ? 'during creation' : 'after creation'}`);
      output[name] = value;
    }
    return output;
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

  app.get('/api/setup/status', () => ({
    required: setupRequired,
    expiresAt: setupRequired ? new Date(setupExpiresAt).toISOString() : null,
    legacyReset: setupRequired && legacyDefaultPassword,
    username: setupRequired && legacyDefaultPassword ? 'admin' : null,
  }));

  app.post<{ Body: { code?: string; username?: string; displayName?: string; password?: string } }>('/api/setup/complete', (req, reply) => {
    if (!setupRequired) return reply.status(409).send({ error: 'Administrator setup is already complete' });
    if (setupCompleting) return reply.status(409).send({ error: 'Administrator setup is already in progress' });
    if (Date.now() > setupExpiresAt || setupFailures >= SETUP_MAX_FAILURES) {
      return reply.status(410).send({ error: 'Setup code expired; restart the server to generate a new code' });
    }
    const candidateHash = createHash('sha256').update(String(req.body?.code ?? '').trim().toUpperCase()).digest();
    if (!timingSafeEqual(candidateHash, setupCodeHash)) {
      setupFailures += 1;
      return reply.status(403).send({ error: 'Invalid setup code' });
    }
    const requestedUsername = String(req.body?.username ?? '').trim();
    const username = legacyDefaultPassword ? 'admin' : requestedUsername;
    const displayName = String(req.body?.displayName ?? '').trim() || username;
    const password = String(req.body?.password ?? '');
    if (!/^[A-Za-z0-9._-]{3,60}$/.test(username)) return reply.status(422).send({ error: 'Username must be 3-60 letters, numbers, dots, underscores, or hyphens' });
    if (password.length < 12) return reply.status(422).send({ error: 'Password must be at least 12 characters' });
    setupCompleting = true;
    try {
      const ctx = kernel.context();
      ctx.tts(() => {
        let user = ctx.select('FW_User').whereEq({ username }).firstOnly();
        if (user && !legacyDefaultPassword) throw Object.assign(new Error('Username already exists'), { statusCode: 409 });
        if (user) user.setMany({ displayName, passwordHash: hashPassword(password), password: null, enabled: true }).update();
        else {
          user = ctx.newRecord('FW_User').setMany({ username, displayName, passwordHash: hashPassword(password), enabled: true });
          user.insert();
        }
        const existingRole = ctx.select('FW_UserRole').whereEq({ userId: user.id as number }).where('role', '=', 'FW_SystemAdminRole').firstOnly();
        if (!existingRole) ctx.newRecord('FW_UserRole').setMany({ userId: user.id, username, role: 'FW_SystemAdminRole' }).insert();
        for (const session of ctx.select('FW_Session').whereEq({ username }).toArray()) session.delete();
      });
      setupRequired = false;
      setupExpiresAt = 0;
      const token = login(kernel.context(), username, password);
      if (!token) throw new Error('Administrator setup succeeded but login failed');
      reply.setCookie(COOKIE_NAME, token, { path: '/', httpOnly: true, sameSite: 'lax', secure: SECURE_COOKIES });
      return { ok: true };
    } finally {
      setupCompleting = false;
    }
  });

  app.post<{ Body: { username?: string; password?: string } }>('/api/login', (req, reply) => {
    if (setupRequired) return reply.status(409).send({ error: 'Administrator setup is required' });
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
    const canOpen = (form: string) => {
      const metadata = kernel.registry.allForms().find((entry) => entry.name === form);
      return Boolean(
        metadata
        && !PROTECTED_TABLES.has(metadata.table)
        && (formAccess === 'all' || formAccess.has(form))
        && policy.can(metadata.table, 'read')
        && (metadata.lines ?? []).every((line) => policy.can(line.table, 'read')),
      );
    };
    const canOpenReport = (name: string) => {
      const report = kernel.registry.allReports().find((entry) => entry.name === name);
      return Boolean(report && policy.canReport(name) && policy.can(report.dataSource, 'read'));
    };
    const canOpenFunction = (name: string) => policy.canFunction(name);
    const canUseView = (name: string) => {
      if (!policy.canView(name) || !kernel.registry.hasView(name)) return false;
      const view = kernel.registry.getView(name);
      return [view.source.table, ...(view.joins ?? []).map((join) => join.table)].every((table) => policy.can(table, 'read'));
    };
    const userRoles = rolesOf(user.username);
    const isSystemAdmin = userRoles.includes('FW_SystemAdminRole');

    const forms = kernel.registry.allForms().filter((f) => !PROTECTED_TABLES.has(f.table) && canOpen(f.name)).map((f) => {
      const secureAction = (action: NonNullable<typeof f.actions>[number]) => {
        const target = action.target ?? action.action;
        const type = action.type ?? 'function';
        const allowed = action.privilege ? policy.canPrivilege(action.privilege) : type === 'report' ? policy.canReport(target ?? '') : policy.canFunction(target ?? '');
        return { ...action, disabled: !allowed };
      };
      return {
        ...f,
        actions: f.actions?.map(secureAction),
        charts: f.charts?.filter((embedded) => {
          try { return policy.canChart(embedded.chart) && canUseView(kernel.registry.getChart(embedded.chart).view); } catch { return false; }
        }),
        lines: f.lines?.map((line) => ({ ...line, actions: line.actions?.map(secureAction) })),
      };
    });
    const usedTables = new Set(forms.flatMap((f) => [f.table, ...(f.lines ?? []).map((l) => l.table)]));
    const visibleTables = kernel.registry
      .allTables()
      .filter((t) => !PROTECTED_TABLES.has(t.name))
      .filter((t) => policy.can(t.name, 'read') || usedTables.has(t.name))
      .map((t) => t);
    const visibleEnums = new Set(
      visibleTables.flatMap((table) => table.fields.filter((field) => field.type === 'enum' && field.enumName).map((field) => field.enumName!)),
    );

    // Recursively filter menu items by security
    const filterItems = (
      items: MenuItemMeta[] | undefined,
      allowRoutes = false,
    ): typeof items => {
      if (!items) return items;
      return items
        .map((item) => {
          if (item.items) {
            const children = filterItems(item.items, allowRoutes);
            // keep container if it has visible children or a visible form
            const targetVisible = item.target?.type === 'form' ? canOpen(item.target.name) : item.target?.type === 'report' ? canOpenReport(item.target.name) : item.target?.type === 'function' ? canOpenFunction(item.target.name) : false;
            if ((children && children.length > 0) || (item.form && canOpen(item.form)) || targetVisible || (allowRoutes && item.route)) {
              return { ...item, items: children };
            }
            return null;
          }
          if (allowRoutes && item.route) return item;
          if (item.target?.type === 'form' && canOpen(item.target.name)) return item;
          if (item.target?.type === 'report' && canOpenReport(item.target.name)) return item;
          if (item.target?.type === 'function' && canOpenFunction(item.target.name)) return item;
          return item.form && canOpen(item.form) ? item : null;
        })
        .filter(Boolean) as typeof items;
    };

    // Build per-app grouping
    const allMenus = kernel.registry.allMenus();
    const isFrameworkAdmin = isSystemAdmin;
    const access = appAccessOf(user.username);
    const frameworkMenus: typeof allMenus = [];
    const appMap = new Map<string, { name: string; label: string; icon?: import('@emu/core').IconName; dependsOn?: string[]; models?: { name: string; label?: string; layer: import('@emu/core').LayerType }[]; modules: string[]; menus: typeof allMenus }>();
    for (const app of kernel.registry.loadedApps()) {
      appMap.set(app.name, {
        name: app.name,
        label: app.label ?? app.name,
        icon: app.icon,
        dependsOn: app.dependsOn,
        models: app.models,
        modules: kernel.modulesForApp(app.name),
        menus: [],
      });
    }

    for (const menu of allMenus) {
      const appName = kernel.appForArtifact(menu.name);
      if (appName === 'system') {
        const systemItems = menu.items.filter((item) => {
          if (item.route === '/account/password') return true;
          if (item.route === '/designer') return isFrameworkAdmin || access.customizeApps.size > 0;
          return isFrameworkAdmin;
        });
        const filtered = { ...menu, items: filterItems(systemItems, true) ?? [] };
        if (filtered.items.length > 0) frameworkMenus.push(filtered);
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
      capabilities: {
        designer: isFrameworkAdmin || access.customizeApps.size > 0,
        maintenance: isFrameworkAdmin,
        tableBrowser: isFrameworkAdmin,
        securityAdmin: isFrameworkAdmin,
        myAccount: true,
      },
      tables: visibleTables,
      enums: kernel.registry.allEnums().filter((entry) => visibleEnums.has(entry.name)),
      forms,
      reports: kernel.registry.allReports().filter((r) => !PROTECTED_TABLES.has(r.dataSource) && policy.canReport(r.name) && policy.can(r.dataSource, 'read')),
      views: kernel.registry.allViews().filter((view) => canUseView(view.name)),
      charts: kernel.registry.allCharts().filter((chart) => policy.canChart(chart.name) && canUseView(chart.view)),
      privileges: isFrameworkAdmin ? kernel.registry.allPrivileges() : [],
      duties: isFrameworkAdmin ? kernel.registry.allDuties() : [],
      roles: isFrameworkAdmin ? kernel.registry.allRoles() : [],
      actions: [...kernel.actions.keys()].filter((name) => policy.canFunction(name)).sort(),
      frameworkMenus,
      apps: [...appMap.values()].filter((a) => {
        if (a.menus.length === 0) return false;
        if (a.name === 'system') return false;
        // App access is explicit: no FW_AppAccess row with canOpen = the app is invisible.
        // (Framework admins keep full visibility so they can manage everything.)
        if (isSystemAdmin) return true;
        return access.openApps.has(a.name);
      }),
    };
  });

  // ---- web designer ----

  const requireDesigner = (req: FastifyRequest): string => {
    const user = requireUser(req);
    const access = appAccessOf(user.username);
    const allowed =
      rolesOf(user.username).includes('FW_SystemAdminRole') ||
      access.customizeApps.size > 0;
    if (!allowed) {
      throw Object.assign(new Error('Designer requires an administrator role'), { statusCode: 403 });
    }
    return user.username;
  };

  /** Which apps this user may customize in the Designer ('all' for framework admins). */
  const designerScope = (req: FastifyRequest): 'all' | Set<string> => {
    const user = requireUser(req);
    if (rolesOf(user.username).includes('FW_SystemAdminRole')) {
      return 'all';
    }
    return appAccessOf(user.username).customizeApps;
  };
  registerDesignerRoutes(app, kernel, requireDesigner, designerScope);
  const requireFrameworkAdmin = (req: FastifyRequest): string => {
    const user = requireUser(req);
    if (!rolesOf(user.username).includes('FW_SystemAdminRole')) {
      throw Object.assign(new Error('System maintenance requires a framework administrator'), { statusCode: 403 });
    }
    return user.username;
  };
  registerSystemMaintenanceRoutes(app, kernel, requireFrameworkAdmin);
  registerFontRoutes(app, kernel, requireFrameworkAdmin, requireUser);
  registerIntegrationRoutes(app, integrations, requireFrameworkAdmin);
  registerUserSecurityRoutes(app, kernel, {
    requireUser,
    requireAdmin: requireFrameworkAdmin,
    cookieName: COOKIE_NAME,
    secureCookies: SECURE_COOKIES,
  });
  registerViewRoutes(app, kernel, {
    userCtx,
    requireAdmin: requireFrameworkAdmin,
    csvMaxRows: (() => {
      const configured = options.viewCsvMaxRows ?? Number(process.env.EMU_VIEW_CSV_MAX_ROWS ?? 100_000);
      return Number.isFinite(configured) ? Math.max(1, Math.trunc(configured)) : 100_000;
    })(),
  });

  // ---- actions (named server-side operations, e.g. SalesOrderPost) ----

  app.post<{ Params: { name: string }; Body: { [key: string]: unknown } }>(
    '/api/action/:name',
    async (req) => {
      const handler = kernel.actions.get(req.params.name);
      if (!handler) throw Object.assign(new Error(`Unknown action '${req.params.name}'`), { statusCode: 404 });
      const ctx = userCtx(req);
      if (!ctx.policy.canFunction(req.params.name)) throw new SecurityError(`Access denied: function '${req.params.name}'`);
      if (kernel.actionModes.get(req.params.name) === 'async') {
        return (await handler(ctx, req.body ?? {}, integrations.services)) ?? { ok: true };
      }
      return ctx.tts(() => handler(ctx, req.body ?? {}, integrations.services) ?? { ok: true });
    },
  );

  // ---- generic data API ----

  app.get<{ Params: { table: string }; Querystring: ListQuery }>(
    '/api/data/:table',
    (req) => {
      const table = dataTable(req.params.table, req);
      const ctx = userCtx(req);
      const query = req.query as unknown as { [key: string]: string | undefined };
      const searchable = table.fields.filter((field) => field.type === 'string' || field.type === 'int' || field.type === 'real').map((field) => field.name);
      const q = buildFilteredQuery(ctx, table.name, query, coerce, searchable);
      const countQ = buildFilteredQuery(ctx, table.name, query, coerce, searchable);
      const limit = Math.min(Number(req.query.limit ?? 50), 500);
      const offset = Number(req.query.offset ?? 0);
      q.limit(limit, offset);
      return { data: q.toArray().map((r) => r.toObject()), total: countQ.count() };
    },
  );

  registerImportExportRoutes(app, kernel, { userCtx, dataTable, coerce, writableBody });
  registerReportRoutes(app, kernel, { userCtx, coerce });

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
      rec.setMany(writableBody(table.name, req.body, 'create'));
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
      rec.setMany(writableBody(table.name, req.body, 'update'));
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
