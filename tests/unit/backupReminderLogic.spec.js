import { describe, expect, it } from 'vitest';
import { REMIND_AFTER_DAYS, shouldRemindBackup, formatLastBackup } from '@/backup/reminder';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date(2026, 8, 28, 12, 0).getTime();

describe('shouldRemindBackup', () => {
  it('never reminds users without notes or pins', () => {
    expect(shouldRemindBackup({ hasUserData: false, lastBackupAt: null, now })).toBe(false);
  });

  it('reminds users with data who never backed up', () => {
    expect(shouldRemindBackup({ hasUserData: true, lastBackupAt: null, now })).toBe(true);
  });

  it('reminds only once the last backup is old enough', () => {
    const recent = now - (REMIND_AFTER_DAYS - 1) * DAY;
    const old = now - REMIND_AFTER_DAYS * DAY;

    expect(shouldRemindBackup({ hasUserData: true, lastBackupAt: recent, now })).toBe(false);
    expect(shouldRemindBackup({ hasUserData: true, lastBackupAt: old, now })).toBe(true);
  });

  it('stays quiet for a while after being dismissed', () => {
    const base = { hasUserData: true, lastBackupAt: null, now };

    expect(shouldRemindBackup({ ...base, dismissedAt: now - DAY })).toBe(false);
    expect(shouldRemindBackup({ ...base, dismissedAt: now - REMIND_AFTER_DAYS * DAY })).toBe(true);
  });

  it('uses 30 days', () => {
    expect(REMIND_AFTER_DAYS).toBe(30);
  });
});

describe('formatLastBackup', () => {
  it.each([
    [null, 'Never'],
    [undefined, 'Never'],
    [now - 60 * 1000, 'Today'],
    [now - DAY, 'Yesterday'],
    [now - 3 * DAY - 1000, '3 days ago'],
  ])('%s -> %s', (lastBackupAt, expected) => {
    expect(formatLastBackup(lastBackupAt, now)).toBe(expected);
  });
});
