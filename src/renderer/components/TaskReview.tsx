import type { ProposedTask } from '../../shared/domain';
import type { PlanningActionResult } from '../planningActionResult';
import { TaskEditor } from './TaskEditor';

type TaskReviewProps = {
  tasks: ProposedTask[];
  busy: boolean;
  onUpdateTask(task: ProposedTask): Promise<PlanningActionResult<ProposedTask>>;
};

export function TaskReview({ tasks, busy, onUpdateTask }: TaskReviewProps) {
  return (
    <section className="task-review" aria-labelledby="tasks-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Review</p>
          <h2 id="tasks-title">Tasks</h2>
        </div>
        <span className="task-count" aria-label={`${tasks.length} tasks`}>{tasks.length}</span>
      </div>

      {tasks.length === 0 ? (
        <p className="empty-state">Your interpreted tasks will appear here.</p>
      ) : (
        <div className="task-list">
          {tasks.map((task) => (
            <TaskEditor
              busy={busy}
              key={task.id}
              onSave={onUpdateTask}
              task={task}
            />
          ))}
        </div>
      )}
    </section>
  );
}
