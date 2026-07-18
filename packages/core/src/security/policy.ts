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
  canFunction(name: string): boolean;
  canReport(name: string): boolean;
  canView(name: string): boolean;
  /** Chart permission is inherited from its View privilege. */
  canChart(name: string): boolean;
  canPrivilege(name: string): boolean;
  rowScope?(table: string): { field: string; value: string } | undefined;
}

export const allowAll: SecurityPolicy = {
  can: () => true,
  accessibleForms: () => 'all',
  canFunction: () => true,
  canReport: () => true,
  canView: () => true,
  canChart: () => true,
  canPrivilege: () => true,
};

/**
 * Resolves Role → Duty → Privilege into a flat permission set.
 * Unknown role names are ignored (a user may carry roles from an app that is
 * not loaded in this installation).
 */
export function buildRolePolicy(registry: MetadataRegistry, roleNames: string[]): SecurityPolicy {
  const tablePerms = new Map<string, Set<CrudOp>>();
  const forms = new Set<string>();
  const functions = new Set<string>();
  const reports = new Set<string>();
  const views = new Set<string>();
  const privileges = new Set<string>();

  const applyPrivilege = (privName: string) => {
    const priv = registry.getPrivilege(privName);
    if (!priv) return;
    privileges.add(privName);
    for (const perm of priv.tablePermissions ?? []) {
      const ops = tablePerms.get(perm.table) ?? new Set<CrudOp>();
      if (perm.read) ops.add('read');
      if (perm.create) ops.add('create');
      if (perm.update) ops.add('update');
      if (perm.delete) ops.add('delete');
      tablePerms.set(perm.table, ops);
    }
    for (const form of priv.forms ?? []) forms.add(form);
    for (const name of priv.functions ?? []) functions.add(name);
    for (const name of priv.reports ?? []) reports.add(name);
    for (const name of priv.views ?? []) views.add(name);
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
    canFunction: (name) => functions.has(name),
    canReport: (name) => reports.has(name),
    canView: (name) => views.has(name),
    canChart: (name) => registry.hasChart(name) && views.has(registry.getChart(name).view),
    canPrivilege: (name) => privileges.has(name),
  };
}
