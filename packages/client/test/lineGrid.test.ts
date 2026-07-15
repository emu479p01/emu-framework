import { defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { NConfigProvider, NMessageProvider } from 'naive-ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LineGrid from '../src/components/LineGrid.vue';
import { api } from '../src/api';
import { useMeta, type Metadata } from '../src/stores/meta';

const line = { table: 'TEST_Line', refField: 'headerId', fields: ['headerId', 'item', 'quantity'] };
const rows = [{ id: 7, headerId: 1, item: 'โฟมล้างหน้า', quantity: 2 }];

function button(wrapper: ReturnType<typeof mount>, label: string) {
  const found = wrapper.findAll('button').find((entry) => entry.text().trim() === label);
  if (!found) throw new Error(`Button '${label}' was not rendered`);
  return found;
}

describe('LineGrid responsive cards', () => {
  let pinia: ReturnType<typeof createPinia>;
  beforeEach(() => {
    vi.restoreAllMocks();
    pinia = createPinia();
    setActivePinia(pinia);
    useMeta().meta = {
      branding: { title: 'Test' }, capabilities: { designer: false, maintenance: false, tableBrowser: false },
      tables: [{ kind: 'table', name: 'TEST_Line', label: 'Lines', fields: [
        { name: 'headerId', type: 'int' }, { name: 'item', label: 'Item', type: 'string' }, { name: 'quantity', label: 'Quantity', type: 'real' },
      ] }], enums: [], forms: [], reports: [], privileges: [], duties: [], roles: [], actions: [], frameworkMenus: [], apps: [],
    } as Metadata;
  });

  it('renders readable mobile cards and keeps edit/create/delete actions available', async () => {
    vi.spyOn(api, 'list').mockResolvedValue({ data: rows, total: 1 });
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({});
    const post = vi.spyOn(api, 'post').mockResolvedValue({});
    const remove = vi.spyOn(api, 'delete').mockResolvedValue({});
    const Host = defineComponent({
      components: { LineGrid, NConfigProvider, NMessageProvider },
      setup: () => ({ line }),
      template: '<n-config-provider><n-message-provider><LineGrid :line="line" :header-id="1" /></n-message-provider></n-config-provider>',
    });
    const wrapper = mount(Host, {
      global: {
        plugins: [pinia],
        stubs: {
          FieldControl: { props: ['modelValue'], template: '<div class="field-control-stub">{{ modelValue }}</div>' },
          ActionDialog: true,
        },
      },
    });
    await flushPromises();

    expect(wrapper.get('.line-mobile-card').text()).toContain('โฟมล้างหน้า');
    expect(wrapper.get('.line-mobile-card').text()).toContain('Quantity');

    await button(wrapper, 'Edit').trigger('click');
    expect(button(wrapper, 'Save').exists()).toBe(true);
    expect(button(wrapper, 'Cancel').exists()).toBe(true);
    await button(wrapper, 'Save').trigger('click');
    await flushPromises();
    expect(patch).toHaveBeenCalledWith('/api/data/TEST_Line/7', expect.objectContaining({ item: 'โฟมล้างหน้า' }));

    await wrapper.get('[data-testid="add-line"]').trigger('click');
    await button(wrapper, 'Save').trigger('click');
    await flushPromises();
    expect(post).toHaveBeenCalledWith('/api/data/TEST_Line', expect.objectContaining({ headerId: 1 }));

    await button(wrapper, 'Delete').trigger('click');
    await flushPromises();
    expect(remove).toHaveBeenCalledWith('/api/data/TEST_Line/7');
  });
});
