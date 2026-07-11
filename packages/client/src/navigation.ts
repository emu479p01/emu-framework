import { h, type VNodeChild } from 'vue';
import { RouterLink } from 'vue-router';
import type { IconName, MenuItemMeta, MenuMeta } from '@emu/core';
import type { MenuOption } from 'naive-ui';

export type NavMenuOption = MenuOption & { formName?: string; routeTo?: string };
export interface NavigationApp {
  name: string;
  label: string;
  icon?: IconName;
  menus: MenuMeta[];
}

export const ICON_OPTIONS: { label: string; value: IconName }[] = [
  ['App', 'app'], ['Grid', 'grid'], ['Users', 'users'], ['Settings', 'settings'], ['Database', 'database'],
  ['Table', 'table'], ['Chart', 'chart'], ['Shield', 'shield'], ['Tools', 'wrench'], ['File', 'file'],
].map(([label, value]) => ({ label, value: value as IconName }));

const PATHS: Record<IconName, string> = {
  app: 'M4 5.5 12 2l8 3.5v13L12 22l-8-3.5v-13ZM8 9h8M8 13h8M8 17h5',
  grid: 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.4-3.5a7 7 0 0 0-.1-1l2-1.55-2-3.46-2.45 1a7.4 7.4 0 0 0-1.75-1L14.75 3h-4l-.35 2.99a7.4 7.4 0 0 0-1.75 1l-2.45-1-2 3.46 2 1.55a7 7 0 0 0 0 2l-2 1.55 2 3.46 2.45-1a7.4 7.4 0 0 0 1.75 1l.35 2.99h4l.35-2.99a7.4 7.4 0 0 0 1.75-1l2.45 1 2-3.46-2-1.55a7 7 0 0 0 .1-1Z',
  database: 'M20 5c0 1.66-3.58 3-8 3S4 6.66 4 5s3.58-3 8-3 8 1.34 8 3ZM4 5v7c0 1.66 3.58 3 8 3s8-1.34 8-3V5M4 12v7c0 1.66 3.58 3 8 3s8-1.34 8-3v-7',
  table: 'M3 4h18v16H3V4Zm0 5h18M9 4v16',
  chart: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Zm-3-10 2 2 4-4',
  wrench: 'M14.7 6.3a4 4 0 0 0-5-5L12 3.6 9.6 6 7.3 3.7a4 4 0 0 0 5 5L4 17a2.1 2.1 0 0 0 3 3l8.3-8.3a4 4 0 0 0 5-5L18 9l-3-2.7Z',
  file: 'M6 2h8l4 4v16H6V2Zm8 0v5h5M9 12h6M9 16h6',
};

export function iconForItem(item: MenuItemMeta): IconName {
  if (item.icon) return item.icon;
  if (item.items?.length) return 'grid';
  const target = `${item.route ?? ''} ${item.form ?? ''}`.toLowerCase();
  if (target.includes('maintenance')) return 'database';
  if (target.includes('designer')) return 'wrench';
  if (target.includes('user')) return 'users';
  return item.form ? 'table' : 'file';
}

export function renderIcon(icon: IconName, label?: string): () => VNodeChild {
  return () => h('span', { class: 'nav-icon', 'aria-hidden': 'true', title: label }, [
    h('svg', { viewBox: '0 0 24 24', width: '18', height: '18', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [
      h('path', { d: PATHS[icon] }),
    ]),
  ]);
}

export function renderAppIcon(app: NavigationApp): () => VNodeChild {
  if (app.icon) return renderIcon(app.icon, app.label);
  const initial = (app.label || app.name).trim().slice(0, 1).toUpperCase() || 'A';
  return () => h('span', { class: 'nav-icon nav-monogram', 'aria-hidden': 'true', title: app.label }, initial);
}

export function itemToOption(item: MenuItemMeta, parentKey: string, appName: string, onNavigate: () => void): NavMenuOption {
  const key = `${parentKey}:${item.route || item.form || item.label || 'sub'}`;
  const icon = renderIcon(iconForItem(item), item.label);
  if (item.items?.length) {
    return { label: item.label ?? '', key, icon, children: item.items.map((child) => itemToOption(child, key, appName, onNavigate)) };
  }
  const to = item.route || `/app/${appName}/form/${item.form}`;
  return {
    key, routeTo: item.route, formName: item.form, icon,
    label: () => h(RouterLink, { to, onClick: onNavigate }, { default: () => item.label ?? item.form ?? to }),
  };
}

export function buildNavigationOptions(input: {
  isFrameworkUser: boolean;
  settingsLabel: string;
  frameworkMenus: MenuMeta[];
  apps: NavigationApp[];
  onNavigate: () => void;
}): NavMenuOption[] {
  const options: NavMenuOption[] = [];
  if (input.isFrameworkUser && input.frameworkMenus.length) {
    options.push({
      label: input.settingsLabel, key: 'framework-settings', icon: renderIcon('settings', input.settingsLabel),
      children: input.frameworkMenus.flatMap((menu) => menu.items.map((item) => itemToOption(item, `fw-${menu.name}`, 'system', input.onNavigate))),
    });
  }
  options.push(...input.apps.map((app) => ({
    label: app.label, key: `app-${app.name}`, icon: renderAppIcon(app),
    children: app.menus.flatMap((menu) => menu.items.map((item) => itemToOption(item, `app-${app.name}`, app.name, input.onNavigate))),
  })));
  return options;
}

export function findActiveKey(options: NavMenuOption[], formName: string, path: string): string | undefined {
  for (const option of options) {
    if ((formName && option.formName === formName) || option.routeTo === path) return option.key as string;
    const found = option.children && findActiveKey(option.children as NavMenuOption[], formName, path);
    if (found) return found;
  }
}
