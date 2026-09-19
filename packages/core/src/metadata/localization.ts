import type { MetadataRegistry } from './registry.js';
import type { LayerType, MenuItemMeta, TranslationMeta } from './types.js';
import { DEFAULT_LOCALE, SYSTEM_FIELDS, layerIndex, localeBase, normalizeLocale } from './types.js';

// ---- shared resource keys (single source for the runtime resolver and the Designer) ----

export function appLabelKey(app: string): string { return `app.${app}.label`; }
export function modelLabelKey(app: string, model: string): string { return `model.${app}.${model}.label`; }
export function menuLabelKey(menu: string): string { return `menu.${menu}.label`; }
export function menuItemLabelKey(menu: string, itemId: string): string { return `menu.${menu}.item.${itemId}.label`; }
export function tableLabelKey(table: string): string { return `table.${table}.label`; }
export function tableFieldLabelKey(table: string, field: string): string { return `table.${table}.field.${field}.label`; }
export function enumLabelKey(enumName: string): string { return `enum.${enumName}.label`; }
export function enumValueLabelKey(enumName: string, value: string): string { return `enum.${enumName}.value.${value}.label`; }
export function formLabelKey(form: string): string { return `form.${form}.label`; }
export function formGroupLabelKey(form: string, groupId: string): string { return `form.${form}.group.${groupId}.label`; }
export function formActionLabelKey(form: string, actionId: string): string { return `form.${form}.action.${actionId}.label`; }
export function formLineLabelKey(form: string, lineId: string): string { return `form.${form}.line.${lineId}.label`; }
export function formLineActionLabelKey(form: string, lineId: string, actionId: string): string { return `form.${form}.line.${lineId}.action.${actionId}.label`; }
export function reportLabelKey(report: string): string { return `report.${report}.label`; }
export function reportParameterLabelKey(report: string, field: string): string { return `report.${report}.parameter.${field}.label`; }
export function reportElementTextKey(report: string, elementId: string): string { return `report.${report}.element.${elementId}.text`; }
export type ArtifactLabelKind = 'view' | 'chart' | 'privilege' | 'duty' | 'role' | 'dataEntity' | 'report';
export function artifactLabelKey(kind: ArtifactLabelKind, name: string): string { return `${kind}.${name}.label`; }

/** Framework-owned keys are reserved: only system-app translations may define them. */
export function isFrameworkResourceKey(key: string): boolean { return key.startsWith('ui.'); }

/** Owning app for a dotted resource key ('ui.*' belongs to the system app). */
export function resourceKeyOwner(registry: MetadataRegistry, key: string): string | undefined {
  if (isFrameworkResourceKey(key)) return 'system';
  const [scope, target] = key.split('.');
  switch (scope) {
    case 'app':
    case 'model':
      return target;
    case 'table':
    case 'enum':
    case 'form':
    case 'menu':
    case 'report':
    case 'view':
    case 'chart':
    case 'privilege':
    case 'duty':
    case 'role':
    case 'dataEntity':
      return registry.appForArtifact(target ?? '');
    default:
      return undefined;
  }
}

function menuItemsContainId(items: MenuItemMeta[], itemId: string): boolean {
  for (const item of items) {
    if (item.id === itemId) return true;
    if (item.items && menuItemsContainId(item.items, itemId)) return true;
  }
  return false;
}

/** True when a resource key still points at a live metadata target. */
export function resourceTargetExists(registry: MetadataRegistry, key: string): boolean {
  if (isFrameworkResourceKey(key)) return true;
  const [scope, name, relation, detail, , leaf] = key.split('.');
  switch (scope) {
    case 'app':
      return registry.loadedApps().some((app) => app.name === name);
    case 'model': {
      const app = registry.loadedApps().find((entry) => entry.name === name);
      return Boolean(app?.models?.some((model) => model.name === relation));
    }
    case 'table': {
      if (!registry.allTables().some((table) => table.name === name)) return false;
      if (relation === 'field') {
        const table = registry.getTable(name!);
        return table.fields.some((field) => field.name === detail)
          || (SYSTEM_FIELDS as readonly string[]).includes(detail ?? '');
      }
      return true;
    }
    case 'enum': {
      if (!registry.allEnums().some((entry) => entry.name === name)) return false;
      if (relation === 'value') return registry.getEnum(name!).values.some((value) => value.name === detail);
      return true;
    }
    case 'form': {
      const form = registry.allForms().find((entry) => entry.name === name);
      if (!form) return false;
      if (relation === 'group') return (form.groups ?? []).some((group) => group.id === detail);
      if (relation === 'action') return (form.actions ?? []).some((action) => action.id === detail);
      if (relation === 'line') {
        const line = (form.lines ?? []).find((entry) => entry.id === detail);
        if (!line) return false;
        if (leaf !== undefined) return (line.actions ?? []).some((action) => action.id === leaf);
        return true;
      }
      return true;
    }
    case 'menu': {
      const menu = registry.allMenus().find((entry) => entry.name === name);
      if (!menu) return false;
      if (relation === 'item') return menuItemsContainId(menu.items, detail ?? '');
      return true;
    }
    case 'report': {
      const report = registry.allReports().find((entry) => entry.name === name);
      if (!report) return false;
      if (relation === 'parameter') return (report.parameters ?? []).some((parameter) => parameter.field === detail);
      if (relation === 'element') {
        const ids = [
          ...report.bands.flatMap((band) => band.elements.map((element) => element.id)),
          ...(report.lineSources ?? []).flatMap((source) => source.bands.flatMap((band) => band.elements.map((element) => element.id))),
        ];
        return ids.includes(detail ?? '');
      }
      return true;
    }
    case 'view':
      return registry.allViews().some((entry) => entry.name === name);
    case 'chart':
      return registry.allCharts().some((entry) => entry.name === name);
    case 'privilege':
      return registry.allPrivileges().some((entry) => entry.name === name);
    case 'duty':
      return registry.allDuties().some((entry) => entry.name === name);
    case 'role':
      return registry.allRoles().some((entry) => entry.name === name);
    case 'dataEntity':
      return registry.allDataEntities().some((entry) => entry.name === name);
    default:
      return false;
  }
}

/**
 * Locale fallback chain for one key lookup: exact user locale → its base
 * language → the owner app's defaultLocale → that locale's base language.
 * Duplicates (case-insensitive) are removed before searching.
 */
export function localeChain(userLocale: string, ownerDefaultLocale: string): string[] {
  const chain: string[] = [];
  const push = (locale: string): void => {
    const trimmed = locale.trim();
    if (!trimmed) return;
    let canonical: string;
    try { canonical = normalizeLocale(trimmed); } catch { canonical = trimmed; }
    if (!chain.some((entry) => entry.toLowerCase() === canonical.toLowerCase())) chain.push(canonical);
  };
  push(userLocale);
  push(localeBase(userLocale));
  push(ownerDefaultLocale || DEFAULT_LOCALE);
  push(localeBase(ownerDefaultLocale || DEFAULT_LOCALE));
  return chain;
}

interface TranslationCandidate {
  name: string;
  app: string;
  layer: LayerType;
  locale: string;
  resources: Record<string, string>;
}

/**
 * Per-key translation resolution with layer precedence. For one key and
 * locale the highest layer wins (SYS → ISV → LOC → DEV → CUS); when layers
 * are equal the Translation artifact name decides, so results never depend
 * on file load order.
 */
export class LocaleResolver {
  private candidates: TranslationCandidate[];

  constructor(private registry: MetadataRegistry) {
    this.candidates = registry.allTranslations()
      .map((translation: TranslationMeta) => ({
        name: translation.name,
        app: translation.app ?? 'system',
        layer: (translation.layer ?? 'SYS') as LayerType,
        locale: translation.locale,
        resources: translation.resources,
      }))
      // ascending (layer, name) — the LAST matching candidate wins
      .sort((a, b) => layerIndex(a.layer) - layerIndex(b.layer) || a.name.localeCompare(b.name));
  }

  private mayOverride(translationApp: string, key: string, ownerApp: string | undefined): boolean {
    if (isFrameworkResourceKey(key)) return translationApp === 'system';
    if (ownerApp === undefined) return true;
    return translationApp === ownerApp || this.registry.appDependsOn(translationApp, ownerApp);
  }

  private lookup(key: string, locale: string, ownerApp: string | undefined): string | undefined {
    const wanted = locale.toLowerCase();
    let winner: TranslationCandidate | undefined;
    for (const candidate of this.candidates) {
      if (candidate.locale.toLowerCase() !== wanted) continue;
      if (candidate.resources[key] === undefined) continue;
      if (!this.mayOverride(candidate.app, key, ownerApp)) continue;
      winner = candidate;
    }
    return winner?.resources[key];
  }

  /** Resolve one resource key for a user locale; undefined keeps the stored label. */
  resolve(key: string, ownerApp: string | undefined, userLocale: string): string | undefined {
    const chain = localeChain(userLocale, ownerApp !== undefined ? this.registry.defaultLocaleOf(ownerApp) : DEFAULT_LOCALE);
    for (const locale of chain) {
      const value = this.lookup(key, locale, ownerApp);
      if (value !== undefined) return value;
    }
    return undefined;
  }

  /** Framework `ui.*` messages resolved for a user locale (system default 'en'). */
  uiMessages(userLocale: string): Record<string, string> {
    const messages: Record<string, string> = {};
    const keys = new Set<string>();
    for (const candidate of this.candidates) {
      if (candidate.app !== 'system') continue;
      for (const key of Object.keys(candidate.resources)) {
        if (isFrameworkResourceKey(key)) keys.add(key);
      }
    }
    const chain = localeChain(userLocale, DEFAULT_LOCALE);
    for (const key of keys) {
      for (const locale of chain) {
        const value = this.lookup(key, locale, 'system');
        if (value !== undefined) { messages[key] = value; break; }
      }
    }
    return messages;
  }

  /** Locales that resolve at least one framework `ui.*` key. */
  frameworkLocales(): string[] {
    const locales = new Set<string>();
    for (const candidate of this.candidates) {
      if (candidate.app !== 'system') continue;
      if (Object.keys(candidate.resources).some(isFrameworkResourceKey)) locales.add(candidate.locale);
    }
    return [...locales].sort();
  }

  /** Locales available for one app: its defaultLocale plus every locale that
   * translates its artifacts (own translations and dependent apps'). */
  localesForApp(appName: string): string[] {
    const locales = new Set<string>([this.registry.defaultLocaleOf(appName)]);
    for (const candidate of this.candidates) {
      if (candidate.app === appName || this.registry.appDependsOn(candidate.app, appName)) locales.add(candidate.locale);
    }
    return [...locales].sort();
  }
}

export interface TranslationDiagnostic {
  kind: 'duplicate' | 'missing-target';
  locale: string;
  key: string;
  message: string;
}

/** Designer warnings: duplicate keys per locale and resources without a live target. */
export function translationDiagnostics(registry: MetadataRegistry): TranslationDiagnostic[] {
  const diagnostics: TranslationDiagnostic[] = [];
  const grouped = new Map<string, { locale: string; key: string; artifacts: string[] }>();
  for (const translation of registry.allTranslations()) {
    for (const key of Object.keys(translation.resources)) {
      const localeKey = `${translation.locale.toLowerCase()}\0${key}`;
      const entry = grouped.get(localeKey) ?? { locale: translation.locale, key, artifacts: [] };
      entry.artifacts.push(translation.name);
      grouped.set(localeKey, entry);
    }
  }
  for (const entry of grouped.values()) {
    if (new Set(entry.artifacts).size > 1) {
      diagnostics.push({
        kind: 'duplicate',
        locale: entry.locale,
        key: entry.key,
        message: `Key '${entry.key}' (${entry.locale}) is defined by ${entry.artifacts.length} translations: ${entry.artifacts.join(', ')} — the highest layer wins`,
      });
    }
    if (!resourceTargetExists(registry, entry.key)) {
      diagnostics.push({
        kind: 'missing-target',
        locale: entry.locale,
        key: entry.key,
        message: `Key '${entry.key}' (${entry.locale}) does not match a current metadata target`,
      });
    }
  }
  return diagnostics;
}
