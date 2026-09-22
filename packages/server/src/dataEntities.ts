import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import ExcelJS from 'exceljs';
import { parse as parseCsv } from 'csv-parse/sync';
import { stringify as stringifyCsv } from 'csv-stringify/sync';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import type { DataContext, DataEntityMeta, FieldValue, Kernel, TableMeta } from '@emu/core';
import { SecurityError, ValidationError } from '@emu/core';

const ENTITY_FORMAT = 'emuframework-data-entity';
const MAX_IMPORT_BYTES = 256 * 1024 * 1024;
type ObjectRow = Record<string, unknown>;
interface StagedEntity { entity: string; root: ObjectRow[]; lines: Record<string, ObjectRow[]> }

function jobsPath(): string { return process.env.EMU_DATA_JOB_PATH ?? join(dirname(process.env.EMU_DB_PATH ?? './data.db'), 'data-jobs'); }
function table(kernel: Kernel, name: string): TableMeta { return kernel.registry.getTable(name); }
function fields(meta: TableMeta, names: string[]): string[] {
  const allowed = new Set(meta.fields.filter((field) => !field.encrypted).map((field) => field.name));
  return names.filter((name) => allowed.has(name));
}
function cell(value: ExcelJS.CellValue): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    if ('result' in value) return value.result;
    if ('text' in value) return value.text;
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
  }
  return value ?? null;
}
function worksheetRows(sheet: ExcelJS.Worksheet): ObjectRow[] {
  const columns: string[] = []; sheet.getRow(1).eachCell((value) => columns.push(String(value.value ?? '').trim()));
  const rows: ObjectRow[] = [];
  for (let index = 2; index <= sheet.rowCount; index += 1) {
    const output = Object.fromEntries(columns.map((column, offset) => [column, cell(sheet.getRow(index).getCell(offset + 1).value)]));
    if (Object.values(output).some((value) => value !== null && value !== '')) rows.push(output);
  }
  return rows;
}
function csvRows(data: Uint8Array): ObjectRow[] {
  return parseCsv(Buffer.from(data).toString('utf8').replace(/^﻿/, ''), { columns: true, skip_empty_lines: true, trim: true }) as ObjectRow[];
}
async function parseEntityFile(filename: string, buffer: Buffer, entity: DataEntityMeta): Promise<StagedEntity> {
  const extension = extname(filename).toLowerCase();
  if (extension === '.xls') throw Object.assign(new Error('Legacy .xls files are not supported; use .xlsx'), { statusCode: 415 });
  if (extension === '.xlsx') {
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const root = workbook.getWorksheet('Header') ?? workbook.worksheets[0];
    if (!root) throw new Error('Workbook is missing the Header sheet');
    return { entity: entity.name, root: worksheetRows(root), lines: Object.fromEntries((entity.lines ?? []).map((line) => [line.name, workbook.getWorksheet(line.name) ? worksheetRows(workbook.getWorksheet(line.name)!) : []])) };
  }
  if (extension !== '.zip') throw Object.assign(new Error('Data Entity imports accept .xlsx or manifest CSV .zip files'), { statusCode: 415 });
  const files = unzipSync(buffer); if (!files['manifest.json']) throw new Error('CSV package is missing manifest.json');
  const manifest = JSON.parse(strFromU8(files['manifest.json'])) as { format?: string; schemaVersion?: number; entity?: string; sources?: Array<{ name: string; file: string }> };
  if (manifest.format !== ENTITY_FORMAT || manifest.schemaVersion !== 1 || manifest.entity !== entity.name) throw new Error('CSV package manifest does not match this Data Entity');
  const source = (name: string): ObjectRow[] => {
    const declared = manifest.sources?.find((entry) => entry.name === name); if (!declared || declared.file.includes('..') || declared.file.includes('\\') || !files[declared.file]) throw new Error(`CSV package is missing source '${name}'`);
    return csvRows(files[declared.file]);
  };
  return { entity: entity.name, root: source('Header'), lines: Object.fromEntries((entity.lines ?? []).map((line) => [line.name, source(line.name)])) };
}
function coerce(meta: TableMeta, fieldName: string, raw: unknown): FieldValue {
  if (raw === null || raw === undefined || raw === '') return null;
  const field = meta.fields.find((candidate) => candidate.name === fieldName);
  if (!field) throw new ValidationError(`${meta.name}: unknown field '${fieldName}'`);
  if (['int', 'real', 'enum', 'reference'].includes(field.type)) { const number = Number(raw); if (!Number.isFinite(number)) throw new ValidationError(`${meta.name}.${fieldName} expects a number`); return number; }
  if (field.type === 'boolean') return ['true', '1', 'yes'].includes(String(raw).toLowerCase()) ? 1 : 0;
  return String(raw);
}
function writable(meta: TableMeta, row: ObjectRow, allowedFields: string[], operation: 'create'|'update'): Record<string, FieldValue> {
  const allowed = new Set(allowedFields); const output: Record<string, FieldValue> = {};
  for (const field of meta.fields) {
    if (!allowed.has(field.name) || field.readOnly || (operation === 'create' ? field.allowEditOnCreate === false : field.allowEdit === false) || !(field.name in row)) continue;
    output[field.name] = coerce(meta, field.name, row[field.name]);
  }
  return output;
}
function findByKey(ctx: DataContext, tableName: string, keys: string[], row: ObjectRow) {
  const query = ctx.select(tableName); for (const key of keys) query.where(key, '=', row[key] as FieldValue); return query.firstOnly();
}
export function importEntityDocument(kernel: Kernel, ctx: DataContext, entity: DataEntityMeta, header: ObjectRow, allLines: Record<string, ObjectRow[]>): { inserted: number; updated: number; linesInserted: number; linesUpdated: number } {
  kernel.assertArtifactWritable(entity.name);
  const rootMeta = table(kernel, entity.rootTable);
  for (const key of entity.businessKey) if (header[key] === null || header[key] === undefined || header[key] === '') throw new ValidationError(`Header business key '${key}' is required`);
  let inserted = 0; let updated = 0; let linesInserted = 0; let linesUpdated = 0;
  ctx.tts(() => {
    ctx.guardWrite(() => kernel.assertArtifactWritable(entity.name));
    let root = findByKey(ctx, entity.rootTable, entity.businessKey, header);
    if (root) { root.setMany(writable(rootMeta, header, entity.fields, 'update')).update(); updated += 1; }
    else { root = ctx.newRecord(entity.rootTable).setMany(writable(rootMeta, header, entity.fields, 'create')); root.insert(); inserted += 1; }
    for (const source of entity.lines ?? []) {
      const lineMeta = table(kernel, source.table);
      const documentLines = (allLines[source.name] ?? []).filter((row) => entity.businessKey.every((key) => String(row[key] ?? '') === String(header[key] ?? '')));
      for (const input of documentLines) {
        for (const key of source.lineKeys) if (input[key] === null || input[key] === undefined || input[key] === '') throw new ValidationError(`${source.name} line key '${key}' is required`);
        const lookup = { ...input, [source.parentReference]: root.id };
        const keys = [source.parentReference, ...source.lineKeys];
        let line = findByKey(ctx, source.table, keys, lookup);
        const values = { ...writable(lineMeta, input, source.fields, line ? 'update' : 'create'), [source.parentReference]: root.id as number };
        if (line) { line.setMany(values).update(); linesUpdated += 1; }
        else { line = ctx.newRecord(source.table).setMany(values); line.insert(); linesInserted += 1; }
      }
    }
  });
  return { inserted, updated, linesInserted, linesUpdated };
}

function assertPermission(ctx: DataContext, entity: DataEntityMeta, operation: 'read'|'write'): void {
  const tables = [entity.rootTable, ...(entity.lines ?? []).map((line) => line.table)];
  for (const name of tables) {
    if (operation === 'read' ? !ctx.policy.can(name, 'read') : (!ctx.policy.can(name, 'create') || !ctx.policy.can(name, 'update'))) throw new SecurityError(`Access denied: Data Entity ${operation} on '${name}'`);
  }
}
function insertJob(kernel: Kernel, jobId: string, type: string, entityName: string, user: string, status: string, inputPath?: string): void {
  const now = new Date().toISOString(); kernel.db.prepare(`INSERT INTO "FW_DataJob" (createdAt,createdBy,modifiedAt,modifiedBy,jobId,type,entityName,status,requestedBy,inputPath) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(now,user,now,user,jobId,type,entityName,status,user,inputPath ?? null);
}

export function registerDataEntityRoutes(app: FastifyInstance, kernel: Kernel, deps: { userCtx: (request: FastifyRequest) => DataContext }): void {
  app.get<{ Params: { name: string }; Querystring: { format?: string } }>('/api/data-entities/:name/export', async (request, reply) => {
    const entity = kernel.registry.getDataEntity(request.params.name); const ctx = deps.userCtx(request); assertPermission(ctx, entity, 'read');
    const rootMeta = table(kernel, entity.rootTable); const headers = ctx.select(entity.rootTable).limit(50_000).toArray();
    const headerRows = headers.map((record) => Object.fromEntries(entity.fields.map((name) => [name, record.get(name)])));
    const lineRows: Record<string, ObjectRow[]> = {};
    for (const source of entity.lines ?? []) {
      const output: ObjectRow[] = [];
      for (const header of headers) for (const line of ctx.select(source.table).where(source.parentReference, '=', header.id!).toArray()) {
        output.push(Object.fromEntries([...entity.businessKey.map((name) => [name, header.get(name)]), ...source.fields.map((name) => [name, line.get(name)])]));
      }
      lineRows[source.name] = output;
    }
    if (request.query.format === 'csv') {
      const payload: Record<string, Uint8Array> = {}; const sources: Array<{ name: string; file: string }> = [];
      const add = (name: string, rows: ObjectRow[], columns: string[]) => { const file = `${name}.csv`; sources.push({ name, file }); payload[file] = new TextEncoder().encode('﻿' + stringifyCsv(rows, { header: true, columns })); };
      add('Header', headerRows, fields(rootMeta, entity.fields));
      for (const source of entity.lines ?? []) add(source.name, lineRows[source.name]!, [...entity.businessKey, ...fields(table(kernel, source.table), source.fields)]);
      payload['manifest.json'] = new TextEncoder().encode(JSON.stringify({ format: ENTITY_FORMAT, schemaVersion: 1, entity: entity.name, exportedAt: new Date().toISOString(), sources }, null, 2));
      reply.header('Content-Type', 'application/zip'); reply.header('Content-Disposition', `attachment; filename="${entity.name}.zip"`); return reply.send(Buffer.from(zipSync(payload, { level: 6 })));
    }
    const workbook = new ExcelJS.Workbook(); const addSheet = (name: string, rows: ObjectRow[], columns: string[]) => { const sheet = workbook.addWorksheet(name.slice(0, 31)); sheet.addRow(columns); for (const row of rows) sheet.addRow(columns.map((column) => row[column] ?? null)); };
    addSheet('Header', headerRows, fields(rootMeta, entity.fields)); for (const source of entity.lines ?? []) addSheet(source.name, lineRows[source.name]!, [...entity.businessKey, ...fields(table(kernel, source.table), source.fields)]);
    const buffer = await workbook.xlsx.writeBuffer(); reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); reply.header('Content-Disposition', `attachment; filename="${entity.name}.xlsx"`); return reply.send(Buffer.from(buffer));
  });

  app.post<{ Params: { name: string } }>('/api/data-entities/:name/import/preview', async (request, reply) => {
    const entity = kernel.registry.getDataEntity(request.params.name); const ctx = deps.userCtx(request); assertPermission(ctx, entity, 'write');
    const file = await request.file({ limits: { fileSize: MAX_IMPORT_BYTES } }); if (!file) return reply.status(400).send({ error: 'No file uploaded' });
    const staged = await parseEntityFile(file.filename, await file.toBuffer(), entity); const jobId = randomUUID(); const path = join(jobsPath(), `${jobId}.json`); await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(staged));
    insertJob(kernel, jobId, 'entity-import', entity.name, ctx.session.user, 'staged', path);
    return { previewId: jobId, entity: entity.name, documents: staged.root.length, sources: [{ name: 'Header', rows: staged.root.length }, ...(entity.lines ?? []).map((line) => ({ name: line.name, rows: staged.lines[line.name]?.length ?? 0 }))], sample: staged.root.slice(0, 10) };
  });

  app.post<{ Params: { name: string }; Body: { previewId?: string } }>('/api/data-entities/:name/import/commit', async (request, reply) => {
    const entity = kernel.registry.getDataEntity(request.params.name); const ctx = deps.userCtx(request); assertPermission(ctx, entity, 'write');
    const row = kernel.db.prepare('SELECT * FROM "FW_DataJob" WHERE jobId=? AND type=? AND entityName=?').get(request.body?.previewId, 'entity-import', entity.name) as { inputPath?: string; requestedBy: string; status: string } | undefined;
    if (!row || row.requestedBy !== ctx.session.user || row.status !== 'staged' || !row.inputPath) return reply.status(410).send({ error: 'Import preview is unavailable' });
    kernel.db.prepare('UPDATE "FW_DataJob" SET status=?,modifiedAt=CURRENT_TIMESTAMP WHERE jobId=?').run('running', request.body.previewId);
    const staged = JSON.parse(await readFile(row.inputPath, 'utf8')) as StagedEntity; const total = { inserted: 0, updated: 0, linesInserted: 0, linesUpdated: 0 }; const failures: Array<{ document: number; key: string; error: string }> = [];
    staged.root.forEach((header, index) => {
      try { const result = importEntityDocument(kernel, ctx, entity, header, staged.lines); for (const key of Object.keys(total) as Array<keyof typeof total>) total[key] += result[key]; }
      catch (error) { failures.push({ document: index + 1, key: entity.businessKey.map((key) => `${key}=${String(header[key] ?? '')}`).join(','), error: error instanceof Error ? error.message : String(error) }); }
    });
    let resultPath: string | null = null; if (failures.length) { resultPath = join(jobsPath(), `${request.body.previewId}-errors.csv`); await writeFile(resultPath, stringifyCsv(failures, { header: true })); }
    const summary = { ...total, failed: failures.length }; kernel.db.prepare('UPDATE "FW_DataJob" SET status=?,resultPath=?,summaryJson=?,modifiedAt=CURRENT_TIMESTAMP WHERE jobId=?').run('completed', resultPath, JSON.stringify(summary), request.body.previewId);
    return { jobId: request.body.previewId, ...summary, errorFile: resultPath ? `/api/data-entities/jobs/${request.body.previewId}/errors` : null };
  });

  app.get<{ Params: { jobId: string } }>('/api/data-entities/jobs/:jobId/errors', async (request, reply) => {
    const ctx = deps.userCtx(request); const row = kernel.db.prepare('SELECT requestedBy,resultPath FROM "FW_DataJob" WHERE jobId=?').get(request.params.jobId) as { requestedBy: string; resultPath?: string } | undefined;
    if (!row || row.requestedBy !== ctx.session.user || !row.resultPath) return reply.status(404).send({ error: 'Error file was not found' });
    reply.header('Content-Type', 'text/csv; charset=utf-8'); reply.header('Content-Disposition', `attachment; filename="${request.params.jobId}-errors.csv"`); return reply.send(await readFile(row.resultPath));
  });
}
