import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const Database = require(join(root, 'node_modules', '.pnpm', 'better-sqlite3@11.10.0', 'node_modules', 'better-sqlite3'));

console.log('=== DESIGNER.DB ===');
const designer = new Database(join(root, 'designer.db'));

const allArtifacts = designer.prepare('SELECT kind, name, json FROM FW_WebArtifact ORDER BY kind, name').all();
console.log('Total FW_WebArtifact:', allArtifacts.length);

const erpArtifacts = allArtifacts.filter(r => {
  const j = r.json || '';
  return r.name === 'erp' || r.name.startsWith('ERP_') || /"app"\s*:\s*"erp"/i.test(j) || /Mini ERP/i.test(j);
});
console.log('\nERP-related artifacts in designer.db:', erpArtifacts.length);
erpArtifacts.forEach(r => {
  let app = '', model = '';
  try { const a = JSON.parse(r.json); app = a.app || ''; model = a.model || ''; } catch {}
  console.log(' ', r.kind.padEnd(16), r.name, 'app=' + app, 'model=' + model);
});

console.log('\n=== FW_Role enum (current) ===');
const roleRow = designer.prepare("SELECT json FROM FW_WebArtifact WHERE name = 'FW_Role'").get();
if (roleRow) {
  const role = JSON.parse(roleRow.json);
  console.dir(role.values);
}

designer.close();

console.log('\n=== DATA.DB ===');
const data = new Database(join(root, 'data.db'));

const tables = data.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
console.log('Tables:', tables.join(', '));

console.log('\n--- FW_UserRole ---');
try {
  const ur = data.prepare('SELECT * FROM FW_UserRole').all();
  console.dir(ur);
} catch (e) { console.log('Error:', e.message); }

console.log('\n--- admin user ---');
try {
  const u = data.prepare("SELECT * FROM FW_User WHERE username='admin'").get();
  console.dir(u);
} catch (e) { console.log('Error:', e.message); }

console.log('\n--- ERP_* tables row counts ---');
for (const t of tables.filter(n => /^ERP_/i.test(n))) {
  try {
    const c = data.prepare(`SELECT COUNT(*) as c FROM "${t}"`).get().c;
    console.log(t + ':', c, 'rows');
  } catch {}
}

console.log('\n--- FW_AppAccess ---');
try {
  const aa = data.prepare('SELECT * FROM FW_AppAccess').all();
  console.dir(aa);
} catch (e) { console.log('No FW_AppAccess or error'); }

data.close();
console.log('\nDone inspection.');
