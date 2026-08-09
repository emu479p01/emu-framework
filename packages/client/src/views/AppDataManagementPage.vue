<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { NAlert, NButton, NCard, NDataTable, NDescriptions, NDescriptionsItem, NInput, NModal, NSelect, NSpace, NSpin, NTag, useMessage } from 'naive-ui';
import { api, ApiError, type AppDataOverview, type AppDataPreview } from '../api';

const message = useMessage();
const loading = ref(true); const working = ref(false);
const overview = ref<AppDataOverview>({ apps: [] }); const selected = ref('');
const preview = ref<AppDataPreview|null>(null); const confirmText = ref('');
const dialog = ref<'import'|'delete'|null>(null);
const current = computed(() => overview.value.apps.find((app) => app.name === selected.value) ?? null);
const appOptions = computed(() => overview.value.apps.map((app) => ({ label: app.label, value: app.name })));
const columns = [
  { title: 'Table', key: 'label', render: (row: { label: string; name: string }) => `${row.label} (${row.name})` },
  { title: 'Rows', key: 'rows' },
];
const previewColumns = [
  { title: 'Table', key: 'name' }, { title: 'Current', key: 'currentRows' }, { title: 'Incoming', key: 'incomingRows' },
];

async function load() {
  loading.value = true;
  try {
    overview.value = await api.get<AppDataOverview>('/api/system/app-data');
    if (!overview.value.apps.some((app) => app.name === selected.value)) selected.value = overview.value.apps[0]?.name ?? '';
  } catch (error) { message.error(error instanceof ApiError ? error.message : 'Could not load app data information'); }
  finally { loading.value = false; }
}

function exportData() {
  if (!selected.value) return;
  const link = document.createElement('a'); link.href = `/api/system/app-data/${encodeURIComponent(selected.value)}/export`;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => void load(), 1000);
}

function chooseImport() {
  if (!selected.value) return;
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.emuappdata,application/zip';
  input.onchange = async () => {
    const file = input.files?.[0]; if (!file) return; working.value = true;
    try { preview.value = await api.appDataPreview(selected.value, file); confirmText.value = ''; dialog.value = 'import'; }
    catch (error) { message.error(error instanceof ApiError ? error.message : 'Package validation failed'); }
    finally { working.value = false; }
  };
  input.click();
}

function openDelete() { preview.value = null; confirmText.value = ''; dialog.value = 'delete'; }

async function commit() {
  if (!selected.value || confirmText.value !== selected.value) return;
  working.value = true;
  try {
    if (dialog.value === 'import' && preview.value) {
      await api.post(`/api/system/app-data/${encodeURIComponent(selected.value)}/import/replace`, { previewId: preview.value.previewId, confirmation: confirmText.value });
      message.success('App data replaced successfully');
    } else if (dialog.value === 'delete') {
      await api.delete(`/api/system/app-data/${encodeURIComponent(selected.value)}`, { confirmation: confirmText.value });
      message.success('All app data deleted');
    }
    dialog.value = null; await load();
  } catch (error) { message.error(error instanceof ApiError ? error.message : 'Operation failed'); }
  finally { working.value = false; }
}

onMounted(load);
</script>

<template>
  <div class="page">
    <div class="hero"><div><div class="eyebrow">FRAMEWORK ADMINISTRATION</div><h1>App Data Management</h1><p>Export, replace, or permanently delete the business data owned by one App.</p></div><n-tag type="warning" round>Framework Admin</n-tag></div>
    <n-spin :show="loading || working">
      <n-card>
        <n-space vertical size="large">
          <n-select v-model:value="selected" :options="appOptions" placeholder="Select an App" style="max-width:420px" />
          <template v-if="current">
            <n-descriptions label-placement="left" :column="1" size="small">
              <n-descriptions-item label="App">{{ current.label }} ({{ current.name }})</n-descriptions-item>
              <n-descriptions-item label="Total rows">{{ current.totalRows.toLocaleString() }}</n-descriptions-item>
              <n-descriptions-item label="Last operation">{{ current.lastOperation ? `${current.lastOperation.action} · ${new Date(current.lastOperation.createdAt).toLocaleString()}` : '—' }}</n-descriptions-item>
            </n-descriptions>
            <n-data-table :columns="columns" :data="current.tables" :pagination="false" />
            <n-alert type="warning">Replace and Delete are atomic maintenance operations. They bypass per-record business hooks and never modify App metadata.</n-alert>
            <n-space><n-button type="primary" @click="exportData">Export App Data</n-button><n-button @click="chooseImport">Replace from Package</n-button><n-button type="error" secondary @click="openDelete">Delete All Data</n-button></n-space>
          </template>
          <n-alert v-else type="info">No business Apps are currently loaded.</n-alert>
        </n-space>
      </n-card>
    </n-spin>

    <n-modal :show="dialog !== null" @update:show="(show) => { if (!show) dialog = null }">
      <n-card style="width:min(680px,calc(100vw - 24px))" :title="dialog === 'import' ? `Replace ${current?.label} data?` : `Delete all ${current?.label} data?`" closable @close="dialog = null">
        <n-space vertical size="large">
          <n-alert type="error">This replaces or deletes all data owned by the App in one transaction. Other Apps are never cascaded automatically.</n-alert>
          <n-data-table v-if="preview" :columns="previewColumns" :data="preview.tables" :pagination="false" />
          <p>Type <strong>{{ selected }}</strong> to confirm:</p><n-input v-model:value="confirmText" :placeholder="selected" />
          <n-space justify="end"><n-button @click="dialog = null">Cancel</n-button><n-button type="error" :disabled="confirmText !== selected" :loading="working" @click="commit">{{ dialog === 'import' ? 'Replace Data' : 'Delete All Data' }}</n-button></n-space>
        </n-space>
      </n-card>
    </n-modal>
  </div>
</template>

<style scoped>
.page{max-width:1080px;margin:0 auto}.hero{display:flex;justify-content:space-between;gap:20px;margin-bottom:24px}.eyebrow{color:var(--emu-primary);font-size:11px;font-weight:800;letter-spacing:.12em}.hero h1{font-size:30px;letter-spacing:-.04em;margin:6px 0}.hero p{color:var(--emu-muted);line-height:1.6}@media(max-width:700px){.hero{display:block}.hero .n-tag{margin-top:8px}}
</style>
