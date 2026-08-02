import { describe, expect, it } from 'vitest';
import { scheduleTasks } from '../../src/main/scheduler/scheduleTasks';
import type {
  AppSettings,
  BusyPeriod,
  ProposedTask,
  ScheduleBlock,
} from '../../src/shared/domain';

const targetDate = '2026-08-03';

const settings: AppSettings = {
  version: 1,
  timeZone: 'Europe/London',
  workingHours: { start: '09:00', end: '17:00' },
  workingDays: [0, 1, 2, 3, 4, 5, 6],
  breakAfterMinutes: 60,
  breakDurationMinutes: 10,
};

function task(overrides: Partial<ProposedTask> = {}): ProposedTask {
  return {
    id: 'task',
    title: 'Task',
    durationMinutes: 30,
    durationWasEstimated: false,
    priority: 'medium',
    canSplit: false,
    minimumSessionMinutes: 15,
    ...overrides,
  };
}

function busy(start: string, end: string): BusyPeriod {
  return { start, end, sourceCalendarId: 'primary' };
}

function taskTiming(block: ScheduleBlock): {
  taskId: string | undefined;
  start: string;
  end: string;
} {
  return { taskId: block.taskId, start: block.start, end: block.end };
}

function sessionTiming(block: ScheduleBlock): {
  taskId: string | undefined;
  start: string;
  end: string;
  sessionIndex: number | undefined;
  sessionCount: number | undefined;
} {
  return {
    ...taskTiming(block),
    sessionIndex: block.sessionIndex,
    sessionCount: block.sessionCount,
  };
}

describe('scheduleTasks', () => {
  it('schedules an earlier-deadline low-priority task before a high-priority task without a deadline', () => {
    const result = scheduleTasks({
      targetDate,
      settings,
      busyPeriods: [],
      tasks: [
        task({ id: 'high', title: 'High', durationMinutes: 60, priority: 'high' }),
        task({
          id: 'due',
          title: 'Due',
          durationMinutes: 60,
          priority: 'low',
          deadline: '2026-08-03T10:00:00+01:00',
        }),
      ],
    });

    expect(result.blocks.filter((block) => block.kind === 'task').map(taskTiming)).toEqual([
      { taskId: 'due', start: '2026-08-03T09:00:00.000+01:00', end: '2026-08-03T10:00:00.000+01:00' },
      { taskId: 'high', start: '2026-08-03T10:00:00.000+01:00', end: '2026-08-03T11:00:00.000+01:00' },
    ]);
  });

  it('sorts equal deadlines urgent before high before medium before low', () => {
    const deadline = '2026-08-03T12:00:00+01:00';
    const result = scheduleTasks({
      targetDate,
      settings,
      busyPeriods: [],
      tasks: [
        task({ id: 'low', title: 'Low', priority: 'low', deadline }),
        task({ id: 'medium', title: 'Medium', priority: 'medium', deadline }),
        task({ id: 'high', title: 'High', priority: 'high', deadline }),
        task({ id: 'urgent', title: 'Urgent', priority: 'urgent', deadline }),
      ],
    });

    expect(result.blocks.filter((block) => block.kind === 'task').map(taskTiming)).toEqual([
      { taskId: 'urgent', start: '2026-08-03T09:00:00.000+01:00', end: '2026-08-03T09:30:00.000+01:00' },
      { taskId: 'high', start: '2026-08-03T09:30:00.000+01:00', end: '2026-08-03T10:00:00.000+01:00' },
      { taskId: 'medium', start: '2026-08-03T10:00:00.000+01:00', end: '2026-08-03T10:30:00.000+01:00' },
      { taskId: 'low', start: '2026-08-03T10:30:00.000+01:00', end: '2026-08-03T11:00:00.000+01:00' },
    ]);
  });

  it('reserves an immediately following ten-minute break for an unsplittable 90-minute task', () => {
    const result = scheduleTasks({
      targetDate,
      settings,
      busyPeriods: [],
      tasks: [task({ id: 'long', title: 'Long', durationMinutes: 90 })],
    });

    expect(result.blocks.map((block) => ({
      kind: block.kind,
      start: block.start,
      end: block.end,
    }))).toEqual([
      { kind: 'task', start: '2026-08-03T09:00:00.000+01:00', end: '2026-08-03T10:30:00.000+01:00' },
      { kind: 'break', start: '2026-08-03T10:30:00.000+01:00', end: '2026-08-03T10:40:00.000+01:00' },
    ]);
  });

  it('does not create a break for an exactly 60-minute session', () => {
    const result = scheduleTasks({
      targetDate,
      settings,
      busyPeriods: [],
      tasks: [task({ id: 'sixty', title: 'Sixty', durationMinutes: 60 })],
    });

    expect(result.blocks.map((block) => ({
      kind: block.kind,
      start: block.start,
      end: block.end,
    }))).toEqual([
      { kind: 'task', start: '2026-08-03T09:00:00.000+01:00', end: '2026-08-03T10:00:00.000+01:00' },
    ]);
  });

  it('creates a break for a 61-minute unsplittable session', () => {
    const result = scheduleTasks({
      targetDate,
      settings,
      busyPeriods: [],
      tasks: [task({ id: 'sixty-one', title: 'Sixty one', durationMinutes: 61 })],
    });

    expect(result.blocks.map((block) => ({
      kind: block.kind,
      start: block.start,
      end: block.end,
    }))).toEqual([
      { kind: 'task', start: '2026-08-03T09:00:00.000+01:00', end: '2026-08-03T10:01:00.000+01:00' },
      { kind: 'break', start: '2026-08-03T10:01:00.000+01:00', end: '2026-08-03T10:11:00.000+01:00' },
    ]);
  });

  it('splits a 120-minute task into two 60-minute sessions when no contiguous slot fits', () => {
    const result = scheduleTasks({
      targetDate,
      settings,
      busyPeriods: [
        busy('2026-08-03T10:00:00+01:00', '2026-08-03T11:00:00+01:00'),
        busy('2026-08-03T12:00:00+01:00', '2026-08-03T17:00:00+01:00'),
      ],
      tasks: [task({
        id: 'split',
        title: 'Split',
        durationMinutes: 120,
        canSplit: true,
        minimumSessionMinutes: 30,
      })],
    });

    expect(result.blocks.filter((block) => block.kind === 'task').map(sessionTiming)).toEqual([
      {
        taskId: 'split',
        start: '2026-08-03T09:00:00.000+01:00',
        end: '2026-08-03T10:00:00.000+01:00',
        sessionIndex: 1,
        sessionCount: 2,
      },
      {
        taskId: 'split',
        start: '2026-08-03T11:00:00.000+01:00',
        end: '2026-08-03T12:00:00.000+01:00',
        sessionIndex: 2,
        sessionCount: 2,
      },
    ]);
    expect(result.blocks.some((block) => block.kind === 'break')).toBe(false);
    expect(result.unscheduledTasks).toEqual([]);
  });

  it('leaves a final fragment below minimumSessionMinutes unscheduled', () => {
    const result = scheduleTasks({
      targetDate,
      settings,
      busyPeriods: [
        busy('2026-08-03T10:00:00+01:00', '2026-08-03T11:00:00+01:00'),
        busy('2026-08-03T12:00:00+01:00', '2026-08-03T17:00:00+01:00'),
      ],
      tasks: [task({
        id: 'fragment',
        title: 'Fragment',
        durationMinutes: 70,
        canSplit: true,
        minimumSessionMinutes: 15,
      })],
    });

    expect(result.blocks.filter((block) => block.kind === 'task').map(taskTiming)).toEqual([
      { taskId: 'fragment', start: '2026-08-03T09:00:00.000+01:00', end: '2026-08-03T10:00:00.000+01:00' },
    ]);
    expect(result.unscheduledTasks).toEqual([{
      taskId: 'fragment',
      remainingMinutes: 10,
      reason: 'minimum-session-does-not-fit',
    }]);
  });

  it('returns deadline-impossible when every free slot starts after the deadline', () => {
    const result = scheduleTasks({
      targetDate,
      settings,
      busyPeriods: [busy('2026-08-03T09:00:00+01:00', '2026-08-03T10:30:00+01:00')],
      tasks: [task({
        id: 'missed',
        title: 'Missed',
        durationMinutes: 30,
        deadline: '2026-08-03T10:00:00+01:00',
      })],
    });

    expect(result.blocks).toEqual([]);
    expect(result.unscheduledTasks).toEqual([{
      taskId: 'missed',
      remainingMinutes: 30,
      reason: 'deadline-impossible',
    }]);
  });

  it('never schedules before 09:00 or after 17:00', () => {
    const result = scheduleTasks({
      targetDate,
      settings,
      busyPeriods: [],
      tasks: [task({
        id: 'full-day',
        title: 'Full day',
        durationMinutes: 480,
        canSplit: true,
        minimumSessionMinutes: 60,
      })],
    });

    const taskBlocks = result.blocks.filter((block) => block.kind === 'task');
    expect(taskBlocks).toHaveLength(8);
    expect(taskBlocks[0]).toMatchObject({
      start: '2026-08-03T09:00:00.000+01:00',
      end: '2026-08-03T10:00:00.000+01:00',
    });
    expect(taskBlocks[7]).toMatchObject({
      start: '2026-08-03T16:00:00.000+01:00',
      end: '2026-08-03T17:00:00.000+01:00',
    });
  });

  it('clips contiguous candidates to the deadline including required break capacity', () => {
    const result = scheduleTasks({
      targetDate,
      settings,
      busyPeriods: [],
      tasks: [task({
        id: 'break-before-deadline',
        title: 'Break before deadline',
        durationMinutes: 61,
        deadline: '2026-08-03T10:01:00+01:00',
      })],
    });

    expect(result.blocks).toEqual([]);
    expect(result.unscheduledTasks).toEqual([{
      taskId: 'break-before-deadline',
      remainingMinutes: 61,
      reason: 'minimum-session-does-not-fit',
    }]);
  });

  it('preserves original input order when every ordering field ties', () => {
    const result = scheduleTasks({
      targetDate,
      settings,
      busyPeriods: [],
      tasks: [
        task({ id: 'first', title: 'First' }),
        task({ id: 'second', title: 'Second' }),
      ],
    });

    expect(result.blocks.filter((block) => block.kind === 'task').map(taskTiming)).toEqual([
      { taskId: 'first', start: '2026-08-03T09:00:00.000+01:00', end: '2026-08-03T09:30:00.000+01:00' },
      { taskId: 'second', start: '2026-08-03T09:30:00.000+01:00', end: '2026-08-03T10:00:00.000+01:00' },
    ]);
  });

  it('sorts unsplittable tasks first and then longer durations for otherwise equal tasks', () => {
    const result = scheduleTasks({
      targetDate,
      settings,
      busyPeriods: [],
      tasks: [
        task({ id: 'split', title: 'Split', durationMinutes: 60, canSplit: true }),
        task({ id: 'short', title: 'Short', durationMinutes: 30 }),
        task({ id: 'long', title: 'Long', durationMinutes: 60 }),
      ],
    });

    expect(result.blocks.filter((block) => block.kind === 'task').map(taskTiming)).toEqual([
      { taskId: 'long', start: '2026-08-03T09:00:00.000+01:00', end: '2026-08-03T10:00:00.000+01:00' },
      { taskId: 'short', start: '2026-08-03T10:00:00.000+01:00', end: '2026-08-03T10:30:00.000+01:00' },
      { taskId: 'split', start: '2026-08-03T10:30:00.000+01:00', end: '2026-08-03T11:30:00.000+01:00' },
    ]);
  });

  it('places task blocks around busy time without overlap', () => {
    const result = scheduleTasks({
      targetDate,
      settings,
      busyPeriods: [busy('2026-08-03T09:30:00+01:00', '2026-08-03T10:30:00+01:00')],
      tasks: [
        task({ id: 'first', title: 'First' }),
        task({ id: 'second', title: 'Second' }),
      ],
    });

    expect(result.blocks.filter((block) => block.kind === 'task').map(taskTiming)).toEqual([
      { taskId: 'first', start: '2026-08-03T09:00:00.000+01:00', end: '2026-08-03T09:30:00.000+01:00' },
      { taskId: 'second', start: '2026-08-03T10:30:00.000+01:00', end: '2026-08-03T11:00:00.000+01:00' },
    ]);
  });

  it('rounds a second-bearing free boundary up to the next London minute without changing task or break duration', () => {
    const result = scheduleTasks({
      targetDate,
      settings,
      busyPeriods: [busy(
        '2026-08-03T09:00:00+01:00',
        '2026-08-03T12:03:30+01:00',
      )],
      tasks: [task({
        id: 'second-boundary',
        title: 'Second boundary',
        durationMinutes: 61,
      })],
    });

    expect(result.blocks.map((block) => ({
      kind: block.kind,
      start: block.start,
      end: block.end,
    }))).toEqual([
      {
        kind: 'task',
        start: '2026-08-03T12:04:00.000+01:00',
        end: '2026-08-03T13:05:00.000+01:00',
      },
      {
        kind: 'break',
        start: '2026-08-03T13:05:00.000+01:00',
        end: '2026-08-03T13:15:00.000+01:00',
      },
    ]);
  });

  it('rechecks interval capacity after rounding a second-bearing start boundary', () => {
    const result = scheduleTasks({
      targetDate,
      settings,
      busyPeriods: [
        busy('2026-08-03T09:00:00+01:00', '2026-08-03T12:03:30+01:00'),
        busy('2026-08-03T13:03:45+01:00', '2026-08-03T13:30:30+01:00'),
      ],
      tasks: [task({
        id: 'fit-after-rounding',
        title: 'Fit after rounding',
        durationMinutes: 60,
      })],
    });

    expect(result.blocks.map(taskTiming)).toEqual([{
      taskId: 'fit-after-rounding',
      start: '2026-08-03T13:31:00.000+01:00',
      end: '2026-08-03T14:31:00.000+01:00',
    }]);
  });

  it('keeps scheduled split sessions and reports the remaining work', () => {
    const result = scheduleTasks({
      targetDate,
      settings,
      busyPeriods: [
        busy('2026-08-03T10:00:00+01:00', '2026-08-03T11:00:00+01:00'),
        busy('2026-08-03T12:00:00+01:00', '2026-08-03T17:00:00+01:00'),
      ],
      tasks: [task({
        id: 'partial',
        title: 'Partial',
        durationMinutes: 150,
        canSplit: true,
        minimumSessionMinutes: 30,
      })],
    });

    expect(result.blocks.filter((block) => block.kind === 'task').map(sessionTiming)).toEqual([
      {
        taskId: 'partial',
        start: '2026-08-03T09:00:00.000+01:00',
        end: '2026-08-03T10:00:00.000+01:00',
        sessionIndex: 1,
        sessionCount: 2,
      },
      {
        taskId: 'partial',
        start: '2026-08-03T11:00:00.000+01:00',
        end: '2026-08-03T12:00:00.000+01:00',
        sessionIndex: 2,
        sessionCount: 2,
      },
    ]);
    expect(result.unscheduledTasks).toEqual([{
      taskId: 'partial',
      remainingMinutes: 30,
      reason: 'no-free-time',
    }]);
  });

  it('does not schedule a long session unless its immediately following break also fits', () => {
    const result = scheduleTasks({
      targetDate,
      settings,
      busyPeriods: [busy('2026-08-03T10:30:00+01:00', '2026-08-03T17:00:00+01:00')],
      tasks: [task({ id: 'no-break-room', title: 'No break room', durationMinutes: 90 })],
    });

    expect(result.blocks).toEqual([]);
    expect(result.unscheduledTasks).toEqual([{
      taskId: 'no-break-room',
      remainingMinutes: 90,
      reason: 'minimum-session-does-not-fit',
    }]);
  });

  it('reports no-free-time when the working window has no free interval', () => {
    const result = scheduleTasks({
      targetDate,
      settings,
      busyPeriods: [busy('2026-08-03T09:00:00+01:00', '2026-08-03T17:00:00+01:00')],
      tasks: [task({ id: 'full', title: 'Full' })],
    });

    expect(result.blocks).toEqual([]);
    expect(result.unscheduledTasks).toEqual([{
      taskId: 'full',
      remainingMinutes: 30,
      reason: 'no-free-time',
    }]);
  });

  it('reports deadline-impossible when a deadline task has no usable time before its deadline', () => {
    const result = scheduleTasks({
      targetDate,
      settings,
      busyPeriods: [busy('2026-08-03T09:00:00+01:00', '2026-08-03T17:00:00+01:00')],
      tasks: [task({
        id: 'blocked-deadline',
        title: 'Blocked deadline',
        deadline: '2026-08-03T12:00:00+01:00',
      })],
    });

    expect(result.blocks).toEqual([]);
    expect(result.unscheduledTasks).toEqual([{
      taskId: 'blocked-deadline',
      remainingMinutes: 30,
      reason: 'deadline-impossible',
    }]);
  });

  it('reports minimum-session-does-not-fit when free intervals exist but none can fit the session', () => {
    const result = scheduleTasks({
      targetDate,
      settings,
      busyPeriods: [
        busy('2026-08-03T09:20:00+01:00', '2026-08-03T09:40:00+01:00'),
        busy('2026-08-03T10:00:00+01:00', '2026-08-03T17:00:00+01:00'),
      ],
      tasks: [task({ id: 'too-large', title: 'Too large', durationMinutes: 30 })],
    });

    expect(result.blocks).toEqual([]);
    expect(result.unscheduledTasks).toEqual([{
      taskId: 'too-large',
      remainingMinutes: 30,
      reason: 'minimum-session-does-not-fit',
    }]);
  });
});
