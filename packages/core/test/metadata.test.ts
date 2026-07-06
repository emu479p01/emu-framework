import { describe, it, expect } from 'vitest';
import DatabaseCtor from 'better-sqlite3';
import { MetadataRegistry, MetadataError, syncSchema, type TableMeta } from '../src/index.js';
import { TESTAPP_CustTable, salesStatusEnum, TESTAPP_SalesTable, testRegistry } from './helpers.js';

describe('MetadataRegistry', () => {
  it('loads and validates a well-formed app', () => {
    const registry = testRegistry();
    expect(registry.getTable('TESTAPP_CustTable').fields).toHaveLength(3);
    expect(registry.getEnum('TESTAPP_SalesStatus').values[1].name).toBe('Posted');
  });

  it('rejects duplicate artifact names across apps', () => {
    const registry = testRegistry();
    expect(() => registry.registerApp({ name: 'testapp.ext' }, [TESTAPP_CustTable])).toThrow(MetadataError);
  });

  it('rejects unknown enum references', () => {
    const registry = new MetadataRegistry();
    const bad: TableMeta = {
      kind: 'table',
      name: 'A_Bad',
      fields: [{ name: 'x', type: 'enum', enumName: 'Nope' }],
    };
    expect(() => registry.registerApp({ name: 'a' }, [bad])).toThrow(/unknown enum/);
  });

  it('rejects unknown reference tables', () => {
    const registry = new MetadataRegistry();
    const bad: TableMeta = {
      kind: 'table',
      name: 'A_Bad',
      fields: [{ name: 'x', type: 'reference', reference: { table: 'Nope' } }],
    };
    expect(() => registry.registerApp({ name: 'a' }, [bad])).toThrow(/unknown reference/);
  });

  it('rejects reserved system field names', () => {
    const registry = new MetadataRegistry();
    const bad: TableMeta = {
      kind: 'table',
      name: 'A_Bad',
      fields: [{ name: 'id', type: 'int' }],
    };
    expect(() => registry.registerApp({ name: 'a' }, [bad])).toThrow(/reserved system field/);
  });

  it('rejects missing app dependencies', () => {
    const registry = new MetadataRegistry();
    expect(() => registry.registerApp({ name: 'ext', dependsOn: ['base'] }, [])).toThrow(
      /depends on 'base'/,
    );
  });
});

describe('syncSchema', () => {
  it('creates tables with system columns and indexes', () => {
    const db = new DatabaseCtor(':memory:');
    const result = syncSchema(db, testRegistry());
    expect(result.createdTables).toEqual(['TESTAPP_CustTable', 'TESTAPP_SalesTable']);
    const cols = (db.prepare(`PRAGMA table_info("TESTAPP_CustTable")`).all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toContain('id');
    expect(cols).toContain('createdBy');
    expect(cols).toContain('accountNum');
    const idx = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='TESTAPP_CustTable'`)
      .all() as { name: string }[];
    expect(idx.map((i) => i.name)).toContain('TESTAPP_CustTable_AccountIdx');
  });

  it('is idempotent and adds new columns additively', () => {
    const db = new DatabaseCtor(':memory:');
    syncSchema(db, testRegistry());

    // second sync with an extended table (simulates an extension adding a field)
    const registry2 = new MetadataRegistry();
    const custV2: TableMeta = {
      ...TESTAPP_CustTable,
      fields: [...TESTAPP_CustTable.fields, { name: 'phone', type: 'string' }],
    };
    registry2.registerApp({ name: 'testapp' }, [salesStatusEnum, custV2, TESTAPP_SalesTable]);
    const result = syncSchema(db, registry2);

    expect(result.createdTables).toHaveLength(0);
    expect(result.addedColumns).toEqual(['TESTAPP_CustTable.phone']);
  });
});
