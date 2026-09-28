/* eslint-disable no-script-url -- javascript: urls are the malicious inputs under test */
import { describe, expect, it, afterEach } from 'vitest';
import { buildBackup } from '@/backup/format';
import {
  LIMITS, ERROR, SKIP, readBackup, validateBackup,
} from '@/backup/validate';

const bookmark = (overrides = {}) => ({
  type: 'bookmark', title: 'Site', url: 'https://site.com/', dateAdded: 1700000000000, ...overrides,
});
const folder = (children = [], overrides = {}) => ({
  type: 'folder', title: 'Folder', children, ...overrides,
});
const envelope = (tree, overrides = {}) => ({
  format: 'favbox-backup',
  version: 1,
  exportedAt: '2026-09-28T10:00:00.000Z',
  app: { name: 'FavBox', version: '2.2.0' },
  source: { browser: 'chrome' },
  options: { includeScreenshots: true },
  settings: {},
  tree,
  ...overrides,
});
const nest = (depth) => {
  let node = folder([bookmark()]);
  for (let i = 1; i < depth; i++) node = folder([node]);
  return node;
};
const firstBookmark = (result) => result.backup.tree[0].children[0];
const dataOf = (data) => {
  const result = validateBackup(envelope([folder([bookmark({ data })])]));
  return { data: firstBookmark(result).data, droppedFields: result.droppedFields };
};

describe('readBackup', () => {
  it('rejects text over the size limit', () => {
    const result = readBackup('{"format":"favbox-backup"}', { ...LIMITS, maxChars: 10 });

    expect(result).toMatchObject({ backup: null, error: { code: ERROR.TOO_LARGE } });
  });

  it('rejects text that is not JSON', () => {
    expect(readBackup('<html>').error.code).toBe(ERROR.INVALID_JSON);
    expect(readBackup('').error.code).toBe(ERROR.INVALID_JSON);
  });

  it('accepts what the exporter produces, unchanged', () => {
    const backup = buildBackup({
      tree: [{
        id: '0',
        children: [{
          id: '1',
          title: 'Bookmarks bar',
          children: [
            { id: '10', title: 'Tokio 🏷 #rust', url: 'https://tokio.rs/', dateAdded: 1700000000000 },
            { id: '11', title: 'Empty', children: [] },
          ],
        }],
      }],
      entities: [{
        id: '10',
        notes: '<p>n</p>',
        pinned: 1,
        description: 'Async runtime',
        favicon: 'https://tokio.rs/favicon.ico',
        image: 'data:image/jpeg;base64,AAAA',
        keywords: ['rust'],
        httpStatus: 200,
      }],
      settings: { fontSize: 'lg', skipDeleteConfirmation: true, theme: 'dark', viewMode: 'list' },
      app: { name: 'FavBox', version: '2.2.0' },
      browserName: 'chrome',
      exportedAt: new Date('2026-09-28T10:00:00.000Z'),
    });

    const result = readBackup(JSON.stringify(backup));

    expect(result.error).toBeNull();
    expect(result.backup).toEqual(backup);
    expect(result.skipped).toEqual({ count: 0, items: [] });
    expect(result.droppedFields).toBe(0);
  });
});

describe('validateBackup: whole file', () => {
  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'favbox'],
  ])('rejects %s', (_, value) => {
    expect(validateBackup(value).error.code).toBe(ERROR.INVALID_FORMAT);
  });

  it('rejects files that are not FavBox backups', () => {
    expect(validateBackup(envelope([], { format: 'raindrop' })).error.code).toBe(ERROR.NOT_A_BACKUP);
  });

  it.each([2, 0, '1', 1.5, undefined])('rejects version %s', (version) => {
    expect(validateBackup(envelope([], { version })).error.code).toBe(ERROR.UNSUPPORTED_VERSION);
  });

  it('rejects a missing tree', () => {
    expect(validateBackup(envelope(undefined)).error.code).toBe(ERROR.INVALID_FORMAT);
  });

  it('accepts the maximum depth and rejects anything deeper', () => {
    expect(validateBackup(envelope([nest(LIMITS.maxDepth)])).error).toBeNull();
    expect(validateBackup(envelope([nest(LIMITS.maxDepth + 1)])).error.code).toBe(ERROR.TOO_DEEP);
  });

  it('rejects too many nodes', () => {
    const tree = [folder([bookmark(), bookmark(), bookmark(), bookmark(), bookmark()])];

    const result = validateBackup(envelope(tree), { ...LIMITS, maxNodes: 5 });

    expect(result).toMatchObject({ backup: null, error: { code: ERROR.TOO_MANY_NODES } });
  });
});

describe('validateBackup: bookmarks and folders', () => {
  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'chrome://settings',
  ])('skips non-web url %s', (url) => {
    const result = validateBackup(envelope([folder([bookmark({ url, title: 'Bad' })])]));

    expect(result.backup.tree[0].children).toEqual([]);
    expect(result.skipped).toEqual({ count: 1, items: [{ title: 'Bad', url, reason: SKIP.UNSUPPORTED_URL }] });
  });

  it.each([['not a url'], [42], [undefined]])('skips invalid url %s', (url) => {
    const result = validateBackup(envelope([folder([bookmark({ url })])]));

    expect(result.backup.tree[0].children).toEqual([]);
    expect(result.skipped.items[0].reason).toBe(SKIP.INVALID_URL);
  });

  it('skips nodes of unknown type or shape', () => {
    const result = validateBackup(envelope([folder([{ type: 'separator' }, 'text', null, bookmark()])]));

    expect(result.backup.tree[0].children).toEqual([bookmark()]);
    expect(result.skipped.count).toBe(3);
    expect(result.skipped.items.every((item) => item.reason === SKIP.INVALID_NODE)).toBe(true);
  });

  it('truncates long titles and replaces non-string titles', () => {
    const long = 'a'.repeat(LIMITS.maxTitle + 10);
    const result = validateBackup(envelope([folder([bookmark({ title: long }), bookmark({ title: 7 })], { title: {} })]));

    expect(result.backup.tree[0].title).toBe('');
    expect(result.backup.tree[0].children[0].title).toHaveLength(LIMITS.maxTitle);
    expect(result.backup.tree[0].children[1].title).toBe('');
  });

  it('treats a folder without a children array as empty', () => {
    const result = validateBackup(envelope([folder('nope')]));

    expect(result.backup.tree[0].children).toEqual([]);
  });

  it.each([-1, Number.NaN, '1700000000000', 9e15])('drops invalid dateAdded %s', (dateAdded) => {
    const result = validateBackup(envelope([folder([bookmark({ dateAdded })])]));

    expect(firstBookmark(result)).not.toHaveProperty('dateAdded');
  });

  it('caps the skipped details but keeps the full count', () => {
    const bad = Array.from({ length: LIMITS.maxSkippedItems + 5 }, () => bookmark({ url: 'javascript:1' }));

    const result = validateBackup(envelope([folder(bad)]));

    expect(result.skipped.count).toBe(LIMITS.maxSkippedItems + 5);
    expect(result.skipped.items).toHaveLength(LIMITS.maxSkippedItems);
  });
});

describe('validateBackup: bookmark data', () => {
  it('keeps valid fields', () => {
    const data = {
      notes: '<p>n</p>',
      pinned: 1,
      description: 'd',
      favicon: 'https://site.com/favicon.ico',
      image: 'https://site.com/og.png',
      keywords: ['a', 'b'],
      httpStatus: 404,
    };

    expect(dataOf(data)).toEqual({ data, droppedFields: 0 });
  });

  it('drops notes that are too long or not text', () => {
    expect(dataOf({ notes: 'a'.repeat(LIMITS.maxNotes + 1) })).toEqual({ data: {}, droppedFields: 1 });
    expect(dataOf({ notes: { html: 1 } })).toEqual({ data: {}, droppedFields: 1 });
  });

  it('accepts boolean pins and drops other values', () => {
    expect(dataOf({ pinned: true }).data).toEqual({ pinned: 1 });
    expect(dataOf({ pinned: false }).data).toEqual({ pinned: 0 });
    expect(dataOf({ pinned: 5 })).toEqual({ data: {}, droppedFields: 1 });
  });

  it.each([
    ['data:image/jpeg;base64,AAAA', true],
    ['data:image/png;base64,AAAA', true],
    ['https://site.com/a.png', true],
    ['data:image/svg+xml,<svg onload="alert(1)"/>', false],
    ['data:text/html,<script>', false],
    ['javascript:alert(1)', false],
    ['/relative.png', false],
  ])('image %s is kept: %s', (image, kept) => {
    const { data } = dataOf({ image, favicon: image });

    expect('image' in data).toBe(kept);
    expect('favicon' in data).toBe(kept);
  });

  it('drops oversized images', () => {
    const image = `data:image/jpeg;base64,${'A'.repeat(LIMITS.maxImage)}`;

    expect(dataOf({ image })).toEqual({ data: {}, droppedFields: 1 });
  });

  it('keeps only valid keywords, up to the limit', () => {
    const keywords = ['ok', 3, 'x'.repeat(LIMITS.maxKeywordLength + 1), null,
      ...Array.from({ length: LIMITS.maxKeywords + 5 }, (_, i) => `k${i}`)];

    const { data } = dataOf({ keywords });

    expect(data.keywords[0]).toBe('ok');
    expect(data.keywords).toHaveLength(LIMITS.maxKeywords);
    expect(data.keywords.every((k) => typeof k === 'string' && k.length <= LIMITS.maxKeywordLength)).toBe(true);
  });

  it.each([1.5, 1000, -1, '200'])('drops invalid httpStatus %s', (httpStatus) => {
    expect(dataOf({ httpStatus })).toEqual({ data: {}, droppedFields: 1 });
  });

  it('ignores unknown fields', () => {
    expect(dataOf({ notes: 'n', id: '10', folderId: '1', evil: '<script>' })).toEqual({ data: { notes: 'n' }, droppedFields: 0 });
  });

  it('drops data that is not an object', () => {
    const result = validateBackup(envelope([folder([bookmark({ data: 'x' })])]));

    expect(firstBookmark(result)).not.toHaveProperty('data');
  });
});

describe('validateBackup: envelope fields', () => {
  it('keeps valid settings and drops invalid or unknown ones', () => {
    const settings = {
      fontSize: 'huge', viewMode: 'list', skipDeleteConfirmation: 'yes', theme: 'dark', token: 'x',
    };

    expect(validateBackup(envelope([], { settings })).backup.settings).toEqual({ viewMode: 'list', theme: 'dark' });
    expect(validateBackup(envelope([], { settings: 'x' })).backup.settings).toEqual({});
  });

  it('normalizes metadata', () => {
    const result = validateBackup(envelope([], {
      exportedAt: 'yesterday', app: { name: 5 }, source: null, options: { includeScreenshots: 'no' },
    }));

    expect(result.backup).toMatchObject({
      exportedAt: null,
      app: { name: '', version: '' },
      source: { browser: '' },
      options: { includeScreenshots: true },
    });
  });
});

describe('validateBackup: prototype pollution', () => {
  afterEach(() => {
    delete Object.prototype.polluted;
  });

  it('never copies __proto__ keys', () => {
    const text = `{
      "__proto__": { "polluted": 1 },
      "format": "favbox-backup", "version": 1, "tree": [
        { "type": "folder", "title": "F", "__proto__": { "polluted": 2 }, "children": [
          { "type": "bookmark", "title": "B", "url": "https://b.com/",
            "data": { "notes": "n", "__proto__": { "polluted": 3 } } }
        ] }
      ],
      "settings": { "__proto__": { "polluted": 4 } }
    }`;

    const { backup } = readBackup(text);

    expect({}.polluted).toBeUndefined();
    const own = (object) => Object.prototype.hasOwnProperty.call(object, '__proto__');
    expect(own(backup) || own(backup.settings) || own(backup.tree[0]) || own(backup.tree[0].children[0].data)).toBe(false);
    expect(backup.polluted).toBeUndefined();
    expect(backup.tree[0].children[0].data.polluted).toBeUndefined();
  });
});
