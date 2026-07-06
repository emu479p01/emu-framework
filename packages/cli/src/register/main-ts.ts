import { readFileSync, writeFileSync } from 'node:fs';
import { mainTsPath } from '../utils/paths.js';

const IMPORT_BEGIN = '// @emu:app-imports-begin';
const IMPORT_END = '// @emu:app-imports-end';
const DIRS_BEGIN = '// @emu:app-dirs-begin';
const DIRS_END = '// @emu:app-dirs-end';
const LOGIC_BEGIN = '// @emu:app-logic-begin';
const LOGIC_END = '// @emu:app-logic-end';

export function hasNfMarkers(root: string): boolean {
  const content = readFileSync(mainTsPath(root), 'utf-8');
  return [IMPORT_BEGIN, DIRS_BEGIN, LOGIC_BEGIN].every((m) => content.includes(m));
}

export function ensureMarkers(root: string): void {
  if (hasNfMarkers(root)) return;
  const path = mainTsPath(root);
  let content = readFileSync(path, 'utf-8');

  // Insert import markers after the import block
  const lines = content.split('\n');
  let insertAt = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith('import') && !trimmed.startsWith('//') && trimmed !== '') {
      insertAt = i;
      break;
    }
  }
  lines.splice(insertAt, 0, IMPORT_BEGIN, IMPORT_END);
  content = lines.join('\n');

  // Insert dirs markers inside appDirs array
  content = content.replace(
    /(appDirs:\s*\[)([\s\S]*?)(\])/,
    (_m, prefix: string, inner: string, suffix: string) =>
      `${prefix}\n      ${DIRS_BEGIN}\n${inner}      ${DIRS_END}\n    ${suffix}`,
  );

  // Insert logic markers inside registerLogic callback
  content = content.replace(
    /(registerLogic\s*\(\s*kernel\s*\)\s*\{)([\s\S]*?)(\})/,
    (_m, prefix: string, inner: string, suffix: string) =>
      `${prefix}\n      ${LOGIC_BEGIN}\n${inner}      ${LOGIC_END}\n    ${suffix}`,
  );

  writeFileSync(path, content);
}

export function registerAppInMainTs(root: string, appName: string): void {
  const path = mainTsPath(root);
  const cap = capitalize(appName);
  let content = readFileSync(path, 'utf-8');

  const importLine = `import { register${cap}Logic } from '@emu/app-${appName}';`;
  if (content.includes(importLine)) return;

  content = content.replace(IMPORT_BEGIN, `${IMPORT_BEGIN}\n${importLine}`);
  content = content.replace(DIRS_BEGIN, `${DIRS_BEGIN}\n    join(root, 'apps', '${appName}'),`);
  content = content.replace(LOGIC_BEGIN, `${LOGIC_BEGIN}\n    register${cap}Logic(kernel);`);

  writeFileSync(path, content);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
