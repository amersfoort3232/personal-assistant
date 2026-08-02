# Safe Local Error Logging Design

Date: 2026-08-02

## Goal

Persist useful application error diagnostics with operation context while excluding user content and credentials. The log must help investigate failures such as rejected DeepSeek requests without changing normal application behavior when logging itself is unavailable.

## Scope

The logger covers errors that reach application-owned boundaries:

- failed main-process IPC operations;
- application startup failures after Electron becomes ready;
- uncaught main-process exceptions and unhandled rejections;
- sanitized renderer exceptions and unhandled rejections;
- renderer-process termination; and
- Electron child-process termination.

Operating-system failures that prevent Electron from starting cannot be logged by the application.

The feature does not add an in-app log viewer or an "Open log folder" button.

## Location and Retention

Electron resolves the Windows Documents directory with `app.getPath('documents')`. The logger appends the `personal-assistant` directory and these filenames:

- current: `personal-assistant.log`
- backup: `personal-assistant.previous.log`

On the target machine, the current file resolves to:

`C:\Users\arms0\Documents\personal-assistant\personal-assistant.log`

The username is not hard-coded, so the repository remains portable.

The current file may grow to 5 MiB. The `electron-log` file transport is configured with that maximum size and a custom synchronous `archiveLogFn`. On rotation, the callback removes the previous backup if it exists, renames the current file to the backup filename, and starts a new current file. Bounded entries ensure that one entry cannot exceed the rotation limit. Total retained storage is approximately 10 MiB.

## Entry Format

The log uses UTF-8 JSON Lines: one JSON object per line. An entry contains only the following fields:

```ts
type ErrorLogEntry = {
  timestamp: string;
  level: 'error';
  process: 'main' | 'renderer';
  operation: string;
  code?: string;
  retryable?: boolean;
  message: string;
  stack?: string;
};
```

`timestamp` is an ISO 8601 UTC timestamp. `operation` identifies the boundary, such as `ipc:send-message`, `application-startup`, `renderer:unhandled-error`, or `electron:render-process-gone`.

Expected `AppError` instances include their public code, message, and retryability. Unexpected errors include a sanitized message and may include a bounded stack trace. Messages are limited to 1,000 characters and stacks to 8,000 characters. Control characters other than line separators used by stack formatting are removed before JSON serialization.

The logging API accepts an error and fixed operation metadata only. It never accepts or serializes IPC arguments, prompts, task text, API keys, OAuth tokens, authorization headers, calendar data, HTTP request bodies, HTTP response bodies, arbitrary error causes, or arbitrary objects.

## Architecture

### Error logger

A focused main-process module wraps a pinned `electron-log` 5.x production dependency. The wrapper owns safe entry construction, bounding, sanitization, JSON serialization, and the fail-open boundary. `electron-log` owns directory creation, synchronous file appends, and size-based rotation.

The file transport uses `resolvePathFn` to select the Documents-based current path, `maxSize` for the 5 MiB limit, `archiveLogFn` for the single exact backup path, and a text-only format so each supplied JSON string remains one JSON-lines entry. Console and remote transports are disabled.

The application does not override `console`, pass arbitrary objects to `electron-log`, import its renderer logger, or enable its unrestricted automatic error and event capture. All entries continue to flow through the application's sanitized wrapper and trusted renderer diagnostic channel.

The wrapper depends on an injected transport port and clock for deterministic unit tests. Production wiring adapts the configured `electron-log` main-process instance to that port.

### IPC operation failures

The existing central IPC wrapper already catches every orchestrator failure. `registerIpcHandlers` receives a narrow logger port and records the caught error with the channel name before returning the existing safe IPC error envelope. Only the channel name is logged; the wrapper does not pass request arguments or parsed payloads to the logger.

### Renderer failures

The preload installs listeners for renderer `error` and `unhandledrejection` events. It reduces a renderer failure to bounded primitive fields (name, message, and stack) and sends that record over a dedicated one-way diagnostic IPC channel.

The main process accepts diagnostic reports only from the existing expected web contents, main frame, and trusted renderer URL. It converts the primitive report into a renderer log entry. Untrusted senders and invalid reports are rejected without logging their supplied content.

### Process and startup failures

The main application creates the logger once Electron is ready and wires it to:

- the outer application-startup rejection boundary;
- `process` uncaught-exception and unhandled-rejection events;
- the main window's renderer-process termination event; and
- Electron child-process termination events.

Process termination entries contain Electron-provided reason, exit code, and process type only when those values fit the fixed diagnostic schema. No command lines or environment variables are recorded.

## Error Handling

Logging is fail-open. The wrapper contains transport failures, including directory creation, rotation, rename, and append failures. The user-facing operation continues to return its original success or failure result, and the logger never replaces the original error.

The existing UI continues to show safe public errors. Logging does not make stack traces or internal failures visible in the renderer.

## Testing

Implementation follows test-driven development. Automated tests cover:

- JSON-lines serialization of expected and unexpected errors;
- message and stack bounds;
- exclusion of arbitrary properties and supplied payloads;
- transport configuration for the exact current path, 5 MiB size, and exact backup path;
- rotation at the 5 MiB boundary and single-backup retention;
- transport failure isolation;
- IPC operation logging without arguments;
- trusted, schema-validated renderer diagnostic forwarding;
- rejection of untrusted renderer diagnostic reports; and
- startup and Electron process-event wiring.

After focused tests pass, verification runs TypeScript checking, the full unit/integration suite, Electron E2E tests, production dependency inspection, installer creation, production ASAR inspection, and fuse verification.

## Documentation

The local release documentation records both Windows paths, the 5 MiB plus one-backup retention policy, the JSON-lines format, and the explicit list of excluded sensitive data.
