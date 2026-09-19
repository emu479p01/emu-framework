import type { MetadataRegistry } from '@emu/core';
import {
  LocaleResolver,
  appLabelKey,
  artifactLabelKey,
  enumLabelKey,
  enumValueLabelKey,
  formActionLabelKey,
  formGroupLabelKey,
  formLabelKey,
  formLineActionLabelKey,
  formLineLabelKey,
  menuItemLabelKey,
  menuLabelKey,
  modelLabelKey,
  reportElementTextKey,
  reportParameterLabelKey,
  tableFieldLabelKey,
  tableLabelKey,
} from '@emu/core';

function localizeMenuItems(resolver: LocaleResolver, items: Array<Record<string, any>>, menuName: string, ownerApp: string, locale: string): void {
  for (const item of items) {
    if (item.id) {
      const translated = resolver.resolve(menuItemLabelKey(menuName, item.id), ownerApp, locale);
      if (translated !== undefined) item.label = translated;
    }
    if (Array.isArray(item.items)) localizeMenuItems(resolver, item.items, menuName, ownerApp, locale);
  }
}

/**
 * Localizes a metadata API payload without changing stored/default labels.
 * Each key resolves per-key against the owning app's defaultLocale with
 * layer precedence, then the payload gains locale, availableLocales and
 * resolved framework uiMessages.
 */
export function localizeMetadata<T extends Record<string, any>>(registry: MetadataRegistry, payload: T, locale: string): T {
  const resolver = new LocaleResolver(registry);
  const localized = structuredClone(payload);
  const applyLabel = (value: Record<string, any>, key: string, ownerApp: string | undefined): void => {
    const translated = resolver.resolve(key, ownerApp, locale);
    if (translated !== undefined) value.label = translated;
  };
  for (const app of localized.apps ?? []) {
    applyLabel(app, appLabelKey(app.name), app.name);
    for (const model of app.models ?? []) applyLabel(model, modelLabelKey(app.name, model.name), app.name);
    for (const menu of app.menus ?? []) {
      applyLabel(menu, menuLabelKey(menu.name), app.name);
      localizeMenuItems(resolver, menu.items ?? [], menu.name, app.name, locale);
    }
  }
  for (const menu of localized.frameworkMenus ?? []) {
    applyLabel(menu, menuLabelKey(menu.name), 'system');
    localizeMenuItems(resolver, menu.items ?? [], menu.name, 'system', locale);
  }
  for (const table of localized.tables ?? []) {
    const owner = registry.appForArtifact(table.name);
    applyLabel(table, tableLabelKey(table.name), owner);
    for (const field of table.fields ?? []) applyLabel(field, tableFieldLabelKey(table.name, field.name), owner);
  }
  for (const entry of localized.enums ?? []) {
    const owner = registry.appForArtifact(entry.name);
    applyLabel(entry, enumLabelKey(entry.name), owner);
    for (const value of entry.values ?? []) applyLabel(value, enumValueLabelKey(entry.name, value.name), owner);
  }
  for (const form of localized.forms ?? []) {
    const owner = registry.appForArtifact(form.name);
    applyLabel(form, formLabelKey(form.name), owner);
    for (const group of form.groups ?? []) if (group.id) applyLabel(group, formGroupLabelKey(form.name, group.id), owner);
    for (const action of form.actions ?? []) if (action.id) applyLabel(action, formActionLabelKey(form.name, action.id), owner);
    for (const line of form.lines ?? []) {
      if (line.id) applyLabel(line, formLineLabelKey(form.name, line.id), owner);
      for (const action of line.actions ?? []) if (action.id) applyLabel(action, formLineActionLabelKey(form.name, line.id, action.id), owner);
    }
  }
  const artifactKinds = [
    { list: 'reports', kind: 'report' as const },
    { list: 'views', kind: 'view' as const },
    { list: 'charts', kind: 'chart' as const },
    { list: 'privileges', kind: 'privilege' as const },
    { list: 'duties', kind: 'duty' as const },
    { list: 'roles', kind: 'role' as const },
    { list: 'dataEntities', kind: 'dataEntity' as const },
  ];
  for (const { list, kind } of artifactKinds) {
    for (const artifact of localized[list] ?? []) applyLabel(artifact, artifactLabelKey(kind, artifact.name), registry.appForArtifact(artifact.name));
  }
  for (const report of localized.reports ?? []) {
    const owner = registry.appForArtifact(report.name);
    for (const parameter of report.parameters ?? []) applyLabel(parameter, reportParameterLabelKey(report.name, parameter.field), owner);
    for (const band of report.bands ?? []) for (const element of band.elements ?? []) {
      if (element.type !== 'text') continue;
      const translated = resolver.resolve(reportElementTextKey(report.name, element.id), owner, locale);
      if (translated !== undefined) element.text = translated;
    }
  }
  const available = new Set<string>();
  for (const app of localized.apps ?? []) for (const candidate of app.availableLocales ?? []) available.add(candidate);
  for (const candidate of resolver.frameworkLocales()) available.add(candidate);
  (localized as Record<string, any>).locale = locale;
  (localized as Record<string, any>).availableLocales = [...available].sort();
  (localized as Record<string, any>).uiMessages = resolver.uiMessages(locale);
  return localized;
}

/** Localizes archive Data Entity labels for admin screens with the same resolver. */
export function localizeArchiveEntities(kernel: { registry: MetadataRegistry }, entities: Array<{ name: string; label?: string; businessDateField?: string }>, locale: string): Array<{ name: string; label?: string; businessDateField?: string }> {
  const resolver = new LocaleResolver(kernel.registry);
  return entities.map((entity) => {
    const translated = resolver.resolve(artifactLabelKey('dataEntity', entity.name), kernel.registry.appForArtifact(entity.name), locale);
    return { ...entity, label: translated ?? entity.label ?? entity.name };
  });
}
