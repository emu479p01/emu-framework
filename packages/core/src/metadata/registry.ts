import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AnyMeta,
  AppManifest,
  DutyMeta,
  EnumMeta,
  EnumExtensionMeta,
  FormExtensionMeta,
  FormMeta,
  MenuExtensionMeta,
  MenuItemMeta,
  MenuMeta,
  PrivilegeMeta,
  PrivilegeExtensionMeta,
  ReportBandMeta,
  ReportMeta,
  RoleMeta,
  RoleExtensionMeta,
  ScriptExtensionMeta,
  ScriptMeta,
  DutyExtensionMeta,
  TableExtensionMeta,
  TableMeta,
} from './types.js';
import { SYSTEM_FIELDS, LAYER_ORDER, DEFAULT_LAYER, EXTENSION_KINDS, type LayerType } from './types.js';
import { validateMetadataArtifact } from './schema.js';

export class MetadataError extends Error {}

interface LoadedApp {
  manifest: AppManifest;
  artifacts: AnyMeta[];
}

const META_DIRS: { dir: string; kind: AnyMeta['kind'] }[] = [
  { dir: 'enums', kind: 'enum' },
  { dir: 'tables', kind: 'table' },
  { dir: 'tableExtensions', kind: 'tableExtension' },
  { dir: 'forms', kind: 'form' },
  { dir: 'formExtensions', kind: 'formExtension' },
  { dir: 'enumExtensions', kind: 'enumExtension' },
  { dir: 'menus', kind: 'menu' },
  { dir: 'menuExtensions', kind: 'menuExtension' },
  { dir: 'privileges', kind: 'privilege' },
  { dir: 'privilegeExtensions', kind: 'privilegeExtension' },
  { dir: 'duties', kind: 'duty' },
  { dir: 'dutyExtensions', kind: 'dutyExtension' },
  { dir: 'roles', kind: 'role' },
  { dir: 'roleExtensions', kind: 'roleExtension' },
  { dir: 'scripts', kind: 'script' },
  { dir: 'scriptExtensions', kind: 'scriptExtension' },
  { dir: 'reports', kind: 'report' },
];

const KNOWN_META_KINDS = new Set(META_DIRS.map((d) => d.dir));

/**
 * Loads and validates metadata from all registered apps.
 * Supports hierarchical module subdirectories under metadata/.
 */
export class MetadataRegistry {
  private apps: LoadedApp[] = [];
  private tables = new Map<string, TableMeta>();
  private enums = new Map<string, EnumMeta>();
  private forms = new Map<string, FormMeta>();
  private menus = new Map<string, MenuMeta>();
  private privileges = new Map<string, PrivilegeMeta>();
  private duties = new Map<string, DutyMeta>();
  private roles = new Map<string, RoleMeta>();
  private scripts = new Map<string, ScriptMeta>();
  private reports = new Map<string, ReportMeta>();
  private extensionNames = new Set<string>();
  /** Maps artifact name → app name for grouping in metadata API */
  private artifactApp = new Map<string, string>();
  /** Maps app name → list of module directory names */
  private appModules = new Map<string, string[]>();
  private appManifests = new Map<string, AppManifest>();

  /** Register an app from a directory containing app.json + metadata/ subfolders. */
  loadAppFromDir(appDir: string): void {
    const manifestPath = join(appDir, 'app.json');
    if (!existsSync(manifestPath)) {
      throw new MetadataError(`App manifest not found: ${manifestPath}`);
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as AppManifest;
    const artifacts: AnyMeta[] = [];
    const modules: string[] = [];

    const metaRoot = join(appDir, 'metadata');
    if (!existsSync(metaRoot)) {
      throw new MetadataError(`Metadata directory not found: ${metaRoot}`);
    }

    // Scan modules — subdirs that are not known meta kind dirs
    for (const entry of readdirSync(metaRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (KNOWN_META_KINDS.has(entry.name)) {
        // Root-level metadata kind directory — load artifacts here
        for (const { dir, kind } of META_DIRS) {
          if (entry.name !== dir) continue;
          const full = join(metaRoot, dir);
          readArtifacts(full, kind, artifacts);
        }
      } else {
        // Module subdirectory — scan for metadata kinds inside
        modules.push(entry.name);
        const modDir = join(metaRoot, entry.name);
        for (const { dir, kind } of META_DIRS) {
          const full = join(modDir, dir);
          readArtifacts(full, kind, artifacts);
        }
      }
    }

    this.registerApp(manifest, artifacts);
    this.appModules.set(manifest.name, modules);
  }

  /** Register an app programmatically (useful for tests and built-in system app). */
  registerApp(manifest: AppManifest, artifacts: AnyMeta[]): void {
    for (const dep of manifest.dependsOn ?? []) {
      if (!this.apps.some((a) => a.manifest.name === dep)) {
        throw new MetadataError(`App '${manifest.name}' depends on '${dep}' which is not loaded`);
      }
    }
    const normalizedManifest = normalizeManifest(manifest);
    this.appManifests.set(normalizedManifest.name, normalizedManifest);
    const normalizedArtifacts = artifacts.map((a) => this.normalizeArtifact(normalizedManifest, a));
    for (const meta of normalizedArtifacts) {
      this.addArtifact(normalizedManifest.name, meta);
    }
    this.apps.push({ manifest: normalizedManifest, artifacts: normalizedArtifacts });
    this.validate();
  }

  /** Register web artifacts into an existing app (already loaded by boot steps). */
  registerWebArtifacts(appName: string, artifacts: AnyMeta[]): void {
    if (!this.apps.some((a) => a.manifest.name === appName)) {
      throw new MetadataError(`Cannot add web artifacts: app '${appName}' is not loaded`);
    }
    for (const meta of artifacts) {
      this.addArtifact(appName, meta);
    }
    this.validate();
  }

  private addArtifact(appName: string, artifact: AnyMeta): void {
    const meta = structuredClone(artifact);
    this.validatePlacement(appName, meta);
    this.validateNaming(appName, meta);
    if (EXTENSION_KINDS.has(meta.kind)) {
      if (this.extensionNames.has(meta.name)) {
        throw new MetadataError(`Duplicate extension '${meta.name}' (app '${appName}')`);
      }
      if (!meta.name.endsWith('_Extension')) {
        throw new MetadataError(`Extension '${meta.name}' must end with '_Extension'`);
      }
      this.extensionNames.add(meta.name);
      this.applyExtension(appName, meta as any);
      this.artifactApp.set(meta.name, appName);
      return;
    }
    if (meta.kind === 'script') {
      this.addBase(appName, meta, this.scripts as Map<string, AnyMeta>);
      this.artifactApp.set(meta.name, appName);
      return;
    }
    const map = this.mapFor(meta.kind as any) as Map<string, AnyMeta>;
    const existing = map.get(meta.name);
    if (existing) {
      const newLayer = (meta as any).layer ?? DEFAULT_LAYER;
      const oldLayer = (existing as any).layer ?? DEFAULT_LAYER;
      const newIdx = LAYER_ORDER.indexOf(newLayer);
      const oldIdx = LAYER_ORDER.indexOf(oldLayer);
      if (newIdx > oldIdx) {
        map.set(meta.name, meta);
        this.artifactApp.set(meta.name, appName);
      } else if (newIdx < oldIdx) {
        // skip silently
      } else {
        throw new MetadataError(`Duplicate ${meta.kind} '${meta.name}' in layer '${newLayer}' (app '${appName}')`);
      }
      return;
    }
    map.set(meta.name, meta);
    this.artifactApp.set(meta.name, appName);
  }

  private addBase(appName: string, meta: AnyMeta, map: Map<string, AnyMeta>): void {
    const existing = map.get(meta.name);
    if (existing) {
      const newLayer = (meta as any).layer ?? DEFAULT_LAYER;
      const oldLayer = (existing as any).layer ?? DEFAULT_LAYER;
      const newIdx = LAYER_ORDER.indexOf(newLayer);
      const oldIdx = LAYER_ORDER.indexOf(oldLayer);
      if (newIdx > oldIdx) {
        map.set(meta.name, meta);
        this.artifactApp.set(meta.name, appName);
      } else if (newIdx === oldIdx) {
        throw new MetadataError(`Duplicate ${meta.kind} '${meta.name}' in layer '${newLayer}' (app '${appName}')`);
      }
      return;
    }
    map.set(meta.name, meta);
  }

  private mapFor(kind: Exclude<AnyMeta['kind'], `${string}Extension`>): Map<string, AnyMeta> {
    switch (kind) {
      case 'table':
        return this.tables as Map<string, AnyMeta>;
      case 'enum':
        return this.enums as Map<string, AnyMeta>;
      case 'form':
        return this.forms as Map<string, AnyMeta>;
      case 'menu':
        return this.menus as Map<string, AnyMeta>;
      case 'privilege':
        return this.privileges as Map<string, AnyMeta>;
      case 'duty':
        return this.duties as Map<string, AnyMeta>;
      case 'role':
        return this.roles as Map<string, AnyMeta>;
      case 'report':
        return this.reports as Map<string, AnyMeta>;
      default:
        throw new MetadataError(`Unsupported base kind '${kind}'`);
    }
  }

  private normalizeArtifact(manifest: AppManifest, artifact: AnyMeta): AnyMeta {
    const meta = structuredClone(artifact) as AnyMeta;
    const models = manifest.models ?? [];
    const defaultModel = models[0];
    (meta as any).app ??= manifest.name;
    if ((meta as any).kind !== 'app' && !(meta as any).model && defaultModel) {
      (meta as any).model = defaultModel.name;
    }
    const model = models.find((m) => m.name === (meta as any).model);
    if (model) (meta as any).layer = model.layer;
    return meta;
  }

  private validatePlacement(appName: string, meta: AnyMeta): void {
    if ((meta as any).kind === 'app') return;
    if ((meta as any).app !== appName) {
      throw new MetadataError(`${meta.kind} '${meta.name}': app must be '${appName}'`);
    }
    if (!(meta as any).model) {
      throw new MetadataError(`${meta.kind} '${meta.name}': model is required`);
    }
    const manifest = this.appManifests.get(appName);
    const model = manifest?.models?.find((m) => m.name === (meta as any).model);
    if (!model) {
      throw new MetadataError(`${meta.kind} '${meta.name}': unknown model '${(meta as any).model}' for app '${appName}'`);
    }
    (meta as any).layer = model.layer;
  }

  private validateNaming(appName: string, meta: AnyMeta): void {
    const prefix = appName === 'system'
      ? 'FW_'
      : `${appName.split('.')[0].replace(/[^a-z0-9]/gi, '').toUpperCase()}_`;
    if (!meta.name.startsWith(prefix)) {
      throw new MetadataError(`${meta.kind} '${meta.name}' must start with '${prefix}'`);
    }
  }

  /** Merge an extension into the effective base artifact. */
  private applyExtension(appName: string, ext: AnyMeta): void {
    const e = ext as any;
    if (e.kind === 'tableExtension') {
      const base = this.tables.get(e.table);
      if (!base) throw new MetadataError(`Extension '${e.name}': unknown table '${e.table}'`);
      for (const field of e.fields ?? []) {
        if (base.fields.some((f: any) => f.name === field.name))
          throw new MetadataError(`Extension '${e.name}': field '${field.name}' already exists on '${e.table}'`);
        base.fields.push(field);
      }
      base.indexes = [...(base.indexes ?? []), ...(e.indexes ?? [])];
    } else if (e.kind === 'formExtension') {
      const base = this.forms.get(e.form);
      if (!base) throw new MetadataError(`Extension '${e.name}': unknown form '${e.form}'`);
      if (e.listFields) base.listFields = [...(base.listFields ?? []), ...e.listFields];
      if (e.groups) base.groups = [...(base.groups ?? []), ...e.groups];
    } else if (e.kind === 'menuExtension') {
      const base = this.menus.get(e.menu);
      if (!base) throw new MetadataError(`Extension '${e.name}': unknown menu '${e.menu}'`);
      base.items.push(...e.items);
    } else if (e.kind === 'enumExtension') {
      const base = this.enums.get(e.enum);
      if (!base) throw new MetadataError(`Extension '${e.name}': unknown enum '${e.enum}'`);
      base.values.push(...e.values);
    } else if (e.kind === 'privilegeExtension') {
      const base = this.privileges.get(e.privilege);
      if (!base) throw new MetadataError(`Extension '${e.name}': unknown privilege '${e.privilege}'`);
      if (e.tablePermissions) base.tablePermissions = [...(base.tablePermissions ?? []), ...e.tablePermissions];
      if (e.forms) base.forms = [...(base.forms ?? []), ...e.forms];
    } else if (e.kind === 'dutyExtension') {
      const base = this.duties.get(e.duty);
      if (!base) throw new MetadataError(`Extension '${e.name}': unknown duty '${e.duty}'`);
      if (e.privileges) base.privileges = [...base.privileges, ...e.privileges];
    } else if (e.kind === 'roleExtension') {
      const base = this.roles.get(e.role);
      if (!base) throw new MetadataError(`Extension '${e.name}': unknown role '${e.role}'`);
      if (e.duties) base.duties = [...(base.duties ?? []), ...e.duties];
      if (e.privileges) base.privileges = [...(base.privileges ?? []), ...e.privileges];
    } else if (e.kind === 'scriptExtension') {
      const base = this.scripts.get(e.script);
      if (!base) throw new MetadataError(`Extension '${e.name}': unknown script '${e.script}'`);
    }
  }

  /** Cross-reference validation over everything loaded so far. */
  private validate(): void {
    for (const table of this.tables.values()) {
      const seen = new Set<string>();
      for (const f of table.fields) {
        if ((SYSTEM_FIELDS as readonly string[]).includes(f.name)) {
          throw new MetadataError(`${table.name}.${f.name}: '${f.name}' is a reserved system field`);
        }
        if (seen.has(f.name)) {
          throw new MetadataError(`${table.name}: duplicate field '${f.name}'`);
        }
        seen.add(f.name);
        if (f.type === 'enum' && (!f.enumName || !this.enums.has(f.enumName))) {
          throw new MetadataError(`${table.name}.${f.name}: unknown enum '${f.enumName}'`);
        }
        if (f.type === 'reference' && (!f.reference || !this.tables.has(f.reference.table))) {
          throw new MetadataError(
            `${table.name}.${f.name}: unknown reference table '${f.reference?.table}'`,
          );
        }
      }
      if (table.titleField && !table.fields.some((f) => f.name === table.titleField)) {
        throw new MetadataError(`${table.name}: titleField '${table.titleField}' does not exist`);
      }
      for (const idx of table.indexes ?? []) {
        for (const fname of idx.fields) {
          if (!seen.has(fname)) {
            throw new MetadataError(`${table.name}: index '${idx.name}' uses unknown field '${fname}'`);
          }
        }
      }
      for (const f of table.fields) {
        for (const cf of f.reference?.copyFields ?? []) {
          const refTable = this.tables.get(f.reference!.table);
          const fromOk =
            refTable?.fields.some((x) => x.name === cf.from) ||
            (SYSTEM_FIELDS as readonly string[]).includes(cf.from);
          if (!fromOk) {
            throw new MetadataError(
              `${table.name}.${f.name}: copyFields 'from' unknown field '${cf.from}' on '${f.reference!.table}'`,
            );
          }
          if (cf.to === f.name || !table.fields.some((x) => x.name === cf.to)) {
            throw new MetadataError(
              `${table.name}.${f.name}: copyFields 'to' unknown/invalid field '${cf.to}'`,
            );
          }
        }
      }
    }
    for (const form of this.forms.values()) {
      const table = this.tables.get(form.table);
      if (!table) throw new MetadataError(`Form '${form.name}': unknown table '${form.table}'`);
      const fieldNames = new Set([
        ...table.fields.map((f) => f.name),
        ...(SYSTEM_FIELDS as readonly string[]),
      ]);
      const checkFields = (fields: string[] | undefined, where: string) => {
        for (const f of fields ?? []) {
          if (!fieldNames.has(f)) {
            throw new MetadataError(`Form '${form.name}' ${where}: unknown field '${f}'`);
          }
        }
      };
      checkFields(form.listFields, 'listFields');
      for (const g of form.groups ?? []) checkFields(g.fields, 'group');
      for (const line of form.lines ?? []) {
        const lineTable = this.tables.get(line.table);
        if (!lineTable) {
          throw new MetadataError(`Form '${form.name}': unknown line table '${line.table}'`);
        }
        if (!lineTable.fields.some((f) => f.name === line.refField)) {
          throw new MetadataError(
            `Form '${form.name}': line table '${line.table}' has no refField '${line.refField}'`,
          );
        }
        if (line.fields.includes(line.refField)) {
          throw new MetadataError(
            `Form '${form.name}': line '${line.table}' cannot display its own refField '${line.refField}' as an editable column`,
          );
        }
        for (const agg of line.aggregates ?? []) {
          if (agg.fn !== 'count') {
            if (!agg.field) {
              throw new MetadataError(
                `Form '${form.name}' line '${line.table}': aggregate '${agg.fn}' requires 'field'`,
              );
            }
            const aggField = lineTable.fields.find((f) => f.name === agg.field);
            if (!aggField) {
              throw new MetadataError(
                `Form '${form.name}' line '${line.table}': aggregate field '${agg.field}' not found`,
              );
            }
            if (aggField.type !== 'int' && aggField.type !== 'real') {
              throw new MetadataError(
                `Form '${form.name}' line '${line.table}': aggregate field '${agg.field}' must be numeric`,
              );
            }
          }
        }
      }
    }
    for (const menu of this.menus.values()) {
      this.validateMenuItems(menu.items, `Menu '${menu.name}'`);
    }
    for (const priv of this.privileges.values()) {
      for (const perm of priv.tablePermissions ?? []) {
        if (!this.tables.has(perm.table)) {
          throw new MetadataError(`Privilege '${priv.name}': unknown table '${perm.table}'`);
        }
      }
      for (const form of priv.forms ?? []) {
        if (!this.forms.has(form)) {
          throw new MetadataError(`Privilege '${priv.name}': unknown form '${form}'`);
        }
      }
    }
    for (const duty of this.duties.values()) {
      for (const priv of duty.privileges) {
        if (!this.privileges.has(priv)) {
          throw new MetadataError(`Duty '${duty.name}': unknown privilege '${priv}'`);
        }
      }
    }
    for (const role of this.roles.values()) {
      for (const duty of role.duties ?? []) {
        if (!this.duties.has(duty)) {
          throw new MetadataError(`Role '${role.name}': unknown duty '${duty}'`);
        }
      }
      for (const priv of role.privileges ?? []) {
        if (!this.privileges.has(priv)) {
          throw new MetadataError(`Role '${role.name}': unknown privilege '${priv}'`);
        }
      }
    }
    for (const report of this.reports.values()) {
      const table = this.tables.get(report.dataSource);
      if (!table) throw new MetadataError(`Report '${report.name}': unknown dataSource table '${report.dataSource}'`);
      const mainFieldNames = new Set([...table.fields.map((f) => f.name), ...(SYSTEM_FIELDS as readonly string[])]);
      this.validateReportBands(report.bands, mainFieldNames, `Report '${report.name}'`);
      for (const line of report.lineSources ?? []) {
        const lineTable = this.tables.get(line.table);
        if (!lineTable) {
          throw new MetadataError(`Report '${report.name}': unknown lineSource table '${line.table}'`);
        }
        if (!lineTable.fields.some((f) => f.name === line.refField)) {
          throw new MetadataError(
            `Report '${report.name}': lineSource table '${line.table}' has no refField '${line.refField}'`,
          );
        }
        const lineFieldNames = new Set([...lineTable.fields.map((f) => f.name), ...(SYSTEM_FIELDS as readonly string[])]);
        this.validateReportBands(line.bands, lineFieldNames, `Report '${report.name}' lineSource '${line.table}'`);
      }
    }
    for (const ext of [...this.extensionNames]) {
      void ext;
    }
  }

  private validateReportBands(bands: ReportBandMeta[], fieldNames: Set<string>, context: string): void {
    for (const band of bands) {
      for (const el of band.elements) {
        if (el.type === 'field' && el.field && !fieldNames.has(el.field)) {
          throw new MetadataError(`${context}: unknown field '${el.field}' in ${band.kind} band`);
        }
      }
    }
  }

  private validateMenuItems(items: MenuItemMeta[], context: string): void {
    for (const item of items) {
      if (item.form && !this.forms.has(item.form)) {
        throw new MetadataError(`${context}: unknown form '${item.form}'`);
      }
      if (item.items) {
        this.validateMenuItems(item.items, context);
      }
    }
  }

  getTable(name: string): TableMeta {
    const t = this.tables.get(name);
    if (!t) throw new MetadataError(`Unknown table '${name}'`);
    return t;
  }

  getEnum(name: string): EnumMeta {
    const e = this.enums.get(name);
    if (!e) throw new MetadataError(`Unknown enum '${name}'`);
    return e;
  }

  getForm(name: string): FormMeta {
    const f = this.forms.get(name);
    if (!f) throw new MetadataError(`Unknown form '${name}'`);
    return f;
  }

  hasTable(name: string): boolean {
    return this.tables.has(name);
  }

  allTables(): TableMeta[] {
    return [...this.tables.values()];
  }

  allEnums(): EnumMeta[] {
    return [...this.enums.values()];
  }

  allForms(): FormMeta[] {
    return [...this.forms.values()];
  }

  allMenus(): MenuMeta[] {
    return [...this.menus.values()];
  }

  getRole(name: string): RoleMeta | undefined {
    return this.roles.get(name);
  }

  getDuty(name: string): DutyMeta | undefined {
    return this.duties.get(name);
  }

  getPrivilege(name: string): PrivilegeMeta | undefined {
    return this.privileges.get(name);
  }

  allRoles(): RoleMeta[] {
    return [...this.roles.values()];
  }

  allDuties(): DutyMeta[] {
    return [...this.duties.values()];
  }

  allPrivileges(): PrivilegeMeta[] {
    return [...this.privileges.values()];
  }

  getScript(name: string): ScriptMeta | undefined {
    return this.scripts.get(name);
  }

  allScripts(): ScriptMeta[] {
    return [...this.scripts.values()];
  }

  getReport(name: string): ReportMeta {
    const r = this.reports.get(name);
    if (!r) throw new MetadataError(`Unknown report '${name}'`);
    return r;
  }

  hasReport(name: string): boolean {
    return this.reports.has(name);
  }

  allReports(): ReportMeta[] {
    return [...this.reports.values()];
  }

  loadedApps(): AppManifest[] {
    return this.apps.map((a) => a.manifest);
  }

  /** Returns the app name that registered a given artifact. */
  appForArtifact(name: string): string | undefined {
    return this.artifactApp.get(name);
  }

  /** Returns module directory names for an app. */
  modulesForApp(appName: string): string[] {
    return this.appModules.get(appName) ?? [];
  }
}

/** Read metadata JSON files from a directory into the artifacts array. */
function readArtifacts(dir: string, kind: AnyMeta['kind'], out: AnyMeta[]): void {
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const meta = JSON.parse(readFileSync(join(dir, file), 'utf-8')) as AnyMeta;
    if (meta.kind !== kind) {
      throw new MetadataError(`${file}: expected kind '${kind}', got '${meta.kind}'`);
    }
    const diagnostics = validateMetadataArtifact(meta);
    if (diagnostics.length > 0) {
      throw new MetadataError(`${file}: ${diagnostics.map((item) => `${item.path} ${item.message}`).join('; ')}`);
    }
    out.push(meta);
  }
}

function normalizeManifest(manifest: AppManifest): AppManifest {
  if (manifest.models && manifest.models.length > 0) return manifest;
  if (manifest.name === 'system') {
    return {
      ...manifest,
      models: [{ name: 'Framework', label: 'Framework', layer: 'SYS' }],
    };
  }
  if (manifest.name === 'erp') {
    return {
      ...manifest,
      models: [{ name: 'MiniERPApplication', label: 'Mini ERP Application', layer: 'SYS' }],
    };
  }
  if (manifest.name === 'erp.credit') {
    return {
      ...manifest,
      models: [{ name: 'MiniERPCredit', label: 'Mini ERP Credit', layer: 'DEV' }],
    };
  }
  return {
    ...manifest,
    models: [{ name: 'ClientCustom', label: 'Client Custom', layer: 'CUS' }],
  };
}
