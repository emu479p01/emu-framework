import type { FastifyInstance, FastifyRequest } from 'fastify';
import ExcelJS from 'exceljs';
import { parse as parseCsvSync } from 'csv-parse/sync';
import { stringify as stringifyCsvSync } from 'csv-stringify/sync';
import type { DataContext, FieldValue, Kernel, TableMeta } from '@emu/core';

/** Rows beyond this are silently truncated on export — a safety cap, not an expected ceiling. */
const EXPORT_ROW_CAP = 50_000;

export interface ImportExportDeps {
  userCtx: (req: FastifyRequest) => DataContext;
  dataTable: (name: string, req?: FastifyRequest) => TableMeta;
  coerce: (tableName: string, field: string, value: string) => FieldValue;
  writableBody: (tableName: string, body: { [field: string]: FieldValue }) => { [field: string]: FieldValue };
}

/** Shared by the generic list route and export — builds a Query from filter.<field> and sort query params. */
export function buildFilteredQuery(
  ctx: DataContext,
  tableName: string,
  query: { [key: string]: string | undefined },
  coerce: ImportExportDeps['coerce'],
  searchableFields: string[] = [],
) {
  const q = ctx.select(tableName);
  for (const [key, value] of Object.entries(query)) {
    if (key.startsWith('filter.') && value !== undefined) {
      const field = key.slice('filter.'.length);
      q.where(field, '=', coerce(tableName, field, value));
    }
  }
  if (query.search) q.search(searchableFields, query.search);
  if (query.sort) {
    const [field, dir] = query.sort.split(':');
    q.orderBy(field, dir === 'desc' ? 'desc' : 'asc');
  }
  return q;
}

function formatExportCell(kernel: Kernel, table: TableMeta, fieldName: string, value: unknown): unknown {
  if (fieldName === 'id') return value;
  const field = table.fields.find((f) => f.name === fieldName);
  if (!field) return value;
  if (value === null || value === undefined) return '';
  if (field.type === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (field.type === 'enum' && field.enumName) {
    try {
      const en = kernel.registry.getEnum(field.enumName);
      const found = en.values.find((v) => v.value === Number(value));
      return found?.label ?? found?.name ?? value;
    } catch {
      return value;
    }
  }
  return value;
}

interface ParsedFile {
  columns: string[];
  rows: { [column: string]: unknown }[];
}

function normalizeCellValue(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if ('result' in v) return (v as { result: unknown }).result;
    if ('text' in v) return (v as { text: unknown }).text;
    if ('richText' in v) return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join('');
  }
  return v;
}

function parseCsvFile(buffer: Buffer): ParsedFile {
  const text = buffer.toString('utf8').replace(/^﻿/, '');
  if (!text.trim()) return { columns: [], rows: [] };
  const records = parseCsvSync(text, { columns: true, skip_empty_lines: true, trim: true }) as {
    [column: string]: string;
  }[];
  const columns = records.length > 0 ? Object.keys(records[0]) : [];
  return { columns, rows: records };
}

async function parseXlsxFile(buffer: Buffer): Promise<ParsedFile> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return { columns: [], rows: [] };
  const columns: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell) => {
    columns.push(String(cell.value ?? '').trim());
  });
  const rows: { [column: string]: unknown }[] = [];
  for (let i = 2; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    if (row.cellCount === 0) continue;
    const obj: { [column: string]: unknown } = {};
    columns.forEach((col, idx) => {
      obj[col] = normalizeCellValue(row.getCell(idx + 1).value);
    });
    if (Object.values(obj).every((v) => v === null || v === undefined || v === '')) continue;
    rows.push(obj);
  }
  return { columns, rows };
}

async function parseUploadedFile(filename: string, buffer: Buffer): Promise<ParsedFile> {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'xlsx' || ext === 'xls') return parseXlsxFile(buffer);
  return parseCsvFile(buffer);
}

/** Case-insensitive match of an uploaded column header against a table's fields (name or label). */
function suggestField(table: TableMeta, column: string): string | null {
  const norm = column.trim().toLowerCase();
  const byName = table.fields.find((f) => f.name.toLowerCase() === norm);
  if (byName) return byName.name;
  const byLabel = table.fields.find((f) => (f.label ?? '').toLowerCase() === norm);
  return byLabel ? byLabel.name : null;
}

function coerceImportValue(table: TableMeta, fieldName: string, raw: unknown): FieldValue {
  const field = table.fields.find((f) => f.name === fieldName);
  if (raw === undefined || raw === null || raw === '') return null;
  if (!field) return raw as FieldValue;
  switch (field.type) {
    case 'int':
    case 'real':
    case 'enum':
    case 'reference':
      return Number(raw);
    case 'boolean': {
      const s = String(raw).trim().toLowerCase();
      return s === 'true' || s === '1' || s === 'yes' ? 1 : 0;
    }
    default:
      return String(raw);
  }
}

export function registerImportExportRoutes(app: FastifyInstance, kernel: Kernel, deps: ImportExportDeps): void {
  const { userCtx, dataTable, coerce, writableBody } = deps;

  // ---- export ----

  app.get<{ Params: { table: string }; Querystring: { format?: string; sort?: string; [key: string]: string | undefined } }>(
    '/api/data/:table/export',
    async (req, reply) => {
      const table = dataTable(req.params.table, req);
      const ctx = userCtx(req);
      const q = buildFilteredQuery(ctx, table.name, req.query, coerce, table.fields.map((field) => field.name));
      q.limit(EXPORT_ROW_CAP);
      const rows = q.toArray().map((r) => r.toObject());
      const columns = ['id', ...table.fields.map((f) => f.name)];
      const headers = ['ID', ...table.fields.map((f) => f.label ?? f.name)];
      const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';

      if (format === 'xlsx') {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet(table.name);
        ws.addRow(headers);
        for (const row of rows) {
          ws.addRow(columns.map((c) => formatExportCell(kernel, table, c, row[c])));
        }
        const buffer = await wb.xlsx.writeBuffer();
        reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        reply.header('Content-Disposition', `attachment; filename="${table.name}.xlsx"`);
        return reply.send(Buffer.from(buffer));
      }

      const csv = stringifyCsvSync([headers, ...rows.map((row) => columns.map((c) => formatExportCell(kernel, table, c, row[c])))]);
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${table.name}.csv"`);
      return reply.send('﻿' + csv);
    },
  );

  // ---- import preview (no writes) ----

  app.post<{ Params: { table: string } }>('/api/data/:table/import/preview', async (req, reply) => {
    const table = dataTable(req.params.table, req);
    userCtx(req); // ensure authenticated; read-level access is enough to preview
    const file = await req.file();
    if (!file) return reply.status(400).send({ error: 'No file uploaded' });
    const buffer = await file.toBuffer();
    const parsed = await parseUploadedFile(file.filename, buffer);
    const suggestedMapping = parsed.columns.map((column) => ({ column, field: suggestField(table, column) }));
    return {
      columns: parsed.columns,
      suggestedMapping,
      rowCount: parsed.rows.length,
      sampleRows: parsed.rows.slice(0, 20),
    };
  });

  // ---- import commit ----

  app.post<{ Params: { table: string } }>('/api/data/:table/import/commit', async (req, reply) => {
    const table = dataTable(req.params.table, req);
    const ctx = userCtx(req);

    let fileBuffer: Buffer | null = null;
    let filename = '';
    let mapping: { [column: string]: string } = {};
    let mode: 'insert' | 'upsert' = 'insert';
    let keyField = '';

    for await (const part of req.parts()) {
      if (part.type === 'file') {
        filename = part.filename;
        fileBuffer = await part.toBuffer();
      } else if (part.fieldname === 'mapping') {
        try {
          mapping = JSON.parse(part.value as string);
        } catch {
          return reply.status(400).send({ error: 'mapping must be valid JSON' });
        }
      } else if (part.fieldname === 'mode') {
        mode = part.value === 'upsert' ? 'upsert' : 'insert';
      } else if (part.fieldname === 'keyField') {
        keyField = part.value as string;
      }
    }

    if (!fileBuffer) return reply.status(400).send({ error: 'No file uploaded' });
    if (mode === 'upsert' && !keyField) {
      return reply.status(400).send({ error: 'keyField is required for upsert mode' });
    }

    const parsed = await parseUploadedFile(filename, fileBuffer);
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const failed: { row: number; error: string }[] = [];

    parsed.rows.forEach((row, idx) => {
      try {
        const mapped: { [field: string]: FieldValue } = {};
        for (const [column, field] of Object.entries(mapping)) {
          if (!field) continue;
          mapped[field] = coerceImportValue(table, field, row[column]);
        }
        const writable = writableBody(table.name, mapped);

        if (mode === 'upsert') {
          const keyValue = mapped[keyField];
          const existing =
            keyValue !== undefined && keyValue !== null
              ? ctx.select(table.name).whereEq({ [keyField]: keyValue }).firstOnly()
              : null;
          if (existing) {
            existing.setMany(writable).update();
            updated++;
          } else {
            ctx.newRecord(table.name).setMany(writable).insert();
            inserted++;
          }
        } else {
          ctx.newRecord(table.name).setMany(writable).insert();
          inserted++;
        }
      } catch (e) {
        skipped++;
        // +2: header row is row 1, data rows are 1-indexed after it
        failed.push({ row: idx + 2, error: e instanceof Error ? e.message : String(e) });
      }
    });

    return { inserted, updated, skipped, failed };
  });
}
