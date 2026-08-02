# Today Calendar on Home and in a Calendar Tab

Date: 2026-08-02

## Goal

Let the user see their current Google Calendar from Personal Assistant without
leaving the app. Show a compact summary on Home and a read-only full-day view
in a separate Calendar tab.

## User Experience

The existing **Plan your day** screen becomes the Home screen. It retains chat,
task review, and schedule creation, and adds a compact **Today's calendar**
section. The section lists today's events by local start time and title, with a
clear **View calendar** button.

Selecting the button opens a **Calendar** tab. The tab shows today's events in
a read-only, chronological day timeline. It includes a **Back to Home** button
and a **Refresh** button. A separate **Plan another event** action also returns
to Home, where the user can add a task, build a schedule, and approve it. The
application opens on Home.

Both views load today's events when they are first shown. Refresh reloads the
same local calendar day; no date picker or calendar editing is included in this
scope.

## Calendar Access

The app will add Google's calendar-read scope so it can retrieve event titles
and start/end times. Existing users must disconnect and reconnect Google once
to grant the extra permission. The app continues to use the existing scopes
needed to read availability and create its own planning calendar.

The calendar service will retrieve events from the connected account's primary
calendar and the Personal Assistant calendar. All-day events are represented in
the summary and timeline. The renderer receives only safe event display data:
title, start, end, all-day state, and source calendar identifier. It does not
receive OAuth tokens, descriptions, attendees, locations, or video links.

## States and Errors

While loading, each view shows a compact loading state. If Google is not
connected, the Home section and Calendar tab explain that calendar access must
be connected. If the request fails, they present a retryable error and a
Refresh action. An empty day clearly states that there are no events today.

The calendar is strictly read-only: no events are updated, deleted, or created
through this feature. Existing schedule approval remains the only way the app
creates Personal Assistant events.

## Architecture

A new typed IPC request obtains today's display events from the orchestrator.
The Google calendar service validates Google API responses, maps them to a
shared `CalendarEvent` contract, and returns only the listed safe fields. The
preload bridge exposes the request; the React app owns Home/Calendar navigation
and loading state. Dedicated Home-summary and Calendar-timeline components
render the common display data.

## Tests and Verification

- Schema and IPC tests validate the display-event contract and reject malformed
  requests/responses.
- Google service tests cover timed events, all-day events, source calendars,
  and invalid Google responses.
- Renderer tests cover the Home summary, Calendar navigation, refresh, empty,
  disconnected, and error states.
- OAuth tests verify the requested read scope and preserve the existing scopes.
- The full project check, a production package, and a local app launch verify
  the completed feature.

## Scope Boundaries

This feature is limited to today, the primary calendar, and the existing
Personal Assistant calendar. It does not add week/month views, a date picker,
calendar selection, event editing, Google Calendar embedding, or a web browser
inside the app.
