import { defineCommand } from 'citty';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { findProjectRoot, listAppNames, readAppJson } from '../utils/paths.js';

const META_DIRS = ['tables', 'enums', 'forms', 'menus', 'privileges', 'duties', 'roles'];

export const listCommand = defineCommand({
  meta: {
    name: 'list',
    description: 'List all apps with dependency tree and metadata counts',
  },
  async run() {
    const root = findProjectRoot();
    const appNames = listAppNames(root);

    console.log('');
    p.intro(pc.cyan('Apps & Extensions'));

    if (appNames.length === 0) {
      p.log.warn('No apps found. Use `pnpm emu add app <name>` to create one.');
      return;
    }

    // Find base apps (not depended on by any extension)
    const allDeps = new Set<string>();
    for (const name of appNames) {
      const info = readAppJson(root, name);
      if (info) {
        for (const d of info.dependsOn) allDeps.add(d);
      }
    }

    // Base apps first (no dependsOn = root models), then extensions under them
    const baseApps = appNames.filter((n) => {
      const info = readAppJson(root, n);
      return info && info.dependsOn.length === 0;
    });
    const printed = new Set<string>();

    for (const base of baseApps) {
      if (printed.has(base)) continue;
      printTree(root, base, '', true, printed);
    }

    // Any remaining (orphaned)
    const orphaned = appNames.filter((n) => !printed.has(n));
    for (const o of orphaned) {
      printTree(root, o, '', true, printed);
    }

    console.log('');
    p.outro(`Run ${pc.cyan('pnpm emu add app <name>')} to create a new app`);
  },
});

function printTree(root: string, name: string, prefix: string, isLast: boolean, printed: Set<string>) {
  if (printed.has(name)) return;
  printed.add(name);

  const info = readAppJson(root, name);
  if (!info) return;

  const counts = countMetadata(join(root, 'apps', name));
  const connector = isLast ? '└──' : '├──';
  const depStr = info.dependsOn.length > 0 ? pc.dim(` (extends: ${info.dependsOn.join(', ')})`) : '';

  console.log(`  ${pc.cyan(prefix + connector)} ${pc.bold(name)}${pc.dim(` — ${info.label}`)}${depStr}`);
  if (counts) {
    console.log(`  ${pc.dim(prefix + (isLast ? '    ' : '│   ') + counts)}`);
  }

  // Find child extensions that depend on this app
  const children = listAppNames(root).filter((n) => {
    if (printed.has(n)) return false;
    const ci = readAppJson(root, n);
    return ci && ci.dependsOn.includes(name);
  });

  // Show modules for this app
  const modules = listModules(root, name);
  const modPrefix = prefix + (isLast ? '    ' : '│   ');
  modules.forEach((mod, i) => {
    const lastMod = i === modules.length - 1 && children.length === 0;
    const mc = countModuleMetadata(join(root, 'apps', name, 'metadata', mod));
    console.log(`  ${pc.yellow(modPrefix + (lastMod ? '└──' : '├──') + ' ' + mod)}`);
    if (mc) {
      console.log(`  ${pc.dim(modPrefix + (lastMod ? '    ' : '│   ') + mc)}`);
    }
  });

  const childPrefix = prefix + (isLast ? '    ' : '│   ');
  children.forEach((child, i) => {
    printTree(root, child, childPrefix, i === children.length - 1, printed);
  });
}

function countMetadata(appDir: string): string | null {
  if (!existsSync(appDir)) return null;
  const metaDir = join(appDir, 'metadata');
  if (!existsSync(metaDir)) return null;
  const parts: string[] = [];
  for (const dir of META_DIRS) {
    const d = join(metaDir, dir);
    if (existsSync(d)) {
      const count = readdirSync(d).filter((f) => f.endsWith('.json')).length;
      if (count > 0) {
        const label = dir === 'privileges' ? 'privs' : dir;
        parts.push(`${count} ${label}`);
      }
    }
  }
  // Check extensions too
  for (const extDir of ['tableExtensions', 'formExtensions', 'menuExtensions']) {
    const d = join(metaDir, extDir);
    if (existsSync(d)) {
      const count = readdirSync(d).filter((f) => f.endsWith('.json')).length;
      if (count > 0) parts.push(`${count} ${extDir}`);
    }
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

function listModules(root: string, appName: string): string[] {
  const metaDir = join(root, 'apps', appName, 'metadata');
  if (!existsSync(metaDir)) return [];
  return readdirSync(metaDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !KNOWN_META_KINDS.has(d.name))
    .map((d) => d.name);
}

function countModuleMetadata(modDir: string): string | null {
  if (!existsSync(modDir)) return null;
  const parts: string[] = [];
  for (const dir of META_DIRS) {
    const d = join(modDir, dir);
    if (existsSync(d)) {
      const count = readdirSync(d).filter((f) => f.endsWith('.json')).length;
      if (count > 0) {
        parts.push(`${count} ${dir}`);
      }
    }
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

const KNOWN_META_KINDS = new Set([...META_DIRS, 'tableExtensions', 'formExtensions', 'menuExtensions']);
