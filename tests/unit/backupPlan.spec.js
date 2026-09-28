import { describe, expect, it } from 'vitest';
import {
  NOTES_SEPARATOR, flattenBackup, flattenBrowserTree, planRestore,
} from '@/backup/plan';

const deepFreeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

const backupOf = (tree) => ({
  format: 'favbox-backup', version: 1, settings: {}, tree,
});
const bm = (title, url, data, dateAdded = 1000) => ({
  type: 'bookmark', title, url, dateAdded, ...(data && { data }),
});
const dir = (title, children) => ({ type: 'folder', title, children });

const browserTree = (roots) => [{ id: '0', title: '', children: roots }];
const node = (id, title, url, dateAdded = 1000) => ({ id, title, url, dateAdded });
const folderNode = (id, title, children) => ({ id, title, children });

describe('flattenBackup', () => {
  it('lists bookmarks with their folder path below the root', () => {
    const backup = backupOf([
      dir('Bookmarks bar', [bm('A', 'https://a.com/'), dir('Dev', [dir('JS', [bm('B', 'https://b.com/', { notes: 'n' })])])]),
      dir('Other bookmarks', [bm('C', 'https://c.com/')]),
    ]);

    expect(flattenBackup(backup)).toEqual([
      {
        root: 'Bookmarks bar', path: [], title: 'A', url: 'https://a.com/', dateAdded: 1000, data: {},
      },
      {
        root: 'Bookmarks bar', path: ['Dev', 'JS'], title: 'B', url: 'https://b.com/', dateAdded: 1000, data: { notes: 'n' },
      },
      {
        root: 'Other bookmarks', path: [], title: 'C', url: 'https://c.com/', dateAdded: 1000, data: {},
      },
    ]);
  });

  it('keeps bookmarks placed directly at the top level', () => {
    expect(flattenBackup(backupOf([bm('A', 'https://a.com/')]))[0]).toMatchObject({ root: null, path: [] });
  });
});

describe('flattenBrowserTree', () => {
  it('lists bookmarks with folder path and stored row', () => {
    const tree = browserTree([
      folderNode('1', 'Bookmarks bar', [node('10', 'A', 'https://a.com/'), folderNode('11', 'Dev', [node('12', 'B', 'https://b.com/')])]),
    ]);
    const rows = [{ id: '12', notes: 'n' }];

    expect(flattenBrowserTree(tree, rows)).toEqual([
      {
        id: '10', path: [], title: 'A', url: 'https://a.com/', dateAdded: 1000, row: null,
      },
      {
        id: '12', path: ['Dev'], title: 'B', url: 'https://b.com/', dateAdded: 1000, row: { id: '12', notes: 'n' },
      },
    ]);
  });
});

describe('planRestore', () => {
  const plan = (backupTree, roots, rows) => planRestore(backupOf(backupTree), browserTree(roots), rows);

  it('restores notes, pins and screenshots onto matching bookmarks', () => {
    const result = plan(
      [dir('Bar', [bm('A', 'https://a.com/', { notes: '<p>n</p>', pinned: 1, image: 'data:image/jpeg;base64,AA' })])],
      [folderNode('1', 'Bar', [node('10', 'A', 'https://a.com/')])],
      [{ id: '10', notes: '', pinned: 0, image: null }],
    );

    expect(result.updates).toEqual([{
      id: '10',
      title: 'A',
      url: 'https://a.com/',
      rowMissing: false,
      changes: { notes: '<p>n</p>', pinned: 1, image: 'data:image/jpeg;base64,AA' },
      mergedNotes: false,
      backupData: { notes: '<p>n</p>', pinned: 1, image: 'data:image/jpeg;base64,AA' },
      dateAdded: 1000,
    }]);
    expect(result.summary).toEqual({
      matched: 1, toUpdate: 1, mergedNotes: 0, unchanged: 0, toCreate: 0,
    });
  });

  it('appends different backup notes to existing notes instead of overwriting', () => {
    const result = plan(
      [dir('Bar', [bm('A', 'https://a.com/', { notes: '<p>old</p>' })])],
      [folderNode('1', 'Bar', [node('10', 'A', 'https://a.com/')])],
      [{ id: '10', notes: '<p>new</p>' }],
    );

    expect(result.updates[0].changes).toEqual({ notes: `<p>new</p>${NOTES_SEPARATOR}<p>old</p>` });
    expect(result.updates[0].mergedNotes).toBe(true);
    expect(result.summary.mergedNotes).toBe(1);
  });

  it.each(['', '<p></p>', '  ', undefined, null])('treats %j as no notes and replaces it', (notes) => {
    const result = plan(
      [dir('Bar', [bm('A', 'https://a.com/', { notes: '<p>old</p>' })])],
      [folderNode('1', 'Bar', [node('10', 'A', 'https://a.com/')])],
      [{ id: '10', notes }],
    );

    expect(result.updates[0].changes).toEqual({ notes: '<p>old</p>' });
    expect(result.updates[0].mergedNotes).toBe(false);
  });

  it('skips backup notes that are empty', () => {
    const result = plan(
      [dir('Bar', [bm('A', 'https://a.com/', { notes: '<p></p>' })])],
      [folderNode('1', 'Bar', [node('10', 'A', 'https://a.com/')])],
      [{ id: '10', notes: '<p>keep</p>' }],
    );

    expect(result.updates).toEqual([]);
  });

  it('is idempotent: restoring the same backup twice changes nothing the second time', () => {
    const merged = `<p>new</p>${NOTES_SEPARATOR}<p>old</p>`;
    const result = plan(
      [dir('Bar', [bm('A', 'https://a.com/', { notes: '<p>old</p>', pinned: 1, image: 'https://a.com/og.png' })])],
      [folderNode('1', 'Bar', [node('10', 'A', 'https://a.com/')])],
      [{ id: '10', notes: merged, pinned: 1, image: 'https://a.com/other.png' }],
    );

    expect(result.updates).toEqual([]);
    expect(result.summary).toMatchObject({ matched: 1, toUpdate: 0, unchanged: 1 });
  });

  it('never unpins and never replaces an existing image', () => {
    const result = plan(
      [dir('Bar', [bm('A', 'https://a.com/', { pinned: 0, image: 'https://a.com/backup.png' })])],
      [folderNode('1', 'Bar', [node('10', 'A', 'https://a.com/')])],
      [{ id: '10', pinned: 1, image: 'https://a.com/current.png' }],
    );

    expect(result.updates).toEqual([]);
  });

  it('flags matches whose bookmark is not stored yet, keeping the backup data to create the row', () => {
    const data = { notes: 'n', description: 'd', favicon: 'https://a.com/f.ico' };
    const result = plan(
      [dir('Bar', [bm('A', 'https://a.com/', data, 42)])],
      [folderNode('1', 'Bar', [node('10', 'A', 'https://a.com/')])],
      [],
    );

    expect(result.updates[0]).toMatchObject({
      id: '10', rowMissing: true, changes: { notes: 'n' }, backupData: data, dateAdded: 42,
    });
  });

  it('lists missing bookmarks to recreate, keeping their root and folder path', () => {
    const result = plan(
      [dir('Bookmarks bar', [dir('Dev', [bm('Gone', 'https://gone.com/', { notes: 'n' }, 7)])])],
      [folderNode('1', 'Bookmarks bar', [])],
      [],
    );

    expect(result.creates).toEqual([{
      folders: ['Bookmarks bar', 'Dev'], title: 'Gone', url: 'https://gone.com/', dateAdded: 7, data: { notes: 'n' },
    }]);
    expect(result.summary.toCreate).toBe(1);
  });

  it('counts matches with nothing to restore as unchanged', () => {
    const result = plan(
      [dir('Bar', [bm('A', 'https://a.com/')])],
      [folderNode('1', 'Bar', [node('10', 'A', 'https://a.com/')])],
      [{ id: '10', notes: '' }],
    );

    expect(result.summary).toEqual({
      matched: 1, toUpdate: 0, mergedNotes: 0, unchanged: 1, toCreate: 0,
    });
  });

  it('does not mutate its inputs', () => {
    const backup = deepFreeze(backupOf([dir('Bar', [bm('A', 'https://a.com/', { notes: 'x' })])]));
    const tree = deepFreeze(browserTree([folderNode('1', 'Bar', [node('10', 'A', 'https://a.com/')])]));
    const rows = deepFreeze([{ id: '10', notes: 'y' }]);

    expect(() => planRestore(backup, tree, rows)).not.toThrow();
  });
});
