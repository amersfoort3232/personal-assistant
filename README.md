# Personal Assistant

A local-first Windows Electron assistant that turns a conversation into an editable day plan and adds only approved blocks to a dedicated Google Calendar.

## Requirements

- Windows 10 or 11, x64
- Node.js 24 LTS
- A DeepSeek API key
- A Google Cloud Desktop OAuth client with the Google Calendar API enabled

See [Google Calendar and DeepSeek setup](docs/setup/google-cloud.md) before starting the production app.

## Development

```powershell
npm ci
npm run check
npm start
```

The renderer is sandboxed and has no direct Node.js or network access. Chat, task, and draft-schedule state stays in memory and is forgotten when the app closes. The DeepSeek API key and Google refresh token are encrypted. The Desktop OAuth client values are build configuration and cannot be kept confidential in an installed app; do not commit `.env` files, API keys, or tokens.

## Windows release build

Set `GOOGLE_OAUTH_CLIENT_ID` and, only if supplied by Google, `GOOGLE_OAUTH_CLIENT_SECRET`, then run:

```powershell
npm run check
npm run make
npm run assert:production-package
npm run verify:fuses
```

The Squirrel.Windows installer is written beneath `out/make/squirrel.windows/x64`. Production builds use `personal-assistant.exe`, disable DevTools and unsafe Node launch options through Electron fuses, validate and exclusively load `app.asar`, and exclude the deterministic E2E fake services.

## End-to-end build

`npm run verify:e2e` creates a compile-time fake build using a temporary test profile. `PA_TEST_USER_DATA_PATH` is ignored by production builds. Never run E2E tests against your normal Electron user-data directory.
