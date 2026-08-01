import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/shared/errors';
import { IPC } from '../../src/shared/ipc';
import { ipcRequestSchemas } from '../../src/shared/schemas';
import {
  handlerDefinitions,
  isTrustedIpcEvent,
  isTrustedSender,
  toIpcError,
  type IpcInvokeEventLike,
} from '../../src/main/ipc/registerIpcHandlers';
import { createAssistantBridge } from '../../src/renderer/bridge';

const packagedRendererUrl = 'file:///C:/Program%20Files/Personal%20Assistant/resources/app/.vite/renderer/main_window/index.html';

describe('IPC sender security', () => {
  it('accepts only the configured development origin', () => {
    const developmentUrl = 'http://localhost:5173';

    expect(isTrustedSender('http://localhost:5173/settings?tab=calendar', developmentUrl)).toBe(true);
    expect(isTrustedSender('http://localhost:5173.evil.example/settings', developmentUrl)).toBe(false);
    expect(isTrustedSender('http://localhost:5174/settings', developmentUrl)).toBe(false);
    expect(isTrustedSender('https://example.com', developmentUrl)).toBe(false);
  });

  it('accepts only the exact packaged renderer file', () => {
    expect(isTrustedSender(packagedRendererUrl, undefined, packagedRendererUrl)).toBe(true);
    expect(isTrustedSender('file:///C:/Program%20Files/Personal%20Assistant/resources/app/.vite/renderer/other/index.html', undefined, packagedRendererUrl)).toBe(false);
    expect(isTrustedSender(`${packagedRendererUrl}.attacker`, undefined, packagedRendererUrl)).toBe(false);
    expect(isTrustedSender('', undefined, packagedRendererUrl)).toBe(false);
    expect(isTrustedSender('not a url', undefined, packagedRendererUrl)).toBe(false);
  });

  it('requires the expected webContents and its current top frame', () => {
    const topFrame = { url: packagedRendererUrl };
    const expectedWebContents = { mainFrame: topFrame };
    const trustedEvent: IpcInvokeEventLike = {
      sender: expectedWebContents,
      senderFrame: topFrame,
    };

    expect(isTrustedIpcEvent(trustedEvent, {
      packagedRendererUrl,
      expectedWebContents,
    })).toBe(true);
    expect(isTrustedIpcEvent({
      sender: expectedWebContents,
      senderFrame: { url: packagedRendererUrl },
    }, {
      packagedRendererUrl,
      expectedWebContents,
    })).toBe(false);
    expect(isTrustedIpcEvent({
      sender: { mainFrame: topFrame },
      senderFrame: topFrame,
    }, {
      packagedRendererUrl,
      expectedWebContents,
    })).toBe(false);
  });
});

describe('IPC payload and error contracts', () => {
  it('uses the shared request schemas for every channel', () => {
    expect(handlerDefinitions[IPC.GET_SETUP_STATUS].schema).toBe(ipcRequestSchemas.getSetupStatus);
    expect(handlerDefinitions[IPC.SEND_MESSAGE].schema).toBe(ipcRequestSchemas.sendMessage);
    expect(handlerDefinitions[IPC.APPROVE_SCHEDULE].schema).toBe(ipcRequestSchemas.approveSchedule);
    expect(handlerDefinitions[IPC.UPDATE_SCHEDULE].schema).toBe(ipcRequestSchemas.updateSchedule);
  });

  it('keeps safe AppError fields and removes private Error details', () => {
    expect(toIpcError(new AppError('CALENDAR_UNAVAILABLE', 'Calendar is temporarily unavailable.', true))).toEqual({
      code: 'CALENDAR_UNAVAILABLE',
      message: 'Calendar is temporarily unavailable.',
      retryable: true,
    });

    const unexpected = new Error('provider response included a private token');
    unexpected.stack = 'private stack';
    expect(toIpcError(unexpected)).toEqual({
      code: 'UNEXPECTED_ERROR',
      message: 'An unexpected error occurred.',
      retryable: false,
    });
  });
});

describe('assistant preload bridge', () => {
  it('maps only named methods to their channel and payload contracts', async () => {
    const invoke = vi.fn(async () => ({ ok: true as const, value: 'result' }));
    const bridge = createAssistantBridge(invoke);

    await bridge.getSetupStatus();
    await bridge.saveDeepSeekApiKey('deepseek-key-value-1234');
    await bridge.connectGoogle();
    await bridge.disconnectGoogle();
    await bridge.getSettings();
    await bridge.updateSettings({
      version: 1,
      timeZone: 'Europe/London',
      workingHours: { start: '09:00', end: '17:00' },
      workingDays: [0, 1, 2, 3, 4, 5, 6],
      breakAfterMinutes: 60,
      breakDurationMinutes: 10,
    });
    await bridge.sendMessage('Plan my day');
    await bridge.updateTask({
      id: 'task-1',
      title: 'Plan my day',
      durationMinutes: 30,
      durationWasEstimated: false,
      priority: 'medium',
      canSplit: false,
      minimumSessionMinutes: 30,
    });
    await bridge.generateSchedule('2026-08-02');
    await bridge.updateSchedule([]);
    await bridge.approveSchedule(['block-1']);
    await bridge.resetSession();

    expect(invoke.mock.calls).toEqual([
      [IPC.GET_SETUP_STATUS],
      [IPC.SAVE_DEEPSEEK_KEY, { apiKey: 'deepseek-key-value-1234' }],
      [IPC.CONNECT_GOOGLE],
      [IPC.DISCONNECT_GOOGLE],
      [IPC.GET_SETTINGS],
      [IPC.UPDATE_SETTINGS, {
        version: 1,
        timeZone: 'Europe/London',
        workingHours: { start: '09:00', end: '17:00' },
        workingDays: [0, 1, 2, 3, 4, 5, 6],
        breakAfterMinutes: 60,
        breakDurationMinutes: 10,
      }],
      [IPC.SEND_MESSAGE, { text: 'Plan my day' }],
      [IPC.UPDATE_TASK, {
        id: 'task-1',
        title: 'Plan my day',
        durationMinutes: 30,
        durationWasEstimated: false,
        priority: 'medium',
        canSplit: false,
        minimumSessionMinutes: 30,
      }],
      [IPC.GENERATE_SCHEDULE, { targetDate: '2026-08-02' }],
      [IPC.UPDATE_SCHEDULE, { blocks: [] }],
      [IPC.APPROVE_SCHEDULE, { blockIds: ['block-1'] }],
      [IPC.RESET_SESSION],
    ]);
    expect(Object.keys(bridge).sort()).toEqual([
      'approveSchedule',
      'connectGoogle',
      'disconnectGoogle',
      'generateSchedule',
      'getSettings',
      'getSetupStatus',
      'resetSession',
      'saveDeepSeekApiKey',
      'sendMessage',
      'updateSchedule',
      'updateSettings',
      'updateTask',
    ]);
  });

  it('rejects with only the structured error returned by main', async () => {
    const safeError = {
      code: 'VALIDATION_FAILED' as const,
      message: 'Request payload is invalid.',
      retryable: false,
    };
    const bridge = createAssistantBridge(async () => ({ ok: false, error: safeError }));

    await expect(bridge.sendMessage('')).rejects.toEqual(safeError);
  });

  it('sanitizes transport and malformed-envelope failures', async () => {
    const transportFailure = createAssistantBridge(async () => {
      throw new Error('electron stack and private argument');
    });
    const malformedEnvelope = createAssistantBridge(async () => ({ private: 'provider body' }));
    const safeError = {
      code: 'UNEXPECTED_ERROR',
      message: 'An unexpected error occurred.',
      retryable: false,
    };

    await expect(transportFailure.getSettings()).rejects.toEqual(safeError);
    await expect(malformedEnvelope.getSettings()).rejects.toEqual(safeError);
  });
});
