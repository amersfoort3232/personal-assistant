import { describe, expect, it, vi } from 'vitest';
import { createMainWindowOptions } from '../../src/main/app/createMainWindow';
import {
  createSystemBrowserOpener,
  isAllowedExternalUrl,
} from '../../src/main/app/securityPolicy';

describe('secure Electron window', () => {
  it('isolates and sandboxes the renderer', () => {
    const options = createMainWindowOptions('C:\\app\\preload.js');

    expect(options.webPreferences).toMatchObject({
      preload: 'C:\\app\\preload.js',
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    });
  });

  it('disables DevTools in production window options', () => {
    const options = createMainWindowOptions('C:\\app\\preload.js', true);

    expect(options.webPreferences?.devTools).toBe(false);
  });

  it('allows only required browser origins', () => {
    expect(isAllowedExternalUrl('https://accounts.google.com/o/oauth2/v2/auth')).toBe(true);
    expect(isAllowedExternalUrl('https://calendar.google.com/calendar/u/0/r')).toBe(true);
    expect(isAllowedExternalUrl('http://example.com')).toBe(false);
    expect(isAllowedExternalUrl('file:///C:/Windows/System32/calc.exe')).toBe(false);
  });

  it('opens only approved Google HTTPS URLs in the system browser', async () => {
    const openExternal = vi.fn(async () => undefined);
    const openBrowser = createSystemBrowserOpener(openExternal);

    await openBrowser('https://accounts.google.com/o/oauth2/v2/auth');
    await openBrowser('https://calendar.google.com/calendar/u/0/r');
    await expect(
      openBrowser('https://evil.example/private?token=do-not-echo'),
    ).rejects.toMatchObject({
      code: 'GOOGLE_AUTH_FAILED',
      message: 'Google authorization URL is not allowed.',
      retryable: false,
    });

    expect(openExternal.mock.calls).toEqual([
      ['https://accounts.google.com/o/oauth2/v2/auth'],
      ['https://calendar.google.com/calendar/u/0/r'],
    ]);
  });
});
