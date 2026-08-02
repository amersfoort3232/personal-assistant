import { describe, expect, it } from 'vitest';
import { SessionStore } from '../../src/main/session/sessionStore';

describe('SessionStore', () => {
  it('clears only schedule state when tasks change', () => {
    const store = new SessionStore();
    store.appendMessage({
      id: 'm1',
      role: 'user',
      text: 'Study React',
      createdAt: '2026-08-01T09:00:00+01:00',
    });
    store.replaceTasks([{
      id: 'task-1',
      title: 'Study React',
      durationMinutes: 60,
      durationWasEstimated: false,
      priority: 'medium',
      canSplit: false,
      minimumSessionMinutes: 30,
    }]);
    store.replaceSchedule({
      targetDate: '2026-08-01',
      busyPeriods: [{
        start: '2026-08-01T12:00:00+01:00',
        end: '2026-08-01T13:00:00+01:00',
        sourceCalendarId: 'primary',
      }],
      blocks: [{
        id: 'block-1',
        kind: 'task',
        taskId: 'task-1',
        title: 'Study React',
        start: '2026-08-01T09:00:00+01:00',
        end: '2026-08-01T10:00:00+01:00',
        selected: true,
      }],
      unscheduledTasks: [{
        taskId: 'task-1',
        remainingMinutes: 30,
        reason: 'no-free-time',
      }],
      warnings: ['Some work does not fit. No task was moved to another date.'],
    });
    store.replaceApprovalAttempt(store.getSnapshot().draftSchedule, [{
      blockId: 'block-1',
      status: 'failed',
      errorCode: 'CALENDAR_UNAVAILABLE',
    }]);

    store.clearSchedule();

    expect(store.getSnapshot()).toEqual({
      messages: [{
        id: 'm1',
        role: 'user',
        text: 'Study React',
        createdAt: '2026-08-01T09:00:00+01:00',
      }],
      tasks: [{
        id: 'task-1',
        title: 'Study React',
        durationMinutes: 60,
        durationWasEstimated: false,
        priority: 'medium',
        canSplit: false,
        minimumSessionMinutes: 30,
      }],
      busyPeriods: [],
      draftSchedule: [],
      unscheduledTasks: [],
      warnings: [],
      targetDate: undefined,
    });
  });

  it('forgets messages, tasks, and schedule on reset', () => {
    const store = new SessionStore();
    store.appendMessage({
      id: 'm1',
      role: 'user',
      text: 'Study React',
      createdAt: '2026-08-01T09:00:00+01:00',
    });
    store.replaceTasks([]);
    store.replaceSchedule({
      targetDate: '2026-08-01',
      busyPeriods: [],
      blocks: [],
      unscheduledTasks: [],
      warnings: [],
    });
    store.replaceApprovalAttempt([], [{
      blockId: 'block-1',
      status: 'failed',
      errorCode: 'CALENDAR_UNAVAILABLE',
    }]);

    store.reset();

    expect(store.getSnapshot()).toEqual({
      messages: [],
      tasks: [],
      busyPeriods: [],
      draftSchedule: [],
      unscheduledTasks: [],
      warnings: [],
      targetDate: undefined,
    });
  });
});
