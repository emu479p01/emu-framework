import { describe, it, expect } from 'vitest';
import DatabaseCtor from 'better-sqlite3';
import { MetadataRegistry, MetadataError, syncSchema, validateMetadataArtifact, type TableMeta, type FormMeta, type ReportMeta } from '../src/index.js';
import { TESTAPP_CustTable, salesStatusEnum, TESTAPP_SalesTable, testRegistry, testManifest } from './helpers.js';

describe('MetadataRegistry', () => {
  it('accepts optional safe icons and rejects unknown icon tokens', () => {
    expect(validateMetadataArtifact({ kind: 'app', name: 'plain' })).toEqual([]);
    expect(validateMetadataArtifact({ kind: 'app', name: 'safe', icon: 'chart' })).toEqual([]);
    expect(validateMetadataArtifact({ kind: 'app', name: 'unsafe', icon: '<svg>' }).some((item) => item.path.includes('icon'))).toBe(true);

    const registry = new MetadataRegistry();
    expect(() => registry.registerApp(testManifest('a'),[{
      kind: 'menu', name: 'A_Menu', items: [{ label: 'Nested', items: [{ label: 'Bad', icon: 'unknown' as any }] }],
    }])).toThrow(/unknown icon/);
  });

  it('loads and validates a well-formed app', () => {
    const registry = testRegistry();
    expect(registry.getTable('TESTAPP_CustTable').fields).toHaveLength(3);
    expect(registry.getEnum('TESTAPP_SalesStatus').values[1].name).toBe('Posted');
  });

  it('rejects duplicate artifact names across apps', () => {
    const registry = testRegistry();
    expect(() => registry.registerApp(testManifest('testapp.ext'), [TESTAPP_CustTable])).toThrow(MetadataError);
  });

  it('rejects unknown enum references', () => {
    const registry = new MetadataRegistry();
    const bad: TableMeta = {
      kind: 'table',
      name: 'A_Bad',
      fields: [{ name: 'x', type: 'enum', enumName: 'Nope' }],
    };
    expect(() => registry.registerApp(testManifest('a'),[bad])).toThrow(/unknown enum/);
  });

  it('rejects unknown reference tables', () => {
    const registry = new MetadataRegistry();
    const bad: TableMeta = {
      kind: 'table',
      name: 'A_Bad',
      fields: [{ name: 'x', type: 'reference', reference: { table: 'Nope' } }],
    };
    expect(() => registry.registerApp(testManifest('a'),[bad])).toThrow(/unknown reference/);
  });

  it('rejects reserved system field names', () => {
    const registry = new MetadataRegistry();
    const bad: TableMeta = {
      kind: 'table',
      name: 'A_Bad',
      fields: [{ name: 'id', type: 'int' }],
    };
    expect(() => registry.registerApp(testManifest('a'),[bad])).toThrow(/reserved system field/);
  });

  it('rejects missing app dependencies', () => {
    const registry = new MetadataRegistry();
    expect(() => registry.registerApp({ ...testManifest('ext'), dependsOn: ['base'] }, [])).toThrow(
      /depends on 'base'/,
    );
  });

  it('accepts a line grid with valid count/sum aggregates', () => {
    const registry = new MetadataRegistry();
    const header: TableMeta = { kind: 'table', name: 'A_Header', fields: [{ name: 'name', type: 'string' }] };
    const line: TableMeta = {
      kind: 'table',
      name: 'A_Line',
      fields: [
        { name: 'headerId', type: 'reference', reference: { table: 'A_Header' } },
        { name: 'qty', type: 'real' },
      ],
    };
    const form: FormMeta = {
      kind: 'form',
      name: 'A_HeaderForm',
      table: 'A_Header',
      lines: [
        {
          table: 'A_Line',
          refField: 'headerId',
          fields: ['qty'],
          aggregates: [{ fn: 'count' }, { fn: 'sum', field: 'qty', label: 'Total qty' }],
        },
      ],
    };
    registry.registerApp(testManifest('a'),[header, line, form]);
    expect(registry.getForm('A_HeaderForm').lines?.[0].aggregates).toHaveLength(2);
  });

  it('rejects a line grid that displays its own refField as an editable column', () => {
    const registry = new MetadataRegistry();
    const header: TableMeta = { kind: 'table', name: 'A_Header', fields: [{ name: 'name', type: 'string' }] };
    const line: TableMeta = {
      kind: 'table',
      name: 'A_Line',
      fields: [
        { name: 'headerId', type: 'reference', reference: { table: 'A_Header' } },
        { name: 'qty', type: 'real' },
      ],
    };
    const form: FormMeta = {
      kind: 'form',
      name: 'A_HeaderForm',
      table: 'A_Header',
      lines: [{ table: 'A_Line', refField: 'headerId', fields: ['headerId', 'qty'] }],
    };
    expect(() => registry.registerApp(testManifest('a'),[header, line, form])).toThrow(
      /cannot display its own refField/,
    );
  });

  it('rejects a sum/avg aggregate missing a field', () => {
    const registry = new MetadataRegistry();
    const header: TableMeta = { kind: 'table', name: 'A_Header', fields: [{ name: 'name', type: 'string' }] };
    const line: TableMeta = {
      kind: 'table',
      name: 'A_Line',
      fields: [{ name: 'headerId', type: 'reference', reference: { table: 'A_Header' } }],
    };
    const form: FormMeta = {
      kind: 'form',
      name: 'A_HeaderForm',
      table: 'A_Header',
      lines: [{ table: 'A_Line', refField: 'headerId', fields: [], aggregates: [{ fn: 'sum' }] }],
    };
    expect(() => registry.registerApp(testManifest('a'),[header, line, form])).toThrow(/requires 'field'/);
  });

  it('rejects an aggregate on an unknown or non-numeric field', () => {
    const registry = new MetadataRegistry();
    const header: TableMeta = { kind: 'table', name: 'A_Header', fields: [{ name: 'name', type: 'string' }] };
    const line: TableMeta = {
      kind: 'table',
      name: 'A_Line',
      fields: [
        { name: 'headerId', type: 'reference', reference: { table: 'A_Header' } },
        { name: 'label', type: 'string' },
      ],
    };
    const formUnknown: FormMeta = {
      kind: 'form',
      name: 'A_HeaderForm',
      table: 'A_Header',
      lines: [{ table: 'A_Line', refField: 'headerId', fields: [], aggregates: [{ fn: 'sum', field: 'nope' }] }],
    };
    expect(() => registry.registerApp(testManifest('a'),[header, line, formUnknown])).toThrow(/aggregate field 'nope' not found/);

    const registry2 = new MetadataRegistry();
    const formNonNumeric: FormMeta = {
      kind: 'form',
      name: 'A_HeaderForm',
      table: 'A_Header',
      lines: [{ table: 'A_Line', refField: 'headerId', fields: [], aggregates: [{ fn: 'sum', field: 'label' }] }],
    };
    expect(() => registry2.registerApp(testManifest('a'),[header, line, formNonNumeric])).toThrow(/must be numeric/);
  });

  it('accepts a reference field with valid copyFields', () => {
    const registry = new MetadataRegistry();
    const ref: TableMeta = { kind: 'table', name: 'A_Item', fields: [{ name: 'price', type: 'real' }] };
    const main: TableMeta = {
      kind: 'table',
      name: 'A_Line',
      fields: [
        { name: 'item', type: 'reference', reference: { table: 'A_Item', copyFields: [{ from: 'price', to: 'price' }] } },
        { name: 'price', type: 'real' },
      ],
    };
    registry.registerApp(testManifest('a'),[ref, main]);
    expect(registry.getTable('A_Line').fields[0].reference?.copyFields).toEqual([{ from: 'price', to: 'price' }]);
  });

  it('rejects copyFields with an unknown source or target field', () => {
    const registry = new MetadataRegistry();
    const ref: TableMeta = { kind: 'table', name: 'A_Item', fields: [{ name: 'price', type: 'real' }] };
    const badFrom: TableMeta = {
      kind: 'table',
      name: 'A_Line',
      fields: [
        { name: 'item', type: 'reference', reference: { table: 'A_Item', copyFields: [{ from: 'nope', to: 'price' }] } },
        { name: 'price', type: 'real' },
      ],
    };
    expect(() => registry.registerApp(testManifest('a'),[ref, badFrom])).toThrow(/copyFields 'from' unknown field/);

    const registry2 = new MetadataRegistry();
    const badTo: TableMeta = {
      kind: 'table',
      name: 'A_Line',
      fields: [{ name: 'item', type: 'reference', reference: { table: 'A_Item', copyFields: [{ from: 'price', to: 'nope' }] } }],
    };
    expect(() => registry2.registerApp(testManifest('a'),[ref, badTo])).toThrow(/copyFields 'to' unknown\/invalid field/);
  });

  it('validates View grouping, typed filters, App dependencies, and protected tables', () => {
    const aggregateWithoutGrouping = new MetadataRegistry();
    expect(() => aggregateWithoutGrouping.registerApp(testManifest('testapp'), [
      salesStatusEnum, TESTAPP_CustTable, TESTAPP_SalesTable,
      {
        kind: 'view', name: 'TESTAPP_BadGrouping', source: { table: 'TESTAPP_SalesTable', alias: 's' },
        columns: [
          { name: 'salesId', expression: { type: 'field', ref: 's.salesId' } },
          { name: 'total', expression: { type: 'aggregate', fn: 'sum', ref: 's.totalAmount' } },
        ],
      },
    ])).toThrow(/must be in groupBy/);

    const wrongParameterType = new MetadataRegistry();
    expect(() => wrongParameterType.registerApp(testManifest('testapp'), [
      salesStatusEnum, TESTAPP_CustTable, TESTAPP_SalesTable,
      {
        kind: 'view', name: 'TESTAPP_BadParameter', source: { table: 'TESTAPP_CustTable', alias: 'c' },
        parameters: [{ name: 'minimum', type: 'real' }],
        filters: [{ ref: 'c.name', operator: 'eq', value: { parameter: 'minimum' } }],
        columns: [{ name: 'name', expression: { type: 'field', ref: 'c.name' } }],
      },
    ])).toThrow(/incompatible/);

    const crossApp = new MetadataRegistry();
    crossApp.registerApp(testManifest('base'), [{ kind: 'table', name: 'BASE_Record', fields: [{ name: 'name', type: 'string' }] }]);
    expect(() => crossApp.registerApp(testManifest('consumer'), [{
      kind: 'view', name: 'CONSUMER_Records', source: { table: 'BASE_Record', alias: 'b' },
      columns: [{ name: 'name', expression: { type: 'field', ref: 'b.name' } }],
    }])).toThrow(/must depend on 'base'/);

    const protectedRegistry = new MetadataRegistry();
    protectedRegistry.registerApp(testManifest('system', 'SYS'), [{ kind: 'table', name: 'FW_Secret', fields: [{ name: 'value', type: 'string' }] }]);
    expect(() => protectedRegistry.registerApp({ ...testManifest('consumer'), dependsOn: ['system'] }, [{
      kind: 'view', name: 'CONSUMER_Secrets', source: { table: 'FW_Secret', alias: 's' },
      columns: [{ name: 'value', expression: { type: 'field', ref: 's.value' } }],
    }])).toThrow(/protected table/);
  });

  it('validates dynamic lookup filters and form filter columns', () => {
    const registry = new MetadataRegistry();
    const category: TableMeta = { kind: 'table', name: 'A_Category', fields: [{ name: 'status', type: 'string' }] };
    const item: TableMeta = {
      kind: 'table', name: 'A_Item', fields: [
        { name: 'categoryId', type: 'reference', reference: { table: 'A_Category' } },
        { name: 'name', type: 'string' },
      ],
    };
    const line: TableMeta = {
      kind: 'table', name: 'A_Line', fields: [
        { name: 'categoryId', type: 'reference', reference: { table: 'A_Category' } },
        { name: 'itemId', type: 'reference', reference: { table: 'A_Item', filters: [
          { field: 'categoryId', operator: 'eq', value: { source: 'record', field: 'categoryId' } },
          { field: 'name', operator: 'ne', value: { source: 'lookup', field: 'categoryId', lookupField: 'status' } },
        ] } },
      ],
    };
    const form: FormMeta = { kind: 'form', name: 'A_LineForm', table: 'A_Line', listFields: ['itemId'], filterFields: ['categoryId', 'itemId'] };
    registry.registerApp(testManifest('a'), [category, item, line, form]);
    expect(registry.getForm('A_LineForm').filterFields).toEqual(['categoryId', 'itemId']);

    const invalid: TableMeta = {
      ...line,
      fields: [
        line.fields[0],
        { name: 'itemId', type: 'reference', reference: { table: 'A_Item', filters: [{ field: 'categoryId', operator: 'eq', value: { source: 'record', field: 'missing' } }] } },
      ],
    };
    expect(() => new MetadataRegistry().registerApp(testManifest('a'), [category, item, invalid])).toThrow(/unknown current-record field/);
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
    registry2.registerApp(testManifest('testapp'), [salesStatusEnum, custV2, TESTAPP_SalesTable]);
    const result = syncSchema(db, registry2);

    expect(result.createdTables).toHaveLength(0);
    expect(result.addedColumns).toEqual(['TESTAPP_CustTable.phone']);
  });
});

describe('MetadataRegistry — reports', () => {
  function goodReport(): ReportMeta {
    return {
      kind: 'report',
      name: 'TESTAPP_CustListReport',
      app: 'testapp',
      model: 'ClientCustom',
      dataSource: 'TESTAPP_CustTable',
      bands: [
        {
          kind: 'header',
          height: 40,
          elements: [{ id: 'title', type: 'text', x: 0, y: 0, width: 200, height: 20, text: 'Customers' }],
        },
        {
          kind: 'detail',
          height: 20,
          elements: [
            { id: 'accountNum', type: 'field', x: 0, y: 0, width: 100, height: 20, field: 'accountNum' },
            { id: 'name', type: 'field', x: 100, y: 0, width: 100, height: 20, field: 'name' },
          ],
        },
      ],
    } as ReportMeta;
  }

  it('registers a well-formed report and exposes it via getReport/allReports', () => {
    const registry = testRegistry();
    registry.registerWebArtifacts('testapp', [goodReport()]);
    expect(registry.hasReport('TESTAPP_CustListReport')).toBe(true);
    expect(registry.getReport('TESTAPP_CustListReport').dataSource).toBe('TESTAPP_CustTable');
    expect(registry.allReports()).toHaveLength(1);
  });

  it('rejects a report with an unknown dataSource table', () => {
    const registry = testRegistry();
    const bad = { ...goodReport(), dataSource: 'Nope' };
    expect(() => registry.registerWebArtifacts('testapp', [bad])).toThrow(/unknown dataSource table/);
  });

  it('rejects a report with an unknown field binding', () => {
    const registry = testRegistry();
    const bad = goodReport();
    bad.bands[1].elements.push({ id: 'bad', type: 'field', x: 0, y: 20, width: 50, height: 20, field: 'nope' });
    expect(() => registry.registerWebArtifacts('testapp', [bad])).toThrow(/unknown field 'nope'/);
  });

  it('rejects a report with an invalid lineSource refField', () => {
    const registry = testRegistry();
    const bad: ReportMeta = {
      ...goodReport(),
      name: 'TESTAPP_SalesInvoiceReport',
      dataSource: 'TESTAPP_SalesTable',
      bands: [{ kind: 'detail', height: 20, elements: [] }],
      lineSources: [{ table: 'TESTAPP_CustTable', refField: 'nope', bands: [{ kind: 'detail', height: 20, elements: [] }] }],
    };
    expect(() => registry.registerWebArtifacts('testapp', [bad])).toThrow(/has no refField 'nope'/);
  });

  it('validates reusable picker actions and dynamic record filters', () => {
    const registry = testRegistry();
    registry.registerWebArtifacts('testapp', [goodReport(), {
      kind: 'form', name: 'TESTAPP_AllocationForm', app: 'testapp', model: 'ClientCustom', table: 'TESTAPP_CustTable', actions: [{
        label: 'Allocate', type: 'picker', target: 'AllocateStock', picker: {
          table: 'TESTAPP_SalesTable', columns: ['salesId', 'totalAmount'], searchFields: ['salesId'], multiple: true,
          allocation: { availableField: 'totalAmount' },
          filters: [{ field: 'salesId', operator: 'eq', value: { source: 'record', field: 'accountNum' } }],
        },
      }],
    } as any]);
    expect(registry.getForm('TESTAPP_AllocationForm').actions?.[0].type).toBe('picker');
  });

  it('rejects picker fields that do not exist on the source table', () => {
    const registry = testRegistry();
    expect(() => registry.registerWebArtifacts('testapp', [{
      kind: 'form', name: 'TESTAPP_BadPickerForm', app: 'testapp', model: 'ClientCustom', table: 'TESTAPP_CustTable', actions: [{
        label: 'Bad', type: 'picker', target: 'BadAction', picker: { table: 'TESTAPP_SalesTable', columns: ['missing'] },
      }],
    } as any])).toThrow(/unknown source field 'missing'/);
  });
});
