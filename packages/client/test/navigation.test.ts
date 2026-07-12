import { describe, expect, it, vi } from 'vitest';
import type { MenuMeta } from '@emu/core';
import { buildNavigationOptions, findActiveKey, iconForItem, type NavMenuOption } from '../src/navigation';

function allOptions(options: NavMenuOption[]): NavMenuOption[] {
  return options.flatMap((option) => [option, ...allOptions((option.children ?? []) as NavMenuOption[])]);
}

describe('sidebar navigation', () => {
  const settings: MenuMeta = {
    kind: 'menu', name: 'FW_Settings', items: [
      { label: 'Users', icon: 'users', form: 'FW_UserForm' },
      { label: 'Maintenance', route: '/system/maintenance' },
    ],
  };
  const appMenu: MenuMeta = {
    kind: 'menu', name: 'SALES_Menu', items: [
      { label: 'Sales', items: [{ label: 'Orders', form: 'SALES_OrderForm' }] },
    ],
  };

  it('builds Settings and Apps as icon-bearing submenus, never collapsed groups', () => {
    const options = buildNavigationOptions({
      isFrameworkUser: true, settingsLabel: 'Settings', frameworkMenus: [settings],
      apps: [{ name: 'sales', label: 'Sales', menus: [appMenu] }], onNavigate: vi.fn(),
    });
    expect(options.map((option) => option.key)).toEqual(['app-sales', 'framework-settings']);
    expect(options.every((option) => option.type !== 'group' && typeof option.icon === 'function')).toBe(true);
    expect(allOptions(options).every((option) => typeof option.icon === 'function')).toBe(true);
    expect(findActiveKey(options, 'SALES_OrderForm', '/')).toContain('SALES_OrderForm');
    expect(findActiveKey(options, '', '/system/maintenance')).toContain('/system/maintenance');
  });

  it('maps an action item to the server-action route', () => {
    const actionMenu: MenuMeta = { kind: 'menu', name: 'Jobs', items: [{ label: 'Rebuild', action: 'RebuildIndex' }] };
    const options = buildNavigationOptions({ isFrameworkUser: false, settingsLabel: 'Settings', frameworkMenus: [], apps: [{ name: 'ops', label: 'Ops', menus: [actionMenu] }], onNavigate: vi.fn() });
    expect(allOptions(options).some((option) => String(option.key).includes('RebuildIndex'))).toBe(true);
  });

  it('maps typed Form, Function and Report targets', () => {
    const menu: MenuMeta = { kind: 'menu', name: 'Targets', items: [
      { label: 'Orders', target: { type: 'form', name: 'SALES_OrderForm' } },
      { label: 'Recalculate', target: { type: 'function', name: 'Recalculate' } },
      { label: 'Statement', target: { type: 'report', name: 'CustomerStatement' } },
    ] };
    const options = buildNavigationOptions({ isFrameworkUser: false, settingsLabel: 'Settings', frameworkMenus: [], apps: [{ name: 'sales', label: 'Sales', menus: [menu] }], onNavigate: vi.fn() });
    expect(findActiveKey(options, 'SALES_OrderForm', '/')).toContain('SALES_OrderForm');
    expect(findActiveKey(options, '', '/report/CustomerStatement')).toContain('CustomerStatement');
    expect(allOptions(options).some((option) => String(option.key).includes('Recalculate'))).toBe(true);
  });

  it('uses deterministic fallbacks when metadata has no icon', () => {
    expect(iconForItem({ label: 'Users', form: 'FW_UserForm' })).toBe('users');
    expect(iconForItem({ label: 'Designer', route: '/designer' })).toBe('wrench');
    expect(iconForItem({ label: 'Orders', form: 'SALES_OrderForm' })).toBe('table');
    expect(iconForItem({ label: 'Section', items: [] })).toBe('file');
  });
});
