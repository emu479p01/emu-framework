<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { NAlert, NButton, NCard } from 'naive-ui';
import { api, ApiError } from '../api';

const props = defineProps<{ name: string }>();
const router = useRouter();
const route = useRoute();
const busy = ref(false);
const error = ref('');
const result = ref<unknown>();
const args = computed<Record<string, string>>(() => {
  const output: Record<string, string> = {};
  for (const [key, raw] of Object.entries(route.query)) {
    if (!key.startsWith('arg.') || key.length === 4 || raw === null || raw === undefined) continue;
    const value = Array.isArray(raw) ? raw.at(-1) : raw;
    if (value !== null && value !== undefined) output[key.slice(4)] = String(value);
  }
  return output;
});
async function run() {
  busy.value = true; error.value = ''; result.value = undefined;
  try { result.value = await api.post(`/api/action/${encodeURIComponent(props.name)}`, args.value); }
  catch (e) { error.value = e instanceof ApiError ? e.message : String(e); }
  finally { busy.value = false; }
}
function back() { window.history.length > 1 ? router.back() : router.push('/'); }
</script>
<template>
  <n-card :title="name" style="max-width:720px;margin:auto">
    <n-alert v-if="error" type="error" title="Function failed">{{ error }}</n-alert>
    <n-alert v-else-if="result !== undefined" type="success" title="Function completed"><pre>{{ JSON.stringify(result, null, 2) }}</pre></n-alert>
    <template v-else>
      <n-alert type="info" title="Confirm function">Review the arguments below, then confirm to run this server function.</n-alert>
      <pre class="function-args">{{ JSON.stringify(args, null, 2) }}</pre>
    </template>
    <div class="function-actions"><n-button @click="back">Back</n-button><n-button v-if="result === undefined" type="primary" :loading="busy" @click="run">Run function</n-button></div>
  </n-card>
</template>
<style scoped>.function-args{padding:14px;margin:14px 0 0;background:#f8fafc;border:1px solid var(--emu-border);border-radius:8px;white-space:pre-wrap;overflow-wrap:anywhere}.function-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}</style>
