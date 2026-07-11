<script setup lang="ts">
import { computed } from 'vue';
import { NButton, NCard, NEmpty, NGrid, NGridItem } from 'naive-ui';
import { RouterLink } from 'vue-router';
import { useMeta } from '../stores/meta';
import { t } from '../i18n';

const meta = useMeta();

function firstLeaf(items: { label?: string; form?: string; items?: typeof items }[]): string | null {
  for (const item of items) {
    if (item.form) return item.form;
    if (item.items) {
      const f = firstLeaf(item.items);
      if (f) return f;
    }
  }
  return null;
}

const appCards = computed(() =>
  meta.apps.map((app) => {
    const firstForm = app.menus.flatMap((m) => m.items).length > 0
      ? firstLeaf(app.menus[0].items)
      : null;
    return { ...app, firstForm };
  }),
);
</script>

<template>
  <div class="home-page">
    <div class="home-heading"><div><span>WORKSPACE</span><h1>{{ t('home.title') }}</h1><p>Choose an app to continue your work.</p></div></div>
    <n-card v-if="appCards.length === 0" class="onboarding-card" data-testid="empty-onboarding">
      <n-empty :description="t('home.emptyDescription')">
        <template #extra>
          <h2>{{ t('home.emptyTitle') }}</h2>
          <router-link to="/designer?mode=simple"><n-button type="primary" size="large" data-testid="create-first-app">{{ t('home.create') }}</n-button></router-link>
        </template>
      </n-empty>
    </n-card>
    <n-grid v-else :cols="3" :x-gap="16" :y-gap="16">
      <n-grid-item v-for="app in appCards" :key="app.name">
        <router-link :to="app.firstForm ? `/app/${app.name}/form/${app.firstForm}` : `/app/${app.name}`" style="text-decoration: none">
          <n-card hoverable size="medium" class="workspace-card">
            <div class="app-monogram">{{ app.label.slice(0,1).toUpperCase() }}</div>
            <h3>{{ app.label }}</h3>
            <p v-if="app.modules && app.modules.length > 0">{{ app.modules.join(', ') }}</p>
            <p v-else>{{ app.menus.length }} menu{{ app.menus.length === 1 ? '' : 's' }}</p>
            <div class="open-label">Open workspace →</div>
          </n-card>
        </router-link>
      </n-grid-item>
    </n-grid>
  </div>
</template>

<style scoped>
.home-page{max-width:1120px;margin:0 auto}.home-heading span{color:var(--emu-primary);font-size:11px;font-weight:800;letter-spacing:.12em}.home-heading h1{margin:6px 0 0;font-size:32px;letter-spacing:-.04em}.home-heading p{margin:7px 0 26px;color:var(--emu-muted)}
.workspace-card{min-height:190px;border:1px solid var(--emu-border);box-shadow:var(--emu-shadow-sm);transition:transform .2s ease,box-shadow .2s ease}.workspace-card:hover{transform:translateY(-3px);box-shadow:0 16px 34px rgba(15,23,42,.1)}.app-monogram{display:grid;place-items:center;width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;font-weight:800;box-shadow:0 8px 18px rgba(79,70,229,.22)}.workspace-card h3{font-size:17px;margin:18px 0 4px}.workspace-card p{margin:0;color:var(--emu-muted);font-size:13px}.open-label{margin-top:20px;color:var(--emu-primary);font-weight:700;font-size:12px}
.onboarding-card{max-width:760px;margin:40px auto;padding:36px 20px;text-align:center}.onboarding-card h2{margin:8px 0 20px}
@media(max-width:800px){:deep(.n-grid){grid-template-columns:1fr!important}}
</style>
