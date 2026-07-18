import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function findProjectRoot(): string {
  let dir = process.cwd();
  while (dir !== parseRoot(dir)) {
    const pkg = join(dir, 'package.json');
    const ws = join(dir, 'pnpm-workspace.yaml');
    if (existsSync(pkg) && existsSync(ws)) return dir;
    dir = join(dir, '..');
  }
  return process.cwd();
}

function parseRoot(p: string): string {
  const s = p.replace(/[\\/]$/, '');
  const idx = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
  return idx < 0 ? p : s.slice(0, idx === 0 ? 1 : idx);
}

export function getAppDir(root: string, name: string): string {
  return join(root, 'apps', name);
}

export function listAppNames(root: string): string[] {
  const appsDir = join(root, 'apps');
  if (!existsSync(appsDir)) return [];
  return readdirSync(appsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(appsDir, d.name, 'app.json')))
    .map((d) => d.name);
}

export function mainTsPath(root: string): string {
  return join(root, 'packages', 'server', 'src', 'main.ts');
}

export function workspacePath(root: string): string {
  return join(root, 'pnpm-workspace.yaml');
}

export interface AppInfo {
  name: string;
  label: string;
  dependsOn: string[];
  models: { name: string; label?: string; layer: string }[];
}

export function readAppJson(root: string, appName: string): AppInfo | null {
  const path = join(root, 'apps', appName, 'app.json');
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'));
    return {
      name: raw.name ?? appName,
      label: raw.label ?? appName,
      dependsOn: raw.dependsOn ?? [],
      models: raw.models ?? [],
    };
  } catch {
    return null;
  }
}

export function getDependsOnChain(root: string, appName: string): string[] {
  const visited = new Set<string>();
  const chain: string[] = [];
  const queue = [appName];
  while (queue.length > 0) {
    const name = queue.shift()!;
    if (visited.has(name)) continue;
    visited.add(name);
    const info = readAppJson(root, name);
    if (info) {
      chain.push(name);
      for (const dep of info.dependsOn) queue.push(dep);
    }
  }
  return chain;
}
