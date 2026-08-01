import type { AppSettings } from '../../shared/domain';

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  timeZone: 'Europe/London',
  workingHours: { start: '09:00', end: '17:00' },
  workingDays: [0, 1, 2, 3, 4, 5, 6],
  breakAfterMinutes: 60,
  breakDurationMinutes: 10,
};
