/**
 * Metadata type definitions — the heart of the framework.
 * Apps declare tables/enums/forms/menus as JSON files matching these shapes,
 * and the framework generates schema, data API, and UI from them.
 */

export type FieldType =
  | 'string'
  | 'int'
  | 'real'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'enum'
  | 'reference';

export interface FieldMeta {
  name: string;
  type: FieldType;
  label?: string;
  mandatory?: boolean;
  readOnly?: boolean;
  maxLength?: number;
  enumName?: string;
  reference?: { table: string; displayField?: string };
  default?: string | number | boolean | null;
}

export interface IndexMeta {
  name: string;
  fields: string[];
  unique?: boolean;
}

/** Layer priority — higher layers override lower layers. */
export type LayerType = 'SYS' | 'ISV' | 'LOC' | 'DEV' | 'CUS';
export const LAYER_ORDER: readonly LayerType[] = ['SYS', 'ISV', 'LOC', 'DEV', 'CUS'] as const;
export const DEFAULT_LAYER: LayerType = 'SYS';

export interface TableMeta {
  kind: 'table';
  name: string;
  app?: string;
  label?: string;
  titleField?: string;
  fields: FieldMeta[];
  indexes?: IndexMeta[];
  layer?: LayerType;
  model?: string;
}

export interface EnumValueMeta {
  name: string;
  value: number;
  label?: string;
}

export interface EnumMeta {
  kind: 'enum';
  name: string;
  app?: string;
  label?: string;
  values: EnumValueMeta[];
  layer?: LayerType;
  model?: string;
}

export interface FormLineGridMeta {
  table: string;
  refField: string;
  fields: string[];
}

export interface FormGroupMeta {
  label?: string;
  fields: string[];
}

export interface FormAction {
  label: string;
  action: string;
}

export interface FormMeta {
  kind: 'form';
  name: string;
  app?: string;
  table: string;
  label?: string;
  actions?: FormAction[];
  listFields?: string[];
  groups?: FormGroupMeta[];
  lines?: FormLineGridMeta[];
  layer?: LayerType;
  model?: string;
}

export interface MenuItemMeta {
  label?: string;
  form?: string;
  route?: string;
  items?: MenuItemMeta[];
}

export interface MenuMeta {
  kind: 'menu';
  name: string;
  app?: string;
  label?: string;
  items: MenuItemMeta[];
  layer?: LayerType;
  model?: string;
}

// ---- security ----

export interface TablePermission {
  table: string;
  read?: boolean;
  create?: boolean;
  update?: boolean;
  delete?: boolean;
}

export interface PrivilegeMeta {
  kind: 'privilege';
  name: string;
  app?: string;
  label?: string;
  tablePermissions?: TablePermission[];
  forms?: string[];
  layer?: LayerType;
  model?: string;
}

export interface DutyMeta {
  kind: 'duty';
  name: string;
  app?: string;
  label?: string;
  privileges: string[];
  layer?: LayerType;
  model?: string;
}

export interface RoleMeta {
  kind: 'role';
  name: string;
  app?: string;
  label?: string;
  duties?: string[];
  privileges?: string[];
  layer?: LayerType;
  model?: string;
}

// ---- extensions ----

export interface TableExtensionMeta {
  kind: 'tableExtension';
  name: string;
  app?: string;
  table: string;
  fields?: FieldMeta[];
  indexes?: IndexMeta[];
  layer?: LayerType;
  model?: string;
}

export interface FormExtensionMeta {
  kind: 'formExtension';
  name: string;
  app?: string;
  form: string;
  listFields?: string[];
  groups?: FormGroupMeta[];
  layer?: LayerType;
  model?: string;
}

export interface MenuExtensionMeta {
  kind: 'menuExtension';
  name: string;
  app?: string;
  menu: string;
  items: MenuItemMeta[];
  layer?: LayerType;
  model?: string;
}

export interface EnumExtensionMeta {
  kind: 'enumExtension';
  name: string;
  app?: string;
  enum: string;
  values: EnumValueMeta[];
  layer?: LayerType;
  model?: string;
}

export interface PrivilegeExtensionMeta {
  kind: 'privilegeExtension';
  name: string;
  app?: string;
  privilege: string;
  tablePermissions?: TablePermission[];
  forms?: string[];
  layer?: LayerType;
  model?: string;
}

export interface DutyExtensionMeta {
  kind: 'dutyExtension';
  name: string;
  app?: string;
  duty: string;
  privileges?: string[];
  layer?: LayerType;
  model?: string;
}

export interface RoleExtensionMeta {
  kind: 'roleExtension';
  name: string;
  app?: string;
  role: string;
  duties?: string[];
  privileges?: string[];
  layer?: LayerType;
  model?: string;
}

export interface ScriptMeta {
  kind: 'script';
  name: string;
  app?: string;
  label?: string;
  code: string;
  layer?: LayerType;
  model?: string;
}

export interface ScriptExtensionMeta {
  kind: 'scriptExtension';
  name: string;
  app?: string;
  script: string;
  code: string;
  layer?: LayerType;
  model?: string;
}

export interface AppManifest {
  name: string;
  label?: string;
  dependsOn?: string[];
  /** Model definitions: name → layer */
  models?: { name: string; label?: string; layer: LayerType }[];
}

export type AnyMeta =
  | TableMeta
  | EnumMeta
  | FormMeta
  | MenuMeta
  | PrivilegeMeta
  | DutyMeta
  | RoleMeta
  | TableExtensionMeta
  | FormExtensionMeta
  | MenuExtensionMeta
  | EnumExtensionMeta
  | PrivilegeExtensionMeta
  | DutyExtensionMeta
  | RoleExtensionMeta
  | ScriptExtensionMeta
  | ScriptMeta;

/** All extension kinds (accumulate into base, never override). */
export const EXTENSION_KINDS = new Set([
  'tableExtension',
  'formExtension',
  'menuExtension',
  'enumExtension',
  'privilegeExtension',
  'dutyExtension',
  'roleExtension',
  'scriptExtension',
]);

/** All non-extension kinds (can override by layer). */
export const BASE_KINDS = new Set([
  'table',
  'enum',
  'form',
  'menu',
  'privilege',
  'duty',
  'role',
  'script',
]);

export const SYSTEM_FIELDS = ['id', 'createdAt', 'createdBy', 'modifiedAt', 'modifiedBy'] as const;
export type SystemField = (typeof SYSTEM_FIELDS)[number];
