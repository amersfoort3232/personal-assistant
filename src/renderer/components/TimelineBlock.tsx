import { useEffect, useState, type KeyboardEvent } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { DateTime } from 'luxon';
import type { ScheduleBlock } from '../../shared/domain';

type TimelineBlockProps = {
  block: ScheduleBlock;
  busy: boolean;
  onChange(block: ScheduleBlock): Promise<boolean>;
  onResize(minutes: number): void;
  onShift(minutes: number): void;
  onRemove(): void;
  style: { top: number; height: number };
};

function timeValue(value: string): string {
  return DateTime.fromISO(value, { setZone: true }).toFormat('HH:mm');
}

export function TimelineBlock({
  block,
  busy,
  onChange,
  onResize,
  onRemove,
  onShift,
  style,
}: TimelineBlockProps) {
  const [title, setTitle] = useState(block.title);
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
  } = useDraggable({
    id: block.id,
    disabled: busy,
  });

  useEffect(() => {
    setTitle(block.title);
  }, [block.title]);

  const commitTitle = async () => {
    const nextTitle = title.trim();
    if (!nextTitle || nextTitle === block.title) {
      setTitle(block.title);
      return;
    }
    const accepted = await onChange({ ...block, title: nextTitle });
    if (!accepted) setTitle(block.title);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      if (!busy) onShift(event.key === 'ArrowUp' ? -15 : 15);
      return;
    }
  };

  const start = timeValue(block.start);
  const end = timeValue(block.end);
  const translatedTop = style.top + (transform?.y ?? 0);

  return (
    <div
      aria-label={`${block.title}, ${block.kind}, ${start} to ${end}. Alt plus Arrow Up or Down moves by 15 minutes.`}
      className={`timeline-block timeline-block-${block.kind}${isDragging ? ' is-dragging' : ''}`}
      onKeyDown={handleKeyDown}
      ref={setNodeRef}
      role="group"
      style={{ top: translatedTop, minHeight: style.height }}
      tabIndex={0}
    >
      <div className="timeline-block-heading">
        <label className="block-selection">
          <input
            aria-label={`Select ${block.title}`}
            checked={block.selected}
            disabled={busy}
            onChange={(event) => void onChange({ ...block, selected: event.target.checked })}
            onPointerDown={(event) => event.stopPropagation()}
            type="checkbox"
          />
          <span>{block.kind === 'task' ? 'Task' : 'Break'}</span>
        </label>
        <button
          {...attributes}
          {...listeners}
          aria-label={`Drag ${block.title}`}
          className="drag-handle"
          disabled={busy}
          ref={setActivatorNodeRef}
          type="button"
        >
          Drag · Alt+↑/↓
        </button>
      </div>

      <label className="timeline-field">
        <span>Title</span>
        <input
          aria-label={`Title for ${block.title}`}
          disabled={busy}
          maxLength={160}
          onBlur={() => void commitTitle()}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          onPointerDown={(event) => event.stopPropagation()}
          value={title}
        />
      </label>

      <div className="timeline-time-fields">
        <label className="timeline-field">
          <span>Start</span>
          <input
            aria-label={`Start time for ${block.title}`}
            disabled={busy}
            max="17:00"
            min="09:00"
            onChange={(event) => {
              const value = event.target.value;
              if (value) void onChange({ ...block, start: value });
            }}
            onKeyDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            step="300"
            type="time"
            value={start}
          />
        </label>
        <label className="timeline-field">
          <span>End</span>
          <input
            aria-label={`End time for ${block.title}`}
            disabled={busy}
            max="17:00"
            min="09:00"
            onChange={(event) => {
              const value = event.target.value;
              if (value) void onChange({ ...block, end: value });
            }}
            onKeyDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            step="300"
            type="time"
            value={end}
          />
        </label>
      </div>

      <div className="resize-controls" aria-label={`Resize ${block.title}`} role="group">
        <button
          aria-label={`Shorten ${block.title} by 15 minutes`}
          className="button button-secondary"
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            onResize(-15);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          type="button"
        >
          Shorten 15m
        </button>
        <button
          aria-label={`Extend ${block.title} by 15 minutes`}
          className="button button-secondary"
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            onResize(15);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          type="button"
        >
          Extend 15m
        </button>
      </div>

      <button
        aria-label={`Remove ${block.title}`}
        className="button button-danger remove-block"
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        type="button"
      >
        Remove
      </button>
    </div>
  );
}
