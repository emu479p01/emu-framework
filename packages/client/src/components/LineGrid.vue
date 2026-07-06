<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import { NButton, NCard, NDataTable, NSpace, useMessage, type DataTableColumns } from 'naive-ui';
import { api, ApiError, type Row } from '../api';
import { useMeta } from '../stores/meta';
import FieldControl from './FieldControl.vue';

const props = defineProps<{
  line: { table: string; refField: string; fields: string[] };
  headerId: number;
}>();

const meta = useMeta();
const message = useMessage();

const rows = ref<Row[]>([]);
/** row id currently in edit mode; 0 = new unsaved row */
const editingId = ref<number | null>(null);
const draft = ref<Record<string, unknown>>({});
const lookups = ref<Record<string, Record<number, string>>>({});

const table = computed(() => meta.table(props.line.table));
const fields = computed(() =>
  props.line.fields
    .map((n) => table.value?.fields.find((f) => f.name === n))
    .filter((f): f is NonNullable<typeof f> => f !== undefined),
);

async function load() {
  const refTables = new Set(
    fields.value.filter((f) => f.type === 'reference' && f.reference).map((f) => f.reference!.table),
  );
  for (const t of refTables) {
    const display = meta.table(t)?.titleField ?? 'id';
    const { data } = await api.list(t, { limit: 500 });
    lookups.value[t] = Object.fromEntries(data.map((r) => [r.id, String(r[display] ?? r.id)]));
  }
  const res = await api.list(props.line.table, {
    [`filter.${props.line.refField}`]: props.headerId,
    limit: 500,
  });
  rows.value = res.data;
}

watch(() => props.headerId, load, { immediate: true });

function startEdit(row: Row | null) {
  if (row) {
    editingId.value = row.id;
    draft.value = { ...row };
  } else {
    editingId.value = 0;
    draft.value = { [props.line.refField]: props.headerId };
  }
}

async function saveDraft() {
  try {
    if (editingId.value === 0) {
      await api.post(`/api/data/${props.line.table}`, draft.value);
    } else {
      await api.patch(`/api/data/${props.line.table}/${editingId.value}`, draft.value);
    }
    editingId.value = null;
    await load();
  } catch (err) {
    if (err instanceof ApiError) message.error(err.message);
    else throw err;
  }
}

async function removeRow(row: Row) {
  try {
    await api.delete(`/api/data/${props.line.table}/${row.id}`);
    await load();
  } catch (err) {
    if (err instanceof ApiError) message.error(err.message);
    else throw err;
  }
}

const columns = computed<DataTableColumns<Row>>(() => [
  ...fields.value.map((f) => ({
    title: f.label ?? f.name,
    key: f.name,
    render: (row: Row) => {
      if (editingId.value !== null && (row.id === editingId.value || (editingId.value === 0 && row.id === 0))) {
        return h(FieldControl, {
          field: f,
          modelValue: draft.value[f.name],
          'onUpdate:modelValue': (v: unknown) => (draft.value[f.name] = v),
        });
      }
      const v = row[f.name];
      if (f.type === 'enum' && f.enumName) return meta.enumLabel(f.enumName, v);
      if (f.type === 'reference' && f.reference) {
        return lookups.value[f.reference.table]?.[v as number] ?? String(v ?? '');
      }
      return String(v ?? '');
    },
  })),
  {
    title: '',
    key: '_actions',
    width: 160,
    render: (row: Row) => {
      const isEditing =
        editingId.value !== null && (row.id === editingId.value || (editingId.value === 0 && row.id === 0));
      if (isEditing) {
        return h(NSpace, {}, () => [
          h(NButton, { size: 'small', type: 'primary', onClick: saveDraft }, () => 'Save'),
          h(NButton, { size: 'small', onClick: () => (editingId.value = null) }, () => 'Cancel'),
        ]);
      }
      return h(NSpace, {}, () => [
        h(NButton, { size: 'small', onClick: () => startEdit(row) }, () => 'Edit'),
        h(NButton, { size: 'small', quaternary: true, type: 'error', onClick: () => removeRow(row) }, () => 'Del'),
      ]);
    },
  },
]);

const displayRows = computed<Row[]>(() =>
  editingId.value === 0 ? [...rows.value, { id: 0 } as Row] : rows.value,
);
</script>

<template>
  <n-card :title="table?.label ?? line.table" size="small">
    <template #header-extra>
      <n-button size="small" data-testid="add-line" @click="startEdit(null)">Add line</n-button>
    </template>
    <n-data-table :columns="columns" :data="displayRows" :row-key="(r: Row) => r.id" size="small" />
  </n-card>
</template>
