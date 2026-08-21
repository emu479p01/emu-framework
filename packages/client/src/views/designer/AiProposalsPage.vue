<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { NAlert, NButton, NCard, NCode, NEmpty, NSpace, NTag, useDialog, useMessage } from 'naive-ui';
import { useRouter } from 'vue-router';
import { api, ApiError } from '../../api';

interface Proposal {
  id: string; tokenName: string; status: string; createdAt: string; reviewedAt?: string; reviewedBy?: string;
  changeSet: { description?: string };
  preview: { baseRevision: string; nextRevision: string; diff: { op: string; kind: string; name: string; highRisk?: boolean }[]; schemaEffects: { type: string; target: string }[] };
}
const router = useRouter(); const message = useMessage(); const dialog = useDialog();
const proposals = ref<Proposal[]>([]); const loading = ref(false);
async function load() { loading.value = true; try { proposals.value = (await api.get<{ data: Proposal[] }>('/api/designer/ai-proposals')).data; } finally { loading.value = false; } }
function approve(proposal: Proposal) {
  dialog.warning({ title: 'Apply AI proposal?', content: `${proposal.preview.diff.length} artifact change(s) will be revalidated and applied atomically.`, positiveText: 'Approve and apply', negativeText: 'Cancel', onPositiveClick: async () => {
    try { await api.post(`/api/designer/ai-proposals/${encodeURIComponent(proposal.id)}/approve`); await load(); message.success('AI proposal applied'); }
    catch (error) { message.error(error instanceof ApiError ? error.message : 'Proposal could not be applied'); }
  } });
}
async function reject(proposal: Proposal) { try { await api.post(`/api/designer/ai-proposals/${encodeURIComponent(proposal.id)}/reject`); await load(); message.success('Proposal rejected'); } catch (error) { message.error(error instanceof ApiError ? error.message : 'Proposal could not be rejected'); } }
onMounted(load);
</script>

<template>
  <div class="proposal-page">
    <n-space justify="space-between" align="center"><div><h1>AI Proposal Inbox</h1><p>AI tokens can propose metadata, but only a user with Customize access can apply it.</p></div><n-button @click="router.push('/designer?mode=advanced')">Back to Designer</n-button></n-space>
    <n-alert type="info" style="margin-bottom:16px">Every approval revalidates the workspace revision. AI tokens cannot apply proposals or read business records.</n-alert>
    <n-empty v-if="!loading && !proposals.length" description="No AI proposals" />
    <n-card v-for="proposal in proposals" :key="proposal.id" size="small" style="margin-bottom:12px">
      <n-space justify="space-between"><div><strong>{{ proposal.changeSet.description || proposal.id }}</strong><div class="muted">{{ proposal.tokenName }} · {{ proposal.createdAt }}</div></div><n-tag :type="proposal.status === 'pending' ? 'warning' : proposal.status === 'approved' ? 'success' : 'default'">{{ proposal.status }}</n-tag></n-space>
      <div class="diff"><div v-for="item in proposal.preview.diff" :key="`${item.kind}:${item.name}`"><n-tag size="small">{{ item.op }}</n-tag> {{ item.kind }} · {{ item.name }} <strong v-if="item.highRisk">executable</strong></div></div>
      <details><summary>ChangeSet JSON</summary><n-code :code="JSON.stringify(proposal, null, 2)" language="json" word-wrap /></details>
      <n-space v-if="proposal.status === 'pending'" justify="end" style="margin-top:12px"><n-button @click="reject(proposal)">Reject</n-button><n-button type="primary" @click="approve(proposal)">Approve</n-button></n-space>
    </n-card>
  </div>
</template>

<style scoped>.proposal-page{max-width:1000px;margin:0 auto}.proposal-page h1{margin:0}.proposal-page p,.muted{color:var(--emu-muted)}.diff{margin:14px 0;display:grid;gap:6px}summary{cursor:pointer;margin-bottom:8px}</style>
