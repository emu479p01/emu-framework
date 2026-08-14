<script setup lang="ts">
import { computed, useAttrs } from 'vue';
import { NDataTable, type DataTableColumns } from 'naive-ui';

defineOptions({ inheritAttrs: false });
const props = withDefaults(defineProps<{
  columns: DataTableColumns<any>;
  data: any[];
  rowKey?: (row: any) => string | number;
  maxHeight?: string | number;
}>(), { maxHeight: 'clamp(280px, 55vh, 640px)' });
const attrs = useAttrs();

const columns = computed<DataTableColumns<any>>(() => props.columns.map((column: any) => {
  const action = column.key === '_actions';
  return {
    ...column,
    width: column.width ?? (action ? 150 : 160),
    minWidth: column.minWidth ?? (action ? 120 : 120),
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
  />
</template>

<style scoped>
.business-data-table{border:1px solid var(--emu-border);border-radius:var(--emu-radius-lg);overflow:hidden;box-shadow:var(--emu-shadow-sm)}
.business-data-table :deep(th .n-data-table-th__title){white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.business-data-table :deep(.n-data-table-base-table-body){overscroll-behavior:contain}
</style>
