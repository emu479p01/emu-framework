import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FieldDef, IndexDef, FormGroupDef, MenuItemDef } from './object.js';

function ensureDir(path: string) {
  mkdirSync(dirname(path), { recursive: true });
}

export function scaffoldTableExtension(
  appDir: string,
  data: { name: string; table: string; fields?: FieldDef[]; indexes?: IndexDef[] },
): string {
  const path = join(appDir, 'metadata', 'tableExtensions', `${data.name}.json`);
  ensureDir(path);
  const json: Record<string, unknown> = { kind: 'tableExtension', name: data.name, table: data.table };
  if (data.fields && data.fields.length > 0) json.fields = data.fields;
  if (data.indexes && data.indexes.length > 0) json.indexes = data.indexes;
  writeFileSync(path, JSON.stringify(json, null, 2));
  return path;
}

export function scaffoldFormExtension(
  appDir: string,
  data: { name: string; form: string; listFields?: string[]; groups?: FormGroupDef[] },
): string {
  const path = join(appDir, 'metadata', 'formExtensions', `${data.name}.json`);
  ensureDir(path);
  const json: Record<string, unknown> = { kind: 'formExtension', name: data.name, form: data.form };
  if (data.listFields && data.listFields.length > 0) json.listFields = data.listFields;
  if (data.groups && data.groups.length > 0) json.groups = data.groups;
  writeFileSync(path, JSON.stringify(json, null, 2));
  return path;
}

export function scaffoldMenuExtension(
  appDir: string,
  data: { name: string; menu: string; items: MenuItemDef[] },
): string {
  const path = join(appDir, 'metadata', 'menuExtensions', `${data.name}.json`);
  ensureDir(path);
  writeFileSync(
    path,
    JSON.stringify(
      { kind: 'menuExtension', name: data.name, menu: data.menu, items: data.items },
      null,
      2,
    ),
  );
  return path;
}
