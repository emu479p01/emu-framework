import { defineCommand } from 'citty';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as p from '@clack/prompts';
import {
  Kernel,
  loadWorkspaceArtifacts,
  metadataArtifactSchema,
  metadataChangeSetSchema,
  previewMetadataChangeSet,
  summarizeWorkspace,
  type MetadataArtifact,
  type MetadataChangeSet,
} from '@emu/core';
import { findProjectRoot } from '../utils/paths.js';

const kindDirectories: Record<string, string> = {
  table: 'tables', enum: 'enums', form: 'forms', menu: 'menus', privilege: 'privileges', duty: 'duties', role: 'roles',
  script: 'scripts', report: 'reports', view: 'views', chart: 'charts', tableExtension: 'tableExtensions', enumExtension: 'enumExtensions',
  formExtension: 'formExtensions', menuExtension: 'menuExtensions', privilegeExtension: 'privilegeExtensions',
  dutyExtension: 'dutyExtensions', roleExtension: 'roleExtensions', scriptExtension: 'scriptExtensions',
};

function flag(args: Record<string, unknown>, key: string): boolean { return args[key] === true || args[key] === 'true'; }
function print(value: unknown): void { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }
function readChangeSet(file: string): MetadataChangeSet { return JSON.parse(readFileSync(file, 'utf8')) as MetadataChangeSet; }

export const inspectCommand = defineCommand({
  meta: { name: 'inspect', description: 'Inspect the workspace in an AI-friendly format' },
  args: { json: { type: 'boolean', description: 'Output JSON' } },
  run({ args }) {
    const summary = summarizeWorkspace(loadWorkspaceArtifacts(findProjectRoot()));
    if (flag(args, 'json')) print(summary);
    else {
      p.intro('EmuFramework workspace');
      p.log.info(`Revision: ${summary.revision}`);
      for (const app of summary.apps) p.log.message(`${app.label} (${app.name}) — ${app.artifacts} artifacts`);
      p.outro(`${summary.apps.length} apps`);
    }
  },
});

export const schemaCommand = defineCommand({
  meta: { name: 'schema', description: 'Print metadata and change-set JSON Schemas' },
  args: { json: { type: 'boolean', description: 'Output JSON', default: true } },
  run() { print({ metadataArtifact: metadataArtifactSchema, changeSet: metadataChangeSetSchema }); },
});

function validate(root: string, changeSet: MetadataChangeSet, allowScripts = false) {
  const snapshot = loadWorkspaceArtifacts(root);
  const kernel = new Kernel(':memory:');
  return previewMetadataChangeSet(kernel, snapshot.artifacts, changeSet, { allowScripts });
}

export const validateCommand = defineCommand({
  meta: { name: 'validate', description: 'Validate a metadata change set without modifying the workspace' },
  args: { file: { type: 'positional', required: true, description: 'Change-set JSON file' }, json: { type: 'boolean', description: 'Output JSON' } },
  run({ args }) {
    const preview = validate(findProjectRoot(), readChangeSet(String(args.file)));
    const { candidateArtifacts: _candidateArtifacts, ...result } = preview;
    print(result);
    if (!preview.valid) process.exitCode = 1;
  },
});

function targetPath(root: string, artifact: MetadataArtifact): string {
  if (artifact.kind === 'app') return join(root, 'apps', artifact.name, 'app.json');
  const app = 'app' in artifact ? artifact.app : undefined;
  if (!app) throw new Error(`Artifact '${artifact.name}' must declare its app`);
  const dir = kindDirectories[artifact.kind];
  if (!dir) throw new Error(`No file mapping for kind '${artifact.kind}'`);
  return join(root, 'apps', app, 'metadata', dir, `${artifact.name}.json`);
}

export const applyCommand = defineCommand({
  meta: { name: 'apply', description: 'Apply a validated change set to workspace files after confirmation' },
  args: {
    file: { type: 'positional', required: true, description: 'Change-set JSON file' },
    yes: { type: 'boolean', description: 'Confirm non-interactively' },
  },
  async run({ args }) {
    const root = findProjectRoot();
    const changeSet = readChangeSet(String(args.file));
    const preview = validate(root, changeSet, true);
    if (!preview.valid) { print(preview); process.exitCode = 1; return; }
    p.intro(changeSet.description ?? 'Metadata change set');
    for (const item of preview.diff) p.log.message(`${item.op.toUpperCase()} ${item.kind} ${item.name}${item.highRisk ? ' [HIGH RISK]' : ''}`);
    const confirmed = flag(args, 'yes') || await p.confirm({ message: 'Apply these changes to workspace files?', initialValue: false });
    if (p.isCancel(confirmed) || !confirmed) { p.cancel('No files changed'); return; }
    const snapshot = loadWorkspaceArtifacts(root);
    for (const operation of changeSet.operations) {
      if (operation.op === 'delete') {
        const file = snapshot.files[operation.name];
        if (file && existsSync(file)) unlinkSync(file);
      } else {
        const file = targetPath(root, operation.artifact);
        mkdirSync(dirname(file), { recursive: true });
        const body = operation.artifact.kind === 'app'
          ? Object.fromEntries(Object.entries(operation.artifact).filter(([key]) => key !== 'kind'))
          : operation.artifact;
        writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
      }
    }
    p.outro(`Applied ${preview.diff.length} changes`);
  },
});
