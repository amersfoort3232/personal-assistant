export type AppErrorCode =
  | 'VALIDATION_FAILED'
  | 'DEEPSEEK_UNAVAILABLE'
  | 'DEEPSEEK_INVALID_RESPONSE'
  | 'GOOGLE_NOT_CONNECTED'
  | 'GOOGLE_AUTH_FAILED'
  | 'CALENDAR_UNAVAILABLE'
  | 'CONFLICT_DETECTED'
  | 'CREDENTIAL_STORAGE_UNAVAILABLE'
  | 'UNEXPECTED_ERROR';

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
