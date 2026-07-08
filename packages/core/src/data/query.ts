import type { TableMeta } from '../metadata/types.js';
import { SYSTEM_FIELDS } from '../metadata/types.js';
import { ValidationError } from './hooks.js';
import type { FieldValue, Record } from './record.js';
import type { DataContext } from './context.js';

type Op = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'LIKE' | 'IN';

interface Condition {
  field: string;
  op: Op;
  value: FieldValue | FieldValue[];
}

/**
 * Fluent query builder over one table:
 *   ctx.select('Member').where('memberNo', '=', 'M-001').firstOnly()
 *   for (const loan of ctx.select('BookLoan').where('status', '=', LoanStatus.Open)) { ... }
 */
export class Query implements Iterable<Record> {
  private conditions: Condition[] = [];
  private orderings: { field: string; dir: 'ASC' | 'DESC' }[] = [];
  private limitN?: number;
  private offsetN?: number;

  constructor(
    private readonly ctx: DataContext,
    private readonly table: TableMeta,
  ) {}

  private assertField(name: string): void {
    const ok =
      (SYSTEM_FIELDS as readonly string[]).includes(name) ||
      this.table.fields.some((f) => f.name === name);
    if (!ok) throw new ValidationError(`Table '${this.table.name}' has no field '${name}'`);
  }

  where(field: string, op: Op, value: FieldValue | FieldValue[]): this {
    this.assertField(field);
    this.conditions.push({ field, op, value });
    return this;
  }

  /** Shorthand for equality conditions: .whereEq({ accountNum: 'C001' }) */
  whereEq(fields: { [field: string]: FieldValue }): this {
    for (const [field, value] of Object.entries(fields)) this.where(field, '=', value);
    return this;
  }

  orderBy(field: string, dir: 'asc' | 'desc' = 'asc'): this {
    this.assertField(field);
    this.orderings.push({ field, dir: dir.toUpperCase() as 'ASC' | 'DESC' });
    return this;
  }

  limit(n: number, offset = 0): this {
    this.limitN = n;
    this.offsetN = offset;
    return this;
  }

  private buildSql(selectExpr: string): { sql: string; params: FieldValue[] } {
    const params: FieldValue[] = [];
    let sql = `SELECT ${selectExpr} FROM "${this.table.name}"`;
    if (this.conditions.length > 0) {
      const clauses = this.conditions.map((c) => {
        if (c.op === 'IN') {
          const arr = Array.isArray(c.value) ? c.value : [c.value];
          params.push(...arr);
          return `"${c.field}" IN (${arr.map(() => '?').join(', ')})`;
        }
        params.push(c.value as FieldValue);
        return `"${c.field}" ${c.op} ?`;
      });
      sql += ` WHERE ${clauses.join(' AND ')}`;
    }
    if (this.orderings.length > 0) {
      sql += ` ORDER BY ${this.orderings.map((o) => `"${o.field}" ${o.dir}`).join(', ')}`;
    }
    if (this.limitN !== undefined) {
      sql += ` LIMIT ${this.limitN} OFFSET ${this.offsetN ?? 0}`;
    }
    return { sql, params };
  }

  toArray(): Record[] {
    const { sql, params } = this.buildSql('*');
    return this.ctx._query(this.table, sql, params);
  }

  [Symbol.iterator](): Iterator<Record> {
    return this.toArray()[Symbol.iterator]();
  }

  /** firstOnly — returns the first match or null. */
  firstOnly(): Record | null {
    const prev = this.limitN;
    this.limitN = 1;
    const rows = this.toArray();
    this.limitN = prev;
    return rows[0] ?? null;
  }

  count(): number {
    this.ctx._assertRead(this.table);
    const { sql, params } = this.buildSql('COUNT(*) AS n');
    return this.ctx._scalar(sql, params) as number;
  }
}
