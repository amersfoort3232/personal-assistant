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
