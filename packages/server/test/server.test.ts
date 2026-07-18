import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { hashPassword } from '../src/auth.js';
import type { Kernel } from '@emu/core';
import { applyErpSample } from './fixtures/erpSample.js';
import { completeTestSetup, TEST_ADMIN_PASSWORD, TEST_SETUP_CODE } from './setupHelper.js';

describe('server', () => {
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    app = buildServer({ setupCode: TEST_SETUP_CODE });
    await app.ready();
    await completeTestSetup(app);
    applyErpSample((app as unknown as { kernel: Kernel }).kernel);
    const res = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'admin', password: TEST_ADMIN_PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    cookie = res.headers['set-cookie'] as string;
  });

  const auth = () => ({ cookie: cookie.split(';')[0] });

  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/data/ERP_CustTable' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects bad credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'admin', password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns current user from /api/me', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: auth() });
    expect(res.json()).toMatchObject({ username: 'admin' });
  });

  it('serves business metadata while security tables remain dedicated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/metadata', headers: auth() });
    const meta = res.json();
    const names = meta.tables.map((t: { name: string }) => t.name);
    expect(names).toContain('ERP_CustTable');
    expect(names).not.toContain('FW_User');
    expect(names).not.toContain('FW_Session');
    const erpApp = meta.apps.find((a: { name: string }) => a.name === 'erp');
    expect(erpApp).toBeDefined();
    const ERP_MainMenu = erpApp.menus.find((m: { name: string }) => m.name === 'ERP_MainMenu');
    expect(ERP_MainMenu).toBeDefined();
    const allLabels: string[] = [];
    const collectLabels = (items: any[]) => {
      for (const it of items) {
        if (it.label) allLabels.push(it.label);
        if (it.items) collectLabels(it.items);
      }
    };
    collectLabels(ERP_MainMenu.items);
    expect(allLabels).not.toContain('Users');
    const frameworkLabels = meta.frameworkMenus.flatMap((menu: any) => menu.items.map((item: any) => item.label));
    expect(frameworkLabels).toContain('Users & Security');
  });

  it('does CRUD through the data API', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/data/ERP_CustTable',
      headers: auth(),
      payload: { accountNum: 'C001', name: 'Contoso', id: 999 }, // id must be ignored
    });
    expect(created.statusCode).toBe(201);
    const rec = created.json();
    expect(rec.id).toBe(1);
    expect(rec.createdBy).toBe('admin');

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/data/ERP_CustTable/${rec.id}`,
      headers: auth(),
      payload: { phone: '02-000-0000' },
    });
    expect(patched.json().phone).toBe('02-000-0000');

    const list = await app.inject({
      method: 'GET',
      url: '/api/data/ERP_CustTable?filter.accountNum=C001',
      headers: auth(),
    });
    expect(list.json()).toMatchObject({ total: 1 });

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/data/ERP_CustTable/${rec.id}`,
      headers: auth(),
    });
    expect(del.statusCode).toBe(200);
  });

  it('maps validation errors to 422', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/data/ERP_CustTable',
      headers: auth(),
      payload: { accountNum: 'C002' }, // missing mandatory name
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/mandatory/);
  });

  it('coerces numeric filters (enum status)', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/data/ERP_CustTable',
      headers: auth(),
      payload: { accountNum: 'C010', name: 'Order customer' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/data/ERP_SalesTable',
      headers: auth(),
      // status is read-only and receives its numeric default (0) on create
      payload: { salesId: 'SO-1', custId: 1 },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/data/ERP_SalesTable?filter.status=0',
      headers: auth(),
    });
    expect(res.json().total).toBe(1);
  });

  it('blocks security tables through the generic data API even for System Admin', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/data/FW_User', headers: auth() });
    expect(res.statusCode).toBe(404);
  });

  it('enforces role security over REST (ERP_SalesClerk)', async () => {
    const kernel = (app as unknown as { kernel: Kernel }).kernel;
    const ctx = kernel.context();
    const clerkUser = ctx
      .newRecord('FW_User')
      .setMany({ username: 'clerk', passwordHash: hashPassword('pw'), enabled: true });
    clerkUser.insert();
    ctx.newRecord('FW_UserRole').setMany({ userId: clerkUser.id, role: 'ERP_SalesClerk' }).insert();
    // app visibility is explicit since FW_AppAccess: grant clerk access to the erp app
    ctx.newRecord('FW_AppAccess').setMany({ userId: clerkUser.id, appName: 'erp', canOpen: true }).insert();

    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'clerk', password: 'pw' },
    });
    const clerkAuth = { cookie: (login.headers['set-cookie'] as string).split(';')[0] };

    // clerk may read customers but not create them
    const read = await app.inject({ method: 'GET', url: '/api/data/ERP_CustTable', headers: clerkAuth });
    expect(read.statusCode).toBe(200);
    const write = await app.inject({
      method: 'POST',
      url: '/api/data/ERP_CustTable',
      headers: clerkAuth,
      payload: { accountNum: 'C900', name: 'Nope' },
    });
    expect(write.statusCode).toBe(403);

    // metadata is filtered: only ERP_SalesTableForm menu items remain
    const meta = await app.inject({ method: 'GET', url: '/api/metadata', headers: clerkAuth });
    const collectForms = (items: any[]): string[] => {
      const forms: string[] = [];
      for (const it of items) {
        if (it.form) forms.push(it.form);
        if (it.items) forms.push(...collectForms(it.items));
      }
      return forms;
    };
    const allForms = meta.json().apps.flatMap((a: any) =>
      a.menus.flatMap((m: any) => collectForms(m.items)),
    );
    expect(allForms).toEqual(['ERP_SalesTableForm']);
  });

  it('requires explicit setup even when registerLogic creates users first', async () => {
    const app2 = buildServer({
      setupCode: TEST_SETUP_CODE,
      registerLogic(kernel) {
        kernel
          .context()
          .newRecord('FW_User')
          .setMany({ username: 'demo', passwordHash: hashPassword('demo'), enabled: true })
          .insert();
      },
    });
    await app2.ready();
    expect((await app2.inject({ method: 'GET', url: '/api/setup/status' })).json().required).toBe(true);
    expect((await app2.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: 'admin' } })).statusCode).toBe(409);
    await app2.close();
  });

  it('runs server actions atomically and rolls back on failure', async () => {
    const kernel = (app as unknown as { kernel: Kernel }).kernel;
    const before = kernel.context().select('ERP_CustTable').count();
    kernel.actions.set('FailingAllocation', (ctx) => {
      ctx.newRecord('ERP_CustTable').setMany({ accountNum: 'ROLLBACK', name: 'Rollback test' }).insert();
      throw new Error('allocation failed');
    });
    const response = await app.inject({ method: 'POST', url: '/api/action/FailingAllocation', headers: auth(), payload: { recordId: 1, selections: [{ id: 1, quantity: 1 }] } });
    expect(response.statusCode).toBe(500);
    expect(kernel.context().select('ERP_CustTable').count()).toBe(before);
  });

  it('logs out and invalidates the session', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'admin', password: TEST_ADMIN_PASSWORD },
    });
    const c = (login.headers['set-cookie'] as string).split(';')[0];
    await app.inject({ method: 'POST', url: '/api/logout', headers: { cookie: c } });
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: c } });
    expect(me.statusCode).toBe(401);
  });
});
