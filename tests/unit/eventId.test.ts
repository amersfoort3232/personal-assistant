import { describe, expect, it } from 'vitest';
import { createGoogleEventId } from '../../src/main/google/eventId';

const block = {
  id: 'block-1', kind: 'task' as const, taskId: 'task-1', title: 'Study React',
  start: '2026-08-01T09:00:00+01:00', end: '2026-08-01T10:00:00+01:00',
  selected: true,
};

describe('Google event IDs', () => {
  it('is stable and uses only Google-valid base32hex characters', () => {
    const first = createGoogleEventId('calendar@example.com', block);
    const second = createGoogleEventId('calendar@example.com', block);

    expect(first).toBe(second);
    expect(first).toMatch(/^pa[0-9a-v]{20,}$/);
    expect(first.length).toBeLessThanOrEqual(1024);
  });

  it('changes when approved timing changes', () => {
    expect(createGoogleEventId('calendar@example.com', block)).not.toBe(
      createGoogleEventId('calendar@example.com', { ...block, end: '2026-08-01T10:05:00+01:00' }),
    );
  });

  it('changes when approved block content changes without revealing private plaintext', () => {
    const eventId = createGoogleEventId('calendar@example.com', block);

    expect(eventId).not.toBe(createGoogleEventId('calendar@example.com', { ...block, title: 'Personal study notes' }));
    expect(eventId).not.toContain('calendar');
    expect(eventId).not.toContain('block');
    expect(eventId).not.toContain('task');
    expect(eventId).not.toContain('study');
  });
});
