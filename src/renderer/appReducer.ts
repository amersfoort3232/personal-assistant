import type {
  ApprovalResult,
  ConversationSnapshot,
  ScheduleSnapshot,
  SetupStatus,
} from '../shared/domain';

export type AppView = 'loading' | 'setup' | 'planning' | 'schedule' | 'result';

export type RendererState = {
  view: AppView;
  setup?: SetupStatus;
  conversation?: ConversationSnapshot;
  schedule?: ScheduleSnapshot;
  approval?: ApprovalResult;
  busy: boolean;
  error?: string;
};

export const initialRendererState: RendererState = {
  view: 'loading',
  busy: true,
};

export type AppAction =
  | { type: 'setupLoaded'; setup: SetupStatus }
  | { type: 'operationStarted' }
  | { type: 'operationFailed'; message: string }
  | { type: 'setupUpdated'; setup: SetupStatus }
  | { type: 'conversationUpdated'; conversation: ConversationSnapshot }
  | { type: 'scheduleGenerated'; schedule: ScheduleSnapshot }
  | { type: 'sessionReset' };

export function isSetupComplete(setup: SetupStatus): boolean {
  return setup.hasDeepSeekApiKey && setup.googleConnected && setup.calendarReady;
}

export function appReducer(state: RendererState, action: AppAction): RendererState {
  switch (action.type) {
    case 'setupLoaded':
    case 'setupUpdated':
      return {
        ...state,
        view: isSetupComplete(action.setup) ? 'planning' : 'setup',
        setup: action.setup,
        busy: false,
        error: undefined,
      };
    case 'operationStarted':
      return { ...state, busy: true, error: undefined };
    case 'operationFailed':
      return { ...state, busy: false, error: action.message };
    case 'conversationUpdated':
      return {
        ...state,
        view: 'planning',
        conversation: action.conversation,
        schedule: undefined,
        approval: undefined,
        busy: false,
        error: undefined,
      };
    case 'scheduleGenerated':
      return {
        ...state,
        view: 'schedule',
        schedule: action.schedule,
        approval: undefined,
        busy: false,
        error: undefined,
      };
    case 'sessionReset':
      return {
        ...state,
        view: 'planning',
        conversation: undefined,
        schedule: undefined,
        approval: undefined,
        busy: false,
        error: undefined,
      };
  }
}
