import { describe, expect, it } from 'vitest';
import { Kernel, validateMetadataArtifact, type AnyMeta } from '../src/index.js';

const manifest = { kind: 'app', name: 'secrets', models: [{ name: 'Core', layer: 'CUS' }] } as unknown as AnyMeta;
const table = (encrypted: boolean): AnyMeta => ({
  kind: 'table', name: 'SECRETS_Config', app: 'secrets', model: 'Core', layer: 'CUS',
  fields: [{ name: 'label', type: 'string' }, { name: 'secret', type: 'string', encrypted: encrypted || undefined }],
} as AnyMeta);

describe('encrypted fields', () => {
  it('encrypts at rest while trusted DataContext reads plaintext', () => {
    const kernel = new Kernel();
    expect(kernel.applyWebArtifacts([manifest, table(true)])).toEqual([]);
    const rec = kernel.context().newRecord('SECRETS_Config').setMany({ label: 'API', secret: 'top-secret' }).insert();
    const raw = kernel.db.prepare('SELECT secret FROM "SECRETS_Config" WHERE id=?').get(rec.id) as { secret: string };
    expect(raw.secret).not.toContain('top-secret');
    expect(raw.secret).toMatch(/^v1:/);
    expect(kernel.context().find('SECRETS_Config', rec.id!)?.f.secret).toBe('top-secret');
    expect(() => kernel.context().select('SECRETS_Config').where('secret', '=', 'top-secret')).toThrow(/encrypted fields cannot be filtered/i);
  });

  it('migrates plaintext to ciphertext and back transactionally and idempotently', () => {
    const kernel = new Kernel();
    expect(kernel.applyWebArtifacts([manifest, table(false)])).toEqual([]);
    kernel.context().newRecord('SECRETS_Config').setMany({ label: 'Legacy', secret: 'legacy-value' }).insert();
    expect(kernel.applyWebArtifacts([manifest, table(true)])).toEqual([]);
    const encrypted = (kernel.db.prepare('SELECT secret FROM "SECRETS_Config"').get() as { secret: string }).secret;
    expect(encrypted).toMatch(/^v1:/);
    expect(kernel.applyWebArtifacts([manifest, table(true)])).toEqual([]);
    expect((kernel.db.prepare('SELECT secret FROM "SECRETS_Config"').get() as { secret: string }).secret).toBe(encrypted);
    expect(kernel.applyWebArtifacts([manifest, table(false)])).toEqual([]);
    expect((kernel.db.prepare('SELECT secret FROM "SECRETS_Config"').get() as { secret: string }).secret).toBe('legacy-value');
  });

  it('rolls back and keeps encrypted metadata active when decryption migration fails', () => {
    const kernel = new Kernel();
    expect(kernel.applyWebArtifacts([manifest, table(true)])).toEqual([]);
    kernel.context().newRecord('SECRETS_Config').setMany({ label: 'Broken', secret: 'value' }).insert();
    const corrupted = `v1:${Buffer.alloc(12).toString('base64')}:${Buffer.alloc(16).toString('base64')}:${Buffer.from('broken').toString('base64')}`;
    kernel.db.prepare('UPDATE "SECRETS_Config" SET secret=?').run(corrupted);
    const errors = kernel.applyWebArtifacts([manifest, table(false)]);
    expect(errors[0]).toMatchObject({ name: 'encrypted-field-migration' });
    expect(kernel.registry.getTable('SECRETS_Config').fields.find((field) => field.name === 'secret')?.encrypted).toBe(true);
    expect((kernel.db.prepare('SELECT secret FROM "SECRETS_Config"').get() as { secret: string }).secret).toBe(corrupted);
  });

  it('validates multiline and encrypted metadata constraints', () => {
    const invalid = validateMetadataArtifact({ kind: 'table', name: 'Bad', app: 'bad', model: 'Core', layer: 'CUS', fields: [{ name: 'amount', type: 'int', multiline: true, encrypted: true }] });
    expect(invalid.map((issue) => issue.message).join(' ')).toMatch(/multiline.*string/i);
    expect(invalid.map((issue) => issue.message).join(' ')).toMatch(/encrypted.*string/i);
    const kernel = new Kernel();
    expect(kernel.applyWebArtifacts([manifest, { ...table(true), titleField: 'secret', indexes: [{ name: 'SecretIdx', fields: ['secret'] }] } as AnyMeta])[0]?.error).toMatch(/encrypted field/i);
  });
});
