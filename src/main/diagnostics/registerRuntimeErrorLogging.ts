import type { ErrorLoggerPort } from './errorLogger';

export type RuntimeEventSource = {
  on(event: string, listener: (...args: unknown[]) => void): void;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function textField(details: unknown, name: string): string {
  const value = isRecord(details) ? details[name] : undefined;
  return typeof value === 'string' ? value : 'unknown';
}

function exitCodeField(details: unknown): string {
  const value = isRecord(details) ? details.exitCode : undefined;
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : 'unknown';
}

export function registerRuntimeErrorLogging(
  processEvents: RuntimeEventSource,
  appEvents: RuntimeEventSource,
  webContentsEvents: RuntimeEventSource,
  errorLogger: ErrorLoggerPort,
): void {
  processEvents.on('uncaughtExceptionMonitor', (error) => {
    errorLogger.logError('main', 'process:uncaught-exception', error);
  });
  processEvents.on('unhandledRejection', (reason) => {
    errorLogger.logError('main', 'process:unhandled-rejection', reason);
  });
  appEvents.on('child-process-gone', (_event, details) => {
    errorLogger.logError('main', 'electron:child-process-gone', new Error(
      `Electron child process exited: type=${textField(details, 'type')}; reason=${textField(details, 'reason')}; exitCode=${exitCodeField(details)}`,
    ));
  });
  webContentsEvents.on('render-process-gone', (_event, details) => {
    errorLogger.logError('main', 'electron:render-process-gone', new Error(
      `Renderer process exited: reason=${textField(details, 'reason')}; exitCode=${exitCodeField(details)}`,
    ));
  });
}
