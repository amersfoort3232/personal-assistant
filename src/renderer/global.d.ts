import type { AssistantBridge } from './bridge';

declare global {
  interface Window {
    assistant: AssistantBridge;
  }
}

export {};
