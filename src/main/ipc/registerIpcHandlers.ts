import type { z } from 'zod';
import type {
  AppSettings,
  CalendarEvent,
  ApprovalResult,
  ConversationSnapshot,
  ProposedTask,
  ScheduleBlock,
  ScheduleSnapshot,
  SetupStatus,
} from '../../shared/domain';
import { AppError } from '../../shared/errors';
import {
  IPC,
  type IpcResult,
  type SerializableAppError,
} from '../../shared/ipc';
import { ipcRequestSchemas } from '../../shared/schemas';
import type { ErrorLoggerPort } from '../diagnostics/errorLogger';

type FrameLike = { readonly url: string };
type WebContentsLike = { readonly mainFrame: FrameLike };

export type IpcInvokeEventLike = {
  readonly sender: WebContentsLike;
  readonly senderFrame: FrameLike | null;
};

export type IpcMainListener = (
  event: IpcInvokeEventLike,
  ...args: unknown[]
) => Promise<IpcResult<unknown>>;

export type IpcMainLike = {
  handle(channel: string, listener: IpcMainListener): void;
};

export type OrchestratorPort = {
  getSetupStatus(): Promise<SetupStatus>;
  saveDeepSeekApiKey(apiKey: string): Promise<void>;
  connectGoogle(): Promise<SetupStatus>;
  disconnectGoogle(): Promise<SetupStatus>;
  getSettings(): Promise<AppSettings>;
  getTodayCalendar(): Promise<CalendarEvent[]>;
  updateSettings(settings: AppSettings): Promise<AppSettings>;
  sendMessage(text: string): Promise<ConversationSnapshot>;
  updateTask(task: ProposedTask): Promise<ConversationSnapshot>;
  generateSchedule(targetDate: string): Promise<ScheduleSnapshot>;
  updateSchedule(blocks: ScheduleBlock[]): Promise<ScheduleSnapshot>;
  approveSchedule(blockIds: string[]): Promise<ApprovalResult>;
  resetSession(): Promise<void>;
};

export type TrustedSenderPolicy = {
  readonly devServerUrl?: string;
  readonly packagedRendererUrl: string;
  readonly expectedWebContents: object;
};

type HandlerDefinition<T> = {
  readonly schema: z.ZodType<T>;
  readonly invoke: (orchestrator: OrchestratorPort, payload: T) => Promise<unknown>;
};

export const handlerDefinitions = {
  [IPC.GET_SETUP_STATUS]: {
    schema: ipcRequestSchemas.getSetupStatus,
    invoke: (orchestrator) => orchestrator.getSetupStatus(),
  } satisfies HandlerDefinition<undefined>,
  [IPC.SAVE_DEEPSEEK_KEY]: {
    schema: ipcRequestSchemas.saveDeepSeekApiKey,
    invoke: (orchestrator, payload) => orchestrator.saveDeepSeekApiKey(payload.apiKey),
  } satisfies HandlerDefinition<z.infer<typeof ipcRequestSchemas.saveDeepSeekApiKey>>,
  [IPC.CONNECT_GOOGLE]: {
    schema: ipcRequestSchemas.connectGoogle,
    invoke: (orchestrator) => orchestrator.connectGoogle(),
  } satisfies HandlerDefinition<undefined>,
  [IPC.DISCONNECT_GOOGLE]: {
    schema: ipcRequestSchemas.disconnectGoogle,
    invoke: (orchestrator) => orchestrator.disconnectGoogle(),
  } satisfies HandlerDefinition<undefined>,
  [IPC.GET_SETTINGS]: {
    schema: ipcRequestSchemas.getSettings,
    invoke: (orchestrator) => orchestrator.getSettings(),
  } satisfies HandlerDefinition<undefined>,
  [IPC.GET_TODAY_CALENDAR]: {
    schema: ipcRequestSchemas.getTodayCalendar,
    invoke: (orchestrator) => orchestrator.getTodayCalendar(),
  } satisfies HandlerDefinition<undefined>,
  [IPC.UPDATE_SETTINGS]: {
    schema: ipcRequestSchemas.updateSettings,
    invoke: (orchestrator, payload) => orchestrator.updateSettings(payload),
  } satisfies HandlerDefinition<z.infer<typeof ipcRequestSchemas.updateSettings>>,
  [IPC.SEND_MESSAGE]: {
    schema: ipcRequestSchemas.sendMessage,
    invoke: (orchestrator, payload) => orchestrator.sendMessage(payload.text),
  } satisfies HandlerDefinition<z.infer<typeof ipcRequestSchemas.sendMessage>>,
  [IPC.UPDATE_TASK]: {
    schema: ipcRequestSchemas.updateTask,
    invoke: (orchestrator, payload) => orchestrator.updateTask(payload),
  } satisfies HandlerDefinition<z.infer<typeof ipcRequestSchemas.updateTask>>,
  [IPC.GENERATE_SCHEDULE]: {
    schema: ipcRequestSchemas.generateSchedule,
    invoke: (orchestrator, payload) => orchestrator.generateSchedule(payload.targetDate),
  } satisfies HandlerDefinition<z.infer<typeof ipcRequestSchemas.generateSchedule>>,
  [IPC.UPDATE_SCHEDULE]: {
    schema: ipcRequestSchemas.updateSchedule,
    invoke: (orchestrator, payload) => orchestrator.updateSchedule(payload.blocks),
  } satisfies HandlerDefinition<z.infer<typeof ipcRequestSchemas.updateSchedule>>,
  [IPC.APPROVE_SCHEDULE]: {
    schema: ipcRequestSchemas.approveSchedule,
    invoke: (orchestrator, payload) => orchestrator.approveSchedule(payload.blockIds),
  } satisfies HandlerDefinition<z.infer<typeof ipcRequestSchemas.approveSchedule>>,
  [IPC.RESET_SESSION]: {
    schema: ipcRequestSchemas.resetSession,
    invoke: (orchestrator) => orchestrator.resetSession(),
  } satisfies HandlerDefinition<undefined>,
} as const;

export function isTrustedSender(
  senderUrl: string,
  devServerUrl?: string,
  packagedRendererUrl?: string,
): boolean {
  try {
    const sender = new URL(senderUrl);
    if (devServerUrl) {
      const development = new URL(devServerUrl);
      return (development.protocol === 'http:' || development.protocol === 'https:')
        && sender.origin === development.origin;
    }
    if (!packagedRendererUrl) return false;
    const packaged = new URL(packagedRendererUrl);
    return packaged.protocol === 'file:'
      && sender.protocol === 'file:'
      && sender.href === packaged.href;
  } catch {
    return false;
  }
}

export function isTrustedIpcEvent(
  event: IpcInvokeEventLike,
  policy: TrustedSenderPolicy,
): boolean {
  return event.sender === policy.expectedWebContents
    && event.senderFrame !== null
    && event.senderFrame === event.sender.mainFrame
    && isTrustedSender(
      event.senderFrame.url,
      policy.devServerUrl,
      policy.packagedRendererUrl,
    );
}

export function toIpcError(error: unknown): SerializableAppError {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }
  return {
    code: 'UNEXPECTED_ERROR',
    message: 'An unexpected error occurred.',
    retryable: false,
  };
}

const validationError = (message: string): AppError => (
  new AppError('VALIDATION_FAILED', message, false)
);

function registerHandler<T>(
  ipcMain: IpcMainLike,
  orchestrator: OrchestratorPort,
  policy: TrustedSenderPolicy,
  errorLogger: ErrorLoggerPort,
  channel: string,
  definition: HandlerDefinition<T>,
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      if (!isTrustedIpcEvent(event, policy)) {
        throw validationError('IPC sender is not trusted.');
      }
      if (args.length > 1) {
        throw validationError('IPC request payload is invalid.');
      }
      const parsed = definition.schema.safeParse(args[0]);
      if (!parsed.success) {
        throw validationError('IPC request payload is invalid.');
      }
      const value = await definition.invoke(orchestrator, parsed.data);
      return { ok: true, value };
    } catch (error) {
      errorLogger.logError('main', `ipc:${channel}`, error);
      return { ok: false, error: toIpcError(error) };
    }
  });
}

export function registerIpcHandlers(
  ipcMain: IpcMainLike,
  orchestrator: OrchestratorPort,
  policy: TrustedSenderPolicy,
  errorLogger: ErrorLoggerPort,
): void {
  registerHandler(ipcMain, orchestrator, policy, errorLogger, IPC.GET_SETUP_STATUS, handlerDefinitions[IPC.GET_SETUP_STATUS]);
  registerHandler(ipcMain, orchestrator, policy, errorLogger, IPC.SAVE_DEEPSEEK_KEY, handlerDefinitions[IPC.SAVE_DEEPSEEK_KEY]);
  registerHandler(ipcMain, orchestrator, policy, errorLogger, IPC.CONNECT_GOOGLE, handlerDefinitions[IPC.CONNECT_GOOGLE]);
  registerHandler(ipcMain, orchestrator, policy, errorLogger, IPC.DISCONNECT_GOOGLE, handlerDefinitions[IPC.DISCONNECT_GOOGLE]);
  registerHandler(ipcMain, orchestrator, policy, errorLogger, IPC.GET_SETTINGS, handlerDefinitions[IPC.GET_SETTINGS]);
  registerHandler(ipcMain, orchestrator, policy, errorLogger, IPC.GET_TODAY_CALENDAR, handlerDefinitions[IPC.GET_TODAY_CALENDAR]);
  registerHandler(ipcMain, orchestrator, policy, errorLogger, IPC.UPDATE_SETTINGS, handlerDefinitions[IPC.UPDATE_SETTINGS]);
  registerHandler(ipcMain, orchestrator, policy, errorLogger, IPC.SEND_MESSAGE, handlerDefinitions[IPC.SEND_MESSAGE]);
  registerHandler(ipcMain, orchestrator, policy, errorLogger, IPC.UPDATE_TASK, handlerDefinitions[IPC.UPDATE_TASK]);
  registerHandler(ipcMain, orchestrator, policy, errorLogger, IPC.GENERATE_SCHEDULE, handlerDefinitions[IPC.GENERATE_SCHEDULE]);
  registerHandler(ipcMain, orchestrator, policy, errorLogger, IPC.UPDATE_SCHEDULE, handlerDefinitions[IPC.UPDATE_SCHEDULE]);
  registerHandler(ipcMain, orchestrator, policy, errorLogger, IPC.APPROVE_SCHEDULE, handlerDefinitions[IPC.APPROVE_SCHEDULE]);
  registerHandler(ipcMain, orchestrator, policy, errorLogger, IPC.RESET_SESSION, handlerDefinitions[IPC.RESET_SESSION]);
}
