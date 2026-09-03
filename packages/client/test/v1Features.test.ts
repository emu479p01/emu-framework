import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { createPinia } from 'pinia';
import { NDataTable } from 'naive-ui';
import BusinessDataTable from '../src/components/BusinessDataTable.vue';
import FieldControl from '../src/components/FieldControl.vue';
import ActionPage from '../src/views/ActionPage.vue';
import { safeInternalRedirect } from '../src/internalRedirect';
import { api } from '../src/api';

describe('v1 client features', () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it('persists bounded column widths and removes stale field keys', async () => {
    const wrapper = mount(BusinessDataTable, { props: { columns: [{ title: 'Name', key: 'name' }, { title: '', key: '_actions' }], data: [], storageKey: 'list:test' } });
    const table = wrapper.findComponent(NDataTable);
    const resize = table.props('onUnstableColumnResize') as (resized: number, limited: number, column: unknown) => void;
    resize(920, 920, { key: 'name' });
    await wrapper.vm.$nextTick();
    expect(JSON.parse(localStorage.getItem('emu:grid-widths:v1:list:test') ?? '{}')).toEqual({ name: 800 });
    await wrapper.setProps({ columns: [{ title: 'Code', key: 'code' }] });
    expect(JSON.parse(localStorage.getItem('emu:grid-widths:v1:list:test') ?? '{}')).toEqual({});
  });

  it('renders multiline strings as a textarea and preserves blank lines', () => {
    const value = 'first line\n\nthird line';
    const wrapper = mount(FieldControl, { props: { field: { name: 'notes', type: 'string', multiline: true }, modelValue: value }, global: { plugins: [createPinia()] } });
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe(value);
  });

  it('accepts only safe internal login redirects', () => {
    expect(safeInternalRedirect('/app/sales/form/Order?tab=lines#row-2')).toBe('/app/sales/form/Order?tab=lines#row-2');
    expect(safeInternalRedirect('https://evil.example/steal')).toBe('/');
    expect(safeInternalRedirect('//evil.example/steal')).toBe('/');
    expect(safeInternalRedirect('/login?redirect=/app')).toBe('/');
  });

  it('confirms before running a deeplink Function and sends only last arg.* values', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true });
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/action/:name', component: ActionPage, props: true }] });
    await router.push('/action/Send?arg.orderId=41&arg.orderId=42&ignored=value');
    await router.isReady();
    const wrapper = mount(ActionPage, { props: { name: 'Send' }, global: { plugins: [router] } });
    expect(post).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('"orderId": "42"');
    await wrapper.get('button:last-child').trigger('click');
    await flushPromises();
    expect(post).toHaveBeenCalledWith('/api/action/Send', { orderId: '42' });
  });
});
