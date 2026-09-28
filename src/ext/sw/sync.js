import { fetchUrl } from '@/services/httpClient';
import BookmarkStorage from '@/storage/bookmark';
import AttributeStorage from '@/storage/attribute';
import MetadataParser, { isHeadWithPreview } from '@/parser/metadata';
import { getBookmarksCount, getFoldersMap, getBookmarksIterator } from '@/services/browserBookmarks';
import runWithHostLimit from '@/services/hostPool';
import hashCode from '@/services/hash';

const MAX_CONCURRENT = 80;
// Chrome opens at most 6 connections per host; more requests just queue and time out
const MAX_PER_HOST = 6;
const BATCH_SIZE = 100;
const PROGRESS_UPDATE_INTERVAL = 3000;
const FETCH_TIMEOUT = 8000;
const FETCH_OPTIONS = {
  htmlOnly: true,
  maxBytes: 512 * 1024,
  isComplete: isHeadWithPreview,
};

const bookmarkStorage = new BookmarkStorage();
const attributeStorage = new AttributeStorage();

const sendProgress = (progress, savedCount) => {
  browser.storage.session.set({ progress });
  browser.runtime.sendMessage({ action: 'sync', data: { progress, savedCount } }).catch(() => {});
};

const fetchPageMetadata = async (bookmark, foldersMap) => {
  const response = await fetchUrl(bookmark.url, FETCH_TIMEOUT, FETCH_OPTIONS);
  return (new MetadataParser(bookmark, response, foldersMap)).getFavboxBookmark();
};

const hostOf = ({ url }) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

const toAttribute = (key, { value, count }) => ({
  key,
  value: String(value).trim(),
  id: hashCode(key, String(value).trim()),
  count,
});

export const refreshAttributes = async () => {
  console.time('refreshAttributes');

  await attributeStorage.clear();

  const [domains, tags, keywords] = await Promise.all([
    bookmarkStorage.aggregateDomains(),
    bookmarkStorage.aggregateTags(),
    bookmarkStorage.aggregateKeywords(),
  ]);

  const attributes = [
    ...domains.map((r) => toAttribute('domain', r)),
    ...tags.map((r) => toAttribute('tag', r)),
    ...keywords.map((r) => toAttribute('keyword', r)),
  ];

  await attributeStorage.saveMany(attributes);
  console.timeEnd('refreshAttributes');
};

const sync = async () => {
  console.time('Sync time');

  const [browserTotal, idbTotal, { status }] = await Promise.all([
    getBookmarksCount(),
    bookmarkStorage.total(),
    browser.storage.session.get('status'),
  ]);

  await browser.storage.session.set({ browserTotal, idbTotal });
  console.log(`Browser: ${browserTotal}, IDB: ${idbTotal}, Status: ${status}`);

  if (browserTotal === idbTotal || status) {
    await browser.storage.session.set({ status: true });
    console.log('Already in sync');
    return;
  }

  await browser.storage.session.set({ status: false });
  const [foldersMap, existingIds] = await Promise.all([
    getFoldersMap(),
    bookmarkStorage.getAllIds().then((ids) => new Set(ids)),
  ]);

  const browserIds = new Set();
  const batch = [];
  let processed = 0;
  let savedCount = 0;
  let lastProgressUpdate = Date.now();

  const bookmarksToProcess = [];
  for await (const bookmark of getBookmarksIterator()) {
    browserIds.add(bookmark.id);
    if (!existingIds.has(bookmark.id)) {
      bookmarksToProcess.push(bookmark);
    }
  }
  bookmarksToProcess.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  console.log(`To process: ${bookmarksToProcess.length}`);

  const saveBatch = async () => {
    // splice synchronously so concurrent workers never save the same items twice
    const itemsToSave = batch.splice(0);
    if (itemsToSave.length === 0) return;
    await bookmarkStorage.createMany(itemsToSave);
    savedCount += itemsToSave.length;
    console.log(`Saved batch: ${itemsToSave.length}, total: ${savedCount}`);
  };

  const reportProgress = () => {
    const now = Date.now();
    if (now - lastProgressUpdate > PROGRESS_UPDATE_INTERVAL) {
      const progress = Math.round((processed / bookmarksToProcess.length) * 100);
      sendProgress(progress, savedCount);
      lastProgressUpdate = now;
    }
  };

  const handleBookmark = async (bookmark) => {
    try {
      batch.push(await fetchPageMetadata(bookmark, foldersMap));
    } catch (error) {
      console.error(`Error processing ${bookmark.url}:`, error.message);
    } finally {
      processed++;
      reportProgress();
    }
    if (batch.length >= BATCH_SIZE) {
      await saveBatch();
    }
  };

  await runWithHostLimit(bookmarksToProcess, handleBookmark, {
    concurrency: MAX_CONCURRENT,
    perHost: MAX_PER_HOST,
    hostOf,
  });
  await saveBatch();

  const idbIds = await bookmarkStorage.getAllIds();
  const toDelete = idbIds.filter((id) => !browserIds.has(id));
  if (toDelete.length > 0) {
    console.log(`Removing ${toDelete.length} outdated bookmarks`);
    await bookmarkStorage.removeByIds(toDelete);
  }

  await refreshAttributes();
  await browser.storage.session.set({ status: true });
  sendProgress(100, savedCount);

  console.timeEnd('Sync time');
  console.log(`Saved: ${savedCount}`);
};

export default sync;
