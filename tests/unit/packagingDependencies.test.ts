import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

type PackageMetadata = {
  name?: unknown;
  version?: unknown;
};

describe('Node 24 packaging dependencies', () => {
  it('resolves Electron Packager extraction to its Node 24-compatible replacement', async () => {
    const packagerEntry = createRequire(import.meta.url).resolve('@electron/packager');
    const extractorEntry = createRequire(packagerEntry).resolve('extract-zip');
    const metadata = JSON.parse(
      await readFile(path.join(path.dirname(extractorEntry), 'package.json'), 'utf8'),
    ) as PackageMetadata;

    expect(metadata).toMatchObject({
      name: '@electron-internal/extract-zip',
      version: '1.0.5',
    });
  });
});
