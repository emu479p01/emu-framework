import { spawn } from 'node:child_process';
import { copyFile, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import net from 'node:net';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const required = (name) => { const value = args.get(name); if (!value) throw new Error(`Missing ${name}`); return value; };
const jobPath = required('--job'); const stage = required('--stage'); const dataPath = required('--data');
const designerPath = required('--designer'); const fontsPath = required('--fonts'); const root = required('--root');
const recovery = join(dirname(jobPath), `pre-restore-${Date.now()}`);

async function state(status, error) {
  const job = JSON.parse(await readFile(jobPath, 'utf8'));
  job.status = status; job.updatedAt = new Date().toISOString();
  if (error) job.error = String(error).slice(0, 500);
  await writeFile(jobPath, JSON.stringify(job, null, 2));
  return job;
}

function runPowerShell(parameters, detached = false) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', parameters, { cwd: root, windowsHide: true, detached, stdio: 'ignore' });
    if (detached) { child.unref(); resolve(); return; }
    child.once('error', reject); child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Launcher exited with ${code}`)));
  });
}

function portOpen() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: 3399 });
    socket.setTimeout(750); socket.once('connect', () => { socket.destroy(); resolve(true); });
    const no = () => { socket.destroy(); resolve(false); }; socket.once('error', no); socket.once('timeout', no);
  });
}

async function waitFor(expected, attempts = 90) {
  for (let i = 0; i < attempts; i += 1) {
    if (await portOpen() === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(expected ? 'Restored app failed its health check' : 'App did not stop for restore');
}

async function backupFile(source, name) {
  if (!existsSync(source)) return;
  await mkdir(recovery, { recursive: true }); await copyFile(source, join(recovery, name));
}

async function replaceFile(source, target) {
  await mkdir(dirname(target), { recursive: true });
  await rm(`${target}-wal`, { force: true }); await rm(`${target}-shm`, { force: true });
  const temporary = `${target}.restore-new`; const previous = `${target}.restore-old`;
  await copyFile(source, temporary); await rm(previous, { force: true });
  if (existsSync(target)) await rename(target, previous);
  try { await rename(temporary, target); }
  catch (error) { if (existsSync(previous)) await rename(previous, target); throw error; }
  await rm(previous, { force: true });
}

async function apply(job) {
  if (job.components.includes('data')) { await backupFile(dataPath, 'data.db'); await replaceFile(join(stage, 'data.db'), dataPath); }
  if (job.components.includes('designer')) { await backupFile(designerPath, 'designer.db'); await replaceFile(join(stage, 'designer.db'), designerPath); }
  if (job.components.includes('fonts')) {
    if (existsSync(fontsPath)) await cp(fontsPath, join(recovery, 'fonts'), { recursive: true });
    await rm(fontsPath, { recursive: true, force: true });
    if (existsSync(join(stage, 'fonts'))) await cp(join(stage, 'fonts'), fontsPath, { recursive: true }); else await mkdir(fontsPath, { recursive: true });
  }
}

async function rollback(job) {
  if (job.components.includes('data') && existsSync(join(recovery, 'data.db'))) await replaceFile(join(recovery, 'data.db'), dataPath);
  if (job.components.includes('designer') && existsSync(join(recovery, 'designer.db'))) await replaceFile(join(recovery, 'designer.db'), designerPath);
  if (job.components.includes('fonts')) {
    await rm(fontsPath, { recursive: true, force: true });
    if (existsSync(join(recovery, 'fonts'))) await cp(join(recovery, 'fonts'), fontsPath, { recursive: true });
  }
}

const launcher = join(root, 'launch.ps1');
let job;
try {
  job = await state('running'); await waitFor(false); await apply(job); await state('restarting');
  await runPowerShell(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher], true); await waitFor(true);
  await state('succeeded'); await rm(stage, { recursive: true, force: true }); await rm(recovery, { recursive: true, force: true });
} catch (error) {
  try {
    await runPowerShell(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher, '-Stop']);
    if (job) await rollback(job);
    await runPowerShell(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher], true);
  } catch {}
  await state('failed', error instanceof Error ? error.message : error);
}
