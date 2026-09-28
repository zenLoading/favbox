import { matchBookmarks } from './match';

// Inserted between existing notes and restored notes; TipTap renders it as a divider
export const NOTES_SEPARATOR = '<hr>';

// An empty TipTap editor saves "<p></p>"
const hasNotes = (notes) => typeof notes === 'string' && notes.replace(/<p>\s*<\/p>/g, '').trim() !== '';

/**
 * Lists the bookmarks of a validated backup. `root` is the top-level folder
 * (its name depends on the browser), `path` the folders below it.
 * @param {object} backup
 * @returns {Array<{root: string|null, path: string[], title: string, url: string, dateAdded?: number, data: object}>}
 */
export function flattenBackup(backup) {
  const visit = (node, root, path) => {
    if (node.type === 'bookmark') {
      return [{
        root, path, title: node.title, url: node.url, dateAdded: node.dateAdded, data: node.data ?? {},
      }];
    }
    return node.children.flatMap((child) => visit(child, root, [...path, node.title]));
  };
  return backup.tree.flatMap((node) => (node.type === 'folder'
    ? node.children.flatMap((child) => visit(child, node.title, []))
    : visit(node, null, [])));
}

/**
 * Lists the bookmarks of browser.bookmarks.getTree() with their stored row.
 * @param {Array<object>} tree
 * @param {Array<object>} rows - Stored bookmark rows.
 * @returns {Array<{id: string, path: string[], title: string, url: string, dateAdded?: number, row: object|null}>}
 */
export function flattenBrowserTree(tree, rows) {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const visit = (node, path) => {
    if (node.url) {
      return [{
        id: node.id, path, title: node.title, url: node.url, dateAdded: node.dateAdded, row: rowsById.get(node.id) ?? null,
      }];
    }
    return (node.children ?? []).flatMap((child) => visit(child, [...path, node.title]));
  };
  // Skip the unnamed browser root and the top-level folders, like flattenBackup
  const roots = tree.flatMap((root) => root.children ?? []);
  return roots.flatMap((root) => (root.children ?? []).flatMap((child) => visit(child, [])));
}

/**
 * Works out which fields to restore. Never overwrites: notes are appended,
 * pins are only added, images only fill a gap.
 * @returns {{changes: object, mergedNotes: boolean}}
 */
const restoreChanges = (backupData, row) => {
  const changes = {};
  let mergedNotes = false;
  if (hasNotes(backupData.notes)) {
    const current = row?.notes;
    if (!hasNotes(current)) {
      changes.notes = backupData.notes;
    } else if (!current.includes(backupData.notes)) {
      changes.notes = `${current}${NOTES_SEPARATOR}${backupData.notes}`;
      mergedNotes = true;
    }
  }
  if (backupData.pinned === 1 && row?.pinned !== 1) changes.pinned = 1;
  if (backupData.image && !row?.image) changes.image = backupData.image;
  return { changes, mergedNotes };
};

/**
 * Plans a restore without changing anything, so it can be previewed.
 * @param {object} backup - Validated backup (see validateBackup).
 * @param {Array<object>} tree - Result of browser.bookmarks.getTree().
 * @param {Array<object>} rows - Stored bookmark rows.
 * @returns {{updates: Array<object>, creates: Array<object>, summary: object}}
 */
export function planRestore(backup, tree, rows) {
  const { matches, unmatched } = matchBookmarks(flattenBackup(backup), flattenBrowserTree(tree, rows));

  const planned = matches.map(({ backup: entry, current }) => ({
    entry, current, ...restoreChanges(entry.data, current.row),
  }));
  const updates = planned
    .filter(({ changes }) => Object.keys(changes).length > 0)
    .map(({
      entry, current, changes, mergedNotes,
    }) => ({
      id: current.id,
      title: current.title,
      url: current.url,
      rowMissing: current.row === null,
      changes,
      mergedNotes,
      backupData: entry.data,
      dateAdded: entry.dateAdded,
    }));
  const creates = unmatched.map((entry) => ({
    folders: entry.root === null ? [...entry.path] : [entry.root, ...entry.path],
    title: entry.title,
    url: entry.url,
    dateAdded: entry.dateAdded,
    data: entry.data,
  }));

  return {
    updates,
    creates,
    summary: {
      matched: matches.length,
      toUpdate: updates.length,
      mergedNotes: updates.filter((u) => u.mergedNotes).length,
      unchanged: matches.length - updates.length,
      toCreate: creates.length,
    },
  };
}
