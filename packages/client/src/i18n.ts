import { reactive } from 'vue';

/** English fallbacks used before metadata loads or when a key has no translation. */
const FALLBACK_MESSAGES: Record<string, string> = {
  'ui.nav.settings': 'Settings',
  'ui.nav.recent': 'Recent',
  'ui.nav.recentEmpty': 'No recently opened items',
  'ui.nav.openMenu': 'Open navigation',
  'ui.nav.collapseMenu': 'Collapse navigation',
  'ui.nav.systemMaintenance': 'System Maintenance',
  'ui.nav.appData': 'App Data Management',
  'ui.nav.reportFonts': 'Report Fonts',
  'ui.nav.smtp': 'SMTP Settings',
  'ui.nav.usersSecurity': 'Users & Security',
  'ui.nav.changePassword': 'Change Password',
  'ui.auth.logout': 'Sign out',
  'ui.auth.changePassword': 'Change password',
  'ui.auth.language': 'Language',
  'ui.auth.localeSaved': 'Language updated',
  'ui.auth.localePartial': 'Language saved, but reloading texts failed',
  'ui.home.title': 'Apps',
  'ui.home.subtitle': 'Choose an app to continue your work.',
  'ui.home.emptyTitle': 'Build your first business app',
  'ui.home.emptyDescription': 'Start with an entity, fields, page, and navigation. No JSON required.',
  'ui.home.create': 'Create your first app',
  'ui.common.save': 'Save',
  'ui.common.back': 'Back',
  'ui.common.cancel': 'Cancel',
  'ui.common.delete': 'Delete',
  'ui.common.close': 'Close',
  'ui.common.download': 'Download',
  'ui.common.search': 'Search',
  'ui.common.retry': 'Retry',
  'ui.common.unknown': 'Unknown',
  'ui.attachments.title': 'Attachments',
  'ui.attachments.upload': 'Upload file',
  'ui.attachments.notePlaceholder': 'Add a note',
  'ui.attachments.addNote': 'Add note',
  'ui.attachments.urlPlaceholder': 'https://…',
  'ui.attachments.addUrl': 'Add URL',
  'ui.attachments.empty': 'No attachments',
  'ui.attachments.deleteConfirm': 'Delete this attachment?',
  'ui.attachments.uploaded': 'Attachment uploaded',
  'ui.attachments.preview': 'Open preview',
  'ui.attachments.previewFailed': 'The image could not be loaded',
  'ui.attachments.imageAlt': 'Image preview',
  'ui.designer.title': 'Builder',
  'ui.designer.new': 'New',
  'ui.designer.save': 'Save',
  'ui.designer.saved': 'Saved — changes are live',
  'ui.designer.back': 'Back',
  'ui.designer.designTab': 'Design',
  'ui.designer.jsonTab': 'JSON',
  'ui.designer.name': 'Name',
  'ui.designer.label': 'Label',
  'ui.designer.app': 'App',
  'ui.designer.model': 'Model',
  'ui.designer.layer': 'Layer',
  'ui.designer.search': 'Search artifacts',
  'ui.designer.appDefaultLocale': 'Default language',
  'ui.designer.appDefaultLocaleHint': 'Labels fall back to this locale when the user language has no translation.',
};

export type MessageKey = keyof typeof FALLBACK_MESSAGES;

const state = reactive<{ messages: Record<string, string>; locale: string }>({ messages: {}, locale: 'en' });

/** Called by the meta store whenever /api/metadata is (re)loaded. */
export function setUiMessages(messages: Record<string, string>, locale: string): void {
  state.messages = messages;
  state.locale = locale;
}

export function currentUiLocale(): string {
  return state.locale;
}

/** Reactive translation lookup: server-resolved framework messages first,
 * English fallbacks second. Reading `state` inside a render/computed keeps
 * every consumer reactive across language switches. */
export function t(key: MessageKey | (string & {})): string {
  return state.messages[key as string] ?? FALLBACK_MESSAGES[key as MessageKey] ?? String(key);
}
