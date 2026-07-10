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
  <div>
    <div class="home-heading"><div><h1>{{ t('home.title') }}</h1><p>Choose an app to continue your work.</p></div></div>
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
          <n-card hoverable size="medium" :title="app.label">
            <template v-if="app.modules && app.modules.length > 0">
              {{ app.modules.join(', ') }}
            </template>
            <template v-else>
              {{ app.menus.length }} menu(s)
            </template>
          </n-card>
        </router-link>
      </n-grid-item>
    </n-grid>
  </div>
</template>

<style scoped>
.home-heading h1{margin:0;font-size:28px}.home-heading p{margin:6px 0 24px;color:var(--emu-muted)}
.onboarding-card{max-width:760px;margin:40px auto;padding:36px 20px;text-align:center}.onboarding-card h2{margin:8px 0 20px}
</style>
