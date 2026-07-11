<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { NAlert, NButton, NCard, NDescriptions, NDescriptionsItem, NSpace, NSpin, NTag, useMessage } from 'naive-ui';
import { api, ApiError } from '../api';

const message = useMessage();
const loading = ref(true);
const validating = ref(false);
const info = ref<{ version: string; backupSchemaVersion: number; updateChannel: string } | null>(null);
const validated = ref<{ frameworkVersion: string; createdAt: string; files: { name: string; bytes: number }[] } | null>(null);

onMounted(async () => {
  try { info.value = await api.get('/api/system/info'); }
  catch (error) { message.error(error instanceof ApiError ? error.message : 'Could not load system information'); }
  finally { loading.value = false; }
});

function downloadBackup() {
  const link = document.createElement('a');
  link.href = '/api/system/backup/export';
  document.body.appendChild(link); link.click(); link.remove();
}

function chooseBackup() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.emubackup,application/zip';
  input.onchange = async () => {
    const file = input.files?.[0]; if (!file) return;
    validating.value = true; validated.value = null;
    try {
      const result = await api.validateSystemBackup(file);
      validated.value = result.manifest;
      message.success('Backup package is valid');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Backup validation failed');
    } finally { validating.value = false; }
  };
  input.click();
}

function mb(bytes: number) { return `${(bytes / 1024 / 1024).toFixed(2)} MB`; }
</script>

<template>
  <div class="maintenance-page">
    <div class="page-hero">
      <div><div class="eyebrow">FRAMEWORK ADMINISTRATION</div><h1>System Maintenance</h1><p>Manage versions and create verified recovery points for the complete system.</p></div>
      <n-tag v-if="info" type="success" round>v{{ info.version }} · {{ info.updateChannel }}</n-tag>
    </div>
    <n-spin :show="loading">
      <div class="maintenance-grid">
        <n-card title="Database backup" class="maintenance-card">
          <p>Export consistent snapshots of both business data and Designer metadata in one checksummed package.</p>
          <n-space><n-button type="primary" @click="downloadBackup">Export Full Backup</n-button><n-button secondary :loading="validating" @click="chooseBackup">Validate Restore File</n-button></n-space>
          <n-alert v-if="validated" type="success" style="margin-top:18px" title="Ready to restore">
            Backup from v{{ validated.frameworkVersion }}, {{ new Date(validated.createdAt).toLocaleString() }}.
            <div>{{ validated.files.map((file) => `${file.name} (${mb(file.bytes)})`).join(' · ') }}</div>
            <div class="command">Stop the app, then run: <code>RestoreDatabase.cmd "path\to\backup.emubackup"</code></div>
          </n-alert>
        </n-card>
        <n-card title="Framework update" class="maintenance-card">
          <p>The stable updater verifies release checksums, preserves apps and databases, then runs typecheck and build.</p>
          <n-descriptions label-placement="left" :column="1" size="small">
            <n-descriptions-item label="Current version">{{ info?.version ?? '—' }}</n-descriptions-item>
            <n-descriptions-item label="Update channel">Stable GitHub Releases</n-descriptions-item>
            <n-descriptions-item label="Command"><code>Update.cmd</code></n-descriptions-item>
          </n-descriptions>
          <n-alert type="info" style="margin-top:18px">Create a database backup before updating. The updater also creates its own safety backup automatically.</n-alert>
        </n-card>
      </div>
    </n-spin>
  </div>
</template>

<style scoped>
.maintenance-page{max-width:1080px;margin:0 auto}.page-hero{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:24px}.eyebrow{color:var(--emu-primary);font-size:11px;font-weight:800;letter-spacing:.12em}.page-hero h1{font-size:30px;letter-spacing:-.04em;margin:6px 0}.page-hero p,.maintenance-card p{color:var(--emu-muted);line-height:1.6}.maintenance-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.maintenance-card{border-radius:var(--emu-radius-lg);box-shadow:var(--emu-shadow-sm)}.command{margin-top:10px}code{background:#eef2ff;color:#3730a3;border-radius:6px;padding:3px 7px;font-size:12px}@media(max-width:800px){.maintenance-grid{grid-template-columns:1fr}.page-hero{display:block}.page-hero>.n-tag{margin-top:12px}}
</style>
