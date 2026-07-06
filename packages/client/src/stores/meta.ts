import { defineStore } from 'pinia';
import { api } from '../api';

export interface FieldMeta {
  name: string;
  type: string;
  label?: string;
  mandatory?: boolean;
  readOnly?: boolean;
  maxLength?: number;
  enumName?: string;
  reference?: { table: string; displayField?: string; copyFields?: { from: string; to: string }[] };
}
export interface TableMeta {
  name: string;
  app?: string;
  model?: string;
  layer?: string;
  label?: string;
  titleField?: string;
  fields: FieldMeta[];
}
export interface EnumMeta {
  name: string;
  app?: string;
  model?: string;
  layer?: string;
  values: { name: string; value: number; label?: string }[];
}
export interface AggregateMeta {
  fn: 'count' | 'sum' | 'avg';
  field?: string;
  label?: string;
}

export interface FormMeta {
  name: string;
  table: string;
  label?: string;
  app?: string;
  model?: string;
  layer?: string;
  actions?: { label: string; action: string }[];
  listFields?: string[];
  groups?: { label?: string; fields: string[] }[];
  lines?: { table: string; refField: string; fields: string[]; aggregates?: AggregateMeta[] }[];
}

export interface MenuItem {
  label?: string;
  form?: string;
  route?: string;
  items?: MenuItem[];
}

export interface MenuMeta {
  name: string;
  app?: string;
  model?: string;
  layer?: string;
  label?: string;
  items: MenuItem[];
}

export interface ReportMeta {
  name: string;
  label?: string;
  app?: string;
  model?: string;
  layer?: string;
  dataSource: string;
}

export interface SecurityMeta {
  name: string;
  label?: string;
  app?: string;
  model?: string;
  layer?: string;
}

export interface ModelEntry {
  name: string;
  label?: string;
  layer: string;
}

export interface AppEntry {
  name: string;
  label: string;
  models?: ModelEntry[];
  modules: string[];
  menus: MenuMeta[];
}

interface Metadata {
  branding: { title: string };
  tables: TableMeta[];
  enums: EnumMeta[];
  forms: FormMeta[];
  reports: ReportMeta[];
  privileges: SecurityMeta[];
  duties: SecurityMeta[];
  roles: SecurityMeta[];
  frameworkMenus: MenuMeta[];
  apps: AppEntry[];
}

export const useMeta = defineStore('meta', {
  state: () => ({ meta: null as Metadata | null }),
  getters: {
    apps: (s) => s.meta?.apps ?? [],
    frameworkMenus: (s) => s.meta?.frameworkMenus ?? [],
    menus: (s) => s.meta?.apps.flatMap((a) => a.menus) ?? [],
    table: (s) => (name: string) => s.meta?.tables.find((t) => t.name === name),
    form: (s) => (name: string) => s.meta?.forms.find((f) => f.name === name),
    enumOf: (s) => (name: string) => s.meta?.enums.find((e) => e.name === name),
    reportsFor: (s) => (tableName: string) => (s.meta?.reports ?? []).filter((r) => r.dataSource === tableName),
  },
  actions: {
    async load() {
      this.meta = await api.get<Metadata>('/api/metadata');
    },
    fieldsFor(form: FormMeta): FieldMeta[] {
      const table = this.table(form.table);
      return table?.fields ?? [];
    },
    field(tableName: string, fieldName: string): FieldMeta | undefined {
      return this.table(tableName)?.fields.find((f) => f.name === fieldName);
    },
    enumLabel(enumName: string, value: unknown): string {
      const ev = this.enumOf(enumName)?.values.find((v) => v.value === value);
      return ev ? (ev.label ?? ev.name) : String(value ?? '');
    },
  },
});
