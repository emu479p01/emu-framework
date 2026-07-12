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
    onNavigate: () => (drawerOpen.value = false),
  });
});
const appMenuOptions = computed(() => menuOptions.value.filter((option) => option.key !== 'framework-settings'));
const frameworkMenuOptions = computed(() => menuOptions.value.filter((option) => option.key === 'framework-settings'));
const activeKey = computed(() => findActiveKey(menuOptions.value, String(route.params.formName ?? ''), route.path) ?? '');
const breadcrumb = computed(() => {
  if (route.path === '/') return t('home.title');
  if (route.path.startsWith('/designer')) return t('designer.title');
  if (route.path.startsWith('/system/maintenance')) return 'System Maintenance';
  if (route.path.startsWith('/system/fonts')) return 'Report Fonts';
  const form = meta.form(String(route.params.formName ?? ''));
  return form?.label ?? form?.name ?? t('home.title');
});
const userOptions = [{ key: 'logout', label: t('auth.logout') }];
async function onUserAction(key: string) { if (key === 'logout') { await session.logout(); router.push('/login'); } }
function updateViewport() { mobile.value = window.innerWidth < 900; if (!mobile.value) drawerOpen.value = false; }
function addOverflowTitle(event: Event) {
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('.n-menu-item-content-header,.n-base-select-option__content');
  if (target && !target.title) target.title = target.textContent?.trim() ?? '';
}
onMounted(() => { updateViewport(); window.addEventListener('resize', updateViewport); document.addEventListener('mouseover', addOverflowTitle); });
onBeforeUnmount(() => { window.removeEventListener('resize', updateViewport); document.removeEventListener('mouseover', addOverflowTitle); });
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
              <n-menu class="app-menu" :options="appMenuOptions" :value="activeKey" :collapsed="siderCollapsed" :collapsed-width="72" :default-expanded-keys="appMenuOptions.map((item) => item.key as string)" inverted />
              <n-menu v-if="frameworkMenuOptions.length" class="framework-menu" :options="frameworkMenuOptions" :value="activeKey" :collapsed="siderCollapsed" :collapsed-width="72" :default-expanded-keys="frameworkMenuOptions.map((item) => item.key as string)" inverted />
            </div>
          </n-layout-sider>
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
.brand img{filter:drop-shadow(0 4px 10px rgba(99,102,241,.35))}.sider-navigation{height:calc(100vh - 68px);display:flex;flex-direction:column;min-height:0}.app-menu{padding:12px 8px;overflow:auto;flex:1;min-height:0}.framework-menu{padding:12px 8px 16px;border-top:1px solid rgba(255,255,255,.14);flex:0 0 auto}.app-menu .n-menu-item-content,.framework-menu .n-menu-item-content{border-radius:8px;padding-left:10px!important}.app-menu .n-menu-item-content-header,.framework-menu .n-menu-item-content-header{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nav-icon{width:24px;height:24px;display:inline-grid;place-items:center;flex:0 0 24px}.nav-monogram{border-radius:7px;background:rgba(99,102,241,.24);color:#c7d2fe;font-size:12px;font-weight:800}.n-menu--collapsed .nav-icon{width:32px;height:32px}.n-menu--collapsed .nav-monogram{border-radius:9px}
.brand.compact { justify-content:center; padding:0; }
.topbar { height:68px; flex:0 0 68px; padding:0 28px; display:flex; align-items:center; gap:12px; background:rgba(255,255,255,.92);backdrop-filter:blur(12px);box-shadow:0 1px 0 rgba(15,23,42,.06); }
.page-context { flex:1; min-width:0; }
.crumb { font-size:14px; font-weight:700;letter-spacing:-.01em; }
.user-button { max-width:220px; }
.page-content { flex:1 1 auto; min-height:0; overflow-x:hidden; overflow-y:auto; padding:32px; background:radial-gradient(circle at 100% 0,rgba(99,102,241,.055),transparent 28%),var(--emu-bg); }
:focus-visible { outline:3px solid rgba(79,70,229,.45) !important; outline-offset:2px; }
@media (max-width:899px) { .topbar{padding:0 14px}.page-content{padding:18px 14px}.user-button{max-width:145px} }
</style>
