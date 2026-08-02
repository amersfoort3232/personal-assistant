import { describe, expect, it } from 'vitest';
import { ErrorLogger } from '../../src/main/diagnostics/errorLogger';
import { AppError } from '../../src/shared/errors';

class RecordingTransport {
  readonly lines: string[] = [];

  write(line: string): void {
    this.lines.push(line);
  }
}

describe('ErrorLogger', () => {
  it('writes only approved AppError fields as one JSON line', () => {
    const transport = new RecordingTransport();
    const logger = new ErrorLogger(transport, () => new Date('2026-08-02T19:00:00.000Z'));

    logger.logError(
      'main',
      'ipc:assistant:send-message',
      new AppError('DEEPSEEK_UNAVAILABLE', 'DeepSeek rejected the request.', false),
    );

    expect(transport.lines).toEqual([JSON.stringify({
      timestamp: '2026-08-02T19:00:00.000Z',
      level: 'error',
      process: 'main',
      operation: 'ipc:assistant:send-message',
      code: 'DEEPSEEK_UNAVAILABLE',
      retryable: false,
      message: 'DeepSeek rejected the request.',
    })]);
  });

  it('bounds unexpected errors and ignores arbitrary private properties', () => {
    const transport = new RecordingTransport();
    const logger = new ErrorLogger(transport, () => new Date('2026-08-02T19:00:00.000Z'));
    const error = new Error(`provider failure ${'m'.repeat(1200)}`) as Error & { apiKey?: string };
    error.stack = `Error: provider failure\n${'s'.repeat(9000)}`;
    error.apiKey = 'deepseek-secret-must-not-appear';

    logger.logError('main', 'application-startup', error);

    const line = transport.lines[0];
    const entry = JSON.parse(line);
    expect(entry.message.length).toBe(1000);
    expect(entry.stack.length).toBe(8000);
    expect(line).not.toContain('deepseek-secret-must-not-appear');
    expect(Object.keys(entry).sort()).toEqual([
      'level', 'message', 'operation', 'process', 'stack', 'timestamp',
    ]);
  });

  it('does not serialize non-Error rejection values', () => {
    const transport = new RecordingTransport();
    const logger = new ErrorLogger(transport, () => new Date('2026-08-02T19:00:00.000Z'));

    logger.logError('main', 'process:unhandled-rejection', { token: 'private-token' });

    expect(transport.lines[0]).toContain('Unknown non-Error failure.');
    expect(transport.lines[0]).not.toContain('private-token');
  });

  it('never throws when the transport fails', () => {
    const logger = new ErrorLogger({
      write() {
        throw new Error('disk unavailable');
      },
    });

    expect(() => logger.logError('main', 'ipc:test', new Error('original failure'))).not.toThrow();
  });
});
