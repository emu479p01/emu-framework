<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import { NButton, NCard, NSpace, useDialog, useMessage, type DataTableColumns } from 'naive-ui';
import { api, ApiError, type Row } from '../api';
import { useMeta } from '../stores/meta';
import FieldControl from './FieldControl.vue';
import { applyIfBlank } from '../utils/applyDefaults';
import ActionDialog from './ActionDialog.vue';
import BusinessDataTable from './BusinessDataTable.vue';
import type { FormAction } from '@emu/core';

const props = defineProps<{
  line: { table: string; refField: string; fields: string[]; aggregates?: { fn: 'count' | 'sum' | 'avg'; field?: string; label?: string }[]; actions?: FormAction[] };
  headerId: number;
  headerRecord?: Record<string, unknown>;
}>();

const meta = useMeta();
const message = useMessage();
const dialog = useDialog();

const rows = ref<Row[]>([]);
/** row id currently in edit mode; 0 = new unsaved row */
const editingId = ref<number | null>(null);
const draft = ref<Record<string, unknown>>({});
const lookups = ref<Record<string, Record<number, string>>>({});
const selectedAction = ref<FormAction | null>(null); const selectedLine = ref<Row | null>(null); const actionDialogOpen = ref(false);
function launchAction(action: FormAction, row: Row) { selectedAction.value = action; selectedLine.value = row; actionDialogOpen.value = true; }

const table = computed(() => meta.table(props.line.table));
const fields = computed(() =>
  props.line.fields
    .filter((n) => n !== props.line.refField)
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

function isEditing(row: Row): boolean {
  return editingId.value !== null && (row.id === editingId.value || (editingId.value === 0 && row.id === 0));
}

async function saveDraft() {
  try {
    if (editingId.value === 0) {
      await api.post(`/api/data/${props.line.table}`, writableDraft(true));
    } else {
      await api.patch(`/api/data/${props.line.table}/${editingId.value}`, writableDraft(false));
    }
    editingId.value = null;
    await load();
  } catch (err) {
    if (err instanceof ApiError) message.error(err.message);
    else throw err;
  }
}

function writableDraft(createMode: boolean): Record<string, unknown> {
  const allowed = new Set(fields.value.filter((field) => !field.readOnly && (createMode ? field.allowEditOnCreate !== false : field.allowEdit !== false)).map((field) => field.name));
  if (createMode) allowed.add(props.line.refField);
  return Object.fromEntries(Object.entries(draft.value).filter(([key]) => allowed.has(key)));
}

function confirmSave() {
  const missing = fields.value.filter((field) => field.mandatory && !field.readOnly && (draft.value[field.name] === undefined || draft.value[field.name] === null || draft.value[field.name] === ''));
  if (missing.length) { message.warning(`Complete required fields: ${missing.map((field) => field.label ?? field.name).join(', ')}`); return; }
  const creating = editingId.value === 0;
  dialog.warning({
    title: creating ? 'Confirm add line' : 'Confirm save line',
    content: creating ? 'Add this line record?' : `Save changes to line #${editingId.value}?`,
    positiveText: creating ? 'Add' : 'Save', negativeText: 'Cancel',
    onPositiveClick: saveDraft,
  });
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

function confirmRemove(row: Row) {
  const titleField = table.value?.titleField;
  const identity = titleField && row[titleField] != null ? String(row[titleField]) : `#${row.id}`;
  dialog.warning({ title: 'Confirm delete line', content: `Delete line ${identity}?`, positiveText: 'Delete', negativeText: 'Cancel', onPositiveClick: () => removeRow(row) });
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
          record: draft.value,
          recordTable: props.line.table,
          'onUpdate:modelValue': (v: unknown) => (draft.value[f.name] = v),
          'onUpdate:related': (patch: Record<string, unknown>) => applyIfBlank(draft.value, patch),
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
      if (isEditing(row)) {
        return h(NSpace, {}, () => [
          h(NButton, { size: 'small', type: 'primary', onClick: confirmSave }, () => 'Save'),
          h(NButton, { size: 'small', onClick: () => (editingId.value = null) }, () => 'Cancel'),
        ]);
      }
      return h(NSpace, {}, () => [
        ...(props.line.actions ?? []).map((action) => h(NButton, { size: 'small', onClick: () => launchAction(action, row) }, () => action.label)),
        h(NButton, { size: 'small', onClick: () => startEdit(row) }, () => 'Edit'),
        h(NButton, { size: 'small', quaternary: true, type: 'error', onClick: () => confirmRemove(row) }, () => 'Del'),
      ]);
    },
  },
]);

const displayRows = computed<Row[]>(() =>
  editingId.value === 0 ? [...rows.value, { id: 0 } as Row] : rows.value,
);

const aggregateResults = computed(() =>
  (props.line.aggregates ?? []).map((agg) => {
    const label = agg.label ?? (agg.fn === 'count' ? 'Count' : `${agg.fn} ${agg.field}`);
    if (agg.fn === 'count') return { label, value: rows.value.length };
    const values = rows.value.map((r) => Number(r[agg.field!]) || 0);
    const sum = values.reduce((a, b) => a + b, 0);
    const value = agg.fn === 'sum' ? sum : values.length > 0 ? sum / values.length : 0;
    return { label, value };
  }),
);
</script>

<template>
  <n-card :title="table?.label ?? line.table" size="small" class="line-grid-card">
    <template #header-extra>
      <n-space align="center">
        <span v-for="(agg, i) in aggregateResults" :key="i" style="color: var(--n-text-color-3); font-size: 13px">
          {{ agg.label }}: <b>{{ agg.value }}</b>
        </span>
        <n-button size="small" data-testid="add-line" @click="startEdit(null)">Add line</n-button>
      </n-space>
    </template>
    <BusinessDataTable class="line-table" :columns="columns" :data="displayRows" :row-key="(r: Row) => r.id" size="small" />
    <ActionDialog v-model:show="actionDialogOpen" :action="selectedAction" :record-id="headerId" :record="headerRecord" :line-id="selectedLine?.id" :line-record="selectedLine ?? undefined" @completed="load" />
  </n-card>
</template>

<style scoped>
@media(max-width:700px){.line-grid-card :deep(.n-card-header){align-items:flex-start;gap:10px}.line-grid-card :deep(.n-card-header__extra){margin-left:0}.line-grid-card :deep(.n-card-header__extra .n-space){justify-content:flex-start!important;flex-wrap:wrap!important}.line-table :deep(.n-button){min-height:40px}}
</style>
