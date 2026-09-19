import { describe, expect, it } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import TranslationEditor from '../src/views/designer/TranslationEditor.vue';
import { useDesigner, type Artifact } from '../src/stores/designer';
import { setUiMessages } from '../src/i18n';

const catalog = {
  tables: [
    { kind: 'table', name: 'APP_CustTable', app: 'app', model: 'Main', label: 'Customers', fields: [{ name: 'accountNum', label: 'Account' }, { name: 'name' }] },
  ],
  enums: [], menus: [
    { kind: 'menu', name: 'APP_Menu', app: 'app', model: 'Main', label: 'Main', items: [{ id: 'menu-orders', label: 'Orders', form: 'APP_OrderForm' }] },
  ],
  forms: [
    { kind: 'form', name: 'APP_OrderForm', app: 'app', model: 'Main', label: 'Orders', table: 'APP_CustTable', groups: [{ id: 'group-general', label: 'General', fields: ['name'] }], actions: [{ id: 'action-post', label: 'Post' }], lines: [] },
  ],
  privileges: [], duties: [], roles: [], scripts: [], functions: [], reports: [], views: [], charts: [],
  dataEntities: [{ kind: 'dataEntity', name: 'APP_OrderEntity', app: 'app', model: 'Main', label: 'Orders' }],
  translations: [],
};

describe('TranslationEditor key list and save semantics', () => {
  const mountEditor = (artifact: Artifact) => {
    const pinia = createPinia();
    setActivePinia(pinia);
    setUiMessages({}, 'en');
    const designer = useDesigner();
    designer.apps = [{ name: 'app', label: 'My App', models: [{ name: 'Main', layer: 'SYS' }] }];
    designer.catalog = catalog as any;
    designer.artifacts = [];
    designer.loaded = true;
    return mount(TranslationEditor, {
      props: { artifact, app: 'app', model: 'Main' },
      global: { plugins: [pinia] },
    });
  };

  it('derives resource keys from real metadata with the runtime key builders', () => {
    const artifact: Artifact = { kind: 'translation', name: 'APP_Thai', locale: 'th', resources: {} };
    const wrapper = mountEditor(artifact);
    const keys = (wrapper.vm as any).rows.map((row: any) => row.key) as string[];
    expect(keys).toContain('app.app.label');
    expect(keys).toContain('model.app.Main.label');
    expect(keys).toContain('table.APP_CustTable.label');
    expect(keys).toContain('table.APP_CustTable.field.accountNum.label');
    expect(keys).toContain('form.APP_OrderForm.label');
    expect(keys).toContain('form.APP_OrderForm.group.group-general.label');
    expect(keys).toContain('form.APP_OrderForm.action.action-post.label');
    expect(keys).toContain('menu.APP_Menu.item.menu-orders.label');
    expect(keys).toContain('dataEntity.APP_OrderEntity.label');
  });

  it('treats an empty translation cell as "do not override" on save', async () => {
    const artifact: Artifact = { kind: 'translation', name: 'APP_Thai', locale: 'th', resources: { 'app.app.label': 'แอปเดิม', 'table.APP_CustTable.label': '' } };
    const wrapper = mountEditor(artifact);
    const vm = wrapper.vm as any;
    const inputElement = wrapper.find('[data-testid="translation-input-app.app.label"]').find('input').element as HTMLInputElement;
    expect(inputElement.value).toBe('แอปเดิม');
    vm.values['app.app.label'] = '';
    await flushPromises();
    expect(artifact.resources).toEqual({});
    vm.values['table.APP_CustTable.label'] = 'ลูกค้า';
    await flushPromises();
    expect(artifact.resources).toEqual({ 'table.APP_CustTable.label': 'ลูกค้า' });
  });

  it('flags saved keys whose target disappeared', () => {
    const artifact: Artifact = { kind: 'translation', name: 'APP_Thai', locale: 'th', resources: { 'table.GoneTable.label': 'เก่า' } };
    const wrapper = mountEditor(artifact);
    expect((wrapper.vm as any).staleKeys).toEqual(['table.GoneTable.label']);
    expect(wrapper.text()).toContain('table.GoneTable.label');
  });

  it('validates the locale tag with a field-pointing message', () => {
    const artifact: Artifact = { kind: 'translation', name: 'APP_Bad', locale: 'th_TH', resources: {} };
    const wrapper = mountEditor(artifact);
    expect((wrapper.vm as any).localeError).toContain('locale:');
  });
});
