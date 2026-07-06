import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Write JSON, creating the kind directory if the app/module doesn't have it yet. */
function writeJson(path: string, json: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(json, null, 2));
}

export interface FieldDef {
  name: string;
  type: string;
  label?: string;
  mandatory?: boolean;
  maxLength?: number;
}

export interface IndexDef {
  name: string;
  fields: string[];
  unique?: boolean;
}

export interface EnumValueDef {
  name: string;
  value: number;
  label?: string;
}

export interface TablePermissionDef {
  table: string;
  read?: boolean;
  create?: boolean;
  update?: boolean;
  delete?: boolean;
}

export interface FormGroupDef {
  label?: string;
  fields: string[];
}

export interface MenuItemDef {
  label?: string;
  form: string;
}

export function scaffoldTable(
  metaDir: string,
  data: { name: string; label: string; titleField?: string; fields: FieldDef[]; indexes?: IndexDef[] },
): string {
  const path = join(metaDir, 'tables', `${data.name}.json`);
  const json = {
    kind: 'table',
    name: data.name,
    label: data.label,
    ...(data.titleField ? { titleField: data.titleField } : {}),
    fields: data.fields.map(f => ({
      name: f.name,
      type: f.type,
      ...(f.label ? { label: f.label } : {}),
      ...(f.mandatory ? { mandatory: true } : {}),
      ...(f.maxLength ? { maxLength: f.maxLength } : {}),
    })),
    ...(data.indexes && data.indexes.length > 0 ? { indexes: data.indexes } : {}),
  };
  writeJson(path, json);
  return path;
}

export function scaffoldEnum(
  metaDir: string,
  data: { name: string; label: string; values: EnumValueDef[] },
): string {
  const path = join(metaDir, 'enums', `${data.name}.json`);
  writeJson(path, { kind: 'enum', name: data.name, label: data.label, values: data.values });
  return path;
}

export function scaffoldForm(
  metaDir: string,
  data: {
    name: string;
    label: string;
    table: string;
    listFields?: string[];
    groups?: FormGroupDef[];
    actions?: { label: string; action: string }[];
    lines?: { table: string; refField: string; fields: string[] }[];
  },
): string {
  const path = join(metaDir, 'forms', `${data.name}.json`);
  const json: Record<string, unknown> = {
    kind: 'form',
    name: data.name,
    label: data.label,
    table: data.table,
  };
  if (data.listFields && data.listFields.length > 0) json.listFields = data.listFields;
  if (data.groups && data.groups.length > 0) json.groups = data.groups;
  if (data.actions && data.actions.length > 0) json.actions = data.actions;
  if (data.lines && data.lines.length > 0) json.lines = data.lines;
  writeJson(path, json);
  return path;
}

export function scaffoldMenu(
  metaDir: string,
  data: { name: string; label: string; items: MenuItemDef[] },
): string {
  const path = join(metaDir, 'menus', `${data.name}.json`);
  writeJson(path, { kind: 'menu', name: data.name, label: data.label, items: data.items });
  return path;
}

export function scaffoldPrivilege(
  metaDir: string,
  data: {
    name: string;
    label: string;
    tablePermissions?: TablePermissionDef[];
    forms?: string[];
  },
): string {
  const path = join(metaDir, 'privileges', `${data.name}.json`);
  const json: Record<string, unknown> = { kind: 'privilege', name: data.name, label: data.label };
  if (data.tablePermissions) json.tablePermissions = data.tablePermissions;
  if (data.forms) json.forms = data.forms;
  writeJson(path, json);
  return path;
}

export function scaffoldDuty(
  metaDir: string,
  data: { name: string; label: string; privileges: string[] },
): string {
  const path = join(metaDir, 'duties', `${data.name}.json`);
  writeJson(path, { kind: 'duty', name: data.name, label: data.label, privileges: data.privileges });
  return path;
}

export function scaffoldRole(
  metaDir: string,
  data: { name: string; label: string; duties?: string[]; privileges?: string[] },
): string {
  const path = join(metaDir, 'roles', `${data.name}.json`);
  const json: Record<string, unknown> = { kind: 'role', name: data.name, label: data.label };
  if (data.duties) json.duties = data.duties;
  if (data.privileges) json.privileges = data.privileges;
  writeJson(path, json);
  return path;
}
