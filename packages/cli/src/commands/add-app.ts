import { defineCommand } from 'citty';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { findProjectRoot, listAppNames } from '../utils/paths.js';
import { isInteractive } from '../utils/tty.js';
import { scaffoldApp } from '../scaffold/app.js';
import { registerAppInMainTs } from '../register/main-ts.js';
import { registerAppInWorkspace } from '../register/workspace.js';

export const addAppCommand = defineCommand({
  meta: {
    name: 'app',
    description: 'Scaffold a new application module (standard or extension)',
  },
  args: {
    name: {
      type: 'positional',
      description: 'App name (lowercase, use dot notation for extensions: erp.credit)',
      required: true,
    },
  },
  async run({ args }) {
    const root = findProjectRoot();
    const existing = listAppNames(root);
    const name = args.name.toLowerCase().replace(/[^a-z0-9.-]/g, '-');

    console.log('');
    p.intro(pc.cyan(`Scaffold new app: ${name}`));

    if (existing.includes(name)) {
      p.log.error(`App '${name}' already exists`);
      process.exit(1);
    }

    // No TTY (scripts/CI): infer everything from dot notation — "erp.credit" extends "erp"
    if (!isInteractive()) {
      const base = name.includes('.') ? name.split('.')[0] : undefined;
      const dependsOn = base && existing.includes(base) ? [base] : [];
      createApp(root, name, name, dependsOn);
      return;
    }

    const isExtension = await p.confirm({
      message: 'Is this an extension app? (extends another app)',
      initialValue: name.includes('.'),
    });
    if (p.isCancel(isExtension)) process.exit(0);

    let dependsOn: string[] = [];

    if (isExtension) {
      if (existing.length === 0) {
        p.log.warn('No existing apps found to extend. Creating as standalone app.');
      } else {
        dependsOn = await p.multiselect({
          message: 'Select base app(s) this extension depends on',
          options: existing.map((n) => ({ value: n, label: n })),
          required: true,
        }) as string[];
        if (p.isCancel(dependsOn) || dependsOn.length === 0) {
          p.log.error('Extensions must declare at least one base app in dependsOn');
          process.exit(1);
        }
      }
    } else if (existing.length > 0) {
      const optDeps = await p.multiselect({
        message: 'Depends on apps? (optional for standard apps)',
        options: existing.map((n) => ({ value: n, label: n })),
        required: false,
      }) as string[];
      if (p.isCancel(optDeps)) process.exit(0);
      if (optDeps.length > 0) dependsOn = optDeps;
    }

    const label = await p.text({
      message: 'App label (display name)',
      placeholder: name,
      defaultValue: name,
    });
    if (p.isCancel(label)) process.exit(0);

    createApp(root, name, label as string, dependsOn);
  },
});

function createApp(root: string, name: string, label: string, dependsOn: string[]): void {
  const { appDir } = scaffoldApp(root, name, label);

  if (dependsOn.length > 0) {
    const appJsonPath = `${appDir}/app.json`;
    const json = JSON.parse(readFileSync(appJsonPath, 'utf-8'));
    json.dependsOn = dependsOn;
    writeFileSync(appJsonPath, JSON.stringify(json, null, 2));
  }

  registerAppInWorkspace(root, name);
  registerAppInMainTs(root, name);

  try {
    execSync('pnpm install', { cwd: root, stdio: 'pipe' });
  } catch {
    console.error(pc.yellow('pnpm install failed — run it manually'));
  }

  p.outro(pc.green(`App '${name}' is ready!`));
  if (dependsOn.length > 0) {
    p.log.message(`  ${pc.dim('Extends:')}  ${dependsOn.join(', ')}`);
  }
  p.log.message(`  ${pc.dim('Metadata:')} apps/${name}/metadata/`);
  p.log.message(`  ${pc.dim('Logic:')}    apps/${name}/src/logic.ts`);
  p.log.message(`  ${pc.dim('Next:')}     pnpm emu add object ${name} table`);
}
