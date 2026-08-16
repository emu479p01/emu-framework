import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { unzipSync, zipSync } from 'fflate';
import { buildServer } from '../src/server.js';
import { hashPassword } from '../src/auth.js';
import { completeTestSetup, TEST_SETUP_CODE } from './setupHelper.js';

function multipart(file: Buffer) {
  const boundary = `----EmuBackup${Date.now()}`;
  return {
    boundary,
    body: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.emubackup"\r\nContent-Type: application/zip\r\n\r\n`),
      file,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

describe('system maintenance', () => {
  let app: FastifyInstance;
  let auth: { cookie: string };
  let clerkAuth: { cookie: string };
  beforeAll(async () => {
    app = buildServer({ setupCode: TEST_SETUP_CODE });
    await app.ready();
    await completeTestSetup(app);
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: 'Admin-password-123' } });
    auth = { cookie: (login.headers['set-cookie'] as string).split(';')[0] };
    const ctx = (app as FastifyInstance & { kernel: any }).kernel.context();
    ctx.newRecord('FW_User').setMany({ username: 'clerk', displayName: 'Clerk', passwordHash: hashPassword('clerk'), enabled: true }).insert();
    const clerkLogin = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'clerk', password: 'clerk' } });
    clerkAuth = { cookie: (clerkLogin.headers['set-cookie'] as string).split(';')[0] };
  });
  afterAll(async () => { vi.restoreAllMocks(); await app.close(); });

  it('exports and validates a complete two-database backup', async () => {
    const exported = await app.inject({ method: 'GET', url: '/api/system/backup/export', headers: auth });
    expect(exported.statusCode).toBe(200);
    const files = unzipSync(exported.rawPayload);
    expect(Object.keys(files).sort()).toEqual(['data.db', 'designer.db', 'manifest.json']);
    expect(JSON.parse(Buffer.from(files['manifest.json']).toString('utf8'))).toMatchObject({ schemaVersion: 3, components: ['data', 'designer', 'fonts'] });
    const { boundary, body } = multipart(exported.rawPayload);
    const validated = await app.inject({
      method: 'POST', url: '/api/system/backup/validate',
      headers: { ...auth, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
    });
    expect(validated.statusCode).toBe(200);
    expect(validated.json().manifest.files).toHaveLength(2);
  });

  it('exports independent backup components and creates a restore preview', async () => {
    const data = await app.inject({ method: 'GET', url: '/api/system/backup/export?component=data', headers: auth });
    expect(Object.keys(unzipSync(data.rawPayload)).sort()).toEqual(['data.db', 'manifest.json']);
    const upload = multipart(data.rawPayload);
    const preview = await app.inject({
      method: 'POST', url: '/api/system/backup/restore/preview',
      headers: { ...auth, 'content-type': `multipart/form-data; boundary=${upload.boundary}` }, payload: upload.body,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ components: ['data'] });
    expect(preview.json().warnings[0]).toContain('users');

    const fonts = await app.inject({ method: 'GET', url: '/api/system/backup/export?component=fonts', headers: auth });
    expect(JSON.parse(Buffer.from(unzipSync(fonts.rawPayload)['manifest.json']).toString('utf8')).components).toEqual(['fonts']);
  });

  it('accepts legacy full manifests and rejects backups from newer frameworks', async () => {
    const exported = await app.inject({ method: 'GET', url: '/api/system/backup/export', headers: auth });
    const files = unzipSync(exported.rawPayload); const legacy = JSON.parse(Buffer.from(files['manifest.json']).toString('utf8'));
    legacy.schemaVersion = 2; legacy.frameworkVersion = '0.1.4.0'; delete legacy.components; files['manifest.json'] = new TextEncoder().encode(JSON.stringify(legacy));
    const legacyUpload = multipart(Buffer.from(zipSync(files)));
    const accepted = await app.inject({ method: 'POST', url: '/api/system/backup/validate', headers: { ...auth, 'content-type': `multipart/form-data; boundary=${legacyUpload.boundary}` }, payload: legacyUpload.body });
    expect(accepted.statusCode).toBe(200);

    legacy.frameworkVersion = '99.0.0.0'; files['manifest.json'] = new TextEncoder().encode(JSON.stringify(legacy));
    const futureUpload = multipart(Buffer.from(zipSync(files)));
    const rejected = await app.inject({ method: 'POST', url: '/api/system/backup/restore/preview', headers: { ...auth, 'content-type': `multipart/form-data; boundary=${futureUpload.boundary}` }, payload: futureUpload.body });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json().error).toContain('newer framework');
  });

  it('requires a framework administrator', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/system/info' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/system/update/latest', headers: clerkAuth })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/system/update', headers: clerkAuth })).statusCode).toBe(403);
  });

  it('reports the latest stable release without accepting a client-selected version', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      tag_name: '0.1.6.1', name: 'Stable', body: 'Release notes', html_url: 'https://example.test/release',
      published_at: '2026-07-12T00:00:00Z', draft: false, prerelease: false,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const response = await app.inject({ method: 'GET', url: '/api/system/update/latest', headers: auth });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ currentVersion: '0.1.6.1', latestVersion: '0.1.6.1', updateAvailable: false });
  });

  it('exposes an unauthenticated health check for container supervision', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json()).toEqual({ ok: true });
  });
});
