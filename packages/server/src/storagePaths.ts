import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function storagePath(environmentName: string, directory: string): string {
  const configured = process.env[environmentName]?.trim();
  if (configured) return resolve(configured);
  if (process.env.EMU_DEPLOYMENT_MODE === 'docker') return resolve('/data', directory);
  return resolve(tmpdir(), 'emuframework', String(process.pid), directory);
}

export function attachmentStoragePath(): string {
  return storagePath('EMU_FILE_STORAGE_PATH', 'files');
}

export function archiveStoragePath(): string {
  return storagePath('EMU_ARCHIVE_STORAGE_PATH', 'archive');
}
