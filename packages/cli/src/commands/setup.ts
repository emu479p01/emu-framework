import { defineCommand } from 'citty';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { findProjectRoot } from '../utils/paths.js';
import { ensureMarkers } from '../register/main-ts.js';

export const setupCommand = defineCommand({
  meta: {
    name: 'setup',
    description: 'Initialize a new Framework project or prepare an existing one',
  },
  async run() {
    console.log('');
    p.intro(pc.cyan('EmuFramework Setup'));

    const root = findProjectRoot();

    const group = await p.group(
      {
        projectName: () =>
          p.text({
            message: 'Project name',
            placeholder: 'newframework',
            defaultValue: 'newframework',
          }),
        port: () =>
          p.text({
            message: 'Server port',
            placeholder: '3399',
            defaultValue: '3399',
          }),
      },
      {
        onCancel() {
          p.cancel('Setup cancelled');
          process.exit(0);
        },
      },
    );

    // Ensure main.ts has @emu markers for future app registration
    try {
      ensureMarkers(root);
      p.log.success('Added @emu registration markers to server/main.ts');
    } catch {
      p.log.warn('Could not add markers — main.ts may already be set up or does not exist');
    }

    p.outro(pc.green('Setup complete!'));
    p.log.message(`Server will run on port ${group.port}`);
    p.log.message(`Use ${pc.cyan('pnpm emu add app <name>')} to create your first app`);
  },
});
