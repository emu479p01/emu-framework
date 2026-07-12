import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const expected = manifest.version;
const nodeVersion = manifest.emuToolchain?.node;
const pnpmVersion = String(manifest.packageManager ?? '').replace(/^pnpm@/, '');
const failures = [];

if (!nodeVersion || !pnpmVersion) failures.push('package.json: missing emuToolchain.node or packageManager');

for (const file of ['packages/core/package.json', 'packages/server/package.json', 'packages/client/package.json', 'packages/cli/package.json', 'packages/mcp/package.json']) {
  const version = JSON.parse(readFileSync(join(root, file), 'utf8')).version;
  if (version !== expected) failures.push(`${file}: version ${version}, expected ${expected}`);
}

const requiredText = new Map([
  ['README.md', [expected, `Node.js ${nodeVersion}`, `pnpm ${pnpmVersion}`]],
  ['CONTRIBUTING.md', [`Node.js ${nodeVersion}`, `pnpm ${pnpmVersion}`]],
  ['Dockerfile', [`node:${nodeVersion}`, `pnpm@${pnpmVersion}`]],
  ['Dockerfile.updater', [`node:${nodeVersion}`]],
  ['.github/workflows/ci.yml', [`node-version: ${nodeVersion}`]],
  ['.github/workflows/release.yml', [`node-version: ${nodeVersion}`, `version: ${pnpmVersion}`]],
  ['launch.ps1', [`nodeVersion = \"${nodeVersion}\"`, `pnpmVersion = \"${pnpmVersion}\"`]],
  ['scripts/update-framework.ps1', [`node-v${nodeVersion}-win-x64`]],
  ['scripts/restore-database.ps1', [`node-v${nodeVersion}-win-x64`]],
]);
for (const [file, needles] of requiredText) {
  const text = readFileSync(join(root, file), 'utf8');
  for (const needle of needles) if (!text.includes(needle)) failures.push(`${file}: missing ${needle}`);
}

const core = readFileSync(join(root, 'packages/core/src/index.ts'), 'utf8');
const cli = readFileSync(join(root, 'packages/cli/src/index.ts'), 'utf8');
if (!core.includes(`CORE_VERSION = '${expected}'`)) failures.push('packages/core/src/index.ts: CORE_VERSION drift');
if (!cli.includes(`version: '${expected}'`)) failures.push('packages/cli/src/index.ts: CLI version drift');

if (failures.length) {
  console.error(`Version drift detected:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
  process.exit(1);
}
console.log(`Framework ${expected}; Node.js ${nodeVersion}; pnpm ${pnpmVersion}. All release surfaces match.`);
