<script setup lang="ts">
import { NButton, NCheckbox, NInput, NSelect, NTable } from 'naive-ui';
import { computed } from 'vue';

export interface EditableIndex {
  name: string;
  fields: string[];
  unique?: boolean;
}

const props = defineProps<{ indexes: EditableIndex[]; fields: { name: string }[] }>();

const fieldOptions = computed(() => props.fields.map((f) => ({ label: f.name, value: f.name })));

function addIndex() {
  props.indexes.push({ name: '', fields: [], unique: false });
}

function removeIndex(i: number) {
  props.indexes.splice(i, 1);
}
</script>

<template>
  <n-table size="small" :bordered="false">
    <thead>
      <tr>
        <th style="width: 24%">Index name</th>
        <th style="width: 44%">Fields</th>
        <th style="width: 14%">Unique</th>
        <th style="width: 8%"></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="(idx, i) in indexes" :key="i">
        <td><n-input v-model:value="idx.name" placeholder="idxName" size="small" /></td>
        <td><n-select v-model:value="idx.fields" :options="fieldOptions" multiple size="small" /></td>
        <td style="text-align: center">
          <n-checkbox
            :checked="idx.unique === true"
            @update:checked="(v: boolean) => (idx.unique = v || undefined)"
          />
        </td>
        <td><n-button size="tiny" quaternary type="error" @click="removeIndex(i)">✕</n-button></td>
      </tr>
    </tbody>
  </n-table>
  <n-button size="small" style="margin-top: 8px" data-testid="add-index" @click="addIndex">
    + Add index
  </n-button>
</template>
