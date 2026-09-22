import type { Record } from './record.js';
import type { DataContext } from './context.js';

/**
 * Table lifecycle hooks — the equivalent of table event methods
 * (initValue/validateWrite/validateDelete).
 * Multiple hook sets may be registered per table (base app + extensions).
 * validate* hooks return false or throw to block the operation.
 */
export interface TableHooks {
  initValue?(record: Record, ctx: DataContext): void;
  validateWrite?(record: Record, ctx: DataContext): boolean | void;
  validateDelete?(record: Record, ctx: DataContext): boolean | void;
}

export class ValidationError extends Error {}

export class HookRegistry {
  constructor(private captureGuard?: () => (() => void) | undefined) {}
  private hooks = new Map<string, TableHooks[]>();

  register(table: string, hooks: TableHooks): void {
    const guard = this.captureGuard?.();
    if (guard) hooks = Object.fromEntries(Object.entries(hooks).map(([key, fn]) => [key, (record: Record, ctx: DataContext) => { ctx.guardWrite(guard); return fn(record, ctx); }])) as TableHooks;
    const list = this.hooks.get(table) ?? [];
    list.push(hooks);
    this.hooks.set(table, list);
  }

  clear(): void {
    this.hooks.clear();
  }
  snapshot(): () => void {
    const saved = new Map([...this.hooks].map(([key, value]) => [key, [...value]]));
    return () => { this.hooks = saved; };
  }

  for(table: string): TableHooks[] {
    return this.hooks.get(table) ?? [];
  }
}
