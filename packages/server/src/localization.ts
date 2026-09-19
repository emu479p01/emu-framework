import type { MetadataRegistry, TranslationMeta } from '@emu/core';

function resourcesFor(translations: TranslationMeta[], locale: string): Record<string, string> {
  const exact = locale.toLowerCase();
  const base = exact.split('-')[0];
  const result: Record<string, string> = {};
  for (const candidate of [base, exact]) {
    for (const translation of translations) {
      if (translation.locale.toLowerCase() === candidate) Object.assign(result, translation.resources);
    }
  }
  return result;
}

function applyLabel(value: Record<string, any>, key: string, resources: Record<string, string>): void {
  if (resources[key] !== undefined) value.label = resources[key];
}

function localizeMenuItems(items: Array<Record<string, any>>, menuName: string, resources: Record<string, string>): void {
  for (const item of items) {
    if (item.id) applyLabel(item, `menu.${menuName}.item.${item.id}.label`, resources);
    if (Array.isArray(item.items)) localizeMenuItems(item.items, menuName, resources);
  }
}

/** Localizes a metadata API payload without changing stored/default labels. */
export function localizeMetadata<T extends Record<string, any>>(registry: MetadataRegistry, payload: T, locale: string): T {
  const translations = registry.allTranslations();
  const resources = resourcesFor(translations, locale);
  const localized = structuredClone(payload);
  for (const app of localized.apps ?? []) {
    applyLabel(app, `app.${app.name}.label`, resources);
    for (const model of app.models ?? []) applyLabel(model, `model.${app.name}.${model.name}.label`, resources);
    for (const menu of app.menus ?? []) { applyLabel(menu, `menu.${menu.name}.label`, resources); localizeMenuItems(menu.items ?? [], menu.name, resources); }
  }
  for (const menu of localized.frameworkMenus ?? []) { applyLabel(menu, `menu.${menu.name}.label`, resources); localizeMenuItems(menu.items ?? [], menu.name, resources); }
  for (const table of localized.tables ?? []) {
    applyLabel(table, `table.${table.name}.label`, resources);
    for (const field of table.fields ?? []) applyLabel(field, `table.${table.name}.field.${field.name}.label`, resources);
  }
  for (const entry of localized.enums ?? []) {
    applyLabel(entry, `enum.${entry.name}.label`, resources);
    for (const value of entry.values ?? []) applyLabel(value, `enum.${entry.name}.value.${value.name}.label`, resources);
  }
  for (const form of localized.forms ?? []) {
    applyLabel(form, `form.${form.name}.label`, resources);
    for (const group of form.groups ?? []) if (group.id) applyLabel(group, `form.${form.name}.group.${group.id}.label`, resources);
    for (const action of form.actions ?? []) if (action.id) applyLabel(action, `form.${form.name}.action.${action.id}.label`, resources);
    for (const line of form.lines ?? []) {
      if (line.id) applyLabel(line, `form.${form.name}.line.${line.id}.label`, resources);
      for (const action of line.actions ?? []) if (action.id) applyLabel(action, `form.${form.name}.line.${line.id}.action.${action.id}.label`, resources);
    }
  }
  for (const kind of ['reports', 'views', 'charts', 'privileges', 'duties', 'roles', 'dataEntities']) {
    const singular = kind === 'dataEntities' ? 'dataEntity' : kind.slice(0, -1);
    for (const artifact of localized[kind] ?? []) applyLabel(artifact, `${singular}.${artifact.name}.label`, resources);
  }
  for (const report of localized.reports ?? []) {
    for (const parameter of report.parameters ?? []) applyLabel(parameter, `report.${report.name}.parameter.${parameter.field}.label`, resources);
    for (const band of report.bands ?? []) for (const element of band.elements ?? []) {
      const translated = resources[`report.${report.name}.element.${element.id}.text`];
      if (translated !== undefined && element.type === 'text') element.text = translated;
    }
  }
  (localized as Record<string, any>).locale = locale;
  (localized as Record<string, any>).availableLocales = [...new Set(['en', 'th', ...translations.map((entry) => entry.locale)])].sort();
  return localized;
}
