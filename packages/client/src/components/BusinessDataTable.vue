<script setup lang="ts">
import { computed, ref, useAttrs, watch } from 'vue';
import { NDataTable, type DataTableColumns } from 'naive-ui';

defineOptions({ inheritAttrs: false });
const props = withDefaults(defineProps<{
  columns: DataTableColumns<any>;
  data: any[];
  rowKey?: (row: any) => string | number;
  maxHeight?: string | number;
  storageKey?: string;
}>(), { maxHeight: 'clamp(280px, 55vh, 640px)' });
const attrs = useAttrs();
const widths = ref<Record<string, number>>({});
const storageName = computed(() => props.storageKey ? `emu:grid-widths:v1:${props.storageKey}` : '');
const clamp = (value: number) => Math.max(80, Math.min(800, Math.round(value)));

function loadWidths() {
  widths.value = {};
  if (!storageName.value || typeof localStorage === 'undefined') return;
  try {
    const parsed = JSON.parse(localStorage.getItem(storageName.value) ?? '{}') as Record<string, unknown>;
    const validKeys = new Set(props.columns.map((column: any) => String(column.key ?? '')).filter((key) => key && key !== '_actions'));
    widths.value = Object.fromEntries(Object.entries(parsed).filter(([key, value]) => validKeys.has(key) && typeof value === 'number').map(([key, value]) => [key, clamp(value as number)]));
    localStorage.setItem(storageName.value, JSON.stringify(widths.value));
  } catch { widths.value = {}; }
}
watch([storageName, () => props.columns.map((column: any) => String(column.key ?? '')).join('|')], loadWidths, { immediate: true });

function resizeColumn(_resizedWidth: number, limitedWidth: number, column: any) {
  const key = String(column.key ?? '');
  if (!key || key === '_actions' || column.type) return;
  widths.value = { ...widths.value, [key]: clamp(limitedWidth) };
  if (storageName.value && typeof localStorage !== 'undefined') localStorage.setItem(storageName.value, JSON.stringify(widths.value));
}

const columns = computed<DataTableColumns<any>>(() => props.columns.map((column: any) => {
  const action = column.key === '_actions';
  const key = String(column.key ?? '');
  return {
    ...column,
    width: widths.value[key] ?? column.width ?? (action ? 150 : 160),
    minWidth: column.minWidth ?? (action ? 120 : 80),
    maxWidth: column.maxWidth ?? (action ? undefined : 800),
    resizable: !action && !column.type && Boolean(key),
    ...(action ? { fixed: 'right' as const } : {}),
  };
}));
const scrollX = computed(() => columns.value.reduce((sum, column: any) => sum + Number(column.width ?? column.minWidth ?? 160), 0));
</script>

<template>
  <n-data-table
    v-bind="attrs"
    class="business-data-table"
    :columns="columns"
    :data="data"
    :row-key="rowKey"
    :scroll-x="scrollX"
    :max-height="maxHeight"
    :on-unstable-column-resize="resizeColumn"
  />
</template>

<style scoped>
.business-data-table{border:1px solid var(--emu-border);border-radius:var(--emu-radius-lg);overflow:hidden;box-shadow:var(--emu-shadow-sm)}
.business-data-table :deep(th .n-data-table-th__title){white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.business-data-table :deep(.n-data-table-base-table-body){overscroll-behavior:contain}
.business-data-table :deep(td){white-space:pre-wrap;overflow-wrap:anywhere}
</style>
