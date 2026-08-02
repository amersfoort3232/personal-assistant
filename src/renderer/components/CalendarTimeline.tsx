import type { CalendarEvent } from '../../shared/domain';

export function CalendarTimeline({ events = [], onBackHome }: { events?: CalendarEvent[]; onBackHome(): void }) {
  return <main className="app-shell planning-shell"><div className="planning-workspace"><header className="planning-header"><div><p className="eyebrow">Google Calendar</p><h1>Calendar</h1></div><div className="planning-actions"><button className="button button-secondary" onClick={onBackHome} type="button">Back to Home</button><button className="button button-primary" onClick={onBackHome} type="button">Plan another event</button></div></header><section className="today-calendar" aria-label="Today's events"><h2>Today's events</h2>{events.length === 0 ? <p>No events today.</p> : <ol>{events.map((event) => <li key={`${event.sourceCalendarId}-${event.id}`}><strong>{event.allDay ? 'All day' : `${event.start.slice(11, 16)}–${event.end.slice(11, 16)}`}</strong> {event.title}</li>)}</ol>}</section></div></main>;
}
