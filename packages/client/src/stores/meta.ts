import { defineStore } from 'pinia';
import { api } from '../api';
import type {
  AggregateMeta, DutyMeta, EnumMeta, FieldMeta, FormMeta, MenuItemMeta, MenuMeta,
  PrivilegeMeta, ReportMeta, RoleMeta, TableMeta,
} from '@emu/core';

export type { AggregateMeta, EnumMeta, FieldMeta, FormMeta, MenuMeta, ReportMeta, TableMeta };
export type MenuItem = MenuItemMeta;
export type SecurityMeta = Pick<PrivilegeMeta | DutyMeta | RoleMeta, 'name' | 'label' | 'app' | 'model' | 'layer'>;
export interface ModelEntry { name: string; label?: string; layer: string }
export interface AppEntry { name: string; label: string; icon?: import('@emu/core').IconName; models?: ModelEntry[]; modules: string[]; menus: MenuMeta[] }
export interface Metadata {
  branding: { title: string };
  tables: TableMeta[]; enums: EnumMeta[]; forms: FormMeta[]; reports: ReportMeta[];
  privileges: SecurityMeta[]; duties: SecurityMeta[]; roles: SecurityMeta[];
  frameworkMenus: MenuMeta[]; apps: AppEntry[];
}

export const useMeta = defineStore('meta', {
  state: () => ({ meta: null as Metadata | null }),
  getters: {
    apps: (state) => state.meta?.apps ?? [],
    frameworkMenus: (state) => state.meta?.frameworkMenus ?? [],
    menus: (state) => state.meta?.apps.flatMap((app) => app.menus) ?? [],
    table: (state) => (name: string) => state.meta?.tables.find((table) => table.name === name),
    form: (state) => (name: string) => state.meta?.forms.find((form) => form.name === name),
    enumOf: (state) => (name: string) => state.meta?.enums.find((entry) => entry.name === name),
    reportsFor: (state) => (tableName: string) => (state.meta?.reports ?? []).filter((report) => report.dataSource === tableName),
  },
  actions: {
    async load() { this.meta = await api.get<Metadata>('/api/metadata'); },
    fieldsFor(form: FormMeta): FieldMeta[] { return this.table(form.table)?.fields ?? []; },
    field(tableName: string, fieldName: string): FieldMeta | undefined { return this.table(tableName)?.fields.find((field) => field.name === fieldName); },
    enumLabel(enumName: string, value: unknown): string {
      const match = this.enumOf(enumName)?.values.find((entry) => entry.value === value);
      return match ? (match.label ?? match.name) : String(value ?? '');
    },
  },
});
