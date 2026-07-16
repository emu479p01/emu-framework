import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import nodemailer from 'nodemailer';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EmailSendInput, FunctionServices, HttpRequestInput, HttpResponseOutput, Kernel } from '@emu/core';

const SETTINGS_TABLE = 'FW_SystemSetting';
const SMTP_SETTING = 'smtp';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_MESSAGE_BYTES = 1024 * 1024;
const MAX_RECIPIENTS = 50;

interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  username?: string;
  encryptedPassword?: string;
  fromAddress: string;
  fromName?: string;
}

export interface PublicSmtpSettings {
  configured: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  passwordConfigured: boolean;
  fromAddress: string;
  fromName: string;
}

function ensureSettingsTable(kernel: Kernel): void {
  kernel.designerDb.exec(`
    CREATE TABLE IF NOT EXISTS "${SETTINGS_TABLE}" (
      name TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      modifiedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function secretKey(designerDbPath?: string): Buffer {
  const configured = process.env.EMU_SECRET_KEY_PATH;
  const keyPath = configured ?? (designerDbPath && designerDbPath !== ':memory:' ? join(dirname(designerDbPath), '.emu-secret.key') : undefined);
  if (!keyPath) return randomBytes(32);
  if (existsSync(keyPath)) {
    const value = readFileSync(keyPath, 'utf8').trim();
    const key = Buffer.from(value, 'hex');
    if (key.length !== 32) throw new Error(`Invalid integration secret key at '${keyPath}'`);
    return key;
  }
  mkdirSync(dirname(keyPath), { recursive: true });
  const key = randomBytes(32);
  writeFileSync(keyPath, key.toString('hex'), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  try { chmodSync(keyPath, 0o600); } catch { /* Windows permissions are inherited. */ }
  return key;
}

function encrypt(value: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join(':');
}

function decrypt(value: string, key: Buffer): string {
  const [version, iv, tag, encrypted] = value.split(':');
  if (version !== 'v1' || !iv || !tag || !encrypted) throw new Error('SMTP password cannot be decrypted; restore the integration secret key or enter the password again');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8');
}

async function boundedBody(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error(`HTTP response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(`HTTP response exceeds ${MAX_RESPONSE_BYTES} bytes`);
    }
    chunks.push(value);
  }
  const result = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(result);
}

async function httpRequest(input: HttpRequestInput): Promise<HttpResponseOutput> {
  const url = new URL(input.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only HTTP and HTTPS URLs are supported');
  if (input.json !== undefined && input.text !== undefined) throw new Error('Specify either json or text, not both');
  const timeoutMs = Math.max(1, Math.min(Number(input.timeoutMs ?? DEFAULT_TIMEOUT_MS), MAX_TIMEOUT_MS));
  const headers = new Headers(input.headers ?? {});
  let body: string | undefined;
  if (input.json !== undefined) {
    headers.set('content-type', headers.get('content-type') ?? 'application/json');
    body = JSON.stringify(input.json);
  } else if (input.text !== undefined) body = input.text;
  const response = await fetch(url, {
    method: String(input.method ?? (body === undefined ? 'GET' : 'POST')).toUpperCase(),
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await boundedBody(response);
  let json: unknown | null = null;
  if (text) { try { json = JSON.parse(text); } catch { /* non-JSON body */ } }
  const outputHeaders: Record<string, string> = {};
  response.headers.forEach((value, name) => { outputHeaders[name] = value; });
  return { status: response.status, ok: response.ok, headers: outputHeaders, text, json };
}

function addresses(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).map((entry) => entry.trim()).filter(Boolean);
}

export function createIntegrationManager(kernel: Kernel, designerDbPath?: string) {
  ensureSettingsTable(kernel);
  const key = secretKey(designerDbPath);
  const readSettings = (): SmtpSettings | null => {
    const row = kernel.designerDb.prepare(`SELECT value FROM "${SETTINGS_TABLE}" WHERE name = ?`).get(SMTP_SETTING) as { value: string } | undefined;
    if (!row) return null;
    try { return JSON.parse(row.value) as SmtpSettings; } catch { return null; }
  };
  const publicSettings = (): PublicSmtpSettings => {
    const value = readSettings();
    return {
      configured: Boolean(value?.host && value.fromAddress), host: value?.host ?? '', port: value?.port ?? 587,
      secure: value?.secure ?? false, username: value?.username ?? '', passwordConfigured: Boolean(value?.encryptedPassword),
      fromAddress: value?.fromAddress ?? '', fromName: value?.fromName ?? '',
    };
  };
  const saveSettings = (input: { host?: string; port?: number; secure?: boolean; username?: string; password?: string; fromAddress?: string; fromName?: string }): PublicSmtpSettings => {
    const existing = readSettings();
    const host = String(input.host ?? '').trim();
    const port = Number(input.port ?? 587);
    const fromAddress = String(input.fromAddress ?? '').trim();
    if (!host || !fromAddress) throw Object.assign(new Error('SMTP host and sender address are required'), { statusCode: 422 });
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw Object.assign(new Error('SMTP port must be between 1 and 65535'), { statusCode: 422 });
    const settings: SmtpSettings = {
      host, port, secure: Boolean(input.secure), username: String(input.username ?? '').trim() || undefined,
      encryptedPassword: input.password ? encrypt(input.password, key) : existing?.encryptedPassword,
      fromAddress, fromName: String(input.fromName ?? '').trim() || undefined,
    };
    kernel.designerDb.prepare(`INSERT INTO "${SETTINGS_TABLE}"(name,value) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value, modifiedAt=CURRENT_TIMESTAMP`).run(SMTP_SETTING, JSON.stringify(settings));
    return publicSettings();
  };
  const transport = () => {
    const settings = readSettings();
    if (!settings?.host || !settings.fromAddress) throw Object.assign(new Error('SMTP is not configured'), { statusCode: 503 });
    const password = settings.encryptedPassword ? decrypt(settings.encryptedPassword, key) : undefined;
    return {
      settings,
      client: nodemailer.createTransport({
        host: settings.host, port: settings.port, secure: settings.secure,
        auth: settings.username ? { user: settings.username, pass: password ?? '' } : undefined,
        connectionTimeout: DEFAULT_TIMEOUT_MS, greetingTimeout: DEFAULT_TIMEOUT_MS, socketTimeout: DEFAULT_TIMEOUT_MS,
        tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      }),
    };
  };
  const send = async (input: EmailSendInput) => {
    const to = addresses(input.to); const cc = addresses(input.cc); const bcc = addresses(input.bcc);
    if (to.length === 0) throw new Error('At least one To recipient is required');
    if (to.length + cc.length + bcc.length > MAX_RECIPIENTS) throw new Error(`Email is limited to ${MAX_RECIPIENTS} recipients`);
    if (!input.subject?.trim()) throw new Error('Email subject is required');
    if (!input.text && !input.html) throw new Error('Email text or html body is required');
    if (Buffer.byteLength(`${input.subject}${input.text ?? ''}${input.html ?? ''}`, 'utf8') > MAX_MESSAGE_BYTES) throw new Error(`Email content exceeds ${MAX_MESSAGE_BYTES} bytes`);
    const { settings, client } = transport();
    const from = settings.fromName ? { name: settings.fromName, address: settings.fromAddress } : settings.fromAddress;
    const info = await client.sendMail({ from, to, cc, bcc, replyTo: input.replyTo, subject: input.subject, text: input.text, html: input.html });
    return { messageId: info.messageId, accepted: (info.accepted ?? []).map(String), rejected: (info.rejected ?? []).map(String) };
  };
  const services: FunctionServices = { http: { request: httpRequest }, email: { send } };
  return { services, publicSettings, saveSettings, verify: async () => { const { client } = transport(); return client.verify(); }, send };
}

export function registerIntegrationRoutes(
  app: FastifyInstance,
  manager: ReturnType<typeof createIntegrationManager>,
  requireAdmin: (req: FastifyRequest) => string,
): void {
  app.get('/api/system/integrations/smtp', (req) => { requireAdmin(req); return manager.publicSettings(); });
  app.put<{ Body: Parameters<typeof manager.saveSettings>[0] }>('/api/system/integrations/smtp', (req) => { requireAdmin(req); return manager.saveSettings(req.body ?? {}); });
  app.post('/api/system/integrations/smtp/verify', async (req) => { requireAdmin(req); await manager.verify(); return { ok: true }; });
  app.post<{ Body: { to?: string } }>('/api/system/integrations/smtp/test', async (req) => {
    requireAdmin(req);
    const to = String(req.body?.to ?? '').trim();
    if (!to) throw Object.assign(new Error('Test recipient is required'), { statusCode: 422 });
    return manager.send({ to, subject: 'EmuFramework SMTP test', text: 'SMTP configuration is working.', html: '<p>SMTP configuration is working.</p>' });
  });
}
