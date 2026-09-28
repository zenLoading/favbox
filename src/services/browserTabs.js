/**
 * Finds the active tab of the last focused window if it shows the given url.
 * Guards against reading HTML from an unrelated page (another window,
 * bookmarks synced from another device, created via bookmark manager, etc.).
 * @param {string} url - The bookmark url.
 * @returns {Promise<browser.tabs.Tab|null>}
 */
export default async function findActiveTabByUrl(url) {
  try {
    const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    return tab?.url === url ? tab : null;
  } catch (e) {
    console.error('Failed to query active tab', e);
    return null;
  }
}
