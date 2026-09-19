import { afterEach, describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { archiveStoragePath, attachmentStoragePath } from '../src/storagePaths.js';

const originalDeployment = process.env.EMU_DEPLOYMENT_MODE;
const originalFiles = process.env.EMU_FILE_STORAGE_PATH;
const originalArchive = process.env.EMU_ARCHIVE_STORAGE_PATH;

afterEach(() => {
  if (originalDeployment === undefined) delete process.env.EMU_DEPLOYMENT_MODE; else process.env.EMU_DEPLOYMENT_MODE = originalDeployment;
  if (originalFiles === undefined) delete process.env.EMU_FILE_STORAGE_PATH; else process.env.EMU_FILE_STORAGE_PATH = originalFiles;
  if (originalArchive === undefined) delete process.env.EMU_ARCHIVE_STORAGE_PATH; else process.env.EMU_ARCHIVE_STORAGE_PATH = originalArchive;
});

describe('persistent storage paths', () => {
  it('uses writable process-local paths outside Docker', () => {
    delete process.env.EMU_DEPLOYMENT_MODE; delete process.env.EMU_FILE_STORAGE_PATH; delete process.env.EMU_ARCHIVE_STORAGE_PATH;
    const localRoot = resolve(tmpdir(), 'emuframework', String(process.pid));
    expect(attachmentStoragePath()).toBe(resolve(localRoot, 'files'));
    expect(archiveStoragePath()).toBe(resolve(localRoot, 'archive'));
  });

  it('preserves Docker fallbacks and explicit overrides', () => {
    process.env.EMU_DEPLOYMENT_MODE = 'docker'; delete process.env.EMU_FILE_STORAGE_PATH; delete process.env.EMU_ARCHIVE_STORAGE_PATH;
    expect(attachmentStoragePath()).toBe(resolve('/data/files'));
    expect(archiveStoragePath()).toBe(resolve('/data/archive'));
    process.env.EMU_FILE_STORAGE_PATH = './custom-files'; process.env.EMU_ARCHIVE_STORAGE_PATH = './custom-archive';
    expect(attachmentStoragePath()).toBe(resolve('./custom-files'));
    expect(archiveStoragePath()).toBe(resolve('./custom-archive'));
  });
});
