import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { completeTestSetup, TEST_SETUP_CODE } from './setupHelper.js';

describe('AI proposal REST API', () => {
  let app: FastifyInstance; let admin: { cookie: string }; let authorization: string;
  beforeAll(async () => {
    app = buildServer({ setupCode: TEST_SETUP_CODE }); await app.ready(); admin = await completeTestSetup(app);
    await app.inject({ method: 'PUT', url: '/api/designer/artifacts/app/web', headers: admin, payload: { kind: 'app', name: 'web', models: [{ name: 'ClientCustom', layer: 'CUS' }] } });
    const token = await app.inject({ method: 'POST', url: '/api/system/ai-tokens', headers: admin, payload: { name: 'Builder', apps: ['web'], scopes: ['inspect', 'validate', 'propose'] } });
    expect(token.statusCode).toBe(201); authorization = `Bearer ${token.json().token}`;
  });

  it('scopes inspection and exposes schemas without business data access', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/ai/capabilities', headers: { authorization } })).json()).toMatchObject({ apply: false, businessData: false, apps: ['web'] });
    expect((await app.inject({ method: 'GET', url: '/api/v1/ai/schemas/artifact', headers: { authorization } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/ai/workspace?app=system', headers: { authorization } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/data/FW_User', headers: { authorization } })).statusCode).not.toBe(200);
  });

  it('accepts executable proposals but requires a scoped human approval', async () => {
    const workspace = (await app.inject({ method: 'GET', url: '/api/v1/ai/workspace?app=web', headers: { authorization } })).json();
    const changeSet = { version: 1, baseRevision: workspace.revision, source: 'ai', description: 'Add reviewed function', operations: [{ op: 'upsert', kind: 'function', name: 'WEB_AiFunction', artifact: { kind: 'function', name: 'WEB_AiFunction', app: 'web', model: 'ClientCustom', layer: 'CUS', code: 'return { ok: true };' } }] };
    const proposal = await app.inject({ method: 'POST', url: '/api/v1/ai/proposals', headers: { authorization }, payload: changeSet });
    expect(proposal.statusCode).toBe(201); expect(proposal.json().preview.diff[0]).toMatchObject({ name: 'WEB_AiFunction', highRisk: true });
    const id = proposal.json().id;
    const inbox = await app.inject({ method: 'GET', url: '/api/designer/ai-proposals', headers: admin });
    expect(inbox.json().data.some((item: any) => item.id === id && item.status === 'pending')).toBe(true);
    expect((await app.inject({ method: 'POST', url: `/api/designer/ai-proposals/${id}/approve`, headers: admin })).statusCode).toBe(200);
    const refreshed = (await app.inject({ method: 'GET', url: '/api/v1/ai/workspace?app=web', headers: { authorization } })).json();
    expect(refreshed.artifacts.some((artifact: any) => artifact.name === 'WEB_AiFunction')).toBe(true);
    expect((await app.inject({ method: 'POST', url: `/api/designer/ai-proposals/${id}/approve`, headers: admin })).statusCode).toBe(409);
  });

  it('revokes tokens immediately', async () => {
    const list = (await app.inject({ method: 'GET', url: '/api/system/ai-tokens', headers: admin })).json();
    await app.inject({ method: 'POST', url: `/api/system/ai-tokens/${list.data[0].id}/revoke`, headers: admin });
    expect((await app.inject({ method: 'GET', url: '/api/v1/ai/capabilities', headers: { authorization } })).statusCode).toBe(401);
  });
});
