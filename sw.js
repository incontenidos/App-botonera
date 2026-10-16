// Service worker: funciona sin conexión y recibe audios/links desde "Compartir" (Web Share Target).
// Cambiar este número en cada versión publicada: así el navegador instala el service worker nuevo.
const VERSION = '1.4';
const CACHE = `botonera-${VERSION}`;
const SHELL = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './src/app.js', './src/db.js', './src/player.js', './src/recorder.js', './src/sources.js',
  './src/cues.js', './src/show-engine.js', './src/show.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' saltea la caché HTTP (GitHub Pages guarda archivos hasta 10 min) y evita mezclar versiones.
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const old = (await caches.keys()).filter((k) => k !== CACHE);
    await Promise.all(old.map((k) => caches.delete(k)));
    await self.clients.claim();
    // Si es una actualización (había una versión anterior), recargamos las pestañas abiertas
    // para que no queden con una mezcla de archivos viejos y nuevos.
    if (old.length) {
      const wins = await self.clients.matchAll({ type: 'window' });
      await Promise.all(wins.map((w) => w.navigate(w.url).catch(() => {})));
    }
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method === 'POST' && url.origin === self.location.origin && url.pathname.endsWith('/share-target')) {
    event.respondWith(receiveShare(request));
    return;
  }
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Red primero, revalidando siempre con el servidor (no-cache), y caché propia si no hay conexión.
  const fresh = request.mode === 'navigate'
    ? fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' })
    : fetch(request, { cache: 'no-cache' });
  event.respondWith(
    fresh
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request, { ignoreSearch: true })
        .then((hit) => hit || caches.match('./index.html'))),
  );
});

// Misma base que src/db.js (mantener DB_NAME, versión y stores sincronizados).
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('botonera-db', 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sounds')) db.createObjectStore('sounds', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('inbox')) db.createObjectStore('inbox', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('shows')) db.createObjectStore('shows', { keyPath: 'id' });
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
