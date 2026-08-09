import { beforeAll, describe, expect, it } from 'vitest';
import { createMetadataPackage, mergeAppManifest, parseMetadataPackage } from '../src/metadataPackage.js';
import type { MetadataArtifact } from '@emu/core';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { completeTestSetup, TEST_SETUP_CODE } from './setupHelper.js';

function multipartPackage(payload: Buffer, filename = 'sales.emuapp.json') {
  const boundary = `----EmuPackage${Date.now()}${Math.random()}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/json\r\n\r\n`),
    payload,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { boundary, body };
}

describe('metadata packages', () => {
  it('round-trips a checksummed package and rejects tampering', () => {
    const artifact = { kind: 'app', name: 'sales', models: [{ name: 'Core', layer: 'CUS' }] } as MetadataArtifact;
    const pkg = createMetadataPackage('0.0.0.9', { type: 'app', app: 'sales' }, [artifact]);
    expect(parseMetadataPackage(JSON.parse(JSON.stringify(pkg))).scope.app).toBe('sales');
    expect(() => parseMetadataPackage({ ...pkg, frameworkVersion: '9.9.9' })).toThrow(/checksum/i);
  });

  it('merges model definitions without deleting local models', () => {
    const existing = { kind: 'app', name: 'sales', dependsOn: ['base'], models: [{ name: 'Local', layer: 'CUS' }] } as MetadataArtifact;
    const incoming = { kind: 'app', name: 'sales', dependsOn: ['shared'], models: [{ name: 'Core', layer: 'ISV' }] } as MetadataArtifact;
    const merged = mergeAppManifest(existing, incoming) as MetadataArtifact & { models: { name: string }[]; dependsOn: string[] };
    expect(merged.models.map((model) => model.name)).toEqual(['Local', 'Core']);
    expect(merged.dependsOn).toEqual(['base', 'shared']);
  });
});

describe('metadata package API', () => {
  let app: FastifyInstance;
  let auth: { cookie: string };
  beforeAll(async () => {
    app = buildServer({ setupCode: TEST_SETUP_CODE }); await app.ready();
    await completeTestSetup(app);
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: 'Admin-password-123' } });
    auth = { cookie: (login.headers['set-cookie'] as string).split(';')[0] };
    const createdApp = await app.inject({ method: 'PUT', url: '/api/designer/artifacts/app/sales', headers: auth,
      payload: { kind: 'app', name: 'sales', icon: 'chart', models: [{ name: 'Core', layer: 'CUS' }] } });
    expect(createdApp.statusCode).toBe(200);
    const createdTable = await app.inject({ method: 'PUT', url: '/api/designer/artifacts/table/SALES_Thing', headers: auth,
      payload: { kind: 'table', name: 'SALES_Thing', app: 'sales', model: 'Core', layer: 'CUS', fields: [{ name: 'code', type: 'string' }] } });
    expect(createdTable.statusCode, createdTable.body).toBe(200);
    const createdMenu = await app.inject({ method: 'PUT', url: '/api/designer/artifacts/menu/SALES_MainMenu', headers: auth,
      payload: { kind: 'menu', name: 'SALES_MainMenu', app: 'sales', model: 'Core', layer: 'CUS', items: [{ label: 'Designer', route: '/designer', icon: 'wrench' }] } });
    expect(createdMenu.statusCode, createdMenu.body).toBe(200);
  });

  it('exports, previews, and merges an app package', async () => {
    const exported = await app.inject({ method: 'GET', url: '/api/designer/packages/app/sales/export', headers: auth });
    expect(exported.statusCode).toBe(200);
    const original = parseMetadataPackage(exported.json());
    expect(original.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'app', name: 'sales', icon: 'chart' }),
      expect.objectContaining({ kind: 'menu', name: 'SALES_MainMenu', items: [expect.objectContaining({ icon: 'wrench' })] }),
    ]));
    const changed = createMetadataPackage('0.0.0.9', original.scope, original.artifacts.map((artifact) =>
      artifact.name === 'SALES_Thing' ? { ...artifact, label: 'Imported things' } : artifact,
    ));
    const { boundary, body } = multipartPackage(Buffer.from(JSON.stringify(changed)));
    const preview = await app.inject({ method: 'POST', url: '/api/designer/packages/import/preview',
      headers: { ...auth, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().diff).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'SALES_Thing', op: 'update' })]));
    const applied = await app.inject({ method: 'POST', url: '/api/designer/change-sets/apply', headers: auth,
      payload: { previewId: preview.json().previewId, confirmation: true } });
    expect(applied.statusCode).toBe(200);
  });

  it('accepts metadata packages larger than the old 1 MB default', async () => {
    const large = createMetadataPackage('0.1.2.0', { type: 'app', app: 'sales' }, [
      { kind: 'app', name: 'sales', label: `Sales ${'x'.repeat(1024 * 1024)}`, models: [{ name: 'Core', layer: 'CUS' }] } as MetadataArtifact,
    ]);
    const payload = Buffer.from(JSON.stringify(large));
    expect(payload.length).toBeGreaterThan(1024 * 1024);
    const { boundary, body } = multipartPackage(payload);
    const response = await app.inject({ method: 'POST', url: '/api/designer/packages/import/preview',
      headers: { ...auth, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().package.artifactCount).toBe(1);
  });

  it('rejects metadata packages larger than 20 MB with a clear 413 response', async () => {
    const { boundary, body } = multipartPackage(Buffer.alloc(20 * 1024 * 1024 + 1, 0x78));
    const response = await app.inject({ method: 'POST', url: '/api/designer/packages/import/preview',
      headers: { ...auth, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({ error: 'Package is too large (maximum 20 MB)' });
  });
});
