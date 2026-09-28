import { describe, expect, it } from 'vitest';
import { testContext } from './helpers.js';
import { SYSTEM_FIELD_ALIASES, syncSchema } from '../src/index.js';

describe('audit aliases and synchronous lifecycle', () => {
  it('queries aliases against the original columns and protects audit history', () => {
    const { ctx, db } = testContext();
    const row = ctx.newRecord('TESTAPP_CustTable').setMany({ accountNum: 'A1', name: 'Before', sys_createdBy: 'forged' }).insert();
    expect(row.get('sys_createdBy')).toBe('tester');
    const createdAt = row.get('createdAt');
    row.setMany({ sys_createdAt: 'forged', createdBy: 'forged', name: 'After' }).update();
    expect(row.get('sys_createdAt')).toBe(createdAt); expect(row.get('createdBy')).toBe('tester');
    expect(ctx.select('TESTAPP_CustTable').where('sys_createdBy', '=', 'tester').orderBy('sys_modifiedAt').count()).toBe(1);
    for (const [alias, column] of Object.entries(SYSTEM_FIELD_ALIASES)) expect(row.toObject()[alias]).toBe(row.toObject()[column]);
    const columns = db.prepare('PRAGMA table_info("TESTAPP_CustTable")').all() as { name: string }[];
    expect(columns.some(column => column.name.startsWith('sys_'))).toBe(false);
    db.close();
  });
  it('rejects async hooks and event handlers before executing them', () => {
    const { ctx, db } = testContext(); let called = false;
    expect(() => ctx.hooks.register('TESTAPP_CustTable', { async initValue() { called = true; } })).toThrow(/async lifecycle/);
    expect(() => ctx.events.on('TESTAPP_CustTable', 'onInserted', async () => { called = true; })).toThrow(/async lifecycle/);
    expect(called).toBe(false); db.close();
  });
  it('rolls back events in order and rejects promise-returning validators', () => {
    const { ctx, db } = testContext(); const order: string[] = [];
    ctx.hooks.register('TESTAPP_CustTable', { initValue: () => { order.push('init'); }, validateWrite: () => { order.push('validate'); } });
    ctx.events.on('TESTAPP_CustTable', 'onInserting', () => { order.push('insert'); });
    ctx.events.on('TESTAPP_CustTable', 'onInserted', () => { order.push('inserted'); throw new Error('post failed'); });
    expect(() => ctx.tts(() => ctx.newRecord('TESTAPP_CustTable').setMany({ accountNum: 'A1', name: 'Test' }).insert())).toThrow('post failed');
    expect(order).toEqual(['init', 'validate', 'insert', 'inserted']); expect(ctx.select('TESTAPP_CustTable').count()).toBe(0);
    ctx.hooks.register('TESTAPP_CustTable', { validateWrite: (() => Promise.resolve(false)) as never });
    expect(() => ctx.newRecord('TESTAPP_CustTable').setMany({ accountNum: 'A2', name: 'Test' }).insert()).toThrow(/async lifecycle/);
    db.close();
  });
  it('preflights alias collisions without modifying existing data', () => {
    const { ctx, db } = testContext();
    db.exec('ALTER TABLE TESTAPP_CustTable ADD COLUMN sys_createdBy TEXT');
    expect(() => syncSchema(db, ctx.registry)).toThrow(/reserved audit aliases collide/);
    db.close();
  });
});
