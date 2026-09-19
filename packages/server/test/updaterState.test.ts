import { describe, expect, it } from 'vitest';
import { interruptedRestoreAction, isStableVersion, mergeContainerEnvironment, updateChangedState, type UpdaterPhase } from '../src/updaterState.js';

describe('updater durable-state decisions', () => {
  it('only accepts stable X.Y.Z target versions', () => {
    expect(isStableVersion('1.0.2')).toBe(true);
    for (const value of ['v1.0.2', '1.0', '1.0.2-beta.1', 'latest', '1.0.2.3']) expect(isStableVersion(value)).toBe(false);
  });

  it.each<[UpdaterPhase | undefined, boolean]>([
    [undefined, false], ['preparing', false], ['stopping', false],
    ['snapshotting', true], ['switching', true], ['verifying', true], ['rolling_back', true],
  ])('classifies interrupted update phase %s safely', (phase, changed) => {
    expect(updateChangedState(phase, false, false)).toBe(changed);
  });

  it('always compensates when a snapshot or rollback container exists', () => {
    expect(updateChangedState('stopping', true, false)).toBe(true);
    expect(updateChangedState('preparing', false, true)).toBe(true);
  });

  it.each<[UpdaterPhase | undefined, boolean, string]>([
    [undefined, false, 'resume_original'],
    ['stopping', false, 'resume_original'],
    ['snapshotting', false, 'resume_original'],
    ['restoring', false, 'recovery_required'],
    ['verifying', false, 'recovery_required'],
    ['restoring', true, 'rollback'],
  ])('chooses restore compensation for phase %s and snapshot=%s', (phase, snapshot, expected) => {
    expect(interruptedRestoreAction(phase, snapshot)).toBe(expected);
  });

  it('uses candidate image defaults while carrying explicit runtime environment overrides', () => {
    expect(mergeContainerEnvironment(
      ['NODE_VERSION=24.18.0', 'NODE_ENV=production', 'EMU_APP_TITLE=Custom'],
      ['NODE_VERSION=24.18.0', 'NODE_ENV=production'],
      ['NODE_VERSION=24.20.0', 'NODE_ENV=production', 'NEW_DEFAULT=yes'],
    )).toEqual(['NODE_VERSION=24.20.0', 'NODE_ENV=production', 'NEW_DEFAULT=yes', 'EMU_APP_TITLE=Custom']);
  });
});
