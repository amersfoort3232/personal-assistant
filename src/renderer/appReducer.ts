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
  conflictAnnouncement?: string;
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
  | { type: 'scheduleUpdated'; schedule: ScheduleSnapshot }
  | { type: 'approvalConflict'; schedule: ScheduleSnapshot }
  | { type: 'approvalCompleted'; approval: Extract<ApprovalResult, { status: 'completed' }> }
  | { type: 'approvalRetried'; approval: Extract<ApprovalResult, { status: 'completed' }> }
  | { type: 'sessionReset' };

export const CONFLICT_ANNOUNCEMENT = 'Your calendar changed after this schedule was created. No events were added. Review the revised schedule.';

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
        conflictAnnouncement: undefined,
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
        conflictAnnouncement: undefined,
      };
    case 'scheduleGenerated':
      return {
        ...state,
        view: 'schedule',
        schedule: action.schedule,
        approval: undefined,
        busy: false,
        error: undefined,
        conflictAnnouncement: undefined,
      };
    case 'scheduleUpdated':
      return {
        ...state,
        view: 'schedule',
        schedule: action.schedule,
        busy: false,
        error: undefined,
      };
    case 'approvalConflict':
      return {
        ...state,
        view: 'schedule',
        schedule: action.schedule,
        approval: undefined,
        busy: false,
        error: undefined,
        conflictAnnouncement: CONFLICT_ANNOUNCEMENT,
      };
    case 'approvalCompleted':
      return {
        ...state,
        view: 'result',
        approval: action.approval,
        busy: false,
        error: undefined,
        conflictAnnouncement: undefined,
      };
    case 'approvalRetried': {
      const previous = state.approval?.status === 'completed' ? state.approval.results : [];
      const retriedIds = new Set(action.approval.results.map((result) => result.blockId));
      return {
        ...state,
        view: 'result',
        approval: {
          status: 'completed',
          results: [
            ...previous.filter((result) => !retriedIds.has(result.blockId)),
            ...action.approval.results,
          ],
        },
        busy: false,
        error: undefined,
        conflictAnnouncement: undefined,
      };
    }
    case 'sessionReset':
      return {
        ...state,
        view: 'planning',
        conversation: undefined,
        schedule: undefined,
        approval: undefined,
        busy: false,
        error: undefined,
        conflictAnnouncement: undefined,
      };
  }
}
