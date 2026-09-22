import { describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { Kernel, licenseBytes, type LicensePayload, type AnyMeta } from '../src/index.js';

function fixture() {
  const kernel = new Kernel();
  kernel.registerApp({ name: 'licensed', models: [{ name: 'Addon', layer: 'ISV', license: { vendor: 'seller' } }] }, [
    { kind: 'table', name: 'LICENSED_Row', app: 'licensed', model: 'Addon', fields: [{ name: 'name', type: 'string' }] },
  ]);
  kernel.registerApp({ name: 'dependent', dependsOn: ['licensed'], models: [] }, []);
  kernel.sync();
  const pair = generateKeyPairSync('ed25519');
  kernel.licenses.setCustomer('customer', 'admin');
  kernel.licenses.trust('seller', pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(), 'admin');
  const payload: LicensePayload = { version: 1, vendor: 'seller', customer: 'customer', installationId: kernel.licenses.identity().installationId, app: 'licensed', model: 'Addon', sequence: 1, notBefore: '2020-01-01T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z' };
  const signed = (p = payload) => ({ payload: p, signature: sign(null,licenseBytes(p),pair.privateKey).toString('base64') });
  return { kernel, payload, signed };
}
describe('offline ISV licensing', () => {
  it('blocks writes and dependent apps while retaining reads, then renews without redeploy', () => {
    const { kernel, signed } = fixture();
    try {
      expect(() => kernel.context().newRecord('LICENSED_Row').set('name','before').insert()).toThrow(/read-only/);
      expect(() => kernel.licenses.assertApp('dependent')).toThrow(/read-only/);
      expect(kernel.context().select('LICENSED_Row').toArray()).toEqual([]);
      kernel.licenses.install(signed(),'admin');
      kernel.context().newRecord('LICENSED_Row').set('name','after').insert();
      expect(kernel.context().select('LICENSED_Row').toArray()).toHaveLength(1);
      expect(() => kernel.licenses.assertApp('dependent')).not.toThrow();
      expect(() => kernel.licenses.install(signed(),'admin')).toThrow(/sequence/);
    } finally { kernel.close(); }
  });
  it('rejects tampering, wrong installation, customer, model, vendor and expired files', () => {
    const { kernel, payload, signed } = fixture();
    try {
      expect(() => kernel.licenses.install({ ...signed(), payload: { ...payload, sequence: 4 } },'admin')).toThrow(/signature/);
      for (const change of [{ installationId:'other' }, { customer:'other' }, { model:'Other' }, { vendor:'other' }, { expiresAt:'2021-01-01T00:00:00Z' }]) expect(() => kernel.licenses.install(signed({ ...payload, ...change }), 'admin')).toThrow();
      expect(kernel.designerDb.prepare('SELECT COUNT(*) n FROM FW_LicenseAudit WHERE action=?').get('rejected')).toMatchObject({ n: 6 });
    } finally { kernel.close(); }
  });
  it('rechecks expiry before transaction commit and rolls back all writes', () => {
    const { kernel, payload, signed } = fixture();
    const clock = vi.spyOn(Date,'now');
    try {
      // Kernel uses the current clock through the default provider.
      const end = Date.parse(payload.expiresAt);
      kernel.licenses.install(signed(),'admin');
      const ctx = kernel.context();
      expect(() => ctx.tts(() => {
        ctx.newRecord('LICENSED_Row').set('name','rollback').insert();
        clock.mockReturnValue(end + 1);
      })).toThrow(/read-only/);
      expect(ctx.select('LICENSED_Row').toArray()).toHaveLength(0);
    } finally { clock.mockRestore(); kernel.close(); }
  });
  it('guards action handlers registered by scripts and restores runtime on failed apply', () => {
    const { kernel } = fixture();
    try {
      const before = kernel.registry;
      const artifacts = [
        { kind:'app', name:'web', models:[{ name:'Main',layer:'SYS' }] },
        { kind:'script',name:'WEB_Broken',app:'web',model:'Main',code:'kernel.actions.set("partial", () => 1); throw new Error("failure");' },
      ] as unknown as AnyMeta[];
      expect(() => kernel.applyWebArtifactsAtomic(artifacts, () => {})).toThrow(/apply/);
      expect(kernel.registry).toBe(before);
      expect(kernel.actions.has('partial')).toBe(false);
      kernel.actions.set('LICENSED_Row', () => 'must not run');
      expect(() => kernel.actions.get('LICENSED_Row')!(kernel.context(), {})).toThrow(/read-only/);
    } finally { kernel.close(); }
  });
});
