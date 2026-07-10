const messages = {
  'nav.settings': 'Settings', 'nav.openMenu': 'Open navigation', 'nav.collapseMenu': 'Collapse navigation',
  'auth.logout': 'Sign out', 'home.title': 'Apps', 'home.emptyTitle': 'Build your first business app',
  'home.emptyDescription': 'Start with an entity, fields, page, and navigation. No JSON required.',
  'home.create': 'Create your first app', 'designer.title': 'Builder',
} as const;
export type MessageKey = keyof typeof messages;
export function t(key: MessageKey): string { return messages[key]; }
