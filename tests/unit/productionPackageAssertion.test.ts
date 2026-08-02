import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPackage } from '@electron/asar';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertProductionAsar,
  productionCredentialValues,
} from '../../scripts/assert-production-package.mjs';

const temporaryDirectories: string[] = [];

async function makeAsar(mainSource: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'pa-production-asar-'));
  temporaryDirectories.push(root);
  const source = path.join(root, 'source');
  const asarPath = path.join(root, 'app.asar');
  await import('node:fs/promises').then(({ mkdir, writeFile }) => (
    mkdir(path.join(source, '.vite', 'build'), { recursive: true }).then(() => (
      writeFile(path.join(source, '.vite', 'build', 'main.js'), mainSource)
    ))
  ));
  await createPackage(source, asarPath);
  return asarPath;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { force: true, recursive: true })
  )));
});

describe('production package assertion', () => {
  it('checks runtime credentials but treats the Desktop OAuth secret as build configuration', () => {
    expect(productionCredentialValues({
      DEEPSEEK_API_KEY: 'deepseek-secret',
      GOOGLE_OAUTH_CLIENT_SECRET: 'desktop-client-configuration',
      GOOGLE_REFRESH_TOKEN: 'google-refresh-token',
    })).toEqual(['deepseek-secret', 'google-refresh-token']);
  });

  it('accepts an ASAR without test-only code or supplied credentials', async () => {
    const asarPath = await makeAsar('console.log("production");');
    await expect(assertProductionAsar(asarPath, ['a-secret-value'])).resolves.toBeUndefined();
  });

  it.each([
    ['fake module name', 'fakeServiceFactory'],
    ['fixed E2E task marker', 'PA_E2E_FIXED_TASK_STUDY_REACT'],
    ['fixed E2E task title', 'Study React'],
    ['second fixed E2E task title', 'Answer emails'],
    ['placeholder fake key', 'pa-e2e-placeholder-key-never-persisted'],
    ['supplied credential', 'a-secret-value'],
  ])('rejects an ASAR containing a %s', async (_label, forbiddenText) => {
    const asarPath = await makeAsar(`export const value = ${JSON.stringify(forbiddenText)};`);
    await expect(assertProductionAsar(asarPath, ['a-secret-value'])).rejects.toThrow(
      /Production ASAR contains forbidden content/u,
    );
  });
});
