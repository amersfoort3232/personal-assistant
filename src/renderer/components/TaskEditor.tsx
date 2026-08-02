import { DateTime } from 'luxon';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ProposedTask, TaskPriority } from '../../shared/domain';

const LONDON_ZONE = 'Europe/London';

type TaskEditorProps = {
  task: ProposedTask;
  busy: boolean;
  onSave(task: ProposedTask): Promise<void>;
};

type TaskFormState = {
  title: string;
  notes: string;
  durationMinutes: string;
  durationWasEstimated: boolean;
  priority: TaskPriority;
  deadline: string;
  canSplit: boolean;
  minimumSessionMinutes: string;
};

function deadlineToLocal(deadline: string | undefined): string {
  if (!deadline) return '';
  const parsed = DateTime.fromISO(deadline, { setZone: true }).setZone(LONDON_ZONE);
  return parsed.isValid ? parsed.toFormat("yyyy-MM-dd'T'HH:mm") : '';
}

function formFromTask(task: ProposedTask): TaskFormState {
  return {
    title: task.title,
    notes: task.notes ?? '',
    durationMinutes: String(task.durationMinutes),
    durationWasEstimated: task.durationWasEstimated,
    priority: task.priority,
    deadline: deadlineToLocal(task.deadline),
    canSplit: task.canSplit,
    minimumSessionMinutes: String(task.minimumSessionMinutes),
  };
}

function integerInRange(value: string, minimum: number, maximum: number): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : undefined;
}

export function TaskEditor({ task, busy, onSave }: TaskEditorProps) {
  const [form, setForm] = useState(() => formFromTask(task));
  const submitting = useRef(false);

  useEffect(() => {
    setForm(formFromTask(task));
  }, [task]);

  const duration = integerInRange(form.durationMinutes, 5, 480);
  const minimumSession = integerInRange(form.minimumSessionMinutes, 15, 120);
  const minimumExceedsDuration = duration !== undefined
    && minimumSession !== undefined
    && minimumSession > duration;
  const parsedDeadline = form.deadline
    ? DateTime.fromISO(form.deadline, { zone: LONDON_ZONE })
    : undefined;
  const valid = form.title.trim().length > 0
    && duration !== undefined
    && minimumSession !== undefined
    && !minimumExceedsDuration
    && (!parsedDeadline || parsedDeadline.isValid);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid || busy || submitting.current || duration === undefined || minimumSession === undefined) {
      return;
    }

    submitting.current = true;
    const deadline = form.deadline === deadlineToLocal(task.deadline)
      ? task.deadline
      : parsedDeadline?.toISO() ?? undefined;
    try {
      await onSave({
        ...task,
        title: form.title.trim(),
        notes: form.notes.trim() || undefined,
        durationMinutes: duration,
        durationWasEstimated: form.durationWasEstimated,
        priority: form.priority,
        deadline,
        canSplit: form.canSplit,
        minimumSessionMinutes: minimumSession,
      });
    } catch {
      // App renders the structured public bridge error without exposing internals.
    } finally {
      submitting.current = false;
    }
  };

  const prefix = `task-${task.id}`;

  return (
    <form className="task-editor" onSubmit={(event) => void save(event)}>
      <fieldset aria-busy={busy} disabled={busy}>
        <legend>{task.title}</legend>
        <div className="task-heading">
          <span className="task-title">{task.title}</span>
          {form.durationWasEstimated && <span className="estimated-badge">Estimated</span>}
        </div>

        <div className="task-fields">
          <label htmlFor={`${prefix}-title`}>Title</label>
          <input
            id={`${prefix}-title`}
            maxLength={160}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            required
            type="text"
            value={form.title}
          />

          <label htmlFor={`${prefix}-notes`}>Notes</label>
          <textarea
            id={`${prefix}-notes`}
            maxLength={2000}
            onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
            rows={2}
            value={form.notes}
          />

          <div className="task-field-grid">
            <div>
              <label htmlFor={`${prefix}-duration`}>Duration (minutes)</label>
              <input
                id={`${prefix}-duration`}
                inputMode="numeric"
                max={480}
                min={5}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  durationMinutes: event.target.value,
                  durationWasEstimated: false,
                }))}
                required
                step={1}
                type="number"
                value={form.durationMinutes}
              />
            </div>

            <div>
              <label htmlFor={`${prefix}-minimum`}>Minimum session (minutes)</label>
              <input
                aria-describedby={minimumExceedsDuration ? `${prefix}-minimum-error` : undefined}
                id={`${prefix}-minimum`}
                inputMode="numeric"
                max={duration ?? 120}
                min={15}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  minimumSessionMinutes: event.target.value,
                }))}
                required
                step={1}
                type="number"
                value={form.minimumSessionMinutes}
              />
            </div>

            <div>
              <label htmlFor={`${prefix}-priority`}>Priority</label>
              <select
                id={`${prefix}-priority`}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  priority: event.target.value as TaskPriority,
                }))}
                value={form.priority}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>

            <div>
              <label htmlFor={`${prefix}-deadline`}>Deadline</label>
              <input
                id={`${prefix}-deadline`}
                onChange={(event) => setForm((current) => ({ ...current, deadline: event.target.value }))}
                type="datetime-local"
                value={form.deadline}
              />
            </div>
          </div>

          <label className="checkbox-label" htmlFor={`${prefix}-split`}>
            <input
              checked={form.canSplit}
              id={`${prefix}-split`}
              onChange={(event) => setForm((current) => ({ ...current, canSplit: event.target.checked }))}
              type="checkbox"
            />
            Allow splitting into multiple sessions
          </label>

          {minimumExceedsDuration && (
            <p className="field-error" id={`${prefix}-minimum-error`}>
              Minimum session cannot exceed duration.
            </p>
          )}

          <button
            aria-label={`Save ${task.title}`}
            className="button button-secondary"
            disabled={!valid || busy}
            type="submit"
          >
            Save changes
          </button>
        </div>
      </fieldset>
    </form>
  );
}
