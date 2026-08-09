import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Kernel } from '@emu/core';
import { unzipSync } from 'fflate';
import { buildServer } from '../src/server.js';
import { applyErpSample } from './fixtures/erpSample.js';
import { completeTestSetup, TEST_SETUP_CODE } from './setupHelper.js';

function multipart(file: Buffer) {
  const boundary = `----EmuAppData${Date.now()}`;
  return { boundary, body: Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="erp.emuappdata"\r\nContent-Type: application/zip\r\n\r\n`),
    file, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]) };
}

describe('app data management', () => {
  let app: FastifyInstance; let auth: { cookie: string }; let kernel: Kernel;
  beforeAll(async () => {
    app = buildServer({ setupCode: TEST_SETUP_CODE }); await app.ready(); await completeTestSetup(app);
    kernel = (app as unknown as { kernel: Kernel }).kernel; applyErpSample(kernel);
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: 'Admin-password-123' } });
    auth = { cookie: (login.headers['set-cookie'] as string).split(';')[0] };
    kernel.context().newRecord('ERP_InventItem').setMany({ itemId: 'A-1', itemName: 'Archive item', salesPrice: 42, onHand: 3 }).insert();
  });
  afterAll(async () => { await app.close(); });

  it('lists only business apps and their owned table counts', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/system/app-data', headers: auth });
    expect(response.statusCode).toBe(200);
    expect(response.json().apps.some((entry: { name: string }) => entry.name === 'system')).toBe(false);
    expect(response.json().apps.find((entry: { name: string }) => entry.name === 'erp').totalRows).toBeGreaterThan(0);
  });

  it('exports, deletes, previews, and atomically restores one app package', async () => {
    const exported = await app.inject({ method: 'GET', url: '/api/system/app-data/erp/export', headers: auth });
    expect(exported.statusCode).toBe(200);
    const files = unzipSync(exported.rawPayload); const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString('utf8'));
    expect(manifest).toMatchObject({ format: 'emuframework-app-data', schemaVersion: 1, app: 'erp' });
    expect(Object.keys(files)).toContain('tables/ERP_InventItem.ndjson');

    const deleted = await app.inject({ method: 'DELETE', url: '/api/system/app-data/erp', headers: auth, payload: { confirmation: 'erp' } });
    expect(deleted.statusCode).toBe(200);
    expect(kernel.context().select('ERP_InventItem').count()).toBe(0);

    const upload = multipart(exported.rawPayload);
    const preview = await app.inject({ method: 'POST', url: '/api/system/app-data/erp/import/preview', headers: { ...auth, 'content-type': `multipart/form-data; boundary=${upload.boundary}` }, payload: upload.body });
    expect(preview.statusCode).toBe(200);
    const restored = await app.inject({ method: 'POST', url: '/api/system/app-data/erp/import/replace', headers: auth, payload: { previewId: preview.json().previewId, confirmation: 'erp' } });
    expect(restored.statusCode).toBe(200);
    expect(kernel.context().select('ERP_InventItem').whereEq({ itemId: 'A-1' }).firstOnly()?.f.itemName).toBe('Archive item');
  });

  it('requires typed confirmation and framework-admin authentication', async () => {
    expect((await app.inject({ method: 'DELETE', url: '/api/system/app-data/erp', headers: auth, payload: { confirmation: 'wrong' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/system/app-data' })).statusCode).toBe(401);
  });
});
