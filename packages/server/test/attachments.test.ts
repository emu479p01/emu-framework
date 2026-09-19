import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FastifyInstance } from 'fastify';
import type { Kernel } from '@emu/core';
import { buildServer } from '../src/server.js';
import { applyErpSample } from './fixtures/erpSample.js';
import { completeTestSetup, TEST_ADMIN_PASSWORD, TEST_SETUP_CODE } from './setupHelper.js';

function multipart(name: string, mime: string, bytes: Buffer) {
  const boundary = `----EmuAttachment${Date.now()}`;
  return { contentType: `multipart/form-data; boundary=${boundary}`, body: Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]) };
}

describe('record attachments', () => {
  let app: FastifyInstance; let auth: { cookie: string }; let root: string; let customerId: number;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'emu-attachments-')); process.env.EMU_FILE_STORAGE_PATH = root;
    app = buildServer({ setupCode: TEST_SETUP_CODE }); await app.ready(); await completeTestSetup(app); const kernel = (app as FastifyInstance & { kernel: Kernel }).kernel; applyErpSample(kernel);
    const login = await app.inject({ method:'POST',url:'/api/login',payload:{username:'admin',password:TEST_ADMIN_PASSWORD} }); auth={cookie:(login.headers['set-cookie'] as string).split(';')[0]};
    customerId = (await app.inject({method:'POST',url:'/api/data/ERP_CustTable',headers:auth,payload:{accountNum:'ATT-1',name:'Attachment customer'}})).json().id;
  });
  afterAll(async () => { await app.close(); delete process.env.EMU_FILE_STORAGE_PATH; await rm(root,{recursive:true,force:true}); });

  it('streams an allowed file under an opaque key and downloads by parent permission', async () => {
    const upload = multipart('proof.txt','text/plain',Buffer.from('hello attachment'));
    const created = await app.inject({method:'POST',url:`/api/attachments/ERP_CustTable/${customerId}/file`,headers:{...auth,'content-type':upload.contentType},payload:upload.body});
    expect(created.statusCode).toBe(201); const id=created.json().id;
    const listed = await app.inject({method:'GET',url:`/api/attachments/ERP_CustTable/${customerId}`,headers:auth}); expect(listed.json().items[0]).toMatchObject({id,kind:'file',name:'proof.txt',bytes:16});
    const downloaded = await app.inject({method:'GET',url:`/api/attachments/${id}/download`,headers:auth}); expect(downloaded.rawPayload.toString()).toBe('hello attachment');
    const kernel=(app as FastifyInstance & {kernel:Kernel}).kernel; const blob=kernel.db.prepare('SELECT storageKey FROM "FW_Blob"').get() as {storageKey:string}; expect(blob.storageKey).not.toContain('proof'); expect((await readFile(join(root,...blob.storageKey.split('/')))).toString()).toBe('hello attachment');
  });

  it('supports note and URL but rejects executable content', async () => {
    expect((await app.inject({method:'POST',url:`/api/attachments/ERP_CustTable/${customerId}/note`,headers:auth,payload:{text:'Call customer'}})).statusCode).toBe(201);
    expect((await app.inject({method:'POST',url:`/api/attachments/ERP_CustTable/${customerId}/url`,headers:auth,payload:{url:'https://example.test/doc'}})).statusCode).toBe(201);
    const upload=multipart('bad.svg','image/svg+xml',Buffer.from('<svg/>')); expect((await app.inject({method:'POST',url:`/api/attachments/ERP_CustTable/${customerId}/file`,headers:{...auth,'content-type':upload.contentType},payload:upload.body})).statusCode).toBe(415);
  });
});
