import { createHash } from 'node:crypto';
import type { MetadataArtifact } from '@emu/core';

export const METADATA_PACKAGE_FORMAT = 'emuframework-metadata';
export const METADATA_PACKAGE_SCHEMA_VERSION = 1;

export interface MetadataPackage {
  format: typeof METADATA_PACKAGE_FORMAT;
  schemaVersion: typeof METADATA_PACKAGE_SCHEMA_VERSION;
  frameworkVersion: string;
  exportedAt: string;
  scope: { type: 'app'; app: string } | { type: 'model'; app: string; model: string };
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
    schemaVersion: METADATA_PACKAGE_SCHEMA_VERSION,
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
  if (pkg.format !== METADATA_PACKAGE_FORMAT || pkg.schemaVersion !== METADATA_PACKAGE_SCHEMA_VERSION) {
    throw new Error('Unsupported metadata package format or schema version');
  }
  if (!pkg.scope || (pkg.scope.type !== 'app' && pkg.scope.type !== 'model')) throw new Error('Invalid package scope');
  if (!pkg.scope.app || (pkg.scope.type === 'model' && !pkg.scope.model)) throw new Error('Package scope is incomplete');
  if (!Array.isArray(pkg.artifacts) || pkg.artifacts.length === 0) throw new Error('Package contains no artifacts');
  if (typeof pkg.checksum !== 'string') throw new Error('Package checksum is missing');
  const { checksum, ...payload } = pkg;
  const actual = createHash('sha256').update(canonicalPayload(payload)).digest('hex');
  if (actual !== checksum) throw new Error('Package checksum does not match its contents');
  return pkg;
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
