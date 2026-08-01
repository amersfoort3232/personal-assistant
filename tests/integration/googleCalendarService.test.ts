import { describe, expect, it, vi } from 'vitest';
import { GoogleCalendarService } from '../../src/main/google/googleCalendarService';
import { DEFAULT_SETTINGS } from '../../src/main/settings/defaultSettings';
import type { AppSettings, ProposedTask, ScheduleBlock } from '../../src/shared/domain';

const API = 'https://www.googleapis.com/calendar/v3';
const ACCESS_TOKEN = 'private-access-token';
const CALENDAR_ID = 'assistant-calendar@example.com';

const SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS,
  personalAssistantCalendarId: CALENDAR_ID,
};

const TASK: ProposedTask = {
  id: 'task-1',
  title: 'Prepare confidential launch notes',
  durationMinutes: 60,
  durationWasEstimated: false,
  priority: 'high',
  canSplit: true,
  minimumSessionMinutes: 30,
};

const BLOCK: ScheduleBlock = {
  id: 'block-1',
  kind: 'task',
  taskId: TASK.id,
  title: 'Prepare launch notes',
  start: '2026-08-03T09:00:00+01:00',
  end: '2026-08-03T10:00:00+01:00',
  selected: true,
  sessionIndex: 1,
  sessionCount: 2,
};

type QueuedReply = Response | Error;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function calendarResponse(id: string) {
  return {
    kind: 'calendar#calendar',
    etag: '"calendar-etag"',
    id,
    summary: 'Personal Assistant',
    timeZone: 'Europe/London',
  };
}

function createService(...replies: QueuedReply[]) {
  const queue = [...replies];
  const fetchImpl = vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error('Unexpected fake fetch call');
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  const auth = { getAccessToken: vi.fn(async () => ACCESS_TOKEN) };
  return { service: new GoogleCalendarService(auth, fetchImpl), fetchImpl };
}

function requestAt(fetchImpl: typeof fetch, index = 0) {
  const [url, init] = vi.mocked(fetchImpl).mock.calls[index];
  return { url: String(url), init };
}

function parsedBody(init: RequestInit | undefined): unknown {
  return JSON.parse(String(init?.body));
}

describe('GoogleCalendarService', () => {
  it('verifies and reuses a valid stored Personal Assistant calendar ID', async () => {
    const { service, fetchImpl } = createService(jsonResponse(calendarResponse(CALENDAR_ID)));

    const result = await service.ensurePersonalAssistantCalendar(SETTINGS);

    expect(result).toBe(SETTINGS);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(requestAt(fetchImpl)).toMatchObject({
      url: `${API}/calendars/assistant-calendar%40example.com`,
      init: {
        headers: expect.objectContaining({
          authorization: `Bearer ${ACCESS_TOKEN}`,
          'content-type': 'application/json',
        }),
      },
    });
    expect(requestAt(fetchImpl).init?.method).toBeUndefined();
  });

  it('creates the Personal Assistant calendar when no calendar ID is stored', async () => {
    const { service, fetchImpl } = createService(jsonResponse(calendarResponse(CALENDAR_ID)));

    const result = await service.ensurePersonalAssistantCalendar(DEFAULT_SETTINGS);

    expect(result).toEqual(SETTINGS);
    const request = requestAt(fetchImpl);
    expect(request.url).toBe(`${API}/calendars`);
    expect(request.init?.method).toBe('POST');
    expect(parsedBody(request.init)).toEqual({
      summary: 'Personal Assistant',
      timeZone: 'Europe/London',
    });
  });

  it('creates a replacement only after a stored calendar returns 404', async () => {
    const { service, fetchImpl } = createService(
      jsonResponse({ error: { message: 'private deleted-calendar detail' } }, 404),
      jsonResponse(calendarResponse('replacement-calendar')),
    );

    await expect(service.ensurePersonalAssistantCalendar(SETTINGS)).resolves.toEqual({
      ...SETTINGS,
      personalAssistantCalendarId: 'replacement-calendar',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(requestAt(fetchImpl, 1).url).toBe(`${API}/calendars`);
    expect(requestAt(fetchImpl, 1).init?.method).toBe('POST');
  });

  it.each([
    { name: 'a non-404 verification response', replies: [jsonResponse({ secret: 'private response body' }, 403)] },
    { name: 'a malformed verification response', replies: [jsonResponse({ id: 42, secret: 'private response body' })] },
    { name: 'a malformed creation response', replies: [jsonResponse({ summary: 'private response body' })], settings: DEFAULT_SETTINGS },
    { name: 'a network failure', replies: [new Error('private network detail')] },
  ])('normalizes $name without exposing Calendar data or credentials', async ({ replies, settings = SETTINGS }) => {
    const { service } = createService(...replies);

    const error = await service.ensurePersonalAssistantCalendar(settings).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ code: 'CALENDAR_UNAVAILABLE', retryable: true });
    expect((error as Error).message).not.toContain('private');
    expect((error as Error).message).not.toContain(ACCESS_TOKEN);
  });

  it('queries exactly primary and the app calendar across the selected London local day', async () => {
    const { service, fetchImpl } = createService(jsonResponse({
      kind: 'calendar#freeBusy',
      timeMin: '2026-10-24T23:00:00.000Z',
      timeMax: '2026-10-26T00:00:00.000Z',
      calendars: {
        primary: {
          busy: [{ start: '2026-10-25T09:00:00+00:00', end: '2026-10-25T10:00:00+00:00' }],
        },
        [CALENDAR_ID]: {
          busy: [{ start: '2026-10-25T13:00:00+00:00', end: '2026-10-25T13:30:00+00:00' }],
        },
      },
    }));

    const result = await service.getBusyPeriods('2026-10-25', SETTINGS);

    expect(result).toEqual([
      {
        start: '2026-10-25T09:00:00+00:00',
        end: '2026-10-25T10:00:00+00:00',
        sourceCalendarId: 'primary',
      },
      {
        start: '2026-10-25T13:00:00+00:00',
        end: '2026-10-25T13:30:00+00:00',
        sourceCalendarId: CALENDAR_ID,
      },
    ]);
    const request = requestAt(fetchImpl);
    expect(request.url).toBe(`${API}/freeBusy`);
    expect(request.init?.method).toBe('POST');
    expect(parsedBody(request.init)).toEqual({
      timeMin: '2026-10-25T00:00:00.000+01:00',
      timeMax: '2026-10-26T00:00:00.000+00:00',
      timeZone: 'Europe/London',
      items: [{ id: 'primary' }, { id: CALENDAR_ID }],
    });
  });

  it.each([
    {
      name: 'a missing requested calendar',
      payload: { calendars: { primary: { busy: [] } } },
    },
    {
      name: 'a malformed busy period',
      payload: {
        calendars: {
          primary: { busy: [{ start: 'not-a-date', end: '2026-08-03T10:00:00+01:00' }] },
          [CALENDAR_ID]: { busy: [] },
        },
      },
    },
    {
      name: 'a per-calendar API error',
      payload: {
        calendars: {
          primary: { busy: [], errors: [{ domain: 'calendar', reason: 'privateReason' }] },
          [CALENDAR_ID]: { busy: [] },
        },
      },
    },
    {
      name: 'a malformed extra calendar entry',
      payload: {
        calendars: {
          primary: { busy: [] },
          [CALENDAR_ID]: { busy: [] },
          extra: { busy: 'private response body' },
        },
      },
    },
  ])('rejects FreeBusy response containing $name', async ({ payload }) => {
    const { service } = createService(jsonResponse(payload));

    const error = await service.getBusyPeriods('2026-08-03', SETTINGS).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ code: 'CALENDAR_UNAVAILABLE', retryable: true });
    expect((error as Error).message).not.toContain('private');
  });

  it.each([
    { name: 'an HTTP error', reply: jsonResponse({ description: 'private response body' }, 503) },
    { name: 'malformed JSON', reply: new Response('private non-JSON response') },
    { name: 'a network error', reply: new Error('private network detail') },
  ])('normalizes $name from FreeBusy without exposing sensitive details', async ({ reply }) => {
    const { service } = createService(reply);

    const error = await service.getBusyPeriods('2026-08-03', SETTINGS).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ code: 'CALENDAR_UNAVAILABLE', retryable: true });
    expect((error as Error).message).not.toContain('private');
    expect((error as Error).message).not.toContain(ACCESS_TOKEN);
  });

  it('rejects FreeBusy before HTTP when the Personal Assistant calendar is missing', async () => {
    const { service, fetchImpl } = createService();

    await expect(service.getBusyPeriods('2026-08-03', DEFAULT_SETTINGS)).rejects.toMatchObject({
      code: 'CALENDAR_UNAVAILABLE',
      retryable: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('inserts a deterministic event with exact task metadata and default reminders', async () => {
    const { service, fetchImpl } = createService(jsonResponse({
      kind: 'calendar#event',
      etag: '"event-etag"',
      id: 'deterministic-event-id',
      status: 'confirmed',
      htmlLink: 'https://calendar.google.com/event',
      summary: BLOCK.title,
      start: { dateTime: BLOCK.start, timeZone: 'Europe/London' },
      end: { dateTime: BLOCK.end, timeZone: 'Europe/London' },
    }));

    const result = await service.insertBlock(CALENDAR_ID, BLOCK, 'deterministic-event-id', TASK);

    expect(result).toEqual({
      blockId: BLOCK.id,
      status: 'created',
      googleEventId: 'deterministic-event-id',
    });
    const request = requestAt(fetchImpl);
    expect(request.url).toBe(`${API}/calendars/assistant-calendar%40example.com/events`);
    expect(request.init?.method).toBe('POST');
    expect(parsedBody(request.init)).toEqual({
      id: 'deterministic-event-id',
      summary: 'Prepare launch notes',
      description: [
        'Created by Personal Assistant',
        'Priority: high',
        'Original task: Prepare confidential launch notes',
        'Duration: 60 minutes (confirmed)',
        'Session: 1 of 2',
      ].join('\n'),
      start: { dateTime: '2026-08-03T09:00:00+01:00', timeZone: 'Europe/London' },
      end: { dateTime: '2026-08-03T10:00:00+01:00', timeZone: 'Europe/London' },
      reminders: { useDefault: true },
    });
  });

  it('returns already-existed after 409 only when the fetched event semantically matches', async () => {
    const { service, fetchImpl } = createService(
      jsonResponse({ error: { message: 'duplicate' } }, 409),
      jsonResponse({
        kind: 'calendar#event',
        etag: '"existing-etag"',
        id: 'deterministic-event-id',
        status: 'confirmed',
        summary: BLOCK.title,
        start: { dateTime: '2026-08-03T08:00:00Z', timeZone: 'UTC' },
        end: { dateTime: '2026-08-03T09:00:00Z', timeZone: 'UTC' },
      }),
    );

    await expect(
      service.insertBlock(CALENDAR_ID, BLOCK, 'deterministic-event-id', TASK),
    ).resolves.toEqual({
      blockId: BLOCK.id,
      status: 'already-existed',
      googleEventId: 'deterministic-event-id',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(requestAt(fetchImpl, 1).url).toBe(
      `${API}/calendars/assistant-calendar%40example.com/events/deterministic-event-id`,
    );
    expect(requestAt(fetchImpl, 1).init?.method).toBeUndefined();
  });

  it.each([
    { field: 'summary', value: 'A different event' },
    { field: 'start', value: { dateTime: '2026-08-03T09:30:00+01:00', timeZone: 'Europe/London' } },
    { field: 'end', value: { dateTime: '2026-08-03T10:30:00+01:00', timeZone: 'Europe/London' } },
  ])('returns failed after 409 when the existing event has a mismatching $field', async ({ field, value }) => {
    const existing = {
      kind: 'calendar#event',
      etag: '"existing-etag"',
      id: 'deterministic-event-id',
      status: 'confirmed',
      summary: BLOCK.title,
      start: { dateTime: BLOCK.start, timeZone: 'Europe/London' },
      end: { dateTime: BLOCK.end, timeZone: 'Europe/London' },
      [field]: value,
    };
    const { service } = createService(jsonResponse({}, 409), jsonResponse(existing));

    await expect(service.insertBlock(CALENDAR_ID, BLOCK, 'deterministic-event-id', TASK)).resolves.toEqual({
      blockId: BLOCK.id,
      status: 'failed',
      errorCode: 'HTTP_409',
    });
  });

  it.each([
    { name: 'an insert HTTP error', replies: [jsonResponse({ description: 'private response body' }, 503)], errorCode: 'HTTP_503' },
    { name: 'an insert network error', replies: [new Error('private network detail')], errorCode: 'CALENDAR_UNAVAILABLE' },
    { name: 'a malformed successful insert', replies: [jsonResponse({ id: 42, description: 'private task detail' })], errorCode: 'INVALID_RESPONSE' },
    { name: 'a malformed conflict lookup', replies: [jsonResponse({}, 409), jsonResponse({ description: 'private task detail' })], errorCode: 'INVALID_RESPONSE' },
    { name: 'a conflict lookup network error', replies: [jsonResponse({}, 409), new Error('private network detail')], errorCode: 'CALENDAR_UNAVAILABLE' },
  ])('returns a safe failed result for $name', async ({ replies, errorCode }) => {
    const { service } = createService(...replies);

    const result = await service.insertBlock(CALENDAR_ID, BLOCK, 'deterministic-event-id', TASK);

    expect(result).toEqual({ blockId: BLOCK.id, status: 'failed', errorCode });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(JSON.stringify(result)).not.toContain(TASK.title);
    expect(JSON.stringify(result)).not.toContain(ACCESS_TOKEN);
  });
});
