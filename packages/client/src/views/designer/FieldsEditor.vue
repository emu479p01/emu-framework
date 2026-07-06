<script setup lang="ts">
import { NButton, NCheckbox, NInput, NSelect, NTable } from 'naive-ui';
import { computed } from 'vue';
import { useMeta } from '../../stores/meta';

export interface EditableField {
  name: string;
  type: string;
  label?: string;
  mandatory?: boolean;
  enumName?: string;
  reference?: { table: string };
}

const props = defineProps<{ fields: EditableField[] }>();
const meta = useMeta();

const TYPE_OPTIONS = ['string', 'int', 'real', 'boolean', 'date', 'datetime', 'enum', 'reference'].map(
  (t) => ({ label: t, value: t }),
);

const enumOptions = computed(() =>
  (meta.meta?.enums ?? []).map((e) => ({ label: e.name, value: e.name })),
);
const tableOptions = computed(() =>
  (meta.meta?.tables ?? []).map((t) => ({ label: t.name, value: t.name })),
);

function addField() {
  props.fields.push({ name: '', type: 'string' });
}

function removeField(i: number) {
  props.fields.splice(i, 1);
}

function onTypeChange(field: EditableField) {
  if (field.type !== 'enum') delete field.enumName;
  if (field.type !== 'reference') delete field.reference;
  if (field.type === 'reference' && !field.reference) field.reference = { table: '' };
}
</script>

<template>
  <n-table size="small" :bordered="false">
    <thead>
      <tr>
        <th style="width: 22%">Field name</th>
        <th style="width: 16%">Type</th>
        <th style="width: 22%">Label</th>
        <th style="width: 10%">Mandatory</th>
        <th style="width: 22%">Enum / Reference</th>
        <th style="width: 8%"></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="(field, i) in fields" :key="i">
        <td><n-input v-model:value="field.name" placeholder="fieldName" size="small" /></td>
        <td>
          <n-select
            v-model:value="field.type"
            :options="TYPE_OPTIONS"
            size="small"
            @update:value="onTypeChange(field)"
          />
        </td>
        <td><n-input v-model:value="field.label" placeholder="(optional)" size="small" /></td>
        <td style="text-align: center">
          <n-checkbox
            :checked="field.mandatory === true"
            @update:checked="(v: boolean) => (field.mandatory = v || undefined)"
          />
        </td>
        <td>
          <n-select
            v-if="field.type === 'enum'"
            v-model:value="field.enumName"
            :options="enumOptions"
            placeholder="enum"
            size="small"
          />
          <n-select
            v-else-if="field.type === 'reference' && field.reference"
            v-model:value="field.reference.table"
            :options="tableOptions"
            placeholder="table"
            size="small"
            filterable
          />
        </td>
        <td><n-button size="tiny" quaternary type="error" @click="removeField(i)">✕</n-button></td>
      </tr>
    </tbody>
  </n-table>
  <n-button size="small" style="margin-top: 8px" data-testid="add-field" @click="addField">
    + Add field
  </n-button>
</template>
