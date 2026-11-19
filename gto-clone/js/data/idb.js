// A small key-value store in IndexedDB. Unlike localStorage (about 5 MB for
// the whole medapex55-coder.github.io origin, shared with the hand
// histories and the old apex-demo site), it has room to spare and keeps
// Blobs (screenshots) as they are. Every call resolves, to null / false
// when IndexedDB is unavailable (private window, blocked storage).
const DB = /[?&]test=1/.test(location.search) ? 'raisemypoker-test' : 'raisemypoker';
const STORE = 'kv';
let db = null;

function open() {
  db ||= new Promise((ok, ko) => {
    if (!window.indexedDB) { ko(new Error('IndexedDB indisponible')); return; }
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  }).catch((e) => { db = null; throw e; });
  return db;
}

function run(mode, fn) {
  return open().then((d) => new Promise((ok, ko) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => ok(req.result);
    tx.onerror = tx.onabort = () => ko(tx.error);
  }));
}

export const idbGet = (key) => run('readonly', (s) => s.get(key)).catch(() => null);
export const idbSet = (key, value) => run('readwrite', (s) => s.put(value, key)).then(() => true, () => false);
export const idbDel = (key) => run('readwrite', (s) => s.delete(key)).then(() => true, () => false);

// Asks the browser not to clear this site's storage when space runs low.
let asked = false;
export function keepStorage() {
  if (asked) return;
  asked = true;
  navigator.storage?.persist?.().catch(() => {});
}
