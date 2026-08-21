import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  CORE_VERSION,
  metadataArtifactSchema,
  metadataChangeSetSchema,
  metadataRevision,
  previewMetadataChangeSet,
  type AnyMeta,
  type Kernel,
  type MetadataArtifact,
  type MetadataChangeSet,
} from '@emu/core';
import { loadStoredArtifacts, persistStoredArtifacts } from './designer.js';

type AiScope = 'inspect' | 'validate' | 'propose';
interface TokenRow { id: number; name: string; tokenHash: string; appsJson: string; scopesJson: string; expiresAt: string | null; revokedAt: string | null }

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const jsonArray = (value: string): string[] => { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; } };

function createTables(kernel: Kernel): void {
  kernel.designerDb.exec(`
    CREATE TABLE IF NOT EXISTS "FW_AiToken" (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, tokenHash TEXT NOT NULL UNIQUE,
      appsJson TEXT NOT NULL, scopesJson TEXT NOT NULL, expiresAt TEXT, revokedAt TEXT,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, createdBy TEXT NOT NULL, lastUsedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS "FW_AiProposal" (
      id TEXT PRIMARY KEY, tokenId INTEGER NOT NULL, changeSetJson TEXT NOT NULL, previewJson TEXT NOT NULL,
      status TEXT NOT NULL, createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, reviewedAt TEXT, reviewedBy TEXT,
      resultJson TEXT, FOREIGN KEY(tokenId) REFERENCES "FW_AiToken"(id)
    );
    CREATE TABLE IF NOT EXISTS "FW_AiAudit" (
      id INTEGER PRIMARY KEY AUTOINCREMENT, createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      tokenId INTEGER, actor TEXT, action TEXT NOT NULL, proposalId TEXT, detailJson TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS "FW_AiProposalStatusIdx" ON "FW_AiProposal"(status, createdAt);
  `);
}

function affectedApps(changeSet: MetadataChangeSet, current: MetadataArtifact[]): Set<string> {
  const existing = new Map(current.map((artifact) => [artifact.name, artifact]));
  const apps = new Set<string>();
  for (const operation of changeSet.operations ?? []) {
    const artifact = operation.op === 'upsert' ? operation.artifact : existing.get(operation.name);
    if (!artifact) continue;
    apps.add(artifact.kind === 'app' ? artifact.name : artifact.app ?? '');
  }
  apps.delete('');
  return apps;
}

export function registerAiRoutes(
  app: FastifyInstance,
  kernel: Kernel,
  options: {
    requireDesigner: (req: FastifyRequest) => string;
    designerScope: (req: FastifyRequest) => 'all' | Set<string>;
    requireAdmin: (req: FastifyRequest) => string;
  },
): void {
  createTables(kernel);
  const audit = (action: string, detail: unknown, tokenId?: number, actor?: string, proposalId?: string) => {
    kernel.designerDb.prepare('INSERT INTO "FW_AiAudit" (tokenId, actor, action, proposalId, detailJson) VALUES (?, ?, ?, ?, ?)')
      .run(tokenId ?? null, actor ?? null, action, proposalId ?? null, JSON.stringify(detail));
  };
  const requireToken = (req: FastifyRequest, scope: AiScope): TokenRow => {
    const authorization = req.headers.authorization ?? '';
    const secret = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const row = secret ? kernel.designerDb.prepare('SELECT * FROM "FW_AiToken" WHERE tokenHash = ?').get(hashToken(secret)) as TokenRow | undefined : undefined;
    if (!row || row.revokedAt || (row.expiresAt && Date.parse(row.expiresAt) <= Date.now())) throw Object.assign(new Error('Invalid or expired AI token'), { statusCode: 401 });
    if (!jsonArray(row.scopesJson).includes(scope)) throw Object.assign(new Error(`AI token lacks '${scope}' scope`), { statusCode: 403 });
    kernel.designerDb.prepare('UPDATE "FW_AiToken" SET lastUsedAt=CURRENT_TIMESTAMP WHERE id=?').run(row.id);
    return row;
  };
  const assertTokenApps = (token: TokenRow, apps: Set<string>) => {
    const allowed = new Set(jsonArray(token.appsJson));
    for (const appName of apps) if (!allowed.has(appName)) throw Object.assign(new Error(`AI token cannot access app '${appName}'`), { statusCode: 403 });
  };

  app.get('/api/system/ai-tokens', (req) => {
    options.requireAdmin(req);
    const rows = kernel.designerDb.prepare('SELECT id,name,appsJson,scopesJson,expiresAt,revokedAt,createdAt,createdBy,lastUsedAt FROM "FW_AiToken" ORDER BY id DESC').all() as any[];
    return { data: rows.map((row) => ({ ...row, apps: jsonArray(row.appsJson), scopes: jsonArray(row.scopesJson), appsJson: undefined, scopesJson: undefined })) };
  });
  app.post<{ Body: { name?: string; apps?: string[]; scopes?: AiScope[]; expiresAt?: string | null } }>('/api/system/ai-tokens', (req, reply) => {
    const actor = options.requireAdmin(req);
    if (!req.body?.name || !req.body.apps?.length || !req.body.scopes?.length) return reply.status(400).send({ error: 'name, apps and scopes are required' });
    const validScopes = req.body.scopes.filter((scope): scope is AiScope => ['inspect', 'validate', 'propose'].includes(scope));
    if (validScopes.length !== req.body.scopes.length) return reply.status(400).send({ error: 'Unknown AI token scope' });
    const knownApps = new Set(kernel.registry.loadedApps().map((candidate) => candidate.name));
    if (req.body.apps.some((name) => name === 'system' || !knownApps.has(name))) {
      return reply.status(400).send({ error: 'AI tokens may only target existing non-system Apps' });
    }
    if (req.body.expiresAt && (!Number.isFinite(Date.parse(req.body.expiresAt)) || Date.parse(req.body.expiresAt) <= Date.now())) {
      return reply.status(400).send({ error: 'expiresAt must be a valid future date' });
    }
    const secret = `emu_ai_${randomBytes(24).toString('base64url')}`;
    const result = kernel.designerDb.prepare('INSERT INTO "FW_AiToken" (name,tokenHash,appsJson,scopesJson,expiresAt,createdBy) VALUES (?,?,?,?,?,?)')
      .run(req.body.name, hashToken(secret), JSON.stringify([...new Set(req.body.apps)]), JSON.stringify([...new Set(validScopes)]), req.body.expiresAt ?? null, actor);
    audit('token.create', { name: req.body.name, apps: req.body.apps, scopes: validScopes }, Number(result.lastInsertRowid), actor);
    reply.status(201); return { token: secret };
  });
  app.post<{ Params: { id: string } }>('/api/system/ai-tokens/:id/revoke', (req) => {
    const actor = options.requireAdmin(req); const id = Number(req.params.id);
    kernel.designerDb.prepare('UPDATE "FW_AiToken" SET revokedAt=CURRENT_TIMESTAMP WHERE id=? AND revokedAt IS NULL').run(id);
    audit('token.revoke', {}, id, actor); return { ok: true };
  });

  app.get('/api/v1/ai/capabilities', (req) => {
    const token = requireToken(req, 'inspect');
    return { version: CORE_VERSION, changeSetVersion: 1, scopes: jsonArray(token.scopesJson), apps: jsonArray(token.appsJson), apply: false, businessData: false, executableArtifacts: true };
  });
  app.get('/api/v1/ai/schemas/artifact', (req) => { requireToken(req, 'inspect'); return metadataArtifactSchema; });
  app.get('/api/v1/ai/schemas/change-set', (req) => { requireToken(req, 'inspect'); return metadataChangeSetSchema; });
  app.get<{ Querystring: { app?: string; model?: string; kind?: string; cursor?: string; limit?: string } }>('/api/v1/ai/workspace', (req) => {
    const token = requireToken(req, 'inspect'); const allowed = new Set(jsonArray(token.appsJson));
    if (req.query.app && !allowed.has(req.query.app)) throw Object.assign(new Error(`AI token cannot access app '${req.query.app}'`), { statusCode: 403 });
    const current = loadStoredArtifacts(kernel);
    const filtered = current.filter((artifact) => {
      const appName = artifact.kind === 'app' ? artifact.name : artifact.app;
      return Boolean(appName && allowed.has(appName)) && (!req.query.app || appName === req.query.app)
        && (!req.query.model || (artifact.kind !== 'app' && artifact.model === req.query.model)) && (!req.query.kind || artifact.kind === req.query.kind);
    });
    const cursor = Math.max(0, Number(req.query.cursor ?? 0) || 0); const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100) || 100));
    return { revision: metadataRevision(current), artifacts: filtered.slice(cursor, cursor + limit), nextCursor: cursor + limit < filtered.length ? String(cursor + limit) : null, total: filtered.length };
  });
  app.post<{ Body: MetadataChangeSet }>('/api/v1/ai/change-sets/validate', (req, reply) => {
    const token = requireToken(req, 'validate'); const current = loadStoredArtifacts(kernel); assertTokenApps(token, affectedApps(req.body, current));
    const preview = previewMetadataChangeSet(kernel, current, req.body, { allowScripts: true });
    const { candidateArtifacts: _candidate, ...safe } = preview; audit('changeset.validate', { valid: preview.valid, diff: preview.diff }, token.id);
    return reply.status(preview.valid ? 200 : 422).send(safe);
  });
  app.post<{ Body: MetadataChangeSet }>('/api/v1/ai/proposals', (req, reply) => {
    const token = requireToken(req, 'propose'); const current = loadStoredArtifacts(kernel); assertTokenApps(token, affectedApps(req.body, current));
    const preview = previewMetadataChangeSet(kernel, current, req.body, { allowScripts: true });
    if (!preview.valid) { const { candidateArtifacts: _candidate, ...safe } = preview; return reply.status(422).send(safe); }
    const id = randomUUID(); const { candidateArtifacts: _candidate, ...safe } = preview;
    kernel.designerDb.prepare('INSERT INTO "FW_AiProposal" (id,tokenId,changeSetJson,previewJson,status) VALUES (?,?,?,?,?)').run(id, token.id, JSON.stringify(req.body), JSON.stringify(safe), 'pending');
    audit('proposal.create', { diff: preview.diff }, token.id, undefined, id); reply.status(201); return { id, status: 'pending', preview: safe };
  });

  app.get('/api/designer/ai-proposals', (req) => {
    options.requireDesigner(req); const scope = options.designerScope(req); const current = loadStoredArtifacts(kernel);
    const rows = kernel.designerDb.prepare('SELECT p.*,t.name AS tokenName FROM "FW_AiProposal" p JOIN "FW_AiToken" t ON t.id=p.tokenId ORDER BY p.createdAt DESC').all() as any[];
    return { data: rows.filter((row) => { const apps = affectedApps(JSON.parse(row.changeSetJson), current); return scope === 'all' || [...apps].every((name) => scope.has(name)); }).map((row) => ({ id: row.id, tokenName: row.tokenName, status: row.status, createdAt: row.createdAt, reviewedAt: row.reviewedAt, reviewedBy: row.reviewedBy, changeSet: JSON.parse(row.changeSetJson), preview: JSON.parse(row.previewJson), result: row.resultJson ? JSON.parse(row.resultJson) : null })) };
  });
  app.post<{ Params: { id: string } }>('/api/designer/ai-proposals/:id/approve', (req, reply) => {
    const actor = options.requireDesigner(req); const row = kernel.designerDb.prepare('SELECT * FROM "FW_AiProposal" WHERE id=?').get(req.params.id) as any;
    if (!row) return reply.status(404).send({ error: 'Proposal not found' }); if (row.status !== 'pending') return reply.status(409).send({ error: 'Proposal has already been reviewed' });
    const changeSet = JSON.parse(row.changeSetJson) as MetadataChangeSet; const current = loadStoredArtifacts(kernel); const scope = options.designerScope(req); const apps = affectedApps(changeSet, current);
    if (scope !== 'all' && [...apps].some((name) => !scope.has(name))) return reply.status(403).send({ error: 'No customize permission for every affected app' });
    const preview = previewMetadataChangeSet(kernel, current, changeSet, { allowScripts: true });
    if (!preview.valid) return reply.status(preview.diagnostics.some((item) => item.code === 'stale_revision') ? 409 : 422).send({ error: 'Proposal no longer validates', diagnostics: preview.diagnostics, registryErrors: preview.registryErrors });
    const errors = kernel.applyWebArtifacts(preview.candidateArtifacts as unknown as AnyMeta[]); if (errors.length) return reply.status(422).send({ error: 'Proposal apply failed', errors });
    persistStoredArtifacts(kernel, preview.candidateArtifacts, actor); const result = { revision: preview.nextRevision, diff: preview.diff };
    kernel.designerDb.prepare('UPDATE "FW_AiProposal" SET status=?,reviewedAt=CURRENT_TIMESTAMP,reviewedBy=?,resultJson=? WHERE id=?').run('approved', actor, JSON.stringify(result), req.params.id);
    audit('proposal.approve', result, row.tokenId, actor, req.params.id); return { ok: true, ...result };
  });
  app.post<{ Params: { id: string } }>('/api/designer/ai-proposals/:id/reject', (req, reply) => {
    const actor = options.requireDesigner(req); const result = kernel.designerDb.prepare('UPDATE "FW_AiProposal" SET status=?,reviewedAt=CURRENT_TIMESTAMP,reviewedBy=? WHERE id=? AND status=?').run('rejected', actor, req.params.id, 'pending');
    if (!result.changes) return reply.status(409).send({ error: 'Proposal is missing or already reviewed' }); audit('proposal.reject', {}, undefined, actor, req.params.id); return { ok: true };
  });
}
