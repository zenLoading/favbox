import BookmarkStorage from '@/storage/bookmark';
import AttributeStorage from '@/storage/attribute';
import MetadataParser, { PAGE_FETCH_OPTIONS } from '@/parser/metadata';
import { fetchUrl } from '@/services/httpClient';
import { extractTitle, extractTags } from '@/services/tags';
import { getFoldersMap, getBookmarksFromNode } from '@/services/browserBookmarks';
import findActiveTabByUrl from '@/services/browserTabs';
import sync from './sync';
import ping from './ping';

const bookmarkStorage = new BookmarkStorage();
const attributeStorage = new AttributeStorage();

// https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers
const waitUntil = async (promise) => {
  const keepAlive = setInterval(browser.runtime.getPlatformInfo, 25 * 1000);
  try {
    await promise;
  } finally {
    clearInterval(keepAlive);
  }
};

browser.runtime.onInstalled.addListener(async () => {
  browser.contextMenus.create({ id: 'openPopup', title: 'Bookmark this page', contexts: ['all'] });
  await browser.alarms.create('healthcheck', { periodInMinutes: 0.5 });
  await browser.storage.session.set({ nativeImport: false });
  waitUntil(sync());
});

browser.runtime.onStartup.addListener(async () => {
  console.warn('Wake up..');
  await browser.storage.session.set({ nativeImport: false });
  const alarm = await browser.alarms.get('healthcheck');
  if (!alarm) {
    await browser.alarms.create('healthcheck', { periodInMinutes: 0.5 });
  }
  waitUntil(sync());
});

browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'healthcheck') {
    console.log('health check');
    await browser.storage.local.set({ lastHealthCheck: Date.now() });
  }
});

browser.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'openPopup') {
    browser.action.openPopup();
  }
});

// https:// developer.browser.com/docs/extensions/reference/bookmarks/#event-onCreated
browser.bookmarks.onCreated.addListener(async (id, bookmark) => {
  const { nativeImport } = await browser.storage.session.get('nativeImport');
  if (nativeImport === true) {
    return;
  }
  console.time(`bookmark-created-${id}`);
  console.warn('🎉 Handle bookmark create..', id, bookmark);
  if (bookmark.url === undefined) {
    console.warn('bad bookmark data', bookmark);
    return;
  }
  let response = null;

  const foldersMapPromise = getFoldersMap();

  // fetch HTML from the tab showing this page (content script), otherwise from the network
  const activeTab = await findActiveTabByUrl(bookmark.url);
  if (activeTab) {
    try {
      console.warn('requesting html from tab', activeTab);
      const content = await browser.tabs.sendMessage(activeTab.id, { action: 'getHTML' });
      response = { html: content?.html, error: 0 };
      console.warn('response from tab', response);
    } catch (e) {
      console.error('Content script is not available', e);
    }
  }
  if (response === null) {
    console.warn('Fetching data from internet.. 🌎', bookmark.url);
    response = await fetchUrl(bookmark.url, 15000, PAGE_FETCH_OPTIONS);
  }

  try {
    if (response === null) {
      throw new Error('No page data: response is null');
    }
    const foldersMap = await foldersMapPromise;
    const entity = await (new MetadataParser(bookmark, response, foldersMap)).getFavboxBookmark();
    if (entity.image === null && activeTab) {
      try {
        console.warn('📸 No image, take a screenshot', activeTab);
        const screenshot = await browser.tabs.captureVisibleTab(activeTab.windowId, { format: 'jpeg', quality: 10 });
        entity.image = screenshot;
      } catch (e) {
        console.error('📸', e);
      }
    }
    console.log('🔖 Entity', entity);
    await bookmarkStorage.create(entity);
    await attributeStorage.create(entity);
    refreshUserInterface();
    console.log('🎉 Bookmark has been created..');
  } catch (e) {
    console.error('🎉', e, id, bookmark);
  } finally {
    response = null;
  }
  console.timeEnd(`bookmark-created-${id}`);
});

// https://developer.chrome.com/docs/extensions/reference/bookmarks/#event-onChanged
browser.bookmarks.onChanged.addListener(async (id, changeInfo) => {
  console.time(`bookmark-changed-${id}`);
  try {
    const [bookmark] = await browser.bookmarks.get(id);
    // folder
    if (!bookmark.url) {
      // Only update if title actually changed
      if (changeInfo.title !== undefined) {
        await bookmarkStorage.updateBookmarksFolderName(bookmark.id, changeInfo.title);
        console.log('🔄 Folder has been updated..', id, changeInfo);
      }
    }
    // bookmark
    if (bookmark.url) {
      const oldBookmark = await bookmarkStorage.getById(id);
      // Only update if title actually changed (changeInfo.title contains new value)
      if (changeInfo.title !== undefined) {
        await bookmarkStorage.update(id, {
          title: extractTitle(changeInfo.title),
          tags: extractTags(changeInfo.title),
          url: bookmark.url,
          updatedAt: new Date().toISOString(),
        });
        const newBookmark = await bookmarkStorage.getById(id);
        if (oldBookmark && newBookmark) {
          await attributeStorage.update(newBookmark, oldBookmark);
        }
      } else {
        // Title didn't change, but url or other fields might have - update only url
        await bookmarkStorage.update(id, {
          url: bookmark.url,
          updatedAt: new Date().toISOString(),
        });
      }
      console.log('🔄 Bookmark has been updated..', id, changeInfo);
    }
  } catch (e) {
    console.error('🔄', e, id, changeInfo);
  }
  refreshUserInterface();
  console.timeEnd(`bookmark-changed-${id}`);
});

// https://developer.chrome.com/docs/extensions/reference/bookmarks/#event-onMoved
browser.bookmarks.onMoved.addListener(async (id, moveInfo) => {
  console.time(`bookmark-moved-${id}`);
  try {
    const [item] = await browser.bookmarks.get(id);
    // Only process bookmarks (with url), not folders
    if (item.url) {
      const [folder] = await browser.bookmarks.get(moveInfo.parentId);
      console.log('🗂 Bookmark has been moved..', id, moveInfo, folder);
      await bookmarkStorage.update(id, {
        folderName: folder.title,
        folderId: folder.id,
        updatedAt: new Date().toISOString(),
      });
      refreshUserInterface();
    } else {
      // Folder moved - update folderName for all bookmarks in this folder
      console.log('🗂 Folder has been moved..', id, moveInfo);
      await bookmarkStorage.updateBookmarksFolderName(id, item.title);
      refreshUserInterface();
    }
  } catch (e) {
    console.error('🗂', e, id, moveInfo);
  }
  console.timeEnd(`bookmark-moved-${id}`);
});

// https://developer.chrome.com/docs/extensions/reference/bookmarks/#event-onRemoved
browser.bookmarks.onRemoved.addListener(async (id, removeInfo) => {
  console.time(`bookmark-removed-${id}`);
  console.log('🗑️ Handle remove bookmark..', id, removeInfo);
  // folder has been deleted..
  if (removeInfo.node.children !== undefined) {
    try {
      const items = getBookmarksFromNode(removeInfo.node);
      const bookmarksToRemove = items.map((bookmark) => bookmark.id);
      if (bookmarksToRemove.length) {
        await bookmarkStorage.removeByIds(bookmarksToRemove);
        // Full refresh after folder deletion
        const [domains, tags, keywords] = await Promise.all([
          bookmarkStorage.aggregateDomains(),
          bookmarkStorage.aggregateTags(),
          bookmarkStorage.aggregateKeywords(),
        ]);
        await attributeStorage.refreshFromAggregated(domains, tags, keywords, true);
        console.log('🗑️ Folder has been removed..', bookmarksToRemove.length, id, removeInfo);
      }
      refreshUserInterface();
    } catch (e) {
      console.error('🗑️ Remove err', e);
    }
    return;
  }
  // single bookmark has been deleted..
  try {
    const bookmark = await bookmarkStorage.getById(id);
    if (!bookmark) {
      // Bookmark not found in storage - might have been deleted already or never synced
      console.warn(`Bookmark with ID ${id} not found in storage, skipping removal.`);
      return;
    }
    await bookmarkStorage.removeById(id);
    await attributeStorage.remove(bookmark);
    console.log('🗑️ Bookmark has been removed..', id, removeInfo);
    refreshUserInterface();
  } catch (e) {
    console.error('🗑️', e);
  }
  console.timeEnd(`bookmark-removed-${id}`);
});

// https://developer.chrome.com/docs/extensions/reference/api/bookmarks#event-onImportBegan
browser.bookmarks.onImportBegan.addListener(async () => {
  console.log('📄 Import bookmarks started');
  await browser.storage.session.set({ nativeImport: true });
  await browser.storage.session.set({ status: false });
});

// https://developer.chrome.com/docs/extensions/reference/api/bookmarks#event-onImportEnded
browser.bookmarks.onImportEnded.addListener(async () => {
  console.log('📄 Import bookmarks ended');
  await browser.storage.session.set({ nativeImport: false });
  waitUntil(sync());
});

function refreshUserInterface() {
  try {
    browser.runtime.sendMessage({ action: 'refresh' });
  } catch (e) {
    console.error('Refresh UI listener not available', e);
  }
}
ping();
