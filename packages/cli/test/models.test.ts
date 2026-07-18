import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scaffoldApp } from '../src/scaffold/app.js';
import { scaffoldTable } from '../src/scaffold/object.js';
import { scaffoldTableExtension } from '../src/scaffold/extension.js';

const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

describe('explicit App and Model scaffolding', () => {
  it('creates every App name, including erp, with zero Models', () => {
    const root = mkdtempSync(join(tmpdir(), 'emu-cli-model-'));
    const { appDir } = scaffoldApp(root, 'erp', 'ERP');
    expect(readJson(join(appDir, 'app.json')).models).toEqual([]);
  });

  it('writes explicit app/model/layer placement into objects and extensions', () => {
    const root = mkdtempSync(join(tmpdir(), 'emu-cli-placement-'));
    const tablePath = scaffoldTable(root, {
      app: 'sales', model: 'Operations', layer: 'DEV',
      name: 'SALES_Order', label: 'Order', fields: [{ name: 'number', type: 'string' }],
    });
    expect(readJson(tablePath)).toMatchObject({ app: 'sales', model: 'Operations', layer: 'DEV' });
    const extensionPath = scaffoldTableExtension(root, {
      app: 'sales.local', model: 'Localization', layer: 'LOC',
      name: 'SALES_Local_Order_Extension', table: 'SALES_Order', fields: [{ name: 'taxCode', type: 'string' }],
    });
    expect(readJson(extensionPath)).toMatchObject({ app: 'sales.local', model: 'Localization', layer: 'LOC' });
  });
});
