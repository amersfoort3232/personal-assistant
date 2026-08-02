import { describe, expect, it } from 'vitest';
import { assertGoogleOAuthBuildConfig } from '../../scripts/assert-google-oauth-build-config.mjs';

describe('Google OAuth production build configuration', () => {
  it('rejects a missing client ID with a safe error', () => {
    expect(() => assertGoogleOAuthBuildConfig({ GOOGLE_OAUTH_CLIENT_ID: '   ' }))
      .toThrow('GOOGLE_OAUTH_CLIENT_ID is required for a production build.');
  });

  it('accepts a configured client ID without exposing it in errors', () => {
    const clientId = 'private-client-id.apps.googleusercontent.com';

    expect(() => assertGoogleOAuthBuildConfig({ GOOGLE_OAUTH_CLIENT_ID: clientId })).not.toThrow();
    try {
      assertGoogleOAuthBuildConfig({ GOOGLE_OAUTH_CLIENT_ID: '' });
    } catch (error) {
      expect(String(error)).not.toContain(clientId);
    }
  });
});
