import { contextBridge, ipcRenderer } from 'electron';
import { registerRendererErrorForwarding } from './preload/rendererErrorForwarding';
import { createAssistantBridge } from './renderer/bridge';
import { DIAGNOSTIC_IPC } from './shared/ipc';

contextBridge.exposeInMainWorld(
  'assistant',
  createAssistantBridge((channel, payload) => (
    payload === undefined
      ? ipcRenderer.invoke(channel)
      : ipcRenderer.invoke(channel, payload)
  )),
);

registerRendererErrorForwarding(
  (type, listener) => window.addEventListener(type, listener as EventListener),
  (report) => ipcRenderer.send(DIAGNOSTIC_IPC.REPORT_RENDERER_ERROR, report),
);
