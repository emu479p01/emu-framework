import { defineStore } from 'pinia';
import { api } from '../api';
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
  models?: { name: string; label?: string; layer: string }[];
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
      await api.put(`/api/designer/artifacts/${artifact.kind}/${artifact.name}`, artifact);
      await Promise.all([this.load(), useMeta().load()]);
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
  },
});
