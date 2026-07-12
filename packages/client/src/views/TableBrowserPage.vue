<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import { NButton, NCard, NDataTable, NInput, NModal, NSelect, NSpace, useDialog, useMessage } from 'naive-ui';
import { useRouter } from 'vue-router';
import { api, ApiError, type Row } from '../api';
import { useMeta } from '../stores/meta';
import FieldControl from '../components/FieldControl.vue';
const meta = useMeta(); const router = useRouter(); const message = useMessage(); const dialog = useDialog();
const tableName = ref(''); const rows = ref<Row[]>([]); const search = ref(''); const editing = ref<Record<string, unknown> | null>(null);
const table = computed(() => meta.table(tableName.value));
const tableOptions = computed(() => (meta.meta?.tables ?? []).filter((t) => !t.name.startsWith('FW_')).map((t) => ({ label: t.label ?? t.name, value: t.name })));
const columns = computed(() => table.value ? [{ title: 'ID', key: 'id', width: 70 }, ...table.value.fields.map((f) => ({ title: f.label ?? f.name, key: f.name, ellipsis: { tooltip: true } })), { title: '', key: '_actions', render: (row: Row) => h(NButton, { size: 'small', onClick: () => editing.value = { ...row } }, () => 'Edit') }] : []);
async function load() { if (!tableName.value) return; const result = await api.list(tableName.value, { limit: 500, search: search.value }); rows.value = result.data; }
watch(tableName, load);
async function save() { if (!table.value || !editing.value) return; try { const id = editing.value.id; if (id) await api.patch(`/api/data/${table.value.name}/${id}`, editing.value); else await api.post(`/api/data/${table.value.name}`, editing.value); editing.value = null; await load(); message.success('Saved'); } catch (e) { message.error(e instanceof ApiError ? e.message : String(e)); } }
function remove() { if (!editing.value?.id || !table.value) return; dialog.warning({ title: 'Delete record', content: 'Delete this record?', positiveText: 'Delete', negativeText: 'Cancel', onPositiveClick: async () => { await api.delete(`/api/data/${table.value!.name}/${editing.value!.id}`); editing.value = null; await load(); } }); }
function back() { window.history.length > 1 ? router.back() : router.push('/'); }
</script>
<template><div><n-space justify="space-between" style="margin-bottom:16px"><h2 style="margin:0">Table Browser</h2><n-button @click="back">Back</n-button></n-space><n-card><n-space><n-select v-model:value="tableName" :options="tableOptions" filterable placeholder="Business table" style="width:280px"/><n-input v-model:value="search" placeholder="Search" style="width:260px" @keyup.enter="load"/><n-button @click="load">Search</n-button><n-button :disabled="!table" @click="editing = {}">New</n-button></n-space><n-data-table style="margin-top:16px" :columns="columns" :data="rows" :row-key="(r: Row) => r.id" /></n-card><n-modal :show="editing !== null" preset="card" :title="editing?.id ? `Edit #${editing.id}` : 'New record'" style="width:min(700px,95vw)" @update:show="(v) => { if (!v) editing = null }"><template v-if="editing && table"><div v-for="field in table.fields" :key="field.name" style="margin-bottom:12px"><label>{{ field.label ?? field.name }}</label><FieldControl :field="field" :model-value="editing[field.name]" :create-mode="!editing.id" @update:model-value="(v) => editing![field.name] = v" /></div><n-space justify="end"><n-button v-if="editing.id" type="error" quaternary @click="remove">Delete</n-button><n-button @click="editing = null">Cancel</n-button><n-button type="primary" @click="save">Save</n-button></n-space></template></n-modal></div></template>
