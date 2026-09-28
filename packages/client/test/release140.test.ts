import { defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { NConfigProvider, NDialogProvider, NMessageProvider, NDatePicker } from 'naive-ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FormPage from '../src/views/FormPage.vue';
import FieldControl from '../src/components/FieldControl.vue';
import DeploymentDetails from '../src/components/DeploymentDetails.vue';
import FunctionImages from '../src/components/FunctionImages.vue';
import { api } from '../src/api';
import { useMeta, type Metadata } from '../src/stores/meta';
import type { MetadataPackagePreview } from '../src/api';

describe('1.4.0 UI workflows', () => {
  beforeEach(() => vi.restoreAllMocks());
  it('loads mandatory initValue into New and saves using its draft token', async () => {
    const pinia = createPinia(); setActivePinia(pinia);
    useMeta().meta = { tables: [{ kind: 'table', name: 'TEST_Order', fields: [
      { name: 'number', type: 'string', mandatory: true, readOnly: true },
      { name: 'name', type: 'string', mandatory: true },
    ] }], forms: [{ kind: 'form', name: 'TEST_Form', table: 'TEST_Order' }] } as Metadata;
    const post = vi.spyOn(api, 'post').mockImplementation(async url => url.endsWith('/drafts')
      ? { token: 'opaque', record: { number: 'SO-123', name: 'Order' } } as never
      : { id: 7, number: 'SO-123', name: 'Order' } as never);
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }] });
    await router.push('/form/TEST_Form/new');
    const Host = defineComponent({ components: { FormPage, NConfigProvider, NDialogProvider, NMessageProvider }, template: '<n-config-provider><n-dialog-provider><n-message-provider><FormPage form-name="TEST_Form" id="new" /></n-message-provider></n-dialog-provider></n-config-provider>' });
    const wrapper = mount(Host, { global: { plugins: [pinia, router], stubs: { ActionDialog: true, FieldControl: { props: ['modelValue'], template: '<span>{{ modelValue }}</span>' } } } });
    await flushPromises(); expect(wrapper.text()).toContain('SO-123');
    await wrapper.get('[data-testid="save-record"]').trigger('click'); await flushPromises();
    expect(post).toHaveBeenLastCalledWith('/api/data/TEST_Order/drafts/opaque/save', { name: 'Order' });
    expect(wrapper.find('.error-list').exists()).toBe(false); wrapper.unmount();
  });
  it('passes UTC instants to the local datetime picker and emits UTC on changes', () => {
    const wrapper = mount(FieldControl, { props: { field: { name: 'when', type: 'datetime' }, modelValue: '2026-08-15T15:52:39' }, global: { plugins: [createPinia()] } });
    const picker = wrapper.findComponent(NDatePicker);
    expect(picker.props('value')).toBe(Date.parse('2026-08-15T15:52:39Z'));
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    picker.vm.$emit('update:value', Date.parse('2026-08-15T17:52:39Z'));
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['2026-08-15T17:52:39.000Z']); wrapper.unmount();
  });
  it('collapses deployments, preserves warnings and shows moved/deleted artifacts on expansion', async () => {
    const preview = { package: { scope: { type: 'app', app: 'erp' } }, diff: [
      { op: 'delete', kind: 'table', name: 'Old', before: { app: 'erp', model: 'Base' }, highRisk: true },
      { op: 'update', kind: 'script', name: 'Moved', before: { app: 'erp', model: 'Base' }, after: { app: 'erp', model: 'Custom' } },
    ] } as MetadataPackagePreview;
    const wrapper = mount(DeploymentDetails, { props: { preview } });
    expect(wrapper.text()).toContain('High risk: 1'); expect(wrapper.text()).not.toContain('Old');
    await wrapper.findAll('button')[0]!.trigger('click');
    expect(wrapper.text()).toContain('Old'); expect(wrapper.text()).toContain('Moved from erp/Base');
    await wrapper.findAll('button')[1]!.trigger('click'); expect(wrapper.text()).not.toContain('Old'); wrapper.unmount();
  });
  it('keeps successful image uploads when a later upload fails, then retries only the failed file', async () => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() }));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'first' }) } as Response)
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: 'Retry' }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'second' }) } as Response);
    const wrapper = mount(FunctionImages, { props: { name: 'Fn', config: { table: 'T', recordIdArgument: 'id', multiple: true }, recordId: 7 } });
    const input = wrapper.get('input[type=file]');
    Object.defineProperty(input.element, 'files', { value: [new File(['png'], 'a.png', { type: 'image/png' }), new File(['png'], 'b.png', { type: 'image/png' })] });
    await input.trigger('change'); expect(fetchMock).not.toHaveBeenCalled();
    await expect(wrapper.vm.upload()).rejects.toThrow('Retry');
    await expect(wrapper.vm.upload()).resolves.toEqual(['first', 'second']);
    expect(fetchMock).toHaveBeenCalledTimes(3); expect(fetchMock.mock.calls[1]![0]).toBe(fetchMock.mock.calls[2]![0]);
    wrapper.unmount(); vi.unstubAllGlobals();
  });
});
