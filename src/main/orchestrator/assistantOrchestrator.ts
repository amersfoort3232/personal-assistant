import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import type {
  AppSettings,
  ApprovalResult,
  BusyPeriod,
  CalendarEvent,
  ChatMessage,
  ConversationSnapshot,
  EventCreationResult,
  ProposedTask,
  ScheduleBlock,
  ScheduleSnapshot,
  SetupStatus,
  UnscheduledTask,
} from '../../shared/domain';
import { AppError } from '../../shared/errors';
import {
  appSettingsSchema,
  proposedTaskSchema,
  scheduleBlockListSchema,
} from '../../shared/schemas';
import { createGoogleEventId } from '../google/eventId';
import {
  buildWorkingWindow,
  deriveFreeIntervals,
  mergeBusyPeriods,
} from '../scheduler/intervals';
import { scheduleTasks } from '../scheduler/scheduleTasks';
import { validateDraft } from '../scheduler/validateDraft';

type SessionSnapshot = {
  messages: ChatMessage[];
  tasks: ProposedTask[];
  busyPeriods: BusyPeriod[];
  draftSchedule: ScheduleBlock[];
  unscheduledTasks: UnscheduledTask[];
  warnings: string[];
  targetDate: string | undefined;
  approvalAttempt?: {
    blocks: ScheduleBlock[];
    results: EventCreationResult[];
  };
};

type SessionPort = {
  getSnapshot(): SessionSnapshot;
  appendMessage(message: ChatMessage): void;
  replaceTasks(tasks: ProposedTask[]): void;
  replaceSchedule(schedule: ScheduleSnapshot, preserveApprovalAttempt?: boolean): void;
  replaceApprovalAttempt(blocks: ScheduleBlock[], results: EventCreationResult[]): void;
  clearSchedule(): void;
  reset(): void;
};

type TaskServicePort = {
  interpret(messages: ChatMessage[]): Promise<ProposedTask[]>;
};

type CredentialVaultPort = {
  get(name: 'deepseek-api-key'): Promise<string | undefined>;
  set(name: 'deepseek-api-key', value: string): Promise<void>;
};

type GoogleAuthPort = {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): Promise<boolean>;
};

type GoogleCalendarPort = {
  ensurePersonalAssistantCalendar(settings: AppSettings): Promise<AppSettings>;
  getBusyPeriods(targetDate: string, settings: AppSettings): Promise<BusyPeriod[]>;
  getTodayCalendar(settings: AppSettings): Promise<CalendarEvent[]>;
  insertBlock(
    calendarId: string,
    block: ScheduleBlock,
    eventId: string,
    task?: ProposedTask,
  ): Promise<EventCreationResult>;
};

type SettingsPort = {
  load(): Promise<AppSettings>;
  save(settings: AppSettings): Promise<void>;
};

const UNSCHEDULED_TASKS_WARNING = 'Some work does not fit. No task was moved to another date.';
const UNSCHEDULED_RETRY_WARNING = 'Some retry events do not fit around current calendar availability.';

function validationError(message: string): AppError {
  return new AppError('VALIDATION_FAILED', message, false);
}

function isValidTargetDate(targetDate: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return false;
  const parsed = new Date(`${targetDate}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === targetDate;
}

function safeInsertionErrorCode(error: unknown): string {
  return error instanceof AppError ? error.code : 'CALENDAR_UNAVAILABLE';
}

function assertSelectedTaskReferences(
  blocks: ScheduleBlock[],
  tasks: ProposedTask[],
): void {
  const taskIds = new Set(tasks.map((task) => task.id));
  if (blocks.some((block) => (
    block.selected
    && block.kind === 'task'
    && (!block.taskId || !taskIds.has(block.taskId))
  ))) {
    throw validationError('Selected task block references a missing task.');
  }
}

function assertValidAutomaticSchedule(input: {
  schedule: ScheduleSnapshot;
  busyPeriods: BusyPeriod[];
  tasks: ProposedTask[];
  settings: AppSettings;
  fallbackMessage: string;
}): void {
  const parsed = scheduleBlockListSchema.safeParse(input.schedule.blocks);
  if (!parsed.success) throw validationError(input.fallbackMessage);
  assertSelectedTaskReferences(parsed.data, input.tasks);

  const validation = validateDraft(
    parsed.data,
    input.busyPeriods,
    input.schedule.targetDate,
    input.settings,
  );
  if (!validation.valid) {
    throw validationError(validation.errors[0]?.message ?? input.fallbackMessage);
  }
}

function settledAttemptBusyPeriods(
  attempt: SessionSnapshot['approvalAttempt'],
): BusyPeriod[] {
  if (!attempt) return [];
  const settledIds = new Set(attempt.results
    .filter((result) => result.status !== 'failed')
    .map((result) => result.blockId));
  return attempt.blocks
    .filter((block) => settledIds.has(block.id))
    .map((block) => ({
      start: block.start,
      end: block.end,
      sourceCalendarId: 'ephemeral-approval-attempt',
    }));
}

function mergeApprovalAttempt(
  previous: NonNullable<SessionSnapshot['approvalAttempt']> | undefined,
  blocks: ScheduleBlock[],
  results: EventCreationResult[],
): NonNullable<SessionSnapshot['approvalAttempt']> {
  const mergedBlocks = new Map(previous?.blocks.map((block) => [block.id, block]) ?? []);
  const mergedResults = new Map(previous?.results.map((result) => [result.blockId, result]) ?? []);
  for (const block of blocks) mergedBlocks.set(block.id, block);
  for (const result of results) mergedResults.set(result.blockId, result);
  return { blocks: [...mergedBlocks.values()], results: [...mergedResults.values()] };
}

function reconcileApprovalAttemptDraft(
  previous: NonNullable<SessionSnapshot['approvalAttempt']>,
  unresolvedBlocks: ScheduleBlock[],
): NonNullable<SessionSnapshot['approvalAttempt']> {
  const unresolvedIds = new Set(unresolvedBlocks.map((block) => block.id));
  const retainedResults = previous.results.filter((result) => (
    result.status !== 'failed' || unresolvedIds.has(result.blockId)
  ));
  const retainedIds = new Set(retainedResults.map((result) => result.blockId));
  const blocks = new Map(previous.blocks
    .filter((block) => retainedIds.has(block.id))
    .map((block) => [block.id, block]));
  for (const block of unresolvedBlocks) blocks.set(block.id, block);
  return { blocks: [...blocks.values()], results: retainedResults };
}

function reflowRetryBlocks(input: {
  blocks: ScheduleBlock[];
  busyPeriods: BusyPeriod[];
  occupiedResults: BusyPeriod[];
  settings: AppSettings;
  targetDate: string;
}): ScheduleSnapshot {
  const window = buildWorkingWindow(input.targetDate, input.settings);
  const occupied = mergeBusyPeriods(
    [...input.busyPeriods, ...input.occupiedResults],
    window,
  );
  const free = deriveFreeIntervals(window, occupied);
  const scheduled: ScheduleBlock[] = [];
  const unscheduledMinutes = new Map<string, number>();
  let omittedBreaks = 0;

  const ordered = input.blocks
    .map((block, index) => ({
      block,
      index,
      startMs: DateTime.fromISO(block.start, { setZone: true }).toMillis(),
      durationMs: DateTime.fromISO(block.end, { setZone: true }).toMillis()
        - DateTime.fromISO(block.start, { setZone: true }).toMillis(),
    }))
    .sort((left, right) => left.startMs - right.startMs || left.index - right.index);

  for (const { block, durationMs } of ordered) {
    const slotIndex = free.findIndex((slot) => slot.endMs - slot.startMs >= durationMs);
    if (slotIndex < 0) {
      if (block.taskId) {
        const durationMinutes = durationMs / 60_000;
        unscheduledMinutes.set(
          block.taskId,
          (unscheduledMinutes.get(block.taskId) ?? 0) + durationMinutes,
        );
      } else {
        omittedBreaks += 1;
      }
      continue;
    }

    const slot = free[slotIndex];
    const startMs = slot.startMs;
    const endMs = startMs + durationMs;
    scheduled.push({
      ...block,
      start: DateTime.fromMillis(startMs, { zone: input.settings.timeZone }).toISO()!,
      end: DateTime.fromMillis(endMs, { zone: input.settings.timeZone }).toISO()!,
      selected: true,
    });
    if (endMs === slot.endMs) free.splice(slotIndex, 1);
    else free[slotIndex] = { startMs: endMs, endMs: slot.endMs };
  }

  const unscheduledTasks: UnscheduledTask[] = [...unscheduledMinutes].map(([
    taskId,
    remainingMinutes,
  ]) => ({ taskId, remainingMinutes, reason: 'no-free-time' }));
  const omittedAny = unscheduledTasks.length > 0 || omittedBreaks > 0;
  return {
    targetDate: input.targetDate,
    busyPeriods: input.busyPeriods,
    blocks: scheduled.sort((left, right) => left.start.localeCompare(right.start)),
    unscheduledTasks,
    warnings: omittedAny ? [UNSCHEDULED_RETRY_WARNING] : [],
  };
}

export class AssistantOrchestrator {
  private operationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly session: SessionPort,
    private readonly taskService: TaskServicePort,
    private readonly vault: CredentialVaultPort,
    private readonly googleAuth: GoogleAuthPort,
    private readonly calendar: GoogleCalendarPort,
    private readonly settings: SettingsPort,
  ) {}

  private runExclusive<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async getSetupStatus(): Promise<SetupStatus> {
    const [apiKey, googleConnected, settings] = await Promise.all([
      this.vault.get('deepseek-api-key'),
      this.googleAuth.isConnected(),
      this.settings.load(),
    ]);
    return {
      hasDeepSeekApiKey: Boolean(apiKey),
      googleConnected,
      calendarReady: googleConnected && Boolean(settings.personalAssistantCalendarId),
    };
  }

  saveDeepSeekApiKey(apiKey: string): Promise<void> {
    return this.runExclusive(async () => {
      const clean = apiKey.trim();
      if (clean.length < 20 || clean.length > 500) {
        throw validationError('DeepSeek API key format is invalid.');
      }
      await this.vault.set('deepseek-api-key', clean);
    });
  }

  connectGoogle(): Promise<SetupStatus> {
    return this.runExclusive(async () => {
      await this.googleAuth.connect();
      const current = await this.settings.load();
      const ready = await this.calendar.ensurePersonalAssistantCalendar(current);
      await this.settings.save(ready);
      return this.getSetupStatus();
    });
  }

  disconnectGoogle(): Promise<SetupStatus> {
    return this.runExclusive(async () => {
      await this.googleAuth.disconnect();
      return this.getSetupStatus();
    });
  }

  async getSettings(): Promise<AppSettings> {
    return this.settings.load();
  }

  getTodayCalendar(): Promise<CalendarEvent[]> {
    return this.runExclusive(async () => {
      if (!await this.googleAuth.isConnected()) {
        throw new AppError('GOOGLE_NOT_CONNECTED', 'Google Calendar is not connected.', false);
      }
      const settings = await this.settings.load();
      if (!settings.personalAssistantCalendarId) {
        throw new AppError('CALENDAR_UNAVAILABLE', 'Personal Assistant calendar is not ready.', false);
      }
      return this.calendar.getTodayCalendar(settings);
    });
  }

  updateSettings(input: AppSettings): Promise<AppSettings> {
    return this.runExclusive(async () => {
      const parsed = appSettingsSchema.safeParse(input);
      if (!parsed.success) throw validationError('Settings are invalid.');
      await this.settings.save(parsed.data);
      return parsed.data;
    });
  }

  resetSession(): Promise<void> {
    return this.runExclusive(() => {
      this.session.reset();
    });
  }

  sendMessage(text: string): Promise<ConversationSnapshot> {
    return this.runExclusive(async () => {
      const clean = text.trim();
      if (!clean) throw validationError('Message cannot be empty.');

      const userMessage: ChatMessage = {
        id: randomUUID(),
        role: 'user',
        text: clean,
        createdAt: new Date().toISOString(),
      };
      const state = this.session.getSnapshot();
      const tasks = await this.taskService.interpret([...state.messages, userMessage]);
      this.session.appendMessage(userMessage);
      this.session.replaceTasks(tasks);
      this.session.clearSchedule();
      this.session.appendMessage({
        id: randomUUID(),
        role: 'assistant',
        text: `I found ${tasks.length} task${tasks.length === 1 ? '' : 's'}. Review the details before scheduling.`,
        createdAt: new Date().toISOString(),
      });
      const updated = this.session.getSnapshot();
      return { messages: updated.messages, tasks: updated.tasks };
    });
  }

  updateTask(task: ProposedTask): Promise<ConversationSnapshot> {
    return this.runExclusive(() => {
      const parsed = proposedTaskSchema.safeParse(task);
      if (!parsed.success) throw validationError('Task is invalid.');

      const state = this.session.getSnapshot();
      if (!state.tasks.some((item) => item.id === parsed.data.id)) {
        throw validationError('Task does not exist.');
      }
      const tasks = state.tasks.map((item) => item.id === parsed.data.id ? parsed.data : item);
      this.session.replaceTasks(tasks);
      this.session.clearSchedule();
      const updated = this.session.getSnapshot();
      return { messages: updated.messages, tasks: updated.tasks };
    });
  }

  generateSchedule(targetDate: string): Promise<ScheduleSnapshot> {
    return this.runExclusive(async () => {
      if (!isValidTargetDate(targetDate)) throw validationError('Selected date is invalid.');

      const state = this.session.getSnapshot();
      if (state.tasks.length === 0) throw validationError('No tasks are ready to schedule.');

      const settings = await this.settings.load();
      const busyPeriods = await this.calendar.getBusyPeriods(targetDate, settings);
      const schedule = scheduleTasks({ targetDate, tasks: state.tasks, busyPeriods, settings });
      assertValidAutomaticSchedule({
        schedule,
        busyPeriods,
        tasks: state.tasks,
        settings,
        fallbackMessage: 'Generated schedule is invalid.',
      });
      this.session.replaceSchedule(schedule);
      return schedule;
    });
  }

  updateSchedule(blocks: ScheduleBlock[]): Promise<ScheduleSnapshot> {
    return this.runExclusive(async () => {
      const state = this.session.getSnapshot();
      if (!state.targetDate) throw validationError('No schedule exists.');

      const parsed = scheduleBlockListSchema.safeParse(blocks);
      if (!parsed.success) throw validationError('Schedule blocks are invalid.');
      assertSelectedTaskReferences(parsed.data, state.tasks);
      const retryAttempt = state.approvalAttempt?.results.some((result) => result.status === 'failed')
        ? state.approvalAttempt
        : undefined;
      if (retryAttempt) {
        const unresolvedIds = new Set(retryAttempt.results
          .filter((result) => result.status === 'failed')
          .map((result) => result.blockId));
        if (parsed.data.some((block) => !unresolvedIds.has(block.id))) {
          throw validationError('Only unresolved retry blocks can be edited.');
        }
      }
      const settings = await this.settings.load();
      const validation = validateDraft(
        parsed.data,
        [...state.busyPeriods, ...settledAttemptBusyPeriods(retryAttempt)],
        state.targetDate,
        settings,
      );
      if (!validation.valid) {
        throw validationError(validation.errors[0]?.message ?? 'Schedule blocks are invalid.');
      }

      const warnings = [...new Set([
        ...(state.unscheduledTasks.length > 0 ? [UNSCHEDULED_TASKS_WARNING] : []),
        ...validation.warnings.map((warning) => warning.message),
      ])];
      const schedule: ScheduleSnapshot = {
        targetDate: state.targetDate,
        busyPeriods: state.busyPeriods,
        blocks: parsed.data,
        unscheduledTasks: state.unscheduledTasks,
        warnings,
      };
      this.session.replaceSchedule(schedule, Boolean(retryAttempt));
      if (retryAttempt) {
        const reconciledAttempt = reconcileApprovalAttemptDraft(retryAttempt, parsed.data);
        this.session.replaceApprovalAttempt(reconciledAttempt.blocks, reconciledAttempt.results);
      }
      return schedule;
    });
  }

  approveSchedule(blockIds: string[]): Promise<ApprovalResult> {
    return this.runExclusive(async () => {
      const state = this.session.getSnapshot();
      if (!state.targetDate) throw validationError('No schedule exists.');
      if (blockIds.length === 0) throw validationError('Select at least one schedule block.');
      if (blockIds.some((id) => typeof id !== 'string' || id.length === 0)) {
        throw validationError('Selected block IDs are invalid.');
      }

      const selectedSet = new Set(blockIds);
      if (selectedSet.size !== blockIds.length) {
        throw validationError('Selected block IDs must be unique.');
      }
      const knownIds = new Set(state.draftSchedule.map((block) => block.id));
      if (blockIds.some((id) => !knownIds.has(id))) {
        throw validationError('Selected schedule block does not exist.');
      }
      const approvalAttempt = state.approvalAttempt;
      if (approvalAttempt) {
        const unresolvedIds = new Set(approvalAttempt.results
          .filter((result) => result.status === 'failed')
          .map((result) => result.blockId));
        if (blockIds.some((id) => !unresolvedIds.has(id))) {
          throw validationError('Only failed schedule blocks can be retried.');
        }
      }

      const settings = await this.settings.load();
      if (!settings.personalAssistantCalendarId) {
        throw new AppError(
          'CALENDAR_UNAVAILABLE',
          'Personal Assistant calendar is not ready.',
          false,
        );
      }

      const parsed = scheduleBlockListSchema.safeParse(
        state.draftSchedule.map((block) => ({
          ...block,
          selected: selectedSet.has(block.id),
        })),
      );
      if (!parsed.success) throw validationError('Schedule blocks are invalid.');
      assertSelectedTaskReferences(parsed.data, state.tasks);

      const validation = validateDraft(
        parsed.data,
        [...state.busyPeriods, ...settledAttemptBusyPeriods(approvalAttempt)],
        state.targetDate,
        settings,
      );
      if (!validation.valid) {
        throw validationError(validation.errors[0]?.message ?? 'Schedule blocks are invalid.');
      }

      const latestBusy = await this.calendar.getBusyPeriods(state.targetDate, settings);
      const settledBusy = settledAttemptBusyPeriods(approvalAttempt);
      const latestValidation = validateDraft(
        parsed.data,
        [...latestBusy, ...settledBusy],
        state.targetDate,
        settings,
      );
      if (!latestValidation.valid) {
        const revised = approvalAttempt
          ? reflowRetryBlocks({
              blocks: parsed.data.filter((block) => block.selected),
              busyPeriods: latestBusy,
              occupiedResults: settledBusy,
              settings,
              targetDate: state.targetDate,
            })
          : scheduleTasks({
              targetDate: state.targetDate,
              tasks: state.tasks,
              busyPeriods: latestBusy,
              settings,
            });
        assertValidAutomaticSchedule({
          schedule: revised,
          busyPeriods: [...latestBusy, ...settledBusy],
          tasks: state.tasks,
          settings,
          fallbackMessage: approvalAttempt
            ? 'Revised retry schedule is invalid.'
            : 'Revised schedule is invalid.',
        });
        this.session.replaceSchedule(revised, Boolean(approvalAttempt));
        return { status: 'conflict-detected', schedule: revised };
      }

      const results: EventCreationResult[] = [];
      const attemptedBlocks = parsed.data.filter((item) => item.selected);
      for (const block of attemptedBlocks) {
        const proposedTask = block.kind === 'task'
          ? state.tasks.find((item) => item.id === block.taskId)!
          : undefined;
        try {
          results.push(await this.calendar.insertBlock(
            settings.personalAssistantCalendarId,
            block,
            createGoogleEventId(settings.personalAssistantCalendarId, block),
            proposedTask,
          ));
        } catch (error) {
          results.push({
            blockId: block.id,
            status: 'failed',
            errorCode: safeInsertionErrorCode(error),
          });
        }
      }
      const mergedAttempt = mergeApprovalAttempt(approvalAttempt, attemptedBlocks, results);
      this.session.replaceApprovalAttempt(mergedAttempt.blocks, mergedAttempt.results);
      return { status: 'completed', results };
    });
  }
}
