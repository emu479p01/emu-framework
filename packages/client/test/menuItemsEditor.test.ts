import { mount } from '@vue/test-utils';
import { NConfigProvider } from 'naive-ui';
import { defineComponent } from 'vue';
import { describe, expect, it } from 'vitest';
import MenuItemsEditor, { type EditableMenuItem } from '../src/views/designer/MenuItemsEditor.vue';

describe('MenuItemsEditor', () => {
  it('hides Stable IDs and distinguishes inherited actions in a deeply nested tree', () => {
    let leaf: EditableMenuItem = { id: 'leaf-secret-id', label: 'Level 6', target: { type: 'group' }, __inherited: true, __originLayer: 'SYS' };
    for (let depth = 5; depth >= 1; depth -= 1) {
      leaf = { id: `level-${depth}`, label: `Level ${depth}`, target: { type: 'group' }, items: [leaf], __inherited: true, __originLayer: 'SYS' };
    }
    const items: EditableMenuItem[] = [leaf, { id: 'current-secret-id', label: 'Current item', target: { type: 'group' }, __inherited: false, __originLayer: 'CUS' }];
    const Host = defineComponent({
      components: { NConfigProvider, MenuItemsEditor },
      setup: () => ({ items }),
      template: '<n-config-provider><MenuItemsEditor :items="items" :form-options="[]" :report-options="[]" :function-options="[]" extension-mode /></n-config-provider>',
    });
    const wrapper = mount(Host);
    expect(wrapper.text()).not.toContain('Stable ID');
    expect(wrapper.text()).not.toContain('secret-id');
    expect(wrapper.text()).toContain('SYS · inherited');
    expect(wrapper.text()).toContain('CUS · current');
    expect(wrapper.text()).toContain('Reset override');
    expect(wrapper.text()).toContain('Show in Menu');
    expect(wrapper.findAll('.menu-level')).toHaveLength(6);
  });
});
