import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { DateTime } from 'luxon';
import type { BusyPeriod, ScheduleBlock } from '../../shared/domain';
import { TimelineBlock } from './TimelineBlock';

const WORK_START_HOUR = 9;
const WORK_END_HOUR = 17;
export const PIXELS_PER_15_MINUTES = 24;

type ScheduleTimelineProps = {
  blocks: ScheduleBlock[];
  busy: boolean;
  busyPeriods: BusyPeriod[];
  onChange(blocks: ScheduleBlock[]): Promise<boolean>;
};

function minutesAfterStart(value: string): number {
  const time = DateTime.fromISO(value, { setZone: true });
  return (time.hour - WORK_START_HOUR) * 60 + time.minute;
}

function formattedTime(value: string): string {
  return DateTime.fromISO(value, { setZone: true }).toFormat('HH:mm');
}

function boundaries(block: ScheduleBlock) {
  const base = DateTime.fromISO(block.start, { setZone: true });
  return {
    opening: base.startOf('day').set({ hour: WORK_START_HOUR }),
    closing: base.startOf('day').set({ hour: WORK_END_HOUR }),
  };
}

function replaceBlock(blocks: ScheduleBlock[], replacement: ScheduleBlock): ScheduleBlock[] {
  return blocks.map((block) => block.id === replacement.id ? replacement : block);
}

function changeTime(block: ScheduleBlock, field: 'start' | 'end', time: string): ScheduleBlock | null {
  const [hour, minute] = time.split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute % 5 !== 0) return null;
  const currentStart = DateTime.fromISO(block.start, { setZone: true });
  const currentEnd = DateTime.fromISO(block.end, { setZone: true });
  const { opening, closing } = boundaries(block);
  const proposed = currentStart.startOf('day').set({ hour, minute, second: 0, millisecond: 0 });

  if (field === 'start') {
    const next = DateTime.max(opening, DateTime.min(proposed, currentEnd.minus({ minutes: 5 })));
    if (next.equals(currentStart)) return null;
    return { ...block, start: next.toISO()! };
  }

  const next = DateTime.min(closing, DateTime.max(proposed, currentStart.plus({ minutes: 5 })));
  if (next.equals(currentEnd)) return null;
  return { ...block, end: next.toISO()! };
}

function moveBlock(block: ScheduleBlock, minutes: number): ScheduleBlock | null {
  const start = DateTime.fromISO(block.start, { setZone: true });
  const end = DateTime.fromISO(block.end, { setZone: true });
  const { opening, closing } = boundaries(block);
  let nextStart = start.plus({ minutes });
  let nextEnd = end.plus({ minutes });

  if (nextStart < opening) {
    const correction = opening.diff(nextStart, 'minutes').minutes;
    nextStart = nextStart.plus({ minutes: correction });
    nextEnd = nextEnd.plus({ minutes: correction });
  }
  if (nextEnd > closing) {
    const correction = nextEnd.diff(closing, 'minutes').minutes;
    nextStart = nextStart.minus({ minutes: correction });
    nextEnd = nextEnd.minus({ minutes: correction });
  }
  if (nextStart.equals(start) && nextEnd.equals(end)) return null;
  return { ...block, start: nextStart.toISO()!, end: nextEnd.toISO()! };
}

function resizeBlock(block: ScheduleBlock, minutes: number): ScheduleBlock | null {
  const start = DateTime.fromISO(block.start, { setZone: true });
  const end = DateTime.fromISO(block.end, { setZone: true });
  const { closing } = boundaries(block);
  const nextEnd = DateTime.min(closing, DateTime.max(start.plus({ minutes: 5 }), end.plus({ minutes })));
  if (nextEnd.equals(end)) return null;
  return { ...block, end: nextEnd.toISO()! };
}

export function ScheduleTimeline({ blocks, busy, busyPeriods, onChange }: ScheduleTimelineProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 2 } }),
    useSensor(KeyboardSensor),
  );

  const commitBlock = (block: ScheduleBlock) => onChange(replaceBlock(blocks, block));

  const handleDragEnd = (event: DragEndEvent) => {
    if (busy) return;
    const block = blocks.find((item) => item.id === event.active.id);
    if (!block) return;
    const shiftedMinutes = Math.round(event.delta.y / PIXELS_PER_15_MINUTES) * 15;
    if (shiftedMinutes === 0) return;
    const shifted = moveBlock(block, shiftedMinutes);
    if (shifted) void commitBlock(shifted);
  };

  return (
    <section className="schedule-timeline" aria-labelledby="timeline-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">09:00–17:00</p>
          <h2 id="timeline-title">Daily timeline</h2>
        </div>
      </div>
      <p className="field-note timeline-help">
        Drag a block, or focus it and press Alt+Arrow Up or Alt+Arrow Down, to move by 15 minutes.
      </p>

      <DndContext onDragEnd={handleDragEnd} sensors={sensors}>
        <div className="timeline-grid">
          {Array.from({ length: 33 }, (_, index) => {
            const totalMinutes = WORK_START_HOUR * 60 + index * 15;
            const label = `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
            return (
              <span
                aria-hidden="true"
                className="timeline-tick"
                key={label}
                style={{ top: index * PIXELS_PER_15_MINUTES }}
              >
                {index % 4 === 0 ? label : ''}
              </span>
            );
          })}

          {busyPeriods.map((period) => {
            const top = minutesAfterStart(period.start) / 15 * PIXELS_PER_15_MINUTES;
            const height = Math.max(
              PIXELS_PER_15_MINUTES,
              (minutesAfterStart(period.end) - minutesAfterStart(period.start)) / 15 * PIXELS_PER_15_MINUTES,
            );
            const start = formattedTime(period.start);
            const end = formattedTime(period.end);
            return (
              <div
                aria-label={`Busy period from ${start} to ${end}, locked`}
                className="timeline-busy"
                key={`${period.sourceCalendarId}-${period.start}-${period.end}`}
                role="group"
                style={{ top, minHeight: height }}
              >
                <strong>Busy</strong>
                <span>{start}–{end}</span>
                <span>Locked</span>
              </div>
            );
          })}

          {blocks.map((block) => {
            const top = minutesAfterStart(block.start) / 15 * PIXELS_PER_15_MINUTES;
            const height = Math.max(
              PIXELS_PER_15_MINUTES * 2,
              (minutesAfterStart(block.end) - minutesAfterStart(block.start)) / 15 * PIXELS_PER_15_MINUTES,
            );
            return (
              <TimelineBlock
                block={block}
                busy={busy}
                key={block.id}
                onChange={async (replacement) => {
                  const normalized = replacement.start.includes(':') && replacement.start.length === 5
                    ? changeTime(block, 'start', replacement.start)
                    : replacement.end.includes(':') && replacement.end.length === 5
                      ? changeTime(block, 'end', replacement.end)
                      : replacement;
                  return normalized ? commitBlock(normalized) : false;
                }}
                onResize={(minutes) => {
                  const resized = resizeBlock(block, minutes);
                  if (resized) void commitBlock(resized);
                }}
                onRemove={() => void onChange(blocks.filter((item) => item.id !== block.id))}
                onShift={(minutes) => {
                  const shifted = moveBlock(block, minutes);
                  if (shifted) void commitBlock(shifted);
                }}
                style={{ top, height }}
              />
            );
          })}
        </div>
      </DndContext>
    </section>
  );
}
