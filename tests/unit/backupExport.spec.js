import { describe, expect, it, vi, beforeEach } from 'vitest';
import browser from 'webextension-polyfill';
import downloadText from '@/backup/download';
import exportBackup from '@/backup/export';

const mocks = vi.hoisted(() => ({
  findAll: vi.fn(),
}));

vi.mock('webextension-polyfill', () => ({
  default: {
    bookmarks: { getTree: vi.fn() },
    runtime: { getManifest: vi.fn(() => ({ name: 'FavBox', version: '2.2.0' })) },
    storage: { local: { set: vi.fn() } },
  },
}));

// export.js instantiates BookmarkStorage with `new`, so the mock must be a regular function
vi.mock('@/storage/bookmark', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  default: vi.fn(function BookmarkStorage() { return { findAll: mocks.findAll }; }),
}));

vi.mock('@/backup/download', () => ({
  default: vi.fn(),
}));

const tree = [{
  id: '0',
  title: '',
  children: [{
    id: '1',
    title: 'Bookmarks bar',
    children: [
      { id: '10', parentId: '1', title: 'A', url: 'https://a.com/', dateAdded: 1 },
      { id: '11', parentId: '1', title: 'B', url: 'https://b.com/', dateAdded: 2 },
    ],
  }],
}];

describe('exportBackup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(browser.bookmarks.getTree).mockResolvedValue(tree);
    vi.mocked(browser.storage.local.set).mockResolvedValue();
    mocks.findAll.mockResolvedValue([
      { id: '10', notes: '<p>n</p>', pinned: 1, image: 'data:image/jpeg;base64,AAAA' },
    ]);
    localStorage.clear();
    localStorage.setItem('fontSize', 'lg');
  });

  it('downloads a backup of the bookmark tree, stored data and settings', async () => {
    await exportBackup({ now: new Date(2026, 8, 28, 9, 5) });

    expect(downloadText).toHaveBeenCalledTimes(1);
    const [content, fileName, type] = vi.mocked(downloadText).mock.calls[0];
    expect(fileName).toBe('favbox-backup-20260928-0905.json');
    expect(type).toBe('application/json');
    const backup = JSON.parse(content);
    expect(backup).toMatchObject({
      format: 'favbox-backup',
      app: { name: 'FavBox', version: '2.2.0' },
      settings: { fontSize: 'lg' },
    });
    expect(backup.tree[0].children[0].data).toMatchObject({ notes: '<p>n</p>', pinned: 1 });
  });

  it('records when the last backup was made', async () => {
    const now = new Date(2026, 8, 28, 9, 5);

    await exportBackup({ now });

    expect(browser.storage.local.set).toHaveBeenCalledWith({ lastBackupAt: now.getTime() });
  });

  it('returns a summary for the notification', async () => {
    const summary = await exportBackup();

    expect(summary).toEqual({ bookmarks: 2, folders: 1, notes: 1, pinned: 1, screenshots: 1 });
  });

  it('passes includeScreenshots through', async () => {
    await exportBackup({ includeScreenshots: false });

    const backup = JSON.parse(vi.mocked(downloadText).mock.calls[0][0]);
    expect(backup.options.includeScreenshots).toBe(false);
    expect(backup.tree[0].children[0].data).not.toHaveProperty('image');
  });

  it('does not record a backup time when reading data fails', async () => {
    mocks.findAll.mockRejectedValue(new Error('IDB closed'));

    await expect(exportBackup()).rejects.toThrow('IDB closed');
    expect(downloadText).not.toHaveBeenCalled();
    expect(browser.storage.local.set).not.toHaveBeenCalled();
  });
});
