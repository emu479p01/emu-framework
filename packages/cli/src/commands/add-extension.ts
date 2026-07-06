import { defineCommand } from 'citty';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { findProjectRoot, getAppDir, getDependsOnChain } from '../utils/paths.js';
import { requireInteractive } from '../utils/tty.js';
import {
  scaffoldTableExtension,
  scaffoldFormExtension,
  scaffoldMenuExtension,
} from '../scaffold/extension.js';

type ExtKind = 'tableExtension' | 'formExtension' | 'menuExtension';
const EXTS: ExtKind[] = ['tableExtension', 'formExtension', 'menuExtension'];

export const addExtensionCommand = defineCommand({
  meta: {
    name: 'extension',
    description: 'Scaffold a metadata extension (tableExtension, formExtension, menuExtension)',
  },
  args: {
    app: {
      type: 'positional',
      description: 'Target app name',
      required: true,
    },
    kind: {
      type: 'positional',
      description: EXTS.join(' | '),
      required: true,
    },
  },
  async run({ args }) {
    const root = findProjectRoot();
    const appDir = getAppDir(root, args.app);
    if (!existsSync(appDir)) {
      console.error(pc.red(`App '${args.app}' not found at ${appDir}`));
      process.exit(1);
    }

    const kind = args.kind as ExtKind;
    if (!EXTS.includes(kind)) {
      console.error(pc.red(`Unknown kind '${kind}'. Use: ${EXTS.join(', ')}`));
      process.exit(1);
    }

    requireInteractive('Extensions use an interactive wizard — run from a real terminal, use the Web Designer, or create the JSON by hand under metadata/.../{tableExtensions,formExtensions,menuExtensions}/');

    console.log('');
    p.intro(pc.cyan(`Add ${kind} to ${args.app}`));

    // Discover base objects from this app + its dependsOn chain
    const allTargets = getDependsOnChain(root, args.app);
    p.log.info(`Discovering objects from: ${allTargets.join(', ')}`);

    switch (kind) {
      case 'tableExtension': await addTableExt(root, appDir, allTargets); break;
      case 'formExtension': await addFormExt(root, appDir, allTargets); break;
      case 'menuExtension': await addMenuExt(root, appDir, allTargets); break;
    }
  },
});

const EXT_FIELD_TYPES = [
  { value: 'string', label: 'string' },
  { value: 'int', label: 'int' },
  { value: 'real', label: 'real' },
  { value: 'boolean', label: 'boolean' },
  { value: 'date', label: 'date' },
  { value: 'datetime', label: 'datetime' },
];

async function addTableExt(root: string, appDir: string, targetApps: string[]) {
  const allTables = listFromApps(root, targetApps, 'tables');

  const table = await p.select({
    message: 'Base table to extend',
    options: allTables.map((t) => ({ value: t, label: t })),
  }) as string;
  if (p.isCancel(table)) process.exit(0);

  const name = await p.text({
    message: 'Extension name',
    placeholder: `${table}.MyExt`,
    defaultValue: `${table}.MyExt`,
  }) as string;
  if (p.isCancel(name)) process.exit(0);

  const fields: { name: string; type: string; label?: string }[] = [];
  p.log.step('Add fields to extend the table (leave name empty to finish)');

  while (true) {
    const fName = await p.text({ message: 'Field name' }) as string;
    if (p.isCancel(fName) || !fName) break;

    const fType = await p.select({ message: 'Field type', options: EXT_FIELD_TYPES }) as string;
    if (p.isCancel(fType)) process.exit(0);

    fields.push({ name: fName, type: fType });
    p.log.success(`  Added: ${fName} (${fType})`);
  }

  const filepath = scaffoldTableExtension(appDir, { name, table, fields });
  p.outro(pc.green(`Created ${filepath}`));
}

async function addFormExt(root: string, appDir: string, targetApps: string[]) {
  const allForms = listFromApps(root, targetApps, 'forms');

  const form = await p.select({
    message: 'Base form to extend',
    options: allForms.map((f) => ({ value: f, label: f })),
  }) as string;
  if (p.isCancel(form)) process.exit(0);

  const name = await p.text({
    message: 'Extension name',
    placeholder: `${form}.MyExt`,
    defaultValue: `${form}.MyExt`,
  }) as string;
  if (p.isCancel(name)) process.exit(0);

  const filepath = scaffoldFormExtension(appDir, { name, form });
  p.outro(pc.green(`Created ${filepath}`));
  p.log.message(pc.dim('Edit the JSON to add listFields, groups, etc.'));
}

async function addMenuExt(root: string, appDir: string, targetApps: string[]) {
  const allMenus = listFromApps(root, targetApps, 'menus');
  const allForms = listFromApps(root, targetApps, 'forms');

  const menu = await p.select({
    message: 'Base menu to extend',
    options: allMenus.map((m) => ({ value: m, label: m })),
  }) as string;
  if (p.isCancel(menu)) process.exit(0);

  const name = await p.text({
    message: 'Extension name',
    placeholder: `${menu}.MyExt`,
    defaultValue: `${menu}.MyExt`,
  }) as string;
  if (p.isCancel(name)) process.exit(0);

  const items: { label?: string; form: string }[] = [];
  p.log.step('Add menu items (leave form blank to finish)');

  while (true) {
    const itemForm = await p.select({
      message: 'Form for menu item',
      options: [{ value: '', label: '(done)' }, ...allForms.map((f) => ({ value: f, label: f }))],
    }) as string;
    if (p.isCancel(itemForm) || !itemForm) break;

    const itemLabel = await p.text({ message: 'Menu item label', placeholder: itemForm }) as string;
    if (p.isCancel(itemLabel)) break;

    items.push({ label: itemLabel || undefined, form: itemForm });
    p.log.success(`  Added: ${itemLabel || itemForm} -> ${itemForm}`);
  }

  const filepath = scaffoldMenuExtension(appDir, { name, menu, items });
  p.outro(pc.green(`Created ${filepath}`));
}

function listFromApps(root: string, appNames: string[], kindDir: string): string[] {
  const results: string[] = [];
  const appsDir = join(root, 'apps');

  const collect = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const file of readdirSync(dir)) {
      if (file.endsWith('.json')) results.push(file.replace('.json', ''));
    }
  };

  for (const appName of appNames) {
    const metaDir = join(appsDir, appName, 'metadata');
    if (!existsSync(metaDir)) continue;
    collect(join(metaDir, kindDir));
    // module layout: metadata/<Module>/<kind>/
    for (const sub of readdirSync(metaDir, { withFileTypes: true })) {
      if (sub.isDirectory()) collect(join(metaDir, sub.name, kindDir));
    }
  }
  return results;
}
