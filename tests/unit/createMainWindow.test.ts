import { describe, expect, it } from 'vitest';
import { createMainWindowOptions } from '../../src/main/app/createMainWindow';
import { isAllowedExternalUrl } from '../../src/main/app/securityPolicy';

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

  it('allows only required browser origins', () => {
    expect(isAllowedExternalUrl('https://accounts.google.com/o/oauth2/v2/auth')).toBe(true);
    expect(isAllowedExternalUrl('https://calendar.google.com/calendar/u/0/r')).toBe(true);
    expect(isAllowedExternalUrl('http://example.com')).toBe(false);
    expect(isAllowedExternalUrl('file:///C:/Windows/System32/calc.exe')).toBe(false);
  });
});
