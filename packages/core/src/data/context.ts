import type { Database } from 'better-sqlite3';
import type { MetadataRegistry } from '../metadata/registry.js';
import type { TableMeta } from '../metadata/types.js';
import { EventBus } from './events.js';
import { HookRegistry, ValidationError } from './hooks.js';
import { Record, type FieldValue } from './record.js';
import { Query } from './query.js';
import { allowAll, SecurityError, type SecurityPolicy } from '../security/policy.js';

export interface SessionInfo {
  user: string;
}

/**
 * The data kernel: every read/write goes through here so hooks, events and
 * (later) security always apply, regardless of caller (REST, script, test).
 */
export class DataContext {
  readonly events: EventBus;
  readonly hooks: HookRegistry;
  private ttsLevel = 0;
  private deleting = new Set<string>();

  constructor(
    private readonly db: Database,
    readonly registry: MetadataRegistry,
    readonly session: SessionInfo = { user: 'system' },
    events?: EventBus,
    hooks?: HookRegistry,
    readonly policy: SecurityPolicy = allowAll,
  ) {
    // events/hooks are usually shared kernel-wide so app logic registered at
    // boot applies to every request context
    this.events = events ?? new EventBus();
    this.hooks = hooks ?? new HookRegistry();
  }

  newRecord(tableName: string): Record {
    const table = this.registry.getTable(tableName);
    const rec = new Record(this, table);
    for (const field of table.fields) {
      if (field.default !== undefined) rec.set(field.name, field.default as FieldValue);
    }
    for (const hooks of this.hooks.for(tableName)) {
      hooks.initValue?.(rec, this);
    }
    return rec;
  }

  select(tableName: string): Query {
    return new Query(this, this.registry.getTable(tableName));
  }

  find(tableName: string, id: number): Record | null {
    return this.select(tableName).where('id', '=', id).firstOnly();
  }

  /**
   * Transaction begin/commit. Nested calls use savepoints; any throw rolls back.
   */
  tts<T>(fn: () => T): T {
    const savepoint = `tts_${this.ttsLevel}`;
    if (this.ttsLevel === 0) {
      this.db.exec('BEGIN');
    } else {
      this.db.exec(`SAVEPOINT ${savepoint}`);
    }
    this.ttsLevel++;
    try {
      const result = fn();
      this.ttsLevel--;
      if (this.ttsLevel === 0) {
        this.db.exec('COMMIT');
      } else {
        this.db.exec(`RELEASE ${savepoint}`);
      }
      return result;
    } catch (err) {
      this.ttsLevel--;
      if (this.ttsLevel === 0) {
        this.db.exec('ROLLBACK');
      } else {
        this.db.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
      }
      throw err;
    }
  }

  // ---- internal write path (called by Record) ----

  private assertAllowed(table: string, op: 'read' | 'create' | 'update' | 'delete'): void {
    if (!this.policy.can(table, op)) {
      throw new SecurityError(`Access denied: ${op} on '${table}' (user '${this.session.user}')`);
    }
  }

  private validateWrite(table: TableMeta, rec: Record): void {
    for (const f of table.fields) {
      const value = rec.get(f.name);
      if (f.mandatory && (rec.get(f.name) === null || rec.get(f.name) === '')) {
        throw new ValidationError(`${table.name}.${f.name} is mandatory`);
      }
      if (value !== null) {
        if ((f.type === 'int' || f.type === 'real' || f.type === 'enum' || f.type === 'reference') && typeof value !== 'number') {
          throw new ValidationError(`${table.name}.${f.name} expects ${f.type === 'reference' ? 'a numeric record id' : 'a number'}; received '${String(value)}'`);
        }
        if ((f.type === 'string' || f.type === 'date' || f.type === 'datetime') && typeof value !== 'string') {
          throw new ValidationError(`${table.name}.${f.name} expects text; received ${typeof value}`);
        }
      }
    }
    this.events.emit(table.name, 'onValidating', rec, this);
    for (const hooks of this.hooks.for(table.name)) {
      if (hooks.validateWrite?.(rec, this) === false) {
        throw new ValidationError(`${table.name}: validateWrite failed`);
      }
    }
  }

  _insert(rec: Record): void {
    const table = rec.table;
    if (rec.id !== null) throw new ValidationError(`${table.name}: record already inserted`);
    this.assertAllowed(table.name, 'create');
    this.validateWrite(table, rec);
    this.events.emit(table.name, 'onInserting', rec, this);

    const now = new Date().toISOString();
    rec.set('createdAt', now).set('createdBy', this.session.user);
    rec.set('modifiedAt', now).set('modifiedBy', this.session.user);

    const cols = ['createdAt', 'createdBy', 'modifiedAt', 'modifiedBy', ...table.fields.map((f) => f.name)];
    const sql = `INSERT INTO "${table.name}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
    const info = this.db.prepare(sql).run(...cols.map((c) => normalize(rec.get(c))));
    rec.set('id', Number(info.lastInsertRowid));

    this.events.emit(table.name, 'onInserted', rec, this);
  }

  _update(rec: Record): void {
    const table = rec.table;
    if (rec.id === null) throw new ValidationError(`${table.name}: cannot update unsaved record`);
    this.assertAllowed(table.name, 'update');
    this.validateWrite(table, rec);
    this.events.emit(table.name, 'onUpdating', rec, this);

    rec.set('modifiedAt', new Date().toISOString()).set('modifiedBy', this.session.user);

    const cols = ['modifiedAt', 'modifiedBy', ...table.fields.map((f) => f.name)];
    const sql = `UPDATE "${table.name}" SET ${cols.map((c) => `"${c}" = ?`).join(', ')} WHERE id = ?`;
    this.db.prepare(sql).run(...cols.map((c) => normalize(rec.get(c))), rec.id);

    this.events.emit(table.name, 'onUpdated', rec, this);
  }

  _delete(rec: Record): void {
    if (this.ttsLevel === 0) {
      this.tts(() => this.deleteWithinTransaction(rec));
      return;
    }
    this.deleteWithinTransaction(rec);
  }

  private deleteWithinTransaction(rec: Record): void {
    const table = rec.table;
    if (rec.id === null) throw new ValidationError(`${table.name}: cannot delete unsaved record`);
    this.assertAllowed(table.name, 'delete');
    const deleteKey = `${table.name}:${rec.id}`;
    if (this.deleting.has(deleteKey)) return;
    this.deleting.add(deleteKey);
    try {
      for (const childTable of this.registry.allTables()) {
        for (const field of childTable.fields) {
          if (field.type !== 'reference' || field.reference?.table !== table.name) continue;
          // Relation discovery is an internal integrity check and must not require read
          // permission on every possible child table. Any resulting update/delete still
          // passes through that table's normal write policy below.
          const childRows = this.db.prepare(`SELECT * FROM "${childTable.name}" WHERE "${field.name}" = ?`).all(rec.id) as { [column: string]: unknown }[];
          const children = childRows.map((row) => new Record(this, childTable)._hydrate(row));
          if (children.length === 0) continue;
          const behavior = field.reference.onDelete ?? 'restrict';
          if (behavior === 'restrict') {
            throw new ValidationError(`Cannot delete ${table.name} ${rec.id}: ${children.length} record(s) in ${childTable.name}.${field.name} still reference it`);
          }
          if (behavior === 'setNull') {
            if (field.mandatory) throw new ValidationError(`${childTable.name}.${field.name}: mandatory references cannot use onDelete 'setNull'`);
            for (const child of children) child.set(field.name, null).update();
          } else {
            for (const child of children) child.delete();
          }
        }
      }
    for (const hooks of this.hooks.for(table.name)) {
      if (hooks.validateDelete?.(rec, this) === false) {
        throw new ValidationError(`${table.name}: validateDelete failed`);
      }
    }
    this.events.emit(table.name, 'onDeleting', rec, this);
    this.db.prepare(`DELETE FROM "${table.name}" WHERE id = ?`).run(rec.id);
    this.events.emit(table.name, 'onDeleted', rec, this);
    } finally {
      this.deleting.delete(deleteKey);
    }
  }

  // ---- internal read path (called by Query) ----

  _query(table: TableMeta, sql: string, params: FieldValue[]): Record[] {
    this.assertAllowed(table.name, 'read');
    const rows = this.db.prepare(sql).all(...params) as { [column: string]: unknown }[];
    return rows.map((row) => new Record(this, table)._hydrate(row));
  }

  _assertRead(table: TableMeta): void {
    this.assertAllowed(table.name, 'read');
  }

  _scalar(sql: string, params: FieldValue[]): unknown {
    const row = this.db.prepare(sql).get(...params) as { [column: string]: unknown } | undefined;
    return row ? Object.values(row)[0] : null;
  }
}

/** SQLite cannot bind booleans — store as 0/1. */
function normalize(v: FieldValue): string | number | null {
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}
