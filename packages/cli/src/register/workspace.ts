import { readFileSync, writeFileSync } from 'node:fs';
import { workspacePath } from '../utils/paths.js';

export function registerAppInWorkspace(root: string, appName: string): void {
  const wsEntry = `  - 'apps/${appName}'`;
  const path = workspacePath(root);
  const content = readFileSync(path, 'utf-8');
  if (content.includes(wsEntry)) return;
  writeFileSync(path, content.trimEnd() + '\n' + wsEntry + '\n');
}
