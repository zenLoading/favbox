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

  it('findAll returns every bookmark across several pages', async () => {
    const storage = new BookmarkStorage();
    const ids = Array.from({ length: 250 }, (_, i) => `all-${String(i).padStart(3, '0')}`);
    await storage.createMany(ids.map(makeBookmark));

    const all = await storage.findAll();

    const found = all.map((b) => b.id).filter((id) => id.startsWith('all-'));
    expect(found.sort()).toEqual(ids);
    expect(all.find((b) => b.id === 'all-042')).toMatchObject({ title: 'Bookmark all-042', notes: '' });
  });
});
