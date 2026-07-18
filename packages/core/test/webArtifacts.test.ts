import { describe, it, expect } from 'vitest';
import { Kernel, orderScriptsForExecution, type AnyMeta } from '../src/index.js';
import { TESTAPP_CustTable, salesStatusEnum, TESTAPP_SalesTable, testManifest } from './helpers.js';

function bootKernel(): Kernel {
  const kernel = new Kernel();
  kernel.registerApp({ name: 'testapp', models: [{ name: 'Base', layer: 'SYS' }, { name: 'ClientCustom', layer: 'CUS' }] }, [salesStatusEnum, TESTAPP_CustTable, TESTAPP_SalesTable]);
  kernel.sync();
  return kernel;
}

const webTable: AnyMeta = {
  kind: 'table',
  name: 'WEB_WebNote',
  app: 'web', model: 'ClientCustom', layer: 'CUS',
  titleField: 'title',
  fields: [
    { name: 'title', type: 'string', mandatory: true },
    { name: 'body', type: 'string' },
  ],
};

const webForm: AnyMeta = { kind: 'form', name: 'WEB_WebNoteForm', app: 'web', model: 'ClientCustom', layer: 'CUS', table: 'WEB_WebNote' };
const webManifest = { kind: 'app', name: 'web', models: [{ name: 'ClientCustom', layer: 'CUS' }] } as unknown as AnyMeta;

describe('orderScriptsForExecution', () => {
  it('orders base scripts by layer/name and slots extensions after their base', () => {
    const s = (kind: string, name: string, layer: string, script?: string) =>
      ({ kind, name, layer, script } as never);
    const ordered = orderScriptsForExecution([
      s('script', 'B_Cus', 'CUS'),
      s('scriptExtension', 'A_Sys_Extension', 'CUS', 'A_Sys'),
      s('script', 'A_Sys', 'SYS'),
      s('scriptExtension', 'Orphan_Extension', 'DEV', 'FileBased'),
      s('script', 'C_Dev', 'DEV'),
    ]);
    expect(ordered.map((a: { name: string }) => a.name)).toEqual([
      'A_Sys', 'A_Sys_Extension', 'C_Dev', 'B_Cus', 'Orphan_Extension',
    ]);
  });
});

describe('Kernel.applyWebArtifacts', () => {
  it('never injects Models based on an App name', () => {
    const kernel = bootKernel();
    expect(kernel.applyWebArtifacts([{ kind: 'app', name: 'erp', label: 'Fresh ERP' } as unknown as AnyMeta])).toEqual([]);
    expect(kernel.registry.loadedApps().find((app) => app.name === 'erp')?.models).toEqual([]);
    const errors = kernel.applyWebArtifacts([
      { kind: 'app', name: 'erp', label: 'Fresh ERP' } as unknown as AnyMeta,
      { kind: 'table', name: 'ERP_Item', app: 'erp', fields: [{ name: 'name', type: 'string' }] } as AnyMeta,
    ]);
    expect(errors[0]?.error).toMatch(/model is required/i);
  });

  it('adds new runtime artifacts and syncs schema — usable immediately', () => {
    const kernel = bootKernel();
    const errors = kernel.applyWebArtifacts([webManifest, webForm, webTable]); // out of order on purpose
    expect(errors).toEqual([]);
    expect(kernel.registry.getTable('WEB_WebNote').name).toBe('WEB_WebNote');
    expect(kernel.registry.getForm('WEB_WebNoteForm').table).toBe('WEB_WebNote');

    const ctx = kernel.context();
    const note = ctx.newRecord('WEB_WebNote').setMany({ title: 'hello' });
    note.insert();
    expect(ctx.select('WEB_WebNote').count()).toBe(1);
  });

  it('applies web extensions to file-based tables', () => {
    const kernel = bootKernel();
    const errors = kernel.applyWebArtifacts([
      {
        kind: 'tableExtension',
        name: 'TESTAPP_CustTable_Extension',
        app: 'testapp',
        model: 'ClientCustom',
        table: 'TESTAPP_CustTable',
        fields: [{ name: 'webField', type: 'string' }],
      } as AnyMeta,
    ]);
    expect(errors).toEqual([]);
    expect(kernel.registry.getTable('TESTAPP_CustTable').fields.some((f) => f.name === 'webField')).toBe(true);
    // schema followed
    const ctx = kernel.context();
    ctx.newRecord('TESTAPP_CustTable').setMany({ accountNum: 'C1', name: 'X', webField: 'ok' }).insert();
  });

  it('skips invalid artifacts with errors, keeps valid ones', () => {
    const kernel = bootKernel();
    const bad: AnyMeta = { kind: 'form', name: 'WEB_BadForm', app: 'web', model: 'ClientCustom', layer: 'CUS', table: 'Nope' };
    const errors = kernel.applyWebArtifacts([webManifest, webTable, bad]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ name: 'WEB_BadForm' });
    expect(kernel.registry.hasTable('WEB_WebNote')).toBe(true);
  });

  it('re-apply replaces the web layer (edit + delete semantics)', () => {
    const kernel = bootKernel();
    kernel.applyWebArtifacts([webManifest, webTable, webForm]);
    // now remove the form, keep only the table
    const errors = kernel.applyWebArtifacts([webManifest, webTable]);
    expect(errors).toEqual([]);
    expect(kernel.registry.hasTable('WEB_WebNote')).toBe(true);
    expect(() => kernel.registry.getForm('WEB_WebNoteForm')).toThrow();
    // data in the web table survives re-apply (schema is additive)
    const ctx = kernel.context();
    ctx.newRecord('WEB_WebNote').setMany({ title: 'still here' }).insert();
    expect(ctx.select('WEB_WebNote').count()).toBe(1);
  });

  it('registers a manifest-only app so it appears in loadedApps (Designer dropdown)', () => {
    const kernel = bootKernel();
    const errors = kernel.applyWebArtifacts([
      {
        kind: 'app',
        name: 'hr',
        label: 'HR',
        models: [{ name: 'HRCore', label: 'HR Core', layer: 'CUS' }],
      } as unknown as AnyMeta,
    ]);
    expect(errors).toEqual([]);
    const apps = kernel.registry.loadedApps().map((a) => a.name);
    expect(apps).toContain('hr');
    expect(kernel.registry.loadedApps().find((a) => a.name === 'hr')?.label).toBe('HR');

    // and adding a table under it later works
    const errors2 = kernel.applyWebArtifacts([
      { kind: 'app', name: 'hr', label: 'HR', models: [{ name: 'HRCore', layer: 'CUS' }] } as unknown as AnyMeta,
      {
        kind: 'table',
        name: 'HR_Employee',
        app: 'hr',
        model: 'HRCore',
        fields: [{ name: 'empName', type: 'string', mandatory: true }],
      } as unknown as AnyMeta,
    ]);
    expect(errors2).toEqual([]);
    expect(kernel.appForArtifact('HR_Employee')).toBe('hr');
  });

  it('native logic (TS hooks) survives web-artifact rebuilds', () => {
    const kernel = bootKernel();
    let calls = 0;
    kernel.registerNativeLogic((k) => {
      k.hooks.register('TESTAPP_CustTable', {
        initValue(rec) {
          calls++;
          rec.f.name = 'from-native-hook';
        },
      });
    });
    kernel.applyWebArtifacts([webManifest, webTable]); // clears + rebuilds hooks
    const rec = kernel.context().newRecord('TESTAPP_CustTable');
    expect(rec.f.name).toBe('from-native-hook');
    expect(calls).toBeGreaterThan(0);
  });

  it('executes scripts ordered by layer, base before its extensions', () => {
    (globalThis as any).__scriptOrder = [];
    const kernel = bootKernel();
    const manifest = {
      kind: 'app',
      name: 'layered',
      label: 'Layered',
      models: [
        { name: 'Sys', layer: 'SYS' },
        { name: 'Dev', layer: 'DEV' },
        { name: 'Cus', layer: 'CUS' },
      ],
    } as unknown as AnyMeta;
    const script = (name: string, model: string, marker: string): AnyMeta =>
      ({
        kind: 'script',
        name,
        app: 'layered',
        model,
        code: `(globalThis.__scriptOrder ??= []).push('${marker}')`,
      } as unknown as AnyMeta);
    // deliberately out of order
    const errors = kernel.applyWebArtifacts([
      script('LAYERED_Cus', 'Cus', 'cus'),
      script('LAYERED_Dev', 'Dev', 'dev'),
      manifest,
      {
        kind: 'scriptExtension',
        name: 'LAYERED_Sys_Extension',
        app: 'layered',
        model: 'Cus',
        script: 'LAYERED_Sys',
        code: `(globalThis.__scriptOrder ??= []).push('sysExt')`,
      } as unknown as AnyMeta,
      script('LAYERED_Sys', 'Sys', 'sys'),
    ]);
    expect(errors).toEqual([]);
    expect((globalThis as any).__scriptOrder).toEqual(['sys', 'sysExt', 'dev', 'cus']);
    delete (globalThis as any).__scriptOrder;
  });

  it('registers function artifacts as kernel actions', () => {
    const kernel = bootKernel();
    const errors = kernel.applyWebArtifacts([
      {
        kind: 'app',
        name: 'fnapp',
        models: [{ name: 'Sys', layer: 'SYS' }, { name: 'Cus', layer: 'CUS' }],
      } as unknown as AnyMeta,
      {
        kind: 'function',
        name: 'FNAPP_CountCustomers',
        app: 'fnapp',
        model: 'Cus',
        code: 'return { count: ctx.select("TESTAPP_CustTable").count(), got: args.x };',
      } as unknown as AnyMeta,
    ]);
    expect(errors).toEqual([]);
    expect(kernel.actions.has('FNAPP_CountCustomers')).toBe(true);
    const result = kernel.actions.get('FNAPP_CountCustomers')!(kernel.context(), { x: 42 });
    expect(result).toEqual({ count: 0, got: 42 });
  });

  it('function in a higher layer overrides the same name in a lower layer', () => {
    const kernel = bootKernel();
    const errors = kernel.applyWebArtifacts([
      {
        kind: 'app',
        name: 'fnapp',
        models: [{ name: 'Sys', layer: 'SYS' }, { name: 'Cus', layer: 'CUS' }],
      } as unknown as AnyMeta,
      { kind: 'function', name: 'FNAPP_Answer', app: 'fnapp', model: 'Sys', code: 'return "sys";' } as unknown as AnyMeta,
      { kind: 'function', name: 'FNAPP_Answer', app: 'fnapp', model: 'Cus', code: 'return "cus";' } as unknown as AnyMeta,
    ]);
    expect(errors).toEqual([]);
    expect(kernel.actions.get('FNAPP_Answer')!(kernel.context(), {})).toBe('cus');
  });

  it('function compile errors are reported, and previews never execute function code', () => {
    const kernel = bootKernel();
    const manifest = { kind: 'app', name: 'fnapp', models: [{ name: 'Cus', layer: 'CUS' }] } as unknown as AnyMeta;
    const bad = {
      kind: 'function',
      name: 'FNAPP_Broken',
      app: 'fnapp',
      model: 'Cus',
      code: 'this is not javascript ((',
    } as unknown as AnyMeta;
    const previewErrors = kernel.previewWebArtifacts([manifest, bad]);
    expect(previewErrors).toEqual([]); // structural preview only — code blanked
    const errors = kernel.applyWebArtifacts([manifest, bad]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ kind: 'function', name: 'FNAPP_Broken' });
  });

  it('a new user app has no models until the user creates one', () => {
    const kernel = bootKernel();
    const errors = kernel.applyWebArtifacts([
      { kind: 'app', name: 'fresh', label: 'Fresh' } as unknown as AnyMeta,
    ]);
    expect(errors).toEqual([]);
    const fresh = kernel.registry.loadedApps().find((a) => a.name === 'fresh');
    expect(fresh).toBeDefined();
    expect(fresh?.models ?? []).toEqual([]);

    // an artifact under a model-less app is rejected until a model exists
    const errors2 = kernel.applyWebArtifacts([
      { kind: 'app', name: 'fresh', label: 'Fresh' } as unknown as AnyMeta,
      { kind: 'table', name: 'FRESH_Item', app: 'fresh', fields: [{ name: 'x', type: 'string' }] } as unknown as AnyMeta,
    ]);
    expect(errors2).toHaveLength(1);
    expect(errors2[0].error).toMatch(/model/i);
  });

  it('cannot redefine an existing file-based artifact', () => {
    const kernel = bootKernel();
    const errors = kernel.applyWebArtifacts([
      { kind: 'table', name: 'TESTAPP_CustTable', app: 'testapp', model: 'Base', fields: [] } as unknown as AnyMeta,
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toMatch(/Duplicate/);
  });
});
