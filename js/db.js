'use strict';
/*
 * IndexedDB を使った端末内保存。外部への送信は一切行わない。
 *
 * entries（入出金）:
 *   { id, date:'YYYY-MM-DD', type:'income'|'expense', categoryId, amount:整数,
 *     createdAt:ISO文字列, updatedAt:ISO文字列|null }
 * categories（項目）:
 *   { id, type:'income'|'expense', name, color:'#rrggbb', order:整数, hidden:真偽 }
 *
 * v1 → v2: 項目を名前（category）で持っていたものを ID（categoryId）参照に移行。
 *          項目名を変えても入力済みデータが引き継がれるようにするため。
 */
const DB = (() => {
  const NAME = 'kakeibo';
  const VERSION = 2;

  const DEFAULT_CATEGORIES = [
    { id: 'c-salary', type: 'income', name: '給与', color: '#e15759', order: 0, hidden: false },
    { id: 'c-bonus', type: 'income', name: '賞与', color: '#f28e2b', order: 1, hidden: false },
    { id: 'c-food', type: 'expense', name: '食費', color: '#4e79a7', order: 0, hidden: false },
    { id: 'c-shopping', type: 'expense', name: '買い物', color: '#76b7b2', order: 1, hidden: false },
    { id: 'c-rent', type: 'expense', name: '家賃', color: '#59a14f', order: 2, hidden: false },
    { id: 'c-subsc', type: 'expense', name: 'サブスク', color: '#b8a12a', order: 3, hidden: false },
    { id: 'c-game', type: 'expense', name: 'ゲーム課金', color: '#b07aa1', order: 4, hidden: false },
  ];

  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(NAME, VERSION);
        req.onupgradeneeded = (ev) => {
          const db = req.result;
          const tx = req.transaction;
          const old = ev.oldVersion;
          if (old < 1) {
            const s = db.createObjectStore('entries', { keyPath: 'id' });
            s.createIndex('date', 'date');
          }
          if (old < 2) {
            const cs = db.createObjectStore('categories', { keyPath: 'id' });
            DEFAULT_CATEGORIES.forEach((c) => cs.put(c));
            // 既存の入出金データを「項目名」→「項目ID」に置き換える
            const byName = new Map(DEFAULT_CATEGORIES.map((c) => [`${c.type}|${c.name}`, c.id]));
            tx.objectStore('entries').openCursor().onsuccess = (e) => {
              const cur = e.target.result;
              if (!cur) return;
              const v = cur.value;
              if (!v.categoryId) {
                const id = byName.get(`${v.type}|${v.category}`);
                if (id) {
                  v.categoryId = id;
                  delete v.category;
                  cur.update(v);
                }
              }
              cur.continue();
            };
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          // 別タブで新しい版が開かれたら接続を閉じる（更新の妨げにならないように）
          db.onversionchange = () => db.close();
          resolve(db);
        };
        req.onerror = () => reject(req.error);
        req.onblocked = () => console.warn('古い版のアプリが別のタブで開かれています。閉じてから再読み込みしてください。');
      });
    }
    return dbPromise;
  }

  // fn がリクエストを返した場合、トランザクション完了時にその結果を返す
  function tx(store, mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('transaction aborted'));
    }));
  }

  return {
    getAll: (store) => tx(store, 'readonly', (s) => s.getAll()),
    putMany: (store, list) => tx(store, 'readwrite', (s) => { list.forEach((e) => s.put(e)); }),
    deleteMany: (store, ids) => tx(store, 'readwrite', (s) => { ids.forEach((id) => s.delete(id)); }),
    // ブラウザによる自動削除を避けるよう永続化を要求（許可されない場合もある）
    requestPersist: () => (navigator.storage && navigator.storage.persist
      ? navigator.storage.persist().catch(() => false)
      : Promise.resolve(false)),
  };
})();
