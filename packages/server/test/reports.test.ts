import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AnyMeta, Kernel } from '@emu/core';
import { buildServer } from '../src/server.js';
import { formatReportFieldValue } from '../src/reports.js';
import { applyErpSample } from './fixtures/erpSample.js';

const custListReport: AnyMeta = {
  kind: 'report',
  name: 'ERP_CustListReport',
  app: 'erp',
  model: 'MiniERPApplication',
  label: 'Customer list',
  dataSource: 'ERP_CustTable',
  parameters: [{ field: 'accountNum', operator: 'eq', label: 'Account' }],
  bands: [
    {
      kind: 'header',
      height: 30,
      elements: [{ id: 'title', type: 'text', x: 0, y: 0, width: 300, height: 20, text: 'Customer list', style: { fontSize: 16, bold: true } }],
    },
    {
      kind: 'detail',
      height: 16,
      elements: [
        { id: 'account', type: 'field', x: 0, y: 0, width: 100, height: 16, field: 'accountNum' },
        { id: 'name', type: 'field', x: 100, y: 0, width: 200, height: 16, field: 'name' },
      ],
    },
  ],
} as any;

describe('report PDF rendering', () => {
  let app: FastifyInstance;
  let cookie: string;
  let kernel: Kernel;
  let customerId: number;

  beforeAll(async () => {
    app = buildServer();
    await app.ready();
    kernel = (app as unknown as { kernel: Kernel }).kernel;
    applyErpSample(kernel);
    const errors = kernel.applyWebArtifacts([...loadArtifacts(kernel), custListReport]);
    expect(errors).toEqual([]);
    const dctx = kernel.designerContext();
    dctx.newRecord('FW_WebArtifact').setMany({ kind: 'report', name: custListReport.name, json: JSON.stringify(custListReport) }).insert();

    const res = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: 'admin' } });
    cookie = res.headers['set-cookie'] as string;

    const customer = await app.inject({
      method: 'POST',
      url: '/api/data/ERP_CustTable',
      headers: auth(),
      payload: { accountNum: 'C001', name: 'Acme Co' },
    });
    customerId = customer.json().id as number;
  });

  function loadArtifacts(kernel: Kernel): AnyMeta[] {
    return kernel
      .designerContext()
      .select('FW_WebArtifact')
      .toArray()
      .map((r) => JSON.parse(r.f.json as string) as AnyMeta);
  }

  function auth() {
    return { cookie: cookie.split(';')[0] };
  }

  it('renders a list-style report to a valid PDF', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/report/ERP_CustListReport/pdf', headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('formats reference fields using the referenced table title field', () => {
    const table = kernel.registry.getTable('ERP_SalesTable');
    const ctx = kernel.context();
    expect(formatReportFieldValue(kernel, ctx, table, { custId: customerId }, 'custId')).toBe('Acme Co');
    expect(formatReportFieldValue(kernel, ctx, table, { custId: 999_999 }, 'custId')).toBe('999999');
  });

  it('rejects unauthenticated report requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/report/ERP_CustListReport/pdf' });
    expect(res.statusCode).toBe(401);
  });

  it('accepts declared parameters and rejects undeclared parameters', async () => {
    const ok = await app.inject({ method: 'GET', url: '/api/report/ERP_CustListReport/pdf?param.accountNum.eq=C001', headers: auth() });
    expect(ok.statusCode).toBe(200);
    const bad = await app.inject({ method: 'GET', url: '/api/report/ERP_CustListReport/pdf?param.name.eq=Acme', headers: auth() });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/not declared/);
  });

  it('404s for an unknown report name', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/report/ERP_NoSuchReport/pdf', headers: auth() });
    expect(res.statusCode).toBe(404);
  });
});
