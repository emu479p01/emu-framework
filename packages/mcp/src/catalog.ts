export const RESOURCE_CATALOG = [
  { uri: 'emu://schema/metadata', name: 'EmuFramework metadata schema', mimeType: 'application/schema+json' },
  { uri: 'emu://schema/change-set', name: 'EmuFramework change-set schema', mimeType: 'application/schema+json' },
  { uri: 'emu://workspace/apps', name: 'Workspace application summary', mimeType: 'application/json' },
];

export const TOOL_NAMES = ['inspect_workspace', 'inspect_app', 'validate_change_set', 'explain_diagnostics'] as const;
export const MUTATING_TOOL_NAMES = ['apply_change_set', 'delete_artifact', 'execute_script', 'query_business_data'] as const;
