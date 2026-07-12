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

  it('rejects non-admin users', async () => {
    const kernel = (app as unknown as { kernel: Kernel }).kernel;
    const ctx = kernel.context();
    const u = ctx
      .newRecord('FW_User')
      .setMany({ username: 'clerk2', passwordHash: hashPassword('pw'), enabled: true });
    u.insert();
    ctx.newRecord('FW_UserRole').setMany({ userId: u.id, role: 'ERP_SalesClerk' }).insert();
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

  it('deleting an app cascades metadata but preserves its data tables', async () => {
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
    expect(del.json().orphanedTables).toContain('TMPAPP_Thing');
    // registry is gone while the physical table and its data are retained
    expect(kernel.registry.hasTable('TMPAPP_Thing')).toBe(false);
    const row = kernel.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='TMPAPP_Thing'`)
      .get();
    expect(row).toBeDefined();
    expect(kernel.db.prepare('SELECT thing FROM "TMPAPP_Thing"').get()).toMatchObject({ thing: 'x' });
    // app gone from loadedApps
    expect(kernel.registry.loadedApps().map((a) => a.name)).not.toContain('tmpapp');

    const rejectedPurge = await app.inject({ method: 'POST', url: '/api/designer/orphans/TMPAPP_Thing/purge', headers: admin, payload: { confirmation: 'wrong' } });
    expect(rejectedPurge.statusCode).toBe(400);
    const purge = await app.inject({ method: 'POST', url: '/api/designer/orphans/TMPAPP_Thing/purge', headers: admin, payload: { confirmation: 'TMPAPP_Thing' } });
    expect(purge.statusCode).toBe(200);
    expect(kernel.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='TMPAPP_Thing'`).get()).toBeUndefined();
  });

  it('validates and applies an atomic change set with audit history', async () => {
    const capabilities = await app.inject({ method: 'GET', url: '/api/designer/capabilities', headers: admin });
    expect(capabilities.statusCode).toBe(200);
    expect(capabilities.json().ai.apply).toBe(false);
    const snapshot = await app.inject({ method: 'GET', url: '/api/designer/snapshot', headers: admin });
    const baseRevision = snapshot.json().revision as string;
    const artifacts = [
      { kind: 'app', name: 'builder', label: 'Builder', models: [{ name: 'Customizations', label: 'Customizations', layer: 'CUS' }] },
      { kind: 'table', name: 'BUILDER_Task', app: 'builder', model: 'Customizations', layer: 'CUS', label: 'Tasks', titleField: 'title', fields: [{ name: 'title', type: 'string', mandatory: true }] },
      { kind: 'form', name: 'BUILDER_TaskForm', app: 'builder', model: 'Customizations', layer: 'CUS', label: 'Tasks', table: 'BUILDER_Task', listFields: ['title'], groups: [{ label: 'Details', fields: ['title'] }] },
      { kind: 'menu', name: 'BUILDER_MainMenu', app: 'builder', model: 'Customizations', layer: 'CUS', label: 'Navigation', items: [{ label: 'Tasks', form: 'BUILDER_TaskForm' }] },
    ];
    const changeSet = {
      version: 1,
      baseRevision,
      source: 'ai',
      description: 'Create the first builder app',
      operations: artifacts.map((artifact) => ({ op: 'upsert', kind: artifact.kind, name: artifact.name, artifact })),
    };
    const validate = await app.inject({ method: 'POST', url: '/api/designer/change-sets/validate', headers: admin, payload: changeSet });
    expect(validate.statusCode).toBe(200);
    expect(validate.json().diff).toHaveLength(4);
    const apply = await app.inject({
      method: 'POST', url: '/api/designer/change-sets/apply', headers: admin,
      payload: { previewId: validate.json().previewId, confirmation: true },
    });
    expect(apply.statusCode).toBe(200);
    const kernel = (app as unknown as { kernel: Kernel }).kernel;
    expect(kernel.registry.hasTable('BUILDER_Task')).toBe(true);
    expect((kernel.designerDb.prepare('SELECT COUNT(*) AS count FROM "FW_ChangeSetAudit"').get() as { count: number }).count).toBe(1);
  });

  it('rejects stale previews and requires human confirmation', async () => {
    const snapshot = await app.inject({ method: 'GET', url: '/api/designer/snapshot', headers: admin });
    const artifact = { kind: 'table', name: 'BUILDER_Note', app: 'builder', model: 'Customizations', layer: 'CUS', fields: [{ name: 'text', type: 'string' }] };
    const validate = await app.inject({
      method: 'POST', url: '/api/designer/change-sets/validate', headers: admin,
      payload: { version: 1, baseRevision: snapshot.json().revision, source: 'ai', operations: [{ op: 'upsert', kind: artifact.kind, name: artifact.name, artifact }] },
    });
    expect(validate.statusCode).toBe(200);
    const apply = await app.inject({ method: 'POST', url: '/api/designer/change-sets/apply', headers: admin, payload: { previewId: validate.json().previewId } });
    expect(apply.statusCode).toBe(400);
  });

  it('lists stored artifacts', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/designer/artifacts', headers: admin });
    const names = res.json().artifacts.map((a: { name: string }) => a.name);
    expect(names).toContain('WEB_WebProject');
    expect(names).toContain('ERP_CustTable_Extension');
    expect(names).not.toContain('WEB_WebProjectForm');
  });

  it('creates a function artifact and invokes it as an action', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/designer/artifacts/function/ERP_CustCount',
      headers: admin,
      payload: {
        kind: 'function',
        name: 'ERP_CustCount',
        app: 'erp',
        model: 'ClientCustom',
        label: 'Customer count',
        code: 'return { count: ctx.select("ERP_CustTable").count() };',
      },
    });
    expect(put.statusCode).toBe(200);

    const meta = await app.inject({ method: 'GET', url: '/api/metadata', headers: admin });
    expect(meta.json().actions).toContain('ERP_CustCount');

    const run = await app.inject({ method: 'POST', url: '/api/action/ERP_CustCount', headers: admin, payload: {} });
    expect(run.statusCode).toBe(200);
    expect(run.json()).toMatchObject({ count: expect.any(Number) });
  });

  it('blocks functions in AI change sets as high-risk executable code', async () => {
    const snapshot = await app.inject({ method: 'GET', url: '/api/designer/snapshot', headers: admin });
    const artifact = { kind: 'function', name: 'ERP_Sneaky', app: 'erp', model: 'ClientCustom', code: 'return 1;' };
    const validate = await app.inject({
      method: 'POST', url: '/api/designer/change-sets/validate', headers: admin,
      payload: { version: 1, baseRevision: snapshot.json().revision, source: 'ai', operations: [{ op: 'upsert', kind: artifact.kind, name: artifact.name, artifact }] },
    });
    expect(validate.statusCode).toBe(422);
    expect(JSON.stringify(validate.json())).toMatch(/high_risk_script/);
  });

  it('validates report JSON without saving it', async () => {
    const valid = await app.inject({ method: 'POST', url: '/api/designer/reports/validate', headers: admin, payload: { artifact: {
      kind: 'report', name: 'ERP_JsonPreview', app: 'erp', model: 'MiniERPApplication', dataSource: 'ERP_CustTable',
      bands: [{ kind: 'detail', height: 20, elements: [{ id: 'name', type: 'field', x: 0, y: 0, width: 100, height: 16, field: 'name' }] }],
    } } });
    expect(valid.statusCode).toBe(200); expect(valid.json()).toMatchObject({ valid: true, summary: { bands: 1, elements: 1 } });
    const bad = await app.inject({ method: 'POST', url: '/api/designer/reports/validate', headers: admin, payload: { artifact: {
      kind: 'report', name: 'ERP_BadJsonPreview', app: 'erp', model: 'MiniERPApplication', dataSource: 'ERP_CustTable',
      bands: [{ kind: 'detail', height: 20, elements: [{ id: 'bad', type: 'field', x: 0, y: 0, width: 100, height: 16, field: 'missing' }] }],
    } } });
    expect(bad.statusCode).toBe(200); expect(bad.json().valid).toBe(false); expect(bad.json().diagnostics[0].message).toMatch(/missing/);
  });
});
