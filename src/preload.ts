import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('personalAssistant', Object.freeze({}));
