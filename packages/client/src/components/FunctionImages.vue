<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { requestForm } from '../api';
import type { FunctionMeta } from '@emu/core';
const props = defineProps<{ name: string; config: NonNullable<FunctionMeta['imageInput']>; recordId: unknown; disabled?: boolean }>();
type Item = { file: File; preview: string; uploadId: string; id?: string; error?: string };
const items = ref<Item[]>([]); const error = ref(''); const uploading = ref(false);
function clear() { for (const item of items.value) URL.revokeObjectURL(item.preview); items.value = []; error.value = ''; }
watch(() => [props.name, props.recordId, props.config.table], clear);
onBeforeUnmount(clear);
function select(event: Event) {
  const input = event.target as HTMLInputElement;
  for (const file of Array.from(input.files ?? [])) {
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) { error.value = 'Choose JPEG, PNG or WebP images.'; continue; }
    if (!props.config.multiple && items.value.length) { error.value = 'This Function accepts one image.'; break; }
    items.value.push({ file, preview: URL.createObjectURL(file), uploadId: crypto.randomUUID() });
  }
  input.value = '';
}
function remove(item: Item) { URL.revokeObjectURL(item.preview); items.value = items.value.filter(entry => entry !== item); }
async function upload(): Promise<string[]> {
  if (uploading.value) throw new Error('Image upload is already running');
  const id = Number(props.recordId);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Save the referenced record before attaching images.');
  if (!items.value.length) throw new Error('Select at least one image.');
  uploading.value = true; error.value = '';
  try {
    for (const item of items.value) {
      if (item.id) continue;
      item.error = '';
      try {
        const form = new FormData(); form.append('file', item.file);
        const result = await requestForm<{ id: string }>(`/api/attachments/${encodeURIComponent(props.config.table)}/${id}/file?function=${encodeURIComponent(props.name)}&uploadId=${item.uploadId}`, form);
        item.id = result.id;
      } catch (failure) { item.error = failure instanceof Error ? failure.message : String(failure); throw failure; }
    }
    return items.value.map(item => item.id!);
  } finally { uploading.value = false; }
}
defineExpose({ upload });
</script>
<template>
  <div class="image-input">
    <p>Attach images to record #{{ recordId }}. Files are uploaded when you confirm. Uploaded images remain attached if the Function fails.</p>
    <label>Choose images <input type="file" accept="image/jpeg,image/png,image/webp" :multiple="config.multiple" :disabled="disabled || uploading" @change="select" /></label>
    <label>Take a photo <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" :disabled="disabled || uploading" @change="select" /></label>
    <p v-if="error" role="alert">{{ error }}</p>
    <ul><li v-for="item in items" :key="item.uploadId"><img :src="item.preview" :alt="item.file.name" /><span>{{ item.file.name }} — {{ item.id ? 'Attached' : item.error || 'Ready to upload' }}</span><button v-if="!item.id" :disabled="disabled || uploading" @click="remove(item)">Remove</button></li></ul>
  </div>
</template>
<style scoped>
label{display:block;margin:12px 0}input{max-width:100%}ul{list-style:none;padding:0}li{display:flex;align-items:center;gap:12px;padding:8px 0;overflow-wrap:anywhere}img{width:70px;height:70px;object-fit:contain}span{flex:1}p[role=alert]{color:#b42318}
</style>
