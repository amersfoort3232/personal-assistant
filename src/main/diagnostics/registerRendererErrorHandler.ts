import {
  rendererErrorReportSchema,
  type RendererErrorReport,
} from '../../shared/diagnostics';
import { DIAGNOSTIC_IPC } from '../../shared/ipc';
import type { ErrorLoggerPort } from './errorLogger';
import {
  isTrustedIpcEvent,
  type IpcInvokeEventLike,
  type TrustedSenderPolicy,
} from '../ipc/registerIpcHandlers';

export type IpcMainDiagnosticListener = (
  event: IpcInvokeEventLike,
  ...args: unknown[]
) => void;

export type IpcMainDiagnosticLike = {
  on(channel: string, listener: IpcMainDiagnosticListener): void;
};

function reportError(report: RendererErrorReport): Error {
  const error = new Error(report.message);
  error.name = report.name;
  if (report.stack) error.stack = report.stack;
  return error;
}

export function registerRendererErrorHandler(
  ipcMain: IpcMainDiagnosticLike,
  policy: TrustedSenderPolicy,
  errorLogger: ErrorLoggerPort,
): void {
  ipcMain.on(DIAGNOSTIC_IPC.REPORT_RENDERER_ERROR, (event, ...args) => {
    if (!isTrustedIpcEvent(event, policy) || args.length !== 1) return;
    const parsed = rendererErrorReportSchema.safeParse(args[0]);
    if (!parsed.success) return;
    errorLogger.logError('renderer', `renderer:${parsed.data.kind}`, reportError(parsed.data));
  });
}
