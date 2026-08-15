import { defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { NConfigProvider, NDialogProvider, NMessageProvider } from 'naive-ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ListPage from '../src/views/ListPage.vue';
import { api } from '../src/api';
import { useMeta, type Metadata } from '../src/stores/meta';

describe('ListPage responsive pagination', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('uses one table on mobile and can load records 26–34', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    useMeta().meta = {
      branding: { title: 'Test' }, capabilities: { designer: false, maintenance: false, tableBrowser: false },
      tables: [{ kind: 'table', name: 'TEST_Item', fields: [{ name: 'name', type: 'string', label: 'Name' }] }],
      enums: [], forms: [{ kind: 'form', name: 'TEST_ItemForm', table: 'TEST_Item', listFields: ['name'] }], reports: [],
      privileges: [], duties: [], roles: [], actions: [], frameworkMenus: [], apps: [],
    } as Metadata;
    const first = Array.from({ length: 25 }, (_, index) => ({ id: index + 1, name: `Item ${index + 1}` }));
    const second = Array.from({ length: 9 }, (_, index) => ({ id: index + 26, name: `Item ${index + 26}` }));
    const list = vi.spyOn(api, 'list').mockResolvedValueOnce({ data: first, total: 34 }).mockResolvedValueOnce({ data: second, total: 34 });
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] });
    const Host = defineComponent({
      components: { ListPage, NConfigProvider, NDialogProvider, NMessageProvider },
      template: '<n-config-provider><n-dialog-provider><n-message-provider><ListPage form-name="TEST_ItemForm" /></n-message-provider></n-dialog-provider></n-config-provider>',
    });
    const wrapper = mount(Host, {
      global: {
        plugins: [pinia, router],
        stubs: {
          BusinessDataTable: { props: ['data', 'pagination'], template: '<div class="business-table-stub"><span class="count">{{ data.length }}</span><button data-testid="next" @click="pagination[\'onUpdate:page\'](2)">Next</button></div>' },
          ImportDialog: true, ActionDialog: true,
        },
      },
    });
    await flushPromises();
    expect(wrapper.find('.mobile-cards').exists()).toBe(false);
    expect(wrapper.get('.list-table .count').text()).toBe('25');
    await wrapper.get('[data-testid="next"]').trigger('click');
    await flushPromises();
    expect(list).toHaveBeenLastCalledWith('TEST_Item', expect.objectContaining({ limit: 25, offset: 25 }));
    expect(wrapper.get('.list-table .count').text()).toBe('9');
  });
});
