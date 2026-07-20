/* Cubby service worker.
   Bump CACHE on every deploy so old assets are cleared. */
const CACHE = 'little-log-v213';
const ASSETS = [
  '/app/',
  '/app/index.html',
  '/app/firebase-init.js',
  '/app/store-firebase.js',
  // The boot chain's hardest dependency. Precached with everything else so `addAll` is atomic: an
  // offline launch either has the whole build or none of it, never a shell whose SDK is missing.
  '/app/vendor/firebase/10.12.2/firebase-app-compat.js',
  '/app/vendor/firebase/10.12.2/firebase-auth-compat.js',
  '/app/vendor/firebase/10.12.2/firebase-firestore-compat.js',
  '/app/vendor/firebase/10.12.2/firebase-messaging-compat.js',
  '/app/voice-log.js',
  '/app/cubby-extras.js',
  '/app/growth-data.js',
  '/app/pregnancy-data.js',
  '/app/reads-data.js',
  '/app/native-bridge.js',
  '/app/milestone-data.js',
  '/app/journey-catalogue.js',
  '/app/firebase-messaging-sw.js',
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

  const isHTML = req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') !== -1;

  // Cache-first (stale-while-revalidate) for the whole same-origin app shell. An installed PWA
  // opens INSTANTLY from cache — no network wait on launch (the old network-first re-downloaded
  // ~700KB of HTML+JS every open). The cache refreshes in the background. Freshness is driven by
  // the CACHE version bump on each deploy: a changed sw.js installs a new SW, `addAll` re-caches
  // every asset together, and activate claims clients — so a new build lands on the next launch
  // and HTML+JS never drift within a version. (Trade-off: a returning user may see the previous
  // build for one launch after a deploy, then it updates — standard PWA behaviour.)
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached || (isHTML ? caches.match('/app/index.html') : undefined));
      return cached || net;
    })
  );
});
