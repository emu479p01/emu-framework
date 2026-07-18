<script setup lang="ts">
import { NButton, NCard, NCheckbox, NFormItem, NInput, NSelect, NSpace } from 'naive-ui';
import type { FormAction, PickerFilterMeta } from '@emu/core';
import { useDesigner } from '../../stores/designer';

const props = defineProps<{ actions: FormAction[]; recordTable: string; lineTable?: string }>();
const designer = useDesigner();
const TYPES = [{ label: 'Function', value: 'function' }, { label: 'Report', value: 'report' }, { label: 'Record picker', value: 'picker' }];
const OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains'].map((value) => ({ label: value, value }));
const VALUE_SOURCES = [{ label: 'Constant value', value: 'constant' }, { label: 'Current record field', value: 'record' }, { label: 'Current line field', value: 'line' }];
const tableOptions = () => designer.catalog.tables.map((table) => ({ label: String(table.label ?? table.name), value: table.name }));
const fieldOptions = (table: string | undefined) => {
  const item = table ? designer.catalog.tables.find((candidate) => candidate.name === table) : undefined;
  return ((item?.fields ?? []) as { name: string; label?: string }[]).map((field) => ({ label: field.label ?? field.name, value: field.name }));
};
const functionOptions = () => designer.catalog.functions.map((item) => ({ label: String(item.label ?? item.name), value: item.name }));
const reportOptions = () => designer.catalog.reports.map((report) => ({ label: String(report.label ?? report.name), value: report.name }));
function actionType(action: FormAction) { return action.type ?? 'function'; }
function add() { props.actions.push({ label: '', type: 'function', target: '' }); }
function changeType(action: FormAction, type: 'function' | 'report' | 'picker') {
  action.type = type; action.target = ''; delete action.action;
  if (type === 'picker') action.picker = { table: '', columns: [], multiple: true };
  else delete action.picker;
}
function addFilter(action: FormAction) { action.picker!.filters = action.picker!.filters ?? []; action.picker!.filters.push({ field: '', operator: 'eq', value: '' }); }
function valueSource(filter: PickerFilterMeta) { return typeof filter.value === 'object' && filter.value !== null && 'source' in filter.value ? filter.value.source : 'constant'; }
function setValueSource(filter: PickerFilterMeta, source: 'constant' | 'record' | 'line') { filter.value = source === 'constant' ? '' : { source, field: '' }; }
function enableAllocation(action: FormAction, enabled: boolean) { action.picker!.allocation = enabled ? { availableField: '' } : undefined; }
</script>

<template>
  <n-space vertical :size="12">
    <n-card v-for="(action, index) in actions" :key="index" size="small" class="action-card">
      <template #header>Action {{ index + 1 }}</template><template #header-extra><n-button size="tiny" quaternary type="error" @click="actions.splice(index, 1)">Remove</n-button></template>
      <div class="action-grid">
        <n-form-item label="Button label" required><n-input v-model:value="action.label" placeholder="Set item" /></n-form-item>
        <n-form-item label="Action type" required><n-select :value="actionType(action)" :options="TYPES" @update:value="(v) => changeType(action, v)" /></n-form-item>
        <n-form-item v-if="actionType(action) === 'function'" label="Function" required><n-select v-model:value="action.target" :options="functionOptions()" filterable tag placeholder="Registered server action" /></n-form-item>
        <n-form-item v-else-if="actionType(action) === 'report'" label="Report" required><n-select v-model:value="action.target" :options="reportOptions()" filterable /></n-form-item>
        <n-form-item v-else label="Function after selection" required><n-select v-model:value="action.target" :options="functionOptions()" filterable tag placeholder="Allocation function" /></n-form-item>
      </div>
      <n-checkbox :checked="action.showOnCreate === true" @update:checked="(v) => action.showOnCreate = v || undefined">Show on new records</n-checkbox>
      <n-card v-if="actionType(action) === 'picker' && action.picker" size="small" title="Record picker settings" class="picker-settings">
        <div class="action-grid">
          <n-form-item label="Source table" required><n-select v-model:value="action.picker.table" :options="tableOptions()" filterable /></n-form-item>
          <n-form-item label="Display columns" required><n-select v-model:value="action.picker.columns" :options="fieldOptions(action.picker.table)" multiple filterable /></n-form-item>
          <n-form-item label="Search fields"><n-select v-model:value="action.picker.searchFields" :options="fieldOptions(action.picker.table)" multiple filterable /></n-form-item>
        </div>
        <n-checkbox :checked="action.picker.multiple !== false" @update:checked="(v) => action.picker!.multiple = v">Allow multiple selection</n-checkbox>
        <n-checkbox :checked="Boolean(action.picker.allocation)" style="margin-left:18px" @update:checked="(v) => enableAllocation(action, v)">Enable allocation quantity</n-checkbox>
        <div v-if="action.picker.allocation" class="action-grid allocation-row">
          <n-form-item label="Available quantity field" required><n-select v-model:value="action.picker.allocation.availableField" :options="fieldOptions(action.picker.table)" filterable /></n-form-item>
          <n-form-item label="Quantity label"><n-input v-model:value="action.picker.allocation.quantityLabel" placeholder="Selected quantity" /></n-form-item>
        </div>
        <h4>Filters</h4>
        <div v-for="(filter, fi) in action.picker.filters ?? []" :key="fi" class="filter-row">
          <n-select v-model:value="filter.field" :options="fieldOptions(action.picker.table)" placeholder="Source field" filterable />
          <n-select v-model:value="filter.operator" :options="OPS" />
          <n-select :value="valueSource(filter)" :options="VALUE_SOURCES.map((o) => ({ ...o, disabled: o.value === 'line' && !lineTable }))" @update:value="(v) => setValueSource(filter, v)" />
          <n-input v-if="valueSource(filter) === 'constant'" :value="String(filter.value ?? '')" placeholder="Value" @update:value="(v) => filter.value = v" />
          <n-select v-else-if="valueSource(filter) === 'record'" :value="typeof filter.value === 'object' && filter.value ? filter.value.field : ''" :options="fieldOptions(recordTable)" filterable @update:value="(v) => filter.value = { source: 'record', field: v }" />
          <n-select v-else :value="typeof filter.value === 'object' && filter.value ? filter.value.field : ''" :options="fieldOptions(lineTable)" filterable @update:value="(v) => filter.value = { source: 'line', field: v }" />
          <n-button quaternary type="error" @click="action.picker!.filters!.splice(fi, 1)">Remove</n-button>
        </div>
        <n-button size="small" @click="addFilter(action)">+ Filter</n-button>
      </n-card>
    </n-card>
  </n-space>
  <n-button size="small" style="margin-top:10px" @click="add">+ Add action</n-button>
</template>

<style scoped>.action-card{border:1px solid var(--emu-border)}.action-grid{display:grid;grid-template-columns:1fr 180px minmax(240px,1fr);gap:14px}.picker-settings{margin-top:8px;background:#fbfdff}.allocation-row{margin-top:14px;grid-template-columns:1fr 1fr}.picker-settings h4{margin:16px 0 8px}.filter-row{display:grid;grid-template-columns:1fr 110px 170px 1fr auto;gap:8px;margin-bottom:8px}@media(max-width:900px){.action-grid,.filter-row{grid-template-columns:1fr 1fr}}@media(max-width:560px){.action-grid,.filter-row{grid-template-columns:1fr}}</style>
