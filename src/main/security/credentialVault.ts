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

  private unavailableError(): AppError {
    return new AppError(
      'CREDENTIAL_STORAGE_UNAVAILABLE',
      'Windows credential encryption is unavailable.',
      false,
    );
  }

  private validateCredentialName(name: string): asserts name is CredentialName {
    if (name !== 'deepseek-api-key' && name !== 'google-refresh-token') {
      throw new AppError('VALIDATION_FAILED', 'Unsupported credential name.', false);
    }
  }

  private file(name: string): string {
    this.validateCredentialName(name);
    return path.join(this.directory, `${name}.bin`);
  }

  async set(name: CredentialName, value: string): Promise<void> {
    this.validateCredentialName(name);

    let encryptionAvailable: boolean;
    try {
      encryptionAvailable = await this.encryption.isAvailable();
    } catch {
      throw this.unavailableError();
    }

    if (!encryptionAvailable) {
      throw this.unavailableError();
    }

    try {
      const encrypted = await this.encryption.encrypt(value);
      await mkdir(this.directory, { recursive: true });
      await writeFile(this.file(name), encrypted, { mode: 0o600 });
    } catch {
      throw this.unavailableError();
    }
  }

  async get(name: CredentialName): Promise<string | undefined> {
    this.validateCredentialName(name);

    try {
      if (!(await this.encryption.isAvailable())) {
        return undefined;
      }

      return await this.encryption.decrypt(await readFile(this.file(name)));
    } catch {
      return undefined;
    }
  }

  async delete(name: CredentialName): Promise<void> {
    this.validateCredentialName(name);
    await rm(this.file(name), { force: true });
  }

  async deleteAll(): Promise<void> {
    await rm(this.directory, { recursive: true, force: true });
  }
}
