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

type NavMenuOption = MenuOption & { formName?: string; routeTo?: string };

function itemToOption(item: MenuItemType, parentKey: string, appName: string): NavMenuOption {
  // use `||` (not `??`) so an empty-string form/route (saved by the Designer for group-only
  // items with no form selected) falls through to the label instead of colliding on ""
  const key = `${parentKey}:${item.route || item.form || item.label || 'sub'}`;
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
      key,
      routeTo: to,
      label: () =>
        h(RouterLink, { to }, { default: () => item.label ?? to }),
    };
  }
  return {
    key,
    formName: item.form,
    label: () =>
      h(RouterLink, { to: `/app/${appName}/form/${item.form}` }, { default: () => item.label ?? item.form ?? '' }),
  };
}

/** Walk the option tree to find the key of the node matching the active route (by form or route target). */
function findActiveKey(options: NavMenuOption[], formName: string, routeTo: string): string | undefined {
  for (const opt of options) {
    if ((formName && opt.formName === formName) || (routeTo && opt.routeTo === routeTo)) {
      return opt.key as string;
    }
    const children = opt.children as NavMenuOption[] | undefined;
    if (children) {
      const found = findActiveKey(children, formName, routeTo);
      if (found) return found;
    }
  }
  return undefined;
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

const activeKey = computed(() => {
  const formName = (route.params.formName as string) ?? '';
  const routeTo = route.path;
  return findActiveKey(menuOptions.value, formName, routeTo) ?? '';
});
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
