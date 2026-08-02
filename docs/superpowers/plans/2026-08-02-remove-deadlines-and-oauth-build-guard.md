# Remove Deadlines and OAuth Build Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove deadline planning and prevent production installers from being built without a Google OAuth client ID.

**Architecture:** Delete deadline data at the shared schema boundary so it cannot re-enter through DeepSeek, IPC, or the editor. Simplify the scheduler to fixed starts plus priority-based flexible allocation. Add a narrowly scoped Node preflight script to production packaging commands; it checks only whether the OAuth client ID is present.

**Tech Stack:** TypeScript, Zod, Luxon, React, Vitest, Node.js, Electron Forge.

## Global Constraints

- `fixedStartTime` remains the only explicit timing constraint and uses `Europe/London` on the selected schedule date.
- No deadline property, deadline UI, deadline unscheduled reason, or deadline prompt/tool field remains.
- OAuth IDs and secrets are build-time configuration; do not print, store, or commit them.
- E2E packaging remains exempt from the production OAuth preflight.

---

### Task 1: Remove Deadline Data and Editor Behaviour

**Files:**
- Modify: `src/shared/schemas.ts`
- Modify: `src/main/deepseek/prompt.ts`
- Modify: `src/renderer/components/TaskEditor.tsx`
- Modify: `src/renderer/components/ChatPanel.tsx`
- Modify: `tests/unit/schemas.test.ts`
- Modify: `tests/unit/taskInterpreter.test.ts`
- Modify: `tests/renderer/PlanningView.test.tsx`
- Modify: `tests/renderer/ScheduleReview.test.tsx`
- Modify: `tests/renderer/ApprovalResultView.test.tsx`

**Interfaces:**
- `ProposedTask` has no `deadline` key.
- `replace_tasks` exposes no `deadline` property.
- `TaskEditor` renders no `Deadline` field and submits title, notes, duration, priority, fixed start, splitting, and minimum session only.

- [ ] **Step 1: Write failing boundary and UI tests**

Change the schema test to assert a task with `deadline` is rejected. Change the DeepSeek request test to assert its prompt and tool properties do not contain `deadline`. Replace deadline editor tests with:

```ts
expect(screen.queryByLabelText(/^deadline$/i)).not.toBeInTheDocument();
expect(bridge.updateTask).toHaveBeenCalledWith(expect.not.objectContaining({ deadline: expect.anything() }));
```

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
npm.cmd test -- tests/unit/schemas.test.ts tests/unit/taskInterpreter.test.ts tests/renderer/PlanningView.test.tsx
```

Expected: deadline remains accepted or rendered.

- [ ] **Step 3: Remove deadline implementation**

Delete the deadline schema field/tool property/prompt guidance. Remove deadline conversion, DST choices, form state, validation, and CSS-only deadline controls from `TaskEditor`. Change ChatPanel help text to mention fixed starts rather than deadlines. Remove deadline keys from renderer fixtures.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```powershell
git add src/shared/schemas.ts src/main/deepseek/prompt.ts src/renderer/components/TaskEditor.tsx src/renderer/components/ChatPanel.tsx tests/unit/schemas.test.ts tests/unit/taskInterpreter.test.ts tests/renderer/PlanningView.test.tsx tests/renderer/ScheduleReview.test.tsx tests/renderer/ApprovalResultView.test.tsx
git commit -m "feat: remove task deadlines"
```

### Task 2: Simplify Scheduler and Unscheduled Reasons

**Files:**
- Modify: `src/main/scheduler/scheduleTasks.ts`
- Modify: `src/renderer/components/UnscheduledTasks.tsx`
- Modify: `tests/unit/scheduleTasks.test.ts`

**Interfaces:**
- Flexible-task ordering is priority descending, unsplittable before splittable, longer duration first, then original input order.
- `UnscheduledTask.reason` no longer includes `'deadline-impossible'`.

- [ ] **Step 1: Write failing scheduling regressions**

Replace deadline ordering cases with tests asserting priority order and preserve the 11:00 fixed-start/15-minute-break tests. Delete deadline-impossible expectations. Add a no-free-time test using a fully busy working window:

```ts
expect(result.unscheduledTasks).toEqual([{
  taskId: 'blocked', remainingMinutes: 30, reason: 'no-free-time',
}]);
```

- [ ] **Step 2: Run scheduler tests and verify RED**

```powershell
npm.cmd test -- tests/unit/scheduleTasks.test.ts
```

Expected: the scheduler still references deadline ordering/constraints.

- [ ] **Step 3: Remove deadline scheduler code**

Delete deadline comparisons, `unscheduledReason`, deadline clipping, and deadline-specific messages. Use the working-window end for all flexible task capacity calculations. Keep fixed-time conflict behaviour, buffers, split-session indexes, and deterministic ordering.

- [ ] **Step 4: Run scheduler tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```powershell
git add src/main/scheduler/scheduleTasks.ts src/renderer/components/UnscheduledTasks.tsx tests/unit/scheduleTasks.test.ts
git commit -m "feat: schedule without deadlines"
```

### Task 3: Guard Production OAuth Packaging

**Files:**
- Create: `scripts/assert-google-oauth-build-config.mjs`
- Modify: `package.json`
- Create: `tests/unit/oauthBuildConfig.test.ts`

**Interfaces:**
- `assertGoogleOAuthBuildConfig(environment: NodeJS.ProcessEnv): void` throws a safe error when `GOOGLE_OAUTH_CLIENT_ID` is absent or blank.
- Production `package` and `make` execute the preflight before Electron Forge; `package:e2e` does not.

- [ ] **Step 1: Write failing preflight tests**

```ts
expect(() => assertGoogleOAuthBuildConfig({ GOOGLE_OAUTH_CLIENT_ID: '   ' }))
  .toThrow('GOOGLE_OAUTH_CLIENT_ID is required for a production build.');
expect(() => assertGoogleOAuthBuildConfig({ GOOGLE_OAUTH_CLIENT_ID: 'desktop-client-id' }))
  .not.toThrow();
```

Also assert an error from a supplied value such as `private-client-id` does not contain that value.

- [ ] **Step 2: Run the preflight test and verify RED**

```powershell
npm.cmd test -- tests/unit/oauthBuildConfig.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement and wire the guard**

Export the preflight function from the script and invoke it only when the script is executed directly. Update `package` and `make` scripts to begin with `node scripts/assert-google-oauth-build-config.mjs &&`; leave `package:e2e` unchanged.

- [ ] **Step 4: Run focused tests and production preflight**

```powershell
npm.cmd test -- tests/unit/oauthBuildConfig.test.ts
node scripts/assert-google-oauth-build-config.mjs
```

Expected: unit test passes; direct command fails safely when no ID is present.

- [ ] **Step 5: Commit Task 3**

```powershell
git add scripts/assert-google-oauth-build-config.mjs package.json tests/unit/oauthBuildConfig.test.ts
git commit -m "fix: require OAuth configuration for production builds"
```

### Task 4: Verify and Reinstall a Credentialed Local Build

**Files:**
- Modify only if fresh verification reveals a specific defect.

- [ ] **Step 1: Run full static and test checks**

```powershell
npm.cmd run check
```

- [ ] **Step 2: Load the downloaded Desktop OAuth configuration only into the build process**

```powershell
$oauthCredential = Get-Content -Raw 'C:\Users\arms0\Downloads\client_secret_123931958886-134tm3o3i6a7h4905mp39mao01v319uf.apps.googleusercontent.com.json' | ConvertFrom-Json
$env:GOOGLE_OAUTH_CLIENT_ID = $oauthCredential.installed.client_id
$env:GOOGLE_OAUTH_CLIENT_SECRET = $oauthCredential.installed.client_secret
npm.cmd run release:verify
```

- [ ] **Step 3: Install and launch the verified installer**

```powershell
Start-Process -FilePath 'out\make\squirrel.windows\x64\PersonalAssistantSetup.exe' -ArgumentList '--silent' -Wait
Start-Process -FilePath 'C:\Users\arms0\AppData\Local\personal_assistant\app-0.1.0\personal-assistant.exe'
```

## Plan Self-Review

- **Spec coverage:** Task 1 removes deadline data and UI; Task 2 removes deadline scheduling/reasons; Task 3 prevents missing OAuth configuration; Task 4 verifies and restores the local application.
- **Completeness scan:** Every code and verification step names exact files and commands.
- **Type consistency:** `GOOGLE_OAUTH_CLIENT_ID`, `fixedStartTime`, and the preflight function names match the specified interfaces.
