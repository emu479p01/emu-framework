import { describe, it, expect } from 'vitest';
import {
  Kernel,
  buildRolePolicy,
  SecurityError,
  type PrivilegeMeta,
  type DutyMeta,
  type RoleMeta,
} from '../src/index.js';
import { TESTAPP_CustTable, salesStatusEnum, TESTAPP_SalesTable, testManifest } from './helpers.js';

const TESTAPP_CustView: PrivilegeMeta = {
  kind: 'privilege',
  name: 'TESTAPP_CustView',
  tablePermissions: [{ table: 'TESTAPP_CustTable', read: true }],
};
const TESTAPP_CustMaintain: PrivilegeMeta = {
  kind: 'privilege',
  name: 'TESTAPP_CustMaintain',
  tablePermissions: [{ table: 'TESTAPP_CustTable', read: true, create: true, update: true, delete: true }],
};
const custDuty: DutyMeta = { kind: 'duty', name: 'TESTAPP_CustMaintenance', privileges: ['TESTAPP_CustMaintain'] };
const clerkRole: RoleMeta = { kind: 'role', name: 'TESTAPP_Clerk', privileges: ['TESTAPP_CustView'] };
const managerRole: RoleMeta = { kind: 'role', name: 'TESTAPP_Manager', duties: ['TESTAPP_CustMaintenance'] };

function securedKernel(): Kernel {
  const kernel = new Kernel();
  kernel.registerApp(testManifest('testapp'), [
    salesStatusEnum,
    TESTAPP_CustTable,
    TESTAPP_SalesTable,
    TESTAPP_CustView,
    TESTAPP_CustMaintain,
    custDuty,
    clerkRole,
    managerRole,
  ]);
  kernel.sync();
  return kernel;
}

describe('security policy', () => {
  it('read-only role can select but not write', () => {
    const kernel = securedKernel();
    kernel.context().newRecord('TESTAPP_CustTable').setMany({ accountNum: 'C1', name: 'X' }).insert();

    const TESTAPP_Clerk = kernel.context({ user: 'TESTAPP_Clerk' }, buildRolePolicy(kernel.registry, ['TESTAPP_Clerk']));
    expect(TESTAPP_Clerk.select('TESTAPP_CustTable').count()).toBe(1);
    expect(() =>
      TESTAPP_Clerk.newRecord('TESTAPP_CustTable').setMany({ accountNum: 'C2', name: 'Y' }).insert(),
    ).toThrow(SecurityError);
    expect(() => TESTAPP_Clerk.select('TESTAPP_CustTable').firstOnly()!.delete()).toThrow(SecurityError);
  });

  it('role via duty gets full CRUD', () => {
    const kernel = securedKernel();
    const mgr = kernel.context({ user: 'mgr' }, buildRolePolicy(kernel.registry, ['TESTAPP_Manager']));
    const rec = mgr.newRecord('TESTAPP_CustTable').setMany({ accountNum: 'C1', name: 'X' }).insert();
    rec.f.name = 'Y';
    rec.update();
    rec.delete();
  });

  it('denies unlisted tables entirely', () => {
    const kernel = securedKernel();
    const TESTAPP_Clerk = kernel.context({ user: 'TESTAPP_Clerk' }, buildRolePolicy(kernel.registry, ['TESTAPP_Clerk']));
    expect(() => TESTAPP_Clerk.select('TESTAPP_SalesTable').toArray()).toThrow(SecurityError);
    expect(() => TESTAPP_Clerk.select('TESTAPP_SalesTable').count()).toThrow(SecurityError);
  });

  it('ignores unknown roles and denies by default', () => {
    const kernel = securedKernel();
    const nobody = kernel.context({ user: 'x' }, buildRolePolicy(kernel.registry, ['Ghost']));
    expect(() => nobody.select('TESTAPP_CustTable').toArray()).toThrow(SecurityError);
  });

  it('validates security metadata references', () => {
    const kernel = new Kernel();
    expect(() =>
      kernel.registerApp(testManifest('bad'), [
        { kind: 'role', name: 'BAD_R', duties: ['Nope'] } as RoleMeta,
      ]),
    ).toThrow(/unknown duty/);
  });
});
