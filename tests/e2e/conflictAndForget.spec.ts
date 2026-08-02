import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { completeFakeSetup, launchE2EApp } from './electronTestApp';

const CONFLICT_MESSAGE = 'Your calendar changed after this schedule was created. No events were added. Review the revised schedule.';

test('a new conflict writes nothing until the revised schedule is reapproved', async ({}, testInfo) => {
  const testUserDataPath = testInfo.outputPath('user-data');
  await mkdir(testUserDataPath, { recursive: true });
  const app = await launchE2EApp(testUserDataPath, { conflictOnApproval: true });

  try {
    const page = await app.firstWindow();
    await completeFakeSetup(page);
    await page.getByLabel('Daily goals and tasks').fill('Study React and answer emails');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.getByLabel('Schedule date').fill('2026-08-03');
    await page.getByRole('button', { name: 'Build schedule' }).click();
    await page.getByRole('button', { name: /Approve \d+ selected blocks/u }).click();

    await expect(page.getByRole('alert').filter({ hasText: CONFLICT_MESSAGE })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Calendar results' })).toHaveCount(0);
    await expect(page.getByText('Created successfully', { exact: true })).toHaveCount(0);

    const starts = await page.getByLabel(/^Start time for /u).all();
    const ends = await page.getByLabel(/^End time for /u).all();
    expect(starts).toHaveLength(ends.length);
    for (let index = 0; index < starts.length; index += 1) {
      const start = await starts[index].inputValue();
      const end = await ends[index].inputValue();
      expect(end <= '10:00' || start >= '10:30').toBe(true);
    }

    await page.getByRole('button', { name: /Approve \d+ selected blocks/u }).click();
    await expect(page.getByRole('heading', { name: 'Calendar results' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Created events' })).toBeVisible();
  } finally {
    await app.close();
  }
});
