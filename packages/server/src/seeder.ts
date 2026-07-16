import type { AnyMeta, Kernel } from '@emu/core';

const FW_MODEL = 'Framework';

/**
 * Framework metadata seeder — runs on EVERY boot and upserts the SYS-layer
 * framework artifacts (idempotent), so upgrades add new framework tables/forms
 * (e.g. FW_AppAccess) to existing installations. Business apps are created via
 * CLI (`pnpm emu add app`) or the Web Designer and are never touched here.
 */
export function seedDesignerDb(kernel: Kernel): void {
  const ctx = kernel.designerContext();
  const firstBoot = ctx.select('FW_WebArtifact').count() === 0;
  if (firstBoot) {
    console.log('[Seeder] First boot - populating designer.db with framework metadata...');
  }

  const SYS = 'SYS' as const;
  const fw = { app: 'system', model: FW_MODEL, layer: SYS };

  const artifacts: (AnyMeta & { app?: string })[] = [
    { kind: 'table', name: 'FW_UserRole', label: 'User roles', ...fw, fields: [
      { name: 'userId', type: 'reference', reference: { table: 'FW_User' } },
      { name: 'username', type: 'string' },
      { name: 'role', type: 'string', mandatory: true, maxLength: 60 },
    ], indexes: [{ name: 'UserRoleIdx', fields: ['userId', 'role'], unique: true }] } as any,
    { kind: 'table', name: 'FW_AppAccess', label: 'App access', ...fw, fields: [
      { name: 'userId', type: 'reference', label: 'User', mandatory: true, reference: { table: 'FW_User' } },
      { name: 'appName', type: 'string', label: 'App', mandatory: true },
      { name: 'canOpen', type: 'boolean', label: 'Open app', default: true },
      { name: 'canCustomize', type: 'boolean', label: 'Customize', default: false },
    ], indexes: [{ name: 'UserAppIdx', fields: ['userId', 'appName'], unique: true }] } as any,
    { kind: 'form', name: 'FW_UserForm', label: 'Users', table: 'FW_User', ...fw,
      listFields: ['username', 'displayName', 'enabled'],
      groups: [{ label: 'General', fields: ['username', 'displayName', 'enabled'] }, { label: 'Security', fields: ['password'] }],
      lines: [
        { table: 'FW_UserRole', refField: 'userId', fields: ['role'] },
        { table: 'FW_AppAccess', refField: 'userId', fields: ['appName', 'canOpen', 'canCustomize'] },
      ] } as any,
    { kind: 'form', name: 'FW_AppAccessForm', label: 'App access', table: 'FW_AppAccess', ...fw,
      listFields: ['userId', 'appName', 'canOpen', 'canCustomize'],
      groups: [{ label: 'Access', fields: ['userId', 'appName', 'canOpen', 'canCustomize'] }] } as any,
    { kind: 'privilege', name: 'FW_SystemAdmin', label: 'System administration', ...fw, tablePermissions: [
      { table: 'FW_User', read: true, create: true, update: true, delete: true },
      { table: 'FW_UserRole', read: true, create: true, update: true, delete: true },
      { table: 'FW_AppAccess', read: true, create: true, update: true, delete: true },
    ], forms: ['FW_UserForm', 'FW_AppAccessForm'], reports: ['FW_UserListReport'] } as any,
    { kind: 'duty', name: 'FW_SystemAdminDuty', label: 'System administration', ...fw, privileges: ['FW_SystemAdmin'] } as any,
    { kind: 'role', name: 'FW_SystemAdminRole', label: 'System administrator', ...fw, duties: ['FW_SystemAdminDuty'] } as any,
    { kind: 'privilege', name: 'FW_FrameworkUserPrivilege', label: 'Framework user', ...fw, tablePermissions: [
      { table: 'FW_User', read: true, update: true },
    ], forms: ['FW_UserForm'] } as any,
    { kind: 'duty', name: 'FW_FrameworkUserDuty', label: 'Framework user', ...fw, privileges: ['FW_FrameworkUserPrivilege'] } as any,
    { kind: 'role', name: 'FW_FrameworkUser', label: 'Framework administrator', ...fw, duties: ['FW_FrameworkUserDuty'] } as any,
    { kind: 'menu', name: 'FW_SettingsMenu', label: 'Settings', ...fw, items: [
      { label: 'Users', icon: 'users', form: 'FW_UserForm' },
      { label: 'App Access', icon: 'shield', form: 'FW_AppAccessForm' },
      { label: 'Designer', icon: 'wrench', route: '/designer' },
      { label: 'System Maintenance', icon: 'database', route: '/system/maintenance' },
      { label: 'Report Fonts', icon: 'file', route: '/system/fonts' },
      { label: 'SMTP Settings', icon: 'settings', route: '/system/integrations/smtp' },
      { label: 'Table Browser', icon: 'table', route: '/system/tables' },
    ] } as any,
    // Example report — a working recipe for the Report Designer, printable from the Users list ("Print" button).
    { kind: 'report', name: 'FW_UserListReport', label: 'User list', ...fw, dataSource: 'FW_User',
      bands: [
        { kind: 'header', height: 30, elements: [
          { id: 'title', type: 'text', x: 0, y: 0, width: 300, height: 20, text: 'User List', style: { fontSize: 16, bold: true } },
        ] },
        { kind: 'detail', height: 18, elements: [
          { id: 'username', type: 'field', x: 0, y: 0, width: 150, height: 16, field: 'username' },
          { id: 'displayName', type: 'field', x: 150, y: 0, width: 200, height: 16, field: 'displayName' },
          { id: 'enabled', type: 'field', x: 350, y: 0, width: 80, height: 16, field: 'enabled' },
        ] },
      ] } as any,
  ];

  const order = ['enum', 'table', 'privilege', 'duty', 'role', 'form', 'menu', 'report'];
  const tableOrder = ['FW_UserRole', 'FW_AppAccess'];
  artifacts.sort((a, b) => {
    const ak = order.indexOf(a.kind);
    const bk = order.indexOf(b.kind);
    if (ak !== bk) return ak - bk;
    if (a.kind === 'table' && b.kind === 'table') return tableOrder.indexOf(a.name) - tableOrder.indexOf(b.name);
    return 0;
  });

  for (const art of artifacts) {
    const json = JSON.stringify(art);
    const existing = ctx.select('FW_WebArtifact').whereEq({ name: art.name }).firstOnly();
    if (existing) {
      if (existing.f.json !== json) {
        existing.setMany({ kind: art.kind, json });
        existing.update();
      }
    } else {
      ctx.newRecord('FW_WebArtifact').setMany({ kind: art.kind, name: art.name, json }).insert();
    }
  }

  if (firstBoot) console.log(`[Seeder] Seeded ${artifacts.length} artifacts into designer.db`);
}
