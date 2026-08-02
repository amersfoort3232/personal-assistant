import type {
  AppSettings,
  BusyPeriod,
  ChatMessage,
  EventCreationResult,
  ProposedTask,
  ScheduleBlock,
} from '../../shared/domain';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AssistantOrchestrator } from '../orchestrator/assistantOrchestrator';
import { SessionStore } from '../session/sessionStore';
import { SettingsRepository } from '../settings/settingsRepository';

export const E2E_FIXED_TASK_MARKER = 'PA_E2E_FIXED_TASK_STUDY_REACT';
const PERSONAL_ASSISTANT_CALENDAR_ID = 'personal-assistant-e2e@group.calendar.google.com';

const FIXED_TASKS: ProposedTask[] = [
  {
    id: 'task-study-react',
    title: 'Study React',
    durationMinutes: 90,
    durationWasEstimated: false,
    priority: 'high',
    canSplit: false,
    minimumSessionMinutes: 30,
  },
  {
    id: 'task-answer-emails',
    title: 'Answer emails',
    durationMinutes: 30,
    durationWasEstimated: true,
    priority: 'medium',
    canSplit: false,
    minimumSessionMinutes: 15,
  },
];

type FakeFactoryOptions = {
  conflictOnFirstApproval: boolean;
};

export type FakeApplicationServices = {
  orchestrator: AssistantOrchestrator;
  session: SessionStore;
  insertedBlocks: ScheduleBlock[];
};

function busyPeriod(targetDate: string, start: string, end: string): BusyPeriod {
  return {
    start: `${targetDate}T${start}:00+01:00`,
    end: `${targetDate}T${end}:00+01:00`,
    sourceCalendarId: 'primary',
  };
}

export async function createFakeApplicationServices(
  userDataPath: string,
  options: FakeFactoryOptions,
): Promise<FakeApplicationServices> {
  const session = new SessionStore();
  const insertedBlocks: ScheduleBlock[] = [];
  const settings = new SettingsRepository(userDataPath);
  const current = await settings.load();
  const configuredMarkerPath = path.join(userDataPath, 'e2e-deepseek-configured');
  let deepSeekConfigured = await access(configuredMarkerPath).then(
    () => true,
    () => false,
  );

  let googleConnected = Boolean(current.personalAssistantCalendarId);
  let busyQueryCount = 0;

  const orchestrator = new AssistantOrchestrator(
    session,
    {
      interpret: async (_messages: ChatMessage[]) => structuredClone(FIXED_TASKS),
    },
    {
      get: async (_name: 'deepseek-api-key') => (
        deepSeekConfigured ? 'pa-e2e-placeholder-key-never-persisted' : undefined
      ),
      set: async (_name: 'deepseek-api-key', _value: string) => {
        deepSeekConfigured = true;
        await mkdir(userDataPath, { recursive: true });
        await writeFile(configuredMarkerPath, 'configured\n', { mode: 0o600 });
      },
    },
    {
      connect: async () => {
        googleConnected = true;
      },
      disconnect: async () => {
        googleConnected = false;
      },
      isConnected: async () => googleConnected,
    },
    {
      ensurePersonalAssistantCalendar: async (input: AppSettings) => ({
        ...input,
        personalAssistantCalendarId: PERSONAL_ASSISTANT_CALENDAR_ID,
      }),
      getBusyPeriods: async (targetDate: string) => {
        busyQueryCount += 1;
        const periods = [busyPeriod(targetDate, '12:00', '13:00')];
        if (options.conflictOnFirstApproval && busyQueryCount >= 2) {
          periods.push(busyPeriod(targetDate, '10:00', '10:30'));
        }
        return periods;
      },
      insertBlock: async (
        _calendarId: string,
        block: ScheduleBlock,
        eventId: string,
      ): Promise<EventCreationResult> => {
        insertedBlocks.push(structuredClone(block));
        return { blockId: block.id, status: 'created', googleEventId: eventId };
      },
    },
    settings,
  );

  return { orchestrator, session, insertedBlocks };
}

export function fakeFactoryOptionsFromEnvironment(): FakeFactoryOptions {
  return {
    conflictOnFirstApproval: process.env.PA_E2E_CONFLICT_ON_APPROVAL === '1',
  };
}
