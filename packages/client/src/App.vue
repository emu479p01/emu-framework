<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  NButton, NConfigProvider, NDialogProvider, NDrawer, NDrawerContent, NDropdown,
  NLayout, NLayoutContent, NLayoutHeader, NLayoutSider, NMenu, NMessageProvider,
  type GlobalThemeOverrides,
} from 'naive-ui';
import { useSession } from './stores/session';
import { useMeta } from './stores/meta';
import { t } from './i18n';
import { buildNavigationOptions, findActiveKey, type NavMenuOption } from './navigation';

const session = useSession();
const meta = useMeta();
const route = useRoute();
const router = useRouter();
const mobile = ref(false);
const drawerOpen = ref(false);
const siderCollapsed = ref(false);
const selectedNavRoot = ref<string | null>(null);
const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#4f46e5', primaryColorHover: '#4338ca', primaryColorPressed: '#3730a3',
    borderRadius: '10px', fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  Button: { borderRadiusMedium: '9px', heightMedium: '38px', fontWeight: '600' },
  Card: { borderRadius: '14px' },
  DataTable: { thColor: '#f8fafc', thTextColor: '#475569', tdColorHover: '#f8fafc' },
};

const menuOptions = computed<NavMenuOption[]>(() => {
  return buildNavigationOptions({
    isFrameworkUser: session.isFrameworkUser,
    settingsLabel: t('nav.settings'),
    frameworkMenus: meta.frameworkMenus,
    apps: meta.apps,
    onNavigate: () => {
      drawerOpen.value = false;
      selectedNavRoot.value = null;
    },
  });
});
const activeKey = computed(() => findActiveKey(menuOptions.value, String(route.params.formName ?? ''), route.path) ?? '');
function containsNavKey(option: NavMenuOption, key: string): boolean {
  return option.key === key || ((option.children ?? []) as NavMenuOption[]).some((child) => containsNavKey(child, key));
}
const activeNavRoot = computed(() => menuOptions.value.find((option) => containsNavKey(option, activeKey.value))?.key as string | undefined);
const highlightedNavRoot = computed(() => selectedNavRoot.value ?? activeNavRoot.value ?? null);
const desktopRootOptions = computed<NavMenuOption[]>(() => menuOptions.value.map((option) => {
  const { children: _children, ...root } = option;
  return root as NavMenuOption;
}));
const desktopChildren = computed(() => (menuOptions.value.find((option) => option.key === selectedNavRoot.value)?.children ?? []) as NavMenuOption[]);
const desktopPanelTitle = computed(() => {
  if (selectedNavRoot.value === 'framework-settings') return t('nav.settings');
  const appName = String(selectedNavRoot.value ?? '').replace(/^app-/, '');
  return meta.apps.find((app) => app.name === appName)?.label ?? appName;
});
function selectNavRoot(key: string) { selectedNavRoot.value = selectedNavRoot.value === key ? null : key; }
const breadcrumb = computed(() => {
  if (route.path === '/') return t('home.title');
  if (route.path.startsWith('/designer')) return t('designer.title');
  if (route.path.startsWith('/system/maintenance')) return 'System Maintenance';
  if (route.path.startsWith('/system/fonts')) return 'Report Fonts';
  if (route.path.startsWith('/system/integrations/smtp')) return 'SMTP Settings';
  const form = meta.form(String(route.params.formName ?? ''));
  return form?.label ?? form?.name ?? t('home.title');
});
const userOptions = [{ key: 'logout', label: t('auth.logout') }];
async function onUserAction(key: string) { if (key === 'logout') { await session.logout(); router.push('/login'); } }
function updateViewport() {
  mobile.value = window.innerWidth < 900;
  if (!mobile.value) drawerOpen.value = false;
  else selectedNavRoot.value = null;
}
function onKeydown(event: KeyboardEvent) { if (event.key === 'Escape') selectedNavRoot.value = null; }
function addOverflowTitle(event: Event) {
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('.n-menu-item-content-header,.n-base-select-option__content');
  if (target && !target.title) target.title = target.textContent?.trim() ?? '';
}
onMounted(() => { updateViewport(); window.addEventListener('resize', updateViewport); window.addEventListener('keydown', onKeydown); document.addEventListener('mouseover', addOverflowTitle); });
onBeforeUnmount(() => { window.removeEventListener('resize', updateViewport); window.removeEventListener('keydown', onKeydown); document.removeEventListener('mouseover', addOverflowTitle); });
</script>

<template>
  <n-config-provider :theme-overrides="themeOverrides">
    <n-message-provider><n-dialog-provider>
      <template v-if="session.user">
        <n-layout has-sider class="app-shell">
          <n-layout-sider v-if="!mobile" class="app-sider" bordered collapse-mode="width" :collapsed="siderCollapsed" :collapsed-width="72" :width="264">
            <div class="brand" :class="{ compact: siderCollapsed }">
              <img src="/logo.svg" alt="" width="28" height="28" />
              <span v-if="!siderCollapsed">{{ meta.meta?.branding.title ?? 'EmuFramework' }}</span>
            </div>
            <div class="sider-navigation">
              <n-menu class="app-menu root-menu" :options="desktopRootOptions" :value="highlightedNavRoot" :collapsed="siderCollapsed" :collapsed-width="72" inverted @update:value="selectNavRoot" />
            </div>
          </n-layout-sider>
          <div v-if="!mobile && desktopChildren.length" class="nav-overlay-backdrop" :style="{ left: siderCollapsed ? '72px' : '264px' }" @click="selectedNavRoot = null"></div>
          <aside v-if="!mobile && desktopChildren.length" class="nav-panel" :style="{ left: siderCollapsed ? '72px' : '264px' }" aria-label="Secondary navigation">
            <div class="nav-panel-header"><strong>{{ desktopPanelTitle }}</strong><n-button quaternary circle size="small" aria-label="Close submenu" @click="selectedNavRoot = null">×</n-button></div>
            <n-menu class="nav-panel-menu" :options="desktopChildren" :value="activeKey" :default-expanded-keys="desktopChildren.map((item) => item.key as string)" />
          </aside>
          <n-drawer v-model:show="drawerOpen" placement="left" :width="280">
            <n-drawer-content :title="meta.meta?.branding.title ?? 'EmuFramework'" closable body-content-style="padding:0">
              <n-menu :options="menuOptions" :value="activeKey" :default-expanded-keys="menuOptions.map((item) => item.key as string)" />
            </n-drawer-content>
          </n-drawer>
          <n-layout class="main-layout">
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
:root { color-scheme:light; --emu-bg:#f5f7fb; --emu-surface:#fff; --emu-border:#e2e8f0; --emu-text:#152033; --emu-muted:#64748b; --emu-primary:#4f46e5; --emu-radius-lg:14px; --emu-shadow-sm:0 1px 3px rgba(15,23,42,.06),0 8px 24px rgba(15,23,42,.04); }
* { box-sizing:border-box; }
body { margin:0; color:var(--emu-text); background:var(--emu-bg); font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; -webkit-font-smoothing:antialiased; }
.app-shell { height:100vh; height:100dvh; min-height:0; overflow:hidden; }
.app-shell > .n-layout-scroll-container,.main-layout > .n-layout-scroll-container{overflow:hidden}
.main-layout { height:100%; min-width:0; }
.main-layout > .n-layout-scroll-container{display:flex;flex-direction:column}
.app-sider { background:linear-gradient(180deg,#111827 0%,#172033 100%)!important; }
.brand { height:68px; display:flex; align-items:center; gap:11px; padding:0 20px; font-weight:750; font-size:16px; overflow:hidden; white-space:nowrap; color:#fff;letter-spacing:-.02em;border-bottom:1px solid rgba(255,255,255,.08) }
.brand img{filter:drop-shadow(0 4px 10px rgba(99,102,241,.35))}.sider-navigation{height:calc(100vh - 68px);display:flex;flex-direction:column;min-height:0}.app-menu{padding:12px 8px;overflow:auto;flex:1;min-height:0}.app-menu .n-menu-item-content{border-radius:8px;padding-left:10px!important}.app-menu .n-menu-item-content-header{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nav-icon{width:24px;height:24px;display:inline-grid;place-items:center;flex:0 0 24px}.nav-monogram{border-radius:7px;background:rgba(99,102,241,.24);color:#c7d2fe;font-size:12px;font-weight:800}.n-menu--collapsed .nav-icon{width:32px;height:32px}.n-menu--collapsed .nav-monogram{border-radius:9px}.nav-overlay-backdrop{position:fixed;inset:0 0 0 auto;right:0;background:rgba(15,23,42,.16);z-index:8}.nav-panel{position:fixed;top:0;bottom:0;width:304px;background:#fff;box-shadow:8px 0 32px rgba(15,23,42,.2);z-index:9;transition:left .2s ease}.nav-panel-header{height:68px;padding:0 14px 0 20px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--emu-border);font-size:15px}.nav-panel-menu{height:calc(100vh - 68px);overflow:auto;padding:12px 8px}.nav-panel-menu .n-menu-item-content{border-radius:8px}
.brand.compact { justify-content:center; padding:0; }
.topbar { height:68px; flex:0 0 68px; padding:0 28px; display:flex; align-items:center; gap:12px; background:rgba(255,255,255,.92);backdrop-filter:blur(12px);box-shadow:0 1px 0 rgba(15,23,42,.06); }
.page-context { flex:1; min-width:0; }
.crumb { font-size:14px; font-weight:700;letter-spacing:-.01em; }
.user-button { max-width:220px; }
.page-content { flex:1 1 auto; min-height:0; overflow-x:hidden; overflow-y:auto; padding:32px; background:radial-gradient(circle at 100% 0,rgba(99,102,241,.055),transparent 28%),var(--emu-bg); }
:focus-visible { outline:3px solid rgba(79,70,229,.45) !important; outline-offset:2px; }
@media (max-width:899px) { .topbar{padding:0 10px;gap:8px}.page-content{padding:16px 10px}.user-button{max-width:130px;min-width:0}.user-button .n-button__content{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.crumb{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.n-modal{max-width:calc(100vw - 16px)} }
@media (max-width:380px) { .topbar{height:60px;flex-basis:60px}.page-content{padding:12px 8px}.user-button{max-width:108px} }
</style>
