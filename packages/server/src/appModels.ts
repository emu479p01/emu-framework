import type { FastifyInstance, FastifyRequest } from 'fastify';
import { metadataRevision, type Kernel, type SignedLicense } from '@emu/core';
import { loadStoredArtifacts } from './designer.js';

export function registerAppModelRoutes(app: FastifyInstance, kernel: Kernel, requireAdmin: (req: FastifyRequest) => string): void {
  app.get('/api/system/apps-models', (req) => {
    requireAdmin(req);
    const stored = loadStoredArtifacts(kernel), blocked = kernel.licenses.blockedApps();
    const history = kernel.designerDb.prepare('SELECT id,createdAt,actor,description,changeSetJson FROM FW_ChangeSetAudit ORDER BY id DESC LIMIT 100').all() as { id: number; createdAt: string; actor: string; description: string; changeSetJson: string }[];
    return {
      identity: kernel.licenses.identity(),
      vendors: kernel.designerDb.prepare('SELECT vendor,publicKey FROM FW_LicenseVendor ORDER BY vendor').all(),
      audit: kernel.designerDb.prepare('SELECT * FROM FW_LicenseAudit ORDER BY id DESC LIMIT 100').all(),
      apps: kernel.registry.loadedApps().map((manifest) => ({
        ...manifest, readOnlyReasons: blocked.get(manifest.name) ?? [],
        history: history.filter((item) => { const cs = JSON.parse(item.changeSetJson); return cs.operations.some((op: any) => op.artifact?.app === manifest.name || (op.kind === 'app' && op.name === manifest.name)); }).map(({ changeSetJson: _, ...item }) => item),
        models: (manifest.models ?? []).map((model) => {
          const artifacts = stored.filter((a) => a.kind !== 'app' && a.app === manifest.name && a.model === model.name);
          const source = stored.some((a) => a.kind === 'app' && a.name === manifest.name) ? 'designer' : 'file';
          return { ...model, source, revision: metadataRevision([model, ...(source === 'designer' ? artifacts : kernel.registry.modelArtifacts(manifest.name, model.name))]), licenseStatus: kernel.licenses.status(manifest.name, model) };
        }),
      })),
    };
  });
  app.put<{ Body: { customer: string } }>('/api/system/licenses/customer', (req, reply) => {
    const actor = requireAdmin(req); try { kernel.licenses.setCustomer(req.body.customer, actor); return { ok: true }; } catch (e) { return reply.status(422).send({ error: (e as Error).message }); }
  });
  app.post<{ Body: { vendor: string; publicKey: string } }>('/api/system/licenses/vendors', (req, reply) => {
    const actor = requireAdmin(req); try { kernel.licenses.trust(req.body.vendor, req.body.publicKey, actor); return { ok: true }; } catch (e) { return reply.status(422).send({ error: (e as Error).message }); }
  });
  app.post<{ Body: SignedLicense }>('/api/system/licenses/import', (req, reply) => {
    const actor = requireAdmin(req); try { kernel.licenses.install(req.body, actor); return { ok: true }; } catch (e) { return reply.status(422).send({ error: (e as Error).message }); }
  });
}
