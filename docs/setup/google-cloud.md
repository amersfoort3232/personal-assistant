# Google Calendar and DeepSeek setup

## Google Cloud

1. Create or select a Google Cloud project in the Google Cloud Console.
2. Enable the **Google Calendar API** for that project.
3. Configure the OAuth consent screen. For a personal app in testing, add your Google account as a test user.
4. Create an OAuth client with application type **Desktop app**.
5. Set `GOOGLE_OAUTH_CLIENT_ID` before building or starting the app. If Google supplies a client secret, set `GOOGLE_OAUTH_CLIENT_SECRET` as well; otherwise leave it unset.
6. Installed desktop applications cannot keep OAuth client configuration confidential. This app relies on user consent, PKCE, random state, and a loopback callback bound to `127.0.0.1`.
7. Configure only these scopes:
   - `https://www.googleapis.com/auth/calendar.freebusy`
   - `https://www.googleapis.com/auth/calendar.app.created`

The app reads free/busy intervals without event titles and writes only to the **Personal Assistant** calendar it creates.

## DeepSeek

Create a DeepSeek API key, then enter it in the app's setup screen. Never place the key, Google tokens, or client secrets in source control. Credentials are encrypted through Electron's operating-system-backed safe storage.

## PowerShell example

```powershell
$env:GOOGLE_OAUTH_CLIENT_ID='your-desktop-client-id'
# Set this only when Google supplied one:
$env:GOOGLE_OAUTH_CLIENT_SECRET='your-desktop-client-secret'
npm start
```
