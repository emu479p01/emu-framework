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

export interface FieldReferenceMeta {
  table: string;
  displayField?: string;
  /** Fields to copy from the referenced record onto this record when the reference is selected. */
  copyFields?: { from: string; to: string }[];
}

export interface FieldMeta {
  name: string;
  type: FieldType;
  label?: string;
  mandatory?: boolean;
  readOnly?: boolean;
  maxLength?: number;
  enumName?: string;
  reference?: FieldReferenceMeta;
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

/** Safe, code-owned icon catalog used by app manifests and navigation metadata. */
export const ICON_NAMES = [
  'app', 'grid', 'users', 'settings', 'database', 'table', 'chart', 'shield', 'wrench', 'file',
] as const;
export type IconName = (typeof ICON_NAMES)[number];
export function isIconName(value: unknown): value is IconName {
  return typeof value === 'string' && (ICON_NAMES as readonly string[]).includes(value);
}

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

export interface AggregateMeta {
  fn: 'count' | 'sum' | 'avg';
  /** Required for sum/avg; ignored for count. */
  field?: string;
  label?: string;
}

export interface FormLineGridMeta {
  table: string;
  refField: string;
  fields: string[];
  aggregates?: AggregateMeta[];
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
  icon?: IconName;
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

// ---- PDF report designer ----

export type ReportElementType = 'text' | 'field' | 'image' | 'line' | 'rect';

export interface ReportElementStyle {
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  align?: 'left' | 'center' | 'right';
  color?: string;
  borderWidth?: number;
}

export interface ReportElementMeta {
  /** Stable id within the report, used by the canvas editor. */
  id: string;
  type: ReportElementType;
  /** Absolute position/size in points, relative to the top-left of the band. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Literal content for 'text' elements. */
  text?: string;
  /** Bound field path for 'field' elements — "field" on the main datasource, or "table.field" for a line source. */
  field?: string;
  /** Formatting token (e.g. date/number format) applied to a 'field' element's value. */
  format?: string;
  style?: ReportElementStyle;
}

export type ReportBandKind = 'pageHeader' | 'header' | 'detail' | 'footer' | 'pageFooter';

export interface ReportBandMeta {
  kind: ReportBandKind;
  /** Band height in points. */
  height: number;
  elements: ReportElementMeta[];
}

export interface ReportLineSourceMeta {
  /** Child/related table for a repeating detail section, e.g. invoice lines. */
  table: string;
  /** FK field on `table` pointing back to a record of the report's main dataSource. */
  refField: string;
  bands: ReportBandMeta[];
}

export interface ReportPageMeta {
  size?: 'A4' | 'Letter';
  orientation?: 'portrait' | 'landscape';
  /** [top, right, bottom, left], in points. */
  margins?: [number, number, number, number];
}

export interface ReportMeta {
  kind: 'report';
  name: string;
  app?: string;
  label?: string;
  /** Main table this report reads from — a single record (id filter) or a filtered/sorted list. */
  dataSource: string;
  page?: ReportPageMeta;
  bands: ReportBandMeta[];
  lineSources?: ReportLineSourceMeta[];
  layer?: LayerType;
  model?: string;
}

export interface AppManifest {
  name: string;
  label?: string;
  icon?: IconName;
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
  | ScriptMeta
  | ReportMeta;

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
  'report',
]);

export const SYSTEM_FIELDS = ['id', 'createdAt', 'createdBy', 'modifiedAt', 'modifiedBy'] as const;
export type SystemField = (typeof SYSTEM_FIELDS)[number];
