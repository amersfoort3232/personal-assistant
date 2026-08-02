# Fixed-Time Tasks and 15-Minute Buffers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep explicitly timed tasks at their requested local start and reserve a 15-minute break between assistant-created tasks.

**Architecture:** Add an optional `fixedStartTime` to the shared validated task contract. The scheduler will allocate fixed tasks first, reserve their surrounding buffers, then schedule flexible tasks using the same buffer invariant. The React editor exposes the field and the DeepSeek tool contract makes fixed starts distinct from deadlines.

**Tech Stack:** TypeScript, Zod, Luxon, Vitest, React Testing Library, Electron Forge.

## Global Constraints

- Timezone is always `Europe/London`; `fixedStartTime` is `HH:mm` and receives its date from `targetDate`.
- A fixed start is exact; conflicting or out-of-hours fixed tasks are never moved and return `fixed-time-conflict`.
- A `Break` is 15 minutes and separates all assistant-created task blocks; imported Google Calendar busy periods are unchanged.
- Continue strict local validation of every DeepSeek tool result and retain approval-before-calendar-write behaviour.
- Do not add planning content or credentials to the rolling error log.

---

### Task 1: Extend the Task Contract, Extraction Prompt, and Editor

**Files:**
- Modify: `src/shared/schemas.ts`
- Modify: `src/main/deepseek/prompt.ts`
- Modify: `src/renderer/components/TaskEditor.tsx`
- Modify: `tests/unit/schemas.test.ts`
- Modify: `tests/unit/taskInterpreter.test.ts`
- Modify: `tests/renderer/PlanningView.test.tsx`

**Interfaces:**
- Produces `ProposedTask.fixedStartTime?: string`, validated as `/^([01]\\d|2[0-3]):[0-5]\\d$/`.
- The forced `replace_tasks` tool accepts the same optional `fixedStartTime` string.
- `TaskEditor` emits `fixedStartTime: undefined` for an empty `Fixed start` time control and preserves a valid `HH:mm` value otherwise.

- [ ] **Step 1: Write failing schema, prompt, and editor tests**

Add a schema assertion that accepts `fixedStartTime: '11:00'` and rejects `'25:00'`. Add a DeepSeek request assertion that its system prompt includes the phrases `fixed start` and `deadline`. Add a planning-view test that changes the labelled `Fixed start` input to `11:00`, saves, and expects:

```ts
expect(bridge.updateTask).toHaveBeenCalledWith({
  ...estimatedTask,
  fixedStartTime: '11:00',
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npm.cmd test -- tests/unit/schemas.test.ts tests/unit/taskInterpreter.test.ts tests/renderer/PlanningView.test.tsx
```

Expected: the fixed-start assertion fails because the property is rejected or the editor control is absent.

- [ ] **Step 3: Implement the shared task field and extraction rule**

In `src/shared/schemas.ts`, define and use:

```ts
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
// proposedTaskSchema field:
fixedStartTime: localTime.optional(),
```

In `src/main/deepseek/prompt.ts`, add a rule that an explicit task-start phrase becomes `fixedStartTime` and must not become `deadline`; add the optional tool property.

In `TaskEditor`, add `fixedStartTime` to `TaskFormState`, initialise it from the task, render `<input type="time">` with label `Fixed start`, and include `fixedStartTime: form.fixedStartTime || undefined` in `submittedTask`.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```powershell
git add src/shared/schemas.ts src/main/deepseek/prompt.ts src/renderer/components/TaskEditor.tsx tests/unit/schemas.test.ts tests/unit/taskInterpreter.test.ts tests/renderer/PlanningView.test.tsx
git commit -m "feat: capture fixed task start times"
```

### Task 2: Schedule Exact Starts and Task Buffers

**Files:**
- Modify: `src/main/scheduler/scheduleTasks.ts`
- Modify: `src/shared/schemas.ts`
- Modify: `src/renderer/components/UnscheduledTasks.tsx`
- Modify: `tests/unit/scheduleTasks.test.ts`
- Modify: `tests/unit/schemas.test.ts`

**Interfaces:**
- Produces `UnscheduledTask.reason` including `'fixed-time-conflict'`.
- `scheduleTasks` emits a fixed task block exactly at `targetDate + fixedStartTime`.
- Consecutive assistant task blocks are separated by a 15-minute `Break` block.

- [ ] **Step 1: Write failing scheduler regressions**

Add three focused tests:

```ts
it('keeps a fixed 11:00 task at 11:00 and reserves the preceding buffer', () => {
  const result = scheduleTasks({
    targetDate,
    settings,
    busyPeriods: [],
    tasks: [
      task({ id: 'flexible', durationMinutes: 60 }),
      task({ id: 'rvi', durationMinutes: 30, fixedStartTime: '11:00' }),
    ],
  });
  expect(result.blocks.filter((block) => block.kind === 'task').map(taskTiming)).toContainEqual({
    taskId: 'rvi', start: '2026-08-03T11:00:00.000+01:00', end: '2026-08-03T11:30:00.000+01:00',
  });
  expect(result.blocks).toContainEqual(expect.objectContaining({ kind: 'break', start: '2026-08-03T10:45:00.000+01:00', end: '2026-08-03T11:00:00.000+01:00' }));
});

it('uses a fifteen-minute break between short tasks', () => {
  // Two 30-minute tasks produce task 09:00–09:30, break 09:30–09:45, task 09:45–10:15.
});

it('does not move a fixed task that overlaps busy time', () => {
  // 11:00–11:30 busy and 11:00 fixed task produce fixed-time-conflict and no task block.
});
```

- [ ] **Step 2: Run the scheduler test file and verify RED**

Run:

```powershell
npm.cmd test -- tests/unit/scheduleTasks.test.ts
```

Expected: fixed-start fields are unsupported and the old ten-minute/long-task-only break behaviour fails the new assertions.

- [ ] **Step 3: Implement exact fixed-time allocation and a 15-minute buffer**

In `scheduleTasks.ts`, introduce `TASK_BUFFER_MINUTES = 15`. Convert a task’s `fixedStartTime` into a London `DateTime` using `targetDate`. Allocate valid fixed tasks first, rejecting a fixed task that cannot fit fully within the working window or overlaps a busy/previously-reserved interval. Reserve 15 minutes before and after an exact task when the adjacent time is in the working window, and emit the corresponding break block.

For flexible tasks, replace the long-task-only break calculation with the 15-minute task buffer. Candidate capacity includes the task duration plus the following buffer; append a `Break` block after each allocated task and consume it from free time. Preserve session indexing and deterministic task ordering.

In `schemas.ts`, add `'fixed-time-conflict'` to `unscheduledTaskSchema`. In `UnscheduledTasks.tsx`, map it to `The fixed start conflicts with your calendar or working hours.`

- [ ] **Step 4: Run the scheduler tests and verify GREEN**

Run the Step 2 command. Expected: PASS, including existing deadline, split-session, conflict, and working-hour tests.

- [ ] **Step 5: Commit Task 2**

```powershell
git add src/main/scheduler/scheduleTasks.ts src/shared/schemas.ts src/renderer/components/UnscheduledTasks.tsx tests/unit/scheduleTasks.test.ts tests/unit/schemas.test.ts
git commit -m "feat: schedule fixed tasks with breaks"
```

### Task 3: Verify the Full App and Package a Local Installer

**Files:**
- Modify only if verification exposes a defect in Task 1 or Task 2.

**Interfaces:**
- Consumes all earlier task changes through TypeScript, renderer, scheduler, integration, E2E, packaging, and fuse checks.
- Produces a verified local installer under `out/make/squirrel.windows/x64/PersonalAssistantSetup.exe`.

- [ ] **Step 1: Run the complete static and test suite**

```powershell
npm.cmd run check
```

Expected: typecheck succeeds and all Vitest files pass.

- [ ] **Step 2: Run packaged Electron end-to-end tests**

```powershell
npm.cmd run verify:e2e
```

Expected: both Playwright Electron workflows pass.

- [ ] **Step 3: Build and verify the production installer**

```powershell
npm.cmd run make
npm.cmd run assert:production-package
npm.cmd run verify:fuses
```

Expected: a Squirrel x64 installer exists and ASAR/fuse assertions pass.

## Plan Self-Review

- **Spec coverage:** Task 1 implements the validated time-only contract, model guidance, and editor. Task 2 implements immutable fixed starts, buffers, visible conflicts, and scheduler tests. Task 3 covers application and packaging verification.
- **Placeholder scan:** No implementation placeholder is used. Verification corrections, if needed, are handled as a new focused task rather than pre-authorised as an unspecified change.
- **Type consistency:** `fixedStartTime`, `fixed-time-conflict`, `TASK_BUFFER_MINUTES`, and `Break` are named consistently across the plan.
