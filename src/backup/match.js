import { extractTitle } from '@/services/tags';

/**
 * Normalizes a url for matching: lowercase host, no default port, no fragment,
 * no trailing slash. Query and protocol are kept since they can change the page.
 * @param {string} url
 * @returns {string}
 */
export function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol}//${parsed.host}${path}${parsed.search}`;
  } catch {
    return String(url).trim();
  }
}

const samePath = (a, b) => a.path.length === b.path.length && a.path.every((folder, i) => folder === b.path[i]);
// Tags are stored in the title and may have changed since the backup
const sameTitle = (a, b) => extractTitle(a.title) === extractTitle(b.title);
const dateDistance = (a, b) => Math.abs((a.dateAdded ?? 0) - (b.dateAdded ?? 0));

// Matching rounds from strongest to weakest; each round only sees what is still unmatched
const ROUNDS = [
  (backup, candidates) => candidates.find((c) => samePath(backup, c) && sameTitle(backup, c)),
  (backup, candidates) => candidates.find((c) => sameTitle(backup, c)),
  (backup, candidates) => candidates.reduce(
    (best, c) => (!best || dateDistance(backup, c) < dateDistance(backup, best) ? c : best),
    null,
  ),
];

/**
 * Pairs backup bookmarks with current bookmarks. Bookmark ids differ between browser
 * profiles, so pairs are found by url, then folder path and title, then closest dateAdded.
 * Exact pairs are made first so a weak match never takes a bookmark another entry matches exactly.
 * @param {Array<{url: string, title: string, path: string[], dateAdded?: number}>} backupEntries
 * @param {Array<{url: string, title: string, path: string[], dateAdded?: number}>} currentEntries
 * @returns {{matches: Array<{backup: object, current: object}>, unmatched: Array<object>}}
 */
export function matchBookmarks(backupEntries, currentEntries) {
  const currentByUrl = Map.groupBy(currentEntries, (entry) => normalizeUrl(entry.url));
  const used = new Set();
  const pairs = new Map();

  ROUNDS.forEach((pick) => {
    backupEntries
      .filter((backup) => !pairs.has(backup))
      .forEach((backup) => {
        const candidates = (currentByUrl.get(normalizeUrl(backup.url)) ?? []).filter((c) => !used.has(c));
        const current = candidates.length > 0 ? pick(backup, candidates) : undefined;
        if (current) {
          used.add(current);
          pairs.set(backup, current);
        }
      });
  });

  return {
    matches: backupEntries.filter((b) => pairs.has(b)).map((backup) => ({ backup, current: pairs.get(backup) })),
    unmatched: backupEntries.filter((b) => !pairs.has(b)),
  };
}
