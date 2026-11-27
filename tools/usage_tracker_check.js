#!/usr/bin/env node
/* usage-tracker: Cubby's own usage events, measured in the seeded app the way a parent uses it.
 *
 *   node tools/usage_tracker_check.js <base-url>               the tree tier (S0-S19, S8b), against the tree that url serves
 *   node tools/usage_tracker_check.js <base-url> --self-test   and then against mutants of app/cubby-track.js
 *   node tools/usage_tracker_check.js <base-url> --emulator [--self-test]   the emulator tier (S0, S20-S24) instead
 *
 * Two tiers, two gates (tools/gates.js). `usage-tracker` is the tree tier: it needs Chrome and nothing else, so
 * every push runs it without java or an emulator. `usage-tracker-emu` is the emulator tier: S20-S24 run the app's
 * real sync layer on a Firestore emulator this file starts itself (see startEmulator), so they need java and the
 * emulator jar, and run wherever the other emulator suites run (`node tools/gates.js --emulator`, CI's emulator
 * job). Each tier's --self-test runs only the mutants its own sections can catch. --only=S20 picks sections by
 * hand, and starts the emulator whenever it picks S20-S24.
 *
 * Spec: docs/superpowers/specs/2026-11-13-admin-dashboard-design.md §8.1 and S24, gate row `usage-tracker`.
 * The tracker (app/cubby-track.js) is the only code that decides what leaves a phone, so this drives the
 * REAL tracker inside the REAL app (?e2e=1, localhost only) and reads what it would have sent from its test
 * sink, window.__cubbyTrackTest, installed before boot with evaluateOnNewDocument. Nothing here talks to
 * any host but this one: every other request is aborted, and the app's Firebase sign-in is replaced, for the
 * tracker only, by a fake signed-in person whose tokens are labelled with whose they are. S20-S24 also
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
 *       app's sign-in layer) never silences the tracker (AR-1). S8b what the app says when a deletion stops, read
 *       off doDeleteAccount for every stage the sign-in layer stamps (the index.html half of DELETE-TRUTH, here so
 *       a push that touches only index.html still meets it), and that a deletion that finishes ends on the goodbye,
 *       on top of the sign-in screen Firebase's sign-out brings up, with the focus. S9  mode off: only one empty ask a day. S10 off
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
 *       asked to go) the tracker carries on, and the app's own Delete says it could not finish, never "Nothing was
 *       deleted" (her private records went first, F2); signing out then forgets whose family record was seen
 *       (window.__cubbyHouseholdSeen is '' before the next sign-in, NEW-2). Stopped at the login (after them) with the
 *       sign-out that follows refused, she is still the account she asked to delete, and nothing more is sent or kept
 *       until she signs out herself; signed in again on the same page she is tracked again.
 *   S22 DELETE-TRUTH through the real deleteAccount and the app's own doDeleteAccount message: a sign-in too old for
 *       Firebase to delete the login is asked for again BEFORE anything is deleted or left, so a Google sheet she
 *       closes, or an email-code session, leaves her place in the family, her private health page, her email, her
 *       note to herself and her user record untouched, asks for no usage purge, and the app says so. Companion:
 *       when she does sign in again the deletion runs to the end and the same probes see each of them go. When
 *       Firebase still asks at the very end (past the point of no return) the app never says "Nothing was deleted":
 *       she is signed out, and the sign-in screen says what is left. And in the iPhone app (a stand-in Capacitor with
 *       the sign-in plugin) the door asks with the app's own Apple sheet; backing out of it deletes nothing, and
 *       signing in on it lets the deletion run to the end. Wherever S22-S24 see a deletion finish, the stand-in signs
 *       her out as Firebase does, and the element at the centre of the screen must be the goodbye (SAR-1).
 *   S23 SA1 and SA3, under this tree's own firestore.rules (put in force on the emulator; the page's Firestore calls
 *       carry her identity): a deletion that stopped at the login signs her out, so no copy of the family she left is
 *       left open (a log made after it reaches no family and is never refused), and the sign-in screen says "Sign in
 *       again, then delete it to finish". Nothing of that family stays in this phone's memory, so her next Cubby holds
 *       none of it: not its baby, not the two entries she logged there, not its name (in memory, on the server, and in
 *       Family & sharing, which showed it while she was in that family) or its Pro taste counts (her units do come with
 *       her). She signs in again, lands in a new Cubby of her own, and deleting finishes (that Cubby flagged,
 *       her user record gone, the purge asked again), with the goodbye on top and no "account is still here" left
 *       under it. A sheet she closes at a later door is still not "Nothing was
 *       deleted", and nothing is sent under her account from the deletion's start until she signs in again, or after
 *       it finishes. S23b the same stop with the sheet closed at once, inside the household listener's 1.5 s
 *       re-check: the sign-in screen stays, with no "no longer in this family" note and no user record written back.
 *   S24 SA2, under this tree's firestore.rules: her leave reaches the server but its answer is lost (503), so
 *       Firestore's rerun of the transaction is refused; the same deletion sees the family no longer lets her in and
 *       finishes, where it used to stop at "Could not finish deleting" on every try.
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
 * the deletion flag raised at the door, kept after an early failure, cleared after a late one, kept after sign-out,
 * or cleared by the sign-out a finished deletion ends with, the family record not forgotten at sign-out, the recent
 * sign-in asked for only at the end, and the old message that called every cancelled sign-in "Nothing was deleted",
 * a stop part-way said as "nothing", the web window's close not read as a cancel, an unstamped stop called
 * "nothing"; and SA1-SA3's: a stop at the login that keeps her signed in, the family she left kept in memory, the
 * household listener's re-check let loose on the sign-in screen, the message left as a toast under that screen, a
 * later stop forgetting how far an earlier one got, a leave refused because she is already out stopping the
 * deletion, and the iPhone app's door asking with a web popup; and SAR-1, SAR-3 and SAR-4's: the goodbye back under
 * the sign-in screen, the family's settings kept whole after a stop, its entries kept in memory, and the stop's note
 * kept after she signs in again.
 * An unmutated temp copy must pass first, so a caught mutant is the mutation and not the harness.
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
/* The emulator tier: the sections that run the real sync layer on a Firestore emulator. The tree tier never
   starts one, so it needs neither java nor the emulator jar. */
const EMU_TIER = ARGS.includes('--emulator');
const EMU_SECTIONS = ['S20', 'S21', 'S22', 'S23', 'S23b', 'S24'];
const inTier = (k) => (EMU_TIER ? EMU_SECTIONS.includes(k) : !EMU_SECTIONS.includes(k));
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
  if (cfg.holdFailsafe) {
    // The sign-in layer's boot failsafe (startSync, 3.5 s after a family is attached), held here so a test runs
    // it at the moment it chooses: after a sign-out that came sooner than 3.5 s (S21 part c).
    const st = window.setTimeout; window.__utFailsafe = [];
    window.setTimeout = function (f, ms, ...a) { if (ms === 3500 && typeof f === 'function' && /maybeBoot\(true\)/.test(String(f))) { window.__utFailsafe.push(f); return 0; } return st.call(window, f, ms, ...a); };
  }
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
  /* Her sign-in, for account deletion (S21-S24): how long ago she signed in by the server's clock
     (cfg.signedInAgo ms, a minute by default), whether Firebase refuses to delete the login anyway
     (cfg.staleLogin: requires-recent-login, as when the steps outran the window), the door she came in by
     (cfg.provider, e.g. 'google.com' or 'apple.com'; none is an email-code sign-in, which cannot be asked again),
     and what she does with each sign-in sheet she is shown (cfg.reauth, in order: 'cancel', 'cancel-late',
     'closed' or 'ok'). On the web the sheet is Firebase's popup; with cfg.native it is the iPhone app's own
     Apple or Google sheet (the Capacitor sign-in plugin, below), whose credential Firebase then takes.
     Signing out signs her out (the app's own listeners hear it), unless cfg.signOutFails: the first sign-out
     is refused and she stays signed in. */
  const U = window.__utAuth = { delay: {}, hang: false, delivered: [], n: 0,
    ago: cfg.signedInAgo === undefined ? 60000 : cfg.signedInAgo, stale: !!cfg.staleLogin, reauths: 0, deletes: 0,
    popups: 0, nativeSheets: 0, credentials: 0, signOuts: 0 };
  const sheet = () => (cfg.reauth || [])[U.reauths++] || 'cancel';
  U.sheet = sheet;
  const mk = (uid) => ({
    uid, providerData: cfg.provider ? [{ providerId: cfg.provider, uid }] : [],
    /* Deleting the login signs her out, as Firebase's user.delete() does (it ends in auth.signOut(), whose
       listeners hear it before the call resolves): the app's own sign-in screen is up before the goodbye is
       drawn. Until Nov 2026 this resolved with her still signed in, and the goodbye was certified over a
       screen no real phone has; on the real SDK it lay under the sign-in screen (SAR-1). */
    delete() {
      U.deletes++;
      if (U.stale) return Promise.reject(Object.assign(new Error('requires recent login'), { code: 'auth/requires-recent-login' }));
      U.switchTo(null);
      return Promise.resolve();
    },
    getIdTokenResult() {
      const now = Date.now();
      return Promise.resolve({ token: 'tok-' + uid, claims: {}, signInProvider: cfg.provider || 'custom',
        authTime: new Date(now - U.ago).toUTCString(), issuedAtTime: new Date(now).toUTCString() });
    },
    reauthenticateWithPopup() {
      U.popups++;
      const how = sheet();
      if (how === 'ok') { U.ago = 0; U.stale = false; return Promise.resolve({}); }
      const no = how === 'closed'
        ? Object.assign(new Error('The popup has been closed by the user before finalizing the operation.'), { code: 'auth/popup-closed-by-user' })
        : Object.assign(new Error('The user did not grant your application the permissions it requested.'), { code: 'auth/user-cancelled' });
      // 'cancel-late': she looks at the sheet for three seconds before closing it.
      return how === 'cancel-late' ? new Promise((res, rej) => setTimeout(() => rej(no), 3000)) : Promise.reject(no);
    },
    // The iPhone app: she has already said yes on its own sheet (cfg.native), and Firebase takes that credential.
    reauthenticateWithCredential(cred) {
      U.credentials++; U.lastCredential = cred && cred.providerId;
      U.ago = 0; U.stale = false; return Promise.resolve({});
    },
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
    isSignInWithEmailLink: () => false, getRedirectResult: () => Promise.resolve({}), setPersistence: () => Promise.resolve(),
    signOut() {
      U.signOuts++;
      if (cfg.signOutFails && U.signOuts === 1) return Promise.reject(Object.assign(new Error('An internal error has occurred.'), { code: 'auth/internal-error' }));
      U.switchTo(null); return Promise.resolve();
    },
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
  /* cfg.realRules (S23, S23b, S24): the page's Firestore calls carry her identity, an emulator mock token for cfg.user, so
     the emulator judges them by the rules S23 puts in force (this tree's firestore.rules) instead of letting anyone
     do anything. firebase-init.js points Firestore at the emulator itself, before anything else touches it; this
     adds her token to that one call. It is engaged when window.__utFsAs names her. And when the household listener
     loses her (its permission-denied warning), the real time is kept in window.__utLost (S23b times its re-check). */
  if (cfg.realRules) {
    window.__utLost = [];
    const warn = console.warn;
    console.warn = function (...a) {
      try { if (a[0] === 'household listen' && a[1] && a[1].code === 'permission-denied') window.__utLost.push(R.now()); } catch (e) {}
      return warn.apply(this, a);
    };
    const who = { sub: cfg.user, user_id: cfg.user, email: cfg.user + '@emu.test', email_verified: true,
      firebase: { sign_in_provider: cfg.provider || 'custom', identities: {} } };
    let fb;
    Object.defineProperty(window, 'firebase', { configurable: true, enumerable: true, get: () => fb, set(v) {
      fb = v;
      const init = v && v.initializeApp;
      if (typeof init !== 'function') return;
      v.initializeApp = function (...a) {
        const app = init.apply(this, a);
        try {
          const fsdb = v.firestore(), use = fsdb.useEmulator;
          fsdb.useEmulator = function (host, port, o) { const r = use.call(this, host, port, Object.assign({ mockUserToken: who }, o || {})); window.__utFsAs = who.sub; return r; };
        } catch (e) { window.__utFsAs = 'not engaged: ' + e; }
        return app;
      };
    } });
  }
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
        /* The app's own Apple and Google sheets (@capacitor-firebase/authentication, skipNativeAuth): 'ok' hands
           back a credential, a cancel is what Apple's sheet says when she backs out of it. */
        FirebaseAuthentication: {
          signInWithApple: () => native('apple'), signInWithGoogle: () => native('google'),
        },
      },
    };
    function native(kind) {
      U.nativeSheets++;
      if (sheet() === 'ok') return Promise.resolve({ credential: { idToken: 'zz-native-' + kind + '-id-token', nonce: 'zz-nonce', accessToken: null } });
      return Promise.reject(new Error(kind === 'apple' ? 'The operation couldn’t be completed. (com.apple.AuthenticationServices.AuthorizationError error 1001.)' : 'Sign in canceled.'));
    }
  }
}

/* CI-like slowness, for reproducing a flake here (never set by tools/gates.js): UT_CPU_THROTTLE=4 slows every page's
   CPU four times (CDP; S21.again-flows went red about 1 run in 3 that way before S21 part c's fix), UT_EMU_DELAY_MS=1500
   holds every request to the Firestore emulator that long, UT_EMU_JITTER_MS=800 adds up to that much more at random. */
const STRESS = { cpu: Number(process.env.UT_CPU_THROTTLE) || 0, emuMs: Number(process.env.UT_EMU_DELAY_MS) || 0, jitter: Number(process.env.UT_EMU_JITTER_MS) || 0 };
const emuWait = () => STRESS.emuMs + (STRESS.jitter ? Math.floor(Math.random() * STRESS.jitter) : 0);
/* cfg.search replaces ?e2e=1 (the cloud path, ?fsemu=, in S20-S24); ctxIn opens the page in a context
   that already exists (the same phone, opened again). ctl.refuse(url, method) answers a request as Firestore
   does when its rules refuse it, ctl.delay(url, method) holds one back that many ms, ctl.hook(request) takes a
   request over entirely when it returns true (S24), and local lists every request this page made to this
   machine. */
async function openApp(browser, base, cfg, ctxIn) {
  const ctx = ctxIn || await browser.createBrowserContext({ downloadBehavior: dl.downloadBehavior() });
  const page = await ctx.newPage();
  if (STRESS.cpu > 1) await page.emulateCPUThrottling(STRESS.cpu);
  const errs = [], usageReqs = [], foreign = [], local = [], ctl = { refuse: null, delay: null, hook: null };
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
      if (ctl.hook && ctl.hook(r)) return;
      if (ctl.refuse && r.method() !== 'OPTIONS' && ctl.refuse(u, r.method())) {
        return r.respond({ status: 403, contentType: 'application/json',
          headers: { 'access-control-allow-origin': r.headers().origin || '*', 'access-control-allow-credentials': 'true' },
          body: JSON.stringify({ error: { code: 403, message: 'Missing or insufficient permissions.', status: 'PERMISSION_DENIED' } }) });
      }
      const wait = (ctl.delay ? ctl.delay(u, r.method()) : 0)
        || ((STRESS.emuMs || STRESS.jitter) && EMU.port && new URL(u).port === String(EMU.port) && r.method() !== 'OPTIONS' ? emuWait() : 0);
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

/* What the app says when a deletion stops (index.html doDeleteAccount), for every stage store-firebase.js stamps on
   what it throws, read off the page. The tree tier, so every push runs it: the stamping itself is the emulator
   tier's (S21, S22, S23), which a push touching store-firebase.js runs, and this half lives in index.html, which
   does not trigger that tier (F4). LL.deleteAccount is stood in for, for this one call each time. */
SECTIONS.S8b = async (b, base, R) => {
  console.log('\nS8b. account deletion: what the app says when it stops, for each stage the sign-in layer reports');
  const { ctx, page } = await openApp(b, base, {});
  try {
    const say = (stage, code, message) => page.evaluate(async (stage, code, message) => {
      const real = window.LL.deleteAccount;
      window.LL.deleteAccount = () => Promise.reject(Object.assign(new Error(message), code ? { code } : {}, stage ? { cubbyDeletion: stage } : {}));
      try { await doDeleteAccount(); } finally { window.LL.deleteAccount = real; }
      const t = document.getElementById('toast');
      return t ? t.textContent : '';
    }, stage, code, message);
    const CANCEL = ['auth/user-cancelled', 'The user did not grant your application the permissions it requested.'];
    const CLOSED = ['auth/popup-closed-by-user', 'The popup has been closed by the user before finalizing the operation.'];
    const APPLE = ['', 'The operation couldn’t be completed. (com.apple.AuthenticationServices.AuthorizationError error 1001.)'];
    const CODE = ['', 'reauth_unsupported'];
    const AGAIN = 'Could not finish deleting. Please try again';
    const LEFT = 'Your private records are deleted, but your account is still here. ';
    const CASES = [
      ['nothing-cancel', 'nothing', CANCEL, 'Nothing was deleted', 'stopped before anything, at a sign-in sheet she cancelled'],
      ['nothing-closed', 'nothing', CLOSED, 'Nothing was deleted', 'stopped before anything, the web sign-in window closed'],
      ['nothing-apple', 'nothing', APPLE, 'Nothing was deleted', 'stopped before anything, the Apple sheet backed out of'],
      ['nothing-code', 'nothing', CODE, 'Please log out, sign in again, then delete', 'stopped before anything, an email-code session too old to ask again'],
      ['nothing-other', 'nothing', ['unavailable', 'Failed to get document because the client is offline.'], 'Nothing was deleted. Please try again', 'stopped before anything, offline'],
      ['partly-refused', 'partly', ['permission-denied', 'Missing or insufficient permissions.'], AGAIN, 'stopped part-way (the leave refused, private records already gone)'],
      ['partly-cancel', 'partly', CANCEL, AGAIN, 'a cancelled sign-in after an earlier attempt stopped part-way: not "Nothing was deleted"'],
      ['login-cancel', 'login', CANCEL, LEFT + 'Delete it once more to finish', 'stopped at the login, the sheet cancelled'],
      ['login-code', 'login', CODE, LEFT + 'Log out, sign in again, then delete it', 'stopped at the login, an email-code session'],
      ['login-other', 'login', ['auth/network-request-failed', 'A network error has occurred.'], LEFT + 'Please try again', 'stopped at the login, offline'],
      ['unstamped', '', CANCEL, AGAIN, 'a stop that does not say how far it got is never called "Nothing was deleted"'],
    ];
    for (const [id, stage, [code, message], want, what] of CASES) {
      const got = await say(stage, code, message);
      R.ok('S8b.' + id, what + ': "' + want + '"', got === want, { stage, code, got });
    }
    /* A deletion that finishes. Firebase signs her out as the login goes, so the sign-in screen is up before the
       goodbye is drawn: the stand-in draws it the way the sign-in layer does when nobody is signed in (signInNote('')
       calls the same showSignIn that onAuthStateChanged(null) does; this tier's page has no Firebase user). The
       goodbye must be what she sees: the element at the centre of the screen is inside it, and it has the focus. At
       z-index 4000, as it was from July to November 2026, the centre was the sign-in screen (SAR-1). */
    const bye = await page.evaluate(async () => {
      const real = window.LL.deleteAccount;
      window.LL.deleteAccount = () => { window.__utAuth.switchTo(null); window.LL.signInNote(''); return Promise.resolve(true); };
      try { await doDeleteAccount(); } finally { window.LL.deleteAccount = real; }
      const at = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      return { goodbye: !!document.getElementById('cb-del-goodbye'), signIn: !!document.getElementById('llAuthOv'),
        top: !at ? 'none' : at.closest('#cb-del-goodbye') ? 'goodbye' : at.closest('#llAuthOv') ? 'signin' : (at.id || at.tagName.toLowerCase()),
        focus: (document.activeElement && document.activeElement.id) || '' };
    });
    R.ok('S8b.goodbye', 'companion: a deletion that finishes says goodbye instead, and that is what she sees: the sign-in screen Firebase\'s sign-out brings up is under it, the centre of the screen is the goodbye, and its Close has the focus',
      bye.goodbye && bye.signIn && bye.top === 'goodbye' && bye.focus === 'cb-del-done', bye);
    /* Last, because it signs the page out: a stop at the login signs her out (store-firebase.js), and the sign-in
       screen covers the toasts, so what is left is said on that screen, and stays there. */
    const out = await page.evaluate(async () => {
      document.getElementById('cb-del-goodbye')?.remove();
      const real = window.LL.deleteAccount;
      window.LL.deleteAccount = () => { window.__utAuth.switchTo(null); return Promise.reject(Object.assign(new Error('The user did not grant your application the permissions it requested.'), { code: 'auth/user-cancelled', cubbyDeletion: 'login' })); };
      try { await doDeleteAccount(); } finally { window.LL.deleteAccount = real; }
      const ov = document.getElementById('llAuthOv');
      return { out: !window.LL.auth.currentUser, note: ov ? ([...ov.querySelectorAll('.lp-msg, .ll-auth-msg')].map((x) => x.textContent.trim()).filter(Boolean)[0] || '') : '' };
    });
    R.ok('S8b.login-signed-out', 'stopped at the login and signed out: the sign-in screen says "' + LEFT + 'Sign in again, then delete it to finish."',
      out.out && out.note === LEFT + 'Sign in again, then delete it to finish.', out);
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

/* ---------------- the real sync layer: the Firestore emulator (S20-S24, the emulator tier) ---------------- */
/* S20-S24 run the app's REAL sign-in layer (store-firebase.js: resolveHousehold, startSync, deleteAccount)
   against a Firestore emulator through the localhost-only ?fsemu= hook in firebase-init.js, so what they prove
   is what the Firestore SDK really does, not what a stand-in says it does. The emulator is the jar firebase-tools
   keeps in ~/.cache/firebase/emulators (any emulator suite run through the firebase CLI downloads it, and in a
   full `gates.js --emulator` run `rules` does so first), started here with java directly (the firebase CLI
   would also fetch its message of the day from the internet), with open rules: the fsemu hook sends no token,
   and the rules are rules-test.js's job (S23, S23b and S24 are the exception, see OPEN_RULES). Its ports are FS_PORT and WS_PORT when tools/gates.js hands them over,
   else two inside EMU_PORT_RANGE. One emulator serves the whole run, the self-test included; each section
   empties it first. Only the emulator tier starts it. */
const EMU = { port: 0, proc: null, gone: false, dir: null, project: 'little-log-a9caa' };
/* Open rules: S20-S22 test the sync layer, not the rules, and their pages carry no identity. S23, S23b and S24 put
   this tree's own firestore.rules in force for their run (emuRules) and put these back after. */
const OPEN_RULES = "rules_version = '2';\nservice cloud.firestore { match /databases/{db}/documents { match /{document=**} { allow read, write: if true; } } }\n";
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
  if (!jar || !fs.existsSync(jar)) throw new Error('no Firestore emulator jar in ~/.cache/firebase/emulators (an emulator suite run through the firebase CLI downloads it: node tools/gates.js --emulator-only --only=rules), or set FIRESTORE_EMULATOR_JAR');
  const given = [Number(process.env.FS_PORT), Number(process.env.WS_PORT)];
  const [port, ws] = given[0] && given[1] ? given : await pickPorts(2);
  EMU.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-usage-emu-'));
  const rules = path.join(EMU.dir, 'open.rules');
  fs.writeFileSync(rules, OPEN_RULES);
  const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
  let said = '', exited = false;
  EMU.proc = spawn(java, ['-jar', jar, '--host=127.0.0.1', '--port=' + port, '--websocket_port=' + ws, '--rules=' + rules], { cwd: EMU.dir, stdio: ['ignore', 'pipe', 'pipe'] });
  EMU.proc.stdout.on('data', (d) => { said += d; });
  EMU.proc.stderr.on('data', (d) => { said += d; });
  EMU.proc.on('exit', () => { exited = true; EMU.gone = true; });
  // No java on PATH (or a JAVA_HOME without one) is a spawn error: reported as this gate's failure, not a crash.
  EMU.proc.on('error', (e) => { exited = true; EMU.gone = true; said += 'could not start ' + java + ': ' + e.message; });
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
    await new Promise((res) => { if (EMU.gone || p.exitCode !== null) return res(); p.once('exit', () => res()); try { p.kill('SIGTERM'); } catch (e) { res(); } setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) {} }, 5000); });
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
  //     She is still in her family and is asked to try again; the tracker carries on. Her sign-in is a minute
  //     old (the stand-in's default), so deleteAccount's recent-sign-in check lets the deletion start. Run through
  //     the app's own Delete (doDeleteAccount), so what it says is read too: her private records went in step 1,
  //     so "Nothing was deleted" would be untrue (F2).
  let o = await openApp(b, base, cloudPage('zz-del-early', { appAuth: true }));
  try {
    const uid = 'zz-del-early', tokOf = /^tok-zz-del-early-/;
    const hid = await cloudBooted(o.page);
    await o.page.evaluate(() => window.cubbyTrack('feature.used', { feature: 'export', action: 'opened' }));
    let s = await sendsUntil(o.page, (x) => named(eventsOf(x), 'feature.used', { feature: 'export' }).length > 0, 20000);
    R.ok('S21.early-before', 'companion: before the deletion her events flow', !!hid && named(eventsOf(s), 'feature.used', { feature: 'export' }).some((e) => tokOf.test(e._token || '')), eventsOf(s).map((e) => [e.name, e._token]));
    o.ctl.refuse = (u, m) => m === 'POST' && /documents:commit/.test(u);
    const said = await deleteFromApp(o.page);
    const err = said.goodbye ? 'resolved' : String((said.threw && (said.threw.code || said.threw.message)) || '');
    o.ctl.refuse = null;
    const st = await o.page.evaluate((u) => ({ member: !!(window.LL.members || {})[u], deleting: window.__cubbyDeleting }), uid);
    const refused = o.local.filter((x) => x.method === 'POST' && /documents:commit/.test(x.url)).length;
    const purge = o.local.filter((x) => /\/api\/account\/purge/.test(x.url)).length;
    R.ok('S21.early-staged', 'staged: the leave was refused (permission-denied), she is still in her family, and her usage rows were never asked to go',
      err === 'permission-denied' && refused > 0 && st.member && purge === 0, { err, refused, purge, st });
    R.ok('S21.early-says', 'and the app says it could not finish, never "Nothing was deleted": her private records went before the leave was refused',
      said.said === 'Could not finish deleting. Please try again' && !!said.threw && said.threw.stage === 'partly', said);
    const n0 = (await sent(o.page)).length;
    await o.page.evaluate(() => window.cubbyTrack('feature.used', { feature: 'games', action: 'opened' }));
    s = await sendsUntil(o.page, (x) => named(eventsOf(x), 'feature.used', { feature: 'games' }).length > 0, 10000);
    R.ok('S21.early-flows', 'after it, her next event flows under her token: the deletion that never got that far did not silence her',
      named(eventsOf(s.slice(n0)), 'feature.used', { feature: 'games' }).some((e) => tokOf.test(e._token || '')), { deleting: await o.page.evaluate(() => window.__cubbyDeleting), sent: eventsOf(s.slice(n0)).map((e) => e.name) });
    // She signs out. Signing out also forgets whose family record was seen as the server holds it (teardown, NEW-2):
    // nothing may be sent on her old say-so between a sign-out and the next sign-in's own server copy. Staged first:
    // before the sign-out it named her (she is still in her family, signed in).
    const seenIn = await o.page.evaluate(() => window.__cubbyHouseholdSeen);
    await o.page.evaluate(async () => { await window.LL.signOut(); });
    await sleep(300);
    const seenOut = await o.page.evaluate(() => ({ seen: window.__cubbyHouseholdSeen, out: !window.LL.auth.currentUser }));
    R.ok('S21.signed-out-unseen', 'signed out, her family record no longer counts as seen: window.__cubbyHouseholdSeen is \'\' before the next sign-in (and named her before)',
      seenIn === uid && seenOut.seen === '' && seenOut.out, { seenIn, seenOut });
  } finally { await o.ctx.close(); }
  // (b) Stopped after them: an email-code sign-in that looked recent when the deletion began (a minute old), but
  //     Firebase still refuses to delete the login at the end (requires-recent-login: the steps outran the window),
  //     and there is no provider to ask again. Her usage rows have been asked to go. The deletion then signs her
  //     out (S23 drives that); here that sign-out is refused (cfg.signOutFails), so she is still the account she
  //     asked to delete, and nothing new may be recorded under it until she signs out herself. She then does, and
  //     signs in again.
  o = await openApp(b, base, cloudPage('zz-del-late', { appAuth: true, staleLogin: true, signOutFails: true }));
  try {
    const uid = 'zz-del-late', tokOf = /^tok-zz-del-late-/;
    const hid = await cloudBooted(o.page);
    await o.page.evaluate(() => window.cubbyTrack('feature.used', { feature: 'export', action: 'opened' }));
    let s = await sendsUntil(o.page, (x) => named(eventsOf(x), 'feature.used', { feature: 'export' }).length > 0, 20000);
    R.ok('S21.late-before', 'companion: before the deletion her events flow', !!hid && named(eventsOf(s), 'feature.used', { feature: 'export' }).some((e) => tokOf.test(e._token || '')), eventsOf(s).map((e) => [e.name, e._token]));
    const err = await o.page.evaluate(() => window.LL.deleteAccount().then(() => 'resolved', (e) => String((e && (e.code || e.message)) || e)));
    const purge = o.local.filter((x) => x.method === 'POST' && /\/api\/account\/purge/.test(x.url)).length;
    const still = await o.page.evaluate(() => ({ who: window.LL.auth.currentUser && window.LL.auth.currentUser.uid, signOuts: window.__utAuth.signOuts }));
    R.ok('S21.late-staged', 'staged: the deletion stopped at the login (reauth_unsupported), after her usage rows were asked to go, and the sign-out that follows was refused, so she is still signed in',
      err === 'reauth_unsupported' && purge === 1 && still.who === uid && still.signOuts === 1, { err, purge, still });
    const n0 = (await sent(o.page)).length;
    await o.page.evaluate(() => { window.cubbyTrack('feature.used', { feature: 'games', action: 'opened' }); window.cubbyTrackEntry('feed', 'logged'); });
    await settle(o.page);
    const s1 = (await sent(o.page)).slice(n0), q1 = await queue(o.page);
    R.ok('S21.late-silent', 'after it nothing more is sent or kept under the account she asked to delete', s1.length === 0 && q1.length === 0,
      { sent: s1.map((x) => x.body.events.map((e) => e.name)), queued: q1.map((x) => x.ev.name) });
    // She signs out herself (this time it works), then in again on the same page. Back means THIS sign-in has
    // booted: her new family (she left the old one, so it is another id) is drawn, and its server copy has named
    // her (window.__cubbyHouseholdSeen), which is all the tracker waits for. cloudBooted alone is no wait here:
    // window.LL.householdId still holds the family she left (sign-out does not clear it) and the sign-in screen is
    // gone while her new family is made, so it passed at once, and the 20 s below timed the whole sign-in too. With
    // each emulator answer held 3.5 s that sign-in took 21 s and this went red, as on CI (run 45383173709), while
    // her event flowed under her token a moment after the window closed. The sign-in now has its own minute, the
    // send its own 20 s.
    const oldHid = await o.page.evaluate(() => window.LL.householdId);
    await o.page.evaluate(async () => { await window.LL.signOut(); });
    await sleep(300);
    await o.page.evaluate((u) => window.__utAuth.switchTo(u), uid);
    let back = null;
    const t0 = Date.now();
    try {
      await o.page.waitForFunction((old, u) => !!(window.LL && window.LL.householdId && window.LL.householdId !== old)
        && !document.getElementById('llAuthOv') && typeof window.__cubbyScreen === 'string' && window.__cubbyHouseholdSeen === u,
      { timeout: 60000 }, oldHid, uid);
      back = await o.page.evaluate(() => window.LL.householdId);
    } catch (e) {}
    const msBack = Date.now() - t0, n1 = (await sent(o.page)).length, t1 = Date.now();
    await o.page.evaluate(() => window.cubbyTrack('feature.used', { feature: 'pro', action: 'opened' }));
    s = await sendsUntil(o.page, (x) => named(eventsOf(x.slice(n1)), 'feature.used', { feature: 'pro' }).length > 0, 20000);
    const msSend = Date.now() - t1;
    R.ok('S21.again-flows', 'signed out and in again on the same page: her events flow again (signing out ended the silence)',
      !!back && named(eventsOf(s.slice(n1)), 'feature.used', { feature: 'pro' }).some((e) => tokOf.test(e._token || '')),
      { oldHid, back, msBack, msSend, sent: eventsOf(s.slice(n1)).map((e) => [e.name, e._token]), queued: (await queue(o.page)).map((x) => [x.ev.name, x.uid]),
        now: await o.page.evaluate(() => ({ deleting: window.__cubbyDeleting, seen: window.__cubbyHouseholdSeen, hid: window.LL.householdId,
          who: window.LL.auth.currentUser && window.LL.auth.currentUser.uid, screen: window.__cubbyScreen, authOv: !!document.getElementById('llAuthOv'),
          mode: localStorage.getItem('cubby-usage-mode') })) });
  } finally { await o.ctx.close(); }
  // (c) Signed out sooner than 3.5 s after her family was attached, then in again on the same page. Attaching a
  //     family arms a boot failsafe (startSync: show the app after 3.5 s even if the entries are slow). Until Nov
  //     2026 it outlived the sign-out: firing after it, it booted the family she had left, hid the sign-in screen,
  //     and marked the app booted, so her next sign-in on that page never drew her family and the loader turned
  //     for good (S21.again-flows went red on CI three times, and about 1 run in 3 here with the page's CPU slowed 4x).
  //     The failsafe is held (cfg.holdFailsafe) and run right after the sign-out, every time.
  o = await openApp(b, base, cloudPage('zz-quick-out', { appAuth: true, holdFailsafe: true }));
  try {
    const uid = 'zz-quick-out';
    const hid = await cloudBooted(o.page);
    const armed = await o.page.evaluate(() => window.__utFailsafe.length);
    await o.page.evaluate(async () => { await window.LL.signOut(); });
    await sleep(300);
    const ran = await o.page.evaluate(() => { const f = window.__utFailsafe.splice(0); f.forEach((x) => x()); return f.length; });
    await sleep(300);
    const door = await o.page.evaluate(() => { const ov = document.getElementById('llAuthOv'); return { landing: !!ov && ov.classList.contains('landing'), signedIn: !!window.LL.auth.currentUser }; });
    R.ok('S21.quick-out-door', 'signed out sooner than the boot failsafe, which then ran: the sign-in screen is still there',
      !!hid && armed > 0 && ran === armed && door.landing && !door.signedIn, { hid, armed, ran, door });
    await o.page.evaluate((u) => window.__utAuth.switchTo(u), uid);
    let back = false;
    try {
      await o.page.waitForFunction((u) => !document.getElementById('llAuthOv') && window.LL.householdId && window.__cubbyHouseholdSeen === u,
        { timeout: 30000 }, uid);
      back = true;
    } catch (e) {}
    R.ok('S21.quick-out-back', 'and signing in again on the same page draws her family: the loader goes',
      back, await o.page.evaluate(() => ({ hid: window.LL.householdId, seen: window.__cubbyHouseholdSeen, screen: window.__cubbyScreen,
        overlay: (document.getElementById('llAuthOv') || {}).textContent || null })));
  } finally { await o.ctx.close(); }
};

/* What a deletion would remove, on the emulator: her place in the family, a private health page, her email, a note
   she wrote to herself, and her own user record. Planted after the app has booted (merged into, never over, what
   the app wrote), read back over REST, as the server holds them. */
const fsVal = (v) => (typeof v === 'string' ? { stringValue: v } : typeof v === 'number' ? { integerValue: String(v) }
  : typeof v === 'boolean' ? { booleanValue: v } : Array.isArray(v) ? { arrayValue: v.length ? { values: v.map(fsVal) } : {} }
    : { mapValue: { fields: Object.keys(v).reduce((a, k) => { a[k] = fsVal(v[k]); return a; }, {}) } });
async function emuMerge(docPath, obj) {
  const mask = Object.keys(obj).map((k) => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  const r = await fetch(emuDocs() + '/' + docPath + '?' + mask, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: Object.keys(obj).reduce((a, k) => { a[k] = fsVal(obj[k]); return a; }, {}) }) });
  return r.ok;
}
async function emuRead(docPath) {
  const r = await fetch(emuDocs() + '/' + docPath, { headers: { authorization: 'Bearer owner' } });
  return r.ok ? r.json() : null;
}
async function plantPrivate(hid, uid) {
  const h = 'households/' + encodeURIComponent(hid);
  const oks = await Promise.all([
    emuMerge(h + '/mhealth/' + uid + '/cat/conditions', { ownerUid: uid, category: 'conditions', data: { conditions: ['zz-private'] }, sharedWith: [] }),
    emuMerge(h + '/memberEmails/' + uid, { email: uid + '@zz.test' }),
    emuMerge(h + '/notes/zz-to-herself', { createdBy: uid, createdByName: '', at: CLOCK, day: '2026-11-14', text: 'zz to herself', audience: uid, pinned: false }),
    emuMerge('users/' + uid, { zzKept: 1 }),
  ]);
  return oks.every(Boolean);
}
async function herRecords(hid, uid) {
  const h = 'households/' + encodeURIComponent(hid);
  const [hh, health, email, note, user] = await Promise.all([emuRead(h), emuRead(h + '/mhealth/' + uid + '/cat/conditions'),
    emuRead(h + '/memberEmails/' + uid), emuRead(h + '/notes/zz-to-herself'), emuRead('users/' + uid)]);
  const members = (((hh || {}).fields || {}).members || {}).mapValue || {};
  return { member: !!(members.fields || {})[uid], health: !!health, email: !!email, note: !!note, user: !!(user && user.fields && user.fields.zzKept) };
}
const allThere = (x) => !!x && x.member && x.health && x.email && x.note && x.user;
const allGone = (x) => !!x && !x.member && !x.health && !x.email && !x.note && !x.user;
/* The app's own Delete path (doDeleteAccount in index.html, what the confirm sheet runs), what it then says, and what
   LL.deleteAccount threw on the way (its code, and the stage store-firebase.js stamped on it). */
const deleteFromApp = (page) => page.evaluate(async () => {
  const real = window.LL.deleteAccount;
  let threw = null;
  window.LL.deleteAccount = () => real().catch((e) => { threw = { code: (e && e.code) || '', message: (e && e.message) || String(e), stage: (e && e.cubbyDeletion) || '' }; throw e; });
  try { await doDeleteAccount(); } finally { window.LL.deleteAccount = real; }
  const t = document.getElementById('toast'), ov = document.getElementById('llAuthOv');
  // The sign-in screen's own message line (the web landing, the app's, the invite's and the plain card).
  const note = ov ? ([...ov.querySelectorAll('.lp-msg, .ll-auth-msg')].map((x) => x.textContent.trim()).filter(Boolean)[0] || '') : '';
  // What she sees: whose is the element at the centre of the screen (SAR-1: a finished deletion's goodbye lay under
  // the sign-in screen that Firebase's sign-out brings up).
  const at = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
  const top = !at ? 'none' : at.closest('#cb-del-goodbye') ? 'goodbye' : at.closest('#llAuthOv') ? 'signin' : at.closest('#ll-access-lost') ? 'access-lost' : (at.id || at.tagName.toLowerCase());
  return { said: t ? t.textContent : '', goodbye: !!document.getElementById('cb-del-goodbye'), threw,
    signedOut: !window.LL.auth.currentUser, signIn: !!(ov && /Continue with Google/.test(ov.textContent)), overlay: !!ov, note, top };
});
/* A deletion that finished, as she sees it: the goodbye, over the sign-in screen Firebase's sign-out has already
   brought up (so "on top" is not won for want of anything to be under), with nothing under it still saying her
   account is here (signInNote, SAR-4). */
const goodbyeSeen = (r) => !!r && r.goodbye && r.signedOut && r.overlay && r.top === 'goodbye' && !/account is still here/.test(r.note);
const LOGIN_LEFT = 'Your private records are deleted, but your account is still here. ';
const SIGN_IN_TO_FINISH = LOGIN_LEFT + 'Sign in again, then delete it to finish.';
/* localKeys: this phone's own keys are where they were, read off cubby-member, which every sign-in writes and only the
   deletion's step 4 (local traces) removes. It used to read little-log-v1, but a phone signed in to a family no longer
   keeps a copy of what that family holds (store-firebase.js letGoOfRecord, 2026-11-19 post-mortem), so that key is gone
   whether or not a deletion ran. The same read is each door's companion: kept at the door, gone once the deletion
   has run to the end (the local-traces-kept mutant below skips step 4, and only the companions notice). */
const signInSheets = (page) => page.evaluate(() => ({ asked: window.__utAuth.reauths, loginDeletes: window.__utAuth.deletes, deleting: window.__cubbyDeleting === true,
  localKeys: localStorage.getItem('cubby-member') === '1' }));
const purgesAsked = (o) => o.local.filter((x) => x.method === 'POST' && /\/api\/account\/purge/.test(x.url)).length;

SECTIONS.S22 = async (b, base, R) => {
  console.log('\nS22. account deletion says only what is true: a sign-in it needs is asked for before anything is deleted (DELETE-TRUTH)');
  await emuClear();
  // (a) Google, signed in ten minutes ago: Firebase would refuse to delete the login. She is asked to sign in again
  //     and closes the sheet. Then she tries again and signs in (the companion: the same probes see it all go).
  let o = await openApp(b, base, cloudPage('zz-truth-google', { appAuth: true, provider: 'google.com', signedInAgo: 600000, staleLogin: true, reauth: ['closed', 'ok'] }));
  try {
    const uid = 'zz-truth-google';
    const hid = await cloudBooted(o.page);
    await sleep(1500);
    const planted = hid ? await plantPrivate(hid, uid) : false;
    const before = hid ? await herRecords(hid, uid) : null;
    R.ok('S22.door-staged', 'staged: she is in her family, with a private health page, her email, a note to herself and her own user record',
      planted && allThere(before), { hid, planted, before });
    const r1 = await deleteFromApp(o.page);
    const after = await herRecords(hid, uid), st = await signInSheets(o.page);
    R.ok('S22.door-asked', 'staged: she was asked to sign in again, and closed the sheet', st.asked === 1, st);
    R.ok('S22.door-kept', 'a sign-in she closes leaves her place in the family and every record where it was, the login and this phone\'s own keys too, and asks for no usage purge',
      allThere(after) && st.loginDeletes === 0 && st.localKeys && purgesAsked(o) === 0, { after, st, purges: purgesAsked(o) });
    R.ok('S22.door-says', 'and the app says "Nothing was deleted", which is now true', r1.said === 'Nothing was deleted', r1);
    R.ok('S22.door-tracked', 'and the tracker was never silenced: the deletion never started', !st.deleting, st);
    const r2 = await deleteFromApp(o.page);
    const gone = await herRecords(hid, uid), st2 = await signInSheets(o.page);
    R.ok('S22.door-companion', 'companion: she tries again and signs in, the deletion runs to the end, the same probes see every one of them go, and the goodbye is what she sees',
      goodbyeSeen(r2) && allGone(gone) && st2.asked === 2 && purgesAsked(o) === 1 && !st2.localKeys, { r2, gone, st2, purges: purgesAsked(o) });
  } finally { await o.ctx.close(); }
  // (b) An email-code sign-in from ten minutes ago: there is no sheet to ask again, so she must sign in afresh first.
  o = await openApp(b, base, cloudPage('zz-truth-code', { appAuth: true, signedInAgo: 600000, staleLogin: true }));
  try {
    const uid = 'zz-truth-code';
    const hid = await cloudBooted(o.page);
    await sleep(1500);
    const planted = hid ? await plantPrivate(hid, uid) : false;
    const r = await deleteFromApp(o.page);
    const after = hid ? await herRecords(hid, uid) : null, st = await signInSheets(o.page);
    R.ok('S22.code-kept', 'an email-code sign-in too old to delete the login stops before anything: her place, her records and the login are kept, no purge is asked',
      planted && allThere(after) && st.loginDeletes === 0 && purgesAsked(o) === 0, { planted, after, st, purges: purgesAsked(o) });
    R.ok('S22.code-says', 'and the app asks her to sign in again first', r.said === 'Please log out, sign in again, then delete', r);
  } finally { await o.ctx.close(); }
  // (c) Past the point of no return: her Google sign-in looked recent (a minute old), so the deletion ran, but
  //     Firebase still asks at the very end and she cancels. Her records and her place are gone; only the login is
  //     left. "Nothing was deleted" would be untrue here. She is signed out, and the sign-in screen says what is left.
  o = await openApp(b, base, cloudPage('zz-truth-late', { appAuth: true, provider: 'google.com', staleLogin: true, reauth: ['cancel'] }));
  try {
    const uid = 'zz-truth-late';
    const hid = await cloudBooted(o.page);
    await sleep(1500);
    const planted = hid ? await plantPrivate(hid, uid) : false;
    const r = await deleteFromApp(o.page);
    const after = hid ? await herRecords(hid, uid) : null, st = await signInSheets(o.page);
    R.ok('S22.late-staged', 'staged: the deletion ran to the login (her place and records gone, the purge asked), then she cancelled the one sign-in Firebase asked for',
      planted && allGone(after) && purgesAsked(o) === 1 && st.asked === 1 && st.loginDeletes === 1, { planted, after, st, purges: purgesAsked(o) });
    R.ok('S22.late-says', 'the app does not say "Nothing was deleted": signed out, the sign-in screen says "' + SIGN_IN_TO_FINISH + '"',
      !/Nothing was deleted/i.test(r.said + r.note) && r.signedOut && r.signIn && r.note === SIGN_IN_TO_FINISH, r);
  } finally { await o.ctx.close(); }
  // (d) The iPhone app (the Capacitor wrapper), an Apple account signed in ten minutes ago: the app's own Apple sheet
  //     asks at the door (reauthenticate's native branch, then Firebase takes the credential). She backs out of it,
  //     and nothing is deleted; then she deletes again and signs in, and it all goes.
  o = await openApp(b, base, cloudPage('zz-truth-apple', { appAuth: true, native: true, provider: 'apple.com', signedInAgo: 600000, staleLogin: true, reauth: ['cancel', 'ok'] }));
  try {
    const uid = 'zz-truth-apple';
    const hid = await cloudBooted(o.page);
    await sleep(1500);
    const planted = hid ? await plantPrivate(hid, uid) : false;
    const r1 = await deleteFromApp(o.page);
    const after = hid ? await herRecords(hid, uid) : null, st = await signInSheets(o.page);
    const how = await o.page.evaluate(() => ({ native: window.__utAuth.nativeSheets, popups: window.__utAuth.popups, credentials: window.__utAuth.credentials, isNative: window.LL.isNativeApp() }));
    R.ok('S22.native-asked', 'staged: in the iPhone app the door asked with the app\'s own Apple sheet, not a web popup, and she backed out of it',
      planted && how.isNative && how.native === 1 && how.popups === 0 && how.credentials === 0, { planted, how });
    R.ok('S22.native-kept', 'backing out of the Apple sheet leaves her place, every record, the login and this phone\'s own keys, and asks for no purge',
      allThere(after) && st.loginDeletes === 0 && st.localKeys && purgesAsked(o) === 0, { after, st, purges: purgesAsked(o) });
    R.ok('S22.native-says', 'and the app says "Nothing was deleted" (Apple\'s cancel is read as a cancel)', r1.said === 'Nothing was deleted' && !r1.signedOut, r1);
    const r2 = await deleteFromApp(o.page);
    const gone = await herRecords(hid, uid), st2 = await signInSheets(o.page);
    const how2 = await o.page.evaluate(() => ({ native: window.__utAuth.nativeSheets, popups: window.__utAuth.popups, credentials: window.__utAuth.credentials, provider: window.__utAuth.lastCredential }));
    R.ok('S22.native-companion', 'companion: she deletes again and signs in on the Apple sheet, Firebase takes that credential, the deletion runs to the end, and the goodbye is what she sees',
      goodbyeSeen(r2) && allGone(gone) && how2.native === 2 && how2.popups === 0 && how2.credentials === 1 && how2.provider === 'apple.com' && st2.loginDeletes === 1 && purgesAsked(o) === 1 && !st2.localKeys,
      { r2, gone, how2, st2, purges: purgesAsked(o) });
  } finally { await o.ctx.close(); }
};

/* S23, S23b and S24 run under this tree's own firestore.rules, put in force on the emulator for their run (the pages
   carry her identity, cfg.realRules), because what they prove depends on a rule: a family refuses the read of
   someone who has left it. Under the open rules a family she had left would still let her read it, and both a
   leave whose answer was lost (S24) and the household listener losing her (S23b) would pass for free. */
async function emuRules(content) {
  const r = await fetch('http://127.0.0.1:' + EMU.port + '/emulator/v1/projects/' + EMU.project + ':securityRules', { method: 'PUT',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }) });
  return r.ok;
}
/* A read as one person, with the same kind of unsigned token the emulator takes from the page. */
async function readAs(docPath, uid) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const tok = b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({ iss: 'https://securetoken.google.com/' + EMU.project, aud: EMU.project, iat: 0, exp: 3600,
    auth_time: 0, sub: uid, user_id: uid, firebase: { sign_in_provider: 'custom', identities: {} } }) + '.';
  const r = await fetch(emuDocs() + '/' + docPath, { headers: { authorization: 'Bearer ' + tok } });
  return r.status;
}
/* Booted under the real rules, joined by Papa (so she is not the last one out), with every record S22 plants, and
   proof of each: the rules refuse a stranger's read of her family and allow hers, and the page's calls carry her. */
async function realRulesFamily(o, uid, R, id) {
  const hid = await cloudBooted(o.page);
  await sleep(1500);
  const fam = 'households/' + encodeURIComponent(hid);
  const joined = hid ? await emuMerge(fam, { members: { [uid]: 'owner', [uid + '-papa']: 'caregiver' } }) : false;
  await sleep(1000);
  const planted = hid ? await plantPrivate(hid, uid) : false;
  const before = hid ? await herRecords(hid, uid) : null;
  const reads = hid ? { stranger: await readAs(fam, 'zz-stranger'), her: await readAs(fam, uid) } : null;
  const as = await o.page.evaluate(() => window.__utFsAs || '');
  R.ok(id, 'staged: this tree\'s firestore.rules are in force (a stranger\'s read of her family is refused, hers is not), the page\'s Firestore calls carry her identity, and she shares the family with Papa, with every record S22 plants',
    !!hid && joined && planted && allThere(before) && !!reads && reads.stranger === 403 && reads.her === 200 && as === uid, { hid, joined, planted, before, reads, as });
  return hid;
}
const herTokens = (uid) => new RegExp('^tok-' + uid + '-\\d+$');

/* A Firestore REST value as plain JS (families and user records read back as the server holds them). */
const plain = (v) => {
  if (!v || typeof v !== 'object') return v;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return ((v.arrayValue || {}).values || []).map(plain);
  if ('mapValue' in v) { const o = {}, f = (v.mapValue || {}).fields || {}; Object.keys(f).forEach((k) => { o[k] = plain(f[k]); }); return o; }
  return v;
};
async function familyOf(hid) { const d = hid ? await emuRead('households/' + encodeURIComponent(hid)) : null; return d && d.fields ? plain({ mapValue: { fields: d.fields } }) : null; }
async function eventsIn(hid) {
  const r = await fetch(emuDocs() + '/households/' + encodeURIComponent(hid) + '/events', { headers: { authorization: 'Bearer owner' } });
  const j = r.ok ? await r.json() : {};
  return (j.documents || []).length;
}
async function eventIdsIn(hid) {
  const r = await fetch(emuDocs() + '/households/' + encodeURIComponent(hid) + '/events?pageSize=300', { headers: { authorization: 'Bearer owner' } });
  const j = r.ok ? await r.json() : {};
  return (j.documents || []).map((d) => decodeURIComponent(String(d.name || '').split('/').pop()));
}
const hasRobin = (fam) => !!(fam && fam.app && (fam.app.babies || []).some((x) => x && x.name === 'Robin'));
/* What S23 names the family she leaves, and its Pro taste counts: neither may reach her next Cubby (SAR-3). Her units
   (oz, where the seed has ml) may, and do: the companion that shows settings are seen at all. */
const OLD_NAME = 'The Rivers';
const settingsOf = (fam) => (fam && fam.app && fam.app.settings) || {};
const carriesFamily = (st) => !!st && (st.householdName === OLD_NAME || !!st.proTaste);
/* The family's name where the app shows it: the name row of Family & sharing (store-firebase.js openFamily, the sheet
   that tells anyone she invites whose Cubby they join). Opened the way chaos opens it, read, and closed again. The
   page's text alone never shows it on the screens S23 passes through, so a check of that text could not go red. */
const familyNameShown = (page) => page.evaluate(() => {
  try { window.openFamily(''); } catch (e) { return 'threw: ' + e.message; }
  const v = document.querySelector('#llModalOv .ll-hhname-v'), t = v ? v.textContent.trim() : '';
  try { const m = document.getElementById('llModalOv'); if (m) m.remove(); } catch (e) {}
  return t;
});
/* What this phone keeps of a family locally (little-log-v1): what her next Cubby is made from when she signs in with
   no family of her own (store-firebase.js buildMigrationPayload). The seed's baby is Robin. */
const localFamily = (page) => page.evaluate(() => {
  try { const s = JSON.parse(localStorage.getItem('little-log-v1') || 'null'); return s ? { babies: (s.babies || []).map((x) => x && x.name), events: (s.events || []).length } : null; }
  catch (e) { return { unreadable: String(e) }; }
});
/* Signed in again on the same page (a fresh sign-in): the app boots into whichever family she has now. */
async function signInAgain(page, uid, oldHid) {
  await page.evaluate((u) => { window.__utAuth.ago = 0; window.__utAuth.stale = false; window.__utAuth.switchTo(u); }, uid);
  try {
    await page.waitForFunction((old) => !!(window.LL && window.LL.householdId && window.LL.householdId !== old) && !document.getElementById('llAuthOv'), { timeout: 30000 }, oldHid);
    return await page.evaluate(() => window.LL.householdId);
  } catch (e) { return null; }
}
const spyToasts = (page) => page.evaluate(() => {
  window.__utToasts = [];
  const t = window.toast;
  window.toast = function (m) { window.__utToasts.push(String(m)); return t.apply(this, arguments); };
});

SECTIONS.S23 = async (b, base, R) => {
  console.log('\nS23. a deletion stopped at the login signs her out, and signing in again then deleting finishes it, under this tree\'s firestore.rules (SA1, SA3)');
  await emuClear();
  const ruled = await emuRules(fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8'));
  R.ok('S23.rules', 'staged: this tree\'s firestore.rules were put in force on the emulator', ruled);
  try {
    /* Google, signed in a minute ago, so the deletion starts; Firebase still asks at the very end (the steps outran
       the window) and she closes that sheet after three seconds. Then she does what the sign-in screen says: signs
       in again and deletes; ten minutes later she closes the sheet at the door; and once more, and signs in. */
    const uid = 'zz-retry', mine = herTokens(uid);
    const o = await openApp(b, base, cloudPage(uid, { appAuth: true, realRules: true, provider: 'google.com', staleLogin: true, reauth: ['cancel-late', 'cancel', 'ok'] }));
    try {
      const hid = await realRulesFamily(o, uid, R, 'S23.staged');
      /* The family she is about to leave has a name, has used Pro tastes, reads in ounces, and holds two entries she
         logged (SAR-3, SAR-4). Saved the app's own way, and seen on the server before anything else happens. */
      const familyIds = await o.page.evaluate((name) => {
        state.settings.householdName = name; state.settings.proTaste = { pdf: 2 }; state.settings.unit = 'oz';
        const ids = [addEvent({ type: 'diaper', kind: 'wet', time: Date.now() - 60000 }), addEvent({ type: 'feed', method: 'bottle', amount: 90, time: Date.now() - 30000 })];
        persist();
        return ids;
      }, OLD_NAME);
      let famSet = {}, famIds = [];
      for (let i = 0; i < 40; i++) {
        famSet = settingsOf(await familyOf(hid)); famIds = await eventIdsIn(hid);
        if (famSet.householdName === OLD_NAME && famSet.proTaste && famSet.unit === 'oz' && familyIds.every((x) => famIds.includes(x))) break;
        await sleep(500);
      }
      R.ok('S23.family-staged', 'staged: on the server the family is named "' + OLD_NAME + '", has used Pro tastes, reads in ounces, and holds the two entries she logged there',
        famSet.householdName === OLD_NAME && !!famSet.proTaste && famSet.proTaste.pdf === 2 && famSet.unit === 'oz' && familyIds.length === 2 && familyIds.every((x) => famIds.includes(x)),
        { famSet, familyIds, famIds });
      const shown1 = await familyNameShown(o.page);
      R.ok('S23.name-shown', 'companion: while she is in it, Family & sharing calls the family "' + OLD_NAME + '" (the reader below can see a name)',
        shown1 === OLD_NAME, { shown: shown1 });
      await spyToasts(o.page);
      await o.page.evaluate(() => window.cubbyTrack('feature.used', { feature: 'export', action: 'opened' }));
      const s0 = await sendsUntil(o.page, (x) => named(eventsOf(x), 'feature.used', { feature: 'export' }).some((e) => mine.test(e._token || '')), 20000);
      R.ok('S23.before', 'companion: before the deletion her events flow under her token (the matcher below can see them)',
        named(eventsOf(s0), 'feature.used', { feature: 'export' }).some((e) => mine.test(e._token || '')), eventsOf(s0).map((e) => [e.name, e._token]));
      const n0 = (await sent(o.page)).length;
      const r1 = await deleteFromApp(o.page);
      const after1 = await herRecords(hid, uid), st1 = await signInSheets(o.page);
      R.ok('S23.stopped', 'staged: the deletion ran to the login (her place and records gone, the purge asked), then she closed the one sign-in Firebase asked for there',
        !!r1.threw && r1.threw.stage === 'login' && allGone(after1) && purgesAsked(o) === 1 && st1.asked === 1 && st1.loginDeletes === 1, { r1, after1, st1, purges: purgesAsked(o) });
      R.ok('S23.signed-out', 'and she is signed out, on the sign-in screen: no copy of the family she left is left open for her to use',
        r1.signedOut && r1.signIn && !r1.goodbye, r1);
      R.ok('S23.stopped-says', 'and the sign-in screen says what is left: "' + SIGN_IN_TO_FINISH + '"', r1.note === SIGN_IN_TO_FINISH, r1);
      const mem1 = await o.page.evaluate(() => ({ settings: state.settings, events: (state.events || []).map((e) => e && e.id) }));
      R.ok('S23.settings-forgotten', 'this phone no longer holds the family\'s name or its Pro taste counts, and keeps her units (ounces)',
        !carriesFamily(mem1.settings) && mem1.settings.unit === 'oz', mem1.settings);
      R.ok('S23.events-forgotten', 'nor the entries logged in the family she left', mem1.events.length === 0 && !familyIds.some((x) => mem1.events.includes(x)), mem1.events);
      // From the deletion's start until she signs in again, nothing is sent or kept under the account she asked to delete.
      await o.page.evaluate(() => window.cubbyTrack('feature.used', { feature: 'games', action: 'opened' }));
      await settle(o.page);
      const leakedOut = eventsOf((await sent(o.page)).slice(n0)).filter((e) => mine.test(e._token || '')), qOut = (await queue(o.page)).filter((x) => x.uid === uid);
      R.ok('S23.silent-until-back', 'from the deletion\'s start until she signs in again nothing is sent or kept under her account',
        leakedOut.length === 0 && qOut.length === 0, { leaked: leakedOut.map((e) => e.name), queued: qOut.map((x) => x.ev.name) });
      /* SA1's state was a page still holding the family she had left, where a log was shown, refused, and followed by
         "Cubby wasn't allowed to save that. If you've been removed from this circle, sign out and back in". A log made
         the app's own way now reaches no family and draws no such toast (the kept-signed-in mutant stages it). */
      const afterId = await o.page.evaluate(() => { try { return addEvent({ type: 'diaper', kind: 'wet', time: Date.now() }); } catch (e) { window.__utLogErr = String(e); return null; } });
      await sleep(4000);
      const toasts = await o.page.evaluate(() => window.__utToasts.slice()), evOld = await eventIdsIn(hid);
      R.ok('S23.log-after-stop', 'a log made after the stop reaches no family and is never refused ("wasn\'t allowed to save"): nothing of the family she left is open to log into',
        !toasts.some((t) => /allowed to save/.test(t)) && !!afterId && !evOld.includes(afterId) && evOld.length === familyIds.length,
        { toasts, afterId, evOld, err: await o.page.evaluate(() => window.__utLogErr || '') });
      const local = await localFamily(o.page);
      R.ok('S23.forgotten', 'and what this phone then saves locally, which her next Cubby is made from, holds nothing of the family she left (no baby Robin)',
        !!local && Array.isArray(local.babies) && !local.babies.includes('Robin'), local);
      // She signs in again, as the sign-in screen says (a fresh sign-in).
      const hid2 = await signInAgain(o.page, uid, hid);
      const fam2 = await familyOf(hid2), user2 = plain({ mapValue: { fields: ((await emuRead('users/' + uid)) || {}).fields || {} } });
      const noteAfter = await o.page.evaluate(() => { const ov = document.getElementById('llAuthOv'); return ov ? ov.textContent : ''; });
      R.ok('S23.new-family', 'signed in again she lands in a new Cubby of her own (her user record names it), with nothing of the family she left in it (no baby Robin)',
        !!hid2 && hid2 !== hid && user2.householdId === hid2 && !!fam2 && !hasRobin(fam2) && !noteAfter, { hid, hid2, userHid: user2.householdId, babies: fam2 && fam2.app && fam2.app.babies, noteAfter });
      const set2 = settingsOf(fam2), ids2 = hid2 ? await eventIdsIn(hid2) : null;
      const seen2 = await o.page.evaluate(() => ({ settings: state.settings, name: (typeof householdName === 'function') ? householdName() : '' }));
      R.ok('S23.new-settings', 'her new Cubby is not named "' + OLD_NAME + '" and has used no Pro tastes: not on the server, not in memory, not in what the app calls it (householdName); her units (ounces) came with her',
        !!hid2 && !carriesFamily(set2) && set2.unit === 'oz' && !carriesFamily(seen2.settings) && seen2.name !== OLD_NAME,
        { set2, mem: seen2.settings, name: seen2.name });
      const shown2 = await familyNameShown(o.page);
      R.ok('S23.new-name-shown', 'and on screen her new Cubby\'s Family & sharing names it something of its own, not "' + OLD_NAME + '"',
        !!shown2 && shown2 !== OLD_NAME && !/^threw/.test(shown2), { shown: shown2 });
      R.ok('S23.new-no-entries', 'and holds none of the entries logged in the family she left', !!ids2 && !familyIds.some((x) => ids2.includes(x)), { familyIds, ids2 });
      // Ten minutes on, she deletes and closes the sheet at the door.
      await o.page.evaluate(() => { window.__utAuth.ago = 600000; });
      const r2 = await deleteFromApp(o.page);
      const st2 = await signInSheets(o.page);
      R.ok('S23.door-again-staged', 'staged: on the next try her sign-in is ten minutes old, she is asked at the door and closes the sheet; nothing more is deleted or asked',
        !!r2.threw && r2.threw.code === 'auth/user-cancelled' && st2.asked === 2 && st2.loginDeletes === 1 && purgesAsked(o) === 1 && !r2.signedOut, { r2, st2, purges: purgesAsked(o) });
      R.ok('S23.door-again-says', 'the app does not say "Nothing was deleted" (her records went the first time): signed in, it says they are deleted and her account is still here',
        r2.said === LOGIN_LEFT + 'Delete it once more to finish', r2);
      // Once more, and she signs in.
      const r3 = await deleteFromApp(o.page);
      const st3 = await signInSheets(o.page), userDoc = await emuRead('users/' + uid), after3 = await herRecords(hid, uid);
      const fam3 = await familyOf(hid2), old = await familyOf(hid);
      R.ok('S23.retry-finishes', 'and it finishes: the goodbye on top of the sign-in screen Firebase\'s sign-out brings up, the login gone, her user record still gone, her new Cubby flagged with nobody left in it, the purge asked again, and the family she left keeping Papa and nothing of hers',
        r3.goodbye && r3.signedOut && r3.overlay && r3.top === 'goodbye' && st3.asked === 3 && st3.loginDeletes === 2 && !userDoc && allGone(after3) && !!fam3 && typeof fam3.deleteAfter === 'number' && !Object.keys(fam3.members || {}).length
          && purgesAsked(o) === 2 && !!old && Object.keys(old.members || {}).join() === uid + '-papa',
        { r3, st3, userDoc: !!userDoc, after3, newFamily: fam3 && { members: fam3.members, deleteAfter: fam3.deleteAfter }, oldMembers: old && old.members, purges: purgesAsked(o) });
      /* SAR-4: the note the stop left on the sign-in screen went when she signed in again. Kept, the finish's own
         sign-out drew it again, under the goodbye: "your account is still here", about an account that is gone. */
      R.ok('S23.finished-no-note', 'and the sign-in screen under the goodbye no longer says her account is still here',
        r3.signedOut && r3.overlay && !/account is still here/.test(r3.note), { note: r3.note, signedOut: r3.signedOut, overlay: r3.overlay });
      // Once it has finished, nothing more is sent or kept under the account.
      const nEnd = (await sent(o.page)).length;
      await o.page.evaluate(() => { window.cubbyTrack('feature.used', { feature: 'games', action: 'opened' }); window.cubbyTrackEntry('feed', 'logged'); });
      await settle(o.page);
      const leaked = eventsOf((await sent(o.page)).slice(nEnd)).filter((e) => mine.test(e._token || '')), q = await queue(o.page);
      R.ok('S23.silent-after', 'and once it has finished nothing more is sent or kept under her account',
        leaked.length === 0 && q.length === 0 && (await signInSheets(o.page)).deleting, { leaked: leaked.map((e) => e.name), queued: q.map((x) => x.ev.name), deleting: (await signInSheets(o.page)).deleting });
    } finally { await o.ctx.close(); }
  } finally { await emuRules(OPEN_RULES); }
};

SECTIONS.S23b = async (b, base, R) => {
  console.log('\nS23b. the same stop with the sheet closed at once, inside the household listener\'s 1.5 s re-check: the sign-in screen stays, with no "no longer in this family" note over it');
  await emuClear();
  const ruled = await emuRules(fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8'));
  R.ok('S23b.rules', 'staged: this tree\'s firestore.rules were put in force on the emulator', ruled);
  try {
    const uid = 'zz-retry-fast';
    const o = await openApp(b, base, cloudPage(uid, { appAuth: true, realRules: true, provider: 'google.com', staleLogin: true, reauth: ['cancel'] }));
    try {
      const hid = await realRulesFamily(o, uid, R, 'S23b.staged');
      const r1 = await deleteFromApp(o.page);
      const stopAt = Date.now();   // the same clock as the page's real one (window.__utLost)
      await sleep(3500);   // past the household listener's 1.5 s re-check, however late its refusal came
      const lost = await o.page.evaluate(() => window.__utLost.slice());
      const view = await o.page.evaluate(() => { const ov = document.getElementById('llAuthOv');
        return { note: !!document.getElementById('ll-access-lost'), signIn: !!(ov && /Continue with Google/.test(ov.textContent)), out: !window.LL.auth.currentUser }; });
      const userDoc = await emuRead('users/' + uid);
      console.log('    the household listener lost her ' + (lost.length ? (stopAt - lost[0]) + ' ms before the stop (its re-check is 1500 ms after)' : 'never'));
      R.ok('S23b.fast-staged', 'staged: the deletion stopped at the login with her place gone, and the household listener lost her (permission-denied) less than 1.5 s before the stop, or after it, so its re-check ran once she had been signed out',
        !!r1.threw && r1.threw.stage === 'login' && lost.length > 0 && stopAt < lost[0] + 1500 && !(await herRecords(hid, uid)).member, { r1, lostAt: lost.map((t) => t - stopAt) });
      R.ok('S23b.fast-signin-stays', 'once that re-check has run she is still signed out on the sign-in screen: it did not take the screen away', view.signIn && view.out, view);
      R.ok('S23b.fast-no-note', 'and no "You\'re no longer in this family" note is up', !view.note, view);
      R.ok('S23b.fast-user-gone', 'and her user record, deleted by the deletion, is not written back', !userDoc, { userDoc: !!userDoc });
      const hid2 = await signInAgain(o.page, uid, hid);
      const r2 = hid2 ? await deleteFromApp(o.page) : null;
      R.ok('S23b.fast-finishes', 'signed in again, deleting finishes, and the goodbye is what she sees', !!hid2 && goodbyeSeen(r2), { hid2, r2 });
    } finally { await o.ctx.close(); }
  } finally { await emuRules(OPEN_RULES); }
};

SECTIONS.S24 = async (b, base, R) => {
  console.log('\nS24. her leave reaches the server but its answer is lost: the same deletion finishes, under this tree\'s firestore.rules (SA2)');
  await emuClear();
  const ruled = await emuRules(fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8'));
  R.ok('S24.rules', 'staged: this tree\'s firestore.rules were put in force on the emulator', ruled);
  try {
    const uid = 'zz-lostack';
    const o = await openApp(b, base, cloudPage(uid, { appAuth: true, realRules: true, provider: 'google.com' }));
    try {
      const hid = await realRulesFamily(o, uid, R, 'S24.staged');
      /* The leave's commit is passed to the emulator, which takes it, and the phone is told 503. Firestore then runs
         the transaction again, and the rules refuse that read: she is no longer in the family. An owner removing her
         while the deletion runs reaches the same refusal. */
      let armed = true, forwarded = null;
      o.ctl.hook = (r) => {
        if (!armed || r.method() !== 'POST' || !/documents:commit/.test(r.url()) || !/formerMemberInfo/.test(r.postData() || '')) return false;
        armed = false;
        (async () => {
          const h = Object.assign({}, r.headers()); delete h['content-length']; delete h.host;
          try { const resp = await fetch(r.url(), { method: 'POST', headers: h, body: r.postData() }); forwarded = resp.status; } catch (e) { forwarded = String(e); }
          r.respond({ status: 503, contentType: 'application/json', headers: { 'access-control-allow-origin': r.headers().origin || '*', 'access-control-allow-credentials': 'true' },
            body: JSON.stringify({ error: { code: 503, message: 'The service is currently unavailable.', status: 'UNAVAILABLE' } }) }).catch(() => {});
        })();
        return true;
      };
      const r1 = await deleteFromApp(o.page);
      o.ctl.hook = null;
      const after = await herRecords(hid, uid), userDoc = await emuRead('users/' + uid), fam = await familyOf(hid);
      R.ok('S24.lost', 'staged: her leave reached the server (the emulator took the write) and the phone was told it failed (503)',
        forwarded === 200 && !armed && !after.member, { forwarded, armed, member: after.member });
      R.ok('S24.finishes', 'the same deletion finds the family no longer lets her in and goes on to the end: the goodbye on top of the screen, every record of hers gone, her user record gone, the purge asked once, and Papa still in the family',
        goodbyeSeen(r1) && allGone(after) && !userDoc && purgesAsked(o) === 1 && !!fam && Object.keys(fam.members || {}).join() === uid + '-papa',
        { r1, after, userDoc: !!userDoc, purges: purgesAsked(o), members: fam && fam.members });
    } finally { await o.ctx.close(); }
  } finally { await emuRules(OPEN_RULES); }
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
      if (!only.includes(k)) continue;
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
    edits: [['if (!loginLeft || !auth.currentUser) window.__cubbyDeleting = false;', '']] },
  { id: 'deleting-cleared-late', file: 'app/store-firebase.js', want: ['S21.late-silent'], sections: ['S21'],
    edits: [['if (!loginLeft || !auth.currentUser) window.__cubbyDeleting = false;', 'window.__cubbyDeleting = false;']] },
  { id: 'deleting-kept-signed-out', file: 'app/store-firebase.js', want: ['S21.again-flows'], sections: ['S21'],
    edits: [["    if (!deletingAccount) window.__cubbyDeleting = false;\n    householdSeen('');\n", "    householdSeen('');\n"]] },
  /* S21 part c: the boot failsafe of a family she has signed out of does nothing. */
  { id: 'stale-failsafe-boots', file: 'app/store-firebase.js', want: ['S21.quick-out-door', 'S21.quick-out-back'], sections: ['S21'],
    edits: [['      if (booted || !gotApp || (!gotEvents && !force) || hhRef !== attached) return;', '      if (booted || !gotApp || (!gotEvents && !force)) return;']] },
  /* NEW-2: teardown forgets whose family record was seen (startSync's own reset alone would leave a window). */
  { id: 'seen-kept-signed-out', file: 'app/store-firebase.js', want: ['S21.signed-out-unseen'], sections: ['S21'],
    edits: [["    if (!deletingAccount) window.__cubbyDeleting = false;\n    householdSeen('');\n", '    if (!deletingAccount) window.__cubbyDeleting = false;\n']] },
  /* P5V-2: the guard on that line. A deletion that finishes signs her out, so teardown runs then too, and the flag
     must stay up until the page reloads; cleared on every sign-out, her account would be tracked again. */
  { id: 'deleting-cleared-on-finish', file: 'app/store-firebase.js', want: ['S23.silent-after'], sections: ['S23'],
    edits: [['    if (!deletingAccount) window.__cubbyDeleting = false;\n', '    window.__cubbyDeleting = false;\n']] },
  /* DELETE-TRUTH: the recent sign-in asked for only at the end (as before), how far it got not said, a stop
     part-way said as "nothing" (F2), and the old message that read every cancel as "Nothing was deleted". */
  { id: 'reauth-at-the-end', file: 'app/store-firebase.js', want: ['S22.door-kept', 'S22.code-kept'], sections: ['S22'],
    edits: [["    try { await freshSignIn(u); } catch (e) { throw deletionStage(e, 'nothing', uid); }\n", '']] },
  { id: 'stage-not-said', file: 'app/store-firebase.js', want: ['S22.late-says'], sections: ['S22'],
    edits: [["throw deletionStage(e, loginLeft ? 'login' : 'partly', uid);", 'throw e;']] },
  /* Step 4 (local traces) skipped: a finished deletion leaves this phone's own keys behind. Only the S22 companions
     read them after the deletion; every other check stays green on this mutant. */
  { id: 'local-traces-kept', file: 'app/store-firebase.js', want: ['S22.door-companion', 'S22.native-companion'], sections: ['S22'],
    edits: [[".forEach(function (k) { try { localStorage.removeItem(k); } catch (e2) {} });", ".forEach(function () {});"]] },
  { id: 'partly-as-nothing', file: 'app/store-firebase.js', want: ['S21.early-says'], sections: ['S21'],
    edits: [["throw deletionStage(e, loginLeft ? 'login' : 'partly', uid);", "throw deletionStage(e, loginLeft ? 'login' : 'nothing', uid);"]] },
  { id: 'nothing-was-deleted', file: 'app/index.html', want: ['S8b.partly-refused', 'S8b.login-cancel', 'S8b.login-signed-out', 'S22.late-says'], sections: ['S8b', 'S22'],
    edits: [["const stage=(e&&e.cubbyDeletion)||'';", "const stage='nothing';"]] },
  { id: 'popup-closed-not-a-cancel', file: 'app/index.html', want: ['S8b.nothing-closed', 'S22.door-says'], sections: ['S8b', 'S22'],
    edits: [['/cancel|popup-closed-by-user/i', '/cancel/i']] },
  { id: 'unstamped-said-nothing', file: 'app/index.html', want: ['S8b.unstamped'], sections: ['S8b'],
    edits: [["const stage=(e&&e.cubbyDeletion)||'';", "const stage=(e&&e.cubbyDeletion)||'nothing';"]] },
  /* SA1-SA3: a stop at the login signs her out, the retry is "sign in again, then delete". Kept signed in on the
     family she left (her logs refused there), the family she left kept in this phone's memory (and so carried into
     her next Cubby), the household listener's re-check let loose on the sign-in screen, the note left as a toast
     under that screen, and a later stop forgetting how far an earlier one got. And SA2: a leave refused because she
     is already out (her own leave's answer lost) stopping the deletion every time. And the iPhone app's own sign-in
     sheet at the door replaced by a web popup. */
  { id: 'kept-signed-in', file: 'app/store-firebase.js', want: ['S22.late-says', 'S23.signed-out', 'S23.log-after-stop', 'S23b.fast-signin-stays'], sections: ['S22', 'S23', 'S23b'],
    edits: [['      if (loginLeft) await signOutAfterStop();\n', '']] },
  { id: 'family-kept-in-memory', file: 'app/store-firebase.js', want: ['S23.forgotten', 'S23.new-family'], sections: ['S23'],
    edits: [['    applyAppBlob({ settings: units }); state.events = []; state.activeBabyId = null;\n', '']] }, // dropFamilyFromMemory: every sign-out's forgetting
  /* SAR-3 and SAR-4, each line of that forgetting on its own: the family's settings kept whole (its name and Pro taste
     counts became her new Cubby's own: the line as it was), and its entries kept in memory. */
  { id: 'settings-carried', file: 'app/store-firebase.js', want: ['S23.settings-forgotten', 'S23.new-settings', 'S23.new-name-shown'], sections: ['S23'],
    edits: [['applyAppBlob({ settings: units }); state.events = [];', 'applyAppBlob({ settings: state.settings }); state.events = [];']] },
  { id: 'events-kept', file: 'app/store-firebase.js', want: ['S23.events-forgotten', 'S23.new-no-entries'], sections: ['S23'],
    edits: [['applyAppBlob({ settings: units }); state.events = [];', 'applyAppBlob({ settings: units });']] },
  /* SAR-4: the stop's note on the sign-in screen not cleared when she signs in again, so the finish's own sign-out
     draws it once more, under the goodbye. */
  { id: 'note-kept', file: 'app/store-firebase.js', want: ['S23.finished-no-note'], sections: ['S23'],
    edits: [["    signInNote = '';   // said what was left to do; she has signed in to do it\n", '']] },
  /* SAR-1: the goodbye back at z-index 4000, under the sign-in screen Firebase's sign-out brings up. S8b in the tree
     tier, S24 (the shortest deletion that finishes) in the emulator tier; S22, S23 and S23b check it the same way. */
  { id: 'goodbye-under-signin', file: 'app/index.html', want: ['S8b.goodbye', 'S24.finishes'], sections: ['S8b', 'S24'],
    edits: [["ov.setAttribute('style','position:fixed;inset:0;z-index:100003;", "ov.setAttribute('style','position:fixed;inset:0;z-index:4000;"]] },
  { id: 'recheck-after-signout', file: 'app/store-firebase.js', want: ['S23b.fast-signin-stays'], sections: ['S23b'],
    edits: [['if (accessLostShown || !refAtLoss || deletingAccount || refAtLoss !== hhRef) return;', 'if (accessLostShown || !refAtLoss || deletingAccount) return;'],
      ["if (err && err.code === 'permission-denied' && refAtLoss === hhRef) showAccessLost();", "if (err && err.code === 'permission-denied') showAccessLost();"]] },
  { id: 'note-not-on-signin', file: 'app/index.html', want: ['S8b.login-signed-out', 'S22.late-says', 'S23.stopped-says'], sections: ['S8b', 'S22', 'S23'],
    edits: [["if(signedOut&&typeof window.LL.signInNote==='function') window.LL.signInNote(", 'if(false) window.LL.signInNote(']] },
  { id: 'stage-forgotten', file: 'app/store-firebase.js', want: ['S23.door-again-says'], sections: ['S23'],
    edits: [['      if (before && STAGE_RANK[before] > STAGE_RANK[stage]) stage = before;\n', '']] },
  { id: 'leave-refusal-final', file: 'app/store-firebase.js', want: ['S24.finishes'], sections: ['S24'],
    edits: [["if ((!out || out.prepare) && refused && refused.code === 'permission-denied' && await refusedHere(leaveRef)) {", 'if (false) {']] },
  { id: 'native-door-popup', file: 'app/store-firebase.js', want: ['S22.native-asked'], sections: ['S22'],
    edits: [['    if (isNativeApp() && nativeAuth()) {\n      return nativeCredential(kind).then(function (cred) { return u.reauthenticateWithCredential(cred); });\n    }\n', '']] },
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

/* Free on every address a URL can reach, as tools/gates.js asks (its PORT_HOSTS): serve.js listens on the
   wildcard address, the checks ask 127.0.0.1, and `localhost` is ::1 first on macOS. There a socket can bind
   127.0.0.1 beside a server on [::], and [::] beside one on 0.0.0.0, so each of the four addresses sees a
   listener the others miss. Asking the wildcard and 127.0.0.1 alone (as before 16 Nov 2026) called a port
   held on 0.0.0.0 free: the temp tree's serve.js then bound beside it, said it was serving, and the stranger
   answered 127.0.0.1 (39 requests in one --self-test run, its control graded on the stranger). An address
   family this machine lacks holds nothing. */
const PORT_HOSTS = [undefined, '0.0.0.0', '127.0.0.1', '::1'];
function portFreeOn(p, host) {
  return new Promise((res) => { const s = net.createServer(); s.once('error', (e) => res(e.code === 'EAFNOSUPPORT' || e.code === 'EADDRNOTAVAIL')); s.listen(host === undefined ? { port: p } : { port: p, host }, () => s.close(() => res(true))); });
}
async function portFree(p) { for (const h of PORT_HOSTS) if (!(await portFreeOn(p, h))) return false; return true; }
/* Inside EMU_PORT_RANGE when one is set (gates.js takes the tree port from the TOP of it, so this searches
   up from the bottom); otherwise a port the OS offers on 127.0.0.1, kept only if it is free at every address. */
async function pickPort() {
  const band = /^(\d+)-(\d+)$/.exec(process.env.EMU_PORT_RANGE || '');
  if (band) { for (let p = Number(band[1]); p <= Number(band[2]); p++) if (await portFree(p)) return p; throw new Error('no free port in EMU_PORT_RANGE ' + band[0]); }
  for (let i = 0; i < 50; i++) {
    const p = await new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const q = s.address().port; s.close(() => res(q)); }); });
    if (await portFree(p)) return p;
  }
  throw new Error('no port the OS offered was free at every address (50 tries)');
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

/* The mutants this tier can judge: each keeps only its sections in the tier, and only the checks those sections
   make. family-ignored is caught by S19 in the tree tier and by S20 in the emulator tier. */
function tierMutants() {
  return ALL_MUTANTS.filter((m) => !PICK.length || PICK.includes(m.id)).map((m) => {
    const sections = m.sections.filter(inTier);
    return Object.assign({}, m, { sections, want: m.want.filter((id) => sections.includes(id.split('.')[0])) });
  }).filter((m) => m.sections.length && m.want.length);
}
async function selfTest(browser) {
  console.log('\nself-test (' + (EMU_TIER ? 'emulator' : 'tree') + ' tier): mutants of the tracker and its hooks, each served from its own temp copy of the tree');
  const MUTANTS = tierMutants();
  if (PICK.length) console.log('  (only ' + MUTANTS.map((m) => m.id).join(', ') + ': a partial self-test, so it cannot pass)');
  const TRACKER = 'app/cubby-track.js';
  const src = fs.readFileSync(path.join(ROOT, TRACKER), 'utf8');
  let caught = 0, bad = 0;
  // Control: an unmutated temp copy passes, so a mutant that fails is failing on its mutation. run() starts with
  // S0.tracker, so a control answered by another server serving another tracker fails there, not silently.
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
    const sections = ONLY.length ? ONLY : Object.keys(SECTIONS).filter(inTier);
    console.log('usage-tracker (' + (EMU_TIER ? 'emulator' : 'tree') + ' tier): ' + BASE + '  sections ' + sections.join(' '));
    // S20-S24 need the Firestore emulator; one serves this run and the self-test's. Only the emulator tier (or an
    // --only that names one of them) starts it, so the tree tier needs neither java nor the emulator jar.
    if (sections.concat(SELF ? tierMutants().flatMap((m) => m.sections) : []).some((k) => EMU_SECTIONS.includes(k))) await startEmulator();
    const R = await run(browser, BASE, ROOT, sections, false);
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
