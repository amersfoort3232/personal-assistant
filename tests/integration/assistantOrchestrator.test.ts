import { describe, expect, it } from 'vitest';
import { AssistantOrchestrator } from '../../src/main/orchestrator/assistantOrchestrator';
import { createGoogleEventId } from '../../src/main/google/eventId';
import { SessionStore } from '../../src/main/session/sessionStore';
import { DEFAULT_SETTINGS } from '../../src/main/settings/defaultSettings';
import type {
  AppSettings,
  BusyPeriod,
  ChatMessage,
  EventCreationResult,
  ProposedTask,
  ScheduleBlock,
} from '../../src/shared/domain';
import { AppError } from '../../src/shared/errors';

const TARGET_DATE = '2026-08-03';
const CALENDAR_ID = 'assistant-calendar@example.com';
const SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS,
  personalAssistantCalendarId: CALENDAR_ID,
};

function task(overrides: Partial<ProposedTask> = {}): ProposedTask {
  return {
    id: 'task-1',
    title: 'Prepare launch notes',
    durationMinutes: 60,
    durationWasEstimated: false,
    priority: 'high',
    canSplit: false,
    minimumSessionMinutes: 30,
    ...overrides,
  };
}

function busy(start: string, end: string): BusyPeriod {
  return { start, end, sourceCalendarId: 'primary' };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

class FakeVault {
  readonly values = new Map<string, string>();

  async get(name: 'deepseek-api-key' | 'google-refresh-token'): Promise<string | undefined> {
    return this.values.get(name);
  }

  async set(name: 'deepseek-api-key' | 'google-refresh-token', value: string): Promise<void> {
    this.values.set(name, value);
  }

  async delete(name: 'deepseek-api-key' | 'google-refresh-token'): Promise<void> {
    this.values.delete(name);
  }
}

class FakeGoogleAuth {
  constructor(private readonly vault: FakeVault) {}

  async connect(): Promise<void> {
    await this.vault.set('google-refresh-token', 'google-refresh-token');
  }

  async disconnect(): Promise<void> {
    await this.vault.delete('google-refresh-token');
  }

  async isConnected(): Promise<boolean> {
    return Boolean(await this.vault.get('google-refresh-token'));
  }
}

class FakeSettingsRepository {
  saved: AppSettings[] = [];
  loadCalls = 0;

  constructor(public value: AppSettings = SETTINGS) {}

  async load(): Promise<AppSettings> {
    this.loadCalls += 1;
    return structuredClone(this.value);
  }

  async save(settings: AppSettings): Promise<void> {
    this.value = structuredClone(settings);
    this.saved.push(structuredClone(settings));
  }
}

type InsertCall = {
  calendarId: string;
  block: ScheduleBlock;
  eventId: string;
  task?: ProposedTask;
};

class FakeCalendarService {
  busyResponses: Array<BusyPeriod[] | Promise<BusyPeriod[]>> = [];
  busyCalls: Array<{ targetDate: string; settings: AppSettings }> = [];
  insertCalls: InsertCall[] = [];
  ensuredSettings: AppSettings = SETTINGS;
  insertBehavior?: (call: InsertCall) => EventCreationResult | Promise<EventCreationResult>;
  onBusyCall?: () => void;

  async ensurePersonalAssistantCalendar(_settings: AppSettings): Promise<AppSettings> {
    return structuredClone(this.ensuredSettings);
  }

  async getBusyPeriods(targetDate: string, settings: AppSettings): Promise<BusyPeriod[]> {
    this.busyCalls.push({ targetDate, settings: structuredClone(settings) });
    this.onBusyCall?.();
    return structuredClone(await (this.busyResponses.shift() ?? []));
  }

  async insertBlock(
    calendarId: string,
    block: ScheduleBlock,
    eventId: string,
    proposedTask?: ProposedTask,
  ): Promise<EventCreationResult> {
    const call = {
      calendarId,
      block: structuredClone(block),
      eventId,
      task: proposedTask ? structuredClone(proposedTask) : undefined,
    };
    this.insertCalls.push(call);
    if (this.insertBehavior) return this.insertBehavior(call);
    return { blockId: block.id, status: 'created', googleEventId: eventId };
  }
}

class FakeTaskService {
  conversations: ChatMessage[][] = [];

  constructor(public responses: Array<ProposedTask[] | Error> = [[task()]]) {}

  async interpret(messages: ChatMessage[]): Promise<ProposedTask[]> {
    this.conversations.push(structuredClone(messages));
    const response = this.responses.shift() ?? [];
    if (response instanceof Error) throw response;
    return structuredClone(response);
  }
}

function createHarness(options: {
  settings?: AppSettings;
  taskResponses?: Array<ProposedTask[] | Error>;
} = {}) {
  const session = new SessionStore();
  const vault = new FakeVault();
  const googleAuth = new FakeGoogleAuth(vault);
  const calendar = new FakeCalendarService();
  const settings = new FakeSettingsRepository(options.settings ?? SETTINGS);
  const taskService = new FakeTaskService(options.taskResponses);
  const orchestrator = new AssistantOrchestrator(
    session,
    taskService,
    vault,
    googleAuth,
    calendar,
    settings,
  );
  return { orchestrator, session, vault, googleAuth, calendar, settings, taskService };
}

async function createDraft(
  harness: ReturnType<typeof createHarness>,
  tasks: ProposedTask[] = [task()],
) {
  harness.taskService.responses = [tasks];
  await harness.orchestrator.sendMessage('Plan my day');
  return harness.orchestrator.generateSchedule(TARGET_DATE);
}

describe('AssistantOrchestrator', () => {
  it('interprets the complete conversation, replaces tasks, and appends a concise summary', async () => {
    const firstTasks = [task()];
    const secondTasks = [task({ id: 'task-2', title: 'Book venue' })];
    const harness = createHarness({ taskResponses: [firstTasks, secondTasks] });

    const first = await harness.orchestrator.sendMessage('  Prepare the launch  ');
    const second = await harness.orchestrator.sendMessage('Also book the venue');

    expect(first.tasks).toEqual(firstTasks);
    expect(first.messages.map(({ role, text }) => ({ role, text }))).toEqual([
      { role: 'user', text: 'Prepare the launch' },
      { role: 'assistant', text: 'I found 1 task. Review the details before scheduling.' },
    ]);
    expect(harness.taskService.conversations[1].map(({ role, text }) => ({ role, text }))).toEqual([
      { role: 'user', text: 'Prepare the launch' },
      { role: 'assistant', text: 'I found 1 task. Review the details before scheduling.' },
      { role: 'user', text: 'Also book the venue' },
    ]);
    expect(second.tasks).toEqual(secondTasks);
    expect(second.messages.at(-1)).toMatchObject({
      role: 'assistant',
      text: 'I found 1 task. Review the details before scheduling.',
    });
  });

  it('does not commit a failed user message or duplicate it when the send is retried', async () => {
    const unavailable = new AppError(
      'DEEPSEEK_UNAVAILABLE',
      'DeepSeek is temporarily unavailable.',
      true,
    );
    const harness = createHarness({ taskResponses: [unavailable, [task()]] });

    await expect(harness.orchestrator.sendMessage('Plan my day')).rejects.toBe(unavailable);
    expect(harness.session.getSnapshot()).toMatchObject({ messages: [], tasks: [] });

    const retried = await harness.orchestrator.sendMessage('Plan my day');

    expect(harness.taskService.conversations.map((messages) => (
      messages.map(({ role, text }) => ({ role, text }))
    ))).toEqual([
      [{ role: 'user', text: 'Plan my day' }],
      [{ role: 'user', text: 'Plan my day' }],
    ]);
    expect(retried.messages.map(({ role, text }) => ({ role, text }))).toEqual([
      { role: 'user', text: 'Plan my day' },
      { role: 'assistant', text: 'I found 1 task. Review the details before scheduling.' },
    ]);
  });

  it('fetches fresh busy periods and stores each generated draft', async () => {
    const harness = createHarness();
    const firstBusy = [busy('2026-08-03T09:00:00+01:00', '2026-08-03T10:00:00+01:00')];
    const secondBusy = [busy('2026-08-03T10:00:00+01:00', '2026-08-03T11:00:00+01:00')];
    harness.calendar.busyResponses = [firstBusy, secondBusy];
    harness.taskService.responses = [[task()]];
    await harness.orchestrator.sendMessage('Plan my day');

    const first = await harness.orchestrator.generateSchedule(TARGET_DATE);
    const second = await harness.orchestrator.generateSchedule(TARGET_DATE);

    expect(first.busyPeriods).toEqual(firstBusy);
    expect(second.busyPeriods).toEqual(secondBusy);
    expect(harness.calendar.busyCalls).toHaveLength(2);
    expect(harness.session.getSnapshot()).toMatchObject({
      targetDate: TARGET_DATE,
      busyPeriods: secondBusy,
      draftSchedule: second.blocks,
    });
  });

  it('invalidates the existing draft when a message replaces the task list', async () => {
    const harness = createHarness();
    await createDraft(harness);
    const replacement = task({ id: 'task-2', title: 'Replacement task' });
    harness.taskService.responses = [[replacement]];

    await harness.orchestrator.sendMessage('Use a different task');

    expect(harness.session.getSnapshot()).toMatchObject({
      tasks: [replacement],
      busyPeriods: [],
      draftSchedule: [],
      unscheduledTasks: [],
      warnings: [],
      targetDate: undefined,
    });
  });

  it('invalidates the existing draft when a task is edited', async () => {
    const harness = createHarness();
    await createDraft(harness);
    const editedTask = task({ title: 'Updated launch notes' });

    await harness.orchestrator.updateTask(editedTask);

    expect(harness.session.getSnapshot()).toMatchObject({
      tasks: [editedTask],
      busyPeriods: [],
      draftSchedule: [],
      unscheduledTasks: [],
      warnings: [],
      targetDate: undefined,
    });
  });

  it.each([
    { name: 'an empty selection', ids: [] },
    { name: 'duplicate IDs', ids: ['known', 'known'] },
    { name: 'an unknown ID', ids: ['missing'] },
  ])('rejects $name before the conflict recheck', async ({ ids }) => {
    const harness = createHarness();
    const draft = await createDraft(harness);
    const known = draft.blocks[0].id;
    const requested = ids.map((id) => id === 'known' ? known : id);
    harness.calendar.busyCalls = [];

    await expect(harness.orchestrator.approveSchedule(requested)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      retryable: false,
    });
    expect(harness.calendar.busyCalls).toEqual([]);
    expect(harness.calendar.insertCalls).toEqual([]);
  });

  it('validates a known selected ID and re-fetches busy periods before insertion', async () => {
    const harness = createHarness();
    const draft = await createDraft(harness);
    harness.calendar.busyCalls = [];
    harness.calendar.busyResponses = [[]];

    await harness.orchestrator.approveSchedule([draft.blocks[0].id]);

    expect(harness.calendar.busyCalls).toEqual([{ targetDate: TARGET_DATE, settings: SETTINGS }]);
    expect(harness.calendar.insertCalls).toHaveLength(1);
  });

  it('stores and returns a revised draft without inserting when fresh availability conflicts', async () => {
    const harness = createHarness();
    const draft = await createDraft(harness);
    const newConflict = busy(draft.blocks[0].start, draft.blocks[0].end);
    harness.calendar.busyResponses = [[newConflict]];

    const result = await harness.orchestrator.approveSchedule([draft.blocks[0].id]);

    expect(result.status).toBe('conflict-detected');
    if (result.status !== 'conflict-detected') throw new Error('Expected conflict result');
    expect(result.schedule.busyPeriods).toEqual([newConflict]);
    expect(result.schedule.blocks[0].start).not.toBe(draft.blocks[0].start);
    expect(harness.calendar.insertCalls).toEqual([]);
    expect(harness.session.getSnapshot().draftSchedule).toEqual(result.schedule.blocks);
  });

  it('queues a draft update behind approval until the selected block is inserted', async () => {
    const harness = createHarness();
    const draft = await createDraft(harness);
    const busyRead = deferred<BusyPeriod[]>();
    const busyStarted = deferred<void>();
    harness.calendar.busyResponses = [busyRead.promise];
    harness.calendar.onBusyCall = () => busyStarted.resolve();
    const approval = harness.orchestrator.approveSchedule([draft.blocks[0].id]);
    await busyStarted.promise;
    const edited = [{
      ...draft.blocks[0],
      start: '2026-08-03T10:00:00+01:00',
      end: '2026-08-03T11:00:00+01:00',
    }];
    const loadCallsBeforeUpdate = harness.settings.loadCalls;

    const update = harness.orchestrator.updateSchedule(edited);
    const loadCallsBeforeApprovalFinished = harness.settings.loadCalls;
    busyRead.resolve([]);
    await approval;
    await update;

    expect(loadCallsBeforeApprovalFinished).toBe(loadCallsBeforeUpdate);
    expect(harness.calendar.insertCalls.map((call) => call.block.id)).toEqual([
      draft.blocks[0].id,
    ]);
    expect(harness.session.getSnapshot().draftSchedule).toEqual(edited);
  });

  it('queues reset behind a pending approval conflict replacement', async () => {
    const harness = createHarness();
    const draft = await createDraft(harness);
    const busyRead = deferred<BusyPeriod[]>();
    const busyStarted = deferred<void>();
    harness.calendar.busyResponses = [busyRead.promise];
    harness.calendar.onBusyCall = () => busyStarted.resolve();
    const approval = harness.orchestrator.approveSchedule([draft.blocks[0].id]);
    await busyStarted.promise;

    const reset = Promise.resolve(harness.orchestrator.resetSession());
    const targetDateBeforeApprovalFinished = harness.session.getSnapshot().targetDate;
    busyRead.resolve([busy(draft.blocks[0].start, draft.blocks[0].end)]);
    await approval;
    await reset;

    expect(targetDateBeforeApprovalFinished).toBe(TARGET_DATE);
    expect(harness.session.getSnapshot()).toEqual({
      messages: [],
      tasks: [],
      busyPeriods: [],
      draftSchedule: [],
      unscheduledTasks: [],
      warnings: [],
      targetDate: undefined,
    });
  });

  it('does not approve a stale draft while an earlier regeneration is pending', async () => {
    const harness = createHarness();
    const original = await createDraft(harness);
    const regenerationBusy = deferred<BusyPeriod[]>();
    const busyStarted = deferred<void>();
    harness.calendar.busyResponses = [regenerationBusy.promise, []];
    harness.calendar.onBusyCall = () => busyStarted.resolve();
    const regeneration = harness.orchestrator.generateSchedule(TARGET_DATE);
    await busyStarted.promise;

    const approval = harness.orchestrator.approveSchedule([original.blocks[0].id]);
    regenerationBusy.resolve([busy(original.blocks[0].start, original.blocks[0].end)]);
    await regeneration;

    await expect(approval).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'Selected schedule block does not exist.',
    });
    expect(harness.calendar.insertCalls).toEqual([]);
  });

  it('inserts only selected blocks sequentially with deterministic IDs', async () => {
    const harness = createHarness();
    const draft = await createDraft(harness, [
      task({ id: 'task-1', title: 'First task' }),
      task({ id: 'task-2', title: 'Second task', priority: 'medium' }),
    ]);
    const selected = draft.blocks[1];
    harness.calendar.busyResponses = [[]];

    const result = await harness.orchestrator.approveSchedule([selected.id]);

    expect(result).toEqual({
      status: 'completed',
      results: [{
        blockId: selected.id,
        status: 'created',
        googleEventId: createGoogleEventId(CALENDAR_ID, selected),
      }],
    });
    expect(harness.calendar.insertCalls.map((call) => call.block.id)).toEqual([selected.id]);
    expect(harness.calendar.insertCalls[0].task?.id).toBe(selected.taskId);
  });

  it('returns one safe result per block and continues after an insertion throws', async () => {
    const harness = createHarness();
    const draft = await createDraft(harness, [
      task({ id: 'task-1', title: 'First task' }),
      task({ id: 'task-2', title: 'Second task', priority: 'medium' }),
      task({ id: 'task-3', title: 'Third task', priority: 'low' }),
    ]);
    const selectedIds = draft.blocks.map((block) => block.id);
    harness.calendar.busyResponses = [[], []];
    harness.calendar.insertBehavior = ({ block }) => {
      if (block.id === selectedIds[1]) throw new Error('private provider failure');
      return { blockId: block.id, status: 'created', googleEventId: `google-${block.id}` };
    };

    const first = await harness.orchestrator.approveSchedule(selectedIds);
    const firstEventIds = harness.calendar.insertCalls.map((call) => call.eventId);
    const second = await harness.orchestrator.approveSchedule(selectedIds);
    const retryEventIds = harness.calendar.insertCalls.slice(3).map((call) => call.eventId);

    expect(first).toEqual({
      status: 'completed',
      results: [
        { blockId: selectedIds[0], status: 'created', googleEventId: `google-${selectedIds[0]}` },
        { blockId: selectedIds[1], status: 'failed', errorCode: 'CALENDAR_UNAVAILABLE' },
        { blockId: selectedIds[2], status: 'created', googleEventId: `google-${selectedIds[2]}` },
      ],
    });
    expect(second.status).toBe('completed');
    expect(harness.calendar.insertCalls.map((call) => call.block.id)).toEqual([
      ...selectedIds,
      ...selectedIds,
    ]);
    expect(retryEventIds).toEqual(firstEventIds);
    expect(JSON.stringify(first)).not.toContain('private provider failure');
  });

  it('validates edited selected blocks before storing and preserves the prior draft on failure', async () => {
    const harness = createHarness();
    const draft = await createDraft(harness);
    const invalid = [{
      ...draft.blocks[0],
      start: '2026-08-03T08:30:00+01:00',
      end: '2026-08-03T09:30:00+01:00',
    }];

    await expect(harness.orchestrator.updateSchedule(invalid)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'Block is outside working hours.',
    });
    expect(harness.session.getSnapshot().draftSchedule).toEqual(draft.blocks);
  });

  it('rejects an edited selected task block that references a missing task', async () => {
    const harness = createHarness();
    const draft = await createDraft(harness);
    const invalid = [{ ...draft.blocks[0], taskId: 'missing-task' }];

    await expect(harness.orchestrator.updateSchedule(invalid)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'Selected task block references a missing task.',
    });
    expect(harness.session.getSnapshot().draftSchedule).toEqual(draft.blocks);
  });

  it('rejects approval when a selected task block references a missing current task', async () => {
    const harness = createHarness();
    const draft = await createDraft(harness);
    harness.session.replaceTasks([]);
    harness.calendar.busyCalls = [];

    await expect(
      harness.orchestrator.approveSchedule([draft.blocks[0].id]),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'Selected task block references a missing task.',
    });
    expect(harness.calendar.busyCalls).toEqual([]);
    expect(harness.calendar.insertCalls).toEqual([]);
  });

  it('accepts a valid edited draft and safely returns validation warnings', async () => {
    const harness = createHarness();
    const draft = await createDraft(harness);
    const edited = [{
      ...draft.blocks[0],
      end: '2026-08-03T10:30:00+01:00',
    }];

    const result = await harness.orchestrator.updateSchedule(edited);

    expect(result.blocks).toEqual(edited);
    expect(result.warnings).toContain('Long task is missing its required adjacent break.');
    expect(harness.session.getSnapshot().draftSchedule).toEqual(edited);
  });

  it('clears an edit warning after the edited draft adds the required break', async () => {
    const harness = createHarness();
    const draft = await createDraft(harness);
    const longTask = {
      ...draft.blocks[0],
      end: '2026-08-03T10:30:00+01:00',
    };
    const warned = await harness.orchestrator.updateSchedule([longTask]);

    const corrected = await harness.orchestrator.updateSchedule([
      longTask,
      {
        id: 'required-break',
        kind: 'break',
        title: 'Break',
        start: '2026-08-03T10:30:00+01:00',
        end: '2026-08-03T10:40:00+01:00',
        selected: true,
      },
    ]);

    expect(warned.warnings).toEqual([
      'Long task is missing its required adjacent break.',
    ]);
    expect(corrected.warnings).toEqual([]);
  });

  it('resets every ephemeral conversation and planning field', async () => {
    const harness = createHarness();
    await createDraft(harness);

    await harness.orchestrator.resetSession();

    expect(harness.session.getSnapshot()).toEqual({
      messages: [],
      tasks: [],
      busyPeriods: [],
      draftSchedule: [],
      unscheduledTasks: [],
      warnings: [],
      targetDate: undefined,
    });
  });

  it.each([
    { apiKey: false, connected: false, calendarId: false, expected: { hasDeepSeekApiKey: false, googleConnected: false, calendarReady: false } },
    { apiKey: true, connected: false, calendarId: true, expected: { hasDeepSeekApiKey: true, googleConnected: false, calendarReady: false } },
    { apiKey: false, connected: true, calendarId: false, expected: { hasDeepSeekApiKey: false, googleConnected: true, calendarReady: false } },
    { apiKey: true, connected: true, calendarId: true, expected: { hasDeepSeekApiKey: true, googleConnected: true, calendarReady: true } },
  ])('reports setup components independently %#', async ({ apiKey, connected, calendarId, expected }) => {
    const harness = createHarness({
      settings: calendarId ? SETTINGS : DEFAULT_SETTINGS,
    });
    if (apiKey) harness.vault.values.set('deepseek-api-key', 'deepseek-secret-key');
    if (connected) harness.vault.values.set('google-refresh-token', 'google-refresh-token');

    await expect(harness.orchestrator.getSetupStatus()).resolves.toEqual(expected);
  });

  it('persists the ensured calendar settings when Google connects', async () => {
    const harness = createHarness({ settings: DEFAULT_SETTINGS });
    harness.calendar.ensuredSettings = SETTINGS;

    const result = await harness.orchestrator.connectGoogle();

    expect(harness.settings.saved).toEqual([SETTINGS]);
    expect(harness.settings.value).toEqual(SETTINGS);
    expect(result).toEqual({
      hasDeepSeekApiKey: false,
      googleConnected: true,
      calendarReady: true,
    });
  });

  it('disconnects only Google and preserves the DeepSeek key', async () => {
    const harness = createHarness();
    harness.vault.values.set('deepseek-api-key', 'deepseek-secret-key');
    harness.vault.values.set('google-refresh-token', 'google-refresh-token');

    const result = await harness.orchestrator.disconnectGoogle();

    expect(harness.vault.values.get('deepseek-api-key')).toBe('deepseek-secret-key');
    expect(harness.vault.values.has('google-refresh-token')).toBe(false);
    expect(result).toEqual({
      hasDeepSeekApiKey: true,
      googleConnected: false,
      calendarReady: false,
    });
  });

  it('fails safely when workflow methods are used in an invalid state', async () => {
    const harness = createHarness();

    await expect(harness.orchestrator.sendMessage('   ')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(harness.orchestrator.generateSchedule(TARGET_DATE)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(harness.orchestrator.updateSchedule([])).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(harness.orchestrator.approveSchedule(['missing'])).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(harness.orchestrator.updateTask(task({ id: 'missing' }))).rejects.toBeInstanceOf(AppError);
    expect(harness.calendar.busyCalls).toEqual([]);
    expect(harness.calendar.insertCalls).toEqual([]);
  });
});
