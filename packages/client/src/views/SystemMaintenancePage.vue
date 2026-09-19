<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { NAlert, NButton, NCard, NCheckbox, NDescriptions, NDescriptionsItem, NEmpty, NInput, NInputNumber, NModal, NSelect, NSpace, NSpin, NTag, useMessage } from 'naive-ui';
import { api, ApiError, type BackupPreview } from '../api';
import { useRouter } from 'vue-router';
import { useMeta } from '../stores/meta';
import { t } from '../i18n';

type MaintenancePhase = 'preparing'|'stopping'|'snapshotting'|'switching'|'restoring'|'verifying'|'completed'|'rolling_back'|'rolled_back'|'recovery_required';
type UpdateJob = { id: string; status: 'pending'|'running'|'restarting'|'succeeded'|'failed'; currentVersion: string; targetVersion: string; requestedBy: string; requestedAt: string; updatedAt: string; backupPath: string; deployment: string; phase?: MaintenancePhase; rollbackStatus?: 'not_required'|'running'|'succeeded'|'failed'; recoveryRequired?: boolean; error?: string };
type Release = { currentVersion: string; latestVersion: string; updateAvailable: boolean; name: string; notes: string; url: string; publishedAt: string|null; checkedAt: string };
type Info = { version: string; backupSchemaVersion: number; updateChannel: string; deployment: string; updateEnabled: boolean; job: UpdateJob|null };

const message = useMessage();
const router = useRouter();
const meta = useMeta();
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
const backupComponent = ref<'full'|'data'|'designer'|'fonts'|'files'|'archive'>('full');
const backupOptions = computed(() => [
  { label: t('ui.backup.full'), value: 'full' },
  { label: t('ui.backup.data'), value: 'data' },
  { label: t('ui.backup.designer'), value: 'designer' },
  { label: t('ui.backup.fonts'), value: 'fonts' },
  { label: t('ui.backup.files'), value: 'files' },
  { label: t('ui.backup.archive'), value: 'archive' },
]);
const restorePreview = ref<BackupPreview|null>(null);
const restoreConfirm = ref(false); const restoreText = ref(''); const restoring = ref(false);
const restoreJob = ref<{ id: string; status: string; components: string[]; phase?: MaintenancePhase; rollbackStatus?: string; recoveryRequired?: boolean; error?: string }|null>(null);
let pollTimer: number|undefined;
type StorageInfo = { filesystem: Record<string,{total:number|null;free:number|null}>; usage: Record<string,number>; usageByApp: {app:string;bytes:number;method:string}[]; paths:{files:string;archive:string}; warnings:string[] };
type ArchivePolicy = { entityName:string;enabled:number;businessDateField:string;ageDays:number;batchSize:number;includeAttachments:number;schedule:string;weekday:number;timezone:string;lastRunAt?:string };
const storage = ref<StorageInfo|null>(null); const archiveEntities = ref<{name:string;label?:string;businessDateField?:string}[]>([]); const archivePolicies = ref<ArchivePolicy[]>([]); const selectedEntity = ref('');
const policyDraft = reactive({ businessDateField:'', ageDays:365, batchSize:100, includeAttachments:true, schedule:'weekly', weekday:0, timezone:'Asia/Bangkok', enabled:false });
const savedSnapshot = ref('');
const archivePreview = ref<{eligible:number;oldest:string|null;cutoff:string;batchSize?:number}|null>(null); const archiveBusy = ref(false);
const confirmRun = ref(false); const confirmEnable = ref(false);
const WEEKDAYS = computed(() => [
  { label: t('ui.archive.weekdaySun'), value: 0 },
  { label: t('ui.archive.weekdayMon'), value: 1 },
  { label: t('ui.archive.weekdayTue'), value: 2 },
  { label: t('ui.archive.weekdayWed'), value: 3 },
  { label: t('ui.archive.weekdayThu'), value: 4 },
  { label: t('ui.archive.weekdayFri'), value: 5 },
  { label: t('ui.archive.weekdaySat'), value: 6 },
]);
const SCHEDULES = [
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
];
const STORAGE_KEYS = ['dataDb','dataWal','designerDb','designerWal','backups','fonts','liveFiles','archive'] as const;
const MOUNTS = [
  { key: 'data', labelKey: 'ui.storage.dataDb' },
  { key: 'files', labelKey: 'ui.storage.liveFiles' },
  { key: 'archive', labelKey: 'ui.storage.archive' },
] as const;
const methodLabel = (method: string) => (method === 'exact-dbstat' ? t('ui.storage.methodMeasured') : t('ui.storage.methodEstimate'));

const policyDirty = computed(() => JSON.stringify(policyDraft) !== savedSnapshot.value);
watch(policyDraft, () => { archivePreview.value = null; });

function snapshotOf(source: typeof policyDraft): string { return JSON.stringify(source); }
async function loadStorageArchive() { storage.value = await api.get('/api/system/storage'); const [result,documents,jobs]=await Promise.all([api.get<{eligibleEntities:typeof archiveEntities.value;policies:ArchivePolicy[]}>('/api/system/archive/policies'),api.get<{items:typeof archivedDocuments.value}>('/api/system/archive/documents?limit=20'),api.get<{items:typeof dataJobs.value}>('/api/system/data-jobs?limit=20')]); archiveEntities.value=result.eligibleEntities;archivePolicies.value=result.policies;archivedDocuments.value=documents.items;dataJobs.value=jobs.items;if(!selectedEntity.value && result.eligibleEntities[0]) selectArchiveEntity(result.eligibleEntities[0].name); }
function selectArchiveEntity(value:string) { selectedEntity.value=value; const existing=archivePolicies.value.find((item)=>item.entityName===value); const entity=archiveEntities.value.find((item)=>item.name===value); Object.assign(policyDraft, existing?{businessDateField:existing.businessDateField,ageDays:existing.ageDays,batchSize:existing.batchSize,includeAttachments:Boolean(existing.includeAttachments),schedule:existing.schedule,weekday:existing.weekday,timezone:existing.timezone,enabled:Boolean(existing.enabled)}:{businessDateField:entity?.businessDateField??'',ageDays:365,batchSize:100,includeAttachments:true,schedule:'weekly',weekday:0,timezone:'Asia/Bangkok',enabled:false}); savedSnapshot.value=snapshotOf(policyDraft); archivePreview.value=null; }
async function savePolicy(){
  if(!selectedEntity.value)return;
  const existing = archivePolicies.value.find((item) => item.entityName === selectedEntity.value);
  const enabling = policyDraft.enabled && !(existing && existing.enabled);
  if (enabling) { confirmEnable.value = true; return; }
  await doSavePolicy();
}
async function doSavePolicy(){
  confirmEnable.value=false;archiveBusy.value=true;
  try{
    // enabled and weekday are always part of the payload so an omitted field can
    // never silently reset them to column defaults.
    await api.put(`/api/system/archive/policies/${encodeURIComponent(selectedEntity.value)}`,{...policyDraft,enabled:policyDraft.enabled,weekday:policyDraft.weekday});
    savedSnapshot.value=snapshotOf(policyDraft);
    await loadStorageArchive();message.success(t('ui.archive.policySaved'));
  }catch(error){message.error(error instanceof ApiError?error.message:String(error));}finally{archiveBusy.value=false;}
}
async function previewArchive(){
  if (policyDirty.value) { message.warning(t('ui.archive.unsaved')); return; }
  try { archivePreview.value=await api.get(`/api/system/archive/${encodeURIComponent(selectedEntity.value)}/preview`); }
  catch(error){message.error(error instanceof ApiError?error.message:String(error));}
}
async function runArchive(){
  archiveBusy.value=true;
  try{const result=await api.post<{archived:number;failed:number}>(`/api/system/archive/${encodeURIComponent(selectedEntity.value)}/run`);message.success(`${t('ui.archive.run')}: ${result.archived} · ${result.failed}`);await loadStorageArchive();await previewArchive();}
  catch(error){message.error(error instanceof ApiError?error.message:String(error));}finally{archiveBusy.value=false;}
}
async function restoreArchived(id:string){archiveBusy.value=true;try{const result=await api.post<{restored:boolean;skipped:boolean;reason?:string}>(`/api/system/archive/documents/${encodeURIComponent(id)}/restore`);result.restored?message.success(t('ui.archive.restored')):message.warning(result.reason??t('ui.archive.skipped'));await loadStorageArchive();}catch(error){message.error(error instanceof ApiError?error.message:String(error));}finally{archiveBusy.value=false;}}

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
    if (showMessage) message.success(release.value.updateAvailable ? `${release.value.latestVersion}` : t('ui.maintenance.upToDate'));
  } catch (error) { message.error(error instanceof ApiError ? error.message : 'Could not check for updates'); }
  finally { checking.value = false; }
}

async function startUpdate() {
  confirmUpdate.value = false; starting.value = true;
  try {
    const result = await api.post<{ job: UpdateJob }>('/api/system/update');
    job.value = result.job; reconnecting.value = true; startPolling();
    message.success(t('ui.maintenance.updateStarted'));
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

async function onLocaleChanged() { await loadStorageArchive().catch(() => undefined); }

onMounted(async () => {
  window.addEventListener('emu:locale-changed', onLocaleChanged);
  try { await loadInfo(); await loadRestoreStatus(); await checkUpdate(false); await loadStorageArchive(); }
  catch (error) { message.error(error instanceof ApiError ? error.message : 'Could not load system information'); }
  finally { loading.value = false; }
});
onBeforeUnmount(() => { if (pollTimer) window.clearInterval(pollTimer); window.removeEventListener('emu:locale-changed', onLocaleChanged); });

function downloadBackup() { const link = document.createElement('a'); link.href = `/api/system/backup/export?component=${backupComponent.value}`; document.body.appendChild(link); link.click(); link.remove(); }
function chooseBackup() {
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.emubackup,application/zip';
  input.onchange = async () => {
    const file = input.files?.[0]; if (!file) return; validating.value = true; validated.value = null;
    try {
      restorePreview.value = await api.backupRestorePreview(file); validated.value = restorePreview.value.manifest;
      restoreText.value = ''; restoreConfirm.value = true; message.success(t('ui.maintenance.backupReady'));
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
    restoreJob.value = result.job; restoreConfirm.value = false; message.success(t('ui.maintenance.restoreStarted'));
    const timer = window.setInterval(async () => {
      try { await loadRestoreStatus(); if (!restoreJob.value || !['pending','running','restarting'].includes(restoreJob.value.status)) window.clearInterval(timer); }
      catch { /* expected while the app restarts */ }
    }, 2500);
  } catch (error) { message.error(error instanceof ApiError ? error.message : 'Could not start restore'); }
  finally { restoring.value = false; }
}
function size(bytes?: number|null): string {
  if (bytes == null || !Number.isFinite(bytes)) return t('ui.common.unknown');
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}
function mb(bytes: number) { return size(bytes); }
function back() { window.history.length > 1 ? router.back() : router.push('/'); }
const archivedDocuments=ref<Array<{archiveId:string;entityName:string;businessKey:string;businessDate:string;createdAt:string;restoredAt?:string}>>([]);const dataJobs=ref<Array<{jobId:string;type:string;entityName:string;status:string;createdAt:string;error?:string}>>([]);
</script>

<template>
  <div class="maintenance-page">
    <div class="page-hero">
      <div><div class="eyebrow">FRAMEWORK ADMINISTRATION</div><h1>{{ t('ui.maintenance.title') }}</h1><p>{{ t('ui.maintenance.subtitle') }}</p></div>
      <n-space><n-button @click="back">{{ t('ui.common.back') }}</n-button><n-tag v-if="info" type="success" round>v{{ info.version }} · {{ info.updateChannel }}</n-tag></n-space>
    </div>
    <n-spin :show="loading">
      <div class="maintenance-grid">
        <n-card :title="t('ui.maintenance.update')" class="maintenance-card">
          <n-descriptions label-placement="left" :column="1" size="small">
            <n-descriptions-item :label="t('ui.maintenance.current')">{{ info?.version ?? '—' }}</n-descriptions-item>
            <n-descriptions-item :label="t('ui.maintenance.latest')">{{ release?.latestVersion ?? t('ui.maintenance.notChecked') }}</n-descriptions-item>
            <n-descriptions-item :label="t('ui.maintenance.deployment')">{{ info?.deployment ?? '—' }}</n-descriptions-item>
            <n-descriptions-item :label="t('ui.maintenance.lastChecked')">{{ release ? new Date(release.checkedAt).toLocaleString() : '—' }}</n-descriptions-item>
          </n-descriptions>
          <n-space class="actions">
            <n-button :loading="checking" @click="checkUpdate()">{{ t('ui.maintenance.checkUpdate') }}</n-button>
            <n-button type="primary" :disabled="!release?.updateAvailable || !info?.updateEnabled || active" :loading="starting" @click="confirmUpdate = true">{{ t('ui.maintenance.updateLatest') }}</n-button>
          </n-space>
          <n-alert v-if="info && !info.updateEnabled" type="warning" class="notice">{{ t('ui.maintenance.updateDisabled') }}</n-alert>
          <n-alert v-if="job" :type="jobType" class="notice" :title="`Update ${job.status}`">
            v{{ job.currentVersion }} → v{{ job.targetVersion }}<span v-if="reconnecting"> · reconnecting…</span>
            <div v-if="job.phase">Phase: {{ job.phase }}<span v-if="job.rollbackStatus && job.rollbackStatus !== 'not_required'"> · rollback {{ job.rollbackStatus }}</span></div>
            <div v-if="job.error">{{ job.error }}</div><div v-if="job.backupPath" class="command">Backup: <code>{{ job.backupPath }}</code></div>
          </n-alert>
          <n-alert v-if="job?.recoveryRequired" type="error" class="notice" title="Administrator recovery required">Automated rollback did not complete. Preserve the recovery files and inspect the updater logs before attempting another update.</n-alert>
          <details v-if="release?.notes" class="notes"><summary>Release notes</summary><pre>{{ release.notes }}</pre><a :href="release.url" target="_blank" rel="noopener">Open release on GitHub</a></details>
        </n-card>
        <n-card :title="t('ui.maintenance.backup')" class="maintenance-card">
          <p>{{ t('ui.maintenance.backupDescription') }}</p>
          <div class="backup-field">
            <span class="backup-label">{{ t('ui.maintenance.backupComponent') }}</span>
            <n-select v-model:value="backupComponent" :options="backupOptions" class="component-select" />
            <p class="hint">{{ t('ui.maintenance.backupComponentHint') }}</p>
          </div>
          <n-space><n-button type="primary" @click="downloadBackup">{{ t('ui.maintenance.downloadBackup') }}</n-button><n-button secondary :loading="validating" @click="chooseBackup">{{ t('ui.maintenance.uploadRestore') }}</n-button></n-space>
          <n-alert v-if="validated" type="success" class="notice" :title="t('ui.maintenance.backupReady')">
            Backup from v{{ validated.frameworkVersion }}, {{ new Date(validated.createdAt).toLocaleString() }}.
            <div>{{ validated.files.map((file) => `${file.name} (${mb(file.bytes)})`).join(' · ') }}</div>
          </n-alert>
          <n-alert v-if="restoreJob" :type="restoreJob.status === 'failed' ? 'error' : restoreJob.status === 'succeeded' ? 'success' : 'info'" class="notice" :title="`Restore ${restoreJob.status}`">
            {{ restoreJob.components.join(', ') }}<div v-if="restoreJob.phase">Phase: {{ restoreJob.phase }}<span v-if="restoreJob.rollbackStatus && restoreJob.rollbackStatus !== 'not_required'"> · rollback {{ restoreJob.rollbackStatus }}</span></div><div v-if="restoreJob.error">{{ restoreJob.error }}</div>
          </n-alert>
          <n-alert v-if="restoreJob?.recoveryRequired" type="error" class="notice" title="Administrator recovery required">Automated restore rollback did not complete. Preserve the recovery files and inspect the updater logs.</n-alert>
        </n-card>
        <n-card :title="t('ui.maintenance.storage')" class="maintenance-card storage-card">
          <n-alert v-for="warning in storage?.warnings ?? []" :key="warning" type="warning" class="notice">{{ warning }}</n-alert>
          <n-descriptions v-if="storage" label-placement="left" :column="1" size="small">
            <n-descriptions-item v-for="key in STORAGE_KEYS" :key="key" :label="t(`ui.storage.${key}`)">{{ size(storage.usage[key]) }}</n-descriptions-item>
          </n-descriptions>
          <details v-if="storage" class="notes"><summary>{{ t('ui.maintenance.storagePaths') }} · {{ t('ui.storage.filesystem') }}</summary>
            <div class="mounts">
              <div v-for="mount in MOUNTS" :key="mount.key" class="mount">
                <strong>{{ t(mount.labelKey) }}</strong>
                <div>{{ t('ui.storage.total') }}: {{ size(storage.filesystem[mount.key]?.total) }} · {{ t('ui.storage.free') }}: {{ size(storage.filesystem[mount.key]?.free) }}</div>
                <div class="mount-path">{{ mount.key === 'data' ? t('ui.storage.dataDb') : mount.key === 'files' ? storage.paths.files : storage.paths.archive }}</div>
              </div>
            </div>
          </details>
          <details v-if="storage?.usageByApp.length" class="notes"><summary>{{ t('ui.storage.usageByApp') }}</summary>
            <div v-for="entry in storage.usageByApp" :key="entry.app" class="app-usage">{{ entry.app }}: {{ size(entry.bytes) }} ({{ methodLabel(entry.method) }})</div>
            <p class="hint">{{ t('ui.maintenance.storageApprox') }}</p>
          </details>
        </n-card>
        <n-card :title="t('ui.maintenance.archive')" class="maintenance-card archive-card">
          <n-empty v-if="!archiveEntities.length" :description="t('ui.archive.empty')">
            <template #extra>
              <n-button v-if="meta.meta?.capabilities.designer" tag="a" href="/designer" @click.prevent="router.push('/designer')">{{ t('ui.designer.title') }}</n-button>
            </template>
          </n-empty>
          <n-space v-else vertical>
            <div class="archive-field">
              <span class="archive-label">{{ t('ui.maintenance.archiveEntity') }}</span>
              <n-select :value="selectedEntity" :options="archiveEntities.map((entity)=>({label:entity.label??entity.name,value:entity.name}))" :placeholder="t('ui.maintenance.archiveEntityHint')" @update:value="selectArchiveEntity" />
            </div>
            <div class="archive-field">
              <span class="archive-label">{{ t('ui.archive.businessDateField') }}</span>
              <n-input v-model:value="policyDraft.businessDateField" :placeholder="t('ui.archive.businessDateHint')" />
            </div>
            <n-space wrap>
              <div class="archive-field inline"><span class="archive-label">{{ t('ui.archive.ageDays') }}</span><n-input-number v-model:value="policyDraft.ageDays" :min="0" /></div>
              <div class="archive-field inline"><span class="archive-label">{{ t('ui.archive.batchSize') }}</span><n-input-number v-model:value="policyDraft.batchSize" :min="1" :max="10000" /></div>
            </n-space>
            <n-space wrap align="center">
              <div class="archive-field inline"><span class="archive-label">{{ t('ui.archive.schedule') }}</span><n-select v-model:value="policyDraft.schedule" :options="SCHEDULES" style="width:130px" /></div>
              <div v-if="policyDraft.schedule === 'weekly'" class="archive-field inline"><span class="archive-label">{{ t('ui.archive.weekday') }}</span><n-select v-model:value="policyDraft.weekday" :options="WEEKDAYS" style="width:150px" /></div>
              <div class="archive-field inline"><span class="archive-label">{{ t('ui.archive.timezone') }}</span><n-input v-model:value="policyDraft.timezone" placeholder="Asia/Bangkok" style="width:170px" /></div>
            </n-space>
            <n-space wrap align="center">
              <label class="archive-check"><n-checkbox v-model:checked="policyDraft.includeAttachments" /> {{ t('ui.archive.includeAttachments') }}</label>
              <label class="archive-check"><n-checkbox v-model:checked="policyDraft.enabled" /> {{ t('ui.archive.enabled') }}</label>
            </n-space>
            <p class="hint">{{ t('ui.archive.enabledHint') }}</p>
            <n-alert v-if="policyDirty" type="warning" :show-icon="true">{{ t('ui.archive.unsaved') }}</n-alert>
            <n-space>
              <n-button :loading="archiveBusy" :disabled="!selectedEntity" @click="savePolicy">{{ t('ui.archive.savePolicy') }}</n-button>
              <n-button :disabled="!selectedEntity || policyDirty" @click="previewArchive">{{ t('ui.archive.preview') }}</n-button>
              <n-button type="primary" :loading="archiveBusy" :disabled="!selectedEntity || policyDirty || !archivePreview" @click="confirmRun = true">{{ t('ui.archive.run') }}</n-button>
            </n-space>
            <n-alert v-if="archivePreview" type="info">{{ archivePreview.eligible }} · {{ t('ui.archive.oldest') }} {{ archivePreview.oldest ?? '—' }} · {{ t('ui.archive.cutoff') }} {{ archivePreview.cutoff }} · {{ t('ui.archive.batchSize') }} {{ archivePreview.batchSize ?? policyDraft.batchSize }}</n-alert>
            <details v-if="archivedDocuments.length" class="notes"><summary>{{ t('ui.archive.documents') }}</summary><div v-for="document in archivedDocuments" :key="document.archiveId" class="archive-row"><span>{{ document.entityName }} · {{ document.businessKey }} · {{ document.businessDate }}</span><n-space><a :href="`/api/system/archive/documents/${encodeURIComponent(document.archiveId)}`" target="_blank">{{ t('ui.archive.view') }}</a><n-button size="tiny" :disabled="Boolean(document.restoredAt)" :loading="archiveBusy" @click="restoreArchived(document.archiveId)">{{ t('ui.archive.restore') }}</n-button></n-space></div></details>
            <details v-if="dataJobs.length" class="notes"><summary>{{ t('ui.archive.jobs') }}</summary><div v-for="jobEntry in dataJobs" :key="jobEntry.jobId">{{ jobEntry.createdAt }} · {{ jobEntry.type }} · {{ jobEntry.entityName }} · {{ jobEntry.status }} <span v-if="jobEntry.error">— {{ jobEntry.error }}</span></div></details>
          </n-space>
        </n-card>
      </div>
    </n-spin>
    <n-modal v-model:show="confirmUpdate" preset="dialog" :title="t('ui.maintenance.updateTitle')" :positive-text="t('ui.maintenance.updateConfirm')" :negative-text="t('ui.common.cancel')" @positive-click="startUpdate">
      {{ t('ui.maintenance.updateBody') }}
    </n-modal>
    <n-modal v-model:show="confirmEnable" preset="dialog" :title="t('ui.archive.enabled')" :positive-text="t('ui.archive.savePolicy')" :negative-text="t('ui.common.cancel')" @positive-click="doSavePolicy">
      {{ t('ui.archive.saveEnabledNotice') }}
    </n-modal>
    <n-modal v-model:show="confirmRun" preset="dialog" :title="t('ui.archive.confirmTitle')" :positive-text="t('ui.archive.run')" :negative-text="t('ui.common.cancel')" @positive-click="runArchive">
      <div class="run-summary">
        <div><strong>{{ t('ui.maintenance.archiveEntity') }}:</strong> {{ selectedEntity }}</div>
        <div><strong>{{ t('ui.archive.cutoff') }}:</strong> {{ archivePreview?.cutoff ?? '—' }}</div>
        <div><strong>{{ t('ui.archive.batchSize') }}:</strong> {{ policyDraft.batchSize }}</div>
      </div>
      <p class="hint">{{ t('ui.archive.runNotice') }}</p>
    </n-modal>
    <n-modal v-model:show="restoreConfirm" preset="card" :title="t('ui.maintenance.uploadRestore')" style="width:min(620px,calc(100vw - 24px))">
      <n-space vertical size="large">
        <n-alert type="error">{{ t('ui.maintenance.restoreBody') }}</n-alert>
        <n-alert v-for="warning in restorePreview?.warnings ?? []" :key="warning" type="warning">{{ warning }}</n-alert>
        <div>{{ t('ui.maintenance.restoreComponents') }}: <strong>{{ restorePreview?.components.join(', ') }}</strong></div>
        <div>{{ t('ui.maintenance.restoreType') }} <strong>RESTORE</strong>:</div><n-input v-model:value="restoreText" placeholder="RESTORE" />
        <n-space justify="end"><n-button @click="restoreConfirm = false">{{ t('ui.common.cancel') }}</n-button><n-button type="error" :disabled="restoreText !== 'RESTORE'" :loading="restoring" @click="startRestore">{{ t('ui.maintenance.restoreAndRestart') }}</n-button></n-space>
      </n-space>
    </n-modal>
  </div>
</template>

<style scoped>
.maintenance-page{max-width:1080px;margin:0 auto}.page-hero{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:24px}.eyebrow{color:var(--emu-primary);font-size:11px;font-weight:800;letter-spacing:.12em}.page-hero h1{font-size:30px;letter-spacing:-.04em;margin:6px 0}.page-hero p,.maintenance-card p{color:var(--emu-muted);line-height:1.6}.maintenance-grid{display:grid;grid-template-columns:1.2fr .8fr;gap:18px}.maintenance-card{border-radius:var(--emu-radius-lg);box-shadow:var(--emu-shadow-sm)}.actions,.notice{margin-top:18px}.component-select{max-width:360px;margin:8px 0}.command{margin-top:8px;overflow-wrap:anywhere}.notes{margin-top:18px}.notes summary{cursor:pointer;font-weight:700}.notes pre{white-space:pre-wrap;max-height:260px;overflow:auto;background:#f8fafc;padding:12px;border-radius:8px;font:12px/1.5 ui-monospace,monospace}code{background:#eef2ff;color:#3730a3;border-radius:6px;padding:3px 7px;font-size:12px}
.storage-card,.archive-card{grid-column:1/-1}
.hint{color:var(--emu-muted);font-size:13px;line-height:1.5;margin:8px 0 0}
.backup-field .backup-label,.archive-field .archive-label{display:block;font-size:13px;font-weight:700;margin-bottom:6px}
.archive-field.inline{display:inline-flex;align-items:center;gap:8px}.archive-field.inline .archive-label{margin:0}
.archive-check{display:inline-flex;align-items:center;gap:6px;font-size:14px}
.mounts{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin-top:10px}.mount{border:1px solid var(--emu-border);border-radius:10px;padding:10px}.mount-path{color:var(--emu-muted);font-size:12px;overflow-wrap:anywhere;margin-top:4px}
.app-usage{padding:3px 0;overflow-wrap:anywhere}
.archive-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid var(--emu-border)}
.run-summary div{padding:3px 0}
@media(max-width:800px){.maintenance-grid{grid-template-columns:1fr}.page-hero{display:block}.page-hero h1{font-size:25px}.page-hero>.n-space{margin-top:12px;flex-wrap:wrap!important}.actions{display:grid!important;grid-template-columns:1fr}.actions :deep(.n-button),.maintenance-card :deep(.n-button){min-height:44px}.maintenance-card :deep(.n-card__content){padding:16px}.maintenance-card :deep(.n-descriptions-table-content){overflow-wrap:anywhere}.component-select{max-width:100%}}
</style>
