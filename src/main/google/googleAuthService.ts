import { randomBytes } from 'node:crypto';
import { AppError } from '../../shared/errors';
import type { CredentialVault } from '../security/credentialVault';
import { createPkcePair } from './pkce';
import { waitForOAuthCode, type OAuthLoopback } from './oauthLoopbackServer';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.app.created',
];

const REFRESH_TOKEN_KEY = 'google-refresh-token';

export type GoogleOAuthConfig = { clientId: string; clientSecret?: string };
export type BrowserOpener = (url: string) => Promise<void>;
export type OAuthLoopbackFactory = (expectedState: string, timeoutMs?: number) => Promise<OAuthLoopback>;

type GoogleCredentialVault = Pick<CredentialVault, 'get' | 'set' | 'delete'>;
type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
};

function authError(message = 'Google authorization failed.', retryable = true): AppError {
  return new AppError('GOOGLE_AUTH_FAILED', message, retryable);
}

function parseTokenResponse(value: unknown): TokenResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw authError();
  const token = value as Record<string, unknown>;
  if (
    typeof token.access_token !== 'string'
    || token.access_token.length === 0
    || typeof token.expires_in !== 'number'
    || !Number.isFinite(token.expires_in)
    || token.expires_in <= 0
    || ('refresh_token' in token && (
      typeof token.refresh_token !== 'string' || token.refresh_token.length === 0
    ))
  ) {
    throw authError();
  }
  return {
    access_token: token.access_token,
    expires_in: token.expires_in,
    ...(typeof token.refresh_token === 'string' ? { refresh_token: token.refresh_token } : {}),
  };
}

export class GoogleAuthService {
  private accessToken?: { value: string; expiresAt: number };

  constructor(
    private readonly config: GoogleOAuthConfig,
    private readonly vault: GoogleCredentialVault,
    private readonly openBrowser: BrowserOpener,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly createLoopback: OAuthLoopbackFactory = waitForOAuthCode,
  ) {}

  async connect(): Promise<void> {
    const state = randomBytes(32).toString('hex');
    const pkce = createPkcePair();
    let loopback: OAuthLoopback;
    try {
      loopback = await this.createLoopback(state);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw authError('The Google authorization callback could not start.');
    }
    const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authorizationUrl.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: loopback.redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state,
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
    }).toString();

    try {
      await this.openBrowser(authorizationUrl.toString());
      const { code } = await loopback.result;
      const token = await this.exchange({
        code,
        code_verifier: pkce.verifier,
        redirect_uri: loopback.redirectUri,
        grant_type: 'authorization_code',
      });
      if (!token.refresh_token) {
        throw authError('Google did not return a refresh token.');
      }
      await this.vault.set(REFRESH_TOKEN_KEY, token.refresh_token);
      this.rememberAccessToken(token);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw authError();
    } finally {
      await loopback.close();
    }
  }

  async isConnected(): Promise<boolean> {
    return Boolean(await this.vault.get(REFRESH_TOKEN_KEY));
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) {
      return this.accessToken.value;
    }
    const refreshToken = await this.vault.get(REFRESH_TOKEN_KEY);
    if (!refreshToken) {
      throw new AppError('GOOGLE_NOT_CONNECTED', 'Google is not connected.', false);
    }
    const token = await this.exchange({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    this.rememberAccessToken(token);
    return token.access_token;
  }

  async disconnect(): Promise<void> {
    this.accessToken = undefined;
    await this.vault.delete(REFRESH_TOKEN_KEY);
  }

  private async exchange(fields: Record<string, string>): Promise<TokenResponse> {
    let response: Response;
    try {
      response = await this.fetchImpl('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.config.clientId,
          ...(this.config.clientSecret ? { client_secret: this.config.clientSecret } : {}),
          ...fields,
        }),
      });
    } catch {
      throw authError('Google token request failed.');
    }
    if (!response.ok) {
      throw authError(`Google token request failed (${response.status}).`);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw authError();
    }
    return parseTokenResponse(payload);
  }

  private rememberAccessToken(token: TokenResponse): void {
    this.accessToken = {
      value: token.access_token,
      expiresAt: Date.now() + token.expires_in * 1_000,
    };
  }
}
