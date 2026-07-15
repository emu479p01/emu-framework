import type { FastifyInstance, FastifyRequest } from 'fastify';
import pdfMake from 'pdfmake';
import type { DataContext, Kernel, ReportBandMeta, ReportElementMeta, ReportMeta, TableMeta } from '@emu/core';
import { buildFilteredQuery } from './importExport.js';
import { DEFAULT_REPORT_FONT, THAI_REPORT_FONT, registerPdfFonts } from './fontManager.js';

// Fonts/images referenced in a report are always server-authored (never taken from request
// input), so it's safe to allow local-file resolution; remote URLs stay disabled.
pdfMake.setLocalAccessPolicy(() => true);
pdfMake.setUrlAccessPolicy(() => false);

export interface ReportRouteDeps {
  userCtx: (req: FastifyRequest) => DataContext;
  coerce: (tableName: string, field: string, value: string) => string | number | boolean | null;
}

type ReportRow = { [field: string]: unknown };
const THAI_TEXT = /[\u0E00-\u0E7F]/;

export function reportFontForText(text: string, requestedFont: string | undefined, availableFonts: Set<string>): string | undefined {
  if (THAI_TEXT.test(text)) return THAI_REPORT_FONT;
  return requestedFont && availableFonts.has(requestedFont) ? requestedFont : undefined;
}

export function formatReportFieldValue(kernel: Kernel, ctx: DataContext, table: TableMeta, row: ReportRow | null, fieldName: string): string {
  if (!row) return '';
  const value = row[fieldName];
  if (value === null || value === undefined) return '';
  const field = table.fields.find((f) => f.name === fieldName);
  if (!field) return String(value);
  if (field.type === 'boolean') return value ? 'Yes' : 'No';
  if (field.type === 'enum' && field.enumName) {
    try {
      const en = kernel.registry.getEnum(field.enumName);
      const found = en.values.find((v) => v.value === Number(value));
      return found?.label ?? found?.name ?? String(value);
    } catch {
      return String(value);
    }
  }
  if (field.type === 'reference' && field.reference) {
    const referencedId = Number(value);
    if (!Number.isFinite(referencedId)) return String(value);
    const referencedTable = kernel.registry.getTable(field.reference.table);
    const referencedRecord = ctx.find(referencedTable.name, referencedId);
    if (!referencedRecord) return String(value);
    const referencedRow = referencedRecord.toObject();
    const displayFields = field.reference.displayFields
      ?? [field.reference.displayField ?? referencedTable.titleField ?? 'id'];
    return displayFields.map((displayField) => String(referencedRow[displayField] ?? '')).join(' | ');
  }
  return String(value);
}

function renderElement(
  kernel: Kernel,
  ctx: DataContext,
  table: TableMeta,
  el: ReportElementMeta,
  row: ReportRow | null,
  originX: number,
  originY: number,
  availableFonts: Set<string>,
): unknown {
  const x = originX + el.x;
  const y = originY + el.y;
  const style = el.style ?? {};

  if (el.type === 'line') {
    return {
      canvas: [{ type: 'line', x1: 0, y1: 0, x2: el.width, y2: el.height, lineWidth: style.borderWidth ?? 1 }],
      absolutePosition: { x, y },
    };
  }
  if (el.type === 'rect' || el.type === 'image') {
    // Image binding is not yet supported by the designer — render a placeholder box.
    return {
      canvas: [{ type: 'rect', x: 0, y: 0, w: el.width, h: el.height, lineWidth: style.borderWidth ?? 1 }],
      absolutePosition: { x, y },
    };
  }

  const text = el.type === 'field' && el.field ? formatReportFieldValue(kernel, ctx, table, row, el.field) : (el.text ?? '');
  return {
    text,
    absolutePosition: { x, y },
    width: el.width,
    fontSize: style.fontSize ?? 10,
    bold: style.bold,
    italics: style.italic,
    alignment: style.align,
    color: style.color,
    font: reportFontForText(text, style.fontFamily, availableFonts),
  };
}

/** Builds a pdfmake docDefinition by walking the report's bands top-to-bottom, tracking a running Y cursor. */
export function buildDocDefinition(kernel: Kernel, ctx: DataContext, report: ReportMeta, mainRows: ReportRow[]): Record<string, unknown> {
  const availableFonts = registerPdfFonts(kernel);
  const table = kernel.registry.getTable(report.dataSource);
  const margins = report.page?.margins ?? [40, 40, 40, 40];
  const [marginTop, , , marginLeft] = margins;
  const content: unknown[] = [];
  let cursorY = marginTop;

  const renderBand = (band: ReportBandMeta, row: ReportRow | null, bandTable: TableMeta) => {
    for (const el of band.elements) {
      content.push(renderElement(kernel, ctx, bandTable, el, row, marginLeft, cursorY, availableFonts));
    }
    cursorY += band.height;
  };

  for (const band of report.bands.filter((b) => b.kind === 'pageHeader' || b.kind === 'header')) {
    renderBand(band, mainRows[0] ?? null, table);
  }

  for (const mainRow of mainRows) {
    for (const band of report.bands.filter((b) => b.kind === 'detail')) {
      renderBand(band, mainRow, table);
    }
    for (const line of report.lineSources ?? []) {
      const lineTable = kernel.registry.getTable(line.table);
      const childRows = ctx
        .select(line.table)
        .whereEq({ [line.refField]: mainRow.id as number })
        .toArray()
        .map((r) => r.toObject());
      for (const child of childRows) {
        for (const band of line.bands) renderBand(band, child, lineTable);
      }
    }
  }

  for (const band of report.bands.filter((b) => b.kind === 'footer' || b.kind === 'pageFooter')) {
    renderBand(band, mainRows[mainRows.length - 1] ?? null, table);
  }

  return {
    pageSize: report.page?.size ?? 'A4',
    pageOrientation: report.page?.orientation ?? 'portrait',
    pageMargins: margins,
    defaultStyle: { font: report.defaultFont && availableFonts.has(report.defaultFont) ? report.defaultFont : DEFAULT_REPORT_FONT, fontSize: 10 },
    content,
  };
}

export function registerReportRoutes(app: FastifyInstance, kernel: Kernel, deps: ReportRouteDeps): void {
  const { userCtx, coerce } = deps;

  app.get<{ Params: { name: string }; Querystring: { id?: string; sort?: string; [key: string]: string | undefined } }>(
    '/api/report/:name/pdf',
    async (req, reply) => {
      const report = kernel.registry.getReport(req.params.name);
      const ctx = userCtx(req);
      if (!ctx.policy.canReport(report.name)) throw Object.assign(new Error(`Access denied: report '${report.name}'`), { statusCode: 403 });

      const declared = new Map((report.parameters ?? []).map((p) => [`param.${p.field}.${p.operator ?? 'eq'}`, p]));
      for (const key of Object.keys(req.query)) {
        if (key.startsWith('param.') && !declared.has(key)) return reply.status(400).send({ error: `Report parameter '${key}' is not declared` });
      }
      const filters: { [key: string]: string | undefined } = {};
      for (const [key, parameter] of declared) {
        const value = req.query[key];
        if (parameter.required && (value === undefined || value === '')) return reply.status(400).send({ error: `Report parameter '${parameter.label ?? parameter.field}' is required` });
        if (value !== undefined && value !== '') {
          const op = parameter.operator === 'from' ? 'gte' : parameter.operator === 'to' ? 'lte' : 'eq';
          filters[`filter.${parameter.field}.${op}`] = value;
        }
      }

      let mainRows: ReportRow[];
      if (req.query.id) {
        const rec = ctx.find(report.dataSource, Number(req.query.id));
        if (!rec) return reply.status(404).send({ error: 'Not found' });
        mainRows = [rec.toObject()];
      } else {
        const q = buildFilteredQuery(ctx, report.dataSource, { ...filters, sort: req.query.sort }, coerce);
        q.limit(1000);
        mainRows = q.toArray().map((r) => r.toObject());
      }

      const docDefinition = buildDocDefinition(kernel, ctx, report, mainRows);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- our dynamic content tree isn't worth typing against pdfmake's Content union
      const buffer = await pdfMake.createPdf(docDefinition as any).getBuffer();

      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `inline; filename="${report.name}.pdf"`);
      return reply.send(buffer);
    },
  );
}
