import { readFile } from 'node:fs/promises';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { describe, expect, it } from 'vitest';

import config from '../../forge.config';

describe('Windows release configuration', () => {
  it('packages the app as an ASAR with the expected executable name', () => {
    expect(config.packagerConfig).toMatchObject({
      asar: true,
      executableName: 'personal-assistant',
    });
  });

  it('creates only the named Windows Squirrel installer', () => {
    const maker = config.makers?.[0] as unknown as {
      configOrConfigFetcher: { name: string; setupExe: string };
      platformsToMakeOn: string[];
    };

    expect(config.makers).toHaveLength(1);
    expect(maker.configOrConfigFetcher).toEqual({
      name: 'personal_assistant',
      setupExe: 'PersonalAssistantSetup.exe',
    });
    expect(maker.platformsToMakeOn).toEqual(['win32']);
  });

  it('pins every packaged release variant to Windows x64', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.package).toContain('electron-forge package --arch=x64');
    expect(packageJson.scripts['package:e2e']).toContain('electron-forge package --arch=x64');
    expect(packageJson.scripts.make).toContain('electron-forge make --arch=x64');
  });

  it('hardens the packaged Electron binary with the required production fuses', () => {
    const fusePlugin = config.plugins?.find((plugin) => plugin instanceof FusesPlugin);

    expect(fusePlugin).toBeInstanceOf(FusesPlugin);
    expect(fusePlugin?.fusesConfig).toMatchObject({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: true,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
    });
  });
});
