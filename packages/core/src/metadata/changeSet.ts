import { createHash } from 'node:crypto';
import type { Kernel, WebArtifactError } from '../kernel.js';
import type { AnyMeta } from './types.js';
import { validateMetadataChangeSet, type MetadataArtifact, type MetadataChangeSet, type SchemaDiagnostic } from './schema.js';

export interface ArtifactDiff { op: 'create' | 'update' | 'delete'; kind: string; name: string; highRisk?: boolean }
export interface SchemaEffect { type: 'create-table' | 'add-field' | 'orphan-table' | 'metadata-only'; target: string }
export interface ChangeSetPreview {
  valid: boolean;
  baseRevision: string;
  nextRevision: string;
  diagnostics: SchemaDiagnostic[];
  registryErrors: WebArtifactError[];
  diff: ArtifactDiff[];
  schemaEffects: SchemaEffect[];
  destructive: boolean;
  candidateArtifacts: MetadataArtifact[];
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  }
  return value;
}

export function metadataRevision(artifacts: readonly unknown[]): string {
  const ordered = [...artifacts].sort((a: any, b: any) => `${a.kind}:${a.name}`.localeCompare(`${b.kind}:${b.name}`));
  return createHash('sha256').update(JSON.stringify(canonical(ordered))).digest('hex');
}

export function previewMetadataChangeSet(
  kernel: Kernel,
  current: MetadataArtifact[],
  changeSet: MetadataChangeSet,
  options: { allowScripts?: boolean } = {},
): ChangeSetPreview {
  const baseRevision = metadataRevision(current);
  const diagnostics = validateMetadataChangeSet(changeSet);
  if (changeSet.baseRevision !== baseRevision) {
    diagnostics.push({ path: '/baseRevision', code: 'stale_revision', message: `Workspace changed; expected '${baseRevision}'` });
  }
  const byName = new Map(current.map((artifact) => [artifact.name, structuredClone(artifact)]));
  const diff: ArtifactDiff[] = [];
  const schemaEffects: SchemaEffect[] = [];
  for (const operation of changeSet.operations ?? []) {
    const existing = byName.get(operation.name);
    if (operation.op === 'delete') {
      if (!existing) diagnostics.push({ path: `/operations/${operation.name}`, code: 'not_found', message: `Artifact '${operation.name}' does not exist` });
      else {
        byName.delete(operation.name);
        diff.push({ op: 'delete', kind: operation.kind, name: operation.name, highRisk: operation.kind === 'table' || operation.kind === 'app' });
        schemaEffects.push({ type: operation.kind === 'table' || operation.kind === 'app' ? 'orphan-table' : 'metadata-only', target: operation.name });
        if (operation.kind === 'app') {
          for (const [childName, child] of [...byName.entries()]) {
            if ('app' in child && child.app === operation.name) {
              byName.delete(childName);
              diff.push({ op: 'delete', kind: child.kind, name: child.name, highRisk: child.kind === 'table' });
              schemaEffects.push({ type: child.kind === 'table' ? 'orphan-table' : 'metadata-only', target: child.name });
            }
          }
        }
      }
      continue;
    }
    const artifact = operation.artifact as MetadataArtifact;
    if (artifact.kind !== operation.kind || artifact.name !== operation.name) {
      diagnostics.push({ path: `/operations/${operation.name}`, code: 'identity_mismatch', message: 'Operation kind/name must match the artifact' });
    }
    if (!options.allowScripts && (artifact.kind === 'script' || artifact.kind === 'scriptExtension')) {
      diagnostics.push({ path: `/operations/${operation.name}`, code: 'high_risk_script', message: 'AI and automated change sets cannot create executable scripts' });
    }
    byName.set(operation.name, structuredClone(artifact));
    diff.push({ op: existing ? 'update' : 'create', kind: operation.kind, name: operation.name, highRisk: artifact.kind === 'script' || artifact.kind === 'scriptExtension' });
    if (artifact.kind === 'table') {
      schemaEffects.push({ type: existing ? 'metadata-only' : 'create-table', target: artifact.name });
      const oldFields = new Set(existing?.kind === 'table' ? existing.fields.map((field) => field.name) : []);
      for (const field of artifact.fields) if (!oldFields.has(field.name)) schemaEffects.push({ type: 'add-field', target: `${artifact.name}.${field.name}` });
    } else schemaEffects.push({ type: 'metadata-only', target: artifact.name });
  }
  const candidateArtifacts = [...byName.values()];
  const registryErrors = diagnostics.length === 0 ? kernel.previewWebArtifacts(candidateArtifacts as unknown as AnyMeta[]) : [];
  const nextRevision = metadataRevision(candidateArtifacts);
  return {
    valid: diagnostics.length === 0 && registryErrors.length === 0,
    baseRevision,
    nextRevision,
    diagnostics,
    registryErrors,
    diff,
    schemaEffects,
    destructive: diff.some((item) => item.op === 'delete' && item.highRisk),
    candidateArtifacts,
  };
}
