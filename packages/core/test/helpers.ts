import DatabaseCtor from 'better-sqlite3';
import type { Database } from 'better-sqlite3';
import {
  MetadataRegistry,
  DataContext,
  syncSchema,
  type TableMeta,
  type EnumMeta,
} from '../src/index.js';

export const salesStatusEnum: EnumMeta = {
  kind: 'enum',
  name: 'TESTAPP_SalesStatus',
  values: [
    { name: 'Open', value: 0 },
    { name: 'Posted', value: 1 },
  ],
};

export const TESTAPP_CustTable: TableMeta = {
  kind: 'table',
  name: 'TESTAPP_CustTable',
  titleField: 'name',
  fields: [
    { name: 'accountNum', type: 'string', mandatory: true, maxLength: 20 },
    { name: 'name', type: 'string', mandatory: true },
    { name: 'creditMax', type: 'real', default: 0 },
  ],
  indexes: [{ name: 'AccountIdx', fields: ['accountNum'], unique: true }],
};

export const TESTAPP_SalesTable: TableMeta = {
  kind: 'table',
  name: 'TESTAPP_SalesTable',
  fields: [
    { name: 'salesId', type: 'string', mandatory: true },
    { name: 'custId', type: 'reference', reference: { table: 'TESTAPP_CustTable' } },
    { name: 'status', type: 'enum', enumName: 'TESTAPP_SalesStatus', default: 0 },
    { name: 'totalAmount', type: 'real', default: 0 },
  ],
};

export function testRegistry(): MetadataRegistry {
  const registry = new MetadataRegistry();
  registry.registerApp({ name: 'testapp' }, [salesStatusEnum, TESTAPP_CustTable, TESTAPP_SalesTable]);
  return registry;
}

export function testContext(): { ctx: DataContext; db: Database; registry: MetadataRegistry } {
  const db = new DatabaseCtor(':memory:');
  const registry = testRegistry();
  syncSchema(db, registry);
  const ctx = new DataContext(db, registry, { user: 'tester' });
  return { ctx, db, registry };
}
