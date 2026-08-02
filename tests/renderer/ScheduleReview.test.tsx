// @vitest-environment jsdom

import { readFile } from 'node:fs/promises';
import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';
import type { AssistantBridge } from '../../src/renderer/bridge';
import type {
  ApprovalResult,
  ConversationSnapshot,
  ProposedTask,
  ScheduleBlock,
  ScheduleSnapshot,
  SetupStatus,
} from '../../src/shared/domain';

const completeSetup: SetupStatus = {
  hasDeepSeekApiKey: true,
  googleConnected: true,
  calendarReady: true,
};

const task: ProposedTask = {
  id: 'task-study',
  title: 'Study TypeScript',
  notes: 'Focus on narrowing',
  durationMinutes: 60,
  durationWasEstimated: false,
  priority: 'high',
  deadline: undefined,
  canSplit: false,
  minimumSessionMinutes: 30,
};

const conversation: ConversationSnapshot = {
  messages: [{
    id: 'assistant-message',
    role: 'assistant',
    text: 'I found one task.',
    createdAt: '2026-08-02T08:00:00+01:00',
  }],
  tasks: [task],
};

const taskBlock: ScheduleBlock = {
  id: 'block-task',
  kind: 'task',
  taskId: task.id,
  title: task.title,
  start: '2026-08-02T09:00:00+01:00',
  end: '2026-08-02T10:00:00+01:00',
  selected: true,
};

const breakBlock: ScheduleBlock = {
  id: 'block-break',
  kind: 'break',
  title: 'Recovery break',
  start: '2026-08-02T10:15:00+01:00',
  end: '2026-08-02T10:30:00+01:00',
  selected: true,
};

const schedule: ScheduleSnapshot = {
  targetDate: '2026-08-02',
  busyPeriods: [{
    start: '2026-08-02T12:00:00+01:00',
    end: '2026-08-02T13:00:00+01:00',
    sourceCalendarId: 'primary',
  }],
  blocks: [taskBlock, breakBlock],
  unscheduledTasks: [{
    taskId: task.id,
    remainingMinutes: 25,
    reason: 'minimum-session-does-not-fit',
  }],
  warnings: [],
};

function acceptedSchedule(blocks: ScheduleBlock[]): ScheduleSnapshot {
  return { ...schedule, blocks };
}

function createBridge(overrides: Partial<AssistantBridge> = {}): AssistantBridge {
  return {
    getSetupStatus: vi.fn().mockResolvedValue(completeSetup),
    saveDeepSeekApiKey: vi.fn(),
    connectGoogle: vi.fn(),
    disconnectGoogle: vi.fn(),
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue(conversation),
    updateTask: vi.fn(),
    generateSchedule: vi.fn().mockResolvedValue(schedule),
    updateSchedule: vi.fn().mockImplementation(async (blocks: ScheduleBlock[]) => (
      acceptedSchedule(blocks)
    )),
    approveSchedule: vi.fn().mockResolvedValue({ status: 'completed', results: [] }),
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

async function renderSchedule(bridge = createBridge()) {
  window.assistant = bridge;
  const user = userEvent.setup();
  render(<StrictMode><App /></StrictMode>);
  await screen.findByRole('heading', { name: /plan your day/i });
  await user.type(screen.getByLabelText(/daily goals and tasks/i), 'Plan study time');
  await user.keyboard('{Enter}');
  await screen.findByText('I found one task.');
  await user.click(screen.getByRole('button', { name: /build schedule/i }));
  await screen.findByRole('heading', { name: /review your schedule/i });
  return { bridge, user };
}

describe('schedule review', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders calendar busy periods as locked text-equivalent blocks without edit controls', async () => {
    await renderSchedule();

    const busy = screen.getByRole('group', { name: /busy period.*12:00.*13:00.*locked/i });
    expect(busy).toHaveTextContent(/busy.*locked/i);
    expect(within(busy).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(busy).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(busy).queryByRole('button')).not.toBeInTheDocument();
  });

  it('selects task and break blocks independently and approves only accepted selected IDs', async () => {
    const { bridge, user } = await renderSchedule();
    const breakSelection = screen.getByRole('checkbox', { name: /select recovery break/i });

    expect(screen.getByRole('checkbox', { name: /select study typescript/i })).toBeChecked();
    expect(breakSelection).toBeChecked();
    await user.click(breakSelection);
    await waitFor(() => expect(breakSelection).not.toBeChecked());
    await user.click(screen.getByRole('button', { name: /approve 1 selected block/i }));

    expect(bridge.approveSchedule).toHaveBeenCalledWith(['block-task']);
  });

  it('uses labelled five-minute time fields and sends explicit-offset edits', async () => {
    const { bridge } = await renderSchedule();
    const start = screen.getByLabelText(/start time for study typescript/i);
    const end = screen.getByLabelText(/end time for study typescript/i);

    expect(start).toHaveAttribute('type', 'time');
    expect(start).toHaveAttribute('step', '300');
    expect(end).toHaveAttribute('step', '300');
    fireEvent.change(start, { target: { value: '09:05' } });

    await waitFor(() => expect(bridge.updateSchedule).toHaveBeenCalledWith([
      { ...taskBlock, start: '2026-08-02T09:05:00.000+01:00' },
      breakBlock,
    ]));
    expect(start).toHaveValue('09:05');

    vi.mocked(bridge.updateSchedule).mockClear();
    fireEvent.change(start, { target: { value: '09:03' } });
    await act(async () => Promise.resolve());
    expect(bridge.updateSchedule).not.toHaveBeenCalled();
    expect(start).toHaveValue('09:05');
  });

  it('moves a focused task by 15 minutes with Alt+Arrow', async () => {
    const { bridge } = await renderSchedule();
    const block = screen.getByRole('group', { name: /study typescript.*task.*09:00.*10:00/i });

    fireEvent.keyDown(block, { key: 'ArrowDown', altKey: true });
    await waitFor(() => expect(bridge.updateSchedule).toHaveBeenCalledWith([
      {
        ...taskBlock,
        start: '2026-08-02T09:15:00.000+01:00',
        end: '2026-08-02T10:15:00.000+01:00',
      },
      breakBlock,
    ]));

  });

  it('does not move a focused block beyond the 09:00–17:00 window', async () => {
    const atStart = acceptedSchedule([{
      ...taskBlock,
      start: '2026-08-02T09:00:00+01:00',
      end: '2026-08-02T09:30:00+01:00',
    }]);
    const bridge = createBridge({ generateSchedule: vi.fn().mockResolvedValue(atStart) });
    await renderSchedule(bridge);

    fireEvent.keyDown(
      screen.getByRole('group', { name: /study typescript.*task/i }),
      { key: 'ArrowUp', altKey: true },
    );
    await act(async () => Promise.resolve());
    expect(bridge.updateSchedule).not.toHaveBeenCalled();
  });

  it('converts a one-row pointer drag into a 15-minute start/end shift', async () => {
    const { bridge, user } = await renderSchedule();
    const block = screen.getByRole('group', { name: /study typescript.*task/i });

    await user.pointer({
      coords: { clientX: 100, clientY: 100 },
      keys: '[MouseLeft>]',
      target: block,
    });
    await user.pointer({ coords: { clientX: 100, clientY: 103 }, target: block });
    expect(block).toHaveClass('is-dragging');
    await user.pointer({ coords: { clientX: 100, clientY: 124 }, target: block });
    await user.pointer({
      coords: { clientX: 100, clientY: 124 },
      keys: '[/MouseLeft]',
      target: block,
    });

    await waitFor(() => expect(bridge.updateSchedule).toHaveBeenCalledWith([
      {
        ...taskBlock,
        start: '2026-08-02T09:15:00.000+01:00',
        end: '2026-08-02T10:15:00.000+01:00',
      },
      breakBlock,
    ]));
  });

  it('resizes in 15-minute increments while time fields and handles clamp to 09:00–17:00', async () => {
    const endingAtClose = acceptedSchedule([
      {
        ...taskBlock,
        start: '2026-08-02T16:00:00+01:00',
        end: '2026-08-02T17:00:00+01:00',
      },
    ]);
    const bridge = createBridge({ generateSchedule: vi.fn().mockResolvedValue(endingAtClose) });
    const { user } = await renderSchedule(bridge);
    const end = screen.getByLabelText(/end time for study typescript/i);

    fireEvent.change(end, { target: { value: '17:30' } });
    await act(async () => Promise.resolve());
    expect(bridge.updateSchedule).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /extend study typescript by 15 minutes/i }));
    expect(bridge.updateSchedule).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /shorten study typescript by 15 minutes/i }));
    await waitFor(() => expect(bridge.updateSchedule).toHaveBeenCalledWith([{
      ...endingAtClose.blocks[0],
      end: '2026-08-02T16:45:00.000+01:00',
    }]));
  });

  it('restores the last accepted snapshot when the main process rejects an edit', async () => {
    const updateSchedule = vi.fn().mockRejectedValue({
      code: 'VALIDATION_FAILED',
      message: 'That edit overlaps a locked busy period.',
      retryable: false,
    });
    await renderSchedule(createBridge({ updateSchedule }));

    fireEvent.change(screen.getByLabelText(/start time for study typescript/i), {
      target: { value: '12:00' },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(/overlaps a locked busy period/i);
    expect(screen.getByLabelText(/start time for study typescript/i)).toHaveValue('09:00');
  });

  it('renames and removes task or break blocks through validated schedule updates', async () => {
    const { bridge, user } = await renderSchedule();
    const title = screen.getByLabelText(/title for recovery break/i);

    await user.clear(title);
    await user.type(title, 'Tea break');
    fireEvent.blur(title);
    await waitFor(() => expect(bridge.updateSchedule).toHaveBeenCalledWith([
      taskBlock,
      { ...breakBlock, title: 'Tea break' },
    ]));

    await user.click(screen.getByRole('button', { name: /remove tea break/i }));
    await waitFor(() => expect(screen.queryByLabelText(/title for tea break/i)).not.toBeInTheDocument());
    expect(bridge.updateSchedule).toHaveBeenLastCalledWith([taskBlock]);
  });

  it('explains unscheduled remaining work with a readable reason', async () => {
    await renderSchedule();

    const item = screen.getByRole('listitem', { name: /study typescript unscheduled/i });
    expect(item).toHaveTextContent('25 minutes remaining');
    expect(item).toHaveTextContent(/minimum useful session does not fit/i);
  });

  it('blocks double approval and all edit actions while approval is active', async () => {
    const pending = deferred<ApprovalResult>();
    const approveSchedule = vi.fn().mockReturnValue(pending.promise);
    const { user } = await renderSchedule(createBridge({ approveSchedule }));
    const approve = screen.getByRole('button', { name: /approve 2 selected blocks/i });

    await user.dblClick(approve);

    expect(approveSchedule).toHaveBeenCalledTimes(1);
    expect(approve).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /select study typescript/i })).toBeDisabled();
    expect(screen.getByLabelText(/start time for study typescript/i)).toBeDisabled();
    pending.resolve({ status: 'completed', results: [] });
  });

  it('replaces the timeline on conflict and announces that no events were created', async () => {
    const revised = acceptedSchedule([{
      ...taskBlock,
      start: '2026-08-02T13:00:00+01:00',
      end: '2026-08-02T14:00:00+01:00',
    }]);
    const approveSchedule = vi.fn().mockResolvedValue({
      status: 'conflict-detected',
      schedule: revised,
    } satisfies ApprovalResult);
    const { user } = await renderSchedule(createBridge({ approveSchedule }));

    await user.click(screen.getByRole('button', { name: /approve 2 selected blocks/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your calendar changed after this schedule was created. No events were added. Review the revised schedule.',
    );
    expect(screen.getByLabelText(/start time for study typescript/i)).toHaveValue('13:00');
    expect(screen.queryByRole('heading', { name: /calendar results/i })).not.toBeInTheDocument();
  });

  it('keeps a keyboard-accessible revision composer and invalidates the draft on success', async () => {
    const sendMessage = vi.fn()
      .mockResolvedValueOnce(conversation)
      .mockResolvedValueOnce({ ...conversation, messages: [...conversation.messages, {
        id: 'revision-answer',
        role: 'assistant' as const,
        text: 'I revised the task list.',
        createdAt: '2026-08-02T08:10:00+01:00',
      }] });
    const { user } = await renderSchedule(createBridge({ sendMessage }));
    const composer = screen.getByLabelText(/daily goals and tasks/i);

    await user.type(composer, 'Move study later');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { name: /plan your day/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /review your schedule/i })).not.toBeInTheDocument();
  });

  it('retains revision text and the current timeline when revision chat fails', async () => {
    const failingSend = vi.fn()
      .mockResolvedValueOnce(conversation)
      .mockRejectedValueOnce({
        code: 'DEEPSEEK_UNAVAILABLE',
        message: 'Revision unavailable. Try again.',
        retryable: true,
      });
    const { user } = await renderSchedule(createBridge({ sendMessage: failingSend }));
    const retryComposer = screen.getByLabelText(/daily goals and tasks/i);
    await user.type(retryComposer, 'Keep this revision text');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(/revision unavailable/i);
    expect(retryComposer).toHaveValue('Keep this revision text');
    expect(screen.getByRole('heading', { name: /review your schedule/i })).toBeInTheDocument();
  });

  it('provides visible focus, text equivalents, and at least 40px interactive targets', async () => {
    const styles = await readFile('src/renderer/styles.css', 'utf8');
    const style = document.createElement('style');
    style.textContent = styles;
    document.head.append(style);
    await renderSchedule();

    const taskGroup = screen.getByRole('group', { name: /study typescript.*task.*09:00.*10:00/i });
    const checkbox = screen.getByRole('checkbox', { name: /select study typescript/i });
    const remove = screen.getByRole('button', { name: /remove study typescript/i });
    expect(taskGroup).toHaveAttribute('tabindex', '0');
    expect(getComputedStyle(checkbox.closest('label') as HTMLLabelElement).minHeight).toBe('40px');
    expect(getComputedStyle(remove).minHeight).toBe('40px');
    expect(styles).toMatch(/\.timeline-block[^}]*:focus-visible/s);
    style.remove();
  });
});
