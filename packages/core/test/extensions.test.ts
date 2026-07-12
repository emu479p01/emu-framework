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
  registry.registerApp(testManifest('testapp'), [salesStatusEnum, TESTAPP_CustTable, TESTAPP_SalesTable, baseForm, baseMenu]);
  return registry;
}

const tableExt: TableExtensionMeta = {
  kind: 'tableExtension',
  name: 'TESTAPP_CustTable_Extension',
  table: 'TESTAPP_CustTable',
  fields: [{ name: 'creditLimit', type: 'real', default: 0 }],
};

describe('extensions', () => {
  it('table extension adds fields to the effective table', () => {
    const registry = baseRegistry();
    registry.registerApp({ ...testManifest('testapp.ext'), dependsOn: ['testapp'] }, [tableExt]);
    const fields = registry.getTable('TESTAPP_CustTable').fields.map((f) => f.name);
    expect(fields).toContain('creditLimit');
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
    expect(items[1].items).toEqual([{ label: 'Nested', form: 'TESTAPP_CustForm' }]);
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
