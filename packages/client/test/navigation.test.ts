import { describe, expect, it, vi } from 'vitest';
import type { MenuMeta } from '@emu/core';
import { buildNavigationOptions, findActiveKey, findNavigationKeyPath, iconForItem, type NavMenuOption } from '../src/navigation';

function allOptions(options: NavMenuOption[]): NavMenuOption[] {
  return options.flatMap((option) => [option, ...allOptions((option.children ?? []) as NavMenuOption[])]);
}

describe('sidebar navigation', () => {
  it('keeps Recent copies out of active selection and matches app and detail routes', () => {
    const apps = ['one','two'].map(name => ({ name, label: name, menus: [{ kind: 'menu' as const, name: `${name}_Menu`, items: [{ id: 'item', form: 'SharedForm', label: 'Shared' }] }] }));
    const options = buildNavigationOptions({ apps, frameworkMenus: [], settingsLabel:'Settings', recentLabel:'Recent', recentEmptyLabel:'Empty', recentKeys:['one_Menu\0item','two_Menu\0item'], onNavigate: vi.fn() });
    for (const name of ['one','two']) {
      for (const path of [`/app/${name}/form/SharedForm`, `/app/${name}/form/SharedForm/42`]) {
        const key = findActiveKey(options, 'SharedForm', path, name)!;
        expect(key.startsWith(`app-${name}:`)).toBe(true);
        expect(key.startsWith('recent:')).toBe(false);
      }
      const root = options.find(o => o.key === `app-${name}`)!;
      const recent = (root.children as NavMenuOption[])[0]!;
      expect((recent.children as NavMenuOption[]).map(o => o.menuName)).toEqual([`${name}_Menu`]);
    }
  });
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

  it('builds Recent, Settings and Apps as icon-bearing submenus, never collapsed groups', () => {
    const options = buildNavigationOptions({
      isFrameworkUser: true, settingsLabel: 'Settings', recentLabel: 'Recent', recentEmptyLabel: 'No recently opened items',
      frameworkMenus: [settings],
      apps: [{ name: 'sales', label: 'Sales', menus: [appMenu] }], onNavigate: vi.fn(),
    });
    expect(options.map((option) => option.key)).toEqual(['app-sales', 'framework-settings']);
    expect(options.every((option) => option.type !== 'group' && typeof option.icon === 'function')).toBe(true);
    // every navigable row carries an icon; the inert Recent empty hint is exempt
    expect(allOptions(options).filter((option) => !option.disabled).every((option) => typeof option.icon === 'function')).toBe(true);
    expect(findActiveKey(options, 'SALES_OrderForm', '/app/sales/form/SALES_OrderForm')).toContain('SALES_OrderForm');
    expect(findActiveKey(options, '', '/system/maintenance')).toContain('/system/maintenance');
    const active = findActiveKey(options, 'SALES_OrderForm', '/app/sales/form/SALES_OrderForm')!;
    expect(findNavigationKeyPath(options, active)).toEqual(['app-sales', 'app-sales:Sales', active]);
  });

  it('shows an app-local inert Recent hint without history', () => {
    const options = buildNavigationOptions({
      settingsLabel: 'Settings', recentLabel: 'Recent', recentEmptyLabel: 'No recently opened items',
      frameworkMenus: [], apps: [{ name: 'sales', label: 'Sales', menus: [appMenu] }], onNavigate: vi.fn(),
    });
    expect(options.map((option) => option.key)).toEqual(['app-sales']);
    const recent = (options[0]!.children as NavMenuOption[])[0]!;
    expect((recent.children ?? [])).toHaveLength(1);
    expect(String((recent.children as NavMenuOption[])[0]!.key)).toBe('app-sales:recent:empty');
    expect((recent.children as NavMenuOption[])[0]!.disabled).toBe(true);
  });

  it('maps an action item to the server-action route', () => {
    const actionMenu: MenuMeta = { kind: 'menu', name: 'Jobs', items: [{ label: 'Rebuild', action: 'RebuildIndex' }] };
    const options = buildNavigationOptions({ isFrameworkUser: false, settingsLabel: 'Settings', recentLabel: 'Recent', recentEmptyLabel: 'Empty', frameworkMenus: [], apps: [{ name: 'ops', label: 'Ops', menus: [actionMenu] }], onNavigate: vi.fn() });
    expect(allOptions(options).some((option) => String(option.key).includes('RebuildIndex'))).toBe(true);
  });

  it('maps typed Form, Function and Report targets', () => {
    const menu: MenuMeta = { kind: 'menu', name: 'Targets', items: [
      { label: 'Orders', target: { type: 'form', name: 'SALES_OrderForm' } },
      { label: 'Recalculate', target: { type: 'function', name: 'Recalculate' } },
      { label: 'Statement', target: { type: 'report', name: 'CustomerStatement' } },
    ] };
    const options = buildNavigationOptions({ isFrameworkUser: false, settingsLabel: 'Settings', recentLabel: 'Recent', recentEmptyLabel: 'Empty', frameworkMenus: [], apps: [{ name: 'sales', label: 'Sales', menus: [menu] }], onNavigate: vi.fn() });
    expect(findActiveKey(options, 'SALES_OrderForm', '/app/sales/form/SALES_OrderForm')).toContain('SALES_OrderForm');
    expect(findActiveKey(options, '', '/report/CustomerStatement')).toContain('CustomerStatement');
    expect(allOptions(options).some((option) => String(option.key).includes('Recalculate'))).toBe(true);
  });

  it('uses deterministic fallbacks when metadata has no icon', () => {
    expect(iconForItem({ label: 'Users', form: 'FW_UserForm' })).toBe('users');
    expect(iconForItem({ label: 'Designer', route: '/designer' })).toBe('wrench');
    expect(iconForItem({ label: 'Orders', form: 'SALES_OrderForm' })).toBe('table');
    expect(iconForItem({ label: 'Section', items: [] })).toBe('file');
  });

  it('uses visible before legacy hidden and removes hidden descendants', () => {
    const menu: MenuMeta = { kind: 'menu', name: 'Visibility', items: [
      { label: 'Legacy hidden', hidden: true, form: 'HiddenForm' },
      { label: 'Explicitly restored', hidden: true, visible: true, form: 'RestoredForm' },
      { label: 'Explicitly hidden', visible: false, form: 'InvisibleForm' },
      { label: 'Group', items: [
        { label: 'Visible child', form: 'VisibleForm' },
        { label: 'Hidden child', visible: false, form: 'HiddenChildForm' },
      ] },
    ] };
    const options = buildNavigationOptions({ isFrameworkUser: false, settingsLabel: 'Settings', recentLabel: 'Recent', recentEmptyLabel: 'Empty', frameworkMenus: [], apps: [{ name: 'app', label: 'App', menus: [menu] }], onNavigate: vi.fn() });
    const keys = allOptions(options).map((option) => String(option.key));
    expect(keys.some((key) => key.includes('RestoredForm'))).toBe(true);
    expect(keys.some((key) => key.includes('VisibleForm'))).toBe(true);
    expect(keys.some((key) => key.includes('HiddenForm') || key.includes('InvisibleForm') || key.includes('HiddenChildForm'))).toBe(false);
  });
});
