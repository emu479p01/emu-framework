import { createPublicKey, randomUUID, verify } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type { AppManifest } from './metadata/types.js';

export interface LicensePayload {
  version: 1; vendor: string; customer: string; installationId: string;
  app: string; model: string; notBefore: string; expiresAt: string; sequence: number;
}
export interface SignedLicense { payload: LicensePayload; signature: string }
export function licenseBytes(payload: LicensePayload): Buffer {
  return Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(payload).sort(([a], [b]) => a.localeCompare(b)))));
}
export class LicenseError extends Error { readonly statusCode = 403; readonly code = 'APP_LICENSE_READ_ONLY'; }

/** Installation state is intentionally outside metadata packages. */
export class LicenseManager {
  private lastStatus = new Map<string, string>();
  constructor(private db: Database, private apps: () => AppManifest[], private now: () => number = () => Date.now()) {
    db.exec(`CREATE TABLE IF NOT EXISTS FW_LicenseIdentity (id INTEGER PRIMARY KEY CHECK(id=1), installationId TEXT NOT NULL, customer TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS FW_LicenseVendor (vendor TEXT PRIMARY KEY, publicKey TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS FW_ModelLicense (app TEXT NOT NULL, model TEXT NOT NULL, json TEXT NOT NULL, sequence INTEGER NOT NULL, PRIMARY KEY(app,model));
      CREATE TABLE IF NOT EXISTS FW_LicenseAudit (id INTEGER PRIMARY KEY, createdAt TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL);`);
    db.prepare('INSERT OR IGNORE INTO FW_LicenseIdentity VALUES (1,?,?)').run(randomUUID(), '');
  }
  identity(): { installationId: string; customer: string } { return this.db.prepare('SELECT installationId,customer FROM FW_LicenseIdentity WHERE id=1').get() as { installationId: string; customer: string }; }
  audit(actor: string, action: string, detail: string): void { this.db.prepare('INSERT INTO FW_LicenseAudit(createdAt,actor,action,detail) VALUES(?,?,?,?)').run(new Date(this.now()).toISOString(), actor, action, detail); }
  setCustomer(customer: string, actor: string): void {
    if (!customer.trim()) throw new Error('Customer is required');
    const current = this.identity();
    if (current.customer && current.customer !== customer) throw new Error('Installation customer is already registered');
    this.db.prepare('UPDATE FW_LicenseIdentity SET customer=? WHERE id=1').run(customer); this.audit(actor, 'customer', customer);
  }
  trust(vendor: string, publicKey: string, actor: string): void {
    if (!vendor.trim() || createPublicKey(publicKey).asymmetricKeyType !== 'ed25519') throw new Error('An Ed25519 vendor public key is required');
    const old = this.db.prepare('SELECT publicKey FROM FW_LicenseVendor WHERE vendor=?').get(vendor) as { publicKey: string } | undefined;
    if (old && old.publicKey !== publicKey) throw new Error('Vendor key is already registered; key replacement is not supported');
    this.db.prepare('INSERT OR IGNORE INTO FW_LicenseVendor VALUES (?,?)').run(vendor, publicKey); this.audit(actor, 'trust-vendor', vendor);
  }
  install(input: SignedLicense, actor: string): void {
    try {
      const p = input?.payload;
      if (!p || p.version !== 1 || !['vendor','customer','installationId','app','model','notBefore','expiresAt'].every((key) => typeof (p as unknown as Record<string, unknown>)[key] === 'string')) throw new Error('Invalid license payload');
      const vendor = this.db.prepare('SELECT publicKey FROM FW_LicenseVendor WHERE vendor=?').get(p.vendor) as { publicKey: string } | undefined;
      if (!vendor || typeof input.signature !== 'string' || !verify(null, licenseBytes(p), vendor.publicKey, Buffer.from(input.signature, 'base64'))) throw new Error('License signature is invalid or vendor is untrusted');
      const identity = this.identity();
      if (!identity.customer || p.customer !== identity.customer || p.installationId !== identity.installationId) throw new Error('License belongs to another customer or installation');
      const model = this.apps().find((a) => a.name === p.app)?.models?.find((m) => m.name === p.model);
      if (model?.layer !== 'ISV' || model.license?.vendor !== p.vendor) throw new Error('License does not match an installed licensed ISV model');
      const start = Date.parse(p.notBefore), end = Date.parse(p.expiresAt);
      if (!p.notBefore.endsWith('Z') || !p.expiresAt.endsWith('Z') || !Number.isFinite(start) || !Number.isFinite(end) || start >= end || end <= this.now()) throw new Error('License dates are invalid or expired');
      if (!Number.isSafeInteger(p.sequence) || p.sequence < 1) throw new Error('Invalid renewal sequence');
      const old = this.db.prepare('SELECT sequence,json FROM FW_ModelLicense WHERE app=? AND model=?').get(p.app,p.model) as { sequence: number; json: string } | undefined;
      if (old && p.sequence <= old.sequence) throw new Error('License renewal sequence must increase');
      if (old && start > this.now()) throw new Error('Renewal must already be valid to avoid replacing an active license with a future license');
      this.db.transaction(() => {
        this.db.prepare('INSERT INTO FW_ModelLicense VALUES(?,?,?,?) ON CONFLICT(app,model) DO UPDATE SET json=excluded.json,sequence=excluded.sequence').run(p.app,p.model,JSON.stringify(input),p.sequence);
        this.audit(actor,'install',`${p.app}/${p.model} sequence ${p.sequence}`);
      })();
    } catch (error) { this.audit(actor,'rejected',(error as Error).message); throw error; }
  }
  status(app: string, model: NonNullable<AppManifest['models']>[number]) {
    let result;
    try { result = this.inspect(app, model); }
    catch { result = { status: 'invalid', blocked: true, vendor: model.license?.vendor ?? null, expiresAt: null }; }
    if (model.license && this.lastStatus.get(`${app}/${model.name}`) !== result.status) {
      this.audit('system', 'status', `${app}/${model.name}: ${result.status}`);
      this.lastStatus.set(`${app}/${model.name}`, result.status);
    }
    return result;
  }
  private inspect(app: string, model: NonNullable<AppManifest['models']>[number]) {
    if (!model.license) return { status: 'not-required', blocked: false, vendor: null, expiresAt: null };
    const row = this.db.prepare('SELECT json FROM FW_ModelLicense WHERE app=? AND model=?').get(app, model.name) as { json: string } | undefined;
    if (!row) return { status: 'missing', blocked: true, vendor: model.license.vendor, expiresAt: null };
    const signed = JSON.parse(row.json) as SignedLicense;
    const p = signed.payload;
    const trusted = this.db.prepare('SELECT publicKey FROM FW_LicenseVendor WHERE vendor=?').get(model.license.vendor) as { publicKey: string } | undefined;
    const identity = this.identity();
    const valid = trusted && p.vendor === model.license.vendor && p.app === app && p.model === model.name && p.installationId === identity.installationId && p.customer === identity.customer && verify(null,licenseBytes(p),trusted.publicKey,Buffer.from(signed.signature,'base64'));
    const now = this.now();
    const status = !valid ? 'invalid' : now < Date.parse(p.notBefore) ? 'not-yet-valid' : now >= Date.parse(p.expiresAt) ? 'expired' : Date.parse(p.expiresAt)-now <= 30*86400000 ? 'expiring' : 'active';
    return { status, blocked: !['active','expiring'].includes(status), vendor: model.license.vendor, expiresAt: p.expiresAt };
  }
  blockedApps(): Map<string, string[]> {
    const apps = this.apps(), blocked = new Map<string, string[]>();
    for (const app of apps) for (const model of app.models ?? []) { const s = this.status(app.name,model); if (s.blocked) blocked.set(app.name,[...(blocked.get(app.name) ?? []),`${app.name}/${model.name}: ${s.status}`]); }
    let changed = true;
    while (changed) { changed = false; for (const app of apps) if (!blocked.has(app.name)) { const dependencies = (app.dependsOn ?? []).filter((name) => blocked.has(name)); if (dependencies.length) { blocked.set(app.name,dependencies.flatMap((name) => blocked.get(name)!)); changed = true; } } }
    return blocked;
  }
  assertApp(app?: string): void { if (!app || app === 'system') return; const reason = this.blockedApps().get(app); if (reason) throw new LicenseError(`App '${app}' is read-only: ${reason.join('; ')}`); }
}
