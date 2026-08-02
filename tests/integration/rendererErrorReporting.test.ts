import { describe, expect, it } from 'vitest';
import { ErrorLogger } from '../../src/main/diagnostics/errorLogger';
import {
  registerRendererErrorHandler,
  type IpcMainDiagnosticLike,
  type IpcMainDiagnosticListener,
} from '../../src/main/diagnostics/registerRendererErrorHandler';
import type { IpcInvokeEventLike } from '../../src/main/ipc/registerIpcHandlers';
import { DIAGNOSTIC_IPC } from '../../src/shared/ipc';

const packagedRendererUrl = 'file:///app/.vite/renderer/main_window/index.html';

function createIpcMain(): IpcMainDiagnosticLike & {
  listeners: Map<string, IpcMainDiagnosticListener>;
} {
  const listeners = new Map<string, IpcMainDiagnosticListener>();
  return {
    listeners,
    on(channel, listener) {
      if (listeners.has(channel)) throw new Error(`duplicate listener: ${channel}`);
      listeners.set(channel, listener);
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

describe('renderer error reporting', () => {
  it('logs a trusted, schema-valid report as a safe renderer entry', () => {
    const ipcMain = createIpcMain();
    const { event, expectedWebContents } = createEvent();
    const lines: string[] = [];
    const logger = new ErrorLogger({ write: (line) => lines.push(line) }, () => (
      new Date('2026-08-02T19:00:00.000Z')
    ));
    registerRendererErrorHandler(ipcMain, {
      packagedRendererUrl,
      expectedWebContents,
    }, logger);

    ipcMain.listeners.get(DIAGNOSTIC_IPC.REPORT_RENDERER_ERROR)?.(event, {
      kind: 'unhandled-error',
      name: 'Error',
      message: 'Renderer failed.',
      stack: 'Error: Renderer failed.',
    });

    expect(lines.map((line) => JSON.parse(line))).toEqual([{
      timestamp: '2026-08-02T19:00:00.000Z',
      level: 'error',
      process: 'renderer',
      operation: 'renderer:unhandled-error',
      message: 'Renderer failed.',
      stack: 'Error: Renderer failed.',
    }]);
  });

  it('rejects untrusted and malformed reports without logging their content', () => {
    const ipcMain = createIpcMain();
    const { event, expectedWebContents } = createEvent();
    const lines: string[] = [];
    registerRendererErrorHandler(ipcMain, {
      packagedRendererUrl,
      expectedWebContents,
    }, new ErrorLogger({ write: (line) => lines.push(line) }));
    const listener = ipcMain.listeners.get(DIAGNOSTIC_IPC.REPORT_RENDERER_ERROR);

    listener?.({
      sender: { mainFrame: event.senderFrame! },
      senderFrame: event.senderFrame,
    }, {
      kind: 'unhandled-error',
      name: 'Error',
      message: 'private untrusted detail',
    });
    listener?.(event, {
      kind: 'unhandled-error',
      name: 'Error',
      message: 'private malformed detail',
      extra: 'rejected',
    });

    expect(lines).toEqual([]);
  });
});
