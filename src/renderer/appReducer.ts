import type {
  ApprovalResult,
  ConversationSnapshot,
  ScheduleBlock,
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
  approvalBlocks?: ScheduleBlock[];
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
  | { type: 'approvalConflict'; retry: boolean; schedule: ScheduleSnapshot }
  | { type: 'approvalCompleted'; approval: Extract<ApprovalResult, { status: 'completed' }> }
  | { type: 'approvalRetried'; approval: Extract<ApprovalResult, { status: 'completed' }> }
  | { type: 'sessionReset' };

export const CONFLICT_ANNOUNCEMENT = 'Your calendar changed after this schedule was created. No events were added. Review the revised schedule.';
export const RETRY_CONFLICT_ANNOUNCEMENT = 'Your calendar changed while retrying. No retry events were added. Earlier results remain unchanged. Review the revised schedule.';

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
        approvalBlocks: undefined,
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
        approvalBlocks: undefined,
        busy: false,
        error: undefined,
        conflictAnnouncement: undefined,
      };
    case 'scheduleUpdated': {
      if (state.approval?.status === 'completed') {
        const retainedUnresolvedIds = new Set(action.schedule.blocks.map((block) => block.id));
        const results = state.approval.results.filter((result) => (
          result.status !== 'failed' || retainedUnresolvedIds.has(result.blockId)
        ));
        const retainedResultIds = new Set(results.map((result) => result.blockId));
        const blocks = new Map((state.approvalBlocks ?? [])
          .filter((block) => retainedResultIds.has(block.id))
          .map((block) => [block.id, block]));
        for (const block of action.schedule.blocks) blocks.set(block.id, block);
        const hasFailures = results.some((result) => result.status === 'failed');
        return {
          ...state,
          view: hasFailures ? 'schedule' : 'result',
          schedule: action.schedule,
          approval: { status: 'completed', results },
          approvalBlocks: [...blocks.values()],
          busy: false,
          error: undefined,
          conflictAnnouncement: hasFailures ? state.conflictAnnouncement : undefined,
        };
      }
      return {
        ...state,
        view: 'schedule',
        schedule: action.schedule,
        busy: false,
        error: undefined,
      };
    }
    case 'approvalConflict':
      return {
        ...state,
        view: 'schedule',
        schedule: action.schedule,
        approval: action.retry ? state.approval : undefined,
        approvalBlocks: action.retry ? state.approvalBlocks : undefined,
        busy: false,
        error: undefined,
        conflictAnnouncement: action.retry
          ? RETRY_CONFLICT_ANNOUNCEMENT
          : CONFLICT_ANNOUNCEMENT,
      };
    case 'approvalCompleted':
      return {
        ...state,
        view: 'result',
        approval: action.approval,
        approvalBlocks: state.schedule?.blocks,
        busy: false,
        error: undefined,
        conflictAnnouncement: undefined,
      };
    case 'approvalRetried': {
      const previous = state.approval?.status === 'completed' ? state.approval.results : [];
      const retriedIds = new Set(action.approval.results.map((result) => result.blockId));
      const blocks = new Map(state.approvalBlocks?.map((block) => [block.id, block]) ?? []);
      for (const block of state.schedule?.blocks ?? []) blocks.set(block.id, block);
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
        approvalBlocks: [...blocks.values()],
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
        approvalBlocks: undefined,
        busy: false,
        error: undefined,
        conflictAnnouncement: undefined,
      };
  }
}
