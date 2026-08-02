# Safe Error Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a privacy-bounded rolling JSON-lines error log at `C:\Users\arms0\Documents\personal-assistant\personal-assistant.log` with operation context from IPC, renderer, startup, and Electron runtime failures.

**Architecture:** A main-process `ErrorLogger` converts only approved error fields into bounded JSON entries and sends them to a narrowly configured `electron-log` file transport. IPC, preload, and Electron lifecycle adapters provide fixed operation names without passing user payloads, credentials, HTTP bodies, or arbitrary objects.

**Tech Stack:** Electron 43, TypeScript 7, Vitest 4, Zod 4, `electron-log` 5.4.4, Electron Forge/Vite.

## Global Constraints

- Resolve the Windows Documents directory with `app.getPath('documents')`; never hard-code the username `arms0` in production code.
- Current log filename: `personal-assistant.log`; single backup filename: `personal-assistant.previous.log`.
- Current file maximum: exactly `5 * 1024 * 1024` bytes.
- Write UTF-8 JSON Lines with only `timestamp`, `level`, `process`, `operation`, optional `code`, optional `retryable`, `message`, and optional `stack`.
- Limit messages to 1,000 characters and stacks to 8,000 characters.
- Never log prompts, IPC payloads, task text, API keys, OAuth tokens, authorization headers, calendar content, HTTP request/response bodies, arbitrary error causes, command lines, or environment variables.
- Pin `electron-log` to exact version `5.4.4`; disable its console and remote transports and do not enable console overriding, renderer imports, or unrestricted automatic capture.
- Logging is fail-open: no transport or serialization failure may replace or interrupt the original application result.
- Preserve the existing unstaged DeepSeek V4 fix in `src/main/deepseek/deepSeekClient.ts` and `tests/unit/taskInterpreter.test.ts`; commit it separately before logging work.
- Do not push to GitHub during this plan. The user requested local completion first.

---

### Task 0: Preserve the verified DeepSeek fix

**Files:**
- Modify: `src/main/deepseek/deepSeekClient.ts`
- Modify: `tests/unit/taskInterpreter.test.ts`

**Interfaces:**
- Consumes: the already-implemented `DeepSeekClient.createTaskToolCall(...)` request boundary.
- Produces: a clean logging-feature baseline in which V4 requests set `thinking: { type: 'disabled' }` and structured HTTP error messages remain bounded.

- [ ] **Step 1: Verify the focused DeepSeek regression tests**

Run:

```powershell
npm.cmd test -- tests/unit/taskInterpreter.test.ts
```

Expected: PASS with 13 tests, including `disables thinking mode when forcing the task extraction tool` and `reports a bounded structured API error without exposing the full response`.

- [ ] **Step 2: Verify the existing diff contains only the approved DeepSeek changes**

Run:

```powershell
git diff -- src/main/deepseek/deepSeekClient.ts tests/unit/taskInterpreter.test.ts
git diff --check -- src/main/deepseek/deepSeekClient.ts tests/unit/taskInterpreter.test.ts
```

Expected: the production diff adds explicit disabled thinking plus bounded `error.message` extraction; the test diff covers both. No credentials or arbitrary response fields appear.

- [ ] **Step 3: Commit the verified fix separately**

```powershell
git add -- src/main/deepseek/deepSeekClient.ts tests/unit/taskInterpreter.test.ts
git commit -m "fix: support DeepSeek V4 task extraction"
```

Expected: one commit containing only those two files.

---

### Task 1: Build the privacy-bounded error logger core

**Files:**
- Create: `src/main/diagnostics/errorLogger.ts`
- Create: `tests/unit/errorLogger.test.ts`

**Interfaces:**
- Consumes: `AppError` from `src/shared/errors.ts`.
- Produces: `ErrorTransport.write(line: string): void`, `ErrorProcess`, `ErrorLoggerPort`, and `ErrorLogger.logError(process, operation, error): void`.

- [ ] **Step 1: Write failing tests for safe JSON entries and fail-open behavior**

Create `tests/unit/errorLogger.test.ts` with literal expectations:

```ts
import { describe, expect, it } from 'vitest';
import { ErrorLogger } from '../../src/main/diagnostics/errorLogger';
import { AppError } from '../../src/shared/errors';

class RecordingTransport {
  readonly lines: string[] = [];
  write(line: string): void { this.lines.push(line); }
}

describe('ErrorLogger', () => {
  it('writes only approved AppError fields as one JSON line', () => {
    const transport = new RecordingTransport();
    const logger = new ErrorLogger(transport, () => new Date('2026-08-02T19:00:00.000Z'));

    logger.logError(
      'main',
      'ipc:assistant:send-message',
      new AppError('DEEPSEEK_UNAVAILABLE', 'DeepSeek rejected the request.', false),
    );

    expect(transport.lines).toEqual([JSON.stringify({
      timestamp: '2026-08-02T19:00:00.000Z',
      level: 'error',
      process: 'main',
      operation: 'ipc:assistant:send-message',
      code: 'DEEPSEEK_UNAVAILABLE',
      retryable: false,
      message: 'DeepSeek rejected the request.',
    })]);
  });

  it('bounds unexpected errors and ignores arbitrary private properties', () => {
    const transport = new RecordingTransport();
    const logger = new ErrorLogger(transport, () => new Date('2026-08-02T19:00:00.000Z'));
    const error = new Error(`provider failure ${'m'.repeat(1200)}`) as Error & { apiKey?: string };
    error.stack = `Error: provider failure\n${'s'.repeat(9000)}`;
    error.apiKey = 'deepseek-secret-must-not-appear';

    logger.logError('main', 'application-startup', error);

    const line = transport.lines[0];
    const entry = JSON.parse(line);
    expect(entry.message.length).toBe(1000);
    expect(entry.stack.length).toBe(8000);
    expect(line).not.toContain('deepseek-secret-must-not-appear');
    expect(Object.keys(entry).sort()).toEqual([
      'level', 'message', 'operation', 'process', 'stack', 'timestamp',
    ]);
  });

  it('does not serialize non-Error rejection values', () => {
    const transport = new RecordingTransport();
    const logger = new ErrorLogger(transport, () => new Date('2026-08-02T19:00:00.000Z'));

    logger.logError('main', 'process:unhandled-rejection', { token: 'private-token' });

    expect(transport.lines[0]).toContain('Unknown non-Error failure.');
    expect(transport.lines[0]).not.toContain('private-token');
  });

  it('never throws when the transport fails', () => {
    const logger = new ErrorLogger({
      write() { throw new Error('disk unavailable'); },
    });

    expect(() => logger.logError('main', 'ipc:test', new Error('original failure'))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm.cmd test -- tests/unit/errorLogger.test.ts
```

Expected: FAIL because `src/main/diagnostics/errorLogger.ts` does not exist.

- [ ] **Step 3: Implement the minimal logger core**

Create `src/main/diagnostics/errorLogger.ts`:

```ts
import { AppError } from '../../shared/errors';

export type ErrorProcess = 'main' | 'renderer';

export type ErrorTransport = {
  write(line: string): void;
};

export type ErrorLoggerPort = {
  logError(process: ErrorProcess, operation: string, error: unknown): void;
};

const MESSAGE_LIMIT = 1_000;
const STACK_LIMIT = 8_000;
const OPERATION_LIMIT = 200;

function clean(value: string, limit: number, preserveLines = false): string {
  const controls = preserveLines
    ? /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g
    : /[\u0000-\u001f\u007f]/g;
  return value.replace(controls, ' ').trim().slice(0, limit);
}

export class ErrorLogger implements ErrorLoggerPort {
  constructor(
    private readonly transport: ErrorTransport,
    private readonly now: () => Date = () => new Date(),
  ) {}

  logError(process: ErrorProcess, operation: string, error: unknown): void {
    try {
      const base = {
        timestamp: this.now().toISOString(),
        level: 'error' as const,
        process,
        operation: clean(operation, OPERATION_LIMIT),
      };
      if (error instanceof AppError) {
        this.transport.write(JSON.stringify({
          ...base,
          code: error.code,
          retryable: error.retryable,
          message: clean(error.message, MESSAGE_LIMIT),
        }));
        return;
      }
      if (error instanceof Error) {
        this.transport.write(JSON.stringify({
          ...base,
          message: clean(error.message || error.name, MESSAGE_LIMIT),
          ...(error.stack ? { stack: clean(error.stack, STACK_LIMIT, true) } : {}),
        }));
        return;
      }
      this.transport.write(JSON.stringify({
        ...base,
        message: 'Unknown non-Error failure.',
      }));
    } catch {
      // Error logging must never replace the original application result.
    }
  }
}
```

- [ ] **Step 4: Run focused tests and typechecking**

Run:

```powershell
npm.cmd test -- tests/unit/errorLogger.test.ts
npm.cmd run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the logger core**

```powershell
git add -- src/main/diagnostics/errorLogger.ts tests/unit/errorLogger.test.ts
git commit -m "feat: add safe error log entries"
```

---

### Task 2: Configure the electron-log file transport and rotation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/main/diagnostics/electronLogTransport.ts`
- Create: `tests/unit/electronLogTransport.test.ts`
- Modify: `tests/unit/packagingDependencies.test.ts`

**Interfaces:**
- Consumes: `ErrorTransport` from Task 1.
- Produces: `ERROR_LOG_MAX_BYTES` and `createElectronLogTransport(documentsPath, maxSizeBytes?): ErrorTransport`.

- [ ] **Step 1: Write failing dependency-placement and real-transport tests**

Extend `tests/unit/packagingDependencies.test.ts` with literal assertions:

```ts
expect(packageJson.dependencies['electron-log']).toBe('5.4.4');
expect(packageJson.devDependencies['electron-log']).toBeUndefined();
```

Create `tests/unit/electronLogTransport.test.ts`:

```ts
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ERROR_LOG_MAX_BYTES,
  createElectronLogTransport,
} from '../../src/main/diagnostics/electronLogTransport';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('electron-log transport', () => {
  it('uses the approved production size and Documents-based filename', async () => {
    const documents = await mkdtemp(path.join(tmpdir(), 'pa-electron-log-'));
    directories.push(documents);
    const transport = createElectronLogTransport(documents);

    transport.write('{"event":"failure"}');

    const current = path.join(documents, 'personal-assistant', 'personal-assistant.log');
    expect(ERROR_LOG_MAX_BYTES).toBe(5 * 1024 * 1024);
    await expect(readFile(current, 'utf8')).resolves.toContain('{"event":"failure"}');
  });

  it('retains one exact previous file when the current file rotates', async () => {
    const documents = await mkdtemp(path.join(tmpdir(), 'pa-electron-log-'));
    directories.push(documents);
    const transport = createElectronLogTransport(documents, 180);

    for (let index = 0; index < 8; index += 1) {
      transport.write(JSON.stringify({ index, message: 'x'.repeat(80) }));
    }

    const directory = path.join(documents, 'personal-assistant');
    const files = (await readdir(directory)).sort();
    expect(files).toEqual(['personal-assistant.log', 'personal-assistant.previous.log']);
    await expect(readFile(path.join(directory, 'personal-assistant.previous.log'), 'utf8'))
      .resolves.toContain('"message"');
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npm.cmd test -- tests/unit/electronLogTransport.test.ts tests/unit/packagingDependencies.test.ts
```

Expected: FAIL because the transport module and exact production dependency are absent.

- [ ] **Step 3: Install the exact production dependency**

Run:

```powershell
npm.cmd install --save-exact electron-log@5.4.4
```

Expected: `package.json` contains `"electron-log": "5.4.4"` under `dependencies`, and `package-lock.json` records the exact package.

- [ ] **Step 4: Implement the configured transport**

Create `src/main/diagnostics/electronLogTransport.ts`:

```ts
import electronLog from 'electron-log/main';
import { renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { ErrorTransport } from './errorLogger';

export const ERROR_LOG_MAX_BYTES = 5 * 1024 * 1024;

let loggerSequence = 0;

export function createElectronLogTransport(
  documentsPath: string,
  maxSizeBytes = ERROR_LOG_MAX_BYTES,
): ErrorTransport {
  loggerSequence += 1;
  const logger = electronLog.create({ logId: `personal-assistant-errors-${loggerSequence}` });
  const directory = path.join(documentsPath, 'personal-assistant');
  const currentPath = path.join(directory, 'personal-assistant.log');
  const previousPath = path.join(directory, 'personal-assistant.previous.log');

  logger.transports.console.level = false;
  logger.transports.remote.level = false;
  logger.transports.file.level = 'error';
  logger.transports.file.format = '{text}';
  logger.transports.file.maxSize = maxSizeBytes;
  logger.transports.file.resolvePathFn = () => currentPath;
  logger.transports.file.archiveLogFn = (oldLogFile) => {
    try {
      rmSync(previousPath, { force: true });
      renameSync(oldLogFile.toString(), previousPath);
    } catch {
      // Rotation failure must not crash the application.
    }
  };

  return {
    write(line: string) {
      logger.error(line);
    },
  };
}
```

- [ ] **Step 5: Run focused tests, typechecking, and production dependency audit**

Run:

```powershell
npm.cmd test -- tests/unit/electronLogTransport.test.ts tests/unit/errorLogger.test.ts
npm.cmd run typecheck
npm.cmd audit --omit=dev
```

Expected: PASS; production audit reports zero known vulnerabilities. The pinned 5.4.4 logger exposes `console`, `remote`, and `file` transports with mutable `level` fields.

- [ ] **Step 6: Commit the transport and dependency**

```powershell
git add -- package.json package-lock.json src/main/diagnostics/electronLogTransport.ts tests/unit/electronLogTransport.test.ts tests/unit/packagingDependencies.test.ts
git commit -m "feat: add rolling electron error log"
```

---

### Task 3: Record failed IPC operations without payloads

**Files:**
- Modify: `src/main/ipc/registerIpcHandlers.ts`
- Modify: `tests/integration/ipcHandlers.test.ts`

**Interfaces:**
- Consumes: `ErrorLoggerPort.logError(process, operation, error)` from Task 1.
- Produces: `registerIpcHandlers(ipcMain, orchestrator, policy, errorLogger): void` with fixed `ipc:<channel>` operation names.

- [ ] **Step 1: Add a failing integration test with a recording logger**

Extend `tests/integration/ipcHandlers.test.ts` with:

```ts
import type { ErrorLoggerPort, ErrorProcess } from '../../src/main/diagnostics/errorLogger';

class RecordingErrorLogger implements ErrorLoggerPort {
  readonly entries: Array<{ process: ErrorProcess; operation: string; error: unknown }> = [];
  logError(process: ErrorProcess, operation: string, error: unknown): void {
    this.entries.push({ process, operation, error });
  }
}
```

Update the local `register()` helper to create and pass `errorLogger`, then return it. Add this test:

```ts
it('logs the failed channel and error without passing the IPC payload', async () => {
  const { ipcMain, orchestrator, event, errorLogger } = register();
  const providerError = new Error('provider failed');
  vi.mocked(orchestrator.sendMessage).mockRejectedValueOnce(providerError);

  await invoke(ipcMain, IPC.SEND_MESSAGE, event, { text: 'private planning request' });

  expect(errorLogger.entries).toEqual([{
    process: 'main',
    operation: `ipc:${IPC.SEND_MESSAGE}`,
    error: providerError,
  }]);
  expect(JSON.stringify(errorLogger.entries)).not.toContain('private planning request');
});
```

- [ ] **Step 2: Run the integration test and verify RED**

Run:

```powershell
npm.cmd test -- tests/integration/ipcHandlers.test.ts
```

Expected: FAIL because `registerIpcHandlers` does not accept or call an error logger.

- [ ] **Step 3: Inject the logger into the existing catch boundary**

Modify `src/main/ipc/registerIpcHandlers.ts`:

```ts
import type { ErrorLoggerPort } from '../diagnostics/errorLogger';
```

Add `errorLogger: ErrorLoggerPort` to `registerHandler(...)`, and change its catch block to:

```ts
    } catch (error) {
      errorLogger.logError('main', `ipc:${channel}`, error);
      return { ok: false, error: toIpcError(error) };
    }
```

Add the same port to `registerIpcHandlers(...)` and pass it to every `registerHandler(...)` call. Do not pass `args`, `parsed.data`, or the event to the logger.

- [ ] **Step 4: Run IPC and security tests**

Run:

```powershell
npm.cmd test -- tests/integration/ipcHandlers.test.ts tests/unit/ipcSecurity.test.ts
npm.cmd run typecheck
```

Expected: PASS. Existing safe IPC error envelopes remain unchanged.

- [ ] **Step 5: Commit IPC operation logging**

```powershell
git add -- src/main/ipc/registerIpcHandlers.ts tests/integration/ipcHandlers.test.ts
git commit -m "feat: log failed assistant operations"
```

---

### Task 4: Forward sanitized renderer failures through trusted IPC

**Files:**
- Create: `src/shared/diagnostics.ts`
- Modify: `src/shared/ipc.ts`
- Create: `src/preload/rendererErrorForwarding.ts`
- Modify: `src/preload.ts`
- Create: `src/main/diagnostics/registerRendererErrorHandler.ts`
- Create: `tests/unit/rendererErrorForwarding.test.ts`
- Create: `tests/integration/rendererErrorReporting.test.ts`

**Interfaces:**
- Consumes: `ErrorLoggerPort` and existing `isTrustedIpcEvent(...)` sender policy.
- Produces: `DIAGNOSTIC_IPC.REPORT_RENDERER_ERROR`, `RendererErrorReport`, `rendererErrorReportSchema`, `toRendererErrorReport(kind, reason)`, `registerRendererErrorForwarding(addListener, send)`, and `registerRendererErrorHandler(...)`.

- [ ] **Step 1: Write failing pure forwarding tests**

Create `tests/unit/rendererErrorForwarding.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { registerRendererErrorForwarding } from '../../src/preload/rendererErrorForwarding';

describe('renderer error forwarding', () => {
  it('forwards only bounded primitive Error fields', () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const reports: unknown[] = [];
    registerRendererErrorForwarding(
      (type, listener) => listeners.set(type, listener),
      (report) => reports.push(report),
    );
    const error = new Error(`renderer failed ${'m'.repeat(1200)}`) as Error & { token?: string };
    error.stack = `Error: renderer failed\n${'s'.repeat(9000)}`;
    error.token = 'renderer-private-token';

    listeners.get('error')?.({ error, message: 'fallback' });

    expect(reports).toHaveLength(1);
    expect(JSON.stringify(reports[0])).not.toContain('renderer-private-token');
    expect(reports[0]).toMatchObject({ kind: 'unhandled-error', name: 'Error' });
    expect((reports[0] as { message: string }).message.length).toBe(1000);
    expect((reports[0] as { stack: string }).stack.length).toBe(8000);
  });

  it('does not serialize non-Error rejection values', () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const reports: unknown[] = [];
    registerRendererErrorForwarding(
      (type, listener) => listeners.set(type, listener),
      (report) => reports.push(report),
    );

    listeners.get('unhandledrejection')?.({ reason: { apiKey: 'private-key' } });

    expect(reports).toEqual([{
      kind: 'unhandled-rejection',
      name: 'UnknownError',
      message: 'Unknown non-Error failure.',
    }]);
  });
});
```

- [ ] **Step 2: Write failing trusted-main-boundary tests**

Create `tests/integration/rendererErrorReporting.test.ts` with a fake `ipcMain.on` registry, the existing trusted frame shape, and a real `ErrorLogger` backed by an in-memory recording transport and fixed clock. After invoking the trusted listener, parse the recorded JSON line and cover this literal outcome:

```ts
expect(recorded).toEqual([{
  timestamp: '2026-08-02T19:00:00.000Z',
  level: 'error',
  process: 'renderer',
  operation: 'renderer:unhandled-error',
  message: 'Renderer failed.',
  stack: 'Error: Renderer failed.',
}]);
```

Invoke the listener again with a foreign sender and with `{ message: 'private', extra: 'rejected' }`; assert neither adds an entry.

- [ ] **Step 3: Run both tests and verify RED**

Run:

```powershell
npm.cmd test -- tests/unit/rendererErrorForwarding.test.ts tests/integration/rendererErrorReporting.test.ts
```

Expected: FAIL because the diagnostic modules and channel do not exist.

- [ ] **Step 4: Add the shared strict report contract**

Create `src/shared/diagnostics.ts`:

```ts
import { z } from 'zod';

export const rendererErrorReportSchema = z.object({
  kind: z.enum(['unhandled-error', 'unhandled-rejection']),
  name: z.string().min(1).max(100),
  message: z.string().min(1).max(1_000),
  stack: z.string().max(8_000).optional(),
}).strict();

export type RendererErrorReport = z.infer<typeof rendererErrorReportSchema>;

function bounded(value: string, limit: number, preserveLines = false): string {
  const controls = preserveLines
    ? /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g
    : /[\u0000-\u001f\u007f]/g;
  return value.replace(controls, ' ').trim().slice(0, limit);
}

export function toRendererErrorReport(
  kind: RendererErrorReport['kind'],
  reason: unknown,
): RendererErrorReport {
  if (!(reason instanceof Error)) {
    return { kind, name: 'UnknownError', message: 'Unknown non-Error failure.' };
  }
  return {
    kind,
    name: bounded(reason.name || 'Error', 100),
    message: bounded(reason.message || reason.name || 'Renderer failure.', 1_000),
    ...(reason.stack ? { stack: bounded(reason.stack, 8_000, true) } : {}),
  };
}
```

In `src/shared/ipc.ts`, add a separate constant so invoke channels remain unchanged:

```ts
export const DIAGNOSTIC_IPC = {
  REPORT_RENDERER_ERROR: 'assistant:report-renderer-error',
} as const;
```

- [ ] **Step 5: Implement preload forwarding**

Create `src/preload/rendererErrorForwarding.ts`:

```ts
import { toRendererErrorReport, type RendererErrorReport } from '../shared/diagnostics';

type AddListener = (
  type: 'error' | 'unhandledrejection',
  listener: (event: unknown) => void,
) => void;

export function registerRendererErrorForwarding(
  addListener: AddListener,
  send: (report: RendererErrorReport) => void,
): void {
  addListener('error', (event) => {
    const value = typeof event === 'object' && event !== null
      ? (event as { error?: unknown; message?: string }).error
        ?? new Error((event as { message?: string }).message ?? 'Renderer failure.')
      : event;
    send(toRendererErrorReport('unhandled-error', value));
  });
  addListener('unhandledrejection', (event) => {
    const reason = typeof event === 'object' && event !== null
      ? (event as { reason?: unknown }).reason
      : event;
    send(toRendererErrorReport('unhandled-rejection', reason));
  });
}
```

Modify `src/preload.ts` after the existing bridge exposure:

```ts
import { DIAGNOSTIC_IPC } from './shared/ipc';
import { registerRendererErrorForwarding } from './preload/rendererErrorForwarding';

registerRendererErrorForwarding(
  (type, listener) => window.addEventListener(type, listener),
  (report) => ipcRenderer.send(DIAGNOSTIC_IPC.REPORT_RENDERER_ERROR, report),
);
```

- [ ] **Step 6: Implement trusted main-process receipt**

Create `src/main/diagnostics/registerRendererErrorHandler.ts`. Define a minimal `on(channel, listener)` port, validate with `isTrustedIpcEvent`, parse with `rendererErrorReportSchema`, reconstruct only name/message/stack on a new `Error`, and call:

```ts
errorLogger.logError('renderer', `renderer:${report.kind}`, error);
```

Never log invalid or untrusted report values.

- [ ] **Step 7: Run renderer, IPC security, and type tests**

Run:

```powershell
npm.cmd test -- tests/unit/rendererErrorForwarding.test.ts tests/integration/rendererErrorReporting.test.ts tests/unit/ipcSecurity.test.ts
npm.cmd run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit renderer error capture**

```powershell
git add -- src/shared/diagnostics.ts src/shared/ipc.ts src/preload/rendererErrorForwarding.ts src/preload.ts src/main/diagnostics/registerRendererErrorHandler.ts tests/unit/rendererErrorForwarding.test.ts tests/integration/rendererErrorReporting.test.ts
git commit -m "feat: capture sanitized renderer failures"
```

---

### Task 5: Wire startup and Electron runtime error boundaries

**Files:**
- Create: `src/main/diagnostics/registerRuntimeErrorLogging.ts`
- Modify: `src/main.ts`
- Create: `tests/unit/runtimeErrorLogging.test.ts`

**Interfaces:**
- Consumes: `ErrorLogger`, `createElectronLogTransport`, `registerRendererErrorHandler`, and `registerIpcHandlers` from earlier tasks.
- Produces: `registerRuntimeErrorLogging(processEvents, appEvents, webContentsEvents, errorLogger): void` and the production logger lifecycle in `src/main.ts`.

- [ ] **Step 1: Write failing event-wiring tests**

Create `tests/unit/runtimeErrorLogging.test.ts` with small event registries and a recording logger. Register runtime logging, fire each event, and assert these fixed operations:

```ts
expect(entries.map((entry) => entry.operation)).toEqual([
  'process:uncaught-exception',
  'process:unhandled-rejection',
  'electron:child-process-gone',
  'electron:render-process-gone',
]);
```

For child/renderer termination, assert the generated Error message contains only process type, reason, and numeric exit code. Include `commandLine: 'contains-secret'` and `environment: 'contains-secret'` on fake detail objects and assert neither appears in recorded messages.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm.cmd test -- tests/unit/runtimeErrorLogging.test.ts
```

Expected: FAIL because `registerRuntimeErrorLogging.ts` does not exist.

- [ ] **Step 3: Implement fixed runtime adapters**

Create `src/main/diagnostics/registerRuntimeErrorLogging.ts` with narrow event-source types. Register:

```ts
processEvents.on('uncaughtExceptionMonitor', (error) => {
  errorLogger.logError('main', 'process:uncaught-exception', error);
});
processEvents.on('unhandledRejection', (reason) => {
  errorLogger.logError('main', 'process:unhandled-rejection', reason);
});
appEvents.on('child-process-gone', (_event, details) => {
  const error = new Error(
    `Electron child process exited: type=${details.type}; reason=${details.reason}; exitCode=${details.exitCode}`,
  );
  errorLogger.logError('main', 'electron:child-process-gone', error);
});
webContentsEvents.on('render-process-gone', (_event, details) => {
  const error = new Error(
    `Renderer process exited: reason=${details.reason}; exitCode=${details.exitCode}`,
  );
  errorLogger.logError('main', 'electron:render-process-gone', error);
});
```

Use `uncaughtExceptionMonitor`, not `uncaughtException`, so logging does not change Node's default crash semantics.

- [ ] **Step 4: Wire one production logger in main.ts**

In `src/main.ts`:

1. Add imports for the logger, transport, renderer handler, and runtime handler.
2. Add `let applicationErrorLogger: ErrorLogger | undefined;`.
3. Add a helper that returns `undefined` before `app.isReady()`, otherwise creates exactly one logger with `app.getPath('documents')`.
4. At the start of `startApplication`, obtain the logger.
5. Pass it to `registerIpcHandlers`.
6. Register the trusted renderer diagnostic handler with the same `TrustedSenderPolicy` used by invoke handlers.
7. Register runtime logging after the window exists.
8. Change the outer startup catch to accept `error`, call `getApplicationErrorLogger()?.logError('main', 'application-startup', error)`, then preserve the existing safe dialog and quit behavior.

The resulting startup boundary must retain this public copy exactly:

```ts
dialog.showErrorBox(
  'Personal Assistant could not start',
  'The application could not start safely. Please restart and try again.',
);
```

- [ ] **Step 5: Run runtime, IPC, and startup-adjacent tests**

Run:

```powershell
npm.cmd test -- tests/unit/runtimeErrorLogging.test.ts tests/integration/ipcHandlers.test.ts tests/integration/rendererErrorReporting.test.ts tests/unit/createMainWindow.test.ts
npm.cmd run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit production wiring**

```powershell
git add -- src/main/diagnostics/registerRuntimeErrorLogging.ts src/main.ts tests/unit/runtimeErrorLogging.test.ts
git commit -m "feat: wire application error logging"
```

---

### Task 6: Document, verify, install, and inspect the local feature

**Files:**
- Modify: `docs/release/0.1.0-local.md`
- Test: all test files and release artifacts.

**Interfaces:**
- Consumes: the complete logger feature from Tasks 1-5.
- Produces: documented log locations, verified production dependency packaging, and a locally installed corrected build. No GitHub push.

- [ ] **Step 1: Document the exact Windows paths and privacy boundary**

Add this section to `docs/release/0.1.0-local.md`:

```md
## Local error log

- Current: `%USERPROFILE%\Documents\personal-assistant\personal-assistant.log`
- Previous: `%USERPROFILE%\Documents\personal-assistant\personal-assistant.previous.log`
- Retention: 5 MiB current file plus one previous backup.
- Format: one JSON error entry per line with timestamp, process, operation, safe error fields, and bounded unexpected-error stacks.
- Excluded: prompts, IPC payloads, tasks, API keys, OAuth tokens, authorization headers, calendar content, HTTP bodies, command lines, and environment variables.
```

- [ ] **Step 2: Run the full source verification**

Run:

```powershell
npm.cmd run check
npm.cmd audit --omit=dev
git diff --check
```

Expected: all TypeScript and tests pass; production audit reports zero known vulnerabilities; no whitespace errors.

- [ ] **Step 3: Run the complete credentialed release verification**

Load the downloaded OAuth JSON into environment variables without printing either value, then run:

```powershell
$oauthCredential = Get-Content -Raw 'C:\Users\arms0\Downloads\client_secret_123931958886-134tm3o3i6a7h4905mp39mao01v319uf.apps.googleusercontent.com.json' | ConvertFrom-Json
$env:GOOGLE_OAUTH_CLIENT_ID = $oauthCredential.installed.client_id
$env:GOOGLE_OAUTH_CLIENT_SECRET = $oauthCredential.installed.client_secret
npm.cmd run release:verify
```

Expected: unit/integration tests pass, both Electron E2E tests pass, installer creation succeeds, the production ASAR assertion passes, and fuse verification passes. Never print or commit the OAuth JSON or decrypted credentials.

- [ ] **Step 4: Install and launch the corrected local installer**

Close only Personal Assistant processes after resolving their exact executable paths. Run and wait for:

```powershell
Start-Process -FilePath 'C:\Users\arms0\Documents\personal-assistant\.worktrees\personal-assistant\out\make\squirrel.windows\x64\PersonalAssistantSetup.exe' -Wait
```

Then launch `%LOCALAPPDATA%\personal_assistant\app-0.1.0\personal-assistant.exe` and confirm the window remains responsive.

- [ ] **Step 5: Verify a real safe error entry when an error naturally occurs**

After any application error, inspect only the approved fields:

```powershell
Get-Content -Tail 5 'C:\Users\arms0\Documents\personal-assistant\personal-assistant.log'
```

Expected: valid JSON Lines with a fixed operation name. Confirm no prompt, API key, OAuth value, authorization header, calendar content, or HTTP body appears. Do not deliberately replace or expose saved credentials merely to force an error.

- [ ] **Step 6: Commit documentation**

```powershell
git add -- docs/release/0.1.0-local.md
git commit -m "docs: record local error log"
```

- [ ] **Step 7: Final repository audit**

Run:

```powershell
git status --short
git log -8 --oneline
git diff HEAD~6 --check
```

Expected: clean worktree, separate focused commits, and no push performed.
