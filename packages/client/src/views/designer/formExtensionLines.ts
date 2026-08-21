import type { FormExtensionMeta, FormLineGridMeta, FormLineOverrideMeta } from '@emu/core';

export interface EditorFormLine extends FormLineGridMeta { __inherited?: boolean }
export interface FormLayerEntry { artifact: Record<string, any>; editable: boolean }

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const overrideKeys = ['label', 'hidden', 'order', 'fields', 'aggregates', 'actions'] as const;

function applyOverrides(lines: EditorFormLine[], artifact: Record<string, any>): void {
  for (const override of artifact.elementOverrides ?? []) {
    const line = lines.find((candidate) => candidate.id === override.targetId);
    if (!line) continue;
    for (const key of ['label', 'hidden', 'order'] as const) if (override[key] !== undefined) (line as any)[key] = clone(override[key]);
  }
  for (const override of artifact.lineOverrides ?? []) {
    const line = lines.find((candidate) => candidate.id === override.targetId);
    if (!line) continue;
    for (const key of overrideKeys) if (override[key] !== undefined) (line as any)[key] = clone(override[key]);
  }
}

export function buildFormExtensionLines(layers: FormLayerEntry[], extension: FormExtensionMeta): { lines: EditorFormLine[]; baselines: Map<string, EditorFormLine> } {
  const inherited: EditorFormLine[] = [];
  for (const entry of layers) {
    if (entry.editable) continue;
    const artifact = entry.artifact;
    if (artifact.kind === 'form') inherited.push(...clone(artifact.lines ?? []));
    else if (artifact.kind === 'formExtension') {
      inherited.push(...clone(artifact.lines ?? []));
      applyOverrides(inherited, artifact);
    }
  }
  const baselines = new Map(inherited.filter((line) => line.id).map((line) => [line.id!, clone(line)]));
  applyOverrides(inherited, extension as unknown as Record<string, any>);
  return {
    lines: [...inherited.map((line) => ({ ...line, __inherited: true })), ...((extension.lines ?? []).map((line) => ({ ...line, __inherited: false })))],
    baselines,
  };
}

export function syncFormLineOverrides(extension: FormExtensionMeta, lines: EditorFormLine[], baselines: Map<string, EditorFormLine>): void {
  extension.lines = lines.filter((line) => !line.__inherited).map(({ __inherited: _marker, ...line }) => clone(line));
  const overrides: FormLineOverrideMeta[] = [];
  for (const line of lines.filter((candidate) => candidate.__inherited && candidate.id)) {
    const baseline = baselines.get(line.id!);
    if (!baseline) continue;
    const delta: FormLineOverrideMeta = { targetId: line.id! };
    for (const key of overrideKeys) {
      if (JSON.stringify(line[key]) !== JSON.stringify(baseline[key])) (delta as any)[key] = clone(line[key]);
    }
    if (Object.keys(delta).length > 1) overrides.push(delta);
  }
  if (overrides.length) extension.lineOverrides = overrides;
  else delete extension.lineOverrides;
}
