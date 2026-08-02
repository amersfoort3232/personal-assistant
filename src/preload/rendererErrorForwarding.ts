import { toRendererErrorReport, type RendererErrorReport } from '../shared/diagnostics';

type AddListener = (
  type: 'error' | 'unhandledrejection',
  listener: (event: unknown) => void,
) => void;

export function registerRendererErrorForwarding(
  addListener: AddListener,
  send: (report: RendererErrorReport) => void,
): void {
  addListener('error', (event) => {
    const value = typeof event === 'object' && event !== null
      ? (event as { error?: unknown; message?: string }).error
        ?? new Error((event as { message?: string }).message ?? 'Renderer failure.')
      : event;
    send(toRendererErrorReport('unhandled-error', value));
  });
  addListener('unhandledrejection', (event) => {
    const reason = typeof event === 'object' && event !== null
      ? (event as { reason?: unknown }).reason
      : event;
    send(toRendererErrorReport('unhandled-rejection', reason));
  });
}
