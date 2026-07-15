<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { NAlert, NButton, NCard, NInput, NModal, NSelect, NSpace, NSpin, NTag, useMessage } from 'naive-ui';
import { api, ApiError } from '../api';

type Font = { family: string; builtIn?: boolean; version?: string; subsets?: string[]; variants?: string[] | Record<string, string> };
const message = useMessage();
const installed = ref<Font[]>([]); const catalog = ref<Font[]>([]); const query = ref(''); const busy = ref(false);
const showSettings = ref(false); const apiKey = ref(''); const maskedKey = ref('');
const available = computed(() => catalog.value.filter((font) => font.family.toLowerCase().includes(query.value.toLowerCase()) && !installed.value.some((item) => item.family === font.family)).slice(0, 200));
async function loadInstalled() { installed.value = (await api.get<{ fonts: Font[] }>('/api/fonts')).fonts; }
async function loadSettings() { const value = await api.get<{ configured: boolean; maskedKey: string }>('/api/system/fonts/settings'); maskedKey.value = value.maskedKey; }
async function saveSettings() { await api.put('/api/system/fonts/settings', { apiKey: apiKey.value }); apiKey.value = ''; showSettings.value = false; await loadSettings(); message.success('Google Fonts API key saved'); }
async function sync() { busy.value = true; try { catalog.value = (await api.get<{ fonts: Font[] }>('/api/system/fonts/catalog')).fonts; } catch (error) { message.error(error instanceof ApiError ? error.message : String(error)); } finally { busy.value = false; } }
async function install(family: string) { busy.value = true; try { await api.post(`/api/system/fonts/${encodeURIComponent(family)}/install`); await loadInstalled(); message.success(`${family} installed`); } catch (error) { message.error(error instanceof ApiError ? error.message : String(error)); } finally { busy.value = false; } }
async function remove(family: string) { try { await api.delete(`/api/system/fonts/${encodeURIComponent(family)}`); await loadInstalled(); message.success(`${family} removed`); } catch (error) { message.error(error instanceof ApiError ? error.message : String(error)); } }
onMounted(async () => { await Promise.all([loadInstalled(), loadSettings()]); });
</script>

<template>
  <div class="font-page">
    <n-space class="font-heading" justify="space-between" align="center"><div><h1>Report Fonts</h1><p>Install Google Fonts once, then use them offline in Report Designer and PDFs.</p></div><n-button @click="showSettings = true">API settings {{ maskedKey }}</n-button></n-space>
    <n-alert type="warning" title="API key storage">The Google Fonts API key is stored as plaintext in the system database. It is masked in this UI and never returned in full.</n-alert>
    <n-card title="Installed fonts" class="card"><n-space><n-tag v-for="font in installed" :key="font.family" size="large" :closable="!font.builtIn" @close="remove(font.family)">{{ font.family }} <small>{{ font.builtIn ? 'built-in' : font.version }}</small></n-tag></n-space></n-card>
    <n-card title="Google Fonts catalog" class="card"><n-space class="font-search"><n-input v-model:value="query" placeholder="Search font family" style="width:320px" /><n-button type="primary" :loading="busy" @click="sync">Sync catalog</n-button></n-space><n-spin :show="busy"><div class="catalog"><div v-for="font in available" :key="font.family" class="font-row"><div :style="{ fontFamily: font.family }"><strong>{{ font.family }}</strong><small>{{ font.subsets?.join(', ') }}</small></div><n-button size="small" @click="install(font.family)">Install</n-button></div></div></n-spin></n-card>
    <n-modal v-model:show="showSettings" preset="card" title="Google Fonts API" style="width:min(520px,calc(100vw - 32px))"><n-input v-model:value="apiKey" type="password" show-password-on="click" placeholder="Google Fonts Developer API key" /><n-space justify="end" style="margin-top:16px"><n-button @click="showSettings=false">Cancel</n-button><n-button type="primary" @click="saveSettings">Save</n-button></n-space></n-modal>
  </div>
</template>

<style scoped>.font-page{max-width:1100px;margin:0 auto}.font-page h1{margin:0}.font-page p{color:var(--emu-muted)}.card{margin-top:18px}.catalog{margin-top:18px;display:grid;grid-template-columns:1fr 1fr;gap:10px}.font-row{display:flex;justify-content:space-between;align-items:center;gap:12px;border:1px solid var(--emu-border);border-radius:9px;padding:12px;min-width:0}.font-row>div{min-width:0;overflow-wrap:anywhere}.font-row small{display:block;color:var(--emu-muted);margin-top:4px}@media(max-width:700px){.catalog{grid-template-columns:1fr}.font-heading{display:block!important}.font-heading :deep(.n-button){width:100%;min-height:44px}.font-search{display:grid!important;grid-template-columns:1fr}.font-search :deep(.n-input){width:100%!important}.font-search :deep(.n-button){min-height:44px}.font-row :deep(.n-button){min-height:44px}}
</style>
