#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  Kernel,
  loadWorkspaceArtifacts,
  metadataArtifactSchema,
  metadataChangeSetSchema,
  previewMetadataChangeSet,
  summarizeWorkspace,
  type MetadataChangeSet,
} from '@emu/core';
import { RESOURCE_CATALOG, TOOL_NAMES } from './catalog.js';

function workspaceRoot(): string {
  let dir = process.env.EMU_WORKSPACE_ROOT || process.cwd();
  const root = parse(dir).root;
  while (dir !== root) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml')) && existsSync(join(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

const server = new Server(
  { name: 'emuframework-dev', version: '0.1.1.0' },
  { capabilities: { resources: {}, tools: {}, prompts: {} } },
);

server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: RESOURCE_CATALOG }));

server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [
  { uriTemplate: 'emu://workspace/app/{name}', name: 'Application metadata snapshot', mimeType: 'application/json' },
] }));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  const snapshot = loadWorkspaceArtifacts(workspaceRoot());
  let value: unknown;
  if (uri === 'emu://schema/metadata') value = metadataArtifactSchema;
  else if (uri === 'emu://schema/change-set') value = metadataChangeSetSchema;
  else if (uri === 'emu://workspace/apps') value = summarizeWorkspace(snapshot);
  else if (uri.startsWith('emu://workspace/app/')) {
    const app = decodeURIComponent(uri.slice('emu://workspace/app/'.length));
    value = { revision: snapshot.revision, artifacts: snapshot.artifacts.filter((artifact) => artifact.kind === 'app' ? artifact.name === app : artifact.app === app) };
  } else throw new Error(`Unknown resource '${uri}'`);
  return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(value, null, 2) }] };
});

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  { name: TOOL_NAMES[0], description: 'Return apps, artifact counts, diagnostics, and the current revision.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: readOnly },
  { name: TOOL_NAMES[1], description: 'Return metadata for one app without business records.', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false }, annotations: readOnly },
  { name: TOOL_NAMES[2], description: 'Validate and preview a draft change set. Never writes files, metadata, schema, or business data.', inputSchema: metadataChangeSetSchema as any, annotations: readOnly },
  { name: TOOL_NAMES[3], description: 'Turn validation diagnostics into actionable developer guidance.', inputSchema: { type: 'object', properties: { diagnostics: { type: 'array', items: { type: 'object' } } }, required: ['diagnostics'], additionalProperties: false }, annotations: readOnly },
] }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const snapshot = loadWorkspaceArtifacts(workspaceRoot());
  const args = request.params.arguments ?? {};
  let value: unknown;
  if (request.params.name === 'inspect_workspace') value = summarizeWorkspace(snapshot);
  else if (request.params.name === 'inspect_app') {
    const app = String(args.name ?? '');
    value = { revision: snapshot.revision, artifacts: snapshot.artifacts.filter((artifact) => artifact.kind === 'app' ? artifact.name === app : artifact.app === app) };
  } else if (request.params.name === 'validate_change_set') {
    const kernel = new Kernel(':memory:');
    const preview = previewMetadataChangeSet(kernel, snapshot.artifacts, args as unknown as MetadataChangeSet, { allowScripts: false });
    const { candidateArtifacts: _candidateArtifacts, ...safe } = preview;
    value = safe;
  } else if (request.params.name === 'explain_diagnostics') {
    const items = Array.isArray(args.diagnostics) ? args.diagnostics : [];
    value = items.map((item: any) => ({
      path: item.path ?? '/', code: item.code ?? 'validation',
      guidance: item.code === 'stale_revision' ? 'Inspect the workspace again and rebuild the change set with the new revision.'
        : item.code === 'high_risk_script' ? 'Implement executable logic manually and review it outside the AI change-set flow.'
        : `Correct the value at ${item.path ?? '/'} and validate again.`,
    }));
  } else throw new Error(`Unknown tool '${request.params.name}'`);
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
});

server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [
  { name: 'create_business_app', description: 'Plan an app as a safe EmuFramework metadata change set', arguments: [{ name: 'requirements', description: 'Business requirements', required: true }] },
  { name: 'extend_app_safely', description: 'Plan an extension without modifying its base app', arguments: [{ name: 'app', required: true }, { name: 'requirements', required: true }] },
] }));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const args = request.params.arguments ?? {};
  const text = request.params.name === 'create_business_app'
    ? `Create a version-1 EmuFramework MetadataChangeSet for these requirements: ${args.requirements}. Read emu://schema/metadata and emu://workspace/apps first. Require an explicit App, Model and Layer for every artifact; include an App manifest with an explicit Model when creating an App, and call validate_change_set. Do not create scripts.`
    : `Extend app ${args.app} for these requirements: ${args.requirements}. Inspect emu://workspace/app/${args.app}, use extension artifacts, preserve the base model, and validate the result. Do not create scripts.`;
  return { messages: [{ role: 'user', content: { type: 'text', text } }] };
});

await server.connect(new StdioServerTransport());
