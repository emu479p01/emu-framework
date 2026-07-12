<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { NAlert, NButton, NCard, NSpin } from 'naive-ui';
import { api, ApiError } from '../api';

const props = defineProps<{ name: string }>();
const router = useRouter();
const busy = ref(true);
const error = ref('');
const result = ref<unknown>();
onMounted(async () => {
  try { result.value = await api.post(`/api/action/${encodeURIComponent(props.name)}`, {}); }
  catch (e) { error.value = e instanceof ApiError ? e.message : String(e); }
  finally { busy.value = false; }
});
function back() { window.history.length > 1 ? router.back() : router.push('/'); }
</script>
<template><n-card :title="name" style="max-width:720px;margin:auto"><n-spin v-if="busy" /><n-alert v-else-if="error" type="error" title="Action failed">{{ error }}</n-alert><n-alert v-else type="success" title="Action completed"><pre v-if="result">{{ JSON.stringify(result, null, 2) }}</pre></n-alert><n-button style="margin-top:16px" @click="back">Back</n-button></n-card></template>
