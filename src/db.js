// Local storage in IndexedDB. Books are keyed by ISBN-13.
// Deleted books are kept as tombstones ({deleted: true}) so that merging
// backups between devices doesn't resurrect them.

const DB_NAME = "spine";
const DB_VERSION = 1;
let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("books")) db.createObjectStore("books", { keyPath: "isbn" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/** All records including tombstones. */
export function getAllRaw() {
  return tx("books", "readonly", (s) => s.getAll());
}

export async function getAll() {
  return (await getAllRaw()).filter((b) => !b.deleted);
}

export async function get(isbn) {
  const b = await tx("books", "readonly", (s) => s.get(isbn));
  return b && !b.deleted ? b : null;
}

export function put(book) {
  const now = new Date().toISOString();
  const record = { ...book, deleted: false, addedAt: book.addedAt || now, updatedAt: now };
  return tx("books", "readwrite", (s) => s.put(record)).then(() => record);
}

/** Write without touching updatedAt (background fixes like covers must not win merges). */
export function putQuiet(book) {
  return tx("books", "readwrite", (s) => s.put(book));
}

export function remove(isbn) {
  const now = new Date().toISOString();
  return tx("books", "readwrite", (s) => s.put({ isbn, deleted: true, updatedAt: now }));
}

/** Merge incoming records: the newer updatedAt wins. Returns counts. */
export async function merge(incoming) {
  const existing = new Map((await getAllRaw()).map((b) => [b.isbn, b]));
  const stats = { added: 0, updated: 0, removed: 0, unchanged: 0 };
  const toWrite = [];
  for (const b of incoming) {
    const cur = existing.get(b.isbn);
    if (cur && cur.updatedAt >= b.updatedAt) { stats.unchanged++; continue; }
    toWrite.push(b);
    if (b.deleted) { if (cur && !cur.deleted) stats.removed++; else stats.unchanged++; }
    else if (!cur || cur.deleted) stats.added++;
    else stats.updated++;
  }
  await tx("books", "readwrite", (s) => toWrite.forEach((b) => s.put(b)));
  return stats;
}

export function getMeta(key) {
  return tx("meta", "readonly", (s) => s.get(key));
}

export function setMeta(key, value) {
  return tx("meta", "readwrite", (s) => s.put(value, key));
}
