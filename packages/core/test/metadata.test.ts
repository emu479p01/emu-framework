import { describe, it, expect } from 'vitest';
import DatabaseCtor from 'better-sqlite3';
import { MetadataRegistry, MetadataError, syncSchema, validateMetadataArtifact, type TableMeta, type FormMeta, type ReportMeta } from '../src/index.js';
import { TESTAPP_CustTable, salesStatusEnum, TESTAPP_SalesTable, testRegistry } from './helpers.js';

describe('MetadataRegistry', () => {
  it('accepts optional safe icons and rejects unknown icon tokens', () => {
    expect(validateMetadataArtifact({ kind: 'app', name: 'plain' })).toEqual([]);
    expect(validateMetadataArtifact({ kind: 'app', name: 'safe', icon: 'chart' })).toEqual([]);
    expect(validateMetadataArtifact({ kind: 'app', name: 'unsafe', icon: '<svg>' }).some((item) => item.path.includes('icon'))).toBe(true);

    const registry = new MetadataRegistry();
    expect(() => registry.registerApp({ name: 'a' }, [{
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
    registry.registerApp({ name: 'a' }, [header, line, form]);
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
    expect(() => registry.registerApp({ name: 'a' }, [header, line, form])).toThrow(
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
    expect(() => registry.registerApp({ name: 'a' }, [header, line, form])).toThrow(/requires 'field'/);
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
    expect(() => registry.registerApp({ name: 'a' }, [header, line, formUnknown])).toThrow(/aggregate field 'nope' not found/);

    const registry2 = new MetadataRegistry();
    const formNonNumeric: FormMeta = {
      kind: 'form',
      name: 'A_HeaderForm',
      table: 'A_Header',
      lines: [{ table: 'A_Line', refField: 'headerId', fields: [], aggregates: [{ fn: 'sum', field: 'label' }] }],
    };
    expect(() => registry2.registerApp({ name: 'a' }, [header, line, formNonNumeric])).toThrow(/must be numeric/);
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
    registry.registerApp({ name: 'a' }, [ref, main]);
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
    expect(() => registry.registerApp({ name: 'a' }, [ref, badFrom])).toThrow(/copyFields 'from' unknown field/);

    const registry2 = new MetadataRegistry();
    const badTo: TableMeta = {
      kind: 'table',
      name: 'A_Line',
      fields: [{ name: 'item', type: 'reference', reference: { table: 'A_Item', copyFields: [{ from: 'price', to: 'nope' }] } }],
    };
    expect(() => registry2.registerApp({ name: 'a' }, [ref, badTo])).toThrow(/copyFields 'to' unknown\/invalid field/);
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
});
