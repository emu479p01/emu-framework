import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildServer } from './server.js';
import { hashPassword } from './auth.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const appTitle = process.env.EMU_APP_TITLE ?? 'EmuFramework';
const dbPath = process.env.EMU_DB_PATH ?? join(root, 'data.db');
const designerDbPath = process.env.EMU_DESIGNER_DB_PATH ?? join(root, 'designer.db');
const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3399);

if (process.env.NODE_ENV === 'production') {
  if (process.env.EMU_DEPLOYMENT_MODE !== 'docker') throw new Error('EmuFramework v0.5 production runtime is Docker-only');
  if (!dbPath.startsWith('/data/') || !designerDbPath.startsWith('/data/')) throw new Error('Docker production databases must use the persistent /data volume');
}

const app = buildServer({
  dbPath,
  designerDbPath,
  appTitle,
  appDirs: [
    // @emu:app-dirs-begin
    // @emu:app-dirs-end
  ],
  registerLogic(kernel) {
    // @emu:app-logic-begin
    // Business logic is now stored in designer.db as 'script' artifacts
    // They are executed automatically by applyWebArtifacts / bootWebArtifacts
    // @emu:app-logic-end
  },
});

app.listen({ port, host }).then(() => {
  const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;
  console.log(`${appTitle} server on http://${displayHost}:${port}`);
  console.log(`DB: ${dbPath}  |  Designer DB: ${designerDbPath}`);
  console.log('Artifact authoring: Web Designer and reviewed AI REST proposals');
});
