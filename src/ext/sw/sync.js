import { fetchUrl } from '@/services/httpClient';
import BookmarkStorage from '@/storage/bookmark';
import AttributeStorage from '@/storage/attribute';
import MetadataParser, { PAGE_FETCH_OPTIONS } from '@/parser/metadata';
import { getBookmarksSnapshot } from '@/services/browserBookmarks';
import runWithHostLimit, { hostOfUrl } from '@/services/hostPool';
import rebuildAttributes from '@/services/attributes';

const MAX_CONCURRENT = 80;
// Chrome opens at most 6 connections per host; more requests just queue and time out
const MAX_PER_HOST = 6;
const BATCH_SIZE = 100;
const PROGRESS_UPDATE_INTERVAL = 3000;
const FETCH_TIMEOUT = 8000;

const bookmarkStorage = new BookmarkStorage();
const attributeStorage = new AttributeStorage();

const sendProgress = (progress, savedCount) => {
  browser.storage.session.set({ progress });
  browser.runtime.sendMessage({ action: 'sync', data: { progress, savedCount } }).catch(() => {});
};

const fetchPageMetadata = async (bookmark, foldersMap) => {
  const response = await fetchUrl(bookmark.url, FETCH_TIMEOUT, PAGE_FETCH_OPTIONS);
  return (new MetadataParser(bookmark, response, foldersMap)).getFavboxBookmark();
};

const sync = async () => {
  console.time('Sync time');

  const [{ bookmarks, folders: foldersMap }, storedIds, { status }] = await Promise.all([
    getBookmarksSnapshot(),
    bookmarkStorage.getAllIds(),
    browser.storage.session.get('status'),
  ]);

  // Diff ids instead of totals: an add plus a delete leaves the totals equal.
  // Both lists come from the same moment, so bookmarks that onCreated stores
  // while this sync runs are never treated as outdated.
  const browserIds = new Set(bookmarks.map((bookmark) => bookmark.id));
  const existingIds = new Set(storedIds);
  const bookmarksToProcess = bookmarks
    .filter((bookmark) => !existingIds.has(bookmark.id))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const outdatedIds = storedIds.filter((id) => !browserIds.has(id));

  await browser.storage.session.set({ browserTotal: bookmarks.length, idbTotal: storedIds.length });
  console.log(`Browser: ${bookmarks.length}, IDB: ${storedIds.length}, Status: ${status}`);

  if ((bookmarksToProcess.length === 0 && outdatedIds.length === 0) || status) {
    await browser.storage.session.set({ status: true });
    console.log('Already in sync');
    return;
  }

  await browser.storage.session.set({ status: false });

  const batch = [];
  let processed = 0;
  let savedCount = 0;
  let lastProgressUpdate = Date.now();

  console.log(`To process: ${bookmarksToProcess.length}, outdated: ${outdatedIds.length}`);

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
    hostOf: ({ url }) => hostOfUrl(url),
  });
  await saveBatch();

  if (outdatedIds.length > 0) {
    console.log(`Removing ${outdatedIds.length} outdated bookmarks`);
    await bookmarkStorage.removeByIds(outdatedIds);
  }

  await rebuildAttributes(bookmarkStorage, attributeStorage);
  await browser.storage.session.set({ status: true });
  sendProgress(100, savedCount);

  console.timeEnd('Sync time');
  console.log(`Saved: ${savedCount}`);
};

export default sync;
