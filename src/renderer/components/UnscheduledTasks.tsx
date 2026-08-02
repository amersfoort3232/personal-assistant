import type { ProposedTask, UnscheduledTask } from '../../shared/domain';

const REASONS: Record<UnscheduledTask['reason'], string> = {
  'no-free-time': 'No free time remains in the working day.',
  'deadline-impossible': 'The deadline cannot be met in the available time.',
  'minimum-session-does-not-fit': 'The minimum useful session does not fit.',
};

type UnscheduledTasksProps = {
  tasks: ProposedTask[];
  unscheduledTasks: UnscheduledTask[];
};

export function UnscheduledTasks({ tasks, unscheduledTasks }: UnscheduledTasksProps) {
  if (unscheduledTasks.length === 0) return null;

  const titles = new Map(tasks.map((task) => [task.id, task.title]));

  return (
    <section className="unscheduled-tasks" aria-labelledby="unscheduled-title">
      <h2 id="unscheduled-title">Unscheduled work</h2>
      <ul>
        {unscheduledTasks.map((item) => {
          const title = titles.get(item.taskId) ?? 'Unknown task';
          return (
            <li aria-label={`${title} unscheduled`} key={item.taskId}>
              <strong>{title}</strong>
              <span>{item.remainingMinutes} minutes remaining</span>
              <span>{REASONS[item.reason]}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
