import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Kernel } from '@emu/core';
import { buildServer } from '../src/server.js';
import { applyErpSample } from './fixtures/erpSample.js';

/** Builds a minimal multipart/form-data body for fastify's inject() (no external deps). */
function buildMultipart(fields: { name: string; value: string }[], file?: { name: string; filename: string; content: Buffer; contentType: string }) {
  const boundary = `----EmuTestBoundary${Date.now()}`;
  const parts: Buffer[] = [];
  for (const f of fields) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"\r\n\r\n${f.value}\r\n`),
    );
  }
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
      ),
      file.content,
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(parts) };
}

describe('import/export', () => {
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    app = buildServer();
    await app.ready();
    applyErpSample((app as unknown as { kernel: Kernel }).kernel);
    const res = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'admin', password: 'admin' },
    });
    cookie = res.headers['set-cookie'] as string;
    // seed two customers to export
    await app.inject({
      method: 'POST',
      url: '/api/data/ERP_CustTable',
      headers: auth(),
      payload: { accountNum: 'C001', name: 'Acme Co', email: 'a@acme.test', phone: '111' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/data/ERP_CustTable',
      headers: auth(),
      payload: { accountNum: 'C002', name: 'Beta Co', email: 'b@beta.test', phone: '222' },
    });
  });

  function auth() {
    return { cookie: cookie.split(';')[0] };
  }

  it('exports CSV with headers and rows', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/data/ERP_CustTable/export?format=csv', headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const text = res.body.replace(/^﻿/, '');
    expect(text).toContain('Account');
    expect(text).toContain('C001');
    expect(text).toContain('Acme Co');
  });

  it('exports XLSX as a valid workbook', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/data/ERP_CustTable/export?format=xlsx', headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.rawPayload.length).toBeGreaterThan(0);
  });

  it('rejects export for unauthenticated requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/data/ERP_CustTable/export?format=csv' });
    expect(res.statusCode).toBe(401);
  });

  it('previews a CSV import with suggested field mapping', async () => {
    const csv = 'Account,Name,Email,Phone\nC010,Gamma Co,g@gamma.test,333\n';
    const { boundary, body } = buildMultipart([], {
      name: 'file',
      filename: 'custs.csv',
      content: Buffer.from(csv),
      contentType: 'text/csv',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/data/ERP_CustTable/import/preview',
      headers: { ...auth(), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.rowCount).toBe(1);
    expect(json.columns).toEqual(['Account', 'Name', 'Email', 'Phone']);
    const mapping = Object.fromEntries(json.suggestedMapping.map((m: { column: string; field: string | null }) => [m.column, m.field]));
    expect(mapping.Account).toBe('accountNum');
    expect(mapping.Name).toBe('name');
  });

  it('commits a CSV import in insert mode', async () => {
    const csv = 'accountNum,name,email,phone\nC020,Delta Co,d@delta.test,444\n';
    const mapping = JSON.stringify({ accountNum: 'accountNum', name: 'name', email: 'email', phone: 'phone' });
    const { boundary, body } = buildMultipart(
      [
        { name: 'mapping', value: mapping },
        { name: 'mode', value: 'insert' },
      ],
      { name: 'file', filename: 'custs.csv', content: Buffer.from(csv), contentType: 'text/csv' },
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/data/ERP_CustTable/import/commit',
      headers: { ...auth(), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.inserted).toBe(1);
    expect(json.failed).toEqual([]);

    const list = await app.inject({ method: 'GET', url: '/api/data/ERP_CustTable?filter.accountNum=C020', headers: auth() });
    expect(list.json().data[0].name).toBe('Delta Co');
  });

  it('commits an upsert import that updates an existing row by key field', async () => {
    const csv = 'accountNum,name,email,phone\nC001,Acme Co Updated,new@acme.test,999\nC030,Epsilon Co,e@eps.test,555\n';
    const mapping = JSON.stringify({ accountNum: 'accountNum', name: 'name', email: 'email', phone: 'phone' });
    const { boundary, body } = buildMultipart(
      [
        { name: 'mapping', value: mapping },
        { name: 'mode', value: 'upsert' },
        { name: 'keyField', value: 'accountNum' },
      ],
      { name: 'file', filename: 'custs.csv', content: Buffer.from(csv), contentType: 'text/csv' },
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/data/ERP_CustTable/import/commit',
      headers: { ...auth(), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.updated).toBe(1);
    expect(json.inserted).toBe(1);

    const updated = await app.inject({ method: 'GET', url: '/api/data/ERP_CustTable?filter.accountNum=C001', headers: auth() });
    expect(updated.json().data[0].name).toBe('Acme Co Updated');
  });

  it('reports failed rows without aborting the whole import (missing mandatory field)', async () => {
    const csv = 'accountNum,name\n,Missing Account Name\nC040,Zeta Co\n';
    const mapping = JSON.stringify({ accountNum: 'accountNum', name: 'name' });
    const { boundary, body } = buildMultipart(
      [
        { name: 'mapping', value: mapping },
        { name: 'mode', value: 'insert' },
      ],
      { name: 'file', filename: 'custs.csv', content: Buffer.from(csv), contentType: 'text/csv' },
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/data/ERP_CustTable/import/commit',
      headers: { ...auth(), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.inserted).toBe(1);
    expect(json.skipped).toBe(1);
    expect(json.failed).toHaveLength(1);
    expect(json.failed[0].row).toBe(2);
  });
});
