import { createHash } from 'node:crypto';
import type { MetadataArtifact, MetadataChangeSet, AppManifest } from '@emu/core';

export const METADATA_PACKAGE_FORMAT = 'emuframework-metadata';
export const METADATA_PACKAGE_SCHEMA_VERSION = 1;

export interface MetadataPackage {
  format: typeof METADATA_PACKAGE_FORMAT;
  schemaVersion: 1 | 2;
  frameworkVersion: string;
  exportedAt: string;
  scope: { type: 'app'; app: string } | { type: 'model'; app: string; model: string } | { type: 'models'; app: string; mode: 'vendor' | 'promotion'; models: NonNullable<AppManifest['models']> };
  artifacts: MetadataArtifact[];
  checksum: string;
}

function canonicalPayload(pkg: Omit<MetadataPackage, 'checksum'>): string {
  return JSON.stringify(pkg);
}

export function createMetadataPackage(
  frameworkVersion: string,
  scope: MetadataPackage['scope'],
  artifacts: MetadataArtifact[],
): MetadataPackage {
  const payload = {
    format: METADATA_PACKAGE_FORMAT,
    schemaVersion: scope.type === 'models' ? 2 as const : METADATA_PACKAGE_SCHEMA_VERSION,
    frameworkVersion,
    exportedAt: new Date().toISOString(),
    scope,
    artifacts,
  } as const;
  return { ...payload, checksum: createHash('sha256').update(canonicalPayload(payload)).digest('hex') };
}

export function parseMetadataPackage(input: unknown): MetadataPackage {
  if (!input || typeof input !== 'object') throw new Error('Invalid metadata package');
  const pkg = input as MetadataPackage;
  if (pkg.format !== METADATA_PACKAGE_FORMAT || ![1, 2].includes(pkg.schemaVersion)) {
    throw new Error('Unsupported metadata package format or schema version');
  }
  if (!pkg.scope || !['app', 'model', 'models'].includes(pkg.scope.type)) throw new Error('Invalid package scope');
  if ((pkg.scope.type === 'models') !== (pkg.schemaVersion === 2)) throw new Error('Package schema version does not match its scope');
  if (!pkg.scope.app || (pkg.scope.type === 'model' && !pkg.scope.model)) throw new Error('Package scope is incomplete');
  if (!Array.isArray(pkg.artifacts) || pkg.artifacts.length === 0) throw new Error('Package contains no artifacts');
  if (typeof pkg.checksum !== 'string') throw new Error('Package checksum is missing');
  const { checksum, ...payload } = pkg;
  const actual = createHash('sha256').update(canonicalPayload(payload)).digest('hex');
  if (actual !== checksum) throw new Error('Package checksum does not match its contents');
  if (pkg.scope.type === 'models') validateModelPackage(pkg);
  return pkg;
}

function validateModelPackage(pkg: MetadataPackage): void {
  if (pkg.scope.type !== 'models') return;
  const scope = pkg.scope;
  if (!['vendor', 'promotion'].includes(scope.mode) || !Array.isArray(scope.models) || !scope.models.length) throw new Error('Select at least one model and a valid deployment mode');
  const models = new Map(scope.models.map((model) => [model.name, model]));
  if (models.size !== scope.models.length) throw new Error('Duplicate model selection');
  for (const model of models.values()) {
    if (!model.name || !['SYS', 'ISV', 'LOC', 'DEV', 'CUS'].includes(model.layer)) throw new Error('Invalid model definition');
    if (scope.mode === 'vendor' && !['SYS', 'ISV', 'LOC'].includes(model.layer)) throw new Error('Vendor deployments cannot contain DEV/CUS');
  }
  const manifests = pkg.artifacts.filter((a) => a.kind === 'app');
  if (manifests.length !== 1 || manifests[0].name !== scope.app) throw new Error('Package requires exactly one matching app manifest');
  const manifest = manifests[0] as AppManifest;
  if (JSON.stringify(manifest.models) !== JSON.stringify(scope.models)) throw new Error('Package models do not match manifest');
  const names = new Set<string>();
  for (const artifact of pkg.artifacts) {
    if (names.has(artifact.name)) throw new Error(`Duplicate artifact '${artifact.name}'`);
    names.add(artifact.name);
    if (artifact.kind === 'app') continue;
    const model = models.get(artifact.model ?? '');
    if (artifact.app !== scope.app || !model || (artifact.layer && artifact.layer !== model.layer)) throw new Error(`Artifact '${artifact.name}' is outside the selected models`);
  }
}

/** Complete snapshots replace only selected model metadata; physical data is never deleted. */
export function modelPackageOperations(pkg: MetadataPackage, current: MetadataArtifact[]): MetadataChangeSet['operations'] {
  validateModelPackage(pkg);
  if (pkg.scope.type !== 'models') throw new Error('Expected selected-model package');
  const scope = pkg.scope;
  if (scope.app === 'system') throw new Error('System metadata cannot be deployed');
  const selected = new Set(scope.models.map((m) => m.name));
  const existing = current.find((a) => a.kind === 'app' && a.name === scope.app);
  const incoming = pkg.artifacts.find((a) => a.kind === 'app')!;
  if (existing?.kind === 'app') {
    for (const model of scope.models) {
      const old = existing.models?.find((m) => m.name === model.name);
      if (old && old.layer !== model.layer) throw new Error(`Model '${model.name}' cannot change layer during deployment`);
      if (old?.license && old.license.vendor !== model.license?.vendor) throw new Error(`Cannot remove or change license requirement for '${model.name}'`);
    }
  }
  const merged = mergeAppManifest(existing, incoming);
  const manifest = existing?.kind === 'app' && merged.kind === 'app'
    ? { ...existing, models: merged.models, dependsOn: merged.dependsOn } : merged;
  const operations: MetadataChangeSet['operations'] = [{ op: 'upsert', kind: 'app', name: scope.app, artifact: manifest }];
  const names = new Set(pkg.artifacts.map((a) => a.name));
  for (const artifact of pkg.artifacts) {
    if (artifact.kind === 'app') continue;
    const old = current.find((a) => a.name === artifact.name);
    if (old && (old.kind === 'app' || old.kind !== artifact.kind || old.app !== scope.app || old.model !== artifact.model)) throw new Error(`Ownership conflict for '${artifact.name}'`);
    operations.push({ op: 'upsert', kind: artifact.kind, name: artifact.name, artifact });
  }
  for (const artifact of current) {
    if (artifact.kind !== 'app' && artifact.app === scope.app && selected.has(artifact.model ?? '') && !names.has(artifact.name)) operations.push({ op: 'delete', kind: artifact.kind, name: artifact.name });
  }
  return operations;
}

export function mergeAppManifest(existing: MetadataArtifact | undefined, incoming: MetadataArtifact): MetadataArtifact {
  if (incoming.kind !== 'app' || !existing || existing.kind !== 'app') return incoming;
  const oldModels = Array.isArray(existing.models) ? existing.models : [];
  const newModels = Array.isArray(incoming.models) ? incoming.models : [];
  const models = new Map(oldModels.map((model) => [model.name, model]));
  for (const model of newModels) models.set(model.name, model);
  return {
    ...existing,
    ...incoming,
    dependsOn: [...new Set([...(existing.dependsOn ?? []), ...(incoming.dependsOn ?? [])])],
    models: [...models.values()],
  };
}
