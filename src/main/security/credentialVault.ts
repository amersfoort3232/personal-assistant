import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../../shared/errors';
import type { EncryptionAdapter } from './encryptionAdapter';

export type CredentialName = 'deepseek-api-key' | 'google-refresh-token';

export class CredentialVault {
  constructor(
    private readonly directory: string,
    private readonly encryption: EncryptionAdapter,
  ) {}

  private file(name: CredentialName): string {
    return path.join(this.directory, `${name}.bin`);
  }

  async set(name: CredentialName, value: string): Promise<void> {
    try {
      if (!(await this.encryption.isAvailable())) {
        throw new AppError(
          'CREDENTIAL_STORAGE_UNAVAILABLE',
          'Windows credential encryption is unavailable.',
          false,
        );
      }

      const encrypted = await this.encryption.encrypt(value);
      await mkdir(this.directory, { recursive: true });
      await writeFile(this.file(name), encrypted, { mode: 0o600 });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        'CREDENTIAL_STORAGE_UNAVAILABLE',
        'Windows credential encryption is unavailable.',
        false,
      );
    }
  }

  async get(name: CredentialName): Promise<string | undefined> {
    try {
      return await this.encryption.decrypt(await readFile(this.file(name)));
    } catch {
      return undefined;
    }
  }

  async delete(name: CredentialName): Promise<void> {
    await rm(this.file(name), { force: true });
  }

  async deleteAll(): Promise<void> {
    await rm(this.directory, { recursive: true, force: true });
  }
}
