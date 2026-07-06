<script setup lang="ts">
import { computed } from 'vue';
import { NCard, NGrid, NGridItem, NEmpty } from 'naive-ui';
import { RouterLink } from 'vue-router';
import { useMeta } from '../stores/meta';

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
    <h2>Apps</h2>
    <n-empty v-if="appCards.length === 0" description="No apps available. Contact your administrator." />
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
