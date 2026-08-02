import { describe, expect, it } from 'vitest';
import {
  appSettingsSchema,
  ipcRequestSchemas,
  proposedTaskSchema,
  scheduleBlockSchema,
} from '../../src/shared/schemas';

describe('domain schemas', () => {
  it('accepts a complete proposed task', () => {
    expect(
      proposedTaskSchema.parse({
        id: 'task-1',
        title: 'Study React',
        durationMinutes: 120,
        durationWasEstimated: true,
        priority: 'high',
        deadline: '2026-08-01T16:00:00+01:00',
        canSplit: true,
        minimumSessionMinutes: 30,
      }),
    ).toMatchObject({ title: 'Study React', durationMinutes: 120 });
  });

  it('rejects unknown properties and impossible durations', () => {
    expect(() =>
      proposedTaskSchema.parse({
        id: 'task-1',
        title: 'Study React',
        durationMinutes: -10,
        durationWasEstimated: true,
        priority: 'high',
        canSplit: true,
        minimumSessionMinutes: 30,
        inventedField: 'unsafe',
      }),
    ).toThrow();
  });

  it('rejects a minimum session longer than the task', () => {
    const result = proposedTaskSchema.safeParse({
      id: 'task-1',
      title: 'Email',
      durationMinutes: 20,
      durationWasEstimated: false,
      priority: 'medium',
      canSplit: true,
      minimumSessionMinutes: 30,
    });
    expect(result.success).toBe(false);
  });

  it('accepts a fixed local start time and rejects an invalid one', () => {
    const completeTask = {
      id: 'task-1',
      title: 'Leave for RVI hospital',
      durationMinutes: 30,
      durationWasEstimated: true,
      priority: 'high',
      canSplit: false,
      minimumSessionMinutes: 15,
    };

    expect(proposedTaskSchema.parse({ ...completeTask, fixedStartTime: '11:00' }))
      .toMatchObject({ fixedStartTime: '11:00' });
    expect(proposedTaskSchema.safeParse({ ...completeTask, fixedStartTime: '25:00' }).success)
      .toBe(false);
  });

  it('locks settings to approved MVP defaults', () => {
    expect(
      appSettingsSchema.parse({
        version: 1,
        timeZone: 'Europe/London',
        workingHours: { start: '09:00', end: '17:00' },
        workingDays: [0, 1, 2, 3, 4, 5, 6],
        breakAfterMinutes: 60,
        breakDurationMinutes: 15,
      }),
    ).toBeTruthy();
  });

  it('requires task blocks to include a task id', () => {
    expect(
      scheduleBlockSchema.safeParse({
        id: 'block-1',
        kind: 'task',
        title: 'Study',
        start: '2026-08-01T09:00:00+01:00',
        end: '2026-08-01T10:00:00+01:00',
        selected: true,
      }).success,
    ).toBe(false);
  });
});

describe('IPC request schemas', () => {
  it('rejects an empty message', () => {
    expect(() => ipcRequestSchemas.sendMessage.parse({ text: '   ' })).toThrow();
  });

  it('rejects more than one hundred approved block ids', () => {
    expect(() =>
      ipcRequestSchemas.approveSchedule.parse({
        blockIds: Array.from({ length: 101 }, (_, index) => `block-${index}`),
      }),
    ).toThrow();
  });

  it('rejects unknown update-schedule fields', () => {
    expect(() =>
      ipcRequestSchemas.updateSchedule.parse({
        blocks: [],
        unsafe: true,
      }),
    ).toThrow();
  });
});
