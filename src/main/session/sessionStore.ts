import type {
  ChatMessage,
  ProposedTask,
  ScheduleSnapshot,
} from '../../shared/domain';

type SessionState = {
  messages: ChatMessage[];
  tasks: ProposedTask[];
  busyPeriods: ScheduleSnapshot['busyPeriods'];
  draftSchedule: ScheduleSnapshot['blocks'];
  unscheduledTasks: ScheduleSnapshot['unscheduledTasks'];
  warnings: string[];
  targetDate: string | undefined;
};

const emptyState = (): SessionState => ({
  messages: [],
  tasks: [],
  busyPeriods: [],
  draftSchedule: [],
  unscheduledTasks: [],
  warnings: [],
  targetDate: undefined,
});

export class SessionStore {
  private state = emptyState();

  getSnapshot(): SessionState {
    return structuredClone(this.state);
  }

  appendMessage(message: ChatMessage): void {
    this.state.messages.push(structuredClone(message));
  }

  replaceTasks(tasks: ProposedTask[]): void {
    this.state.tasks = structuredClone(tasks);
  }

  replaceSchedule(schedule: ScheduleSnapshot): void {
    this.state.busyPeriods = structuredClone(schedule.busyPeriods);
    this.state.draftSchedule = structuredClone(schedule.blocks);
    this.state.unscheduledTasks = structuredClone(schedule.unscheduledTasks);
    this.state.warnings = [...schedule.warnings];
    this.state.targetDate = schedule.targetDate;
  }

  clearSchedule(): void {
    this.state.busyPeriods = [];
    this.state.draftSchedule = [];
    this.state.unscheduledTasks = [];
    this.state.warnings = [];
    this.state.targetDate = undefined;
  }

  reset(): void {
    this.state = emptyState();
  }
}
