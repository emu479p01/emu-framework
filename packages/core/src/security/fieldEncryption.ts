import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ENVELOPE_VERSION = 'v1';

function loadOrCreateKey(databasePath: string): Buffer {
  const configured = process.env.EMU_SECRET_KEY_PATH;
  const keyPath = configured ?? (databasePath !== ':memory:' ? join(dirname(databasePath), '.emu-secret.key') : undefined);
  if (!keyPath) return randomBytes(32);
  if (existsSync(keyPath)) {
    const key = Buffer.from(readFileSync(keyPath, 'utf8').trim(), 'hex');
    if (key.length !== 32) throw new Error(`Invalid encryption key at '${keyPath}'`);
    return key;
  }
  mkdirSync(dirname(keyPath), { recursive: true });
  const key = randomBytes(32);
  writeFileSync(keyPath, key.toString('hex'), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  try { chmodSync(keyPath, 0o600); } catch { /* Windows permissions are inherited. */ }
  return key;
}

/** Shared, versioned AES-256-GCM codec for persistent framework and business secrets. */
export class FieldEncryption {
  private readonly key: Buffer;

  constructor(databasePath = ':memory:') {
    this.key = loadOrCreateKey(databasePath);
  }

  isEncrypted(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    const [version, iv, tag, encrypted, extra] = value.split(':');
    if (version !== ENVELOPE_VERSION || !iv || !tag || encrypted === undefined || extra !== undefined) return false;
    try { return Buffer.from(iv, 'base64').length === 12 && Buffer.from(tag, 'base64').length === 16; } catch { return false; }
  }

  encrypt(value: string): string {
    if (this.isEncrypted(value)) return value;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [ENVELOPE_VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join(':');
  }

  decrypt(value: string): string {
    const [version, iv, tag, encrypted] = value.split(':');
    if (version !== ENVELOPE_VERSION || !iv || !tag || !encrypted) throw new Error('Encrypted value cannot be decrypted; restore the matching secret key or replace the value');
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('Encrypted value cannot be decrypted; restore the matching secret key or replace the value');
    }
  }
}
