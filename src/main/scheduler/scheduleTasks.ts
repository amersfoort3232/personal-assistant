import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import type {
  AppSettings,
  BusyPeriod,
  ProposedTask,
  ScheduleBlock,
  ScheduleSnapshot,
  UnscheduledTask,
} from '../../shared/domain';
import {
  buildWorkingWindow,
  deriveFreeIntervals,
  mergeBusyPeriods,
  type NumericInterval,
} from './intervals';

const PRIORITY = { low: 1, medium: 2, high: 3, urgent: 4 } as const;
const MINUTE = 60_000;
const TASK_BUFFER_MINUTES = 15;

function orderedTasks(tasks: ProposedTask[], targetDate: string): ProposedTask[] {
  const endOfDay = DateTime.fromISO(targetDate, { zone: 'Europe/London' })
    .set({ hour: 17, minute: 0, second: 0, millisecond: 0 })
    .toMillis();

  return tasks
    .map((task, index) => ({ task, index }))
    .sort((left, right) => {
      const leftDeadline = left.task.deadline
        ? DateTime.fromISO(left.task.deadline, { setZone: true }).toMillis()
        : endOfDay;
      const rightDeadline = right.task.deadline
        ? DateTime.fromISO(right.task.deadline, { setZone: true }).toMillis()
        : endOfDay;

      return leftDeadline - rightDeadline
        || PRIORITY[right.task.priority] - PRIORITY[left.task.priority]
        || Number(left.task.canSplit) - Number(right.task.canSplit)
        || right.task.durationMinutes - left.task.durationMinutes
        || left.index - right.index;
    })
    .map(({ task }) => task);
}

function consume(
  free: NumericInterval[],
  intervalIndex: number,
  startMs: number,
  occupiedEndMs: number,
): void {
  const interval = free[intervalIndex];
  const replacements: NumericInterval[] = [];

  if (interval.startMs < startMs) {
    replacements.push({ startMs: interval.startMs, endMs: startMs });
  }
  if (occupiedEndMs < interval.endMs) {
    replacements.push({ startMs: occupiedEndMs, endMs: interval.endMs });
  }

  free.splice(intervalIndex, 1, ...replacements);
}

function toIso(ms: number): string {
  return DateTime.fromMillis(ms, { zone: 'Europe/London' }).toISO()!;
}

function ceilToWholeMinute(ms: number, timeZone: string): number {
  const instant = DateTime.fromMillis(ms, { zone: timeZone });
  const minute = instant.startOf('minute');
  return instant.toMillis() === minute.toMillis()
    ? instant.toMillis()
    : minute.plus({ minutes: 1 }).toMillis();
}

function addTaskBlock(
  blocks: ScheduleBlock[],
  task: ProposedTask,
  startMs: number,
  durationMinutes: number,
  breakMinutes: number,
): { occupiedEndMs: number } {
  const endMs = startMs + durationMinutes * MINUTE;
  blocks.push({
    id: randomUUID(),
    kind: 'task',
    taskId: task.id,
    title: task.title,
    start: toIso(startMs),
    end: toIso(endMs),
    selected: true,
  });
  if (breakMinutes === 0) return { occupiedEndMs: endMs };

  const breakEndMs = endMs + breakMinutes * MINUTE;
  blocks.push({
    id: randomUUID(),
    kind: 'break',
    title: 'Break',
    start: toIso(endMs),
    end: toIso(breakEndMs),
    selected: true,
  });
  return { occupiedEndMs: breakEndMs };
}

function addBreakBlock(blocks: ScheduleBlock[], startMs: number, durationMinutes: number): void {
  blocks.push({
    id: randomUUID(),
    kind: 'break',
    title: 'Break',
    start: toIso(startMs),
    end: toIso(startMs + durationMinutes * MINUTE),
    selected: true,
  });
}

function reserve(free: NumericInterval[], startMs: number, endMs: number): void {
  for (let intervalIndex = free.length - 1; intervalIndex >= 0; intervalIndex -= 1) {
    const interval = free[intervalIndex];
    const reservedStartMs = Math.max(interval.startMs, startMs);
    const reservedEndMs = Math.min(interval.endMs, endMs);
    if (reservedStartMs < reservedEndMs) {
      consume(free, intervalIndex, reservedStartMs, reservedEndMs);
    }
  }
}

function fixedStartMs(task: ProposedTask, targetDate: string, timeZone: string): number | undefined {
  if (!task.fixedStartTime) return undefined;
  const parsed = DateTime.fromISO(`${targetDate}T${task.fixedStartTime}`, { zone: timeZone });
  return parsed.isValid ? parsed.toMillis() : undefined;
}

function unscheduledReason(
  task: ProposedTask,
  free: NumericInterval[],
  deadlineMs: number,
  windowStartMs: number,
): UnscheduledTask['reason'] {
  const hasUsableTimeBeforeDeadline = deadlineMs > windowStartMs
    && free.some((slot) => Math.min(slot.endMs, deadlineMs) > slot.startMs);

  if (task.deadline && !hasUsableTimeBeforeDeadline) {
    return 'deadline-impossible';
  }
  if (free.length === 0) return 'no-free-time';
  return 'minimum-session-does-not-fit';
}

export function scheduleTasks(input: {
  targetDate: string;
  tasks: ProposedTask[];
  busyPeriods: BusyPeriod[];
  settings: AppSettings;
}): ScheduleSnapshot {
  const window = buildWorkingWindow(input.targetDate, input.settings);
  const busy = mergeBusyPeriods(input.busyPeriods, window);
  const free = deriveFreeIntervals(window, busy);
  const blocks: ScheduleBlock[] = [];
  const unscheduledTasks: UnscheduledTask[] = [];
  const windowStartMs = window.start.toMillis();
  const windowEndMs = window.end.toMillis();

  const fixedTasks = input.tasks
    .filter((task) => task.fixedStartTime)
    .sort((left, right) => (
      (fixedStartMs(left, input.targetDate, input.settings.timeZone) ?? Infinity)
      - (fixedStartMs(right, input.targetDate, input.settings.timeZone) ?? Infinity)
    ));

  for (const task of fixedTasks) {
    const startMs = fixedStartMs(task, input.targetDate, input.settings.timeZone);
    const occupiedEndMs = startMs === undefined
      ? undefined
      : startMs + (task.durationMinutes + TASK_BUFFER_MINUTES) * MINUTE;
    const slotIndex = startMs === undefined || occupiedEndMs === undefined
      ? -1
      : free.findIndex((slot) => slot.startMs <= startMs && slot.endMs >= occupiedEndMs);

    if (slotIndex < 0 || startMs === undefined) {
      unscheduledTasks.push({
        taskId: task.id,
        remainingMinutes: task.durationMinutes,
        reason: 'fixed-time-conflict',
      });
      continue;
    }

    const preBufferStartMs = Math.max(windowStartMs, startMs - TASK_BUFFER_MINUTES * MINUTE);
    const hasPreBuffer = startMs - preBufferStartMs === TASK_BUFFER_MINUTES * MINUTE
      && free.some((slot) => slot.startMs <= preBufferStartMs && slot.endMs >= startMs);
    if (hasPreBuffer) addBreakBlock(blocks, preBufferStartMs, TASK_BUFFER_MINUTES);

    const added = addTaskBlock(
      blocks,
      task,
      startMs,
      task.durationMinutes,
      TASK_BUFFER_MINUTES,
    );
    consume(free, slotIndex, startMs, added.occupiedEndMs);
    reserve(free, preBufferStartMs, startMs);
  }

  const flexibleTasks = orderedTasks(
    input.tasks.filter((candidate) => !candidate.fixedStartTime),
    input.targetDate,
  );

  for (const [taskIndex, task] of flexibleTasks.entries()) {
    let remainingMinutes = task.durationMinutes;
    const deadlineMs = task.deadline
      ? Math.min(
          DateTime.fromISO(task.deadline, { setZone: true }).toMillis(),
          windowEndMs,
        )
      : windowEndMs;
    const breakMinutes = task.durationMinutes > input.settings.breakAfterMinutes
      || taskIndex < flexibleTasks.length - 1
      ? TASK_BUFFER_MINUTES
      : 0;

    const contiguousIndex = free.findIndex((slot) => {
      const alignedStartMs = ceilToWholeMinute(slot.startMs, input.settings.timeZone);
      const taskEndMs = alignedStartMs + task.durationMinutes * MINUTE;
      return taskEndMs <= deadlineMs
        && taskEndMs + breakMinutes * MINUTE <= slot.endMs;
    });
    const fallbackIndex = task.durationMinutes <= input.settings.breakAfterMinutes
      && breakMinutes > 0
      ? free.findIndex((slot) => {
      const alignedStartMs = ceilToWholeMinute(slot.startMs, input.settings.timeZone);
      const taskEndMs = alignedStartMs + task.durationMinutes * MINUTE;
      return taskEndMs <= deadlineMs && taskEndMs <= slot.endMs;
    })
      : -1;

    if (contiguousIndex >= 0 || fallbackIndex >= 0) {
      const useBufferedSlot = contiguousIndex >= 0
        && (fallbackIndex < 0 || contiguousIndex <= fallbackIndex);
      const intervalIndex = useBufferedSlot ? contiguousIndex : fallbackIndex;
      const startMs = ceilToWholeMinute(
        free[intervalIndex].startMs,
        input.settings.timeZone,
      );
      const added = addTaskBlock(
        blocks,
        task,
        startMs,
        task.durationMinutes,
        useBufferedSlot ? breakMinutes : 0,
      );
      consume(free, intervalIndex, startMs, added.occupiedEndMs);
      remainingMinutes = 0;
    } else if (task.canSplit) {
      let finalSessionEndMs: number | undefined;
      for (
        let intervalIndex = 0;
        intervalIndex < free.length && remainingMinutes > 0;
        intervalIndex += 1
      ) {
        const slot = free[intervalIndex];
        const startMs = ceilToWholeMinute(slot.startMs, input.settings.timeZone);
        const availableMinutes = Math.floor(
          (Math.min(slot.endMs, deadlineMs) - startMs) / MINUTE,
        );
        const usableTaskMinutes = Math.min(
          availableMinutes,
          Math.floor((slot.endMs - startMs) / MINUTE),
        );
        if (usableTaskMinutes < task.minimumSessionMinutes) continue;

        const sessionMinutes = Math.min(60, remainingMinutes, usableTaskMinutes);
        if (sessionMinutes < task.minimumSessionMinutes) continue;

        const added = addTaskBlock(
          blocks,
          task,
          startMs,
          sessionMinutes,
          0,
        );
        consume(free, intervalIndex, startMs, added.occupiedEndMs);
        remainingMinutes -= sessionMinutes;
        finalSessionEndMs = added.occupiedEndMs;
        intervalIndex = -1;
      }

      if (remainingMinutes === 0 && taskIndex < flexibleTasks.length - 1 && finalSessionEndMs) {
        const bufferEndMs = finalSessionEndMs + TASK_BUFFER_MINUTES * MINUTE;
        const bufferSlotIndex = free.findIndex(
          (slot) => slot.startMs <= finalSessionEndMs && slot.endMs >= bufferEndMs,
        );
        if (bufferSlotIndex >= 0) {
          addBreakBlock(blocks, finalSessionEndMs, TASK_BUFFER_MINUTES);
          consume(free, bufferSlotIndex, finalSessionEndMs, bufferEndMs);
        }
      }
    }

    if (remainingMinutes > 0) {
      unscheduledTasks.push({
        taskId: task.id,
        remainingMinutes,
        reason: unscheduledReason(task, free, deadlineMs, windowStartMs),
      });
    }
  }

  const taskBlocks = blocks.filter((block) => block.kind === 'task');
  const sessionCounts = new Map<string, number>();
  for (const block of taskBlocks) {
    sessionCounts.set(block.taskId!, (sessionCounts.get(block.taskId!) ?? 0) + 1);
  }

  const sessionIndices = new Map<string, number>();
  for (const block of taskBlocks) {
    const nextIndex = (sessionIndices.get(block.taskId!) ?? 0) + 1;
    sessionIndices.set(block.taskId!, nextIndex);
    block.sessionIndex = nextIndex;
    block.sessionCount = sessionCounts.get(block.taskId!);
  }

  return {
    targetDate: input.targetDate,
    busyPeriods: input.busyPeriods,
    blocks: blocks.sort((left, right) => left.start.localeCompare(right.start)),
    unscheduledTasks,
    warnings: unscheduledTasks.length > 0
      ? ['Some work does not fit. No task was moved to another date.']
      : [],
  };
}
