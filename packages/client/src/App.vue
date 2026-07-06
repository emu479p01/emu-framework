<script setup lang="ts">
import { computed, h } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import {
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
  NLayout,
  NLayoutSider,
  NLayoutHeader,
  NLayoutContent,
  NMenu,
  NButton,
  NText,
  NCollapse,
  NCollapseItem,
  type MenuOption,
} from 'naive-ui';
import { useSession } from './stores/session';
import { useMeta, type MenuItem as MenuItemType } from './stores/meta';

const session = useSession();
const meta = useMeta();
const route = useRoute();
const router = useRouter();

function itemToOption(item: MenuItemType, parentKey: string, appName: string): MenuOption {
  const key = `${parentKey}:${item.route ?? item.form ?? item.label ?? 'sub'}`;
  if (item.items && item.items.length > 0) {
    return {
      label: item.label ?? '',
      key,
      children: item.items.map((child) => itemToOption(child, key, appName)),
    };
  }
  if (item.route) {
    const to = item.route;
    return {
      key: to,
      label: () =>
        h(RouterLink, { to }, { default: () => item.label ?? to }),
    };
  }
  return {
    key: item.form ?? key,
    label: () =>
      h(RouterLink, { to: `/app/${appName}/form/${item.form}` }, { default: () => item.label ?? item.form ?? '' }),
  };
}

const menuOptions = computed<MenuOption[]>(() => {
  const groups: MenuOption[] = [];
  if (session.isFrameworkUser && meta.frameworkMenus.length > 0) {
    const items: MenuOption[] = [];
    for (const menu of meta.frameworkMenus) {
      for (const item of menu.items) items.push(itemToOption(item, `fw-${menu.name}`, 'system'));
    }
    groups.push({
      label: 'Settings',
      key: 'framework-settings',
      type: 'group',
      children: items,
    });
  }
  groups.push(...meta.apps.map((app) => {
    const allItems: MenuOption[] = [];
    for (const menu of app.menus) {
      for (const item of menu.items) {
        allItems.push(itemToOption(item, `app-${app.name}`, app.name));
      }
    }
    return {
      label: app.label,
      key: `app-${app.name}`,
      type: 'group',
      children: allItems,
    };
  }));
  return groups;
});

const activeKey = computed(() => (route.params.formName as string) ?? (route.params.appName as string) ?? '');
const collapsed = computed(() => meta.apps.reduce((acc, app) => {
  acc[app.name] = false;
  return acc;
}, {} as Record<string, boolean>));

async function onLogout() {
  await session.logout();
  router.push('/login');
}
</script>

<template>
  <n-config-provider>
    <n-message-provider>
      <n-dialog-provider>
        <template v-if="session.user">
          <n-layout has-sider style="height: 100vh">
            <n-layout-sider bordered :width="240">
              <div style="padding: 16px; font-weight: 600; font-size: 16px">{{ meta.meta?.branding.title ?? 'EmuFramework' }}</div>
              <n-menu
                :options="menuOptions"
                :value="activeKey"
                :default-expanded-keys="menuOptions.map((m) => m.key as string)"
              />
            </n-layout-sider>
            <n-layout>
              <n-layout-header bordered style="padding: 10px 24px; display: flex; justify-content: flex-end; align-items: center; gap: 12px">
                <n-text depth="3">{{ session.user.displayName }}</n-text>
                <n-button size="small" quaternary @click="onLogout">Logout</n-button>
              </n-layout-header>
              <n-layout-content content-style="padding: 24px">
                <router-view />
              </n-layout-content>
            </n-layout>
          </n-layout>
        </template>
        <template v-else>
          <router-view />
        </template>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>
