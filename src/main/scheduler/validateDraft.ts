import { DateTime } from 'luxon';
import type { AppSettings, BusyPeriod, ScheduleBlock } from '../../shared/domain';
import { buildWorkingWindow, intervalsOverlap, type NumericInterval } from './intervals';

export type DraftValidationResult = {
  valid: boolean;
  errors: Array<{ blockId: string; message: string }>;
  warnings: Array<{ blockId: string; message: string }>;
};

type ParsedBlock = {
  block: ScheduleBlock;
  index: number;
  start: DateTime;
  end: DateTime;
  interval: NumericInterval;
};

const INVALID_TIME_MESSAGE = 'Block has an invalid start or end time.';
const POSITIVE_DURATION_MESSAGE = 'Block must have a positive duration.';
const WRONG_DATE_MESSAGE = 'Block is not on the selected date.';
const OUTSIDE_WORKING_HOURS_MESSAGE = 'Block is outside working hours.';
const BUSY_OVERLAP_MESSAGE = 'Block overlaps a busy calendar period.';
const SELECTED_ID_MESSAGE = 'Selected block IDs must be unique.';
const SELECTED_OVERLAP_MESSAGE = 'Selected blocks overlap.';
const MISSING_BREAK_MESSAGE = 'Long task is missing its required adjacent break.';

export function validateDraft(
  blocks: ScheduleBlock[],
  busyPeriods: BusyPeriod[],
  targetDate: string,
  settings: AppSettings,
): DraftValidationResult {
  const errors: DraftValidationResult['errors'] = [];
  const warnings: DraftValidationResult['warnings'] = [];
  const selected = blocks.filter((block) => block.selected);
  const window = buildWorkingWindow(targetDate, settings);
  const parsed: ParsedBlock[] = [];

  for (const [index, block] of selected.entries()) {
    const start = parseTimestamp(block.start);
    const end = parseTimestamp(block.end);
    if (!start || !end) {
      errors.push({ blockId: block.id, message: INVALID_TIME_MESSAGE });
      continue;
    }

    const startMs = start.toMillis();
    const endMs = end.toMillis();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      errors.push({ blockId: block.id, message: INVALID_TIME_MESSAGE });
      continue;
    }
    if (endMs <= startMs) {
      errors.push({ blockId: block.id, message: POSITIVE_DURATION_MESSAGE });
      continue;
    }

    const localStart = start.setZone(settings.timeZone);
    const localEnd = end.setZone(settings.timeZone);
    if (localStart.toISODate() !== targetDate || localEnd.toISODate() !== targetDate) {
      errors.push({ blockId: block.id, message: WRONG_DATE_MESSAGE });
      continue;
    }
    if (!window.start.isValid || !window.end.isValid || startMs < window.start.toMillis() || endMs > window.end.toMillis()) {
      errors.push({ blockId: block.id, message: OUTSIDE_WORKING_HOURS_MESSAGE });
      continue;
    }

    parsed.push({ block, index, start, end, interval: { startMs, endMs } });
  }

  addDuplicateIdErrors(selected, errors);
  addBusyOverlapErrors(parsed, busyPeriods, errors);
  addSelectedOverlapErrors(parsed, errors);
  addMissingBreakWarnings(parsed, settings, warnings);

  return { valid: errors.length === 0, errors, warnings };
}

function parseTimestamp(value: unknown): DateTime | undefined {
  if (typeof value !== 'string') return undefined;

  const parsed = DateTime.fromISO(value, { setZone: true });
  return parsed.isValid ? parsed : undefined;
}

function addDuplicateIdErrors(
  selected: ScheduleBlock[],
  errors: DraftValidationResult['errors'],
): void {
  const counts = new Map<string, number>();
  for (const block of selected) counts.set(block.id, (counts.get(block.id) ?? 0) + 1);

  for (const block of selected) {
    if ((counts.get(block.id) ?? 0) > 1) {
      errors.push({ blockId: block.id, message: SELECTED_ID_MESSAGE });
    }
  }
}

function addBusyOverlapErrors(
  blocks: ParsedBlock[],
  busyPeriods: BusyPeriod[],
  errors: DraftValidationResult['errors'],
): void {
  const busyIntervals = busyPeriods.flatMap((period) => {
    const start = parseTimestamp(period.start);
    const end = parseTimestamp(period.end);
    if (!start || !end) return [];

    const startMs = start.toMillis();
    const endMs = end.toMillis();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];
    return [{ startMs, endMs }];
  });

  for (const { block, interval } of blocks) {
    if (busyIntervals.some((busy) => intervalsOverlap(interval, busy))) {
      errors.push({ blockId: block.id, message: BUSY_OVERLAP_MESSAGE });
    }
  }
}

function addSelectedOverlapErrors(
  blocks: ParsedBlock[],
  errors: DraftValidationResult['errors'],
): void {
  const overlappingIndexes = new Set<number>();

  for (let left = 0; left < blocks.length; left += 1) {
    for (let right = left + 1; right < blocks.length; right += 1) {
      if (intervalsOverlap(blocks[left].interval, blocks[right].interval)) {
        overlappingIndexes.add(left);
        overlappingIndexes.add(right);
      }
    }
  }

  for (const [index, { block }] of blocks.entries()) {
    if (overlappingIndexes.has(index)) {
      errors.push({ blockId: block.id, message: SELECTED_OVERLAP_MESSAGE });
    }
  }
}

function addMissingBreakWarnings(
  blocks: ParsedBlock[],
  settings: AppSettings,
  warnings: DraftValidationResult['warnings'],
): void {
  const chronological = [...blocks].sort((left, right) =>
    left.interval.startMs - right.interval.startMs || left.index - right.index,
  );

  for (const [index, block] of chronological.entries()) {
    const durationMinutes = (block.interval.endMs - block.interval.startMs) / 60_000;
    if (block.block.kind !== 'task' || durationMinutes <= settings.breakAfterMinutes) continue;

    const next = chronological[index + 1];
    const hasAdjacentBreak = next?.block.kind === 'break'
      && next.interval.startMs === block.interval.endMs
      && next.interval.endMs - next.interval.startMs === settings.breakDurationMinutes * 60_000;

    if (!hasAdjacentBreak) warnings.push({ blockId: block.block.id, message: MISSING_BREAK_MESSAGE });
  }
}
