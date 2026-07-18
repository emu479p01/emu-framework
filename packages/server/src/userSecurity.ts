import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Kernel } from '@emu/core';
import { createSession, hashPassword, MIN_PASSWORD_LENGTH, verifyPassword, type AuthUser } from './auth.js';

interface AppGrantInput { appName?: string; canOpen?: boolean; canCustomize?: boolean }
interface UserInput {
  username?: string;
  displayName?: string;
  password?: string;
  enabled?: boolean;
  roles?: string[];
  appAccess?: AppGrantInput[];
}

interface SecurityRouteDeps {
  requireUser(req: FastifyRequest): AuthUser;
  requireAdmin(req: FastifyRequest): string;
  cookieName: string;
  secureCookies: boolean;
}

const USERNAME = /^[A-Za-z0-9._-]{3,60}$/;

export function registerUserSecurityRoutes(
  app: FastifyInstance,
  kernel: Kernel,
  deps: SecurityRouteDeps,
): void {
  const bad = (message: string, statusCode = 422): never => {
    throw Object.assign(new Error(message), { statusCode });
  };
  const validatePassword = (password: string): void => {
    if (password.length < MIN_PASSWORD_LENGTH) bad(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  };
  const businessApps = () => kernel.registry.loadedApps().filter((entry) => entry.name !== 'system');
  const validRoles = () => new Set(kernel.registry.allRoles().map((entry) => entry.name));
  const validateAssignments = (body: UserInput) => {
    const roles = [...new Set((body.roles ?? []).map(String))];
    const knownRoles = validRoles();
    for (const role of roles) if (!knownRoles.has(role)) bad(`Unknown role '${role}'`);
    const knownApps = new Set(businessApps().map((entry) => entry.name));
    const appAccess = body.appAccess ?? [];
    const seen = new Set<string>();
    for (const grant of appAccess) {
      const appName = String(grant.appName ?? '');
      if (!knownApps.has(appName)) bad(`Unknown app '${appName}'`);
      if (seen.has(appName)) bad(`Duplicate app access '${appName}'`);
      seen.add(appName);
    }
    return { roles, appAccess: appAccess.map((grant) => ({ appName: String(grant.appName), canOpen: Boolean(grant.canOpen), canCustomize: Boolean(grant.canCustomize) })) };
  };
  const adminCount = (): number => Number((kernel.db.prepare(`
    SELECT COUNT(DISTINCT u.id) AS total
    FROM "FW_User" u JOIN "FW_UserRole" r ON r.userId = u.id
    WHERE u.enabled = 1 AND r.role = 'FW_SystemAdminRole'
  `).get() as { total: number }).total);
  const isEnabledAdmin = (id: number): boolean => Boolean(kernel.db.prepare(`
    SELECT 1 FROM "FW_User" u JOIN "FW_UserRole" r ON r.userId=u.id
    WHERE u.id=? AND u.enabled=1 AND r.role='FW_SystemAdminRole'
  `).get(id));
  const ensureNotLastAdmin = (id: number, nextEnabled: boolean, nextRoles: string[]): void => {
    if (isEnabledAdmin(id) && (!nextEnabled || !nextRoles.includes('FW_SystemAdminRole')) && adminCount() <= 1) {
      bad('The last enabled System Administrator cannot be disabled, deleted, or have its role removed', 409);
    }
  };
  const rowsFor = (id: number) => ({
    roles: (kernel.db.prepare('SELECT role FROM "FW_UserRole" WHERE userId=? ORDER BY role').all(id) as { role: string }[]).map((row) => row.role),
    appAccess: (kernel.db.prepare('SELECT appName, canOpen, canCustomize FROM "FW_AppAccess" WHERE userId=? ORDER BY appName').all(id) as { appName: string; canOpen: number; canCustomize: number }[])
      .map((row) => ({ appName: row.appName, canOpen: Boolean(row.canOpen), canCustomize: Boolean(row.canCustomize) })),
  });
  const replaceAssignments = (id: number, username: string, roles: string[], grants: ReturnType<typeof validateAssignments>['appAccess'], actor: string) => {
    kernel.db.prepare('DELETE FROM "FW_UserRole" WHERE userId=?').run(id);
    kernel.db.prepare('DELETE FROM "FW_AppAccess" WHERE userId=?').run(id);
    const roleInsert = kernel.db.prepare(`INSERT INTO "FW_UserRole" (createdAt,createdBy,modifiedAt,modifiedBy,userId,username,role) VALUES (CURRENT_TIMESTAMP,?,CURRENT_TIMESTAMP,?,?,?,?)`);
    for (const role of roles) roleInsert.run(actor, actor, id, username, role);
    const accessInsert = kernel.db.prepare(`INSERT INTO "FW_AppAccess" (createdAt,createdBy,modifiedAt,modifiedBy,userId,appName,canOpen,canCustomize) VALUES (CURRENT_TIMESTAMP,?,CURRENT_TIMESTAMP,?,?,?,?,?)`);
    for (const grant of grants) accessInsert.run(actor, actor, id, grant.appName, grant.canOpen ? 1 : 0, grant.canCustomize ? 1 : 0);
  };

  app.get('/api/system/security/catalog', (req) => {
    deps.requireAdmin(req);
    return {
      roles: kernel.registry.allRoles().map((role) => ({ name: role.name, label: role.label ?? role.name, legacy: role.name === 'FW_FrameworkUser' })),
      apps: businessApps().map((entry) => ({ name: entry.name, label: entry.label ?? entry.name })),
    };
  });

  app.get('/api/system/security/users', (req) => {
    deps.requireAdmin(req);
    const users = kernel.db.prepare('SELECT id, username, displayName, enabled, createdAt, modifiedAt FROM "FW_User" ORDER BY username').all() as Array<Record<string, unknown> & { id: number }>;
    return { data: users.map((user) => ({ ...user, enabled: Boolean(user.enabled), ...rowsFor(user.id) })) };
  });

  app.post<{ Body: UserInput }>('/api/system/security/users', (req, reply) => {
    const actor = deps.requireAdmin(req);
    const username = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');
    if (!USERNAME.test(username)) bad('Username must be 3-60 letters, numbers, dots, underscores, or hyphens');
    validatePassword(password);
    const assignments = validateAssignments(req.body ?? {});
    if (kernel.db.prepare('SELECT 1 FROM "FW_User" WHERE username=?').get(username)) bad('Username already exists', 409);
    const transaction = kernel.db.transaction(() => {
      const result = kernel.db.prepare(`INSERT INTO "FW_User" (createdAt,createdBy,modifiedAt,modifiedBy,username,displayName,passwordHash,password,enabled) VALUES (CURRENT_TIMESTAMP,?,CURRENT_TIMESTAMP,?,?,?,?,?,?)`)
        .run(actor, actor, username, String(req.body?.displayName ?? '').trim() || username, hashPassword(password), null, req.body?.enabled === false ? 0 : 1);
      const id = Number(result.lastInsertRowid);
      replaceAssignments(id, username, assignments.roles, assignments.appAccess, actor);
      return id;
    });
    const id = transaction();
    reply.status(201);
    return { id, username, displayName: String(req.body?.displayName ?? '').trim() || username, enabled: req.body?.enabled !== false, ...rowsFor(id) };
  });

  app.patch<{ Params: { id: string }; Body: UserInput }>('/api/system/security/users/:id', (req) => {
    const actor = deps.requireAdmin(req);
    const id = Number(req.params.id);
    const existing = kernel.db.prepare('SELECT id,username,displayName,enabled FROM "FW_User" WHERE id=?').get(id) as { id: number; username: string; displayName?: string; enabled: number } | undefined;
    if (!existing) bad('User not found', 404);
    const userRow = existing!;
    if (req.body?.username !== undefined && req.body.username !== userRow.username) bad('Username cannot be changed after creation');
    if (req.body?.password !== undefined) bad('Use the reset-password endpoint to set a password');
    const current = rowsFor(id);
    const assignments = req.body?.roles !== undefined || req.body?.appAccess !== undefined
      ? validateAssignments({ roles: req.body.roles ?? current.roles, appAccess: req.body.appAccess ?? current.appAccess })
      : { roles: current.roles, appAccess: current.appAccess };
    const enabled = req.body?.enabled ?? Boolean(userRow.enabled);
    ensureNotLastAdmin(id, enabled, assignments.roles);
    kernel.db.transaction(() => {
      kernel.db.prepare('UPDATE "FW_User" SET displayName=?, enabled=?, modifiedAt=CURRENT_TIMESTAMP, modifiedBy=? WHERE id=?')
        .run(req.body?.displayName !== undefined ? String(req.body.displayName).trim() : userRow.displayName, enabled ? 1 : 0, actor, id);
      replaceAssignments(id, userRow.username, assignments.roles, assignments.appAccess, actor);
      if (!enabled) kernel.db.prepare('DELETE FROM "FW_Session" WHERE username=?').run(userRow.username);
    })();
    return { id, username: userRow.username, displayName: req.body?.displayName !== undefined ? String(req.body.displayName).trim() : userRow.displayName, enabled, ...rowsFor(id) };
  });

  app.delete<{ Params: { id: string } }>('/api/system/security/users/:id', (req) => {
    deps.requireAdmin(req);
    const id = Number(req.params.id);
    const existing = kernel.db.prepare('SELECT username,enabled FROM "FW_User" WHERE id=?').get(id) as { username: string; enabled: number } | undefined;
    if (!existing) bad('User not found', 404);
    const userRow = existing!;
    ensureNotLastAdmin(id, false, []);
    kernel.db.transaction(() => {
      kernel.db.prepare('DELETE FROM "FW_Session" WHERE username=?').run(userRow.username);
      kernel.db.prepare('DELETE FROM "FW_UserRole" WHERE userId=?').run(id);
      kernel.db.prepare('DELETE FROM "FW_AppAccess" WHERE userId=?').run(id);
      kernel.db.prepare('DELETE FROM "FW_User" WHERE id=?').run(id);
    })();
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { newPassword?: string } }>('/api/system/security/users/:id/reset-password', (req) => {
    deps.requireAdmin(req);
    const id = Number(req.params.id);
    const password = String(req.body?.newPassword ?? '');
    validatePassword(password);
    const user = kernel.db.prepare('SELECT username FROM "FW_User" WHERE id=?').get(id) as { username: string } | undefined;
    if (!user) bad('User not found', 404);
    const userRow = user!;
    kernel.db.transaction(() => {
      kernel.db.prepare('UPDATE "FW_User" SET passwordHash=?, password=NULL, modifiedAt=CURRENT_TIMESTAMP, modifiedBy=? WHERE id=?').run(hashPassword(password), deps.requireAdmin(req), id);
      kernel.db.prepare('DELETE FROM "FW_Session" WHERE username=?').run(userRow.username);
    })();
    return { ok: true };
  });

  app.post<{ Body: { currentPassword?: string; newPassword?: string } }>('/api/account/change-password', (req, reply) => {
    const auth = deps.requireUser(req);
    const currentPassword = String(req.body?.currentPassword ?? '');
    const newPassword = String(req.body?.newPassword ?? '');
    validatePassword(newPassword);
    const user = kernel.db.prepare('SELECT passwordHash FROM "FW_User" WHERE username=?').get(auth.username) as { passwordHash: string } | undefined;
    if (!user || !verifyPassword(currentPassword, user.passwordHash)) bad('Current password is incorrect', 403);
    kernel.db.transaction(() => {
      kernel.db.prepare('UPDATE "FW_User" SET passwordHash=?, password=NULL, modifiedAt=CURRENT_TIMESTAMP, modifiedBy=? WHERE username=?').run(hashPassword(newPassword), auth.username, auth.username);
      kernel.db.prepare('DELETE FROM "FW_Session" WHERE username=?').run(auth.username);
    })();
    const token = createSession(kernel.context({ user: auth.username }), auth.username);
    reply.setCookie(deps.cookieName, token, { path: '/', httpOnly: true, sameSite: 'lax', secure: deps.secureCookies });
    return { ok: true };
  });
}
