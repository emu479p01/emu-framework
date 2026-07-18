import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Kernel } from '@emu/core';
import { buildServer } from '../src/server.js';
import { applyErpSample } from './fixtures/erpSample.js';
import { completeTestSetup, TEST_ADMIN_PASSWORD, TEST_SETUP_CODE } from './setupHelper.js';

describe('dedicated user and password administration', () => {
  let app: FastifyInstance;
  let kernel: Kernel;
  let admin: { cookie: string };
  let userId: number;

  const login = async (username: string, password: string) => {
    const result = await app.inject({ method: 'POST', url: '/api/login', payload: { username, password } });
    return { result, auth: { cookie: String(result.headers['set-cookie'] ?? '').split(';')[0]! } };
  };

  beforeAll(async () => {
    app = buildServer({ setupCode: TEST_SETUP_CODE }); await app.ready(); await completeTestSetup(app);
    kernel = (app as unknown as { kernel: Kernel }).kernel; applyErpSample(kernel);
    admin = (await login('admin', TEST_ADMIN_PASSWORD)).auth;
  });

  it('creates deny-by-default users with a required initial password and never returns hashes', async () => {
    const weak = await app.inject({ method: 'POST', url: '/api/system/security/users', headers: admin, payload: { username: 'newuser', password: 'short' } });
    expect(weak.statusCode).toBe(422);
    const created = await app.inject({ method: 'POST', url: '/api/system/security/users', headers: admin, payload: { username: 'newuser', displayName: 'New User', password: 'Initial-password-123', roles: [], appAccess: [] } });
    expect(created.statusCode, created.body).toBe(201); userId = created.json().id;
    expect(JSON.stringify(created.json())).not.toMatch(/password|hash/i);
    const auth = (await login('newuser', 'Initial-password-123')).auth;
    const metadata = await app.inject({ method: 'GET', url: '/api/metadata', headers: auth });
    expect(metadata.json().apps).toEqual([]);
    expect(metadata.json().frameworkMenus.flatMap((menu: any) => menu.items.map((item: any) => item.route))).toContain('/account/password');
    const direct = await app.inject({ method: 'GET', url: '/api/data/ERP_CustTable', headers: auth });
    expect(direct.statusCode).toBe(403);
    const importPreview = await app.inject({ method: 'POST', url: '/api/data/ERP_CustTable/import/preview', headers: auth });
    expect(importPreview.statusCode).toBe(403);
    const listed = await app.inject({ method: 'GET', url: '/api/system/security/users', headers: admin });
    expect(JSON.stringify(listed.json())).not.toMatch(/passwordHash|Initial-password-123/);
    const designerMetadata = await app.inject({ method: 'GET', url: '/api/designer/artifacts', headers: admin });
    expect(designerMetadata.body).not.toMatch(/passwordHash|tokenHash/);
  });

  it('keeps Customize independent from Open and exposes a scoped metadata catalog', async () => {
    const updated = await app.inject({ method: 'PATCH', url: `/api/system/security/users/${userId}`, headers: admin, payload: { roles: [], appAccess: [{ appName: 'erp', canOpen: false, canCustomize: true }] } });
    expect(updated.statusCode).toBe(200);
    const auth = (await login('newuser', 'Initial-password-123')).auth;
    const metadata = await app.inject({ method: 'GET', url: '/api/metadata', headers: auth });
    expect(metadata.json().apps).toEqual([]);
    expect(metadata.json().capabilities.designer).toBe(true);
    const designer = await app.inject({ method: 'GET', url: '/api/designer/artifacts', headers: auth });
    expect(designer.statusCode).toBe(200);
    expect(designer.json().apps.map((entry: { name: string }) => entry.name)).toEqual(['erp']);
    expect(designer.json().catalog.tables.some((table: { name: string }) => table.name === 'ERP_CustTable')).toBe(true);
    const direct = await app.inject({ method: 'GET', url: '/api/data/ERP_CustTable', headers: auth });
    expect(direct.statusCode).toBe(403);
  });

  it('changes passwords with current-password verification and rotates only the active session', async () => {
    const first = await login('newuser', 'Initial-password-123');
    const second = await login('newuser', 'Initial-password-123');
    const wrong = await app.inject({ method: 'POST', url: '/api/account/change-password', headers: first.auth, payload: { currentPassword: 'wrong', newPassword: 'Changed-password-123' } });
    expect(wrong.statusCode).toBe(403);
    const changed = await app.inject({ method: 'POST', url: '/api/account/change-password', headers: first.auth, payload: { currentPassword: 'Initial-password-123', newPassword: 'Changed-password-123' } });
    expect(changed.statusCode).toBe(200);
    const rotated = { cookie: String(changed.headers['set-cookie']).split(';')[0]! };
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: rotated })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: second.auth })).statusCode).toBe(401);
    expect((await login('newuser', 'Initial-password-123')).result.statusCode).toBe(401);
    expect((await login('newuser', 'Changed-password-123')).result.statusCode).toBe(200);
  });

  it('admin reset works immediately, revokes sessions, and protects the last admin', async () => {
    const oldSession = (await login('newuser', 'Changed-password-123')).auth;
    const reset = await app.inject({ method: 'POST', url: `/api/system/security/users/${userId}/reset-password`, headers: admin, payload: { newPassword: 'Reset-password-123' } });
    expect(reset.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: oldSession })).statusCode).toBe(401);
    expect((await login('newuser', 'Reset-password-123')).result.statusCode).toBe(200);
    const adminRow = kernel.db.prepare(`SELECT id FROM "FW_User" WHERE username='admin'`).get() as { id: number };
    const disable = await app.inject({ method: 'PATCH', url: `/api/system/security/users/${adminRow.id}`, headers: admin, payload: { enabled: false } });
    expect(disable.statusCode).toBe(409);
  });
});
