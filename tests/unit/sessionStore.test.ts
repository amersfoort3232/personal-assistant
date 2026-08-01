import { describe, expect, it } from 'vitest';
import { SessionStore } from '../../src/main/session/sessionStore';

describe('SessionStore', () => {
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
