import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Kernel } from '@emu/core';
import nodemailer from 'nodemailer';
import { buildServer } from '../src/server.js';
import { completeTestSetup, TEST_SETUP_CODE } from './setupHelper.js';

const verify = vi.fn(async () => true);
const sendMail = vi.fn(async () => ({ messageId: 'message-1', accepted: ['to@example.test'], rejected: [] }));
vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn(() => ({ verify, sendMail })) } }));

describe('Function integrations', () => {
  let app: FastifyInstance; let auth: { cookie: string }; let kernel: Kernel;
  beforeEach(async () => {
    vi.clearAllMocks();
    app = buildServer({ setupCode: TEST_SETUP_CODE }); await app.ready(); auth = await completeTestSetup(app); kernel = (app as FastifyInstance & { kernel: Kernel }).kernel;
  });

  it('compiles async Functions with await and returns bounded HTTP responses including non-2xx', async () => {
    const artifacts = kernel.webArtifacts.concat({
      kind: 'function', name: 'FW_TEST_Http', app: 'system', model: 'Framework', layer: 'SYS', executionMode: 'async',
      code: 'return await services.http.request({ url: args.url, timeoutMs: 1000 });',
    } as any);
    expect(kernel.applyWebArtifacts(artifacts)).toEqual([]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ error: 'upstream' }), { status: 503, headers: { 'content-type': 'application/json' } }));
    const response = await app.inject({ method: 'POST', url: '/api/action/FW_TEST_Http', headers: auth, payload: { url: 'https://example.test/api' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 503, ok: false, json: { error: 'upstream' } });
    vi.restoreAllMocks();
    await app.close();
  });

  it('rejects oversized HTTP responses', async () => {
    kernel.actions.set('TEST_Large', (_ctx, _args, services) => services!.http.request({ url: 'https://example.test/large' }));
    kernel.actionModes.set('TEST_Large', 'async');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('small', { headers: { 'content-length': String(6 * 1024 * 1024) } }));
    const response = await app.inject({ method: 'POST', url: '/api/action/TEST_Large', headers: auth, payload: {} });
    expect(response.statusCode).toBe(500); expect(response.json().error).toMatch(/exceeds/);
    vi.restoreAllMocks(); await app.close();
  });

  it('returns network and timeout failures to the Function caller', async () => {
    kernel.actions.set('TEST_Timeout', (_ctx, _args, services) => services!.http.request({ url: 'https://example.test/slow', timeoutMs: 1 }));
    kernel.actionModes.set('TEST_Timeout', 'async');
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new DOMException('The operation timed out', 'TimeoutError'));
    const response = await app.inject({ method: 'POST', url: '/api/action/TEST_Timeout', headers: auth, payload: {} });
    expect(response.statusCode).toBe(500); expect(response.json().error).toMatch(/timed out/i);
    vi.restoreAllMocks(); await app.close();
  });

  it('stores SMTP password encrypted and exposes text/HTML email through services', async () => {
    const saved = await app.inject({ method: 'PUT', url: '/api/system/integrations/smtp', headers: auth, payload: {
      host: 'smtp.example.test', port: 465, secure: true, username: 'mailer', password: 'smtp-secret-value', fromAddress: 'noreply@example.test', fromName: 'Emu',
    } });
    expect(saved.statusCode).toBe(200); expect(saved.json()).toMatchObject({ configured: true, passwordConfigured: true });
    const stored = kernel.designerDb.prepare("SELECT value FROM FW_SystemSetting WHERE name='smtp'").get() as { value: string };
    expect(stored.value).not.toContain('smtp-secret-value'); expect(stored.value).toContain('encryptedPassword');
    expect((await app.inject({ method: 'POST', url: '/api/system/integrations/smtp/verify', headers: auth })).statusCode).toBe(200);

    kernel.actions.set('TEST_Email', (_ctx, _args, services) => services!.email.send({ to: 'to@example.test', cc: 'cc@example.test', bcc: 'bcc@example.test', subject: 'Subject', text: 'Text', html: '<p>HTML</p>' }));
    kernel.actionModes.set('TEST_Email', 'async');
    const sent = await app.inject({ method: 'POST', url: '/api/action/TEST_Email', headers: auth, payload: {} });
    expect(sent.statusCode).toBe(200); expect(sent.json().messageId).toBe('message-1');
    expect(nodemailer.createTransport).toHaveBeenCalled();
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: ['to@example.test'], cc: ['cc@example.test'], bcc: ['bcc@example.test'], text: 'Text', html: '<p>HTML</p>' }));
    await app.close();
  });

  it('reports SMTP not configured without leaking secrets', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/system/integrations/smtp/verify', headers: auth });
    expect(response.statusCode).toBe(503); expect(response.json().error).toBe('SMTP is not configured'); await app.close();
  });
});
