import BookmarkStorage from '@/storage/bookmark';
import {
  buildBackup, summarizeBackup, backupFileName, bookmarksFileName, detectBrowser,
} from './format';
import { readSettings } from './settings';
import { toNetscapeHtml } from './netscape';
import downloadText from './download';

const collectBackup = async ({ includeScreenshots, now }) => {
  const [tree, entities] = await Promise.all([
    browser.bookmarks.getTree(),
    new BookmarkStorage().findAll(),
  ]);
  const { name, version } = browser.runtime.getManifest();
  return buildBackup({
    tree,
    entities,
    settings: readSettings(localStorage),
    app: { name, version },
    browserName: detectBrowser(navigator.userAgent),
    includeScreenshots,
    exportedAt: now,
  });
};

/**
 * Exports the bookmark tree, the extension data and the settings to a JSON file.
 * @param {object} [options]
 * @param {boolean} [options.includeScreenshots] - Keep captured screenshots.
 * @param {Date} [options.now]
 * @returns {Promise<{bookmarks: number, folders: number, notes: number, pinned: number, screenshots: number}>}
 */
export default async function exportBackup({ includeScreenshots = true, now = new Date() } = {}) {
  const backup = await collectBackup({ includeScreenshots, now });
  downloadText(JSON.stringify(backup), backupFileName(now), 'application/json');
  await browser.storage.local.set({ lastBackupAt: now.getTime() });
  return summarizeBackup(backup);
}

/**
 * Exports the bookmarks as a Netscape HTML file that any browser can import.
 * Pins and screenshots are not part of that format, so this is not a backup.
 * @param {{now?: Date}} [options]
 * @returns {Promise<{bookmarks: number, folders: number, notes: number, pinned: number, screenshots: number}>}
 */
export async function exportHtml({ now = new Date() } = {}) {
  const backup = await collectBackup({ includeScreenshots: false, now });
  downloadText(toNetscapeHtml(backup), bookmarksFileName(now), 'text/html');
  return summarizeBackup(backup);
}
