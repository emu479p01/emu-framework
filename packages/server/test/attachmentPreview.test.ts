import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FastifyInstance } from 'fastify';
import type { Kernel } from '@emu/core';
import { buildServer } from '../src/server.js';
import { hashPassword } from '../src/auth.js';
import { applyErpSample } from './fixtures/erpSample.js';
import { completeTestSetup, TEST_ADMIN_PASSWORD, TEST_SETUP_CODE } from './setupHelper.js';

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const JPEG_MINIMAL = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0)]);

function multipart(name: string, mime: string, bytes: Buffer) {
  const boundary = `----EmuPreview${Date.now()}`;
  return { contentType: `multipart/form-data; boundary=${boundary}`, body: Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]) };
}

describe('image attachment preview', () => {
  let app: FastifyInstance; let auth: { cookie: string }; let root: string; let customerId: number; let lineId: number;
  const upload = async (table: string, id: number, name: string, mime: string, bytes: Buffer) => {
    const part = multipart(name, mime, bytes);
    const response = await app.inject({ method: 'POST', url: `/api/attachments/${table}/${id}/file`, headers: { ...auth, 'content-type': part.contentType }, payload: part.body });
    return response.json().id as string;
  };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'emu-preview-')); process.env.EMU_FILE_STORAGE_PATH = root;
    app = buildServer({ setupCode: TEST_SETUP_CODE }); await app.ready(); await completeTestSetup(app);
    const kernel = (app as FastifyInstance & { kernel: Kernel }).kernel; applyErpSample(kernel);
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: TEST_ADMIN_PASSWORD } });
    auth = { cookie: (login.headers['set-cookie'] as string).split(';')[0] };
    customerId = (await app.inject({ method: 'POST', url: '/api/data/ERP_CustTable', headers: auth, payload: { accountNum: 'P-1', name: 'Preview customer' } })).json().id;
    const order = (await app.inject({ method: 'POST', url: '/api/data/ERP_SalesTable', headers: auth, payload: { salesId: 'SO-P1', custId: customerId } })).json().id;
    const item = (await app.inject({ method: 'POST', url: '/api/data/ERP_InventItem', headers: auth, payload: { itemId: 'IT-1', itemName: 'Preview item' } })).json().id;
    lineId = (await app.inject({ method: 'POST', url: '/api/data/ERP_SalesLine', headers: auth, payload: { salesId: order, itemId: item, qty: 1 } })).json().id;
  });
  afterAll(async () => { await app.close(); delete process.env.EMU_FILE_STORAGE_PATH; await rm(root, { recursive: true, force: true }); });

  it('streams PNG and JPEG inline with hardening headers', async () => {
    const png = await upload('ERP_CustTable', customerId, 'logo.png', 'image/png', PNG_1X1);
    const jpeg = await upload('ERP_CustTable', customerId, 'photo.jpg', 'image/jpeg', JPEG_MINIMAL);
    for (const [id, type, bytes] of [[png, 'image/png', PNG_1X1], [jpeg, 'image/jpeg', JPEG_MINIMAL]] as const) {
      const preview = await app.inject({ method: 'GET', url: `/api/attachments/${id}/preview`, headers: auth });
      expect(preview.statusCode).toBe(200);
      expect(preview.headers['content-type']).toBe(type);
      expect(preview.headers['content-disposition']).toBe('inline');
      expect(preview.headers['x-content-type-options']).toBe('nosniff');
      expect(preview.headers['cache-control']).toBe('private, no-store');
      expect(preview.rawPayload.equals(bytes)).toBe(true);
    }
    // download keeps its attachment disposition
    const download = await app.inject({ method: 'GET', url: `/api/attachments/${png}/download`, headers: auth });
    expect(download.statusCode).toBe(200);
    expect(String(download.headers['content-disposition'])).toContain('attachment');
  });

  it('previews header and line attachments alike', async () => {
    const lineFile = await upload('ERP_SalesLine', lineId, 'line.png', 'image/png', PNG_1X1);
    const preview = await app.inject({ method: 'GET', url: `/api/attachments/${lineFile}/preview`, headers: auth });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['content-type']).toBe('image/png');
  });

  it('rejects non-image attachments and mismatched signatures', async () => {
    const text = await upload('ERP_CustTable', customerId, 'note.txt', 'text/plain', Buffer.from('not an image'));
    const unsupported = await app.inject({ method: 'GET', url: `/api/attachments/${text}/preview`, headers: auth });
    expect(unsupported.statusCode).toBe(415);

    // A text payload that slips past the extension↔MIME upload check under a
    // recorded image/png type must still be caught by the signature check.
    const disguised = await upload('ERP_CustTable', customerId, 'fake.png', 'image/png', Buffer.from('plain text pretending to be png'));
    const caught = await app.inject({ method: 'GET', url: `/api/attachments/${disguised}/preview`, headers: auth });
    expect(caught.statusCode).toBe(415);
    expect(caught.json().error).toContain('does not match');
  });

  it('reports missing content with 410', async () => {
    const id = await upload('ERP_CustTable', customerId, 'gone.png', 'image/png', PNG_1X1);
    const kernel = (app as FastifyInstance & { kernel: Kernel }).kernel;
    const blob = kernel.db.prepare('SELECT storageKey FROM "FW_Blob" WHERE blobId=(SELECT blobId FROM "FW_Attachment" WHERE attachmentId=?)').get(id) as { storageKey: string };
    await unlink(join(root, ...blob.storageKey.split('/')));
    const preview = await app.inject({ method: 'GET', url: `/api/attachments/${id}/preview`, headers: auth });
    expect(preview.statusCode).toBe(410);
  });

  it('requires parent-record read permission', async () => {
    const id = await upload('ERP_CustTable', customerId, 'secret.png', 'image/png', PNG_1X1);
    expect((await app.inject({ method: 'GET', url: `/api/attachments/${id}/preview` })).statusCode).toBe(401);
    const kernel = (app as FastifyInstance & { kernel: Kernel }).kernel;
    const now = new Date().toISOString();
    kernel.db.prepare(`INSERT INTO "FW_User" (createdAt,createdBy,modifiedAt,modifiedBy,username,displayName,passwordHash,enabled,locale)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(now, 'admin', now, 'admin', 'viewer', 'Viewer', hashPassword('Viewer-password-123'), 1, 'en');
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'viewer', password: 'Viewer-password-123' } });
    expect(login.statusCode).toBe(200);
    const viewerAuth = { cookie: (login.headers['set-cookie'] as string).split(';')[0] };
    const preview = await app.inject({ method: 'GET', url: `/api/attachments/${id}/preview`, headers: viewerAuth });
    expect(preview.statusCode).toBe(403);
  });
});
