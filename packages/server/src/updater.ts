import http from 'node:http';
import { copyFile, cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { interruptedRestoreAction, isStableVersion, mergeContainerEnvironment, updateChangedState, type UpdaterPhase } from './updaterState.js';

type JobStatus = 'pending' | 'running' | 'restarting' | 'succeeded' | 'failed';
type RollbackStatus = 'not_required' | 'running' | 'succeeded' | 'failed';
type JobPhase = UpdaterPhase;

interface JobState {
  id: string;
  status: JobStatus;
  phase?: JobPhase;
  rollbackStatus?: RollbackStatus;
  recoveryRequired?: boolean;
  recoveryPath?: string;
  updatedAt?: string;
  error?: string;
  [key: string]: unknown;
}

interface UpdateRequest { jobId: string; version: string; backupPath?: string }
type RestoreComponent = 'data' | 'designer' | 'fonts' | 'files' | 'archive';
interface RestoreRequest { jobId: string; stagePath: string; components: RestoreComponent[] }
interface ContainerInfo {
  Config: Record<string, unknown> & { Image?: string; Env?: string[]; Labels?: Record<string, string> };
  HostConfig: Record<string, unknown>;
  NetworkSettings: { Networks: Record<string, Record<string, unknown>> };
  State?: { Running?: boolean; Status?: string; Health?: { Status?: string } };
  Mounts?: Array<{ Destination: string; Name?: string; Source?: string; Type?: string }>;
}
interface ImageInfo { Config: Record<string, unknown> & { Env?: string[]; Labels?: Record<string, string> } }
interface SnapshotManifest { entries: Array<{ name: string; root?: 'data' | 'files' | 'archive'; kind: 'file' | 'directory'; existed: boolean }> }

const token = process.env.EMU_UPDATER_TOKEN;
const imageRepository = process.env.EMU_IMAGE_REPOSITORY ?? 'ghcr.io/emu479p01/emu-framework';
const appContainer = process.env.EMU_APP_CONTAINER ?? 'emuframework-app';
const dataRoot = resolve(process.env.EMU_DATA_PATH ?? '/data');
const filesRoot = resolve(process.env.EMU_FILE_STORAGE_PATH ?? join(dataRoot, 'files'));
const archiveRoot = resolve(process.env.EMU_ARCHIVE_STORAGE_PATH ?? join(dataRoot, 'archive'));
const statePath = process.env.EMU_UPDATE_STATE_PATH ?? join(dataRoot, 'update-status.json');
const restoreStatePath = process.env.EMU_RESTORE_STATE_PATH ?? join(dataRoot, 'restore-status.json');
const pullPolicy = process.env.EMU_UPDATER_PULL_POLICY === 'never' ? 'never' : 'always';
const localImage = process.env.EMU_UPDATER_LOCAL_IMAGE;

if (!token || token.length < 24) throw new Error('EMU_UPDATER_TOKEN must contain at least 24 characters');

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function insideDataRoot(path: string): boolean {
  const rel = relative(dataRoot, resolve(path));
  return rel !== '' && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\');
}

function rootFor(entry: SnapshotManifest['entries'][number]): string {
  if (entry.root === 'files') return filesRoot;
  if (entry.root === 'archive') return archiveRoot;
  return dataRoot;
}

async function clearDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
  for (const entry of await readdir(path)) await rm(join(path, entry), { recursive: true, force: true });
}

function mountIdentity(info: ContainerInfo, destination: string): string | null {
  const mount = info.Mounts?.find((item) => resolve(item.Destination) === resolve(destination));
  return mount ? `${mount.Type ?? ''}:${mount.Name ?? mount.Source ?? ''}` : null;
}

/** A newly introduced persistent path must be mounted into both containers
 * from the same source. This runs before stopApp so a topology mistake cannot
 * turn an update into data loss. Legacy /data/files and /data/archive layouts
 * intentionally remain valid and require no additional mount. */
async function assertMountContinuity(appInfo: ContainerInfo): Promise<void> {
  const configured = [
    process.env.EMU_FILE_STORAGE_PATH ? filesRoot : null,
    process.env.EMU_ARCHIVE_STORAGE_PATH ? archiveRoot : null,
  ].filter((path): path is string => Boolean(path) && !insideDataRoot(path!));
  if (!configured.length) return;
  const updaterInfo = await containerInfo(process.env.HOSTNAME ?? '');
  if (!updaterInfo) throw new Error('Cannot verify updater mounts; application was not stopped');
  for (const destination of configured) {
    const appMount = mountIdentity(appInfo, destination);
    const updaterMount = mountIdentity(updaterInfo, destination);
    if (!appMount || appMount !== updaterMount) throw new Error(`Persistent mount '${destination}' is missing or differs between app and updater; application was not stopped`);
  }
}

function docker<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  return new Promise((resolvePromise, reject) => {
    const request = http.request({
      socketPath: '/var/run/docker.sock', method, path,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if ((response.statusCode ?? 500) >= 300) {
          reject(new Error(`Docker API ${method} ${path} returned ${response.statusCode}: ${text.slice(0, 300)}`));
          return;
        }
        if (!text) { resolvePromise(undefined as T); return; }
        try { resolvePromise(JSON.parse(text) as T); } catch { resolvePromise(text as T); }
      });
    });
    request.on('error', reject);
    if (body) request.end(JSON.stringify(body)); else request.end();
  });
}

async function readState(path: string): Promise<JobState | null> {
  try { return JSON.parse(await readFile(path, 'utf8')) as JobState; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function writeState(path: string, state: JobState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2), 'utf8');
  await rename(temporary, path);
}

async function patchState(path: string, jobId: string, patch: Partial<JobState>): Promise<void> {
  const state = await readState(path);
  if (!state || state.id !== jobId) throw new Error('Job no longer matches shared state');
  const next: JobState = { ...state, ...patch, updatedAt: new Date().toISOString() };
  if (patch.error) next.error = String(patch.error).slice(0, 500);
  await writeState(path, next);
}

async function containerInfo(name: string): Promise<ContainerInfo | null> {
  return docker<ContainerInfo>('GET', `/containers/${encodeURIComponent(name)}/json`).catch(() => null);
}

async function stopApp(): Promise<void> {
  const before = await containerInfo(appContainer);
  if (before?.State?.Running) await docker('POST', `/containers/${encodeURIComponent(appContainer)}/stop?t=30`);
  const after = await containerInfo(appContainer);
  if (after?.State?.Running) throw new Error('Application container did not stop; persistent files were not changed');
}

async function startContainer(name: string): Promise<void> {
  const info = await containerInfo(name);
  if (!info) throw new Error(`Container '${name}' does not exist`);
  if (!info.State?.Running) await docker('POST', `/containers/${encodeURIComponent(name)}/start`);
}

async function waitHealthy(name: string): Promise<void> {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const info = await containerInfo(name);
    if (!info) throw new Error(`Container '${name}' disappeared during health verification`);
    if (info.State?.Health?.Status === 'healthy' || (!info.State?.Health && info.State?.Running)) return;
    if (info.State?.Status === 'exited' || info.State?.Health?.Status === 'unhealthy') throw new Error(`Container '${name}' failed its health check`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
  }
  throw new Error(`Container '${name}' did not become healthy in time`);
}

async function snapshot(recoveryPath: string, entries: SnapshotManifest['entries']): Promise<void> {
  if (!insideDataRoot(recoveryPath)) throw new Error('Recovery path must stay inside the persistent data root');
  await rm(recoveryPath, { recursive: true, force: true });
  await mkdir(recoveryPath, { recursive: true });
  const manifest: SnapshotManifest = { entries: [] };
  for (const requested of entries) {
    const source = requested.root && requested.root !== 'data' ? rootFor(requested) : join(dataRoot, requested.name);
    const existed = existsSync(source);
    manifest.entries.push({ ...requested, existed });
    if (!existed) continue;
    const target = join(recoveryPath, requested.root && requested.root !== 'data' ? requested.root : requested.name);
    await mkdir(dirname(target), { recursive: true });
    if (requested.kind === 'directory') await cp(source, target, { recursive: true });
    else await copyFile(source, target);
  }
  await writeFile(join(recoveryPath, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

async function restoreSnapshot(recoveryPath: string): Promise<void> {
  if (!insideDataRoot(recoveryPath)) throw new Error('Recovery path must stay inside the persistent data root');
  const manifest = JSON.parse(await readFile(join(recoveryPath, 'manifest.json'), 'utf8')) as SnapshotManifest;
  for (const entry of manifest.entries) {
    if (!/^[A-Za-z0-9._-]+$/.test(entry.name)) throw new Error('Recovery manifest contains an unsafe entry');
    if (entry.root && !['data', 'files', 'archive'].includes(entry.root)) throw new Error('Recovery manifest contains an unsafe root');
    const externalRoot = entry.root && entry.root !== 'data';
    const target = externalRoot ? rootFor(entry) : join(dataRoot, entry.name);
    if (externalRoot) await clearDirectory(target); else await rm(target, { recursive: true, force: true });
    if (entry.kind === 'file') {
      await rm(`${target}-wal`, { force: true });
      await rm(`${target}-shm`, { force: true });
    }
    if (!entry.existed) continue;
    const source = join(recoveryPath, externalRoot ? entry.root! : entry.name);
    if (entry.kind === 'directory' && externalRoot) {
      for (const child of await readdir(source)) await cp(join(source, child), join(target, child), { recursive: true });
    } else if (entry.kind === 'directory') await cp(source, target, { recursive: true });
    else await copyFile(source, target);
  }
}

const updateEntries: SnapshotManifest['entries'] = [
  { name: 'data.db', kind: 'file', existed: false },
  { name: 'designer.db', kind: 'file', existed: false },
  { name: '.emu-secret.key', kind: 'file', existed: false },
  { name: 'fonts', kind: 'directory', existed: false },
  { name: 'files', root: 'files', kind: 'directory', existed: false },
  { name: 'archive', root: 'archive', kind: 'directory', existed: false },
];

function restoreEntries(components: RestoreRequest['components']): SnapshotManifest['entries'] {
  const entries: SnapshotManifest['entries'] = [];
  if (components.includes('data')) entries.push({ name: 'data.db', kind: 'file', existed: false });
  if (components.includes('designer')) entries.push({ name: 'designer.db', kind: 'file', existed: false });
  if (components.includes('fonts')) entries.push({ name: 'fonts', kind: 'directory', existed: false });
  if (components.includes('files')) entries.push({ name: 'files', root: 'files', kind: 'directory', existed: false });
  if (components.includes('archive')) entries.push({ name: 'archive', root: 'archive', kind: 'directory', existed: false });
  return entries;
}

async function replaceRestoreComponents(request: RestoreRequest): Promise<void> {
  for (const component of request.components) {
    const name = component === 'data' ? 'data.db' : component === 'designer' ? 'designer.db' : component;
    const source = join(request.stagePath, name);
    const external = component === 'files' || component === 'archive';
    const target = component === 'files' ? filesRoot : component === 'archive' ? archiveRoot : join(dataRoot, name);
    if (external) await clearDirectory(target); else await rm(target, { recursive: true, force: true });
    if (component === 'data' || component === 'designer') {
      await rm(`${target}-wal`, { force: true });
      await rm(`${target}-shm`, { force: true });
      await copyFile(source, target);
    } else if (existsSync(source)) {
      if (external) for (const child of await readdir(source)) await cp(join(source, child), join(target, child), { recursive: true });
      else await cp(source, target, { recursive: true });
    } else {
      await mkdir(target, { recursive: true });
    }
  }
}

async function rollbackUpdate(jobId: string, oldName: string, recoveryPath: string, cause: unknown): Promise<void> {
  await patchState(statePath, jobId, { status: 'running', phase: 'rolling_back', rollbackStatus: 'running', error: errorText(cause) });
  try {
    const old = await containerInfo(oldName);
    const current = await containerInfo(appContainer);
    if (old && current) await docker('DELETE', `/containers/${encodeURIComponent(appContainer)}?force=true`);
    else if (!old && current?.State?.Running) await stopApp();
    if (existsSync(join(recoveryPath, 'manifest.json'))) await restoreSnapshot(recoveryPath);
    if (old) await docker('POST', `/containers/${encodeURIComponent(oldName)}/rename?name=${encodeURIComponent(appContainer)}`);
    await startContainer(appContainer);
    await waitHealthy(appContainer);
    await patchState(statePath, jobId, { status: 'failed', phase: 'rolled_back', rollbackStatus: 'succeeded', recoveryRequired: false, error: errorText(cause) });
    await rm(recoveryPath, { recursive: true, force: true });
  } catch (rollbackError) {
    await patchState(statePath, jobId, {
      status: 'failed', phase: 'recovery_required', rollbackStatus: 'failed', recoveryRequired: true,
      error: `${errorText(cause)}; rollback failed: ${errorText(rollbackError)}`,
    });
  }
}

async function update(request: UpdateRequest): Promise<void> {
  if (!isStableVersion(request.version)) throw new Error('Invalid stable version; expected X.Y.Z');
  const image = pullPolicy === 'never' && localImage ? localImage : `${imageRepository}:${request.version}`;
  const oldName = `${appContainer}-rollback-${request.jobId.slice(0, 8)}`;
  const recoveryPath = join(dataRoot, `update-recovery-${request.jobId}`);
  let stopped = false;

  await patchState(statePath, request.jobId, { status: 'running', phase: 'preparing', rollbackStatus: 'not_required', recoveryRequired: false, recoveryPath });
  try {
    if (pullPolicy === 'always') {
      try { await docker('POST', `/images/create?fromImage=${encodeURIComponent(imageRepository)}&tag=${encodeURIComponent(request.version)}`); }
      catch (error) {
        if (String(error).includes('returned 404')) throw new Error(`Container image ${image} is not published. No container was changed.`);
        throw error;
      }
    }
    const candidateImage = await docker<ImageInfo>('GET', `/images/${encodeURIComponent(image)}/json`);
    const old = await containerInfo(appContainer);
    if (!old) throw new Error(`Application container '${appContainer}' was not found`);
    await assertMountContinuity(old);
    const previousImage = old.Config.Image ? await docker<ImageInfo>('GET', `/images/${encodeURIComponent(old.Config.Image)}/json`) : null;

    await patchState(statePath, request.jobId, { phase: 'stopping' });
    await stopApp(); stopped = true;
    await patchState(statePath, request.jobId, { phase: 'snapshotting' });
    await snapshot(recoveryPath, updateEntries);

    const endpoints = structuredClone(old.NetworkSettings.Networks);
    for (const endpoint of Object.values(endpoints)) {
      delete endpoint.IPAddress; delete endpoint.GlobalIPv6Address; delete endpoint.MacAddress;
    }
    const config: Record<string, unknown> = {
      ...candidateImage.Config,
      Env: mergeContainerEnvironment(old.Config.Env, previousImage?.Config.Env, candidateImage.Config.Env),
      Labels: { ...(candidateImage.Config.Labels ?? {}), ...(old.Config.Labels ?? {}) },
      Image: image, HostConfig: old.HostConfig,
      NetworkingConfig: { EndpointsConfig: endpoints },
    };

    await patchState(statePath, request.jobId, { status: 'restarting', phase: 'switching' });
    await docker('POST', `/containers/${encodeURIComponent(appContainer)}/rename?name=${encodeURIComponent(oldName)}`);
    await docker('POST', `/containers/create?name=${encodeURIComponent(appContainer)}`, config);
    await startContainer(appContainer);
    await patchState(statePath, request.jobId, { phase: 'verifying' });
    await waitHealthy(appContainer);

    await patchState(statePath, request.jobId, { status: 'succeeded', phase: 'completed', rollbackStatus: 'not_required', recoveryRequired: false });
    await docker('DELETE', `/containers/${encodeURIComponent(oldName)}?force=true`).catch((error) => console.error('Could not remove rollback container:', error));
    await rm(recoveryPath, { recursive: true, force: true });
  } catch (error) {
    if (!stopped) {
      await patchState(statePath, request.jobId, { status: 'failed', phase: 'completed', rollbackStatus: 'not_required', recoveryRequired: false, error: errorText(error) });
      return;
    }
    await rollbackUpdate(request.jobId, oldName, recoveryPath, error);
  }
}

async function rollbackRestore(request: RestoreRequest, recoveryPath: string, cause: unknown): Promise<void> {
  await patchState(restoreStatePath, request.jobId, { status: 'running', phase: 'rolling_back', rollbackStatus: 'running', error: errorText(cause) });
  try {
    await stopApp();
    await restoreSnapshot(recoveryPath);
    await startContainer(appContainer);
    await waitHealthy(appContainer);
    await patchState(restoreStatePath, request.jobId, { status: 'failed', phase: 'rolled_back', rollbackStatus: 'succeeded', recoveryRequired: false, error: errorText(cause) });
    await rm(request.stagePath, { recursive: true, force: true });
    await rm(recoveryPath, { recursive: true, force: true });
  } catch (rollbackError) {
    await patchState(restoreStatePath, request.jobId, {
      status: 'failed', phase: 'recovery_required', rollbackStatus: 'failed', recoveryRequired: true,
      error: `${errorText(cause)}; rollback failed: ${errorText(rollbackError)}`,
    });
  }
}

async function restore(request: RestoreRequest): Promise<void> {
  if (!Array.isArray(request.components) || request.components.some((item) => !['data', 'designer', 'fonts', 'files', 'archive'].includes(item))) throw new Error('Invalid restore components');
  if (!insideDataRoot(request.stagePath) || request.stagePath.includes('..')) throw new Error('Invalid restore stage path');
  const recoveryPath = join(dataRoot, `restore-recovery-${request.jobId}`);
  let stopped = false;
  await patchState(restoreStatePath, request.jobId, { status: 'running', phase: 'stopping', rollbackStatus: 'not_required', recoveryRequired: false, recoveryPath });
  try {
    const current = await containerInfo(appContainer);
    if (!current) throw new Error(`Application container '${appContainer}' was not found`);
    await assertMountContinuity(current);
    await stopApp(); stopped = true;
    await patchState(restoreStatePath, request.jobId, { phase: 'snapshotting' });
    await snapshot(recoveryPath, restoreEntries(request.components));
    await patchState(restoreStatePath, request.jobId, { phase: 'restoring' });
    await replaceRestoreComponents(request);
    await patchState(restoreStatePath, request.jobId, { status: 'restarting', phase: 'verifying' });
    await startContainer(appContainer);
    await waitHealthy(appContainer);
    await patchState(restoreStatePath, request.jobId, { status: 'succeeded', phase: 'completed', rollbackStatus: 'not_required', recoveryRequired: false });
    await rm(request.stagePath, { recursive: true, force: true });
    await rm(recoveryPath, { recursive: true, force: true });
  } catch (error) {
    if (!stopped) {
      await patchState(restoreStatePath, request.jobId, { status: 'failed', phase: 'completed', rollbackStatus: 'not_required', recoveryRequired: false, error: errorText(error) });
      return;
    }
    await rollbackRestore(request, recoveryPath, error);
  }
}

async function recoverUpdate(state: JobState): Promise<void> {
  const oldName = `${appContainer}-rollback-${state.id.slice(0, 8)}`;
  const recoveryPath = typeof state.recoveryPath === 'string' ? state.recoveryPath : join(dataRoot, `update-recovery-${state.id}`);
  const hasSnapshot = existsSync(join(recoveryPath, 'manifest.json'));
  const old = await containerInfo(oldName);
  if (!updateChangedState(state.phase, hasSnapshot, Boolean(old))) {
    await startContainer(appContainer);
    await waitHealthy(appContainer);
    await patchState(statePath, state.id, {
      status: 'failed', phase: 'completed', rollbackStatus: 'not_required', recoveryRequired: false,
      error: 'Update was interrupted before persistent data or the application container was changed',
    });
    return;
  }
  await rollbackUpdate(state.id, oldName, recoveryPath, new Error('Update was interrupted because the updater restarted'));
}

async function recoverRestore(state: JobState): Promise<void> {
  const recoveryPath = typeof state.recoveryPath === 'string' ? state.recoveryPath : join(dataRoot, `restore-recovery-${state.id}`);
  const request: RestoreRequest = {
    jobId: state.id,
    stagePath: typeof state.stagePath === 'string' ? state.stagePath : join(dataRoot, 'restore-jobs', state.id),
    components: Array.isArray(state.components) ? state.components.filter((item): item is RestoreRequest['components'][number] => ['data', 'designer', 'fonts', 'files', 'archive'].includes(String(item))) : [],
  };
  const action = interruptedRestoreAction(state.phase, existsSync(join(recoveryPath, 'manifest.json')));
  if (action === 'rollback') {
    await rollbackRestore(request, recoveryPath, new Error('Restore was interrupted because the updater restarted'));
    return;
  }
  if (action === 'resume_original') {
    await startContainer(appContainer);
    await waitHealthy(appContainer);
    await patchState(restoreStatePath, state.id, {
      status: 'failed', phase: 'completed', rollbackStatus: 'not_required', recoveryRequired: false,
      error: 'Restore was interrupted before persistent data was changed',
    });
    return;
  }
  await patchState(restoreStatePath, state.id, {
    status: 'failed', phase: 'recovery_required', rollbackStatus: 'failed', recoveryRequired: true,
    error: 'Restore was interrupted before a verified recovery snapshot was available',
  });
}

async function recoverInterruptedJobs(): Promise<void> {
  const updateState = await readState(statePath).catch((error) => { console.error('Could not read update state:', error); return null; });
  if (updateState && ['pending', 'running', 'restarting'].includes(updateState.status)) {
    try { await recoverUpdate(updateState); } catch (error) { console.error('Could not recover interrupted update:', error); }
  }
  const restoreState = await readState(restoreStatePath).catch((error) => { console.error('Could not read restore state:', error); return null; });
  if (restoreState && ['pending', 'running', 'restarting'].includes(restoreState.status)) {
    try { await recoverRestore(restoreState); } catch (error) { console.error('Could not recover interrupted restore:', error); }
  }
}

async function runBackground(task: () => Promise<void>, stateFile: string, jobId: string): Promise<void> {
  try { await task(); }
  catch (error) {
    console.error(error);
    try { await patchState(stateFile, jobId, { status: 'failed', phase: 'recovery_required', rollbackStatus: 'failed', recoveryRequired: true, error: errorText(error) }); }
    catch (statusError) { console.error('Could not persist failed job status:', statusError); }
  } finally { busy = false; }
}

let busy = false;
await recoverInterruptedJobs();

http.createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, busy }));
    return;
  }
  if (request.method !== 'POST' || !['/update', '/restore'].includes(request.url ?? '')) { response.writeHead(404).end(); return; }
  if (request.headers.authorization !== `Bearer ${token}`) { response.writeHead(401).end(); return; }
  if (busy) { response.writeHead(409).end(); return; }

  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    if (typeof body.jobId !== 'string' || !body.jobId) throw new Error('Invalid job request');
    if (request.url === '/update') {
      if (typeof body.version !== 'string' || Object.keys(body).some((key) => !['jobId', 'version', 'backupPath'].includes(key))) throw new Error('Invalid update request');
      const job: UpdateRequest = { jobId: body.jobId, version: body.version, backupPath: typeof body.backupPath === 'string' ? body.backupPath : undefined };
      if (localImage && !(await readState(statePath))) {
        await writeState(statePath, {
          id: job.jobId, status: 'pending', phase: 'preparing', rollbackStatus: 'not_required', recoveryRequired: false,
          targetVersion: job.version, requestedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), testMode: true,
        });
      }
      busy = true; void runBackground(() => update(job), statePath, job.jobId);
    } else {
      if (typeof body.stagePath !== 'string' || !Array.isArray(body.components) || Object.keys(body).some((key) => !['jobId', 'stagePath', 'components'].includes(key))) throw new Error('Invalid restore request');
      const job: RestoreRequest = { jobId: body.jobId, stagePath: body.stagePath, components: body.components as RestoreRequest['components'] };
      if (localImage && !(await readState(restoreStatePath))) {
        await writeState(restoreStatePath, {
          id: job.jobId, status: 'pending', phase: 'preparing', rollbackStatus: 'not_required', recoveryRequired: false,
          components: job.components, stagePath: job.stagePath, requestedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), testMode: true,
        });
      }
      busy = true; void runBackground(() => restore(job), restoreStatePath, job.jobId);
    }
    response.writeHead(202, { 'Content-Type': 'application/json' }).end(JSON.stringify({ accepted: true }));
  } catch (error) {
    response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: errorText(error) }));
  }
}).listen(3400, '0.0.0.0');
