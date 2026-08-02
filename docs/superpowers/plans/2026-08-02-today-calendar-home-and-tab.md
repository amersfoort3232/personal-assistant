# Today Calendar Home and Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display today's Google Calendar events on the Home screen and in a read-only Calendar tab, with clear return-to-planning actions.

**Architecture:** Add a narrow `CalendarEvent` shared contract and a no-payload IPC method that asks the orchestrator for today's primary and Personal Assistant events. The Google service validates and filters API data before it reaches React; renderer components share the display data while the App controls Home/Calendar navigation, loading, refresh, and reconnection states.

**Tech Stack:** Electron Forge, React 19, TypeScript, Zod 4, Luxon, Vitest, Google Calendar REST API.

## Global Constraints

- Show only the current Europe/London calendar day; do not add a date picker, week/month view, event editing, or calendar selection.
- Query only the primary and configured Personal Assistant calendars.
- Return only title, start, end, all-day state, and source calendar identifier to the renderer; never return tokens, descriptions, attendees, locations, or links.
- The Calendar view is read-only; schedule approval remains the only event-creation path.
- Preserve existing availability queries and Personal Assistant event creation.
- Add `https://www.googleapis.com/auth/calendar.events.readonly`; existing users reconnect Google once to grant it.

---

### Task 1: Define calendar display data and secure IPC boundary

**Files:**
- Modify: `src/shared/schemas.ts`
- Modify: `src/shared/domain.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/ipc/registerIpcHandlers.ts`
- Modify: `src/renderer/bridge.ts`
- Modify: `src/main/testing/fakeServiceFactory.ts`
- Test: `tests/unit/schemas.test.ts`
- Test: `tests/unit/ipcSecurity.test.ts`
- Test: `tests/integration/ipcHandlers.test.ts`

**Interfaces:**
- Produces `CalendarEvent = { id: string; title: string; start: string; end: string; allDay: boolean; sourceCalendarId: string }`.
- Produces `IPC.GET_TODAY_CALENDAR = 'assistant:get-today-calendar'` with `ipcRequestSchemas.getTodayCalendar: z.undefined()`.
- Extends the bridge and orchestrator port with `getTodayCalendar(): Promise<CalendarEvent[]>`.
- Extends the fake calendar port with `getTodayCalendar(settings: AppSettings): Promise<CalendarEvent[]>`.

- [ ] **Step 1: Write failing contract tests**

```ts
expect(calendarEventSchema.safeParse({
  id: 'primary-event', title: 'Hospital',
  start: '2026-08-02T11:00:00+01:00', end: '2026-08-02T12:00:00+01:00',
  allDay: false, sourceCalendarId: 'primary',
}).success).toBe(true);
expect(calendarEventSchema.safeParse({ ...validEvent, description: 'private' }).success).toBe(false);
```

Add IPC tests that require the new channel to use `getTodayCalendar`, reject a payload, and confirm the preload bridge invokes the new channel without a payload.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npm.cmd test -- tests/unit/schemas.test.ts tests/unit/ipcSecurity.test.ts tests/integration/ipcHandlers.test.ts`

Expected: FAIL because `CalendarEvent`, `GET_TODAY_CALENDAR`, and `getTodayCalendar` do not exist.

- [ ] **Step 3: Implement the contract and IPC handler**

```ts
export const calendarEventSchema = z.object({
  id: z.string().min(1), title: z.string().trim().min(1).max(160),
  start: rfc3339WithOffset, end: rfc3339WithOffset,
  allDay: z.boolean(), sourceCalendarId: z.string().min(1),
}).strict();

[IPC.GET_TODAY_CALENDAR]: {
  schema: ipcRequestSchemas.getTodayCalendar,
  invoke: (orchestrator) => orchestrator.getTodayCalendar(),
}
```

Update all typed ports, bridge mappings, handler registration, and the fake service with deterministic safe events.

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `npm.cmd test -- tests/unit/schemas.test.ts tests/unit/ipcSecurity.test.ts tests/integration/ipcHandlers.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- src/shared/schemas.ts src/shared/domain.ts src/shared/ipc.ts src/main/ipc/registerIpcHandlers.ts src/renderer/bridge.ts src/main/testing/fakeServiceFactory.ts tests/unit/schemas.test.ts tests/unit/ipcSecurity.test.ts tests/integration/ipcHandlers.test.ts
git commit -m "feat: add calendar display IPC"
```

### Task 2: Read and validate today's Google Calendar events

**Files:**
- Modify: `src/main/google/googleAuthService.ts`
- Modify: `src/main/google/googleCalendarService.ts`
- Modify: `src/main/orchestrator/assistantOrchestrator.ts`
- Test: `tests/integration/googleCalendarService.test.ts`
- Test: `tests/unit/googleAuthService.test.ts` (create)
- Test: `tests/unit/assistantOrchestrator.test.ts` (create)

**Interfaces:**
- Consumes `CalendarEvent` from Task 1.
- Produces `GoogleCalendarService.getTodayCalendar(settings: AppSettings): Promise<CalendarEvent[]>`.
- Produces `AssistantOrchestrator.getTodayCalendar(): Promise<CalendarEvent[]>`.

- [ ] **Step 1: Write failing Google and orchestrator tests**

```ts
expect(await service.getTodayCalendar(settings)).toEqual([
  { id: 'primary-1', title: 'RVI hospital',
    start: '2026-08-02T11:00:00+01:00', end: '2026-08-02T12:00:00+01:00',
    allDay: false, sourceCalendarId: 'primary' },
]);
expect(authorizationUrl.searchParams.get('scope')).toContain(
  'https://www.googleapis.com/auth/calendar.events.readonly',
);
```

Cover all-day Google `date` values, invalid/missing event fields, a failed response, and filtering events outside today's London day. Verify the orchestrator loads settings and delegates to the calendar port.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npm.cmd test -- tests/integration/googleCalendarService.test.ts tests/unit/googleAuthService.test.ts tests/unit/assistantOrchestrator.test.ts`

Expected: FAIL because the OAuth scope and calendar-read method are absent.

- [ ] **Step 3: Implement safe event retrieval**

Add the read-only scope to `SCOPES`. In the calendar service calculate London's start/end of today, request `GET /calendars/{id}/events` for `primary` and `settings.personalAssistantCalendarId` with `timeMin`, `timeMax`, `singleEvents=true`, and `orderBy=startTime`.

Validate timed `dateTime` events and all-day `date` events with dedicated Zod schemas. Map each to the Task 1 contract, use a safe fallback title of `Untitled event` only when Google omits a summary, sort by start then title, and reject malformed provider data as `CALENDAR_UNAVAILABLE`. The orchestrator must reject requests when Google is disconnected or the Personal Assistant calendar is unavailable using existing safe error behavior.

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `npm.cmd test -- tests/integration/googleCalendarService.test.ts tests/unit/googleAuthService.test.ts tests/unit/assistantOrchestrator.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- src/main/google/googleAuthService.ts src/main/google/googleCalendarService.ts src/main/orchestrator/assistantOrchestrator.ts tests/integration/googleCalendarService.test.ts tests/unit/googleAuthService.test.ts tests/unit/assistantOrchestrator.test.ts
git commit -m "feat: read todays Google Calendar events"
```

### Task 3: Render Home summary and Calendar tab navigation

**Files:**
- Create: `src/renderer/components/TodayCalendarSummary.tsx`
- Create: `src/renderer/components/CalendarTimeline.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Test: `tests/renderer/PlanningView.test.tsx`
- Test: `tests/renderer/CalendarView.test.tsx`

**Interfaces:**
- Consumes `CalendarEvent[]` from `AssistantBridge.getTodayCalendar()`.
- `TodayCalendarSummary` accepts `{ events, loading, error, onViewCalendar, onRefresh, onReconnect }`.
- `CalendarTimeline` accepts `{ events, loading, error, onBackHome, onPlanAnotherEvent, onRefresh, onReconnect }`.
- Produces a Home/Calendar screen state in `App`.

- [ ] **Step 1: Write failing renderer tests**

```tsx
expect(await screen.findByRole('heading', { name: /today's calendar/i })).toBeInTheDocument();
await user.click(screen.getByRole('button', { name: /view calendar/i }));
expect(screen.getByRole('heading', { name: /^calendar$/i })).toBeInTheDocument();
await user.click(screen.getByRole('button', { name: /plan another event/i }));
expect(screen.getByRole('heading', { name: /home/i })).toBeInTheDocument();
```

Cover a timed event, all-day event, empty day, loading state, Refresh calling the bridge again, retryable error, disconnected/reconnect state, Back to Home, and Plan another event. Ensure no event descriptions or locations appear.

- [ ] **Step 2: Run renderer tests to verify they fail**

Run: `npm.cmd test -- tests/renderer/PlanningView.test.tsx tests/renderer/CalendarView.test.tsx`

Expected: FAIL because the summary, tab, and calendar bridge method do not exist.

- [ ] **Step 3: Implement Home and Calendar presentation**

Create focused read-only components that format `CalendarEvent` values in Europe/London. Make Home the default screen and relabel its heading to `Home`; retain the existing task-planning controls. Add a compact summary beneath the Home controls with View calendar and Refresh actions.

In `App`, fetch today once after setup is complete, share state across Home and Calendar, and refetch on Refresh. The Calendar tab renders a chronological full-day timeline and exposes **Back to Home** and **Plan another event** buttons; both return to Home without clearing conversation or tasks. Render a reconnect button only for `GOOGLE_NOT_CONNECTED` / `GOOGLE_AUTH_FAILED`; it calls the existing `connectGoogle` bridge action and then refetches.

Add responsive CSS so Home retains a usable planning layout and the Calendar timeline remains readable on a narrow window.

- [ ] **Step 4: Run renderer tests to verify they pass**

Run: `npm.cmd test -- tests/renderer/PlanningView.test.tsx tests/renderer/CalendarView.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- src/renderer/App.tsx src/renderer/components/TodayCalendarSummary.tsx src/renderer/components/CalendarTimeline.tsx src/renderer/styles.css tests/renderer/PlanningView.test.tsx tests/renderer/CalendarView.test.tsx
git commit -m "feat: show todays calendar in the app"
```

### Task 4: Verify the complete flow and package locally

**Files:**
- Modify only if verification exposes a real defect.
- Test: `tests/e2e/planning.spec.ts` (extend only if the existing fake Electron environment can cover the new navigation reliably)

**Interfaces:**
- Consumes the completed Home summary, Calendar tab, bridge, and Google service.
- Produces a production installer that contains no credential values and opens without the missing-OAuth configuration dialog.

- [ ] **Step 1: Add any missing end-to-end assertion**

Extend the existing fake-service planning flow to open Calendar and return with Plan another event only if the test environment can launch Electron reliably; otherwise leave the already-comprehensive unit and renderer coverage as the regression suite.

- [ ] **Step 2: Run the full static and test suite**

Run: `npm.cmd run check`

Expected: PASS with all TypeScript checks and Vitest tests green.

- [ ] **Step 3: Build an OAuth-configured production installer**

Run the existing local credential-loading PowerShell build command, then run:

```powershell
node scripts/assert-production-package.mjs
node scripts/verify-production-fuses.mjs
```

Expected: the OAuth preflight, package assertion, and production fuse verification all pass without printing OAuth values.

- [ ] **Step 4: Install and manually verify**

Install `out/make/squirrel.windows/x64/PersonalAssistantSetup.exe`, launch Personal Assistant, reconnect Google once, and verify today's summary, Calendar tab, Refresh, Back to Home, and Plan another event.

- [ ] **Step 5: Commit verification-only fixes if required**

If verification finds and corrects a defect, stage exactly the modified source
and test files, then commit them with `fix: complete calendar view verification`.
Otherwise, do not create a verification-only commit.
