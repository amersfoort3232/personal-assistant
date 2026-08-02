import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMainWindowOptions } from './main/app/createMainWindow';
import { handleSquirrelLifecycleEvent } from './main/app/squirrelLifecycle';
import {
  createSystemBrowserOpener,
  isAllowedExternalUrl,
} from './main/app/securityPolicy';
import { selectUserDataPath } from './main/app/runtimeUserDataPath';
import { ErrorLogger } from './main/diagnostics/errorLogger';
import { createElectronLogTransport } from './main/diagnostics/electronLogTransport';
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
declare const __PA_E2E_BUILD__: boolean;
declare const __PA_PRODUCTION_BUILD__: boolean;

const executableDirectory = path.dirname(process.execPath);
const squirrelHandled = handleSquirrelLifecycleEvent(process.argv, {
  executableName: path.basename(process.execPath),
  runUpdate: (args) => {
    const update = spawn(path.resolve(executableDirectory, '..', 'Update.exe'), args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    update.unref();
  },
  scheduleQuit: (delayMs) => setTimeout(() => app.quit(), delayMs),
});

function createWindow(): BrowserWindow {
  const window = new BrowserWindow(
    createMainWindowOptions(
      path.join(__dirname, 'preload.js'),
      __PA_PRODUCTION_BUILD__,
    ),
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
  if (__PA_PRODUCTION_BUILD__) Menu.setApplicationMenu(null);
  const errorLogger = new ErrorLogger(createElectronLogTransport(app.getPath('documents')));

  if (!__PA_E2E_BUILD__ && !GOOGLE_OAUTH_CLIENT_ID.trim()) {
    dialog.showErrorBox(
      'Personal Assistant configuration required',
      'Google sign-in is unavailable because this build is missing its OAuth client ID.',
    );
    app.quit();
    return;
  }

  const userDataPath = selectUserDataPath(
    __PA_E2E_BUILD__,
    process.env,
    app.getPath('userData'),
  );
  let session: SessionStore;
  let orchestrator: AssistantOrchestrator;

  if (__PA_E2E_BUILD__) {
    const { createFakeApplicationServices, fakeFactoryOptionsFromEnvironment } = await import(
      './main/testing/fakeServiceFactory'
    );
    const fake = await createFakeApplicationServices(
      userDataPath,
      fakeFactoryOptionsFromEnvironment(),
    );
    session = fake.session;
    orchestrator = fake.orchestrator;
  } else {
    const settings = new SettingsRepository(userDataPath);
    const vault = new CredentialVault(
      path.join(userDataPath, 'credentials'),
      electronEncryptionAdapter,
    );
    const taskService = new DeepSeekTaskService(vault);
    const googleAuth = new GoogleAuthService(
      {
        clientId: GOOGLE_OAUTH_CLIENT_ID,
        ...(GOOGLE_OAUTH_CLIENT_SECRET
          ? { clientSecret: GOOGLE_OAUTH_CLIENT_SECRET }
          : {}),
      },
      vault,
      createSystemBrowserOpener((url) => shell.openExternal(url)),
    );
    const calendar = new GoogleCalendarService(googleAuth);
    session = new SessionStore();
    orchestrator = new AssistantOrchestrator(
      session,
      taskService,
      vault,
      googleAuth,
      calendar,
      settings,
    );
  }
  const packagedRendererPath = path.join(
    __dirname,
    `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
  );
  const window = createWindow();

  registerIpcHandlers(ipcMain, orchestrator, {
    devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL,
    packagedRendererUrl: pathToFileURL(packagedRendererPath).href,
    expectedWebContents: window.webContents,
  }, errorLogger);
  app.once('before-quit', () => session.reset());
  await loadWindow(window, packagedRendererPath);
}

if (!squirrelHandled) {
  void app.whenReady().then(startApplication).catch(() => {
    dialog.showErrorBox(
      'Personal Assistant could not start',
      'The application could not start safely. Please restart and try again.',
    );
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
}
