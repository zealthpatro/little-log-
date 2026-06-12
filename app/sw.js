/* Cubby service worker.
   Bump CACHE on every deploy so old assets are cleared. */
const CACHE = 'little-log-v58';
const ASSETS = [
  '/app/',
  '/app/index.html',
  '/app/firebase-init.js',
  '/app/store-firebase.js',
  '/app/cubby-extras.js',
  '/app/growth-data.js',
  '/app/landing.js',
  '/app/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/logo-512.png',
  '/icons/favicon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // Only manage same-origin requests. Let Firebase, Google sign-in and font CDNs pass through untouched.
  if (new URL(req.url).origin !== self.location.origin) return;

  const accept = req.headers.get('accept') || '';
  const isHTML = req.mode === 'navigate' || accept.indexOf('text/html') !== -1;

  if (isHTML) {
    // Network-first for the page so updates land immediately; fall back to cache offline.
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
  } else if (new URL(req.url).pathname.endsWith('.js')) {
    // Network-first for our own JS, so HTML and its scripts/CSS never drift out of sync
    // (a stale cached script was rendering the Pro sheet unstyled). Cache is offline fallback.
    e.respondWith(
      fetch(req)
        .then((res) => { if (res && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })
        .catch(() => caches.match(req))
    );
  } else {
    // Cache-first for truly-static assets (icons, manifest), revalidate in the background.
    e.respondWith(
      caches.match(req).then((cached) => {
        const net = fetch(req).then((res) => {
          if (res && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
          return res;
        }).catch(() => cached);
        return cached || net;
      })
    );
  }
});
