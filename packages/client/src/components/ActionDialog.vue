<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import { NAlert, NButton, NDataTable, NInput, NInputNumber, NModal, NSpace, useMessage, type DataTableColumns } from 'naive-ui';
import type { FormAction, ReportMeta } from '@emu/core';
import { api, ApiError, type Row } from '../api';
import { useMeta } from '../stores/meta';
import FieldControl from './FieldControl.vue';

const props = defineProps<{ show: boolean; action: FormAction | null; recordId?: number; lineId?: number; record?: Record<string, unknown>; lineRecord?: Record<string, unknown> }>();
const emit = defineEmits<{ 'update:show': [value: boolean]; completed: [] }>();
const meta = useMeta(); const message = useMessage();
const busy = ref(false); const error = ref(''); const rows = ref<Row[]>([]); const search = ref('');
const selectedIds = ref<number[]>([]); const quantities = ref<Record<number, number>>({}); const reportValues = ref<Record<string, unknown>>({});
const type = computed(() => props.action?.type ?? 'function');
const target = computed(() => props.action?.target ?? props.action?.action ?? '');
const report = computed<ReportMeta | undefined>(() => type.value === 'report' ? meta.meta?.reports.find((entry) => entry.name === target.value) : undefined);
const picker = computed(() => props.action?.picker);
const table = computed(() => picker.value ? meta.table(picker.value.table) : undefined);
function resolveFilterValue(value: NonNullable<NonNullable<FormAction['picker']>['filters']>[number]['value']): unknown {
  if (typeof value !== 'object' || value === null || !('source' in value)) return value;
  return value.source === 'line' ? props.lineRecord?.[value.field] : props.record?.[value.field];
}
async function loadPicker() {
  if (!picker.value) return;
  busy.value = true; error.value = '';
  try {
    const params: Record<string, string | number> = { limit: 500, ...(search.value.trim() ? { search: search.value.trim() } : {}) };
    for (const filter of picker.value.filters ?? []) {
      const value = resolveFilterValue(filter.value);
      if (value !== undefined && value !== null && value !== '') params[`filter.${filter.field}.${filter.operator}`] = String(value);
    }
    rows.value = (await api.list(picker.value.table, params)).data;
  } catch (e) { error.value = e instanceof ApiError ? e.message : String(e); }
  finally { busy.value = false; }
}
watch(() => props.show, (show) => { if (!show) return; error.value = ''; selectedIds.value = []; quantities.value = {}; reportValues.value = {}; search.value = ''; if (type.value === 'picker') loadPicker(); });
const pickerColumns = computed<DataTableColumns<Row>>(() => {
  if (!picker.value) return [];
  const columns: DataTableColumns<Row> = [{ type: 'selection', multiple: picker.value.multiple !== false }];
  for (const name of picker.value.columns) columns.push({ title: table.value?.fields.find((field) => field.name === name)?.label ?? name, key: name, ellipsis: { tooltip: true } });
  if (picker.value.allocation && !picker.value.columns.includes(picker.value.allocation.availableField)) {
    const availableName = picker.value.allocation.availableField;
    columns.push({ title: table.value?.fields.find((field) => field.name === availableName)?.label ?? availableName, key: availableName });
  }
  if (picker.value.allocation) columns.push({
    title: picker.value.allocation.quantityLabel ?? 'Selected quantity', key: '_quantity', width: 190,
    render: (row) => h(NInputNumber, { value: quantities.value[row.id] ?? null, min: 0, max: Number(row[picker.value!.allocation!.availableField] ?? 0), disabled: !selectedIds.value.includes(row.id), 'onUpdate:value': (value: number | null) => quantities.value[row.id] = value ?? 0 }),
  });
  return columns;
});
function updateChecked(keys: Array<string | number>) {
  selectedIds.value = keys.map(Number);
  for (const id of selectedIds.value) if (picker.value?.allocation && quantities.value[id] === undefined) quantities.value[id] = Math.min(1, Number(rows.value.find((row) => row.id === id)?.[picker.value.allocation.availableField] ?? 0));
}
function parameterKey(parameter: NonNullable<ReportMeta['parameters']>[number]) { return `${parameter.field}:${parameter.operator ?? 'eq'}`; }
async function confirm() {
  if (!props.action || !target.value) return;
  if (type.value === 'report') {
    const query = new URLSearchParams();
    for (const parameter of report.value?.parameters ?? []) {
      const value = reportValues.value[parameterKey(parameter)];
      if (parameter.required && (value === undefined || value === null || value === '')) { error.value = `${parameter.label ?? parameter.field} is required`; return; }
      if (value !== undefined && value !== null && value !== '') query.set(`param.${parameter.field}.${parameter.operator ?? 'eq'}`, String(value));
    }
    window.open(`/api/report/${encodeURIComponent(target.value)}/pdf?${query}`, '_blank', 'noopener'); emit('update:show', false); return;
  }
  const selections = selectedIds.value.map((id) => ({ id, ...(picker.value?.allocation ? { quantity: quantities.value[id] ?? 0 } : {}) }));
  if (type.value === 'picker') {
    if (!selections.length) { error.value = 'Select at least one record.'; return; }
    for (const selection of selections) {
      const row = rows.value.find((entry) => entry.id === selection.id)!;
      const available = picker.value?.allocation ? Number(row[picker.value.allocation.availableField] ?? 0) : undefined;
      if (available !== undefined && (!(selection.quantity! > 0) || selection.quantity! > available)) { error.value = `Selected quantity for record ${selection.id} must be between 1 and ${available}.`; return; }
    }
  }
  busy.value = true; error.value = '';
  try {
    await api.post(`/api/action/${encodeURIComponent(target.value)}`, {
      recordId: props.recordId,
      id: props.recordId,
      record: props.record,
      lineId: props.lineId,
      lineRecord: props.lineRecord,
      ...(type.value === 'picker' ? { selections } : {}),
    });
    message.success(`${props.action.label} completed`); emit('completed'); emit('update:show', false);
  } catch (e) { error.value = e instanceof ApiError ? e.message : String(e); }
  finally { busy.value = false; }
}
</script>

<template>
  <n-modal :show="show" preset="card" :title="action?.label ?? 'Action'" style="width:min(960px,96vw)" @update:show="(value) => emit('update:show', value)">
    <n-alert v-if="error" type="error" title="Action could not continue" style="margin-bottom:14px;white-space:pre-line">{{ error }}</n-alert>
    <template v-if="type === 'picker' && picker">
      <n-space style="margin-bottom:12px"><n-input v-model:value="search" clearable placeholder="Search available records" style="width:320px" @keyup.enter="loadPicker" /><n-button :loading="busy" @click="loadPicker">Search</n-button></n-space>
      <n-data-table :columns="pickerColumns" :data="rows" :loading="busy" :row-key="(row: Row) => row.id" :checked-row-keys="selectedIds" :max-height="460" @update:checked-row-keys="updateChecked" />
    </template>
    <template v-else-if="type === 'report' && report">
      <div v-for="parameter in report.parameters ?? []" :key="parameterKey(parameter)" class="parameter-field"><label>{{ parameter.label ?? parameter.field }}<span v-if="parameter.required"> *</span></label><FieldControl :field="meta.field(report.dataSource, parameter.field)!" :model-value="reportValues[parameterKey(parameter)]" create-mode @update:model-value="(value) => reportValues[parameterKey(parameter)] = value" /></div>
      <n-alert v-if="!(report.parameters?.length)" type="info">This report has no parameters and is ready to open.</n-alert>
    </template>
    <n-alert v-else-if="type === 'function'" type="info">Run server function <b>{{ target }}</b> for the current record?</n-alert>
    <template #footer><n-space justify="end"><n-button @click="emit('update:show', false)">Cancel</n-button><n-button type="primary" :loading="busy" @click="confirm">{{ type === 'report' ? 'Open PDF' : type === 'picker' ? 'Confirm selection' : 'Run function' }}</n-button></n-space></template>
  </n-modal>
</template>

<style scoped>.parameter-field{margin-bottom:16px}.parameter-field label{display:block;font-weight:600;margin-bottom:6px}</style>
