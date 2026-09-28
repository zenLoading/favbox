import { describe, expect, it, vi, beforeEach } from 'vitest';
import browser from 'webextension-polyfill';
import { applyDataUpdates, applyCreates } from '@/backup/apply';
import { LIMITS, ERROR } from '@/backup/validate';
import { READ_FAILED, prepareRestore, runRestore } from '@/backup/restore';

const mocks = vi.hoisted(() => ({ findAll: vi.fn() }));

vi.mock('webextension-polyfill', () => ({
  default: { bookmarks: { getTree: vi.fn() } },
}));

// restore.js instantiates BookmarkStorage with `new`, so the mock must be a regular function
vi.mock('@/storage/bookmark', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  default: vi.fn(function BookmarkStorage() { return { findAll: mocks.findAll }; }),
}));

vi.mock('@/backup/apply', () => ({
  applyDataUpdates: vi.fn(),
  applyCreates: vi.fn(),
}));

const backupFile = (value, name = 'backup.json') => new File([JSON.stringify(value)], name, { type: 'application/json' });

const validBackup = {
  format: 'favbox-backup',
  version: 1,
  exportedAt: '2026-09-01T10:00:00.000Z',
  tree: [{
    type: 'folder',
    title: 'Bookmarks bar',
    children: [
      {
        type: 'bookmark', title: 'A', url: 'https://a.com/', data: { notes: '<p>n</p>' },
      },
      { type: 'bookmark', title: 'Gone', url: 'https://gone.com/' },
      { type: 'bookmark', title: 'Evil', url: 'javascript:alert(1)' }, // eslint-disable-line no-script-url
    ],
  }],
};

describe('prepareRestore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(browser.bookmarks.getTree).mockResolvedValue([{
      id: '0',
      children: [{ id: '1', title: 'Bookmarks bar', children: [{ id: '10', title: 'A', url: 'https://a.com/' }] }],
    }]);
    mocks.findAll.mockResolvedValue([{ id: '10', notes: '' }]);
  });

  it('rejects files that are too large without reading them', async () => {
    const file = backupFile(validBackup);

    const result = await prepareRestore(file, { ...LIMITS, maxChars: 10 });

    expect(result).toEqual({ error: { code: ERROR.TOO_LARGE } });
    expect(browser.bookmarks.getTree).not.toHaveBeenCalled();
  });

  it('returns validation errors', async () => {
    const result = await prepareRestore(new File(['not json'], 'x.json'));

    expect(result).toEqual({ error: { code: ERROR.INVALID_JSON } });
  });

  it('reports files that cannot be read', async () => {
    const unreadable = { size: 10 };

    expect(await prepareRestore(unreadable)).toEqual({ error: { code: READ_FAILED } });
  });

  it('plans the restore against the current bookmarks and keeps what validation skipped', async () => {
    const result = await prepareRestore(backupFile(validBackup));

    expect(result.error).toBeNull();
    expect(result.exportedAt).toBe('2026-09-01T10:00:00.000Z');
    expect(result.skipped.count).toBe(1);
    expect(result.plan.summary).toEqual({
      matched: 1, toUpdate: 1, mergedNotes: 0, unchanged: 0, toCreate: 1,
    });
  });
});

describe('runRestore', () => {
  const plan = {
    updates: [{ id: '1' }, { id: '2' }],
    creates: [{ url: 'https://gone.com/' }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(applyDataUpdates).mockImplementation(async (updates, { onProgress }) => {
      updates.forEach((_, i) => onProgress({ done: i + 1, total: updates.length }));
      return {
        updated: 1, merged: 1, created: 0, unchanged: 0, failed: [{ title: 'X', url: 'https://x.com/', reason: 'gone' }],
      };
    });
    vi.mocked(applyCreates).mockImplementation(async (creates, { onProgress }) => {
      creates.forEach((_, i) => onProgress({ done: i + 1, total: creates.length }));
      return {
        folderId: '99', folders: 2, bookmarks: 1, failed: [],
      };
    });
  });

  it('only restores data by default', async () => {
    const report = await runRestore(plan, { folderTitle: 'R' });

    expect(applyDataUpdates).toHaveBeenCalledWith(plan.updates, expect.any(Object));
    expect(applyCreates).not.toHaveBeenCalled();
    expect(report).toEqual({
      updated: 1, merged: 1, created: 0, recreated: 0, folderTitle: null, failed: [{ title: 'X', url: 'https://x.com/', reason: 'gone' }],
    });
  });

  it('recreates missing bookmarks when asked', async () => {
    const report = await runRestore(plan, { restoreData: false, recreateMissing: true, folderTitle: 'R' });

    expect(applyDataUpdates).not.toHaveBeenCalled();
    expect(applyCreates).toHaveBeenCalledWith(plan.creates, expect.objectContaining({ folderTitle: 'R' }));
    expect(report).toMatchObject({ recreated: 1, folderTitle: 'R', failed: [] });
  });

  it('reports progress across both steps', async () => {
    const onProgress = vi.fn();

    await runRestore(plan, { recreateMissing: true, folderTitle: 'R', onProgress });

    expect(onProgress.mock.calls.map(([p]) => p)).toEqual([
      { done: 1, total: 3 },
      { done: 2, total: 3 },
      { done: 3, total: 3 },
    ]);
  });

  it('does nothing when both options are off', async () => {
    const report = await runRestore(plan, { restoreData: false, recreateMissing: false, folderTitle: 'R' });

    expect(applyDataUpdates).not.toHaveBeenCalled();
    expect(applyCreates).not.toHaveBeenCalled();
    expect(report.failed).toEqual([]);
  });
});
