<script setup lang="ts">
import { NButton, NCard, NCheckbox, NFormItem, NInput, NSelect, NSpace, NTag } from 'naive-ui';
import { ICON_OPTIONS } from '../../navigation';
import type { IconName, MenuItemMeta } from '@emu/core';

export interface EditableMenuItem extends MenuItemMeta {
  items?: EditableMenuItem[];
  __inherited?: boolean;
  __originLayer?: string;
  __baseline?: MenuItemMeta;
}

type EditableField = 'label' | 'icon' | 'target' | 'visible' | 'order';

const props = defineProps<{
  items: EditableMenuItem[];
  formOptions: { label: string; value: string }[];
  reportOptions: { label: string; value: string }[];
  functionOptions: { label: string; value: string }[];
  depth?: number;
  parent?: EditableMenuItem;
  extensionMode?: boolean;
}>();

const emit = defineEmits<{
  change: [item: EditableMenuItem, field: EditableField, value: unknown];
  reset: [item: EditableMenuItem];
  addItem: [parent: EditableMenuItem | undefined, siblings: EditableMenuItem[]];
  removeItem: [item: EditableMenuItem, siblings: EditableMenuItem[], index: number];
  moveItem: [item: EditableMenuItem, siblings: EditableMenuItem[], index: number, direction: -1 | 1];
}>();

const TARGET_TYPES = [
  { label: 'Group / submenu', value: 'group' }, { label: 'Form', value: 'form' },
  { label: 'Function', value: 'function' }, { label: 'Report', value: 'report' },
];
function newItem(): EditableMenuItem {
  return { id: `menu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, label: '', icon: 'grid', visible: true, target: { type: 'group' } };
}
function addItem() {
  if (props.extensionMode) emit('addItem', props.parent, props.items);
  else props.items.push(newItem());
}
function addSubItem(item: EditableMenuItem) {
  if (props.extensionMode) { emit('addItem', item, item.items ?? []); return; }
  item.items ??= [];
  item.items.push(newItem());
}
function removeItem(item: EditableMenuItem, index: number) {
  if (props.extensionMode) emit('removeItem', item, props.items, index);
  else props.items.splice(index, 1);
}
function moveItem(item: EditableMenuItem, index: number, direction: -1 | 1) {
  if (props.extensionMode) { emit('moveItem', item, props.items, index, direction); return; }
  const target = index + direction;
  if (target < 0 || target >= props.items.length) return;
  props.items.splice(target, 0, props.items.splice(index, 1)[0]);
}
function updateField(item: EditableMenuItem, field: EditableField, value: unknown) {
  if (props.extensionMode && item.__inherited) emit('change', item, field, value);
  else (item as any)[field] = value;
}
function itemType(item: EditableMenuItem): 'group' | 'form' | 'function' | 'report' {
  return item.target?.type ?? (item.form ? 'form' : item.action ? 'function' : 'group');
}
function itemTarget(item: EditableMenuItem): string {
  return item.target && 'name' in item.target ? item.target.name : item.form ?? item.action ?? '';
}
function setType(item: EditableMenuItem, type: 'group' | 'form' | 'function' | 'report') {
  if (!item.__inherited) { delete item.form; delete item.action; delete item.route; }
  updateField(item, 'target', type === 'group' ? { type } : { type, name: '' });
}
function setTarget(item: EditableMenuItem, name: string) {
  const type = itemType(item);
  if (type !== 'group') updateField(item, 'target', { type, name });
}
function itemVisible(item: EditableMenuItem): boolean { return item.visible ?? item.hidden !== true; }
</script>

<template>
  <div class="menu-level" :class="{ nested: (depth ?? 0) > 0 }" :style="{ '--menu-depth': String(depth ?? 0) }">
    <n-space vertical :size="8">
      <n-card v-for="(item, i) in items" :key="item.id ?? i" size="small" class="menu-item-card" :class="{ inherited: item.__inherited }">
        <div class="menu-item-heading">
          <n-tag v-if="extensionMode" size="small" :type="item.__inherited ? 'info' : 'success'">
            {{ item.__inherited ? `${item.__originLayer ?? 'Inherited'} · inherited` : `${item.__originLayer ?? 'Current'} · current` }}
          </n-tag>
        </div>
        <div class="menu-item-grid">
          <n-form-item label="Label" required><n-input :value="item.label" placeholder="Menu label" @update:value="(v) => updateField(item, 'label', v)" /></n-form-item>
          <n-form-item label="Icon"><n-select :value="item.icon" :options="ICON_OPTIONS" clearable placeholder="Icon" @update:value="(v) => updateField(item, 'icon', v)" /></n-form-item>
          <n-form-item label="Target type" required><n-select :value="itemType(item)" :options="TARGET_TYPES" @update:value="(v) => setType(item, v)" /></n-form-item>
          <n-form-item v-if="itemType(item) === 'form'" label="Form" required><n-select :value="itemTarget(item)" :options="formOptions" filterable @update:value="(v) => setTarget(item, v)" /></n-form-item>
          <n-form-item v-else-if="itemType(item) === 'function'" label="Function name" required><n-select :value="itemTarget(item)" :options="functionOptions" filterable tag placeholder="Registered server action" @update:value="(v) => setTarget(item, v)" /></n-form-item>
          <n-form-item v-else-if="itemType(item) === 'report'" label="Report" required><n-select :value="itemTarget(item)" :options="reportOptions" filterable @update:value="(v) => setTarget(item, v)" /></n-form-item>
          <n-form-item label="Menu visibility"><n-checkbox :checked="itemVisible(item)" @update:checked="(v) => updateField(item, 'visible', v)">Show in Menu</n-checkbox></n-form-item>
        </div>
        <div class="menu-item-actions">
          <n-button size="tiny" @click="addSubItem(item)">+ Sub-item</n-button>
          <n-button size="tiny" :disabled="i === 0" @click="moveItem(item, i, -1)">↑ Up</n-button>
          <n-button size="tiny" :disabled="i === items.length - 1" @click="moveItem(item, i, 1)">↓ Down</n-button>
          <n-button v-if="item.__inherited" size="tiny" quaternary @click="$emit('reset', item)">Reset override</n-button>
          <n-button v-else size="tiny" quaternary type="error" @click="removeItem(item, i)">Remove</n-button>
        </div>
        <MenuItemsEditor
          v-if="item.items && item.items.length > 0"
          :items="item.items"
          :form-options="formOptions"
          :report-options="reportOptions"
          :function-options="functionOptions"
          :depth="(depth ?? 0) + 1"
          :parent="item"
          :extension-mode="extensionMode"
          @change="(...args) => $emit('change', ...args)"
          @reset="(value) => $emit('reset', value)"
          @add-item="(...args) => $emit('addItem', ...args)"
          @remove-item="(...args) => $emit('removeItem', ...args)"
          @move-item="(...args) => $emit('moveItem', ...args)"
        />
      </n-card>
    </n-space>
    <n-button size="small" class="add-item-button" @click="addItem">{{ depth ? '+ Add item at this level' : '+ Add item' }}</n-button>
  </div>
</template>

<style scoped>
.menu-level{min-width:0;margin-top:4px;margin-left:min(calc(var(--menu-depth) * 12px),48px)}
.menu-level.nested{border-left:2px solid #dbeafe;padding-left:8px}
.menu-item-card{min-width:0;max-width:100%;overflow:hidden;border:1px solid var(--emu-border)}
.menu-item-card.inherited{border-color:#bfdbfe;background:#f8fbff}
.menu-item-heading{display:flex;min-height:22px;margin-bottom:6px}
.menu-item-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:8px 12px;min-width:0}
.menu-item-grid :deep(.n-form-item),.menu-item-grid :deep(.n-form-item-blank),.menu-item-grid :deep(.n-input),.menu-item-grid :deep(.n-base-selection){min-width:0;width:100%;max-width:100%}
.menu-item-actions{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.add-item-button{margin-top:8px}
@media(max-width:560px){.menu-level{margin-left:min(calc(var(--menu-depth) * 6px),18px);padding-left:4px}.menu-item-grid{grid-template-columns:minmax(0,1fr)}}
</style>
