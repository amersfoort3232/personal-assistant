import { describe, expect, it, vi } from 'vitest';
import { GoogleAuthService, type OAuthLoopbackFactory } from '../../src/main/google/googleAuthService';
import { waitForOAuthCode } from '../../src/main/google/oauthLoopbackServer';

const APPROVED_SCOPES = [
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.app.created',
];

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createVault(initialRefreshToken?: string) {
  let refreshToken = initialRefreshToken;
  return {
    get: vi.fn(async () => refreshToken),
    set: vi.fn(async (_name: 'google-refresh-token', value: string) => {
      refreshToken = value;
    }),
    delete: vi.fn(async () => {
      refreshToken = undefined;
    }),
  };
}

function createFakeLoopback() {
  const callback = deferred<{ code: string }>();
  const close = vi.fn(async () => undefined);
  let expectedState = '';
  const factory: OAuthLoopbackFactory = vi.fn(async (state) => {
    expectedState = state;
    return {
      redirectUri: 'http://127.0.0.1:49152/oauth2callback',
      result: callback.promise,
      close,
    };
  });
  return { callback, close, factory, get expectedState() { return expectedState; } };
}

function createService(options: {
  initialRefreshToken?: string;
  fetchImpl?: typeof fetch;
  openBrowser?: (url: string) => Promise<void>;
  loopbackFactory?: OAuthLoopbackFactory;
} = {}) {
  const vault = createVault(options.initialRefreshToken);
  const loopback = createFakeLoopback();
  const fetchImpl = options.fetchImpl ?? vi.fn(async () => jsonResponse({
    access_token: 'memory-access-token',
    expires_in: 3600,
    refresh_token: 'stored-refresh-token',
  })) as unknown as typeof fetch;
  const openBrowser = options.openBrowser ?? vi.fn(async () => undefined);
  const service = new GoogleAuthService(
    { clientId: 'desktop-client-id' },
    vault,
    openBrowser,
    fetchImpl,
    options.loopbackFactory ?? loopback.factory,
  );
  return { service, vault, loopback, fetchImpl, openBrowser };
}

describe('GoogleAuthService', () => {
  it('opens a PKCE authorization request with only the approved scopes and stores only the refresh token', async () => {
    const { service, vault, loopback, fetchImpl, openBrowser } = createService();

    const connection = service.connect();
    await vi.waitFor(() => expect(openBrowser).toHaveBeenCalledOnce());
    const authorizationUrl = new URL(vi.mocked(openBrowser).mock.calls[0][0]);

    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:49152/oauth2callback');
    expect(authorizationUrl.searchParams.get('response_type')).toBe('code');
    expect(authorizationUrl.searchParams.get('access_type')).toBe('offline');
    expect(authorizationUrl.searchParams.get('prompt')).toBe('consent');
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizationUrl.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(authorizationUrl.searchParams.get('scope')?.split(' ')).toEqual(APPROVED_SCOPES);
    expect(authorizationUrl.searchParams.get('state')).toBe(loopback.expectedState);
    expect(loopback.expectedState).toMatch(/^[a-f0-9]{64}$/);

    loopback.callback.resolve({ code: 'one-time-code' });
    await connection;

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [endpoint, request] = vi.mocked(fetchImpl).mock.calls[0];
    expect(endpoint).toBe('https://oauth2.googleapis.com/token');
    expect(request?.method).toBe('POST');
    const requestBody = new URLSearchParams(request?.body as string);
    expect(Object.fromEntries(requestBody)).toMatchObject({
      client_id: 'desktop-client-id',
      code: 'one-time-code',
      redirect_uri: 'http://127.0.0.1:49152/oauth2callback',
      grant_type: 'authorization_code',
    });
    expect(requestBody.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(vault.set).toHaveBeenCalledWith('google-refresh-token', 'stored-refresh-token');
    expect(await service.getAccessToken()).toBe('memory-access-token');
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(loopback.close).toHaveBeenCalledOnce();
  });

  it('rejects a mismatched callback state before token exchange', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const vault = createVault();
    let callbackStatus: number | undefined;
    const service = new GoogleAuthService(
      { clientId: 'desktop-client-id' },
      vault,
      async (authorizationUrl) => {
        const url = new URL(authorizationUrl);
        const redirectUri = url.searchParams.get('redirect_uri')!;
        const callbackQuery = new URLSearchParams({ code: 'secret-code', state: 'wrong-state' });
        callbackStatus = (await fetch(`${redirectUri}?${callbackQuery}`)).status;
      },
      fetchImpl,
      waitForOAuthCode,
    );

    const error = await service.connect().catch((reason: unknown) => reason);

    expect(callbackStatus).toBe(400);
    expect(error).toMatchObject({ code: 'GOOGLE_AUTH_FAILED' });
    expect((error as Error).message).not.toContain('secret-code');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(vault.set).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'an OAuth error callback', path: '/oauth2callback?error=access_denied&error_description=private-detail', method: 'GET', status: 400 },
    { name: 'a missing code', path: '/oauth2callback?state=expected-state', method: 'GET', status: 400 },
    { name: 'the wrong callback path', path: '/not-the-callback?code=secret-code&state=expected-state', method: 'GET', status: 404 },
    { name: 'a non-GET callback', path: '/oauth2callback?code=secret-code&state=expected-state', method: 'POST', status: 405 },
  ])('rejects $name without exposing callback values', async ({ path, method, status }) => {
    const loopback = await waitForOAuthCode('expected-state', 1_000);
    try {
      const response = await fetch(new URL(path, loopback.redirectUri), { method });
      const responseBody = await response.text();
      const error = await loopback.result.catch((reason: unknown) => reason);

      expect(response.status).toBe(status);
      expect(responseBody).not.toContain('secret-code');
      expect(responseBody).not.toContain('private-detail');
      expect(error).toMatchObject({ code: 'GOOGLE_AUTH_FAILED' });
      expect((error as Error).message).not.toContain('secret-code');
      expect((error as Error).message).not.toContain('private-detail');
    } finally {
      await loopback.close();
    }
  });

  it('times out and closes an unused loopback callback', async () => {
    const loopback = await waitForOAuthCode('expected-state', 10);

    await expect(loopback.result).rejects.toMatchObject({
      code: 'GOOGLE_AUTH_FAILED',
      retryable: true,
    });
    await expect(loopback.close()).resolves.toBeUndefined();
  });

  it.each([
    null,
    [],
    {},
    { access_token: '', expires_in: 3600, refresh_token: 'refresh-token' },
    { access_token: 'access-token', expires_in: 0, refresh_token: 'refresh-token' },
    { access_token: 'access-token', expires_in: 3600, refresh_token: 42 },
  ])('rejects a malformed token response %# without storing credentials', async (tokenResponse) => {
    const fetchImpl = vi.fn(async () => jsonResponse(tokenResponse)) as unknown as typeof fetch;
    const { service, vault, loopback } = createService({ fetchImpl });

    const connection = service.connect();
    await vi.waitFor(() => expect(loopback.factory).toHaveBeenCalledOnce());
    loopback.callback.resolve({ code: 'one-time-code' });

    await expect(connection).rejects.toMatchObject({ code: 'GOOGLE_AUTH_FAILED' });
    expect(vault.set).not.toHaveBeenCalled();
    expect(loopback.close).toHaveBeenCalledOnce();
  });

  it('rejects invalid token JSON without exposing the authorization code', async () => {
    const fetchImpl = vi.fn(async () => new Response('not-json', { status: 200 })) as unknown as typeof fetch;
    const { service, vault, loopback } = createService({ fetchImpl });

    const connection = service.connect();
    await vi.waitFor(() => expect(loopback.factory).toHaveBeenCalledOnce());
    loopback.callback.resolve({ code: 'secret-code' });
    const error = await connection.catch((reason: unknown) => reason);

    expect(error).toMatchObject({ code: 'GOOGLE_AUTH_FAILED' });
    expect((error as Error).message).not.toContain('secret-code');
    expect(vault.set).not.toHaveBeenCalled();
  });

  it('reports refresh failure safely and retains the stored refresh token', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'invalid_grant', error_description: 'private-detail' }, 400)) as unknown as typeof fetch;
    const { service, vault } = createService({ initialRefreshToken: 'stored-refresh-token', fetchImpl });

    const error = await service.getAccessToken().catch((reason: unknown) => reason);

    expect(error).toMatchObject({ code: 'GOOGLE_AUTH_FAILED', retryable: true });
    expect((error as Error).message).not.toContain('stored-refresh-token');
    expect((error as Error).message).not.toContain('private-detail');
    expect(vault.delete).not.toHaveBeenCalled();
  });

  it('reports a disconnected account without making a token request', async () => {
    const { service, fetchImpl } = createService();

    await expect(service.getAccessToken()).rejects.toMatchObject({ code: 'GOOGLE_NOT_CONNECTED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('deletes the refresh token and clears an in-memory access token on disconnect', async () => {
    const { service, vault, loopback, fetchImpl } = createService();
    const connection = service.connect();
    await vi.waitFor(() => expect(loopback.factory).toHaveBeenCalledOnce());
    loopback.callback.resolve({ code: 'one-time-code' });
    await connection;

    await service.disconnect();

    expect(vault.delete).toHaveBeenCalledWith('google-refresh-token');
    await expect(service.isConnected()).resolves.toBe(false);
    await expect(service.getAccessToken()).rejects.toMatchObject({ code: 'GOOGLE_NOT_CONNECTED' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('closes the loopback server when opening the system browser fails', async () => {
    const { service, loopback } = createService({
      openBrowser: async () => {
        throw new Error('browser unavailable');
      },
    });

    await expect(service.connect()).rejects.toMatchObject({ code: 'GOOGLE_AUTH_FAILED' });
    expect(loopback.close).toHaveBeenCalledOnce();
  });

  it('reports a loopback startup failure without exposing system details', async () => {
    const systemDetail = 'bind failed on a private interface';
    const { service } = createService({
      loopbackFactory: async () => {
        throw new Error(systemDetail);
      },
    });

    const error = await service.connect().catch((reason: unknown) => reason);

    expect(error).toMatchObject({ code: 'GOOGLE_AUTH_FAILED', retryable: true });
    expect((error as Error).message).not.toContain(systemDetail);
  });
});
