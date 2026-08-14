import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Kernel } from '@emu/core';
import { buildServer } from '../src/server.js';
import { hashPassword } from '../src/auth.js';
import { applyErpSample } from './fixtures/erpSample.js';

const kernelOf = (app: unknown): Kernel => (app as { kernel: Kernel }).kernel;

describe('manifest models boot migration', () => {
  it('migrates v0.1.3 extensions in place and preserves an audit copy', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'emu-v014-migration-'));
    const dbPath = join(dir, 'data.sqlite'); const designerDbPath = join(dir, 'designer.sqlite');
    const first = buildServer({ dbPath, designerDbPath }); await first.ready();
    const db = kernelOf(first).designerDb;
    const insert = db.prepare(`INSERT INTO "FW_WebArtifact" (kind,name,json,createdAt,createdBy,modifiedAt,modifiedBy) VALUES (?,?,?,CURRENT_TIMESTAMP,'test',CURRENT_TIMESTAMP,'test')`);
    insert.run('app', 'legacy', JSON.stringify({ kind: 'app', name: 'legacy', models: [{ name: 'Base', layer: 'SYS' }, { name: 'Cus', layer: 'CUS' }] }));
    insert.run('table', 'LEGACY_Item', JSON.stringify({ kind: 'table', name: 'LEGACY_Item', app: 'legacy', model: 'Base', fields: [{ name: 'status', type: 'enum', enumName: 'LEGACY_Status', mandatory: true }, { name: 'computed', type: 'real', mandatory: true, readOnly: true }] }));
    insert.run('enum', 'LEGACY_Status', JSON.stringify({ kind: 'enum', name: 'LEGACY_Status', app: 'legacy', model: 'Base', values: [{ name: 'Open', value: 0 }] }));
    insert.run('tableExtension', 'LEGACY_Item_Extension', JSON.stringify({ kind: 'tableExtension', name: 'LEGACY_Item_Extension', app: 'legacy', model: 'Cus', table: 'LEGACY_Item', fields: [{ name: 'note', type: 'string' }] }));
    db.prepare(`DELETE FROM "FW_DesignerMigration" WHERE migration='v0.1.4.0-layered-customization'`).run();
    await first.close();

    const second = buildServer({ dbPath, designerDbPath }); await second.ready();
    const kernel = kernelOf(second);
    expect(kernel.registry.getTable('LEGACY_Item').fields.find((field) => field.name === 'status')?.mandatory).toBeUndefined();
    expect(kernel.registry.getTable('LEGACY_Item').fields.find((field) => field.name === 'computed')?.mandatory).toBeUndefined();
    expect(kernel.designerDb.prepare(`SELECT 1 FROM "FW_WebArtifact" WHERE name='LEGACY_Cus_LEGACY_Item_Extension'`).get()).toBeTruthy();
    const auditCount = (kernel.designerDb.prepare(`SELECT COUNT(*) AS count FROM "FW_MetadataMigrationAudit" WHERE migration='v0.1.4.0-layered-customization'`).get() as { count: number }).count;
    expect(auditCount).toBeGreaterThan(0);
    await second.close();

    const third = buildServer({ dbPath, designerDbPath }); await third.ready();
    const thirdKernel = kernelOf(third);
    const systemMenu = JSON.parse((thirdKernel.designerDb.prepare(`SELECT json FROM "FW_WebArtifact" WHERE name='FW_SettingsMenu'`).get() as { json: string }).json);
    expect(systemMenu.items.every((item: { id?: string }) => Boolean(item.id))).toBe(true);
    expect((thirdKernel.designerDb.prepare(`SELECT COUNT(*) AS count FROM "FW_MetadataMigrationAudit" WHERE migration='v0.1.4.0-layered-customization'`).get() as { count: number }).count).toBe(auditCount);
    await third.close();
  });

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
    kernelOf(first).db.prepare(`DELETE FROM "FW_Migration" WHERE migration='v0.1.1.0-explicit-models'`).run();
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

  it('migrates FW_FrameworkUser to existing-App Customize once without granting Open or future Apps', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'emu-security-migration-'));
    const dbPath = join(dir, 'data.sqlite');
    const designerDbPath = join(dir, 'designer.sqlite');
    const first = buildServer({ dbPath, designerDbPath }); await first.ready();
    const kernel = kernelOf(first); applyErpSample(kernel);
    const ctx = kernel.context();
    const user = ctx.newRecord('FW_User').setMany({ username: 'legacy-designer', passwordHash: hashPassword('Legacy-password-123'), enabled: true }); user.insert();
    ctx.newRecord('FW_UserRole').setMany({ userId: user.id, role: 'FW_FrameworkUser' }).insert();
    ctx.newRecord('FW_AppAccess').setMany({ userId: user.id, appName: 'erp', canOpen: false, canCustomize: false }).insert();
    kernel.db.prepare(`DELETE FROM "FW_Migration" WHERE migration='v0.1.1.0-framework-user-customize'`).run();
    await first.close();

    const second = buildServer({ dbPath, designerDbPath }); await second.ready();
    const secondKernel = kernelOf(second);
    const migrated = secondKernel.db.prepare(`SELECT canOpen,canCustomize FROM "FW_AppAccess" WHERE userId=? AND appName='erp'`).get(user.id) as { canOpen: number; canCustomize: number };
    expect(Boolean(migrated.canOpen)).toBe(false);
    expect(Boolean(migrated.canCustomize)).toBe(true);
    expect((secondKernel.db.prepare(`SELECT COUNT(*) AS count FROM "FW_AppAccess" WHERE userId=? AND appName='erp'`).get(user.id) as { count: number }).count).toBe(1);
    const stored = secondKernel.designerContext().select('FW_WebArtifact').toArray().map((row) => JSON.parse(String(row.f.json)));
    const future = { kind: 'app', name: 'future', label: 'Future', models: [] };
    expect(secondKernel.applyWebArtifacts([...stored, future])).toEqual([]);
    secondKernel.designerContext().newRecord('FW_WebArtifact').setMany({ kind: 'app', name: 'future', json: JSON.stringify(future) }).insert();
    await second.close();

    const third = buildServer({ dbPath, designerDbPath }); await third.ready();
    const futureGrant = kernelOf(third).db.prepare(`SELECT 1 FROM "FW_AppAccess" WHERE userId=? AND appName='future'`).get(user.id);
    expect(futureGrant).toBeUndefined();
    await third.close();
  });
});
