import { DateTime } from 'luxon';
import { z } from 'zod';
import type {
  AppSettings,
  BusyPeriod,
  EventCreationResult,
  ProposedTask,
  ScheduleBlock,
} from '../../shared/domain';
import { AppError } from '../../shared/errors';
import { busyPeriodSchema } from '../../shared/schemas';
import type { GoogleAuthService } from './googleAuthService';

const API = 'https://www.googleapis.com/calendar/v3';
const EVENT_TIME_ZONE = 'Europe/London';

const calendarSchema = z.object({
  kind: z.string().optional(),
  etag: z.string().optional(),
  id: z.string().min(1),
  summary: z.string().optional(),
  timeZone: z.string().optional(),
}).passthrough();

const rawBusyPeriodSchema = z.object({
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
}).passthrough();

const calendarErrorSchema = z.object({
  domain: z.string().min(1),
  reason: z.string().min(1),
}).passthrough();

const freeBusyCalendarSchema = z.object({
  busy: z.array(rawBusyPeriodSchema),
  errors: z.array(calendarErrorSchema).optional(),
}).passthrough();

const freeBusyResponseSchema = z.object({
  kind: z.string().optional(),
  timeMin: z.string().datetime({ offset: true }).optional(),
  timeMax: z.string().datetime({ offset: true }).optional(),
  calendars: z.record(z.string(), freeBusyCalendarSchema),
}).passthrough();

const createdEventSchema = z.object({
  id: z.string().min(1),
}).passthrough();

const existingEventSchema = z.object({
  id: z.string().min(1),
  summary: z.string(),
  start: z.object({
    dateTime: z.string().datetime({ offset: true }),
    timeZone: z.string().optional(),
  }).passthrough(),
  end: z.object({
    dateTime: z.string().datetime({ offset: true }),
    timeZone: z.string().optional(),
  }).passthrough(),
}).passthrough();

function unavailable(message: string, retryable = true): AppError {
  return new AppError('CALENDAR_UNAVAILABLE', message, retryable);
}

function invalidResponse(): AppError {
  return unavailable('Google Calendar returned an invalid response.');
}

function sameInstant(first: string, second: string): boolean {
  const firstDateTime = DateTime.fromISO(first, { setZone: true });
  const secondDateTime = DateTime.fromISO(second, { setZone: true });
  return firstDateTime.isValid
    && secondDateTime.isValid
    && firstDateTime.toMillis() === secondDateTime.toMillis();
}

export class GoogleCalendarService {
  constructor(
    private readonly auth: Pick<GoogleAuthService, 'getAccessToken'>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async ensurePersonalAssistantCalendar(settings: AppSettings): Promise<AppSettings> {
    if (settings.personalAssistantCalendarId) {
      const response = await this.request(
        `/calendars/${encodeURIComponent(settings.personalAssistantCalendarId)}`,
      );
      if (response.ok) {
        const calendar = await this.readJson(response, calendarSchema);
        if (calendar.id !== settings.personalAssistantCalendarId) throw invalidResponse();
        return settings;
      }
      if (response.status !== 404) {
        throw unavailable('Unable to verify Personal Assistant calendar.');
      }
    }

    const response = await this.request('/calendars', {
      method: 'POST',
      body: JSON.stringify({
        summary: 'Personal Assistant',
        timeZone: EVENT_TIME_ZONE,
      }),
    });
    if (!response.ok) {
      throw unavailable('Unable to create Personal Assistant calendar.');
    }
    const calendar = await this.readJson(response, calendarSchema);
    return { ...settings, personalAssistantCalendarId: calendar.id };
  }

  async getBusyPeriods(targetDate: string, settings: AppSettings): Promise<BusyPeriod[]> {
    if (!settings.personalAssistantCalendarId) {
      throw unavailable('Personal Assistant calendar is missing.', false);
    }

    const start = /^\d{4}-\d{2}-\d{2}$/.test(targetDate)
      ? DateTime.fromISO(targetDate, { zone: settings.timeZone }).startOf('day')
      : DateTime.invalid('Invalid selected date');
    if (!start.isValid) {
      throw new AppError('VALIDATION_FAILED', 'Selected date is invalid.', false);
    }
    const end = start.plus({ days: 1 });
    const calendarIds = ['primary', settings.personalAssistantCalendarId];
    const response = await this.request('/freeBusy', {
      method: 'POST',
      body: JSON.stringify({
        timeMin: start.toISO(),
        timeMax: end.toISO(),
        timeZone: settings.timeZone,
        items: calendarIds.map((id) => ({ id })),
      }),
    });
    if (!response.ok) {
      throw unavailable('Unable to read Google Calendar availability.');
    }

    const payload = await this.readJson(response, freeBusyResponseSchema);
    if (Object.values(payload.calendars).some((calendar) => (calendar.errors?.length ?? 0) > 0)) {
      throw unavailable('Unable to read Google Calendar availability.');
    }

    return calendarIds.flatMap((sourceCalendarId) => {
      if (!Object.hasOwn(payload.calendars, sourceCalendarId)) throw invalidResponse();
      return payload.calendars[sourceCalendarId].busy.map((period) => {
        const parsed = busyPeriodSchema.safeParse({ ...period, sourceCalendarId });
        if (!parsed.success) throw invalidResponse();
        return parsed.data;
      });
    });
  }

  async insertBlock(
    calendarId: string,
    block: ScheduleBlock,
    eventId: string,
    task?: ProposedTask,
  ): Promise<EventCreationResult> {
    const taskDescription = task
      ? [
          'Created by Personal Assistant',
          `Priority: ${task.priority}`,
          `Original task: ${task.title}`,
          `Duration: ${task.durationMinutes} minutes (${task.durationWasEstimated ? 'estimated' : 'confirmed'})`,
          `Session: ${block.sessionIndex ?? 1} of ${block.sessionCount ?? 1}`,
        ].join('\n')
      : 'Created by Personal Assistant\nType: Scheduled break';
    const event = {
      id: eventId,
      summary: block.title,
      description: taskDescription,
      start: { dateTime: block.start, timeZone: EVENT_TIME_ZONE },
      end: { dateTime: block.end, timeZone: EVENT_TIME_ZONE },
      reminders: { useDefault: true },
    };

    let response: Response;
    try {
      response = await this.request(
        `/calendars/${encodeURIComponent(calendarId)}/events`,
        { method: 'POST', body: JSON.stringify(event) },
      );
    } catch (error) {
      return this.failedResult(block.id, this.safeErrorCode(error));
    }

    if (response.ok) {
      try {
        const created = await this.readJson(response, createdEventSchema);
        return { blockId: block.id, status: 'created', googleEventId: created.id };
      } catch {
        return this.failedResult(block.id, 'INVALID_RESPONSE');
      }
    }

    if (response.status === 409) {
      let existingResponse: Response;
      try {
        existingResponse = await this.request(
          `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        );
      } catch (error) {
        return this.failedResult(block.id, this.safeErrorCode(error));
      }
      if (existingResponse.ok) {
        let existing: z.infer<typeof existingEventSchema>;
        try {
          existing = await this.readJson(existingResponse, existingEventSchema);
        } catch {
          return this.failedResult(block.id, 'INVALID_RESPONSE');
        }
        if (
          existing.summary === event.summary
          && sameInstant(existing.start.dateTime, block.start)
          && sameInstant(existing.end.dateTime, block.end)
        ) {
          return {
            blockId: block.id,
            status: 'already-existed',
            googleEventId: existing.id,
          };
        }
      }
    }

    return this.failedResult(block.id, `HTTP_${response.status}`);
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.auth.getAccessToken();
    try {
      return await this.fetchImpl(`${API}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          ...init.headers,
        },
      });
    } catch {
      throw unavailable('Google Calendar request failed.');
    }
  }

  private async readJson<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw invalidResponse();
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw invalidResponse();
    return parsed.data;
  }

  private failedResult(blockId: string, errorCode: string): EventCreationResult {
    return { blockId, status: 'failed', errorCode };
  }

  private safeErrorCode(error: unknown): string {
    return error instanceof AppError ? error.code : 'CALENDAR_UNAVAILABLE';
  }
}
