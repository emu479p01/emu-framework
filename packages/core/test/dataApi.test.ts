import { describe, it, expect } from 'vitest';
import { DataEventCancelled, ValidationError } from '../src/index.js';
import { testContext } from './helpers.js';

describe('DataContext CRUD', () => {
  it('searches safely across selected metadata fields', () => {
    const { ctx } = testContext();
    ctx.newRecord('TESTAPP_CustTable').setMany({ accountNum: 'C001', name: 'Northwind', creditMax: 100 }).insert();
    ctx.newRecord('TESTAPP_CustTable').setMany({ accountNum: 'C002', name: 'Contoso', creditMax: 200 }).insert();
    const rows = ctx.select('TESTAPP_CustTable').search(['accountNum', 'name'], 'wind').toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].f.name).toBe('Northwind');
  });

  it('inserts with system columns and reads back', () => {
    const { ctx } = testContext();
    const cust = ctx.newRecord('TESTAPP_CustTable');
    cust.f.accountNum = 'C001';
    cust.f.name = 'Contoso';
    cust.insert();

    expect(cust.id).toBe(1);
    expect(cust.get('createdBy')).toBe('tester');

    const found = ctx.select('TESTAPP_CustTable').where('accountNum', '=', 'C001').firstOnly();
    expect(found?.f.name).toBe('Contoso');
    expect(found?.f.creditMax).toBe(0); // default applied
  });

  it('enforces mandatory fields', () => {
    const { ctx } = testContext();
    const cust = ctx.newRecord('TESTAPP_CustTable').set('accountNum', 'C002');
    expect(() => cust.insert()).toThrow(/name is mandatory/);
  });

  it('rejects unknown fields at runtime', () => {
    const { ctx } = testContext();
    const cust = ctx.newRecord('TESTAPP_CustTable');
    expect(() => cust.set('nope', 1)).toThrow(ValidationError);
  });

  it('updates and deletes', () => {
    const { ctx } = testContext();
    const cust = ctx.newRecord('TESTAPP_CustTable').setMany({ accountNum: 'C001', name: 'Old' });
    cust.insert();

    cust.f.name = 'New';
    cust.update();
    expect(ctx.find('TESTAPP_CustTable', cust.id!)?.f.name).toBe('New');

    cust.delete();
    expect(ctx.select('TESTAPP_CustTable').count()).toBe(0);
  });

  it('supports iteration, ordering, whereEq and count', () => {
    const { ctx } = testContext();
    for (const [num, name] of [['C2', 'Beta'], ['C1', 'Alpha'], ['C3', 'Gamma']]) {
      ctx.newRecord('TESTAPP_CustTable').setMany({ accountNum: num, name }).insert();
    }
    const names: string[] = [];
    for (const rec of ctx.select('TESTAPP_CustTable').orderBy('accountNum')) {
      names.push(rec.f.name as string);
    }
    expect(names).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(ctx.select('TESTAPP_CustTable').whereEq({ accountNum: 'C2' }).firstOnly()?.f.name).toBe('Beta');
    expect(ctx.select('TESTAPP_CustTable').where('accountNum', 'IN', ['C1', 'C3']).count()).toBe(2);
  });
});

describe('table hooks', () => {
  it('initValue runs on newRecord', () => {
    const { ctx } = testContext();
    ctx.hooks.register('TESTAPP_CustTable', {
      initValue(rec) {
        rec.f.creditMax = 5000;
      },
    });
    expect(ctx.newRecord('TESTAPP_CustTable').f.creditMax).toBe(5000);
  });

  it('validateWrite=false blocks insert and update', () => {
    const { ctx } = testContext();
    ctx.hooks.register('TESTAPP_CustTable', {
      validateWrite(rec) {
        return (rec.f.creditMax as number) >= 0;
      },
    });
    const cust = ctx.newRecord('TESTAPP_CustTable').setMany({ accountNum: 'C1', name: 'X', creditMax: -1 });
    expect(() => cust.insert()).toThrow(/validateWrite failed/);
    cust.f.creditMax = 10;
    cust.insert();
  });

  it('validateDelete=false blocks delete', () => {
    const { ctx } = testContext();
    ctx.hooks.register('TESTAPP_CustTable', { validateDelete: () => false });
    const cust = ctx.newRecord('TESTAPP_CustTable').setMany({ accountNum: 'C1', name: 'X' });
    cust.insert();
    expect(() => cust.delete()).toThrow(/validateDelete failed/);
  });
});

describe('data events', () => {
  it('fires pre and post events in order', () => {
    const { ctx } = testContext();
    const log: string[] = [];
    for (const ev of ['onValidating', 'onInserting', 'onInserted'] as const) {
      ctx.events.on('TESTAPP_CustTable', ev, () => log.push(ev));
    }
    ctx.newRecord('TESTAPP_CustTable').setMany({ accountNum: 'C1', name: 'X' }).insert();
    expect(log).toEqual(['onValidating', 'onInserting', 'onInserted']);
  });

  it('pre-event cancel aborts the write', () => {
    const { ctx } = testContext();
    ctx.events.on('TESTAPP_CustTable', 'onInserting', (e) => {
      if (e.record.f.accountNum === 'BLOCKED') e.cancel('blocked account');
    });
    const ok = ctx.newRecord('TESTAPP_CustTable').setMany({ accountNum: 'C1', name: 'X' });
    ok.insert();
    const blocked = ctx.newRecord('TESTAPP_CustTable').setMany({ accountNum: 'BLOCKED', name: 'X' });
    expect(() => blocked.insert()).toThrow(DataEventCancelled);
    expect(ctx.select('TESTAPP_CustTable').count()).toBe(1);
  });

  it('handlers can modify the record before write (extension use case)', () => {
    const { ctx } = testContext();
    ctx.events.on('TESTAPP_SalesTable', 'onInserting', (e) => {
      e.record.f.totalAmount = 999;
    });
    const so = ctx.newRecord('TESTAPP_SalesTable').set('salesId', 'SO-1');
    so.insert();
    expect(ctx.find('TESTAPP_SalesTable', so.id!)?.f.totalAmount).toBe(999);
  });
});

describe('tts transactions', () => {
  it('commits on success', () => {
    const { ctx } = testContext();
    ctx.tts(() => {
      ctx.newRecord('TESTAPP_CustTable').setMany({ accountNum: 'C1', name: 'X' }).insert();
      ctx.newRecord('TESTAPP_CustTable').setMany({ accountNum: 'C2', name: 'Y' }).insert();
    });
    expect(ctx.select('TESTAPP_CustTable').count()).toBe(2);
  });

  it('rolls back everything on throw', () => {
    const { ctx } = testContext();
    expect(() =>
      ctx.tts(() => {
        ctx.newRecord('TESTAPP_CustTable').setMany({ accountNum: 'C1', name: 'X' }).insert();
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(ctx.select('TESTAPP_CustTable').count()).toBe(0);
  });

  it('supports nested tts with partial rollback via savepoints', () => {
    const { ctx } = testContext();
    ctx.tts(() => {
      ctx.newRecord('TESTAPP_CustTable').setMany({ accountNum: 'C1', name: 'X' }).insert();
      try {
        ctx.tts(() => {
          ctx.newRecord('TESTAPP_CustTable').setMany({ accountNum: 'C2', name: 'Y' }).insert();
          throw new Error('inner boom');
        });
      } catch {
        // inner rolled back, outer continues
      }
    });
    expect(ctx.select('TESTAPP_CustTable').count()).toBe(1);
    expect(ctx.select('TESTAPP_CustTable').firstOnly()?.f.accountNum).toBe('C1');
  });
});
