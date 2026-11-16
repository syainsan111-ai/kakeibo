'use strict';
/*
 * IndexedDB を使った端末内保存。外部への送信は一切行わない。
 * レコード形式:
 *   { id, date:'YYYY-MM-DD', type:'income'|'expense', category, amount:整数,
 *     createdAt:ISO文字列, updatedAt:ISO文字列|null }
 */
const DB = (() => {
  const NAME = 'kakeibo';
  const VERSION = 1;
  const STORE = 'entries';
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(NAME, VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) {
            const store = db.createObjectStore(STORE, { keyPath: 'id' });
            store.createIndex('date', 'date');
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  // fn がリクエストを返した場合、トランザクション完了時にその結果を返す
  function tx(mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('transaction aborted'));
    }));
  }

  return {
    getAll: () => tx('readonly', (s) => s.getAll()),
    putMany: (list) => tx('readwrite', (s) => { list.forEach((e) => s.put(e)); }),
    deleteMany: (ids) => tx('readwrite', (s) => { ids.forEach((id) => s.delete(id)); }),
    // ブラウザによる自動削除を避けるよう永続化を要求（許可されない場合もある）
    requestPersist: () => (navigator.storage && navigator.storage.persist
      ? navigator.storage.persist().catch(() => false)
      : Promise.resolve(false)),
  };
})();
