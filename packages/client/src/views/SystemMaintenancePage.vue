<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { NAlert, NButton, NCard, NDescriptions, NDescriptionsItem, NInput, NInputNumber, NModal, NSelect, NSpace, NSpin, NTag, useMessage } from 'naive-ui';
import { api, ApiError, type BackupPreview } from '../api';
import { useRouter } from 'vue-router';

type MaintenancePhase = 'preparing'|'stopping'|'snapshotting'|'switching'|'restoring'|'verifying'|'completed'|'rolling_back'|'rolled_back'|'recovery_required';
type UpdateJob = { id: string; status: 'pending'|'running'|'restarting'|'succeeded'|'failed'; currentVersion: string; targetVersion: string; requestedBy: string; requestedAt: string; updatedAt: string; backupPath: string; deployment: string; phase?: MaintenancePhase; rollbackStatus?: 'not_required'|'running'|'succeeded'|'failed'; recoveryRequired?: boolean; error?: string };
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
const backupComponent = ref<'full'|'data'|'designer'|'fonts'|'files'|'archive'>('full');
const backupOptions = [
  { label: 'Full — Data + Designer + Fonts + Files + Archive', value: 'full' }, { label: 'Data database', value: 'data' },
  { label: 'Designer database', value: 'designer' }, { label: 'Report fonts', value: 'fonts' }, { label: 'Live attachments', value: 'files' }, { label: 'Archive catalog and payloads', value: 'archive' },
];
const restorePreview = ref<BackupPreview|null>(null);
const restoreConfirm = ref(false); const restoreText = ref(''); const restoring = ref(false);
const restoreJob = ref<{ id: string; status: string; components: string[]; phase?: MaintenancePhase; rollbackStatus?: string; recoveryRequired?: boolean; error?: string }|null>(null);
let pollTimer: number|undefined;
type StorageInfo = { filesystem: Record<string,{total:number|null;free:number|null}>; usage: Record<string,number>; usageByApp: {app:string;bytes:number;method:string}[]; paths:{files:string;archive:string}; warnings:string[] };
type ArchivePolicy = { entityName:string;enabled:number;businessDateField:string;ageDays:number;batchSize:number;includeAttachments:number;schedule:string;weekday:number;timezone:string;lastRunAt?:string };
const storage = ref<StorageInfo|null>(null); const archiveEntities = ref<{name:string;label?:string;businessDateField?:string}[]>([]); const archivePolicies = ref<ArchivePolicy[]>([]); const selectedEntity = ref('');
const policyDraft = ref({ businessDateField:'', ageDays:365, batchSize:100, includeAttachments:true, schedule:'weekly', weekday:0, timezone:'Asia/Bangkok' });
const archivePreview = ref<{eligible:number;oldest:string|null;cutoff:string}|null>(null); const archiveBusy = ref(false);
const archivedDocuments=ref<Array<{archiveId:string;entityName:string;businessKey:string;businessDate:string;createdAt:string;restoredAt?:string}>>([]);const dataJobs=ref<Array<{jobId:string;type:string;entityName:string;status:string;createdAt:string;error?:string}>>([]);
async function loadStorageArchive() { storage.value = await api.get('/api/system/storage'); const [result,documents,jobs]=await Promise.all([api.get<{eligibleEntities:typeof archiveEntities.value;policies:ArchivePolicy[]}>('/api/system/archive/policies'),api.get<{items:typeof archivedDocuments.value}>('/api/system/archive/documents?limit=20'),api.get<{items:typeof dataJobs.value}>('/api/system/data-jobs?limit=20')]); archiveEntities.value=result.eligibleEntities; archivePolicies.value=result.policies;archivedDocuments.value=documents.items;dataJobs.value=jobs.items;if(!selectedEntity.value && result.eligibleEntities[0]) selectArchiveEntity(result.eligibleEntities[0].name); }
function selectArchiveEntity(value:string) { selectedEntity.value=value; const existing=archivePolicies.value.find((item)=>item.entityName===value); const entity=archiveEntities.value.find((item)=>item.name===value); policyDraft.value=existing?{businessDateField:existing.businessDateField,ageDays:existing.ageDays,batchSize:existing.batchSize,includeAttachments:Boolean(existing.includeAttachments),schedule:existing.schedule,weekday:existing.weekday,timezone:existing.timezone}:{businessDateField:entity?.businessDateField??'',ageDays:365,batchSize:100,includeAttachments:true,schedule:'weekly',weekday:0,timezone:'Asia/Bangkok'}; archivePreview.value=null; }
async function savePolicy(){if(!selectedEntity.value)return;archiveBusy.value=true;try{await api.put(`/api/system/archive/policies/${encodeURIComponent(selectedEntity.value)}`,policyDraft.value);await loadStorageArchive();message.success('Archive policy saved');}catch(error){message.error(error instanceof ApiError?error.message:String(error));}finally{archiveBusy.value=false;}}
async function previewArchive(){archivePreview.value=await api.get(`/api/system/archive/${encodeURIComponent(selectedEntity.value)}/preview`);}
async function runArchive(){archiveBusy.value=true;try{const result=await api.post<{archived:number;failed:number}>(`/api/system/archive/${encodeURIComponent(selectedEntity.value)}/run`);message.success(`Archived ${result.archived}; failed ${result.failed}`);await loadStorageArchive();await previewArchive();}catch(error){message.error(error instanceof ApiError?error.message:String(error));}finally{archiveBusy.value=false;}}
async function restoreArchived(id:string){archiveBusy.value=true;try{const result=await api.post<{restored:boolean;skipped:boolean;reason?:string}>(`/api/system/archive/documents/${encodeURIComponent(id)}/restore`);result.restored?message.success('Archived document restored'):message.warning(result.reason??'Document skipped');await loadStorageArchive();}catch(error){message.error(error instanceof ApiError?error.message:String(error));}finally{archiveBusy.value=false;}}

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
  try { await loadInfo(); await loadRestoreStatus(); await checkUpdate(false); await loadStorageArchive(); }
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
            <div v-if="job.phase">Phase: {{ job.phase }}<span v-if="job.rollbackStatus && job.rollbackStatus !== 'not_required'"> · rollback {{ job.rollbackStatus }}</span></div>
            <div v-if="job.error">{{ job.error }}</div><div v-if="job.backupPath" class="command">Backup: <code>{{ job.backupPath }}</code></div>
          </n-alert>
          <n-alert v-if="job?.recoveryRequired" type="error" class="notice" title="Administrator recovery required">Automated rollback did not complete. Preserve the recovery files and inspect the updater logs before attempting another update.</n-alert>
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
            {{ restoreJob.components.join(', ') }}<div v-if="restoreJob.phase">Phase: {{ restoreJob.phase }}<span v-if="restoreJob.rollbackStatus && restoreJob.rollbackStatus !== 'not_required'"> · rollback {{ restoreJob.rollbackStatus }}</span></div><div v-if="restoreJob.error">{{ restoreJob.error }}</div>
          </n-alert>
          <n-alert v-if="restoreJob?.recoveryRequired" type="error" class="notice" title="Administrator recovery required">Automated restore rollback did not complete. Preserve the recovery files and inspect the updater logs.</n-alert>
        </n-card>
        <n-card title="Storage & Archive" class="maintenance-card storage-card">
          <n-alert v-for="warning in storage?.warnings ?? []" :key="warning" type="warning" class="notice">{{ warning }}</n-alert>
          <n-descriptions v-if="storage" label-placement="left" :column="1" size="small">
            <n-descriptions-item v-for="(bytes,key) in storage.usage" :key="key" :label="String(key)">{{ mb(bytes) }}</n-descriptions-item>
            <n-descriptions-item label="Files path">{{ storage.paths.files }}</n-descriptions-item><n-descriptions-item label="Archive path">{{ storage.paths.archive }}</n-descriptions-item>
          </n-descriptions>
          <details v-if="storage?.usageByApp.length"><summary>Database usage per App</summary><div v-for="entry in storage.usageByApp" :key="entry.app">{{ entry.app }}: {{ mb(entry.bytes) }} ({{ entry.method }})</div></details>
          <hr>
          <n-space vertical>
            <n-select :value="selectedEntity" :options="archiveEntities.map((entity)=>({label:entity.label??entity.name,value:entity.name}))" placeholder="Archive-eligible Data Entity" @update:value="selectArchiveEntity" />
            <n-input v-model:value="policyDraft.businessDateField" placeholder="Business date field" />
            <n-space><span>Age days</span><n-input-number v-model:value="policyDraft.ageDays" :min="0"/><span>Batch</span><n-input-number v-model:value="policyDraft.batchSize" :min="1" :max="10000"/></n-space>
            <n-space><n-select v-model:value="policyDraft.schedule" :options="[{label:'Daily',value:'daily'},{label:'Weekly',value:'weekly'}]" style="width:130px"/><n-input v-model:value="policyDraft.timezone" placeholder="Asia/Bangkok"/><label><input v-model="policyDraft.includeAttachments" type="checkbox"> Include attachments</label></n-space>
            <n-space><n-button :loading="archiveBusy" @click="savePolicy">Save policy</n-button><n-button :disabled="!selectedEntity" @click="previewArchive">Preview</n-button><n-button type="primary" :loading="archiveBusy" :disabled="!archivePreview" @click="runArchive">Archive batch</n-button></n-space>
            <n-alert v-if="archivePreview" type="info">{{ archivePreview.eligible }} eligible documents · oldest {{ archivePreview.oldest ?? '—' }} · cutoff {{ archivePreview.cutoff }}</n-alert>
            <details v-if="archivedDocuments.length"><summary>Archived documents (read-only)</summary><div v-for="document in archivedDocuments" :key="document.archiveId" class="archive-row"><span>{{ document.entityName }} · {{ document.businessKey }} · {{ document.businessDate }}</span><n-space><a :href="`/api/system/archive/documents/${encodeURIComponent(document.archiveId)}`" target="_blank">View</a><n-button size="tiny" :disabled="Boolean(document.restoredAt)" @click="restoreArchived(document.archiveId)">Restore</n-button></n-space></div></details>
            <details v-if="dataJobs.length"><summary>Job history</summary><div v-for="jobEntry in dataJobs" :key="jobEntry.jobId">{{ jobEntry.createdAt }} · {{ jobEntry.type }} · {{ jobEntry.entityName }} · {{ jobEntry.status }} <span v-if="jobEntry.error">— {{ jobEntry.error }}</span></div></details>
          </n-space>
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
.storage-card{grid-column:1/-1}.archive-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid var(--emu-border)}
</style>
