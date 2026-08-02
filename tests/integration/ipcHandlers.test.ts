import { describe, expect, it, vi } from 'vitest';
import type { ErrorLoggerPort, ErrorProcess } from '../../src/main/diagnostics/errorLogger';
import type { AppSettings, ApprovalResult } from '../../src/shared/domain';
import { AppError } from '../../src/shared/errors';
import { IPC, type IpcResult } from '../../src/shared/ipc';
import {
  registerIpcHandlers,
  type IpcInvokeEventLike,
  type IpcMainLike,
  type IpcMainListener,
  type OrchestratorPort,
} from '../../src/main/ipc/registerIpcHandlers';

const packagedRendererUrl = 'file:///app/.vite/renderer/main_window/index.html';

class RecordingErrorLogger implements ErrorLoggerPort {
  readonly entries: Array<{ process: ErrorProcess; operation: string; error: unknown }> = [];

  logError(process: ErrorProcess, operation: string, error: unknown): void {
    this.entries.push({ process, operation, error });
  }
}

function createIpcMain(): IpcMainLike & {
  handlers: Map<string, IpcMainListener>;
} {
  const handlers = new Map<string, IpcMainListener>();
  return {
    handlers,
    handle(channel, listener) {
      if (handlers.has(channel)) throw new Error(`duplicate handler: ${channel}`);
      handlers.set(channel, listener);
    },
  };
}

function createEvent(): { event: IpcInvokeEventLike; expectedWebContents: object } {
  const frame = { url: packagedRendererUrl };
  const expectedWebContents = { mainFrame: frame };
  return {
    event: { sender: expectedWebContents, senderFrame: frame },
    expectedWebContents,
  };
}

function createOrchestrator(): OrchestratorPort {
  const settings: AppSettings = {
    version: 1,
    timeZone: 'Europe/London',
    workingHours: { start: '09:00', end: '17:00' },
    workingDays: [0, 1, 2, 3, 4, 5, 6],
    breakAfterMinutes: 60,
    breakDurationMinutes: 10,
  };
  const approval: ApprovalResult = { status: 'completed', results: [] };
  return {
    getSetupStatus: vi.fn(async () => ({
      hasDeepSeekApiKey: false,
      googleConnected: false,
      calendarReady: false,
    })),
    saveDeepSeekApiKey: vi.fn(async () => undefined),
    connectGoogle: vi.fn(async () => ({
      hasDeepSeekApiKey: false,
      googleConnected: true,
      calendarReady: true,
    })),
    disconnectGoogle: vi.fn(async () => ({
      hasDeepSeekApiKey: false,
      googleConnected: false,
      calendarReady: false,
    })),
    getSettings: vi.fn(async () => settings),
    updateSettings: vi.fn(async (settings) => settings),
    sendMessage: vi.fn(async () => ({ messages: [], tasks: [] })),
    updateTask: vi.fn(async () => ({ messages: [], tasks: [] })),
    generateSchedule: vi.fn(async (targetDate) => ({
      targetDate,
      busyPeriods: [],
      blocks: [],
      unscheduledTasks: [],
      warnings: [],
    })),
    updateSchedule: vi.fn(async () => ({
      targetDate: '2026-08-02',
      busyPeriods: [],
      blocks: [],
      unscheduledTasks: [],
      warnings: [],
    })),
    approveSchedule: vi.fn(async () => approval),
    resetSession: vi.fn(async () => undefined),
  };
}

async function invoke(
  ipcMain: ReturnType<typeof createIpcMain>,
  channel: string,
  event: IpcInvokeEventLike,
  ...args: unknown[]
): Promise<IpcResult<unknown>> {
  const handler = ipcMain.handlers.get(channel);
  if (!handler) throw new Error(`handler not registered: ${channel}`);
  return handler(event, ...args);
}

function register() {
  const ipcMain = createIpcMain();
  const orchestrator = createOrchestrator();
  const errorLogger = new RecordingErrorLogger();
  const { event, expectedWebContents } = createEvent();
  registerIpcHandlers(ipcMain, orchestrator, {
    packagedRendererUrl,
    expectedWebContents,
  }, errorLogger);
  return { ipcMain, orchestrator, event, errorLogger };
}

describe('validated IPC handlers', () => {
  it('registers every approved channel exactly once', () => {
    const { ipcMain } = register();
    expect([...ipcMain.handlers.keys()].sort()).toEqual(Object.values(IPC).sort());
  });

  it('rejects untrusted frames before invoking the orchestrator', async () => {
    const { ipcMain, orchestrator } = register();
    const foreignFrame = { url: 'https://example.com' };
    const result = await invoke(ipcMain, IPC.GET_SETUP_STATUS, {
      sender: { mainFrame: foreignFrame },
      senderFrame: foreignFrame,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'IPC sender is not trusted.',
        retryable: false,
      },
    });
    expect(orchestrator.getSetupStatus).not.toHaveBeenCalled();
  });

  it('validates no-payload calls and payload limits with the shared schemas', async () => {
    const { ipcMain, orchestrator, event } = register();

    const noPayload = await invoke(ipcMain, IPC.GET_SETUP_STATUS, event, { unsafe: true });
    const emptyMessage = await invoke(ipcMain, IPC.SEND_MESSAGE, event, { text: '   ' });
    const tooManyIds = await invoke(ipcMain, IPC.APPROVE_SCHEDULE, event, {
      blockIds: Array.from({ length: 101 }, (_, index) => `block-${index}`),
    });
    const unknownScheduleField = await invoke(ipcMain, IPC.UPDATE_SCHEDULE, event, {
      blocks: [],
      unknown: true,
    });

    for (const result of [noPayload, emptyMessage, tooManyIds, unknownScheduleField]) {
      expect(result).toEqual({
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'IPC request payload is invalid.',
          retryable: false,
        },
      });
    }
    expect(orchestrator.getSetupStatus).not.toHaveBeenCalled();
    expect(orchestrator.sendMessage).not.toHaveBeenCalled();
    expect(orchestrator.approveSchedule).not.toHaveBeenCalled();
    expect(orchestrator.updateSchedule).not.toHaveBeenCalled();
  });

  it('awaits orchestrator methods and returns domain values in success envelopes', async () => {
    const { ipcMain, orchestrator, event } = register();
    let resolveStatus: ((status: {
      hasDeepSeekApiKey: boolean;
      googleConnected: boolean;
      calendarReady: boolean;
    }) => void) | undefined;
    const pending = new Promise<{
      hasDeepSeekApiKey: boolean;
      googleConnected: boolean;
      calendarReady: boolean;
    }>((resolve) => {
      resolveStatus = resolve;
    });
    vi.mocked(orchestrator.getSetupStatus).mockReturnValueOnce(pending);

    const resultPromise = invoke(ipcMain, IPC.GET_SETUP_STATUS, event);
    let settled = false;
    void resultPromise.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveStatus?.({
      hasDeepSeekApiKey: true,
      googleConnected: true,
      calendarReady: true,
    });
    await expect(resultPromise).resolves.toEqual({
      ok: true,
      value: {
        hasDeepSeekApiKey: true,
        googleConnected: true,
        calendarReady: true,
      },
    });
  });

  it('maps validated payloads to the matching async orchestrator method', async () => {
    const { ipcMain, orchestrator, event } = register();

    await invoke(ipcMain, IPC.SEND_MESSAGE, event, { text: '  Plan this  ' });
    await invoke(ipcMain, IPC.GENERATE_SCHEDULE, event, { targetDate: '2026-08-02' });
    await invoke(ipcMain, IPC.APPROVE_SCHEDULE, event, { blockIds: ['block-1'] });

    expect(orchestrator.sendMessage).toHaveBeenCalledWith('Plan this');
    expect(orchestrator.generateSchedule).toHaveBeenCalledWith('2026-08-02');
    expect(orchestrator.approveSchedule).toHaveBeenCalledWith(['block-1']);
  });

  it('returns safe AppError and unexpected-error envelopes', async () => {
    const { ipcMain, orchestrator, event } = register();
    vi.mocked(orchestrator.connectGoogle).mockRejectedValueOnce(
      new AppError('GOOGLE_AUTH_FAILED', 'Google authorization failed.', true),
    );
    vi.mocked(orchestrator.sendMessage).mockRejectedValueOnce(
      new Error('provider body with private prompt and stack'),
    );

    await expect(invoke(ipcMain, IPC.CONNECT_GOOGLE, event)).resolves.toEqual({
      ok: false,
      error: {
        code: 'GOOGLE_AUTH_FAILED',
        message: 'Google authorization failed.',
        retryable: true,
      },
    });
    await expect(invoke(ipcMain, IPC.SEND_MESSAGE, event, { text: 'private input' })).resolves.toEqual({
      ok: false,
      error: {
        code: 'UNEXPECTED_ERROR',
        message: 'An unexpected error occurred.',
        retryable: false,
      },
    });
  });

  it('logs the failed channel and error without passing the IPC payload', async () => {
    const { ipcMain, orchestrator, event, errorLogger } = register();
    const providerError = new Error('provider failed');
    vi.mocked(orchestrator.sendMessage).mockRejectedValueOnce(providerError);

    await invoke(ipcMain, IPC.SEND_MESSAGE, event, { text: 'private planning request' });

    expect(errorLogger.entries).toEqual([{
      process: 'main',
      operation: `ipc:${IPC.SEND_MESSAGE}`,
      error: providerError,
    }]);
    expect(JSON.stringify(errorLogger.entries)).not.toContain('private planning request');
  });
});
