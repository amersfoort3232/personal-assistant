import { AppError } from '../../shared/errors';

export type ErrorProcess = 'main' | 'renderer';

export type ErrorTransport = {
  write(line: string): void;
};

export type ErrorLoggerPort = {
  logError(process: ErrorProcess, operation: string, error: unknown): void;
};

const MESSAGE_LIMIT = 1_000;
const STACK_LIMIT = 8_000;
const OPERATION_LIMIT = 200;

function clean(value: string, limit: number, preserveLines = false): string {
  const controls = preserveLines
    ? /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g
    : /[\u0000-\u001f\u007f]/g;
  return value.replace(controls, ' ').trim().slice(0, limit);
}

export class ErrorLogger implements ErrorLoggerPort {
  constructor(
    private readonly transport: ErrorTransport,
    private readonly now: () => Date = () => new Date(),
  ) {}

  logError(process: ErrorProcess, operation: string, error: unknown): void {
    try {
      const base = {
        timestamp: this.now().toISOString(),
        level: 'error' as const,
        process,
        operation: clean(operation, OPERATION_LIMIT),
      };
      if (error instanceof AppError) {
        this.transport.write(JSON.stringify({
          ...base,
          code: error.code,
          retryable: error.retryable,
          message: clean(error.message, MESSAGE_LIMIT),
        }));
        return;
      }
      if (error instanceof Error) {
        this.transport.write(JSON.stringify({
          ...base,
          message: clean(error.message || error.name, MESSAGE_LIMIT),
          ...(error.stack ? { stack: clean(error.stack, STACK_LIMIT, true) } : {}),
        }));
        return;
      }
      this.transport.write(JSON.stringify({
        ...base,
        message: 'Unknown non-Error failure.',
      }));
    } catch {
      // Error logging must never replace the original application result.
    }
  }
}
