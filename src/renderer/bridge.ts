import type {
  AppSettings,
  ApprovalResult,
  ConversationSnapshot,
  ProposedTask,
  ScheduleBlock,
  ScheduleSnapshot,
  SetupStatus,
} from '../shared/domain';
import type { AppErrorCode } from '../shared/errors';
import {
  IPC,
  type IpcChannel,
  type IpcResult,
  type SerializableAppError,
} from '../shared/ipc';

export type AssistantBridge = {
  getSetupStatus(): Promise<SetupStatus>;
  saveDeepSeekApiKey(apiKey: string): Promise<void>;
  connectGoogle(): Promise<SetupStatus>;
  disconnectGoogle(): Promise<SetupStatus>;
  getSettings(): Promise<AppSettings>;
  updateSettings(settings: AppSettings): Promise<AppSettings>;
  sendMessage(text: string): Promise<ConversationSnapshot>;
  updateTask(task: ProposedTask): Promise<ConversationSnapshot>;
  generateSchedule(targetDate: string): Promise<ScheduleSnapshot>;
  updateSchedule(blocks: ScheduleBlock[]): Promise<ScheduleSnapshot>;
  approveSchedule(blockIds: string[]): Promise<ApprovalResult>;
  resetSession(): Promise<void>;
};

export type IpcInvoker = (channel: IpcChannel, payload?: unknown) => Promise<unknown>;

const APP_ERROR_CODES = new Set<AppErrorCode>([
  'VALIDATION_FAILED',
  'DEEPSEEK_UNAVAILABLE',
  'DEEPSEEK_INVALID_RESPONSE',
  'GOOGLE_NOT_CONNECTED',
  'GOOGLE_AUTH_FAILED',
  'CALENDAR_UNAVAILABLE',
  'CONFLICT_DETECTED',
  'CREDENTIAL_STORAGE_UNAVAILABLE',
  'UNEXPECTED_ERROR',
]);

const unexpectedError = (): SerializableAppError => ({
  code: 'UNEXPECTED_ERROR',
  message: 'An unexpected error occurred.',
  retryable: false,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSerializableAppError(value: unknown): value is SerializableAppError {
  if (!isRecord(value) || Object.keys(value).length !== 3) return false;
  return typeof value.code === 'string'
    && APP_ERROR_CODES.has(value.code as AppErrorCode)
    && typeof value.message === 'string'
    && typeof value.retryable === 'boolean';
}

function unwrapResult<T>(value: unknown): T {
  if (!isRecord(value) || typeof value.ok !== 'boolean') throw unexpectedError();
  if (value.ok === true && Object.keys(value).length === 2 && 'value' in value) {
    return value.value as T;
  }
  if (
    value.ok === false
    && Object.keys(value).length === 2
    && isSerializableAppError(value.error)
  ) {
    throw value.error;
  }
  throw unexpectedError();
}

async function invokeSafely<T>(
  invoke: IpcInvoker,
  channel: IpcChannel,
  ...payload: [] | [unknown]
): Promise<T> {
  try {
    const result: IpcResult<T> = await invoke(channel, ...payload) as IpcResult<T>;
    return unwrapResult<T>(result);
  } catch (error) {
    throw isSerializableAppError(error) ? error : unexpectedError();
  }
}

export function createAssistantBridge(invoke: IpcInvoker): AssistantBridge {
  return Object.freeze({
    getSetupStatus: () => invokeSafely<SetupStatus>(invoke, IPC.GET_SETUP_STATUS),
    saveDeepSeekApiKey: (apiKey) => invokeSafely<void>(
      invoke,
      IPC.SAVE_DEEPSEEK_KEY,
      { apiKey },
    ),
    connectGoogle: () => invokeSafely<SetupStatus>(invoke, IPC.CONNECT_GOOGLE),
    disconnectGoogle: () => invokeSafely<SetupStatus>(invoke, IPC.DISCONNECT_GOOGLE),
    getSettings: () => invokeSafely<AppSettings>(invoke, IPC.GET_SETTINGS),
    updateSettings: (settings) => invokeSafely<AppSettings>(
      invoke,
      IPC.UPDATE_SETTINGS,
      settings,
    ),
    sendMessage: (text) => invokeSafely<ConversationSnapshot>(
      invoke,
      IPC.SEND_MESSAGE,
      { text },
    ),
    updateTask: (task) => invokeSafely<ConversationSnapshot>(
      invoke,
      IPC.UPDATE_TASK,
      task,
    ),
    generateSchedule: (targetDate) => invokeSafely<ScheduleSnapshot>(
      invoke,
      IPC.GENERATE_SCHEDULE,
      { targetDate },
    ),
    updateSchedule: (blocks) => invokeSafely<ScheduleSnapshot>(
      invoke,
      IPC.UPDATE_SCHEDULE,
      { blocks },
    ),
    approveSchedule: (blockIds) => invokeSafely<ApprovalResult>(
      invoke,
      IPC.APPROVE_SCHEDULE,
      { blockIds },
    ),
    resetSession: () => invokeSafely<void>(invoke, IPC.RESET_SESSION),
  });
}
