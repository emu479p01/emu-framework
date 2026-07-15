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
<template>
  <div class="table-browser">
    <div class="table-browser-heading"><h2>Table Browser</h2><n-button @click="back">Back</n-button></div>
    <n-card>
      <div class="table-browser-tools"><n-select v-model:value="tableName" :options="tableOptions" filterable placeholder="Business table"/><n-input v-model:value="search" placeholder="Search" @keyup.enter="load"/><n-button @click="load">Search</n-button><n-button :disabled="!table" @click="editing = {}">New</n-button></div>
      <n-data-table class="table-browser-desktop" :columns="columns" :data="rows" :row-key="(r: Row) => r.id" />
      <div class="table-browser-mobile">
        <button v-for="row in rows" :key="row.id" class="table-browser-record" @click="editing = { ...row }"><span><small>ID</small>{{ row.id }}</span><span v-for="field in table?.fields" :key="field.name"><small>{{ field.label ?? field.name }}</small>{{ row[field.name] ?? '—' }}</span><strong>Edit</strong></button>
        <div v-if="!rows.length" class="table-browser-empty">No data</div>
      </div>
    </n-card>
    <n-modal :show="editing !== null" preset="card" :title="editing?.id ? `Edit #${editing.id}` : 'New record'" class="table-editor-modal" style="width:min(700px,95vw)" @update:show="(v) => { if (!v) editing = null }">
      <template v-if="editing && table"><div v-for="field in table.fields" :key="field.name" class="table-editor-field"><label>{{ field.label ?? field.name }}</label><FieldControl :field="field" :model-value="editing[field.name]" :create-mode="!editing.id" @update:model-value="(v) => editing![field.name] = v" /></div><n-space class="table-editor-actions" justify="end"><n-button v-if="editing.id" type="error" quaternary @click="remove">Delete</n-button><n-button @click="editing = null">Cancel</n-button><n-button type="primary" @click="save">Save</n-button></n-space></template>
    </n-modal>
  </div>
</template>

<style scoped>
.table-browser-heading{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}.table-browser-heading h2{margin:0}.table-browser-tools{display:grid;grid-template-columns:280px minmax(180px,260px) auto auto;gap:8px}.table-browser-desktop{margin-top:16px}.table-browser-mobile{display:none}.table-editor-field{margin-bottom:12px}.table-editor-field label{display:block;margin-bottom:5px}.table-browser-record{display:block;width:100%;padding:14px;border:1px solid var(--emu-border);border-radius:12px;background:#fff;text-align:left}.table-browser-record+.table-browser-record{margin-top:10px}.table-browser-record span{display:block;margin-bottom:9px;overflow-wrap:anywhere}.table-browser-record small{display:block;color:var(--emu-muted);font-size:11px;font-weight:700}.table-browser-record strong{color:var(--emu-primary)}.table-browser-empty{text-align:center;color:var(--emu-muted);padding:30px}
@media(max-width:700px){.table-browser-tools{grid-template-columns:1fr}.table-browser-tools :deep(.n-button){min-height:44px}.table-browser-desktop{display:none}.table-browser-mobile{display:block;margin-top:16px}.table-editor-modal{width:calc(100vw - 16px)!important}.table-editor-actions{display:grid!important;grid-template-columns:repeat(3,1fr)}.table-editor-actions :deep(.n-button){min-height:44px}}
</style>
