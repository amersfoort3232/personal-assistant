import { describe, expect, it } from 'vitest';
import { registerRendererErrorForwarding } from '../../src/preload/rendererErrorForwarding';

describe('renderer error forwarding', () => {
  it('forwards only bounded primitive Error fields', () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const reports: unknown[] = [];
    registerRendererErrorForwarding(
      (type, listener) => listeners.set(type, listener),
      (report) => reports.push(report),
    );
    const error = new Error(`renderer failed ${'m'.repeat(1200)}`) as Error & { token?: string };
    error.stack = `Error: renderer failed\n${'s'.repeat(9000)}`;
    error.token = 'renderer-private-token';

    listeners.get('error')?.({ error, message: 'fallback' });

    expect(reports).toHaveLength(1);
    expect(JSON.stringify(reports[0])).not.toContain('renderer-private-token');
    expect(reports[0]).toMatchObject({ kind: 'unhandled-error', name: 'Error' });
    expect((reports[0] as { message: string }).message.length).toBe(1000);
    expect((reports[0] as { stack: string }).stack.length).toBe(8000);
  });

  it('does not serialize non-Error rejection values', () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const reports: unknown[] = [];
    registerRendererErrorForwarding(
      (type, listener) => listeners.set(type, listener),
      (report) => reports.push(report),
    );

    listeners.get('unhandledrejection')?.({ reason: { apiKey: 'private-key' } });

    expect(reports).toEqual([{
      kind: 'unhandled-rejection',
      name: 'UnknownError',
      message: 'Unknown non-Error failure.',
    }]);
  });
});
