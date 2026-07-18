/** Naming rules shared by the Designer editors. */

/** Artifact-name prefix mirrors the core rule: system → FW, otherwise the root App segment. */
export function appPrefix(app: string): string {
  return app === 'system'
    ? 'FW'
    : app.split('.')[0]!.replace(/[^a-z0-9]/gi, '').toUpperCase();
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
