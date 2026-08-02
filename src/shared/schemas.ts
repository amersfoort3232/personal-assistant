import { z } from 'zod';

const rfc3339WithOffset = z.string().datetime({ offset: true });
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const taskPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);

export const proposedTaskSchema = z
  .object({
    id: z.string().min(1).max(80),
    title: z.string().trim().min(1).max(160),
    notes: z.string().trim().max(2000).optional(),
    durationMinutes: z.number().int().min(5).max(480),
    durationWasEstimated: z.boolean(),
    priority: taskPrioritySchema,
    fixedStartTime: localTime.optional(),
    canSplit: z.boolean(),
    minimumSessionMinutes: z.number().int().min(15).max(120),
  })
  .strict()
  .superRefine((task, context) => {
    if (task.minimumSessionMinutes > task.durationMinutes) {
      context.addIssue({
        code: 'custom',
        path: ['minimumSessionMinutes'],
        message: 'Minimum session cannot exceed task duration',
      });
    }
  });

export const busyPeriodSchema = z
  .object({
    start: rfc3339WithOffset,
    end: rfc3339WithOffset,
    sourceCalendarId: z.string().min(1),
  })
  .strict();

export const scheduleBlockSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(['task', 'break']),
    taskId: z.string().min(1).optional(),
    title: z.string().trim().min(1).max(160),
    start: rfc3339WithOffset,
    end: rfc3339WithOffset,
    selected: z.boolean(),
    sessionIndex: z.number().int().positive().optional(),
    sessionCount: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((block, context) => {
    if (block.kind === 'task' && !block.taskId) {
      context.addIssue({
        code: 'custom',
        path: ['taskId'],
        message: 'Task block requires taskId',
      });
    }
  });

export const unscheduledTaskSchema = z
  .object({
    taskId: z.string().min(1),
    remainingMinutes: z.number().int().positive(),
    reason: z.enum([
      'no-free-time',
      'fixed-time-conflict',
      'minimum-session-does-not-fit',
    ]),
  })
  .strict();

export const appSettingsSchema = z
  .object({
    version: z.literal(1),
    timeZone: z.literal('Europe/London'),
    workingHours: z.object({ start: z.literal('09:00'), end: z.literal('17:00') }).strict(),
    workingDays: z.tuple([
      z.literal(0),
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
    ]),
    breakAfterMinutes: z.literal(60),
    breakDurationMinutes: z.union([z.literal(10), z.literal(15)]),
    personalAssistantCalendarId: z.string().min(1).optional(),
  })
  .strict();

export const taskListSchema = z.array(proposedTaskSchema).max(30);
export const scheduleBlockListSchema = z.array(scheduleBlockSchema).max(100);

export const ipcRequestSchemas = {
  getSetupStatus: z.undefined(),
  saveDeepSeekApiKey: z.object({ apiKey: z.string().trim().min(20).max(500) }).strict(),
  connectGoogle: z.undefined(),
  disconnectGoogle: z.undefined(),
  getSettings: z.undefined(),
  updateSettings: appSettingsSchema,
  sendMessage: z.object({ text: z.string().trim().min(1).max(5000) }).strict(),
  updateTask: proposedTaskSchema,
  generateSchedule: z.object({ targetDate: z.string().date() }).strict(),
  updateSchedule: z.object({ blocks: scheduleBlockListSchema }).strict(),
  approveSchedule: z.object({ blockIds: z.array(z.string().min(1)).max(100) }).strict(),
  resetSession: z.undefined(),
} as const;
