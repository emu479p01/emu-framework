import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { MetadataArtifact } from './schema.js';
import { metadataRevision } from './changeSet.js';

export interface WorkspaceLoadError { file: string; message: string }
export interface WorkspaceSnapshot {
  root: string;
  revision: string;
  artifacts: MetadataArtifact[];
  files: Record<string, string>;
  errors: WorkspaceLoadError[];
}

export function loadWorkspaceArtifacts(root: string): WorkspaceSnapshot {
  const artifacts: MetadataArtifact[] = [];
  const files: Record<string, string> = {};
  const errors: WorkspaceLoadError[] = [];
  const appsRoot = join(root, 'apps');
  if (!existsSync(appsRoot)) return { root, revision: metadataRevision([]), artifacts, files, errors };
  for (const entry of readdirSync(appsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const appDir = join(appsRoot, entry.name);
    const manifestFile = join(appDir, 'app.json');
    if (!existsSync(manifestFile)) continue;
    try {
      const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as Record<string, unknown>;
      const artifact = { ...manifest, kind: 'app', name: String(manifest.name ?? entry.name) } as MetadataArtifact;
      artifacts.push(artifact);
      files[artifact.name] = manifestFile;
    } catch (error) {
      errors.push({ file: manifestFile, message: error instanceof Error ? error.message : String(error) });
    }
    const metadataDir = join(appDir, 'metadata');
    const walk = (dir: string): void => {
      if (!existsSync(dir)) return;
      for (const item of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, item.name);
        if (item.isDirectory()) walk(path);
        else if (item.name.endsWith('.json')) {
          try {
            const artifact = JSON.parse(readFileSync(path, 'utf8')) as MetadataArtifact;
            artifacts.push(artifact);
            files[artifact.name] = path;
          } catch (error) {
            errors.push({ file: path, message: error instanceof Error ? error.message : String(error) });
          }
        }
      }
    };
    walk(metadataDir);
  }
  return { root, revision: metadataRevision(artifacts), artifacts, files, errors };
}

export function summarizeWorkspace(snapshot: WorkspaceSnapshot) {
  const apps = snapshot.artifacts.filter((artifact) => artifact.kind === 'app').map((artifact) => ({
    name: artifact.name,
    label: artifact.label ?? artifact.name,
    artifacts: snapshot.artifacts.filter((candidate) => candidate.kind !== 'app' && 'app' in candidate && candidate.app === artifact.name).length,
  }));
  const kinds = Object.fromEntries(
    [...new Set(snapshot.artifacts.map((artifact) => artifact.kind))].sort().map((kind) => [kind, snapshot.artifacts.filter((artifact) => artifact.kind === kind).length]),
  );
  return { version: '0.0.1.1', revision: snapshot.revision, apps, kinds, errors: snapshot.errors };
}
