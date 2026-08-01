import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { createMainWindowOptions } from './main/app/createMainWindow';
import { isAllowedExternalUrl } from './main/app/securityPolicy';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

async function createWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow(
    createMainWindowOptions(path.join(__dirname, 'preload.js')),
  );

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.once('ready-to-show', () => window.show());

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    await window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
  return window;
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
