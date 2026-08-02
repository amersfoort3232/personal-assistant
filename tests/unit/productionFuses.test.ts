import electronFuses, { type FuseConfig } from '@electron/fuses';
import { describe, expect, it } from 'vitest';
import { assertRequiredProductionFuses } from '../../scripts/verify-production-fuses.mjs';

const { FuseV1Options, FuseVersion } = electronFuses;
const DISABLED = 0x30;
const ENABLED = 0x31;

function secureFuseConfig(): FuseConfig<number> {
  return {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: DISABLED,
    [FuseV1Options.EnableCookieEncryption]: ENABLED,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: DISABLED,
    [FuseV1Options.EnableNodeCliInspectArguments]: DISABLED,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: ENABLED,
    [FuseV1Options.OnlyLoadAppFromAsar]: ENABLED,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: DISABLED,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: ENABLED,
  };
}

describe('production fuse verification', () => {
  it('accepts the required hardened fuse states', () => {
    expect(() => assertRequiredProductionFuses(secureFuseConfig())).not.toThrow();
  });

  it('rejects an unsafe required fuse state', () => {
    const config = secureFuseConfig();
    config[FuseV1Options.RunAsNode] = ENABLED;

    expect(() => assertRequiredProductionFuses(config)).toThrow(/RunAsNode/u);
  });
});
