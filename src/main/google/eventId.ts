import { createHash } from 'node:crypto';
import type { ScheduleBlock } from '../../shared/domain';

const ALPHABET = '0123456789abcdefghijklmnopqrstuv';

function base32Hex(buffer: Buffer): string {
  let output = '';
  let carry = 0;
  let bitCount = 0;

  for (const byte of buffer) {
    carry = (carry << 8) | byte;
    bitCount += 8;

    while (bitCount >= 5) {
      bitCount -= 5;
      output += ALPHABET[(carry >> bitCount) & 31];
    }
  }

  if (bitCount > 0) output += ALPHABET[(carry << (5 - bitCount)) & 31];
  return output;
}

export function createGoogleEventId(calendarId: string, block: ScheduleBlock): string {
  const material = JSON.stringify([
    calendarId,
    block.id,
    block.kind,
    block.taskId ?? null,
    block.title,
    block.start,
    block.end,
    block.selected,
    block.sessionIndex ?? null,
    block.sessionCount ?? null,
  ]);

  const digest = createHash('sha256').update(material).digest();
  return `pa${base32Hex(digest).slice(0, 40)}`;
}
