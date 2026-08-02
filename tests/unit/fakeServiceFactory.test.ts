import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeApplicationServices } from '../../src/main/testing/fakeServiceFactory';

const temporaryDirectories: string[] = [];

async function temporaryUserData(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'pa-e2e-factory-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { force: true, recursive: true })
  )));
});

describe('E2E fake application services', () => {
  it('drives deterministic setup, extraction, availability, and insertion through the real orchestrator', async () => {
    const userDataPath = await temporaryUserData();
    const fake = await createFakeApplicationServices(userDataPath, {
      conflictOnFirstApproval: false,
    });

    await expect(fake.orchestrator.getSetupStatus()).resolves.toEqual({
      hasDeepSeekApiKey: false,
      googleConnected: false,
      calendarReady: false,
    });
    await fake.orchestrator.saveDeepSeekApiKey('e2e-deepseek-key-123456789');
    await expect(readFile(path.join(userDataPath, 'e2e-deepseek-configured'), 'utf8'))
      .resolves.toBe('configured\n');
    await expect(fake.orchestrator.connectGoogle()).resolves.toEqual({
      hasDeepSeekApiKey: true,
      googleConnected: true,
      calendarReady: true,
    });

    const restarted = await createFakeApplicationServices(userDataPath, {
      conflictOnFirstApproval: false,
    });
    await expect(restarted.orchestrator.getSetupStatus()).resolves.toEqual({
      hasDeepSeekApiKey: true,
      googleConnected: true,
      calendarReady: true,
    });

    const conversation = await fake.orchestrator.sendMessage('Study React and answer emails');
    expect(conversation.tasks.map((task) => task.title)).toEqual([
      'Study React',
      'Answer emails',
    ]);

    const schedule = await fake.orchestrator.generateSchedule('2026-08-03');
    expect(schedule.busyPeriods).toEqual([{
      start: '2026-08-03T12:00:00+01:00',
      end: '2026-08-03T13:00:00+01:00',
      sourceCalendarId: 'primary',
    }]);
    expect(schedule.blocks.every((block) => (
      block.end <= '2026-08-03T12:00:00+01:00'
      || block.start >= '2026-08-03T13:00:00+01:00'
    ))).toBe(true);

    const approval = await fake.orchestrator.approveSchedule(
      schedule.blocks.filter((block) => block.selected).map((block) => block.id),
    );
    expect(approval.status).toBe('completed');
    expect(fake.insertedBlocks).toHaveLength(schedule.blocks.length);
  });

  it('records no inserts on a new conflict and succeeds only after reapproval', async () => {
    const fake = await createFakeApplicationServices(await temporaryUserData(), {
      conflictOnFirstApproval: true,
    });
    await fake.orchestrator.saveDeepSeekApiKey('e2e-deepseek-key-123456789');
    await fake.orchestrator.connectGoogle();
    await fake.orchestrator.sendMessage('Study React and answer emails');
    const schedule = await fake.orchestrator.generateSchedule('2026-08-03');

    const first = await fake.orchestrator.approveSchedule(
      schedule.blocks.filter((block) => block.selected).map((block) => block.id),
    );
    expect(first.status).toBe('conflict-detected');
    expect(fake.insertedBlocks).toEqual([]);
    if (first.status !== 'conflict-detected') throw new Error('Expected conflict');
    expect(first.schedule.blocks.every((block) => (
      block.end <= '2026-08-03T10:00:00+01:00'
      || block.start >= '2026-08-03T10:30:00+01:00'
    ))).toBe(true);

    const second = await fake.orchestrator.approveSchedule(
      first.schedule.blocks.filter((block) => block.selected).map((block) => block.id),
    );
    expect(second.status).toBe('completed');
    expect(fake.insertedBlocks).toHaveLength(first.schedule.blocks.length);
  });
});
