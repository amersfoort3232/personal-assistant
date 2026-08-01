import { DateTime } from 'luxon';
import type { AppSettings, BusyPeriod } from '../../shared/domain';

export type NumericInterval = { startMs: number; endMs: number };
export type WorkingWindow = { start: DateTime; end: DateTime };

export function buildWorkingWindow(
  targetDate: string,
  settings: AppSettings,
): WorkingWindow {
  const date = DateTime.fromISO(targetDate, { zone: settings.timeZone });
  const [startHour, startMinute] = settings.workingHours.start.split(':').map(Number);
  const [endHour, endMinute] = settings.workingHours.end.split(':').map(Number);

  return {
    start: date.set({ hour: startHour, minute: startMinute, second: 0, millisecond: 0 }),
    end: date.set({ hour: endHour, minute: endMinute, second: 0, millisecond: 0 }),
  };
}

export function mergeBusyPeriods(
  periods: BusyPeriod[],
  window: WorkingWindow,
): NumericInterval[] {
  if (!isValidWindow(window)) return [];

  const parsed = periods.flatMap(({ start, end }) => {
    const startDateTime = DateTime.fromISO(start, { setZone: true });
    const endDateTime = DateTime.fromISO(end, { setZone: true });
    if (!startDateTime.isValid || !endDateTime.isValid) return [];

    return [{ startMs: startDateTime.toMillis(), endMs: endDateTime.toMillis() }];
  });

  return normalizeIntervals(parsed, window);
}

export function deriveFreeIntervals(
  window: WorkingWindow,
  busyIntervals: NumericInterval[],
): NumericInterval[] {
  if (!isValidWindow(window)) return [];

  const busy = normalizeIntervals(busyIntervals, window);
  const free: NumericInterval[] = [];
  let cursor = window.start.toMillis();

  for (const interval of busy) {
    if (cursor < interval.startMs) {
      free.push({ startMs: cursor, endMs: interval.startMs });
    }
    cursor = Math.max(cursor, interval.endMs);
  }

  const windowEnd = window.end.toMillis();
  if (cursor < windowEnd) {
    free.push({ startMs: cursor, endMs: windowEnd });
  }

  return free;
}

export function intervalsOverlap(a: NumericInterval, b: NumericInterval): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

function normalizeIntervals(
  intervals: NumericInterval[],
  window: WorkingWindow,
): NumericInterval[] {
  const windowStart = window.start.toMillis();
  const windowEnd = window.end.toMillis();

  const clipped = intervals
    .map(({ startMs, endMs }, index) => ({
      startMs: Math.max(startMs, windowStart),
      endMs: Math.min(endMs, windowEnd),
      index,
    }))
    .filter(({ startMs, endMs }) => Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs)
    .sort((a, b) => a.startMs - b.startMs || a.index - b.index);

  return clipped.reduce<NumericInterval[]>((merged, { startMs, endMs }) => {
    const previous = merged.at(-1);
    if (!previous || startMs > previous.endMs) {
      merged.push({ startMs, endMs });
    } else {
      previous.endMs = Math.max(previous.endMs, endMs);
    }
    return merged;
  }, []);
}

function isValidWindow(window: WorkingWindow): boolean {
  if (!window.start.isValid || !window.end.isValid) return false;

  const startMs = window.start.toMillis();
  const endMs = window.end.toMillis();
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs;
}
