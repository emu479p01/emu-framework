import { defineCommand } from 'citty';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { findProjectRoot, getAppDir } from '../utils/paths.js';
import { isInteractive } from '../utils/tty.js';

const LAYERS = ['SYS', 'ISV', 'LOC', 'DEV', 'CUS'] as const;

export const addModelCommand = defineCommand({
  meta: { name: 'model', description: 'Add an explicit metadata Model to an App' },
  args: {
    app: { type: 'positional', description: 'Target app name', required: true },
    name: { type: 'positional', description: 'Model name', required: true },
    label: { type: 'string', description: 'Display label' },
    layer: { type: 'string', description: 'SYS | ISV | LOC | DEV | CUS' },
  },
  async run({ args }) {
    const root = findProjectRoot();
    const appDir = getAppDir(root, args.app);
    const manifestPath = join(appDir, 'app.json');
    if (!existsSync(manifestPath)) throw new Error(`App '${args.app}' was not found`);
    let layer = String(args.layer ?? '').toUpperCase();
    if (!layer && isInteractive()) layer = await p.select({ message: 'Model layer', options: LAYERS.map((value) => ({ label: value, value })) }) as string;
    if (!LAYERS.includes(layer as typeof LAYERS[number])) throw new Error(`--layer is required and must be one of ${LAYERS.join(', ')}`);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { models?: { name: string; label?: string; layer: string }[] };
    manifest.models ??= [];
    if (manifest.models.some((model) => model.name === args.name)) throw new Error(`Model '${args.name}' already exists in '${args.app}'`);
    manifest.models.push({ name: args.name, label: String(args.label ?? args.name), layer });
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    p.outro(pc.green(`Added Model '${args.name}' (${layer}) to '${args.app}'`));
  },
});
