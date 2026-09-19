import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
if (process.version !== 'v24.18.0') throw new Error(`Offline verification requires bundled Node v24.18.0; received ${process.version}`);
if (/[/\\]OneDrive(?:[/\\]|$)/i.test(root)) throw new Error('Refusing to verify from a OneDrive path');

const required = [
  'node_modules/typescript/bin/tsc',
  'packages/core/node_modules/vitest/vitest.mjs',
  'packages/server/node_modules/vitest/vitest.mjs',
  'packages/client/node_modules/vitest/vitest.mjs',
  'packages/client/node_modules/vue-tsc/bin/vue-tsc.js',
  'packages/client/node_modules/vite/bin/vite.js',
];
for (const item of required) if (!existsSync(resolve(root, item))) throw new Error(`Offline dependency is missing: ${item}. Nothing was downloaded.`);

function run(label, args, cwd = root) {
  process.stdout.write(`\n== ${label} ==\n`);
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit', env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}`);
}

run('release policy tests', ['--test', 'scripts/release-policy.test.mjs']);
run('version consistency', ['scripts/release-policy.mjs', '--versions-only']);
run('core typecheck', ['node_modules/typescript/bin/tsc', '-p', 'packages/core/tsconfig.json', '--noEmit']);
run('core build prerequisite', ['node_modules/typescript/bin/tsc', '-p', 'packages/core/tsconfig.build.json']);
run('server typecheck', ['node_modules/typescript/bin/tsc', '-p', 'packages/server/tsconfig.json', '--noEmit']);
run('client typecheck', ['packages/client/node_modules/vue-tsc/bin/vue-tsc.js', '--noEmit', '-p', 'packages/client/tsconfig.json']);
run('core tests', ['node_modules/vitest/vitest.mjs', 'run'], resolve(root, 'packages/core'));
run('server tests', ['node_modules/vitest/vitest.mjs', 'run'], resolve(root, 'packages/server'));
run('client tests', ['node_modules/vitest/vitest.mjs', 'run'], resolve(root, 'packages/client'));
run('core build', ['node_modules/typescript/bin/tsc', '-p', 'packages/core/tsconfig.build.json']);
run('server build', ['node_modules/typescript/bin/tsc', '-p', 'packages/server/tsconfig.build.json']);
run('client build', ['node_modules/vite/bin/vite.js', 'build'], resolve(root, 'packages/client'));
run('release check', ['scripts/release-policy.mjs', '--tag', '1.0.2', '--previous', '1.0.1']);
process.stdout.write('\nOffline release gates passed without package installation or network access.\n');
