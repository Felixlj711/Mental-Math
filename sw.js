// Service worker: keeps a copy of the app on the phone so it works offline.
//
// IMPORTANT: whenever you change any file, bump VERSION below. That is how
// phones notice there is an update (they then show an "Update" button).

const VERSION = 'v1.1.0';
const CACHE = `mental-math-${VERSION}`;

const FILES = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/chart.js',
  './js/db.js',
  './js/engine.js',
  './js/format.js',
  './js/generators.js',
  './js/rng.js',
  './js/stats.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the browser's HTTP cache so we store fresh files
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
  );
});

// The page asks for this when you tap "Update".
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('mental-math-') && key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })()
  );
});

// Cache first: answer from the phone's copy, fall back to the network.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        return await fetch(req);
      } catch (err) {
        if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
        throw err;
      }
    })()
  );
});
