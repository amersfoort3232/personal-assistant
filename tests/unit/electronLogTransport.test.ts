import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ERROR_LOG_MAX_BYTES,
  createElectronLogTransport,
} from '../../src/main/diagnostics/electronLogTransport';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('electron-log transport', () => {
  it('uses the approved production size and Documents-based filename', async () => {
    const documents = await mkdtemp(path.join(tmpdir(), 'pa-electron-log-'));
    directories.push(documents);
    const transport = createElectronLogTransport(documents);

    transport.write('{"event":"failure"}');

    const current = path.join(documents, 'personal-assistant', 'personal-assistant.log');
    expect(ERROR_LOG_MAX_BYTES).toBe(5 * 1024 * 1024);
    await expect(readFile(current, 'utf8')).resolves.toContain('{"event":"failure"}');
  });

  it('retains one exact previous file when the current file rotates', async () => {
    const documents = await mkdtemp(path.join(tmpdir(), 'pa-electron-log-'));
    directories.push(documents);
    const transport = createElectronLogTransport(documents, 180);

    for (let index = 0; index < 8; index += 1) {
      transport.write(JSON.stringify({ index, message: 'x'.repeat(80) }));
    }

    const directory = path.join(documents, 'personal-assistant');
    const files = (await readdir(directory)).sort();
    expect(files).toEqual(['personal-assistant.log', 'personal-assistant.previous.log']);
    await expect(readFile(path.join(directory, 'personal-assistant.previous.log'), 'utf8'))
      .resolves.toContain('"message"');
  });
});
