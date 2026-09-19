import { describe, expect, it } from 'vitest';
import { setUiMessages, t } from '../src/i18n';

describe('reactive framework ui messages', () => {
  it('falls back to English before metadata loads', () => {
    setUiMessages({}, 'en');
    expect(t('ui.common.save')).toBe('Save');
    expect(t('ui.nav.recent')).toBe('Recent');
    expect(t('ui.nav.recentEmpty')).toBe('No recently opened items');
  });
  it('uses server-resolved messages once loaded and keeps fallbacks for gaps', () => {
    setUiMessages({ 'ui.common.save': 'บันทึก' }, 'th');
    expect(t('ui.common.save')).toBe('บันทึก');
    expect(t('ui.nav.recent')).toBe('Recent');
  });
  it('returns unknown keys verbatim', () => {
    expect(t('ui.unknown.key')).toBe('ui.unknown.key');
  });
});
