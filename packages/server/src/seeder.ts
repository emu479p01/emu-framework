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
    { kind: 'privilege', name: 'FW_SystemAdmin', label: 'System administration', ...fw, tablePermissions: [
      { table: 'FW_User', read: true, create: true, update: true, delete: true },
      { table: 'FW_UserRole', read: true, create: true, update: true, delete: true },
      { table: 'FW_AppAccess', read: true, create: true, update: true, delete: true },
    ] } as any,
    { kind: 'duty', name: 'FW_SystemAdminDuty', label: 'System administration', ...fw, privileges: ['FW_SystemAdmin'] } as any,
    { kind: 'role', name: 'FW_SystemAdminRole', label: 'System administrator', ...fw, duties: ['FW_SystemAdminDuty'] } as any,
    { kind: 'privilege', name: 'FW_FrameworkUserPrivilege', label: 'Framework user (legacy; no runtime access)', ...fw } as any,
    { kind: 'duty', name: 'FW_FrameworkUserDuty', label: 'Framework user', ...fw, privileges: ['FW_FrameworkUserPrivilege'] } as any,
    { kind: 'role', name: 'FW_FrameworkUser', label: 'Framework user (legacy)', ...fw, duties: ['FW_FrameworkUserDuty'] } as any,
    { kind: 'menu', name: 'FW_SettingsMenu', label: 'Settings', ...fw, items: [
      { label: 'My Account', icon: 'settings', route: '/account/password' },
      { label: 'Users & Security', icon: 'users', route: '/system/security/users' },
      { label: 'Designer', icon: 'wrench', route: '/designer' },
      { label: 'System Maintenance', icon: 'database', route: '/system/maintenance' },
      { label: 'Report Fonts', icon: 'file', route: '/system/fonts' },
      { label: 'SMTP Settings', icon: 'settings', route: '/system/integrations/smtp' },
      { label: 'Table Browser', icon: 'table', route: '/system/tables' },
    ] } as any,
  ];

  // v0.1.1.0 replaces generic security forms/reports with dedicated APIs and
  // pages. Remove their old metadata on upgrade; business tables are untouched.
  for (const name of ['FW_UserForm', 'FW_AppAccessForm', 'FW_UserListReport']) {
    ctx.select('FW_WebArtifact').whereEq({ name }).firstOnly()?.delete();
  }

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
