import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { NDialogProvider, NMessageProvider } from 'naive-ui';
import AttachmentPanel from '../src/components/AttachmentPanel.vue';
import { api } from '../src/api';
import { setUiMessages } from '../src/i18n';

const pngItem = { id: 'att-png', kind: 'file', name: 'logo.png', mimeType: 'image/png', bytes: 100, createdAt: '2026-01-01T00:00:00Z', createdBy: 'admin' };
const pdfItem = { id: 'att-pdf', kind: 'file', name: 'doc.pdf', mimeType: 'application/pdf', bytes: 900, createdAt: '2026-01-01T00:00:00Z', createdBy: 'admin' };
const noteItem = { id: 'att-note', kind: 'note', name: 'Note', text: 'hello', createdAt: '2026-01-01T00:00:00Z', createdBy: 'admin' };

const Host = { components: { AttachmentPanel, NMessageProvider, NDialogProvider }, template: '<n-message-provider><n-dialog-provider><AttachmentPanel table="T" :record-id="1" /></n-dialog-provider></n-message-provider>' };

describe('AttachmentPanel image preview', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    setUiMessages({}, 'en');
    vi.spyOn(api, 'get').mockResolvedValue({ items: [pngItem, pdfItem, noteItem] });
    vi.spyOn(api, 'delete').mockResolvedValue({ ok: true });
  });
  it('shows lazy thumbnails for images only and keeps other kinds as links', async () => {
    const wrapper = mount(Host);
    await flushPromises();
    const images = wrapper.findAll('.thumbnail');
    expect(images).toHaveLength(1);
    expect(images[0]!.attributes('src')).toBe('/api/attachments/att-png/preview');
    expect(images[0]!.attributes('loading')).toBe('lazy');
    expect(wrapper.html()).toContain('/api/attachments/att-pdf/download');
    expect(wrapper.html()).toContain('hello');
    expect(wrapper.find('.empty').exists()).toBe(false);
  });
  it('opens a viewer with file name, download and close, and closes on Escape', async () => {
    const wrapper = mount(Host);
    await flushPromises();
    expect(wrapper.find('[data-testid="attachment-viewer"]').exists()).toBe(false);
    await wrapper.find('.file-link').trigger('click');
    const viewer = wrapper.find('[data-testid="attachment-viewer"]');
    expect(viewer.exists()).toBe(true);
    expect(viewer.text()).toContain('logo.png');
    expect(viewer.find('.viewer-download').attributes('href')).toBe('/api/attachments/att-png/download');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(wrapper.find('[data-testid="attachment-viewer"]').exists()).toBe(false);
  });
  it('falls back to a download link when the thumbnail fails to load', async () => {
    const wrapper = mount(Host);
    await flushPromises();
    await wrapper.find('.thumbnail').trigger('error');
    await flushPromises();
    expect(wrapper.find('.thumbnail').exists()).toBe(false);
    expect(wrapper.html()).toContain('/api/attachments/att-png/download');
    expect(wrapper.find('.file-link').exists()).toBe(false);
  });
});
