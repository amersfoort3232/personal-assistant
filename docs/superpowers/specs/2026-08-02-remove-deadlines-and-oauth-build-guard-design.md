# Remove Deadlines and Guard Production OAuth Builds

Date: 2026-08-02

## Goal

Simplify planning by removing deadline-based scheduling entirely and prevent a
production installer from being created without its required Google OAuth client
ID.

## Deadline Removal

`ProposedTask` no longer includes a deadline. The DeepSeek prompt and
`replace_tasks` tool no longer describe or accept one. The task review screen
removes the Deadline input and its London daylight-saving-time validation.

The deterministic scheduler retains exact `fixedStartTime` tasks. It allocates
those first, then orders flexible tasks by priority, whether they can split, and
duration. `deadline-impossible` is removed from the unscheduled-task contract
and UI. Existing approved Calendar events remain unchanged; unapproved tasks
and the conversation are in-memory only, so no task-data migration is required.

## Production OAuth Build Guard

The Google OAuth client ID is compile-time desktop-app configuration, not a
secret. A production `package` or `make` command must require a non-empty
`GOOGLE_OAUTH_CLIENT_ID` before Electron Forge runs. E2E packaging remains
exempt because it deliberately uses fake services.

A small Node preflight script validates only whether the value is present; it
never prints the value. The script is run by the production npm scripts, so a
missing ID cannot produce another installable but unusable build. The existing
runtime check remains defense in depth.

For a local release, the build command reads the downloaded Desktop OAuth JSON
in-memory, assigns the client ID and optional client secret to that process only,
and runs release verification. Neither value is written to the repository,
installer logs, or Git.

## Tests and Verification

- Schema tests reject legacy deadline fields.
- Task-editor renderer tests confirm no Deadline control is shown and saving a
  task sends no deadline property.
- Scheduler tests prove priority/split/duration order without deadline cases and
  retain exact fixed-start and 15-minute-break regressions.
- Preflight unit tests accept an ID and reject missing/blank IDs without
  including the supplied ID in the error message.
- Production build scripts are exercised with a present configuration; the
  updated installer is locally installed and launched.

## Safety

No source file stores the OAuth values. The build guard’s error message is safe
to show to a user and explains only which configuration is absent. The current
runtime configuration dialog remains in place if a malformed external build
bypasses the preflight.
