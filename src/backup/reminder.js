export const REMIND_AFTER_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const daysSince = (timestamp, now) => Math.floor((now - timestamp) / DAY_MS);

/**
 * Tells whether to remind the user to back up. Only users with notes or pins
 * are reminded, since the browser already syncs everything else.
 * @param {object} params
 * @param {boolean} params.hasUserData - The user has pinned bookmarks (notes belong to them).
 * @param {number|null} [params.lastBackupAt]
 * @param {number|null} [params.dismissedAt] - When the reminder was last dismissed.
 * @param {number} params.now
 * @returns {boolean}
 */
export function shouldRemindBackup({
  hasUserData, lastBackupAt = null, dismissedAt = null, now,
}) {
  if (!hasUserData) return false;
  const isDue = lastBackupAt == null || daysSince(lastBackupAt, now) >= REMIND_AFTER_DAYS;
  const isSnoozed = dismissedAt != null && daysSince(dismissedAt, now) < REMIND_AFTER_DAYS;
  return isDue && !isSnoozed;
}

/**
 * @param {number|null|undefined} lastBackupAt
 * @param {number} now
 * @returns {string} "Never", "Today", "Yesterday" or "N days ago"
 */
export function formatLastBackup(lastBackupAt, now) {
  if (lastBackupAt == null) return 'Never';
  const days = daysSince(lastBackupAt, now);
  if (days < 1) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}
