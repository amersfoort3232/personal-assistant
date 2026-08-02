import electronFuses from '@electron/fuses';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { FuseV1Options, FuseVersion, getCurrentFuseWire } = electronFuses;
const DISABLED = 0x30;
const ENABLED = 0x31;

const REQUIRED_FUSES = [
  ['RunAsNode', FuseV1Options.RunAsNode, DISABLED],
  ['EnableCookieEncryption', FuseV1Options.EnableCookieEncryption, ENABLED],
  [
    'EnableNodeOptionsEnvironmentVariable',
    FuseV1Options.EnableNodeOptionsEnvironmentVariable,
    DISABLED,
  ],
  [
    'EnableNodeCliInspectArguments',
    FuseV1Options.EnableNodeCliInspectArguments,
    DISABLED,
  ],
  [
    'EnableEmbeddedAsarIntegrityValidation',
    FuseV1Options.EnableEmbeddedAsarIntegrityValidation,
    ENABLED,
  ],
  ['OnlyLoadAppFromAsar', FuseV1Options.OnlyLoadAppFromAsar, ENABLED],
  [
    'LoadBrowserProcessSpecificV8Snapshot',
    FuseV1Options.LoadBrowserProcessSpecificV8Snapshot,
    DISABLED,
  ],
  [
    'GrantFileProtocolExtraPrivileges',
    FuseV1Options.GrantFileProtocolExtraPrivileges,
    ENABLED,
  ],
];

export function assertRequiredProductionFuses(fuseConfig) {
  if (fuseConfig.version !== FuseVersion.V1) {
    throw new Error(`Unexpected production fuse version: ${String(fuseConfig.version)}`);
  }

  for (const [name, option, requiredState] of REQUIRED_FUSES) {
    if (fuseConfig[option] !== requiredState) {
      throw new Error(`Production fuse ${name} is not in the required state.`);
    }
  }
}

async function findDefaultExecutable() {
  const executable = path.resolve(
    'out',
    'Personal Assistant-win32-x64',
    'personal-assistant.exe',
  );
  await access(executable);
  return executable;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  const executable = process.argv[2]
    ? path.resolve(process.argv[2])
    : await findDefaultExecutable();
  const fuseConfig = await getCurrentFuseWire(executable);
  assertRequiredProductionFuses(fuseConfig);
  process.stdout.write(`Production fuses passed: ${executable}\n`);
}
