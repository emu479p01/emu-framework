import type { IconName, MenuItemMeta, MenuItemOverrideMeta, MenuExtensionMeta } from '@emu/core';

export type MenuOverrideField = 'label' | 'icon' | 'target' | 'visible' | 'order';

export interface EditorMenuItem extends MenuItemMeta {
  __inherited?: boolean;
  __originLayer?: string;
  __baseline?: MenuItemMeta;
}

interface LayerEntry {
  artifact: Record<string, any>;
  layer: string;
  editable: boolean;
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function findItem(items: EditorMenuItem[], id: string): EditorMenuItem | undefined {
  for (const item of items) {
    if (item.id === id) return item;
    const nested = item.items ? findItem(item.items as EditorMenuItem[], id) : undefined;
    if (nested) return nested;
  }
}

function editorMeta(item: EditorMenuItem, key: '__inherited' | '__originLayer' | '__baseline', value: unknown): void {
  Object.defineProperty(item, key, { value, writable: true, configurable: true, enumerable: false });
}

function mark(items: EditorMenuItem[], layer: string, inherited: boolean): void {
  for (const item of items) {
    editorMeta(item, '__originLayer', layer);
    editorMeta(item, '__inherited', inherited);
    if (item.items) mark(item.items as EditorMenuItem[], layer, inherited);
  }
}

function appendExtensionItems(target: EditorMenuItem[], items: MenuItemMeta[], layer: string, inherited: boolean): void {
  for (const source of items) {
    const item = inherited ? clone(source) as EditorMenuItem : source as EditorMenuItem;
    mark([item], layer, inherited);
    if (item.parentId) {
      const parent = findItem(target, item.parentId);
      if (parent) { parent.items ??= []; (parent.items as EditorMenuItem[]).push(item); }
    } else target.push(item);
  }
}

function applyOverride(items: EditorMenuItem[], override: MenuItemOverrideMeta): void {
  const item = findItem(items, override.targetId);
  if (!item) return;
  for (const field of ['label', 'icon', 'visible', 'hidden', 'order'] as const) {
    if (override[field] !== undefined) (item as any)[field] = override[field];
  }
  if (override.target !== undefined) item.target = clone(override.target);
}

function applyLayer(items: EditorMenuItem[], artifact: Record<string, any>, layer: string, inherited: boolean): void {
  if (artifact.kind === 'menu') {
    items.splice(0, items.length, ...clone(artifact.items ?? []));
    mark(items, layer, inherited);
    return;
  }
  appendExtensionItems(items, artifact.items ?? [], layer, inherited);
  for (const insertion of artifact.insertions ?? []) {
    const parent = findItem(items, insertion.path.at(-1));
    if (!parent) continue;
    parent.items ??= [];
    const additions = inherited ? clone(insertion.items ?? []) : insertion.items ?? [];
    mark(additions, layer, inherited);
    (parent.items as EditorMenuItem[]).push(...additions);
  }
  for (const override of artifact.itemOverrides ?? []) applyOverride(items, override);
  sortTree(items);
}

function sortTree(items: EditorMenuItem[]): void {
  const decorated = items.map((item, index) => ({ item, index }));
  decorated.sort((a, b) => (a.item.order ?? a.index) - (b.item.order ?? b.index) || a.index - b.index);
  items.splice(0, items.length, ...decorated.map(({ item }) => item));
  for (const item of items) if (item.items) sortTree(item.items as EditorMenuItem[]);
}

function snapshotBaselines(items: EditorMenuItem[]): void {
  for (const item of items) {
    const { items: _items, __baseline: _baseline, __inherited: _inherited, __originLayer: _origin, ...fields } = item;
    editorMeta(item, '__baseline', clone(fields as MenuItemMeta));
    editorMeta(item, '__inherited', true);
    if (item.items) snapshotBaselines(item.items as EditorMenuItem[]);
  }
}

export function buildMenuExtensionTree(layers: LayerEntry[], current: MenuExtensionMeta): EditorMenuItem[] {
  const items: EditorMenuItem[] = [];
  for (const entry of layers.filter((layer) => !layer.editable)) applyLayer(items, entry.artifact, entry.layer, true);
  snapshotBaselines(items);
  applyLayer(items, current as unknown as Record<string, any>, current.layer ?? 'CUS', false);
  return items;
}

function equal(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }

export function updateInheritedDelta(extension: MenuExtensionMeta, item: EditorMenuItem, field: MenuOverrideField, value: unknown): void {
  if (!item.id || !item.__inherited) return;
  const overrides = extension.itemOverrides ??= [];
  let override = overrides.find((entry) => entry.targetId === item.id);
  const baseline = field === 'visible'
    ? (item.__baseline?.visible ?? item.__baseline?.hidden !== true)
    : item.__baseline?.[field as keyof MenuItemMeta];
  if (equal(value, baseline)) {
    if (override) delete (override as any)[field];
  } else {
    override ??= { targetId: item.id };
    if (!overrides.includes(override)) overrides.push(override);
    (override as any)[field] = clone(value);
  }
  item[field as keyof EditorMenuItem] = clone(value) as never;
  if (field === 'visible') delete item.hidden;
  if (override && Object.keys(override).length === 1) overrides.splice(overrides.indexOf(override), 1);
  if (overrides.length === 0) delete extension.itemOverrides;
}

export function resetInheritedDelta(extension: MenuExtensionMeta, item: EditorMenuItem): void {
  if (!item.id || !item.__baseline) return;
  if (extension.itemOverrides) {
    extension.itemOverrides = extension.itemOverrides.filter((entry) => entry.targetId !== item.id);
    if (extension.itemOverrides.length === 0) delete extension.itemOverrides;
  }
  for (const field of ['label', 'icon', 'target', 'visible', 'order'] as const) {
    const baseline = item.__baseline[field];
    if (baseline === undefined) delete (item as any)[field]; else (item as any)[field] = clone(baseline);
  }
  if (item.__baseline.hidden === undefined) delete item.hidden; else item.hidden = item.__baseline.hidden;
}

export function newMenuItem(parentId?: string): EditorMenuItem {
  const item: EditorMenuItem = {
    id: `menu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    ...(parentId ? { parentId } : {}), label: '', icon: 'grid' as IconName, visible: true, target: { type: 'group' },
  };
  editorMeta(item, '__inherited', false);
  return item;
}

export function removeExtensionItem(extension: MenuExtensionMeta, id: string): void {
  const remove = (items: MenuItemMeta[] | undefined): boolean => {
    if (!items) return false;
    const index = items.findIndex((item) => item.id === id);
    if (index >= 0) { items.splice(index, 1); return true; }
    return items.some((item) => remove(item.items));
  };
  if (remove(extension.items)) return;
  for (const insertion of extension.insertions ?? []) if (remove(insertion.items)) return;
}
