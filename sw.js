/* Star Party service worker — network-first for the app shell.
   When online, always fetch the latest files (so updates appear on reopen);
   fall back to cache only when offline. This avoids "stuck on an old version".
*/
const CACHE = 'starparty-v7';
const SHELL = [
  '.',
  'index.html',
  'styles.css',
  'app.js',
  'catalog.js',
  'tonight.js',
  'vendor/astronomy.browser.min.js',
  'manifest.webmanifest',
  'icon.svg',
];

self.addEventListener('install', (e) => {
  // Precache resiliently (one bad file won't block the whole update) and
  // bypass the HTTP cache so we store genuinely fresh copies.
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const sameOrigin = new URL(req.url).origin === self.location.origin;

  if (sameOrigin) {
    // Network-first: latest when online, cached fallback when offline.
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
        return res;
      } catch (err) {
        const hit = await caches.match(req);
        return hit || caches.match('index.html');
      }
    })());
  } else {
    // Third-party (e.g. map lookups): cache-first, then network.
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});
