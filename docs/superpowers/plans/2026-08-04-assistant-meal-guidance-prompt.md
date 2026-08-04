# Personal Assistant Meal Guidance Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach DeepSeek to behave as a practical personal assistant and leave meal periods blank without inventing meal tasks or events.

**Architecture:** Change only the existing task-extraction system prompt and its request-level regression test. The scheduler and task schema remain unchanged, making the feature guidance rather than a hard scheduling constraint.

**Tech Stack:** TypeScript, DeepSeek chat-completions tool call, Vitest.

## Global Constraints

- Treat this as prompt-only guidance; do not change the deterministic scheduler.
- Use Europe/London meal windows: breakfast 08:00–09:00, lunch 12:00–13:00, dinner 18:00–19:00.
- Never create meal tasks, notes, or Google Calendar events unless the user explicitly requests a meal.
- Preserve fixed-start handling, editable task extraction, and the existing 15-minute task gaps.

---

### Task 1: Add and verify the real-assistant meal guidance

**Files:**
- Modify: `src/main/deepseek/prompt.ts`
- Modify: `tests/unit/taskInterpreter.test.ts`

**Interfaces:**
- Consumes `TASK_EXTRACTION_SYSTEM_PROMPT` and `replaceTasksTool`.
- Produces an unchanged task-list tool contract with stronger system instructions.

- [ ] **Step 1: Write the failing request test**

```ts
expect(body.messages[0].content).toContain('practical personal assistant');
expect(body.messages[0].content).toContain('Breakfast: 08:00–09:00');
expect(body.messages[0].content).toContain('Lunch: 12:00–13:00');
expect(body.messages[0].content).toContain('Dinner: 18:00–19:00');
expect(body.messages[0].content).toContain('Do not create meal tasks or events');
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm.cmd test -- tests/unit/taskInterpreter.test.ts`

Expected: FAIL because the prompt does not yet contain the real-assistant or meal guidance.

- [ ] **Step 3: Add the minimal explicit system prompt guidance**

```ts
- Act as a practical personal assistant: organise the user's stated tasks sensibly around fixed commitments and leave sensible personal time.
- When proposing timing guidance, avoid these Europe/London meal periods: Breakfast: 08:00–09:00; Lunch: 12:00–13:00; Dinner: 18:00–19:00.
- Do not create meal tasks, notes, or events unless the user explicitly asks to plan a meal; leave those periods blank.
```

- [ ] **Step 4: Run focused and complete checks**

Run: `npm.cmd test -- tests/unit/taskInterpreter.test.ts` then `npm.cmd run check`

Expected: both commands pass.

- [ ] **Step 5: Commit**

```powershell
git add -- src/main/deepseek/prompt.ts tests/unit/taskInterpreter.test.ts
git commit -m "feat: guide DeepSeek around meal times"
```
