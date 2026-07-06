import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AnyMeta, Kernel, WebArtifactError } from '@emu/core';
import { readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
]);

function loadStored(kernel: Kernel): AnyMeta[] {
  const artifacts: AnyMeta[] = [];
  for (const row of kernel.designerContext().select('FW_WebArtifact').toArray()) {
    try {
      artifacts.push(JSON.parse(row.f.json as string) as AnyMeta);
    } catch {
      console.warn(`FW_WebArtifact '${row.f.name}': invalid JSON — skipped`);
    }
  }
  return artifacts;
}

/** Load stored web artifacts and merge them into the registry (boot). */
export function bootWebArtifacts(kernel: Kernel): WebArtifactError[] {
  const stored = loadStored(kernel);
  if (stored.length === 0) return [];
  const errors = kernel.applyWebArtifacts(stored);
  for (const e of errors) {
    console.warn(`Web artifact ${e.kind} '${e.name}' skipped: ${e.error}`);
  }
  return errors;
}

export function registerDesignerRoutes(
  app: FastifyInstance,
  kernel: Kernel,
  requireDesigner: (req: FastifyRequest) => void,
  designerScope: (req: FastifyRequest) => 'all' | Set<string>,
): void {
  let lastErrors: WebArtifactError[] = [];

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

      // candidate set = stored artifacts with this one upserted
      const candidates = loadStored(kernel).filter((a) => a.name !== name);
      candidates.push(artifact);

      const errors = kernel.applyWebArtifacts(candidates);
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
        // Cascade: delete the app manifest + every web artifact that belongs to this app.
        // Remember which tables the app owned so we can drop them after the rebuild.
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
        lastErrors = kernel.applyWebArtifacts(loadStored(kernel));
        const dropped = kernel.dropTables(ownedTables);
        return { ok: true, errors: lastErrors, droppedTables: dropped };
      } else {
        const existing = ctx.select('FW_WebArtifact').whereEq({ name }).firstOnly();
        if (!existing) return reply.status(404).send({ error: `Artifact '${name}' not found` });
        existing.delete();
      }

      lastErrors = kernel.applyWebArtifacts(loadStored(kernel));
      // deleting a table artifact also drops its (now orphaned) data table
      const dropped = kind === 'table' ? kernel.dropTables([name]) : [];
      return { ok: true, errors: lastErrors, droppedTables: dropped };
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

      lastErrors = kernel.applyWebArtifacts(loadStored(kernel));
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

      lastErrors = kernel.applyWebArtifacts(loadStored(kernel));
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
      lastErrors = kernel.applyWebArtifacts(stored);
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
