import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, rename, stat, unlink } from 'node:fs/promises';
import { basename, extname, join, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DataContext, Kernel } from '@emu/core';
import { SecurityError } from '@emu/core';
import { attachmentStoragePath } from './storagePaths.js';

export { attachmentStoragePath } from './storagePaths.js';

type AttachmentKind = 'file' | 'note' | 'url';
interface ParentParams { table: string; id: string }
interface AttachmentParams { attachmentId: string }

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const BUILTIN_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv', 'text/plain', 'image/png', 'image/jpeg',
]);
const MIME_BY_EXTENSION: Record<string, Set<string>> = {
  '.pdf': new Set(['application/pdf']),
  '.docx': new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  '.xlsx': new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
  '.pptx': new Set(['application/vnd.openxmlformats-officedocument.presentationml.presentation']),
  '.csv': new Set(['text/csv', 'text/plain', 'application/csv']),
  '.txt': new Set(['text/plain']),
  '.png': new Set(['image/png']),
  '.jpg': new Set(['image/jpeg']),
  '.jpeg': new Set(['image/jpeg']),
};

function configuredMaxBytes(): number {
  const value = Number(process.env.EMU_ATTACHMENT_MAX_BYTES ?? DEFAULT_MAX_BYTES);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : DEFAULT_MAX_BYTES;
}

function allowedMimeTypes(): Set<string> {
  const configured = process.env.EMU_ATTACHMENT_ALLOWED_TYPES?.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  return configured?.length ? new Set(configured) : BUILTIN_MIME_TYPES;
}

function validateFile(name: string, mimeType: string): void {
  const extension = extname(name).toLowerCase();
  const normalizedMime = mimeType.toLowerCase().split(';', 1)[0]!;
  const extensionTypes = MIME_BY_EXTENSION[extension];
  if (!extensionTypes || !allowedMimeTypes().has(normalizedMime) || !extensionTypes.has(normalizedMime)) {
    throw Object.assign(new Error(`Attachment type '${extension || normalizedMime}' is not allowed`), { statusCode: 415 });
  }
}

function positiveId(raw: string): number {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id < 1) throw Object.assign(new Error('Record id must be a positive integer'), { statusCode: 400 });
  return id;
}

function storageFile(root: string, storageKey: string): string {
  const candidate = resolve(root, ...storageKey.split('/'));
  if (!candidate.startsWith(`${root}${sep}`)) throw new Error('Invalid attachment storage key');
  return candidate;
}

function assertParent(kernel: Kernel, ctx: DataContext, table: string, id: number, operation: 'read' | 'update'): void {
  if (!kernel.registry.hasTable(table) || table.startsWith('FW_')) throw Object.assign(new Error(`Unknown table '${table}'`), { statusCode: 404 });
  if (!ctx.policy.can(table, operation)) throw new SecurityError(`Access denied: ${operation} on '${table}'`);
  const found = kernel.db.prepare(`SELECT id FROM "${table}" WHERE id=?`).get(id);
  if (!found) throw Object.assign(new Error(`${table} record ${id} was not found`), { statusCode: 404 });
}

function attachmentRow(kernel: Kernel, attachmentId: string): Record<string, unknown> {
  const row = kernel.db.prepare(`SELECT a.*, b.storageKey, b.originalName, b.mimeType, b.bytes, b.sha256
    FROM "FW_Attachment" a LEFT JOIN "FW_Blob" b ON b.blobId=a.blobId WHERE a.attachmentId=?`).get(attachmentId) as Record<string, unknown> | undefined;
  if (!row) throw Object.assign(new Error('Attachment was not found'), { statusCode: 404 });
  return row;
}

function publicAttachment(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.attachmentId,
    kind: row.kind,
    name: row.name,
    text: row.kind === 'note' ? row.text : undefined,
    url: row.kind === 'url' ? row.url : undefined,
    mimeType: row.mimeType ?? undefined,
    bytes: row.bytes ?? undefined,
    sha256: row.sha256 ?? undefined,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  };
}

function insertAttachment(kernel: Kernel, username: string, values: {
  attachmentId: string; parentTable: string; parentId: number; kind: AttachmentKind; name: string; blobId?: string; text?: string; url?: string;
}): void {
  const now = new Date().toISOString();
  kernel.db.prepare(`INSERT INTO "FW_Attachment"
    (createdAt,createdBy,modifiedAt,modifiedBy,attachmentId,parentTable,parentId,kind,name,blobId,text,url)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    now, username, now, username, values.attachmentId, values.parentTable, values.parentId,
    values.kind, values.name, values.blobId ?? null, values.text ?? null, values.url ?? null,
  );
}

export function registerAttachmentRoutes(app: FastifyInstance, kernel: Kernel, deps: {
  userCtx: (request: FastifyRequest) => DataContext;
}): void {
  const root = attachmentStoragePath();
  void recoverAttachmentOrphans(kernel, root).catch((error) => app.log.error(error, 'Attachment orphan recovery failed'));

  app.get<{ Params: ParentParams }>('/api/attachments/:table/:id', (request) => {
    const ctx = deps.userCtx(request); const id = positiveId(request.params.id);
    assertParent(kernel, ctx, request.params.table, id, 'read');
    const rows = kernel.db.prepare(`SELECT a.*, b.mimeType, b.bytes, b.sha256 FROM "FW_Attachment" a
      LEFT JOIN "FW_Blob" b ON b.blobId=a.blobId WHERE a.parentTable=? AND a.parentId=? ORDER BY a.createdAt DESC`).all(request.params.table, id) as Record<string, unknown>[];
    return { items: rows.map(publicAttachment) };
  });

  app.post<{ Params: ParentParams }>('/api/attachments/:table/:id/file', async (request, reply) => {
    const ctx = deps.userCtx(request); const id = positiveId(request.params.id);
    assertParent(kernel, ctx, request.params.table, id, 'update');
    const part = await request.file({ limits: { files: 1, fileSize: configuredMaxBytes() } });
    if (!part) return reply.status(400).send({ error: 'A file is required' });
    const originalName = basename(part.filename || 'attachment');
    validateFile(originalName, part.mimetype);
    const blobId = randomUUID(); const attachmentId = randomUUID();
    const storageKey = `${blobId.slice(0, 2)}/${randomUUID()}`;
    const finalPath = storageFile(root, storageKey); const tempPath = `${finalPath}.upload`;
    await mkdir(resolve(finalPath, '..'), { recursive: true });
    const hash = createHash('sha256'); let bytes = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > configuredMaxBytes()) return callback(Object.assign(new Error('Attachment exceeds the configured size limit'), { statusCode: 413 }));
        hash.update(chunk); callback(null, chunk);
      },
    });
    try {
      await pipeline(part.file, meter, createWriteStream(tempPath, { flags: 'wx' }));
      if (part.file.truncated) throw Object.assign(new Error('Attachment exceeds the configured size limit'), { statusCode: 413 });
      await rename(tempPath, finalPath);
      const now = new Date().toISOString();
      kernel.db.exec('BEGIN');
      try {
        kernel.db.prepare(`INSERT INTO "FW_Blob" (createdAt,createdBy,modifiedAt,modifiedBy,blobId,storageKey,originalName,mimeType,bytes,sha256)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(now, ctx.session.user, now, ctx.session.user, blobId, storageKey, originalName, part.mimetype, bytes, hash.digest('hex'));
        insertAttachment(kernel, ctx.session.user, { attachmentId, parentTable: request.params.table, parentId: id, kind: 'file', name: originalName, blobId });
        kernel.db.exec('COMMIT');
      } catch (error) { kernel.db.exec('ROLLBACK'); throw error; }
      return reply.status(201).send({ id: attachmentId, kind: 'file', name: originalName, mimeType: part.mimetype, bytes });
    } catch (error) {
      await unlink(tempPath).catch(() => undefined); await unlink(finalPath).catch(() => undefined); throw error;
    }
  });

  app.post<{ Params: ParentParams; Body: { name?: string; text?: string } }>('/api/attachments/:table/:id/note', (request, reply) => {
    const ctx = deps.userCtx(request); const id = positiveId(request.params.id); assertParent(kernel, ctx, request.params.table, id, 'update');
    const text = String(request.body?.text ?? '').trim(); const name = String(request.body?.name ?? 'Note').trim().slice(0, 255);
    if (!text) return reply.status(400).send({ error: 'Note text is required' });
    const attachmentId = randomUUID(); insertAttachment(kernel, ctx.session.user, { attachmentId, parentTable: request.params.table, parentId: id, kind: 'note', name: name || 'Note', text });
    return reply.status(201).send({ id: attachmentId, kind: 'note', name: name || 'Note', text });
  });

  app.post<{ Params: ParentParams; Body: { name?: string; url?: string } }>('/api/attachments/:table/:id/url', (request, reply) => {
    const ctx = deps.userCtx(request); const id = positiveId(request.params.id); assertParent(kernel, ctx, request.params.table, id, 'update');
    let parsed: URL; try { parsed = new URL(String(request.body?.url ?? '')); } catch { return reply.status(400).send({ error: 'A valid URL is required' }); }
    if (!['http:', 'https:'].includes(parsed.protocol)) return reply.status(400).send({ error: 'Only HTTP and HTTPS URLs are allowed' });
    const name = String(request.body?.name ?? parsed.hostname).trim().slice(0, 255) || parsed.hostname;
    const attachmentId = randomUUID(); insertAttachment(kernel, ctx.session.user, { attachmentId, parentTable: request.params.table, parentId: id, kind: 'url', name, url: parsed.toString() });
    return reply.status(201).send({ id: attachmentId, kind: 'url', name, url: parsed.toString() });
  });

  app.get<{ Params: AttachmentParams }>('/api/attachments/:attachmentId/download', (request, reply) => {
    const ctx = deps.userCtx(request); const row = attachmentRow(kernel, request.params.attachmentId);
    assertParent(kernel, ctx, String(row.parentTable), Number(row.parentId), 'read');
    if (row.kind !== 'file' || !row.storageKey) return reply.status(409).send({ error: 'This attachment is not a file' });
    const path = storageFile(root, String(row.storageKey));
    if (!existsSync(path)) return reply.status(410).send({ error: 'Attachment content is missing; contact an administrator' });
    reply.header('Content-Type', String(row.mimeType));
    reply.header('Content-Length', String(row.bytes));
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(String(row.originalName))}`);
    return reply.send(createReadStream(path));
  });

  app.delete<{ Params: AttachmentParams }>('/api/attachments/:attachmentId', async (request) => {
    const ctx = deps.userCtx(request); const row = attachmentRow(kernel, request.params.attachmentId);
    assertParent(kernel, ctx, String(row.parentTable), Number(row.parentId), 'update');
    kernel.db.exec('BEGIN');
    try {
      kernel.db.prepare('DELETE FROM "FW_Attachment" WHERE attachmentId=?').run(request.params.attachmentId);
      if (row.blobId) kernel.db.prepare('DELETE FROM "FW_Blob" WHERE blobId=? AND NOT EXISTS (SELECT 1 FROM "FW_Attachment" WHERE blobId=?)').run(row.blobId, row.blobId);
      kernel.db.exec('COMMIT');
    } catch (error) { kernel.db.exec('ROLLBACK'); throw error; }
    if (row.storageKey) await unlink(storageFile(root, String(row.storageKey))).catch(() => undefined);
    return { ok: true };
  });
}

/** Remove interrupted uploads and catalog rows whose content disappeared. This
 * is deliberately conservative: live catalog entries are never removed merely
 * because a directory scan could not complete. */
export async function recoverAttachmentOrphans(kernel: Kernel, root = attachmentStoragePath()): Promise<{ uploads: number; missing: number; untracked: number; dangling: number }> {
  let uploads = 0; let missing = 0; let untracked = 0; let dangling = 0;
  await mkdir(root, { recursive: true });
  const references = kernel.db.prepare('SELECT attachmentId,parentTable,parentId,blobId FROM "FW_Attachment"').all() as Array<{ attachmentId: string; parentTable: string; parentId: number; blobId?: string }>;
  for (const reference of references) {
    const exists = kernel.registry.hasTable(reference.parentTable) && Boolean(kernel.db.prepare(`SELECT id FROM "${reference.parentTable}" WHERE id=?`).get(reference.parentId));
    if (exists) continue;
    const blob = reference.blobId ? kernel.db.prepare('SELECT storageKey FROM "FW_Blob" WHERE blobId=?').get(reference.blobId) as { storageKey?: string } | undefined : undefined;
    kernel.db.prepare('DELETE FROM "FW_Attachment" WHERE attachmentId=?').run(reference.attachmentId);
    if (reference.blobId) kernel.db.prepare('DELETE FROM "FW_Blob" WHERE blobId=? AND NOT EXISTS (SELECT 1 FROM "FW_Attachment" WHERE blobId=?)').run(reference.blobId, reference.blobId);
    if (blob?.storageKey) await unlink(storageFile(root, blob.storageKey)).catch(() => undefined);
    dangling += 1;
  }
  const blobs = kernel.db.prepare('SELECT blobId,storageKey FROM "FW_Blob"').all() as Array<{ blobId: string; storageKey: string }>;
  const tracked = new Set(blobs.map((blob) => blob.storageKey.replace(/\\/g, '/')));
  for (const directory of await readdir(root, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    for (const file of await readdir(join(root, directory.name), { withFileTypes: true })) {
      if (file.isFile() && file.name.endsWith('.upload')) { await unlink(join(root, directory.name, file.name)); uploads += 1; }
      else if (file.isFile() && !tracked.has(`${directory.name}/${file.name}`)) { await unlink(join(root, directory.name, file.name)); untracked += 1; }
    }
  }
  for (const blob of blobs) {
    try { await stat(storageFile(root, blob.storageKey)); } catch {
      kernel.db.prepare('DELETE FROM "FW_Attachment" WHERE blobId=?').run(blob.blobId);
      kernel.db.prepare('DELETE FROM "FW_Blob" WHERE blobId=?').run(blob.blobId);
      missing += 1;
    }
  }
  return { uploads, missing, untracked, dangling };
}

export async function deleteRecordAttachments(kernel: Kernel, parentTable: string, parentId: number): Promise<void> {
  const rows = kernel.db.prepare(`SELECT a.blobId,b.storageKey FROM "FW_Attachment" a LEFT JOIN "FW_Blob" b ON b.blobId=a.blobId WHERE a.parentTable=? AND a.parentId=?`).all(parentTable, parentId) as Array<{ blobId?: string; storageKey?: string }>;
  kernel.db.prepare('DELETE FROM "FW_Attachment" WHERE parentTable=? AND parentId=?').run(parentTable, parentId);
  for (const row of rows) {
    if (row.blobId) kernel.db.prepare('DELETE FROM "FW_Blob" WHERE blobId=? AND NOT EXISTS (SELECT 1 FROM "FW_Attachment" WHERE blobId=?)').run(row.blobId, row.blobId);
    if (row.storageKey) await unlink(storageFile(attachmentStoragePath(), row.storageKey)).catch(() => undefined);
  }
}
