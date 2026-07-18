import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAppDir } from '../utils/paths.js';
import { appJson, appPackageJson, appTsConfig, logicTs } from '../utils/templates.js';

const META_DIRS = ['tables', 'enums', 'forms', 'menus', 'privileges', 'duties', 'roles', 'functions', 'reports', 'views', 'charts', 'menuExtensions'];

export interface ScaffoldAppResult {
  appDir: string;
  appName: string;
  label: string;
}

export function scaffoldApp(root: string, name: string, label: string): ScaffoldAppResult {
  const appDir = getAppDir(root, name);
  if (existsSync(appDir)) {
    throw new Error(`App '${name}' already exists at ${appDir}`);
  }

  mkdirSync(appDir, { recursive: true });
  mkdirSync(join(appDir, 'src'), { recursive: true });
  mkdirSync(join(appDir, 'metadata'), { recursive: true });
  for (const dir of META_DIRS) {
    mkdirSync(join(appDir, 'metadata', dir), { recursive: true });
  }
  mkdirSync(join(appDir, 'test'), { recursive: true });

  writeFileSync(join(appDir, 'app.json'), appJson(name, label, []));
  writeFileSync(join(appDir, 'package.json'), appPackageJson(name));
  writeFileSync(join(appDir, 'tsconfig.json'), appTsConfig());
  writeFileSync(join(appDir, 'src', 'logic.ts'), logicTs(name));

  return { appDir, appName: name, label };
}
