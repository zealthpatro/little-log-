/* Cubby's own usage events. One tracker for the website, the home-screen app and the iPhone and Android
 * apps (they all run this same web code). Spec: docs/superpowers/specs/2026-11-13-admin-dashboard-design.md §8.
 * Gate: tools/usage_tracker_check.js (the seeded app in Chrome, with --self-test mutants of this file).
 *
 *   cubbyTrack(name, props)         queue one event (checked against app/usage-allowlist.js first)
 *   cubbyTrackScreen(screen)        a screen came up (deduped: a repaint of the same screen is not a view)
 *   cubbyTrackEntry(type, action)   an entry was logged, edited or deleted: the TOOL is recorded, never
 *                                   the entry (no amount, no time, no name, no note)
 *   cubbyTrackAppState(active)      the native shell came to the front or went away
 *   cubbyTrackPushOpened(data)      a notification was tapped: only its kind is recorded
 *   cubbyTrackLinkOpened()          the native shell was opened by a link: the visit says link, never the link
 *   cubbyTrackFlush()               send what may be sent now (tests, and the app after the notice is seen)
 *
 * WHAT IT NEVER DOES. It never sends anything a family typed: every property is from a fixed list, a
 * bounded number or a fixed format, checked here and again on the server. It never awaits on a tap,
 * never throws and never shows an error: telemetry must never cost a parent a tap. It is silent off
 * little-cubby.com (tests use window.__cubbyTrackTest), while her own loss holding is active, and while
 * an account is being deleted. For a signed-in person nothing leaves before her family record has been
 * seen as the server holds it, so a holding set on another phone is known first (store-firebase.js says
 * when). One person's queued events never travel under another person's sign-in.
 *
 * THE SWITCH IS ON THE SERVER. Nothing is sent until today's mode is known for this person, and it is
 * learned with an EMPTY batch. Until USAGE_MODE allows it, /api/usage answers {"mode":"off"}, and this
 * asks again the next day and otherwise sends nothing. In mode "on", linked events also wait until the
 * person has seen the current privacy notice (window.CUBBY_PRIVACY_NOTICE / window.cubbyNoticeSeen).
 * While a notice is published and not yet seen, nothing carries the person's sign-in at all: even the
 * daily ask goes without it, so nothing on the server is linked to her before she has read the card.
 */
(function () {
  'use strict';
  var QKEY = 'cubby-usage-q', DKEY = 'cubby-usage-device', MKEY = 'cubby-usage-mode', VKEY = 'cubby-usage-ver';
  var MAX_Q = 500, BATCH = 50, IDLE_MS = 30 * 60000, ANON_WAIT = 24 * 3600000, TAP_JOIN_MS = 10000;
  var has = function (o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); };
  var A = function () { return window.CUBBY_USAGE_ALLOWLIST || null; };
  var sink = function () { return Array.isArray(window.__cubbyTrackTest) ? window.__cubbyTrackTest : null; };
  var live = function () { return location.hostname === 'little-cubby.com' || !!sink(); };
  var ls = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };

  function rand(n) {
    var a = 'abcdefghijklmnopqrstuvwxyz0123456789', out = '', b = new Uint8Array(n);
    try { crypto.getRandomValues(b); } catch (e) { for (var i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256); }
    for (var j = 0; j < n; j++) out += a[b[j] % 36];
    return out;
  }
  function uuid4() {
    try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    var b = new Uint8Array(16); try { crypto.getRandomValues(b); } catch (e) { for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256); }
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function device() {
    var d = ls.get(DKEY);
    if (!/^d_[a-z0-9]{12}$/.test(d || '')) { d = 'd_' + rand(12); ls.set(DKEY, d); }
    return d;
  }
  function platform() {
    try { var C = window.Capacitor; if (C && C.isNativePlatform && C.isNativePlatform()) return C.getPlatform() === 'android' ? 'android_app' : 'ios_app'; } catch (e) {}
    try { if (window.navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)) return 'home_screen'; } catch (e) {}
    return 'browser';
  }
  /* The number of the service worker cache actually running (little-log-vNNN), learned once. */
  var appVersion = 'v0';
  try {
    if (window.caches && caches.keys) caches.keys().then(function (ks) {
      for (var i = 0; i < ks.length; i++) { var m = /^little-log-v(\d{1,5})$/.exec(ks[i]); if (m) { appVersion = 'v' + m[1]; break; } }
      var prev = ls.get(VKEY);
      if (appVersion !== 'v0') { if (prev && prev !== appVersion) track('app.updated', { from_version: prev, to_version: appVersion }); ls.set(VKEY, appVersion); }
    }).catch(function () {});
  } catch (e) {}

  /* ---- the queue: 500 at most, oldest dropped, each event remembers whose it is ---- */
  function load() { try { var q = JSON.parse(ls.get(QKEY) || '[]'); return Array.isArray(q) ? q : []; } catch (e) { return []; } }
  function save(q) { if (q.length > MAX_Q) q = q.slice(q.length - MAX_Q); ls.set(QKEY, JSON.stringify(q)); }

  /* ---- who ---- */
  // The token is cached for the pagehide batch, which cannot wait for getIdToken(), and it is kept
  // WITH the uid it was issued to: a token fetched for one person that arrives after someone else has
  // signed in is thrown away, never used for the next person's batch.
  var curUid = null, token = '', tokenUid = null, authSeen = false;
  function auth() { return window.LL && window.LL.auth; }
  function tokenFor(uid) { return uid && tokenUid === uid ? token : ''; }
  function whoChanged(next) {
    var q = load(), now = Date.now();
    // Sign-out, or someone else: every event queued under any other person goes, so it can never leave
    // under this sign-in. Unowned events from the last 24 hours (before sign-in, or while sign-in was
    // still being read on this load) go with the person now signed in; older ones are dropped.
    q = q.filter(function (x) { return x.uid ? x.uid === next : (!next || now - x.at <= ANON_WAIT); });
    if (next) q.forEach(function (x) { if (!x.uid) x.uid = next; });
    save(q);
    // Two people on one phone are two devices and two visits: on sign-out or a switch the install id and
    // the visit are both renewed, so nothing the server keeps joins one person's use to the other's.
    // The old visit is not ended under the new person (its events were dropped above).
    var renew = authSeen && curUid && next !== curUid;
    if (renew) { ls.set(DKEY, 'd_' + rand(12)); visit = null; lastScreen = ''; }
    if (next !== curUid) { token = ''; tokenUid = null; }
    curUid = next; authSeen = true;
    if (renew && visible()) startVisit('other', 'warm');
    if (next) refreshToken();
  }
  function refreshToken() {
    try {
      var u = auth() && auth().currentUser;
      if (!u || !curUid || u.uid !== curUid) return Promise.resolve(tokenFor(curUid));
      var forUid = u.uid;
      return Promise.resolve(u.getIdToken()).then(function (t) {
        if (forUid !== curUid) return '';
        token = t || ''; tokenUid = forUid; return token;
      }).catch(function () { return tokenFor(curUid); });
    } catch (e) { return Promise.resolve(tokenFor(curUid)); }
  }
  (function watchAuth(tries) {
    var a = auth();
    if (!a || !a.onAuthStateChanged) { if (tries < 240) setTimeout(function () { watchAuth(tries + 1); }, 500); return; }
    a.onAuthStateChanged(function (u) { try { whoChanged(u ? u.uid : null); } catch (e) {} });
    if (a.onIdTokenChanged) a.onIdTokenChanged(function (u) {
      try { if (u && u.uid === curUid) refreshToken(); else if (!u) { token = ''; tokenUid = null; } } catch (e) {}
    });
  })(0);

  /* ---- silence ---- */
  function lossHeld() { try { return typeof window.myLossHolding === 'function' && !!window.myLossHolding(); } catch (e) { return false; } }
  // Set by store-firebase.js once an account deletion has really started; cleared there if it failed before
  // her usage rows were asked to go, or when she signs out after one that failed later.
  function deleting() { return !!window.__cubbyDeleting; }
  // Her family record as the SERVER holds it (PRIV-4). The app paints from this phone's own copy, which can
  // be a day old, and a loss holding set on another phone arrives only with the server's copy. So for a
  // signed-in person nothing leaves until store-firebase.js names her in window.__cubbyHouseholdSeen (or
  // says '*': a local-only page with no family record at all). Signed out, there is no family record.
  function familySeen() { if (!curUid) return true; var s = window.__cubbyHouseholdSeen; return s === '*' || (!!s && s === curUid); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  // Today's answer, per person. `linked` says it was asked with the person's own sign-in; one learned
  // without it (her notice was not yet seen) is asked again, with it, once it may go.
  function modeFor(who, needLinked) { try { var m = JSON.parse(ls.get(MKEY) || 'null'); return m && m.who === who && m.day === today() && (!needLinked || m.linked) ? m : null; } catch (e) { return null; } }
  function setMode(who, mode, linked) { ls.set(MKEY, JSON.stringify({ who: who, mode: mode, day: today(), linked: !!linked })); }
  function silent() {
    if (!live() || !A()) return true;
    if (lossHeld() || deleting()) return true;
    // Before sign-in nothing is silenced: what is recorded waits on the phone for a sign-in to claim it,
    // and whatever no one claims within 24 hours goes anonymously only in mode on (flush), or nowhere.
    if (!authSeen || !curUid) return false;
    var m = modeFor(curUid, linkOk());
    return !!(m && m.mode === 'off');
  }
  function noticeSeen() { return !!(window.CUBBY_PRIVACY_NOTICE && window.cubbyNoticeSeen === window.CUBBY_PRIVACY_NOTICE); }
  // May a send carry this person's sign-in? Not while a notice is published that she has not seen (G4).
  function linkOk() { return !window.CUBBY_PRIVACY_NOTICE || noticeSeen(); }

  /* ---- the allowlist, checked on the phone ---- */
  // Returns a fresh object holding only the allowlisted keys, or null. The copy is what is checked and
  // what is stored, so nothing the caller passed (an extra key, a getter) can ride along.
  function clean(name, props) {
    var L = A(); if (!L || !has(L.events, name)) return null;
    var spec = L.events[name], want = Object.keys(spec.props), out = {};
    props = props && typeof props === 'object' ? props : {};
    if (Object.keys(props).length !== want.length) return null;
    for (var i = 0; i < want.length; i++) {
      var k = want[i], p = spec.props[k];
      if (!has(props, k)) return null;
      var v = props[k];
      if (p.enum && !(typeof v === 'string' && p.enum.indexOf(v) >= 0)) return null;
      if (p.int && !(typeof v === 'number' && v % 1 === 0 && v >= p.int[0] && v <= p.int[1])) return null;
      if (p.format && !(typeof v === 'string' && new RegExp(L.formats[p.format]).test(v))) return null;
      if (!p.enum && !p.int && !p.format) return null;
      out[k] = v;
    }
    return out;
  }
  // What may go without a token (§8.7): the same rules the server applies before sign-in.
  function anonOk(ev) {
    var L = A(), spec = L && L.events[ev.name];
    return !!(spec && spec.anon && (!spec.anonScreens || spec.anonScreens.indexOf(ev.props && ev.props.screen) >= 0));
  }

  var visit = null, visitAt = 0, lastInput = Date.now(), lastScreen = '', painted = false;
  function visible() { return document.visibilityState !== 'hidden'; }
  function track(name, props) {
    try {
      if (silent()) return;
      var p = clean(name, props);
      if (!p) return;
      if (!visit && name !== 'visit.started' && visible()) startVisit(takeFrom('other'), 'warm');
      var q = load(), now = Date.now();
      q.push({ uid: curUid, at: now, ev: { id: uuid4(), t: now, visit: visit || ('v_' + rand(8)), name: name, props: p } });
      save(q);
      schedule();
    } catch (e) {}
  }

  /* ---- sending ---- */
  var timer = null, sending = false;
  function schedule() { if (!timer) timer = setTimeout(function () { timer = null; flush(false); }, 5000); }
  function envelope(events) {
    var b = { v: 1, tz: (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; } })(),
      device: device(), platform: platform(), app_version: appVersion, events: events };
    if (window.cubbyNativeVersion) b.native_version = String(window.cubbyNativeVersion);
    return b;
  }
  function post(body, tok, final) {
    var s = sink();
    if (s) {
      s.push({ token: tok || null, uid: tok ? curUid : null, final: !!final, body: JSON.parse(JSON.stringify(body)) });
      // The test answers as the server would: a mode word, or a function of (token, body) giving a mode
      // word or { status, mode } (a refusal, a server error).
      var a = window.__cubbyTrackMode;
      try { if (typeof a === 'function') a = a(tok || null, JSON.parse(JSON.stringify(body))); } catch (e) { a = null; }
      if (a && typeof a === 'object') return Promise.resolve({ ok: a.status >= 200 && a.status < 300, status: a.status | 0, json: a.mode ? { mode: a.mode } : null });
      return Promise.resolve({ ok: true, status: 200, json: { mode: a || 'internal' } });
    }
    var h = { 'content-type': 'application/json' };
    if (tok) h.Authorization = 'Bearer ' + tok;
    return fetch('/api/usage', { method: 'POST', keepalive: !!final, headers: h, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, json: j }; }).catch(function () { return { ok: r.ok, status: r.status, json: null }; }); });
  }
  function dropWhere(test) { save(load().filter(function (x) { return !test(x); })); }
  // Unowned events no one signed in to claim within 24 hours: the only ones that may go anonymously.
  function aged(x, now) { return !x.uid && now - x.at > ANON_WAIT; }
  // An "off" answer drops the events of the person it was FOR (captured before the send), never those
  // of whoever is signed in when it lands. Before sign-in it drops only what would have gone anonymously:
  // fresh events still wait for a sign-in, which asks again for that person.
  function dropOff(forUid, now) { dropWhere(function (x) { return forUid ? x.uid === forUid : aged(x, now); }); }

  function flush(final) {
    if (!live() || sending || !A()) return;
    try {
      // Nothing leaves during her own loss holding or an account deletion, and nothing recorded in that
      // time is kept to leave later.
      if (lossHeld() || deleting()) { save([]); return; }
      // Nothing goes until auth has answered (whose events these are), the app has painted once (so a loss
      // holding already in this phone's copy is known), and her family record has been seen as the server
      // holds it (so one set on another phone is known too). Until then the queue waits; when that copy
      // brings a holding, the line above empties it.
      if (!authSeen || !painted || !familySeen()) return;
      var forUid = curUid, who = forUid || 'anon', now = Date.now(), q = load();
      var link = !forUid || linkOk();
      var tok = forUid && link ? tokenFor(forUid) : '';
      if (forUid && link && !tok) { if (!final) refreshToken().then(function (t) { if (t) flush(false); }); return; }
      var mine = forUid ? q.filter(function (x) { return x.uid === forUid; }) : q.filter(function (x) { return aged(x, now); });
      var m = modeFor(who, !!tok);
      if (!m) {
        // Today's mode for this person is learned with an EMPTY batch, so nothing is ever sent to a
        // server that is off. Nothing is learned on the way out: the queue waits for the next open.
        if (final) return;
        sending = true;
        post(envelope([]), tok, false).then(function (r) {
          sending = false;
          var md = r && r.json && r.json.mode;
          if (md !== 'off' && md !== 'internal' && md !== 'on') return;
          setMode(who, md, !!tok);
          if (md === 'off') dropOff(forUid, now);
          else flush(false);
        }, function () { sending = false; });
        return;
      }
      if (m.mode === 'off') { dropOff(forUid, now); return; }
      // Linked events wait for the current notice (G4): always in mode on, and whenever one is published.
      if (forUid && (!link || (m.mode === 'on' && !noticeSeen()))) return;
      if (!forUid) {
        // Unclaimed for 24 hours: what the server takes before sign-in goes, in mode on only; the rest
        // can never go anywhere, so it leaves the queue.
        var go = m.mode === 'on' ? mine.filter(function (x) { return anonOk(x.ev); }) : [], keep = {};
        go.forEach(function (x) { keep[x.ev.id] = 1; });
        if (go.length < mine.length) dropWhere(function (x) { return aged(x, now) && !keep[x.ev.id]; });
        mine = go;
      }
      if (!mine.length) return;
      var batch = mine.slice(0, BATCH), ids = {};
      batch.forEach(function (x) { ids[x.ev.id] = 1; });
      sending = true;
      post(envelope(batch.map(function (x) { return x.ev; })), tok, final).then(function (r) {
        sending = false;
        var md = r && r.json && r.json.mode;
        if (md === 'off' || md === 'internal' || md === 'on') setMode(who, md, !!tok);
        if (md === 'off') { dropOff(forUid, now); return; }
        // Sent, or refused for its shape (a client bug that a retry cannot fix): out of the queue either way.
        if (r && (r.ok || r.status === 400 || r.status === 413)) {
          dropWhere(function (x) { return !!ids[x.ev.id]; });
          if (mine.length > BATCH && !final) schedule();
        }
      }, function () { sending = false; });
      if (!final) refreshToken();
    } catch (e) { sending = false; }
  }

  /* ---- visits ---- */
  var NAV_KEYS = ['go', 'join', 'read', 'stage', 'tab'];
  // How this page was opened. Read from the navigation entry as well as the address bar, because the
  // deep-link stash in index.html tidies ?go= and ?join= away before this file runs, and this file takes
  // the notification marker away itself.
  function openedFrom() {
    try {
      var urls = [location.href];
      try { var n = performance.getEntriesByType('navigation')[0]; if (n && n.name) urls.push(n.name); } catch (e) {}
      for (var i = 0; i < urls.length; i++) {
        var u = new URL(urls[i], location.href), q = u.searchParams;
        if (new URLSearchParams(u.hash.slice(1)).get('from') === 'notification') return 'notification';
        for (var j = 0; j < NAV_KEYS.length; j++) if (q.get(NAV_KEYS[j])) return 'link';
      }
    } catch (e) {}
    return 'icon';
  }
  // A notification tap reaches a page that was not open as /app/#from=notification&nk=<kind> (app/sw.js).
  // The marker rides in the fragment, which is never part of a request: the tap opens the precached
  // /app/ at once, and no server log sees it. Only the kind word is read, and the marker leaves the
  // address bar at once.
  function takeMarker() {
    try {
      var h = new URLSearchParams(location.hash.slice(1));
      if (h.get('from') !== 'notification') return null;
      var k = h.get('nk');
      h.delete('from'); h.delete('nk');
      var rest = h.toString();
      try { history.replaceState(history.state, '', location.pathname + location.search + (rest ? '#' + rest : '')); } catch (e) {}
      return kindOf(k);
    } catch (e) { return null; }
  }
  function kindOf(d) {
    var L = A(), kinds = (L && L.events['push.opened'] && L.events['push.opened'].props.kind.enum) || ['other'];
    try {
      if (typeof d === 'string') return kinds.indexOf(d) >= 0 ? d : 'other';
      d = d || {};
      var tag = String(d.tag || ''), cat = String(d.cat || '');
      // Shapes from worker.js: a dose reminder or the day's digest carries tag med-... or digest-...
      // (and medId when it has a ticket); a campaign carries tag camp-... and its cat.
      var k = (d.medId || /^(med|digest)-/.test(tag)) ? 'medicine' : (cat === 'team_note' || /^note-/.test(tag)) ? 'team_note' : cat;
      return kinds.indexOf(k) >= 0 ? k : 'other';
    } catch (e) { return 'other'; }
  }
  var firstFrom = null, coldUsed = false;
  function takeFrom(dflt) { var f = firstFrom; firstFrom = null; return f || dflt; }
  function startVisit(from, start) {
    if (visit) return;
    visit = 'v_' + rand(8); visitAt = Date.now(); lastInput = visitAt; lastScreen = '';
    if (!coldUsed) { coldUsed = true; start = 'cold'; }
    track('visit.started', { opened_from: from, start: start });
  }
  function endVisit(reason) {
    if (!visit) return;
    // An idle visit ended at the last touch, not 30 minutes of nothing later.
    var until = reason === 'idle' ? lastInput : Date.now();
    var secs = Math.max(0, Math.min(86400, Math.round((until - visitAt) / 1000)));
    track('visit.ended', { seconds: secs, reason: reason });
    visit = null;
    flush(reason !== 'idle');
  }
  // A notification tap or a link that brought Cubby to the front: a visit that just started (from the
  // icon, or the shell's plain "came to the front") is relabelled; a source already named is kept.
  function cameFrom(from) {
    if (!visit) { startVisit(from, 'warm'); return; }
    if (Date.now() - visitAt > TAP_JOIN_MS) return;
    var q = load(), hit = false;
    q.forEach(function (x) { if (x.ev && x.ev.name === 'visit.started' && x.ev.visit === visit && (x.ev.props.opened_from === 'icon' || x.ev.props.opened_from === 'other')) { x.ev.props.opened_from = from; hit = true; } });
    if (hit) save(q);
  }
  function pushOpened(data) {
    var kind = kindOf(data);
    cameFrom('notification');
    track('push.opened', { kind: kind });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') endVisit('hidden'); else startVisit(takeFrom('other'), 'warm');
  });
  window.addEventListener('pagehide', function () { endVisit('hidden'); });
  window.addEventListener('pageshow', function (e) { if (e && e.persisted && visible()) startVisit('other', 'warm'); });
  ['pointerdown', 'keydown'].forEach(function (t) {
    window.addEventListener(t, function () {
      lastInput = Date.now();
      if (!visit && visible()) startVisit(takeFrom('other'), 'warm');
    }, { passive: true, capture: true });
  });
  setInterval(function () { if (visit && Date.now() - lastInput > IDLE_MS) endVisit('idle'); }, 60000);
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.addEventListener) navigator.serviceWorker.addEventListener('message', function (e) {
      try { if (e && e.data && typeof e.data.cubbyNotification === 'string') pushOpened(e.data.cubbyNotification); } catch (x) {}
    });
  } catch (e) {}
  (function () {
    var nk = takeMarker();
    firstFrom = nk ? 'notification' : openedFrom();
    if (visible()) startVisit(takeFrom('icon'), 'cold');
    if (nk) track('push.opened', { kind: nk });
  })();

  /* ---- what the app calls ---- */
  var KIND = { feed: 'feed', sleep: 'sleep', diaper: 'nappy', pump: 'pump', growth: 'growth', medicine: 'medicine',
    temperature: 'health_log', symptom: 'health_log', visit: 'health_log', vaccine: 'vaccines',
    milestone: 'moments', activity: 'moments', note: 'note', photo: 'photos' };
  window.cubbyTrack = track;
  window.cubbyTrackScreen = function (screen) {
    try { painted = true; if (!screen || screen === lastScreen) return; lastScreen = screen; track('screen.viewed', { screen: screen }); } catch (e) {}
  };
  window.cubbyTrackEntry = function (type, action) {
    try { var f = has(KIND, type) ? KIND[type] : null; if (f) track('feature.used', { feature: f, action: action }); } catch (e) {}
  };
  window.cubbyTrackAppState = function (active) {
    try { if (active) startVisit(takeFrom('other'), 'warm'); else endVisit('hidden'); } catch (e) {}
  };
  window.cubbyTrackPushOpened = function (data) { try { pushOpened(data); } catch (e) {} };
  window.cubbyTrackLinkOpened = function () { try { cameFrom('link'); } catch (e) {} };
  window.cubbyTrackFlush = function () { flush(false); };
  // The app can paint before this file runs (it loads after store-firebase.js): render() leaves what it
  // drew in window.__cubbyScreen, so the first screen is not lost.
  try { if ('__cubbyScreen' in window) window.cubbyTrackScreen(window.__cubbyScreen); } catch (e) {}
})();
