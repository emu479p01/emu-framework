/** Naming rules shared by the Designer editors. */

/** Artifact-name prefix for an app: system → FW, erp* → ERP, else uppercase alnum app name. */
export function appPrefix(app: string): string {
  return app === 'system'
    ? 'FW'
    : app.startsWith('erp')
      ? 'ERP'
      : app.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

/**
 * Derived extension name: `<AppPrefix>_<BaseName>_Extension`.
 * When the base object already carries the app's own prefix (extending an
 * object of the same app), the prefix is not repeated.
 */
export function deriveExtensionName(app: string, base: string): string {
  if (!base) return '';
  const prefix = appPrefix(app);
  return base.startsWith(`${prefix}_`) ? `${base}_Extension` : `${prefix}_${base}_Extension`;
}

/** Field on each extension artifact that names its base object. */
export const EXT_TARGET_FIELD: Record<string, string> = {
  tableExtension: 'table',
  formExtension: 'form',
  menuExtension: 'menu',
  enumExtension: 'enum',
  privilegeExtension: 'privilege',
  dutyExtension: 'duty',
  roleExtension: 'role',
  scriptExtension: 'script',
};
