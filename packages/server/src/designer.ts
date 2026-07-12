import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  CORE_VERSION,
  metadataArtifactSchema,
  metadataChangeSetSchema,
  metadataRevision,
  previewMetadataChangeSet,
  validateMetadataArtifact,
  type AnyMeta,
  type ChangeSetPreview,
  type Kernel,
  type MetadataArtifact,
  type MetadataChangeSet,
  type WebArtifactError,
} from '@emu/core';
import { readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createMetadataPackage, mergeAppManifest, parseMetadataPackage } from './metadataPackage.js';
import { missingReportFonts } from './fontManager.js';

/**
 * Web Designer API — CRUD over runtime metadata artifacts stored in
 * FW_WebArtifact. Every change revalidates and rebuilds the registry via
 * kernel.applyWebArtifacts, so it takes effect immediately (no restart).
 */

const DESIGNER_KINDS = new Set([
  'app',
  'table',
  'enum',
  'form',
  'menu',
  'script',
  'tableExtension',
  'enumExtension',
  'formExtension',
  'menuExtension',
  'privilege',
  'privilegeExtension',
  'duty',
  'dutyExtension',
  'role',
  'roleExtension',
  'scriptExtension',
  'function',
  'report',
]);

function loadStored(kernel: Kernel): MetadataArtifact[] {
  const artifacts: MetadataArtifact[] = [];
  for (const row of kernel.designerContext().select('FW_WebArtifact').toArray()) {
    try {
      artifacts.push(JSON.parse(row.f.json as string) as MetadataArtifact);
    } catch {
      console.warn(`FW_WebArtifact '${row.f.name}': invalid JSON — skipped`);
    }
  }
  return artifacts;
}

/** Load stored web artifacts and merge them into the registry (boot). */
export function bootWebArtifacts(kernel: Kernel): WebArtifactError[] {
  const stored = loadStored(kernel);
  const errors = kernel.applyWebArtifacts(stored as unknown as AnyMeta[]);
  for (const e of errors) {
    console.warn(`Web artifact ${e.kind} '${e.name}' skipped: ${e.error}`);
  }
  return errors;
}

export function registerDesignerRoutes(
  app: FastifyInstance,
  kernel: Kernel,
  requireDesigner: (req: FastifyRequest) => string,
  designerScope: (req: FastifyRequest) => 'all' | Set<string>,
): void {
  let lastErrors: WebArtifactError[] = [];
  const previews = new Map<string, { actor: string; expiresAt: number; changeSet: MetadataChangeSet; preview: ChangeSetPreview }>();
  kernel.designerDb.exec(`
    CREATE TABLE IF NOT EXISTS "FW_ChangeSetAudit" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      createdAt TEXT NOT NULL,
      actor TEXT NOT NULL,
      source TEXT NOT NULL,
      baseRevision TEXT NOT NULL,
      nextRevision TEXT NOT NULL,
      description TEXT,
      changeSetJson TEXT NOT NULL,
      resultJson TEXT NOT NULL
    )
  `);

  const saveCandidate = (candidate: MetadataArtifact[]): void => {
    const transaction = kernel.designerDb.transaction(() => {
      const names = new Set(candidate.map((artifact) => artifact.name));
      const rows = kernel.designerDb.prepare('SELECT name FROM "FW_WebArtifact"').all() as { name: string }[];
      const remove = kernel.designerDb.prepare('DELETE FROM "FW_WebArtifact" WHERE name = ?');
      for (const row of rows) if (!names.has(row.name)) remove.run(row.name);
      const upsert = kernel.designerDb.prepare(`
        INSERT INTO "FW_WebArtifact" (kind, name, json, createdAt, createdBy, modifiedAt, modifiedBy)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP, ?)
        ON CONFLICT(name) DO UPDATE SET kind=excluded.kind, json=excluded.json,
          modifiedAt=CURRENT_TIMESTAMP, modifiedBy=excluded.modifiedBy
      `);
      for (const artifact of candidate) upsert.run(artifact.kind, artifact.name, JSON.stringify(artifact), 'changeset', 'changeset');
    });
    transaction();
  };

  const assertChangeSetScope = (req: FastifyRequest, changeSet: MetadataChangeSet): void => {
    for (const operation of changeSet.operations) {
      const stored = loadStored(kernel).find((artifact) => artifact.name === operation.name);
      const artifact = operation.op === 'upsert' ? operation.artifact : stored;
      assertScope(req, { kind: operation.kind, name: operation.name, app: artifact && 'app' in artifact ? artifact.app : undefined });
    }
  };

  /** true when the artifact belongs to an app this user may customize */
  const inScope = (scope: 'all' | Set<string>, artifact: { kind?: string; name?: string; app?: string }): boolean => {
    if (scope === 'all') return true;
    if (artifact.kind === 'app') return scope.has(artifact.name ?? '');
    return scope.has(artifact.app ?? '');
  };

  const assertScope = (req: FastifyRequest, artifact: { kind?: string; name?: string; app?: string }): void => {
    if (!inScope(designerScope(req), artifact)) {
      throw Object.assign(
        new Error(`No customize permission for app '${artifact.kind === 'app' ? artifact.name : (artifact.app ?? 'web')}'`),
        { statusCode: 403 },
      );
    }
  };

  app.get('/api/designer/artifacts', (req) => {
    requireDesigner(req);
    const scope = designerScope(req);
    const rows = kernel
      .designerContext()
      .select('FW_WebArtifact')
      .toArray()
      .map((r) => ({
        kind: r.f.kind as string,
        name: r.f.name as string,
        artifact: JSON.parse(r.f.json as string) as AnyMeta,
        error: lastErrors.find((e) => e.name === r.f.name)?.error,
      }))
      .filter((r) => inScope(scope, { kind: r.kind, name: r.name, ...(r.artifact as { app?: string }) }));
    return {
      artifacts: rows,
      apps: kernel.registry.loadedApps().filter((a) => scope === 'all' || scope.has(a.name)),
    };
  });

  app.get('/api/designer/capabilities', (req) => {
    requireDesigner(req);
    const artifacts = loadStored(kernel);
    return {
      version: CORE_VERSION,
      revision: metadataRevision(artifacts),
      changeSets: { version: 1, previewTtlSeconds: 600, humanConfirmationRequired: true },
      ai: { inspect: true, validate: true, apply: false, businessData: false, scripts: false },
      schemas: { artifact: metadataArtifactSchema, changeSet: metadataChangeSetSchema },
    };
  });

  app.post<{ Body: { artifact?: AnyMeta } }>('/api/designer/reports/validate', (req, reply) => {
    requireDesigner(req);
    const artifact = req.body?.artifact;
    if (!artifact || artifact.kind !== 'report') return reply.status(400).send({ error: 'A full report artifact is required' });
    assertScope(req, artifact);
    const diagnostics = validateMetadataArtifact(artifact);
    if (diagnostics.length) return { valid: false, diagnostics };
    const candidates = loadStored(kernel).filter((candidate) => candidate.name !== artifact.name);
    candidates.push(artifact as MetadataArtifact);
    const error = kernel.previewWebArtifacts(candidates as unknown as AnyMeta[]).find((entry) => entry.name === artifact.name);
    const fontWarnings = missingReportFonts(kernel, artifact);
    return {
      valid: !error,
      diagnostics: [...(error ? [{ path: '/', code: 'metadata', message: error.error }] : []), ...fontWarnings.map((font) => ({ path: '/defaultFont', code: 'missing_font', message: `Font '${font}' is not installed; PDF rendering will use Roboto` }))],
      summary: {
        bands: artifact.bands.length,
        elements: artifact.bands.reduce((sum, band) => sum + band.elements.length, 0),
        lineSources: artifact.lineSources?.length ?? 0,
        parameters: artifact.parameters?.length ?? 0,
      },
    };
  });

  app.get<{ Querystring: { app?: string } }>('/api/designer/snapshot', (req) => {
    requireDesigner(req);
    const scope = designerScope(req);
    const requestedApp = req.query.app;
    if (requestedApp && scope !== 'all' && !scope.has(requestedApp)) {
      return { revision: metadataRevision(loadStored(kernel)), apps: [], artifacts: [] };
    }
    const artifacts = loadStored(kernel).filter((artifact) => {
      const artifactApp = artifact.kind === 'app' ? artifact.name : artifact.app;
      if (requestedApp && artifactApp !== requestedApp) return false;
      return scope === 'all' || scope.has(artifactApp ?? '');
    });
    return {
      revision: metadataRevision(loadStored(kernel)),
      apps: kernel.registry.loadedApps().filter((entry) => (!requestedApp || entry.name === requestedApp) && (scope === 'all' || scope.has(entry.name))),
      artifacts,
    };
  });

  const exportArtifacts = (appName: string, model?: string): MetadataArtifact[] => {
    const stored = loadStored(kernel);
    const manifest = stored.find((artifact) => artifact.kind === 'app' && artifact.name === appName);
    if (!manifest) {
      throw Object.assign(new Error(`App '${appName}' is file-based and must be moved using its apps/ folder`), { statusCode: 409 });
    }
    if (!model) {
      return stored.filter((artifact) => artifact === manifest || ('app' in artifact && artifact.app === appName));
    }
    const appManifest = manifest as MetadataArtifact & { models?: { name: string; label?: string; layer: 'SYS' | 'ISV' | 'LOC' | 'DEV' | 'CUS' }[] };
    const definition = appManifest.models?.find((entry) => entry.name === model);
    if (!definition) throw Object.assign(new Error(`Unknown model '${model}' in app '${appName}'`), { statusCode: 404 });
    const scopedManifest = { ...appManifest, models: [definition] } as MetadataArtifact;
    return [
      scopedManifest,
      ...stored.filter((artifact) => artifact.kind !== 'app' && 'app' in artifact && artifact.app === appName && artifact.model === model),
    ];
  };

  app.get<{ Params: { app: string } }>('/api/designer/packages/app/:app/export', (req, reply) => {
    requireDesigner(req);
    assertScope(req, { kind: 'app', name: req.params.app, app: req.params.app });
    if (req.params.app === 'system') return reply.status(400).send({ error: 'System app cannot be exported' });
    const pkg = createMetadataPackage(CORE_VERSION, { type: 'app', app: req.params.app }, exportArtifacts(req.params.app));
    reply.header('Content-Type', 'application/json; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${req.params.app}.emuapp.json"`);
    return reply.send(JSON.stringify(pkg, null, 2));
  });

  app.get<{ Params: { app: string; model: string } }>('/api/designer/packages/model/:app/:model/export', (req, reply) => {
    requireDesigner(req);
    assertScope(req, { app: req.params.app });
    if (req.params.app === 'system') return reply.status(400).send({ error: 'System models cannot be exported' });
    const pkg = createMetadataPackage(
      CORE_VERSION,
      { type: 'model', app: req.params.app, model: req.params.model },
      exportArtifacts(req.params.app, req.params.model),
    );
    reply.header('Content-Type', 'application/json; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${req.params.app}-${req.params.model}.emumodel.json"`);
    return reply.send(JSON.stringify(pkg, null, 2));
  });

  app.post('/api/designer/packages/import/preview', async (req, reply) => {
    const actor = requireDesigner(req);
    const file = await req.file();
    if (!file) return reply.status(400).send({ error: 'No package uploaded' });
    if (file.file.truncated) return reply.status(413).send({ error: 'Package is too large' });
    let parsed: unknown;
    try {
      parsed = JSON.parse((await file.toBuffer()).toString('utf8'));
    } catch {
      return reply.status(400).send({ error: 'Package is not valid JSON' });
    }
    let pkg;
    try {
      pkg = parseMetadataPackage(parsed);
    } catch (error) {
      return reply.status(422).send({ error: error instanceof Error ? error.message : String(error) });
    }
    if (pkg.scope.app === 'system') return reply.status(400).send({ error: 'System metadata cannot be imported' });
    assertScope(req, { kind: pkg.scope.type === 'app' ? 'app' : undefined, name: pkg.scope.app, app: pkg.scope.app });

    const stored = loadStored(kernel);
    const incomingNames = new Set<string>();
    const operations: MetadataChangeSet['operations'] = [];
    for (const raw of pkg.artifacts) {
      const artifact = raw.kind === 'app'
        ? mergeAppManifest(stored.find((candidate) => candidate.kind === 'app' && candidate.name === raw.name), raw)
        : raw;
      if (incomingNames.has(artifact.name)) return reply.status(422).send({ error: `Duplicate artifact '${artifact.name}' in package` });
      incomingNames.add(artifact.name);
      const diagnostics = validateMetadataArtifact(artifact);
      if (diagnostics.length) return reply.status(422).send({ error: `Invalid artifact '${artifact.name}'`, diagnostics });
      if (artifact.kind === 'app') {
        if (artifact.name !== pkg.scope.app) return reply.status(422).send({ error: 'App manifest does not match package scope' });
      } else if (!('app' in artifact) || artifact.app !== pkg.scope.app) {
        return reply.status(422).send({ error: `Artifact '${artifact.name}' is outside package app scope` });
      } else if (pkg.scope.type === 'model' && artifact.model !== pkg.scope.model) {
        return reply.status(422).send({ error: `Artifact '${artifact.name}' is outside package model scope` });
      }
      operations.push({ op: 'upsert', kind: artifact.kind, name: artifact.name, artifact });
    }

    const changeSet: MetadataChangeSet = {
      version: 1,
      baseRevision: metadataRevision(stored),
      source: 'designer',
      description: `Import ${pkg.scope.type} package ${pkg.scope.app}${pkg.scope.type === 'model' ? `/${pkg.scope.model}` : ''}`,
      operations,
    };
    const preview = previewMetadataChangeSet(kernel, stored, changeSet, { allowScripts: true });
    if (!preview.valid) return reply.status(422).send(preview);
    const previewId = randomUUID();
    previews.set(previewId, { actor, expiresAt: Date.now() + 10 * 60_000, changeSet, preview });
    const { candidateArtifacts: _candidateArtifacts, ...safePreview } = preview;
    return {
      ...safePreview,
      previewId,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      package: { scope: pkg.scope, frameworkVersion: pkg.frameworkVersion, exportedAt: pkg.exportedAt, artifactCount: pkg.artifacts.length },
    };
  });

  app.post<{ Body: MetadataChangeSet }>('/api/designer/change-sets/validate', (req, reply) => {
    const actor = requireDesigner(req);
    assertChangeSetScope(req, req.body);
    const allowScripts = req.body.source === 'designer';
    const preview = previewMetadataChangeSet(kernel, loadStored(kernel), req.body, { allowScripts });
    if (!preview.valid) return reply.status(422).send(preview);
    const previewId = randomUUID();
    previews.set(previewId, { actor, expiresAt: Date.now() + 10 * 60_000, changeSet: req.body, preview });
    const { candidateArtifacts: _candidateArtifacts, ...safePreview } = preview;
    return { ...safePreview, previewId, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() };
  });

  app.post<{ Body: { previewId?: string; confirmation?: boolean; confirmHighRisk?: boolean } }>(
    '/api/designer/change-sets/apply',
    (req, reply) => {
      const actor = requireDesigner(req);
      if (!req.body?.confirmation) return reply.status(400).send({ error: 'Human confirmation is required' });
      const cached = req.body.previewId ? previews.get(req.body.previewId) : undefined;
      if (!cached || cached.expiresAt < Date.now()) return reply.status(410).send({ error: 'Preview expired; validate the change set again' });
      if (cached.actor !== actor) return reply.status(403).send({ error: 'Preview belongs to another user' });
      if (cached.preview.diff.some((item) => item.highRisk) && !req.body.confirmHighRisk) {
        return reply.status(400).send({ error: 'High-risk changes require separate confirmation' });
      }
      assertChangeSetScope(req, cached.changeSet);
      if (metadataRevision(loadStored(kernel)) !== cached.preview.baseRevision) {
        return reply.status(409).send({ error: 'Workspace changed; validate the change set again' });
      }
      lastErrors = kernel.applyWebArtifacts(cached.preview.candidateArtifacts as unknown as AnyMeta[]);
      if (lastErrors.length > 0) return reply.status(422).send({ error: 'Change set no longer validates', errors: lastErrors });
      saveCandidate(cached.preview.candidateArtifacts);
      kernel.designerDb.prepare(`
        INSERT INTO "FW_ChangeSetAudit" (createdAt, actor, source, baseRevision, nextRevision, description, changeSetJson, resultJson)
        VALUES (CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?)
      `).run(actor, cached.changeSet.source ?? 'designer', cached.preview.baseRevision, cached.preview.nextRevision,
        cached.changeSet.description ?? null, JSON.stringify(cached.changeSet), JSON.stringify({ diff: cached.preview.diff, schemaEffects: cached.preview.schemaEffects }));
      previews.delete(req.body.previewId!);
      return { ok: true, revision: cached.preview.nextRevision, diff: cached.preview.diff };
    },
  );

  app.post<{ Params: { table: string }; Body: { confirmation?: string } }>(
    '/api/designer/orphans/:table/purge',
    (req, reply) => {
      requireDesigner(req);
      if (designerScope(req) !== 'all') return reply.status(403).send({ error: 'Only a framework administrator can purge data' });
      const table = req.params.table;
      if (table.startsWith('FW_')) return reply.status(400).send({ error: 'Framework tables cannot be purged' });
      if (kernel.registry.hasTable(table)) return reply.status(409).send({ error: 'The table is still active metadata and cannot be purged' });
      if (req.body?.confirmation !== table) return reply.status(400).send({ error: `Type '${table}' to confirm permanent data deletion` });
      const droppedTables = kernel.dropTables([table]);
      return { ok: true, droppedTables };
    },
  );

  app.put<{ Params: { kind: string; name: string }; Body: AnyMeta }>(
    '/api/designer/artifacts/:kind/:name',
    (req, reply) => {
      requireDesigner(req);
      const { kind, name } = req.params;
      assertScope(req, { kind, name, app: (req.body as { app?: string })?.app });
      if (!DESIGNER_KINDS.has(kind)) {
        return reply.status(400).send({ error: `Unsupported kind '${kind}'` });
      }
      const artifact = { ...req.body, kind, name } as AnyMeta;
      const schemaDiagnostics = validateMetadataArtifact(artifact);
      if (schemaDiagnostics.length > 0) {
        return reply.status(422).send({ error: 'Artifact does not match the metadata schema', diagnostics: schemaDiagnostics });
      }

      // candidate set = stored artifacts with this one upserted
      const candidates = loadStored(kernel).filter((a) => a.name !== name);
      candidates.push(artifact);

      const errors = kernel.applyWebArtifacts(candidates as unknown as AnyMeta[]);
      const own = errors.find((e) => e.name === name);
      if (own) {
        // the new artifact is invalid — registry was rebuilt without it; report why
        lastErrors = errors;
        return reply.status(422).send({ error: own.error });
      }
      lastErrors = errors;

      const ctx = kernel.designerContext();
      const existing = ctx.select('FW_WebArtifact').whereEq({ name }).firstOnly();
      if (existing) {
        existing.setMany({ kind, json: JSON.stringify(artifact) });
        existing.update();
      } else {
        ctx.newRecord('FW_WebArtifact').setMany({ kind, name, json: JSON.stringify(artifact) }).insert();
      }
      return { ok: true, errors };
    },
  );

  app.delete<{ Params: { kind: string; name: string } }>(
    '/api/designer/artifacts/:kind/:name',
    (req, reply) => {
      requireDesigner(req);
      const { kind, name } = req.params;
      const ctx = kernel.designerContext();
      {
        const row = ctx.select('FW_WebArtifact').whereEq({ name }).firstOnly();
        const stored = row ? (JSON.parse(row.f.json as string) as { app?: string }) : {};
        assertScope(req, { kind, name, app: stored.app });
      }

      if (kind === 'app') {
        if (name === 'system') return reply.status(400).send({ error: 'Cannot delete system app' });
        // Cascade metadata only. Physical tables are intentionally retained as orphans.
        const ownedTables: string[] = [];
        const all = ctx.select('FW_WebArtifact').toArray();
        for (const row of all) {
          if (row.f.name === name) {
            row.delete();
            continue;
          }
          try {
            const art = JSON.parse(row.f.json as string) as any;
            if (art && art.app === name) {
              if (art.kind === 'table') ownedTables.push(art.name);
              row.delete();
            }
          } catch {
            // ignore bad json
          }
        }
        lastErrors = kernel.applyWebArtifacts(loadStored(kernel) as unknown as AnyMeta[]);
        return { ok: true, errors: lastErrors, orphanedTables: ownedTables };
      } else {
        const existing = ctx.select('FW_WebArtifact').whereEq({ name }).firstOnly();
        if (!existing) return reply.status(404).send({ error: `Artifact '${name}' not found` });
        existing.delete();
      }

      lastErrors = kernel.applyWebArtifacts(loadStored(kernel) as unknown as AnyMeta[]);
      // deleting a table artifact also drops its (now orphaned) data table
      // Metadata deletion intentionally preserves the physical table and its data.
      return { ok: true, errors: lastErrors, orphanedTables: kind === 'table' ? [name] : [] };
    },
  );

  // Create or update a Model on an app manifest
  app.put<{ Params: { app: string; model: string }; Body: { label?: string; layer: string } }>(
    '/api/designer/artifacts/model/:app/:model',
    (req, reply) => {
      requireDesigner(req);
      const { app: appName, model } = req.params;
      const { label, layer } = req.body ?? {};
      if (appName === 'system') return reply.status(400).send({ error: 'Cannot modify system models' });
      assertScope(req, { app: appName });

      if (!layer) return reply.status(400).send({ error: 'layer is required' });
      const validLayers = ['SYS', 'ISV', 'LOC', 'DEV', 'CUS'];
      if (!validLayers.includes(layer)) {
        return reply.status(400).send({ error: `Invalid layer '${layer}'. Must be one of: ${validLayers.join(', ')}` });
      }

      const ctx = kernel.designerContext();
      const manifestRow = ctx.select('FW_WebArtifact').whereEq({ name: appName }).firstOnly();
      if (!manifestRow) return reply.status(404).send({ error: `App '${appName}' not found` });

      let manifest: any;
      try { manifest = JSON.parse(manifestRow.f.json as string); } catch {
        return reply.status(400).send({ error: 'App manifest is corrupted' });
      }

      if (!Array.isArray(manifest.models)) manifest.models = [];
      const existing = manifest.models.find((m: any) => m.name === model);
      const oldLayer = existing?.layer;

      if (existing) {
        if (label !== undefined) existing.label = label;
        existing.layer = layer;
      } else {
        manifest.models.push({ name: model, label: label ?? model, layer });
      }

      const all = ctx.select('FW_WebArtifact').toArray();
      const changedLayer = oldLayer && oldLayer !== layer;
      for (const row of all) {
        if (row.f.name === appName) {
          row.set('json', JSON.stringify(manifest));
          row.update();
          continue;
        }
        if (changedLayer) {
          try {
            const art = JSON.parse(row.f.json as string) as any;
            if (art && art.app === appName && art.model === model) {
              art.layer = layer;
              row.set('json', JSON.stringify(art));
              row.update();
            }
          } catch {}
        }
      }

      lastErrors = kernel.applyWebArtifacts(loadStored(kernel) as unknown as AnyMeta[]);
      return { ok: true, errors: lastErrors };
    },
  );

  // Delete an entire Model under an app (cascade all its web artifacts + remove from app manifest)
  app.delete<{ Params: { app: string; model: string } }>(
    '/api/designer/artifacts/model/:app/:model',
    (req, reply) => {
      requireDesigner(req);
      const { app, model } = req.params;
      if (app === 'system') return reply.status(400).send({ error: 'Cannot modify system models' });
      assertScope(req, { app });

      const ctx = kernel.designerContext();
      const all = ctx.select('FW_WebArtifact').toArray();
      for (const row of all) {
        if (row.f.name === app) {
          // patch the app manifest to drop this model
          try {
            const manifest = JSON.parse(row.f.json as string) as any;
            if (manifest && Array.isArray(manifest.models)) {
              manifest.models = manifest.models.filter((m: any) => m.name !== model);
              row.set('json', JSON.stringify(manifest));
              row.update();
            }
          } catch {}
          continue;
        }
        try {
          const art = JSON.parse(row.f.json as string) as any;
          if (art && art.app === app && art.model === model) {
            row.delete();
          }
        } catch {}
      }

      lastErrors = kernel.applyWebArtifacts(loadStored(kernel) as unknown as AnyMeta[]);
      return { ok: true, errors: lastErrors };
    },
  );

  // Reload file-based apps from disk (for apps created via CLI while server is running)
  app.post('/api/designer/reload', (req, reply) => {
    requireDesigner(req);
    if (designerScope(req) !== 'all') {
      return reply.status(403).send({ error: 'Reload requires a framework administrator role' });
    }
    try {
      // Discover any new apps/ folders and load them
      (kernel as any).discoverAndLoadApps?.();
      // Re-apply current web artifacts so registry is fresh
      const stored = loadStored(kernel);
      lastErrors = kernel.applyWebArtifacts(stored as unknown as AnyMeta[]);
      // Ensure schema for any new tables from file apps
      kernel.sync();
      return {
        ok: true,
        apps: kernel.registry.loadedApps(),
        errors: lastErrors,
      };
    } catch (e: any) {
      return reply.status(500).send({ error: e?.message || String(e) });
    }
  });
}
