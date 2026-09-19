import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AnyMeta, Kernel } from '@emu/core';
import { buildServer } from '../src/server.js';
import { persistStoredArtifacts } from '../src/designer.js';
import { applyErpSample } from './fixtures/erpSample.js';
import { completeTestSetup, TEST_ADMIN_PASSWORD, TEST_SETUP_CODE } from './setupHelper.js';

const storedOf = (kernel: Kernel): AnyMeta[] =>
  kernel.designerContext().select('FW_WebArtifact').toArray().map((row) => JSON.parse(String(row.f.json)) as AnyMeta);

describe('v1.2.0 localization contract', () => {
  let app: FastifyInstance; let kernel: Kernel; let auth: { cookie: string };
  beforeAll(async () => {
    app = buildServer({ setupCode: TEST_SETUP_CODE }); await app.ready(); await completeTestSetup(app);
    kernel = (app as FastifyInstance & { kernel: Kernel }).kernel;
    applyErpSample(kernel);
    // App-1 (erp): en + th translations, no declared defaultLocale (→ en).
    // App-2 (thaiapp): th-only translation, defaultLocale th.
    const extra: AnyMeta[] = [
      { kind: 'translation', name: 'ERP_English', app: 'erp', model: 'MiniERPApplication', layer: 'SYS', locale: 'en', resources: { 'app.erp.label': 'ERP (EN)' } } as AnyMeta,
      { kind: 'translation', name: 'ERP_Thai', app: 'erp', model: 'MiniERPApplication', layer: 'SYS', locale: 'th', resources: { 'app.erp.label': 'อีอาร์พี' } } as AnyMeta,
      { kind: 'app', name: 'thaiapp', label: 'Thai App', defaultLocale: 'th', models: [{ name: 'Main', label: 'Main', layer: 'SYS' }] } as any,
      { kind: 'table', name: 'THAIAPP_Order', app: 'thaiapp', model: 'Main', layer: 'SYS', fields: [{ name: 'code', type: 'string' }, { name: 'orderDate', type: 'date' }] } as AnyMeta,
      { kind: 'form', name: 'THAIAPP_OrderForm', app: 'thaiapp', model: 'Main', layer: 'SYS', table: 'THAIAPP_Order' } as AnyMeta,
      { kind: 'menu', name: 'THAIAPP_Menu', app: 'thaiapp', model: 'Main', layer: 'SYS', items: [{ id: 'menu-order', label: 'Orders', form: 'THAIAPP_OrderForm' }] } as AnyMeta,
      { kind: 'translation', name: 'THAIAPP_Thai', app: 'thaiapp', model: 'Main', layer: 'SYS', locale: 'th', resources: { 'app.thaiapp.label': 'แอปไทย', 'form.THAIAPP_OrderForm.label': 'ใบสั่งขาย' } } as AnyMeta,
    ];
    expect(kernel.applyWebArtifacts([...storedOf(kernel), ...extra])).toEqual([]);
    persistStoredArtifacts(kernel, [...storedOf(kernel), ...extra]);
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: TEST_ADMIN_PASSWORD } });
    auth = { cookie: (login.headers['set-cookie'] as string).split(';')[0] };
  });
  afterAll(() => app.close());

  it('canonicalizes and rejects user locales with field-pointing errors', async () => {
    const saved = await app.inject({ method: 'PATCH', url: '/api/me/locale', headers: auth, payload: { locale: 'th-th' } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().locale).toBe('th-TH');
    const rejected = await app.inject({ method: 'PATCH', url: '/api/me/locale', headers: auth, payload: { locale: 'not a tag' } });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error).toMatch(/^locale: /);
  });

  const metadataFor = async (locale: string) => {
    await app.inject({ method: 'PATCH', url: '/api/me/locale', headers: auth, payload: { locale } });
    return (await app.inject({ method: 'GET', url: '/api/metadata', headers: auth })).json();
  };

  it('adds locale, availableLocales, uiMessages and per-app locale fields', async () => {
    const metadata = await metadataFor('en');
    expect(metadata.locale).toBe('en');
    expect(metadata.availableLocales).toEqual(['en', 'th']);
    expect(metadata.uiMessages['ui.common.save']).toBe('Save');
    expect(metadata.uiMessages['ui.nav.recent']).toBe('Recent');
    const erp = metadata.apps.find((entry: any) => entry.name === 'erp');
    const thai = metadata.apps.find((entry: any) => entry.name === 'thaiapp');
    expect(erp.defaultLocale).toBe('en');
    expect(erp.availableLocales).toEqual(['en', 'th']);
    expect(thai.defaultLocale).toBe('th');
    expect(thai.availableLocales).toEqual(['th']);
  });

  it('resolves framework ui messages in Thai', async () => {
    const metadata = await metadataFor('th');
    expect(metadata.locale).toBe('th');
    expect(metadata.uiMessages['ui.common.save']).toBe('บันทึก');
    expect(metadata.uiMessages['ui.nav.recent']).toBe('เปิดล่าสุด');
    await metadataFor('en');
  });

  it('picks translations per key: App-1 en/th + App-2 th-only', async () => {
    // User en → erp label from en, thaiapp falls back to its th default.
    const en = await metadataFor('en');
    expect(en.apps.find((entry: any) => entry.name === 'erp').label).toBe('ERP (EN)');
    expect(en.apps.find((entry: any) => entry.name === 'thaiapp').label).toBe('แอปไทย');
    // User th → both apps show Thai.
    const th = await metadataFor('th');
    expect(th.apps.find((entry: any) => entry.name === 'erp').label).toBe('อีอาร์พี');
    expect(th.apps.find((entry: any) => entry.name === 'thaiapp').label).toBe('แอปไทย');
    expect(th.forms.find((entry: any) => entry.name === 'THAIAPP_OrderForm').label).toBe('ใบสั่งขาย');
    // User ja → no ja resources; erp falls back to its default locale en, thaiapp to th.
    const ja = await metadataFor('ja');
    expect(ja.apps.find((entry: any) => entry.name === 'erp').label).toBe('ERP (EN)');
    expect(ja.apps.find((entry: any) => entry.name === 'thaiapp').label).toBe('แอปไทย');
    // The user locale is never rewritten automatically by entering an app.
    const me = (await app.inject({ method: 'GET', url: '/api/me', headers: auth })).json();
    expect(me.locale).toBe('ja');
    await metadataFor('en');
  });

  it('localizes archive Data Entity labels through the same resolver', async () => {
    const extra: AnyMeta[] = [
      { kind: 'dataEntity', name: 'THAIAPP_OrderEntity', app: 'thaiapp', model: 'Main', layer: 'SYS', rootTable: 'THAIAPP_Order', businessKey: ['code'], fields: ['code', 'orderDate'], archiveEligible: true, businessDateField: 'orderDate' } as AnyMeta,
      { kind: 'translation', name: 'THAIAPP_ThaiEntity', app: 'thaiapp', model: 'Main', layer: 'SYS', locale: 'th', resources: { 'dataEntity.THAIAPP_OrderEntity.label': 'เอกสารคำสั่งขาย' } } as AnyMeta,
    ];
    const candidates = [...storedOf(kernel).filter((entry) => !extra.some((candidate) => candidate.name === entry.name)), ...extra];
    expect(kernel.applyWebArtifacts(candidates)).toEqual([]);
    persistStoredArtifacts(kernel, candidates);
    await app.inject({ method: 'PATCH', url: '/api/me/locale', headers: auth, payload: { locale: 'th' } });
    const policies = (await app.inject({ method: 'GET', url: '/api/system/archive/policies', headers: auth })).json();
    const entity = policies.eligibleEntities.find((entry: any) => entry.name === 'THAIAPP_OrderEntity');
    expect(entity.label).toBe('เอกสารคำสั่งขาย');
    // thaiapp declares th as its default locale, so even an English user falls back to Thai here.
    await app.inject({ method: 'PATCH', url: '/api/me/locale', headers: auth, payload: { locale: 'en' } });
    const english = (await app.inject({ method: 'GET', url: '/api/system/archive/policies', headers: auth })).json();
    expect(english.eligibleEntities.find((entry: any) => entry.name === 'THAIAPP_OrderEntity').label).toBe('เอกสารคำสั่งขาย');
  });

  it('reports duplicate and missing-target translation diagnostics to the Designer', async () => {
    const extra: AnyMeta[] = [
      { kind: 'translation', name: 'THAIAPP_ThaiDup', app: 'thaiapp', model: 'Main', layer: 'SYS', locale: 'th', resources: { 'app.thaiapp.label': 'ซ้ำ', 'table.GoneTable.label': 'x' } } as AnyMeta,
    ];
    const candidates = [...storedOf(kernel), ...extra];
    expect(kernel.applyWebArtifacts(candidates)).toEqual([]);
    persistStoredArtifacts(kernel, candidates);
    const diagnostics = (await app.inject({ method: 'GET', url: '/api/designer/translations/diagnostics', headers: auth })).json().diagnostics;
    expect(diagnostics.some((entry: any) => entry.kind === 'duplicate' && entry.key === 'app.thaiapp.label')).toBe(true);
    expect(diagnostics.some((entry: any) => entry.kind === 'missing-target' && entry.key === 'table.GoneTable.label')).toBe(true);
  });

  it('saves and reloads Translation and Data Entity kinds through the Designer', async () => {
    const translation = { kind: 'translation', name: 'THAIAPP_NewTranslation', app: 'thaiapp', model: 'Main', layer: 'SYS', locale: 'en', resources: { 'app.thaiapp.label': 'Thai App (EN)' } };
    const saved = await app.inject({ method: 'PUT', url: '/api/designer/artifacts/translation/THAIAPP_NewTranslation', headers: auth, payload: translation });
    expect(saved.statusCode).toBe(200);
    const entity = { kind: 'dataEntity', name: 'THAIAPP_CodeEntity', app: 'thaiapp', model: 'Main', layer: 'SYS', rootTable: 'THAIAPP_Order', businessKey: ['code'], fields: ['code'] };
    const entitySaved = await app.inject({ method: 'PUT', url: '/api/designer/artifacts/dataEntity/THAIAPP_CodeEntity', headers: auth, payload: entity });
    expect(entitySaved.statusCode).toBe(200);
    const reloaded = kernel.registry.getDataEntity('THAIAPP_CodeEntity');
    expect(reloaded.businessKey).toEqual(['code']);
    const artifacts = (await app.inject({ method: 'GET', url: '/api/designer/artifacts?includeCatalog=false', headers: auth })).json().artifacts;
    expect(artifacts.some((entry: any) => entry.name === 'THAIAPP_NewTranslation' && entry.kind === 'translation')).toBe(true);
    expect(artifacts.some((entry: any) => entry.name === 'THAIAPP_CodeEntity' && entry.kind === 'dataEntity')).toBe(true);
    const catalog = (await app.inject({ method: 'GET', url: '/api/designer/catalog', headers: auth })).json().catalog;
    expect(catalog.dataEntities.some((entry: any) => entry.name === 'THAIAPP_CodeEntity')).toBe(true);
    expect(catalog.translations.some((entry: any) => entry.name === 'THAIAPP_NewTranslation')).toBe(true);
  });

  it('rejects data entity extensions that change protected structure', async () => {
    const bad = { kind: 'dataEntityExtension', name: 'THAIAPP_Main_THAIAPP_CodeEntity_Extension', app: 'thaiapp', model: 'Main', layer: 'SYS', dataEntity: 'THAIAPP_CodeEntity', rootTable: 'Other' };
    const saved = await app.inject({ method: 'PUT', url: '/api/designer/artifacts/dataEntityExtension/THAIAPP_Main_THAIAPP_CodeEntity_Extension', headers: auth, payload: bad });
    expect(saved.statusCode).toBe(422);
  });
});
