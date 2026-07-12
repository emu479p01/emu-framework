<script setup lang="ts">
import { NButton, NCard, NFormItem, NInput, NSelect, NSpace } from 'naive-ui';
import { ICON_OPTIONS } from '../../navigation';
import type { IconName } from '@emu/core';

export interface EditableMenuItem {
  label?: string;
  icon?: IconName;
  form?: string;
  route?: string;
  action?: string;
  target?: { type: 'group' } | { type: 'form' | 'function' | 'report'; name: string };
  items?: EditableMenuItem[];
}

const props = defineProps<{
  items: EditableMenuItem[];
  formOptions: { label: string; value: string }[];
  reportOptions: { label: string; value: string }[];
  functionOptions: { label: string; value: string }[];
  depth?: number;
}>();

function addItem() {
  props.items.push({ label: '', icon: 'grid', target: { type: 'group' } });
}

function addSubItem(item: EditableMenuItem) {
  if (!item.items) item.items = [];
  item.items.push({ label: '', icon: 'grid', target: { type: 'group' } });
}
const TARGET_TYPES = [
  { label: 'Group / submenu', value: 'group' }, { label: 'Form', value: 'form' },
  { label: 'Function', value: 'function' }, { label: 'Report', value: 'report' },
];
function itemType(item: EditableMenuItem): 'group' | 'form' | 'function' | 'report' {
  return item.target?.type ?? (item.form ? 'form' : item.action ? 'function' : 'group');
}
function itemTarget(item: EditableMenuItem): string {
  return item.target && 'name' in item.target ? item.target.name : item.form ?? item.action ?? '';
}
function setType(item: EditableMenuItem, type: 'group' | 'form' | 'function' | 'report') {
  delete item.form; delete item.action; delete item.route;
  item.target = type === 'group' ? { type } : { type, name: '' };
}
function setTarget(item: EditableMenuItem, name: string) {
  const type = itemType(item); if (type !== 'group') item.target = { type, name };
}

function removeItem(i: number) {
  props.items.splice(i, 1);
}
</script>

<template>
  <div :style="depth ? { marginLeft: '24px', marginTop: '4px' } : {}">
    <n-space vertical :size="8">
      <n-card v-for="(item, i) in items" :key="i" size="small" class="menu-item-card">
        <div class="menu-item-grid">
          <n-form-item label="Label" required><n-input v-model:value="item.label" placeholder="Menu label" /></n-form-item>
          <n-form-item label="Icon"><n-select v-model:value="item.icon" :options="ICON_OPTIONS" clearable placeholder="Icon" /></n-form-item>
          <n-form-item label="Target type" required><n-select :value="itemType(item)" :options="TARGET_TYPES" @update:value="(v) => setType(item, v)" /></n-form-item>
          <n-form-item v-if="itemType(item) === 'form'" label="Form" required><n-select :value="itemTarget(item)" :options="formOptions" filterable @update:value="(v) => setTarget(item, v)" /></n-form-item>
          <n-form-item v-else-if="itemType(item) === 'function'" label="Function name" required><n-select :value="itemTarget(item)" :options="functionOptions" filterable tag placeholder="Registered server action" @update:value="(v) => setTarget(item, v)" /></n-form-item>
          <n-form-item v-else-if="itemType(item) === 'report'" label="Report" required><n-select :value="itemTarget(item)" :options="reportOptions" filterable @update:value="(v) => setTarget(item, v)" /></n-form-item>
        </div>
        <n-space><n-button size="tiny" @click="addSubItem(item)">+ Sub-item</n-button><n-button size="tiny" quaternary type="error" @click="removeItem(i)">Remove</n-button></n-space>
        <MenuItemsEditor
          v-if="item.items && item.items.length > 0"
          :items="item.items"
          :form-options="formOptions"
          :report-options="reportOptions"
          :function-options="functionOptions"
          :depth="(depth ?? 0) + 1"
        />
      </n-card>
    </n-space>
    <n-button size="small" style="margin-top: 8px" @click="addItem">
      {{ depth ? '+ Add item at this level' : '+ Add item' }}
    </n-button>
  </div>
</template>

<style scoped>.menu-item-card{border:1px solid var(--emu-border)}.menu-item-grid{display:grid;grid-template-columns:1fr 150px 180px minmax(220px,1fr);gap:12px}@media(max-width:900px){.menu-item-grid{grid-template-columns:1fr 1fr}}@media(max-width:560px){.menu-item-grid{grid-template-columns:1fr}}</style>
