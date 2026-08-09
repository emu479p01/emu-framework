import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import DatabaseCtor from 'better-sqlite3';
import { CORE_VERSION, type Kernel } from '@emu/core';
import { fontCachePath } from './fontManager.js';

const BACKUP_FORMAT = 'emuframework-backup';
const BACKUP_SCHEMA_VERSION = 3;
const MAX_BACKUP_BYTES = 512 * 1024 * 1024;
const REPOSITORY = 'emu479p01/emu-framework';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

export type BackupComponent = 'full' | 'data' | 'designer' | 'fonts';

interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  frameworkVersion: string;
  createdAt: string;
  components?: Exclude<BackupComponent, 'full'>[];
  files: { name: string; sha256: string; bytes: number }[];
}

export interface RestoreJob {
  id: string;
  status: 'pending' | 'running' | 'restarting' | 'succeeded' | 'failed';
  components: Exclude<BackupComponent, 'full'>[];
  requestedBy: string;
  requestedAt: string;
  updatedAt: string;
  deployment: UpdateJob['deployment'];
  stagePath: string;
  error?: string;
}

type RestorePreview = { actor: string; expiresAt: number; manifest: BackupManifest; files: Record<string, Uint8Array>; components: Exclude<BackupComponent, 'full'>[] };
const restorePreviews = new Map<string, RestorePreview>();

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

function restoreStatePath(): string {
  return process.env.EMU_RESTORE_STATE_PATH ?? (deploymentMode() === 'docker' ? '/data/restore-status.json' : join(root, 'backups', 'restore-status.json'));
}

function restoreStageDir(): string {
  return process.env.EMU_RESTORE_STAGE_DIR ?? join(backupDir(), 'restore-jobs');
}

function dataDbPath(): string { return process.env.EMU_DB_PATH ?? join(root, 'data.db'); }
function designerDbPath(): string { return process.env.EMU_DESIGNER_DB_PATH ?? join(root, 'designer.db'); }

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

async function readRestoreJob(): Promise<RestoreJob | null> {
  try { return JSON.parse(await readFile(restoreStatePath(), 'utf8')) as RestoreJob; } catch { return null; }
}

async function writeRestoreJob(job: RestoreJob): Promise<void> {
  await mkdir(dirname(restoreStatePath()), { recursive: true });
  await writeFile(restoreStatePath(), JSON.stringify(job, null, 2), 'utf8');
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

async function createBackupArchive(kernel: Kernel, output?: string, component: BackupComponent = 'full'): Promise<{ archive: Buffer; manifest: BackupManifest }> {
  const dir = await mkdtemp(join(tmpdir(), 'emu-backup-'));
  try {
    const components: Exclude<BackupComponent, 'full'>[] = component === 'full' ? ['data', 'designer', 'fonts'] : [component];
    const payload: Record<string, Uint8Array> = {};
    if (components.includes('data')) {
      const path = join(dir, 'data.db'); await kernel.db.backup(path); payload['data.db'] = new Uint8Array(await readFile(path));
    }
    if (components.includes('designer')) {
      const path = join(dir, 'designer.db'); await kernel.designerDb.backup(path); payload['designer.db'] = new Uint8Array(await readFile(path));
    }
    const collectFonts = async (directory: string, prefix = 'fonts'): Promise<void> => {
      if (!existsSync(directory)) return;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const full = join(directory, entry.name); const name = `${prefix}/${entry.name}`;
        if (entry.isDirectory()) await collectFonts(full, name);
        else if (entry.isFile()) payload[name] = new Uint8Array(await readFile(full));
      }
    };
    if (components.includes('fonts')) await collectFonts(fontCachePath());
    const manifest: BackupManifest = {
      format: BACKUP_FORMAT, schemaVersion: BACKUP_SCHEMA_VERSION, frameworkVersion: CORE_VERSION,
      createdAt: new Date().toISOString(), components,
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

async function validateArchive(buffer: Buffer): Promise<{ manifest: BackupManifest; files: Record<string, Uint8Array>; components: Exclude<BackupComponent, 'full'>[] }> {
  if (buffer.length > MAX_BACKUP_BYTES) throw new Error('Backup exceeds the 512 MB safety limit');
  const files = unzipSync(buffer);
  for (const name of Object.keys(files)) if ((name !== 'manifest.json' && name !== 'data.db' && name !== 'designer.db' && !/^fonts\/[A-Za-z0-9 _-]+\/[A-Za-z0-9._-]+$/.test(name)) || name.includes('..') || name.includes('\\')) throw new Error('Backup contains an unsafe file path');
  if (!files['manifest.json']) throw new Error('Backup is missing manifest.json');
  let manifest: BackupManifest;
  try { manifest = JSON.parse(strFromU8(files['manifest.json'])) as BackupManifest; }
  catch { throw new Error('Backup manifest is invalid JSON'); }
  if (manifest.format !== BACKUP_FORMAT || ![1, 2, BACKUP_SCHEMA_VERSION].includes(manifest.schemaVersion)) throw new Error('Unsupported backup format');
  if (compareVersions(manifest.frameworkVersion, CORE_VERSION) > 0) throw new Error(`Backup requires newer framework ${manifest.frameworkVersion}`);
  const components: Exclude<BackupComponent, 'full'>[] = manifest.schemaVersion < 3
    ? ['data', 'designer', 'fonts']
    : [...new Set(manifest.components ?? [])].filter((item): item is Exclude<BackupComponent, 'full'> => ['data', 'designer', 'fonts'].includes(item));
  if (!components.length) throw new Error('Backup does not declare any components');
  if (components.includes('data') && !files['data.db']) throw new Error('Backup is missing data.db');
  if (components.includes('designer') && !files['designer.db']) throw new Error('Backup is missing designer.db');
  for (const entry of manifest.files) {
    const data = files[entry.name];
    if (!data || data.length !== entry.bytes || sha256(data) !== entry.sha256) throw new Error(`Checksum failed for ${entry.name}`);
  }
  const payloadNames = Object.keys(files).filter((name) => name !== 'manifest.json');
  const declaredNames = new Set(manifest.files.map((entry) => entry.name));
  if (payloadNames.length !== declaredNames.size || payloadNames.some((name) => !declaredNames.has(name))) throw new Error('Backup files do not match its manifest');
  if (!components.includes('data') && files['data.db']) throw new Error('Backup contains undeclared Data component');
  if (!components.includes('designer') && files['designer.db']) throw new Error('Backup contains undeclared Designer component');
  if (!components.includes('fonts') && payloadNames.some((name) => name.startsWith('fonts/'))) throw new Error('Backup contains undeclared Fonts component');
  const dir = await mkdtemp(join(tmpdir(), 'emu-validate-'));
  try {
    for (const name of ['data.db', 'designer.db']) {
      if (!files[name]) continue;
      const path = join(dir, name); await writeFile(path, files[name]);
      const db = new DatabaseCtor(path, { readonly: true });
      try {
        const result = db.pragma('integrity_check') as { integrity_check: string }[];
        if (!result.length || result.some((row) => row.integrity_check !== 'ok')) throw new Error(`SQLite integrity check failed for ${name}`);
      } finally { db.close(); }
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
  return { manifest: { ...manifest, components }, files, components };
}

async function launchRestore(job: RestoreJob): Promise<void> {
  if (job.deployment === 'docker') {
    const url = process.env.EMU_UPDATER_URL; const token = process.env.EMU_UPDATER_TOKEN;
    if (!url || !token) throw new Error('Docker restore coordinator is not configured');
    const response = await fetch(`${url.replace(/\/$/, '')}/restore`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: job.id, stagePath: job.stagePath, components: job.components }), signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Docker updater rejected restore (HTTP ${response.status})`);
    return;
  }
  if (job.deployment === 'windows') {
    const script = join(root, 'scripts', 'restore-coordinator.mjs');
    if (!existsSync(script)) throw new Error('Restore coordinator is missing');
    const child = spawn(process.execPath, [script, '--job', restoreStatePath(), '--stage', job.stagePath, '--data', dataDbPath(), '--designer', designerDbPath(), '--fonts', fontCachePath(), '--root', root], {
      cwd: root, detached: true, stdio: 'ignore', windowsHide: true,
    });
    child.unref(); return;
  }
  throw new Error('Web restore is not supported on this deployment');
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
    await validateArchive(archive);
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

  app.get<{ Querystring: { component?: BackupComponent } }>('/api/system/backup/export', async (req, reply) => {
    requireFrameworkAdmin(req);
    const component = req.query.component ?? 'full';
    if (!['full', 'data', 'designer', 'fonts'].includes(component)) return reply.status(400).send({ error: 'Invalid backup component' });
    const { archive } = await createBackupArchive(kernel, undefined, component);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="emuframework-${component}-${CORE_VERSION}-${stamp}.emubackup"`);
    return reply.send(archive);
  });

  app.post('/api/system/backup/validate', async (req, reply) => {
    requireFrameworkAdmin(req);
    const file = await req.file({ limits: { fileSize: MAX_BACKUP_BYTES } });
    if (!file) return reply.status(400).send({ error: 'No backup uploaded' });
    try { return { ok: true, manifest: (await validateArchive(await file.toBuffer())).manifest }; }
    catch (error) { return reply.status(422).send({ error: error instanceof Error ? error.message : String(error) }); }
  });

  app.post('/api/system/backup/restore/preview', async (req, reply) => {
    const actor = requireFrameworkAdmin(req);
    const file = await req.file({ limits: { fileSize: MAX_BACKUP_BYTES } });
    if (!file) return reply.status(400).send({ error: 'No backup uploaded' });
    try {
      const parsed = await validateArchive(await file.toBuffer());
      const previewId = randomUUID(); const expiresAt = Date.now() + 10 * 60_000;
      restorePreviews.set(previewId, { actor, expiresAt, ...parsed });
      return {
        previewId, expiresAt: new Date(expiresAt).toISOString(), manifest: parsed.manifest, components: parsed.components,
        warnings: parsed.components.includes('data') ? ['Restoring Data also restores users, security, and sessions. You may need to sign in with credentials from the backup.'] : [],
      };
    } catch (error) { return reply.status(422).send({ error: error instanceof Error ? error.message : String(error) }); }
  });

  app.post<{ Body: { previewId?: string; confirmation?: string } }>('/api/system/backup/restore', async (req, reply) => {
    const actor = requireFrameworkAdmin(req);
    if (req.body?.confirmation !== 'RESTORE') return reply.status(400).send({ error: "Type 'RESTORE' to confirm" });
    const preview = req.body?.previewId ? restorePreviews.get(req.body.previewId) : undefined;
    if (!preview || preview.expiresAt < Date.now()) return reply.status(410).send({ error: 'Restore preview expired; upload the backup again' });
    if (preview.actor !== actor) return reply.status(403).send({ error: 'Restore preview belongs to another user' });
    const existing = await readRestoreJob();
    if (existing && ['pending', 'running', 'restarting'].includes(existing.status)) return reply.status(409).send({ error: 'A restore is already running', job: existing });
    const id = randomUUID(); const stagePath = join(restoreStageDir(), id); await mkdir(stagePath, { recursive: true });
    for (const [name, bytes] of Object.entries(preview.files)) {
      if (name === 'manifest.json') continue;
      const target = join(stagePath, ...name.split('/')); await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes);
    }
    const now = new Date().toISOString();
    const job: RestoreJob = { id, status: 'pending', components: preview.components, requestedBy: actor, requestedAt: now, updatedAt: now, deployment: deploymentMode(), stagePath };
    await writeRestoreJob(job); restorePreviews.delete(req.body.previewId!);
    try { await launchRestore(job); }
    catch (error) {
      job.status = 'failed'; job.updatedAt = new Date().toISOString(); job.error = error instanceof Error ? error.message : String(error); await writeRestoreJob(job);
      return reply.status(503).send({ error: job.error, job });
    }
    if (job.deployment === 'windows') setTimeout(() => { void app.close().finally(() => process.exit(0)); }, 750).unref();
    return reply.status(202).send({ job });
  });

  app.get('/api/system/backup/restore/status', async (req) => {
    requireFrameworkAdmin(req); return { job: await readRestoreJob() };
  });
}
