import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import HomePage from '../src/views/HomePage.vue';

describe('Home onboarding', () => {
  it('gives a new business builder a clear next action', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: HomePage }, { path: '/designer', component: { template: '<div />' } }] });
    await router.push('/'); await router.isReady();
    const wrapper = mount(HomePage, { global: { plugins: [createPinia(), router] } });
    expect(wrapper.get('[data-testid="empty-onboarding"]').text()).toContain('Build your first business app');
    expect(wrapper.get('[data-testid="create-first-app"]').text()).toContain('Create your first app');
  });
});
