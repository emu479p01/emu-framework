import { describe, expect, it } from 'vitest';
import { MUTATING_TOOL_NAMES, RESOURCE_CATALOG, TOOL_NAMES } from '../src/catalog.js';

describe('MCP safety catalog', () => {
  it('exposes schemas and workspace context', () => {
    expect(RESOURCE_CATALOG.map((resource) => resource.uri)).toEqual(expect.arrayContaining([
      'emu://schema/metadata', 'emu://schema/change-set', 'emu://workspace/apps',
    ]));
  });

  it('contains no mutating or business-data tools', () => {
    for (const name of MUTATING_TOOL_NAMES) expect(TOOL_NAMES).not.toContain(name);
    expect(TOOL_NAMES).toContain('validate_change_set');
  });
});
