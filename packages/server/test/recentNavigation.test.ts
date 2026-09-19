import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AnyMeta, Kernel } from '@emu/core';
import { buildServer } from '../src/server.js';
import { hashPassword } from '../src/auth.js';
import { persistStoredArtifacts } from '../src/designer.js';
import { applyErpSample } from './fixtures/erpSample.js';
import { completeTestSetup, TEST_ADMIN_PASSWORD, TEST_SETUP_CODE } from './setupHelper.js';

const storedOf = (kernel: Kernel): AnyMeta[] =>
  kernel.designerContext().select('FW_WebArtifact').toArray().map((row) => JSON.parse(String(row.f.json)) as AnyMeta);

function manyAppArtifacts(): AnyMeta[] {
  const fw = { app: 'manyapp', model: 'Main', layer: 'SYS' as const };
  const items = Array.from({ length: 12 }, (_, index) => ({ id: `many-${index + 1}`, label: `Screen ${index + 1}`, form: `MANYAPP_F${index + 1}Form` }));
  return [
    { kind: 'app', name: 'manyapp', models: [{ name: 'Main', label: 'Main', layer: 'SYS' }] } as any,
    { kind: 'table', name: 'MANYAPP_Table', ...fw, fields: [{ name: 'name', type: 'string' }] } as AnyMeta,
    ...items.map((item) => ({ kind: 'form', name: item.form, ...fw, table: 'MANYAPP_Table' } as AnyMeta)),
    { kind: 'menu', name: 'MANYAPP_Menu', ...fw, items } as AnyMeta,
  ];
}

describe('recent navigation history', () => {
  let app: FastifyInstance; let kernel: Kernel; let auth: { cookie: string };
  const open = async (itemId: string) =>
    app.inject({ method: 'POST', url: '/api/navigation/recent', headers: auth, payload: { menuName: 'MANYAPP_Menu', itemId } });
  const preferences = async () => (await app.inject({ method: 'GET', url: '/api/navigation/preferences', headers: auth })).json();
  const parseTs = (value: string) => Date.parse(String(value).includes('T') ? value : `${String(value).replace(' ', 'T')}Z`);

  beforeAll(async () => {
    app = buildServer({ setupCode: TEST_SETUP_CODE }); await app.ready(); await completeTestSetup(app);
    kernel = (app as FastifyInstance & { kernel: Kernel }).kernel;
    applyErpSample(kernel);
    const candidates = [...storedOf(kernel), ...manyAppArtifacts()];
    expect(kernel.applyWebArtifacts(candidates)).toEqual([]);
    persistStoredArtifacts(kernel, candidates);
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: TEST_ADMIN_PASSWORD } });
    auth = { cookie: (login.headers['set-cookie'] as string).split(';')[0] };
  });
  afterAll(() => app.close());

  it('keeps at most ten unique items per user and moves reopened items to the top', async () => {
    for (let index = 1; index <= 11; index += 1) {
      expect((await open(`many-${index}`)).statusCode).toBe(200);
    }
    let prefs = await preferences();
    expect(prefs.recent).toHaveLength(10);
    expect(prefs.recent[0]).toMatchObject({ menuName: 'MANYAPP_Menu', itemId: 'many-11' });
    expect(prefs.recent.some((entry: any) => entry.itemId === 'many-1')).toBe(false);
    expect((await open('many-1')).statusCode).toBe(200);
    prefs = await preferences();
    expect(prefs.recent[0]).toMatchObject({ itemId: 'many-1' });
    expect(prefs.recent).toHaveLength(10);
  });

  it('orders same-second opens deterministically with millisecond timestamps', async () => {
    const before = (await preferences()).recent.map((entry: any) => parseTs(entry.lastOpenedAt)).filter(Number.isFinite);
    await open('many-2');
    await open('many-3');
    const rows = kernel.db.prepare(`SELECT itemId,lastOpenedAt FROM "FW_NavigationItem" WHERE userId=(SELECT id FROM "FW_User" WHERE username='admin') AND itemId IN ('many-2','many-3') AND lastOpenedAt IS NOT NULL`).all() as Array<{ itemId: string; lastOpenedAt: string }>;
    expect(rows).toHaveLength(2);
    const stamps = rows.map((row) => parseTs(row.lastOpenedAt));
    expect(stamps.every((stamp) => Number.isFinite(stamp))).toBe(true);
    const maxBefore = Math.max(...before);
    expect(Math.min(...stamps)).toBeGreaterThan(maxBefore);
    expect(Math.max(...stamps)).toBeGreaterThan(Math.min(...stamps));
    const prefs = await preferences();
    expect(prefs.recent[0]).toMatchObject({ itemId: 'many-3' });
    expect(prefs.recent[1]).toMatchObject({ itemId: 'many-2' });
  });

  it('keeps favorite rows alive outside the recent window', async () => {
    expect((await app.inject({ method: 'PUT', url: `/api/navigation/favorites/MANYAPP_Menu/${encodeURIComponent('many-4')}`, headers: auth, payload: { favorite: true } })).statusCode).toBe(200);
    const prefs = await preferences();
    expect(prefs.favorites.some((entry: any) => entry.itemId === 'many-4')).toBe(true);
    expect(prefs.recent.length).toBeLessThanOrEqual(10);
  });

  it('is isolated per user and only records permitted menu items', async () => {
    const now = new Date().toISOString();
    kernel.db.prepare(`INSERT INTO "FW_User" (createdAt,createdBy,modifiedAt,modifiedBy,username,displayName,passwordHash,enabled,locale)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(now, 'admin', now, 'admin', 'solo', 'Solo User', hashPassword('Solo-password-123'), 1, 'en');
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'solo', password: 'Solo-password-123' } });
    expect(login.statusCode).toBe(200);
    const soloAuth = { cookie: (login.headers['set-cookie'] as string).split(';')[0] };
    const collect = (items: any[], out: any[]) => items.forEach((item) => (item.items?.length ? collect(item.items, out) : out.push(item)));
    // solo sees no app menus; the always-permitted account route is the only recordable item
    const soloMeta = (await app.inject({ method: 'GET', url: '/api/metadata', headers: soloAuth })).json();
    let account: { menuName: string; itemId: string } | null = null;
    for (const menu of soloMeta.frameworkMenus) {
      const leaves: any[] = [];
      collect(menu.items ?? [], leaves);
      const hit = leaves.find((item) => item.route === '/account/password');
      if (hit) { account = { menuName: menu.name, itemId: hit.id }; break; }
    }
    expect(account).toBeTruthy();
    expect((await app.inject({ method: 'POST', url: '/api/navigation/recent', headers: soloAuth, payload: { menuName: account!.menuName, itemId: account!.itemId } })).statusCode).toBe(200);
    // an ERP menu item is not permitted for solo → the write is rejected
    const adminMeta = (await app.inject({ method: 'GET', url: '/api/metadata', headers: auth })).json();
    const erpMenu = adminMeta.apps.find((entry: any) => entry.name === 'erp').menus[0];
    const erpLeaves: any[] = [];
    collect(erpMenu.items, erpLeaves);
    expect((await app.inject({ method: 'POST', url: '/api/navigation/recent', headers: soloAuth, payload: { menuName: erpMenu.name, itemId: erpLeaves[0].id } })).statusCode).toBe(404);
    // admin history is untouched by solo's activity
    const adminPrefs = await preferences();
    expect(adminPrefs.recent.some((entry: any) => entry.itemId === account!.itemId)).toBe(false);
  });

  it('prunes history for menus that no longer exist', async () => {
    expect((await app.inject({ method: 'DELETE', url: '/api/designer/artifacts/app/manyapp', headers: auth })).statusCode).toBe(200);
    const prefs = await preferences();
    expect(prefs.recent.every((entry: any) => entry.menuName !== 'MANYAPP_Menu')).toBe(true);
    expect(prefs.recent.length).toBeLessThanOrEqual(10);
  });
});
