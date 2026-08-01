import { randomUUID } from 'node:crypto';
import type {
  AppSettings,
  ApprovalResult,
  BusyPeriod,
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
};

type SessionPort = {
  getSnapshot(): SessionSnapshot;
  appendMessage(message: ChatMessage): void;
  replaceTasks(tasks: ProposedTask[]): void;
  replaceSchedule(schedule: ScheduleSnapshot): void;
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

export class AssistantOrchestrator {
  constructor(
    private readonly session: SessionPort,
    private readonly taskService: TaskServicePort,
    private readonly vault: CredentialVaultPort,
    private readonly googleAuth: GoogleAuthPort,
    private readonly calendar: GoogleCalendarPort,
    private readonly settings: SettingsPort,
  ) {}

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

  async saveDeepSeekApiKey(apiKey: string): Promise<void> {
    const clean = apiKey.trim();
    if (clean.length < 20 || clean.length > 500) {
      throw validationError('DeepSeek API key format is invalid.');
    }
    await this.vault.set('deepseek-api-key', clean);
  }

  async connectGoogle(): Promise<SetupStatus> {
    await this.googleAuth.connect();
    const current = await this.settings.load();
    const ready = await this.calendar.ensurePersonalAssistantCalendar(current);
    await this.settings.save(ready);
    return this.getSetupStatus();
  }

  async disconnectGoogle(): Promise<SetupStatus> {
    await this.googleAuth.disconnect();
    return this.getSetupStatus();
  }

  async getSettings(): Promise<AppSettings> {
    return this.settings.load();
  }

  async updateSettings(input: AppSettings): Promise<AppSettings> {
    const parsed = appSettingsSchema.safeParse(input);
    if (!parsed.success) throw validationError('Settings are invalid.');
    await this.settings.save(parsed.data);
    return parsed.data;
  }

  resetSession(): void {
    this.session.reset();
  }

  async sendMessage(text: string): Promise<ConversationSnapshot> {
    const clean = text.trim();
    if (!clean) throw validationError('Message cannot be empty.');

    this.session.appendMessage({
      id: randomUUID(),
      role: 'user',
      text: clean,
      createdAt: new Date().toISOString(),
    });
    const state = this.session.getSnapshot();
    const tasks = await this.taskService.interpret(state.messages);
    this.session.replaceTasks(tasks);
    this.session.appendMessage({
      id: randomUUID(),
      role: 'assistant',
      text: `I found ${tasks.length} task${tasks.length === 1 ? '' : 's'}. Review the details before scheduling.`,
      createdAt: new Date().toISOString(),
    });
    const updated = this.session.getSnapshot();
    return { messages: updated.messages, tasks: updated.tasks };
  }

  updateTask(task: ProposedTask): ConversationSnapshot {
    const parsed = proposedTaskSchema.safeParse(task);
    if (!parsed.success) throw validationError('Task is invalid.');

    const state = this.session.getSnapshot();
    if (!state.tasks.some((item) => item.id === parsed.data.id)) {
      throw validationError('Task does not exist.');
    }
    const tasks = state.tasks.map((item) => item.id === parsed.data.id ? parsed.data : item);
    this.session.replaceTasks(tasks);
    const updated = this.session.getSnapshot();
    return { messages: updated.messages, tasks: updated.tasks };
  }

  async generateSchedule(targetDate: string): Promise<ScheduleSnapshot> {
    if (!isValidTargetDate(targetDate)) throw validationError('Selected date is invalid.');

    const state = this.session.getSnapshot();
    if (state.tasks.length === 0) throw validationError('No tasks are ready to schedule.');

    const settings = await this.settings.load();
    const busyPeriods = await this.calendar.getBusyPeriods(targetDate, settings);
    const schedule = scheduleTasks({ targetDate, tasks: state.tasks, busyPeriods, settings });
    this.session.replaceSchedule(schedule);
    return schedule;
  }

  async updateSchedule(blocks: ScheduleBlock[]): Promise<ScheduleSnapshot> {
    const state = this.session.getSnapshot();
    if (!state.targetDate) throw validationError('No schedule exists.');

    const parsed = scheduleBlockListSchema.safeParse(blocks);
    if (!parsed.success) throw validationError('Schedule blocks are invalid.');
    const settings = await this.settings.load();
    const validation = validateDraft(
      parsed.data,
      state.busyPeriods,
      state.targetDate,
      settings,
    );
    if (!validation.valid) {
      throw validationError(validation.errors[0]?.message ?? 'Schedule blocks are invalid.');
    }

    const warnings = [...new Set([
      ...state.warnings,
      ...validation.warnings.map((warning) => warning.message),
    ])];
    const schedule: ScheduleSnapshot = {
      targetDate: state.targetDate,
      busyPeriods: state.busyPeriods,
      blocks: parsed.data,
      unscheduledTasks: state.unscheduledTasks,
      warnings,
    };
    this.session.replaceSchedule(schedule);
    return schedule;
  }

  async approveSchedule(blockIds: string[]): Promise<ApprovalResult> {
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

    const validation = validateDraft(
      parsed.data,
      state.busyPeriods,
      state.targetDate,
      settings,
    );
    if (!validation.valid) {
      throw validationError(validation.errors[0]?.message ?? 'Schedule blocks are invalid.');
    }

    const latestBusy = await this.calendar.getBusyPeriods(state.targetDate, settings);
    const latestValidation = validateDraft(
      parsed.data,
      latestBusy,
      state.targetDate,
      settings,
    );
    if (!latestValidation.valid) {
      const revised = scheduleTasks({
        targetDate: state.targetDate,
        tasks: state.tasks,
        busyPeriods: latestBusy,
        settings,
      });
      this.session.replaceSchedule(revised);
      return { status: 'conflict-detected', schedule: revised };
    }

    const results: EventCreationResult[] = [];
    for (const block of parsed.data.filter((item) => item.selected)) {
      const proposedTask = block.taskId
        ? state.tasks.find((item) => item.id === block.taskId)
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
    return { status: 'completed', results };
  }
}
