import { defineCommand } from 'citty';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { findProjectRoot, getAppDir } from '../utils/paths.js';
import { isInteractive, requireInteractive } from '../utils/tty.js';
import {
  scaffoldTable,
  scaffoldEnum,
  scaffoldForm,
  scaffoldMenu,
  scaffoldPrivilege,
  scaffoldDuty,
  scaffoldRole,
} from '../scaffold/object.js';

type ObjectKind = 'table' | 'enum' | 'form' | 'menu' | 'privilege' | 'duty' | 'role';
const KINDS: ObjectKind[] = ['table', 'enum', 'form', 'menu', 'privilege', 'duty', 'role'];

export const addObjectCommand = defineCommand({
  meta: {
    name: 'object',
    description: 'Scaffold a metadata object (table, enum, form, menu, privilege, duty, role)',
  },
  args: {
    app: {
      type: 'positional',
      description: 'Target app name',
      required: true,
    },
    kind: {
      type: 'positional',
      description: KINDS.join(' | '),
      required: true,
    },
    module: {
      type: 'positional',
      description: 'Module name (optional)',
      required: false,
    },
    // non-interactive flags — when provided, no wizard is needed (works without a TTY)
    name: { type: 'string', description: 'Object name (PascalCase)' },
    label: { type: 'string', description: 'Display label' },
    titleField: { type: 'string', description: 'table: title field for lookups' },
    fields: {
      type: 'string',
      description: 'table: comma list "name:type[:mandatory]", e.g. "accountNum:string:mandatory,qty:real"',
    },
    values: {
      type: 'string',
      description: 'enum: comma list "Name=0,Other=1" (codes optional)',
    },
    table: { type: 'string', description: 'form: base table name' },
    items: { type: 'string', description: 'menu: comma list "Label=FormName"' },
  },
  async run({ args }) {
    const root = findProjectRoot();
    const appDir = getAppDir(root, args.app);
    if (!existsSync(appDir)) {
      console.error(pc.red(`App '${args.app}' not found at ${appDir}`));
      process.exit(1);
    }

    const kind = args.kind as ObjectKind;
    if (!KINDS.includes(kind)) {
      console.error(pc.red(`Unknown kind '${kind}'. Use: ${KINDS.join(', ')}`));
      process.exit(1);
    }

    const flags = {
      name: args.name as string | undefined,
      label: args.label as string | undefined,
      titleField: args.titleField as string | undefined,
      fields: args.fields as string | undefined,
      values: args.values as string | undefined,
      table: args.table as string | undefined,
      items: args.items as string | undefined,
    };

    // Detect available modules
    const modules = listModules(appDir);
    let moduleName = (args.module as string) || undefined;
    if (!moduleName && modules.length > 0 && isInteractive() && !flags.name) {
      moduleName = await p.select({
        message: 'Module (optional)',
        options: [{ value: '', label: '(root level)' }, ...modules.map((m: string) => ({ value: m, label: m }))],
      }) as string;
      if (p.isCancel(moduleName)) process.exit(0);
      if (!moduleName) moduleName = undefined;
    }

    const targetDir = moduleName ? join(appDir, 'metadata', moduleName) : join(appDir, 'metadata');

    console.log('');
    p.intro(pc.cyan(`Add ${kind} to ${args.app}${moduleName ? ` / ${moduleName}` : ''}`));

    switch (kind) {
      case 'table': await addTable(root, targetDir, flags); break;
      case 'enum': await addEnum(targetDir, flags); break;
      case 'form': await addForm(root, targetDir, flags); break;
      case 'menu': await addMenu(root, targetDir, flags); break;
      case 'privilege':
        requireInteractive(`Privileges have no non-interactive mode yet — run from a real terminal or create apps/${args.app}/metadata/.../privileges/<Name>.json by hand.`);
        await addPrivilege(root, targetDir);
        break;
      case 'duty':
        requireInteractive(`Duties have no non-interactive mode yet — run from a real terminal or create the JSON by hand.`);
        await addDuty(root, targetDir);
        break;
      case 'role':
        requireInteractive(`Roles have no non-interactive mode yet — run from a real terminal or create the JSON by hand.`);
        await addRole(root, targetDir);
        break;
    }
  },
});

const FIELD_TYPES = [
  { value: 'string', label: 'string' },
  { value: 'int', label: 'int' },
  { value: 'real', label: 'real' },
  { value: 'boolean', label: 'boolean' },
  { value: 'date', label: 'date' },
  { value: 'datetime', label: 'datetime' },
  { value: 'enum', label: 'enum' },
  { value: 'reference', label: 'reference' },
];

interface Flags {
  name?: string;
  label?: string;
  titleField?: string;
  fields?: string;
  values?: string;
  table?: string;
  items?: string;
}

/** "accountNum:string:mandatory,qty:real" → FieldDef[] */
function parseFields(spec: string) {
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [name, type = 'string', flag] = s.split(':').map((x) => x.trim());
      return { name, type, mandatory: flag === 'mandatory' || undefined };
    });
}

async function addTable(root: string, appDir: string, flags: Flags) {
  if (flags.name) {
    const fields = parseFields(flags.fields ?? '');
    const filepath = scaffoldTable(appDir, {
      name: flags.name,
      label: flags.label ?? flags.name,
      titleField: flags.titleField,
      fields,
    });
    p.outro(pc.green(`Created ${filepath}`));
    return;
  }
  requireInteractive('Non-interactive: pnpm emu add object <app> table --name MyTable --fields "code:string:mandatory,qty:real" [--label ... --titleField ...]');

  const name = await p.text({ message: 'Table name (PascalCase)', placeholder: 'MyTable' });
  if (p.isCancel(name)) process.exit(0);

  const label = await p.text({ message: 'Table label', placeholder: 'My Table' });
  if (p.isCancel(label)) process.exit(0);

  const titleField = await p.text({ message: 'Title field (for display in lookups)', placeholder: 'name', defaultValue: 'name' });
  if (p.isCancel(titleField)) process.exit(0);

  const fields: { name: string; type: string; label?: string; mandatory?: boolean }[] = [];
  p.log.step('Add fields (leave name empty to finish)');

  while (true) {
    const fName = await p.text({ message: 'Field name' });
    if (p.isCancel(fName) || !fName) break;

    const fType = await p.select({ message: 'Field type', options: FIELD_TYPES }) as string;
    if (p.isCancel(fType)) process.exit(0);

    const fLabel = await p.text({ message: `Label for ${fName} (optional)` });
    if (p.isCancel(fLabel)) process.exit(0);

    const mandatory = await p.confirm({ message: 'Mandatory?', initialValue: false });
    if (p.isCancel(mandatory)) process.exit(0);

    fields.push({ name: fName, type: fType, label: fLabel || undefined, mandatory: mandatory === true });
    p.log.success(`  Added: ${fName} (${fType})`);
  }

  const filepath = scaffoldTable(appDir, { name, label, titleField, fields });
  p.outro(pc.green(`Created ${filepath}`));
}

async function addEnum(appDir: string, flags: Flags) {
  if (flags.name) {
    let next = 0;
    const values = (flags.values ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const [vName, vCode] = s.split('=').map((x) => x.trim());
        const value = vCode !== undefined ? Number(vCode) : next;
        next = value + 1;
        return { name: vName, value };
      });
    const filepath = scaffoldEnum(appDir, { name: flags.name, label: flags.label ?? flags.name, values });
    p.outro(pc.green(`Created ${filepath}`));
    return;
  }
  requireInteractive('Non-interactive: pnpm emu add object <app> enum --name MyEnum --values "Open=0,Closed=1"');

  const name = await p.text({ message: 'Enum name (PascalCase)', placeholder: 'MyEnum' });
  if (p.isCancel(name)) process.exit(0);

  const label = await p.text({ message: 'Enum label', placeholder: 'My Enum' });
  if (p.isCancel(label)) process.exit(0);

  const values: { name: string; value: number }[] = [];
  let nextVal = 0;
  p.log.step('Add enum values (leave name empty to finish)');

  while (true) {
    const vName = await p.text({ message: 'Value name' });
    if (p.isCancel(vName) || !vName) break;

    const vCode = await p.text({ message: 'Numeric code', defaultValue: String(nextVal) });
    if (p.isCancel(vCode)) process.exit(0);

    const code = Number(vCode) || nextVal;
    nextVal = code + 1;
    values.push({ name: vName, value: code });
    p.log.success(`  Added: ${vName} = ${code}`);
  }

  const filepath = scaffoldEnum(appDir, { name, label, values });
  p.outro(pc.green(`Created ${filepath}`));
}

async function addForm(root: string, appDir: string, flags: Flags) {
  if (flags.table) {
    const filepath = scaffoldForm(appDir, {
      name: flags.name ?? `${flags.table}Form`,
      label: flags.label ?? flags.table,
      table: flags.table,
    });
    p.outro(pc.green(`Created ${filepath}`));
    p.log.message(pc.dim('Edit the JSON to add groups, listFields, actions, and lines.'));
    return;
  }
  requireInteractive('Non-interactive: pnpm emu add object <app> form --table MyTable [--name MyTableForm --label ...]');

  const allTables = listAllByKind(root, 'tables');
  const table = await p.select({ message: 'Base table for this form', options: allTables.map((t) => ({ value: t, label: t })) }) as string;
  if (p.isCancel(table)) process.exit(0);

  const name = await p.text({ message: 'Form name (PascalCase)', placeholder: `${table}Form` });
  if (p.isCancel(name)) process.exit(0);

  const label = await p.text({ message: 'Form label', placeholder: table });
  if (p.isCancel(label)) process.exit(0);

  const filepath = scaffoldForm(appDir, { name, label, table });
  p.outro(pc.green(`Created ${filepath}`));
  p.log.message(pc.dim('Edit the JSON to add groups, listFields, actions, and lines.'));
}

async function addMenu(root: string, appDir: string, flags: Flags) {
  if (flags.name) {
    const items = (flags.items ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const [label, form] = s.includes('=') ? s.split('=').map((x) => x.trim()) : [undefined, s];
        return { label: label || undefined, form: form! };
      });
    const filepath = scaffoldMenu(appDir, { name: flags.name, label: flags.label ?? flags.name, items });
    p.outro(pc.green(`Created ${filepath}`));
    return;
  }
  requireInteractive('Non-interactive: pnpm emu add object <app> menu --name MainMenu --items "Customers=CustTableForm,Items=InventItemForm"');

  const allForms = listAllByKind(root, 'forms');
  const name = await p.text({ message: 'Menu name (PascalCase)', placeholder: 'MainMenu' });
  if (p.isCancel(name)) process.exit(0);

  const label = await p.text({ message: 'Menu label', placeholder: 'Navigation' });
  if (p.isCancel(label)) process.exit(0);

  const items: { label?: string; form: string }[] = [];
  p.log.step('Add menu items (leave form blank to finish)');

  while (true) {
    const form = await p.select({
      message: 'Form for this menu item',
      options: [{ value: '', label: '(done)' }, ...allForms.map((f) => ({ value: f, label: f }))],
    }) as string;
    if (p.isCancel(form) || !form) break;

    const itemLabel = await p.text({ message: 'Menu item label', placeholder: form }) as string;
    if (p.isCancel(itemLabel)) break;

    items.push({ label: itemLabel || undefined, form });
    p.log.success(`  Added: ${itemLabel || form} -> ${form}`);
  }

  const filepath = scaffoldMenu(appDir, { name, label, items });
  p.outro(pc.green(`Created ${filepath}`));
}

async function addPrivilege(root: string, appDir: string) {
  const allTables = listAllByKind(root, 'tables');
  const allForms = listAllByKind(root, 'forms');

  const name = await p.text({ message: 'Privilege name (PascalCase)', placeholder: 'MyPrivilege' });
  if (p.isCancel(name)) process.exit(0);

  const label = await p.text({ message: 'Privilege label', placeholder: 'My privilege' });
  if (p.isCancel(label)) process.exit(0);

  const tablePermissions: { table: string; read?: boolean; create?: boolean; update?: boolean; delete?: boolean }[] = [];
  p.log.step('Add table permissions (leave table blank to finish)');

  while (true) {
    const table = await p.select({
      message: 'Table for permission',
      options: [{ value: '', label: '(done)' }, ...allTables.map((t) => ({ value: t, label: t }))],
    }) as string;
    if (p.isCancel(table) || !table) break;

    const read = await p.confirm({ message: 'Read?', initialValue: true });
    if (p.isCancel(read)) process.exit(0);

    const create = await p.confirm({ message: 'Create?', initialValue: false });
    if (p.isCancel(create)) process.exit(0);

    const update = await p.confirm({ message: 'Update?', initialValue: false });
    if (p.isCancel(update)) process.exit(0);

    const del = await p.confirm({ message: 'Delete?', initialValue: false });
    if (p.isCancel(del)) process.exit(0);

    tablePermissions.push({ table, read: read === true, create: create === true, update: update === true, delete: del === true });
    p.log.success(`  Added: ${table}`);
  }

  const forms = await p.multiselect({
    message: 'Accessible forms (optional)',
    options: allForms.map((f) => ({ value: f, label: f })),
    required: false,
  }) as string[];
  if (p.isCancel(forms)) process.exit(0);

  const filepath = scaffoldPrivilege(appDir, {
    name,
    label,
    tablePermissions: tablePermissions.length > 0 ? tablePermissions : undefined,
    forms: forms.length > 0 ? forms : undefined,
  });

  p.outro(pc.green(`Created ${filepath}`));
}

async function addDuty(root: string, appDir: string) {
  const allPrivileges = listAllByKind(root, 'privileges');

  const name = await p.text({ message: 'Duty name (PascalCase)', placeholder: 'MyDuty' });
  if (p.isCancel(name)) process.exit(0);

  const label = await p.text({ message: 'Duty label', placeholder: 'My duty' });
  if (p.isCancel(label)) process.exit(0);

  const privs = await p.multiselect({
    message: 'Privileges in this duty',
    options: allPrivileges.map((n) => ({ value: n, label: n })),
    required: true,
  }) as string[];
  if (p.isCancel(privs)) process.exit(0);

  const filepath = scaffoldDuty(appDir, { name, label, privileges: privs });
  p.outro(pc.green(`Created ${filepath}`));
}

async function addRole(root: string, appDir: string) {
  const allDuties = listAllByKind(root, 'duties');
  const allPrivileges = listAllByKind(root, 'privileges');

  const name = await p.text({ message: 'Role name (PascalCase)', placeholder: 'MyRole' });
  if (p.isCancel(name)) process.exit(0);

  const label = await p.text({ message: 'Role label', placeholder: 'My role' });
  if (p.isCancel(label)) process.exit(0);

  let duties: string[] | undefined;
  let privileges: string[] | undefined;

  if (allDuties.length > 0) {
    const d = await p.multiselect({
      message: 'Duties (optional)',
      options: allDuties.map((n) => ({ value: n, label: n })),
      required: false,
    }) as string[];
    if (p.isCancel(d)) process.exit(0);
    if (d.length > 0) duties = d;
  }

  if (allPrivileges.length > 0) {
    const priv = await p.multiselect({
      message: 'Direct privileges (optional)',
      options: allPrivileges.map((n) => ({ value: n, label: n })),
      required: false,
    }) as string[];
    if (p.isCancel(priv)) process.exit(0);
    if (priv.length > 0) privileges = priv;
  }

  const filepath = scaffoldRole(appDir, { name, label, duties, privileges });
  p.outro(pc.green(`Created ${filepath}`));
}

function listAllByKind(root: string, kindDir: string): string[] {
  const results: string[] = [];
  const appsDir = join(root, 'apps');
  if (!existsSync(appsDir)) return results;

  const collect = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const file of readdirSync(dir)) {
      if (file.endsWith('.json')) results.push(file.replace('.json', ''));
    }
  };

  for (const app of readdirSync(appsDir, { withFileTypes: true })) {
    if (!app.isDirectory()) continue;
    const metaDir = join(appsDir, app.name, 'metadata');
    if (!existsSync(metaDir)) continue;
    // kind dir at app root: metadata/<kind>/
    collect(join(metaDir, kindDir));
    // and inside each module: metadata/<Module>/<kind>/
    for (const sub of readdirSync(metaDir, { withFileTypes: true })) {
      if (sub.isDirectory()) collect(join(metaDir, sub.name, kindDir));
    }
  }
  return results;
}

function listModules(appDir: string): string[] {
  const metaDir = join(appDir, 'metadata');
  if (!existsSync(metaDir)) return [];
  const known = new Set(['tables', 'enums', 'forms', 'menus', 'privileges', 'duties', 'roles', 'tableExtensions', 'formExtensions', 'menuExtensions']);
  return readdirSync(metaDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !known.has(d.name))
    .map((d) => d.name);
}
