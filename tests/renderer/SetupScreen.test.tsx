// @vitest-environment jsdom

import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';
import type { AssistantBridge } from '../../src/renderer/bridge';
import type { SetupStatus } from '../../src/shared/domain';

const incompleteSetup: SetupStatus = {
  hasDeepSeekApiKey: false,
  googleConnected: false,
  calendarReady: false,
};

function createBridge(overrides: Partial<AssistantBridge> = {}): AssistantBridge {
  return {
    getSetupStatus: vi.fn().mockResolvedValue(incompleteSetup),
    saveDeepSeekApiKey: vi.fn().mockResolvedValue(undefined),
    connectGoogle: vi.fn().mockResolvedValue({
      hasDeepSeekApiKey: true,
      googleConnected: true,
      calendarReady: true,
    }),
    disconnectGoogle: vi.fn(),
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    sendMessage: vi.fn(),
    updateTask: vi.fn(),
    generateSchedule: vi.fn(),
    updateSchedule: vi.fn(),
    approveSchedule: vi.fn(),
    resetSession: vi.fn(),
    ...overrides,
  } as AssistantBridge;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function renderApp(bridge = createBridge()) {
  window.assistant = bridge;
  const result = render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await screen.findByRole('heading', { name: /finish setup/i });
  return { bridge, ...result };
}

describe('first-run setup', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a labelled password field and enables save after keyboard input when the API key is missing', async () => {
    const user = userEvent.setup();
    await renderApp();

    const input = screen.getByLabelText(/deepseek api key/i);
    const saveButton = screen.getByRole('button', { name: /save api key/i });
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveFocus();
    expect(saveButton).toBeDisabled();

    await user.type(input, 'sk-valid-key-with-enough-characters');
    expect(saveButton).toBeEnabled();
  });

  it('shows a Google Calendar connection action when Google is missing', async () => {
    await renderApp(createBridge({
      getSetupStatus: vi.fn().mockResolvedValue({
        hasDeepSeekApiKey: true,
        googleConnected: false,
        calendarReady: false,
      }),
    }));

    expect(screen.getByRole('button', { name: /connect google calendar/i })).toHaveFocus();
  });

  it('clears the local API key after a successful save and never renders it in setup state', async () => {
    const user = userEvent.setup();
    const bridge = createBridge();
    await renderApp(bridge);
    const apiKey = 'sk-private-value-that-must-disappear';

    await user.type(screen.getByLabelText(/deepseek api key/i), apiKey);
    await user.click(screen.getByRole('button', { name: /save api key/i }));

    await waitFor(() => {
      expect(screen.queryByDisplayValue(apiKey)).not.toBeInTheDocument();
    });
    expect(document.body).not.toHaveTextContent(apiKey);
    expect(screen.queryByLabelText(/deepseek api key/i)).not.toBeInTheDocument();
    expect(screen.getByText(/api key saved/i)).toBeInTheDocument();
  });

  it('moves to planning after both setup steps complete', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.type(screen.getByLabelText(/deepseek api key/i), 'sk-valid-key-with-enough-characters');
    await user.keyboard('{Tab}{Enter}');
    const connectButton = await screen.findByRole('button', { name: /connect google calendar/i });
    expect(connectButton).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('heading', { name: /plan your day/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /finish setup/i })).not.toBeInTheDocument();
  });

  it('moves focus to the planning heading when the final setup action completes', async () => {
    const user = userEvent.setup();
    await renderApp(createBridge({
      getSetupStatus: vi.fn().mockResolvedValue({
        hasDeepSeekApiKey: true,
        googleConnected: false,
        calendarReady: false,
      }),
    }));

    await user.click(screen.getByRole('button', { name: /connect google calendar/i }));

    const heading = await screen.findByRole('heading', { name: /plan your day/i });
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(heading).toHaveFocus();
  });

  it('does not move focus when the app initially loads completed setup', async () => {
    window.assistant = createBridge({
      getSetupStatus: vi.fn().mockResolvedValue({
        hasDeepSeekApiKey: true,
        googleConnected: true,
        calendarReady: true,
      }),
    });
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    const heading = await screen.findByRole('heading', { name: /plan your day/i });
    expect(heading).not.toHaveFocus();
  });

  it('announces only the public message from a structured bridge error', async () => {
    const user = userEvent.setup();
    const bridge = createBridge({
      saveDeepSeekApiKey: vi.fn().mockRejectedValue({
        code: 'CREDENTIAL_STORAGE_UNAVAILABLE',
        message: 'Windows could not store that key securely. Please try again.',
        retryable: true,
        stack: 'private stack details',
        privateValue: 'sk-leaked-value',
      }),
    });
    await renderApp(bridge);

    await user.type(screen.getByLabelText(/deepseek api key/i), 'sk-valid-key-with-enough-characters');
    await user.click(screen.getByRole('button', { name: /save api key/i }));

    const announcement = await screen.findByRole('status');
    expect(announcement).toHaveAttribute('aria-live', 'polite');
    expect(announcement).toHaveTextContent('Windows could not store that key securely. Please try again.');
    expect(announcement).not.toHaveTextContent(/private stack|sk-leaked|credential_storage/i);
  });

  it('disables setup actions and prevents a second save while one is pending', async () => {
    const user = userEvent.setup();
    const save = deferred<void>();
    const saveDeepSeekApiKey = vi.fn().mockReturnValue(save.promise);
    await renderApp(createBridge({ saveDeepSeekApiKey }));
    const input = screen.getByLabelText(/deepseek api key/i);

    await user.type(input, 'sk-valid-key-with-enough-characters');
    const saveButton = screen.getByRole('button', { name: /save api key/i });
    await user.click(saveButton);

    expect(saveButton).toBeDisabled();
    expect(screen.getByRole('button', { name: /connect google calendar/i })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/saving api key/i);
    await user.click(saveButton);
    expect(saveDeepSeekApiKey).toHaveBeenCalledTimes(1);

    save.resolve(undefined);
    await waitFor(() => expect(screen.getByText(/api key saved/i)).toBeInTheDocument());
  });

  it('loads setup once in StrictMode and ignores a late result after unmount', async () => {
    const status = deferred<SetupStatus>();
    const getSetupStatus = vi.fn().mockReturnValue(status.promise);
    const bridge = createBridge({ getSetupStatus });
    window.assistant = bridge;
    const view = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    expect(getSetupStatus).toHaveBeenCalledTimes(1);
    view.unmount();
    status.resolve(incompleteSetup);
    await Promise.resolve();
    expect(view.container).toBeEmptyDOMElement();
  });
});
