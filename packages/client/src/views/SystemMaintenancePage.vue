<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { NAlert, NButton, NCard, NDescriptions, NDescriptionsItem, NInput, NModal, NSelect, NSpace, NSpin, NTag, useMessage } from 'naive-ui';
import { api, ApiError, type BackupPreview } from '../api';
import { useRouter } from 'vue-router';

type UpdateJob = { id: string; status: 'pending'|'running'|'restarting'|'succeeded'|'failed'; currentVersion: string; targetVersion: string; requestedBy: string; requestedAt: string; updatedAt: string; backupPath: string; deployment: string; error?: string };
type Release = { currentVersion: string; latestVersion: string; updateAvailable: boolean; name: string; notes: string; url: string; publishedAt: string|null; checkedAt: string };
type Info = { version: string; backupSchemaVersion: number; updateChannel: string; deployment: string; updateEnabled: boolean; job: UpdateJob|null };

const message = useMessage();
const router = useRouter();
const loading = ref(true);
const checking = ref(false);
const starting = ref(false);
const validating = ref(false);
const confirmUpdate = ref(false);
const reconnecting = ref(false);
const info = ref<Info|null>(null);
const release = ref<Release|null>(null);
const job = ref<UpdateJob|null>(null);
const validated = ref<{ frameworkVersion: string; createdAt: string; files: { name: string; bytes: number }[] }|null>(null);
const backupComponent = ref<'full'|'data'|'designer'|'fonts'>('full');
const backupOptions = [
  { label: 'Full — Data + Designer + Fonts', value: 'full' }, { label: 'Data database', value: 'data' },
  { label: 'Designer database', value: 'designer' }, { label: 'Report fonts', value: 'fonts' },
];
const restorePreview = ref<BackupPreview|null>(null);
const restoreConfirm = ref(false); const restoreText = ref(''); const restoring = ref(false);
const restoreJob = ref<{ id: string; status: string; components: string[]; error?: string }|null>(null);
let pollTimer: number|undefined;

const active = computed(() => !!job.value && ['pending', 'running', 'restarting'].includes(job.value.status));
const jobType = computed(() => job.value?.status === 'failed' ? 'error' : job.value?.status === 'succeeded' ? 'success' : 'info');

async function loadInfo() {
  info.value = await api.get<Info>('/api/system/info');
  job.value = info.value.job;
  if (active.value) startPolling();
}
async function loadRestoreStatus() {
  const result = await api.get<{ job: typeof restoreJob.value }>('/api/system/backup/restore/status'); restoreJob.value = result.job;
}

async function checkUpdate(showMessage = true) {
  checking.value = true;
  try {
    release.value = await api.get<Release>('/api/system/update/latest');
    if (showMessage) message.success(release.value.updateAvailable ? `Version ${release.value.latestVersion} is available` : 'Framework is up to date');
  } catch (error) { message.error(error instanceof ApiError ? error.message : 'Could not check for updates'); }
  finally { checking.value = false; }
}

async function startUpdate() {
  confirmUpdate.value = false; starting.value = true;
  try {
    const result = await api.post<{ job: UpdateJob }>('/api/system/update');
    job.value = result.job; reconnecting.value = true; startPolling();
    message.success('Backup created. Framework update started.');
  } catch (error) { message.error(error instanceof ApiError ? error.message : 'Could not start update'); }
  finally { starting.value = false; }
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = window.setInterval(async () => {
    try {
      const result = await api.get<{ job: UpdateJob|null }>('/api/system/update/status');
      reconnecting.value = false; job.value = result.job;
      if (!active.value) { window.clearInterval(pollTimer); pollTimer = undefined; await loadInfo(); }
    } catch { reconnecting.value = true; }
  }, 2500);
}

onMounted(async () => {
  try { await loadInfo(); await loadRestoreStatus(); await checkUpdate(false); }
  catch (error) { message.error(error instanceof ApiError ? error.message : 'Could not load system information'); }
  finally { loading.value = false; }
});
onBeforeUnmount(() => { if (pollTimer) window.clearInterval(pollTimer); });

function downloadBackup() { const link = document.createElement('a'); link.href = `/api/system/backup/export?component=${backupComponent.value}`; document.body.appendChild(link); link.click(); link.remove(); }
function chooseBackup() {
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.emubackup,application/zip';
  input.onchange = async () => {
    const file = input.files?.[0]; if (!file) return; validating.value = true; validated.value = null;
    try {
      restorePreview.value = await api.backupRestorePreview(file); validated.value = restorePreview.value.manifest;
      restoreText.value = ''; restoreConfirm.value = true; message.success('Backup package is valid and ready to restore');
    }
    catch (error) { message.error(error instanceof ApiError ? error.message : 'Backup validation failed'); }
    finally { validating.value = false; }
  }; input.click();
}
async function startRestore() {
  if (!restorePreview.value || restoreText.value !== 'RESTORE') return;
  restoring.value = true;
  try {
    const result = await api.post<{ job: typeof restoreJob.value }>('/api/system/backup/restore', { previewId: restorePreview.value.previewId, confirmation: restoreText.value });
    restoreJob.value = result.job; restoreConfirm.value = false; message.success('Restore started. The app will restart automatically.');
    const timer = window.setInterval(async () => {
      try { await loadRestoreStatus(); if (!restoreJob.value || !['pending','running','restarting'].includes(restoreJob.value.status)) window.clearInterval(timer); }
      catch { /* expected while the app restarts */ }
    }, 2500);
  } catch (error) { message.error(error instanceof ApiError ? error.message : 'Could not start restore'); }
  finally { restoring.value = false; }
}
function mb(bytes: number) { return `${(bytes / 1024 / 1024).toFixed(2)} MB`; }
function back() { window.history.length > 1 ? router.back() : router.push('/'); }
</script>

<template>
  <div class="maintenance-page">
    <div class="page-hero">
      <div><div class="eyebrow">FRAMEWORK ADMINISTRATION</div><h1>System Maintenance</h1><p>Update the framework and create verified recovery points.</p></div>
      <n-space><n-button @click="back">Back</n-button><n-tag v-if="info" type="success" round>v{{ info.version }} · {{ info.updateChannel }}</n-tag></n-space>
    </div>
    <n-spin :show="loading">
      <div class="maintenance-grid">
        <n-card title="Framework update" class="maintenance-card">
          <n-descriptions label-placement="left" :column="1" size="small">
            <n-descriptions-item label="Current">{{ info?.version ?? '—' }}</n-descriptions-item>
            <n-descriptions-item label="Latest">{{ release?.latestVersion ?? 'Not checked' }}</n-descriptions-item>
            <n-descriptions-item label="Deployment">{{ info?.deployment ?? '—' }}</n-descriptions-item>
            <n-descriptions-item label="Last checked">{{ release ? new Date(release.checkedAt).toLocaleString() : '—' }}</n-descriptions-item>
          </n-descriptions>
          <n-space class="actions">
            <n-button :loading="checking" @click="checkUpdate()">Check for updates</n-button>
            <n-button type="primary" :disabled="!release?.updateAvailable || !info?.updateEnabled || active" :loading="starting" @click="confirmUpdate = true">Update to latest stable</n-button>
          </n-space>
          <n-alert v-if="info && !info.updateEnabled" type="warning" class="notice">Web update is not configured for this deployment. Use the manual update guide.</n-alert>
          <n-alert v-if="job" :type="jobType" class="notice" :title="`Update ${job.status}`">
            v{{ job.currentVersion }} → v{{ job.targetVersion }}<span v-if="reconnecting"> · reconnecting after restart…</span>
            <div v-if="job.error">{{ job.error }}</div><div v-if="job.backupPath" class="command">Backup: <code>{{ job.backupPath }}</code></div>
          </n-alert>
          <details v-if="release?.notes" class="notes"><summary>Release notes</summary><pre>{{ release.notes }}</pre><a :href="release.url" target="_blank" rel="noopener">Open release on GitHub</a></details>
        </n-card>
        <n-card title="Database backup" class="maintenance-card">
          <p>Create checksummed recovery packages or restore selected system components entirely from this page.</p>
          <n-select v-model:value="backupComponent" :options="backupOptions" class="component-select" />
          <n-space><n-button type="primary" @click="downloadBackup">Download Backup</n-button><n-button secondary :loading="validating" @click="chooseBackup">Upload & Restore</n-button></n-space>
          <n-alert v-if="validated" type="success" class="notice" title="Ready to restore">
            Backup from v{{ validated.frameworkVersion }}, {{ new Date(validated.createdAt).toLocaleString() }}.
            <div>{{ validated.files.map((file) => `${file.name} (${mb(file.bytes)})`).join(' · ') }}</div>
          </n-alert>
          <n-alert v-if="restoreJob" :type="restoreJob.status === 'failed' ? 'error' : restoreJob.status === 'succeeded' ? 'success' : 'info'" class="notice" :title="`Restore ${restoreJob.status}`">
            {{ restoreJob.components.join(', ') }}<div v-if="restoreJob.error">{{ restoreJob.error }}</div>
          </n-alert>
        </n-card>
      </div>
    </n-spin>
    <n-modal v-model:show="confirmUpdate" preset="dialog" title="Update framework?" positive-text="Create backup and update" negative-text="Cancel" @positive-click="startUpdate">
      The app will create a verified backup, install v{{ release?.latestVersion }}, and restart. Users will briefly lose access. Do not close or power off the host during the update.
    </n-modal>
    <n-modal v-model:show="restoreConfirm" preset="card" title="Restore backup" style="width:min(620px,calc(100vw - 24px))">
      <n-space vertical size="large">
        <n-alert type="error">The app will become unavailable briefly. Selected components are replaced atomically and rolled back if the restart health check fails.</n-alert>
        <n-alert v-for="warning in restorePreview?.warnings ?? []" :key="warning" type="warning">{{ warning }}</n-alert>
        <div>Components: <strong>{{ restorePreview?.components.join(', ') }}</strong></div>
        <div>Type <strong>RESTORE</strong> to confirm:</div><n-input v-model:value="restoreText" placeholder="RESTORE" />
        <n-space justify="end"><n-button @click="restoreConfirm = false">Cancel</n-button><n-button type="error" :disabled="restoreText !== 'RESTORE'" :loading="restoring" @click="startRestore">Restore and Restart</n-button></n-space>
      </n-space>
    </n-modal>
  </div>
</template>

<style scoped>
.maintenance-page{max-width:1080px;margin:0 auto}.page-hero{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:24px}.eyebrow{color:var(--emu-primary);font-size:11px;font-weight:800;letter-spacing:.12em}.page-hero h1{font-size:30px;letter-spacing:-.04em;margin:6px 0}.page-hero p,.maintenance-card p{color:var(--emu-muted);line-height:1.6}.maintenance-grid{display:grid;grid-template-columns:1.2fr .8fr;gap:18px}.maintenance-card{border-radius:var(--emu-radius-lg);box-shadow:var(--emu-shadow-sm)}.actions,.notice{margin-top:18px}.component-select{max-width:360px;margin:12px 0}.command{margin-top:8px;overflow-wrap:anywhere}.notes{margin-top:18px}.notes summary{cursor:pointer;font-weight:700}.notes pre{white-space:pre-wrap;max-height:260px;overflow:auto;background:#f8fafc;padding:12px;border-radius:8px;font:12px/1.5 ui-monospace,monospace}code{background:#eef2ff;color:#3730a3;border-radius:6px;padding:3px 7px;font-size:12px}@media(max-width:800px){.maintenance-grid{grid-template-columns:1fr}.page-hero{display:block}.page-hero h1{font-size:25px}.page-hero>.n-space{margin-top:12px;flex-wrap:wrap!important}.actions{display:grid!important;grid-template-columns:1fr}.actions :deep(.n-button),.maintenance-card :deep(.n-button){min-height:44px}.maintenance-card :deep(.n-card__content){padding:16px}.maintenance-card :deep(.n-descriptions-table-content){overflow-wrap:anywhere}}
</style>
