// Local storage on the phone, using IndexedDB (survives closing the app).
// Stores:
//   attempts  one record per answered problem
//   kv        small values: settings, wording rotation

const DB_NAME = 'mental-math-drills';
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        const attempts = db.createObjectStore('attempts', { keyPath: 'id', autoIncrement: true });
        attempts.createIndex('ts', 'ts');
        db.createObjectStore('kv', { keyPath: 'key' });
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Database is blocked by another open tab'));
    });
  }
  return dbPromise;
}

async function run(storeName, mode, work) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    const req = work(store);
    if (req) req.onsuccess = () => (result = req.result);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

export const db = {
  async allAttempts() {
    const list = await run('attempts', 'readonly', (s) => s.index('ts').getAll());
    return list || [];
  },
  addAttempt(attempt) {
    const { id, ...rest } = attempt;
    return run('attempts', 'readwrite', (s) => s.add(rest));
  },
  addAttempts(list) {
    return run('attempts', 'readwrite', (s) => {
      for (const { id, ...rest } of list) s.add(rest);
    });
  },
  async getKV(key) {
    const row = await run('kv', 'readonly', (s) => s.get(key));
    return row ? row.value : undefined;
  },
  setKV(key, value) {
    return run('kv', 'readwrite', (s) => s.put({ key, value }));
  },
  async clearAll() {
    await run('attempts', 'readwrite', (s) => s.clear());
    await run('kv', 'readwrite', (s) => s.clear());
  },
};
