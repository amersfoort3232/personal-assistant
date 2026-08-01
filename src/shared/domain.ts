import type { z } from 'zod';
import type {
  appSettingsSchema,
  busyPeriodSchema,
  proposedTaskSchema,
  scheduleBlockSchema,
  taskPrioritySchema,
  unscheduledTaskSchema,
} from './schemas';

export type TaskPriority = z.infer<typeof taskPrioritySchema>;
export type ProposedTask = z.infer<typeof proposedTaskSchema>;
export type BusyPeriod = z.infer<typeof busyPeriodSchema>;
export type ScheduleBlock = z.infer<typeof scheduleBlockSchema>;
export type UnscheduledTask = z.infer<typeof unscheduledTaskSchema>;
export type AppSettings = z.infer<typeof appSettingsSchema>;

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
};

export type SetupStatus = {
  hasDeepSeekApiKey: boolean;
  googleConnected: boolean;
  calendarReady: boolean;
};

export type ConversationSnapshot = {
  messages: ChatMessage[];
  tasks: ProposedTask[];
};

export type ScheduleSnapshot = {
  targetDate: string;
  busyPeriods: BusyPeriod[];
  blocks: ScheduleBlock[];
  unscheduledTasks: UnscheduledTask[];
  warnings: string[];
};

export type EventCreationResult = {
  blockId: string;
  status: 'created' | 'already-existed' | 'failed';
  googleEventId?: string;
  errorCode?: string;
};

export type ApprovalResult =
  | { status: 'conflict-detected'; schedule: ScheduleSnapshot }
  | { status: 'completed'; results: EventCreationResult[] };
