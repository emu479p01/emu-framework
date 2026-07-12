import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { unzipSync } from 'fflate';
import { buildServer } from '../src/server.js';
import { hashPassword } from '../src/auth.js';

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
    app = buildServer();
    await app.ready();
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: 'admin' } });
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
    const { boundary, body } = multipart(exported.rawPayload);
    const validated = await app.inject({
      method: 'POST', url: '/api/system/backup/validate',
      headers: { ...auth, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
    });
    expect(validated.statusCode).toBe(200);
    expect(validated.json().manifest.files).toHaveLength(2);
  });

  it('requires a framework administrator', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/system/info' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/system/update/latest', headers: clerkAuth })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/system/update', headers: clerkAuth })).statusCode).toBe(403);
  });

  it('reports the latest stable release without accepting a client-selected version', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      tag_name: '0.0.1.2', name: 'Stable', body: 'Release notes', html_url: 'https://example.test/release',
      published_at: '2026-07-12T00:00:00Z', draft: false, prerelease: false,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const response = await app.inject({ method: 'GET', url: '/api/system/update/latest', headers: auth });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ currentVersion: '0.0.1.1', latestVersion: '0.0.1.2', updateAvailable: true });
  });

  it('exposes an unauthenticated health check for container supervision', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json()).toEqual({ ok: true });
  });
});
