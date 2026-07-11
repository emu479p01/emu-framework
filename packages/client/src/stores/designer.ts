import { defineStore } from 'pinia';
import { api, type MetadataPackagePreview } from '../api';
import { useMeta } from './meta';

/** Any metadata artifact as edited in the designer (shape depends on kind). */
export type Artifact = { kind: string; name: string; [key: string]: unknown };

export interface WebArtifactEntry {
  kind: string;
  name: string;
  artifact: Artifact;
  error?: string;
}

export interface DesignerApp {
  name: string;
  label?: string;
  icon?: import('@emu/core').IconName;
  models?: { name: string; label?: string; layer: string }[];
}
export interface ChangeSetPreview {
  previewId: string; expiresAt: string; valid: boolean; baseRevision: string; nextRevision: string;
  diff: { op: 'create' | 'update' | 'delete'; kind: string; name: string; highRisk?: boolean }[];
  schemaEffects: { type: string; target: string }[]; destructive: boolean;
  diagnostics: { path: string; code: string; message: string }[];
  registryErrors: { kind: string; name: string; error: string }[];
}

export const useDesigner = defineStore('designer', {
  state: () => ({ artifacts: [] as WebArtifactEntry[], apps: [] as DesignerApp[], loaded: false }),
  getters: {
    byKind: (s) => (kind: string) => s.artifacts.filter((a) => a.kind === kind),
    get: (s) => (name: string) => s.artifacts.find((a) => a.name === name),
  },
  actions: {
    async load() {
      const res = await api.get<{ artifacts: WebArtifactEntry[]; apps: DesignerApp[] }>('/api/designer/artifacts');
      this.artifacts = res.artifacts;
      this.apps = res.apps ?? [];
      this.loaded = true;
    },
    async save(artifact: Artifact) {
      if (artifact.kind === 'script' || artifact.kind === 'scriptExtension') {
        if (!window.confirm('Executable scripts can change data and server behavior. Review the code carefully and confirm this high-risk change.')) {
          return false;
        }
        const snapshot = await this.snapshot();
        const preview = await this.validateChangeSet({
          version: 1, baseRevision: snapshot.revision, source: 'designer',
          description: `Update high-risk ${artifact.kind} ${artifact.name}`,
          operations: [{ op: 'upsert', kind: artifact.kind, name: artifact.name, artifact }],
        });
        await this.applyChangeSet(preview.previewId, true);
        return true;
      }
      await api.put(`/api/designer/artifacts/${artifact.kind}/${artifact.name}`, artifact);
      await Promise.all([this.load(), useMeta().load()]);
      return true;
    },
    async remove(kind: string, name: string) {
      await api.delete(`/api/designer/artifacts/${kind}/${name}`);
      await Promise.all([this.load(), useMeta().load()]);
    },
    async saveModel(app: string, model: string, data: { label?: string; layer: string }) {
      await api.put(`/api/designer/artifacts/model/${app}/${model}`, data);
      await Promise.all([this.load(), useMeta().load()]);
    },
    async removeModel(app: string, model: string) {
      await api.delete(`/api/designer/artifacts/model/${app}/${model}`);
      await Promise.all([this.load(), useMeta().load()]);
    },
    async reloadFromDisk() {
      await api.post('/api/designer/reload');
      await Promise.all([this.load(), useMeta().load()]);
    },
    async snapshot(app?: string) {
      return api.get<{ revision: string; artifacts: Artifact[] }>(`/api/designer/snapshot${app ? `?app=${encodeURIComponent(app)}` : ''}`);
    },
    async validateChangeSet(changeSet: Record<string, unknown>) {
      return api.post<ChangeSetPreview>('/api/designer/change-sets/validate', changeSet);
    },
    async applyChangeSet(previewId: string, confirmHighRisk = false) {
      const result = await api.post<{ ok: boolean; revision: string }>('/api/designer/change-sets/apply', { previewId, confirmation: true, confirmHighRisk });
      await Promise.all([this.load(), useMeta().load()]);
      return result;
    },
    exportAppUrl(app: string) {
      return `/api/designer/packages/app/${encodeURIComponent(app)}/export`;
    },
    exportModelUrl(app: string, model: string) {
      return `/api/designer/packages/model/${encodeURIComponent(app)}/${encodeURIComponent(model)}/export`;
    },
    previewPackage(file: File): Promise<MetadataPackagePreview> {
      return api.metadataPackagePreview(file);
    },
  },
});
