import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import type {
  ApprovalResult,
  ConversationSnapshot,
  ProposedTask,
  ScheduleBlock,
  ScheduleSnapshot,
} from '../shared/domain';
import type { SerializableAppError } from '../shared/ipc';
import { appReducer, initialRendererState, isSetupComplete } from './appReducer';
import { ChatPanel } from './components/ChatPanel';
import { ApprovalBar } from './components/ApprovalBar';
import { ApprovalResultView } from './components/ApprovalResultView';
import { ScheduleTimeline } from './components/ScheduleTimeline';
import { SetupScreen } from './components/SetupScreen';
import { TaskReview } from './components/TaskReview';
import { UnscheduledTasks } from './components/UnscheduledTasks';
import type { PlanningActionResult } from './planningActionResult';

type SetupActivity = 'saving-key' | 'connecting-google' | null;
type PlanningActivity =
  | 'interpreting'
  | 'updating-task'
  | 'generating-schedule'
  | 'updating-schedule'
  | 'approving-schedule'
  | 'resetting-session'
  | null;

const LONDON_ZONE = 'Europe/London';

function currentLondonDate(): string {
  return DateTime.now().setZone(LONDON_ZONE).toISODate() ?? '';
}

function publicErrorMessage(error: unknown): string {
  if (
    typeof error === 'object'
    && error !== null
    && typeof (error as Partial<SerializableAppError>).code === 'string'
    && typeof (error as Partial<SerializableAppError>).message === 'string'
    && typeof (error as Partial<SerializableAppError>).retryable === 'boolean'
  ) {
    return (error as SerializableAppError).message;
  }
  return 'Something went wrong. Please try again.';
}

export function App() {
  const [state, dispatch] = useReducer(appReducer, initialRendererState);
  const [activity, setActivity] = useState<SetupActivity>(null);
  const [planningActivity, setPlanningActivity] = useState<PlanningActivity>(null);
  const [selectedDate, setSelectedDate] = useState(currentLondonDate);
  const [composerResetToken, setComposerResetToken] = useState(0);
  const mounted = useRef(false);
  const setupRequest = useRef<ReturnType<typeof window.assistant.getSetupStatus> | undefined>(undefined);
  const operationInFlight = useRef<Promise<unknown> | null>(null);
  const focusPlanningAfterSetup = useRef(false);
  const planningHeading = useRef<HTMLHeadingElement>(null);
  const setupRef = useRef(state.setup);
  setupRef.current = state.setup;

  useEffect(() => {
    mounted.current = true;
    const request = setupRequest.current ??= window.assistant.getSetupStatus();

    request.then(
      (setup) => {
        if (mounted.current) dispatch({ type: 'setupLoaded', setup });
      },
      (error: unknown) => {
        if (mounted.current) {
          dispatch({ type: 'operationFailed', message: publicErrorMessage(error) });
        }
      },
    );

    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (state.view !== 'planning' || !focusPlanningAfterSetup.current) return;

    focusPlanningAfterSetup.current = false;
    planningHeading.current?.focus();
  }, [state.view]);

  const applySetupUpdate = useCallback((setup: NonNullable<typeof state.setup>) => {
    if (isSetupComplete(setup)) focusPlanningAfterSetup.current = true;
    dispatch({ type: 'setupUpdated', setup });
  }, []);

  const runSetupOperation = useCallback(async <T,>(
    nextActivity: Exclude<SetupActivity, null>,
    operation: () => Promise<T>,
    onSuccess: (result: T) => void,
  ): Promise<boolean> => {
    if (operationInFlight.current) return false;

    dispatch({ type: 'operationStarted' });
    setActivity(nextActivity);
    const request = operation();
    operationInFlight.current = request;

    try {
      const result = await request;
      if (!mounted.current) return false;
      onSuccess(result);
      return true;
    } catch (error) {
      if (mounted.current) {
        dispatch({ type: 'operationFailed', message: publicErrorMessage(error) });
      }
      return false;
    } finally {
      operationInFlight.current = null;
      if (mounted.current) setActivity(null);
    }
  }, []);

  const runPlanningOperation = useCallback(async <T,>(
    nextActivity: Exclude<PlanningActivity, null>,
    operation: () => Promise<T>,
    onSuccess: (result: T) => void,
  ): Promise<PlanningActionResult<T>> => {
    if (operationInFlight.current) return { status: 'not-started' };

    dispatch({ type: 'operationStarted' });
    setPlanningActivity(nextActivity);
    const request = operation();
    operationInFlight.current = request;

    try {
      const result = await request;
      if (mounted.current) onSuccess(result);
      return { status: 'completed', value: result };
    } catch (error) {
      if (mounted.current) {
        dispatch({ type: 'operationFailed', message: publicErrorMessage(error) });
      }
      throw error;
    } finally {
      operationInFlight.current = null;
      if (mounted.current) setPlanningActivity(null);
    }
  }, []);

  const saveApiKey = useCallback((apiKey: string) => runSetupOperation(
    'saving-key',
    () => window.assistant.saveDeepSeekApiKey(apiKey),
    () => {
      const setup = setupRef.current;
      if (setup) applySetupUpdate({ ...setup, hasDeepSeekApiKey: true });
    },
  ), [applySetupUpdate, runSetupOperation]);

  const connectGoogle = useCallback(async () => {
    await runSetupOperation(
      'connecting-google',
      () => window.assistant.connectGoogle(),
      applySetupUpdate,
    );
  }, [applySetupUpdate, runSetupOperation]);

  const sendMessage = useCallback((text: string) => runPlanningOperation(
    'interpreting',
    () => window.assistant.sendMessage(text),
    (conversation) => dispatch({ type: 'conversationUpdated', conversation }),
  ), [runPlanningOperation]);

  const updateTask = useCallback(async (
    task: ProposedTask,
  ): Promise<PlanningActionResult<ProposedTask>> => {
    const result = await runPlanningOperation<ConversationSnapshot>(
      'updating-task',
      () => window.assistant.updateTask(task),
      (updated) => dispatch({ type: 'conversationUpdated', conversation: updated }),
    );
    if (result.status === 'not-started') return result;
    return {
      status: 'completed',
      value: result.value.tasks.find((item) => item.id === task.id) ?? task,
    };
  }, [runPlanningOperation]);

  const generateSchedule = useCallback(async () => {
    try {
      await runPlanningOperation(
        'generating-schedule',
        () => window.assistant.generateSchedule(selectedDate),
        (schedule) => dispatch({ type: 'scheduleGenerated', schedule }),
      );
    } catch {
      // The reducer retains planning state and exposes only the structured public error.
    }
  }, [runPlanningOperation, selectedDate]);

  const updateSchedule = useCallback(async (blocks: ScheduleBlock[]): Promise<boolean> => {
    try {
      const result = await runPlanningOperation<ScheduleSnapshot>(
        'updating-schedule',
        () => window.assistant.updateSchedule(blocks),
        (schedule) => dispatch({ type: 'scheduleUpdated', schedule }),
      );
      return result.status === 'completed';
    } catch {
      // The current state is the last main-process-accepted snapshot.
      return false;
    }
  }, [runPlanningOperation]);

  const handleApprovalResult = useCallback((result: ApprovalResult, retry: boolean) => {
    if (result.status === 'conflict-detected') {
      dispatch({ type: 'approvalConflict', retry, schedule: result.schedule });
      return;
    }
    dispatch({
      type: retry ? 'approvalRetried' : 'approvalCompleted',
      approval: result,
    });
  }, []);

  const approveSchedule = useCallback(async (blockIds: string[], retry = false) => {
    try {
      await runPlanningOperation(
        'approving-schedule',
        () => window.assistant.approveSchedule(blockIds),
        (result) => handleApprovalResult(result, retry),
      );
    } catch {
      // Keep the accepted schedule/result visible and show only the public bridge error.
    }
  }, [handleApprovalResult, runPlanningOperation]);

  const resetSession = useCallback(async () => {
    try {
      await runPlanningOperation(
        'resetting-session',
        () => window.assistant.resetSession(),
        () => {
          setSelectedDate(currentLondonDate());
          setComposerResetToken((current) => current + 1);
          dispatch({ type: 'sessionReset' });
        },
      );
    } catch {
      // The current in-memory session remains visible if reset fails.
    }
  }, [runPlanningOperation]);

  if (state.view === 'loading') {
    return (
      <main className="app-shell">
        <section className="loading-panel" aria-labelledby="loading-title">
          <div className="brand-mark" aria-hidden="true">PA</div>
          <h1 id="loading-title">Preparing your assistant</h1>
          <div aria-live="polite" role="status">
            {state.error ?? 'Checking setup…'}
          </div>
        </section>
      </main>
    );
  }

  if (state.view === 'setup' && state.setup) {
    return (
      <SetupScreen
        activity={activity}
        busy={state.busy}
        error={state.error}
        onConnectGoogle={connectGoogle}
        onSaveApiKey={saveApiKey}
        setup={state.setup}
      />
    );
  }

  if (state.view === 'schedule' && state.schedule) {
    const messages = state.conversation?.messages ?? [];
    const tasks = state.conversation?.tasks ?? [];
    const selectedIds = state.schedule.blocks
      .filter((block) => block.selected)
      .map((block) => block.id);
    return (
      <main className="app-shell planning-shell">
        <div className="planning-workspace schedule-workspace">
          <header className="planning-header">
            <div>
              <p className="eyebrow">{state.schedule.targetDate}</p>
              <h1 id="schedule-title">Review your schedule</h1>
              <p className="lede">Review every selected block before anything is added to Google Calendar.</p>
            </div>
            <button
              className="button button-secondary"
              disabled={state.busy}
              onClick={() => void resetSession()}
              type="button"
            >
              Start new day
            </button>
          </header>

          {state.conflictAnnouncement && (
            <div className="status-message is-error conflict-message" role="alert">
              {state.conflictAnnouncement}
            </div>
          )}

          <div className="planning-columns schedule-columns">
            <ChatPanel
              disabled={state.busy}
              interpreting={planningActivity === 'interpreting'}
              messages={messages}
              onSend={sendMessage}
              resetToken={composerResetToken}
            />
            <div className="review-column">
              <ScheduleTimeline
                blocks={state.schedule.blocks}
                busy={state.busy}
                busyPeriods={state.schedule.busyPeriods}
                onChange={updateSchedule}
                targetDate={state.schedule.targetDate}
              />
              <UnscheduledTasks tasks={tasks} unscheduledTasks={state.schedule.unscheduledTasks} />
              {state.schedule.warnings.map((warning) => (
                <p className="schedule-warning" key={warning}>⚠ {warning}</p>
              ))}
              <ApprovalBar
                busy={state.busy}
                onApprove={(blockIds) => void approveSchedule(blockIds, Boolean(state.approval))}
                selectedIds={selectedIds}
              />
            </div>
          </div>

          {state.error && <div className="status-message is-error" role="alert">{state.error}</div>}
          {planningActivity && planningActivity !== 'interpreting' && (
            <div aria-live="polite" className="status-message" role="status">
              {planningActivity === 'approving-schedule'
                ? 'Checking conflicts and creating selected events…'
                : planningActivity === 'updating-schedule'
                  ? 'Validating schedule change…'
                  : 'Working…'}
            </div>
          )}
        </div>
      </main>
    );
  }

  if (
    state.view === 'result'
    && state.schedule
    && state.approval?.status === 'completed'
  ) {
    return (
      <main className="app-shell planning-shell">
        <div className="result-workspace">
          <ApprovalResultView
            blocks={state.approvalBlocks ?? state.schedule.blocks}
            busy={state.busy}
            onRetryFailed={(blockIds) => void approveSchedule(blockIds, true)}
            results={state.approval.results}
          />
          {state.error && <div className="status-message is-error" role="alert">{state.error}</div>}
          {planningActivity === 'approving-schedule' && (
            <div aria-live="polite" className="status-message" role="status">
              Retrying failed events…
            </div>
          )}
        </div>
      </main>
    );
  }

  const messages = state.conversation?.messages ?? [];
  const tasks = state.conversation?.tasks ?? [];
  const planningStatus = planningActivity === 'updating-task'
    ? 'Saving task changes…'
    : planningActivity === 'generating-schedule'
      ? 'Checking calendar availability…'
      : planningActivity === 'resetting-session'
        ? 'Starting a new day…'
        : '';

  return (
    <main className="app-shell planning-shell">
      <div className="planning-workspace">
        <header className="planning-header">
          <div>
            <p className="eyebrow">Personal Assistant</p>
            <h1 id="planning-title" ref={planningHeading} tabIndex={-1}>Plan your day</h1>
          </div>
          <div className="planning-actions">
            <label htmlFor="schedule-date">Schedule date</label>
            <input
              disabled={state.busy}
              id="schedule-date"
              onChange={(event) => setSelectedDate(event.target.value)}
              type="date"
              value={selectedDate}
            />
            <button
              className="button button-secondary"
              disabled={state.busy}
              onClick={() => void resetSession()}
              type="button"
            >
              Start new day
            </button>
          </div>
        </header>

        <div className="planning-columns">
          <ChatPanel
            disabled={state.busy}
            interpreting={planningActivity === 'interpreting'}
            messages={messages}
            onSend={sendMessage}
            resetToken={composerResetToken}
          />
          <div className="review-column">
            <TaskReview busy={state.busy} onUpdateTask={updateTask} tasks={tasks} />
            <button
              className="button button-primary build-schedule"
              disabled={state.busy || tasks.length === 0 || selectedDate.length === 0}
              onClick={() => void generateSchedule()}
              type="button"
            >
              Build schedule
            </button>
          </div>
        </div>

        {state.error && <div className="status-message is-error" role="alert">{state.error}</div>}
        {planningStatus && planningActivity !== 'interpreting' && (
          <div aria-live="polite" className="status-message" role="status">{planningStatus}</div>
        )}
      </div>
    </main>
  );
}
