import { afterEach, describe, expect, it, vi } from 'vitest';

const originalE2EBuild = process.env.PA_E2E_BUILD;
const originalProductionBuild = process.env.PA_PRODUCTION;

afterEach(() => {
  if (originalE2EBuild === undefined) delete process.env.PA_E2E_BUILD;
  else process.env.PA_E2E_BUILD = originalE2EBuild;
  if (originalProductionBuild === undefined) delete process.env.PA_PRODUCTION;
  else process.env.PA_PRODUCTION = originalProductionBuild;
  vi.resetModules();
});

async function loadDefine(
  e2eBuild: string | undefined,
  productionBuild?: string,
): Promise<Record<string, string>> {
  if (e2eBuild === undefined) delete process.env.PA_E2E_BUILD;
  else process.env.PA_E2E_BUILD = e2eBuild;
  if (productionBuild === undefined) delete process.env.PA_PRODUCTION;
  else process.env.PA_PRODUCTION = productionBuild;
  vi.resetModules();
  const config = (await import('../../vite.main.config')).default;
  if (typeof config === 'function' || config instanceof Promise || Array.isArray(config)) {
    throw new Error('Expected an object Vite config');
  }
  return config.define as Record<string, string>;
}

describe('main-process Vite compile-time flags', () => {
  it('defines the E2E flag false unless explicitly enabled', async () => {
    await expect(loadDefine(undefined)).resolves.toMatchObject({ __PA_E2E_BUILD__: 'false' });
    await expect(loadDefine('0')).resolves.toMatchObject({ __PA_E2E_BUILD__: 'false' });
  });

  it('defines the E2E flag true only for PA_E2E_BUILD=1', async () => {
    await expect(loadDefine('1')).resolves.toMatchObject({ __PA_E2E_BUILD__: 'true' });
  });

  it('defines production security true only for a non-E2E production build', async () => {
    await expect(loadDefine(undefined, '1')).resolves.toMatchObject({
      __PA_PRODUCTION_BUILD__: 'true',
    });
    await expect(loadDefine('1', '1')).resolves.toMatchObject({
      __PA_PRODUCTION_BUILD__: 'false',
    });
  });
});
