import { AppError } from '../../shared/errors';

const ALLOWED_EXTERNAL_ORIGINS = new Set([
  'https://accounts.google.com',
  'https://calendar.google.com',
]);

export function isAllowedExternalUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && ALLOWED_EXTERNAL_ORIGINS.has(url.origin);
  } catch {
    return false;
  }
}

type OpenExternal = (url: string) => Promise<void>;

export function createSystemBrowserOpener(openExternal: OpenExternal): OpenExternal {
  return async (url) => {
    if (!isAllowedExternalUrl(url)) {
      throw new AppError(
        'GOOGLE_AUTH_FAILED',
        'Google authorization URL is not allowed.',
        false,
      );
    }
    await openExternal(url);
  };
}
