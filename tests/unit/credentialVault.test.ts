import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/shared/errors';
import { CredentialVault } from '../../src/main/security/credentialVault';

const directories: string[] = [];

const fakeEncryption = {
  isAvailable: async () => true,
  encrypt: async (value: string) => Buffer.from(`fake:v1:${Buffer.from(value).toString('base64')}`),
  decrypt: async (value: Buffer) => Buffer.from(value.toString().replace('fake:v1:', ''), 'base64').toString(),
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('CredentialVault', () => {
  it('never writes plaintext credentials', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'pa-vault-'));
    directories.push(directory);
    const vault = new CredentialVault(directory, fakeEncryption);

    await vault.set('deepseek-api-key', 'secret-value');

    const bytes = await readFile(path.join(directory, 'deepseek-api-key.bin'));
    expect(bytes.toString()).not.toContain('secret-value');
    await expect(vault.get('deepseek-api-key')).resolves.toBe('secret-value');
  });

  it('fails closed when encryption is unavailable', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'pa-vault-'));
    directories.push(directory);
    const vault = new CredentialVault(directory, {
      ...fakeEncryption,
      isAvailable: async () => false,
    });

    await expect(vault.set('google-refresh-token', 'token')).rejects.toMatchObject({
      code: 'CREDENTIAL_STORAGE_UNAVAILABLE',
    });
  });

  it('rejects traversal credential names before they affect the filesystem', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'pa-vault-'));
    directories.push(directory);
    const vault = new CredentialVault(directory, {
      ...fakeEncryption,
      isAvailable: async () => false,
    });
    const traversalName = '../credential-traversal' as 'deepseek-api-key';

    for (const operation of [
      () => vault.set(traversalName, 'secret-value'),
      () => vault.get(traversalName),
      () => vault.delete(traversalName),
    ]) {
      await expect(operation()).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        message: 'Unsupported credential name.',
      });
    }

    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it('does not decrypt or return a credential when encryption is unavailable', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'pa-vault-'));
    directories.push(directory);
    await writeFile(path.join(directory, 'deepseek-api-key.bin'), Buffer.from('encrypted-value'));
    let decryptCalled = false;
    const vault = new CredentialVault(directory, {
      ...fakeEncryption,
      isAvailable: async () => false,
      decrypt: async () => {
        decryptCalled = true;
        return 'secret-value';
      },
    });

    await expect(vault.get('deepseek-api-key')).resolves.toBeUndefined();
    expect(decryptCalled).toBe(false);
  });

  it('does not expose a credential when encryption fails', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'pa-vault-'));
    directories.push(directory);
    const secret = 'secret-value';
    const vault = new CredentialVault(directory, {
      ...fakeEncryption,
      encrypt: async () => {
        throw new Error(`could not secure ${secret}`);
      },
    });

    const error = await vault.set('deepseek-api-key', secret).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ code: 'CREDENTIAL_STORAGE_UNAVAILABLE' });
    expect((error as Error).message).not.toContain(secret);
  });

  it('does not expose a credential from an adapter AppError', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'pa-vault-'));
    directories.push(directory);
    const secret = 'secret-value';
    const vault = new CredentialVault(directory, {
      ...fakeEncryption,
      encrypt: async () => {
        throw new AppError('CREDENTIAL_STORAGE_UNAVAILABLE', `could not secure ${secret}`, false);
      },
    });

    const error = await vault.set('deepseek-api-key', secret).catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      code: 'CREDENTIAL_STORAGE_UNAVAILABLE',
      message: 'Windows credential encryption is unavailable.',
    });
    expect((error as Error).message).not.toContain(secret);
  });
});
