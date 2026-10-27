// Pamięć lokalna: IndexedDB (znaleziska, zdjęcia, ślady). Gdy IndexedDB jest niedostępne,
// aplikacja działa w pamięci tymczasowej i ostrzega użytkownika.

const DB_NAME = 'detektor';
const DB_VERSION = 1;
const STORES = ['pins', 'photos', 'tracks'];

let dbPromise = null;
let memory = null; // awaryjny magazyn w pamięci

export function isMemoryOnly() {
  return memory !== null;
}

export function uid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('Brak IndexedDB'));
      return;
    }
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Baza zablokowana'));
  });
  return dbPromise;
}

function useMemory() {
  if (!memory) {
    memory = { pins: new Map(), photos: new Map(), tracks: new Map() };
  }
}

async function run(store, mode, fn) {
  if (memory) return memFn(store, mode, fn);
  let db;
  try {
    db = await openDb();
  } catch (e) {
    useMemory();
    return memFn(store, mode, fn);
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const st = tx.objectStore(store);
    let out;
    const rq = fn(st);
    if (rq) {
      rq.onsuccess = () => {
        out = rq.result;
      };
    }
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transakcja przerwana'));
  });
}

// Prosta atrapa API IndexedDB dla trybu awaryjnego.
function memFn(store, mode, fn) {
  const m = memory[store];
  const fake = {
    getAll: () => ({ set onsuccess(cb) { queueMicrotask(() => { fake._r = [...m.values()]; cb(); }); }, get result() { return fake._r; } }),
    get: (id) => ({ set onsuccess(cb) { queueMicrotask(() => { fake._r = m.get(id); cb(); }); }, get result() { return fake._r; } }),
    put: (o) => ({ set onsuccess(cb) { queueMicrotask(() => { m.set(o.id, o); fake._r = o.id; cb(); }); }, get result() { return fake._r; } }),
    delete: (id) => ({ set onsuccess(cb) { queueMicrotask(() => { m.delete(id); cb(); }); }, get result() { return undefined; } })
  };
  return new Promise((resolve) => {
    const rq = fn(fake);
    if (rq) {
      rq.onsuccess = () => resolve(rq.result);
    } else {
      resolve(undefined);
    }
  });
}

export const getAll = (store) => run(store, 'readonly', (st) => st.getAll());
export const get = (store, id) => run(store, 'readonly', (st) => st.get(id));
export const put = (store, obj) => run(store, 'readwrite', (st) => st.put(obj));
export const del = (store, id) => run(store, 'readwrite', (st) => st.delete(id));

// Proszenie przeglądarki o trwałe przechowywanie (chroni dane przed automatycznym czyszczeniem).
export async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch (e) {
    /* ignoruj */
  }
  return false;
}

export async function storageInfo() {
  const info = { usage: null, quota: null, persisted: null };
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      info.usage = e.usage ?? null;
      info.quota = e.quota ?? null;
    }
    if (navigator.storage && navigator.storage.persisted) {
      info.persisted = await navigator.storage.persisted();
    }
  } catch (e) {
    /* ignoruj */
  }
  return info;
}
