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
  const visit = (node, root, rootIndex, path) => {
    if (node.type === 'bookmark') {
      return [{
        root, rootIndex, path, title: node.title, url: node.url, dateAdded: node.dateAdded, data: node.data ?? {},
      }];
    }
    return node.children.flatMap((child) => visit(child, root, rootIndex, [...path, node.title]));
  };
  return backup.tree.flatMap((node, index) => (node.type === 'folder'
    ? node.children.flatMap((child) => visit(child, node.title, index, []))
    : visit(node, null, index, [])));
}

// Root folder ids are fixed per browser, so they tell the role of each current root
const ROOT_ROLE_BY_ID = {
  1: 'toolbar',
  2: 'other',
  3: 'mobile',
  menu________: 'menu',
  toolbar_____: 'toolbar',
  unfiled_____: 'other',
  mobile______: 'mobile',
};
// Order of the root folders in a backup, by the browser it came from
const ROOT_ROLES_BY_BROWSER = {
  firefox: ['menu', 'toolbar', 'other', 'mobile'],
};
const CHROMIUM_ROOT_ROLES = ['toolbar', 'other', 'mobile'];

/**
 * Finds, for each top-level node of the backup, the current root folder to restore into:
 * same title first (same browser and language), then same role (bookmarks bar, other,
 * mobile), since names and order differ between browsers and languages.
 * Chrome has no bookmarks menu, so it maps to Other bookmarks.
 * @param {object} backup
 * @param {Array<object>} tree - Result of browser.bookmarks.getTree().
 * @returns {Array<{id: string, title: string}|null>} Indexed like backup.tree.
 */
export function resolveTargetRoots(backup, tree) {
  const roots = tree.flatMap((root) => root.children ?? []);
  const byRole = (role) => (role ? roots.find((root) => ROOT_ROLE_BY_ID[root.id] === role) : undefined);
  const roles = ROOT_ROLES_BY_BROWSER[backup.source?.browser] ?? CHROMIUM_ROOT_ROLES;
  return backup.tree.map((node, index) => {
    if (node.type !== 'folder') return byRole('other') ?? null;
    const role = roles[index];
    const target = roots.find((root) => root.title === node.title)
      ?? byRole(role)
      ?? (role === 'menu' ? byRole('other') : undefined);
    return target ?? null;
  }).map((root) => (root ? { id: root.id, title: root.title } : null));
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
 * pins are only added, images only fill a gap. Also used when applying,
 * against the row as it is at that moment.
 * @param {object} backupData
 * @param {object|null} row - Stored row, or null when there is none.
 * @returns {{changes: object, mergedNotes: boolean}}
 */
export const restoreChanges = (backupData, row) => {
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
  // A bookmark without a stored row gets one from the backup, so it needs no page fetch
  const updates = planned
    .filter(({ changes, current }) => Object.keys(changes).length > 0 || current.row === null)
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
  const targetRoots = resolveTargetRoots(backup, tree);
  const creates = unmatched.map((entry) => ({
    // Inside a restore folder the backup root becomes the first level
    folders: entry.root === null ? [...entry.path] : [entry.root, ...entry.path],
    // In the original location: this root of the current browser, then the same folders
    path: [...entry.path],
    target: targetRoots[entry.rootIndex],
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
