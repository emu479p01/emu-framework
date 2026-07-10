import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWorkspaceArtifacts, summarizeWorkspace } from '@emu/core';

describe('AI-friendly CLI workspace format', () => {
  it('produces deterministic JSON summary and revision', () => {
    const root = mkdtempSync(join(tmpdir(), 'emu-cli-'));
    mkdirSync(join(root, 'apps', 'sales', 'metadata', 'tables'), { recursive: true });
    writeFileSync(join(root, 'apps', 'sales', 'app.json'), JSON.stringify({ name: 'sales', label: 'Sales' }));
    writeFileSync(join(root, 'apps', 'sales', 'metadata', 'tables', 'SALES_Customer.json'), JSON.stringify({ kind: 'table', name: 'SALES_Customer', app: 'sales', fields: [{ name: 'name', type: 'string' }] }));
    const first = loadWorkspaceArtifacts(root);
    const second = loadWorkspaceArtifacts(root);
    expect(first.revision).toBe(second.revision);
    expect(summarizeWorkspace(first).apps).toContainEqual({ name: 'sales', label: 'Sales', artifacts: 1 });
  });
});
