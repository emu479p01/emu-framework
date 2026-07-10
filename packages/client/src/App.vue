<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import {
  NButton, NConfigProvider, NDialogProvider, NDrawer, NDrawerContent, NDropdown,
  NLayout, NLayoutContent, NLayoutHeader, NLayoutSider, NMenu, NMessageProvider,
  type MenuOption,
} from 'naive-ui';
import { useSession } from './stores/session';
import { useMeta, type MenuItem } from './stores/meta';
import { t } from './i18n';

const session = useSession();
const meta = useMeta();
const route = useRoute();
const router = useRouter();
const mobile = ref(false);
const drawerOpen = ref(false);
const siderCollapsed = ref(false);

type NavMenuOption = MenuOption & { formName?: string; routeTo?: string };
function itemToOption(item: MenuItem, parentKey: string, appName: string): NavMenuOption {
  const key = `${parentKey}:${item.route || item.form || item.label || 'sub'}`;
  if (item.items?.length) return { label: item.label ?? '', key, children: item.items.map((child) => itemToOption(child, key, appName)) };
  const to = item.route || `/app/${appName}/form/${item.form}`;
  return { key, routeTo: item.route, formName: item.form, label: () => h(RouterLink, { to, onClick: () => (drawerOpen.value = false) }, { default: () => item.label ?? item.form ?? to }) };
}
function findActiveKey(options: NavMenuOption[], formName: string, path: string): string | undefined {
  for (const option of options) {
    if ((formName && option.formName === formName) || option.routeTo === path) return option.key as string;
    const found = option.children && findActiveKey(option.children as NavMenuOption[], formName, path);
    if (found) return found;
  }
}
const menuOptions = computed<NavMenuOption[]>(() => {
  const groups: NavMenuOption[] = [];
  if (session.isFrameworkUser && meta.frameworkMenus.length) {
    groups.push({ label: t('nav.settings'), key: 'framework-settings', type: 'group', children: meta.frameworkMenus.flatMap((menu) => menu.items.map((item) => itemToOption(item, `fw-${menu.name}`, 'system'))) });
  }
  groups.push(...meta.apps.map((app) => ({
    label: app.label, key: `app-${app.name}`, type: 'group' as const,
    children: app.menus.flatMap((menu) => menu.items.map((item) => itemToOption(item, `app-${app.name}`, app.name))),
  })));
  return groups;
});
const activeKey = computed(() => findActiveKey(menuOptions.value, String(route.params.formName ?? ''), route.path) ?? '');
const breadcrumb = computed(() => {
  if (route.path === '/') return t('home.title');
  if (route.path.startsWith('/designer')) return t('designer.title');
  const form = meta.form(String(route.params.formName ?? ''));
  return form?.label ?? form?.name ?? t('home.title');
});
const userOptions = [{ key: 'logout', label: t('auth.logout') }];
async function onUserAction(key: string) { if (key === 'logout') { await session.logout(); router.push('/login'); } }
function updateViewport() { mobile.value = window.innerWidth < 900; if (!mobile.value) drawerOpen.value = false; }
onMounted(() => { updateViewport(); window.addEventListener('resize', updateViewport); });
onBeforeUnmount(() => window.removeEventListener('resize', updateViewport));
</script>

<template>
  <n-config-provider>
    <n-message-provider><n-dialog-provider>
      <template v-if="session.user">
        <n-layout has-sider class="app-shell">
          <n-layout-sider v-if="!mobile" bordered collapse-mode="width" :collapsed="siderCollapsed" :collapsed-width="68" :width="252">
            <div class="brand" :class="{ compact: siderCollapsed }">
              <img src="/logo.svg" alt="" width="28" height="28" />
              <span v-if="!siderCollapsed">{{ meta.meta?.branding.title ?? 'EmuFramework' }}</span>
            </div>
            <n-menu :options="menuOptions" :value="activeKey" :collapsed="siderCollapsed" :collapsed-width="68" :default-expanded-keys="menuOptions.map((item) => item.key as string)" />
          </n-layout-sider>
          <n-drawer v-model:show="drawerOpen" placement="left" :width="280">
            <n-drawer-content :title="meta.meta?.branding.title ?? 'EmuFramework'" closable body-content-style="padding:0">
              <n-menu :options="menuOptions" :value="activeKey" :default-expanded-keys="menuOptions.map((item) => item.key as string)" />
            </n-drawer-content>
          </n-drawer>
          <n-layout>
            <n-layout-header bordered class="topbar">
              <n-button quaternary circle :aria-label="mobile ? t('nav.openMenu') : t('nav.collapseMenu')" @click="mobile ? (drawerOpen = true) : (siderCollapsed = !siderCollapsed)">☰</n-button>
              <div class="page-context"><span class="crumb">{{ breadcrumb }}</span></div>
              <n-dropdown :options="userOptions" @select="onUserAction">
                <n-button quaternary class="user-button" data-testid="user-menu">{{ session.user.displayName }} ▾</n-button>
              </n-dropdown>
            </n-layout-header>
            <n-layout-content class="page-content"><router-view /></n-layout-content>
          </n-layout>
        </n-layout>
      </template>
      <router-view v-else />
    </n-dialog-provider></n-message-provider>
  </n-config-provider>
</template>

<style>
:root { color-scheme: light; --emu-bg:#f6f8fb; --emu-border:#e5e9f0; --emu-text:#172033; --emu-muted:#667085; }
* { box-sizing:border-box; }
body { margin:0; color:var(--emu-text); background:var(--emu-bg); font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }
.app-shell { min-height:100vh; }
.brand { height:60px; display:flex; align-items:center; gap:10px; padding:0 18px; font-weight:700; font-size:16px; overflow:hidden; white-space:nowrap; }
.brand.compact { justify-content:center; padding:0; }
.topbar { height:60px; padding:0 20px; display:flex; align-items:center; gap:12px; background:#fff; }
.page-context { flex:1; min-width:0; }
.crumb { font-size:14px; font-weight:600; }
.user-button { max-width:220px; }
.page-content { min-height:calc(100vh - 60px); padding:28px; background:var(--emu-bg); }
:focus-visible { outline:3px solid #2563eb !important; outline-offset:2px; }
@media (max-width:899px) { .topbar{padding:0 12px}.page-content{padding:16px}.user-button{max-width:145px} }
</style>
