// Service worker: funciona sin conexión y recibe audios/links desde "Compartir" (Web Share Target).
const CACHE = 'botonera-v2';
const SHELL = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './src/app.js', './src/db.js', './src/player.js', './src/recorder.js', './src/sources.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method === 'POST' && url.origin === self.location.origin && url.pathname.endsWith('/share-target')) {
    event.respondWith(receiveShare(request));
    return;
  }
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Red primero (para tener siempre la última versión) y caché si no hay conexión.
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request, { ignoreSearch: request.mode === 'navigate' })
        .then((hit) => hit || caches.match('./index.html'))),
  );
});

// Misma base que src/db.js (mantener DB_NAME, versión y stores sincronizados).
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('botonera-db', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sounds')) db.createObjectStore('sounds', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('inbox')) db.createObjectStore('inbox', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function receiveShare(request) {
  const back = new URL('./?shared=1', self.registration.scope).href;
  try {
    const form = await request.formData();
    const files = form.getAll('audio')
      .filter((f) => f && typeof f !== 'string' && f.size > 0)
      .map((f) => ({ name: f.name, type: f.type, blob: f }));
    const text = ['title', 'text', 'url'].map((k) => form.get(k)).filter((v) => typeof v === 'string' && v).join(' ');
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('inbox', 'readwrite');
      tx.objectStore('inbox').add({ files, text, at: Date.now() });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('No se pudo recibir lo compartido', e);
  }
  return Response.redirect(back, 303);
}
