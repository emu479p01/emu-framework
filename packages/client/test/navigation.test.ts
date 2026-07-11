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
    expect(options.map((option) => option.key)).toEqual(['framework-settings', 'app-sales']);
    expect(options.every((option) => option.type !== 'group' && typeof option.icon === 'function')).toBe(true);
    expect(allOptions(options).every((option) => typeof option.icon === 'function')).toBe(true);
    expect(findActiveKey(options, 'SALES_OrderForm', '/')).toContain('SALES_OrderForm');
    expect(findActiveKey(options, '', '/system/maintenance')).toContain('/system/maintenance');
  });

  it('uses deterministic fallbacks when metadata has no icon', () => {
    expect(iconForItem({ label: 'Users', form: 'FW_UserForm' })).toBe('users');
    expect(iconForItem({ label: 'Designer', route: '/designer' })).toBe('wrench');
    expect(iconForItem({ label: 'Orders', form: 'SALES_OrderForm' })).toBe('table');
    expect(iconForItem({ label: 'Section', items: [] })).toBe('file');
  });
});
