#!/usr/bin/env node
import { generateKeyPairSync, sign, createPrivateKey } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'keygen' && args.length === 1) {
    const pair = generateKeyPairSync('ed25519');
    writeFileSync(`${args[0]}.private.pem`, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
    writeFileSync(`${args[0]}.public.pem`, pair.publicKey.export({ type: 'spki', format: 'pem' }), { flag: 'wx' });
  } else if (command === 'issue' && args.length === 3) {
    const payload = JSON.parse(readFileSync(args[1], 'utf8'));
    if (payload.version !== 1 || !['vendor','customer','installationId','app','model'].every((key) => typeof payload[key] === 'string' && payload[key]) || !Number.isSafeInteger(payload.sequence) || payload.sequence < 1 || !String(payload.notBefore).endsWith('Z') || !String(payload.expiresAt).endsWith('Z') || !(Date.parse(payload.expiresAt) > Date.parse(payload.notBefore))) throw new Error('Invalid license payload');
    const bytes = Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(payload).sort(([a],[b]) => a.localeCompare(b)))));
    const key = createPrivateKey(readFileSync(args[0]));
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('An Ed25519 private key is required');
    writeFileSync(args[2], JSON.stringify({ payload, signature: sign(null, bytes, key).toString('base64') }, null, 2), { flag: 'wx' });
  } else throw new Error('Usage: node scripts/isv-license.mjs keygen <prefix> | issue <private.pem> <payload.json> <output.json>');
} catch (error) { console.error(error.message); process.exitCode = 1; }
