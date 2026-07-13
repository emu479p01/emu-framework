<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  NButton, NCheckbox, NCheckboxGroup, NDataTable, NDropdown, NEmpty, NInput,
  NPopover, NSelect, NSpace, useMessage, type DataTableColumns, type DataTableSortState,
} from 'naive-ui';
import { api, ApiError, type Row } from '../api';
import { useMeta } from '../stores/meta';
import ImportDialog from './ImportDialog.vue';
import ActionDialog from '../components/ActionDialog.vue';
import type { FormAction, ReportMeta } from '@emu/core';

const props = defineProps<{ formName: string; appName?: string }>();
const router = useRouter();
const meta = useMeta();
const message = useMessage();
const rows = ref<Row[]>([]);
const total = ref(0);
const loading = ref(false);
const errorMessage = ref('');
const page = ref(1);
const pageSize = 25;
const search = ref('');
const appliedSearch = ref('');
const filterField = ref<string | null>(null);
const appliedFilterField = ref<string | null>(null);
const sortKey = ref('id');
const sortDir = ref<'asc' | 'desc'>('desc');
const visibleFields = ref<string[]>([]);
const lookups = ref<Record<string, Record<number, string>>>({});
const showImport = ref(false);
const selectedReport = ref<ReportMeta | null>(null);
const reportAction = computed<FormAction | null>(() => selectedReport.value ? { label: selectedReport.value.label ?? selectedReport.value.name, type: 'report', target: selectedReport.value.name } : null);

const form = computed(() => meta.form(props.formName));
const table = computed(() => (form.value ? meta.table(form.value.table) : undefined));
const listFields = computed(() => {
  if (!form.value || !table.value) return [];
  const names = form.value.listFields ?? table.value.fields.map((field) => field.name);
  return names.map((fieldName) => table.value!.fields.find((field) => field.name === fieldName)).filter((field): field is NonNullable<typeof field> => Boolean(field));
});
watch(listFields, (fields) => { visibleFields.value = fields.map((field) => field.name); }, { immediate: true });
const shownFields = computed(() => listFields.value.filter((field) => visibleFields.value.includes(field.name)));
const filterFields = computed(() => {
  if (!form.value || !table.value) return [];
  const names = form.value.filterFields ?? listFields.value.map((field) => field.name);
  return names.map((name) => table.value!.fields.find((field) => field.name === name)).filter((field): field is NonNullable<typeof field> => Boolean(field));
});
const filterFieldOptions = computed(() => [
  { label: 'All columns', value: '' },
  ...filterFields.value.map((field) => ({ label: field.label ?? field.name, value: field.name })),
]);
const formPath = computed(() => props.appName ? `/app/${props.appName}` : '');
function display(field: (typeof listFields.value)[number], row: Row): string {
  const value = row[field.name];
  if (field.type === 'enum' && field.enumName) return meta.enumLabel(field.enumName, value);
  if (field.type === 'reference' && field.reference) return lookups.value[field.reference.table]?.[value as number] ?? String(value ?? '');
  if (field.type === 'boolean') return value ? 'Yes' : 'No';
  return String(value ?? '');
}
const columns = computed<DataTableColumns<Row>>(() => [
  ...shownFields.value.map((field) => ({
    title: field.label ?? field.name, key: field.name, sorter: true,
    sortOrder: sortKey.value === field.name ? (sortDir.value === 'asc' ? 'ascend' as const : 'descend' as const) : false as const,
    render: (row: Row) => display(field, row),
  })),
  { title: '', key: '_actions', width: 86, render: (row: Row) => h(NButton, { size: 'small', quaternary: true, onClick: (event: MouseEvent) => { event.stopPropagation(); router.push(`${formPath.value}/form/${props.formName}/${row.id}`); } }, () => 'Edit') },
]);

async function loadLookups() {
  const references = new Set(listFields.value.filter((field) => field.type === 'reference' && field.reference).map((field) => field.reference!.table));
  for (const name of references) {
    const titleField = meta.table(name)?.titleField ?? 'id';
    const { data } = await api.list(name, { limit: 500 });
    lookups.value[name] = Object.fromEntries(data.map((row) => [row.id, String(row[titleField] ?? row.id)]));
  }
}
async function load() {
  if (!table.value) return;
  loading.value = true; errorMessage.value = '';
  try {
    await loadLookups();
    const result = await api.list(table.value.name, {
      limit: pageSize, offset: (page.value - 1) * pageSize, sort: `${sortKey.value}:${sortDir.value}`,
      ...(appliedSearch.value && appliedFilterField.value ? { [`filter.${appliedFilterField.value}.contains`]: appliedSearch.value } : {}),
      ...(appliedSearch.value && !appliedFilterField.value ? { search: appliedSearch.value } : {}),
    });
    rows.value = result.data; total.value = result.total;
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : 'Records could not be loaded.';
    message.error(errorMessage.value);
  } finally { loading.value = false; }
}
watch([() => props.formName, page, sortKey, sortDir], load, { immediate: true });
function applySearch() { page.value = 1; appliedSearch.value = search.value.trim(); appliedFilterField.value = filterField.value || null; load(); }
function clearSearch() { search.value = ''; appliedSearch.value = ''; appliedFilterField.value = null; page.value = 1; load(); }
function onSorterChange(sorter: DataTableSortState | DataTableSortState[] | null) {
  const selected = Array.isArray(sorter) ? sorter[0] : sorter;
  if (!selected?.columnKey || !selected.order) { sortKey.value = 'id'; sortDir.value = 'desc'; return; }
  sortKey.value = String(selected.columnKey); sortDir.value = selected.order === 'ascend' ? 'asc' : 'desc';
}
const rowProps = (row: Row) => ({ style: 'cursor:pointer', onClick: () => router.push(`${formPath.value}/form/${props.formName}/${row.id}`) });
const exportOptions = [{ label: 'Export CSV', key: 'csv' }, { label: 'Export Excel', key: 'xlsx' }];
const reportOptions = computed(() => (table.value ? meta.reportsFor(table.value.name) : []).map((report) => ({ label: report.label ?? report.name, key: report.name })));
function printReport(name: string) {
  const report = meta.reportsFor(table.value!.name).find((item) => item.name === name);
  if (report) selectedReport.value = report;
}
function exportData(format: string) {
  if (!table.value) return;
  const link = document.createElement('a'); link.href = api.exportUrl(table.value.name, format as 'csv' | 'xlsx'); link.rel = 'noopener'; document.body.appendChild(link); link.click(); link.remove();
}
function back() { window.history.length > 1 ? router.back() : router.push(formPath.value || '/'); }
</script>

<template>
  <div v-if="form && table">
    <div class="list-heading">
      <div><h1>{{ form.label ?? form.name }}</h1><p>{{ total }} records</p></div>
      <n-space>
        <n-button @click="back">Back</n-button>
        <n-dropdown v-if="reportOptions.length" trigger="click" :options="reportOptions" @select="printReport"><n-button data-testid="print-report">Print</n-button></n-dropdown>
        <n-dropdown trigger="click" :options="exportOptions" @select="exportData"><n-button data-testid="export-data">Export</n-button></n-dropdown>
        <n-button data-testid="import-data" @click="showImport=true">Import</n-button>
        <n-button type="primary" data-testid="new-record" @click="router.push(`${formPath}/form/${formName}/new`)">+ New</n-button>
      </n-space>
    </div>
    <div class="list-tools">
      <n-select v-model:value="filterField" :options="filterFieldOptions" placeholder="All columns" clearable />
      <n-input v-model:value="search" clearable placeholder="Search records…" data-testid="list-search" @keyup.enter="applySearch" @clear="clearSearch" />
      <n-button @click="applySearch">Search</n-button>
      <n-popover trigger="click" placement="bottom-end"><template #trigger><n-button>Columns</n-button></template><n-checkbox-group v-model:value="visibleFields"><n-space vertical><n-checkbox v-for="field in listFields" :key="field.name" :value="field.name" :label="field.label ?? field.name" /></n-space></n-checkbox-group></n-popover>
    </div>
    <n-empty v-if="!loading && !errorMessage && rows.length === 0" :description="appliedSearch ? 'No records match your search.' : 'No records yet. Create the first one to get started.'" class="list-empty" />
    <div v-if="rows.length" class="mobile-cards">
      <button v-for="row in rows" :key="row.id" class="record-card" @click="router.push(`${formPath}/form/${formName}/${row.id}`)"><span v-for="field in shownFields.slice(0,4)" :key="field.name"><small>{{ field.label ?? field.name }}</small>{{ display(field,row) || '—' }}</span></button>
    </div>
    <n-data-table v-show="rows.length" class="desktop-table" :columns="columns" :data="rows" :loading="loading" :row-props="rowProps" :pagination="{ page, pageSize, itemCount: total, 'onUpdate:page': (value: number) => (page = value) }" remote @update:sorter="onSorterChange" />
    <ImportDialog v-model:show="showImport" :table-name="table.name" @imported="load" />
    <ActionDialog :show="selectedReport !== null" :action="reportAction" @update:show="(value) => { if (!value) selectedReport = null }" />
  </div>
</template>

<style scoped>
.list-heading{display:flex;justify-content:space-between;gap:16px;align-items:start;margin-bottom:22px}.list-heading h1{margin:0;font-size:30px;letter-spacing:-.04em}.list-heading p{margin:5px 0;color:var(--emu-muted)}.list-tools{display:grid;grid-template-columns:minmax(150px,220px) minmax(220px,420px) auto auto;gap:8px;margin-bottom:16px;padding:12px;background:#fff;border:1px solid var(--emu-border);border-radius:var(--emu-radius-lg);box-shadow:var(--emu-shadow-sm)}.desktop-table{border:1px solid var(--emu-border);border-radius:var(--emu-radius-lg);overflow:hidden;box-shadow:var(--emu-shadow-sm)}.list-empty{padding:70px 0;background:#fff;border:1px dashed var(--emu-border);border-radius:var(--emu-radius-lg)}.mobile-cards{display:none}.record-card{width:100%;border:1px solid var(--emu-border);background:#fff;border-radius:12px;padding:15px;text-align:left;margin-bottom:10px;box-shadow:var(--emu-shadow-sm)}.record-card span{display:block;margin-bottom:8px}.record-card small{display:block;color:var(--emu-muted);font-size:11px}@media(max-width:700px){.list-heading{display:block}.list-heading>.n-space{margin-top:12px}.list-tools{grid-template-columns:1fr}.list-tools>*:last-child{display:none}.desktop-table{display:none!important}.mobile-cards{display:block}}
</style>
