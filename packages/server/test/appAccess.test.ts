import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { hashPassword } from '../src/auth.js';
import type { Kernel } from '@emu/core';
import { applyErpSample } from './fixtures/erpSample.js';
import { completeTestSetup, TEST_SETUP_CODE } from './setupHelper.js';

/**
 * FW_AppAccess: explicit per-user app permissions.
 * No row = the user cannot see (canOpen) or customize (canCustomize) the app.
 */
describe('FW_AppAccess enforcement', () => {
  let app: FastifyInstance;
  let kernel: Kernel;
  let bobId: number;
  let bob: { cookie: string };

  const loginAs = async (username: string, password: string) => {
    const res = await app.inject({ method: 'POST', url: '/api/login', payload: { username, password } });
    return { cookie: (res.headers['set-cookie'] as string).split(';')[0] };
  };

  beforeAll(async () => {
    app = buildServer({ setupCode: TEST_SETUP_CODE });
    await app.ready();
    await completeTestSetup(app);
    kernel = (app as unknown as { kernel: Kernel }).kernel;
    applyErpSample(kernel);

    const ctx = kernel.context();
    const user = ctx
      .newRecord('FW_User')
      .setMany({ username: 'bob', passwordHash: hashPassword('pw'), enabled: true });
    user.insert();
    bobId = user.id!;
    // bob has an ERP role — but role alone must NOT make the app visible
    ctx.newRecord('FW_UserRole').setMany({ userId: bobId, role: 'ERP_SalesClerk' }).insert();
    bob = await loginAs('bob', 'pw');
  });

  it('without an FW_AppAccess row the app is invisible and designer is denied', async () => {
    const meta = await app.inject({ method: 'GET', url: '/api/metadata', headers: bob });
    expect(meta.json().apps).toEqual([]);

    const designer = await app.inject({ method: 'GET', url: '/api/designer/artifacts', headers: bob });
    expect(designer.statusCode).toBe(403);
  });

  it('canOpen grants app visibility', async () => {
    const ctx = kernel.context();
    ctx
      .newRecord('FW_AppAccess')
      .setMany({ userId: bobId, appName: 'erp', canOpen: true, canCustomize: false })
      .insert();

    const meta = await app.inject({ method: 'GET', url: '/api/metadata', headers: bob });
    expect(meta.json().apps.map((a: { name: string }) => a.name)).toEqual(['erp']);

    // still no customize permission
    const designer = await app.inject({ method: 'GET', url: '/api/designer/artifacts', headers: bob });
    expect(designer.statusCode).toBe(403);
  });

  it('canCustomize opens the designer, scoped to the granted app only', async () => {
    const ctx = kernel.context();
    const row = ctx.select('FW_AppAccess').whereEq({ userId: bobId }).firstOnly()!;
    row.f.canCustomize = true;
    row.update();

    const designer = await app.inject({ method: 'GET', url: '/api/designer/artifacts', headers: bob });
    expect(designer.statusCode).toBe(200);
    const body = designer.json();
    expect(body.apps.map((a: { name: string }) => a.name)).toEqual(['erp']);
    // artifact list only shows erp artifacts (the 'app' manifest itself has no app field)
    const apps = new Set(
      body.artifacts
        .filter((a: { kind: string }) => a.kind !== 'app')
        .map((a: { artifact: { app?: string } }) => a.artifact.app),
    );
    expect([...apps]).toEqual(['erp']);
    expect(
      body.artifacts.filter((a: { kind: string }) => a.kind === 'app').map((a: { name: string }) => a.name),
    ).toEqual(['erp']);

    // writing into another app is rejected
    const put = await app.inject({
      method: 'PUT',
      url: '/api/designer/artifacts/table/WEB_Sneaky',
      headers: bob,
      payload: { kind: 'table', name: 'WEB_Sneaky', fields: [{ name: 'x', type: 'string' }] },
    });
    expect(put.statusCode).toBe(403);

    // writing into the granted app works
    const ok = await app.inject({
      method: 'PUT',
      url: '/api/designer/artifacts/tableExtension/ERP_CustTable_Bob_Extension',
      headers: bob,
      payload: {
        kind: 'tableExtension',
        name: 'ERP_CustTable_Bob_Extension',
        app: 'erp',
        model: 'ClientCustom',
        table: 'ERP_CustTable',
        fields: [{ name: 'bobField', type: 'string' }],
      },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('admin still sees everything', async () => {
    const admin = await loginAs('admin', 'Admin-password-123');
    const meta = await app.inject({ method: 'GET', url: '/api/metadata', headers: admin });
    expect(meta.json().apps.map((a: { name: string }) => a.name)).toContain('erp');
    const designer = await app.inject({ method: 'GET', url: '/api/designer/artifacts', headers: admin });
    expect(designer.statusCode).toBe(200);
  });

  it('FW_UserForm carries the app-access line grid', async () => {
    const admin = await loginAs('admin', 'Admin-password-123');
    const meta = await app.inject({ method: 'GET', url: '/api/metadata', headers: admin });
    const userForm = meta.json().forms.find((f: { name: string }) => f.name === 'FW_UserForm');
    expect(userForm.lines.some((l: { table: string }) => l.table === 'FW_AppAccess')).toBe(true);
  });
});
