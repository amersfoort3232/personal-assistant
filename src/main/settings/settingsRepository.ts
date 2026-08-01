import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppSettings } from '../../shared/domain';
import { appSettingsSchema } from '../../shared/schemas';
import { DEFAULT_SETTINGS } from './defaultSettings';

export class SettingsRepository {
  private readonly filePath: string;

  constructor(private readonly userDataPath: string) {
    this.filePath = path.join(userDataPath, 'settings.json');
  }

  async load(): Promise<AppSettings> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8'));
      return appSettingsSchema.parse(parsed);
    } catch {
      await this.save(DEFAULT_SETTINGS);
      return structuredClone(DEFAULT_SETTINGS);
    }
  }

  async save(settings: AppSettings): Promise<void> {
    const safe = appSettingsSchema.parse(settings);
    await mkdir(this.userDataPath, { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(safe, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.filePath);
  }
}
