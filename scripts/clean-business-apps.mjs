/**
 * Remove business apps (ERP demo) from the live databases entirely:
 * - designer.db: delete every FW_WebArtifact row belonging to app erp / erp.credit
 * - data.db:     DROP the ERP_* tables (schema + rows), delete ERP role
 *                assignments, app-access rows, and demo users
 * Framework (FW_*) metadata and data are never touched.
 *
 * Usage: node scripts/clean-business-apps.mjs
 */
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'packages', 'core', 'package.json'));
const Database = require('better-sqlite3');

const designer = new Database(join(root, 'designer.db'));
const data = new Database(join(root, 'data.db'));

// ---- legacy tables (pre-FW_ rename) — they keep re-importing deleted rows at boot ----
for (const t of ['SystemWebArtifact']) {
  try {
    designer.exec(`DROP TABLE IF EXISTS "${t}"`);
    console.log(`designer.db: dropped legacy table ${t}`);
  } catch {}
}
for (const t of ['SystemUser', 'SystemSession', 'SystemUserRole', 'SystemWebArtifact']) {
  try {
    data.exec(`DROP TABLE IF EXISTS "${t}"`);
    console.log(`data.db: dropped legacy table ${t}`);
  } catch {}
}

// ---- designer.db: remove ERP artifacts ----
const deleted = designer
  .prepare("DELETE FROM FW_WebArtifact WHERE name IN ('erp', 'erp.credit') OR name LIKE 'ERP\\_%' ESCAPE '\\'")
  .run();
console.log(`designer.db: deleted ${deleted.changes} ERP artifacts`);

// keep FW_Role enum free of ERP values (in case an old seed merged them in)
const fwRole = designer.prepare("SELECT json FROM FW_WebArtifact WHERE name = 'FW_Role'").get();
if (fwRole) {
  const role = JSON.parse(fwRole.json);
  const before = role.values.length;
  role.values = role.values.filter((v) => !v.name.startsWith('ERP_'));
  if (role.values.length !== before) {
    designer.prepare("UPDATE FW_WebArtifact SET json = ? WHERE name = 'FW_Role'").run(JSON.stringify(role));
    console.log('designer.db: removed ERP values from FW_Role enum');
  }
}
console.log(`designer.db: ${designer.prepare('SELECT COUNT(*) AS n FROM FW_WebArtifact').get().n} artifacts remaining`);

// ---- data.db: drop ERP tables (schema + rows) ----
const erpTables = data
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ERP\\_%' ESCAPE '\\'")
  .all()
  .map((t) => t.name);
for (const table of erpTables) {
  data.exec(`DROP TABLE IF EXISTS "${table}"`);
  console.log(`data.db: dropped table ${table}`);
}

// role assignments referencing values that no longer exist in FW_Role
if (fwRole) {
  const valid = JSON.parse(designer.prepare("SELECT json FROM FW_WebArtifact WHERE name = 'FW_Role'").get().json)
    .values.map((v) => v.value);
  try {
    const r = data
      .prepare(`DELETE FROM FW_UserRole WHERE role NOT IN (${valid.map(() => '?').join(',')})`)
      .run(...valid);
    if (r.changes > 0) console.log(`data.db: deleted ${r.changes} orphaned role assignments`);
  } catch { /* table may not exist yet */ }
}

try {
  const accessRows = data.prepare("DELETE FROM FW_AppAccess WHERE appName IN ('erp', 'erp.credit')").run();
  if (accessRows.changes > 0) console.log(`data.db: deleted ${accessRows.changes} app access rows`);
} catch { /* table may not exist yet */ }

const users = data.prepare("DELETE FROM FW_User WHERE username IN ('clerk', 'manager')").run();
if (users.changes > 0) console.log(`data.db: deleted ${users.changes} demo users`);

designer.close();
data.close();
console.log('Done.');
