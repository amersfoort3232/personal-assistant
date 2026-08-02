// @vitest-environment jsdom

import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';
import type { AssistantBridge } from '../../src/renderer/bridge';
import type {
  ConversationSnapshot,
  ProposedTask,
  ScheduleSnapshot,
  SetupStatus,
} from '../../src/shared/domain';

const completeSetup: SetupStatus = {
  hasDeepSeekApiKey: true,
  googleConnected: true,
  calendarReady: true,
};

const estimatedTask: ProposedTask = {
  id: 'task-study',
  title: 'Study TypeScript',
  notes: 'Focus on narrowing',
  durationMinutes: 60,
  durationWasEstimated: true,
  priority: 'high',
  deadline: '2026-08-02T13:30:00+01:00',
  canSplit: true,
  minimumSessionMinutes: 30,
};

const conversation: ConversationSnapshot = {
  messages: [
    {
      id: 'message-user',
      role: 'user',
      text: 'Plan some study time',
      createdAt: '2026-08-02T09:00:00+01:00',
    },
    {
      id: 'message-assistant',
      role: 'assistant',
      text: 'I found one task.',
      createdAt: '2026-08-02T09:00:01+01:00',
    },
  ],
  tasks: [estimatedTask],
};

const schedule: ScheduleSnapshot = {
  targetDate: '2026-08-02',
  busyPeriods: [],
  blocks: [],
  unscheduledTasks: [],
  warnings: [],
};

function createBridge(overrides: Partial<AssistantBridge> = {}): AssistantBridge {
  return {
    getSetupStatus: vi.fn().mockResolvedValue(completeSetup),
    saveDeepSeekApiKey: vi.fn(),
    connectGoogle: vi.fn(),
    disconnectGoogle: vi.fn(),
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue(conversation),
    updateTask: vi.fn().mockImplementation(async (task: ProposedTask) => ({
      messages: conversation.messages,
      tasks: [task],
    })),
    generateSchedule: vi.fn().mockResolvedValue(schedule),
    updateSchedule: vi.fn(),
    approveSchedule: vi.fn(),
    resetSession: vi.fn().mockResolvedValue(undefined),
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

async function renderPlanning(bridge = createBridge()) {
  window.assistant = bridge;
  const result = render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await screen.findByRole('heading', { name: /plan your day/i });
  return { bridge, ...result };
}

async function loadConversation(bridge = createBridge()) {
  const rendered = await renderPlanning(bridge);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/daily goals and tasks/i), 'Plan some study time');
  await user.keyboard('{Enter}');
  await screen.findByText('I found one task.');
  return { user, ...rendered };
}

describe('planning view', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('submits a non-empty message with Enter while Shift+Enter inserts a newline', async () => {
    const user = userEvent.setup();
    const bridge = createBridge();
    await renderPlanning(bridge);
    const composer = screen.getByLabelText(/daily goals and tasks/i);

    await user.type(composer, 'First task');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    await user.type(composer, 'Second task');

    expect(composer).toHaveValue('First task\nSecond task');
    expect(bridge.sendMessage).not.toHaveBeenCalled();

    await user.keyboard('{Enter}');
    expect(bridge.sendMessage).toHaveBeenCalledWith('First task\nSecond task');
    await waitFor(() => expect(composer).toHaveValue(''));
  });

  it('disables send while interpretation is active and prevents double submission', async () => {
    const user = userEvent.setup();
    const pending = deferred<ConversationSnapshot>();
    const sendMessage = vi.fn().mockReturnValue(pending.promise);
    await renderPlanning(createBridge({ sendMessage }));
    const composer = screen.getByLabelText(/daily goals and tasks/i);

    await user.type(composer, 'Plan my day');
    await user.keyboard('{Enter}{Enter}');

    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/deepseek is working/i);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    pending.resolve(conversation);
    await waitFor(() => expect(screen.getByRole('status')).toBeEmptyDOMElement());
  });

  it('keeps send disabled while another planning operation is active', async () => {
    const pending = deferred<ConversationSnapshot>();
    const updateTask = vi.fn().mockReturnValue(pending.promise);
    const { user } = await loadConversation(createBridge({ updateTask }));
    const composer = screen.getByLabelText(/daily goals and tasks/i);
    await user.type(composer, 'Do not discard this follow-up');
    expect(screen.getByRole('button', { name: /send/i })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: /save study typescript/i }));

    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
    expect(composer).toHaveValue('Do not discard this follow-up');

    pending.resolve(conversation);
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeEnabled());
  });

  it('gives assistant and user messages accessible role labels', async () => {
    await loadConversation();

    expect(screen.getByRole('listitem', { name: /user message/i })).toHaveTextContent(
      'Plan some study time',
    );
    expect(screen.getByRole('listitem', { name: /assistant message/i })).toHaveTextContent(
      'I found one task.',
    );
  });

  it('shows Estimated only for a task whose duration was estimated', async () => {
    await loadConversation();

    expect(screen.getByText('Estimated')).toBeInTheDocument();
  });

  it('sends a numeric duration and clears its estimated flag after a manual edit', async () => {
    const { user, bridge } = await loadConversation();
    const duration = screen.getByRole('spinbutton', { name: /duration.*minutes/i });

    await user.clear(duration);
    await user.type(duration, '45');
    await user.click(screen.getByRole('button', { name: /save study typescript/i }));

    expect(bridge.updateTask).toHaveBeenCalledWith({
      ...estimatedTask,
      durationMinutes: 45,
      durationWasEstimated: false,
    });
    await waitFor(() => expect(screen.queryByText('Estimated')).not.toBeInTheDocument());
  });

  it('keeps the minimum session at or below the duration in the task form', async () => {
    const { user, bridge } = await loadConversation();
    const duration = screen.getByRole('spinbutton', { name: /duration.*minutes/i });
    const minimum = screen.getByRole('spinbutton', { name: /minimum session.*minutes/i });

    expect(minimum).toHaveAttribute('max', '60');
    await user.clear(duration);
    await user.type(duration, '20');

    expect(minimum).toHaveAttribute('max', '20');
    expect(screen.getByText(/minimum session cannot exceed duration/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save study typescript/i })).toBeDisabled();
    expect(bridge.updateTask).not.toHaveBeenCalled();
  });

  it('uses controlled task fields and converts London local deadlines to explicit offsets', async () => {
    const { user, bridge } = await loadConversation();

    const title = screen.getByRole('textbox', { name: /^title$/i });
    await user.clear(title);
    await user.type(title, 'Read TypeScript handbook');
    await user.selectOptions(screen.getByRole('combobox', { name: /priority/i }), 'urgent');
    fireEvent.change(screen.getByLabelText(/^deadline$/i), {
      target: { value: '2026-08-02T16:30' },
    });
    await user.click(screen.getByRole('checkbox', { name: /allow splitting/i }));
    const minimum = screen.getByRole('spinbutton', { name: /minimum session.*minutes/i });
    await user.clear(minimum);
    await user.type(minimum, '20');
    await user.click(screen.getByRole('button', { name: /save study typescript/i }));

    expect(bridge.updateTask).toHaveBeenCalledWith({
      ...estimatedTask,
      title: 'Read TypeScript handbook',
      priority: 'urgent',
      deadline: '2026-08-02T16:30:00.000+01:00',
      canSplit: false,
      minimumSessionMinutes: 20,
    });
  });

  it('disables Build schedule when there are no tasks', async () => {
    await renderPlanning();

    expect(screen.getByRole('button', { name: /build schedule/i })).toBeDisabled();
  });

  it('defaults the selected date to the current Europe/London date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T23:30:00.000Z'));
    window.assistant = createBridge();
    render(<App />);
    await act(async () => Promise.resolve());

    expect(screen.getByLabelText(/schedule date/i)).toHaveValue('2026-08-02');
  });

  it('opens schedule review only after successful generation with the selected date', async () => {
    const { user, bridge } = await loadConversation();
    fireEvent.change(screen.getByLabelText(/schedule date/i), {
      target: { value: '2026-08-03' },
    });

    await user.click(screen.getByRole('button', { name: /build schedule/i }));

    expect(bridge.generateSchedule).toHaveBeenCalledWith('2026-08-03');
    expect(await screen.findByRole('heading', { name: /review your schedule/i })).toBeInTheDocument();
  });

  it('stays in planning and shows only a structured public error when generation fails', async () => {
    const user = userEvent.setup();
    const generateSchedule = vi.fn().mockRejectedValue({
      code: 'CALENDAR_UNAVAILABLE',
      message: 'Calendar availability could not be loaded. Please try again.',
      retryable: true,
      privateValue: 'private calendar response',
      stack: 'private stack',
    });
    await loadConversation(createBridge({ generateSchedule }));

    await user.click(screen.getByRole('button', { name: /build schedule/i }));

    expect(screen.getByRole('heading', { name: /plan your day/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /review your schedule/i })).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Calendar availability could not be loaded. Please try again.',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent(/private calendar|private stack/i);
  });

  it('preserves typed text and exposes only the public message when sending fails', async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn().mockRejectedValue({
      code: 'DEEPSEEK_UNAVAILABLE',
      message: 'DeepSeek is temporarily unavailable. Please retry.',
      retryable: true,
      privateValue: 'the private task text',
      stack: 'private provider stack',
    });
    await renderPlanning(createBridge({ sendMessage }));
    const composer = screen.getByLabelText(/daily goals and tasks/i);

    await user.type(composer, 'Keep this text private');
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'DeepSeek is temporarily unavailable. Please retry.',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent(/private task|provider stack/i);
    expect(composer).toHaveValue('Keep this text private');
  });

  it('resets the session and clears all visible messages and tasks', async () => {
    const { user, bridge } = await loadConversation();
    expect(screen.getByText('I found one task.')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /study typescript/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /start new day/i }));

    expect(bridge.resetSession).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByText('I found one task.')).not.toBeInTheDocument();
      expect(screen.queryByRole('group', { name: /study typescript/i })).not.toBeInTheDocument();
    });
  });
});
