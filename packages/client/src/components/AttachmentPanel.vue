<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { NButton, NCard, NInput, NPopconfirm, NSpace, NTag, useMessage } from 'naive-ui';
import { api, ApiError, requestForm } from '../api';
import { t } from '../i18n';

interface Attachment {
  id: string; kind: 'file'|'note'|'url'; name: string; text?: string; url?: string;
  mimeType?: string; bytes?: number; sha256?: string; createdAt: string; createdBy: string;
}
const props = defineProps<{ table: string; recordId: number; embedded?: boolean }>();
const message = useMessage(); const items = ref<Attachment[]>([]); const busy = ref(false);
const note = ref(''); const url = ref('');
const viewer = ref<Attachment | null>(null);
const viewerState = ref<'loading' | 'ready' | 'error'>('loading');
const viewerClose = ref<InstanceType<typeof NButton> | null>(null);
const failedThumbnails = ref(new Set<string>());
let viewerTrigger: HTMLElement | null = null;

function isPreviewable(item: Attachment): boolean {
  return item.kind === 'file' && (item.mimeType === 'image/png' || item.mimeType === 'image/jpeg') && !failedThumbnails.value.has(item.id);
}
function onThumbnailError(item: Attachment) {
  failedThumbnails.value.add(item.id);
}
function previewUrl(item: Attachment): string { return `/api/attachments/${encodeURIComponent(item.id)}/preview`; }
function downloadUrl(item: Attachment): string { return `/api/attachments/${encodeURIComponent(item.id)}/download`; }

async function openViewer(item: Attachment, event?: Event) {
  event?.preventDefault();
  viewerTrigger = (event?.currentTarget as HTMLElement | null) ?? null;
  viewer.value = item;
  viewerState.value = 'loading';
  await nextTick();
  (viewerClose.value?.$el as HTMLElement | undefined)?.focus?.();
}
function closeViewer() {
  viewer.value = null;
  viewerTrigger?.focus?.();
  viewerTrigger = null;
}
function onViewerKeydown(event: KeyboardEvent) { if (event.key === 'Escape' && viewer.value) closeViewer(); }
onMounted(() => window.addEventListener('keydown', onViewerKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onViewerKeydown));

async function load() {
  if (!props.recordId) return;
  items.value = (await api.get<{ items: Attachment[] }>(`/api/attachments/${encodeURIComponent(props.table)}/${props.recordId}`)).items;
}
watch(() => [props.table, props.recordId], load); onMounted(load);

async function upload(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return;
  busy.value = true;
  try {
    const form = new FormData(); form.append('file', file);
    await requestForm(`/api/attachments/${encodeURIComponent(props.table)}/${props.recordId}/file`, form);
    message.success(t('ui.attachments.uploaded')); await load();
  } catch (error) { message.error(error instanceof ApiError ? error.message : String(error)); }
  finally { input.value = ''; busy.value = false; }
}

async function add(kind: 'note'|'url') {
  busy.value = true;
  try {
    if (kind === 'note') { await api.post(`/api/attachments/${encodeURIComponent(props.table)}/${props.recordId}/note`, { text: note.value }); note.value = ''; }
    else { await api.post(`/api/attachments/${encodeURIComponent(props.table)}/${props.recordId}/url`, { url: url.value }); url.value = ''; }
    await load();
  } catch (error) { message.error(error instanceof ApiError ? error.message : String(error)); }
  finally { busy.value = false; }
}
async function remove(id: string) { await api.delete(`/api/attachments/${encodeURIComponent(id)}`); await load(); }
function size(bytes?: number) { return bytes == null ? '' : bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : bytes < 1073741824 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1073741824).toFixed(2)} GB`; }
</script>

<template>
  <n-card :title="t('ui.attachments.title')" size="small" :bordered="!embedded" class="attachments">
    <n-space vertical>
      <n-space align="center" wrap>
        <label class="file-button"><input type="file" :disabled="busy" @change="upload"><span>{{ t('ui.attachments.upload') }}</span></label>
        <n-input v-model:value="note" :placeholder="t('ui.attachments.notePlaceholder')" style="width:260px" />
        <n-button :disabled="busy || !note.trim()" @click="add('note')">{{ t('ui.attachments.addNote') }}</n-button>
        <n-input v-model:value="url" :placeholder="t('ui.attachments.urlPlaceholder')" style="width:260px" />
        <n-button :disabled="busy || !url.trim()" @click="add('url')">{{ t('ui.attachments.addUrl') }}</n-button>
      </n-space>
      <div v-if="!items.length" class="empty">{{ t('ui.attachments.empty') }}</div>
      <div v-for="item in items" :key="item.id" class="attachment-row" :class="{ previewable: isPreviewable(item) }">
        <n-tag size="small">{{ item.kind }}</n-tag>
        <template v-if="item.kind === 'file'">
          <a v-if="isPreviewable(item)" href="#" class="file-link" :aria-label="`${t('ui.attachments.preview')} — ${item.name}`" @click="openViewer(item, $event)">
            <img class="thumbnail" :src="previewUrl(item)" :alt="t('ui.attachments.imageAlt')" loading="lazy" @error="onThumbnailError(item)" />
            <span class="file-name">{{ item.name }}</span>
          </a>
          <a v-else :href="downloadUrl(item)">{{ item.name }}</a>
        </template>
        <a v-else-if="item.kind === 'url'" :href="item.url" target="_blank" rel="noopener noreferrer">{{ item.name }}</a>
        <span v-else><b>{{ item.name }}</b> — {{ item.text }}</span>
        <span class="meta">{{ size(item.bytes) }} · {{ item.createdBy }}</span>
        <n-popconfirm @positive-click="remove(item.id)"><template #trigger><n-button size="tiny" quaternary type="error">{{ t('ui.common.delete') }}</n-button></template>{{ t('ui.attachments.deleteConfirm') }}</n-popconfirm>
      </div>
    </n-space>
    <div v-if="viewer" class="viewer" role="dialog" aria-modal="true" :aria-label="viewer.name" data-testid="attachment-viewer">
      <div class="viewer-header">
        <strong class="viewer-title">{{ viewer.name }}</strong>
        <n-space :size="8" :wrap="false">
          <a class="viewer-download" :href="downloadUrl(viewer)" :download="viewer.name">{{ t('ui.common.download') }}</a>
          <n-button ref="viewerClose" size="small" quaternary aria-label="Close preview" data-testid="viewer-close" @click="closeViewer">{{ t('ui.common.close') }}</n-button>
        </n-space>
      </div>
      <div class="viewer-body">
        <template v-if="viewerState !== 'error'">
          <img
            :key="viewer.id"
            class="viewer-image"
            :src="previewUrl(viewer)"
            :alt="viewer.name"
            @load="viewerState = 'ready'"
            @error="viewerState = 'error'"
          >
          <div v-if="viewerState === 'loading'" class="viewer-loading">{{ t('ui.attachments.imageAlt') }}…</div>
        </template>
        <div v-else class="viewer-error">
          <p>{{ t('ui.attachments.previewFailed') }}</p>
          <a class="viewer-download" :href="downloadUrl(viewer)" :download="viewer.name">{{ t('ui.common.download') }}</a>
        </div>
      </div>
    </div>
  </n-card>
</template>

<style scoped>
.attachments{margin-top:4px}.file-button{display:inline-flex;align-items:center;height:34px;padding:0 14px;border:1px solid var(--emu-border);border-radius:4px;cursor:pointer}.file-button:hover{border-color:var(--n-color-target)}.file-button input{display:none}.attachment-row{display:flex;align-items:center;gap:10px;padding:8px 2px;border-bottom:1px solid var(--emu-border)}.attachment-row .meta{margin-left:auto;color:var(--emu-muted);font-size:12px}.empty{color:var(--emu-muted);padding:8px 0}
.file-link{display:inline-flex;align-items:center;gap:10px;min-width:0;color:inherit}
.thumbnail{width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid var(--emu-border);flex:0 0 56px;background:#f1f5f9}
.file-name{overflow-wrap:anywhere}
.viewer{position:fixed;inset:0;z-index:60;background:rgba(9,14,26,.86);display:flex;flex-direction:column}
.viewer-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;background:#111827;color:#fff;flex:0 0 auto}
.viewer-title{font-size:15px;overflow-wrap:anywhere;min-width:0}
.viewer-header .n-button{min-height:44px}
.viewer-download{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border-radius:8px;background:var(--emu-primary);color:#fff;font-weight:600;text-decoration:none}
.viewer-body{flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;position:relative;padding:16px}
.viewer-image{max-width:100%;max-height:100%;object-fit:contain}
.viewer-loading{position:absolute;color:#e2e8f0;font-size:14px}
.viewer-error{color:#f8fafc;text-align:center}.viewer-error a{margin-top:10px}
@media (max-width:700px){.viewer-header{padding:8px 10px}.viewer-body{padding:8px}.attachment-row{flex-wrap:wrap}.attachment-row .meta{margin-left:0;width:100%}}
</style>
