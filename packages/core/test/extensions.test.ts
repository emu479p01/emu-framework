import { describe, it, expect } from 'vitest';
import DatabaseCtor from 'better-sqlite3';
import {
  MetadataRegistry,
  MetadataError,
  syncSchema,
  type FormMeta,
  type MenuMeta,
  type TableExtensionMeta,
  type FormExtensionMeta,
  type MenuExtensionMeta,
} from '../src/index.js';
import { TESTAPP_CustTable, salesStatusEnum, TESTAPP_SalesTable, testManifest } from './helpers.js';

const baseForm: FormMeta = {
  kind: 'form',
  name: 'TESTAPP_CustForm',
  table: 'TESTAPP_CustTable',
  listFields: ['accountNum', 'name'],
  groups: [{ label: 'General', fields: ['accountNum', 'name'] }],
};
const baseMenu: MenuMeta = { kind: 'menu', name: 'TESTAPP_Main', items: [{ form: 'TESTAPP_CustForm' }] };

function baseRegistry(): MetadataRegistry {
  const registry = new MetadataRegistry();
  registry.registerApp(testManifest('testapp', 'SYS'), [salesStatusEnum, TESTAPP_CustTable, TESTAPP_SalesTable, baseForm, baseMenu]);
  return registry;
}

const tableExt: TableExtensionMeta = {
  kind: 'tableExtension',
  name: 'TESTAPP_CustTable_Extension',
  table: 'TESTAPP_CustTable',
  fields: [{ name: 'creditLimit', type: 'real', default: 0 }],
};

describe('extensions', () => {
  it.each([
    ['ISV', 'SYS'], ['LOC', 'SYS'], ['LOC', 'ISV'], ['DEV', 'LOC'], ['CUS', 'DEV'],
  ] as const)('allows %s to extend %s', (source, target) => {
    const registry = new MetadataRegistry();
    registry.registerApp(testManifest('base', target), [{ kind: 'table', name: 'BASE_T', fields: [] }]);
    registry.registerApp({ ...testManifest('ext', source), dependsOn: ['base'] }, [{ kind: 'tableExtension', name: `EXT_ClientCustom_BASE_T_Extension`, table: 'BASE_T', fields: [{ name: 'added', type: 'string' }] }]);
    expect(registry.getTable('BASE_T').fields[0].name).toBe('added');
  });

  it.each([['CUS', 'CUS'], ['LOC', 'DEV'], ['SYS', 'ISV']] as const)('rejects %s extending %s', (source, target) => {
    const registry = new MetadataRegistry();
    registry.registerApp(testManifest('base', target), [{ kind: 'table', name: 'BASE_T', fields: [] }]);
    expect(() => registry.registerApp({ ...testManifest('ext', source), dependsOn: ['base'] }, [{ kind: 'tableExtension', name: 'EXT_ClientCustom_BASE_T_Extension', table: 'BASE_T' }])).toThrow(/must be higher/);
  });

  it('requires a dependency for cross-app extensions', () => {
    const registry = new MetadataRegistry();
    registry.registerApp(testManifest('base', 'SYS'), [{ kind: 'table', name: 'BASE_T', fields: [] }]);
    expect(() => registry.registerApp(testManifest('ext', 'CUS'), [{ kind: 'tableExtension', name: 'EXT_ClientCustom_BASE_T_Extension', table: 'BASE_T' }])).toThrow(/must depend/);
  });
  it('table extension adds fields to the effective table', () => {
    const registry = baseRegistry();
    registry.registerApp({ ...testManifest('testapp.ext'), dependsOn: ['testapp'] }, [tableExt]);
    const fields = registry.getTable('TESTAPP_CustTable').fields.map((f) => f.name);
    expect(fields).toContain('creditLimit');
  });

  it('applies only safe field overrides and normalizes read-only fields', () => {
    const registry = baseRegistry();
    registry.registerApp({ ...testManifest('testapp.ext'), dependsOn: ['testapp'] }, [{
      kind: 'tableExtension', name: 'TESTAPP_ClientCustom_TESTAPP_CustTable_Extension', table: 'TESTAPP_CustTable',
      fieldOverrides: [{ field: 'name', label: 'Customer name', readOnly: true }],
    }]);
    const field = registry.getTable('TESTAPP_CustTable').fields.find((item) => item.name === 'name')!;
    expect(field).toMatchObject({ label: 'Customer name', readOnly: true });
    expect(field.mandatory).toBeUndefined();
  });

  it('keeps enum numeric values stable while allowing label overrides', () => {
    const registry = baseRegistry();
    const original = registry.getEnum('TESTAPP_SalesStatus').values[0].value;
    registry.registerApp({ ...testManifest('testapp.ext'), dependsOn: ['testapp'] }, [{
      kind: 'enumExtension', name: 'TESTAPP_ClientCustom_TESTAPP_SalesStatus_Extension', enum: 'TESTAPP_SalesStatus', values: [],
      valueOverrides: [{ name: registry.getEnum('TESTAPP_SalesStatus').values[0].name, label: 'Localized' }],
    }]);
    expect(registry.getEnum('TESTAPP_SalesStatus').values[0]).toMatchObject({ value: original, label: 'Localized' });
  });

  it('extended fields reach the DB schema', () => {
    const registry = baseRegistry();
    registry.registerApp({ ...testManifest('testapp.ext'), dependsOn: ['testapp'] }, [tableExt]);
    const db = new DatabaseCtor(':memory:');
    syncSchema(db, registry);
    const cols = (db.prepare(`PRAGMA table_info("TESTAPP_CustTable")`).all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toContain('creditLimit');
  });

  it('form extension appends groups and listFields', () => {
    const registry = baseRegistry();
    const formExt: FormExtensionMeta = {
      kind: 'formExtension',
      name: 'TESTAPP_CustForm_Extension',
      form: 'TESTAPP_CustForm',
      listFields: ['creditLimit'],
      groups: [{ label: 'Credit', fields: ['creditLimit'] }],
    };
    registry.registerApp({ ...testManifest('testapp.ext'), dependsOn: ['testapp'] }, [tableExt, formExt]);
    const form = registry.getForm('TESTAPP_CustForm');
    expect(form.listFields).toEqual(['accountNum', 'name', 'creditLimit']);
    expect(form.groups).toHaveLength(2);
  });

  it('menu extension appends items', () => {
    const registry = baseRegistry();
    const menuExt: MenuExtensionMeta = {
      kind: 'menuExtension',
      name: 'TESTAPP_Main_Extension',
      menu: 'TESTAPP_Main',
      items: [{ label: 'Again', form: 'TESTAPP_CustForm' }],
    };
    registry.registerApp({ ...testManifest('testapp.ext'), dependsOn: ['testapp'] }, [menuExt]);
    expect(registry.allMenus()[0].items).toHaveLength(2);
  });

  it('menu extension supports nested sub-items', () => {
    const registry = baseRegistry();
    const menuExt: MenuExtensionMeta = {
      kind: 'menuExtension',
      name: 'TESTAPP_Main_Extension',
      menu: 'TESTAPP_Main',
      items: [{ label: 'Group', items: [{ label: 'Nested', form: 'TESTAPP_CustForm' }] }],
    };
    registry.registerApp({ ...testManifest('testapp.ext'), dependsOn: ['testapp'] }, [menuExt]);
    const items = registry.allMenus()[0].items;
    expect(items).toHaveLength(2);
    expect(items[1].items).toEqual([expect.objectContaining({ label: 'Nested', form: 'TESTAPP_CustForm', id: expect.any(String) })]);
  });

  it('menu extension overrides target and visibility without copying inherited items', () => {
    const registry = new MetadataRegistry();
    registry.registerApp(testManifest('testapp', 'SYS'), [salesStatusEnum, TESTAPP_CustTable, TESTAPP_SalesTable, baseForm, {
      kind: 'menu', name: 'TESTAPP_Main', items: [
        { id: 'customers', label: 'Customers', hidden: true, target: { type: 'group' }, items: [
          { id: 'customer-list', label: 'Customer list', target: { type: 'group' } },
        ] },
      ],
    }]);
    const extension: MenuExtensionMeta = {
      kind: 'menuExtension', name: 'TESTAPP_ClientCustom_TESTAPP_Main_Extension', menu: 'TESTAPP_Main',
      itemOverrides: [
        { targetId: 'customers', label: 'Accounts', visible: true, order: 20 },
        { targetId: 'customer-list', target: { type: 'form', name: 'TESTAPP_CustForm' }, visible: false },
      ],
    };
    registry.registerApp({ ...testManifest('testapp.ext'), dependsOn: ['testapp'] }, [extension]);
    const menu = registry.allMenus()[0];
    expect(extension).not.toHaveProperty('items');
    expect(menu.items[0]).toEqual(expect.objectContaining({ label: 'Accounts', visible: true, hidden: true, order: 20 }));
    expect(menu.items[0].items?.[0]).toEqual(expect.objectContaining({ visible: false, target: { type: 'form', name: 'TESTAPP_CustForm' } }));
  });

  it('attaches extension root items to an inherited parentId', () => {
    const registry = new MetadataRegistry();
    registry.registerApp(testManifest('testapp', 'SYS'), [salesStatusEnum, TESTAPP_CustTable, TESTAPP_SalesTable, baseForm, {
      kind: 'menu', name: 'TESTAPP_Main', items: [{ id: 'customers', label: 'Customers', target: { type: 'group' }, items: [] }],
    }]);
    registry.registerApp({ ...testManifest('testapp.ext'), dependsOn: ['testapp'] }, [{
      kind: 'menuExtension', name: 'TESTAPP_ClientCustom_TESTAPP_Main_Extension', menu: 'TESTAPP_Main',
      items: [{ id: 'customer-list', parentId: 'customers', label: 'Customer list', target: { type: 'form', name: 'TESTAPP_CustForm' } }],
    }]);
    expect(registry.allMenus()[0].items).toHaveLength(1);
    expect(registry.allMenus()[0].items[0].items).toEqual([expect.objectContaining({ id: 'customer-list', parentId: 'customers', label: 'Customer list' })]);
  });

  it('menu extension inserts items at an exact stable-id path', () => {
    const registry = new MetadataRegistry();
    registry.registerApp(testManifest('testapp', 'SYS'), [salesStatusEnum, TESTAPP_CustTable, TESTAPP_SalesTable, baseForm, {
      kind: 'menu', name: 'TESTAPP_Main', items: [{ id: 'level-1-a', label: 'Level 1 A', target: { type: 'group' }, items: [
        { id: 'level-2-a', label: 'Level 2 A', target: { type: 'group' }, items: [] },
      ] }],
    }]);
    registry.registerApp({ ...testManifest('testapp.ext'), dependsOn: ['testapp'] }, [{
      kind: 'menuExtension', name: 'TESTAPP_ClientCustom_TESTAPP_Main_Extension', menu: 'TESTAPP_Main',
      items: [{ label: 'Root form', form: 'TESTAPP_CustForm' }],
      insertions: [{ path: ['level-1-a', 'level-2-a'], items: [{ label: 'Nested form', form: 'TESTAPP_CustForm' }] }],
    }]);
    const root = registry.allMenus()[0].items;
    expect(root).toHaveLength(2);
    expect(root[0].items?.[0].items).toEqual([expect.objectContaining({ label: 'Nested form', form: 'TESTAPP_CustForm' })]);
  });

  it('rejects missing, ambiguous and leaf menu insertion paths', () => {
    const make = (path: string[]) => ({
      kind: 'menuExtension' as const, name: 'TESTAPP_ClientCustom_TESTAPP_Main_Extension', menu: 'TESTAPP_Main',
      insertions: [{ path, items: [{ label: 'Nested form', form: 'TESTAPP_CustForm' }] }],
    });
    const missing = baseRegistry();
    expect(() => missing.registerApp({ ...testManifest('testapp.ext'), dependsOn: ['testapp'] }, [make(['missing'])])).toThrow(/menu path 'missing' was not found/);

    const leaf = baseRegistry();
    const leafId = leaf.allMenus()[0].items[0].id!;
    expect(() => leaf.registerApp({ ...testManifest('testapp.ext'), dependsOn: ['testapp'] }, [make([leafId])])).toThrow(/targets a leaf item/);
  });

  it('rejects extending unknown tables and duplicate fields', () => {
    const registry = baseRegistry();
    expect(() =>
      registry.registerApp({ ...testManifest('testapp.ext'), dependsOn: ['testapp'] }, [
        { ...tableExt, table: 'Nope' } as TableExtensionMeta,
      ]),
    ).toThrow(MetadataError);
    expect(() =>
      registry.registerApp({ ...testManifest('testapp.ext2'), dependsOn: ['testapp'] }, [
        {
          kind: 'tableExtension',
          name: 'TESTAPP_Dup_Extension',
          table: 'TESTAPP_CustTable',
          fields: [{ name: 'name', type: 'string' }],
        } as TableExtensionMeta,
      ]),
    ).toThrow(/already exists/);
  });

  it('does not mutate caller-provided metadata objects', () => {
    const registry = baseRegistry();
    registry.registerApp({ ...testManifest('testapp.ext'), dependsOn: ['testapp'] }, [tableExt]);
    expect(TESTAPP_CustTable.fields.some((f) => f.name === 'creditLimit')).toBe(false);
  });
});
