import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import type { ProposedTask } from '../shared/domain';
import type { SerializableAppError } from '../shared/ipc';
import { appReducer, initialRendererState, isSetupComplete } from './appReducer';
import { ChatPanel } from './components/ChatPanel';
import { SetupScreen } from './components/SetupScreen';
import { TaskReview } from './components/TaskReview';

type SetupActivity = 'saving-key' | 'connecting-google' | null;
type PlanningActivity =
  | 'interpreting'
  | 'updating-task'
  | 'generating-schedule'
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
  ): Promise<void> => {
    if (operationInFlight.current) return;

    dispatch({ type: 'operationStarted' });
    setPlanningActivity(nextActivity);
    const request = operation();
    operationInFlight.current = request;

    try {
      const result = await request;
      if (mounted.current) onSuccess(result);
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

  const updateTask = useCallback((task: ProposedTask) => runPlanningOperation(
    'updating-task',
    () => window.assistant.updateTask(task),
    (conversation) => dispatch({ type: 'conversationUpdated', conversation }),
  ), [runPlanningOperation]);

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

  const resetSession = useCallback(async () => {
    try {
      await runPlanningOperation(
        'resetting-session',
        () => window.assistant.resetSession(),
        () => {
          setSelectedDate(currentLondonDate());
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
    return (
      <main className="app-shell planning-shell">
        <section className="schedule-placeholder" aria-labelledby="schedule-title">
          <p className="eyebrow">{state.schedule.targetDate}</p>
          <h1 id="schedule-title">Review your schedule</h1>
          <p className="lede">Your draft is ready to review before anything is added to Google Calendar.</p>
        </section>
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
            busy={state.busy}
            messages={messages}
            onSend={sendMessage}
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
