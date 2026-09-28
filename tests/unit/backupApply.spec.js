import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { reactive } from 'vue';
import browser from 'webextension-polyfill';
import { NOTES_SEPARATOR } from '@/backup/plan';
import {
  WRITE_TIMEOUT_MS, rowFromBackup, restoreFolderTitle, applyDataUpdates, applyCreates,
} from '@/backup/apply';

const mocks = vi.hoisted(() => ({
  rows: new Map(),
  bookmarkStorage: {},
  attributeStorage: { refreshFromAggregated: null },
}));

vi.mock('webextension-polyfill', () => ({
  default: {
    bookmarks: { get: vi.fn(), create: vi.fn(), getChildren: vi.fn() },
    storage: { session: { set: vi.fn() } },
    runtime: { sendMessage: vi.fn() },
  },
}));

// apply.js instantiates the storages with `new`, so the mocks must be regular functions
vi.mock('@/storage/bookmark', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  default: vi.fn(function BookmarkStorage() { return mocks.bookmarkStorage; }),
}));
vi.mock('@/storage/attribute', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  default: vi.fn(function AttributeStorage() { return mocks.attributeStorage; }),
}));

/**
 * In-memory stand-in for browser.bookmarks: creating without parentId puts the
 * node into "Other bookmarks" ('2'), like Chrome and Firefox do.
 */
const createFakeBookmarks = () => {
  const nodes = new Map([
    ['0', { id: '0', title: '' }],
    ['1', { id: '1', parentId: '0', title: 'Bookmarks bar' }],
    ['2', { id: '2', parentId: '0', title: 'Other bookmarks' }],
    ['10', { id: '10', parentId: '1', title: 'Existing 🏷 #keep', url: 'https://existing.com/', dateAdded: 5 }],
  ]);
  let nextId = 100;
  return {
    nodes,
    session: {},
    snapshot: () => JSON.parse(JSON.stringify([...nodes.values()])),
    get: async (id) => {
      if (!nodes.has(id)) throw new Error(`Can't find bookmark for id ${id}`);
      return [{ ...nodes.get(id) }];
    },
    getChildren: async (id) => {
      if (!nodes.has(id)) throw new Error(`Can't find parent bookmark for id ${id}`);
      return [...nodes.values()].filter((n) => n.parentId === id).map((n) => ({ ...n }));
    },
    create: async ({ parentId = '2', title = '', url }) => {
      if (!nodes.has(parentId)) throw new Error('Can\'t find parent bookmark');
      const node = {
        id: String(nextId), parentId, title, ...(url && { url }), dateAdded: 1759000000000 + nextId,
      };
      nextId += 1;
      nodes.set(node.id, node);
      return { ...node };
    },
  };
};

const createFakeStorage = () => ({
  getById: vi.fn(async (id) => (mocks.rows.has(id) ? { ...mocks.rows.get(id) } : null)),
  update: vi.fn(async (id, data) => { mocks.rows.set(id, { ...mocks.rows.get(id), ...data }); }),
  createMany: vi.fn(async (rows) => { rows.forEach((row) => mocks.rows.set(row.id, row)); }),
  aggregateDomains: vi.fn(async () => []),
  aggregateTags: vi.fn(async () => []),
  aggregateKeywords: vi.fn(async () => []),
});

let fake;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows = new Map([['10', { id: '10', notes: '', pinned: 0, image: null }]]);
  Object.assign(mocks.bookmarkStorage, createFakeStorage());
  mocks.attributeStorage.refreshFromAggregated = vi.fn(async () => []);
  fake = createFakeBookmarks();
  vi.mocked(browser.bookmarks.get).mockImplementation(fake.get);
  vi.mocked(browser.bookmarks.create).mockImplementation(fake.create);
  vi.mocked(browser.bookmarks.getChildren).mockImplementation(fake.getChildren);
  vi.mocked(browser.storage.session.set).mockImplementation(async (items) => Object.assign(fake.session, items));
  vi.mocked(browser.runtime.sendMessage).mockResolvedValue();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const update = (overrides = {}) => ({
  id: '10',
  title: 'Existing 🏷 #keep',
  url: 'https://existing.com/',
  rowMissing: false,
  changes: { notes: '<p>backup</p>' },
  mergedNotes: false,
  backupData: { notes: '<p>backup</p>' },
  dateAdded: 1,
  ...overrides,
});

const create = (overrides = {}) => ({
  folders: ['Bookmarks bar', 'Dev'],
  path: ['Dev'],
  target: { id: '1', title: 'Bookmarks bar' },
  title: 'Gone 🏷 #rust',
  url: 'https://gone.com/',
  dateAdded: 1600000000000,
  data: { notes: '<p>n</p>', pinned: 1, description: 'd', keywords: ['k'], httpStatus: 404 },
  ...overrides,
});

describe('rowFromBackup', () => {
  it('builds a stored row from a browser node and backup data', () => {
    const row = rowFromBackup(
      { id: '7', parentId: '3', title: 'Tokio 🏷 #rust #async', url: 'https://www.tokio.rs/guide' },
      'Dev',
      {
        notes: '<p>n</p>', pinned: 1, description: 'd', favicon: 'https://tokio.rs/f.ico', image: 'https://tokio.rs/og.png', keywords: ['k'], httpStatus: 200,
      },
      1600000000000,
      new Date('2026-09-28T10:00:00.000Z'),
    );

    expect(row).toEqual({
      id: '7',
      folderId: '3',
      folderName: 'Dev',
      title: 'Tokio',
      tags: ['rust', 'async'],
      url: 'https://www.tokio.rs/guide',
      domain: 'tokio.rs',
      description: 'd',
      favicon: 'https://tokio.rs/f.ico',
      image: 'https://tokio.rs/og.png',
      keywords: ['k'],
      notes: '<p>n</p>',
      pinned: 1,
      httpStatus: 200,
      dateAdded: 1600000000000,
      createdAt: '2026-09-28T10:00:00.000Z',
      updatedAt: '2026-09-28T10:00:00.000Z',
    });
  });

  it('returns plain data that can be sent to the database worker, even from reactive input', () => {
    // JsStore runs in a Web Worker and structured-clones every row; Vue proxies cannot be cloned
    const data = reactive({ keywords: ['a', 'b'], notes: 'n' });

    const row = rowFromBackup({ id: '7', parentId: '3', title: 'A', url: 'https://a.com/' }, 'F', data, 1);

    expect(() => structuredClone(row)).not.toThrow();
    expect(row.keywords).toEqual(['a', 'b']);
  });

  it('fills defaults when the backup has no data', () => {
    const row = rowFromBackup({ id: '7', parentId: '3', title: 'A', url: 'https://a.com/', dateAdded: 99 }, 'F', {}, undefined);

    expect(row).toMatchObject({
      description: null,
      favicon: 'https://a.com/favicon.ico',
      image: null,
      keywords: [],
      notes: '',
      pinned: 0,
      httpStatus: 200,
      dateAdded: 99,
    });
  });
});

describe('restoreFolderTitle', () => {
  it('names the folder after the local date', () => {
    expect(restoreFolderTitle(new Date(2026, 8, 3))).toBe('FavBox restore 2026-09-03');
  });
});

describe('applyDataUpdates', () => {
  it('writes the planned notes, pins and images', async () => {
    const result = await applyDataUpdates([update({
      changes: { notes: '<p>backup</p>', pinned: 1 },
      backupData: { notes: '<p>backup</p>', pinned: 1 },
    })]);

    expect(mocks.rows.get('10')).toMatchObject({ notes: '<p>backup</p>', pinned: 1 });
    expect(result).toEqual({
      updated: 1, created: 0, merged: 0, unchanged: 0, failed: [],
    });
  });

  it('recomputes changes against the current row, so edits made after the preview are kept', async () => {
    mocks.rows.set('10', { id: '10', notes: '<p>edited after preview</p>' });

    const result = await applyDataUpdates([update()]);

    expect(mocks.rows.get('10').notes).toBe(`<p>edited after preview</p>${NOTES_SEPARATOR}<p>backup</p>`);
    expect(result.merged).toBe(1);
  });

  it('does nothing when the data was already restored', async () => {
    mocks.rows.set('10', { id: '10', notes: '<p>backup</p>' });

    const result = await applyDataUpdates([update()]);

    expect(mocks.bookmarkStorage.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ updated: 0, unchanged: 1 });
  });

  it('creates the row from backup data when the bookmark is not stored yet', async () => {
    fake.nodes.set('11', {
      id: '11', parentId: '1', title: 'New 🏷 #t', url: 'https://new.com/', dateAdded: 50,
    });

    const result = await applyDataUpdates([update({
      id: '11', rowMissing: true, backupData: { notes: 'n', description: 'd' }, dateAdded: 7,
    })]);

    expect(mocks.bookmarkStorage.createMany).toHaveBeenCalledTimes(1);
    expect(mocks.rows.get('11')).toMatchObject({
      id: '11', folderId: '1', folderName: 'Bookmarks bar', title: 'New', tags: ['t'], notes: 'n', description: 'd', dateAdded: 7,
    });
    expect(result).toMatchObject({ created: 1, updated: 0 });
    expect(mocks.attributeStorage.refreshFromAggregated).toHaveBeenCalledTimes(1);
  });

  it('reports missing rows that could not be stored without losing the other results', async () => {
    fake.nodes.set('11', {
      id: '11', parentId: '1', title: 'New', url: 'https://new.com/', dateAdded: 50,
    });
    mocks.bookmarkStorage.createMany.mockRejectedValueOnce(new Error('IDB quota'));

    const result = await applyDataUpdates([
      update({
        id: '11', title: 'New', url: 'https://new.com/', rowMissing: true,
      }),
      update(),
    ]);

    expect(result).toMatchObject({
      updated: 1, created: 0, failed: [{ title: 'New', url: 'https://new.com/', reason: 'IDB quota' }],
    });
  });

  it('records bookmarks deleted since the preview and continues', async () => {
    const result = await applyDataUpdates([
      update({ id: '404', title: 'Deleted', url: 'https://deleted.com/', rowMissing: true }),
      update(),
    ]);

    expect(result.failed).toEqual([{ title: 'Deleted', url: 'https://deleted.com/', reason: expect.any(String) }]);
    expect(result.updated).toBe(1);
  });

  it('reports progress', async () => {
    const onProgress = vi.fn();

    await applyDataUpdates([update(), update()], { onProgress });

    expect(onProgress).toHaveBeenLastCalledWith({ done: 2, total: 2 });
  });

  it('never fetches pages and tells open pages to refresh', async () => {
    await applyDataUpdates([update()]);

    expect(fetch).not.toHaveBeenCalled();
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ action: 'refresh' });
  });
});

describe('applyCreates', () => {
  it('recreates bookmarks inside a restore folder, keeping their folders', async () => {
    const result = await applyCreates([
      create(),
      create({ title: 'Second', url: 'https://second.com/' }),
      create({ folders: ['Other bookmarks'], title: 'Third', url: 'https://third.com/' }),
    ], { folderTitle: 'FavBox restore 2026-09-28' });

    const byTitle = (title) => [...fake.nodes.values()].find((n) => n.title === title);
    const restoreFolder = byTitle('FavBox restore 2026-09-28');
    expect(restoreFolder.parentId).toBe('2');
    const dev = byTitle('Dev');
    expect(fake.nodes.get(dev.parentId)).toMatchObject({ title: 'Bookmarks bar', parentId: restoreFolder.id });
    expect(byTitle('Gone 🏷 #rust')).toMatchObject({ parentId: dev.id, url: 'https://gone.com/' });
    expect(byTitle('Second').parentId).toBe(dev.id);
    expect(fake.nodes.get(byTitle('Third').parentId)).toMatchObject({ title: 'Other bookmarks', parentId: restoreFolder.id });
    // restore folder + Bookmarks bar + Dev + Other bookmarks, each created once
    expect(result).toMatchObject({ folderId: restoreFolder.id, folders: 4, bookmarks: 3, failed: [] });
  });

  it('leaves existing bookmarks untouched', async () => {
    const before = fake.snapshot();

    await applyCreates([create(), create({ url: 'https://existing.com/' })], { folderTitle: 'R' });

    const after = fake.snapshot();
    expect(after.slice(0, before.length)).toEqual(before);
  });

  it('stores rows with the backup data and the original dateAdded', async () => {
    await applyCreates([create()], { folderTitle: 'R' });

    const row = [...mocks.rows.values()].find((r) => r.url === 'https://gone.com/');
    expect(row).toMatchObject({
      title: 'Gone', tags: ['rust'], folderName: 'Dev', notes: '<p>n</p>', pinned: 1, httpStatus: 404, dateAdded: 1600000000000,
    });
    expect(mocks.attributeStorage.refreshFromAggregated).toHaveBeenCalledTimes(1);
  });

  it('pauses page fetching while creating and resumes afterwards', async () => {
    const flagsDuringCreate = [];
    vi.mocked(browser.bookmarks.create).mockImplementation(async (details) => {
      flagsDuringCreate.push(fake.session.nativeImport);
      return fake.create(details);
    });

    await applyCreates([create()], { folderTitle: 'R' });

    expect(flagsDuringCreate.every((flag) => flag === true)).toBe(true);
    expect(fake.session.nativeImport).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('resumes page fetching even when the restore folder cannot be created', async () => {
    vi.mocked(browser.bookmarks.create).mockRejectedValue(new Error('quota'));

    await expect(applyCreates([create()], { folderTitle: 'R' })).rejects.toThrow('quota');
    expect(fake.session.nativeImport).toBe(false);
  });

  it('gives up on a database write that never finishes and still resumes page fetching', async () => {
    vi.useFakeTimers();
    // JsStore never settles when a row cannot be sent to its worker
    mocks.bookmarkStorage.createMany.mockImplementation(() => new Promise(() => {}));

    const pending = applyCreates([create()], { folderTitle: 'R' });
    await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS);
    const result = await pending;
    vi.useRealTimers();

    expect(fake.session.nativeImport).toBe(false);
    expect(result.bookmarks).toBe(0);
    expect(result.failed).toEqual([{ title: 'Gone 🏷 #rust', url: 'https://gone.com/', reason: expect.stringContaining('did not finish') }]);
  });

  it('records a failed bookmark and continues with the rest', async () => {
    vi.mocked(browser.bookmarks.create).mockImplementation(async (details) => {
      if (details.url === 'https://bad.com/') throw new Error('Invalid URL');
      return fake.create(details);
    });

    const result = await applyCreates([create({ title: 'Bad', url: 'https://bad.com/' }), create()], { folderTitle: 'R' });

    expect(result.failed).toEqual([{ title: 'Bad', url: 'https://bad.com/', reason: 'Invalid URL' }]);
    expect(result.bookmarks).toBe(1);
  });

  it('refuses non-web urls even if they got past validation', async () => {
    // eslint-disable-next-line no-script-url
    const result = await applyCreates([create({ title: 'Evil', url: 'javascript:alert(1)' })], { folderTitle: 'R' });

    expect([...fake.nodes.values()].some((n) => n.title === 'Evil')).toBe(false);
    expect(result.failed[0]).toMatchObject({ title: 'Evil', reason: expect.any(String) });
  });

  it('writes rows in batches of at most 100', async () => {
    const creates = Array.from({ length: 250 }, (_, i) => create({ title: `B${i}`, url: `https://b.com/${i}` }));

    await applyCreates(creates, { folderTitle: 'R' });

    const sizes = mocks.bookmarkStorage.createMany.mock.calls.map(([rows]) => rows.length);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(250);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(100);
  });

  it('reports every bookmark of a batch whose data could not be stored', async () => {
    mocks.bookmarkStorage.createMany.mockRejectedValueOnce(new Error('IDB quota'));
    const creates = Array.from({ length: 150 }, (_, i) => create({ title: `B${i}`, url: `https://b.com/${i}` }));

    const result = await applyCreates(creates, { folderTitle: 'R' });

    expect(result.failed).toHaveLength(100);
    expect(result.failed[0]).toEqual({ title: 'B0', url: 'https://b.com/0', reason: 'IDB quota' });
    expect(result.bookmarks).toBe(50);
    expect([...mocks.rows.values()].filter((r) => r.url?.startsWith('https://b.com/'))).toHaveLength(50);
  });

  it('still returns the result when rebuilding attributes fails', async () => {
    mocks.attributeStorage.refreshFromAggregated.mockRejectedValue(new Error('attributes'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await applyCreates([create()], { folderTitle: 'R' });

    expect(result).toMatchObject({ bookmarks: 1, failed: [] });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('reports progress', async () => {
    const onProgress = vi.fn();

    await applyCreates([create(), create({ url: 'https://x.com/' })], { folderTitle: 'R', onProgress });

    expect(onProgress).toHaveBeenLastCalledWith({ done: 2, total: 2 });
  });
});

describe('applyCreates in the original location', () => {
  const nodesTitled = (title) => [...fake.nodes.values()].filter((n) => n.title === title);
  const original = { folderTitle: 'R', placement: 'original' };

  it('puts bookmarks back into their existing folders without a restore folder', async () => {
    fake.nodes.set('20', { id: '20', parentId: '1', title: 'Dev' });

    const result = await applyCreates([
      create(),
      create({ title: 'Second', url: 'https://second.com/' }),
      create({
        path: [], target: { id: '2', title: 'Other bookmarks' }, title: 'Third', url: 'https://third.com/',
      }),
    ], original);

    expect(nodesTitled('Gone 🏷 #rust')[0].parentId).toBe('20');
    expect(nodesTitled('Second')[0].parentId).toBe('20');
    expect(nodesTitled('Third')[0].parentId).toBe('2');
    expect(nodesTitled('Dev')).toHaveLength(1);
    expect(nodesTitled('R')).toEqual([]);
    expect(result).toEqual({
      folderId: null, folders: 0, bookmarks: 3, fallback: 0, failed: [],
    });
  });

  it('creates missing folders along the original path once', async () => {
    const result = await applyCreates([
      create({ path: ['Dev', 'JS'] }),
      create({ path: ['Dev', 'JS'], title: 'Second', url: 'https://second.com/' }),
    ], original);

    const [dev] = nodesTitled('Dev');
    const [js] = nodesTitled('JS');
    expect(dev.parentId).toBe('1');
    expect(js.parentId).toBe(dev.id);
    expect(nodesTitled('Second')[0].parentId).toBe(js.id);
    expect(result.folders).toBe(2);
  });

  it('stores rows with the folder they were put into', async () => {
    await applyCreates([
      create({ path: [], target: { id: '2', title: 'Other bookmarks' } }),
    ], original);

    expect([...mocks.rows.values()].find((r) => r.url === 'https://gone.com/'))
      .toMatchObject({ folderId: '2', folderName: 'Other bookmarks' });
  });

  it('falls back to a restore folder for bookmarks whose root cannot be found', async () => {
    const result = await applyCreates([
      create({ target: null, folders: ['Unknown root', 'Dev'], title: 'Lost' }),
      create({ title: 'Placed', url: 'https://placed.com/' }),
    ], original);

    const [restoreFolder] = nodesTitled('R');
    expect(restoreFolder.parentId).toBe('2');
    const [unknownRoot] = nodesTitled('Unknown root');
    expect(unknownRoot.parentId).toBe(restoreFolder.id);
    expect(nodesTitled('Placed')[0].parentId).not.toBe(restoreFolder.id);
    expect(result).toMatchObject({ folderId: restoreFolder.id, fallback: 1, bookmarks: 2 });
  });

  it('records a bookmark whose original folder was removed meanwhile and continues', async () => {
    const result = await applyCreates([
      create({ target: { id: '404', title: 'Gone root' }, title: 'Orphan' }),
      create({ title: 'Placed', url: 'https://placed.com/' }),
    ], original);

    expect(result.failed).toEqual([{ title: 'Orphan', url: 'https://gone.com/', reason: expect.any(String) }]);
    expect(result.bookmarks).toBe(1);
    expect(fake.session.nativeImport).toBe(false);
  });
});
