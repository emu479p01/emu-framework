import { defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { NConfigProvider, NDialogProvider, NMessageProvider } from 'naive-ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AiProposalsPage from '../src/views/designer/AiProposalsPage.vue';
import { api } from '../src/api';

const proposals = [
  { id: 'pending-1', tokenName: 'Builder', status: 'pending', createdAt: '2026-09-03', changeSet: { description: 'Pending change' }, preview: { baseRevision: 'a', nextRevision: 'b', diff: [{ op: 'create', kind: 'table', name: 'APP_Table' }], schemaEffects: [] } },
  { id: 'approved-1', tokenName: 'Builder', status: 'approved', createdAt: '2026-09-02', changeSet: { description: 'Reviewed change' }, preview: { baseRevision: 'a', nextRevision: 'b', diff: [{ op: 'create', kind: 'form', name: 'APP_Form' }], schemaEffects: [] } },
];

function findButton(label: string) {
  return [...document.body.querySelectorAll('button')].filter((button) => button.textContent?.trim() === label).at(-1) as HTMLButtonElement | undefined;
}

describe('AI Proposal Inbox management', () => {
  beforeEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

  it('expands and collapses proposals and deletes only after confirmation', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: proposals });
    const remove = vi.spyOn(api, 'delete').mockResolvedValue({ ok: true });
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/designer/ai-proposals', component: AiProposalsPage }, { path: '/designer', component: { template: '<div />' } }] });
    await router.push('/designer/ai-proposals'); await router.isReady();
    const Host = defineComponent({
      components: { AiProposalsPage, NConfigProvider, NDialogProvider, NMessageProvider },
      template: '<n-config-provider><n-dialog-provider><n-message-provider><AiProposalsPage /></n-message-provider></n-dialog-provider></n-config-provider>',
    });
    const wrapper = mount(Host, { attachTo: document.body, global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.text()).toContain('APP_Table');
    expect(wrapper.text()).not.toContain('APP_Form');
    const expandButtons = wrapper.findAll('button').filter((button) => button.text() === 'Expand');
    await expandButtons.at(-1)!.trigger('click');
    expect(wrapper.text()).toContain('APP_Form');
    await wrapper.findAll('button').find((button) => button.text() === 'Delete')!.trigger('click');
    await flushPromises();
    findButton('Delete')!.click();
    await flushPromises();
    expect(remove).toHaveBeenCalledWith('/api/designer/ai-proposals/approved-1');
  });
});
