import type { BrowserWindowConstructorOptions } from 'electron';

export function createMainWindowOptions(
  preloadPath: string,
  productionBuild = false,
): BrowserWindowConstructorOptions {
  return {
    width: 1240,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: !productionBuild,
    },
  };
}
