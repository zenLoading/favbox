import BookmarkStorage from '@/storage/bookmark';
import AttributeStorage from '@/storage/attribute';
import rebuildAttributes from '@/services/attributes';
import { hostOfUrl } from '@/services/hostPool';
import { extractTitle, extractTags } from '@/services/tags';
import { restoreChanges } from './plan';

const ROW_BATCH_SIZE = 100;
const WEB_PROTOCOLS = new Set(['http:', 'https:']);

const bookmarkStorage = new BookmarkStorage();
const attributeStorage = new AttributeStorage();

const isWebUrl = (url) => {
  try {
    return WEB_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
};

const pad = (value) => String(value).padStart(2, '0');

const notifyPages = () => {
  // Open extension pages listen for this to reload their lists
  browser.runtime.sendMessage({ action: 'refresh' }).catch(() => {});
};

const failure = ({ title, url }, error) => ({ title, url, reason: error?.message ?? String(error) });

// Attributes are derived data and get rebuilt on the next sync, so a failure here must not fail the restore
const refreshAttributes = async () => {
  try {
    await rebuildAttributes(bookmarkStorage, attributeStorage);
  } catch (e) {
    console.error('Failed to rebuild attributes after restore', e);
  }
};

/**
 * @param {Date} date
 * @returns {string} e.g. "FavBox restore 2026-09-28" (local date)
 */
export function restoreFolderTitle(date) {
  return `FavBox restore ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Builds a stored row from a browser bookmark node and its backup data,
 * so restored bookmarks do not need their page fetched again.
 * @param {{id: string, parentId: string, title: string, url: string, dateAdded?: number}} node
 * @param {string} folderName
 * @param {object} data - Backup data of the bookmark.
 * @param {number} [dateAdded] - Original date from the backup; the browser sets a new one on create.
 * @param {Date} [now]
 * @returns {object}
 */
export function rowFromBackup(node, folderName, data, dateAdded, now = new Date()) {
  const domain = hostOfUrl(node.url).replace(/^www\./, '');
  const timestamp = now.toISOString();
  return {
    id: node.id,
    folderId: node.parentId,
    folderName,
    title: extractTitle(node.title),
    tags: extractTags(node.title),
    url: node.url,
    domain,
    description: data.description ?? null,
    favicon: data.favicon ?? `https://${domain}/favicon.ico`,
    image: data.image ?? null,
    keywords: data.keywords ?? [],
    notes: data.notes ?? '',
    pinned: data.pinned === 1 ? 1 : 0,
    httpStatus: data.httpStatus ?? 200,
    dateAdded: dateAdded ?? node.dateAdded ?? now.getTime(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/**
 * Builds the row of a bookmark that exists in the browser but is not stored yet.
 * Throws when the bookmark was deleted since the preview.
 */
const rowForUnstoredBookmark = async (update) => {
  const [node] = await browser.bookmarks.get(update.id);
  const [parent] = await browser.bookmarks.get(node.parentId);
  return rowFromBackup(node, parent.title, update.backupData, update.dateAdded);
};

/**
 * Applies one planned update. Changes are recomputed against the row as it is now,
 * so notes edited after the preview are merged instead of overwritten.
 * @returns {Promise<'updated'|'merged'|'unchanged'|{row: object}>}
 */
const applyUpdate = async (update) => {
  const row = await bookmarkStorage.getById(update.id);
  if (!row) return { row: await rowForUnstoredBookmark(update) };

  const { changes, mergedNotes } = restoreChanges(update.backupData, row);
  if (Object.keys(changes).length === 0) return 'unchanged';
  await bookmarkStorage.update(update.id, { ...changes, updatedAt: new Date().toISOString() });
  return mergedNotes ? 'merged' : 'updated';
};

/**
 * Restores notes, pins and screenshots onto existing bookmarks.
 * @param {Array<object>} updates - planRestore().updates
 * @param {{onProgress?: (progress: {done: number, total: number}) => void}} [options]
 * @returns {Promise<{updated: number, created: number, merged: number, unchanged: number, failed: Array<object>}>}
 */
export async function applyDataUpdates(updates, { onProgress } = {}) {
  const result = {
    updated: 0, created: 0, merged: 0, unchanged: 0, failed: [],
  };
  const newRows = [];
  for (const [index, update] of updates.entries()) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const outcome = await applyUpdate(update);
      if (typeof outcome === 'object') {
        newRows.push({ update, row: outcome.row });
      } else {
        if (outcome === 'merged') result.merged += 1;
        result[outcome === 'unchanged' ? 'unchanged' : 'updated'] += 1;
      }
    } catch (e) {
      result.failed.push(failure(update, e));
    }
    onProgress?.({ done: index + 1, total: updates.length });
  }
  if (newRows.length > 0) {
    try {
      await bookmarkStorage.createMany(newRows.map(({ row }) => row));
      result.created = newRows.length;
    } catch (e) {
      result.failed.push(...newRows.map(({ update }) => failure(update, e)));
    }
    await refreshAttributes();
  }
  notifyPages();
  return result;
}

/**
 * Returns the id of the folder for a path inside the restore folder, creating missing folders once.
 */
const ensureFolder = async (folders, cache) => {
  let parentId = cache.get('');
  for (let depth = 1; depth <= folders.length; depth++) {
    const key = folders.slice(0, depth).join('\u0000');
    if (!cache.has(key)) {
      // eslint-disable-next-line no-await-in-loop
      const folder = await browser.bookmarks.create({ parentId, title: folders[depth - 1] });
      cache.set(key, folder.id);
    }
    parentId = cache.get(key);
  }
  return parentId;
};

/**
 * Creates one bookmark in its folder and builds its row from the backup data.
 * @returns {Promise<object>} The row to store.
 */
const createBookmark = async (item, folderIds, folderTitle) => {
  if (!isWebUrl(item.url)) throw new Error('Only http and https links can be restored');
  const parentId = await ensureFolder(item.folders, folderIds);
  const node = await browser.bookmarks.create({ parentId, title: item.title, url: item.url });
  return rowFromBackup(node, item.folders.at(-1) ?? folderTitle, item.data, item.dateAdded);
};

/**
 * Recreates missing bookmarks inside a new restore folder, keeping their folder path.
 * Page fetching by the service worker is paused meanwhile: rows come from the backup.
 * @param {Array<object>} creates - planRestore().creates
 * @param {{folderTitle: string, onProgress?: (progress: {done: number, total: number}) => void}} options
 * @returns {Promise<{folderId: string, folders: number, bookmarks: number, failed: Array<object>}>}
 */
export async function applyCreates(creates, { folderTitle, onProgress }) {
  const failed = [];
  const pending = [];
  let bookmarks = 0;
  // A failed write only loses the data of its own batch; the bookmarks exist and sync refetches them later
  const flush = async () => {
    const batch = pending.splice(0);
    if (batch.length === 0) return;
    try {
      await bookmarkStorage.createMany(batch.map(({ row }) => row));
      bookmarks += batch.length;
    } catch (e) {
      failed.push(...batch.map(({ item }) => failure(item, e)));
    }
  };

  await browser.storage.session.set({ nativeImport: true });
  let root;
  const folderIds = new Map();
  try {
    // No parentId: Chrome and Firefox both use "Other bookmarks"
    root = await browser.bookmarks.create({ title: folderTitle });
    folderIds.set('', root.id);
    for (const [index, item] of creates.entries()) {
      try {
        // Sequential on purpose: keeps the original order and creates each folder once
        // eslint-disable-next-line no-await-in-loop
        pending.push({ item, row: await createBookmark(item, folderIds, folderTitle) });
      } catch (e) {
        failed.push(failure(item, e));
      }
      // eslint-disable-next-line no-await-in-loop
      if (pending.length >= ROW_BATCH_SIZE) await flush();
      onProgress?.({ done: index + 1, total: creates.length });
    }
    await flush();
  } finally {
    await browser.storage.session.set({ nativeImport: false });
  }
  await refreshAttributes();
  notifyPages();
  return {
    folderId: root.id, folders: folderIds.size, bookmarks, failed,
  };
}
