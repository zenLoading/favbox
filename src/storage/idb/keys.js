/**
 * Reads only the primary keys of an object store with native IndexedDB.
 * JsStore iterates full records with a cursor, which also loads large fields
 * (images, notes) just to get the ids.
 * The database is opened without a version so JsStore keeps owning the schema:
 * a missing database is not created, and the connection closes right away
 * so it never blocks a JsStore upgrade.
 * @param {string} dbName
 * @param {string} storeName
 * @returns {Promise<Array<string|number>>}
 */
export default function readAllKeys(dbName, storeName) {
  return new Promise((resolve, reject) => {
    let isMissing = false;
    const request = indexedDB.open(dbName);
    request.onupgradeneeded = () => {
      // Only fires when the database does not exist: abort instead of creating an empty one
      isMissing = true;
      request.transaction.abort();
    };
    request.onerror = (event) => {
      if (isMissing) {
        event.preventDefault();
        resolve([]);
        return;
      }
      reject(request.error);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      try {
        const keysRequest = db.transaction(storeName, 'readonly').objectStore(storeName).getAllKeys();
        keysRequest.onsuccess = () => resolve(keysRequest.result);
        keysRequest.onerror = () => reject(keysRequest.error);
      } catch (e) {
        reject(e);
      } finally {
        // Pending requests still complete after close()
        db.close();
      }
    };
  });
}
