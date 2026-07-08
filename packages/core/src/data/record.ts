import type { TableMeta } from '../metadata/types.js';
import { SYSTEM_FIELDS } from '../metadata/types.js';
import { ValidationError } from './hooks.js';
import type { DataContext } from './context.js';

export type FieldValue = string | number | boolean | null;

/**
 * A single row of a metadata-defined table, table-buffer style:
 *   const member = ctx.newRecord('Member');
 *   member.set('memberNo', 'M-001');   // or member.f.memberNo = 'M-001'
 *   member.insert();
 * Field access is validated against table metadata at runtime.
 */
export class Record {
  /** Proxy for natural field access: rec.f.memberNo */
  readonly f: { [field: string]: FieldValue };

  private values = new Map<string, FieldValue>();

  constructor(
    private readonly ctx: DataContext,
    readonly table: TableMeta,
  ) {
    const self = this;
    this.f = new Proxy(
      {},
      {
        get: (_t, prop: string) => self.get(prop),
        set: (_t, prop: string, value: FieldValue) => {
          self.set(prop, value);
          return true;
        },
        has: (_t, prop: string) => self.isValidField(prop),
        ownKeys: () => [...SYSTEM_FIELDS, ...self.table.fields.map((f) => f.name)],
        getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
      },
    ) as { [field: string]: FieldValue };
  }

  get id(): number | null {
    return (this.values.get('id') as number | undefined) ?? null;
  }

  private isValidField(name: string): boolean {
    return (
      (SYSTEM_FIELDS as readonly string[]).includes(name) ||
      this.table.fields.some((f) => f.name === name)
    );
  }

  private assertField(name: string): void {
    if (!this.isValidField(name)) {
      throw new ValidationError(`Table '${this.table.name}' has no field '${name}'`);
    }
  }

  get(field: string): FieldValue {
    this.assertField(field);
    return this.values.get(field) ?? null;
  }

  set(field: string, value: FieldValue): this {
    this.assertField(field);
    this.values.set(field, value);
    return this;
  }

  setMany(data: { [field: string]: FieldValue }): this {
    for (const [k, v] of Object.entries(data)) this.set(k, v);
    return this;
  }

  toObject(): { [field: string]: FieldValue } {
    const out: { [field: string]: FieldValue } = {};
    for (const name of SYSTEM_FIELDS) out[name] = this.values.get(name) ?? null;
    for (const f of this.table.fields) out[f.name] = this.values.get(f.name) ?? null;
    return out;
  }

  /** Load raw DB row into this record (internal). */
  _hydrate(row: { [column: string]: unknown }): this {
    for (const [k, v] of Object.entries(row)) {
      this.values.set(k, v as FieldValue);
    }
    return this;
  }

  insert(): this {
    this.ctx._insert(this);
    return this;
  }

  update(): this {
    this.ctx._update(this);
    return this;
  }

  delete(): void {
    this.ctx._delete(this);
  }
}
