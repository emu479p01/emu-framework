import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { hashPassword } from '../src/auth.js';
import type { Kernel } from '@emu/core';
import { applyErpSample } from './fixtures/erpSample.js';

describe('web designer API', () => {
  let app: FastifyInstance;
  let admin: { cookie: string };

  beforeAll(async () => {
    app = buildServer();
    await app.ready();
    applyErpSample((app as unknown as { kernel: Kernel }).kernel);
    const res = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'admin', password: 'admin' },
    });
    admin = { cookie: (res.headers['set-cookie'] as string).split(';')[0] };
  });

  function roleCode(kernel: Kernel, name: string): number {
    return kernel.registry.getEnum('FW_Role').values.find((v) => v.name === name)!.value;
  }

  it('rejects non-admin users', async () => {
    const kernel = (app as unknown as { kernel: Kernel }).kernel;
    const ctx = kernel.context();
    const u = ctx
      .newRecord('FW_User')
      .setMany({ username: 'clerk2', passwordHash: hashPassword('pw'), enabled: true });
    u.insert();
    ctx.newRecord('FW_UserRole').setMany({ userId: u.id, role: roleCode(kernel, 'ERP_SalesClerk') }).insert();
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'clerk2', password: 'pw' },
    });
    const cookie = (login.headers['set-cookie'] as string).split(';')[0];
    const res = await app.inject({ method: 'GET', url: '/api/designer/artifacts', headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });

  it('creates a table + form at runtime and serves data immediately', async () => {
    const table = await app.inject({
      method: 'PUT',
      url: '/api/designer/artifacts/table/WEB_WebProject',
      headers: admin,
      payload: {
        kind: 'table',
        name: 'WEB_WebProject',
        label: 'Projects',
        titleField: 'projName',
        fields: [
          { name: 'projName', type: 'string', mandatory: true },
          { name: 'budget', type: 'real' },
        ],
      },
    });
    expect(table.statusCode).toBe(200);

    const form = await app.inject({
      method: 'PUT',
      url: '/api/designer/artifacts/form/WEB_WebProjectForm',
      headers: admin,
      payload: { kind: 'form', name: 'WEB_WebProjectForm', table: 'WEB_WebProject' },
    });
    expect(form.statusCode).toBe(200);

    // no restart — data API works right away
    const created = await app.inject({
      method: 'POST',
      url: '/api/data/WEB_WebProject',
      headers: admin,
      payload: { projName: 'Alpha', budget: 1000 },
    });
    expect(created.statusCode).toBe(201);

    // and metadata now contains the new form
    const meta = await app.inject({ method: 'GET', url: '/api/metadata', headers: admin });
    expect(meta.json().forms.map((f: { name: string }) => f.name)).toContain('WEB_WebProjectForm');
  });

  it('rejects invalid artifacts with 422 and keeps the registry intact', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/designer/artifacts/form/WEB_BadForm',
      headers: admin,
      payload: { kind: 'form', name: 'WEB_BadForm', table: 'DoesNotExist' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/unknown table/i);

    // previous web artifacts still fine
    const list = await app.inject({ method: 'GET', url: '/api/data/WEB_WebProject', headers: admin });
    expect(list.statusCode).toBe(200);
  });

  it('extends a file-based table from the web layer', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/designer/artifacts/tableExtension/ERP_CustTable_Extension',
      headers: admin,
      payload: {
        kind: 'tableExtension',
        name: 'ERP_CustTable_Extension',
        app: 'erp',
        model: 'ClientCustom',
        table: 'ERP_CustTable',
        fields: [{ name: 'loyaltyTier', type: 'string' }],
      },
    });
    expect(res.statusCode).toBe(200);
    const meta = await app.inject({ method: 'GET', url: '/api/metadata', headers: admin });
    const cust = meta.json().tables.find((t: { name: string }) => t.name === 'ERP_CustTable');
    expect(cust.fields.some((f: { name: string }) => f.name === 'loyaltyTier')).toBe(true);
  });

  it('deletes an artifact and rebuilds', async () => {
    const del = await app.inject({
      method: 'DELETE',
      url: '/api/designer/artifacts/form/WEB_WebProjectForm',
      headers: admin,
    });
    expect(del.statusCode).toBe(200);
    const meta = await app.inject({ method: 'GET', url: '/api/metadata', headers: admin });
    expect(meta.json().forms.map((f: { name: string }) => f.name)).not.toContain('WEB_WebProjectForm');
  });

  it('deleting an app cascades artifacts and drops its data tables', async () => {
    const kernel = (app as unknown as { kernel: Kernel }).kernel;
    // create a small app with one table + data
    await app.inject({
      method: 'PUT',
      url: '/api/designer/artifacts/app/tmpapp',
      headers: admin,
      payload: { kind: 'app', name: 'tmpapp', label: 'Temp', models: [{ name: 'Main', layer: 'CUS' }] },
    });
    const t = await app.inject({
      method: 'PUT',
      url: '/api/designer/artifacts/table/TMPAPP_Thing',
      headers: admin,
      payload: {
        kind: 'table',
        name: 'TMPAPP_Thing',
        app: 'tmpapp',
        model: 'Main',
        fields: [{ name: 'thing', type: 'string' }],
      },
    });
    expect(t.statusCode).toBe(200);
    await app.inject({
      method: 'POST',
      url: '/api/data/TMPAPP_Thing',
      headers: admin,
      payload: { thing: 'x' },
    });

    const del = await app.inject({ method: 'DELETE', url: '/api/designer/artifacts/app/tmpapp', headers: admin });
    expect(del.statusCode).toBe(200);
    expect(del.json().droppedTables).toContain('TMPAPP_Thing');
    // registry + physical table gone
    expect(kernel.registry.hasTable('TMPAPP_Thing')).toBe(false);
    const row = kernel.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='TMPAPP_Thing'`)
      .get();
    expect(row).toBeUndefined();
    // app gone from loadedApps
    expect(kernel.registry.loadedApps().map((a) => a.name)).not.toContain('tmpapp');
  });

  it('lists stored artifacts', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/designer/artifacts', headers: admin });
    const names = res.json().artifacts.map((a: { name: string }) => a.name);
    expect(names).toContain('WEB_WebProject');
    expect(names).toContain('ERP_CustTable_Extension');
    expect(names).not.toContain('WEB_WebProjectForm');
  });
});
