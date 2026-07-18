import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AnyMeta, Kernel } from '@emu/core';
import { buildServer } from '../src/server.js';
import { hashPassword } from '../src/auth.js';
import { applyErpSample } from './fixtures/erpSample.js';
import { completeTestSetup, TEST_ADMIN_PASSWORD, TEST_SETUP_CODE } from './setupHelper.js';

describe('declarative Views and service tokens', () => {
  let app: FastifyInstance;
  let kernel: Kernel;
  let admin: { cookie: string };
  let analyst: { cookie: string };

  const login = async (username: string, password: string) => {
    const result = await app.inject({ method: 'POST', url: '/api/login', payload: { username, password } });
    expect(result.statusCode).toBe(200);
    return { cookie: String(result.headers['set-cookie']).split(';')[0]! };
  };

  beforeAll(async () => {
    app = buildServer({ setupCode: TEST_SETUP_CODE, viewCsvMaxRows: 10 });
    await app.ready();
    await completeTestSetup(app);
    kernel = (app as unknown as { kernel: Kernel }).kernel;
    applyErpSample(kernel);
    const fw = kernel.designerContext().select('FW_WebArtifact').toArray().map((row) => JSON.parse(String(row.f.json)) as AnyMeta);
    const analytics: AnyMeta[] = [
      {
        kind: 'view', name: 'ERP_CustomerSalesView', app: 'erp', model: 'MiniERPApplication', layer: 'SYS', label: 'Customer sales',
        source: { table: 'ERP_CustTable', alias: 'c' },
        joins: [{ type: 'left', table: 'ERP_SalesTable', alias: 's', on: [{ left: 'c.id', right: 's.custId' }] }],
        parameters: [{ name: 'minimum', type: 'real' }],
        filters: [{ ref: 's.totalAmount', operator: 'gte', value: { parameter: 'minimum' } }],
        columns: [
          { name: 'customerId', expression: { type: 'field', ref: 'c.id' } },
          { name: 'customer', expression: { type: 'field', ref: 'c.name' } },
          { name: 'orders', expression: { type: 'aggregate', fn: 'count', ref: 's.id' } },
          { name: 'total', expression: { type: 'aggregate', fn: 'sum', ref: 's.totalAmount' } },
        ],
        groupBy: ['c.id', 'c.name'], orderBy: [{ column: 'total', direction: 'desc' }],
      },
      { kind: 'chart', name: 'ERP_CustomerSalesChart', app: 'erp', model: 'MiniERPApplication', layer: 'SYS', type: 'bar', view: 'ERP_CustomerSalesView', dimension: 'customer', measures: [{ field: 'total', label: 'Sales' }], legend: true },
      { kind: 'privilege', name: 'ERP_AnalyticsPrivilege', app: 'erp', model: 'MiniERPApplication', layer: 'SYS', tablePermissions: [{ table: 'ERP_CustTable', read: true }, { table: 'ERP_SalesTable', read: true }], views: ['ERP_CustomerSalesView'] },
      { kind: 'duty', name: 'ERP_AnalyticsDuty', app: 'erp', model: 'MiniERPApplication', layer: 'SYS', privileges: ['ERP_AnalyticsPrivilege'] },
      { kind: 'role', name: 'ERP_Analyst', app: 'erp', model: 'MiniERPApplication', layer: 'SYS', duties: ['ERP_AnalyticsDuty'] },
    ];
    expect(kernel.applyWebArtifacts([...fw, ...analytics])).toEqual([]);
    kernel.sync();
    const ctx = kernel.context();
    const analystUser = ctx.newRecord('FW_User').setMany({ username: 'analyst', passwordHash: hashPassword('Analyst-password-123'), enabled: true });
    analystUser.insert();
    ctx.newRecord('FW_UserRole').setMany({ userId: analystUser.id, username: 'analyst', role: 'ERP_Analyst' }).insert();
    ctx.newRecord('FW_AppAccess').setMany({ userId: analystUser.id, appName: 'erp', canOpen: true, canCustomize: false }).insert();
    const customer = ctx.newRecord('ERP_CustTable').setMany({ accountNum: 'C100', name: 'Acme' });
    customer.insert();
    ctx.newRecord('ERP_SalesTable').setMany({ salesId: 'SO100', custId: customer.id, totalAmount: 125 }).insert();
    admin = await login('admin', TEST_ADMIN_PASSWORD);
    analyst = await login('analyst', 'Analyst-password-123');
  });

  it('executes joins, aggregates, typed parameters and paging with bound values', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/views/ERP_CustomerSalesView/data?param.minimum=100&limit=1', headers: analyst });
    expect(response.statusCode).toBe(200);
    expect(response.json().data[0]).toMatchObject({ customer: 'Acme', orders: 1, total: 125 });
    const injection = await app.inject({ method: 'GET', url: '/api/views/ERP_CustomerSalesView/data?param.minimum=0%20OR%201=1', headers: analyst });
    expect(injection.statusCode).toBe(422);
    const chart = await app.inject({ method: 'GET', url: '/api/charts/ERP_CustomerSalesChart', headers: analyst });
    expect(chart.statusCode).toBe(200);
  });

  it('denies role-only and app-only interactive callers', async () => {
    const ctx = kernel.context();
    const roleOnly = ctx.newRecord('FW_User').setMany({ username: 'roleonly', passwordHash: hashPassword('Role-only-password-1'), enabled: true }); roleOnly.insert();
    ctx.newRecord('FW_UserRole').setMany({ userId: roleOnly.id, role: 'ERP_Analyst' }).insert();
    const appOnly = ctx.newRecord('FW_User').setMany({ username: 'apponly', passwordHash: hashPassword('App-only-password-1'), enabled: true }); appOnly.insert();
    ctx.newRecord('FW_AppAccess').setMany({ userId: appOnly.id, appName: 'erp', canOpen: true }).insert();
    for (const credentials of [['roleonly', 'Role-only-password-1'], ['apponly', 'App-only-password-1']] as const) {
      const auth = await login(credentials[0], credentials[1]);
      const response = await app.inject({ method: 'GET', url: '/api/views/ERP_CustomerSalesView/data', headers: auth });
      expect(response.statusCode).toBe(403);
      const chart = await app.inject({ method: 'GET', url: '/api/charts/ERP_CustomerSalesChart', headers: auth });
      expect(chart.statusCode).toBe(403);
    }
  });

  it('exports CSV and limits service tokens to their View scope', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/system/view-tokens', headers: admin, payload: { name: 'Power BI', views: ['ERP_CustomerSalesView'] } });
    expect(created.statusCode).toBe(201);
    const secret = created.json().token as string;
    expect(secret).toMatch(/^emu_view_/);
    const bearer = { authorization: `Bearer ${secret}` };
    const csv = await app.inject({ method: 'GET', url: '/api/views/ERP_CustomerSalesView/export?format=csv', headers: bearer });
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain('customer');
    const dataApi = await app.inject({ method: 'GET', url: '/api/data/ERP_CustTable', headers: bearer });
    expect(dataApi.statusCode).toBe(401);
    const chartApi = await app.inject({ method: 'GET', url: '/api/charts/ERP_CustomerSalesChart', headers: bearer });
    expect(chartApi.statusCode).toBe(401);
    const listed = await app.inject({ method: 'GET', url: '/api/system/view-tokens', headers: admin });
    expect(JSON.stringify(listed.json())).not.toContain('tokenHash');
    expect(JSON.stringify(listed.json())).not.toContain(secret);
    const revoked = await app.inject({ method: 'POST', url: `/api/system/view-tokens/${created.json().id}/revoke`, headers: admin });
    expect(revoked.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: '/api/views/ERP_CustomerSalesView/data', headers: bearer });
    expect(after.statusCode).toBe(401);
  });
});
