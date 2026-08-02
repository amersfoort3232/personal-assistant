// @vitest-environment jsdom

import { StrictMode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';
import type { AssistantBridge } from '../../src/renderer/bridge';
import { ApprovalResultView } from '../../src/renderer/components/ApprovalResultView';
import type {
  ApprovalResult,
  ConversationSnapshot,
  EventCreationResult,
  ProposedTask,
  ScheduleBlock,
  ScheduleSnapshot,
  SetupStatus,
} from '../../src/shared/domain';

const blocks: ScheduleBlock[] = [
  {
    id: 'created-block',
    kind: 'task',
    taskId: 'task-1',
    title: 'Created task',
    start: '2026-08-02T09:00:00+01:00',
    end: '2026-08-02T10:00:00+01:00',
    selected: true,
  },
  {
    id: 'existing-block',
    kind: 'break',
    title: 'Existing break',
    start: '2026-08-02T10:00:00+01:00',
    end: '2026-08-02T10:15:00+01:00',
    selected: true,
  },
  {
    id: 'failed-block',
    kind: 'task',
    taskId: 'task-1',
    title: 'Failed task',
    start: '2026-08-02T10:15:00+01:00',
    end: '2026-08-02T11:00:00+01:00',
    selected: true,
  },
];

const results: EventCreationResult[] = [
  { blockId: 'created-block', status: 'created', googleEventId: 'event-created' },
  { blockId: 'existing-block', status: 'already-existed', googleEventId: 'event-existing' },
  { blockId: 'failed-block', status: 'failed', errorCode: 'CALENDAR_UNAVAILABLE' },
];

describe('approval result view', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders created, already-existing, and failed events in separate labelled lists', () => {
    render(
      <ApprovalResultView
        blocks={blocks}
        busy={false}
        onRetryFailed={vi.fn()}
        results={results}
      />,
    );

    expect(within(screen.getByRole('region', { name: /created events/i }))
      .getByRole('listitem')).toHaveTextContent(/created task.*created/i);
    expect(within(screen.getByRole('region', { name: /already existed/i }))
      .getByRole('listitem')).toHaveTextContent(/existing break.*already existed/i);
    expect(within(screen.getByRole('region', { name: /failed events/i }))
      .getByRole('listitem')).toHaveTextContent(/failed task.*calendar unavailable/i);
  });

  it('offers retry only when failures exist and passes only failed block IDs', async () => {
    const user = userEvent.setup();
    const onRetryFailed = vi.fn();
    const { rerender } = render(
      <ApprovalResultView
        blocks={blocks}
        busy={false}
        onRetryFailed={onRetryFailed}
        results={results}
      />,
    );

    await user.click(screen.getByRole('button', { name: /retry failed events/i }));
    expect(onRetryFailed).toHaveBeenCalledWith(['failed-block']);

    rerender(
      <ApprovalResultView
        blocks={blocks}
        busy={false}
        onRetryFailed={onRetryFailed}
        results={results.filter((result) => result.status !== 'failed')}
      />,
    );
    expect(screen.queryByRole('button', { name: /retry failed events/i })).not.toBeInTheDocument();
  });

  it('reuses the result view with the retry response and prevents concurrent retries', async () => {
    const completeSetup: SetupStatus = {
      hasDeepSeekApiKey: true,
      googleConnected: true,
      calendarReady: true,
    };
    const task: ProposedTask = {
      id: 'task-1',
      title: 'Created task',
      notes: undefined,
      durationMinutes: 60,
      durationWasEstimated: false,
      priority: 'high',
      deadline: undefined,
      canSplit: false,
      minimumSessionMinutes: 30,
    };
    const conversation: ConversationSnapshot = {
      messages: [{
        id: 'assistant',
        role: 'assistant',
        text: 'Tasks ready.',
        createdAt: '2026-08-02T08:00:00+01:00',
      }],
      tasks: [task],
    };
    const schedule: ScheduleSnapshot = {
      targetDate: '2026-08-02',
      busyPeriods: [],
      blocks,
      unscheduledTasks: [],
      warnings: [],
    };
    let resolveRetry!: (result: ApprovalResult) => void;
    const retry = new Promise<ApprovalResult>((resolve) => { resolveRetry = resolve; });
    const approveSchedule = vi.fn()
      .mockResolvedValueOnce({ status: 'completed', results } satisfies ApprovalResult)
      .mockReturnValueOnce(retry);
    const bridge = {
      getSetupStatus: vi.fn().mockResolvedValue(completeSetup),
      saveDeepSeekApiKey: vi.fn(),
      connectGoogle: vi.fn(),
      disconnectGoogle: vi.fn(),
      getSettings: vi.fn(),
      updateSettings: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue(conversation),
      updateTask: vi.fn(),
      generateSchedule: vi.fn().mockResolvedValue(schedule),
      updateSchedule: vi.fn().mockImplementation(async (next: ScheduleBlock[]) => ({ ...schedule, blocks: next })),
      approveSchedule,
      resetSession: vi.fn(),
    } as AssistantBridge;
    window.assistant = bridge;
    const user = userEvent.setup();
    render(<StrictMode><App /></StrictMode>);
    await screen.findByRole('heading', { name: /plan your day/i });
    await user.type(screen.getByLabelText(/daily goals and tasks/i), 'Plan');
    await user.keyboard('{Enter}');
    await screen.findByText('Tasks ready.');
    await user.click(screen.getByRole('button', { name: /build schedule/i }));
    await user.click(await screen.findByRole('button', { name: /approve 3 selected blocks/i }));
    await screen.findByRole('heading', { name: /calendar results/i });

    const retryButton = screen.getByRole('button', { name: /retry failed events/i });
    await user.dblClick(retryButton);
    expect(approveSchedule).toHaveBeenLastCalledWith(['failed-block']);
    expect(approveSchedule).toHaveBeenCalledTimes(2);
    expect(retryButton).toBeDisabled();

    resolveRetry({
      status: 'completed',
      results: [{ blockId: 'failed-block', status: 'created', googleEventId: 'retry-created' }],
    });
    await waitFor(() => {
      expect(screen.getByRole('region', { name: /created events/i })).toHaveTextContent('Failed task');
      expect(screen.queryByRole('region', { name: /failed events/i })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: /calendar results/i })).toBeInTheDocument();
  });
});
