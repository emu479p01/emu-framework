import { describe, expect, it } from 'vitest';
import { Kernel, type AnyMeta } from '../src/index.js';

function performanceCorpus(): AnyMeta[] {
  const artifacts: AnyMeta[] = [];
  for (let appIndex = 0; appIndex < 50; appIndex += 1) {
    const app = `perf${appIndex}`;
    const prefix = `PERF${appIndex}`;
    const base = { app, model: 'Base', layer: 'SYS' as const };
    artifacts.push({ kind: 'app', name: app, models: [{ name: 'Base', layer: 'SYS' }, { name: 'ClientCustom', layer: 'CUS' }] } as unknown as AnyMeta);
    for (let index = 0; index < 88; index += 1) {
      artifacts.push({ kind: 'enum', name: `${prefix}_Enum${index}`, ...base, values: [{ name: 'Active', value: 0 }] } as AnyMeta);
    }
    artifacts.push(
      { kind: 'table', name: `${prefix}_Header`, ...base, fields: [{ name: 'name', type: 'string' }] } as AnyMeta,
      { kind: 'table', name: `${prefix}_Line`, ...base, fields: [{ name: 'headerId', type: 'reference', reference: { table: `${prefix}_Header` } }, { name: 'amount', type: 'real' }] } as AnyMeta,
      { kind: 'form', name: `${prefix}_Form`, ...base, table: `${prefix}_Header`, lines: [{ id: `${prefix.toLowerCase()}-lines`, table: `${prefix}_Line`, refField: 'headerId', fields: ['amount'] }] } as AnyMeta,
      { kind: 'menu', name: `${prefix}_Menu`, ...base, items: [{ form: `${prefix}_Form` }] } as AnyMeta,
      { kind: 'script', name: `${prefix}_Script`, ...base, code: '' } as AnyMeta,
      { kind: 'function', name: `${prefix}_Function`, ...base, code: '' } as AnyMeta,
      { kind: 'view', name: `${prefix}_View`, ...base, source: { table: `${prefix}_Header`, alias: 'h' }, columns: [{ name: 'name', expression: { type: 'field', ref: 'h.name' } }] } as AnyMeta,
      { kind: 'chart', name: `${prefix}_Chart`, ...base, type: 'bar', view: `${prefix}_View`, dimension: 'name', measures: [{ field: 'name' }] } as AnyMeta,
      { kind: 'report', name: `${prefix}_Report`, ...base, dataSource: `${prefix}_Header`, bands: [] } as AnyMeta,
      { kind: 'formExtension', name: `${prefix}_ClientCustom_${prefix}_Form_Extension`, app, model: 'ClientCustom', layer: 'CUS', form: `${prefix}_Form`, lineOverrides: [{ targetId: `${prefix.toLowerCase()}-lines`, label: 'Effective lines' }] } as AnyMeta,
      { kind: 'tableExtension', name: `${prefix}_ClientCustom_${prefix}_Header_Extension`, app, model: 'ClientCustom', layer: 'CUS', table: `${prefix}_Header`, fields: [{ name: 'note', type: 'string' }] } as AnyMeta,
    );
  }
  return artifacts;
}

describe('metadata performance corpus', () => {
  it('builds 5,000 mixed artifacts across 50 Apps without a per-artifact registry rebuild', () => {
    const kernel = new Kernel();
    const artifacts = performanceCorpus();
    const startedAt = performance.now();
    const errors = kernel.applyWebArtifacts(artifacts);
    const elapsedMs = performance.now() - startedAt;
    expect(artifacts).toHaveLength(5_000);
    expect(errors).toEqual([]);
    expect(kernel.lastApplyMetrics.artifactCount).toBe(5_000);
    expect(elapsedMs).toBeLessThan(3_000);
    kernel.db.close();
    kernel.designerDb.close();
  });
});
