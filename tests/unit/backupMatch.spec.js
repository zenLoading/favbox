import { describe, expect, it } from 'vitest';
import { normalizeUrl, matchBookmarks } from '@/backup/match';

const entry = (overrides = {}) => ({
  url: 'https://site.com/a', title: 'Site', path: ['Dev'], dateAdded: 1000, ...overrides,
});

describe('normalizeUrl', () => {
  it.each([
    ['https://Site.COM/a/', 'https://site.com/a'],
    ['https://site.com/a#section', 'https://site.com/a'],
    ['https://site.com/', 'https://site.com'],
    ['https://site.com', 'https://site.com'],
    ['https://site.com:443/a', 'https://site.com/a'],
    ['https://site.com/a?b=1&c=2', 'https://site.com/a?b=1&c=2'],
    ['https://site.com/a/?b=1#x', 'https://site.com/a?b=1'],
  ])('%s -> %s', (url, expected) => {
    expect(normalizeUrl(url)).toBe(expected);
  });

  it('keeps http and https apart', () => {
    expect(normalizeUrl('http://site.com/a')).not.toBe(normalizeUrl('https://site.com/a'));
  });

  it('returns invalid urls trimmed instead of throwing', () => {
    expect(normalizeUrl('  not a url ')).toBe('not a url');
  });
});

describe('matchBookmarks', () => {
  it('matches the only bookmark with the same url', () => {
    const backup = [entry({ title: 'Old title' })];
    const current = [entry({ id: '7', url: 'https://SITE.com/a/', title: 'New title', path: ['Elsewhere'] })];

    const { matches, unmatched } = matchBookmarks(backup, current);

    expect(matches).toEqual([{ backup: backup[0], current: current[0] }]);
    expect(unmatched).toEqual([]);
  });

  it('reports backup bookmarks without a current bookmark as unmatched', () => {
    const backup = [entry(), entry({ url: 'https://gone.com/' })];
    const current = [entry({ id: '1' })];

    const { matches, unmatched } = matchBookmarks(backup, current);

    expect(matches).toHaveLength(1);
    expect(unmatched).toEqual([backup[1]]);
  });

  it('prefers the same folder path and title among bookmarks with the same url', () => {
    const backup = [entry({ path: ['Work'], title: 'Docs' })];
    const current = [
      entry({ id: '1', path: ['Home'], title: 'Docs' }),
      entry({ id: '2', path: ['Work'], title: 'Docs' }),
    ];

    expect(matchBookmarks(backup, current).matches[0].current.id).toBe('2');
  });

  it('then prefers the same title, ignoring tags in it', () => {
    const backup = [entry({ path: ['Gone'], title: 'Docs 🏷 #old' })];
    const current = [
      entry({ id: '1', path: ['Home'], title: 'Other' }),
      entry({ id: '2', path: ['Work'], title: 'Docs 🏷 #new' }),
    ];

    expect(matchBookmarks(backup, current).matches[0].current.id).toBe('2');
  });

  it('then picks the closest dateAdded', () => {
    const backup = [entry({ title: 'X', path: [], dateAdded: 5000 })];
    const current = [
      entry({ id: '1', title: 'A', dateAdded: 1000 }),
      entry({ id: '2', title: 'B', dateAdded: 4900 }),
      entry({ id: '3', title: 'C', dateAdded: 9000 }),
    ];

    expect(matchBookmarks(backup, current).matches[0].current.id).toBe('2');
  });

  it('never uses a current bookmark twice', () => {
    const backup = [entry({ title: 'A' }), entry({ title: 'B' })];
    const current = [entry({ id: '1', title: 'A' })];

    const { matches, unmatched } = matchBookmarks(backup, current);

    expect(matches.map((m) => m.current.id)).toEqual(['1']);
    expect(unmatched).toEqual([backup[1]]);
  });

  it('gives exact matches priority over earlier weaker ones', () => {
    // The first backup entry only matches by url; it must not take the
    // bookmark that the second entry matches exactly
    const backup = [
      entry({ title: 'Loose', path: ['Other'] }),
      entry({ title: 'Docs', path: ['Work'] }),
    ];
    // 'exact' is also the closest by date to the first entry, so matching entry by entry would steal it
    const current = [
      entry({ id: 'exact', title: 'Docs', path: ['Work'], dateAdded: 999 }),
      entry({ id: 'spare', title: 'Something', path: ['Home'], dateAdded: 1 }),
    ];

    const pairs = Object.fromEntries(
      matchBookmarks(backup, current).matches.map((m) => [m.backup.title, m.current.id]),
    );

    expect(pairs).toEqual({ Docs: 'exact', Loose: 'spare' });
  });

  it('returns matches in backup order', () => {
    const backup = [entry({ url: 'https://b.com/' }), entry({ url: 'https://a.com/' })];
    const current = [entry({ id: 'a', url: 'https://a.com/' }), entry({ id: 'b', url: 'https://b.com/' })];

    expect(matchBookmarks(backup, current).matches.map((m) => m.current.id)).toEqual(['b', 'a']);
  });

  it('handles empty inputs', () => {
    expect(matchBookmarks([], [])).toEqual({ matches: [], unmatched: [] });
  });
});
