import Database from '../packages/core/node_modules/better-sqlite3/lib/index.js';

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error('Usage: node scripts/validate-sqlite.mjs <database> [...]');
  process.exit(2);
}
for (const path of paths) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const result = db.pragma('integrity_check', { simple: true });
    if (result !== 'ok') throw new Error(`${path}: integrity_check returned ${String(result)}`);
  } finally {
    db.close();
  }
}
console.log('SQLite integrity check passed.');
