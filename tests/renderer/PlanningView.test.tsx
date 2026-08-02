// @vitest-environment jsdom

import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const siblingTask: ProposedTask = {
  ...estimatedTask,
  id: 'task-email',
  title: 'Write status email',
  notes: 'Summarise the week',
  durationMinutes: 30,
  durationWasEstimated: false,
  priority: 'medium',
  canSplit: false,
  minimumSessionMinutes: 15,
};

const cleanTask: ProposedTask = {
  ...siblingTask,
  id: 'task-clean',
  title: 'Clean editor task',
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
  await waitFor(() => expect(screen.getByLabelText(/daily goals and tasks/i)).toHaveValue(''));
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
    expect(screen.queryByText(/deepseek is working/i)).not.toBeInTheDocument();

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
    expect(minimum).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: /save study typescript/i })).toBeDisabled();
    expect(bridge.updateTask).not.toHaveBeenCalled();
  });

  it('caps the minimum-session input at 120 minutes for longer tasks', async () => {
    const longTask = {
      ...estimatedTask,
      durationMinutes: 300,
      minimumSessionMinutes: 100,
    };
    await loadConversation(createBridge({
      sendMessage: vi.fn().mockResolvedValue({
        messages: conversation.messages,
        tasks: [longTask],
      }),
    }));

    expect(screen.getByRole('spinbutton', { name: /minimum session.*minutes/i }))
      .toHaveAttribute('max', '120');
  });

  it('shows accessible feedback for every invalid duration state', async () => {
    const { user } = await loadConversation();
    const duration = screen.getByRole('spinbutton', { name: /duration.*minutes/i });

    for (const [value, message] of [
      ['', /duration is required/i],
      ['4', /duration must be between 5 and 480 minutes/i],
      ['481', /duration must be between 5 and 480 minutes/i],
      ['15.5', /duration must be a whole number/i],
    ] as const) {
      fireEvent.change(duration, { target: { value } });
      expect(duration).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByText(message)).toBeInTheDocument();
    }

    await user.clear(duration);
    await user.type(duration, '45');
    expect(duration).toHaveAttribute('aria-invalid', 'false');
  });

  it('shows accessible feedback for every invalid minimum-session state', async () => {
    await loadConversation();
    const minimum = screen.getByRole('spinbutton', { name: /minimum session.*minutes/i });

    for (const [value, message] of [
      ['', /minimum session is required/i],
      ['14', /minimum session must be between 15 and 120 minutes/i],
      ['121', /minimum session must be between 15 and 120 minutes/i],
      ['15.5', /minimum session must be a whole number/i],
    ] as const) {
      fireEvent.change(minimum, { target: { value } });
      expect(minimum).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByText(message)).toBeInTheDocument();
    }
  });

  it('uses controlled task fields without a deadline', async () => {
    const { user, bridge } = await loadConversation();

    expect(screen.queryByLabelText(/^deadline$/i)).not.toBeInTheDocument();

    const title = screen.getByRole('textbox', { name: /^title$/i });
    await user.clear(title);
    await user.type(title, 'Read TypeScript handbook');
    await user.selectOptions(screen.getByRole('combobox', { name: /priority/i }), 'urgent');
    await user.click(screen.getByRole('checkbox', { name: /allow splitting/i }));
    const minimum = screen.getByRole('spinbutton', { name: /minimum session.*minutes/i });
    await user.clear(minimum);
    await user.type(minimum, '20');
    await user.click(screen.getByRole('button', { name: /save study typescript/i }));

    expect(bridge.updateTask).toHaveBeenCalledWith({
      ...estimatedTask,
      title: 'Read TypeScript handbook',
      priority: 'urgent',
      canSplit: false,
      minimumSessionMinutes: 20,
    });
  });

  it('saves an optional fixed task start time', async () => {
    const { user, bridge } = await loadConversation();

    await user.type(screen.getByLabelText(/^fixed start$/i), '11:00');
    await user.click(screen.getByRole('button', { name: /save study typescript/i }));

    expect(bridge.updateTask).toHaveBeenCalledWith({
      ...estimatedTask,
      fixedStartTime: '11:00',
    });
  });

  it('keeps dirty sibling edits while saved and clean editors accept the server snapshot', async () => {
    const initial = {
      messages: conversation.messages,
      tasks: [estimatedTask, siblingTask, cleanTask],
    };
    const acceptedStudy = { ...estimatedTask, title: 'Server accepted study task', durationMinutes: 45 };
    const acceptedSibling = { ...siblingTask, title: 'Server sibling value' };
    const acceptedClean = { ...cleanTask, title: 'Server refreshed clean task' };
    const updateTask = vi.fn().mockResolvedValue({
      messages: conversation.messages,
      tasks: [acceptedStudy, acceptedSibling, acceptedClean],
    });
    const { user } = await loadConversation(createBridge({
      sendMessage: vi.fn().mockResolvedValue(initial),
      updateTask,
    }));

    const siblingEditor = screen.getByRole('group', { name: /write status email/i });
    const siblingTitle = within(siblingEditor).getByRole('textbox', { name: /^title$/i });
    await user.clear(siblingTitle);
    await user.type(siblingTitle, 'My unsaved sibling edit');

    const studyEditor = screen.getByRole('group', { name: /study typescript/i });
    const studyDuration = within(studyEditor).getByRole('spinbutton', { name: /duration/i });
    await user.clear(studyDuration);
    await user.type(studyDuration, '45');
    await user.click(within(studyEditor).getByRole('button', { name: /save/i }));

    await waitFor(() => expect(within(
      screen.getByRole('group', { name: /server accepted study task/i }),
    ).getByRole('textbox', { name: /^title$/i })).toHaveValue('Server accepted study task'));
    expect(siblingTitle).toHaveValue('My unsaved sibling edit');
    expect(within(screen.getByRole('group', { name: /server refreshed clean task/i }))
      .getByRole('textbox', { name: /^title$/i })).toHaveValue('Server refreshed clean task');
  });

  it('retains the composer draft when a same-tick task save starts first', async () => {
    const pendingUpdate = deferred<ConversationSnapshot>();
    const updateTask = vi.fn().mockReturnValue(pendingUpdate.promise);
    const bridge = createBridge({ updateTask });
    const { user } = await loadConversation(bridge);
    const sendMessage = vi.mocked(bridge.sendMessage);
    sendMessage.mockClear();
    const composer = screen.getByLabelText(/daily goals and tasks/i);
    await user.type(composer, 'Keep this competing draft');
    const taskForm = screen.getByRole('group', { name: /study typescript/i }).closest('form');
    const composerForm = composer.closest('form');

    expect(taskForm).not.toBeNull();
    expect(composerForm).not.toBeNull();
    act(() => {
      taskForm?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      composerForm?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(composer).toHaveValue('Keep this competing draft');
    expect(updateTask).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    pendingUpdate.resolve(conversation);
  });

  it('retains a dirty task form when a same-tick send starts first', async () => {
    const initial = {
      messages: conversation.messages,
      tasks: [estimatedTask],
    };
    const competingSnapshot = {
      messages: conversation.messages,
      tasks: [{ ...estimatedTask, title: 'Server replacement title' }],
    };
    const bridge = createBridge({
      sendMessage: vi.fn().mockResolvedValue(initial),
    });
    const { user } = await loadConversation(bridge);
    const sendMessage = vi.mocked(bridge.sendMessage);
    const pendingSend = deferred<ConversationSnapshot>();
    sendMessage.mockClear();
    sendMessage.mockReturnValueOnce(pendingSend.promise);
    const updateTask = vi.mocked(bridge.updateTask);
    const title = screen.getByRole('textbox', { name: /^title$/i });
    await user.clear(title);
    await user.type(title, 'Keep my dirty task title');
    const composer = screen.getByLabelText(/daily goals and tasks/i);
    await user.type(composer, 'Start the competing send');
    const composerForm = composer.closest('form');
    const taskForm = screen.getByRole('group', { name: /study typescript/i }).closest('form');

    expect(composerForm).not.toBeNull();
    expect(taskForm).not.toBeNull();
    act(() => {
      composerForm?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      taskForm?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      pendingSend.resolve(competingSnapshot);
      await pendingSend.promise;
    });

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(updateTask).not.toHaveBeenCalled();
    expect(title).toHaveValue('Keep my dirty task title');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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

  it('clears an unsent composer draft only after a successful new-day reset', async () => {
    const user = userEvent.setup();
    await renderPlanning();
    const composer = screen.getByLabelText(/daily goals and tasks/i);
    await user.type(composer, 'Unsent draft');

    await user.click(screen.getByRole('button', { name: /start new day/i }));

    await waitFor(() => expect(composer).toHaveValue(''));
  });

  it('retains an unsent composer draft when the new-day reset fails', async () => {
    const resetSession = vi.fn().mockRejectedValue({
      code: 'INTERNAL_ERROR',
      message: 'Could not start a new day.',
      retryable: true,
    });
    const user = userEvent.setup();
    await renderPlanning(createBridge({ resetSession }));
    const composer = screen.getByLabelText(/daily goals and tasks/i);
    await user.type(composer, 'Keep this unsent draft');

    await user.click(screen.getByRole('button', { name: /start new day/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not start a new day.');
    expect(composer).toHaveValue('Keep this unsent draft');
  });
});
