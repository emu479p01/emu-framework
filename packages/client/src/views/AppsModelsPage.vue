<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { NAlert, NButton, NCard, NInput, NSpace, NTable, NTag, useMessage } from 'naive-ui';
import { api } from '../api';
interface Model { name: string; layer: string; source: string; revision: string | null; licenseStatus: { status: string; vendor: string | null; expiresAt: string | null; blocked: boolean } }
interface Overview { identity: { installationId: string; customer: string }; vendors: { vendor: string }[]; audit: { id: number; createdAt: string; actor: string; action: string; detail: string }[]; apps: { name: string; label?: string; dependsOn?: string[]; readOnlyReasons: string[]; models: Model[]; history: { id: number; createdAt: string; actor: string; description: string }[] }[] }
const data = ref<Overview>(); const customer = ref(''); const vendor = ref(''); const publicKey = ref(''); const busy = ref(false); const message = useMessage();
async function load() { data.value = await api.get<Overview>('/api/system/apps-models'); customer.value = data.value.identity.customer; }
async function run(task: () => Promise<unknown>) { busy.value = true; try { await task(); await load(); message.success('Saved'); } catch(e) { message.error((e as Error).message); } finally { busy.value = false; } }
function importLicense() { const input = document.createElement('input'); input.type='file'; input.accept='.json,application/json'; input.onchange=() => { const file=input.files?.[0]; if (file) void run(async () => api.post('/api/system/licenses/import', JSON.parse(await file.text()))); }; input.click(); }
onMounted(() => { void load().catch((e) => message.error(e.message)); });
</script>
<template>
  <n-space vertical size="large">
    <h1>Apps &amp; Models</h1>
    <n-card v-if="data" title="Installation & ISV licenses">
      <p>Installation ID: <code>{{ data.identity.installationId }}</code></p>
      <n-space vertical>
        <label>Customer ID <n-input v-model:value="customer" :disabled="!!data.identity.customer" placeholder="Customer ID agreed with your vendor" /></label>
        <n-button v-if="!data.identity.customer" :loading="busy" @click="run(() => api.put('/api/system/licenses/customer', { customer }))">Register customer</n-button>
        <label>Vendor ID <n-input v-model:value="vendor" placeholder="Vendor ID" /></label>
        <label>Vendor public key <n-input v-model:value="publicKey" type="textarea" placeholder="Ed25519 public key (PEM)" /></label>
        <n-space><n-button :loading="busy" @click="run(() => api.post('/api/system/licenses/vendors', { vendor, publicKey }))">Trust vendor</n-button><n-button :loading="busy" type="primary" @click="importLicense">Import / renew license</n-button></n-space>
        <p>Trusted vendors: {{ data.vendors.map(v => v.vendor).join(', ') || 'None' }}</p>
      </n-space>
    </n-card>
    <n-card v-for="app in data?.apps" :key="app.name" :title="`${app.label || app.name} (${app.name})`">
      <n-alert v-if="app.readOnlyReasons.length" type="warning">Read-only — {{ app.readOnlyReasons.join('; ') }}</n-alert>
      <p>Dependencies: {{ app.dependsOn?.join(', ') || 'None' }}</p>
      <n-table :single-line="false"><thead><tr><th>Model</th><th>Layer / Source</th><th>Revision</th><th>License / Vendor</th><th>Expires (UTC)</th></tr></thead><tbody>
        <tr v-for="model in app.models" :key="model.name"><td>{{ model.name }}</td><td>{{ model.layer }} / {{ model.source }}</td><td><code :title="model.revision || ''">{{ model.revision?.slice(0, 12) || 'File deployment' }}</code></td><td><n-tag :type="model.licenseStatus.blocked ? 'error' : model.licenseStatus.status === 'expiring' ? 'warning' : 'default'">{{ model.licenseStatus.status }}</n-tag> {{ model.licenseStatus.vendor }}</td><td>{{ model.licenseStatus.expiresAt || '—' }}</td></tr>
      </tbody></n-table>
      <details><summary>Deployment history</summary><p v-for="entry in app.history" :key="entry.id">{{ entry.createdAt }} — {{ entry.actor }} — {{ entry.description }}</p></details>
    </n-card>
    <n-card v-if="data" title="License audit"><p v-for="entry in data.audit" :key="entry.id">{{ entry.createdAt }} — {{ entry.actor }} — {{ entry.action }}: {{ entry.detail }}</p></n-card>
  </n-space>
</template>
