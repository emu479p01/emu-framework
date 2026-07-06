export const CORE_VERSION = '0.0.0.3';

export { Kernel, type ActionHandler, type WebArtifactError } from './kernel.js';
export {
  SecurityError,
  allowAll,
  buildRolePolicy,
  type SecurityPolicy,
  type CrudOp,
} from './security/policy.js';

export * from './metadata/types.js';
export { MetadataRegistry, MetadataError } from './metadata/registry.js';
export { syncSchema, type SyncResult } from './db/schemaSync.js';
export { DataContext, type SessionInfo } from './data/context.js';
export { Record, type FieldValue } from './data/record.js';
export { Query } from './data/query.js';
export {
  EventBus,
  DataEventCancelled,
  type DataEventType,
  type DataEventArgs,
  type DataEventHandler,
} from './data/events.js';
export { HookRegistry, ValidationError, type TableHooks } from './data/hooks.js';
