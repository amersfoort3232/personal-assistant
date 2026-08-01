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

function addTaskBlock(
  blocks: ScheduleBlock[],
  task: ProposedTask,
  startMs: number,
  durationMinutes: number,
  settings: AppSettings,
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

  if (durationMinutes > settings.breakAfterMinutes) {
    const breakEndMs = endMs + settings.breakDurationMinutes * MINUTE;
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

  return { occupiedEndMs: endMs };
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

  for (const task of orderedTasks(input.tasks, input.targetDate)) {
    let remainingMinutes = task.durationMinutes;
    const deadlineMs = task.deadline
      ? Math.min(
          DateTime.fromISO(task.deadline, { setZone: true }).toMillis(),
          windowEndMs,
        )
      : windowEndMs;
    const breakMinutes = task.durationMinutes > input.settings.breakAfterMinutes
      ? input.settings.breakDurationMinutes
      : 0;
    const contiguousMinutes = task.durationMinutes + breakMinutes;

    const contiguousIndex = free.findIndex((slot) => {
      const availableEndMs = Math.min(slot.endMs, deadlineMs);
      return availableEndMs - slot.startMs >= contiguousMinutes * MINUTE;
    });

    if (contiguousIndex >= 0) {
      const startMs = free[contiguousIndex].startMs;
      const added = addTaskBlock(
        blocks,
        task,
        startMs,
        task.durationMinutes,
        input.settings,
      );
      consume(free, contiguousIndex, startMs, added.occupiedEndMs);
      remainingMinutes = 0;
    } else if (task.canSplit) {
      for (
        let intervalIndex = 0;
        intervalIndex < free.length && remainingMinutes > 0;
        intervalIndex += 1
      ) {
        const slot = free[intervalIndex];
        const availableMinutes = Math.floor(
          (Math.min(slot.endMs, deadlineMs) - slot.startMs) / MINUTE,
        );
        if (availableMinutes < task.minimumSessionMinutes) continue;

        const sessionMinutes = Math.min(60, remainingMinutes, availableMinutes);
        if (sessionMinutes < task.minimumSessionMinutes) continue;

        const added = addTaskBlock(
          blocks,
          task,
          slot.startMs,
          sessionMinutes,
          input.settings,
        );
        consume(free, intervalIndex, slot.startMs, added.occupiedEndMs);
        remainingMinutes -= sessionMinutes;
        intervalIndex = -1;
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
