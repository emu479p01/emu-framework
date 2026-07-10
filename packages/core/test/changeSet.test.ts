import { describe, expect, it } from 'vitest';
import {
  Kernel,
  metadataRevision,
  previewMetadataChangeSet,
  validateMetadataArtifact,
  validateMetadataChangeSet,
  type MetadataArtifact,
  type MetadataChangeSet,
} from '../src/index.js';

const app: MetadataArtifact = {
  kind: 'app', name: 'sales', label: 'Sales', models: [{ name: 'Customizations', layer: 'CUS' }],
};
const table: MetadataArtifact = {
  kind: 'table', name: 'SALES_Customer', app: 'sales', model: 'Customizations', layer: 'CUS',
  fields: [{ name: 'name', type: 'string', mandatory: true }],
};

describe('metadata schemas and change sets', () => {
  it('validates representative metadata and reports schema paths', () => {
    expect(validateMetadataArtifact(table)).toEqual([]);
    const errors = validateMetadataArtifact({ kind: 'table', name: '', fields: [{ name: 'x', type: 'unknown' }] });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((error) => error.path.includes('name') || error.path.includes('type'))).toBe(true);
  });

  it('validates the public change-set wire shape', () => {
    const changeSet: MetadataChangeSet = {
      version: 1,
      baseRevision: metadataRevision([app, table]),
      operations: [{ op: 'delete', kind: 'table', name: 'SalesCustomer' }],
    };
    expect(validateMetadataChangeSet(changeSet)).toEqual([]);
  });

  it('previews atomically without changing the live registry or database', () => {
    const kernel = new Kernel(':memory:');
    const current = [app, table];
    const updated: MetadataArtifact = { ...table, fields: [...table.fields, { name: 'email', type: 'string' }] };
    const preview = previewMetadataChangeSet(kernel, current, {
      version: 1,
      baseRevision: metadataRevision(current),
      operations: [{ op: 'upsert', kind: 'table', name: table.name, artifact: updated }],
    });
    expect(preview.valid).toBe(true);
    expect(preview.schemaEffects).toContainEqual({ type: 'add-field', target: 'SALES_Customer.email' });
    expect(kernel.registry.hasTable('SALES_Customer')).toBe(false);
    expect(kernel.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='SALES_Customer'").get()).toBeUndefined();
  });

  it('rejects stale revisions and AI-created scripts', () => {
    const kernel = new Kernel(':memory:');
    const preview = previewMetadataChangeSet(kernel, [app], {
      version: 1,
      baseRevision: 'old',
      source: 'ai',
      operations: [{ op: 'upsert', kind: 'script', name: 'Unsafe', artifact: { kind: 'script', name: 'Unsafe', code: 'throw 1' } }],
    });
    expect(preview.valid).toBe(false);
    expect(preview.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(['stale_revision', 'high_risk_script']));
  });

  it('marks table deletion as destructive metadata while preserving data policy', () => {
    const kernel = new Kernel(':memory:');
    const current = [app, table];
    const preview = previewMetadataChangeSet(kernel, current, {
      version: 1,
      baseRevision: metadataRevision(current),
      operations: [{ op: 'delete', kind: 'table', name: table.name }],
    });
    expect(preview.valid).toBe(true);
    expect(preview.destructive).toBe(true);
    expect(preview.schemaEffects).toContainEqual({ type: 'orphan-table', target: table.name });
  });
});
