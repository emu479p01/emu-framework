import { describe, it, expect } from 'vitest';
import { Kernel, type AnyMeta } from '../src/index.js';
import { TESTAPP_CustTable, salesStatusEnum, TESTAPP_SalesTable } from './helpers.js';

function bootKernel(): Kernel {
  const kernel = new Kernel();
  kernel.registerApp({ name: 'testapp' }, [salesStatusEnum, TESTAPP_CustTable, TESTAPP_SalesTable]);
  kernel.sync();
  return kernel;
}

const webTable: AnyMeta = {
  kind: 'table',
  name: 'WEB_WebNote',
  titleField: 'title',
  fields: [
    { name: 'title', type: 'string', mandatory: true },
    { name: 'body', type: 'string' },
  ],
};

const webForm: AnyMeta = { kind: 'form', name: 'WEB_WebNoteForm', table: 'WEB_WebNote' };

describe('Kernel.applyWebArtifacts', () => {
  it('adds new runtime artifacts and syncs schema — usable immediately', () => {
    const kernel = bootKernel();
    const errors = kernel.applyWebArtifacts([webForm, webTable]); // out of order on purpose
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
    const bad: AnyMeta = { kind: 'form', name: 'WEB_BadForm', table: 'Nope' };
    const errors = kernel.applyWebArtifacts([webTable, bad]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ name: 'WEB_BadForm' });
    expect(kernel.registry.hasTable('WEB_WebNote')).toBe(true);
  });

  it('re-apply replaces the web layer (edit + delete semantics)', () => {
    const kernel = bootKernel();
    kernel.applyWebArtifacts([webTable, webForm]);
    // now remove the form, keep only the table
    const errors = kernel.applyWebArtifacts([webTable]);
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
    kernel.applyWebArtifacts([webTable]); // clears + rebuilds hooks
    const rec = kernel.context().newRecord('TESTAPP_CustTable');
    expect(rec.f.name).toBe('from-native-hook');
    expect(calls).toBeGreaterThan(0);
  });

  it('cannot redefine an existing file-based artifact', () => {
    const kernel = bootKernel();
    const errors = kernel.applyWebArtifacts([
      { kind: 'table', name: 'TESTAPP_CustTable', app: 'testapp', model: 'ClientCustom', fields: [] } as unknown as AnyMeta,
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toMatch(/Duplicate/);
  });
});
