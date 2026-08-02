import { describe, expect, it } from 'vitest';
import { validateDraft } from '../../src/main/scheduler/validateDraft';
import type { AppSettings, BusyPeriod, ScheduleBlock } from '../../src/shared/domain';

const targetDate = '2026-08-01';
const settings: AppSettings = {
  version: 1,
  timeZone: 'Europe/London',
  workingHours: { start: '09:00', end: '17:00' },
  workingDays: [0, 1, 2, 3, 4, 5, 6],
  breakAfterMinutes: 60,
  breakDurationMinutes: 15,
};

function block(overrides: Partial<ScheduleBlock> = {}): ScheduleBlock {
  return {
    id: 'block-1',
    kind: 'task',
    taskId: 'task-1',
    title: 'Study React',
    start: '2026-08-01T09:00:00+01:00',
    end: '2026-08-01T10:00:00+01:00',
    selected: true,
    ...overrides,
  };
}

function busy(start: string, end: string): BusyPeriod {
  return { start, end, sourceCalendarId: 'primary' };
}

describe('validateDraft', () => {
  it('rejects a selected block before 09:00 London time', () => {
    expect(validateDraft([
      block({ start: '2026-08-01T08:59:00+01:00', end: '2026-08-01T09:30:00+01:00' }),
    ], [], targetDate, settings)).toEqual({
      valid: false,
      errors: [{ blockId: 'block-1', message: 'Block is outside working hours.' }],
      warnings: [],
    });
  });

  it('rejects a selected block ending after 17:00 London time', () => {
    expect(validateDraft([
      block({ start: '2026-08-01T16:30:00+01:00', end: '2026-08-01T17:01:00+01:00' }),
    ], [], targetDate, settings)).toEqual({
      valid: false,
      errors: [{ blockId: 'block-1', message: 'Block is outside working hours.' }],
      warnings: [],
    });
  });

  it('accepts blocks exactly touching the 09:00 and 17:00 working-hour boundaries', () => {
    expect(validateDraft([
      block({ id: 'first', start: '2026-08-01T09:00:00+01:00', end: '2026-08-01T10:00:00+01:00' }),
      block({ id: 'second', start: '2026-08-01T16:00:00+01:00', end: '2026-08-01T17:00:00+01:00' }),
    ], [], targetDate, settings)).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it('checks the target date in Europe/London rather than the timestamp offset', () => {
    expect(validateDraft([
      block({ start: '2026-08-01T08:00:00+00:00', end: '2026-08-01T09:00:00+00:00' }),
    ], [], targetDate, settings)).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it('rejects a selected block that falls on another London local date', () => {
    expect(validateDraft([
      block({ start: '2026-08-01T23:30:00-01:00', end: '2026-08-02T00:30:00-01:00' }),
    ], [], targetDate, settings)).toEqual({
      valid: false,
      errors: [{ blockId: 'block-1', message: 'Block is not on the selected date.' }],
      warnings: [],
    });
  });

  it.each([
    ['zero', '2026-08-01T10:00:00+01:00'],
    ['negative', '2026-08-01T09:30:00+01:00'],
  ])('rejects a selected block with %s duration', (_name, end) => {
    expect(validateDraft([
      block({ start: '2026-08-01T10:00:00+01:00', end }),
    ], [], targetDate, settings)).toEqual({
      valid: false,
      errors: [{ blockId: 'block-1', message: 'Block must have a positive duration.' }],
      warnings: [],
    });
  });

  it('rejects a selected block shorter than five minutes', () => {
    expect(validateDraft([
      block({ end: '2026-08-01T09:01:00+01:00' }),
    ], [], targetDate, settings)).toEqual({
      valid: false,
      errors: [{ blockId: 'block-1', message: 'Block must be at least five minutes long.' }],
      warnings: [],
    });
  });

  it('accepts arbitrary whole-minute boundaries and durations from the automatic scheduler', () => {
    expect(validateDraft([
      block({ id: 'task', start: '2026-08-01T09:03:00+01:00', end: '2026-08-01T10:04:00+01:00' }),
      block({
        id: 'break',
        kind: 'break',
        taskId: undefined,
        title: 'Break',
        start: '2026-08-01T10:04:00+01:00',
        end: '2026-08-01T10:19:00+01:00',
      }),
    ], [], targetDate, settings)).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it.each([
    ['non-zero seconds', '2026-08-01T09:00:30+01:00', '2026-08-01T10:00:30+01:00'],
    ['non-zero milliseconds', '2026-08-01T09:00:00.001+01:00', '2026-08-01T10:00:00.001+01:00'],
  ])('rejects selected block %s outside whole-minute boundaries', (_name, start, end) => {
    expect(validateDraft([block({ start, end })], [], targetDate, settings)).toEqual({
      valid: false,
      errors: [{
        blockId: 'block-1',
        message: 'Block times and duration must use whole-minute increments.',
      }],
      warnings: [],
    });
  });

  it('rejects malformed selected timestamps without throwing', () => {
    expect(validateDraft([
      block({ start: 'not-a-timestamp' as never }),
    ], [], targetDate, settings)).toEqual({
      valid: false,
      errors: [{ blockId: 'block-1', message: 'Block has an invalid start or end time.' }],
      warnings: [],
    });
  });

  it('rejects a selected block that overlaps a current Google busy period', () => {
    expect(validateDraft([
      block(),
    ], [busy('2026-08-01T09:30:00+01:00', '2026-08-01T10:30:00+01:00')], targetDate, settings)).toEqual({
      valid: false,
      errors: [{ blockId: 'block-1', message: 'Block overlaps a busy calendar period.' }],
      warnings: [],
    });
  });

  it('treats busy and selected intervals that only touch as non-overlapping', () => {
    expect(validateDraft([
      block(),
    ], [busy('2026-08-01T10:00:00+01:00', '2026-08-01T11:00:00+01:00')], targetDate, settings)).toEqual({
      valid: true,
      errors: [],
      warnings: [],
    });
  });

  it('rejects every selected block sharing an ID', () => {
    expect(validateDraft([
      block(),
      block({ start: '2026-08-01T10:00:00+01:00', end: '2026-08-01T11:00:00+01:00' }),
    ], [], targetDate, settings)).toEqual({
      valid: false,
      errors: [
        { blockId: 'block-1', message: 'Selected block IDs must be unique.' },
        { blockId: 'block-1', message: 'Selected block IDs must be unique.' },
      ],
      warnings: [],
    });
  });

  it('rejects selected blocks that overlap each other', () => {
    expect(validateDraft([
      block({ id: 'first', end: '2026-08-01T10:00:00+01:00' }),
      block({ id: 'second', start: '2026-08-01T09:30:00+01:00', end: '2026-08-01T10:30:00+01:00' }),
    ], [], targetDate, settings)).toEqual({
      valid: false,
      errors: [
        { blockId: 'first', message: 'Selected blocks overlap.' },
        { blockId: 'second', message: 'Selected blocks overlap.' },
      ],
      warnings: [],
    });
  });

  it('allows deselected blocks to overlap selected blocks because they are not inserted', () => {
    expect(validateDraft([
      block(),
      block({ id: 'deselected', selected: false, start: '2026-08-01T09:30:00+01:00', end: '2026-08-01T10:30:00+01:00' }),
    ], [], targetDate, settings)).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it('warns instead of rejecting when a selected task over 60 minutes has no adjacent selected 15-minute break', () => {
    expect(validateDraft([
      block({ end: '2026-08-01T10:30:00+01:00' }),
    ], [], targetDate, settings)).toEqual({
      valid: true,
      errors: [],
      warnings: [{ blockId: 'block-1', message: 'Long task is missing its required adjacent break.' }],
    });
  });

  it('does not warn when a selected long task has its immediately following selected 15-minute break', () => {
    expect(validateDraft([
      block({ id: 'task', end: '2026-08-01T10:30:00+01:00' }),
      block({
        id: 'break',
        kind: 'break',
        taskId: undefined,
        title: 'Break',
        start: '2026-08-01T10:30:00+01:00',
        end: '2026-08-01T10:45:00+01:00',
      }),
    ], [], targetDate, settings)).toEqual({ valid: true, errors: [], warnings: [] });
  });
});
