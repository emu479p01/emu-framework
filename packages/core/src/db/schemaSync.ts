import type { Database } from 'better-sqlite3';
import type { FieldMeta, TableMeta } from '../metadata/types.js';
import type { MetadataRegistry } from '../metadata/registry.js';

/**
 * Frappe-style additive schema sync: CREATE missing tables, ADD missing columns.
 * Never drops or alters existing columns — safe to run on every boot.
 */

function sqlType(field: FieldMeta): string {
  switch (field.type) {
    case 'int':
    case 'boolean':
    case 'enum':
    case 'reference':
      return 'INTEGER';
    case 'real':
      return 'REAL';
    case 'string':
    case 'date':
    case 'datetime':
      return 'TEXT';
  }
}

const SYSTEM_COLUMNS_SQL = [
  'id INTEGER PRIMARY KEY AUTOINCREMENT',
  'createdAt TEXT',
  'createdBy TEXT',
  'modifiedAt TEXT',
  'modifiedBy TEXT',
];

export interface SyncResult {
  createdTables: string[];
  addedColumns: string[]; // "Table.column"
}

export interface SyncOptions {
  /** Only sync this specific table (e.g. FW_WebArtifact for designer.db). */
  onlyTable?: string;
}

export function syncSchema(db: Database, registry: MetadataRegistry, options: SyncOptions = {}): SyncResult {
  const result: SyncResult = { createdTables: [], addedColumns: [] };
  for (const table of registry.allTables()) {
    if (options.onlyTable && table.name !== options.onlyTable) continue;
    syncTable(db, table, result);
  }
  return result;
}

function syncTable(db: Database, table: TableMeta, result: SyncResult): void {
  const exists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table.name);

  if (!exists) {
    const cols = [
      ...SYSTEM_COLUMNS_SQL,
      ...table.fields.map((f) => `"${f.name}" ${sqlType(f)}`),
    ];
    db.exec(`CREATE TABLE "${table.name}" (${cols.join(', ')})`);
    result.createdTables.push(table.name);
  } else {
    const existing = new Set(
      (db.prepare(`PRAGMA table_info("${table.name}")`).all() as { name: string }[]).map(
        (c) => c.name,
      ),
    );
    for (const f of table.fields) {
      if (!existing.has(f.name)) {
        db.exec(`ALTER TABLE "${table.name}" ADD COLUMN "${f.name}" ${sqlType(f)}`);
        result.addedColumns.push(`${table.name}.${f.name}`);
      }
    }
  }

  for (const idx of table.indexes ?? []) {
    const unique = idx.unique ? 'UNIQUE ' : '';
    const cols = idx.fields.map((f) => `"${f}"`).join(', ');
    db.exec(
      `CREATE ${unique}INDEX IF NOT EXISTS "${table.name}_${idx.name}" ON "${table.name}" (${cols})`,
    );
  }
}
