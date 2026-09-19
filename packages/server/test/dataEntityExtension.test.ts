import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import type { FastifyInstance } from 'fastify';
import type { AnyMeta, Kernel } from '@emu/core';
import { buildServer } from '../src/server.js';
import { applyErpSample } from './fixtures/erpSample.js';
import { completeTestSetup, TEST_ADMIN_PASSWORD, TEST_SETUP_CODE } from './setupHelper.js';

const storedOf = (kernel: Kernel): AnyMeta[] =>
  kernel.designerContext().select('FW_WebArtifact').toArray().map((row) => JSON.parse(String(row.f.json)) as AnyMeta);

const SYS_MODEL = { app: 'erp', model: 'MiniERPApplication', layer: 'SYS' as const };
const CUS_MODEL = { app: 'erp', model: 'ClientCustom', layer: 'CUS' as const };

describe('data entity extensions in the runtime', () => {
  let app: FastifyInstance; let kernel: Kernel; let auth: { cookie: string };
  const put = async (kind: string, name: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'PUT', url: `/api/designer/artifacts/${kind}/${encodeURIComponent(name)}`, headers: auth, payload });

  beforeAll(async () => {
    app = buildServer({ setupCode: TEST_SETUP_CODE }); await app.ready(); await completeTestSetup(app);
    kernel = (app as FastifyInstance & { kernel: Kernel }).kernel;
    applyErpSample(kernel);
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: TEST_ADMIN_PASSWORD } });
    auth = { cookie: (login.headers['set-cookie'] as string).split(';')[0] };
  });
  afterAll(() => app.close());

  it('saves a Data Entity and an additive extension through the Designer', async () => {
    const base = {
      kind: 'dataEntity', name: 'ERP_SalesEntity', ...SYS_MODEL,
      rootTable: 'ERP_SalesTable', businessKey: ['salesId'], fields: ['salesId', 'custId', 'status', 'orderDate'],
      lines: [{ name: 'Lines', table: 'ERP_SalesLine', parentReference: 'salesId', fields: ['itemId', 'qty'], lineKeys: ['itemId'] }],
      archiveEligible: true, businessDateField: 'orderDate',
    };
    expect((await put('dataEntity', 'ERP_SalesEntity', base)).statusCode).toBe(200);
    const extension = {
      kind: 'dataEntityExtension', name: 'ERP_ClientCustom_ERP_SalesEntity_Extension', ...CUS_MODEL,
      dataEntity: 'ERP_SalesEntity', fields: ['totalAmount'],
      lineExtensions: [{ name: 'Lines', fields: ['salesPrice'] }],
    };
    expect((await put('dataEntityExtension', extension.name, extension)).statusCode).toBe(200);
    const merged = kernel.registry.getDataEntity('ERP_SalesEntity');
    expect(merged.fields).toEqual(['salesId', 'custId', 'status', 'orderDate', 'totalAmount']);
    expect(merged.lines?.[0]?.fields).toEqual(['itemId', 'qty', 'salesPrice']);
    const metadata = (await app.inject({ method: 'GET', url: '/api/metadata', headers: auth })).json();
    const entity = metadata.dataEntities.find((entry: any) => entry.name === 'ERP_SalesEntity');
    expect(entity.fields).toContain('totalAmount');
  });

  it('rejects extensions that duplicate fields or reuse line names', async () => {
    const duplicateField = { kind: 'dataEntityExtension', name: 'ERP_ClientCustom_Dup_Extension', ...CUS_MODEL, dataEntity: 'ERP_SalesEntity', fields: ['orderDate'] };
    expect((await put('dataEntityExtension', duplicateField.name, duplicateField)).statusCode).toBe(422);
    const duplicateLine = { kind: 'dataEntityExtension', name: 'ERP_ClientCustom_DupLine_Extension', ...CUS_MODEL, dataEntity: 'ERP_SalesEntity', lines: [{ name: 'Lines', table: 'ERP_SalesLine', parentReference: 'salesId', fields: ['itemId'], lineKeys: ['itemId'] }] };
    expect((await put('dataEntityExtension', duplicateLine.name, duplicateLine)).statusCode).toBe(422);
  });

  it('exports the merged entity definition', async () => {
    const customerId = (await app.inject({ method: 'POST', url: '/api/data/ERP_CustTable', headers: auth, payload: { accountNum: 'EXT-1', name: 'Extension customer' } })).json().id;
    const itemId = (await app.inject({ method: 'POST', url: '/api/data/ERP_InventItem', headers: auth, payload: { itemId: 'EXT-IT', itemName: 'Extension item' } })).json().id;
    const orderId = (await app.inject({ method: 'POST', url: '/api/data/ERP_SalesTable', headers: auth, payload: { salesId: 'SO-EXT', custId: customerId, orderDate: '2020-01-01' } })).json().id;
    await app.inject({ method: 'POST', url: '/api/data/ERP_SalesLine', headers: auth, payload: { salesId: orderId, itemId, qty: 2 } });
    const exported = await app.inject({ method: 'GET', url: '/api/data-entities/ERP_SalesEntity/export?format=csv', headers: auth });
    expect(exported.statusCode).toBe(200);
    const files = unzipSync(exported.rawPayload) as Record<string, Uint8Array>;
    const header = Buffer.from(files['Header.csv']!).toString('utf8');
    const lines = Buffer.from(files['Lines.csv']!).toString('utf8');
    expect(header).toContain('totalAmount');
    expect(lines).toContain('salesPrice');
  });

  it('archives with the merged entity and restores archives made before later extensions', async () => {
    const policy = { businessDateField: 'orderDate', ageDays: 365, batchSize: 100, includeAttachments: true, schedule: 'daily', weekday: 0, timezone: 'UTC', enabled: true };
    expect((await app.inject({ method: 'PUT', url: '/api/system/archive/policies/ERP_SalesEntity', headers: auth, payload: policy })).statusCode).toBe(200);
    const run = await app.inject({ method: 'POST', url: '/api/system/archive/ERP_SalesEntity/run', headers: auth });
    expect(run.statusCode).toBe(200);
    expect(run.json().archived).toBe(1);
    const documents = (await app.inject({ method: 'GET', url: '/api/system/archive/documents?entity=ERP_SalesEntity', headers: auth })).json().items;
    expect(documents).toHaveLength(1);
    const archiveId = documents[0].archiveId as string;

    // A later extension introduces a mandatory table field surfaced in the entity.
    const tableExtension = { kind: 'tableExtension', name: 'ERP_ClientCustom_ERP_SalesTable_Extension', ...CUS_MODEL, table: 'ERP_SalesTable', fields: [{ name: 'reason', type: 'string', mandatory: true }] };
    expect((await put('tableExtension', tableExtension.name, tableExtension)).statusCode).toBe(200);
    const entityExtension = {
      kind: 'dataEntityExtension', name: 'ERP_ClientCustom_ERP_SalesEntity_Extension', ...CUS_MODEL,
      dataEntity: 'ERP_SalesEntity', fields: ['totalAmount', 'reason'],
      lineExtensions: [{ name: 'Lines', fields: ['salesPrice'] }],
    };
    expect((await put('dataEntityExtension', entityExtension.name, entityExtension)).statusCode).toBe(200);

    // The archived header predates the mandatory field → restore fails clearly and the archive survives.
    const blocked = await app.inject({ method: 'POST', url: `/api/system/archive/documents/${archiveId}/restore`, headers: auth });
    expect(blocked.statusCode).toBe(422);
    const kept = (await app.inject({ method: 'GET', url: '/api/system/archive/documents?entity=ERP_SalesEntity', headers: auth })).json().items;
    expect(kept).toHaveLength(1);
    expect(kept[0].restoredAt ?? null).toBeNull();

    // Making the field read-only drops the mandatory flag; the same archive then restores.
    const relaxed = { ...tableExtension, fields: [{ name: 'reason', type: 'string' }], fieldOverrides: [{ field: 'reason', readOnly: true }] };
    expect((await put('tableExtension', relaxed.name, relaxed)).statusCode).toBe(200);
    const restored = await app.inject({ method: 'POST', url: `/api/system/archive/documents/${archiveId}/restore`, headers: auth });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().restored).toBe(true);
    const headerRow = kernel.db.prepare(`SELECT reason FROM "ERP_SalesTable" WHERE salesId='SO-EXT'`).get() as { reason: string | null };
    expect(headerRow.reason ?? null).toBeNull();
  });
});
