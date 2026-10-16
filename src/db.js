// Almacenamiento local en IndexedDB: los audios quedan en el dispositivo, sin servidor.
// OJO: sw.js abre la misma base (store "inbox"); si cambiás DB_VERSION o los stores, actualizalo también ahí.

export const DB_NAME = 'botonera-db';
export const DB_VERSION = 2;

let dbPromise;

export function openDB() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sounds')) db.createObjectStore('sounds', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('inbox')) db.createObjectStore('inbox', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('shows')) db.createObjectStore('shows', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      // Si otra pestaña actualiza la base, cerramos para no bloquearla.
      req.result.onversionchange = () => { req.result.close(); dbPromise = null; };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function result(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllSounds() {
  const db = await openDB();
  const all = await result(db.transaction('sounds').objectStore('sounds').getAll());
  return all.sort((a, b) => a.order - b.order);
}

export async function putSounds(sounds) {
  const db = await openDB();
  const tx = db.transaction('sounds', 'readwrite');
  for (const s of sounds) tx.objectStore('sounds').put(s);
  return done(tx);
}

export async function deleteSound(id) {
  const db = await openDB();
  const tx = db.transaction('sounds', 'readwrite');
  tx.objectStore('sounds').delete(id);
  return done(tx);
}

// ---------- Funciones (Modo Función) ----------

export async function getAllShows() {
  const db = await openDB();
  const all = await result(db.transaction('shows').objectStore('shows').getAll());
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function putShow(show) {
  const db = await openDB();
  const tx = db.transaction('shows', 'readwrite');
  tx.objectStore('shows').put(show);
  return done(tx);
}

export async function deleteShow(id) {
  const db = await openDB();
  const tx = db.transaction('shows', 'readwrite');
  tx.objectStore('shows').delete(id);
  return done(tx);
}

/** Devuelve y vacía lo que llegó por "Compartir" (lo guarda el service worker). */
export async function takeInbox() {
  const db = await openDB();
  const tx = db.transaction('inbox', 'readwrite');
  const store = tx.objectStore('inbox');
  const items = await result(store.getAll());
  store.clear();
  await done(tx);
  return items;
}
