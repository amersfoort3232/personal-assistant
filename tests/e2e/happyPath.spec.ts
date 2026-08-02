import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { completeFakeSetup, launchE2EApp } from './electronTestApp';

test('plans, approves, and forgets the session after restart', async ({}, testInfo) => {
  const testUserDataPath = testInfo.outputPath('user-data');
  await mkdir(testUserDataPath, { recursive: true });
  const input = 'Study React and answer emails';

  const firstApp = await launchE2EApp(testUserDataPath);
  try {
    const page = await firstApp.firstWindow();
    await completeFakeSetup(page);
    await page.getByLabel('Daily goals and tasks').fill(input);
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('group', { name: 'Study React', exact: true })).toBeVisible();

    const duration = page.getByLabel('Duration (minutes)', { exact: true }).first();
    await duration.fill('75');
    await page.getByRole('button', { name: 'Save Study React' }).click();
    await expect(duration).toHaveValue('75');

    await page.getByLabel('Schedule date').fill('2026-08-03');
    await page.getByRole('button', { name: 'Build schedule' }).click();
    await expect(page.getByRole('heading', { name: 'Review your schedule' })).toBeVisible();

    await page.getByLabel('Start time for Study React').fill('09:15');
    await page.getByLabel('End time for Study React').fill('10:00');
    await expect(page.getByLabel('Start time for Study React')).toHaveValue('09:15');
    await expect(page.getByLabel('End time for Study React')).toHaveValue('10:00');

    await page.getByRole('button', { name: /Approve \d+ selected blocks/u }).click();
    await expect(page.getByRole('heading', { name: 'Calendar results' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Created events' })).toBeVisible();
  } finally {
    await firstApp.close();
  }

  const secondApp = await launchE2EApp(testUserDataPath);
  try {
    const page = await secondApp.firstWindow();
    await expect(page.getByRole('heading', { name: 'Plan your day' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Finish setup' })).toHaveCount(0);
    await expect(page.getByText('Study React', { exact: true })).toHaveCount(0);
    await expect(page.getByText(input, { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Daily goals and tasks')).toHaveValue('');
  } finally {
    await secondApp.close();
  }
});
