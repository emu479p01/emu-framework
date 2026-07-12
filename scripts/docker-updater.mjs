import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const token = process.env.EMU_UPDATER_TOKEN;
const imageRepository = process.env.EMU_IMAGE_REPOSITORY ?? 'ghcr.io/emu479p01/emu-framework';
const appContainer = process.env.EMU_APP_CONTAINER ?? 'emuframework-app';
const statePath = process.env.EMU_UPDATE_STATE_PATH ?? '/data/update-status.json';
if (!token || token.length < 24) throw new Error('EMU_UPDATER_TOKEN must contain at least 24 characters');

function docker(method, path, body) {
  return new Promise((resolve, reject) => {
    const request = http.request({ socketPath: '/var/run/docker.sock', method, path, headers: body ? { 'Content-Type': 'application/json' } : undefined }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if ((response.statusCode ?? 500) >= 300) return reject(new Error(`Docker API ${method} ${path} returned ${response.statusCode}: ${text.slice(0, 300)}`));
        try { resolve(text ? JSON.parse(text) : null); } catch { resolve(text); }
      });
    });
    request.on('error', reject);
    if (body) request.end(JSON.stringify(body)); else request.end();
  });
}

async function setStatus(jobId, status, error) {
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  if (state.id !== jobId) throw new Error('Update job no longer matches shared state');
  state.status = status; state.updatedAt = new Date().toISOString();
  if (error) state.error = String(error).slice(0, 500);
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2));
}

async function waitHealthy(name) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const info = await docker('GET', `/containers/${name}/json`);
    if (info.State?.Health?.Status === 'healthy' || (!info.State?.Health && info.State?.Running)) return;
    if (info.State?.Status === 'exited' || info.State?.Health?.Status === 'unhealthy') throw new Error('Updated container failed its health check');
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('Updated container did not become healthy in time');
}

async function update({ jobId, version }) {
  if (!/^[0-9]+(?:\.[0-9]+){2,3}$/.test(version)) throw new Error('Invalid stable version');
  const image = `${imageRepository}:${version}`;
  const oldName = `${appContainer}-rollback-${jobId.slice(0, 8)}`;
  await setStatus(jobId, 'running');
  await docker('POST', `/images/create?fromImage=${encodeURIComponent(imageRepository)}&tag=${encodeURIComponent(version)}`);
  await docker('GET', `/images/${encodeURIComponent(image)}/json`);
  const old = await docker('GET', `/containers/${appContainer}/json`);
  const config = { ...old.Config, Image: image, HostConfig: old.HostConfig, NetworkingConfig: { EndpointsConfig: old.NetworkSettings.Networks } };
  delete config.Hostname; delete config.Domainname; delete config.AttachStdin; delete config.AttachStdout; delete config.AttachStderr;
  for (const endpoint of Object.values(config.NetworkingConfig.EndpointsConfig)) {
    delete endpoint.IPAddress; delete endpoint.GlobalIPv6Address; delete endpoint.MacAddress;
  }
  await setStatus(jobId, 'restarting');
  await docker('POST', `/containers/${appContainer}/stop?t=30`).catch(() => undefined);
  await docker('POST', `/containers/${appContainer}/rename?name=${encodeURIComponent(oldName)}`);
  let created = false;
  try {
    await docker('POST', `/containers/create?name=${encodeURIComponent(appContainer)}`, config); created = true;
    await docker('POST', `/containers/${appContainer}/start`);
    await waitHealthy(appContainer);
    await docker('DELETE', `/containers/${oldName}?force=true`);
    await setStatus(jobId, 'succeeded');
  } catch (error) {
    if (created) await docker('DELETE', `/containers/${appContainer}?force=true`).catch(() => undefined);
    await docker('POST', `/containers/${oldName}/rename?name=${encodeURIComponent(appContainer)}`).catch(() => undefined);
    await docker('POST', `/containers/${appContainer}/start`).catch(() => undefined);
    await setStatus(jobId, 'failed', error instanceof Error ? error.message : error);
  }
}

let busy = false;
http.createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/update') { response.writeHead(404).end(); return; }
  if (request.headers.authorization !== `Bearer ${token}`) { response.writeHead(401).end(); return; }
  if (busy) { response.writeHead(409).end(); return; }
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body.jobId || !body.version || Object.keys(body).some((key) => !['jobId', 'version', 'backupPath'].includes(key))) throw new Error('Invalid update request');
    busy = true; void update(body).finally(() => { busy = false; });
    response.writeHead(202, { 'Content-Type': 'application/json' }).end(JSON.stringify({ accepted: true }));
  } catch (error) { response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error instanceof Error ? error.message : 'Invalid request' })); }
}).listen(3400, '0.0.0.0');
