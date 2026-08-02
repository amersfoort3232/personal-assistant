import type { CalendarEvent } from '../../shared/domain';

export function TodayCalendarSummary({ events = [], onViewCalendar }: { events?: CalendarEvent[]; onViewCalendar(): void }) {
  return <section className="today-calendar" aria-labelledby="today-calendar-title">
    <h2 id="today-calendar-title">Today's calendar</h2>
    {events.length === 0 ? <p>No events today.</p> : <ul>{events.slice(0, 4).map((event) => <li key={`${event.sourceCalendarId}-${event.id}`}>{event.allDay ? 'All day' : event.start.slice(11, 16)} — {event.title}</li>)}</ul>}
    <button className="button button-secondary" onClick={onViewCalendar} type="button">View calendar</button>
  </section>;
}
