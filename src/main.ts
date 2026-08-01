import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMainWindowOptions } from './main/app/createMainWindow';
import { isAllowedExternalUrl } from './main/app/securityPolicy';
import { DeepSeekTaskService } from './main/deepseek/deepSeekTaskService';
import { GoogleAuthService } from './main/google/googleAuthService';
import { GoogleCalendarService } from './main/google/googleCalendarService';
import { registerIpcHandlers } from './main/ipc/registerIpcHandlers';
import { AssistantOrchestrator } from './main/orchestrator/assistantOrchestrator';
import { CredentialVault } from './main/security/credentialVault';
import { electronEncryptionAdapter } from './main/security/encryptionAdapter';
import { SessionStore } from './main/session/sessionStore';
import { SettingsRepository } from './main/settings/settingsRepository';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;
declare const GOOGLE_OAUTH_CLIENT_ID: string;
declare const GOOGLE_OAUTH_CLIENT_SECRET: string;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow(
    createMainWindowOptions(path.join(__dirname, 'preload.js')),
  );

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.once('ready-to-show', () => window.show());

  return window;
}

async function loadWindow(window: BrowserWindow, packagedRendererPath: string): Promise<void> {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    await window.loadFile(packagedRendererPath);
  }
}

async function startApplication(): Promise<void> {
  if (!GOOGLE_OAUTH_CLIENT_ID.trim()) {
    dialog.showErrorBox(
      'Personal Assistant configuration required',
      'Google sign-in is unavailable because this build is missing its OAuth client ID.',
    );
    app.quit();
    return;
  }

  const userDataPath = app.getPath('userData');
  const settings = new SettingsRepository(userDataPath);
  const vault = new CredentialVault(
    path.join(userDataPath, 'credentials'),
    electronEncryptionAdapter,
  );
  const session = new SessionStore();
  const taskService = new DeepSeekTaskService(vault);
  const googleAuth = new GoogleAuthService(
    {
      clientId: GOOGLE_OAUTH_CLIENT_ID,
      ...(GOOGLE_OAUTH_CLIENT_SECRET
        ? { clientSecret: GOOGLE_OAUTH_CLIENT_SECRET }
        : {}),
    },
    vault,
    async (url) => {
      await shell.openExternal(url);
    },
  );
  const calendar = new GoogleCalendarService(googleAuth);
  const orchestrator = new AssistantOrchestrator(
    session,
    taskService,
    vault,
    googleAuth,
    calendar,
    settings,
  );
  const packagedRendererPath = path.join(
    __dirname,
    `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
  );
  const window = createWindow();

  registerIpcHandlers(ipcMain, orchestrator, {
    devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL,
    packagedRendererUrl: pathToFileURL(packagedRendererPath).href,
    expectedWebContents: window.webContents,
  });
  app.once('before-quit', () => session.reset());
  await loadWindow(window, packagedRendererPath);
}

void app.whenReady().then(startApplication).catch(() => {
  dialog.showErrorBox(
    'Personal Assistant could not start',
    'The application could not start safely. Please restart and try again.',
  );
  app.quit();
});
app.on('window-all-closed', () => app.quit());
