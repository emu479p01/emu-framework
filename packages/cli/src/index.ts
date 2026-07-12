import { defineCommand, runMain } from 'citty';
import { setupCommand } from './commands/setup.js';
import { addAppCommand } from './commands/add-app.js';
import { addObjectCommand } from './commands/add-object.js';
import { addExtensionCommand } from './commands/add-extension.js';
import { addModuleCommand } from './commands/add-module.js';
import { listCommand } from './commands/list.js';
import { inspectCommand, schemaCommand, validateCommand, applyCommand } from './commands/ai.js';

const addCommand = defineCommand({
  meta: {
    name: 'add',
    description: 'Add a new app, object, or extension',
  },
  subCommands: {
    app: addAppCommand,
    module: addModuleCommand,
    object: addObjectCommand,
    extension: addExtensionCommand,
  },
});

const main = defineCommand({
  meta: {
    name: 'emu',
    description: 'EmuFramework Developer CLI — scaffold apps, objects, and extensions interactively',
    version: '0.0.1.1',
  },
  subCommands: {
    setup: setupCommand,
    add: addCommand,
    list: listCommand,
    inspect: inspectCommand,
    schema: schemaCommand,
    validate: validateCommand,
    apply: applyCommand,
  },
});

runMain(main);
