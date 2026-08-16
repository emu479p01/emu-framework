import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AnyMeta, Kernel } from '@emu/core';
import pdfMake from 'pdfmake';
import { buildServer } from '../src/server.js';
import { buildDocDefinition, formatReportFieldValue, planReportPages, reportFontForText, reportTextRuns } from '../src/reports.js';
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

function docBodyNodes(doc: any): any[] {
  return doc.content.flatMap((page: any) => page.section?.stack ?? [page]);
}

function docHeaderNodes(doc: any): any[] {
  return doc.content.flatMap((_page: any, index: number) => doc.header(index + 1, doc.content.length).stack);
}

function docFooterNodes(doc: any): any[] {
  return doc.content.flatMap((_page: any, index: number) => doc.footer(index + 1, doc.content.length).stack);
}

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
    expect(docBodyNodes(doc).map((item: any) => item.text).filter(Boolean)).toContain('Bomb');
    expect(docBodyNodes(doc).map((item: any) => item.text).filter(Boolean)).toContain('HO');
    const thaiDoc = buildDocDefinition(kernel, ctx, custListReport as any, [{ accountNum: 'TH001', name: 'โฟมล้างหน้า' }]) as any;
    expect(docBodyNodes(thaiDoc).find((item: any) => item.text === 'โฟมล้างหน้า')?.font).toBe(THAI_REPORT_FONT);
    expect(reportFontForText('โฟมล้างหน้า', 'Roboto', new Set(['Roboto', THAI_REPORT_FONT]))).toBe(THAI_REPORT_FONT);
    expect(reportFontForText('Thai ไทย mixed', 'Roboto', new Set(['Roboto', THAI_REPORT_FONT]))).toBe(THAI_REPORT_FONT);
    expect(reportFontForText('English only', 'Roboto', new Set(['Roboto', THAI_REPORT_FONT]))).toBe('Roboto');
    expect(reportTextRuns('Thai ไทย mixed', 'Roboto', 'Roboto', new Set(['Roboto', THAI_REPORT_FONT]))).toEqual([
      { text: 'Thai ', font: 'Roboto' }, { text: 'ไทย', font: THAI_REPORT_FONT }, { text: ' mixed', font: 'Roboto' },
    ]);
  });

  it('builds pre-paginated tablix groups with styles and formats', () => {
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
    const tables = docBodyNodes(doc).filter((item: any) => item.table);
    expect(tables[0].table).toMatchObject({ headerRows: 1, dontBreakRows: true });
    expect(tables[0].table.body).toHaveLength(2);
    expect(tables[0].table.body[0][0]).toMatchObject({ text: 'Account', bold: true, fillColor: '#dddddd' });
    expect(tables[0].table.body[1][0].text).toBe('C1');
    const everyHeaders = docHeaderNodes(doc).filter((item: any) => item.text === 'Every');
    const lastFooters = docFooterNodes(doc).filter((item: any) => item.text === 'Last');
    expect(everyHeaders).toHaveLength(planReportPages(kernel, ctx, report, rows).length);
    expect(lastFooters).toHaveLength(1);
    expect(lastFooters[0].absolutePosition.y).toBe(0);
  });

  it('fits 20 atomic 11pt rows into 100pt body pages as 9, 9 and 2', async () => {
    const ctx = kernel.context();
    const report = {
      ...custListReport,
      page: { size: 'A4', orientation: 'portrait', margins: [371, 40, 371, 40] },
      bands: [{ kind: 'detail', height: 11, elements: [] }],
    } as any;
    const rows = Array.from({ length: 20 }, (_, index) => ({ id: index + 1, accountNum: `P${index + 1}` }));
    const pages = planReportPages(kernel, ctx, report, rows);
    expect(pages.map((page) => page.units.length)).toEqual([9, 9, 2]);
    expect(pages.map((page) => page.usedHeight)).toEqual([99, 99, 22]);
    const doc = buildDocDefinition(kernel, ctx, report, rows);
    const buffer = await pdfMake.createPdf(doc as any).getBuffer();
    expect(buffer.toString('latin1').match(/\/Type\s*\/Page\b/g)).toHaveLength(3);
  });

  it('reserves first/last page bands only on pages where they display', () => {
    const ctx = kernel.context();
    const report = {
      ...custListReport,
      page: { size: 'A4', margins: [371, 40, 371, 40] },
      bands: [
        { kind: 'header', displayOn: 'firstPage', height: 10, elements: [] },
        { kind: 'detail', height: 10, elements: [] },
        { kind: 'footer', displayOn: 'lastPage', height: 10, elements: [] },
      ],
    } as any;
    const rows = Array.from({ length: 10 }, (_, index) => ({ id: index + 1 }));
    const pages = planReportPages(kernel, ctx, report, rows);
    expect(pages).toHaveLength(2);
    expect(pages.map(({ headerHeight, footerHeight, bodyHeight }) => ({ headerHeight, footerHeight, bodyHeight }))).toEqual([
      { headerHeight: 10, footerHeight: 0, bodyHeight: 90 },
      { headerHeight: 0, footerHeight: 10, bodyHeight: 90 },
    ]);
    expect(pages.map((page) => page.units.length)).toEqual([9, 1]);
  });

  it('supports legacy every-page bands and compacts multiple visible footers', () => {
    const ctx = kernel.context();
    const report = {
      ...custListReport,
      page: { size: 'A4', margins: [371, 40, 371, 40] },
      bands: [
        { kind: 'detail', height: 10, elements: [] },
        { kind: 'footer', displayOn: 'firstPage', height: 5, elements: [{ id: 'first', type: 'text', x: 0, y: 0, width: 100, height: 5, text: 'First footer' }] },
        { kind: 'pageFooter', height: 10, elements: [{ id: 'legacy', type: 'text', x: 0, y: 0, width: 100, height: 10, text: 'Legacy footer' }] },
        { kind: 'footer', displayOn: 'lastPage', height: 20, elements: [{ id: 'last', type: 'text', x: 0, y: 0, width: 100, height: 20, text: 'Last footer' }] },
      ],
    } as any;
    const rows = Array.from({ length: 10 }, (_, index) => ({ id: index + 1 }));
    const pages = planReportPages(kernel, ctx, report, rows);
    expect(pages.map((page) => page.footerHeight)).toEqual([15, 30]);
    expect(pages.map((page) => page.units.length)).toEqual([8, 2]);
    const doc = buildDocDefinition(kernel, ctx, report, rows) as any;
    const legacy = docFooterNodes(doc).filter((item: any) => item.text === 'Legacy footer');
    const last = docFooterNodes(doc).find((item: any) => item.text === 'Last footer');
    expect(legacy).toHaveLength(2);
    expect(legacy[1].absolutePosition.y).toBe(0);
    expect(last.absolutePosition.y).toBe(10);
  });

  it('regresses the ATOMY sales-order geometry at the 18/19 line boundary', async () => {
    const ctx = kernel.context();
    const item = ctx.newRecord('ERP_InventItem').setMany({ itemId: 'ATOMY-GEOMETRY', itemName: 'Geometry item', salesPrice: 100, onHand: 100 });
    item.insert();
    const sales = ctx.newRecord('ERP_SalesTable').setMany({ salesId: 'ATOMY-GEOMETRY-SO', custId: customerId, orderDate: '2026-08-16' });
    sales.insert();
    const addLine = (qty: number) => ctx.newRecord('ERP_SalesLine').setMany({ salesId: sales.id, itemId: item.id, qty, salesPrice: 100 }).insert();
    for (let qty = 1; qty <= 18; qty++) addLine(qty);
    const report = {
      kind: 'report', name: 'ATOMY_SalesOrderReport_Geometry', dataSource: 'ERP_SalesTable',
      page: { size: 'A4', orientation: 'portrait', margins: [30, 30, 30, 30] },
      bands: [
        { kind: 'header', displayOn: 'everyPage', height: 224, elements: [] },
        { kind: 'footer', displayOn: 'lastPage', height: 150, elements: [{ id: 'gross', type: 'text', x: 362, y: 14, width: 100, height: 14, text: 'Gross Total' }] },
      ],
      lineSources: [{ table: 'ERP_SalesLine', refField: 'salesId', bands: [{ kind: 'detail', layout: 'freeform', height: 22, elements: [] }] }],
    } as any;
    expect(planReportPages(kernel, ctx, report, [sales.toObject()]).map((page) => page.units.length)).toEqual([18]);
    addLine(19);
    const pages = planReportPages(kernel, ctx, report, [sales.toObject()]);
    expect(pages.map((page) => ({ bodyHeight: page.bodyHeight, rows: page.units.length }))).toEqual([
      { bodyHeight: 558, rows: 18 },
      { bodyHeight: 408, rows: 1 },
    ]);
    const doc = buildDocDefinition(kernel, ctx, report, [sales.toObject()]) as any;
    expect(docFooterNodes(doc).find((itemNode: any) => itemNode.text === 'Gross Total').absolutePosition).toEqual({ x: 392, y: 14 });
    const buffer = await pdfMake.createPdf(doc).getBuffer();
    expect(buffer.toString('latin1').match(/\/Type\s*\/Page\b/g)).toHaveLength(2);
  });

  it.each([
    ['A4', 'portrait', 842], ['A4', 'landscape', 595], ['Letter', 'portrait', 792], ['Letter', 'landscape', 612],
  ] as const)('calculates %s %s body height from the physical page', (size, orientation, pageHeight) => {
    const ctx = kernel.context();
    const report = {
      ...custListReport,
      page: { size, orientation, margins: [30, 40, 50, 40] },
      bands: [
        { kind: 'header', displayOn: 'everyPage', height: 10, elements: [] },
        { kind: 'detail', height: 10, elements: [] },
        { kind: 'footer', displayOn: 'everyPage', height: 20, elements: [] },
      ],
    } as any;
    expect(planReportPages(kernel, ctx, report, [{ id: 1 }])[0].bodyHeight).toBe(pageHeight - 30 - 50 - 10 - 20);
  });

  it('renders main details followed by each parent line source before the next main row', () => {
    const ctx = kernel.context();
    const item = ctx.newRecord('ERP_InventItem').setMany({ itemId: 'ORDER-ITEM', itemName: 'Order item', salesPrice: 1, onHand: 100 });
    item.insert();
    const first = ctx.newRecord('ERP_SalesTable').setMany({ salesId: 'ORDER-A', custId: customerId, orderDate: '2026-08-15' });
    first.insert();
    const second = ctx.newRecord('ERP_SalesTable').setMany({ salesId: 'ORDER-B', custId: customerId, orderDate: '2026-08-15' });
    second.insert();
    ctx.newRecord('ERP_SalesLine').setMany({ salesId: first.id, itemId: item.id, qty: 11, salesPrice: 1 }).insert();
    ctx.newRecord('ERP_SalesLine').setMany({ salesId: second.id, itemId: item.id, qty: 22, salesPrice: 1 }).insert();
    const report = {
      kind: 'report', name: 'ERP_MasterDetailOrder', dataSource: 'ERP_SalesTable',
      bands: [{ kind: 'detail', height: 20, elements: [{ id: 'sales', type: 'field', x: 0, y: 0, width: 100, height: 20, field: 'salesId' }] }],
      lineSources: [{ table: 'ERP_SalesLine', refField: 'salesId', bands: [{ kind: 'detail', height: 20, elements: [{ id: 'qty', type: 'field', x: 0, y: 0, width: 100, height: 20, field: 'qty' }] }] }],
    } as any;
    const doc = buildDocDefinition(kernel, ctx, report, [first.toObject(), second.toObject()]) as any;
    expect(docBodyNodes(doc).map((item: any) => item.text).filter((text: unknown) => ['ORDER-A', '11', 'ORDER-B', '22'].includes(String(text)))).toEqual(['ORDER-A', '11', 'ORDER-B', '22']);
  });

  it('uses tablix headerHeight and rowHeight and repeats the header after a page break', async () => {
    const ctx = kernel.context();
    const item = ctx.newRecord('ERP_InventItem').setMany({ itemId: 'PAGE-ITEM', itemName: 'Page item', salesPrice: 1, onHand: 100 });
    item.insert();
    const sales = ctx.newRecord('ERP_SalesTable').setMany({ salesId: 'PAGE-SO', custId: customerId, orderDate: '2026-08-15' });
    sales.insert();
    for (let qty = 1; qty <= 5; qty++) ctx.newRecord('ERP_SalesLine').setMany({ salesId: sales.id, itemId: item.id, qty, salesPrice: 1 }).insert();
    const report = {
      kind: 'report', name: 'ERP_TablixPagination', dataSource: 'ERP_SalesTable', page: { size: 'A4', margins: [311, 40, 311, 40] }, bands: [],
      lineSources: [{ table: 'ERP_SalesLine', refField: 'salesId', bands: [{ kind: 'detail', layout: 'tablix', height: 99, elements: [], tablix: {
        headerHeight: 20, rowHeight: 60, columns: [{ field: 'qty' }], headerStyle: { padding: 0 }, rowStyle: { padding: 0 },
      } }] }],
    } as any;
    const pages = planReportPages(kernel, ctx, report, [sales.toObject()]);
    expect(pages.map((page) => page.units.length)).toEqual([3, 2]);
    expect(pages.map((page) => page.usedHeight)).toEqual([200, 140]);
    const doc = buildDocDefinition(kernel, ctx, report, [sales.toObject()]) as any;
    expect(docBodyNodes(doc).filter((item: any) => item.table)).toHaveLength(2);
    const buffer = await pdfMake.createPdf(doc).getBuffer();
    expect(buffer.toString('latin1').match(/\/Type\s*\/Page\b/g)).toHaveLength(2);
  });

  it('rejects a body row that cannot fit in its printable page area', () => {
    const ctx = kernel.context();
    const report = {
      ...custListReport,
      page: { size: 'A4', margins: [371, 40, 371, 40] },
      bands: [{ kind: 'detail', height: 101, elements: [] }],
    } as any;
    expect(() => planReportPages(kernel, ctx, report, [{ id: 1 }])).toThrow(/requires 101pt, available 100pt/);
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
    const lineTable = docBodyNodes(doc).find((itemNode: any) => itemNode.table);
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
