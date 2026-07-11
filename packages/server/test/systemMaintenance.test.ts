import { describe, expect, it, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { unzipSync } from 'fflate';
import { buildServer } from '../src/server.js';

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
  beforeAll(async () => {
    app = buildServer();
    await app.ready();
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: 'admin' } });
    auth = { cookie: (login.headers['set-cookie'] as string).split(';')[0] };
  });

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
  });
});
