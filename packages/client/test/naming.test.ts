import { describe, it, expect } from 'vitest';
import { appPrefix, deriveExtensionName, EXT_TARGET_FIELD } from '../src/views/designer/naming';

describe('appPrefix', () => {
  it('maps known apps and uppercases the rest', () => {
    expect(appPrefix('system')).toBe('FW');
    expect(appPrefix('erp')).toBe('ERP');
    expect(appPrefix('erp.credit')).toBe('ERP');
    expect(appPrefix('abc')).toBe('ABC');
    expect(appPrefix('my-app')).toBe('MYAPP');
  });
});

describe('deriveExtensionName', () => {
  it('prefixes cross-app targets with the extending app prefix', () => {
    expect(deriveExtensionName('abc', 'ERP_CustTable')).toBe('ABC_ERP_CustTable_Extension');
    expect(deriveExtensionName('abc', 'FW_UserForm')).toBe('ABC_FW_UserForm_Extension');
  });

  it('does not repeat the prefix when extending an object of the same app', () => {
    expect(deriveExtensionName('erp', 'ERP_CustTable')).toBe('ERP_CustTable_Extension');
  });

  it('returns empty until a target is chosen', () => {
    expect(deriveExtensionName('abc', '')).toBe('');
  });
});

describe('EXT_TARGET_FIELD', () => {
  it('covers all extension kinds', () => {
    expect(Object.keys(EXT_TARGET_FIELD).sort()).toEqual([
      'dutyExtension', 'enumExtension', 'formExtension', 'menuExtension',
      'privilegeExtension', 'roleExtension', 'scriptExtension', 'tableExtension',
    ]);
  });
});
