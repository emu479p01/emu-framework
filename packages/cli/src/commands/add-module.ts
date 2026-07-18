import { defineCommand } from 'citty';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { findProjectRoot, getAppDir } from '../utils/paths.js';

const META_DIRS = ['tables', 'enums', 'forms', 'menus', 'views', 'charts', 'privileges', 'duties', 'roles', 'functions', 'reports'];

export const addModuleCommand = defineCommand({
  meta: {
    name: 'module',
    description: 'Create a module directory under an app',
  },
  args: {
    app: {
      type: 'positional',
      description: 'Target app name',
      required: true,
    },
    name: {
      type: 'positional',
      description: 'Module name (PascalCase)',
      required: true,
    },
  },
  async run({ args }) {
    const root = findProjectRoot();
    const appDir = getAppDir(root, args.app);
    if (!existsSync(appDir)) {
      console.error(pc.red(`App '${args.app}' not found`));
      process.exit(1);
    }

    const moduleDir = join(appDir, 'metadata', args.name);
    if (existsSync(moduleDir)) {
      console.error(pc.red(`Module '${args.name}' already exists in '${args.app}'`));
      process.exit(1);
    }

    p.intro(pc.cyan(`Create module: ${args.name} in ${args.app}`));

    for (const dir of META_DIRS) {
      mkdirSync(join(moduleDir, dir), { recursive: true });
    }

    p.outro(pc.green(`Module '${args.name}' created at apps/${args.app}/metadata/${args.name}/`));
    p.log.message(`  ${pc.dim('Next:')} pnpm emu add object ${args.app} table`);
  },
});
