import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DataContext, type Kernel, type AnyMeta } from '@emu/core';
import { buildServer } from '../src/server.js';
const loadStoredArtifacts = (kernel: Kernel): AnyMeta[] => kernel.designerContext().select('FW_WebArtifact').toArray().map(row => JSON.parse(String(row.get('json'))) as AnyMeta);
import { recordDrafts } from '../src/recordDrafts.js';
import { completeTestSetup, TEST_SETUP_CODE } from './setupHelper.js';

const placement = { app: 'drafts', model: 'Base', layer: 'SYS' as const };
export const artifacts: AnyMeta[] = [
  { kind: 'app', name: 'drafts', models: [{ name: 'Base', layer: 'SYS' }] } as unknown as AnyMeta,
  { kind: 'table', name: 'DRAFTS_Row', ...placement, fields: [
    { name: 'number', type: 'string', mandatory: true, readOnly: true },
    { name: 'name', type: 'string', mandatory: true },
    { name: 'when', type: 'datetime' },
    { name: 'secret', type: 'string', encrypted: true },
  ], indexes: [{ name: 'Number', fields: ['number'], unique: true }] },
  { kind: 'function', name: 'DRAFTS_Image', ...placement, imageInput: { table: 'DRAFTS_Row', recordIdArgument: 'recordId', multiple: true }, code: 'return { ids: args.attachmentIds, recordId: args.recordId };' },
  { kind: 'privilege', name: 'DRAFTS_Edit', ...placement, tablePermissions: [{ table: 'DRAFTS_Row', read: true, create: true, update: true, delete: true }], functions: ['DRAFTS_Image'], views: ['DRAFTS_Audit'] },
  { kind: 'role', name: 'DRAFTS_Role', ...placement, privileges: ['DRAFTS_Edit'] },
  { kind: 'view', name: 'DRAFTS_Audit', ...placement, source: { table: 'DRAFTS_Row', alias: 'r' }, columns: [{ name: 'creator', expression: { type: 'field', ref: 'r.sys_createdBy' } }] },
];
describe('1.4.0 record lifecycle and images', () => {
  let app: ReturnType<typeof buildServer>, kernel: Kernel, auth: { cookie: string }, root: string, sequence: number;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'emu140-'));
    process.env.EMU_FILE_STORAGE_PATH = root;
    app = buildServer({ setupCode: TEST_SETUP_CODE, appTitle: 'Company' });
    await app.ready(); auth = await completeTestSetup(app); kernel = (app as typeof app & { kernel: Kernel }).kernel;
    expect(kernel.applyWebArtifacts([...loadStoredArtifacts(kernel), ...artifacts])).toEqual([]);
    const admin = kernel.context().select('FW_User').where('username', '=', 'admin').firstOnly()!;
    kernel.context().newRecord('FW_UserRole').setMany({ userId: admin.id, username: 'admin', role: 'DRAFTS_Role' }).insert();
    sequence = 0;
    kernel.hooks.register('DRAFTS_Row', { initValue(rec) { rec.set('number', `SO-${++sequence}`).set('secret', 'initial-secret'); } });
  });
  afterEach(async () => { await app.close(); delete process.env.EMU_FILE_STORAGE_PATH; await rm(root, { recursive: true, force: true }); });
  const requestBody = { name: 'Order' };
  async function draft() { return (await app.inject({ method: 'POST', url: '/api/data/DRAFTS_Row/drafts', headers: auth, payload: {} })).json(); }
  async function save(token: string, payload: Record<string, unknown> = requestBody) { return app.inject({ method: 'POST', url: `/api/data/DRAFTS_Row/drafts/${token}/save`, headers: auth, payload }); }

  it('shows initValue without inserting, preserves read-only values, retries validation and deduplicates saves', async () => {
    const d = await draft();
    expect(d.record.number).toBe('SO-1'); expect(d.record.secret).not.toBe('initial-secret');
    expect(kernel.context().select('DRAFTS_Row').count()).toBe(0);
    expect((kernel.db.prepare('SELECT snapshot FROM FW_RecordDraft').get() as { snapshot: string }).snapshot).not.toContain('initial-secret');
    expect((await save(d.token, {})).statusCode).toBe(422);
    const first = await save(d.token); expect(first.statusCode).toBe(201);
    const second = await save(d.token); expect(second.json().id).toBe(first.json().id);
    expect(first.json()).toMatchObject({ number: 'SO-1', sys_createdBy: 'admin', createdBy: 'admin' });
    expect(sequence).toBe(1); expect(kernel.context().select('DRAFTS_Row').count()).toBe(1);
  });
  it('keeps independent tabs, rejects expiry and changed metadata', async () => {
    const a = await draft(), b = await draft(); expect(a.record.number).not.toBe(b.record.number);
    kernel.db.prepare('UPDATE FW_RecordDraft SET expiresAt=0 WHERE token=?').run(a.token);
    expect((await save(a.token)).statusCode).toBe(409);
    expect(kernel.applyWebArtifacts([...loadStoredArtifacts(kernel), ...artifacts, { kind: 'enum', name: 'DRAFTS_State', ...placement, values: [{ name: 'Open', value: 0 }] }])).toEqual([]);
    expect((await save(b.token)).statusCode).toBe(409);
  });
  it('rejects drafts belonging to another user and create permission changes', async () => {
    const d = await draft(), service = recordDrafts(kernel);
    const other = new DataContext(kernel.db, kernel.registry, { user: 'someone-else' });
    expect(() => service.save(other, 'DRAFTS_Row', d.token, requestBody)).toThrow(/unavailable/);
    const denied = new DataContext(kernel.db, kernel.registry, { user: 'admin' }, undefined, undefined, { ...kernel.context().policy, can: () => false });
    expect(() => service.create(denied, 'DRAFTS_Row')).toThrow(/Access denied/);
  });
  it('rejects read-only tampering, preserves created audit and serializes datetimes in UTC', async () => {
    const d = await draft(); expect((await save(d.token, { name: 'Order', number: 'forged' })).statusCode).toBe(422);
    const created = (await save(d.token, { ...requestBody, when: '2026-08-15T15:52:39' })).json();
    expect(created.when).toBe('2026-08-15T15:52:39.000Z');
    const response = await app.inject({ method: 'PATCH', url: `/api/data/DRAFTS_Row/${created.id}`, headers: auth, payload: { name: 'Changed', sys_createdBy: 'forged', createdAt: 'forged', sys_modifiedBy: 'forged' } });
    expect(response.json()).toMatchObject({ createdBy: 'admin', sys_modifiedBy: 'admin', createdAt: created.createdAt });
    const filtered = await app.inject({ url: '/api/data/DRAFTS_Row?filter.sys_createdBy=admin&sort=sys_createdAt', headers: auth });
    expect(filtered.json().data).toHaveLength(1);
    const view = await app.inject({ url: '/api/views/DRAFTS_Audit/data', headers: auth });
    expect(view.statusCode).toBe(200); expect(view.json().data[0].creator).toBe('admin');
  });
  it('rolls back insert and keeps the draft usable when an event fails', async () => {
    const d = await draft(); let fail = true;
    kernel.events.on('DRAFTS_Row', 'onInserted', () => { if (fail) throw new Error('failure'); });
    expect((await save(d.token)).statusCode).toBe(500);
    expect(kernel.context().select('DRAFTS_Row').count()).toBe(0);
    fail = false; expect((await save(d.token)).statusCode).toBe(201); expect(sequence).toBe(1);
  });
  it('publishes safe Function inputs and branding without executable code', async () => {
    expect((await app.inject({ url: '/api/setup/status' })).json().branding.title).toBe('Company');
    const metadata = (await app.inject({ url: '/api/metadata', headers: auth })).json();
    expect(metadata.functionInputs[0]).toMatchObject({ name: 'DRAFTS_Image', imageInput: { table: 'DRAFTS_Row' } });
    expect(metadata.functionInputs[0]).not.toHaveProperty('code');
    expect(metadata.tables.find((t: { name: string }) => t.name === 'DRAFTS_Row').fields).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'sys_createdAt', readOnly: true })]));
  });
  it('uploads and previews WebP, deduplicates retries, validates Function ownership and image signatures', async () => {
    const d = await draft(), row = (await save(d.token)).json(), uploadId = randomUUID();
    const send = async (bytes: Buffer, id = uploadId, recordId = row.id) => {
      const boundary = 'emu140';
      return app.inject({ method: 'POST', url: `/api/attachments/DRAFTS_Row/${recordId}/file?function=DRAFTS_Image&uploadId=${id}`, headers: { ...auth, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.webp"\r\nContent-Type: image/webp\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]) });
    };
    const bytes = Buffer.from('RIFFxxxxWEBPVP8 ');
    expect((await send(bytes)).statusCode).toBe(201);
    expect((await send(bytes)).json().id).toBe(uploadId);
    expect((await app.inject({ url: `/api/attachments/${uploadId}/preview`, headers: auth })).statusCode).toBe(200);
    expect((await send(Buffer.from('fake'), randomUUID())).statusCode).toBe(415);
    const action = (recordId: number, attachmentIds: string[]) => app.inject({ method: 'POST', url: '/api/action/DRAFTS_Image', headers: auth, payload: { recordId, attachmentIds } });
    expect((await action(row.id, [uploadId])).json()).toEqual({ ids: [uploadId], recordId: row.id });
    const other = (await save((await draft()).token)).json();
    expect((await action(other.id, [uploadId])).statusCode).toBe(403);
    expect((await action(row.id, [])).statusCode).toBe(422);
  });
});
