import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import { CORE_VERSION, type Kernel } from '@emu/core';
import { fontCachePath } from './fontManager.js';

const BACKUP_FORMAT = 'emuframework-backup';
const BACKUP_SCHEMA_VERSION = 2;
const MAX_BACKUP_BYTES = 512 * 1024 * 1024;
const REPOSITORY = 'emu479p01/emu-framework';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  frameworkVersion: string;
  createdAt: string;
  files: { name: string; sha256: string; bytes: number }[];
}

export interface UpdateJob {
  id: string;
  status: 'pending' | 'running' | 'restarting' | 'succeeded' | 'failed';
  currentVersion: string;
  targetVersion: string;
  requestedBy: string;
  requestedAt: string;
  updatedAt: string;
  backupPath: string;
  deployment: 'windows' | 'docker' | 'unsupported';
  error?: string;
}

interface GitHubRelease {
  tag_name: string;
  name?: string;
  body?: string;
  html_url: string;
  published_at?: string;
  prerelease?: boolean;
  draft?: boolean;
}

function deploymentMode(): UpdateJob['deployment'] {
  if (process.env.EMU_DEPLOYMENT_MODE === 'docker') return 'docker';
  if (process.env.EMU_DEPLOYMENT_MODE === 'windows' || process.platform === 'win32') return 'windows';
  return 'unsupported';
}

function statePath(): string {
  return process.env.EMU_UPDATE_STATE_PATH ?? (deploymentMode() === 'docker' ? '/data/update-status.json' : join(root, 'backups', 'update-status.json'));
}

function backupDir(): string {
  return process.env.EMU_BACKUP_DIR ?? (deploymentMode() === 'docker' ? '/data/backups' : join(root, 'backups'));
}

function cleanVersion(value: string): string {
  return value.replace(/^[vV]/, '');
}

function compareVersions(left: string, right: string): number {
  const a = cleanVersion(left).split('.').map(Number);
  const b = cleanVersion(right).split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function publicJob(job: UpdateJob): UpdateJob {
  return { ...job, error: job.error?.slice(0, 500) };
}

async function readJob(): Promise<UpdateJob | null> {
  try { return JSON.parse(await readFile(statePath(), 'utf8')) as UpdateJob; }
  catch { return null; }
}

async function writeJob(job: UpdateJob): Promise<void> {
  await mkdir(dirname(statePath()), { recursive: true });
  await writeFile(statePath(), JSON.stringify(job, null, 2), 'utf8');
}

async function latestRelease(): Promise<GitHubRelease> {
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `EmuFramework/${CORE_VERSION}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw Object.assign(new Error(`Release service returned HTTP ${response.status}`), { statusCode: 502 });
  const release = await response.json() as GitHubRelease;
  if (!release.tag_name || release.draft || release.prerelease) throw Object.assign(new Error('No stable release is available'), { statusCode: 502 });
  return release;
}

async function createBackupArchive(kernel: Kernel, output?: string): Promise<{ archive: Buffer; manifest: BackupManifest }> {
  const dir = await mkdtemp(join(tmpdir(), 'emu-backup-'));
  try {
    const dataPath = join(dir, 'data.db');
    const designerPath = join(dir, 'designer.db');
    await kernel.db.backup(dataPath);
    await kernel.designerDb.backup(designerPath);
    const data = new Uint8Array(await readFile(dataPath));
    const designer = new Uint8Array(await readFile(designerPath));
    const payload: Record<string, Uint8Array> = { 'data.db': data, 'designer.db': designer };
    const collectFonts = async (directory: string, prefix = 'fonts'): Promise<void> => {
      if (!existsSync(directory)) return;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const full = join(directory, entry.name); const name = `${prefix}/${entry.name}`;
        if (entry.isDirectory()) await collectFonts(full, name);
        else if (entry.isFile()) payload[name] = new Uint8Array(await readFile(full));
      }
    };
    await collectFonts(fontCachePath());
    const manifest: BackupManifest = {
      format: BACKUP_FORMAT, schemaVersion: BACKUP_SCHEMA_VERSION, frameworkVersion: CORE_VERSION,
      createdAt: new Date().toISOString(),
      files: Object.entries(payload).map(([name, bytes]) => ({ name, sha256: sha256(bytes), bytes: bytes.length })),
    };
    const archive = Buffer.from(zipSync({
      'manifest.json': new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
      ...payload,
    }, { level: 6 }));
    if (output) { await mkdir(dirname(output), { recursive: true }); await writeFile(output, archive); }
    return { archive, manifest };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

function validateArchive(buffer: Buffer): { manifest: BackupManifest; files: Record<string, Uint8Array> } {
  if (buffer.length > MAX_BACKUP_BYTES) throw new Error('Backup exceeds the 512 MB safety limit');
  const files = unzipSync(buffer);
  for (const name of Object.keys(files)) if ((name !== 'manifest.json' && name !== 'data.db' && name !== 'designer.db' && !/^fonts\/[A-Za-z0-9 _-]+\/[A-Za-z0-9._-]+$/.test(name)) || name.includes('..') || name.includes('\\')) throw new Error('Backup contains an unsafe file path');
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

async function launchUpdate(job: UpdateJob): Promise<void> {
  if (job.deployment === 'windows') {
    const script = join(root, 'scripts', 'update-framework.ps1');
    if (!existsSync(script)) throw new Error('Windows updater script is missing');
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Version', job.targetVersion, '-StatusPath', statePath(), '-JobId', job.id], {
      cwd: root, detached: true, stdio: 'ignore', windowsHide: true,
    });
    child.unref();
    return;
  }
  if (job.deployment === 'docker') {
    const url = process.env.EMU_UPDATER_URL;
    const token = process.env.EMU_UPDATER_TOKEN;
    if (!url || !token) throw new Error('Docker updater is not configured');
    const response = await fetch(`${url.replace(/\/$/, '')}/update`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: job.id, version: job.targetVersion, backupPath: job.backupPath }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Docker updater rejected the job (HTTP ${response.status})`);
    return;
  }
  throw new Error('Web updates are not supported on this deployment');
}

export function registerSystemMaintenanceRoutes(app: FastifyInstance, kernel: Kernel, requireFrameworkAdmin: (req: FastifyRequest) => string): void {
  app.get('/api/system/info', async (req) => {
    requireFrameworkAdmin(req);
    return { version: CORE_VERSION, backupSchemaVersion: BACKUP_SCHEMA_VERSION, updateChannel: 'stable', deployment: deploymentMode(), updateEnabled: deploymentMode() !== 'unsupported', job: await readJob() };
  });

  app.get('/api/system/update/latest', async (req) => {
    requireFrameworkAdmin(req);
    const release = await latestRelease();
    const version = cleanVersion(release.tag_name);
    return { currentVersion: CORE_VERSION, latestVersion: version, updateAvailable: compareVersions(version, CORE_VERSION) > 0, name: release.name ?? release.tag_name, notes: (release.body ?? '').slice(0, 10_000), url: release.html_url, publishedAt: release.published_at ?? null, checkedAt: new Date().toISOString() };
  });

  app.get('/api/system/update/status', async (req) => {
    requireFrameworkAdmin(req);
    return { job: await readJob() };
  });

  app.post('/api/system/update', async (req, reply) => {
    const requestedBy = requireFrameworkAdmin(req);
    const existing = await readJob();
    if (existing && ['pending', 'running', 'restarting'].includes(existing.status)) return reply.status(409).send({ error: 'A framework update is already running', job: publicJob(existing) });
    const release = await latestRelease();
    const targetVersion = cleanVersion(release.tag_name);
    if (compareVersions(targetVersion, CORE_VERSION) <= 0) return reply.status(409).send({ error: 'The framework is already up to date' });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = join(backupDir(), `before-update-${CORE_VERSION}-${stamp}.emubackup`);
    const { archive } = await createBackupArchive(kernel, backupPath);
    validateArchive(archive);
    const now = new Date().toISOString();
    const job: UpdateJob = { id: randomUUID(), status: 'pending', currentVersion: CORE_VERSION, targetVersion, requestedBy, requestedAt: now, updatedAt: now, backupPath, deployment: deploymentMode() };
    await writeJob(job);
    try { await launchUpdate(job); }
    catch (error) {
      job.status = 'failed'; job.updatedAt = new Date().toISOString(); job.error = error instanceof Error ? error.message : 'Could not start updater';
      await writeJob(job);
      throw Object.assign(error instanceof Error ? error : new Error(job.error), { statusCode: 503 });
    }
    return reply.status(202).send({ job: publicJob(job) });
  });

  app.get('/api/system/backup/export', async (req, reply) => {
    requireFrameworkAdmin(req);
    const { archive } = await createBackupArchive(kernel);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="emuframework-${CORE_VERSION}-${stamp}.emubackup"`);
    return reply.send(archive);
  });

  app.post('/api/system/backup/validate', async (req, reply) => {
    requireFrameworkAdmin(req);
    const file = await req.file({ limits: { fileSize: MAX_BACKUP_BYTES } });
    if (!file) return reply.status(400).send({ error: 'No backup uploaded' });
    try { return { ok: true, manifest: validateArchive(await file.toBuffer()).manifest }; }
    catch (error) { return reply.status(422).send({ error: error instanceof Error ? error.message : String(error) }); }
  });
}
