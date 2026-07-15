<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import { NButton, NCard, NDataTable, NSpace, useMessage, type DataTableColumns } from 'naive-ui';
import { api, ApiError, type Row } from '../api';
import { useMeta } from '../stores/meta';
import FieldControl from './FieldControl.vue';
import { applyIfBlank } from '../utils/applyDefaults';
import ActionDialog from './ActionDialog.vue';
import type { FormAction } from '@emu/core';

const props = defineProps<{
  line: { table: string; refField: string; fields: string[]; aggregates?: { fn: 'count' | 'sum' | 'avg'; field?: string; label?: string }[]; actions?: FormAction[] };
  headerId: number;
  headerRecord?: Record<string, unknown>;
}>();

const meta = useMeta();
const message = useMessage();

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

function displayValue(row: Row, fieldName: string): string {
  const field = fields.value.find((entry) => entry.name === fieldName);
  const value = row[fieldName];
  if (field?.type === 'enum' && field.enumName) return meta.enumLabel(field.enumName, value);
  if (field?.type === 'reference' && field.reference) return lookups.value[field.reference.table]?.[value as number] ?? String(value ?? '');
  return String(value ?? '—');
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
          h(NButton, { size: 'small', type: 'primary', onClick: saveDraft }, () => 'Save'),
          h(NButton, { size: 'small', onClick: () => (editingId.value = null) }, () => 'Cancel'),
        ]);
      }
      return h(NSpace, {}, () => [
        ...(props.line.actions ?? []).map((action) => h(NButton, { size: 'small', onClick: () => launchAction(action, row) }, () => action.label)),
        h(NButton, { size: 'small', onClick: () => startEdit(row) }, () => 'Edit'),
        h(NButton, { size: 'small', quaternary: true, type: 'error', onClick: () => removeRow(row) }, () => 'Del'),
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
    <n-data-table class="line-desktop-table" :columns="columns" :data="displayRows" :row-key="(r: Row) => r.id" size="small" />
    <div class="line-mobile-list">
      <div v-for="row in displayRows" :key="row.id" class="line-mobile-card">
        <div v-for="field in fields" :key="field.name" class="line-mobile-field">
          <span class="line-mobile-label">{{ field.label ?? field.name }}</span>
          <FieldControl
            v-if="isEditing(row)"
            :field="field"
            :model-value="draft[field.name]"
            :record="draft"
            :record-table="line.table"
            @update:model-value="(value) => draft[field.name] = value"
            @update:related="(patch) => applyIfBlank(draft, patch)"
          />
          <span v-else class="line-mobile-value">{{ displayValue(row, field.name) }}</span>
        </div>
        <div class="line-mobile-actions">
          <template v-if="isEditing(row)">
            <n-button type="primary" @click="saveDraft">Save</n-button>
            <n-button @click="editingId = null">Cancel</n-button>
          </template>
          <template v-else>
            <n-button v-for="action in line.actions ?? []" :key="action.target ?? action.action" @click="launchAction(action, row)">{{ action.label }}</n-button>
            <n-button @click="startEdit(row)">Edit</n-button>
            <n-button quaternary type="error" @click="removeRow(row)">Delete</n-button>
          </template>
        </div>
      </div>
      <div v-if="displayRows.length === 0" class="line-mobile-empty">No data</div>
    </div>
    <ActionDialog v-model:show="actionDialogOpen" :action="selectedAction" :record-id="headerId" :record="headerRecord" :line-id="selectedLine?.id" :line-record="selectedLine ?? undefined" @completed="load" />
  </n-card>
</template>

<style scoped>
.line-mobile-list{display:none}.line-mobile-card{border:1px solid var(--emu-border);border-radius:12px;padding:14px;background:#fff}.line-mobile-card+.line-mobile-card{margin-top:10px}.line-mobile-field+.line-mobile-field{margin-top:12px}.line-mobile-label{display:block;color:var(--emu-muted);font-size:11px;font-weight:700;margin-bottom:5px}.line-mobile-value{display:block;overflow-wrap:anywhere;line-height:1.45}.line-mobile-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px;padding-top:12px;border-top:1px solid var(--emu-border)}.line-mobile-empty{padding:30px 10px;text-align:center;color:var(--emu-muted)}
@media(max-width:700px){.line-desktop-table{display:none}.line-mobile-list{display:block}.line-grid-card :deep(.n-card-header){align-items:flex-start;gap:10px}.line-grid-card :deep(.n-card-header__extra){margin-left:0}.line-grid-card :deep(.n-card-header__extra .n-space){justify-content:flex-start!important;flex-wrap:wrap!important}.line-mobile-actions :deep(.n-button){min-height:44px}}
</style>
