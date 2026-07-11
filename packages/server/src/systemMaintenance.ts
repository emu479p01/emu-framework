import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import { CORE_VERSION, type Kernel } from '@emu/core';

const BACKUP_FORMAT = 'emuframework-backup';
const BACKUP_SCHEMA_VERSION = 1;
const MAX_BACKUP_BYTES = 512 * 1024 * 1024;

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  frameworkVersion: string;
  createdAt: string;
  files: { name: 'data.db' | 'designer.db'; sha256: string; bytes: number }[];
}

function validateArchive(buffer: Buffer): { manifest: BackupManifest; files: Record<string, Uint8Array> } {
  if (buffer.length > MAX_BACKUP_BYTES) throw new Error('Backup exceeds the 512 MB safety limit');
  const files = unzipSync(buffer);
  const allowed = new Set(['manifest.json', 'data.db', 'designer.db']);
  for (const name of Object.keys(files)) {
    if (!allowed.has(name) || name.includes('..') || name.includes('/') || name.includes('\\')) throw new Error('Backup contains an unsafe file path');
  }
  if (!files['manifest.json'] || !files['data.db'] || !files['designer.db']) throw new Error('Backup is missing required files');
  let manifest: BackupManifest;
  try { manifest = JSON.parse(strFromU8(files['manifest.json'])) as BackupManifest; }
  catch { throw new Error('Backup manifest is invalid JSON'); }
  if (manifest.format !== BACKUP_FORMAT || manifest.schemaVersion !== BACKUP_SCHEMA_VERSION) throw new Error('Unsupported backup format');
  for (const entry of manifest.files) {
    const data = files[entry.name];
    if (!data || data.length !== entry.bytes || sha256(data) !== entry.sha256) throw new Error(`Checksum failed for ${entry.name}`);
  }
  return { manifest, files };
}

export function registerSystemMaintenanceRoutes(
  app: FastifyInstance,
  kernel: Kernel,
  requireFrameworkAdmin: (req: FastifyRequest) => string,
): void {
  app.get('/api/system/info', (req) => {
    requireFrameworkAdmin(req);
    return { version: CORE_VERSION, backupSchemaVersion: BACKUP_SCHEMA_VERSION, updateChannel: 'stable' };
  });

  app.get('/api/system/backup/export', async (req, reply) => {
    requireFrameworkAdmin(req);
    const dir = await mkdtemp(join(tmpdir(), 'emu-backup-'));
    try {
      const dataPath = join(dir, 'data.db');
      const designerPath = join(dir, 'designer.db');
      await kernel.db.backup(dataPath);
      await kernel.designerDb.backup(designerPath);
      const data = new Uint8Array(await readFile(dataPath));
      const designer = new Uint8Array(await readFile(designerPath));
      const manifest: BackupManifest = {
        format: BACKUP_FORMAT,
        schemaVersion: BACKUP_SCHEMA_VERSION,
        frameworkVersion: CORE_VERSION,
        createdAt: new Date().toISOString(),
        files: [
          { name: 'data.db', sha256: sha256(data), bytes: data.length },
          { name: 'designer.db', sha256: sha256(designer), bytes: designer.length },
        ],
      };
      const archive = zipSync({
        'manifest.json': new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
        'data.db': data,
        'designer.db': designer,
      }, { level: 6 });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="emuframework-${CORE_VERSION}-${stamp}.emubackup"`);
      return reply.send(Buffer.from(archive));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  app.post('/api/system/backup/validate', async (req, reply) => {
    requireFrameworkAdmin(req);
    const file = await req.file({ limits: { fileSize: MAX_BACKUP_BYTES } });
    if (!file) return reply.status(400).send({ error: 'No backup uploaded' });
    try {
      const { manifest } = validateArchive(await file.toBuffer());
      return { ok: true, manifest };
    } catch (error) {
      return reply.status(422).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
