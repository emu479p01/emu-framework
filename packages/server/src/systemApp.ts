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
    { name: 'json', type: 'string', mandatory: true },
  ],
  indexes: [{ name: 'NameIdx', fields: ['name'], unique: true }],
};

export function registerSystemApp(kernel: Kernel): void {
  kernel.registerApp({ name: 'system', label: 'System', models: [{ name: 'Framework', label: 'Framework', layer: 'SYS' }] }, [
    systemUser,
    systemSession,
    systemWebArtifact,
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
