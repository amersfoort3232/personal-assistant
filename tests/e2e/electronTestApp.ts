import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import path from 'node:path';

export async function launchE2EApp(
  userDataPath: string,
  options: { conflictOnApproval?: boolean } = {},
): Promise<ElectronApplication> {
  if (!path.isAbsolute(userDataPath)) {
    throw new Error('E2E user-data path must be absolute.');
  }

  return electron.launch({
    args: [path.resolve('.vite', 'build', 'main.js')],
    env: {
      ...process.env,
      PA_E2E_CONFLICT_ON_APPROVAL: options.conflictOnApproval ? '1' : '0',
      PA_TEST_USER_DATA_PATH: userDataPath,
    },
  });
}

export async function completeFakeSetup(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Finish setup' })).toBeVisible();
  await page.getByLabel('DeepSeek API key').fill('e2e-deepseek-key-123456789');
  await page.getByRole('button', { name: 'Save API key' }).click();
  await page.getByRole('button', { name: 'Connect Google Calendar' }).click();
  await expect(page.getByRole('heading', { name: 'Plan your day' })).toBeVisible();
}
