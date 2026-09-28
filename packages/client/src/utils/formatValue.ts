import type { FieldMeta } from '@emu/core';

/** Offset-less legacy datetimes were stored as UTC, never as browser-local time. */
export function datetimeMillis(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  let text = value.trim().replace(' ', 'T');
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(text)) text += 'Z';
  const millis = Date.parse(text);
  return Number.isFinite(millis) ? millis : null;
}
export function formatDatetime(value: unknown, timeZone?: string): string {
  const millis = datetimeMillis(value);
  return millis === null ? String(value ?? '') : new Intl.DateTimeFormat('en-GB', {
    calendar: 'gregory', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone,
  }).format(millis);
}
export function formatNumber(value: number | null): string {
  return value === null ? '' : new Intl.NumberFormat('en-US', { maximumSignificantDigits: 21 }).format(value);
}
export function parseNumber(value: string): number | null {
  const text = value.replaceAll(',', '').trim();
  if (!text) return null;
  return /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(text) && Number.isFinite(Number(text)) ? Number(text) : null;
}
export function formatValue(field: Pick<FieldMeta, 'name' | 'type'>, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (field.type === 'datetime') return formatDatetime(value);
  if ((field.type === 'int' || field.type === 'real') && field.name !== 'id' && typeof value === 'number') return formatNumber(value);
  if (field.type === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}
