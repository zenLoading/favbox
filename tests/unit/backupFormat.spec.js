import { describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  buildBackup,
  backupFileName,
  detectBrowser,
  summarizeBackup,
} from '@/backup/format';

const deepFreeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

const chromeTree = () => [
  {
    id: '0',
    title: '',
    children: [
      {
        id: '1',
        title: 'Bookmarks bar',
        children: [
          { id: '10', parentId: '1', title: 'Tokio 🏷 #rust', url: 'https://tokio.rs/', dateAdded: 1700000000000 },
          {
            id: '11',
            parentId: '1',
            title: 'Dev',
            children: [
              { id: '12', parentId: '11', title: 'MDN', url: 'https://developer.mozilla.org/', dateAdded: 1700000001000 },
            ],
          },
          { id: '13', parentId: '1', title: 'Empty', children: [] },
        ],
      },
      { id: '2', title: 'Other bookmarks', children: [] },
    ],
  },
];

const entities = () => [
  {
    id: '10',
    title: 'Tokio',
    notes: '<p>scheduler</p>',
    pinned: 1,
    description: 'Async runtime',
    favicon: 'https://tokio.rs/favicon.ico',
    image: 'data:image/jpeg;base64,AAAA',
    keywords: ['rust', 'async'],
    httpStatus: 200,
    domain: 'tokio.rs',
    folderId: '1',
    folderName: 'Bookmarks bar',
    dateAdded: 1700000000000,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: '12',
    notes: '',
    pinned: 0,
    description: null,
    image: 'https://developer.mozilla.org/og.png',
    keywords: [],
    httpStatus: 404,
  },
];

const build = (overrides = {}) => buildBackup({
  tree: chromeTree(),
  entities: entities(),
  settings: { fontSize: 'md' },
  app: { name: 'FavBox', version: '2.2.0' },
  browserName: 'chrome',
  exportedAt: new Date('2026-09-28T10:00:00.000Z'),
  ...overrides,
});

describe('buildBackup', () => {
  it('writes the envelope with format, version, app, source, options and settings', () => {
    const backup = build();

    expect(backup).toMatchObject({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: '2026-09-28T10:00:00.000Z',
      app: { name: 'FavBox', version: '2.2.0' },
      source: { browser: 'chrome' },
      options: { includeScreenshots: true },
      settings: { fontSize: 'md' },
    });
    expect(BACKUP_FORMAT).toBe('favbox-backup');
    expect(BACKUP_VERSION).toBe(1);
  });

  it('turns the browser roots into top-level folders and keeps the hierarchy', () => {
    const { tree } = build();

    expect(tree.map((node) => node.title)).toEqual(['Bookmarks bar', 'Other bookmarks']);
    expect(tree[0].type).toBe('folder');
    expect(tree[0].children.map((node) => [node.type, node.title])).toEqual([
      ['bookmark', 'Tokio 🏷 #rust'],
      ['folder', 'Dev'],
      ['folder', 'Empty'],
    ]);
    expect(tree[0].children[1].children[0]).toMatchObject({
      type: 'bookmark', title: 'MDN', url: 'https://developer.mozilla.org/', dateAdded: 1700000001000,
    });
    expect(tree[0].children[2].children).toEqual([]);
  });

  it('keeps the browser title so tags stay in it', () => {
    const { tree } = build();

    expect(tree[0].children[0].title).toBe('Tokio 🏷 #rust');
  });

  it('attaches only the extension data fields to each bookmark', () => {
    const { tree } = build();

    expect(tree[0].children[0].data).toEqual({
      notes: '<p>scheduler</p>',
      pinned: 1,
      description: 'Async runtime',
      favicon: 'https://tokio.rs/favicon.ico',
      image: 'data:image/jpeg;base64,AAAA',
      keywords: ['rust', 'async'],
      httpStatus: 200,
    });
  });

  it('omits null and undefined data fields', () => {
    const { tree } = build();

    const { data } = tree[0].children[1].children[0];
    expect(data).not.toHaveProperty('description');
    expect(data).not.toHaveProperty('favicon');
    expect(data).toMatchObject({ notes: '', pinned: 0, httpStatus: 404 });
  });

  it('exports bookmarks that are not stored yet without data', () => {
    const { tree } = build({ entities: [] });

    expect(tree[0].children[0]).not.toHaveProperty('data');
    expect(tree[0].children[0].url).toBe('https://tokio.rs/');
  });

  it('never writes browser ids, since they are only valid in one profile', () => {
    const json = JSON.stringify(build());

    expect(json).not.toMatch(/"id"|"parentId"|"folderId"/);
  });

  it('drops screenshots but keeps image urls when includeScreenshots is false', () => {
    const backup = build({ includeScreenshots: false });

    expect(backup.options.includeScreenshots).toBe(false);
    expect(backup.tree[0].children[0].data).not.toHaveProperty('image');
    expect(backup.tree[0].children[1].children[0].data.image).toBe('https://developer.mozilla.org/og.png');
  });

  it('skips Firefox separators and keeps Firefox folders', () => {
    const tree = [{
      id: 'root________',
      title: '',
      type: 'folder',
      children: [{
        id: 'toolbar_____',
        title: 'Bookmarks Toolbar',
        type: 'folder',
        children: [
          { id: 'a', title: '', type: 'separator' },
          { id: 'b', title: 'Site', type: 'bookmark', url: 'https://site.com/', dateAdded: 1 },
        ],
      }],
    }];

    const backup = build({ tree, entities: [], browserName: 'firefox' });

    expect(backup.tree[0].children).toEqual([
      { type: 'bookmark', title: 'Site', url: 'https://site.com/', dateAdded: 1 },
    ]);
  });

  it('does not mutate its inputs', () => {
    const tree = deepFreeze(chromeTree());
    const frozenEntities = deepFreeze(entities());

    expect(() => build({ tree, entities: frozenEntities, includeScreenshots: false })).not.toThrow();
  });
});

describe('summarizeBackup', () => {
  it('counts bookmarks, folders, notes, pins and screenshots', () => {
    expect(summarizeBackup(build())).toEqual({
      bookmarks: 2,
      folders: 4,
      notes: 1,
      pinned: 1,
      screenshots: 1,
    });
  });
});

describe('backupFileName', () => {
  it('uses the local date and time', () => {
    expect(backupFileName(new Date(2026, 8, 28, 9, 5))).toBe('favbox-backup-20260928-0905.json');
  });
});

describe('detectBrowser', () => {
  it.each([
    ['Mozilla/5.0 (Macintosh) Gecko/20100101 Firefox/131.0', 'firefox'],
    ['Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0', 'edge'],
    ['Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0 Safari/537.36', 'chrome'],
    ['', 'chrome'],
  ])('detects %s as %s', (userAgent, expected) => {
    expect(detectBrowser(userAgent)).toBe(expected);
  });
});
