/* Root service worker: the app moved to /app/ (its own SW lives at /app/sw.js).
   This stub exists only to retire the OLD root-scoped service worker that earlier
   testers still have registered at "/". It unregisters itself and reloads clients,
   so stale root caches are cleared and "/" serves the new marketing site fresh. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => clients.forEach((c) => { try { c.navigate(c.url); } catch (e) {} }))
  );
});
