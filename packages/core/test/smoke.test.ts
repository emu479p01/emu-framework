import { describe, it, expect } from 'vitest';
import { CORE_VERSION } from '../src/index.js';

describe('core', () => {
  it('exports a version', () => {
    expect(CORE_VERSION).toBe('0.0.0.3');
  });
});
