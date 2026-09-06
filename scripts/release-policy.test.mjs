import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyTransition, extractReleaseNotes, parseVersion, run, selectPreviousVersion } from './release-policy.mjs';

const completeNotes = (type = 'PU', version = '1.0.1') => `
before
<!-- release-notes:start -->
## ${type} — EmuFramework v${version}
### Summary
Summary.
### Fixes
Fixed.
### Breaking changes and migration
None.
### Upgrade notes
Upgrade.
### Validation
Validated.
### Known issues
None.
<!-- release-notes:end -->
after`;

test('classifies valid Major, Minor, and Patch transitions', () => {
  assert.equal(classifyTransition('1.8.4', '2.0.0'), 'FU');
  assert.equal(classifyTransition('1.8.4', '1.9.0'), 'FU');
  assert.equal(classifyTransition('1.8.4', '1.8.5'), 'PU');
});

test('rejects skipped components and versions with four components', () => {
  assert.throws(() => classifyTransition('1.8.4', '1.10.0'), /increment exactly one/);
  assert.throws(() => classifyTransition('1.8.4', '2.1.0'), /increment exactly one/);
  assert.throws(() => parseVersion('1.8.4.1'), /X.Y.Z/);
  assert.throws(() => parseVersion('v1.8.4'), /X.Y.Z/);
});

test('selects the latest earlier three-component tag and ignores legacy tags', () => {
  assert.equal(selectPreviousVersion(['0.5.0.0', '0.9.9', '1.0.0', '1.0.1'], '1.0.1'), '1.0.0');
});

test('extracts the canonical release note', () => {
  const notes = extractReleaseNotes(completeNotes(), '1.0.1', 'PU');
  assert.match(notes, /^## PU — EmuFramework v1\.0\.1/);
  assert.doesNotMatch(notes, /<!-- release-notes/);
});

test('rejects mismatched type, missing sections, and missing markers', () => {
  assert.throws(() => extractReleaseNotes(completeNotes('FU'), '1.0.1', 'PU'), /must begin/);
  assert.throws(() => extractReleaseNotes(completeNotes().replace('### Validation', '### Checks'), '1.0.1', 'PU'), /Validation/);
  assert.throws(() => extractReleaseNotes('## PU — EmuFramework v1.0.1', '1.0.1', 'PU'), /marker pair/);
});

test('accepts the pnpm argument separator', () => {
  assert.doesNotThrow(() => run(['--', '--versions-only']));
});
