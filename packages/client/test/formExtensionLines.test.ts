import { describe, expect, it } from 'vitest';
import { buildFormExtensionLines, syncFormLineOverrides } from '../src/views/designer/formExtensionLines';
import type { FormExtensionMeta } from '@emu/core';

describe('form extension line editor', () => {
  it('shows inherited and current lines while saving only the delta', () => {
    const extension: FormExtensionMeta = { kind: 'formExtension', name: 'APP_Cus_APP_Form_Extension', form: 'APP_Form', lines: [{ id: 'own', table: 'APP_Line', refField: 'parent', fields: ['name'] }] };
    const state = buildFormExtensionLines([{ editable: false, artifact: { kind: 'form', lines: [{ id: 'base', label: 'Base', table: 'APP_Line', refField: 'parent', fields: ['name', 'amount'] }] } }], extension);
    state.lines[0].label = 'History'; state.lines[0].fields = ['name'];
    syncFormLineOverrides(extension, state.lines, state.baselines);
    expect(extension.lines).toEqual([{ id: 'own', table: 'APP_Line', refField: 'parent', fields: ['name'] }]);
    expect(extension.lineOverrides).toEqual([{ targetId: 'base', label: 'History', fields: ['name'] }]);
  });

  it('removes the override when an inherited line is reset to its baseline', () => {
    const extension: FormExtensionMeta = { kind: 'formExtension', name: 'APP_Cus_APP_Form_Extension', form: 'APP_Form', lineOverrides: [{ targetId: 'base', hidden: true }] };
    const state = buildFormExtensionLines([{ editable: false, artifact: { kind: 'form', lines: [{ id: 'base', table: 'APP_Line', refField: 'parent', fields: ['name'] }] } }], extension);
    state.lines[0].hidden = undefined;
    syncFormLineOverrides(extension, state.lines, state.baselines);
    expect(extension.lineOverrides).toBeUndefined();
  });
});
