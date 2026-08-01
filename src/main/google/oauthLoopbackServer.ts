import { createServer } from 'node:http';
import { AppError } from '../../shared/errors';

export type OAuthLoopback = {
  redirectUri: string;
  result: Promise<{ code: string }>;
  close(): Promise<void>;
};

function callbackError(message: string, retryable = false): AppError {
  return new AppError('GOOGLE_AUTH_FAILED', message, retryable);
}

export async function waitForOAuthCode(
  expectedState: string,
  timeoutMs = 120_000,
): Promise<OAuthLoopback> {
  let resolveResult!: (value: { code: string }) => void;
  let rejectResult!: (reason: unknown) => void;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closePromise: Promise<void> | undefined;

  const result = new Promise<{ code: string }>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  void result.catch(() => undefined);

  const server = createServer((request, response) => {
    const finish = (status: number, body: string, outcome: { code: string } | AppError) => {
      response.writeHead(status, {
        connection: 'close',
        'content-type': 'text/plain; charset=utf-8',
      });
      response.end(body);
      settle(outcome);
    };

    if (request.method !== 'GET') {
      response.setHeader('allow', 'GET');
      finish(
        405,
        'Authorization failed. Return to Personal Assistant.',
        callbackError('The Google authorization callback was invalid.'),
      );
      return;
    }

    let url: URL;
    try {
      url = new URL(request.url ?? '/', 'http://127.0.0.1');
    } catch {
      finish(
        400,
        'Authorization failed. Return to Personal Assistant.',
        callbackError('The Google authorization callback was invalid.'),
      );
      return;
    }

    if (url.pathname !== '/oauth2callback') {
      finish(
        404,
        'Authorization failed. Return to Personal Assistant.',
        callbackError('The Google authorization callback was invalid.'),
      );
      return;
    }

    if (url.searchParams.has('error')) {
      finish(
        400,
        'Authorization was not completed. Return to Personal Assistant.',
        callbackError('Google authorization was not completed.', true),
      );
      return;
    }

    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    if (state !== expectedState || !code) {
      finish(
        400,
        'Authorization failed. Return to Personal Assistant.',
        callbackError('The Google authorization callback was invalid.'),
      );
      return;
    }

    finish(200, 'Google Calendar connected. You may close this tab.', { code });
  });

  function close(): Promise<void> {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (closePromise) return closePromise;
    closePromise = new Promise<void>((resolve, reject) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    return closePromise;
  }

  function settle(outcome: { code: string } | AppError): void {
    if (settled) return;
    settled = true;
    if (outcome instanceof AppError) rejectResult(outcome);
    else resolveResult(outcome);
    void close().catch(() => undefined);
  }

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await close();
    throw callbackError('The Google authorization callback could not start.', true);
  }

  timer = setTimeout(() => {
    settle(callbackError('Google authorization timed out.', true));
  }, timeoutMs);

  return {
    redirectUri: `http://127.0.0.1:${address.port}/oauth2callback`,
    result,
    close,
  };
}
