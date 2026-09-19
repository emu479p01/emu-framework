<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { NButton, NCard, NInput, NPopconfirm, NSpace, NTag, useMessage } from 'naive-ui';
import { api, ApiError, requestForm } from '../api';

interface Attachment {
  id: string; kind: 'file'|'note'|'url'; name: string; text?: string; url?: string;
  mimeType?: string; bytes?: number; sha256?: string; createdAt: string; createdBy: string;
}
const props = defineProps<{ table: string; recordId: number; embedded?: boolean }>();
const message = useMessage(); const items = ref<Attachment[]>([]); const busy = ref(false);
const note = ref(''); const url = ref('');

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
    message.success('Attachment uploaded'); await load();
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
function size(bytes?: number) { return bytes == null ? '' : bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`; }
</script>

<template>
  <n-card title="Attachments" size="small" :bordered="!embedded" class="attachments">
    <n-space vertical>
      <n-space align="center" wrap>
        <label class="file-button"><input type="file" :disabled="busy" @change="upload"><span>Upload file</span></label>
        <n-input v-model:value="note" placeholder="Add a note" style="width:260px" />
        <n-button :disabled="busy || !note.trim()" @click="add('note')">Add note</n-button>
        <n-input v-model:value="url" placeholder="https://…" style="width:260px" />
        <n-button :disabled="busy || !url.trim()" @click="add('url')">Add URL</n-button>
      </n-space>
      <div v-if="!items.length" class="empty">No attachments</div>
      <div v-for="item in items" :key="item.id" class="attachment-row">
        <n-tag size="small">{{ item.kind }}</n-tag>
        <a v-if="item.kind === 'file'" :href="`/api/attachments/${encodeURIComponent(item.id)}/download`">{{ item.name }}</a>
        <a v-else-if="item.kind === 'url'" :href="item.url" target="_blank" rel="noopener noreferrer">{{ item.name }}</a>
        <span v-else><b>{{ item.name }}</b> — {{ item.text }}</span>
        <span class="meta">{{ size(item.bytes) }} · {{ item.createdBy }}</span>
        <n-popconfirm @positive-click="remove(item.id)"><template #trigger><n-button size="tiny" quaternary type="error">Delete</n-button></template>Delete this attachment?</n-popconfirm>
      </div>
    </n-space>
  </n-card>
</template>

<style scoped>
.attachments{margin-top:4px}.file-button{display:inline-flex;align-items:center;height:34px;padding:0 14px;border:1px solid var(--emu-border);border-radius:4px;cursor:pointer}.file-button:hover{border-color:var(--n-color-target)}.file-button input{display:none}.attachment-row{display:flex;align-items:center;gap:10px;padding:8px 2px;border-bottom:1px solid var(--emu-border)}.attachment-row .meta{margin-left:auto;color:var(--emu-muted);font-size:12px}.empty{color:var(--emu-muted);padding:8px 0}
</style>
