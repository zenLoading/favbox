import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fetchUrl } from '@/services/httpClient';
import { isHeadWithPreview } from '@/parser/metadata';
import sync from '@/ext/sw/sync';

const mocks = vi.hoisted(() => ({
  bookmarkStorage: {
    total: vi.fn(),
    getAllIds: vi.fn(),
    createMany: vi.fn(),
    removeByIds: vi.fn(),
    aggregateDomains: vi.fn(),
    aggregateTags: vi.fn(),
    aggregateKeywords: vi.fn(),
  },
  attributeStorage: {
    clear: vi.fn(),
    saveMany: vi.fn(),
  },
  browserBookmarks: [],
}));

vi.mock('webextension-polyfill', () => ({
  default: {
    storage: { session: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue() } },
    runtime: { sendMessage: vi.fn().mockResolvedValue() },
  },
}));

// sync.js instantiates the storages with `new`, so the mocks must be regular functions
vi.mock('@/storage/bookmark', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  default: vi.fn(function BookmarkStorage() { return mocks.bookmarkStorage; }),
}));

vi.mock('@/storage/attribute', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  default: vi.fn(function AttributeStorage() { return mocks.attributeStorage; }),
}));

vi.mock('@/services/httpClient', () => ({
  fetchUrl: vi.fn(),
}));

vi.mock('@/services/browserBookmarks', () => ({
  getBookmarksCount: vi.fn(async () => mocks.browserBookmarks.length),
  getFoldersMap: vi.fn(async () => new Map([['1', 'Folder']])),
  getBookmarksIterator: vi.fn(async function* iterate() {
    yield* mocks.browserBookmarks;
  }),
}));

const makeBookmarks = (count, host = (i) => `site${i % 7}.com`) => Array.from({ length: count }, (_, i) => ({
  id: String(i + 1),
  parentId: '1',
  title: `Bookmark ${i + 1}`,
  url: `https://${host(i)}/page/${i + 1}`,
  dateAdded: 1700000000000 + i,
}));

const savedBookmarks = () => mocks.bookmarkStorage.createMany.mock.calls.flatMap(([items]) => items);

describe('sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'time').mockImplementation(() => {});
    vi.spyOn(console, 'timeEnd').mockImplementation(() => {});
    mocks.browserBookmarks = [];
    mocks.bookmarkStorage.total.mockResolvedValue(0);
    mocks.bookmarkStorage.getAllIds.mockResolvedValue([]);
    mocks.bookmarkStorage.createMany.mockResolvedValue();
    mocks.bookmarkStorage.removeByIds.mockResolvedValue();
    mocks.bookmarkStorage.aggregateDomains.mockResolvedValue([]);
    mocks.bookmarkStorage.aggregateTags.mockResolvedValue([]);
    mocks.bookmarkStorage.aggregateKeywords.mockResolvedValue([]);
    vi.mocked(fetchUrl).mockResolvedValue({ html: '<html><head><title>t</title></head></html>', httpStatus: 200 });
  });

  it('saves every missing bookmark in batches of at most 100', async () => {
    mocks.browserBookmarks = makeBookmarks(250);

    await sync();

    const saved = savedBookmarks();
    expect(saved).toHaveLength(250);
    expect(new Set(saved.map((b) => b.id)).size).toBe(250);
    const batchSizes = mocks.bookmarkStorage.createMany.mock.calls.map(([items]) => items.length);
    expect(Math.max(...batchSizes)).toBeLessThanOrEqual(100);
  });

  it('keeps bookmarks whose page could not be fetched, with their http status', async () => {
    mocks.browserBookmarks = makeBookmarks(3);
    vi.mocked(fetchUrl).mockResolvedValue({ html: null, httpStatus: 404 });

    await sync();

    const saved = savedBookmarks();
    expect(saved).toHaveLength(3);
    expect(saved.every((b) => b.httpStatus === 404)).toBe(true);
  });

  it('only fetches bookmarks that are not stored yet', async () => {
    mocks.browserBookmarks = makeBookmarks(5);
    mocks.bookmarkStorage.total.mockResolvedValue(2);
    mocks.bookmarkStorage.getAllIds.mockResolvedValue(['1', '2']);

    await sync();

    expect(savedBookmarks().map((b) => b.id).sort()).toEqual(['3', '4', '5']);
    expect(fetchUrl).toHaveBeenCalledTimes(3);
  });

  it('removes stored bookmarks that no longer exist in the browser', async () => {
    mocks.browserBookmarks = makeBookmarks(2);
    mocks.bookmarkStorage.total.mockResolvedValue(3);
    mocks.bookmarkStorage.getAllIds.mockResolvedValue(['1', '2', '99']);

    await sync();

    expect(mocks.bookmarkStorage.removeByIds).toHaveBeenCalledWith(['99']);
  });

  it('does nothing when counts already match', async () => {
    mocks.browserBookmarks = makeBookmarks(4);
    mocks.bookmarkStorage.total.mockResolvedValue(4);

    await sync();

    expect(fetchUrl).not.toHaveBeenCalled();
    expect(mocks.bookmarkStorage.createMany).not.toHaveBeenCalled();
  });

  it('fetches only html and stops reading once the head has what the parser needs', async () => {
    mocks.browserBookmarks = makeBookmarks(1);

    await sync();

    expect(fetchUrl).toHaveBeenCalledWith(
      'https://site0.com/page/1',
      expect.any(Number),
      expect.objectContaining({ htmlOnly: true, maxBytes: expect.any(Number), isComplete: isHeadWithPreview }),
    );
  });

  it('limits concurrent requests to the same host', async () => {
    mocks.browserBookmarks = makeBookmarks(40, () => 'github.com');
    let active = 0;
    let peak = 0;
    vi.mocked(fetchUrl).mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => { setTimeout(resolve, 0); });
      active -= 1;
      return { html: '', httpStatus: 200 };
    });

    await sync();

    expect(savedBookmarks()).toHaveLength(40);
    expect(peak).toBeLessThanOrEqual(6);
  });
});
