import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import readAllKeys from '@/storage/idb/keys';

const DB_NAME = 'favbox_test';

const openDb = (version, upgrade) => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, version);
  request.onupgradeneeded = () => upgrade?.(request.result);
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const deleteDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.deleteDatabase(DB_NAME);
  request.onsuccess = () => resolve();
  request.onerror = () => reject(request.error);
});

const seed = async (records) => {
  const db = await openDb(1, (upgradeDb) => upgradeDb.createObjectStore('bookmarks', { keyPath: 'id' }));
  await new Promise((resolve, reject) => {
    const tx = db.transaction('bookmarks', 'readwrite');
    records.forEach((record) => tx.objectStore('bookmarks').put(record));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
};

describe('readAllKeys', () => {
  beforeEach(async () => {
    await deleteDb();
  });

  it('returns the primary keys of every record', async () => {
    await seed([
      { id: '10', title: 'b', image: 'data:image/jpeg;base64,AAAA' },
      { id: '2', title: 'a' },
      { id: '300', title: 'c' },
    ]);

    const keys = await readAllKeys(DB_NAME, 'bookmarks');

    expect([...keys].sort()).toEqual(['10', '2', '300']);
  });

  it('returns an empty list for an empty store', async () => {
    await seed([]);

    expect(await readAllKeys(DB_NAME, 'bookmarks')).toEqual([]);
  });

  it('does not create the database when it does not exist yet', async () => {
    const keys = await readAllKeys(DB_NAME, 'bookmarks');

    expect(keys).toEqual([]);
    const databases = await indexedDB.databases();
    expect(databases.map((d) => d.name)).not.toContain(DB_NAME);
  });

  it('rejects when the store does not exist', async () => {
    (await openDb(1, (upgradeDb) => upgradeDb.createObjectStore('other'))).close();

    await expect(readAllKeys(DB_NAME, 'bookmarks')).rejects.toThrow();
  });

  it('does not block a later version upgrade', async () => {
    await seed([{ id: '1' }]);
    await readAllKeys(DB_NAME, 'bookmarks');

    const db = await openDb(2, (upgradeDb) => upgradeDb.createObjectStore('attributes', { keyPath: 'id' }));

    expect([...db.objectStoreNames]).toContain('attributes');
    db.close();
  });
});
