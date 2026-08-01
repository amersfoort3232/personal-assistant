import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SetupStatus } from '../../shared/domain';

type SetupActivity = 'saving-key' | 'connecting-google' | null;

type SetupScreenProps = {
  setup: SetupStatus;
  busy: boolean;
  activity: SetupActivity;
  error?: string;
  onSaveApiKey(apiKey: string): Promise<boolean>;
  onConnectGoogle(): Promise<void>;
};

const activityMessage: Record<Exclude<SetupActivity, null>, string> = {
  'saving-key': 'Saving API key securely…',
  'connecting-google': 'Connecting Google Calendar…',
};

export function SetupScreen({
  setup,
  busy,
  activity,
  error,
  onSaveApiKey,
  onConnectGoogle,
}: SetupScreenProps) {
  const [apiKey, setApiKey] = useState('');
  const mounted = useRef(false);
  const googleButton = useRef<HTMLButtonElement>(null);
  const googleReady = setup.googleConnected && setup.calendarReady;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (setup.hasDeepSeekApiKey && !googleReady) googleButton.current?.focus();
  }, [googleReady, setup.hasDeepSeekApiKey]);

  const handleApiKeySubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || apiKey.length === 0) return;

    const saved = await onSaveApiKey(apiKey);
    if (saved && mounted.current) setApiKey('');
  };

  const announcement = error ?? (activity ? activityMessage[activity] : '');

  return (
    <main className="app-shell">
      <section className="setup-panel" aria-labelledby="setup-title">
        <div className="brand-mark" aria-hidden="true">PA</div>
        <p className="eyebrow">Personal Assistant</p>
        <h1 id="setup-title">Finish setup</h1>
        <p className="lede">
          Connect the two services used to understand your tasks and plan time in your calendar.
        </p>

        <div className="progress-summary" aria-label="Setup progress">
          <span>{Number(setup.hasDeepSeekApiKey) + Number(googleReady)} of 2 complete</span>
          <span className="progress-track" aria-hidden="true">
            <span
              className="progress-value"
              style={{ width: `${(Number(setup.hasDeepSeekApiKey) + Number(googleReady)) * 50}%` }}
            />
          </span>
        </div>

        <ol className="setup-steps">
          <li className={setup.hasDeepSeekApiKey ? 'setup-step is-complete' : 'setup-step'}>
            <div className="step-number" aria-hidden="true">
              {setup.hasDeepSeekApiKey ? '✓' : '1'}
            </div>
            <div className="step-content">
              <div className="step-heading">
                <div>
                  <h2>DeepSeek</h2>
                  <p>Used to turn your requests into a clear task plan.</p>
                </div>
                {setup.hasDeepSeekApiKey && <span className="completion-label">API key saved</span>}
              </div>

              {!setup.hasDeepSeekApiKey && (
                <form onSubmit={handleApiKeySubmit} className="setup-form">
                  <label htmlFor="deepseek-api-key">DeepSeek API key</label>
                  <div className="field-row">
                    <input
                      autoComplete="off"
                      autoFocus
                      disabled={busy}
                      id="deepseek-api-key"
                      minLength={20}
                      name="deepseek-api-key"
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder="Enter your API key"
                      required
                      spellCheck={false}
                      type="password"
                      value={apiKey}
                    />
                    <button className="button button-primary" disabled={busy || apiKey.length === 0} type="submit">
                      Save API key
                    </button>
                  </div>
                  <p className="field-note">Stored securely on this device.</p>
                </form>
              )}
            </div>
          </li>

          <li className={googleReady ? 'setup-step is-complete' : 'setup-step'}>
            <div className="step-number" aria-hidden="true">{googleReady ? '✓' : '2'}</div>
            <div className="step-content">
              <div className="step-heading">
                <div>
                  <h2>Google Calendar</h2>
                  <p>Checks your availability and adds only the schedule you approve.</p>
                </div>
                {googleReady && <span className="completion-label">Calendar connected</span>}
              </div>

              {!googleReady && (
                <button
                  autoFocus={setup.hasDeepSeekApiKey}
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() => void onConnectGoogle()}
                  ref={googleButton}
                  type="button"
                >
                  Connect Google Calendar
                </button>
              )}
            </div>
          </li>
        </ol>

        <div
          aria-live="polite"
          aria-atomic="true"
          className={error ? 'status-message is-error' : 'status-message'}
          role="status"
        >
          {announcement}
        </div>
      </section>
    </main>
  );
}
