import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, stat, statfs, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import Database from 'better-sqlite3';
import type { DataEntityMeta, Kernel } from '@emu/core';
import { attachmentStoragePath } from './attachments.js';
import { importEntityDocument } from './dataEntities.js';
import { localizeArchiveEntities } from './localization.js';
import { fontCachePath } from './fontManager.js';
import { archiveStoragePath } from './storagePaths.js';

export { archiveStoragePath } from './storagePaths.js';

interface ArchivePayload {
  schemaVersion: 1; entity: string; key: Record<string, unknown>; businessDate: unknown;
  header: Record<string, unknown>; lines: Record<string, Record<string, unknown>[]>;
  attachments?: Array<Record<string, unknown> & { archivedBlob?: string }>;
}
interface PolicyBody { enabled?: boolean; businessDateField?: string; ageDays?: number; batchSize?: number; includeAttachments?: boolean; schedule?: string; weekday?: number; timezone?: string }

function catalogPath(): string { return join(archiveStoragePath(), 'catalog.db'); }
function safeRelative(root: string, candidate: string): string {
  const rel = relative(root, resolve(root, candidate)); if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('Unsafe archive path'); return rel;
}
function openCatalog(): Database.Database {
  const root = archiveStoragePath(); mkdirSync(root, { recursive: true });
  const db = new Database(catalogPath()); db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS documents (
    archiveId TEXT PRIMARY KEY, entityName TEXT NOT NULL, businessKey TEXT NOT NULL,
    businessDate TEXT, payloadPath TEXT NOT NULL UNIQUE, checksum TEXT NOT NULL,
    bytes INTEGER NOT NULL, createdAt TEXT NOT NULL, createdBy TEXT NOT NULL, restoredAt TEXT
  ); CREATE INDEX IF NOT EXISTS ArchiveEntityDateIdx ON documents(entityName,businessDate);`);
  return db;
}
async function directorySize(path: string): Promise<number> {
  try { let total = 0; for (const entry of await readdir(path, { withFileTypes: true })) { const full = join(path, entry.name); total += entry.isDirectory() ? await directorySize(full) : entry.isFile() ? (await stat(full)).size : 0; } return total; } catch { return 0; }
}
function entityOrThrow(kernel: Kernel, name: string): DataEntityMeta {
  const entity = kernel.registry.getDataEntity(name); if (!entity.archiveEligible) throw Object.assign(new Error(`Data Entity '${name}' is not eligible for archive`), { statusCode: 422 }); return entity;
}
function cutoff(ageDays: number): string { return new Date(Date.now() - ageDays * 86_400_000).toISOString(); }
function policyRow(kernel: Kernel, entityName: string): Record<string, unknown> | undefined { return kernel.db.prepare('SELECT * FROM "FW_ArchivePolicy" WHERE entityName=?').get(entityName) as Record<string, unknown> | undefined; }
function insertJob(kernel: Kernel, jobId: string, entityName: string, user: string): void { const now = new Date().toISOString(); kernel.db.prepare(`INSERT INTO "FW_DataJob" (createdAt,createdBy,modifiedAt,modifiedBy,jobId,type,entityName,status,requestedBy) VALUES (?,?,?,?,?,'archive',?,'running',?)`).run(now,user,now,user,jobId,entityName,user); }
function rawRecord(record: { get: (field: string) => unknown }, fields: string[]): Record<string, unknown> { return Object.fromEntries(fields.map((field) => [field, record.get(field)])); }

async function attachmentPayload(kernel: Kernel, parentPairs: Array<{ table: string; id: number }>, archiveId: string): Promise<ArchivePayload['attachments']> {
  const output: NonNullable<ArchivePayload['attachments']> = []; const root = archiveStoragePath();
  for (const parent of parentPairs) {
    const rows = kernel.db.prepare(`SELECT a.*,b.storageKey,b.sha256,b.originalName,b.mimeType,b.bytes FROM "FW_Attachment" a LEFT JOIN "FW_Blob" b ON b.blobId=a.blobId WHERE parentTable=? AND parentId=?`).all(parent.table, parent.id) as Record<string, unknown>[];
    for (const row of rows) {
      const item = { ...row, parentTable: parent.table, parentId: parent.id } as Record<string, unknown> & { archivedBlob?: string };
      if (row.kind === 'file' && row.storageKey && row.sha256) {
        const source = resolve(attachmentStoragePath(), ...String(row.storageKey).split('/'));
        const blobRelative = `blobs/${String(row.sha256).slice(0, 2)}/${String(row.sha256)}`; safeRelative(root, blobRelative);
        const target = join(root, ...blobRelative.split('/')); await mkdir(dirname(target), { recursive: true }); if (!existsSync(target)) await copyFile(source, target);
        item.archivedBlob = blobRelative;
      }
      delete item.storageKey; output.push(item);
    }
  }
  void archiveId; return output;
}

async function archiveBatch(kernel: Kernel, entity: DataEntityMeta, policy: Record<string, unknown>, actor: string): Promise<Record<string, unknown>> {
  const dateField = String(policy.businessDateField); const limit = Math.max(1, Math.min(10_000, Number(policy.batchSize) || 100)); const ageDays = Math.max(0, Number(policy.ageDays) || 0);
  const ctx = kernel.context({ user: actor }); const candidates = ctx.select(entity.rootTable).where(dateField, '<=', cutoff(ageDays)).orderBy(dateField).limit(limit).toArray();
  const catalog = openCatalog(); let archived = 0; const failed: Array<{ key: string; error: string }> = [];
  try {
    for (const header of candidates) {
      const key = Object.fromEntries(entity.businessKey.map((field) => [field, header.get(field)])); const keyText = JSON.stringify(key);
      try {
        if (catalog.prepare('SELECT 1 FROM documents WHERE entityName=? AND businessKey=?').get(entity.name, keyText)) throw new Error('Document is already archived');
        const lines: Record<string, Record<string, unknown>[]> = {}; const parents = [{ table: entity.rootTable, id: header.id! }];
        for (const source of entity.lines ?? []) {
          const records = ctx.select(source.table).where(source.parentReference, '=', header.id!).toArray(); lines[source.name] = records.map((line) => ({ ...Object.fromEntries(entity.businessKey.map((field) => [field, header.get(field)])), ...rawRecord(line, source.fields), _archiveRecordId: line.id })); parents.push(...records.map((line) => ({ table: source.table, id: line.id! })));
        }
        const countAttachments = parents.reduce((sum, parent) => sum + Number((kernel.db.prepare('SELECT COUNT(*) n FROM "FW_Attachment" WHERE parentTable=? AND parentId=?').get(parent.table, parent.id) as { n: number }).n), 0);
        if (countAttachments && !policy.includeAttachments) throw new Error('Document has attachments but policy does not include them');
        const archiveId = randomUUID(); const payload: ArchivePayload = { schemaVersion: 1, entity: entity.name, key, businessDate: header.get(dateField), header: { ...rawRecord(header, entity.fields), _archiveRecordId: header.id }, lines };
        if (policy.includeAttachments) payload.attachments = await attachmentPayload(kernel, parents, archiveId);
        const bytes = Buffer.from(JSON.stringify(payload)); const checksum = createHash('sha256').update(bytes).digest('hex'); const payloadRelative = `documents/${entity.name}/${archiveId}.json`; safeRelative(archiveStoragePath(), payloadRelative);
        const target = join(archiveStoragePath(), ...payloadRelative.split('/')); const temporary = `${target}.tmp`; await mkdir(dirname(target), { recursive: true }); await writeFile(temporary, bytes); await rename(temporary, target);
        catalog.prepare('INSERT INTO documents (archiveId,entityName,businessKey,businessDate,payloadPath,checksum,bytes,createdAt,createdBy) VALUES (?,?,?,?,?,?,?,?,?)').run(archiveId, entity.name, keyText, String(payload.businessDate ?? ''), payloadRelative, checksum, bytes.length, new Date().toISOString(), actor);
        // Catalog and immutable payload are durable before live deletion begins.
        const liveFiles = parents.flatMap((parent) => (kernel.db.prepare(`SELECT b.storageKey FROM "FW_Attachment" a JOIN "FW_Blob" b ON b.blobId=a.blobId WHERE a.parentTable=? AND a.parentId=?`).all(parent.table, parent.id) as Array<{ storageKey: string }>).map((item) => item.storageKey));
        ctx.tts(() => {
          for (const parent of parents) {
            const attachmentRows = kernel.db.prepare('SELECT blobId FROM "FW_Attachment" WHERE parentTable=? AND parentId=?').all(parent.table, parent.id) as Array<{ blobId?: string }>;
            kernel.db.prepare('DELETE FROM "FW_Attachment" WHERE parentTable=? AND parentId=?').run(parent.table, parent.id);
            for (const attachment of attachmentRows) if (attachment.blobId) kernel.db.prepare('DELETE FROM "FW_Blob" WHERE blobId=? AND NOT EXISTS (SELECT 1 FROM "FW_Attachment" WHERE blobId=?)').run(attachment.blobId, attachment.blobId);
          }
          for (const source of entity.lines ?? []) for (const line of ctx.select(source.table).where(source.parentReference, '=', header.id!).toArray()) line.delete();
          header.delete();
        });
        for (const storageKey of liveFiles) { const liveRoot = attachmentStoragePath(); const path = resolve(liveRoot, ...storageKey.split('/')); if (path.startsWith(`${liveRoot}${sep}`)) await unlink(path).catch(() => undefined); }
        archived += 1;
      } catch (error) { failed.push({ key: keyText, error: error instanceof Error ? error.message : String(error) }); }
    }
  } finally { catalog.close(); }
  return { considered: candidates.length, archived, failed: failed.length, errors: failed };
}

export function registerArchiveRoutes(app: FastifyInstance, kernel: Kernel, requireAdmin: (request: FastifyRequest) => string): void {
  void mkdir(archiveStoragePath(), { recursive: true }).catch((error) => app.log.error(error, 'Archive storage initialization failed'));
  let schedulerRunning = false;
  const runScheduled = async () => {
    if (schedulerRunning) return; schedulerRunning = true;
    try {
      const policies = kernel.db.prepare('SELECT * FROM "FW_ArchivePolicy" WHERE enabled=1').all() as Record<string, unknown>[];
      for (const policy of policies) {
        const timezone = String(policy.timezone || 'Asia/Bangkok'); const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year:'numeric',month:'2-digit',day:'2-digit',weekday:'short' }).formatToParts(new Date());
        const localDate = `${parts.find((part)=>part.type==='year')?.value}-${parts.find((part)=>part.type==='month')?.value}-${parts.find((part)=>part.type==='day')?.value}`; const weekdays: Record<string,number>={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6}; const day=weekdays[parts.find((part)=>part.type==='weekday')?.value ?? 'Sun'];
        const lastDate = policy.lastRunAt ? new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(String(policy.lastRunAt))) : '';
        const due = lastDate !== localDate && (policy.schedule === 'daily' || (policy.schedule === 'weekly' && Number(policy.weekday) === day)); if (!due) continue;
        const entity = kernel.registry.allDataEntities().find((candidate)=>candidate.name===policy.entityName && candidate.archiveEligible); if (!entity) continue; const actor='archive-scheduler'; const jobId=randomUUID(); insertJob(kernel,jobId,entity.name,actor);
        try { const summary=await archiveBatch(kernel,entity,policy,actor); kernel.db.prepare('UPDATE "FW_DataJob" SET status=?,summaryJson=?,modifiedAt=CURRENT_TIMESTAMP WHERE jobId=?').run('completed',JSON.stringify(summary),jobId); kernel.db.prepare('UPDATE "FW_ArchivePolicy" SET lastRunAt=CURRENT_TIMESTAMP WHERE entityName=?').run(entity.name); }
        catch(error){kernel.db.prepare('UPDATE "FW_DataJob" SET status=?,error=?,modifiedAt=CURRENT_TIMESTAMP WHERE jobId=?').run('failed',error instanceof Error?error.message:String(error),jobId);}
      }
    } finally { schedulerRunning = false; }
  };
  const scheduler = setInterval(() => { void runScheduled(); }, 60 * 60_000); scheduler.unref();
  app.get('/api/system/archive/policies', (request) => {
    const actor = requireAdmin(request);
    const policies = kernel.db.prepare('SELECT * FROM "FW_ArchivePolicy" ORDER BY entityName').all();
    const locale = String((kernel.db.prepare('SELECT locale FROM "FW_User" WHERE username=?').get(actor) as { locale?: string } | undefined)?.locale ?? 'en');
    const eligibleEntities = kernel.registry.allDataEntities().filter((entity) => entity.archiveEligible)
      .map((entity) => ({ name: entity.name, label: entity.label, businessDateField: entity.businessDateField }));
    return { eligibleEntities: localizeArchiveEntities(kernel, eligibleEntities, locale), policies };
  });
  app.get<{ Querystring: { type?: string; limit?: string } }>('/api/system/data-jobs', (request) => { requireAdmin(request); const limit=Math.max(1,Math.min(500,Number(request.query.limit)||100));return {items:request.query.type?kernel.db.prepare('SELECT jobId,type,entityName,status,requestedBy,summaryJson,error,createdAt,modifiedAt FROM "FW_DataJob" WHERE type=? ORDER BY createdAt DESC LIMIT ?').all(request.query.type,limit):kernel.db.prepare('SELECT jobId,type,entityName,status,requestedBy,summaryJson,error,createdAt,modifiedAt FROM "FW_DataJob" ORDER BY createdAt DESC LIMIT ?').all(limit)}; });
  app.put<{ Params: { entity: string }; Body: PolicyBody }>('/api/system/archive/policies/:entity', (request) => {
    const actor = requireAdmin(request); const entity = entityOrThrow(kernel, request.params.entity); const dateField = String(request.body.businessDateField ?? entity.businessDateField ?? '');
    if (!entity.fields.includes(dateField)) throw Object.assign(new Error('Business date must be an exported root field'), { statusCode: 422 });
    const rootField = kernel.registry.getTable(entity.rootTable).fields.find((field) => field.name === dateField); if (!rootField || !['date', 'datetime'].includes(rootField.type)) throw Object.assign(new Error('Business date field must be date or datetime'), { statusCode: 422 });
    const schedule = request.body.schedule ?? 'weekly'; if (!['daily', 'weekly'].includes(schedule)) throw Object.assign(new Error('Schedule must be daily or weekly'), { statusCode: 422 });
    const timezone = request.body.timezone ?? 'Asia/Bangkok'; try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); } catch { throw Object.assign(new Error('Timezone is invalid'), { statusCode: 422 }); }
    const values = { enabled: request.body.enabled === false ? 0 : 1, businessDateField: dateField, ageDays: Math.max(0, Math.trunc(request.body.ageDays ?? 365)), batchSize: Math.max(1, Math.min(10_000, Math.trunc(request.body.batchSize ?? 100))), includeAttachments: request.body.includeAttachments === false ? 0 : 1, schedule, weekday: Math.max(0, Math.min(6, Math.trunc(request.body.weekday ?? 0))), timezone };
    const now = new Date().toISOString(); kernel.db.prepare(`INSERT INTO "FW_ArchivePolicy" (createdAt,createdBy,modifiedAt,modifiedBy,entityName,enabled,businessDateField,ageDays,batchSize,includeAttachments,schedule,weekday,timezone)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(entityName) DO UPDATE SET modifiedAt=excluded.modifiedAt,modifiedBy=excluded.modifiedBy,enabled=excluded.enabled,businessDateField=excluded.businessDateField,ageDays=excluded.ageDays,batchSize=excluded.batchSize,includeAttachments=excluded.includeAttachments,schedule=excluded.schedule,weekday=excluded.weekday,timezone=excluded.timezone`).run(now,actor,now,actor,entity.name,values.enabled,values.businessDateField,values.ageDays,values.batchSize,values.includeAttachments,values.schedule,values.weekday,values.timezone);
    return { ok: true, entity: entity.name, ...values };
  });
  app.delete<{ Params: { entity: string } }>('/api/system/archive/policies/:entity', (request) => { requireAdmin(request); kernel.db.prepare('DELETE FROM "FW_ArchivePolicy" WHERE entityName=?').run(request.params.entity); return { ok: true }; });
  app.get<{ Params: { entity: string } }>('/api/system/archive/:entity/preview', (request) => { requireAdmin(request); const entity = entityOrThrow(kernel, request.params.entity); const policy = policyRow(kernel, entity.name); if (!policy) throw Object.assign(new Error('No archive policy exists for this entity'), { statusCode: 409 }); const dateField = String(policy.businessDateField); const row = kernel.db.prepare(`SELECT COUNT(*) count,MIN("${dateField}") oldest FROM "${entity.rootTable}" WHERE "${dateField}"<=?`).get(cutoff(Number(policy.ageDays))) as { count: number; oldest?: string }; return { entity: entity.name, eligible: row.count, oldest: row.oldest ?? null, cutoff: cutoff(Number(policy.ageDays)), batchSize: policy.batchSize }; });
  app.post<{ Params: { entity: string } }>('/api/system/archive/:entity/run', async (request, reply) => {
    const actor = requireAdmin(request); const entity = entityOrThrow(kernel, request.params.entity); const policy = policyRow(kernel, entity.name); if (!policy || !policy.enabled) return reply.status(409).send({ error: 'An enabled archive policy is required' });
    const jobId = randomUUID(); insertJob(kernel, jobId, entity.name, actor);
    try { const summary = await archiveBatch(kernel, entity, policy, actor); kernel.db.prepare('UPDATE "FW_DataJob" SET status=?,summaryJson=?,modifiedAt=CURRENT_TIMESTAMP WHERE jobId=?').run('completed', JSON.stringify(summary), jobId); kernel.db.prepare('UPDATE "FW_ArchivePolicy" SET lastRunAt=CURRENT_TIMESTAMP WHERE entityName=?').run(entity.name); return { jobId, ...summary }; }
    catch (error) { kernel.db.prepare('UPDATE "FW_DataJob" SET status=?,error=?,modifiedAt=CURRENT_TIMESTAMP WHERE jobId=?').run('failed', error instanceof Error ? error.message : String(error), jobId); throw error; }
  });
  app.get<{ Querystring: { entity?: string; q?: string; limit?: string } }>('/api/system/archive/documents', (request) => {
    requireAdmin(request); const catalog = openCatalog(); try { const clauses: string[] = []; const params: unknown[] = []; if (request.query.entity) { clauses.push('entityName=?'); params.push(request.query.entity); } if (request.query.q) { clauses.push('businessKey LIKE ?'); params.push(`%${request.query.q}%`); } const limit = Math.max(1, Math.min(500, Number(request.query.limit) || 100)); return { items: catalog.prepare(`SELECT archiveId,entityName,businessKey,businessDate,bytes,createdAt,createdBy,restoredAt FROM documents ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY createdAt DESC LIMIT ?`).all(...params, limit) }; } finally { catalog.close(); }
  });
  app.get<{ Params: { archiveId: string } }>('/api/system/archive/documents/:archiveId', async (request, reply) => {
    requireAdmin(request); const catalog=openCatalog(); try { const document=catalog.prepare('SELECT * FROM documents WHERE archiveId=?').get(request.params.archiveId) as {payloadPath:string;checksum:string}|undefined;if(!document)return reply.status(404).send({error:'Archived document was not found'});const bytes=await readFile(join(archiveStoragePath(),safeRelative(archiveStoragePath(),document.payloadPath)));if(createHash('sha256').update(bytes).digest('hex')!==document.checksum)return reply.status(422).send({error:'Archived document checksum failed'});return JSON.parse(bytes.toString('utf8')); } finally { catalog.close(); }
  });
  app.get<{ Params: { archiveId: string; attachmentId: string } }>('/api/system/archive/documents/:archiveId/files/:attachmentId', async (request, reply) => {
    requireAdmin(request); const catalog=openCatalog(); try { const document=catalog.prepare('SELECT payloadPath,checksum FROM documents WHERE archiveId=?').get(request.params.archiveId) as {payloadPath:string;checksum:string}|undefined;if(!document)return reply.status(404).send({error:'Archived document was not found'});const bytes=await readFile(join(archiveStoragePath(),safeRelative(archiveStoragePath(),document.payloadPath)));if(createHash('sha256').update(bytes).digest('hex')!==document.checksum)return reply.status(422).send({error:'Archived document checksum failed'});const payload=JSON.parse(bytes.toString('utf8')) as ArchivePayload;const attachment=payload.attachments?.find((item)=>item.attachmentId===request.params.attachmentId);if(!attachment?.archivedBlob)return reply.status(404).send({error:'Archived file was not found'});const path=join(archiveStoragePath(),safeRelative(archiveStoragePath(),attachment.archivedBlob));reply.header('Content-Type',String(attachment.mimeType));reply.header('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(String(attachment.originalName??attachment.name))}`);return reply.send(createReadStream(path)); } finally { catalog.close(); }
  });
  app.post<{ Params: { archiveId: string } }>('/api/system/archive/documents/:archiveId/restore', async (request, reply) => {
    const actor = requireAdmin(request); const catalog = openCatalog(); try {
      const document = catalog.prepare('SELECT * FROM documents WHERE archiveId=?').get(request.params.archiveId) as { entityName: string; businessKey: string; payloadPath: string; checksum: string } | undefined; if (!document) return reply.status(404).send({ error: 'Archived document was not found' });
      const entity = entityOrThrow(kernel, document.entityName); const bytes = await readFile(join(archiveStoragePath(), safeRelative(archiveStoragePath(), document.payloadPath))); if (createHash('sha256').update(bytes).digest('hex') !== document.checksum) return reply.status(422).send({ error: 'Archived document checksum failed' }); const payload = JSON.parse(bytes.toString('utf8')) as ArchivePayload;
      const ctx = kernel.context({ user: actor }); let query = ctx.select(entity.rootTable); for (const key of entity.businessKey) query = query.where(key, '=', payload.header[key] as any); if (query.firstOnly()) return reply.status(409).send({ restored: false, skipped: true, reason: 'Business key already exists' });
      const result = importEntityDocument(kernel, ctx, entity, payload.header, payload.lines);
      const restoredRootQuery = ctx.select(entity.rootTable); for (const key of entity.businessKey) restoredRootQuery.where(key, '=', payload.header[key] as any); const restoredRoot = restoredRootQuery.firstOnly()!;
      const idMap = new Map<string, number>([[`${entity.rootTable}:${String(payload.header._archiveRecordId)}`, restoredRoot.id!]]);
      for (const source of entity.lines ?? []) for (const oldLine of payload.lines[source.name] ?? []) {
        let lineQuery = ctx.select(source.table).where(source.parentReference, '=', restoredRoot.id!); for (const key of source.lineKeys) lineQuery = lineQuery.where(key, '=', oldLine[key] as any); const restoredLine = lineQuery.firstOnly(); if (restoredLine) idMap.set(`${source.table}:${String(oldLine._archiveRecordId)}`, restoredLine.id!);
      }
      for (const old of payload.attachments ?? []) {
        const parentId = idMap.get(`${String(old.parentTable)}:${String(old.parentId)}`); if (!parentId) continue;
        const now = new Date().toISOString(); const attachmentId = randomUUID(); let blobId: string | null = null;
        if (old.kind === 'file' && old.archivedBlob) {
          const archiveBlob = join(archiveStoragePath(), safeRelative(archiveStoragePath(), String(old.archivedBlob))); const storageKey = `${attachmentId.slice(0,2)}/${randomUUID()}`; const liveRoot = attachmentStoragePath(); const target = resolve(liveRoot, ...storageKey.split('/')); await mkdir(dirname(target), { recursive: true }); await copyFile(archiveBlob, target); blobId = randomUUID();
          kernel.db.prepare(`INSERT INTO "FW_Blob" (createdAt,createdBy,modifiedAt,modifiedBy,blobId,storageKey,originalName,mimeType,bytes,sha256) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(now,actor,now,actor,blobId,storageKey,String(old.originalName ?? old.name),String(old.mimeType),Number(old.bytes),String(old.sha256));
        }
        kernel.db.prepare(`INSERT INTO "FW_Attachment" (createdAt,createdBy,modifiedAt,modifiedBy,attachmentId,parentTable,parentId,kind,name,blobId,text,url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(now,actor,now,actor,attachmentId,String(old.parentTable),parentId,String(old.kind),String(old.name),blobId,old.text ?? null,old.url ?? null);
      }
      catalog.prepare('UPDATE documents SET restoredAt=? WHERE archiveId=?').run(new Date().toISOString(), request.params.archiveId); return { restored: true, skipped: false, attachments: payload.attachments?.length ?? 0, ...result };
    } finally { catalog.close(); }
  });
  app.get('/api/system/storage', async (request) => {
    requireAdmin(request); const dataFile = (kernel.db.pragma('database_list') as Array<{ name: string; file: string }>).find((row) => row.name === 'main')?.file ?? ''; const designerFile = (kernel.designerDb.pragma('database_list') as Array<{ name: string; file: string }>).find((row) => row.name === 'main')?.file ?? '';
    const disk = async (path: string) => { try { const value = await statfs(path); return { total: value.blocks * value.bsize, free: value.bavail * value.bsize }; } catch { return { total: null, free: null }; } };
    const fileBytes = (path: string) => path && existsSync(path) ? statSync(path).size : 0; const files = attachmentStoragePath(); const archive = archiveStoragePath(); const backups = process.env.EMU_BACKUP_DIR ?? '/data/backups';
    let usageByApp: Array<{ app: string; bytes: number; method: 'exact-dbstat'|'logical-estimate' }> = [];
    try { const pages = kernel.db.prepare('SELECT name,SUM(pgsize) bytes FROM dbstat GROUP BY name').all() as Array<{ name: string; bytes: number }>; const pageMap = new Map(pages.map((row) => [row.name, Number(row.bytes)])); const apps = new Map<string, number>(); for (const tableMeta of kernel.registry.allTables()) apps.set(tableMeta.app ?? 'unknown', (apps.get(tableMeta.app ?? 'unknown') ?? 0) + (pageMap.get(tableMeta.name) ?? 0)); usageByApp = [...apps].map(([appName, bytes]) => ({ app: appName, bytes, method: 'exact-dbstat' })); }
    catch { for (const tableMeta of kernel.registry.allTables()) { const count = Number((kernel.db.prepare(`SELECT COUNT(*) count FROM "${tableMeta.name}"`).get() as { count: number }).count); const found = usageByApp.find((entry) => entry.app === (tableMeta.app ?? 'unknown')); if (found) found.bytes += count * 256; else usageByApp.push({ app: tableMeta.app ?? 'unknown', bytes: count * 256, method: 'logical-estimate' }); } }
    return { filesystem: { data: await disk(dirname(dataFile) || '.'), files: await disk(files), archive: await disk(archive) }, usage: { dataDb: fileBytes(dataFile), dataWal: fileBytes(`${dataFile}-wal`), designerDb: fileBytes(designerFile), designerWal: fileBytes(`${designerFile}-wal`), backups: await directorySize(backups), fonts: await directorySize(fontCachePath()), liveFiles: await directorySize(files), archive: await directorySize(archive) }, usageByApp, paths: { files, archive }, warnings: [files === resolve('/data/files') ? 'File storage uses shared fallback /data/files' : null, archive === resolve('/data/archive') ? 'Archive storage uses shared fallback /data/archive' : null].filter(Boolean) };
  });
}
