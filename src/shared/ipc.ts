import type { AppErrorCode } from './errors';

export const IPC = {
  GET_SETUP_STATUS: 'assistant:get-setup-status',
  SAVE_DEEPSEEK_KEY: 'assistant:save-deepseek-key',
  CONNECT_GOOGLE: 'assistant:connect-google',
  DISCONNECT_GOOGLE: 'assistant:disconnect-google',
  GET_SETTINGS: 'assistant:get-settings',
  UPDATE_SETTINGS: 'assistant:update-settings',
  SEND_MESSAGE: 'assistant:send-message',
  UPDATE_TASK: 'assistant:update-task',
  GENERATE_SCHEDULE: 'assistant:generate-schedule',
  UPDATE_SCHEDULE: 'assistant:update-schedule',
  APPROVE_SCHEDULE: 'assistant:approve-schedule',
  RESET_SESSION: 'assistant:reset-session',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

export type SerializableAppError = {
  code: AppErrorCode;
  message: string;
  retryable: boolean;
};

export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SerializableAppError };
