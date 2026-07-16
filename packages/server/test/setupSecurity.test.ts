import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Kernel } from '@emu/core';
import { buildServer } from '../src/server.js';
import { hashPassword } from '../src/auth.js';
import { applyErpSample } from './fixtures/erpSample.js';
import { completeTestSetup, TEST_ADMIN_PASSWORD, TEST_SETUP_CODE } from './setupHelper.js';

const kernelOf = (app: FastifyInstance): Kernel => (app as FastifyInstance & { kernel: Kernel }).kernel;

describe('first setup and role-only administration', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it('requires the one-time code, closes setup after success, and rejects reuse', async () => {
    const app = buildServer({ setupCode: TEST_SETUP_CODE }); await app.ready();
    expect((await app.inject({ method: 'GET', url: '/api/setup/status' })).json()).toMatchObject({ required: true, legacyReset: false });
    expect((await app.inject({ method: 'POST', url: '/api/setup/complete', payload: { code: 'WRONG', username: 'owner', password: TEST_ADMIN_PASSWORD } })).statusCode).toBe(403);
    const auth = await completeTestSetup(app, 'owner');
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: auth })).json()).toMatchObject({ username: 'owner', roles: ['FW_SystemAdminRole'] });
    expect((await app.inject({ method: 'POST', url: '/api/setup/complete', payload: { code: TEST_SETUP_CODE, username: 'other', password: TEST_ADMIN_PASSWORD } })).statusCode).toBe(409);
    await app.close();
  });

  it('expires setup codes after fifteen minutes', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-01-01T00:00:00Z').getTime());
    const app = buildServer({ setupCode: TEST_SETUP_CODE }); await app.ready();
    now.mockReturnValue(new Date('2026-01-01T00:16:00Z').getTime());
    const response = await app.inject({ method: 'POST', url: '/api/setup/complete', payload: { code: TEST_SETUP_CODE, username: 'owner', password: TEST_ADMIN_PASSWORD } });
    expect(response.statusCode).toBe(410); await app.close();
  });

  it('does not grant special access to a user merely named admin and filters five business screens to one', async () => {
    const app = buildServer({ setupCode: TEST_SETUP_CODE }); await app.ready();
    const owner = await completeTestSetup(app, 'owner');
    const kernel = kernelOf(app); applyErpSample(kernel);
    const ctx = kernel.context();
    const admin = ctx.newRecord('FW_User').setMany({ username: 'admin', passwordHash: hashPassword('Business-password-123'), enabled: true }); admin.insert();
    ctx.newRecord('FW_UserRole').setMany({ userId: admin.id, username: 'admin', role: 'ERP_SalesClerk' }).insert();
    ctx.newRecord('FW_AppAccess').setMany({ userId: admin.id, appName: 'erp', canOpen: true }).insert();
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: 'Business-password-123' } });
    const auth = { cookie: (login.headers['set-cookie'] as string).split(';')[0] };
    const meta = (await app.inject({ method: 'GET', url: '/api/metadata', headers: auth })).json();
    const menu = meta.apps[0].menus[0];
    const leaves = (items: any[]): string[] => items.flatMap((item) => item.items ? leaves(item.items) : [item.form]).filter(Boolean);
    expect(leaves(menu.items)).toEqual(['ERP_SalesTableForm']);
    expect(menu.items.map((item: { label: string }) => item.label)).toEqual(['Sales']);
    expect((await app.inject({ method: 'POST', url: '/api/data/ERP_CustTable', headers: auth, payload: { accountNum: 'NO', name: 'Denied' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/system/info', headers: auth })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/system/info', headers: owner })).statusCode).toBe(200);
    await app.close();
  });

  it('forces a legacy admin/admin installation through password reset without deleting the account', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'emu-legacy-admin-'));
    const dbPath = join(dir, 'data.db'); const designerDbPath = join(dir, 'designer.db');
    const first = buildServer({ dbPath, designerDbPath, setupCode: TEST_SETUP_CODE }); await first.ready();
    const ctx = kernelOf(first).context();
    const user = ctx.newRecord('FW_User').setMany({ username: 'admin', displayName: 'Legacy administrator', passwordHash: hashPassword('admin'), enabled: true }); user.insert();
    ctx.newRecord('FW_UserRole').setMany({ userId: user.id, username: 'admin', role: 'FW_SystemAdminRole' }).insert();
    await first.close();

    const second = buildServer({ dbPath, designerDbPath, setupCode: TEST_SETUP_CODE }); await second.ready();
    expect((await second.inject({ method: 'GET', url: '/api/setup/status' })).json()).toMatchObject({ required: true, legacyReset: true, username: 'admin' });
    expect((await second.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: 'admin' } })).statusCode).toBe(409);
    await completeTestSetup(second, 'ignored-name');
    expect((await second.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: TEST_ADMIN_PASSWORD } })).statusCode).toBe(200);
    expect(kernelOf(second).context().select('FW_User').whereEq({ username: 'admin' }).count()).toBe(1);
    await second.close();
  });
});
