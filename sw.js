/* Root service worker for the marketing site and the 660-odd articles.
   ==================================================================================================
   It does ONE job: when a page on this site cannot be reached, show our offline page instead of the
   browser's error page. That moment is more common than it sounds. A parent taps a "good read" from
   inside Cubby, the link opens /articles/<slug>/, the train goes into a tunnel, and she gets a
   dinosaur — the one screen in the whole journey that looks like nothing to do with us.

   The app at /app/ has its own service worker (app/sw.js) and is NOT this worker's business. There
   used to be a root-scoped worker here; when the app moved from / to /app/ it was replaced by a stub
   whose only job was to unregister the old one and clear its caches. This file takes that slot back,
   deliberately smaller than what was retired.

   FOUR RULES, and each one is a way this could go wrong at the scale of a whole site.

   1. NAVIGATIONS ONLY. It never touches CSS, JS, images, fonts or API calls. A root-scoped worker
      that cached subresources across 660 pages could serve a stale stylesheet for as long as its
      cache lived, and there is no way to reach a browser that has already decided it has the file.
      Handling only navigations means the worst thing a bug here can do is show the offline page when
      it should not have.

   2. NO CONTENT IS CACHED. Not one article. Exactly one file is precached, the offline page, and it
      carries its own picture inline. So there is no cache to grow, nothing to go stale, and no question about
      which of 660 pages is the old version. (Caching visited articles for offline reading would be a
      genuinely nice feature and a much bigger one: cache size, eviction, and how a parent knows
      whether she is reading today's copy. Not this.)

   3. /app/ AND /g/ ARE PASSED STRAIGHT THROUGH. Scope matching gives /app/* to app/sw.js because its
      scope is longer, but there is one window where that is not yet true: a visitor who picked this
      worker up on a marketing page and then navigates to /app/ for the first time, before the app has
      ever registered its own. In that window this worker controls the navigation. It must do nothing
      with it. /g/ is a guest game whose whole point is live data.

   4. ACTIVATE DELETES ONLY ITS OWN CACHES, BY PREFIX. Caches are per-ORIGIN, not per-worker: the stub
      this replaces did `caches.keys()` then deleted every one of them, which from here would wipe the
      app's whole precache (little-log-v*) and leave an installed PWA unable to launch offline. Never
      iterate all caches from here. Only ours.
   ================================================================================================== */
/* BUMP THIS WHEN offline.html CHANGES. Nothing else reaches an existing install: the precache is
   filled on install, and install only runs when THIS file's bytes change, so editing offline.html
   alone leaves every browser that already has it holding the old copy indefinitely. Same discipline as
   app/sw.js, for the same reason, and here it is easy to forget because the page lives in another file. */
const CACHE = 'cubby-site-v1';
const PREFIX = 'cubby-site-';
const OFFLINE = '/offline.html';
/* Exactly one file, and that is the point. The offline page carries its own picture inline as a data
   URI, because rule 1 means this worker answers navigations and nothing else: a linked image would be
   requested over the dead connection and arrive broken however carefully it had been precached. One
   entry also means there is no second thing that can go stale or go missing. */
const ASSETS = [OFFLINE];

self.addEventListener('install', (e) => {
  // Per-entry catch rather than addAll: with one entry it is the same thing today, but it means adding
  // a second asset later can never take the offline page down with it on install.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(ASSETS.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => { }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      // Ours only. See rule 4: the app's caches live on this same origin.
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* A repair path, because the precache is filled during `install` and install only runs when this
   file's bytes change. Without this, a swallowed install failure, a storage eviction under pressure, or
   another worker on this origin deleting the cache all left the offline page gone for good, and the
   only symptom would be visitors quietly getting the bare fallback below instead of the real page.
   Runs at most once per worker startup: a hit costs one cache lookup, a miss re-fetches while there is
   still a connection to re-fetch it with. */
let _checked = false;
function ensureOffline() {
  if (_checked) return;
  _checked = true;
  caches.open(CACHE)
    .then((c) => c.match(OFFLINE).then((hit) => (hit ? null : c.add(new Request(OFFLINE, { cache: 'reload' })))))
    .catch(() => { });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // Rule 1: only page navigations. Everything else is none of our business.
  if (req.mode !== 'navigate') return;
  ensureOffline();

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Rule 3.
  if (url.pathname === '/app' || url.pathname.startsWith('/app/')) return;
  if (url.pathname === '/g' || url.pathname.startsWith('/g/')) return;

  /* Network first, always: this site is content, and a reader must never be handed yesterday's page
     to save a round trip. The cache is consulted only after the network has actually failed, and the
     only thing in it is the offline page. A response the server gave us — including a 404 or a 500 —
     is a real answer and is passed through untouched; only a failure to reach the server at all is
     ours to answer. */
  e.respondWith(
    fetch(req).catch(() =>
      caches.match(OFFLINE).then((hit) => hit || new Response(
        '<!doctype html><meta charset=utf-8><title>You look offline</title>'
        + '<body style="font-family:system-ui;text-align:center;padding:22vh 24px;color:#2C2521;background:#FBF3E9">'
        + '<h1 style="font-size:21px">You look offline</h1>'
        + '<p style="color:#6B5D50">This page needs a connection. Nothing you have logged in Cubby is affected.</p>',
        { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
      ))
    )
  );
});
