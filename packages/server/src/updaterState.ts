export type UpdaterPhase =
  | 'preparing' | 'stopping' | 'snapshotting' | 'switching' | 'restoring'
  | 'verifying' | 'completed' | 'rolling_back' | 'rolled_back' | 'recovery_required';

export type InterruptedRestoreAction = 'resume_original' | 'rollback' | 'recovery_required';

export function isStableVersion(version: string): boolean {
  return /^[0-9]+\.[0-9]+\.[0-9]+$/.test(version);
}

export function updateChangedState(
  phase: UpdaterPhase | undefined,
  hasSnapshot: boolean,
  hasRollbackContainer: boolean,
): boolean {
  if (hasSnapshot || hasRollbackContainer) return true;
  return !['preparing', 'stopping', undefined].includes(phase);
}

export function interruptedRestoreAction(
  phase: UpdaterPhase | undefined,
  hasSnapshot: boolean,
): InterruptedRestoreAction {
  if (hasSnapshot) return 'rollback';
  if (['stopping', 'snapshotting', undefined].includes(phase)) return 'resume_original';
  return 'recovery_required';
}

function environmentMap(values: unknown): Map<string, string> {
  const result = new Map<string, string>();
  if (!Array.isArray(values)) return result;
  for (const item of values) {
    if (typeof item !== 'string') continue;
    const split = item.indexOf('=');
    const key = split < 0 ? item : item.slice(0, split);
    if (key) result.set(key, split < 0 ? '' : item.slice(split + 1));
  }
  return result;
}

/** Carries operator overrides forward without pinning defaults from the previous image. */
export function mergeContainerEnvironment(current: unknown, previousImage: unknown, candidateImage: unknown): string[] {
  const running = environmentMap(current);
  const previous = environmentMap(previousImage);
  const merged = environmentMap(candidateImage);
  for (const [key, value] of running) {
    if (!previous.has(key) || previous.get(key) !== value) merged.set(key, value);
  }
  return [...merged].map(([key, value]) => `${key}=${value}`);
}
