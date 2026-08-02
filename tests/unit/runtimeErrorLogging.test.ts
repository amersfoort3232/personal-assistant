import { describe, expect, it } from 'vitest';
import { ErrorLogger } from '../../src/main/diagnostics/errorLogger';
import {
  registerRuntimeErrorLogging,
  type RuntimeEventSource,
} from '../../src/main/diagnostics/registerRuntimeErrorLogging';

function createEvents(): RuntimeEventSource & {
  listeners: Map<string, (...args: unknown[]) => void>;
} {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  return {
    listeners,
    on(event, listener) {
      listeners.set(event, listener);
    },
  };
}

describe('runtime error logging', () => {
  it('records fixed runtime operations without command lines or environments', () => {
    const processEvents = createEvents();
    const appEvents = createEvents();
    const webContentsEvents = createEvents();
    const lines: string[] = [];
    const logger = new ErrorLogger({ write: (line) => lines.push(line) }, () => (
      new Date('2026-08-02T19:00:00.000Z')
    ));
    registerRuntimeErrorLogging(processEvents, appEvents, webContentsEvents, logger);

    processEvents.listeners.get('uncaughtExceptionMonitor')?.(new Error('uncaught failure'));
    processEvents.listeners.get('unhandledRejection')?.(new Error('rejected failure'));
    appEvents.listeners.get('child-process-gone')?.({}, {
      type: 'GPU',
      reason: 'crashed',
      exitCode: 7,
      commandLine: 'contains-secret',
      environment: 'contains-secret',
    });
    webContentsEvents.listeners.get('render-process-gone')?.({}, {
      reason: 'killed',
      exitCode: 9,
      commandLine: 'contains-secret',
      environment: 'contains-secret',
    });

    const entries = lines.map((line) => JSON.parse(line));
    expect(entries.map((entry) => entry.operation)).toEqual([
      'process:uncaught-exception',
      'process:unhandled-rejection',
      'electron:child-process-gone',
      'electron:render-process-gone',
    ]);
    expect(entries[2].message).toBe('Electron child process exited: type=GPU; reason=crashed; exitCode=7');
    expect(entries[3].message).toBe('Renderer process exited: reason=killed; exitCode=9');
    expect(JSON.stringify(entries)).not.toContain('contains-secret');
  });
});
