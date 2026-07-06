import type { Record } from './record.js';
import type { DataContext } from './context.js';

/**
 * Table lifecycle data events. Pre-events (onValidating/onInserting/onUpdating/onDeleting)
 * may cancel the operation; post-events are notifications.
 */
export type DataEventType =
  | 'onValidating'
  | 'onInserting'
  | 'onInserted'
  | 'onUpdating'
  | 'onUpdated'
  | 'onDeleting'
  | 'onDeleted';

export const PRE_EVENTS: readonly DataEventType[] = [
  'onValidating',
  'onInserting',
  'onUpdating',
  'onDeleting',
];

export class DataEventCancelled extends Error {
  constructor(
    public readonly table: string,
    public readonly event: DataEventType,
    reason: string,
  ) {
    super(`${table}.${event} cancelled: ${reason}`);
  }
}

export interface DataEventArgs {
  table: string;
  event: DataEventType;
  record: Record;
  /** The context performing the operation — same user, policy, and transaction. */
  ctx: DataContext;
  /** Only callable in pre-events; aborts the data operation. */
  cancel(reason: string): never;
}

export type DataEventHandler = (e: DataEventArgs) => void;

export class EventBus {
  private handlers = new Map<string, DataEventHandler[]>();

  on(table: string, event: DataEventType, handler: DataEventHandler): void {
    const key = `${table}.${event}`;
    const list = this.handlers.get(key) ?? [];
    list.push(handler);
    this.handlers.set(key, list);
  }

  clear(): void {
    this.handlers.clear();
  }

  emit(table: string, event: DataEventType, record: Record, ctx: DataContext): void {
    const list = this.handlers.get(`${table}.${event}`);
    if (!list) return;
    const cancellable = PRE_EVENTS.includes(event);
    const args: DataEventArgs = {
      table,
      event,
      record,
      ctx,
      cancel(reason: string): never {
        if (!cancellable) {
          throw new Error(`Cannot cancel post-event ${table}.${event}`);
        }
        throw new DataEventCancelled(table, event, reason);
      },
    };
    for (const handler of list) {
      handler(args);
    }
  }
}
