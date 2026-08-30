/* Cubby service worker.
   Bump CACHE on every deploy so old assets are cleared. */
const CACHE = 'little-log-v348';
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
  '/app/log-guide.js',
  // The teaching registry and its ledger. Precached with the rest so `addAll` stays atomic: an
  // offline launch never gets a shell whose teaching layer is missing half of itself.
  '/app/teach-data.js',
  '/app/teach.js',
  '/app/teach-ui.js',
  '/app/vax-card.js',
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
  /* The ONE illustration in the precache, and the only one that earns it: it is the artwork for the
     connectivity states, so the moment it is needed is the moment the network is gone. Everything
     below this handler falls back to `cached || undefined` for a non-HTML miss, which means an image
     that was never fetched while online does not render at all — a missing picture on the screen whose
     whole job is to explain a missing network. The other twelve spot illustrations stay out: they
     belong to screens a parent reaches with a connection, and 250KB on every offline launch to
     decorate an empty Rituals tab is not a trade worth making. 22KB. */
  '/app/spot-art/offline_balloon.webp',
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
      /* Only OUR OWN old versions, by prefix. This was `k !== CACHE`, which deleted every cache on the
         origin — fine while the app was the only thing here, and wrong the moment it was not. Cache
         storage is per-ORIGIN, not per-worker: little-cubby.com now also has a root-scoped worker
         holding the site's offline page in `cubby-site-v1`, and a blanket sweep wiped it on this
         worker's very first activation. Since a precache is only filled during `install`, and install
         only runs when that worker's own bytes change, the deletion did not heal: the offline page was
         built, shipped, and then quietly evicted during onboarding for anybody who opened the app.
         The invariant now is that each worker on this origin owns a name prefix and deletes only its
         own. If the app's cache is ever renamed away from `little-log-`, migrate the old names here. */
      .then((keys) => Promise.all(keys.filter((k) => k.indexOf('little-log-') === 0 && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* ---- Push -------------------------------------------------------------------------------------
   This file is the ONLY service worker registered at /app/, and that is the whole point.
   A ServiceWorkerRegistration is keyed by SCOPE, so registering a second script at the same scope
   REPLACES the first. app/firebase-messaging-sw.js used to be registered here too, from enablePush,
   while this file was registered on every page load. Whichever ran last won, and since a page load
   happens far more often than enabling reminders, this file won almost always. It had no push
   listener at all, so the FCM background handler was evicted and a web push could never be shown.
   Nobody noticed because REMINDERS_LIVE was false and no token had ever been minted.

   Handled raw rather than through the Firebase SDK: importScripts of firebase-app + firebase-messaging
   into the precache SW would make install slower and couple offline support to two vendor files. An
   FCM message addressed to a web push token arrives here as an ordinary Web Push event, so reading it
   directly is both lighter and one less thing that can fail at install time. Token minting still goes
   through the SDK in the page; it only needs A registration to subscribe with, not this one's code. */
self.addEventListener('push', (e) => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; }
  catch (err) { try { p = { notification: { body: e.data && e.data.text() } }; } catch (e2) { p = {}; } }
  const n = p.notification || {};
  const d = p.data || {};
  // Chrome shows its own "this site was updated in the background" if a push event resolves without
  // showing anything, so always show something, even for a malformed payload.
  /* "Log it" straight from the notification, so a dose can be recorded without opening anything.
     Only offered when the push carried a ticket, i.e. only on a real per-medicine reminder: the
     morning digest names several medicines and has nothing single to log.
     `actions` is Chromium-only. WebKit does not implement it at any version, so an iPhone reading
     this over Web Push simply shows the notification with no button, unchanged. The button reaches
     iOS through the native wrapper's UNNotificationCategory instead, which is a different client of
     the same endpoint. Passing an unsupported key is harmless, so there is nothing to feature-detect. */
  const opts = {
    body: n.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: d.tag || n.tag || 'cubby',   // same tag replaces rather than stacks: a retry cannot pile up
    data: d
  };
  if (d.nonce) opts.actions = [{ action: 'dose', title: 'Log it' }];
  e.waitUntil(self.registration.showNotification(n.title || 'Cubby', opts));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const d = e.notification.data || {};
  /* The action branch deliberately does NOT open a window. The whole point is that a parent holding
     a baby can record the dose from the lock screen and put the phone down. The ticket is opaque to
     us: everything written is decided by the signature the Worker made, so there is nothing here to
     get wrong. Idempotent server-side on dose-<medId>-<dueTs>, so a double tap is one dose. */
  if (e.action === 'dose' && d.nonce) {
    e.waitUntil(
      fetch('/api/dose', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ n: d.nonce }) })
        .then((r) => self.registration.showNotification(r.ok ? 'Dose logged' : 'Could not log that dose', {
          body: r.ok ? ((d.medName ? d.medName + ' ' : '') + 'is on the record.')
                     : 'Open Cubby and log it there, so nothing is missed.',
          icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
          tag: (d.tag || 'cubby') + '-done'
        }))
        .catch(() => self.registration.showNotification('Could not log that dose', {
          body: 'You look offline. Open Cubby and log it there.',
          icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: (d.tag || 'cubby') + '-done'
        }))
    );
    return;
  }
  // A campaign carries its own destination; a dose reminder just opens the app.
  const target = typeof d.url === 'string' && d.url.indexOf('/app') >= 0 ? d.url : '/app/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cl) => {
      for (const c of cl) { if (c.url.indexOf('/app') >= 0 && 'focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
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
