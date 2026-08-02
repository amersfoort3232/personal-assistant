# Fixed-Time Tasks and 15-Minute Task Buffers

Date: 2026-08-02

## Goal

Represent an explicit start time in a planning request faithfully and leave a
15-minute protected break between assistant-created tasks. This prevents a
request such as "at 11 I start leaving for RVI hospital" from being treated as
a deadline and moved to 09:00.

## Scope

- Add an optional `fixedStartTime` (`HH:mm`, Europe/London local time) to a
  proposed task.
- Teach DeepSeek extraction that phrases such as "at 11", "start at 11", and
  "leave at 11" describe a fixed start when they modify the task itself.
- Preserve a deadline only for wording such as "finish before 11" or "due at
  11".
- Let users see and edit a fixed start time in the task review screen.
- Schedule fixed-time tasks at that exact time on the selected schedule date.
- Insert a 15-minute `Break` block between consecutive assistant-created tasks,
  replacing the existing 10-minute break-only-for-long-tasks rule. The next task
  therefore cannot begin until at least 15 minutes after the preceding task ends.

The change does not alter Google Calendar busy events, working hours, approval,
or the rule that only approved blocks are written to the Personal Assistant
calendar.

## Data Model and Extraction

`ProposedTask` gains an optional `fixedStartTime` field validated as an
unambiguous 24-hour `HH:mm` value. It is deliberately time-only: the schedule
date selected in the application supplies the date and `Europe/London` supplies
the timezone. A task cannot use `fixedStartTime` as a substitute for a deadline;
the two fields remain independently meaningful.

The DeepSeek system prompt and `replace_tasks` tool schema will document the
distinction. For example, the request:

> At 11 I start leaving from home to RVI hospital

produces a task such as `Leave for RVI hospital` with `fixedStartTime: "11:00"`.
If no travel duration is given, the existing conservative-duration estimation
rule still applies and remains labelled as estimated.

## Scheduling Behaviour

The scheduler first validates fixed-time tasks against the selected day,
working window, and imported busy periods. A valid fixed task gets a task block
that begins exactly at its `fixedStartTime`; it is never shifted earlier or
later. Its 15-minute break is reserved as part of the assistant schedule.

The fixed task and its buffer make the surrounding interval unavailable before
ordinary flexible tasks are allocated. Before a fixed task, the preceding
assistant task must end no later than 15 minutes before the fixed start; after
it, the following task begins no earlier than 15 minutes after the fixed task
ends. Flexible tasks use the same buffer rule, so consecutive assistant task
blocks are separated by a 15-minute `Break` block.

If a fixed task lies outside working hours or overlaps an imported Google busy
period, it remains unscheduled with the new `fixed-time-conflict` reason. The
scheduler must not silently move it. The existing review screen makes this
visible before approval.

## Review UI

The task editor gains an optional labelled `Fixed start` time control alongside
the existing deadline control. Leaving it empty keeps the task flexible. A fixed
start is editable before schedule generation, and any accepted edit invalidates
the current draft as other task edits already do.

The schedule timeline continues to render break blocks, now as 15-minute
breaks between task blocks (and after a long task). On approval, task and break blocks are both written
to the Personal Assistant calendar, preserving the protected breaks.

## Tests

- Schema tests accept valid fixed start times and reject malformed times.
- DeepSeek client request tests assert the prompt/tool schema distinguishes a
  fixed start from a deadline.
- Scheduler regression tests prove a task fixed at 11:00 begins at 11:00,
  never at the earlier 09:00 opening, and prevents another task from ending
  later than 10:45.
- Scheduler tests prove consecutive tasks receive a 15-minute break rather
  than the previous 10-minute, long-task-only break.
- Tests cover a fixed task conflicting with a busy period and verify it is not
  silently rescheduled.
- Renderer tests cover reading and saving the fixed-start control.

## Safety and Compatibility

All model output continues through the local strict Zod schema. Existing tasks
without `fixedStartTime` remain valid and become subject to the new default
15-minute task buffer when a schedule is generated. No personal planning text,
credentials, or calendar content is added to logs.
