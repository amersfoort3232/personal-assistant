import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/main/settings/defaultSettings';
import { SettingsRepository } from '../../src/main/settings/settingsRepository';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('SettingsRepository', () => {
  it('recovers invalid settings to approved defaults and rewrites valid JSON', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'pa-settings-'));
    directories.push(directory);
    await writeFile(path.join(directory, 'settings.json'), '{"version": 2}');
    const repository = new SettingsRepository(directory);

    await expect(repository.load()).resolves.toEqual(DEFAULT_SETTINGS);

    const persisted = JSON.parse(await readFile(path.join(directory, 'settings.json'), 'utf8'));
    expect(persisted).toEqual(DEFAULT_SETTINGS);
  });
});
