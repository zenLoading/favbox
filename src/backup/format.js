export const BACKUP_FORMAT = 'favbox-backup';
export const BACKUP_VERSION = 1;

// Extension-only data worth keeping. Ids are left out on purpose:
// browser bookmark ids are only valid inside one browser profile.
const DATA_FIELDS = ['notes', 'pinned', 'description', 'favicon', 'image', 'keywords', 'httpStatus'];

const isScreenshot = (image) => typeof image === 'string' && image.startsWith('data:');

/**
 * Picks the extension data of a stored bookmark.
 * @param {object} entity - Stored bookmark row.
 * @param {boolean} includeScreenshots
 * @returns {object}
 */
const pickData = (entity, includeScreenshots) => Object.fromEntries(
  DATA_FIELDS
    .filter((field) => entity[field] !== undefined && entity[field] !== null)
    .filter((field) => includeScreenshots || field !== 'image' || !isScreenshot(entity[field]))
    .map((field) => [field, entity[field]]),
);

/**
 * Converts a browser bookmark tree node into a backup node.
 * @returns {object|null} null for nodes that are neither bookmarks nor folders (e.g. separators).
 */
const toBackupNode = (node, entitiesById, includeScreenshots) => {
  if (node.url) {
    const entity = entitiesById.get(node.id);
    return {
      type: 'bookmark',
      title: node.title,
      url: node.url,
      dateAdded: node.dateAdded,
      ...(entity && { data: pickData(entity, includeScreenshots) }),
    };
  }
  if (node.children || node.type === 'folder') {
    return {
      type: 'folder',
      title: node.title,
      children: (node.children ?? [])
        .map((child) => toBackupNode(child, entitiesById, includeScreenshots))
        .filter(Boolean),
    };
  }
  return null;
};

/**
 * Builds a backup of the bookmark tree with the extension data attached to each bookmark.
 * @param {object} params
 * @param {Array<object>} params.tree - Result of browser.bookmarks.getTree().
 * @param {Array<object>} params.entities - Stored bookmark rows.
 * @param {object} params.settings - See readSettings().
 * @param {{name: string, version: string}} params.app
 * @param {string} params.browserName
 * @param {boolean} [params.includeScreenshots] - Keep captured screenshots (data URLs).
 * @param {Date} [params.exportedAt]
 * @returns {object}
 */
export function buildBackup({
  tree, entities, settings, app, browserName, includeScreenshots = true, exportedAt = new Date(),
}) {
  const entitiesById = new Map(entities.map((entity) => [entity.id, entity]));
  // The browser root has no title and cannot be recreated; its children are the real roots
  const roots = tree.flatMap((root) => root.children ?? []);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: exportedAt.toISOString(),
    app: { name: app.name, version: app.version },
    source: { browser: browserName },
    options: { includeScreenshots },
    settings: { ...settings },
    tree: roots
      .map((node) => toBackupNode(node, entitiesById, includeScreenshots))
      .filter(Boolean),
  };
}

/**
 * Counts what a backup contains.
 * @param {object} backup
 * @returns {{bookmarks: number, folders: number, notes: number, pinned: number, screenshots: number}}
 */
export function summarizeBackup(backup) {
  const summary = { bookmarks: 0, folders: 0, notes: 0, pinned: 0, screenshots: 0 };
  const visit = (node) => {
    if (node.type === 'folder') {
      summary.folders += 1;
      node.children.forEach(visit);
      return;
    }
    summary.bookmarks += 1;
    if (node.data?.notes) summary.notes += 1;
    if (node.data?.pinned) summary.pinned += 1;
    if (isScreenshot(node.data?.image)) summary.screenshots += 1;
  };
  backup.tree.forEach(visit);
  return summary;
}

const pad = (value) => String(value).padStart(2, '0');

// e.g. 20260928-0905 (local time)
const fileStamp = (date) => {
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  return `${day}-${pad(date.getHours())}${pad(date.getMinutes())}`;
};

/**
 * @param {Date} date
 * @returns {string} e.g. favbox-backup-20260928-0905.json
 */
export function backupFileName(date) {
  return `${BACKUP_FORMAT}-${fileStamp(date)}.json`;
}

/**
 * @param {Date} date
 * @returns {string} e.g. favbox-bookmarks-20260928-0905.html
 */
export function bookmarksFileName(date) {
  return `favbox-bookmarks-${fileStamp(date)}.html`;
}

/**
 * @param {string} userAgent
 * @returns {'firefox'|'edge'|'chrome'}
 */
export function detectBrowser(userAgent) {
  if (/Firefox\//.test(userAgent)) return 'firefox';
  if (/Edg\//.test(userAgent)) return 'edge';
  return 'chrome';
}

/**
 * Size of the captured screenshots (data URLs) a backup would include.
 * @param {Array<object>} rows - Stored bookmark rows.
 * @returns {number} Approximate size in bytes.
 */
export function estimateScreenshotBytes(rows) {
  return rows.reduce((sum, row) => sum + (isScreenshot(row.image) ? row.image.length : 0), 0);
}

const BYTE_UNITS = ['KB', 'MB', 'GB'];

/**
 * @param {number} bytes
 * @returns {string} e.g. "900 B", "4.2 MB"
 */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${BYTE_UNITS[unit]}`;
}
