import type { Kernel, TableMeta } from '@emu/core';
import { hashPassword } from './auth.js';

/**
 * Built-in system app: only the bare minimum for authentication.
 * All other metadata (forms, menus, security, enums, web artifacts storage)
 * lives in the designer database via bootWebArtifacts + the first-boot seeder.
 */

const systemUser: TableMeta = {
  kind: 'table',
  name: 'FW_User',
  app: 'system',
  model: 'Framework',
  layer: 'SYS',
  label: 'Users',
  titleField: 'username',
  fields: [
    { name: 'username', type: 'string', mandatory: true, maxLength: 60 },
    { name: 'displayName', type: 'string' },
    { name: 'locale', type: 'string', default: 'en', maxLength: 35 },
    { name: 'passwordHash', type: 'string', readOnly: true },
    { name: 'password', type: 'string' },
    { name: 'enabled', type: 'boolean', default: true },
  ],
  indexes: [{ name: 'UsernameIdx', fields: ['username'], unique: true }],
};

const systemSession: TableMeta = {
  kind: 'table',
  name: 'FW_Session',
  app: 'system',
  model: 'Framework',
  layer: 'SYS',
  fields: [
    { name: 'token', type: 'string', mandatory: true },
    { name: 'username', type: 'string', mandatory: true },
    { name: 'expiresAt', type: 'datetime', mandatory: true },
  ],
  indexes: [{ name: 'TokenIdx', fields: ['token'], unique: true }],
};

/** Storage for artifacts created in the Web Designer. */
const systemWebArtifact: TableMeta = {
  kind: 'table',
  name: 'FW_WebArtifact',
  app: 'system',
  model: 'Framework',
  layer: 'SYS',
  fields: [
    { name: 'kind', type: 'string', mandatory: true },
    { name: 'name', type: 'string', mandatory: true },
    { name: 'app', type: 'string' },
    { name: 'model', type: 'string' },
    { name: 'layer', type: 'string' },
    { name: 'revision', type: 'string' },
    { name: 'json', type: 'string', mandatory: true },
  ],
  indexes: [
    { name: 'NameIdx', fields: ['name'], unique: true },
    { name: 'PlacementIdx', fields: ['app', 'model', 'kind'] },
    { name: 'RevisionIdx', fields: ['revision'] },
  ],
};

const systemMigration: TableMeta = {
  kind: 'table', name: 'FW_Migration', app: 'system', model: 'Framework', layer: 'SYS',
  fields: [
    { name: 'migration', type: 'string', readOnly: true },
    { name: 'appliedAt', type: 'datetime', readOnly: true },
  ],
  indexes: [{ name: 'MigrationIdx', fields: ['migration'], unique: true }],
};

const systemViewToken: TableMeta = {
  kind: 'table', name: 'FW_ViewToken', app: 'system', model: 'Framework', layer: 'SYS',
  fields: [
    { name: 'name', type: 'string', mandatory: true, maxLength: 120 },
    { name: 'tokenHash', type: 'string', readOnly: true },
    { name: 'enabled', type: 'boolean', default: true },
    { name: 'expiresAt', type: 'datetime' },
    { name: 'lastUsedAt', type: 'datetime', readOnly: true },
    { name: 'revokedAt', type: 'datetime', readOnly: true },
  ],
  indexes: [{ name: 'ViewTokenHashIdx', fields: ['tokenHash'], unique: true }],
};

const systemViewTokenScope: TableMeta = {
  kind: 'table', name: 'FW_ViewTokenScope', app: 'system', model: 'Framework', layer: 'SYS',
  fields: [
    { name: 'tokenId', type: 'reference', mandatory: true, reference: { table: 'FW_ViewToken', onDelete: 'cascade' } },
    { name: 'viewName', type: 'string', mandatory: true },
  ],
  indexes: [{ name: 'ViewTokenScopeIdx', fields: ['tokenId', 'viewName'], unique: true }],
};

const systemNavigationItem: TableMeta = {
  kind: 'table', name: 'FW_NavigationItem', app: 'system', model: 'Framework', layer: 'SYS',
  fields: [
    { name: 'userId', type: 'reference', mandatory: true, reference: { table: 'FW_User', onDelete: 'cascade' } },
    { name: 'menuName', type: 'string', mandatory: true, maxLength: 160 },
    { name: 'itemId', type: 'string', mandatory: true, maxLength: 240 },
    { name: 'favorite', type: 'boolean', default: false },
    { name: 'lastOpenedAt', type: 'datetime' },
  ],
  indexes: [{ name: 'UserMenuItemIdx', fields: ['userId', 'menuName', 'itemId'], unique: true }],
};

/** Content-addressed catalog for record attachments. The opaque storage key is
 * deliberately unrelated to the original filename so clients cannot construct
 * filesystem paths. */
const systemBlob: TableMeta = {
  kind: 'table', name: 'FW_Blob', app: 'system', model: 'Framework', layer: 'SYS',
  fields: [
    { name: 'blobId', type: 'string', mandatory: true, maxLength: 64 },
    { name: 'storageKey', type: 'string', mandatory: true, maxLength: 160 },
    { name: 'originalName', type: 'string', mandatory: true, maxLength: 255 },
    { name: 'mimeType', type: 'string', mandatory: true, maxLength: 160 },
    { name: 'bytes', type: 'int', mandatory: true },
    { name: 'sha256', type: 'string', mandatory: true, maxLength: 64 },
  ],
  indexes: [
    { name: 'BlobIdIdx', fields: ['blobId'], unique: true },
    { name: 'StorageKeyIdx', fields: ['storageKey'], unique: true },
    { name: 'Sha256Idx', fields: ['sha256'] },
  ],
};

const systemAttachment: TableMeta = {
  kind: 'table', name: 'FW_Attachment', app: 'system', model: 'Framework', layer: 'SYS',
  fields: [
    { name: 'attachmentId', type: 'string', mandatory: true, maxLength: 64 },
    { name: 'parentTable', type: 'string', mandatory: true, maxLength: 160 },
    { name: 'parentId', type: 'int', mandatory: true },
    { name: 'kind', type: 'string', mandatory: true, maxLength: 12 },
    { name: 'name', type: 'string', mandatory: true, maxLength: 255 },
    { name: 'blobId', type: 'string', maxLength: 64 },
    { name: 'text', type: 'string' },
    { name: 'url', type: 'string', maxLength: 2048 },
  ],
  indexes: [
    { name: 'AttachmentIdIdx', fields: ['attachmentId'], unique: true },
    { name: 'AttachmentParentIdx', fields: ['parentTable', 'parentId'] },
    { name: 'AttachmentBlobIdx', fields: ['blobId'] },
  ],
};

const systemDataJob: TableMeta = {
  kind: 'table', name: 'FW_DataJob', app: 'system', model: 'Framework', layer: 'SYS',
  fields: [
    { name: 'jobId', type: 'string', mandatory: true, maxLength: 64 },
    { name: 'type', type: 'string', mandatory: true, maxLength: 24 },
    { name: 'entityName', type: 'string', maxLength: 160 },
    { name: 'status', type: 'string', mandatory: true, maxLength: 24 },
    { name: 'requestedBy', type: 'string', mandatory: true, maxLength: 60 },
    { name: 'inputPath', type: 'string', maxLength: 1024 },
    { name: 'resultPath', type: 'string', maxLength: 1024 },
    { name: 'summaryJson', type: 'string' },
    { name: 'error', type: 'string' },
  ],
  indexes: [{ name: 'DataJobIdIdx', fields: ['jobId'], unique: true }, { name: 'DataJobStatusIdx', fields: ['type', 'status'] }],
};

const systemArchivePolicy: TableMeta = {
  kind: 'table', name: 'FW_ArchivePolicy', app: 'system', model: 'Framework', layer: 'SYS',
  fields: [
    { name: 'entityName', type: 'string', mandatory: true, maxLength: 160 },
    { name: 'enabled', type: 'boolean', default: true },
    { name: 'businessDateField', type: 'string', mandatory: true, maxLength: 160 },
    { name: 'ageDays', type: 'int', mandatory: true, default: 365 },
    { name: 'batchSize', type: 'int', mandatory: true, default: 100 },
    { name: 'includeAttachments', type: 'boolean', default: true },
    { name: 'schedule', type: 'string', mandatory: true, default: 'weekly', maxLength: 12 },
    { name: 'weekday', type: 'int', default: 0 },
    { name: 'timezone', type: 'string', mandatory: true, default: 'Asia/Bangkok', maxLength: 80 },
    { name: 'lastRunAt', type: 'datetime', readOnly: true },
  ],
  indexes: [{ name: 'ArchivePolicyEntityIdx', fields: ['entityName'], unique: true }],
};

export function registerSystemApp(kernel: Kernel): void {
  kernel.registerApp({ name: 'system', label: 'System', models: [{ name: 'Framework', label: 'Framework', layer: 'SYS' }] }, [
    systemUser,
    systemSession,
    systemWebArtifact,
    systemMigration,
    systemViewToken,
    systemViewTokenScope,
    systemNavigationItem,
    systemBlob,
    systemAttachment,
    systemDataJob,
    systemArchivePolicy,
  ]);
}

export function registerSystemHooks(kernel: Kernel): void {
  kernel.hooks.register('FW_User', {
    validateWrite(rec) {
      const pw = rec.f.password as string;
      if (pw && pw.length > 0) {
        rec.f.passwordHash = hashPassword(pw);
        rec.f.password = null;
      }
    },
  });
}
