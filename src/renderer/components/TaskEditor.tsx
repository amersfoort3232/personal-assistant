import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ProposedTask, TaskPriority } from '../../shared/domain';
import type { PlanningActionResult } from '../planningActionResult';

type TaskEditorProps = {
  task: ProposedTask;
  busy: boolean;
  onSave(task: ProposedTask): Promise<PlanningActionResult<ProposedTask>>;
};

type TaskFormState = {
  title: string;
  notes: string;
  durationMinutes: string;
  durationWasEstimated: boolean;
  priority: TaskPriority;
  fixedStartTime: string;
  canSplit: boolean;
  minimumSessionMinutes: string;
};

function formFromTask(task: ProposedTask): TaskFormState {
  return {
    title: task.title,
    notes: task.notes ?? '',
    durationMinutes: String(task.durationMinutes),
    durationWasEstimated: task.durationWasEstimated,
    priority: task.priority,
    fixedStartTime: task.fixedStartTime ?? '',
    canSplit: task.canSplit,
    minimumSessionMinutes: String(task.minimumSessionMinutes),
  };
}

function numericError(
  value: string,
  label: 'Duration' | 'Minimum session',
  minimum: number,
  maximum: number,
): string | undefined {
  if (value.trim().length === 0) return `${label} is required.`;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return `${label} must be a whole number.`;
  if (parsed < minimum || parsed > maximum) {
    return `${label} must be between ${minimum} and ${maximum} minutes.`;
  }
  return undefined;
}

function validInteger(value: string): number {
  return Number(value);
}

export function TaskEditor({ task, busy, onSave }: TaskEditorProps) {
  const [form, setForm] = useState(() => formFromTask(task));
  const [dirty, setDirty] = useState(false);
  const submitting = useRef(false);

  useEffect(() => {
    if (!dirty) setForm(formFromTask(task));
  }, [dirty, task]);

  const updateForm = (change: Partial<TaskFormState>) => {
    setDirty(true);
    setForm((current) => ({ ...current, ...change }));
  };

  const durationError = numericError(form.durationMinutes, 'Duration', 5, 480);
  const minimumRangeError = numericError(
    form.minimumSessionMinutes,
    'Minimum session',
    15,
    120,
  );
  const duration = durationError ? undefined : validInteger(form.durationMinutes);
  const minimumSession = minimumRangeError
    ? undefined
    : validInteger(form.minimumSessionMinutes);
  const minimumExceedsDuration = duration !== undefined
    && minimumSession !== undefined
    && minimumSession > duration;
  const minimumError = minimumRangeError
    ?? (minimumExceedsDuration ? 'Minimum session cannot exceed duration.' : undefined);
  const valid = form.title.trim().length > 0
    && duration !== undefined
    && minimumSession !== undefined
    && !minimumError;

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid || busy || submitting.current || duration === undefined || minimumSession === undefined) {
      return;
    }

    const submittedTask: ProposedTask = {
      ...task,
      title: form.title.trim(),
      notes: form.notes.trim() || undefined,
      durationMinutes: duration,
      durationWasEstimated: form.durationWasEstimated,
      priority: form.priority,
      fixedStartTime: form.fixedStartTime || undefined,
      canSplit: form.canSplit,
      minimumSessionMinutes: minimumSession,
    };

    submitting.current = true;
    try {
      const result = await onSave(submittedTask);
      if (result.status === 'completed') {
        setForm(formFromTask(result.value));
        setDirty(false);
      }
    } catch {
      // App renders the structured public bridge error without exposing internals.
    } finally {
      submitting.current = false;
    }
  };

  const prefix = `task-${task.id}`;
  const durationErrorId = `${prefix}-duration-error`;
  const minimumErrorId = `${prefix}-minimum-error`;

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
            onChange={(event) => updateForm({ title: event.target.value })}
            required
            type="text"
            value={form.title}
          />

          <label htmlFor={`${prefix}-notes`}>Notes</label>
          <textarea
            id={`${prefix}-notes`}
            maxLength={2000}
            onChange={(event) => updateForm({ notes: event.target.value })}
            rows={2}
            value={form.notes}
          />

          <div className="task-field-grid">
            <div>
              <label htmlFor={`${prefix}-duration`}>Duration (minutes)</label>
              <input
                aria-describedby={durationError ? durationErrorId : undefined}
                aria-invalid={Boolean(durationError)}
                id={`${prefix}-duration`}
                inputMode="numeric"
                max={480}
                min={5}
                onChange={(event) => updateForm({
                  durationMinutes: event.target.value,
                  durationWasEstimated: false,
                })}
                required
                step={1}
                type="number"
                value={form.durationMinutes}
              />
              {durationError && <p className="field-error" id={durationErrorId}>{durationError}</p>}
            </div>

            <div>
              <label htmlFor={`${prefix}-minimum`}>Minimum session (minutes)</label>
              <input
                aria-describedby={minimumError ? minimumErrorId : undefined}
                aria-invalid={Boolean(minimumError)}
                id={`${prefix}-minimum`}
                inputMode="numeric"
                max={Math.min(duration ?? 120, 120)}
                min={15}
                onChange={(event) => updateForm({ minimumSessionMinutes: event.target.value })}
                required
                step={1}
                type="number"
                value={form.minimumSessionMinutes}
              />
              {minimumError && <p className="field-error" id={minimumErrorId}>{minimumError}</p>}
            </div>

            <div>
              <label htmlFor={`${prefix}-priority`}>Priority</label>
              <select
                id={`${prefix}-priority`}
                onChange={(event) => updateForm({ priority: event.target.value as TaskPriority })}
                value={form.priority}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>

            <div>
              <label htmlFor={`${prefix}-fixed-start`}>Fixed start</label>
              <input
                id={`${prefix}-fixed-start`}
                onChange={(event) => updateForm({ fixedStartTime: event.target.value })}
                type="time"
                value={form.fixedStartTime}
              />
            </div>
          </div>

          <label className="checkbox-label" htmlFor={`${prefix}-split`}>
            <input
              checked={form.canSplit}
              id={`${prefix}-split`}
              onChange={(event) => updateForm({ canSplit: event.target.checked })}
              type="checkbox"
            />
            Allow splitting into multiple sessions
          </label>

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
