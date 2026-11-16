#!/usr/bin/env node
/* usage-tracker: Cubby's own usage events, measured in the seeded app the way a parent uses it.
 *
 *   node tools/usage_tracker_check.js <base-url>               the checks, against the tree that url serves
 *   node tools/usage_tracker_check.js <base-url> --self-test   and then against mutants of app/cubby-track.js
 *
 * Spec: docs/superpowers/specs/2026-11-13-admin-dashboard-design.md §8.1 and S24, gate row `usage-tracker`.
 * The tracker (app/cubby-track.js) is the only code that decides what leaves a phone, so this drives the
 * REAL tracker inside the REAL app (?e2e=1, localhost only) and reads what it would have sent from its test
 * sink, window.__cubbyTrackTest, installed before boot with evaluateOnNewDocument. Nothing here talks to
 * any host but this one: every other request is aborted, and the app's Firebase sign-in is replaced, for the
 * tracker only, by a fake signed-in person whose tokens are labelled with whose they are. S20 and S21 also
 * start a Firestore emulator on this machine (see startEmulator) and run the app's real sync layer on it.
 *
 * What it proves (each section's checks name it):
 *   S1  visit.started on load; the mode is learned with an EMPTY batch before any event leaves; screen.viewed
 *       on a tab change and NOT on a repaint of the same tab.
 *   S2  logging a 137 ml bottle and a feed with the note ZZ-NOTE-7731 records feature.used {feed, logged},
 *       an edit {edited} (none when nothing changed), a delete {deleted}, and no captured body or queued
 *       event carries 137 or ZZ-NOTE. Companion: the same matcher finds both when they are planted.
 *   S3  nothing at all flows while her own loss holding is staged; companion: the same page flows the
 *       moment the holding is gone, so "nothing" was not a sink that cannot see.
 *   S4  mode on: linked events wait until the CURRENT notice is seen, staged both ways (unseen and stale
 *       hold, then seen sends; and seen before boot sends at once). While it is unseen, nothing sent carries
 *       her token, not even the daily mode ask (G4).
 *   S5  user A's queued event never leaves under user B; a token fetched for A that lands after B signed in
 *       is never used for B; B's events never carry A's visit; an "off" answer to A's ask that lands after B
 *       signed in drops A's events, not B's. Companion: A's event is found under A's token by the same matcher.
 *   S6  the pagehide batch goes out final, at once, with the cached token while getIdToken() cannot answer.
 *   S7  the queue never passes 500, oldest dropped first.
 *   S8  account deletion: nothing more flows, and a deletion refused at the door (nobody signed in to the
 *       app's sign-in layer) never silences the tracker (AR-1). S9  mode off: only one empty ask a day. S10 off
 *       the production host with no sink, no request reaches /api/usage. S11 a notification tap (URL marker, page message)
 *       and a link open. S12 the install prompts and the web permission asks. S13 the native shell's hooks
 *       (a stand-in Capacitor). S14 the timer Stops, the doctor report, voice logging and the invite sheet.
 *   S15 the service worker's notification tap (app/sw.js, run in a node sandbox): the marker by kind in the
 *       URL's fragment, so the page still opens from the cache at once, or a message to a Cubby already open,
 *       and never the notification's own words or ids. S12 and S13 also prove a permission already decided
 *       is not counted as an ask, and S13 that a link bringing the app forward names the visit.
 *   S16 a visit idle for 30 minutes ends at the last touch, a return after hours away is not idle, and
 *       nothing is sent before the app has painted once.
 *   S17 before sign-in: events wait 24 hours for a sign-in to claim them (an anonymous "off" does not throw
 *       them away), then only what the server takes before sign-in goes, with no token, in mode on only;
 *       the rest leaves the queue.
 *   S18 a batch refused for its shape (400) leaves the queue; a server error (503) keeps it.
 *   S19 PRIV-4, the tracker's half, staged: for a signed-in person nothing leaves (not even the mode ask) until the
 *       sign-in layer says her family record has been seen as the server holds it (window.__cubbyHouseholdSeen); a
 *       record seen for someone else does not count; when that copy brings her holding, what waited is dropped.
 *       Companion: with no holding in it, what waited goes. The local-only page says '*' itself.
 *   S20 PRIV-4 through the REAL sign-in layer on a Firestore emulator (?fsemu=): her phone opens on yesterday's
 *       copy while Papa's phone has seeded her holding overnight; nothing is sent before the server's copy lands,
 *       nor after it, including through the copy Firestore shows first, marked as from the server while her own
 *       offline write is still pending and without the holding. Companion: a server copy with nothing new in it
 *       releases the queue (seen only through its metadata).
 *   S21 AR-1 through the real deleteAccount on the emulator: refused at the leave (before her usage rows were
 *       asked to go) the tracker carries on; stopped at the login (after them) nothing more is sent or kept until
 *       she signs out, and signed in again on the same page she is tracked again.
 *
 * Self-test: each mutant is a copy of app/cubby-track.js with one rule broken, served from a temp copy of the
 * tree (symlinks, its own tools/serve.js), and must be caught by the check named for it: no dedupe, amount
 * leaks into props, loss holding ignored, notice hold ignored, cross-user leak, cap removed, token race,
 * pagehide without a token, events before the mode is known, deletion ignored, the token on the ask before
 * the notice, the visit kept across a switch, an off answer dropping the wrong person, no paint wait, both
 * halves of the idle rule, the anonymous rules (allowlist, mode on only, dropping, an anonymous off) and a
 * 400 retried forever, the family-record wait ignored or met by anyone's record. More remove or loosen the app's
 * hooks instead (index.html entry hooks, the render hook, the web ask, native-bridge.js, its ask and its link hook),
 * the service worker's marker, and store-firebase.js's half: the family record reported from the cache, while its
 * own write is pending, never through metadata, or not at all for a local-only page, and
 * the deletion flag raised at the door, kept after an early failure, cleared after a late one, or kept after
 * sign-out. An unmutated temp copy must pass first, so a caught mutant is the mutation and not the harness.
 * Each temp copy is removed once it has been graded (the symlinks in it, never what they point at).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const vm = require('vm');
const { spawn } = require('child_process');
const puppeteer = require(path.join(__dirname, 'node_modules', 'puppeteer-core'));
const dl = require('./gate_downloads');

const ROOT = path.join(__dirname, '..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ARGS = process.argv.slice(2);
const BASE = (ARGS.find((a) => /^https?:\/\//.test(a)) || 'http://127.0.0.1:8123').replace(/\/$/, '');
const SELF = ARGS.includes('--self-test');
const ONLY = (ARGS.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);   // --only=S2,S5 while working
const PICK = (ARGS.find((a) => a.startsWith('--mutants=')) || '').slice(10).split(',').filter(Boolean); // --mutants=a,b while working: a partial self-test, never a pass
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* The clock is pinned to a day AND an hour (14 Nov 2026, 10:30 local): the mode is cached per day. */
const CLOCK = new Date(2026, 10, 14, 10, 30, 0, 0).getTime();
const DAY = 86400000;
const NOTICE = '2026-11-a';

/* ---------------- the matcher: does anything a family typed appear? ---------------- */
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AMOUNT = /(^|[^0-9A-Za-z])137(?![0-9])/;    // 137 as a token: "137", 137, "137 ml", "137ml"
const NOTE = /ZZ-NOTE/;
/* Random ids, the device id, timestamps and a measured visit length are fixed formats or clock readings,
   and a 3-digit run inside one is chance, not content. They are masked before the scan; everything else
   in the envelope and in every event's props is scanned as sent. */
function masked(x) {
  const c = JSON.parse(JSON.stringify(x));
  const evs = Array.isArray(c) ? c.map((q) => (q && q.ev) || q) : (c.events || []);
  if (!Array.isArray(c) && /^d_[a-z0-9]{12}$/.test(c.device || '')) c.device = '<device>';
  if (Array.isArray(c)) c.forEach((q) => { if (q && typeof q.at === 'number') q.at = '<at>'; });
  for (const e of evs) {
    if (!e || typeof e !== 'object') continue;
    if (UUID4.test(e.id || '')) e.id = '<id>';
    if (/^v_[a-z0-9]{8}$/.test(e.visit || '')) e.visit = '<visit>';
    if (typeof e.t === 'number') e.t = '<t>';
    if (e.name === 'visit.ended' && e.props && Number.isInteger(e.props.seconds)) e.props.seconds = '<seconds>';
  }
  return JSON.stringify(c);
}
const leaks = (x) => { const s = masked(x); return { amount: AMOUNT.test(s), note: NOTE.test(s) }; };

/* ---------------- one result collector per run ---------------- */
function collector(quiet) {
  const R = { pass: 0, fail: 0, failed: [] };
  R.ok = (id, name, cond, got) => {
    if (cond) { R.pass++; if (!quiet) console.log('  ok   ' + id + ' ' + name); }
    else {
      R.fail++; R.failed.push(id);
      if (!quiet) console.log('  FAIL ' + id + ' ' + name + (got !== undefined ? '\n         got: ' + JSON.stringify(got).slice(0, 600) : ''));
    }
  };
  return R;
}

/* ---------------- the page ---------------- */
const seedBaby = () => ({
  babies: [{ id: 'b1', name: 'Robin', birth: CLOCK - 60 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
  activeBabyId: 'b1', events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
});
const seedLoss = () => Object.assign(seedBaby(), { babies: [], activeBabyId: null, lossHolding: { local: { at: CLOCK - 2 * DAY } } });

/* Runs in the page before any of its scripts, on every navigation of the context. */
function boot(cfg) {
  const R = Date;
  const C = window.__utClk = { shift: cfg.clock - R.now() };     // a test moves the clock with __utClk.shift
  function D(...a) { return a.length === 0 ? new R(R.now() + C.shift) : new R(...a); }
  D.prototype = R.prototype; D.now = () => R.now() + C.shift; D.parse = R.parse; D.UTC = R.UTC;
  window.Date = D;
  if (cfg.captureIdle) {
    // The tracker's 30-minute idle check runs every 60 s; kept here so a test can run it after moving the clock.
    const si = window.setInterval; window.__utIdle = [];
    window.setInterval = function (f, ms, ...a) { if (ms === 60000 && typeof f === 'function' && /IDLE_MS/.test(String(f))) window.__utIdle.push(f); return si.call(window, f, ms, ...a); };
  }
  if (cfg.sink) window.__cubbyTrackTest = [];
  if (cfg.mode) window.__cubbyTrackMode = cfg.mode;
  if (cfg.notice) window.CUBBY_PRIVACY_NOTICE = cfg.notice;
  if (cfg.noticeSeen) window.cubbyNoticeSeen = cfg.noticeSeen;
  /* Whose family record has been seen as the server holds it (store-firebase.js reports it; PRIV-4). A page
     with no app says so itself (cfg.householdSeen). cfg.household stages it instead: the tracker reads what the
     test says (H.value), and what the app itself reported is kept in H.reports. */
  if (cfg.householdSeen !== undefined) window.__cubbyHouseholdSeen = cfg.householdSeen;
  if (cfg.household) {
    const H = window.__utHousehold = { value: cfg.household.value || '', reports: [] };
    Object.defineProperty(window, '__cubbyHouseholdSeen', { configurable: true, get: () => H.value, set: (v) => { H.reports.push(v); } });
  }
  try {
    if (!localStorage.getItem('__ut_seeded')) {
      localStorage.setItem('little-log-v1', JSON.stringify(cfg.seed));
      localStorage.setItem('cubby-quick-uid', 'local');
      localStorage.setItem('__ut_seeded', '1');
    }
  } catch (e) {}
  /* The person signed in, for the tracker. Tokens say whose they are (tok-<uid>-<n>), can be slowed per
     person, or made to never answer. The app's own sign-in layer (store-firebase.js) keeps the real auth
     it captures while it loads (unless cfg.appAuth, for the one sheet that needs a signed-in app); every
     later reader of window.LL.auth, the tracker included, gets this. */
  const U = window.__utAuth = { delay: {}, hang: false, delivered: [], n: 0 };
  const mk = (uid) => ({
    uid, providerData: [],
    /* An email-code sign-in older than five minutes: Firebase refuses to delete the login (AR-1's case). */
    delete() { return cfg.staleLogin ? Promise.reject(Object.assign(new Error('requires recent login'), { code: 'auth/requires-recent-login' })) : Promise.resolve(); },
    getIdToken() {
      const t = 'tok-' + uid + '-' + (++U.n);
      if (U.hang) return new Promise(() => {});
      const d = U.delay[uid] || 0;
      const give = () => { U.delivered.push(t); return t; };
      return d ? new Promise((r) => setTimeout(() => r(give()), d)) : Promise.resolve(give());
    },
  });
  let cur = cfg.user ? mk(cfg.user) : null;
  const authCbs = [], tokCbs = [];
  const fake = {
    get currentUser() { return cur; },
    onAuthStateChanged(cb) { authCbs.push(cb); setTimeout(() => cb(cur), 0); return () => {}; },
    onIdTokenChanged(cb) { tokCbs.push(cb); setTimeout(() => cb(cur), 0); return () => {}; },
    isSignInWithEmailLink: () => false, getRedirectResult: () => Promise.resolve({}), setPersistence: () => Promise.resolve(), signOut: () => Promise.resolve(),
  };
  U.switchTo = (uid) => { cur = uid ? mk(uid) : null; authCbs.forEach((f) => f(cur)); tokCbs.forEach((f) => f(cur)); };
  /* Scripted server answers (the sink calls window.__cubbyTrackMode(token, body)): a mode for asks with and
     without a token, a { status } for batches that carry events, or the race in S5, where A's ask is answered
     "off" only after B has signed in and logged something. */
  if (cfg.answer) {
    const W = window.__utAnswer = Object.assign({ linked: cfg.mode || 'internal', anon: cfg.mode || 'internal', events: null, race: false }, cfg.answer);
    window.__cubbyTrackMode = function (tok, body) {
      if (W.race && tok && /^tok-local-/.test(tok)) {
        W.race = false;
        U.switchTo('zz-user-b');
        window.cubbyTrack('feature.used', { feature: 'pro', action: 'opened' });
        try { const q = JSON.parse(localStorage.getItem('cubby-usage-q') || '[]'); W.raceB = q[q.length - 1].ev.id; } catch (e) {}
        return 'off';
      }
      if (W.events && body && body.events && body.events.length) return W.events;
      return tok ? W.linked : W.anon;
    };
  }
  let real, realDb;
  const LL = {};
  Object.defineProperty(LL, 'auth', {
    configurable: true, enumerable: true,
    get() { const s = document.currentScript; return (!cfg.appAuth && s && /store-firebase\.js/.test(s.src || '')) ? real : fake; },
    set(v) { real = v; },
  });
  /* cfg.netOff: Firestore is cut off from its server the moment firebase-init.js hands the database over, before
     the sign-in layer reads anything, so the app boots from this phone's own copy (a test reconnects it with
     LL.db.enableNetwork()). It is how a slow connection looks to the app, made exact. */
  Object.defineProperty(LL, 'db', {
    configurable: true, enumerable: true,
    get() { return realDb; },
    set(v) { realDb = v; if (cfg.netOff && v && typeof v.disableNetwork === 'function') { try { v.disableNetwork(); } catch (e) {} } },
  });
  window.LL = LL;
  if (cfg.native) {
    const L = window.__utCap = {};
    const add = (plugin) => (ev, cb) => { (L[plugin + ':' + ev] = L[plugin + ':' + ev] || []).push(cb); return Promise.resolve({ remove() {} }); };
    window.Capacitor = {
      isNativePlatform: () => true, getPlatform: () => 'ios',
      Plugins: {
        App: { addListener: add('App'), getInfo: () => Promise.resolve({ version: '1.4.0' }), getLaunchUrl: () => Promise.resolve({}) },
        FirebaseMessaging: { addListener: add('Msg'), checkPermissions: () => Promise.resolve({ receive: 'prompt' }),
          requestPermissions: () => Promise.resolve({ receive: 'granted' }), getToken: () => Promise.resolve({ token: '' }),
          deleteToken: () => Promise.resolve() },
      },
    };
  }
}

/* cfg.search replaces ?e2e=1 (the cloud path, ?fsemu=, in S20 and S21); ctxIn opens the page in a context
   that already exists (the same phone, opened again). ctl.refuse(url, method) answers a request as Firestore
   does when its rules refuse it, ctl.delay(url, method) holds one back that many ms, and local lists every
   request this page made to this machine. */
async function openApp(browser, base, cfg, ctxIn) {
  const ctx = ctxIn || await browser.createBrowserContext({ downloadBehavior: dl.downloadBehavior() });
  const page = await ctx.newPage();
  const errs = [], usageReqs = [], foreign = [], local = [], ctl = { refuse: null, delay: null };
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  await page.setBypassServiceWorker(true);
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const u = r.url();
    if (/^(data|blob|about):/.test(u)) return r.continue();
    let h = ''; try { h = new URL(u).hostname; } catch (e) {}
    if (h === '127.0.0.1' || h === 'localhost') {
      if (/\/api\/usage/.test(u)) usageReqs.push(u);
      local.push({ method: r.method(), url: u });
      if (ctl.refuse && r.method() !== 'OPTIONS' && ctl.refuse(u, r.method())) {
        return r.respond({ status: 403, contentType: 'application/json',
          headers: { 'access-control-allow-origin': r.headers().origin || '*', 'access-control-allow-credentials': 'true' },
          body: JSON.stringify({ error: { code: 403, message: 'Missing or insufficient permissions.', status: 'PERMISSION_DENIED' } }) });
      }
      const wait = ctl.delay ? ctl.delay(u, r.method()) : 0;
      if (wait) { setTimeout(() => { r.continue().catch(() => {}); }, wait); return; }
      return r.continue();
    }
    foreign.push(h); return r.abort();
  });
  await page.setViewport({ width: 390, height: 844 });
  const full = Object.assign({ clock: CLOCK, sink: true, mode: 'internal', user: 'local', seed: seedBaby() }, cfg);
  await page.evaluateOnNewDocument(boot, full);
  await page.goto(base + '/app/' + (cfg.search || '?e2e=1') + (cfg.query || ''), { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForFunction(() => typeof window.cubbyTrack === 'function' && ('__cubbyScreen' in window), { timeout: 20000 });
  await sleep(300);
  return { ctx, page, errs, usageReqs, foreign, local, ctl };
}
const sent = (page) => page.evaluate(() => (window.__cubbyTrackTest || []).map((s) => JSON.parse(JSON.stringify(s))));
const queue = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('cubby-usage-q') || '[]'); } catch (e) { return []; } });
async function settle(page) {
  for (let i = 0; i < 3; i++) { await page.evaluate(() => window.cubbyTrackFlush && window.cubbyTrackFlush()); await sleep(250); }
}
const eventsOf = (bodies) => bodies.reduce((a, s) => a.concat((s.body.events || []).map((e) => Object.assign({ _token: s.token, _final: s.final }, e))), []);
async function allEvents(page) {
  const seen = {}, out = [];
  for (const e of eventsOf(await sent(page)).concat((await queue(page)).map((q) => q.ev))) { if (!seen[e.id]) { seen[e.id] = 1; out.push(e); } }
  return out;
}
const named = (evs, name, props) => evs.filter((e) => e.name === name && Object.keys(props || {}).every((k) => e.props && e.props[k] === props[k]));
const lastQueuedId = (page) => page.evaluate(() => { const q = JSON.parse(localStorage.getItem('cubby-usage-q') || '[]'); return q.length ? q[q.length - 1].ev.id : null; });

/* ---------------- the sections ---------------- */
const SECTIONS = {};

SECTIONS.S1 = async (b, base, R) => {
  console.log('\nS1. a visit, a tab change, and a repaint that is not a view');
  const { ctx, page } = await openApp(b, base, {});
  try {
    await settle(page);
    const first = await sent(page);
    const evs = eventsOf(first);
    R.ok('S1.load', 'visit.started {icon, cold} on load, under the signed-in person\'s token',
      named(evs, 'visit.started', { opened_from: 'icon', start: 'cold' }).some((e) => /^tok-local-/.test(e._token || '')), first.map((s) => ({ t: s.token, n: s.body.events.map((e) => e.name) })));
    R.ok('S1.probe', 'the first thing sent is an EMPTY batch: the mode is asked before any event leaves',
      first.length > 0 && first[0].body.events.length === 0, first.map((s) => s.body.events.length));
    R.ok('S1.home', 'the first screen (home) is a view, even though the app paints before the tracker loads',
      named(evs, 'screen.viewed', { screen: 'home' }).length === 1, evs.map((e) => e.name + ':' + JSON.stringify(e.props)));
    await page.evaluate(() => { go('log'); });
    await page.evaluate(() => { render(); render(); go('log'); render(); });
    await page.evaluate(() => { go('album'); });
    await settle(page);
    const all = await allEvents(page);
    const tl = named(all, 'screen.viewed', { screen: 'timeline' }).length, ph = named(all, 'screen.viewed', { screen: 'photos' }).length;
    R.ok('S1.tab', 'a tab change is a view (Log is timeline, Album is photos)', tl >= 1 && ph === 1, { timeline: tl, photos: ph });
    R.ok('S1.repaint', 'a repaint of the same tab, and going to the tab already open, is not a view', tl === 1, { timeline: tl });
  } finally { await ctx.close(); }
};

SECTIONS.S2 = async (b, base, R) => {
  console.log('\nS2. logging a feed records the tool, never the entry');
  const { ctx, page } = await openApp(b, base, {});
  try {
    await settle(page);
    const id = await page.evaluate(() => {
      openFeed(); feedDraft.method = 'bottle'; feedDraft.amount = 137; feedDraft.unit = 'ml'; saveBottle();
      return state.events[state.events.length - 1].id;
    });
    await sleep(1000);   // past the 900 ms double-tap guard
    await page.evaluate(() => commitEvent({ type: 'feed', method: 'bottle', amount: 137, unit: 'ml', notes: 'ZZ-NOTE-7731', time: now() }));
    await page.evaluate((i) => { openEdit(i); document.getElementById('eAmt').value = '140'; saveEdit(i); }, id);
    await page.evaluate((i) => { openEdit(i); saveEdit(i); }, id);
    await page.evaluate((i) => { deleteEvent(i); confirmDeleteEvent(i); }, id);
    await settle(page);
    const stored = await page.evaluate(() => JSON.stringify(state.events));
    R.ok('S2.staged', 'the record really holds the typed 137 and ZZ-NOTE-7731 (so their absence below means something)',
      AMOUNT.test(stored) && NOTE.test(stored), stored.slice(0, 300));
    const all = await allEvents(page);
    const fu = (a) => named(all, 'feature.used', { feature: 'feed', action: a }).length;
    R.ok('S2.logged', 'feature.used {feed, logged} for the 137 ml bottle and for the noted feed', fu('logged') === 2, all.filter((e) => e.name === 'feature.used').map((e) => e.props));
    R.ok('S2.edited', 'feature.used {feed, edited} once: a save with nothing changed is not an edit', fu('edited') === 1, { edited: fu('edited') });
    R.ok('S2.deleted', 'feature.used {feed, deleted}', fu('deleted') === 1, { deleted: fu('deleted') });
    const bodies = await sent(page), q = await queue(page);
    const hit = bodies.map((s) => leaks(s.body)).concat([leaks(q)]);
    R.ok('S2.no-amount', 'no captured body and no queued event carries 137', hit.every((h) => !h.amount), bodies.filter((s) => leaks(s.body).amount).map((s) => s.body));
    R.ok('S2.no-note', 'no captured body and no queued event carries ZZ-NOTE', hit.every((h) => !h.note), bodies.filter((s) => leaks(s.body).note).map((s) => s.body));
    const L = await page.evaluate(() => window.CUBBY_USAGE_ALLOWLIST);
    const bad = eventsOf(bodies).filter((e) => { const sp = L.events[e.name]; return !sp || JSON.stringify(Object.keys(e.props).sort()) !== JSON.stringify(Object.keys(sp.props).sort()); });
    R.ok('S2.shape', 'every event sent carries exactly its allowlisted properties', bad.length === 0, bad);
    // Companion: the same matcher, on a real captured body with the content planted, must say so.
    const real = bodies.find((s) => s.body.events.length) || { body: { v: 1, events: [] } };
    const planted = JSON.parse(JSON.stringify(real.body));
    planted.events.push({ id: '6f1c0b8e-137a-4000-8000-000000000137', t: 1763000137000, visit: 'v_137aaaaa', name: 'feature.used', props: { feature: 'feed', action: 'logged', amount: 137, note: 'ZZ-NOTE-7731' } });
    const p = leaks(planted);
    R.ok('S2.matcher', 'companion: the same matcher finds 137 and ZZ-NOTE when they are planted in a real body', p.amount && p.note, p);
    const asText = JSON.parse(JSON.stringify(real.body)); asText.events.push({ name: 'feature.used', props: { feature: '137ml', action: 'logged' } });
    R.ok('S2.matcher-text', 'companion: and finds "137ml" written as text', leaks(asText).amount);
    const formatsOnly = JSON.parse(JSON.stringify(real.body)); formatsOnly.events.push({ id: '6f1c0b8e-137a-4000-8000-000000000137', t: 1763000137000, visit: 'v_137aaaaa', name: 'visit.ended', props: { seconds: 137, reason: 'hidden' } });
    R.ok('S2.matcher-formats', 'companion: and does not fire on a 137 inside an id, a timestamp or a measured visit length', !leaks(formatsOnly).amount);
  } finally { await ctx.close(); }
};

const setVis = (page, v) => page.evaluate((x) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => x });
  document.dispatchEvent(new Event('visibilitychange'));
}, v);

SECTIONS.S3 = async (b, base, R) => {
  console.log('\nS3. her own loss holding: nothing at all flows');
  const { ctx, page } = await openApp(b, base, { seed: seedLoss() });
  try {
    const pre = await page.evaluate(() => ({ held: !!myLossHolding(), screen: window.__cubbyScreen, text: (document.getElementById('app') || document.body).innerText.slice(0, 200) }));
    R.ok('S3.staged', 'the holding screen is what is on screen (staged before boot)', pre.held && pre.screen === null && /Take all the time you need/.test(pre.text), pre);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('pointerdown'));
      render(); window.cubbyTrackScreen('home');
      window.cubbyTrack('feature.used', { feature: 'feed', action: 'opened' });
      window.cubbyTrackEntry('feed', 'logged');
    });
    await setVis(page, 'hidden'); await setVis(page, 'visible');
    await settle(page);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await sleep(200);
    const s = await sent(page), q = await queue(page);
    R.ok('S3.silent', 'nothing was sent: no batch, not even the mode ask', s.length === 0, s.map((x) => x.body.events.map((e) => e.name)));
    R.ok('S3.nothing-kept', 'and nothing is kept to leave later', q.length === 0, q.map((x) => x.ev.name));
    // Companion: the same page, once her holding has ended, flows; the sink was able to see all along.
    await page.evaluate(() => { state.lossHolding = {}; window.cubbyTrack('feature.used', { feature: 'feed', action: 'opened' }); });
    await settle(page);
    const after = await sent(page);
    R.ok('S3.companion', 'companion: with the holding ended, the same matcher sees events flow', eventsOf(after).length > 0, after.length);
  } finally { await ctx.close(); }
};

SECTIONS.S4 = async (b, base, R) => {
  console.log('\nS4. mode on: linked events wait until the current notice is seen');
  let o = await openApp(b, base, { mode: 'on', notice: NOTICE });
  try {
    await settle(o.page);
    let s = await sent(o.page);
    R.ok('S4.unseen-holds', 'notice not seen: only empty asks leave, every event waits', s.length > 0 && eventsOf(s).length === 0, s.map((x) => x.body.events.map((e) => e.name)));
    R.ok('S4.unseen-queued', 'and they are waiting in the queue, not lost', (await queue(o.page)).length > 0);
    R.ok('S4.unseen-no-token', 'and nothing sent carries her token, not even the daily ask: nothing on the server is linked to her yet',
      s.length > 0 && s.every((x) => !x.token), s.map((x) => ({ token: x.token, events: x.body.events.length })));
    await o.page.evaluate(() => { window.cubbyNoticeSeen = '2026-10-old'; });
    await settle(o.page);
    s = await sent(o.page);
    R.ok('S4.stale-holds', 'an older notice seen is not the current one: still nothing', eventsOf(s).length === 0, eventsOf(s).map((e) => e.name));
    R.ok('S4.stale-no-token', 'and still no token', s.every((x) => !x.token), s.map((x) => x.token));
    await o.page.evaluate((n) => { window.cubbyNoticeSeen = n; }, NOTICE);
    await settle(o.page);
    s = await sent(o.page);
    R.ok('S4.seen-sends', 'the current notice seen: the held events go, under her token', named(eventsOf(s), 'visit.started', {}).some((e) => /^tok-local-/.test(e._token || '')), eventsOf(s).map((e) => e.name));
  } finally { await o.ctx.close(); }
  o = await openApp(b, base, { mode: 'on', notice: NOTICE, noticeSeen: NOTICE });
  try {
    await settle(o.page);
    const s = await sent(o.page);
    R.ok('S4.seen-at-boot', 'seen before this load: events go on the first send', named(eventsOf(s), 'visit.started', {}).length === 1, eventsOf(s).map((e) => e.name));
  } finally { await o.ctx.close(); }
};

SECTIONS.S5 = async (b, base, R) => {
  console.log('\nS5. one person\'s events never travel under another\'s sign-in');
  let o = await openApp(b, base, {});
  try {
    await settle(o.page);
    await o.page.evaluate(() => window.cubbyTrack('feature.used', { feature: 'games', action: 'opened' }));
    const a1 = await lastQueuedId(o.page);
    await settle(o.page);
    let ev = eventsOf(await sent(o.page));
    R.ok('S5.companion', 'companion: A\'s event is found under A\'s token by the same matcher', ev.some((e) => e.id === a1 && /^tok-local-/.test(e._token)), { a1, sent: ev.map((e) => [e.name, e._token]) });
    const aVisit = (ev.find((e) => e.id === a1) || {}).visit;
    R.ok('S5.visit-a', 'companion: A\'s own events share A\'s visit (the same matcher finds a shared visit)',
      !!aVisit && ev.some((e) => e.name === 'visit.started' && e.visit === aVisit && /^tok-local-/.test(e._token)), ev.map((e) => e.name + '@' + e.visit));
    const a2 = await o.page.evaluate(() => {
      window.cubbyTrack('feature.used', { feature: 'games', action: 'opened' });
      const q = JSON.parse(localStorage.getItem('cubby-usage-q') || '[]'); const id = q[q.length - 1].ev.id;
      window.__utAuth.switchTo('zz-user-b');          // in the same tick: nothing can send A's event first
      return id;
    });
    await o.page.evaluate(() => window.cubbyTrack('feature.used', { feature: 'pro', action: 'opened' }));
    const b1 = await lastQueuedId(o.page);
    await settle(o.page);
    ev = eventsOf(await sent(o.page));
    R.ok('S5.b-flows', 'B\'s own event goes, under B\'s token', ev.some((e) => e.id === b1 && /^tok-zz-user-b-/.test(e._token)), ev.map((e) => [e.name, e._token]));
    R.ok('S5.a-not-under-b', 'A\'s queued event never leaves under B\'s token', !ev.some((e) => e.id === a2 && /^tok-zz-user-b-/.test(e._token)), ev.filter((e) => e.id === a2));
    R.ok('S5.a-dropped', 'and it is dropped, not kept for later', !ev.some((e) => e.id === a2) && !(await queue(o.page)).some((x) => x.ev.id === a2));
    const bEvs = ev.filter((e) => /^tok-zz-user-b-/.test(e._token || ''));
    R.ok('S5.visit-b', 'B\'s events never carry A\'s visit, and B\'s visit has its own start',
      bEvs.length > 0 && bEvs.every((e) => e.visit !== aVisit) && bEvs.some((e) => e.name === 'visit.started'), bEvs.map((e) => e.name + '@' + e.visit + ' (A: ' + aVisit + ')'));
  } finally { await o.ctx.close(); }
  // An "off" answer to A's ask that lands after B has signed in and logged: it is A's answer, not B's.
  o = await openApp(b, base, { answer: { race: true } });
  try {
    await settle(o.page); await settle(o.page);
    const st = await o.page.evaluate(() => ({ raceB: window.__utAnswer.raceB || null, armed: window.__utAnswer.race }));
    const ev = eventsOf(await sent(o.page));
    R.ok('S5.off-staged', 'staged: A\'s mode ask was answered off after B had signed in and logged an event', !!st.raceB && !st.armed, st);
    R.ok('S5.off-for-a', 'that off drops A\'s events only: B\'s event is kept and goes under B\'s token',
      ev.some((e) => e.id === st.raceB && /^tok-zz-user-b-/.test(e._token)), ev.map((e) => [e.name, e._token]));
  } finally { await o.ctx.close(); }
  // The token race: A's token is still on its way when B signs in, and lands after.
  o = await openApp(b, base, {});
  try {
    await settle(o.page);
    await o.page.evaluate(() => {
      window.__utAuth.delay.local = 800;
      window.cubbyTrack('feature.used', { feature: 'games', action: 'opened' });
      window.cubbyTrackFlush();                         // sends, then asks for a fresh token for A (slow)
    });
    await sleep(60);
    const atSwitch = await o.page.evaluate(() => { const n = window.__utAuth.delivered.length; window.__utAuth.switchTo('zz-user-b'); return n; });
    await o.page.evaluate(() => window.cubbyTrack('feature.used', { feature: 'pro', action: 'opened' }));
    const b2 = await lastQueuedId(o.page);
    await sleep(1200);                                  // A's late token has landed by now
    await settle(o.page);
    const ev = eventsOf(await sent(o.page));
    const lateA = await o.page.evaluate((n) => window.__utAuth.delivered.slice(n).filter((t) => /^tok-local-/.test(t)).length, atSwitch);
    R.ok('S5.race-staged', 'staged: a token for A was delivered after B signed in, and B\'s event was sent', lateA >= 1 && ev.some((e) => e.id === b2), { lateA, b2sent: ev.some((e) => e.id === b2) });
    R.ok('S5.race', 'a token fetched for A that lands after B signed in is never used for B\'s events', ev.filter((e) => e.id === b2).every((e) => /^tok-zz-user-b-/.test(e._token)), ev.filter((e) => e.id === b2).map((e) => e._token));
  } finally { await o.ctx.close(); }
};

SECTIONS.S6 = async (b, base, R) => {
  console.log('\nS6. the pagehide batch goes final, at once, with the cached token');
  const { ctx, page } = await openApp(b, base, {});
  try {
    await settle(page);
    const r = await page.evaluate(() => {
      window.__utAuth.hang = true;                        // getIdToken() can no longer answer
      const before = window.__cubbyTrackTest.length;
      window.cubbyTrack('feature.used', { feature: 'timeline', action: 'opened' });
      window.dispatchEvent(new Event('pagehide'));
      const fresh = window.__cubbyTrackTest.slice(before);  // read in the same tick: nothing was awaited
      const last = window.__utAuth.delivered[window.__utAuth.delivered.length - 1];
      return { fresh: JSON.parse(JSON.stringify(fresh)), last };
    });
    const fin = r.fresh.find((s) => s.final);
    R.ok('S6.final', 'a final batch went out in the same tick as pagehide', !!fin, r.fresh.map((s) => ({ final: s.final, token: s.token })));
    R.ok('S6.token', 'with the cached token of the person signed in', !!fin && fin.token === r.last && /^tok-local-/.test(r.last || ''), { got: fin && fin.token, cached: r.last });
    R.ok('S6.ended', 'carrying visit.ended {hidden} and the event before it', !!fin && named(fin.body.events, 'visit.ended', { reason: 'hidden' }).length === 1 && named(fin.body.events, 'feature.used', { feature: 'timeline' }).length === 1,
      fin && fin.body.events.map((e) => e.name));
  } finally { await ctx.close(); }
};

SECTIONS.S7 = async (b, base, R) => {
  console.log('\nS7. the queue never passes 500');
  const { ctx, page } = await openApp(b, base, { mode: 'on', notice: NOTICE });   // held: the notice is not seen
  try {
    await settle(page);
    const r = await page.evaluate(() => {
      window.cubbyTrack('feature.used', { feature: 'games', action: 'opened' });
      const q0 = JSON.parse(localStorage.getItem('cubby-usage-q') || '[]'); const first = q0[q0.length - 1].ev.id;
      let max = 0;
      for (let i = 0; i < 649; i++) { window.cubbyTrack('feature.used', { feature: 'games', action: 'opened' }); if (i % 50 === 0) max = Math.max(max, JSON.parse(localStorage.getItem('cubby-usage-q')).length); }
      const q = JSON.parse(localStorage.getItem('cubby-usage-q') || '[]');
      return { len: q.length, max: Math.max(max, q.length), firstGone: !q.some((x) => x.ev.id === first), lastKept: q[q.length - 1].ev.name === 'feature.used' };
    });
    R.ok('S7.cap', 'after 650 events the queue holds 500, and never more on the way', r.len === 500 && r.max <= 500, r);
    R.ok('S7.oldest', 'the oldest went first, the newest stayed', r.firstGone && r.lastKept, r);
  } finally { await ctx.close(); }
};

SECTIONS.S8 = async (b, base, R) => {
  console.log('\nS8. account deletion: nothing more flows');
  const { ctx, page } = await openApp(b, base, {});
  try {
    await settle(page);
    await page.evaluate(() => window.cubbyTrack('feature.used', { feature: 'export', action: 'opened' }));
    await settle(page);
    R.ok('S8.companion', 'companion: before deletion an event flows and is seen', named(eventsOf(await sent(page)), 'feature.used', { feature: 'export' }).length === 1);
    // AR-1: a deletion refused at the door (the app's sign-in layer has nobody signed in) never started, so it
    // must not silence the tracker. It used to raise the flag first and leave it up for the rest of the page.
    const door = await page.evaluate(() => window.LL.deleteAccount().then(() => 'resolved', (e) => String((e && e.message) || e)));
    await page.evaluate(() => window.cubbyTrack('feature.used', { feature: 'report', action: 'opened' }));
    await settle(page);
    R.ok('S8.door-staged', 'staged: LL.deleteAccount() was refused at the door (not_signed_in)', door === 'not_signed_in', door);
    R.ok('S8.door', 'a deletion refused before it started does not silence the tracker: the next event flows',
      named(eventsOf(await sent(page)), 'feature.used', { feature: 'report' }).length === 1, { door, deleting: await page.evaluate(() => window.__cubbyDeleting) });
    const n0 = (await sent(page)).length;
    await page.evaluate(() => {
      window.cubbyTrack('feature.used', { feature: 'games', action: 'opened' });   // queued, not yet sent
      window.__cubbyDeleting = true;
      window.cubbyTrack('feature.used', { feature: 'pro', action: 'opened' });
    });
    await settle(page);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    const s = await sent(page), q = await queue(page);
    R.ok('S8.silent', 'nothing is sent once the deletion has started, not even what was queued', s.length === n0, s.slice(n0).map((x) => x.body.events.map((e) => e.name)));
    R.ok('S8.cleared', 'and the queue is emptied', q.length === 0, q.map((x) => x.ev.name));
  } finally { await ctx.close(); }
};

SECTIONS.S9 = async (b, base, R) => {
  console.log('\nS9. mode off: one empty ask a day, and nothing else');
  const { ctx, page } = await openApp(b, base, { mode: 'off' });
  try {
    await settle(page);
    await page.evaluate(() => { go('log'); window.cubbyTrack('feature.used', { feature: 'games', action: 'opened' }); });
    await settle(page);
    let s = await sent(page);
    R.ok('S9.empty', 'everything that left was empty', s.length > 0 && eventsOf(s).length === 0, s.map((x) => x.body.events.map((e) => e.name)));
    R.ok('S9.once', 'and it was asked once', s.length === 1, s.length);
    R.ok('S9.dropped', 'the queue is empty: an off server is never sent the events later', (await queue(page)).length === 0);
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(() => typeof window.cubbyTrack === 'function' && ('__cubbyScreen' in window), { timeout: 20000 });
    await settle(page);
    s = await sent(page);
    R.ok('S9.cached', 'the same day, a fresh load asks nothing at all', s.length === 0, s.length);
  } finally { await ctx.close(); }
};

SECTIONS.S10 = async (b, base, R) => {
  console.log('\nS10. off little-cubby.com, with no test sink, nothing reaches /api/usage');
  const o = await openApp(b, base, { sink: false });
  try {
    await o.page.evaluate(() => { go('log'); window.cubbyTrack('feature.used', { feature: 'games', action: 'opened' }); window.cubbyTrackFlush(); window.dispatchEvent(new Event('pagehide')); });
    await sleep(800);
    R.ok('S10.none', 'no request to /api/usage', o.usageReqs.length === 0, o.usageReqs);
    await o.page.evaluate(() => fetch('/api/usage', { method: 'POST', body: '{}' }).catch(() => {}));
    await sleep(300);
    R.ok('S10.companion', 'companion: a request to /api/usage from this page IS seen by the same recorder', o.usageReqs.length === 1, o.usageReqs);
  } finally { await o.ctx.close(); }
};

SECTIONS.S11 = async (b, base, R) => {
  console.log('\nS11. a notification tap and a link');
  let o = await openApp(b, base, { query: '#from=notification&nk=medicine' });
  try {
    await settle(o.page);
    const ev = eventsOf(await sent(o.page));
    R.ok('S11.marker-visit', 'opened from the notification marker: visit.started {notification, cold}', named(ev, 'visit.started', { opened_from: 'notification', start: 'cold' }).length === 1, ev.map((e) => e.name + JSON.stringify(e.props)));
    R.ok('S11.marker-kind', 'and push.opened {kind: medicine}', named(ev, 'push.opened', { kind: 'medicine' }).length === 1);
    const loc = await o.page.evaluate(() => ({ search: location.search, hash: location.hash }));
    R.ok('S11.marker-gone', 'the marker is off the address bar, the rest of it kept', !/from=|nk=/.test(loc.search + loc.hash) && /e2e=1/.test(loc.search), loc);
    await o.page.evaluate(() => {
      window.cubbyTrackPushOpened({ tag: 'camp-autumn', cat: 'marketing', url: '/app/' });
      window.cubbyTrackPushOpened({ tag: 'zz', cat: 'ZZ-NOTE-7731' });
      navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { cubbyNotification: 'feature' } }));
    });
    await settle(o.page);
    const ev2 = eventsOf(await sent(o.page));
    R.ok('S11.kinds', 'kinds map to the fixed list: marketing, other for anything unknown, feature from a page message',
      named(ev2, 'push.opened', { kind: 'marketing' }).length === 1 && named(ev2, 'push.opened', { kind: 'other' }).length === 1 && named(ev2, 'push.opened', { kind: 'feature' }).length === 1,
      ev2.filter((e) => e.name === 'push.opened').map((e) => e.props));
    R.ok('S11.no-words', 'and nothing from the notification itself is carried', !(await sent(o.page)).some((s) => leaks(s.body).note || /camp-autumn/.test(JSON.stringify(s.body))));
  } finally { await o.ctx.close(); }
  o = await openApp(b, base, { query: '&go=feed' });
  try {
    await settle(o.page);
    const ev = eventsOf(await sent(o.page));
    R.ok('S11.link', 'opened from a link (?go=, tidied away before the tracker runs): visit.started {link}', named(ev, 'visit.started', { opened_from: 'link' }).length === 1, ev.filter((e) => e.name === 'visit.started').map((e) => e.props));
  } finally { await o.ctx.close(); }
};

SECTIONS.S12 = async (b, base, R) => {
  console.log('\nS12. the install prompt and the web permission ask');
  const { ctx, page } = await openApp(b, base, {});
  try {
    await page.evaluate(() => {
      window._bip = { prompt() {}, userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }) };
      openInstall();
      window.remindersLive = () => true;
      Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'default' });
      Notification.requestPermission = () => Promise.resolve('denied');
      requestNotif();
    });
    await page.evaluate(() => enablePush());                       // Settings: the Reminders switch on the web
    await settle(page);
    const asks = async () => { const e = await allEvents(page); return { asked: named(e, 'push.permission', { state: 'asked' }).length, denied: named(e, 'push.permission', { state: 'denied' }).length }; };
    const before = await asks();
    await page.evaluate(() => { Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'denied' }); });
    await page.evaluate(() => enablePush());                       // already decided: the browser shows nothing
    await settle(page);
    const afterDecided = await asks();
    await page.evaluate(() => {
      window._bip = null; closeInstall();
      Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
      openInstall();                                               // the iPhone's Share, then Add to Home Screen sheet
    });
    await sleep(200);
    await settle(page);
    const ev = eventsOf(await sent(page));
    R.ok('S12.install', 'install.prompted {shown} then {accepted} for the Chrome prompt',
      named(ev, 'install.prompted', { outcome: 'shown', prompt: 'android_chrome' }).length === 1 && named(ev, 'install.prompted', { outcome: 'accepted', prompt: 'android_chrome' }).length === 1,
      ev.filter((e) => e.name === 'install.prompted').map((e) => e.props));
    R.ok('S12.permission', 'push.permission {asked} then {denied}, from a medicine save and from the Reminders switch', named(ev, 'push.permission', { state: 'asked' }).length === 2 && named(ev, 'push.permission', { state: 'denied' }).length === 2,
      ev.filter((e) => e.name === 'push.permission').map((e) => e.props));
    R.ok('S12.decided', 'a permission already decided shows no prompt, so nothing more is recorded', before.asked === 2 && afterDecided.asked === 2 && afterDecided.denied === 2, { before, afterDecided });
    R.ok('S12.ios', 'install.prompted {shown, ios_instructions} for the iPhone sheet', named(ev, 'install.prompted', { outcome: 'shown', prompt: 'ios_instructions' }).length === 1,
      ev.filter((e) => e.name === 'install.prompted').map((e) => e.props));
  } finally { await ctx.close(); }
};

SECTIONS.S13 = async (b, base, R) => {
  console.log('\nS13. the native shell (a stand-in Capacitor): app state, a tapped notification, the permission ask');
  const { ctx, page } = await openApp(b, base, { native: true });
  try {
    await settle(page);
    const hooked = await page.evaluate(() => Object.keys(window.__utCap || {}));
    R.ok('S13.listening', 'native-bridge listens to appStateChange and notificationActionPerformed', hooked.includes('App:appStateChange') && hooked.includes('Msg:notificationActionPerformed'), hooked);
    await page.evaluate(() => {
      const fire = (k, v) => (window.__utCap[k] || []).forEach((f) => f(v));
      fire('App:appStateChange', { isActive: false });
      fire('App:appStateChange', { isActive: true });
      fire('Msg:notificationActionPerformed', { actionId: 'tap', notification: { data: { tag: 'med-m1-1763', medId: 'm1', medName: 'ZZ-NOTE-MED', nonce: 'zz' } } });
    });
    await page.evaluate(() => window.cubbyEnableNativePush());
    await sleep(200);
    await settle(page);
    const bodies = await sent(page), ev = eventsOf(bodies);
    R.ok('S13.away', 'going away ends the visit (hidden)', named(ev, 'visit.ended', { reason: 'hidden' }).length >= 1);
    R.ok('S13.front', 'coming back starts one, and the tap that brought it is named: {notification, warm}', named(ev, 'visit.started', { opened_from: 'notification', start: 'warm' }).length === 1,
      ev.filter((e) => e.name === 'visit.started').map((e) => e.props));
    R.ok('S13.kind', 'push.opened {medicine}', named(ev, 'push.opened', { kind: 'medicine' }).length === 1);
    R.ok('S13.permission', 'push.permission {asked} then {granted}', named(ev, 'push.permission', { state: 'asked' }).length === 1 && named(ev, 'push.permission', { state: 'granted' }).length === 1);
    R.ok('S13.envelope', 'the envelope says ios_app and the wrapper version', bodies.some((s) => s.body.platform === 'ios_app' && s.body.native_version === '1.4.0'), bodies.map((s) => [s.body.platform, s.body.native_version]));
    R.ok('S13.no-words', 'no medicine name or id from the notification is carried', !bodies.some((s) => NOTE.test(JSON.stringify(s.body)) || /"m1"|med-m1/.test(JSON.stringify(s.body))));
    // Already granted: the toggle shows no OS prompt, so it is not an ask. Then a link brings the app forward.
    await page.evaluate(() => { window.Capacitor.Plugins.FirebaseMessaging.checkPermissions = () => Promise.resolve({ receive: 'granted' }); });
    await page.evaluate(() => window.cubbyEnableNativePush());
    await page.evaluate(() => {
      const fire = (k, v) => (window.__utCap[k] || []).forEach((f) => f(v));
      fire('App:appStateChange', { isActive: false });
      fire('App:appStateChange', { isActive: true });
      fire('App:appUrlOpen', { url: 'https://little-cubby.com/app/' });
    });
    await sleep(200);
    await settle(page);
    const all = await allEvents(page);
    R.ok('S13.decided', 'a permission already given is not asked again: still one asked and one granted', named(all, 'push.permission', { state: 'asked' }).length === 1 && named(all, 'push.permission', { state: 'granted' }).length === 1,
      all.filter((e) => e.name === 'push.permission').map((e) => e.props));
    R.ok('S13.link', 'a link that brings the app forward names the visit: {link, warm}', named(all, 'visit.started', { opened_from: 'link', start: 'warm' }).length === 1,
      all.filter((e) => e.name === 'visit.started').map((e) => e.props));
  } finally { await ctx.close(); }
};

SECTIONS.S14 = async (b, base, R) => {
  console.log('\nS14. every other door that logs or opens a tool records it, by tool');
  let o = await openApp(b, base, {});
  try {
    await o.page.evaluate(() => {
      timersFor('b1').feed = { start: now() - 10 * 60000, side: 'left' }; stopFeed('b1');           // the nursing timer's Stop
      timersFor('b1').sleep = { start: now() - 30 * 60000 }; stopSleep('b1');                     // the sleep timer's Stop
      timersFor('b1').feed = { start: now() - 5 * 3600000, side: 'left' }; stopFeed('b1'); saveFeedCorrect('b1');   // too long: asked, then saved
      timersFor('b1').sleep = { start: now() - 25 * 3600000 }; stopSleep('b1'); saveSleepCorrect('b1');
    });
    await o.page.evaluate(() => { openDoctorReport(); });
    await o.page.evaluate(() => { if (typeof closeSheet === 'function') closeSheet(); openVoiceLog(); });
    await settle(o.page);
    const all = await allEvents(o.page);
    const n = (f, a) => named(all, 'feature.used', { feature: f, action: a }).length;
    const logged = await o.page.evaluate(() => state.events.map((e) => e.type));
    R.ok('S14.timers', 'the timer Stops and their too-long corrections: feed and sleep logged twice each', n('feed', 'logged') === 2 && n('sleep', 'logged') === 2,
      { tracked: all.filter((e) => e.name === 'feature.used').map((e) => e.props), logged });
    R.ok('S14.report', 'the doctor report opened: {report, opened}', n('report', 'opened') === 1);
    R.ok('S14.voice', 'voice logging opened: {voice, opened}', n('voice', 'opened') === 1);
  } finally { await o.ctx.close(); }
  o = await openApp(b, base, { appAuth: true });
  try {
    await o.page.evaluate(() => window.openFamily('invite'));
    await sleep(300);
    await settle(o.page);
    const all = await allEvents(o.page);
    R.ok('S14.invite', 'the invite sheet opened: {invite, opened}', named(all, 'feature.used', { feature: 'invite', action: 'opened' }).length === 1, all.map((e) => e.name + JSON.stringify(e.props)));
  } finally { await o.ctx.close(); }
};

/* The service worker's half of a tapped notification, in node: the sw.js this url serves, run in a sandbox
   with a stand-in `self`, handed the notificationclick a real tap would get. */
/* The same sw.js handed the navigation a browser makes for the URL a tap opened (a fragment is never part of
   a request), with /app/ and /app/index.html in the cache and a network that never answers. */
function swFetch(src, url) {
  const origin = 'https://little-cubby.com', handlers = {};
  const store = { [origin + '/app/']: { label: 'cached /app/' }, [origin + '/app/index.html']: { label: 'cached /app/index.html' } };
  const self = { addEventListener: (t, f) => { handlers[t] = f; }, location: { origin }, skipWaiting() {}, clients: { claim() {}, matchAll: () => Promise.resolve([]) }, registration: {} };
  const caches = { match: (r) => Promise.resolve(store[new URL(typeof r === 'string' ? r : r.url, origin).href]), open: () => Promise.resolve({ put() {} }), keys: () => Promise.resolve([]), delete: () => Promise.resolve(true) };
  const ctx = vm.createContext({ self, caches, fetch: () => new Promise(() => {}), URL, URLSearchParams, console, Promise, setTimeout });
  vm.runInContext(src, ctx);
  const u = new URL(url, origin); u.hash = '';
  let answered = null;
  handlers.fetch({ request: { method: 'GET', url: u.href, mode: 'navigate', headers: { get: () => 'text/html' } }, respondWith(p) { answered = Promise.resolve(p); } });
  return Promise.race([(answered || Promise.resolve(undefined)).then((r) => ({ requested: u.href, got: r && r.label })),
    new Promise((res) => setTimeout(() => res({ requested: u.href, got: 'nothing within 500 ms: waiting on the network' }), 500))]);
}
function swClick(src, data, openClient) {
  const handlers = {}, calls = { opened: [], posted: [], focused: 0 };
  const client = { url: 'https://little-cubby.com/app/', focus() { calls.focused++; return Promise.resolve(); }, postMessage(m) { calls.posted.push(m); } };
  const self = {
    addEventListener: (t, f) => { handlers[t] = f; }, location: { origin: 'https://little-cubby.com' }, skipWaiting() {},
    clients: { matchAll: () => Promise.resolve(openClient ? [client] : []), openWindow: (u) => { calls.opened.push(u); return Promise.resolve(); }, claim() {} },
    registration: { showNotification: () => Promise.resolve() },
  };
  const ctx = vm.createContext({ self, caches: {}, fetch: () => Promise.reject(new Error('offline')), URL, URLSearchParams, console, Promise, setTimeout });
  vm.runInContext(src, ctx);
  let waited = Promise.resolve();
  handlers.notificationclick({ notification: { close() {}, data }, action: '', waitUntil(p) { waited = p; } });
  return waited.then(() => calls);
}
SECTIONS.S15 = async (b, base, R) => {
  console.log('\nS15. the service worker tells the page it was opened by a notification, by kind only');
  const src = await (await fetch(base + '/app/sw.js')).text();
  const med = await swClick(src, { tag: 'med-m1-1763000000000', medId: 'm1', medName: 'ZZ-NOTE-MED', nonce: 'zz' }, false);
  const u = new URL(med.opened[0] || 'about:blank', 'https://little-cubby.com'), uh = new URLSearchParams(u.hash.slice(1));
  R.ok('S15.marker', 'a dose reminder tapped with no window open opens /app/#from=notification&nk=medicine (the marker in the fragment)',
    u.pathname === '/app/' && u.search === '' && uh.get('from') === 'notification' && uh.get('nk') === 'medicine', med.opened);
  const inst = await swFetch(src, med.opened[0] || '/app/#none');
  R.ok('S15.instant', 'and that page opens from the cache at once, with the network silent', inst.got === 'cached /app/', inst);
  const miss = await swFetch(src, '/app/?from=notification&nk=medicine');
  R.ok('S15.instant-companion', 'companion: a marker in the query misses the cache and waits on the network', miss.got !== 'cached /app/', miss);
  R.ok('S15.no-words', 'and the URL carries no medicine name, id or tag', !/ZZ-NOTE|m1|med-/.test(med.opened.join(' ')), med.opened);
  const camp = await swClick(src, { tag: 'camp-autumn', cat: 'marketing', url: 'https://little-cubby.com/app/?go=pro' }, false);
  const cu = new URL(camp.opened[0] || 'about:blank', 'https://little-cubby.com'), ch = new URLSearchParams(cu.hash.slice(1));
  R.ok('S15.campaign', 'a campaign keeps its own destination and adds the marker: go=pro, nk=marketing',
    cu.searchParams.get('go') === 'pro' && ch.get('nk') === 'marketing' && ch.get('from') === 'notification', camp.opened);
  const open = await swClick(src, { tag: 'digest-2026-11-14' }, true);
  R.ok('S15.message', 'with Cubby already open, it is focused and told {cubbyNotification: medicine}, no new window',
    open.focused === 1 && open.opened.length === 0 && open.posted.length === 1 && open.posted[0].cubbyNotification === 'medicine', open);
};

SECTIONS.S16 = async (b, base, R) => {
  console.log('\nS16. idle visits end at the last touch, a return after hours is not idle, nothing goes before the first paint');
  const { ctx, page } = await openApp(b, base, { captureIdle: true });
  try {
    await settle(page);
    const n = await page.evaluate(() => (window.__utIdle || []).length);
    R.ok('S16.staged', 'the tracker\'s 60-second idle check was captured before boot', n === 1, n);
    // One touch a minute in, then 31 minutes of nothing.
    await page.evaluate(() => { window.__utClk.shift += 60000; window.dispatchEvent(new Event('pointerdown')); window.__utClk.shift += 31 * 60000; window.__utIdle.forEach((f) => f()); });
    await settle(page);
    let all = await allEvents(page);
    const idle = named(all, 'visit.ended', { reason: 'idle' });
    R.ok('S16.idle', 'visit.ended {idle} at the last touch: about 60 seconds, not the 32 minutes until the check ran',
      idle.length === 1 && idle[0].props.seconds >= 60 && idle[0].props.seconds <= 90, idle.map((e) => e.props));
    // Away for two hours, then back: the visit that starts is not idle.
    await setVis(page, 'hidden');
    await page.evaluate(() => { window.__utClk.shift += 2 * 3600000; });
    await setVis(page, 'visible');
    await page.evaluate(() => window.__utIdle.forEach((f) => f()));
    await settle(page);
    all = await allEvents(page);
    R.ok('S16.back', 'staged: coming back started a new visit {other, warm}', named(all, 'visit.started', { opened_from: 'other', start: 'warm' }).length >= 1,
      all.filter((e) => e.name === 'visit.started').map((e) => e.props));
    R.ok('S16.no-false-idle', 'and it is not ended as idle the moment it starts', named(all, 'visit.ended', { reason: 'idle' }).length === 1,
      all.filter((e) => e.name === 'visit.ended').map((e) => e.props));
  } finally { await ctx.close(); }
  // The tracker on a page with no app: auth answers, nothing is ever painted.
  const ctx2 = await b.createBrowserContext({ downloadBehavior: dl.downloadBehavior() });
  try {
    const page = await ctx2.newPage();
    await page.setBypassServiceWorker(true);
    await page.setRequestInterception(true);
    page.on('request', (r) => { let h = ''; try { h = new URL(r.url()).hostname; } catch (e) {} return (h === '127.0.0.1' || h === 'localhost' || /^(data|blob|about):/.test(r.url())) ? r.continue() : r.abort(); });
    // No sign-in layer here to say her family record has been seen, so the page says it (that wait is S19's):
    // this half isolates the paint wait.
    await page.evaluateOnNewDocument(boot, { clock: CLOCK, sink: true, mode: 'internal', user: 'local', seed: seedBaby(), householdSeen: 'local' });
    await page.goto(base + '/app/usage-allowlist.js', { waitUntil: 'load', timeout: 20000 });
    await page.addScriptTag({ url: base + '/app/usage-allowlist.js' });
    await page.addScriptTag({ url: base + '/app/cubby-track.js' });
    await sleep(300);
    await settle(page);
    const s0 = await sent(page), q0 = await queue(page);
    R.ok('S16.paint-wait', 'signed in but nothing painted yet: nothing is sent, not even the mode ask, and the visit waits',
      s0.length === 0 && q0.some((x) => x.ev.name === 'visit.started' && x.uid === 'local'), { sent: s0.length, queued: q0.map((x) => [x.uid, x.ev.name]) });
    await page.evaluate(() => window.cubbyTrackScreen('home'));
    await settle(page);
    const s1 = await sent(page);
    R.ok('S16.paint-flows', 'companion: once a screen is painted, the same page sends', named(eventsOf(s1), 'visit.started', {}).length === 1, s1.map((x) => x.body.events.map((e) => e.name)));
  } finally { await ctx2.close(); }
};

SECTIONS.S17 = async (b, base, R) => {
  console.log('\nS17. before sign-in: 24 hours for a sign-in to claim, then only what the server takes, in mode on only');
  let L = null;   // the allowlist the served page runs with
  const anonOk = (e) => { const sp = L && L.events[e.name]; return !!(sp && sp.anon && (!sp.anonScreens || sp.anonScreens.includes(e.props && e.props.screen))); };
  const agedLeft = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('cubby-usage-q') || '[]').filter((x) => !x.uid && Date.now() - x.at > 86400000).map((x) => x.ev.name));
  // (a) Mode on, nobody signs in for 25 hours.
  let o = await openApp(b, base, { user: null, mode: 'on' });
  try {
    L = await o.page.evaluate(() => window.CUBBY_USAGE_ALLOWLIST);
    await o.page.evaluate(() => {
      window.cubbyTrack('install.prompted', { outcome: 'shown', prompt: 'android_chrome' });
      window.cubbyTrack('feature.used', { feature: 'games', action: 'opened' });
    });
    await settle(o.page);
    let s = await sent(o.page);
    const q = await queue(o.page);
    R.ok('S17.wait', 'fresh: only the empty ask has left, and every event waits for a sign-in', s.length >= 1 && eventsOf(s).length === 0 && q.length >= 3 && q.every((x) => !x.uid),
      { sent: s.map((x) => x.body.events.length), queued: q.map((x) => x.ev.name) });
    await o.page.evaluate(() => { window.__utClk.shift += 25 * 3600000; });
    await settle(o.page);
    s = await sent(o.page);
    const ev = eventsOf(s);
    R.ok('S17.anon-only', 'after 24 hours unclaimed, only what the server takes before sign-in went, with no token',
      ev.length > 0 && ev.every((e) => anonOk(e) && !e._token), ev.map((e) => [e.name, (e.props && e.props.screen) || '', e._token]));
    R.ok('S17.anon-went', 'companion: visit.started and install.prompted did go', named(ev, 'visit.started', {}).length >= 1 && named(ev, 'install.prompted', {}).length === 1, ev.map((e) => e.name));
    const left = await agedLeft(o.page);
    R.ok('S17.dropped', 'what may never go anonymously (feature.used, screen.viewed home) did not go and is no longer kept',
      named(ev, 'feature.used', {}).length === 0 && left.length === 0, { sent: ev.map((e) => e.name), left });
  } finally { await o.ctx.close(); }
  // (b) Internal: the server answers "off" to a request with no sign-in. Fresh events still wait, and a
  //     sign-in within 24 hours claims them.
  o = await openApp(b, base, { user: null, answer: { linked: 'internal', anon: 'off' } });
  try {
    await o.page.evaluate(() => window.cubbyTrack('install.prompted', { outcome: 'shown', prompt: 'android_chrome' }));
    const ip = await lastQueuedId(o.page);
    await settle(o.page);
    const s = await sent(o.page);
    R.ok('S17.off-keeps', 'an anonymous "off": nothing went, and the fresh events still wait for a sign-in',
      s.length >= 1 && eventsOf(s).length === 0 && (await queue(o.page)).some((x) => x.ev.id === ip), { sent: s.length, queued: (await queue(o.page)).map((x) => x.ev.name) });
    await o.page.evaluate(() => window.__utAuth.switchTo('local'));
    await settle(o.page);
    const ev = eventsOf(await sent(o.page));
    R.ok('S17.claimed', 'signed in within 24 hours: they go under that person\'s token', ev.some((e) => e.id === ip && /^tok-local-/.test(e._token)), ev.map((e) => [e.name, e._token]));
  } finally { await o.ctx.close(); }
  // (c) Internal, and a server that answers "internal" to a request with no sign-in: still nothing goes
  //     anonymously, and what waited 24 hours is dropped.
  o = await openApp(b, base, { user: null, answer: { linked: 'internal', anon: 'internal' } });
  try {
    await settle(o.page);
    await o.page.evaluate(() => { window.__utClk.shift += 25 * 3600000; });
    await settle(o.page);
    const s = await sent(o.page), left = await agedLeft(o.page);
    R.ok('S17.on-only', 'outside mode on nothing goes anonymously, whatever the server answers', s.length >= 1 && eventsOf(s).length === 0, s.map((x) => x.body.events.map((e) => e.name)));
    R.ok('S17.on-only-dropped', 'and what waited 24 hours unclaimed leaves the queue', left.length === 0, left);
  } finally { await o.ctx.close(); }
};

SECTIONS.S18 = async (b, base, R) => {
  console.log('\nS18. a batch refused for its shape leaves the queue; a server error keeps it');
  const { ctx, page } = await openApp(b, base, { answer: {} });
  try {
    await settle(page);
    await page.evaluate(() => { window.__utAnswer.events = { status: 503 }; window.cubbyTrack('feature.used', { feature: 'games', action: 'opened' }); });
    const g = await lastQueuedId(page);
    await settle(page);
    const n503 = eventsOf(await sent(page)).filter((e) => e.id === g).length;
    R.ok('S18.kept', 'a 503: the event was sent and is still queued for the next send', n503 >= 1 && (await queue(page)).some((x) => x.ev.id === g), { sends: n503 });
    await page.evaluate(() => { window.__utAnswer.events = { status: 400 }; });
    await settle(page);
    const after400 = eventsOf(await sent(page)).filter((e) => e.id === g).length;
    await settle(page);
    const later = eventsOf(await sent(page)).filter((e) => e.id === g).length;
    R.ok('S18.dropped', 'a 400: it leaves the queue and is never sent again', after400 > n503 && later === after400 && !(await queue(page)).some((x) => x.ev.id === g), { n503, after400, later });
  } finally { await ctx.close(); }
};

SECTIONS.S19 = async (b, base, R) => {
  console.log('\nS19. her family record as the server holds it: nothing leaves before it is seen (PRIV-4, the tracker\'s half)');
  let o = await openApp(b, base, { household: { value: '' } });
  try {
    const rep = await o.page.evaluate(() => window.__utHousehold.reports.slice());
    R.ok('S19.reported', 'the local-only page (?e2e=1) itself reports that it has no family record to wait for (\'*\')', rep.includes('*'), rep);
    await sleep(5500);                                  // past the tracker's own send, 5 seconds after the first event
    await settle(o.page);
    let s = await sent(o.page), q = await queue(o.page);
    R.ok('S19.held', 'painted from this phone\'s copy, the server\'s copy not yet seen: nothing is sent, not even the mode ask',
      s.length === 0, s.map((x) => x.body.events.map((e) => e.name)));
    R.ok('S19.queued', 'and what happened waits on the phone, as hers', q.some((x) => x.ev.name === 'visit.started' && x.uid === 'local') && q.some((x) => x.ev.name === 'screen.viewed' && x.uid === 'local'),
      q.map((x) => [x.uid, x.ev.name]));
    await o.page.evaluate(() => { window.__utHousehold.value = 'zz-user-b'; });
    await settle(o.page);
    s = await sent(o.page);
    R.ok('S19.other-held', 'a family record seen for someone else is not hers: still nothing', s.length === 0, s.map((x) => x.body.events.map((e) => e.name)));
    // The server's copy lands, and it carries a holding set on another phone.
    await o.page.evaluate((at) => { state.lossHolding = { local: { at } }; window.__utHousehold.value = 'local'; }, CLOCK - 3600000);
    await settle(o.page);
    s = await sent(o.page); q = await queue(o.page);
    const held = await o.page.evaluate(() => !!myLossHolding());
    R.ok('S19.holding-silent', 'the server\'s copy brings her holding: nothing was ever sent', held && s.length === 0, { held, sent: s.map((x) => x.body.events.map((e) => e.name)) });
    R.ok('S19.holding-dropped', 'and what waited is dropped, never sent later', q.length === 0, q.map((x) => x.ev.name));
  } finally { await o.ctx.close(); }
  // Companion: the same wait, then the server's copy with no holding in it: everything that waited goes.
  o = await openApp(b, base, { household: { value: '' } });
  try {
    await settle(o.page);
    const before = (await sent(o.page)).length;
    await o.page.evaluate(() => { window.__utHousehold.value = 'local'; });
    await settle(o.page);
    const ev = eventsOf(await sent(o.page));
    R.ok('S19.companion', 'companion: once her record is seen, what waited goes under her token (the hold is not a sink that cannot see)',
      before === 0 && named(ev, 'visit.started', {}).some((e) => /^tok-local-/.test(e._token || '')) && named(ev, 'screen.viewed', { screen: 'home' }).length === 1,
      { before, sent: ev.map((e) => [e.name, e._token]) });
  } finally { await o.ctx.close(); }
};

/* ---------------- the real sync layer: the Firestore emulator (S20, S21) ---------------- */
/* S20 and S21 run the app's REAL sign-in layer (store-firebase.js: resolveHousehold, startSync, deleteAccount)
   against a Firestore emulator through the localhost-only ?fsemu= hook in firebase-init.js, so what they prove
   is what the Firestore SDK really does, not what a stand-in says it does. The emulator is the jar firebase-tools
   keeps in ~/.cache/firebase/emulators, started here with java directly (the firebase CLI would also fetch its
   message of the day from the internet), on ports inside EMU_PORT_RANGE, with open rules: the fsemu hook sends
   no token, and the rules are rules-test.js's job. One emulator serves the whole run, the self-test included;
   each section empties it first. */
const EMU = { port: 0, proc: null, dir: null, project: 'little-log-a9caa' };
function emulatorJar() {
  if (process.env.FIRESTORE_EMULATOR_JAR) return process.env.FIRESTORE_EMULATOR_JAR;
  const dir = path.join(os.homedir(), '.cache', 'firebase', 'emulators');
  let jars = [];
  try { jars = fs.readdirSync(dir).filter((n) => /^cloud-firestore-emulator-v[\d.]+\.jar$/.test(n)); } catch (e) {}
  const ver = (n) => n.match(/v([\d.]+)\.jar$/)[1].split('.').map(Number);
  jars.sort((a, c) => { const x = ver(a), y = ver(c); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; });
  return jars.length ? path.join(dir, jars[jars.length - 1]) : null;
}
async function startEmulator() {
  const jar = emulatorJar();
  if (!jar || !fs.existsSync(jar)) throw new Error('no Firestore emulator jar in ~/.cache/firebase/emulators (any emulator suite downloads it: node tools/gates.js --emulator --only=two-caregivers), or set FIRESTORE_EMULATOR_JAR');
  const [port, ws] = await pickPorts(2);
  EMU.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-usage-emu-'));
  const rules = path.join(EMU.dir, 'open.rules');
  fs.writeFileSync(rules, "rules_version = '2';\nservice cloud.firestore { match /databases/{db}/documents { match /{document=**} { allow read, write: if true; } } }\n");
  const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
  let said = '', exited = false;
  EMU.proc = spawn(java, ['-jar', jar, '--host=127.0.0.1', '--port=' + port, '--websocket_port=' + ws, '--rules=' + rules], { cwd: EMU.dir, stdio: ['ignore', 'pipe', 'pipe'] });
  EMU.proc.stdout.on('data', (d) => { said += d; });
  EMU.proc.stderr.on('data', (d) => { said += d; });
  EMU.proc.on('exit', () => { exited = true; });
  process.on('exit', () => { try { EMU.proc.kill('SIGKILL'); } catch (e) {} });
  const stop = Date.now() + 60000;
  for (;;) {
    if (exited) throw new Error('the Firestore emulator exited: ' + said.slice(-300));
    try { const r = await fetch('http://127.0.0.1:' + port + '/'); if (r.ok) break; } catch (e) {}
    if (Date.now() > stop) throw new Error('the Firestore emulator never answered on ' + port + ': ' + said.slice(-300));
    await sleep(250);
  }
  EMU.port = port;
  console.log('firestore emulator: ' + path.basename(jar) + ' on 127.0.0.1:' + port);
}
async function stopEmulator() {
  if (EMU.proc) {
    const p = EMU.proc; EMU.proc = null;
    await new Promise((res) => { if (p.exitCode !== null) return res(); p.once('exit', () => res()); try { p.kill('SIGTERM'); } catch (e) { res(); } setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) {} }, 5000); });
  }
  if (EMU.dir && path.dirname(EMU.dir) === path.resolve(os.tmpdir()) && /^cubby-usage-emu-/.test(path.basename(EMU.dir))) { try { fs.rmSync(EMU.dir, { recursive: true, force: true }); } catch (e) {} }
  EMU.dir = null;
}
const emuDocs = () => 'http://127.0.0.1:' + EMU.port + '/v1/projects/' + EMU.project + '/databases/(default)/documents';
async function emuClear() {
  const r = await fetch('http://127.0.0.1:' + EMU.port + '/emulator/v1/projects/' + EMU.project + '/databases/(default)/documents', { method: 'DELETE' });
  if (!r.ok) throw new Error('could not empty the emulator: ' + r.status);
}
/* Another phone's write: her holding seeded into the family record, as ending a pregnancy on Papa's phone does. */
async function emuSetHolding(hid, uid, at) {
  const body = { fields: { app: { mapValue: { fields: { lossHolding: { mapValue: { fields: { [uid]: { mapValue: { fields: { at: { integerValue: String(at) } } } } } } } } } } } };
  const r = await fetch(emuDocs() + '/households/' + encodeURIComponent(hid) + '?updateMask.fieldPaths=app.lossHolding',
    { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify(body) });
  return r.ok;
}
const cloudPage = (uid, extra) => Object.assign({ search: '?fsemu=' + EMU.port + '&fsuid=' + uid, user: uid }, extra || {});
/* Booted on the cloud path: the family is resolved and the app has drawn it. Returns the family's id. */
async function cloudBooted(page) {
  try {
    await page.waitForFunction(() => !!(window.LL && window.LL.householdId) && typeof state !== 'undefined' && !document.getElementById('llAuthOv') && typeof window.__cubbyScreen === 'string', { timeout: 30000 });
    return await page.evaluate(() => window.LL.householdId);
  } catch (e) { return null; }
}
/* Ask the tracker to send, until `test` holds over everything sent, or the time runs out. */
async function sendsUntil(page, test, ms) {
  const stop = Date.now() + (ms || 15000);
  for (;;) {
    await settle(page);
    const s = await sent(page);
    if (test(s) || Date.now() > stop) return s;
  }
}

SECTIONS.S20 = async (b, base, R) => {
  console.log('\nS20. a loss holding set on another phone, through the real sync layer (Firestore emulator): nothing leaves before the server\'s copy (PRIV-4)');
  await emuClear();
  // (a) Yesterday her phone held the family record. Overnight Papa's phone seeded her holding. This morning her
  //     phone opens on yesterday's copy, and the server's copy is slow to come.
  let ctx = await b.createBrowserContext({ downloadBehavior: dl.downloadBehavior() });
  try {
    const uid = 'zz-mama-held';
    let o = await openApp(b, base, cloudPage(uid), ctx);
    const hid = await cloudBooted(o.page);
    await sleep(3500);                                  // its own first writes (the avatar claim) land, and the copy is on disk
    await o.page.close();
    const wrote = hid ? await emuSetHolding(hid, uid, CLOCK - 3600000) : false;
    o = await openApp(b, base, cloudPage(uid, { netOff: true }), ctx);
    const hid2 = await cloudBooted(o.page);
    const pre = await o.page.evaluate(() => ({ held: !!myLossHolding(), screen: window.__cubbyScreen, hid: window.LL.householdId }));
    R.ok('S20.staged', 'staged: her phone opened on yesterday\'s copy of her family, with no holding in it, and painted it',
      !!hid && hid2 === hid && wrote && !pre.held && !!pre.screen, { hid, hid2, wrote, pre });
    /* A write of this phone's own, made while the server could not be reached (as the app's avatar claim or a
       change made offline leaves), and a recorder of every copy of the family record the page is shown from
       here on. Registered after the app's own listeners, so it sees each copy after they have. */
    const pendingAtBoot = await o.page.evaluate((h, u) => new Promise((res) => {
      const ref = window.LL.db.collection('households').doc(h);
      ref.update({ ['memberInfo.' + u + '.zzOffline']: 1 }).catch(() => {});
      window.__utCopies = [];
      ref.onSnapshot({ includeMetadataChanges: true }, (snap) => {
        const d = snap.data() || {}, lh = ((d.app || {}).lossHolding || {})[u];
        window.__utCopies.push({ fromCache: snap.metadata.fromCache, pending: snap.metadata.hasPendingWrites, holding: !!lh });
        if (window.__utCopies.length === 1) res(snap.metadata.hasPendingWrites);
      });
    }), hid, uid);
    await sleep(5500);                                  // past the tracker's own send
    await settle(o.page);
    let s = await sent(o.page);
    R.ok('S20.held', 'until the server\'s copy has landed nothing is sent, not even the mode ask', s.length === 0, s.map((x) => ({ token: x.token, events: x.body.events.map((e) => e.name + ':' + JSON.stringify(e.props)) })));
    /* Back online, on a connection that delivers in this order: the server reads her record for the listen
       first (the listen's request goes at once, her write's 300 ms later), her write is answered, and only then
       does what the listen read reach the phone (its reply channel is held 1.5 s). */
    const back = Date.now();
    o.ctl.delay = (u, m) => (Date.now() - back > 4000 ? 0
      : /Firestore\/Write\/channel/.test(u) && m === 'POST' ? 300
        : /Firestore\/Listen\/channel/.test(u) && m === 'GET' ? 1500 : 0);
    await o.page.evaluate(() => window.LL.db.enableNetwork());
    const landed = await o.page.waitForFunction(() => !!myLossHolding(), { timeout: 20000 }).then(() => true, () => false);
    await sleep(500);
    await settle(o.page);
    o.ctl.delay = null;
    s = await sent(o.page);
    const q = await queue(o.page);
    const copies = await o.page.evaluate(() => window.__utCopies.slice());
    R.ok('S20.landed', 'staged: the server\'s copy then landed, carrying her holding', landed);
    // What Firestore does on that order (seen on the emulator, and in most runs without the staging too): its
    // first copy after reconnecting is marked as from the server while her own write still shows as pending,
    // and the holding is not in it; only the copy after it, with nothing pending, holds it. A check on
    // fromCache alone would trust the first.
    R.ok('S20.race-staged', 'staged: first came a copy marked as from the server while her own write still showed as pending, with no holding in it',
      pendingAtBoot === true && copies.some((c) => !c.fromCache && c.pending && !c.holding) && copies.some((c) => !c.fromCache && !c.pending && c.holding), copies);
    R.ok('S20.silent', 'and nothing was ever sent', s.length === 0, s.map((x) => x.body.events.map((e) => e.name)));
    R.ok('S20.dropped', 'and what waited is dropped, never sent later', q.length === 0, q.map((x) => x.ev.name));
  } finally { await ctx.close(); }
  // (b) Companion: the same morning with nothing changed overnight. The server's copy holds nothing the page has
  //     not already shown, so only its metadata says it has come; what waited goes then, under her token.
  ctx = await b.createBrowserContext({ downloadBehavior: dl.downloadBehavior() });
  try {
    const uid = 'zz-mama-calm';
    let o = await openApp(b, base, cloudPage(uid), ctx);
    const hid = await cloudBooted(o.page);
    await sleep(3500);
    await o.page.close();
    o = await openApp(b, base, cloudPage(uid, { netOff: true }), ctx);
    const hid2 = await cloudBooted(o.page);
    // Every copy of the record the page is shown from here on, and what it holds.
    await o.page.evaluate((h) => {
      const norm = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().reduce((a, k) => { a[k] = norm(v[k]); return a; }, {}) : Array.isArray(v) ? v.map(norm) : v);
      window.__utCopies = [];
      window.LL.db.collection('households').doc(h).onSnapshot({ includeMetadataChanges: true }, (snap) => {
        window.__utCopies.push({ fromCache: snap.metadata.fromCache, pending: snap.metadata.hasPendingWrites, data: JSON.stringify(norm(snap.data() || null)) });
      });
    }, hid2);
    await settle(o.page);
    const before = (await sent(o.page)).length;
    await o.page.evaluate(() => window.LL.db.enableNetwork());
    const tokOf = new RegExp('^tok-' + uid + '-');
    const s = await sendsUntil(o.page, (x) => eventsOf(x).some((e) => e.name === 'visit.started' && tokOf.test(e._token || '')), 20000);
    const ev = eventsOf(s);
    const copies = await o.page.evaluate(() => window.__utCopies.slice());
    const server = copies.find((c) => !c.fromCache && !c.pending);
    R.ok('S20.flows-staged', 'staged: the server\'s copy came, and it held nothing the cached copy did not (only its metadata changed)',
      copies.length > 0 && !!server && copies.every((c) => c.data === copies[0].data), copies.map((c) => ({ fromCache: c.fromCache, pending: c.pending, same: c.data === copies[0].data })));
    R.ok('S20.flows', 'companion: held until the server\'s copy has come (nothing new in it), then what waited goes under her token',
      !!hid && hid2 === hid && before === 0 && named(ev, 'visit.started', {}).some((e) => tokOf.test(e._token || '')),
      { hid, hid2, before, seen: await o.page.evaluate(() => window.__cubbyHouseholdSeen), sent: ev.map((e) => [e.name, e._token]) });
  } finally { await ctx.close(); }
};

SECTIONS.S21 = async (b, base, R) => {
  console.log('\nS21. an account deletion that does not finish, through the real sync layer (Firestore emulator) (AR-1)');
  await emuClear();
  // (a) Refused before her usage rows were asked to go: the leave (step 2) is refused, as the rules refuse it.
  //     She is still in her family and is asked to try again; the tracker carries on.
  let o = await openApp(b, base, cloudPage('zz-del-early'));
  try {
    const uid = 'zz-del-early', tokOf = /^tok-zz-del-early-/;
    const hid = await cloudBooted(o.page);
    await o.page.evaluate(() => window.cubbyTrack('feature.used', { feature: 'export', action: 'opened' }));
    let s = await sendsUntil(o.page, (x) => named(eventsOf(x), 'feature.used', { feature: 'export' }).length > 0, 20000);
    R.ok('S21.early-before', 'companion: before the deletion her events flow', !!hid && named(eventsOf(s), 'feature.used', { feature: 'export' }).some((e) => tokOf.test(e._token || '')), eventsOf(s).map((e) => [e.name, e._token]));
    o.ctl.refuse = (u, m) => m === 'POST' && /documents:commit/.test(u);
    const err = await o.page.evaluate(() => window.LL.deleteAccount().then(() => 'resolved', (e) => String((e && (e.code || e.message)) || e)));
    o.ctl.refuse = null;
    const st = await o.page.evaluate((u) => ({ member: !!(window.LL.members || {})[u], deleting: window.__cubbyDeleting }), uid);
    const refused = o.local.filter((x) => x.method === 'POST' && /documents:commit/.test(x.url)).length;
    const purge = o.local.filter((x) => /\/api\/account\/purge/.test(x.url)).length;
    R.ok('S21.early-staged', 'staged: the leave was refused (permission-denied), she is still in her family, and her usage rows were never asked to go',
      err === 'permission-denied' && refused > 0 && st.member && purge === 0, { err, refused, purge, st });
    const n0 = (await sent(o.page)).length;
    await o.page.evaluate(() => window.cubbyTrack('feature.used', { feature: 'games', action: 'opened' }));
    s = await sendsUntil(o.page, (x) => named(eventsOf(x), 'feature.used', { feature: 'games' }).length > 0, 10000);
    R.ok('S21.early-flows', 'after it, her next event flows under her token: the deletion that never got that far did not silence her',
      named(eventsOf(s.slice(n0)), 'feature.used', { feature: 'games' }).some((e) => tokOf.test(e._token || '')), { deleting: await o.page.evaluate(() => window.__cubbyDeleting), sent: eventsOf(s.slice(n0)).map((e) => e.name) });
  } finally { await o.ctx.close(); }
  // (b) Stopped after them: an email-code sign-in older than five minutes, so the login itself cannot be deleted
  //     (requires-recent-login, and no provider to ask again). Her usage rows have been asked to go; nothing new is
  //     recorded under that account until she signs out. She then signs in again, as the app tells her to.
  o = await openApp(b, base, cloudPage('zz-del-late', { appAuth: true, staleLogin: true }));
  try {
    const uid = 'zz-del-late', tokOf = /^tok-zz-del-late-/;
    const hid = await cloudBooted(o.page);
    await o.page.evaluate(() => window.cubbyTrack('feature.used', { feature: 'export', action: 'opened' }));
    let s = await sendsUntil(o.page, (x) => named(eventsOf(x), 'feature.used', { feature: 'export' }).length > 0, 20000);
    R.ok('S21.late-before', 'companion: before the deletion her events flow', !!hid && named(eventsOf(s), 'feature.used', { feature: 'export' }).some((e) => tokOf.test(e._token || '')), eventsOf(s).map((e) => [e.name, e._token]));
    const err = await o.page.evaluate(() => window.LL.deleteAccount().then(() => 'resolved', (e) => String((e && (e.code || e.message)) || e)));
    const purge = o.local.filter((x) => x.method === 'POST' && /\/api\/account\/purge/.test(x.url)).length;
    R.ok('S21.late-staged', 'staged: the deletion stopped at the login (reauth_unsupported), after her usage rows were asked to go', err === 'reauth_unsupported' && purge === 1, { err, purge });
    const n0 = (await sent(o.page)).length;
    await o.page.evaluate(() => { window.cubbyTrack('feature.used', { feature: 'games', action: 'opened' }); window.cubbyTrackEntry('feed', 'logged'); });
    await settle(o.page);
    const s1 = (await sent(o.page)).slice(n0), q1 = await queue(o.page);
    R.ok('S21.late-silent', 'after it nothing more is sent or kept under the account she asked to delete', s1.length === 0 && q1.length === 0,
      { sent: s1.map((x) => x.body.events.map((e) => e.name)), queued: q1.map((x) => x.ev.name) });
    // She signs out, then in again on the same page.
    await o.page.evaluate(async () => { await window.LL.signOut(); window.__utAuth.switchTo(null); });
    await sleep(300);
    await o.page.evaluate((u) => window.__utAuth.switchTo(u), uid);
    const back = await cloudBooted(o.page);
    const n1 = (await sent(o.page)).length;
    await o.page.evaluate(() => window.cubbyTrack('feature.used', { feature: 'pro', action: 'opened' }));
    s = await sendsUntil(o.page, (x) => named(eventsOf(x.slice(n1)), 'feature.used', { feature: 'pro' }).length > 0, 20000);
    R.ok('S21.again-flows', 'signed out and in again on the same page: her events flow again (signing out ended the silence)',
      !!back && named(eventsOf(s.slice(n1)), 'feature.used', { feature: 'pro' }).some((e) => tokOf.test(e._token || '')),
      { back, deleting: await o.page.evaluate(() => window.__cubbyDeleting), seen: await o.page.evaluate(() => window.__cubbyHouseholdSeen), sent: eventsOf(s.slice(n1)).map((e) => [e.name, e._token]) });
  } finally { await o.ctx.close(); }
};

/* ---------------- a run ---------------- */
async function treeCheck(base, treeRoot, R) {
  console.log('\nS0. the server is serving the tree under test');
  const want = fs.readFileSync(path.join(treeRoot, 'app', 'cubby-track.js'), 'utf8');
  let got = '', html = '';
  try { got = await (await fetch(base + '/app/cubby-track.js')).text(); html = await (await fetch(base + '/app/')).text(); } catch (e) {}
  R.ok('S0.tracker', 'the tracker served at ' + base + ' is this tree\'s app/cubby-track.js', got === want, { served: got.length, onDisk: want.length });
  R.ok('S0.loaded', 'and app/index.html loads usage-allowlist.js, then cubby-track.js', /src="usage-allowlist\.js"[\s\S]*src="cubby-track\.js"/.test(html));
}

async function run(browser, base, treeRoot, only, quiet) {
  const R = collector(quiet);
  const log = console.log;
  if (quiet) console.log = () => {};
  try {
    await treeCheck(base, treeRoot, R);
    for (const k of Object.keys(SECTIONS)) {
      if (only && !only.includes(k)) continue;
      try { await SECTIONS[k](browser, base, R); }
      catch (e) { R.ok(k + '.ran', 'section ' + k + ' ran to the end', false, String((e && e.message) || e).slice(0, 300)); }
    }
  } finally { console.log = log; }
  return R;
}

/* ---------------- the self-test: mutants of the tracker, each served from its own temp tree ---------------- */
const ALL_MUTANTS = [
  { id: 'no-dedupe', want: ['S1.repaint'], sections: ['S1'],
    edits: [['if (!screen || screen === lastScreen) return;', 'if (!screen) return;']] },
  { id: 'amount-leak', want: ['S2.no-amount', 'S2.no-note'], sections: ['S2'],
    edits: [
      ['if (Object.keys(props).length !== want.length) return null;', ''],
      ['var p = clean(name, props);', 'var p = clean(name, props) ? props : null;'],
      ["track('feature.used', { feature: f, action: action });", "var _l = (typeof state !== 'undefined' && state.events && state.events[state.events.length - 1]) || {}; track('feature.used', { feature: f, action: action, amount: _l.amount, note: _l.notes });"],
    ] },
  { id: 'loss-ignored', want: ['S3.silent', 'S3.nothing-kept'], sections: ['S3'],
    edits: [['if (lossHeld() || deleting()) return true;', 'if (deleting()) return true;'], ['if (lossHeld() || deleting()) { save([]); return; }', 'if (deleting()) { save([]); return; }']] },
  { id: 'notice-ignored', want: ['S4.unseen-holds', 'S4.stale-holds'], sections: ['S4'],
    edits: [["if (forUid && (!link || (m.mode === 'on' && !noticeSeen()))) return;", '']] },
  { id: 'notice-token', want: ['S4.unseen-no-token', 'S4.stale-no-token'], sections: ['S4'],
    edits: [['var link = !forUid || linkOk();', 'var link = true;']] },
  { id: 'cross-user', want: ['S5.a-not-under-b', 'S5.a-dropped'], sections: ['S5'],
    edits: [['return x.uid ? x.uid === next :', 'return x.uid ? true :'], ['q.filter(function (x) { return x.uid === forUid; })', 'q.filter(function (x) { return true; })']] },
  { id: 'visit-kept', want: ['S5.visit-b'], sections: ['S5'],
    edits: [["if (renew) { ls.set(DKEY, 'd_' + rand(12)); visit = null; lastScreen = ''; }", "if (renew) { ls.set(DKEY, 'd_' + rand(12)); }"]] },
  { id: 'off-drops-current', want: ['S5.off-for-a'], sections: ['S5'],
    edits: [['dropOff(forUid, now);', 'dropOff(curUid, now);']] },   // the calls, not the definition
  { id: 'token-race', want: ['S5.race'], sections: ['S5'],
    edits: [["if (forUid !== curUid) return '';", ''], ["function tokenFor(uid) { return uid && tokenUid === uid ? token : ''; }", 'function tokenFor(uid) { return token; }']] },
  { id: 'final-no-token', want: ['S6.final', 'S6.token'], sections: ['S6'],
    edits: [["var tok = forUid && link ? tokenFor(forUid) : '';", "var tok = forUid && link && !final ? tokenFor(forUid) : '';"]] },
  { id: 'cap-removed', want: ['S7.cap'], sections: ['S7'],
    edits: [['if (q.length > MAX_Q) q = q.slice(q.length - MAX_Q);', '']] },
  { id: 'no-mode-ask', want: ['S1.probe', 'S9.empty'], sections: ['S1', 'S9'],
    edits: [['var m = modeFor(who, !!tok);', "var m = modeFor(who, !!tok) || { mode: 'internal' };"]] },
  { id: 'deletion-ignored', want: ['S8.silent', 'S8.cleared'], sections: ['S8'],
    edits: [['if (lossHeld() || deleting()) return true;', 'if (lossHeld()) return true;'], ['if (lossHeld() || deleting()) { save([]); return; }', 'if (lossHeld()) { save([]); return; }']] },
  { id: 'no-paint-wait', want: ['S16.paint-wait'], sections: ['S16'],
    edits: [['if (!authSeen || !painted || !familySeen()) return;', 'if (!authSeen || !familySeen()) return;']] },
  { id: 'idle-ends-now', want: ['S16.idle'], sections: ['S16'],
    edits: [["var until = reason === 'idle' ? lastInput : Date.now();", 'var until = Date.now();']] },
  { id: 'idle-no-reset', want: ['S16.no-false-idle'], sections: ['S16'],
    edits: [["visitAt = Date.now(); lastInput = visitAt; lastScreen = '';", "visitAt = Date.now(); lastScreen = '';"]] },
  { id: 'anon-all', want: ['S17.anon-only'], sections: ['S17'],
    edits: [["var go = m.mode === 'on' ? mine.filter(function (x) { return anonOk(x.ev); }) : []", "var go = m.mode === 'on' ? mine : []"]] },
  { id: 'anon-outside-on', want: ['S17.on-only'], sections: ['S17'],
    edits: [["var go = m.mode === 'on' ? mine.filter(function (x) { return anonOk(x.ev); }) : []", 'var go = mine.filter(function (x) { return anonOk(x.ev); })']] },
  { id: 'anon-kept', want: ['S17.dropped', 'S17.on-only-dropped'], sections: ['S17'],
    edits: [['if (go.length < mine.length) dropWhere(function (x) { return aged(x, now) && !keep[x.ev.id]; });', '']] },
  { id: 'anon-off-drops-all', want: ['S17.off-keeps', 'S17.claimed'], sections: ['S17'],
    edits: [['return forUid ? x.uid === forUid : aged(x, now);', 'return forUid ? x.uid === forUid : !x.uid;']] },
  { id: 'retry-400', want: ['S18.dropped'], sections: ['S18'],
    edits: [['if (r && (r.ok || r.status === 400 || r.status === 413)) {', 'if (r && r.ok) {']] },
  /* PRIV-4: her family record as the server holds it, the tracker's half and the sign-in layer's. */
  { id: 'family-ignored', want: ['S19.held', 'S20.held'], sections: ['S19', 'S20'],
    edits: [['if (!authSeen || !painted || !familySeen()) return;', 'if (!authSeen || !painted) return;']] },
  { id: 'family-anyone', want: ['S19.other-held'], sections: ['S19'],
    edits: [["return s === '*' || (!!s && s === curUid);", "return s === '*' || !!s;"]] },
  { id: 'seen-local-not-said', file: 'app/store-firebase.js', want: ['S19.reported'], sections: ['S19'],
    edits: [["    householdSeen('*');   // the usage tracker (PRIV-4): a local-only page has no family record to wait for\n", '']] },
  { id: 'seen-from-cache', file: 'app/store-firebase.js', want: ['S20.held'], sections: ['S20'],
    edits: [['snap.metadata.fromCache || snap.metadata.hasPendingWrites) return;', 'snap.metadata.hasPendingWrites) return;']] },
  { id: 'seen-while-pending', file: 'app/store-firebase.js', want: ['S20.silent'], sections: ['S20'],
    edits: [['snap.metadata.fromCache || snap.metadata.hasPendingWrites) return;', 'snap.metadata.fromCache) return;']] },
  { id: 'seen-no-metadata', file: 'app/store-firebase.js', want: ['S20.flows'], sections: ['S20'],
    edits: [['offServerSeen = hhRef.onSnapshot({ includeMetadataChanges: true }, function (snap) {', 'offServerSeen = hhRef.onSnapshot(function (snap) {']] },
  /* AR-1: when the deletion flag goes up, and when it comes down. */
  { id: 'deleting-at-door', file: 'app/store-firebase.js', want: ['S8.door'], sections: ['S8'],
    edits: [['window.LL.deleteAccount = async function () {\n    var u = auth.currentUser;', 'window.LL.deleteAccount = async function () {\n    window.__cubbyDeleting = true;\n    var u = auth.currentUser;']] },
  { id: 'deleting-kept-early', file: 'app/store-firebase.js', want: ['S21.early-flows'], sections: ['S21'],
    edits: [['if (!usagePurgeAsked) window.__cubbyDeleting = false;', '']] },
  { id: 'deleting-cleared-late', file: 'app/store-firebase.js', want: ['S21.late-silent'], sections: ['S21'],
    edits: [['if (!usagePurgeAsked) window.__cubbyDeleting = false;', 'window.__cubbyDeleting = false;']] },
  { id: 'deleting-kept-signed-out', file: 'app/store-firebase.js', want: ['S21.again-flows'], sections: ['S21'],
    edits: [['if (!deletingAccount) window.__cubbyDeleting = false;', '']] },
  /* The hooks in the app, not the tracker: each removed, its checks must notice. */
  { id: 'entry-hooks-gone', file: 'app/index.html', want: ['S2.logged', 'S14.timers'], sections: ['S2', 'S14'],
    edits: [[/^.*window\.cubbyTrackEntry\(.*\n/gm, '']] },
  { id: 'screen-hook-gone', file: 'app/index.html', want: ['S1.tab'], sections: ['S1'],
    edits: [['if(window.cubbyTrackScreen) window.cubbyTrackScreen(window.__cubbyScreen);', '']] },
  { id: 'sw-marker-gone', file: 'app/sw.js', want: ['S15.marker', 'S15.message'], sections: ['S15'],
    edits: [[/\{ try \{ c\.postMessage\(\{ cubbyNotification: nk \}\); \} catch \(err\) \{\} return c\.focus\(\); \}/, 'return c.focus();'],
      [/\{ const u = new URL\(target, self\.location\.origin\);.*?return self\.clients\.openWindow\(u\.href\); \}/, 'return self.clients.openWindow(target);']] },
  { id: 'sw-marker-in-query', file: 'app/sw.js', want: ['S15.instant'], sections: ['S15'],
    edits: [["u.hash = (u.hash.length > 1 ? u.hash.slice(1) + '&' : '') + 'from=notification&nk=' + nk;", "u.searchParams.set('from', 'notification'); u.searchParams.set('nk', nk);"]] },
  { id: 'web-ask-always', file: 'app/index.html', want: ['S12.decided'], sections: ['S12'],
    edits: [["_utAsk=Notification.permission==='default';", '_utAsk=true;']] },
  { id: 'native-hooks-gone', file: 'app/native-bridge.js', want: ['S13.listening', 'S13.permission'], sections: ['S13'],
    edits: [[/^.*(appStateChange|cubbyTrackPushOpened|push\.permission).*\n/gm, '']] },
  { id: 'native-ask-always', file: 'app/native-bridge.js', want: ['S13.decided'], sections: ['S13'],
    edits: [["var a = !!(p && /^prompt/.test(p.receive || ''));", 'var a = true;']] },
  { id: 'link-hook-gone', file: 'app/native-bridge.js', want: ['S13.link'], sections: ['S13'],
    edits: [[/^.*cubbyTrackLinkOpened.*\n/gm, '']] },
];

/* Free on every interface: serve.js listens on all of them, and on macOS a 127.0.0.1 bind can succeed beside
   a server already listening on [::] at the same port. */
function portFreeOn(p, host) {
  return new Promise((res) => { const s = net.createServer(); s.once('error', () => res(false)); s.listen(host ? { port: p, host } : { port: p }, () => s.close(() => res(true))); });
}
async function portFree(p) { return (await portFreeOn(p)) && (await portFreeOn(p, '127.0.0.1')); }
/* Inside EMU_PORT_RANGE when one is set (gates.js takes the tree port from the TOP of it, so this searches
   up from the bottom); otherwise any free port. */
async function pickPort() {
  const band = /^(\d+)-(\d+)$/.exec(process.env.EMU_PORT_RANGE || '');
  if (band) { for (let p = Number(band[1]); p <= Number(band[2]); p++) if (await portFree(p)) return p; throw new Error('no free port in EMU_PORT_RANGE ' + band[0]); }
  return new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}
/* n distinct free ports, the same way (the emulator's two, before it binds either). */
async function pickPorts(n) {
  const out = [];
  const band = /^(\d+)-(\d+)$/.exec(process.env.EMU_PORT_RANGE || '');
  if (band) {
    for (let p = Number(band[1]); p <= Number(band[2]) && out.length < n; p++) if (await portFree(p)) out.push(p);
    if (out.length < n) throw new Error('EMU_PORT_RANGE ' + band[0] + ' has no ' + n + ' free ports');
    return out;
  }
  while (out.length < n) { const p = await pickPort(); if (!out.includes(p)) out.push(p); }
  return out;
}
/* A temp copy of the tree: every top-level entry and every app/ file is a symlink to the real one, except
   the mutated file (a real file) and tools/serve.js (a real copy, so it serves THIS folder). */
const MADE = [];
function tempTree(file, content) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-usage-tracker-'));
  MADE.push(tmp);
  for (const n of fs.readdirSync(ROOT)) { if (n === 'app' || n === 'tools' || n === '.git') continue; fs.symlinkSync(path.join(ROOT, n), path.join(tmp, n)); }
  fs.mkdirSync(path.join(tmp, 'app')); fs.mkdirSync(path.join(tmp, 'tools'));
  for (const n of fs.readdirSync(path.join(ROOT, 'app'))) { if ('app/' + n !== file) fs.symlinkSync(path.join(ROOT, 'app', n), path.join(tmp, 'app', n)); }
  fs.writeFileSync(path.join(tmp, file), content);
  fs.copyFileSync(path.join(ROOT, 'tools', 'serve.js'), path.join(tmp, 'tools', 'serve.js'));
  return tmp;
}
/* This run's own temp tree, and only that: fs.rmSync never follows a symlink, so the links go and the real
   files they point at stay. Anything that is not one of this run's mkdtemp folders is refused. */
function rmTree(tmp) {
  if (!MADE.includes(tmp) || path.dirname(tmp) !== path.resolve(os.tmpdir()) || !/^cubby-usage-tracker-/.test(path.basename(tmp))) return;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
}
/* Its own serve.js, and proof that the server answering is that one: it must say it is serving THIS temp
   folder, and must still be running, or another tree's server on the same port would be graded instead. */
async function serveTree(tmp, port) {
  const child = spawn(process.execPath, [path.join(tmp, 'tools', 'serve.js')], { cwd: tmp, env: Object.assign({}, process.env, { PORT: String(port) }), stdio: ['ignore', 'pipe', 'pipe'] });
  let said = '', exited = false;
  child.stdout.on('data', (d) => { said += d; });
  child.stderr.on('data', (d) => { said += d; });
  child.on('exit', () => { exited = true; });
  const base = 'http://127.0.0.1:' + port;
  const stop = Date.now() + 15000;
  for (;;) {
    if (exited) throw new Error('the temp tree server on ' + port + ' exited: ' + said.slice(0, 200));
    if (said.indexOf('serving ' + tmp + ' ') >= 0 || said.indexOf('serving ' + fs.realpathSync(tmp) + ' ') >= 0) {
      try { const r = await fetch(base + '/app/cubby-track.js'); if (r.ok) break; } catch (e) {}
    }
    if (Date.now() > stop) { child.kill(); throw new Error('the temp tree server never came up on ' + port); }
    await sleep(150);
  }
  // Resolves once the server has gone, so the next mutant can have the same port.
  return { base, stop: () => new Promise((res) => { if (exited) return res(); child.once('exit', () => res()); try { child.kill(); } catch (e) { res(); } }) };
}

async function selfTest(browser) {
  console.log('\nself-test: mutants of the tracker and its hooks, each served from its own temp copy of the tree');
  const MUTANTS = PICK.length ? ALL_MUTANTS.filter((m) => PICK.includes(m.id)) : ALL_MUTANTS;
  if (PICK.length) console.log('  (only ' + MUTANTS.map((m) => m.id).join(', ') + ': a partial self-test, so it cannot pass)');
  const TRACKER = 'app/cubby-track.js';
  const src = fs.readFileSync(path.join(ROOT, TRACKER), 'utf8');
  let caught = 0, bad = 0;
  // Control: an unmutated temp copy passes, so a mutant that fails is failing on its mutation.
  {
    const tmp = tempTree(TRACKER, src), port = await pickPort();
    const srv = await serveTree(tmp, port);
    try {
      const sections = [...new Set(MUTANTS.flatMap((m) => m.sections))];
      const R = await run(browser, srv.base, tmp, sections, true);
      const okc = R.fail === 0;
      console.log('  ' + (okc ? 'ok  ' : 'FAIL') + ' control: the unmutated temp copy passes ' + R.pass + ' checks' + (okc ? '' : ', failing ' + R.failed.join(', ')));
      if (!okc) bad++;
    } finally { await srv.stop(); rmTree(tmp); }
  }
  for (const m of MUTANTS) {
    const file = m.file || TRACKER;
    const orig = fs.readFileSync(path.join(ROOT, file), 'utf8');
    let mut = orig, applied = true;
    for (const [from, to] of m.edits) {
      const next = typeof from === 'string' ? mut.split(from).join(to) : mut.replace(from, to);
      if (next === mut) { applied = false; break; }
      mut = next;
    }
    if (!applied) { bad++; console.log('  FAIL ' + m.id + ': its edit no longer applies to ' + file + ', so this mutant proves nothing (update MUTANTS)'); continue; }
    const tmp = tempTree(file, mut), port = await pickPort();
    const srv = await serveTree(tmp, port);
    try {
      const served = await (await fetch(srv.base + '/' + file)).text();
      if (served !== mut || served === orig) { bad++; console.log('  FAIL ' + m.id + ': the temp server is not serving the mutant ' + file); continue; }
      const R = await run(browser, srv.base, tmp, m.sections, true);
      const hit = m.want.filter((id) => R.failed.includes(id));
      if (hit.length) { caught++; console.log('  ok   ' + m.id + ' caught by ' + hit.join(', ')); }
      else { bad++; console.log('  FAIL ' + m.id + ' was NOT caught (expected ' + m.want.join(' or ') + '; failed: ' + (R.failed.join(', ') || 'nothing') + ')'); }
    } finally { await srv.stop(); rmTree(tmp); }
  }
  console.log('\nself-test: ' + caught + ' of ' + MUTANTS.length + ' mutants caught');
  const left = MADE.filter((t) => fs.existsSync(t));
  console.log('  ' + (left.length ? 'FAIL' : 'ok  ') + ' temp trees: ' + MADE.length + ' made, ' + (MADE.length - left.length) + ' removed' + (left.length ? ' (left: ' + left.join(', ') + ')' : ''));
  return !PICK.length && bad === 0 && caught === MUTANTS.length && left.length === 0;
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'], downloadBehavior: dl.downloadBehavior() });
  let okAll = false;
  try {
    console.log('usage-tracker: ' + BASE);
    // S20 and S21 need the Firestore emulator; one serves this run and the self-test's.
    if (SELF || (ONLY.length ? ONLY : Object.keys(SECTIONS)).some((k) => k === 'S20' || k === 'S21')) await startEmulator();
    const R = await run(browser, BASE, ROOT, ONLY.length ? ONLY : null, false);
    console.log('\n' + R.pass + ' passed, ' + R.fail + ' failed');
    okAll = R.fail === 0;
    console.log('USAGE-TRACKER: ' + (okAll ? 'PASS' : 'FAIL'));
    if (SELF) {
      const st = await selfTest(browser);
      console.log('USAGE-TRACKER SELF-TEST: ' + (st ? 'PASS' : 'FAIL'));
      okAll = okAll && st;
    }
  } catch (e) {
    console.log('FAIL usage-tracker crashed: ' + ((e && e.stack) || e));
    okAll = false;
  } finally {
    await browser.close().catch(() => {});
    await stopEmulator();
  }
  process.exit(okAll ? 0 : 1);
})();
