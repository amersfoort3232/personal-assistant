import { contextBridge, ipcRenderer } from 'electron';
import { createAssistantBridge } from './renderer/bridge';

contextBridge.exposeInMainWorld(
  'assistant',
  createAssistantBridge((channel, payload) => (
    payload === undefined
      ? ipcRenderer.invoke(channel)
      : ipcRenderer.invoke(channel, payload)
  )),
);
