import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import pdfMake from 'pdfmake';
// @ts-expect-error pdfmake ships this descriptor without declarations
import robotoFonts from 'pdfmake/fonts/Roboto.js';
import type { Kernel, ReportMeta } from '@emu/core';

export const DEFAULT_REPORT_FONT = 'Roboto';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const cacheDir = () => process.env.EMU_FONT_DIR ?? (process.env.EMU_DEPLOYMENT_MODE === 'docker' ? '/data/fonts' : join(root, 'fonts'));
const MAX_FONT_BYTES = 20 * 1024 * 1024;

export interface InstalledFont { family: string; version?: string; subsets: string[]; variants: Record<string, string>; checksum: string; license: string; installedAt: string }
export interface GoogleFont { family: string; version?: string; subsets: string[]; variants: string[]; files: Record<string, string>; category?: string }

function init(kernel: Kernel): void {
  kernel.designerDb.exec(`
    CREATE TABLE IF NOT EXISTS FW_SystemSetting (name TEXT PRIMARY KEY, value TEXT NOT NULL, modifiedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS FW_Font (family TEXT PRIMARY KEY, json TEXT NOT NULL, modifiedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  `);
}

export function configuredFonts(kernel: Kernel): InstalledFont[] {
  init(kernel);
  return (kernel.designerDb.prepare('SELECT json FROM FW_Font ORDER BY family').all() as { json: string }[]).map((row) => JSON.parse(row.json));
}

export function registerPdfFonts(kernel: Kernel): Set<string> {
  const definitions: Record<string, { normal: string; bold: string; italics: string; bolditalics: string }> = { Roboto: robotoFonts.Roboto };
  for (const font of configuredFonts(kernel)) {
    const regular = font.variants.regular;
    if (!regular || !existsSync(join(cacheDir(), regular))) continue;
    const pick = (variant: string, fallback: string) => join(cacheDir(), font.variants[variant] ?? font.variants[fallback] ?? regular);
    definitions[font.family] = { normal: pick('regular', 'regular'), bold: pick('700', 'regular'), italics: pick('italic', 'regular'), bolditalics: pick('700italic', '700') };
  }
  pdfMake.addFonts(definitions);
  return new Set(Object.keys(definitions));
}

function safeFamily(value: string): string { return value.replace(/[^a-z0-9 _-]/gi, '').trim(); }
function isTtf(data: Uint8Array): boolean {
  return data.length >= 4 && ((data[0] === 0 && data[1] === 1 && data[2] === 0 && data[3] === 0) || new TextDecoder().decode(data.subarray(0, 4)) === 'OTTO');
}

async function catalog(kernel: Kernel): Promise<GoogleFont[]> {
  init(kernel);
  const row = kernel.designerDb.prepare("SELECT value FROM FW_SystemSetting WHERE name='googleFontsApiKey'").get() as { value: string } | undefined;
  if (!row?.value) throw Object.assign(new Error('Google Fonts API key is not configured'), { statusCode: 409 });
  const response = await fetch(`https://www.googleapis.com/webfonts/v1/webfonts?sort=alpha&key=${encodeURIComponent(row.value)}`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw Object.assign(new Error(`Google Fonts returned HTTP ${response.status}`), { statusCode: 502 });
  return ((await response.json()) as { items: GoogleFont[] }).items;
}

async function install(kernel: Kernel, familyName: string): Promise<InstalledFont> {
  const item = (await catalog(kernel)).find((font) => font.family === familyName);
  if (!item) throw Object.assign(new Error(`Unknown Google Font '${familyName}'`), { statusCode: 404 });
  const family = safeFamily(item.family);
  const wanted = ['regular', '700', 'italic', '700italic'];
  const variants: Record<string, string> = {};
  const hashes: string[] = [];
  await mkdir(join(cacheDir(), family), { recursive: true });
  for (const variant of wanted) {
    const rawUrl = item.files[variant];
    if (!rawUrl) continue;
    const url = new URL(rawUrl.replace(/^http:/, 'https:'));
    if (url.protocol !== 'https:' || url.hostname !== 'fonts.gstatic.com') throw new Error('Google Fonts returned an untrusted font URL');
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Font download returned HTTP ${response.status}`);
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.length > MAX_FONT_BYTES || !isTtf(data)) throw new Error('Downloaded font is not a supported TTF/OTF file');
    const relative = `${family}/${variant}.ttf`;
    await writeFile(join(cacheDir(), relative), data);
    variants[variant] = relative;
    hashes.push(createHash('sha256').update(data).digest('hex'));
  }
  if (!variants.regular) throw new Error(`Font '${family}' has no regular TTF variant`);
  const installed: InstalledFont = { family, version: item.version, subsets: item.subsets, variants, checksum: createHash('sha256').update(hashes.join(':')).digest('hex'), license: 'See Google Fonts family license', installedAt: new Date().toISOString() };
  kernel.designerDb.prepare('INSERT INTO FW_Font (family,json) VALUES (?,?) ON CONFLICT(family) DO UPDATE SET json=excluded.json, modifiedAt=CURRENT_TIMESTAMP').run(family, JSON.stringify(installed));
  registerPdfFonts(kernel);
  return installed;
}

export function registerFontRoutes(app: FastifyInstance, kernel: Kernel, requireAdmin: (req: FastifyRequest) => string, requireUser: (req: FastifyRequest) => unknown): void {
  init(kernel); registerPdfFonts(kernel);
  app.get('/api/fonts', (req) => { requireUser(req); return { defaultFont: DEFAULT_REPORT_FONT, fonts: [{ family: DEFAULT_REPORT_FONT, builtIn: true }, ...configuredFonts(kernel).map((font) => ({ ...font, builtIn: false }))] }; });
  app.get('/api/system/fonts/settings', (req) => { requireAdmin(req); const row = kernel.designerDb.prepare("SELECT value FROM FW_SystemSetting WHERE name='googleFontsApiKey'").get() as { value: string } | undefined; return { configured: Boolean(row?.value), maskedKey: row?.value ? `••••${row.value.slice(-4)}` : '' }; });
  app.put<{ Body: { apiKey?: string } }>('/api/system/fonts/settings', (req) => { requireAdmin(req); const key = req.body?.apiKey?.trim(); if (!key) kernel.designerDb.prepare("DELETE FROM FW_SystemSetting WHERE name='googleFontsApiKey'").run(); else kernel.designerDb.prepare("INSERT INTO FW_SystemSetting(name,value) VALUES('googleFontsApiKey',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value, modifiedAt=CURRENT_TIMESTAMP").run(key); return { ok: true, configured: Boolean(key) }; });
  app.get('/api/system/fonts/catalog', async (req) => { requireAdmin(req); return { fonts: (await catalog(kernel)).map(({ family, variants, subsets, category, version }) => ({ family, variants, subsets, category, version })) }; });
  app.post<{ Params: { family: string } }>('/api/system/fonts/:family/install', async (req) => { requireAdmin(req); return install(kernel, decodeURIComponent(req.params.family)); });
  app.delete<{ Params: { family: string } }>('/api/system/fonts/:family', async (req, reply) => { requireAdmin(req); const family = decodeURIComponent(req.params.family); const used = kernel.registry.allReports().filter((report) => report.defaultFont === family || report.bands.some((band) => band.elements.some((element) => element.style?.fontFamily === family)) || report.lineSources?.some((line) => line.bands.some((band) => band.elements.some((element) => element.style?.fontFamily === family)))); if (used.length) return reply.status(409).send({ error: `Font is used by: ${used.map((r) => r.name).join(', ')}` }); kernel.designerDb.prepare('DELETE FROM FW_Font WHERE family=?').run(family); await rm(join(cacheDir(), safeFamily(family)), { recursive: true, force: true }); registerPdfFonts(kernel); return { ok: true }; });
  app.get<{ Params: { family: string; variant: string } }>('/api/fonts/:family/:variant', async (req, reply) => { requireUser(req); const family = configuredFonts(kernel).find((font) => font.family === decodeURIComponent(req.params.family)); const relative = family?.variants[req.params.variant] ?? family?.variants[req.params.variant.includes('italic') ? 'italic' : req.params.variant === '700' ? '700' : 'regular'] ?? family?.variants.regular; if (!relative) return reply.status(404).send({ error: 'Font variant not found' }); reply.header('Content-Type', 'font/ttf'); reply.header('Cache-Control', 'private, max-age=86400'); return reply.send(await readFile(join(cacheDir(), relative))); });
}

export function fontCachePath(): string { return cacheDir(); }

export function missingReportFonts(kernel: Kernel, report: ReportMeta): string[] {
  const available = new Set([DEFAULT_REPORT_FONT, ...configuredFonts(kernel).map((font) => font.family)]);
  const requested = new Set<string>();
  if (report.defaultFont) requested.add(report.defaultFont);
  for (const band of [...report.bands, ...(report.lineSources ?? []).flatMap((line) => line.bands)]) for (const element of band.elements) if (element.style?.fontFamily) requested.add(element.style.fontFamily);
  return [...requested].filter((font) => !available.has(font));
}
