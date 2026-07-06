import type { MetadataRegistry } from '../metadata/registry.js';

export type CrudOp = 'read' | 'create' | 'update' | 'delete';

export class SecurityError extends Error {
  readonly statusCode = 403;
}

/** Decides table access for one session. Enforced inside the data kernel. */
export interface SecurityPolicy {
  can(table: string, op: CrudOp): boolean;
  /** forms this session may open (drives menu/metadata filtering) */
  accessibleForms(): Set<string> | 'all';
}

export const allowAll: SecurityPolicy = {
  can: () => true,
  accessibleForms: () => 'all',
};

/**
 * Resolves Role → Duty → Privilege into a flat permission set.
 * Unknown role names are ignored (a user may carry roles from an app that is
 * not loaded in this installation).
 */
export function buildRolePolicy(registry: MetadataRegistry, roleNames: string[]): SecurityPolicy {
  const tablePerms = new Map<string, Set<CrudOp>>();
  const forms = new Set<string>();

  const applyPrivilege = (privName: string) => {
    const priv = registry.getPrivilege(privName);
    if (!priv) return;
    for (const perm of priv.tablePermissions ?? []) {
      const ops = tablePerms.get(perm.table) ?? new Set<CrudOp>();
      if (perm.read) ops.add('read');
      if (perm.create) ops.add('create');
      if (perm.update) ops.add('update');
      if (perm.delete) ops.add('delete');
      tablePerms.set(perm.table, ops);
    }
    for (const form of priv.forms ?? []) forms.add(form);
  };

  for (const roleName of roleNames) {
    const role = registry.getRole(roleName);
    if (!role) continue;
    for (const dutyName of role.duties ?? []) {
      const duty = registry.getDuty(dutyName);
      for (const priv of duty?.privileges ?? []) applyPrivilege(priv);
    }
    for (const priv of role.privileges ?? []) applyPrivilege(priv);
  }

  return {
    can: (table, op) => tablePerms.get(table)?.has(op) ?? false,
    accessibleForms: () => forms,
  };
}
