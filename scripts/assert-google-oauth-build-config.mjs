import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function assertGoogleOAuthBuildConfig(environment) {
  if (typeof environment.GOOGLE_OAUTH_CLIENT_ID !== 'string'
    || environment.GOOGLE_OAUTH_CLIENT_ID.trim().length === 0) {
    throw new Error('GOOGLE_OAUTH_CLIENT_ID is required for a production build.');
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  assertGoogleOAuthBuildConfig(process.env);
  process.stdout.write('Google OAuth build configuration passed.\n');
}
