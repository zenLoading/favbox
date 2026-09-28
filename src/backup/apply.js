import BookmarkStorage from '@/storage/bookmark';
import AttributeStorage from '@/storage/attribute';
import rebuildAttributes from '@/services/attributes';
import { hostOfUrl } from '@/services/hostPool';
import { extractTitle, extractTags } from '@/services/tags';
import { restoreChanges } from './plan';

const ROW_BATCH_SIZE = 100;
// JsStore never settles when its worker rejects a message; without a limit the restore would
// hang with page fetching paused (nativeImport) until the browser restarts
export const WRITE_TIMEOUT_MS = 30000;
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

const withTimeout = (promise, ms) => {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Saving did not finish within ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

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
    // Copied: rows are structured-cloned into the JsStore worker, and a Vue proxy cannot be
    keywords: [...(data.keywords ?? [])],
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
 * Finds folders by title under a parent, creating the missing ones once.
 * The restore folder is created only when first needed.
 * @param {string} folderTitle - Title of the restore folder.
 */
const createFolderResolver = (folderTitle) => {
  const known = new Map();
  let restoreFolderId = null;
  let created = 0;

  const child = async (parentId, title) => {
    const key = `${parentId}\u0000${title}`;
    if (!known.has(key)) {
      const existing = (await browser.bookmarks.getChildren(parentId)).find((c) => !c.url && c.title === title);
      const folder = existing ?? await browser.bookmarks.create({ parentId, title });
      if (!existing) created += 1;
      known.set(key, folder.id);
    }
    return known.get(key);
  };

  return {
    folderTitle,
    path: async (parentId, titles) => {
      let id = parentId;
      for (const title of titles) {
        // eslint-disable-next-line no-await-in-loop
        id = await child(id, title);
      }
      return id;
    },
    restoreFolder: async () => {
      if (!restoreFolderId) {
        // No parentId: Chrome and Firefox both use "Other bookmarks"
        restoreFolderId = (await browser.bookmarks.create({ title: folderTitle })).id;
        created += 1;
      }
      return restoreFolderId;
    },
    stats: () => ({ restoreFolderId, created }),
  };
};

/**
 * Picks the folder for a bookmark: its original folder when asked and its root was found,
 * otherwise the same path inside the restore folder.
 * @returns {Promise<{parentId: string, folderName: string, fallback: boolean}>}
 */
const findParent = async (item, placement, folders) => {
  if (placement === 'original' && item.target) {
    return {
      parentId: await folders.path(item.target.id, item.path),
      folderName: item.path.at(-1) ?? item.target.title,
      fallback: false,
    };
  }
  return {
    parentId: await folders.path(await folders.restoreFolder(), item.folders),
    folderName: item.folders.at(-1) ?? folders.folderTitle,
    fallback: placement === 'original',
  };
};

/**
 * Creates one bookmark in its folder and builds its row from the backup data.
 * @returns {Promise<{row: object, fallback: boolean}>}
 */
const createBookmark = async (item, placement, folders) => {
  if (!isWebUrl(item.url)) throw new Error('Only http and https links can be restored');
  const { parentId, folderName, fallback } = await findParent(item, placement, folders);
  const node = await browser.bookmarks.create({ parentId, title: item.title, url: item.url });
  return { row: rowFromBackup(node, folderName, item.data, item.dateAdded), fallback };
};

/**
 * Recreates missing bookmarks, keeping their folder path. With placement 'original' they go
 * back to their original folders (existing folders are reused); bookmarks whose root folder
 * cannot be found, and all of them with 'restoreFolder', go into a new restore folder.
 * Page fetching by the service worker is paused meanwhile: rows come from the backup.
 * @param {Array<object>} creates - planRestore().creates
 * @param {{folderTitle: string, placement?: 'original'|'restoreFolder',
 *   onProgress?: (progress: {done: number, total: number}) => void}} options
 * @returns {Promise<{folderId: string|null, folders: number, bookmarks: number, fallback: number,
 *   failed: Array<object>}>}
 */
export async function applyCreates(creates, { folderTitle, placement = 'restoreFolder', onProgress }) {
  const failed = [];
  const pending = [];
  let bookmarks = 0;
  let fallback = 0;
  // A failed write only loses the data of its own batch; the bookmarks exist and sync refetches them later
  const flush = async () => {
    const batch = pending.splice(0);
    if (batch.length === 0) return;
    try {
      await withTimeout(bookmarkStorage.createMany(batch.map(({ row }) => row)), WRITE_TIMEOUT_MS);
      bookmarks += batch.length;
    } catch (e) {
      failed.push(...batch.map(({ item }) => failure(item, e)));
    }
  };

  await browser.storage.session.set({ nativeImport: true });
  const folders = createFolderResolver(folderTitle);
  try {
    // Everything goes into the restore folder: fail early if it cannot be created
    if (placement !== 'original') await folders.restoreFolder();
    for (const [index, item] of creates.entries()) {
      try {
        // Sequential on purpose: keeps the original order and creates each folder once
        // eslint-disable-next-line no-await-in-loop
        const created = await createBookmark(item, placement, folders);
        pending.push({ item, row: created.row });
        if (created.fallback) fallback += 1;
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
  const { restoreFolderId, created } = folders.stats();
  return {
    folderId: restoreFolderId, folders: created, bookmarks, fallback, failed,
  };
}
