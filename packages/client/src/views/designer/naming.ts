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
 * Derived extension name: `<AppPrefix>_<ModelName>_<BaseName>_Extension`.
 */
export function deriveExtensionName(app: string, model: string, base: string): string {
  if (!base || !model) return '';
  return `${appPrefix(app)}_${model.replace(/[^a-z0-9]/gi, '')}_${base}_Extension`;
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
