import { describe, expect, it } from 'vitest';
import { datetimeMillis, formatDatetime, formatNumber, formatValue, parseNumber } from '../src/utils/formatValue';
describe('business value formatting', () => {
  it('treats legacy timestamps as UTC and handles offsets and DST', () => {
    const utc = datetimeMillis('2026-08-15T15:52:39');
    expect(utc).toBe(datetimeMillis('2026-08-15T15:52:39Z'));
    expect(utc).toBe(datetimeMillis('2026-08-15T22:52:39+07:00'));
    expect(formatDatetime('2026-08-15T15:52:39', 'Asia/Bangkok')).toContain('22:52:39');
    expect(formatDatetime('2026-03-08T06:59:00Z', 'America/New_York')).toContain('01:59:00');
    expect(formatDatetime('2026-03-08T07:01:00Z', 'America/New_York')).toContain('03:01:00');
    expect(formatValue({ name: 'date', type: 'date' }, '2026-08-15')).toBe('2026-08-15');
    expect(datetimeMillis('invalid')).toBeNull();
  });
  it('groups numbers without changing values or formatting IDs and strings', () => {
    for (const value of [0, -1234567.89123, 1000000000000, 0.00000012345]) expect(parseNumber(formatNumber(value))).toBe(value);
    expect(formatNumber(25600)).toBe('25,600');
    expect(formatValue({ name: 'id', type: 'int' }, 10001)).toBe('10001');
    expect(formatValue({ name: 'code', type: 'string' }, '0001234')).toBe('0001234');
    expect(formatValue({ name: 'parent', type: 'reference' }, 10001)).toBe('10001');
    expect(parseNumber('')).toBeNull(); expect(parseNumber('12wrong')).toBeNull();
  });
});
