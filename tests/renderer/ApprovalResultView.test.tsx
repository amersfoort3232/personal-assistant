// @vitest-environment jsdom

import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';
import { appReducer, type RendererState } from '../../src/renderer/appReducer';
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

  it('returns to settled results without retry when every retry-revision block is removed', () => {
    const retrySchedule: ScheduleSnapshot = {
      targetDate: '2026-08-02',
      busyPeriods: [],
      blocks: [blocks[2]],
      unscheduledTasks: [],
      warnings: [],
    };
    const state: RendererState = {
      view: 'schedule',
      schedule: retrySchedule,
      approval: { status: 'completed', results },
      approvalBlocks: blocks,
      busy: true,
    };

    const next = appReducer(state, {
      type: 'scheduleUpdated',
      schedule: { ...retrySchedule, blocks: [] },
    });

    expect(next).toMatchObject({
      view: 'result',
      approval: {
        status: 'completed',
        results: results.filter((result) => result.status !== 'failed'),
      },
      approvalBlocks: blocks.slice(0, 2),
      busy: false,
    });
    render(
      <ApprovalResultView
        blocks={next.approvalBlocks!}
        busy={next.busy}
        onRetryFailed={vi.fn()}
        results={next.approval?.status === 'completed' ? next.approval.results : []}
      />,
    );
    expect(screen.getByText('Created task')).toBeInTheDocument();
    expect(screen.getByText('Existing break')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry failed events/i })).not.toBeInTheDocument();
  });

  it('prunes one removed failure, retains revised titles, and merges the remaining retry result', () => {
    const removedFailure = { ...blocks[2], id: 'removed-failure', title: 'Removed failure' };
    const remainingFailure = { ...blocks[2], id: 'remaining-failure', title: 'Revised remaining title' };
    const retryResults: EventCreationResult[] = [
      ...results.filter((result) => result.status !== 'failed'),
      { blockId: removedFailure.id, status: 'failed', errorCode: 'CALENDAR_UNAVAILABLE' },
      { blockId: remainingFailure.id, status: 'failed', errorCode: 'CALENDAR_UNAVAILABLE' },
    ];
    const retrySchedule: ScheduleSnapshot = {
      targetDate: '2026-08-02',
      busyPeriods: [],
      blocks: [removedFailure, remainingFailure],
      unscheduledTasks: [],
      warnings: [],
    };
    const state: RendererState = {
      view: 'schedule',
      schedule: retrySchedule,
      approval: { status: 'completed', results: retryResults },
      approvalBlocks: [...blocks.slice(0, 2), removedFailure, { ...remainingFailure, title: 'Old title' }],
      busy: true,
    };

    const afterRemoval = appReducer(state, {
      type: 'scheduleUpdated',
      schedule: { ...retrySchedule, blocks: [remainingFailure] },
    });
    const afterApproval = appReducer(afterRemoval, {
      type: 'approvalRetried',
      approval: {
        status: 'completed',
        results: [{
          blockId: remainingFailure.id,
          status: 'created',
          googleEventId: 'retry-created',
        }],
      },
    });

    expect(afterRemoval.approval?.status === 'completed' && afterRemoval.approval.results)
      .toEqual([
        ...results.filter((result) => result.status !== 'failed'),
        { blockId: remainingFailure.id, status: 'failed', errorCode: 'CALENDAR_UNAVAILABLE' },
      ]);
    expect(afterApproval.approval?.status === 'completed' && afterApproval.approval.results)
      .toEqual([
        ...results.filter((result) => result.status !== 'failed'),
        {
          blockId: remainingFailure.id,
          status: 'created',
          googleEventId: 'retry-created',
        },
      ]);
    expect(afterApproval.approvalBlocks).toEqual([
      ...blocks.slice(0, 2),
      remainingFailure,
    ]);
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

  it('retains prior results through a retry conflict and merges the revised approval', async () => {
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
    const revisedFailed = {
      ...blocks[2],
      start: '2026-08-02T12:00:00+01:00',
      end: '2026-08-02T12:45:00+01:00',
    };
    const approveSchedule = vi.fn()
      .mockResolvedValueOnce({ status: 'completed', results } satisfies ApprovalResult)
      .mockResolvedValueOnce({
        status: 'conflict-detected',
        schedule: { ...schedule, blocks: [revisedFailed] },
      } satisfies ApprovalResult)
      .mockResolvedValueOnce({
        status: 'completed',
        results: [{ blockId: 'failed-block', status: 'created', googleEventId: 'retry-created' }],
      } satisfies ApprovalResult);
    window.assistant = {
      getSetupStatus: vi.fn().mockResolvedValue(completeSetup),
      saveDeepSeekApiKey: vi.fn(),
      connectGoogle: vi.fn(),
      disconnectGoogle: vi.fn(),
      getSettings: vi.fn(),
      updateSettings: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue(conversation),
      updateTask: vi.fn(),
      generateSchedule: vi.fn().mockResolvedValue(schedule),
      updateSchedule: vi.fn().mockImplementation(async (next: ScheduleBlock[]) => ({
        ...schedule,
        blocks: next,
      })),
      approveSchedule,
      resetSession: vi.fn(),
    } as AssistantBridge;
    const user = userEvent.setup();
    render(<StrictMode><App /></StrictMode>);
    await screen.findByRole('heading', { name: /plan your day/i });
    await user.type(screen.getByLabelText(/daily goals and tasks/i), 'Plan');
    await user.keyboard('{Enter}');
    await screen.findByText('Tasks ready.');
    await user.click(screen.getByRole('button', { name: /build schedule/i }));
    await user.click(await screen.findByRole('button', { name: /approve 3 selected blocks/i }));
    await user.click(await screen.findByRole('button', { name: /retry failed events/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /no retry events were added.*earlier results remain unchanged/i,
    );
    expect(screen.getByLabelText(/start time for failed task/i)).toHaveValue('12:00');
    fireEvent.change(screen.getByLabelText(/start time for failed task/i), {
      target: { value: '12:05' },
    });
    await waitFor(() => expect(window.assistant.updateSchedule).toHaveBeenCalledWith([{
      ...revisedFailed,
      start: '2026-08-02T12:05:00.000+01:00',
    }]));
    await user.click(screen.getByRole('button', { name: /approve 1 selected block/i }));

    await waitFor(() => {
      expect(screen.getByRole('region', { name: /created events/i })).toHaveTextContent('Created task');
      expect(screen.getByRole('region', { name: /created events/i })).toHaveTextContent('Failed task');
      expect(screen.getByRole('region', { name: /already existed/i })).toHaveTextContent('Existing break');
      expect(screen.queryByRole('region', { name: /failed events/i })).not.toBeInTheDocument();
    });
    expect(approveSchedule).toHaveBeenNthCalledWith(1, ['created-block', 'existing-block', 'failed-block']);
    expect(approveSchedule).toHaveBeenNthCalledWith(2, ['failed-block']);
    expect(approveSchedule).toHaveBeenNthCalledWith(3, ['failed-block']);
  });
});
