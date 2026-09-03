<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { NAlert, NButton, NCard, NCode, NEmpty, NSelect, NSpace, NSpin, NTag, useDialog, useMessage } from 'naive-ui';
import { useRouter } from 'vue-router';
import { api, ApiError } from '../../api';

interface Proposal {
  id: string; tokenName: string; status: string; createdAt: string; reviewedAt?: string; reviewedBy?: string;
  changeSet: { description?: string };
  preview: { baseRevision: string; nextRevision: string; diff: { op: string; kind: string; name: string; highRisk?: boolean }[]; schemaEffects: { type: string; target: string }[] };
}
const router = useRouter(); const message = useMessage(); const dialog = useDialog();
const proposals = ref<Proposal[]>([]); const loading = ref(false);
const status = ref('all'); const expandedIds = ref(new Set<string>()); const initialized = ref(false);
const statusOptions = [
  { label: 'All proposals', value: 'all' }, { label: 'Pending', value: 'pending' },
  { label: 'Approved', value: 'approved' }, { label: 'Rejected', value: 'rejected' },
];
const visibleProposals = computed(() => status.value === 'all' ? proposals.value : proposals.value.filter((proposal) => proposal.status === status.value));
async function load() {
  loading.value = true;
  try {
    proposals.value = (await api.get<{ data: Proposal[] }>('/api/designer/ai-proposals')).data;
    const known = new Set(proposals.value.map((proposal) => proposal.id));
    if (!initialized.value) { expandedIds.value = new Set(proposals.value.filter((proposal) => proposal.status === 'pending').map((proposal) => proposal.id)); initialized.value = true; }
    else expandedIds.value = new Set([...expandedIds.value].filter((id) => known.has(id)));
  } catch (error) { message.error(error instanceof ApiError ? error.message : 'AI proposals could not be loaded'); }
  finally { loading.value = false; }
}
function isExpanded(id: string) { return expandedIds.value.has(id); }
function toggle(id: string) { const next = new Set(expandedIds.value); if (next.has(id)) next.delete(id); else next.add(id); expandedIds.value = next; }
function expandVisible() { expandedIds.value = new Set([...expandedIds.value, ...visibleProposals.value.map((proposal) => proposal.id)]); }
function collapseVisible() { const visible = new Set(visibleProposals.value.map((proposal) => proposal.id)); expandedIds.value = new Set([...expandedIds.value].filter((id) => !visible.has(id))); }
function approve(proposal: Proposal) {
  dialog.warning({ title: 'Apply AI proposal?', content: `${proposal.preview.diff.length} artifact change(s) will be revalidated and applied atomically.`, positiveText: 'Approve and apply', negativeText: 'Cancel', onPositiveClick: async () => {
    try { await api.post(`/api/designer/ai-proposals/${encodeURIComponent(proposal.id)}/approve`); await load(); message.success('AI proposal applied'); }
    catch (error) { message.error(error instanceof ApiError ? error.message : 'Proposal could not be applied'); }
  } });
}
async function reject(proposal: Proposal) { try { await api.post(`/api/designer/ai-proposals/${encodeURIComponent(proposal.id)}/reject`); await load(); message.success('Proposal rejected'); } catch (error) { message.error(error instanceof ApiError ? error.message : 'Proposal could not be rejected'); } }
function remove(proposal: Proposal) {
  dialog.warning({ title: 'Delete reviewed proposal?', content: 'This removes the proposal from the Inbox. Applied metadata and AI audit records are not removed.', positiveText: 'Delete', negativeText: 'Cancel', onPositiveClick: async () => {
    try { await api.delete(`/api/designer/ai-proposals/${encodeURIComponent(proposal.id)}`); await load(); message.success('Proposal deleted'); }
    catch (error) { message.error(error instanceof ApiError ? error.message : 'Proposal could not be deleted'); }
  } });
}
onMounted(load);
</script>

<template>
  <div class="proposal-page">
    <n-space justify="space-between" align="center"><div><h1>AI Proposal Inbox</h1><p>AI tokens can propose metadata, but only a user with Customize access can apply it.</p></div><n-button @click="router.push('/designer?mode=advanced')">Back to Designer</n-button></n-space>
    <n-alert type="info" style="margin-bottom:16px">Every approval revalidates the workspace revision. AI tokens cannot apply proposals or read business records.</n-alert>
    <n-space class="inbox-toolbar" justify="space-between" align="center">
      <n-select v-model:value="status" :options="statusOptions" style="width:180px" />
      <n-space><n-button :loading="loading" @click="load">Refresh</n-button><n-button @click="expandVisible">Expand all</n-button><n-button @click="collapseVisible">Collapse all</n-button></n-space>
    </n-space>
    <n-spin :show="loading">
      <n-empty v-if="!visibleProposals.length" :description="proposals.length ? 'No proposals match this status' : 'No AI proposals'" />
      <n-card v-for="proposal in visibleProposals" :key="proposal.id" size="small" class="proposal-card">
        <n-space justify="space-between" align="center">
          <button class="proposal-heading" type="button" :aria-expanded="isExpanded(proposal.id)" @click="toggle(proposal.id)">
            <span class="disclosure">{{ isExpanded(proposal.id) ? '▾' : '▸' }}</span><span><strong>{{ proposal.changeSet.description || proposal.id }}</strong><span class="muted">{{ proposal.tokenName }} · {{ proposal.createdAt }}</span></span>
          </button>
          <n-space align="center"><n-tag :type="proposal.status === 'pending' ? 'warning' : proposal.status === 'approved' ? 'success' : 'default'">{{ proposal.status }}</n-tag><n-button size="small" @click="toggle(proposal.id)">{{ isExpanded(proposal.id) ? 'Collapse' : 'Expand' }}</n-button></n-space>
        </n-space>
        <div v-if="isExpanded(proposal.id)" class="proposal-body">
          <div class="diff"><div v-for="item in proposal.preview.diff" :key="`${item.kind}:${item.name}`"><n-tag size="small">{{ item.op }}</n-tag> {{ item.kind }} · {{ item.name }} <strong v-if="item.highRisk">executable</strong></div></div>
          <details><summary>ChangeSet JSON</summary><n-code :code="JSON.stringify(proposal, null, 2)" language="json" word-wrap /></details>
          <n-space justify="end" style="margin-top:12px"><template v-if="proposal.status === 'pending'"><n-button @click="reject(proposal)">Reject</n-button><n-button type="primary" @click="approve(proposal)">Approve</n-button></template><n-button v-else type="error" secondary @click="remove(proposal)">Delete</n-button></n-space>
        </div>
      </n-card>
    </n-spin>
  </div>
</template>

<style scoped>.proposal-page{max-width:1000px;margin:0 auto}.proposal-page h1{margin:0}.proposal-page p,.muted{color:var(--emu-muted)}.inbox-toolbar{margin-bottom:14px}.proposal-card{margin-bottom:12px}.proposal-heading{display:flex;align-items:flex-start;gap:8px;min-width:0;padding:4px 0;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer}.proposal-heading>span:last-child{display:grid;gap:3px}.disclosure{font-size:18px;line-height:1}.muted{font-size:12px;font-weight:400}.proposal-body{padding-top:4px}.diff{margin:14px 0;display:grid;gap:6px}summary{cursor:pointer;margin-bottom:8px}@media(max-width:640px){.inbox-toolbar{align-items:stretch!important}.inbox-toolbar,.inbox-toolbar>.n-space{display:grid!important}.inbox-toolbar :deep(.n-select){width:100%!important}.proposal-card :deep(.n-space){flex-wrap:wrap!important}}</style>
