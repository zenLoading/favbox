import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import BookmarkStorage from '@/storage/bookmark';

const makeBookmark = (id) => ({
  id,
  folderId: '1',
  folderName: 'Folder',
  title: `Bookmark ${id}`,
  description: null,
  favicon: 'https://example.com/favicon.ico',
  image: 'data:image/jpeg;base64,AAAA',
  domain: 'example.com',
  keywords: [],
  url: `https://example.com/${id}`,
  tags: [],
  pinned: 0,
  notes: '',
  httpStatus: 200,
  dateAdded: 1700000000000,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('BookmarkStorage (JsStore + IndexedDB)', () => {
  it('getAllIds reads the ids of bookmarks written through JsStore', async () => {
    const storage = new BookmarkStorage();
    expect(await storage.getAllIds()).toEqual([]);

    await storage.createMany(['3', '1', '20'].map(makeBookmark));
    await storage.removeById('1');

    expect([...await storage.getAllIds()].sort()).toEqual(['20', '3']);
    expect(await storage.total()).toBe(2);
  });
});
