<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { NButton, NDataTable, NSpace, useMessage, type DataTableColumns } from 'naive-ui';
import { api, ApiError, type Row } from '../api';
import { useMeta } from '../stores/meta';

const props = defineProps<{ formName: string; appName?: string }>();
const router = useRouter();
const meta = useMeta();
const message = useMessage();

const rows = ref<Row[]>([]);
const total = ref(0);
const loading = ref(false);
const page = ref(1);
const pageSize = 25;
/** id → display text per referenced table */
const lookups = ref<Record<string, Record<number, string>>>({});

const form = computed(() => meta.form(props.formName));
const table = computed(() => (form.value ? meta.table(form.value.table) : undefined));
const listFields = computed(() => {
  if (!form.value || !table.value) return [];
  const names = form.value.listFields ?? table.value.fields.map((f) => f.name);
  return names
    .map((n) => table.value!.fields.find((f) => f.name === n))
    .filter((f): f is NonNullable<typeof f> => f !== undefined);
});

const columns = computed<DataTableColumns<Row>>(() =>
  listFields.value.map((f) => ({
    title: f.label ?? f.name,
    key: f.name,
    sorter: true,
    render: (row) => {
      const v = row[f.name];
      if (f.type === 'enum' && f.enumName) return meta.enumLabel(f.enumName, v);
      if (f.type === 'reference' && f.reference) {
        return lookups.value[f.reference.table]?.[v as number] ?? String(v ?? '');
      }
      if (f.type === 'boolean') return v ? 'Yes' : 'No';
      return String(v ?? '');
    },
  })),
);

async function loadLookups() {
  const refTables = new Set(
    listFields.value
      .filter((f) => f.type === 'reference' && f.reference)
      .map((f) => f.reference!.table),
  );
  for (const t of refTables) {
    const display = meta.table(t)?.titleField ?? 'id';
    const { data } = await api.list(t, { limit: 500 });
    lookups.value[t] = Object.fromEntries(data.map((r) => [r.id, String(r[display] ?? r.id)]));
  }
}

async function load() {
  if (!table.value) return;
  loading.value = true;
  try {
    await loadLookups();
    const res = await api.list(table.value.name, {
      limit: pageSize,
      offset: (page.value - 1) * pageSize,
      sort: 'id:desc',
    });
    rows.value = res.data;
    total.value = res.total;
  } catch (err) {
    if (err instanceof ApiError) message.error(err.message);
    else throw err;
  } finally {
    loading.value = false;
  }
}

watch([() => props.formName, page], load, { immediate: true });

const formPath = computed(() => props.appName ? `/app/${props.appName}` : '');

const rowProps = (row: Row) => ({
  style: 'cursor: pointer',
  onClick: () => router.push(`${formPath.value}/form/${props.formName}/${row.id}`),
});
</script>

<template>
  <div v-if="form && table">
    <n-space justify="space-between" style="margin-bottom: 16px">
      <h2 style="margin: 0">{{ form.label ?? form.name }}</h2>
      <n-button type="primary" data-testid="new-record" @click="router.push(`${formPath}/form/${formName}/new`)">
        New
      </n-button>
    </n-space>
    <n-data-table
      :columns="columns"
      :data="rows"
      :loading="loading"
      :row-props="rowProps"
      :pagination="{ page, pageSize, itemCount: total, 'onUpdate:page': (p: number) => (page = p) }"
      remote
    />
  </div>
</template>
