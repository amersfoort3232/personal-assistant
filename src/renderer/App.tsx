import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { SerializableAppError } from '../shared/ipc';
import { appReducer, initialRendererState, isSetupComplete } from './appReducer';
import { SetupScreen } from './components/SetupScreen';

type SetupActivity = 'saving-key' | 'connecting-google' | null;

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

  return (
    <main className="app-shell">
      <section className="planning-placeholder" aria-labelledby="planning-title">
        <div className="brand-mark" aria-hidden="true">PA</div>
        <p className="eyebrow">Setup complete</p>
        <h1 id="planning-title" ref={planningHeading} tabIndex={-1}>Plan your day</h1>
        <p className="lede">Your assistant is connected and ready for your tasks.</p>
      </section>
    </main>
  );
}
