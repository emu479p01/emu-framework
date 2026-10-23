import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import assert from 'node:assert/strict';

const [appImage, updaterImage] = process.argv.slice(2);
if (!appImage || !updaterImage) throw new Error('Usage: node scripts/verify-container-images.mjs APP_IMAGE UPDATER_IMAGE');
const { emuToolchain } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 120_000 }).trim();

async function healthy(id) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const [{ State: state }] = JSON.parse(docker('inspect', id));
    if (!state.Running || state.Health?.Status === 'unhealthy') throw new Error(`Container failed: ${docker('logs', id)}`);
    if (state.Health?.Status === 'healthy') return;
    await setTimeout(2_000);
  }
  throw new Error(`Container health check timed out: ${docker('logs', id)}`);
}

for (const [role, image] of [['app', appImage], ['updater', updaterImage]]) {
  assert.equal(docker('run', '--rm', '--entrypoint', 'node', image, '--version'), `v${emuToolchain.node}`);
  if (role === 'app') {
    docker('run', '--rm', '--entrypoint', 'node', image, '-e', "const db = new (require('./packages/server/node_modules/better-sqlite3'))(':memory:'); db.prepare('SELECT 1').get(); db.close();");
  }
  const id = docker('run', '-d', '--env', 'EMU_DEPLOYMENT_MODE=docker', '--env', 'EMU_UPDATER_TOKEN=container-smoke-test-only-token', image);
  try {
    await healthy(id);
    docker('restart', id);
    await healthy(id);
    console.log(`${role}: Node ${emuToolchain.node}, startup and restart health checks passed`);
  } finally {
    // Only remove this disposable container and its anonymous volumes.
    docker('rm', '--force', '--volumes', id);
  }
}
