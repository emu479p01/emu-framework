import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import type { FastifyInstance } from 'fastify';
import type { Kernel } from '@emu/core';
import { buildServer } from '../src/server.js';
import { hashPassword } from '../src/auth.js';
import { TEST_ADMIN_PASSWORD, TEST_SETUP_CODE } from './setupHelper.js';

const backupPath = process.env.EMU_LEGACY_BACKUP;
const roots: string[] = [];
const apps: FastifyInstance[] = [];
const kernelOf = (app: FastifyInstance): Kernel => (app as FastifyInstance & { kernel: Kernel }).kernel;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function materializeBackup(buffer: Buffer): { root: string; data: string; designer: string } {
  const files = unzipSync(buffer);
  const root = mkdtempSync(join(tmpdir(), 'emu-legacy-backup-')); roots.push(root);
  const data = join(root, 'data.db'); const designer = join(root, 'designer.db');
  writeFileSync(data, files['data.db']); writeFileSync(designer, files['designer.db']);
  return { root, data, designer };
}

afterAll(async () => {
  for (const app of apps) await app.close().catch(() => undefined);
  for (const root of roots) {
    try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
    catch { /* Native SQLite handles can be released only when the Vitest worker exits on Windows. */ }
  }
});

describe('legacy .emubackup compatibility', () => {
  const compatibilityTest = backupPath ? it : it.skip;
  compatibilityTest('boots, no-op saves and round-trips a supplied v0.1.5.0 backup', async () => {
    const source = readFileSync(backupPath!);
    const manifest = JSON.parse(Buffer.from(unzipSync(source)['manifest.json']).toString('utf8'));
    expect(manifest).toMatchObject({ format: 'emuframework-backup', frameworkVersion: '0.1.5.0', schemaVersion: 3 });

    const firstFiles = materializeBackup(source);
    const first = buildServer({ dbPath: firstFiles.data, designerDbPath: firstFiles.designer, setupCode: TEST_SETUP_CODE });
    apps.push(first);
    await first.ready();
    const firstKernel = kernelOf(first);
    const before = clone(firstKernel.registry.allMenus().find((menu) => menu.name === 'ERP_MainMenu'));
    expect(before?.items.length).toBeGreaterThan(0);
    expect(before?.items.every((item) => item.id && item.visible === undefined)).toBe(true);
    const extensionBefore = firstKernel.designerContext().select('FW_WebArtifact').whereEq({ name: 'ERP_Doxbev_ERP_MainMenu_Extension' }).firstOnly();
    expect(extensionBefore).toBeTruthy();

    const ctx = firstKernel.context();
    const owner = ctx.newRecord('FW_User').setMany({ username: 'compat-owner', passwordHash: hashPassword(TEST_ADMIN_PASSWORD), enabled: true }); owner.insert();
    ctx.newRecord('FW_UserRole').setMany({ userId: owner.id, username: 'compat-owner', role: 'FW_SystemAdminRole' }).insert();
    const login = await first.inject({ method: 'POST', url: '/api/login', payload: { username: 'compat-owner', password: TEST_ADMIN_PASSWORD } });
    expect(login.statusCode).toBe(200);
    const auth = { cookie: (login.headers['set-cookie'] as string).split(';')[0] };
    const designer = (await first.inject({ method: 'GET', url: '/api/designer/artifacts', headers: auth })).json();
    const extension = designer.artifacts.find((entry: { name: string }) => entry.name === 'ERP_Doxbev_ERP_MainMenu_Extension').artifact;
    const saved = await first.inject({ method: 'PUT', url: `/api/designer/artifacts/menuExtension/${encodeURIComponent(extension.name)}`, headers: auth, payload: extension });
    expect(saved.statusCode).toBe(200);
    expect(clone(firstKernel.registry.allMenus().find((menu) => menu.name === 'ERP_MainMenu'))).toEqual(before);

    const exported = await first.inject({ method: 'GET', url: '/api/system/backup/export', headers: auth });
    expect(exported.statusCode).toBe(200);
    const exportedManifest = JSON.parse(Buffer.from(unzipSync(exported.rawPayload)['manifest.json']).toString('utf8'));
    expect(exportedManifest.frameworkVersion).toBe('0.5.0.0');
    await first.close();
    apps.splice(apps.indexOf(first), 1);

    const secondFiles = materializeBackup(exported.rawPayload);
    const second = buildServer({ dbPath: secondFiles.data, designerDbPath: secondFiles.designer, setupCode: TEST_SETUP_CODE });
    apps.push(second);
    await second.ready();
    expect(clone(kernelOf(second).registry.allMenus().find((menu) => menu.name === 'ERP_MainMenu'))).toEqual(before);
    await second.close();
    apps.splice(apps.indexOf(second), 1);
  }, 120_000);
});
