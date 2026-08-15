import { describe, expect, it } from 'vitest';
import type { MenuExtensionMeta } from '@emu/core';
import {
  buildMenuExtensionTree,
  newMenuItem,
  resetInheritedDelta,
  updateInheritedDelta,
} from '../src/views/designer/menuExtensionTree';

describe('menu extension effective tree editor', () => {
  const layers = [
    {
      editable: false, layer: 'SYS', artifact: {
        kind: 'menu', name: 'APP_Menu', items: [
          { id: 'root', label: 'Root', icon: 'grid', target: { type: 'group' }, items: [
            { id: 'leaf', label: 'Leaf', target: { type: 'form', name: 'APP_Form' } },
          ] },
        ],
      },
    },
  ];

  it('shows inherited and current items in one tree while serializing only delta', () => {
    const extension: MenuExtensionMeta = {
      kind: 'menuExtension', name: 'APP_Custom_APP_Menu_Extension', menu: 'APP_Menu', layer: 'CUS',
      items: [{ id: 'added', parentId: 'root', label: 'Added', target: { type: 'form', name: 'APP_Form' } }],
      itemOverrides: [{ targetId: 'leaf', label: 'Renamed' }],
    };
    const tree = buildMenuExtensionTree(layers, extension);
    expect(tree[0].__inherited).toBe(true);
    expect(tree[0].items?.map((item) => [item.label, item.__inherited])).toEqual([['Renamed', true], ['Added', false]]);
    expect(JSON.stringify(extension)).not.toContain('__inherited');
    expect(extension).not.toHaveProperty('effective');
  });

  it('creates and resets minimal inherited overrides', () => {
    const extension: MenuExtensionMeta = { kind: 'menuExtension', name: 'APP_Custom_APP_Menu_Extension', menu: 'APP_Menu' };
    const leaf = buildMenuExtensionTree(layers, extension)[0].items![0];
    updateInheritedDelta(extension, leaf, 'label', 'Changed');
    updateInheritedDelta(extension, leaf, 'visible', false);
    updateInheritedDelta(extension, leaf, 'target', { type: 'form', name: 'APP_OtherForm' });
    expect(extension.itemOverrides).toEqual([{
      targetId: 'leaf', label: 'Changed', visible: false, target: { type: 'form', name: 'APP_OtherForm' },
    }]);
    resetInheritedDelta(extension, leaf);
    expect(extension.itemOverrides).toBeUndefined();
    expect(leaf).toEqual(expect.objectContaining({ label: 'Leaf', target: { type: 'form', name: 'APP_Form' } }));
  });

  it('keeps editor-only state out of new item JSON', () => {
    const item = newMenuItem('root');
    expect(item.__inherited).toBe(false);
    expect(JSON.parse(JSON.stringify(item))).toEqual(expect.objectContaining({ parentId: 'root', visible: true }));
    expect(JSON.stringify(item)).not.toContain('__inherited');
  });

  it('persists visible=true when overriding a legacy hidden item', () => {
    const hiddenLayers = [{
      editable: false, layer: 'SYS', artifact: {
        kind: 'menu', name: 'APP_Menu', items: [{ id: 'legacy-hidden', label: 'Hidden', hidden: true, target: { type: 'group' } }],
      },
    }];
    const extension: MenuExtensionMeta = { kind: 'menuExtension', name: 'APP_Custom_APP_Menu_Extension', menu: 'APP_Menu' };
    const item = buildMenuExtensionTree(hiddenLayers, extension)[0];
    updateInheritedDelta(extension, item, 'visible', true);
    expect(extension.itemOverrides).toEqual([{ targetId: 'legacy-hidden', visible: true }]);
  });
});
