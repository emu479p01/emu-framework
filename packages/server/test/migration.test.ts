import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Kernel } from '@emu/core';
import { buildServer } from '../src/server.js';

const kernelOf = (app: unknown): Kernel => (app as { kernel: Kernel }).kernel;

describe('manifest models boot migration', () => {
  it('patches stored app manifests without models from their artifacts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'emu-migration-'));
    const dbPath = join(dir, 'data.sqlite');
    const designerDbPath = join(dir, 'designer.sqlite');

    // Boot once to create the schema, then store an OLD-format app: manifest
    // without `models` plus an artifact referencing the previously auto-injected
    // 'ClientCustom' model.
    const first = buildServer({ dbPath, designerDbPath });
    await first.ready();
    const insert = kernelOf(first).designerDb.prepare(`
      INSERT INTO "FW_WebArtifact" (kind, name, json, createdAt, createdBy, modifiedAt, modifiedBy)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, 'test', CURRENT_TIMESTAMP, 'test')
    `);
    insert.run('app', 'legacy', JSON.stringify({ kind: 'app', name: 'legacy', label: 'Legacy' }));
    insert.run('table', 'LEGACY_Item', JSON.stringify({
      kind: 'table',
      name: 'LEGACY_Item',
      app: 'legacy',
      model: 'ClientCustom',
      layer: 'CUS',
      fields: [{ name: 'title', type: 'string', mandatory: true }],
    }));
    await first.close();

    // Second boot must migrate the manifest and load the artifact without errors.
    const second = buildServer({ dbPath, designerDbPath });
    await second.ready();
    const kernel = kernelOf(second);
    const legacy = kernel.registry.loadedApps().find((a) => a.name === 'legacy');
    expect(legacy?.models).toEqual([{ name: 'ClientCustom', label: 'ClientCustom', layer: 'CUS' }]);
    expect(kernel.registry.hasTable('LEGACY_Item')).toBe(true);
    const stored = kernel.designerDb.prepare('SELECT json FROM "FW_WebArtifact" WHERE name = ?').get('legacy') as { json: string };
    expect(JSON.parse(stored.json).models).toHaveLength(1);
    await second.close();
  });
});
