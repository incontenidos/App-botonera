// Almacenamiento local en IndexedDB: los audios quedan en el dispositivo, sin servidor.
// OJO: sw.js abre la misma base (store "inbox"); si cambiás DB_VERSION o los stores, actualizalo también ahí.

export const DB_NAME = 'botonera-db';
export const DB_VERSION = 2;

let dbPromise;
let blockedHandler = () => {};

/** Se llama cuando otra ventana con una versión vieja tiene la base abierta y no deja actualizarla. */
export function onBlocked(fn) {
  blockedHandler = fn;
}

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
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
    req.onblocked = () => blockedHandler();
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

// Algunos Safari (iPhone) fallan al guardar archivos (Blob) en IndexedDB. Si pasa, reintentamos
// guardando los bytes (ArrayBuffer) y los volvemos a convertir en Blob al leer.
async function packBlob(obj) {
  if (!(obj?.blob instanceof Blob)) return obj;
  const { blob, ...rest } = obj;
  return { ...rest, blobData: await blob.arrayBuffer(), blobType: blob.type };
}

function unpackBlob(obj) {
  if (!obj?.blobData) return obj;
  const { blobData, blobType, ...rest } = obj;
  return { ...rest, blob: new Blob([blobData], { type: blobType || 'audio/mpeg' }) };
}

async function putAll(store, items) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  for (const it of items) tx.objectStore(store).put(it);
  return done(tx);
}

/** Guarda; si el navegador rechaza los Blob, reintenta con bytes. */
async function putWithFallback(store, items, pack) {
  try {
    await putAll(store, items);
  } catch (e) {
    if (e?.name === 'QuotaExceededError') throw e;
    console.warn('Reintentando guardado sin Blob', e);
    await putAll(store, await Promise.all(items.map(pack)));
  }
}

export async function getAllSounds() {
  const db = await openDB();
  const all = await result(db.transaction('sounds').objectStore('sounds').getAll());
  return all.map(unpackBlob).sort((a, b) => a.order - b.order);
}

export function putSounds(sounds) {
  return putWithFallback('sounds', sounds, packBlob);
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
  return all.map((s) => ({ ...s, cues: (s.cues || []).map(unpackBlob) })).sort((a, b) => a.createdAt - b.createdAt);
}

export function putShow(show) {
  return putWithFallback('shows', [show], async (s) => ({ ...s, cues: await Promise.all(s.cues.map(packBlob)) }));
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
