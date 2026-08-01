import { safeStorage } from 'electron';

export interface EncryptionAdapter {
  isAvailable(): Promise<boolean>;
  encrypt(value: string): Promise<Buffer>;
  decrypt(value: Buffer): Promise<string>;
}

export const electronEncryptionAdapter: EncryptionAdapter = {
  async isAvailable() {
    return safeStorage.isEncryptionAvailable();
  },
  async encrypt(value) {
    return safeStorage.encryptString(value);
  },
  async decrypt(value) {
    return safeStorage.decryptString(value);
  },
};
