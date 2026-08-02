import { describe, expect, it } from 'vitest';
import type { AppSettings, BusyPeriod } from '../../src/shared/domain';
import {
  buildWorkingWindow,
  deriveFreeIntervals,
  intervalsOverlap,
  mergeBusyPeriods,
} from '../../src/main/scheduler/intervals';

const settings: AppSettings = {
  version: 1,
  timeZone: 'Europe/London',
  workingHours: { start: '09:00', end: '17:00' },
  workingDays: [0, 1, 2, 3, 4, 5, 6],
  breakAfterMinutes: 60,
  breakDurationMinutes: 15,
};

const window = buildWorkingWindow('2026-08-01', settings);

describe('calendar intervals', () => {
  it('clips busy periods to the working window and discards empty or invalid periods', () => {
    const periods = [
      { start: '2026-08-01T08:30:00+01:00', end: '2026-08-01T09:15:00+01:00', sourceCalendarId: 'primary' },
      { start: '2026-08-01T16:45:00+01:00', end: '2026-08-01T17:15:00+01:00', sourceCalendarId: 'assistant' },
      { start: '2026-08-01T17:00:00+01:00', end: '2026-08-01T18:00:00+01:00', sourceCalendarId: 'primary' },
      { start: '2026-08-01T12:00:00+01:00', end: '2026-08-01T12:00:00+01:00', sourceCalendarId: 'primary' },
      { start: 'not-a-date', end: '2026-08-01T12:00:00+01:00', sourceCalendarId: 'primary' },
    ] as BusyPeriod[];

    expect(mergeBusyPeriods(periods, window)).toEqual([
      { startMs: 1785571200000, endMs: 1785572100000 },
      { startMs: 1785599100000, endMs: 1785600000000 },
    ]);
  });

  it('merges unordered overlapping and touching busy intervals', () => {
    const merged = mergeBusyPeriods([
      { start: '2026-08-01T10:00:00+01:00', end: '2026-08-01T11:00:00+01:00', sourceCalendarId: 'primary' },
      { start: '2026-08-01T09:30:00+01:00', end: '2026-08-01T10:00:00+01:00', sourceCalendarId: 'assistant' },
      { start: '2026-08-01T09:00:00+01:00', end: '2026-08-01T09:45:00+01:00', sourceCalendarId: 'primary' },
    ], window);

    expect(merged).toEqual([{ startMs: 1785571200000, endMs: 1785578400000 }]);
  });

  it('creates free time only inside 09:00-17:00', () => {
    const free = deriveFreeIntervals(window, [
      { startMs: 1785573000000, endMs: 1785578400000 },
    ]);

    expect(free).toEqual([
      { startMs: 1785571200000, endMs: 1785573000000 },
      { startMs: 1785578400000, endMs: 1785600000000 },
    ]);
  });

  it('treats intervals that only touch as non-overlapping', () => {
    expect(intervalsOverlap(
      { startMs: 1785571200000, endMs: 1785574800000 },
      { startMs: 1785574800000, endMs: 1785578400000 },
    )).toBe(false);
    expect(intervalsOverlap(
      { startMs: 1785571200000, endMs: 1785574800000 },
      { startMs: 1785573000000, endMs: 1785578400000 },
    )).toBe(true);
  });

  it('uses the correct UK offset across daylight-saving dates', () => {
    expect(buildWorkingWindow('2026-01-15', settings).start.toISO()).toBe('2026-01-15T09:00:00.000+00:00');
    expect(buildWorkingWindow('2026-08-01', settings).start.toISO()).toBe('2026-08-01T09:00:00.000+01:00');
  });

  it('returns no numeric intervals when the working window is invalid', () => {
    const invalidWindow = buildWorkingWindow('not-a-date', settings);

    expect(mergeBusyPeriods([
      { start: '2026-08-01T09:00:00+01:00', end: '2026-08-01T10:00:00+01:00', sourceCalendarId: 'primary' },
    ], invalidWindow)).toEqual([]);
    expect(deriveFreeIntervals(invalidWindow, [{ startMs: 1, endMs: 2 }])).toEqual([]);
  });
});
