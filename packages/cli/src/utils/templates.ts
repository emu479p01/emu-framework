export function appJson(name: string, label: string, dependsOn: string[]): string {
  return JSON.stringify(
    {
      name,
      label,
      ...(dependsOn.length > 0 ? { dependsOn } : {}),
    },
    null,
    2,
  );
}

export function appPackageJson(name: string): string {
  return JSON.stringify(
    {
      name: `@emu/app-${name}`,
      version: '0.1.0',
      private: true,
      type: 'module',
      main: 'dist/logic.js',
      scripts: {
        build: 'tsc',
        typecheck: 'tsc --noEmit',
        test: 'vitest run',
      },
      dependencies: {
        '@emu/core': 'workspace:*',
      },
      devDependencies: {
        '@types/node': '^22.0.0',
        typescript: '^5.5.0',
        vitest: '^2.0.0',
      },
    },
    null,
    2,
  );
}

export function appTsConfig(): string {
  return JSON.stringify(
    {
      extends: '../../tsconfig.base.json',
      compilerOptions: {
        outDir: 'dist',
        rootDir: 'src',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
      },
      include: ['src'],
    },
    null,
    2,
  );
}

export function logicTs(name: string): string {
  return `import type { Kernel } from '@emu/core';

export function register${capitalize(name)}Logic(kernel: Kernel): void {
  // Register event handlers, hooks, and actions here
  //
  // kernel.events.on('MyTable', 'onInserting', (e) => { ... });
  // kernel.hooks.register('MyTable', { validateWrite(rec) { ... } });
  // kernel.actions.set('MyAction', (ctx, args) => { ... });
}
`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
