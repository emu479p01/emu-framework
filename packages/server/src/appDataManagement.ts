import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { strFromU8, unzipSync, Zip, ZipDeflate } from 'fflate';
import { CORE_VERSION, type Kernel, type TableMeta } from '@emu/core';

const APP_DATA_FORMAT = 'emuframework-app-data';
const APP_DATA_SCHEMA_VERSION = 1;
const MAX_APP_DATA_BYTES = 512 * 1024 * 1024;
const PREVIEW_TTL_MS = 10 * 60_000;
const textEncoder = new TextEncoder();

export interface AppDataManifest {
  format: typeof APP_DATA_FORMAT;
  schemaVersion: typeof APP_DATA_SCHEMA_VERSION;
  frameworkVersion: string;
  app: string;
  exportedAt: string;
  tables: { name: string; schemaHash: string; rowCount: number; sha256: string; bytes: number }[];
}

export interface AppDataPreview {
  previewId: string;
  expiresAt: string;
  app: string;
  frameworkVersion: string;
  exportedAt: string;
  tables: { name: string; currentRows: number; incomingRows: number }[];
  warnings: string[];
}

export interface AppDataResult {
  ok: true;
  app: string;
  tables: { name: string; deleted: number; inserted: number }[];
}

type CachedPreview = {
  actor: string;
  app: string;
  expiresAt: number;
  manifest: AppDataManifest;
  rows: Map<string, Record<string, unknown>[]>;
};

const previews = new Map<string, CachedPreview>();
const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');
const qi = (value: string) => `"${value.replace(/"/g, '""')}"`;

function versionParts(value: string): number[] {
  return value.replace(/^[vV]/, '').split('.').map((part) => Number(part) || 0);
}

function newerThan(left: string, right: string): boolean {
  const a = versionParts(left); const b = versionParts(right);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

function schemaHash(table: TableMeta): string {
  return sha256(JSON.stringify({
    name: table.name,
    fields: table.fields.map((field) => ({
      name: field.name, type: field.type, mandatory: !!field.mandatory,
      enumName: field.enumName ?? null,
      reference: field.reference ? { table: field.reference.table, onDelete: field.reference.onDelete ?? 'restrict' } : null,
    })),
    indexes: (table.indexes ?? []).map((index) => ({ name: index.name, fields: index.fields, unique: !!index.unique })),
  }));
}

function appTables(kernel: Kernel, appName: string): TableMeta[] {
  if (appName === 'system' || !kernel.registry.loadedApps().some((app) => app.name === appName)) {
    throw Object.assign(new Error(`Unknown app '${appName}'`), { statusCode: 404 });
  }
  return kernel.registry.allTables().filter((table) => kernel.appForArtifact(table.name) === appName && !table.name.startsWith('FW_'));
}

function countRows(kernel: Kernel, table: string): number {
  return Number((kernel.db.prepare(`SELECT COUNT(*) AS count FROM ${qi(table)}`).get() as { count: number }).count);
}

function ensureAuditTable(kernel: Kernel): void {
  kernel.designerDb.exec(`CREATE TABLE IF NOT EXISTS "FW_AppDataAudit" (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actor TEXT NOT NULL,
    app TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT
  )`);
}

function audit(kernel: Kernel, actor: string, app: string, action: string, details: unknown): void {
  ensureAuditTable(kernel);
  kernel.designerDb.prepare('INSERT INTO "FW_AppDataAudit" (actor, app, action, details) VALUES (?, ?, ?, ?)')
    .run(actor, app, action, JSON.stringify(details));
}

async function createPackage(kernel: Kernel, appName: string): Promise<{ path: string; manifest: AppDataManifest; cleanup: () => Promise<void> }> {
  const tables = appTables(kernel, appName);
  const entries: AppDataManifest['tables'] = [];
  const directory = await mkdtemp(join(tmpdir(), 'emu-app-data-')); const path = join(directory, `${appName}.emuappdata`);
  const output = createWriteStream(path); let blocked = false; let zipError: Error | null = null;
  const zip = new Zip((error, chunk, final) => {
    if (error) { zipError = error; output.destroy(error); return; }
    if (chunk.length) blocked = !output.write(chunk);
    if (final) output.end();
  });
  const waitForOutput = async () => { if (blocked) { await once(output, 'drain'); blocked = false; } if (zipError) throw zipError; };
  try {
    for (const table of tables) {
      const file = new ZipDeflate(`tables/${table.name}.ndjson`, { level: 6 }); zip.add(file);
      const hash = createHash('sha256'); let rowCount = 0; let bytes = 0; let pending = '';
      for (const row of kernel.db.prepare(`SELECT * FROM ${qi(table.name)} ORDER BY id`).iterate() as Iterable<Record<string, unknown>>) {
        pending += `${JSON.stringify(row)}\n`; rowCount += 1;
        if (pending.length >= 64 * 1024) {
          const chunk = textEncoder.encode(pending); pending = ''; hash.update(chunk); bytes += chunk.length; file.push(chunk); await waitForOutput();
        }
      }
      if (pending) { const chunk = textEncoder.encode(pending); hash.update(chunk); bytes += chunk.length; file.push(chunk); await waitForOutput(); }
      file.push(new Uint8Array(), true); await waitForOutput();
      entries.push({ name: table.name, schemaHash: schemaHash(table), rowCount, sha256: hash.digest('hex'), bytes });
    }
    const manifest: AppDataManifest = { format: APP_DATA_FORMAT, schemaVersion: APP_DATA_SCHEMA_VERSION, frameworkVersion: CORE_VERSION, app: appName, exportedAt: new Date().toISOString(), tables: entries };
    const manifestFile = new ZipDeflate('manifest.json', { level: 6 }); zip.add(manifestFile); manifestFile.push(textEncoder.encode(JSON.stringify(manifest, null, 2)), true); zip.end();
    await finished(output); if (zipError) throw zipError;
    return { path, manifest, cleanup: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) { zip.terminate(); output.destroy(); await rm(directory, { recursive: true, force: true }); throw error; }
}

function parsePackage(kernel: Kernel, expectedApp: string, buffer: Buffer): { manifest: AppDataManifest; rows: Map<string, Record<string, unknown>[]> } {
  if (buffer.length > MAX_APP_DATA_BYTES) throw new Error('App data package exceeds the 512 MB safety limit');
  const files = unzipSync(buffer);
  for (const name of Object.keys(files)) {
    if (name.includes('..') || name.includes('\\') || (name !== 'manifest.json' && !/^tables\/[A-Za-z0-9_.-]+\.ndjson$/.test(name))) {
      throw new Error('App data package contains an unsafe file path');
    }
  }
  if (!files['manifest.json']) throw new Error('App data package is missing manifest.json');
  let manifest: AppDataManifest;
  try { manifest = JSON.parse(strFromU8(files['manifest.json'])) as AppDataManifest; }
  catch { throw new Error('App data manifest is invalid JSON'); }
  if (manifest.format !== APP_DATA_FORMAT || manifest.schemaVersion !== APP_DATA_SCHEMA_VERSION) throw new Error('Unsupported app data package');
  if (manifest.app !== expectedApp) throw new Error(`Package belongs to app '${manifest.app}', not '${expectedApp}'`);
  if (newerThan(manifest.frameworkVersion, CORE_VERSION)) throw new Error(`Package requires newer framework ${manifest.frameworkVersion}`);
  const current = appTables(kernel, expectedApp);
  if (manifest.tables.length !== current.length || current.some((table) => !manifest.tables.some((entry) => entry.name === table.name))) {
    throw new Error('Package table set does not match the current app metadata');
  }
  const rows = new Map<string, Record<string, unknown>[]>();
  const expectedFiles = new Set(manifest.tables.map((table) => `tables/${table.name}.ndjson`));
  const actualFiles = Object.keys(files).filter((name) => name !== 'manifest.json');
  if (actualFiles.length !== expectedFiles.size || actualFiles.some((name) => !expectedFiles.has(name))) {
    throw new Error('Package files do not match its table manifest');
  }
  for (const table of current) {
    const entry = manifest.tables.find((item) => item.name === table.name)!;
    if (entry.schemaHash !== schemaHash(table)) throw new Error(`Schema mismatch for ${table.name}`);
    const bytes = files[`tables/${table.name}.ndjson`];
    if (!bytes || bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) throw new Error(`Checksum failed for ${table.name}`);
    let parsed: Record<string, unknown>[];
    try {
      const text = strFromU8(bytes).trim();
      parsed = text ? text.split(/\r?\n/).map((line) => JSON.parse(line) as Record<string, unknown>) : [];
    } catch { throw new Error(`Invalid NDJSON for ${table.name}`); }
    if (parsed.length !== entry.rowCount) throw new Error(`Row count mismatch for ${table.name}`);
    rows.set(table.name, parsed);
  }
  validateReferences(kernel, current, rows);
  return { manifest, rows };
}

function validateReferences(kernel: Kernel, owned: TableMeta[], incoming: Map<string, Record<string, unknown>[]>): void {
  const ownedNames = new Set(owned.map((table) => table.name));
  const incomingIds = new Map([...incoming].map(([table, rows]) => [table, new Set(rows.map((row) => Number(row.id))) ]));
  for (const table of owned) {
    for (const field of table.fields.filter((item) => item.type === 'reference' && item.reference)) {
      const target = field.reference!.table;
      for (const row of incoming.get(table.name) ?? []) {
        const value = row[field.name];
        if (value === null || value === undefined) continue;
        if (ownedNames.has(target)) {
          if (!incomingIds.get(target)?.has(Number(value))) throw new Error(`${table.name}.${field.name} references missing ${target}#${value}`);
        } else if (!kernel.db.prepare(`SELECT 1 FROM ${qi(target)} WHERE id = ?`).get(value)) {
          throw new Error(`${table.name}.${field.name} references missing external ${target}#${value}`);
        }
      }
    }
  }
  for (const external of kernel.registry.allTables().filter((table) => !ownedNames.has(table.name))) {
    for (const field of external.fields.filter((item) => item.type === 'reference' && item.reference && ownedNames.has(item.reference.table))) {
      const refs = kernel.db.prepare(`SELECT DISTINCT ${qi(field.name)} AS id FROM ${qi(external.name)} WHERE ${qi(field.name)} IS NOT NULL`).all() as { id: number }[];
      const retained = incomingIds.get(field.reference!.table)!;
      if (refs.some((row) => !retained.has(Number(row.id)))) throw new Error(`${external.name}.${field.name} references records that would be removed`);
    }
  }
}

function replaceData(kernel: Kernel, appName: string, rows: Map<string, Record<string, unknown>[]>): AppDataResult {
  const tables = appTables(kernel, appName);
  const result: AppDataResult = { ok: true, app: appName, tables: [] };
  const tx = kernel.db.transaction(() => {
    kernel.db.pragma('defer_foreign_keys = ON');
    for (const table of [...tables].reverse()) {
      const deleted = countRows(kernel, table.name);
      kernel.db.exec(`DELETE FROM ${qi(table.name)}`);
      result.tables.unshift({ name: table.name, deleted, inserted: 0 });
    }
    for (const table of tables) {
      const tableRows = rows.get(table.name) ?? [];
      if (tableRows.length) {
        const columns = (kernel.db.prepare(`PRAGMA table_info(${qi(table.name)})`).all() as { name: string }[]).map((column) => column.name);
        const allowed = new Set(columns);
        const insert = kernel.db.prepare(`INSERT INTO ${qi(table.name)} (${columns.map(qi).join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
        for (const row of tableRows) {
          if (Object.keys(row).some((key) => !allowed.has(key))) throw new Error(`Unknown column in ${table.name}`);
          insert.run(...columns.map((column) => row[column] ?? null));
        }
      }
      result.tables.find((entry) => entry.name === table.name)!.inserted = tableRows.length;
    }
    const violations = kernel.db.pragma('foreign_key_check') as unknown[];
    if (violations.length) throw new Error('Imported data failed foreign-key integrity validation');
  });
  tx();
  return result;
}

function externalDeleteBlockers(kernel: Kernel, owned: TableMeta[]): string[] {
  const names = new Set(owned.map((table) => table.name));
  const blockers: string[] = [];
  for (const table of kernel.registry.allTables().filter((item) => !names.has(item.name))) {
    for (const field of table.fields.filter((item) => item.type === 'reference' && item.reference && names.has(item.reference.table))) {
      const count = Number((kernel.db.prepare(`SELECT COUNT(*) AS count FROM ${qi(table.name)} WHERE ${qi(field.name)} IS NOT NULL`).get() as { count: number }).count);
      if (count) blockers.push(`${table.name}.${field.name} (${count})`);
    }
  }
  return blockers;
}

export function registerAppDataManagementRoutes(app: FastifyInstance, kernel: Kernel, requireFrameworkAdmin: (req: FastifyRequest) => string): void {
  ensureAuditTable(kernel);
  app.get('/api/system/app-data', (req) => {
    requireFrameworkAdmin(req);
    return {
      apps: kernel.registry.loadedApps().filter((entry) => entry.name !== 'system').map((entry) => {
        const tables = appTables(kernel, entry.name).map((table) => ({ name: table.name, label: table.label ?? table.name, rows: countRows(kernel, table.name) }));
        const last = kernel.designerDb.prepare('SELECT createdAt, action FROM "FW_AppDataAudit" WHERE app = ? ORDER BY id DESC LIMIT 1').get(entry.name) as { createdAt: string; action: string } | undefined;
        return { name: entry.name, label: entry.label ?? entry.name, tables, totalRows: tables.reduce((sum, table) => sum + table.rows, 0), lastOperation: last ?? null };
      }),
    };
  });

  app.get<{ Params: { app: string } }>('/api/system/app-data/:app/export', async (req, reply) => {
    const actor = requireFrameworkAdmin(req);
    const { path, manifest, cleanup } = await createPackage(kernel, req.params.app);
    audit(kernel, actor, req.params.app, 'export', { tables: manifest.tables.map((table) => ({ name: table.name, rows: table.rowCount })) });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${req.params.app}-${stamp}.emuappdata"`);
    const stream = createReadStream(path); reply.raw.once('close', () => { void cleanup(); });
    return reply.send(stream);
  });

  app.post<{ Params: { app: string } }>('/api/system/app-data/:app/import/preview', async (req, reply) => {
    const actor = requireFrameworkAdmin(req);
    const file = await req.file({ limits: { fileSize: MAX_APP_DATA_BYTES } });
    if (!file) return reply.status(400).send({ error: 'No app data package uploaded' });
    try {
      const parsed = parsePackage(kernel, req.params.app, await file.toBuffer());
      const id = randomUUID(); const expiresAt = Date.now() + PREVIEW_TTL_MS;
      previews.set(id, { actor, app: req.params.app, expiresAt, manifest: parsed.manifest, rows: parsed.rows });
      const preview: AppDataPreview = {
        previewId: id, expiresAt: new Date(expiresAt).toISOString(), app: req.params.app,
        frameworkVersion: parsed.manifest.frameworkVersion, exportedAt: parsed.manifest.exportedAt,
        tables: parsed.manifest.tables.map((table) => ({ name: table.name, currentRows: countRows(kernel, table.name), incomingRows: table.rowCount })),
        warnings: ['Replace import bypasses per-record business hooks and replaces all data owned by this app.'],
      };
      return preview;
    } catch (error) { return reply.status(422).send({ error: error instanceof Error ? error.message : String(error) }); }
  });

  app.post<{ Params: { app: string }; Body: { previewId?: string; confirmation?: string } }>('/api/system/app-data/:app/import/replace', (req, reply) => {
    const actor = requireFrameworkAdmin(req);
    if (req.body?.confirmation !== req.params.app) return reply.status(400).send({ error: `Type '${req.params.app}' to confirm replacement` });
    const preview = req.body?.previewId ? previews.get(req.body.previewId) : undefined;
    if (!preview || preview.expiresAt < Date.now()) return reply.status(410).send({ error: 'Preview expired; upload the package again' });
    if (preview.actor !== actor || preview.app !== req.params.app) return reply.status(403).send({ error: 'Preview belongs to another user or app' });
    const result = replaceData(kernel, req.params.app, preview.rows);
    previews.delete(req.body.previewId!); audit(kernel, actor, req.params.app, 'replace', result.tables);
    return result;
  });

  app.delete<{ Params: { app: string }; Body: { confirmation?: string } }>('/api/system/app-data/:app', (req, reply) => {
    const actor = requireFrameworkAdmin(req); const tables = appTables(kernel, req.params.app);
    if (req.body?.confirmation !== req.params.app) return reply.status(400).send({ error: `Type '${req.params.app}' to confirm permanent deletion` });
    const blockers = externalDeleteBlockers(kernel, tables);
    if (blockers.length) return reply.status(409).send({ error: `Other apps still reference this data: ${blockers.join(', ')}` });
    const result = replaceData(kernel, req.params.app, new Map(tables.map((table) => [table.name, []])));
    audit(kernel, actor, req.params.app, 'delete', result.tables);
    return result;
  });
}
