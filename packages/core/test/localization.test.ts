import { describe, expect, it } from 'vitest';
import {
  LocaleResolver,
  MetadataError,
  MetadataRegistry,
  DEFAULT_LOCALE,
  localeBase,
  localeChain,
  normalizeLocale,
  resourceTargetExists,
  translationDiagnostics,
  validateMetadataArtifact,
  type AnyMeta,
  type DataEntityMeta,
  type TableMeta,
} from '../src/index.js';
import { testManifest } from './helpers.js';

const custTable: TableMeta = {
  kind: 'table', name: 'TESTAPP_CustTable', titleField: 'name',
  fields: [
    { name: 'accountNum', type: 'string', mandatory: true },
    { name: 'name', type: 'string' },
  ],
};
const salesTable: TableMeta = {
  kind: 'table', name: 'TESTAPP_SalesTable',
  fields: [
    { name: 'salesId', type: 'string', mandatory: true },
    { name: 'custId', type: 'reference', reference: { table: 'TESTAPP_CustTable' } },
    { name: 'remark', type: 'string' },
    { name: 'totalAmount', type: 'real', default: 0 },
  ],
};
const noteTable: TableMeta = {
  kind: 'table', name: 'TESTAPP_NoteTable',
  fields: [
    { name: 'parentId', type: 'reference', reference: { table: 'TESTAPP_SalesTable' } },
    { name: 'text', type: 'string' },
    { name: 'seq', type: 'int' },
  ],
};
const TABLES = [custTable, salesTable, noteTable];

const T = (locale: string, name: string, resources: Record<string, string>, layer: 'SYS' | 'ISV' | 'LOC' | 'DEV' | 'CUS' = 'SYS', app = 'testapp'): AnyMeta =>
  ({ kind: 'translation', name, app, model: 'ClientCustom', layer, locale, resources }) as AnyMeta;

describe('normalizeLocale', () => {
  it('canonicalizes case and structure', () => {
    expect(normalizeLocale('th-th')).toBe('th-TH');
    expect(normalizeLocale('EN')).toBe('en');
    expect(normalizeLocale('en-gb')).toBe('en-GB');
  });
  it('rejects invalid tags with a field-pointing error', () => {
    expect(() => normalizeLocale('th_TH', 'defaultLocale')).toThrow(/defaultLocale: 'th_TH' is not a valid BCP-47 locale tag/);
    expect(() => normalizeLocale('', 'locale')).toThrow(/locale: locale tag is required/);
    expect(() => normalizeLocale('not a locale!')).toThrow(/is not a valid BCP-47 locale tag/);
  });
  it('exposes the base language subtag', () => {
    expect(localeBase('th-TH')).toBe('th');
    expect(localeBase('en')).toBe('en');
  });
  it('builds a deduplicated fallback chain', () => {
    expect(localeChain('en-GB', 'th-TH')).toEqual(['en-GB', 'en', 'th-TH', 'th']);
    expect(localeChain('th', 'th-TH')).toEqual(['th', 'th-TH']);
    expect(localeChain('en', 'th')).toEqual(['en', 'th']);
    expect(localeChain('th-TH', 'th')).toEqual(['th-TH', 'th']);
  });
});

describe('AppManifest defaultLocale', () => {
  it('stores a canonical defaultLocale', () => {
    const registry = new MetadataRegistry();
    registry.registerApp({ ...testManifest('testapp'), defaultLocale: 'th-th' }, []);
    expect(registry.defaultLocaleOf('testapp')).toBe('th-TH');
  });
  it('falls back to en when not declared', () => {
    const registry = new MetadataRegistry();
    registry.registerApp(testManifest('testapp'), []);
    expect(registry.defaultLocaleOf('testapp')).toBe(DEFAULT_LOCALE);
  });
  it('rejects an invalid tag naming the field', () => {
    const registry = new MetadataRegistry();
    expect(() => registry.registerApp({ ...testManifest('testapp'), defaultLocale: 'xx@' }, [])).toThrow(/defaultLocale: 'xx@' is not a valid BCP-47 locale tag/);
  });
  it('fails schema validation with a path pointing at the field', () => {
    const diagnostics = validateMetadataArtifact({ kind: 'app', name: 'app2', defaultLocale: 'bad tag' });
    expect(diagnostics.some((entry) => entry.path === '/defaultLocale' && entry.code === 'invalid_locale')).toBe(true);
    expect(validateMetadataArtifact({ kind: 'app', name: 'app2', defaultLocale: 'th-th' })).toEqual([]);
  });
});

describe('dataEntityExtension', () => {
  const manifest = { name: 'testapp', models: [{ name: 'Base', label: 'Base', layer: 'SYS' as const }, { name: 'ClientCustom', label: 'Client Custom', layer: 'CUS' as const }] };
  const inBase = (meta: AnyMeta): AnyMeta => ({ ...meta, app: 'testapp', model: 'Base' }) as AnyMeta;
  const orderEntity = (extra: Partial<DataEntityMeta> = {}): DataEntityMeta => ({
    kind: 'dataEntity',
    name: 'TESTAPP_OrderEntity',
    rootTable: 'TESTAPP_SalesTable',
    businessKey: ['salesId'],
    fields: ['salesId', 'custId'],
    lines: [{ name: 'Notes', table: 'TESTAPP_NoteTable', parentReference: 'parentId', fields: ['text'], lineKeys: ['seq'] }],
    ...extra,
  });
  const extension = (patch: Record<string, unknown> = {}): AnyMeta => ({
    kind: 'dataEntityExtension',
    name: 'TESTAPP_ClientCustom_TESTAPP_OrderEntity_Extension',
    app: 'testapp',
    model: 'ClientCustom',
    dataEntity: 'TESTAPP_OrderEntity',
    ...patch,
  }) as AnyMeta;

  it('appends root fields, new lines, and fields on existing lines', () => {
    const registry = new MetadataRegistry();
    registry.registerApp(manifest, [
      ...TABLES.map(inBase),
      inBase(orderEntity()),
      extension({ fields: ['remark'], lines: [{ name: 'Extra', table: 'TESTAPP_NoteTable', parentReference: 'parentId', fields: ['text', 'seq'], lineKeys: ['seq'] }], lineExtensions: [{ name: 'Notes', fields: ['seq'] }] }),
    ]);
    const merged = registry.getDataEntity('TESTAPP_OrderEntity');
    expect(merged.fields).toEqual(['salesId', 'custId', 'remark']);
    expect(merged.lines?.map((line) => line.name)).toEqual(['Notes', 'Extra']);
    expect(merged.lines?.[0]?.fields).toEqual(['text', 'seq']);
  });

  it('rejects duplicate root fields, duplicate line names, and unknown lines', () => {
    const attempt = (patch: Record<string, unknown>) => {
      const registry = new MetadataRegistry();
      registry.registerApp(manifest, [...TABLES.map(inBase), inBase(orderEntity()), extension(patch)]);
    };
    expect(() => attempt({ fields: ['salesId'] })).toThrow(/field 'salesId' already exists on 'TESTAPP_OrderEntity'/);
    expect(() => attempt({ lines: [{ name: 'Notes', table: 'TESTAPP_NoteTable', parentReference: 'parentId', fields: ['text'], lineKeys: ['seq'] }] })).toThrow(/line 'Notes' already exists/);
    expect(() => attempt({ lineExtensions: [{ name: 'Missing', fields: ['text'] }] })).toThrow(/unknown line 'Missing'/);
    expect(() => attempt({ lineExtensions: [{ name: 'Notes', fields: ['text'] }] })).toThrow(/field 'text' already exists on line 'Notes'/);
  });

  it('validates merged fields against the root table', () => {
    const registry = new MetadataRegistry();
    expect(() => registry.registerApp(manifest, [
      ...TABLES.map(inBase), inBase(orderEntity()), extension({ fields: ['notAField'] }),
    ])).toThrow(/unknown root field 'notAField'/);
  });

  it('requires a higher layer than the base entity', () => {
    const registry = new MetadataRegistry();
    expect(() => registry.registerApp(manifest, [
      ...TABLES.map((table) => inBase({ ...table })),
      inBase(orderEntity()),
      { ...extension({ model: 'Base' }) as AnyMeta },
    ])).toThrow(/layer 'SYS' must be higher/);
  });

  it('rejects attempts to change root table or business key via the schema', () => {
    const diagnostics = validateMetadataArtifact({
      kind: 'dataEntityExtension', name: 'X_Extension', dataEntity: 'TESTAPP_OrderEntity',
      rootTable: 'Other', businessKey: ['x'],
    });
    expect(diagnostics.some((entry) => entry.code === 'additionalProperties')).toBe(true);
  });
});

describe('LocaleResolver', () => {
  it('falls back per key: exact user locale → base → app default → base', () => {
    const registry = new MetadataRegistry();
    registry.registerApp({ ...testManifest('testapp'), defaultLocale: 'th-TH' }, [
      ...TABLES,
      T('th', 'TESTAPP_Thai', { 'table.TESTAPP_SalesTable.label': 'ไทยทั้งพอดี' }),
    ]);
    const resolver = new LocaleResolver(registry);
    expect(resolver.resolve('table.TESTAPP_SalesTable.label', 'testapp', 'th')).toBe('ไทยทั้งพอดี');
    expect(resolver.resolve('table.TESTAPP_SalesTable.label', 'testapp', 'ja-JP')).toBe('ไทยทั้งพอดี');
    expect(resolver.resolve('table.missing.label', 'testapp', 'th')).toBeUndefined();
  });

  it('uses partial translations of another locale only for the keys they cover', () => {
    const registry = new MetadataRegistry();
    registry.registerApp(testManifest('testapp'), [
      ...TABLES,
      T('en', 'TESTAPP_English', { 'table.TESTAPP_SalesTable.field.salesId.label': 'Sales id' }),
      T('th', 'TESTAPP_Thai', { 'table.TESTAPP_SalesTable.label': 'ไทยทั้งพอดี' }),
    ]);
    const resolver = new LocaleResolver(registry);
    expect(resolver.resolve('table.TESTAPP_SalesTable.label', 'testapp', 'th')).toBe('ไทยทั้งพอดี');
    expect(resolver.resolve('table.TESTAPP_SalesTable.field.salesId.label', 'testapp', 'th')).toBe('Sales id');
    expect(resolver.resolve('table.TESTAPP_SalesTable.label', 'testapp', 'en')).toBeUndefined();
  });

  it('honours layer precedence and name order for the same key and locale', () => {
    const registry = new MetadataRegistry();
    registry.registerApp(
      { ...testManifest('testapp'), models: [{ name: 'Sys', layer: 'SYS' }, { name: 'ClientCustom', layer: 'CUS' }] },
      [
        { ...custTable, model: 'Sys' }, { ...salesTable, model: 'Sys' }, { ...noteTable, model: 'Sys' },
        { ...T('th', 'TESTAPP_LayerSys', { 'table.TESTAPP_SalesTable.label': 'sys' }), model: 'Sys' },
        { ...T('th', 'TESTAPP_LayerCus', { 'table.TESTAPP_SalesTable.label': 'cus' }), model: 'ClientCustom' },
      ],
    );
    const resolver = new LocaleResolver(registry);
    expect(resolver.resolve('table.TESTAPP_SalesTable.label', 'testapp', 'th')).toBe('cus');
  });

  it('reserves ui.* keys for the system app', () => {
    const registry = new MetadataRegistry();
    registry.registerApp(testManifest('testapp'), [
      ...TABLES,
      T('th', 'TESTAPP_Thai', { 'ui.common.save': 'ห้าม' }),
    ]);
    registry.registerApp({ name: 'system', models: [{ name: 'Framework', layer: 'SYS' }] }, [
      { kind: 'translation', name: 'FW_UiTh', app: 'system', model: 'Framework', layer: 'SYS', locale: 'th', resources: { 'ui.common.save': 'บันทึก' } },
    ]);
    const resolver = new LocaleResolver(registry);
    expect(resolver.resolve('ui.common.save', 'system', 'th')).toBe('บันทึก');
    expect(resolver.uiMessages('th')['ui.common.save']).toBe('บันทึก');
    expect(resolver.uiMessages('en')).toEqual({});
    expect(resolver.frameworkLocales()).toEqual(['th']);
  });

  it('allows cross-app translations only through declared dependencies', () => {
    const registry = new MetadataRegistry();
    registry.registerApp(testManifest('otherapp', 'ISV'), [
      { kind: 'table', name: 'OTHERAPP_Table', fields: [{ name: 'code', type: 'string' }] },
    ]);
    registry.registerApp({ name: 'thirdapp', models: [{ name: 'ClientCustom', layer: 'CUS' }] }, [
      { kind: 'translation', name: 'THIRDAPP_Thai', app: 'thirdapp', model: 'ClientCustom', locale: 'th', resources: { 'table.OTHERAPP_Table.label': 'no rights' } },
    ]);
    registry.registerApp({ name: 'testapp', dependsOn: ['otherapp'], models: [{ name: 'ClientCustom', layer: 'CUS' }] }, [
      { kind: 'translation', name: 'TESTAPP_Thai', app: 'testapp', model: 'ClientCustom', locale: 'th', resources: { 'table.OTHERAPP_Table.label': 'ของเพื่อน' } },
    ]);
    const resolver = new LocaleResolver(registry);
    expect(resolver.resolve('table.OTHERAPP_Table.label', 'otherapp', 'th')).toBe('ของเพื่อน');
  });

  it('detects live and missing resource targets', () => {
    const registry = new MetadataRegistry();
    registry.registerApp(testManifest('testapp'), [
      ...TABLES,
      { kind: 'form', name: 'TESTAPP_SalesForm', app: 'testapp', model: 'ClientCustom', table: 'TESTAPP_SalesTable' },
      { kind: 'menu', name: 'TESTAPP_MainMenu', app: 'testapp', model: 'ClientCustom', items: [{ id: 'menu-home', label: 'Home' }] },
    ]);
    expect(resourceTargetExists(registry, 'table.TESTAPP_SalesTable.field.salesId.label')).toBe(true);
    expect(resourceTargetExists(registry, 'table.TESTAPP_SalesTable.field.gone.label')).toBe(false);
    expect(resourceTargetExists(registry, 'menu.TESTAPP_MainMenu.item.menu-home.label')).toBe(true);
    expect(resourceTargetExists(registry, 'menu.TESTAPP_MainMenu.item.menu-gone.label')).toBe(false);
    expect(resourceTargetExists(registry, 'form.TESTAPP_SalesForm.label')).toBe(true);
    expect(resourceTargetExists(registry, 'bogus.key')).toBe(false);
  });

  it('reports duplicate and missing-target diagnostics', () => {
    const registry = new MetadataRegistry();
    registry.registerApp(testManifest('testapp'), [
      ...TABLES,
      T('th', 'TESTAPP_ThaiA', { 'table.TESTAPP_SalesTable.label': 'a', 'table.GoneTable.label': 'x' }),
      T('th', 'TESTAPP_ThaiB', { 'table.TESTAPP_SalesTable.label': 'b' }),
    ]);
    const diagnostics = translationDiagnostics(registry);
    expect(diagnostics.some((entry) => entry.kind === 'duplicate' && entry.key === 'table.TESTAPP_SalesTable.label')).toBe(true);
    expect(diagnostics.some((entry) => entry.kind === 'missing-target' && entry.key === 'table.GoneTable.label')).toBe(true);
  });

  it('lists locales available for an app including its default', () => {
    const registry = new MetadataRegistry();
    registry.registerApp({ ...testManifest('testapp'), defaultLocale: 'th-TH' }, [
      ...TABLES,
      T('th', 'TESTAPP_Thai', { 'table.TESTAPP_SalesTable.label': 'ไทย' }),
      T('en', 'TESTAPP_English', { 'table.TESTAPP_SalesTable.label': 'English' }),
    ]);
    expect(new LocaleResolver(registry).localesForApp('testapp')).toEqual(['en', 'th', 'th-TH']);
  });

  it('keeps registry errors typed', () => {
    expect(new MetadataError('x')).toBeInstanceOf(MetadataError);
  });
});
