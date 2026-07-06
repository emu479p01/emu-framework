<script setup lang="ts">
import { NButton, NInput, NSelect, NSpace } from 'naive-ui';

export interface EditableMenuItem {
  label?: string;
  form?: string;
  route?: string;
  items?: EditableMenuItem[];
}

const props = defineProps<{
  items: EditableMenuItem[];
  formOptions: { label: string; value: string }[];
  depth?: number;
}>();

function addItem() {
  props.items.push({ label: '', form: '' });
}

function addSubItem(item: EditableMenuItem) {
  if (!item.items) item.items = [];
  item.items.push({ label: '', form: '' });
}

function removeItem(i: number) {
  props.items.splice(i, 1);
}
</script>

<template>
  <div :style="depth ? { marginLeft: '24px', marginTop: '4px' } : {}">
    <n-space vertical :size="8">
      <div v-for="(item, i) in items" :key="i">
        <n-space align="center">
          <n-input v-model:value="item.label" size="small" placeholder="Label" style="width: 200px" />
          <n-select
            v-model:value="item.form"
            :options="formOptions"
            size="small"
            style="min-width: 220px"
            filterable
            clearable
            placeholder="Form (leave blank for a group)"
          />
          <n-button size="tiny" @click="addSubItem(item)">+ Sub-item</n-button>
          <n-button size="tiny" quaternary type="error" @click="removeItem(i)">✕</n-button>
        </n-space>
        <MenuItemsEditor
          v-if="item.items && item.items.length > 0"
          :items="item.items"
          :form-options="formOptions"
          :depth="(depth ?? 0) + 1"
        />
      </div>
    </n-space>
    <n-button size="small" style="margin-top: 8px" @click="addItem">
      {{ depth ? '+ Add item at this level' : '+ Add item' }}
    </n-button>
  </div>
</template>
