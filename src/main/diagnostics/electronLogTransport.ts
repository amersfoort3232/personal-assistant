import electronLog from 'electron-log/main';
import { renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { ErrorTransport } from './errorLogger';

export const ERROR_LOG_MAX_BYTES = 5 * 1024 * 1024;

let loggerSequence = 0;

export function createElectronLogTransport(
  documentsPath: string,
  maxSizeBytes = ERROR_LOG_MAX_BYTES,
): ErrorTransport {
  loggerSequence += 1;
  const logger = electronLog.create({ logId: `personal-assistant-errors-${loggerSequence}` });
  const directory = path.join(documentsPath, 'personal-assistant');
  const currentPath = path.join(directory, 'personal-assistant.log');
  const previousPath = path.join(directory, 'personal-assistant.previous.log');

  logger.transports.console.level = false;
  const ipcTransport = logger.transports.ipc;
  if (ipcTransport) ipcTransport.level = false;
  const remoteTransport = logger.transports.remote;
  if (remoteTransport) remoteTransport.level = false;
  logger.transports.file.level = 'error';
  logger.transports.file.format = '{text}';
  logger.transports.file.maxSize = maxSizeBytes;
  logger.transports.file.resolvePathFn = () => currentPath;
  logger.transports.file.archiveLogFn = (oldLogFile) => {
    try {
      rmSync(previousPath, { force: true });
      renameSync(oldLogFile.path, previousPath);
    } catch {
      // Rotation failure must not crash the application.
    }
  };

  return {
    write(line: string) {
      logger.error(line);
    },
  };
}
