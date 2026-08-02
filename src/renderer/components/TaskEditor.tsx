import { DateTime } from 'luxon';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ProposedTask, TaskPriority } from '../../shared/domain';
import type { PlanningActionResult } from '../planningActionResult';

const LONDON_ZONE = 'Europe/London';
const LOCAL_DEADLINE_FORMAT = "yyyy-MM-dd'T'HH:mm";

type DeadlineOffsetChoice = '' | 'earlier' | 'later';

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
  deadline: string;
  deadlineOffsetChoice: DeadlineOffsetChoice;
  canSplit: boolean;
  minimumSessionMinutes: string;
};

type DeadlineState = {
  candidates: DateTime[];
  error?: string;
};

function deadlineToLocal(deadline: string | undefined): string {
  if (!deadline) return '';
  const parsed = DateTime.fromISO(deadline, { setZone: true }).setZone(LONDON_ZONE);
  return parsed.isValid ? parsed.toFormat(LOCAL_DEADLINE_FORMAT) : '';
}

function sortedPossibleOffsets(deadline: DateTime): DateTime[] {
  return deadline.getPossibleOffsets().sort((first, second) => first.toMillis() - second.toMillis());
}

function originalDeadlineOffsetChoice(task: ProposedTask): DeadlineOffsetChoice {
  if (!task.deadline) return '';
  const original = DateTime.fromISO(task.deadline, { setZone: true });
  const local = DateTime.fromISO(deadlineToLocal(task.deadline), { zone: LONDON_ZONE });
  if (!original.isValid || !local.isValid) return '';
  const candidates = sortedPossibleOffsets(local);
  if (candidates.length !== 2) return '';
  return candidates[0].toMillis() === original.toMillis() ? 'earlier' : 'later';
}

function formFromTask(task: ProposedTask): TaskFormState {
  return {
    title: task.title,
    notes: task.notes ?? '',
    durationMinutes: String(task.durationMinutes),
    durationWasEstimated: task.durationWasEstimated,
    priority: task.priority,
    deadline: deadlineToLocal(task.deadline),
    deadlineOffsetChoice: originalDeadlineOffsetChoice(task),
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

function analyzeDeadline(localValue: string): DeadlineState {
  if (!localValue) return { candidates: [] };
  const parsed = DateTime.fromISO(localValue, { zone: LONDON_ZONE });
  if (!parsed.isValid) {
    return { candidates: [], error: 'Enter a valid Europe/London date and time.' };
  }
  if (parsed.toFormat(LOCAL_DEADLINE_FORMAT) !== localValue) {
    return {
      candidates: [],
      error: 'This local time does not exist in Europe/London. Choose another time.',
    };
  }
  return { candidates: sortedPossibleOffsets(parsed) };
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
  const deadlineState = analyzeDeadline(form.deadline);
  const deadlineIsAmbiguous = deadlineState.candidates.length === 2;
  const deadlineError = deadlineState.error
    ?? (deadlineIsAmbiguous && !form.deadlineOffsetChoice
      ? 'Choose the earlier or later offset for this deadline.'
      : undefined);
  const valid = form.title.trim().length > 0
    && duration !== undefined
    && minimumSession !== undefined
    && !minimumError
    && !deadlineError;

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid || busy || submitting.current || duration === undefined || minimumSession === undefined) {
      return;
    }

    const unchangedDeadline = form.deadline === deadlineToLocal(task.deadline)
      && form.deadlineOffsetChoice === originalDeadlineOffsetChoice(task);
    const selectedDeadline = deadlineIsAmbiguous
      ? deadlineState.candidates[form.deadlineOffsetChoice === 'later' ? 1 : 0]
      : deadlineState.candidates[0];
    const deadline = unchangedDeadline
      ? task.deadline
      : selectedDeadline?.toISO() ?? undefined;
    const submittedTask: ProposedTask = {
      ...task,
      title: form.title.trim(),
      notes: form.notes.trim() || undefined,
      durationMinutes: duration,
      durationWasEstimated: form.durationWasEstimated,
      priority: form.priority,
      deadline,
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
  const deadlineErrorId = `${prefix}-deadline-error`;

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
              <label htmlFor={`${prefix}-deadline`}>Deadline</label>
              <input
                aria-describedby={deadlineError ? deadlineErrorId : undefined}
                aria-invalid={Boolean(deadlineError)}
                id={`${prefix}-deadline`}
                onChange={(event) => updateForm({
                  deadline: event.target.value,
                  deadlineOffsetChoice: event.target.value === deadlineToLocal(task.deadline)
                    ? originalDeadlineOffsetChoice(task)
                    : '',
                })}
                type="datetime-local"
                value={form.deadline}
              />
              {deadlineError && <p className="field-error" id={deadlineErrorId}>{deadlineError}</p>}
            </div>
          </div>

          {deadlineIsAmbiguous && (
            <fieldset className="deadline-offset-choice">
              <legend>Choose which {form.deadline.slice(11, 16)} occurrence</legend>
              {deadlineState.candidates.map((candidate, index) => {
                const choice: DeadlineOffsetChoice = index === 0 ? 'earlier' : 'later';
                return (
                  <label className="radio-label" key={choice}>
                    <input
                      className="deadline-offset-radio"
                      checked={form.deadlineOffsetChoice === choice}
                      name={`${prefix}-deadline-offset`}
                      onChange={() => updateForm({ deadlineOffsetChoice: choice })}
                      type="radio"
                      value={choice}
                    />
                    {index === 0 ? 'Earlier' : 'Later'} offset ({candidate.toFormat('ZZ')})
                  </label>
                );
              })}
            </fieldset>
          )}

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
