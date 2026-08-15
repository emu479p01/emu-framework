import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AnyMeta, Kernel } from '@emu/core';
import { buildServer } from '../src/server.js';
import { buildDocDefinition, formatReportFieldValue, reportFontForText, reportTextRuns } from '../src/reports.js';
import { THAI_REPORT_FONT } from '../src/fontManager.js';
import { applyErpSample } from './fixtures/erpSample.js';
import { completeTestSetup, TEST_SETUP_CODE } from './setupHelper.js';

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
    app = buildServer({ setupCode: TEST_SETUP_CODE });
    await app.ready();
    await completeTestSetup(app);
    kernel = (app as unknown as { kernel: Kernel }).kernel;
    applyErpSample(kernel);
    const errors = kernel.applyWebArtifacts([...loadArtifacts(kernel), custListReport]);
    expect(errors).toEqual([]);
    const dctx = kernel.designerContext();
    dctx.newRecord('FW_WebArtifact').setMany({ kind: 'report', name: custListReport.name, json: JSON.stringify(custListReport) }).insert();

    const res = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: 'Admin-password-123' } });
    cookie = res.headers['set-cookie'] as string;

    const customer = await app.inject({
      method: 'POST',
      url: '/api/data/ERP_CustTable',
      headers: auth(),
      payload: { accountNum: 'C001', name: 'Acme Co' },
    });
    customerId = customer.json().id as number;
    const thaiCustomer = await app.inject({
      method: 'POST',
      url: '/api/data/ERP_CustTable',
      headers: auth(),
      payload: { accountNum: 'TH001', name: 'บริษัท ทดสอบ จำกัด' },
    });
    expect(thaiCustomer.statusCode).toBe(201);
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
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('formats reference fields using the referenced table title field', () => {
    const table = kernel.registry.getTable('ERP_SalesTable');
    const ctx = kernel.context();
    expect(formatReportFieldValue(kernel, ctx, table, { custId: customerId }, 'custId')).toBe('Acme Co');
    expect(formatReportFieldValue(kernel, ctx, table, { custId: 999_999 }, 'custId')).toBe('999999');
  });

  it('preserves copied ASCII and Unicode strings in the PDF document definition', () => {
    const table = kernel.registry.getTable('ERP_CustTable');
    const ctx = kernel.context();
    expect(formatReportFieldValue(kernel, ctx, table, { name: 'Bomb' }, 'name')).toBe('Bomb');
    expect(formatReportFieldValue(kernel, ctx, table, { name: 'ทดสอบ café' }, 'name')).toBe('ทดสอบ café');
    const doc = buildDocDefinition(kernel, ctx, { ...custListReport, defaultFont: 'Missing Font' } as any, [{ accountNum: 'HO', name: 'Bomb' }]) as any;
    expect(doc.defaultStyle.font).toBe('Roboto');
    expect(doc.content.map((item: any) => item.text).filter(Boolean)).toContain('Bomb');
    expect(doc.content.map((item: any) => item.text).filter(Boolean)).toContain('HO');
    const thaiDoc = buildDocDefinition(kernel, ctx, custListReport as any, [{ accountNum: 'TH001', name: 'โฟมล้างหน้า' }]) as any;
    expect(thaiDoc.content.find((item: any) => item.text === 'โฟมล้างหน้า')?.font).toBe(THAI_REPORT_FONT);
    expect(reportFontForText('โฟมล้างหน้า', 'Roboto', new Set(['Roboto', THAI_REPORT_FONT]))).toBe(THAI_REPORT_FONT);
    expect(reportFontForText('Thai ไทย mixed', 'Roboto', new Set(['Roboto', THAI_REPORT_FONT]))).toBe(THAI_REPORT_FONT);
    expect(reportFontForText('English only', 'Roboto', new Set(['Roboto', THAI_REPORT_FONT]))).toBe('Roboto');
    expect(reportTextRuns('Thai ไทย mixed', 'Roboto', 'Roboto', new Set(['Roboto', THAI_REPORT_FONT]))).toEqual([
      { text: 'Thai ', font: 'Roboto' }, { text: 'ไทย', font: THAI_REPORT_FONT }, { text: ' mixed', font: 'Roboto' },
    ]);
  });

  it('builds a paginating tablix with repeated headers, styles and formats', () => {
    const ctx = kernel.context();
    const report = {
      ...custListReport,
      bands: [
        { kind: 'header', displayOn: 'everyPage', height: 24, elements: [{ id: 'h', type: 'text', x: 0, y: 0, width: 100, height: 16, text: 'Every' }] },
        { kind: 'detail', layout: 'tablix', height: 18, elements: [], tablix: {
          columns: [{ field: 'accountNum', label: 'Account', width: 100 }, { field: 'name', label: 'Customer', width: 180 }],
          headerStyle: { bold: true, backgroundColor: '#dddddd', padding: 3 }, rowStyle: { padding: 2 }, border: { width: 1, color: '#333333' },
        } },
        { kind: 'footer', displayOn: 'lastPage', height: 20, elements: [{ id: 'f', type: 'text', x: 0, y: 0, width: 100, height: 16, text: 'Last' }] },
      ],
    } as any;
    const rows = Array.from({ length: 60 }, (_, index) => ({ accountNum: `C${index + 1}`, name: index === 0 ? 'ลูกค้าไทย' : `Customer ${index + 1}` }));
    const doc = buildDocDefinition(kernel, ctx, report, rows) as any;
    expect(doc.content[0].table.headerRows).toBe(1);
    expect(doc.content[0].table.body).toHaveLength(61);
    expect(doc.content[0].table.body[0][0]).toMatchObject({ text: 'Account', bold: true, fillColor: '#dddddd' });
    expect(doc.content[0].table.body[1][0].text).toBe('C1');
    expect(doc.header(1, 2).stack[0].text).toBe('Every');
    expect(doc.header(2, 2).stack[0].text).toBe('Every');
    expect(doc.footer(1, 2).stack).toHaveLength(0);
    expect(doc.footer(2, 2).stack[0].text).toBe('Last');
  });

  it('formats supported report number and date tokens', () => {
    const table = kernel.registry.getTable('ERP_SalesTable');
    const ctx = kernel.context();
    expect(formatReportFieldValue(kernel, ctx, table, { totalAmount: 1234.5 }, 'totalAmount', '#,##0.00')).toBe('1,234.50');
    expect(formatReportFieldValue(kernel, ctx, table, { orderDate: '2026-08-15T13:45:00Z' }, 'orderDate', 'dd/MM/yyyy HH:mm')).toBe('15/08/2026 13:45');
  });

  it('renders a line-source detail as a tablix for each parent record', () => {
    const ctx = kernel.context();
    const item = ctx.newRecord('ERP_InventItem').setMany({ itemId: 'REPORT-ITEM', itemName: 'Report item', salesPrice: 12, onHand: 10 });
    item.insert();
    const sales = ctx.newRecord('ERP_SalesTable').setMany({ salesId: 'REPORT-SO', custId: customerId, orderDate: '2026-08-15' });
    sales.insert();
    ctx.newRecord('ERP_SalesLine').setMany({ salesId: sales.id, itemId: item.id, qty: 2, salesPrice: 12 }).insert();
    const report = {
      kind: 'report', name: 'ERP_SalesLineTablix', dataSource: 'ERP_SalesTable', bands: [],
      lineSources: [{ table: 'ERP_SalesLine', refField: 'salesId', bands: [{ kind: 'detail', layout: 'tablix', height: 18, elements: [], tablix: { columns: [{ field: 'qty', format: '#,##0.00' }, { field: 'salesPrice', format: '#,##0.00' }] } }] }],
    } as any;
    const doc = buildDocDefinition(kernel, ctx, report, [sales.toObject()]) as any;
    const lineTable = doc.content.find((itemNode: any) => itemNode.table);
    expect(lineTable.table.headerRows).toBe(1);
    expect(lineTable.table.body).toHaveLength(2);
    expect(lineTable.table.body[1][0].text).toBe('2.00');
  });

  it('masks the stored Google Fonts API key and lists the offline default font', async () => {
    const saved = await app.inject({ method: 'PUT', url: '/api/system/fonts/settings', headers: auth(), payload: { apiKey: 'example-secret-1234' } });
    expect(saved.statusCode).toBe(200);
    const settings = await app.inject({ method: 'GET', url: '/api/system/fonts/settings', headers: auth() });
    expect(settings.json()).toEqual({ configured: true, maskedKey: '••••1234' });
    expect(settings.body).not.toContain('example-secret');
    const fonts = await app.inject({ method: 'GET', url: '/api/fonts', headers: auth() });
    expect(fonts.json().fonts).toContainEqual({ family: 'Roboto', builtIn: true });
    expect(fonts.json().fonts).toContainEqual(expect.objectContaining({ family: THAI_REPORT_FONT, builtIn: true, subsets: ['latin', 'thai'] }));
    const thaiFont = await app.inject({ method: 'GET', url: `/api/fonts/${encodeURIComponent(THAI_REPORT_FONT)}/regular`, headers: auth() });
    expect(thaiFont.statusCode).toBe(200);
    expect(thaiFont.headers['content-type']).toContain('font/ttf');
    expect(thaiFont.rawPayload.length).toBeGreaterThan(30_000);
  });

  it('rejects unauthenticated report requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/report/ERP_CustListReport/pdf' });
    expect(res.statusCode).toBe(401);
  });

  it('accepts declared parameters and rejects undeclared parameters', async () => {
    const ok = await app.inject({ method: 'GET', url: '/api/report/ERP_CustListReport/pdf?param.accountNum.eq=C001', headers: auth() });
    expect(ok.statusCode, ok.body).toBe(200);
    const bad = await app.inject({ method: 'GET', url: '/api/report/ERP_CustListReport/pdf?param.name.eq=Acme', headers: auth() });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/not declared/);
  });

  it('404s for an unknown report name', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/report/ERP_NoSuchReport/pdf', headers: auth() });
    expect(res.statusCode).toBe(404);
  });
});
