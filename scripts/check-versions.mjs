import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const expected = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const packageFiles = ['packages/core/package.json', 'packages/server/package.json', 'packages/client/package.json', 'packages/cli/package.json', 'packages/mcp/package.json'];
const textFiles = ['README.md', 'docs/DEVELOPER-GUIDE.md', 'docs/WEB-DESIGNER-GUIDE.md', 'docs/AI-DEVELOPER-GUIDE.md', 'start.cmd', 'StopApp.cmd', 'launch.ps1'];
const failures = [];
for (const file of packageFiles) {
  const version = JSON.parse(readFileSync(join(root, file), 'utf8')).version;
  if (version !== expected) failures.push(`${file}: ${version}`);
}
for (const file of textFiles) {
  const text = readFileSync(join(root, file), 'utf8');
  if (!text.includes(expected)) failures.push(`${file}: missing ${expected}`);
}
const core = readFileSync(join(root, 'packages/core/src/index.ts'), 'utf8');
const cli = readFileSync(join(root, 'packages/cli/src/index.ts'), 'utf8');
if (!core.includes(`CORE_VERSION = '${expected}'`)) failures.push('packages/core/src/index.ts');
if (!cli.includes(`version: '${expected}'`)) failures.push('packages/cli/src/index.ts');
if (failures.length) {
  console.error(`Version drift detected (expected ${expected}):\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
  process.exit(1);
}
console.log(`All release surfaces use ${expected}.`);
