#!/usr/bin/env node
/* Chaos: seeded, multi-phone family sessions against the REAL app, the REAL rules and the Firestore +
 * Auth emulators, with the invariants a parent relies on checked after every step.
 *
 *   node tools/chaos.js [--seed=N] [--minutes=20] [--out=DIR]      run sessions until the time box ends
 *   node tools/chaos.js --replay=FILE                               re-run one saved action list (a repro):
 *       exit 0 CLEAN, 1 REPRODUCED (the saved signature broke again), 2 OTHER VIOLATIONS (something else
 *       broke); the last line is always "REPLAY: CLEAN|REPRODUCED|OTHER" (tools/nightly_report.js reads it)
 *   node tools/chaos.js --self-test                                 serve the app with a planted lost-write
 *       bug (diaper entries never leave the phone), and fail unless a session catches it, the flake check
 *       calls it real, and the shrinker cuts the list down to the actions that matter; then a member whose
 *       sign-in is ten minutes old deletes her account (her phone signs in again first, as a parent is asked to),
 *       and the same deletion without that sign-in must be refused; Olive on two phones removes Nina and then
 *       deletes her own account, and the same exit with the goodbye under the sign-in screen and the old pointer
 *       write (a merge) must be caught twice; then run the same script against the real app and fail if anything
 *       is broken there
 *
 * A session is one family: Olive (owner), sometimes her own second phone, and newcomers who join by link
 * or answer an email invite (yes or no). Then a seeded mix of what families do: log a feed, a sleep, a
 * nappy; edit and delete entries; add, change and remove a medicine and a milestone; start and stop the
 * sleep timer; go offline for a while; reload in the middle of a save; a phone whose clock is hours or
 * days out (set before boot, with evaluateOnNewDocument); two phones acting inside the same 350 ms; the
 * owner removing someone; a member deleting her account; and a look at a tab at 320 px.
 *
 * INVARIANTS, after every step (S) or at every checkpoint, when all phones are online and settled (C):
 *   S  no page error and no unhandled promise rejection on any phone
 *   S  no permission-denied for a legitimate action (a member's own save, under the real rules)
 *   S  no loading overlay up for more than 12 s while the phone is online
 *   S  no sideways scroll at 320 px on the screen visited
 *   C  every acknowledged edit is on the server and on every member's phone within the settle window
 *      (an entry, its edit, its delete; the baby; a medicine; a milestone; a running timer)
 *   C  nothing a member wrote is lost by another member's save (the generator never lets two phones
 *      touch the SAME item between checkpoints, except in a race, so every expectation is exact)
 *   C  a removed member can read nothing: the household and its entries refuse her, from the server; and her
 *      own user record says she has no family and remembers the one she lost
 *   S  a member who has deleted her account (through the app's own Delete) is no longer in the family, on the
 *      server; the goodbye is what she sees (the element at the centre of her screen); and her user record is
 *      gone, and stays gone once her other phones have reacted
 *
 * On a failure the whole action list is re-run three times. Seen in 2 of 3 or more it is REAL, and is
 * shrunk (delta debugging, dependencies kept) to the shortest list that still breaks the same invariant,
 * saved as chaos-failures/<seed>.json, and given a one-line repro. Otherwise it is recorded as a FLAKE,
 * with its counts. App bugs are reported, never fixed here.
 *
 * Self-hosting, like test/circle-manage.test.js: FS_PORT, AUTH_PORT, WEB_PORT, HUB_PORT, LOG_PORT,
 * WS_PORT (tools/gates.js hands them free). Chrome is headless, every profile fresh, downloads go to a
 * temp dir (tools/gate_downloads.js), and every host but localhost is unresolvable.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ARGS = process.argv.slice(2);
const arg = (k, d) => { const a = ARGS.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const SELF = ARGS.includes('--self-test');
const SEED = Number(arg('seed', SELF ? 1311 : Math.floor(Date.now() / 1000) % 1e8));
const MINUTES = Number(arg('minutes', 20));
/* Real runs save under chaos-failures/ (gitignored AND assetsignored: the repo is public and an open bug
   is not published before it is fixed). The self-test writes to a temp dir, so a gate leaves no file behind. */
const OUT = arg('out', SELF ? path.join(os.tmpdir(), 'cubby-chaos-selftest') : path.join(ROOT, 'chaos-failures'));
const REPLAY = arg('replay', null);
const FS_PORT = Number(process.env.FS_PORT) || 8767;
const AUTH_PORT = Number(process.env.AUTH_PORT) || 9767;
const WEB_PORT = Number(process.env.WEB_PORT) || 8768;
const HUB_PORT = Number(process.env.HUB_PORT) || 0, LOG_PORT = Number(process.env.LOG_PORT) || 0, WS_PORT = Number(process.env.WS_PORT) || 0;
const EXEC_PROJECT = 'demo-cubby-chaos';
const PAGE_PROJECT = 'little-log-a9caa';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PW = 'emulator-only-pw-chaos';
const DAY = 86400000;

/* ---------- outer phase: emulators up with the real rules, then re-run ourselves inside them ---------- */
if (!process.env.CHAOS_INNER) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-chaos-'));
  fs.copyFileSync(process.env.RULES_FILE || path.join(ROOT, 'firestore.rules'), path.join(scratch, 'firestore.rules'));
  fs.writeFileSync(path.join(scratch, 'firebase.json'), JSON.stringify({
    firestore: { rules: 'firestore.rules' },
    emulators: Object.assign({ firestore: Object.assign({ port: FS_PORT }, WS_PORT ? { websocketPort: WS_PORT } : {}), auth: { port: AUTH_PORT }, ui: { enabled: false } },
      HUB_PORT ? { hub: { port: HUB_PORT } } : {}, LOG_PORT ? { logging: { port: LOG_PORT } } : {}),
  }));
  const firebaseBin = path.join(ROOT, 'test', 'node_modules', '.bin', 'firebase');
  const javaBin = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin') : '/opt/homebrew/opt/openjdk/bin';
  const env = Object.assign({}, process.env, { CHAOS_INNER: '1', PATH: javaBin + ':' + process.env.PATH });
  try {
    execFileSync(firebaseBin, ['emulators:exec', '--only', 'firestore,auth', '--project', EXEC_PROJECT, '--config', path.join(scratch, 'firebase.json'),
      'node ' + JSON.stringify(__filename) + ' ' + ARGS.map((a) => JSON.stringify(a)).join(' ')], { cwd: scratch, env, stdio: 'inherit' });
  } catch (e) { process.exitCode = e.status || 1; }
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) {}
  return;
}

/* ---------- small things ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function rng(seed) {
  let a = seed >>> 0;
  const r = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.int = (n) => Math.floor(r() * n); r.pick = (xs) => xs[r.int(xs.length)]; r.chance = (p) => r() < p;
  return r;
}
const FS_DOCS = `http://localhost:${FS_PORT}/v1/projects/${PAGE_PROJECT}/databases/(default)/documents/`;
const ADMIN = { 'content-type': 'application/json', authorization: 'Bearer owner' };
function fromValue(v) {
  if (!v || typeof v !== 'object') return v;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return new Date(v.timestampValue).getTime();
  if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(fromValue);
  if ('mapValue' in v) { const o = {}; const f = (v.mapValue && v.mapValue.fields) || {}; Object.keys(f).forEach((k) => { o[k] = fromValue(f[k]); }); return o; }
  return v;
}
async function adminGet(p) {
  const r = await fetch(FS_DOCS + p, { headers: ADMIN });
  if (r.status === 404) return null;
  const j = await r.json();
  return fromValue({ mapValue: { fields: j.fields || {} } });
}
async function adminList(p) {
  const out = []; let tok = '';
  for (let i = 0; i < 20; i++) {
    const r = await fetch(FS_DOCS + p + '?pageSize=300' + (tok ? '&pageToken=' + encodeURIComponent(tok) : ''), { headers: ADMIN });
    const j = await r.json().catch(() => ({}));
    (j.documents || []).forEach((d) => out.push(fromValue({ mapValue: { fields: d.fields || {} } })));
    if (!j.nextPageToken) break; tok = j.nextPageToken;
  }
  return out;
}
async function makeAccount(email) {
  const r = await fetch(`http://localhost:${AUTH_PORT}/identitytoolkit.googleapis.com/v1/projects/${process.env.GCLOUD_PROJECT || EXEC_PROJECT}/accounts`,
    { method: 'POST', headers: ADMIN, body: JSON.stringify({ email, password: PW, emailVerified: true }) });
  const j = await r.json().catch(() => ({}));
  if (!j.localId) throw new Error('could not make the emulator account for ' + email + ': ' + JSON.stringify(j).slice(0, 200));
  return j.localId;
}

/* ---------- the web server: this checkout, byte for byte, except a planted file in the self-test ---------- */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.wasm': 'application/wasm' };
let OVERRIDE = {};
function startWeb() {
  return new Promise((res) => {
    const srv = http.createServer((req, resp) => {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      // A planted page answers its folder's URL too: the phones open /app/, not /app/index.html.
      const key = OVERRIDE[p] !== undefined ? p : (p.endsWith('/') && OVERRIDE[p + 'index.html'] !== undefined ? p + 'index.html' : null);
      if (key) { resp.writeHead(200, { 'content-type': TYPES[path.extname(key)] || 'text/plain', 'cache-control': 'no-store' }); resp.end(OVERRIDE[key]); return; }
      let fp = path.join(ROOT, p);
      if (!fp.startsWith(ROOT)) { resp.writeHead(403); resp.end(); return; }
      try { if (fs.statSync(fp).isDirectory()) fp = path.join(fp, 'index.html'); } catch (e) {}
      fs.readFile(fp, (err, data) => {
        if (err) { resp.writeHead(404, { 'content-type': 'text/plain' }); resp.end('404'); return; }
        resp.writeHead(200, { 'content-type': TYPES[path.extname(fp)] || 'application/octet-stream', 'cache-control': 'no-store' });
        resp.end(data);
      });
    });
    srv.listen(WEB_PORT, () => res(srv));
  });
}

/* ---------- THE GENERATOR: a seeded family session as a plain list of actions ---------- */
const NEWCOMERS = ['nina', 'paul', 'rosa'];
function generate(seed, steps) {
  const r = rng(seed);
  const A = [];
  const id = () => 'L' + (A.length + 1);
  /* Most boots wait until the baby is on the server before Olive names herself. One in five names herself
     inside the same 350 ms save window, the way a quick first-run wizard can, so that order is exercised too. */
  /* Each phone's colour scheme is seeded too (one in four is in dark mode, which turns Cubby's night
     theme on), so night is exercised on purpose and a replay is the same whatever this Mac's own
     appearance is at the hour it runs. It used to follow the host: macOS's automatic dark mode after
     sunset changed what the 320 px check saw. */
  const dark = () => (r.chance(0.25) ? { dark: true } : {});
  A.push(Object.assign({ a: 'boot', who: 'olive', n: id() }, r.chance(0.2) ? { rushName: true } : {}, dark()));
  const members = ['olive'];
  if (r.chance(0.5)) { A.push(Object.assign({ a: 'second', who: 'olive2', skewMs: r.chance(0.3) ? r.pick([-3, 5, 26]) * 3600000 : 0, n: id() }, dark())); members.push('olive2'); }
  const pending = [];
  for (const nc of NEWCOMERS) {
    if (!r.chance(nc === 'nina' ? 0.95 : 0.5)) continue;
    const skewMs = r.chance(0.3) ? r.pick([-2 * DAY, -5 * 3600000, 7 * 3600000, 3 * DAY]) : 0;
    if (r.chance(0.6)) { A.push({ a: 'inviteLink', who: 'olive', for: nc, n: id() }); pending.push(Object.assign({ a: 'joinLink', who: nc, skewMs }, dark())); }
    else { A.push({ a: 'inviteEmail', who: 'olive', for: nc, n: id() }); pending.push(Object.assign({ a: 'answerEmail', who: nc, yes: r.chance(0.8), skewMs }, dark())); }
  }
  pending.forEach((p) => { p.n = id(); A.push(p); if (p.a === 'joinLink' || p.yes) members.push(p.who); });
  A.push({ a: 'settle', n: id() });
  const items = { log: [], med: [], ms: [] };
  const live = members.slice();
  let since = 0;
  const offline = new Set();
  const lockedThisSegment = new Set();        // item ids already touched by some phone since the last settle
  const who = () => r.pick(live);
  const canTouch = (it, w) => !lockedThisSegment.has(it.n) || it.lock === w;
  const touch = (it, w) => { lockedThisSegment.add(it.n); it.lock = w; };
  for (let s = 0; s < steps; s++) {
    const k = r.int(100);
    const w = who();
    let act = null;
    if (k < 22) { const kind = r.pick(['feed', 'sleep', 'diaper']); act = { a: 'log', who: w, kind, note: 'n' + s }; items.log.push({ n: null, author: w, lock: w }); }
    else if (k < 30 && items.log.length) { const it = r.pick(items.log); const ok = (it.author === w || w.startsWith('olive')) && canTouch(it, w) && !it.deleted; if (ok) { act = { a: 'editLog', who: w, ref: it.n, note: 'e' + s }; touch(it, w); } }
    else if (k < 35 && items.log.length) { const it = r.pick(items.log); const ok = (it.author === w || w.startsWith('olive')) && canTouch(it, w) && !it.deleted; if (ok) { act = { a: 'delLog', who: w, ref: it.n }; touch(it, w); it.deleted = true; } }
    else if (k < 43) { act = { a: 'addMed', who: w, name: 'Med ' + s }; items.med.push({ n: null, lock: w }); }
    else if (k < 47 && items.med.length) { const it = r.pick(items.med); if (canTouch(it, w) && !it.deleted) { act = { a: 'editMed', who: w, ref: it.n, dose: String(1 + r.int(9)) }; touch(it, w); } }
    else if (k < 50 && items.med.length) { const it = r.pick(items.med); if (canTouch(it, w) && !it.deleted) { act = { a: 'delMed', who: w, ref: it.n }; touch(it, w); it.deleted = true; } }
    else if (k < 55) { act = { a: 'addMilestone', who: w, title: 'Moment ' + s }; items.ms.push({ n: null, lock: w }); }
    else if (k < 58 && items.ms.length) { const it = r.pick(items.ms); if (canTouch(it, w) && !it.deleted) { act = { a: 'delMilestone', who: w, ref: it.n }; touch(it, w); it.deleted = true; } }
    else if (k < 63) { if (!lockedThisSegment.has('timer')) { act = { a: r.chance(0.5) ? 'timerStart' : 'timerStop', who: w }; lockedThisSegment.add('timer'); } }
    else if (k < 69) { if (!offline.has(w)) { act = { a: 'offline', who: w }; offline.add(w); } else { act = { a: 'online', who: w }; offline.delete(w); } }
    else if (k < 74) { act = { a: 'reloadMidSave', who: w, kind: r.pick(['feed', 'diaper']), note: 'r' + s, delayMs: r.pick([40, 120, 600]) }; items.log.push({ n: null, author: w, lock: w }); }
    else if (k < 80 && live.length > 1) {
      const x = r.pick(live), others = live.filter((y) => y !== x), y = r.pick(others);
      const kind = r.pick(['addMed', 'log', 'addMilestone']);
      act = { a: 'race', who: x, other: y, kind, label: 'race ' + s, delayMs: r.int(200) };
      if (kind === 'addMed') { items.med.push({ n: null, lock: x }); items.med.push({ n: null, lock: y }); }
      else if (kind === 'log') { items.log.push({ n: null, author: x, lock: x }); items.log.push({ n: null, author: y, lock: y }); }
      else { items.ms.push({ n: null, lock: x }); items.ms.push({ n: null, lock: y }); }
    }
    else if (k < 88) { act = { a: 'visit', who: w, tab: r.pick(['home', 'log', 'health', 'album']), w320: r.chance(0.6) }; }
    else if (k < 91) { const t = live.filter((y) => !y.startsWith('olive')); if (t.length) { const x = r.pick(t); act = { a: 'remove', who: 'olive', target: x }; live.splice(live.indexOf(x), 1); offline.delete(x); } }
    else if (k < 93) { const t = live.filter((y) => !y.startsWith('olive')); if (t.length) { const x = r.pick(t); act = { a: 'deleteAccount', who: x }; live.splice(live.indexOf(x), 1); offline.delete(x); } }
    if (!act) continue;
    act.n = id();
    // Items created by this action get the action's id as their handle, so later actions can name them.
    /* And they are locked to the phone that made them until the next settle. Without that, the first 22-
       minute run (2026-11-13) had Olive's second phone delete an entry Olive had made 2 actions earlier,
       before it could have reached that phone, and blamed the app for not showing it: 23 violations in
       one session, all the harness's. A new item is no other phone's business until a checkpoint. */
    const last = (xs, cnt) => xs.slice(-cnt).forEach((it, i) => { if (it.n === null) { it.n = act.n + (cnt > 1 ? '.' + i : ''); lockedThisSegment.add(it.n); } });
    if (act.a === 'log' || act.a === 'reloadMidSave') last(items.log, 1);
    if (act.a === 'addMed') last(items.med, 1);
    if (act.a === 'addMilestone') last(items.ms, 1);
    if (act.a === 'race') last(act.kind === 'addMed' ? items.med : act.kind === 'log' ? items.log : items.ms, 2);
    A.push(act);
    since++;
    if (since >= 6 || r.chance(0.08)) { A.push({ a: 'settle', n: id() }); since = 0; lockedThisSegment.clear(); offline.clear(); }
  }
  A.push({ a: 'settle', n: id(), final: true });
  return A;
}

/* The generator's promise, which every "converge" verdict leans on: between two checkpoints an item is
   touched only by the phone that made it (or the one phone that locked it). Counted over many seeds in
   the self-test, and once against a generator with the lock taken out, which must break it. */
function crossTouches(gen, seeds) {
  let bad = 0;
  for (let k = 1; k <= seeds; k++) {
    const s = 20261113000 + k, A = gen(s, 18 + rng(s).int(14));
    let owner = {};
    for (const a of A) {
      if (a.a === 'settle') { owner = {}; continue; }
      if (['log', 'reloadMidSave', 'addMed', 'addMilestone'].includes(a.a)) owner[a.n] = a.who;
      if (a.a === 'race') { owner[a.n + '.0'] = a.who; owner[a.n + '.1'] = a.other; }
      if (a.ref && owner[a.ref] && owner[a.ref] !== a.who) bad++;
    }
  }
  return bad;
}

const sigFor = (inv, detail) => inv + ':' + String(detail).replace(/\b(olive2?|nina|paul|rosa)\b/g, '@').replace(/[0-9a-f]{6,}|\d+/gi, '#').slice(0, 60);

/* ---------- THE RUNNER: one session, one action list, a list of violations ---------- */
let browser = null, puppeteer = null, dl = null;
async function ensureBrowser() {
  if (browser && browser.connected) return browser;
  puppeteer = puppeteer || require(path.join(ROOT, 'tools', 'node_modules', 'puppeteer-core'));
  dl = dl || require(path.join(ROOT, 'tools', 'gate_downloads.js'));
  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', downloadBehavior: dl.downloadBehavior(), protocolTimeout: 120000,
    args: ['--no-sandbox', '--disable-gpu', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1'] });
  return browser;
}
const appUrl = (q) => `http://localhost:${WEB_PORT}/app/?fsemu=${FS_PORT}&authemu=${AUTH_PORT}${q || ''}`;
/* Installed before any of the app's own scripts: the phone's clock, a copy of every toast, every
   unhandled rejection, and how long the loading overlay has been up. */
function PRELUDE(skew) {
  if (skew) {
    const D = Date;
    function FD(...a) { if (!(this instanceof FD)) return D(); return a.length ? new D(...a) : new D(D.now() + skew); }
    FD.prototype = D.prototype; FD.now = () => D.now() + skew; FD.parse = D.parse; FD.UTC = D.UTC;
    window.Date = FD;
  }
  window.__toasts = []; window.__unh = []; window.__loader = { since: 0, worst: 0 }; window.__offline = false;
  window.addEventListener('unhandledrejection', (e) => { try { const r = e.reason; window.__unh.push(String((r && (r.code || r.message)) || r).slice(0, 200)); } catch (x) {} });
  document.addEventListener('DOMContentLoaded', () => {
    try { const t = window.toast; if (typeof t === 'function' && !t.__w) { const w = function (m) { window.__toasts.push(String(m)); return t.apply(this, arguments); }; w.__w = 1; window.toast = w; } } catch (e) {}
    const realNow = () => performance.now();
    new MutationObserver(() => {
      const up = !!document.getElementById('loaderOv');
      const L = window.__loader;
      if (up && !L.since) L.since = realNow();
      if (!up && L.since) { if (!window.__offline) L.worst = Math.max(L.worst, realNow() - L.since); L.since = 0; }
    }).observe(document.documentElement, { childList: true, subtree: true });
  });
}

async function runSession(actions, opts) {
  opts = opts || {};
  const sid = (opts.tag || 's') + crypto.randomBytes(3).toString('hex');
  const V = [];                       // violations
  const steps = [];
  const phones = {};                  // name -> { page, ctx, email, uid, member, removed, gone, online, skew }
  const reg = {};                     // logical handle -> real id
  const model = { logs: {}, meds: {}, ms: {}, babies: {}, babyId: null, timer: null, timerBy: null };
  const tokens = {};
  let hid = null;
  /* The signature is WHAT broke, not who it happened to. Names, ids and numbers are folded out, so the
     same broken invariant seen on a different phone in a re-run is one finding, and the flake check
     counts it as the same one (the self-test proves the two halves of one seeded race share a
     signature, and that the old name-bearing signature split them). */
  let curStep = null;                 // the action running now, so a violation inside it names it
  const violate = (inv, detail, step) => { V.push({ inv, detail: String(detail).slice(0, 400), step: step || curStep || null, sig: sigFor(inv, detail) }); };
  const b = await ensureBrowser();
  const emailOf = (w) => w.replace(/2$/, '') + '.' + sid + '@chaos.test';

  const open = async (w, skew, query, existing, dark) => {
    const ctx = await b.createBrowserContext({ downloadBehavior: dl.downloadBehavior() });
    const page = await ctx.newPage();
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }]);
    const P = { page, ctx, email: emailOf(w), member: false, removed: false, gone: false, online: true, skew: skew || 0, errs: [], denied: [] };
    page.on('pageerror', (e) => P.errs.push(String(e.message || e).slice(0, 200)));
    page.on('console', (m) => { const t = m.text(); if (/permission-denied|Missing or insufficient permissions/i.test(t)) P.denied.push(t.slice(0, 200)); });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await page.evaluateOnNewDocument(PRELUDE, skew || 0);
    await page.goto(appUrl(query), { waitUntil: 'networkidle2', timeout: 45000 });
    await page.waitForFunction(() => !!(window.LL && window.LL.auth && window.LL.auth.signInWithEmailAndPassword), { timeout: 20000 });
    if (!existing) await makeAccount(P.email);
    await page.evaluate((e, p) => window.LL.auth.signInWithEmailAndPassword(e, p).then(() => true), P.email, PW);
    phones[w] = P;
    return P;
  };
  const booted = async (P, ms) => {
    try { await P.page.waitForFunction(() => !!(window.LL && window.LL.householdId && typeof state !== 'undefined' && !document.getElementById('llAuthOv')), { timeout: ms || 40000 }); return true; }
    catch (e) { return false; }
  };
  const who = (P) => P.page.evaluate(() => ({ uid: window.LL.auth.currentUser && window.LL.auth.currentUser.uid, hid: window.LL.householdId || null, role: window.LL.role || null }));
  const setName = (P, name) => P.page.evaluate((name) => {
    const uid = window.LL.auth.currentUser.uid;
    return window.LL.db.doc('households/' + window.LL.householdId).update({ ['memberInfo.' + uid + '.setupDone']: true, ['memberInfo.' + uid + '.name']: name }).then(() => 'ok', (e) => e && e.code);
  }, name);
  const waitSheet = async (P, ms) => { try { await P.page.waitForFunction(() => { const s = document.getElementById('sheet'); return !!(s && s.classList.contains('show') && /Join the family/.test(s.innerText)); }, { timeout: ms || 25000 }); return true; } catch (e) { return false; } };
  const tap = (P, label) => P.page.evaluate((l) => { const x = [...document.querySelectorAll('#sheet button')].find((y) => y.textContent.trim() === l); if (!x) return false; x.click(); return true; }, label);
  const usable = (w) => phones[w] && phones[w].member && !phones[w].removed && !phones[w].gone;

  /* What each kind of action does, through the app's own globals and save path (persist -> pushNow). */
  const doLog = (P, kind, note) => P.page.evaluate((kind, note) => {
    const t = Date.now();
    const ev = { type: kind, time: t, notes: note, authorId: window.LL.auth.currentUser.uid };
    if (kind === 'feed') { ev.method = 'bottle'; ev.amount = 90; }
    if (kind === 'sleep') { ev.time = t - 1800000; ev.end = t; }
    if (kind === 'diaper') ev.kind = 'wet';
    return addEvent(ev);
  }, kind, note);
  const doAddMed = (P, name) => P.page.evaluate((name) => { const m = { id: uid(), name, dose: '5', unit: 'ml', babyId: state.activeBabyId, createdAt: Date.now(), pattern: { type: 'asNeeded' } }; state.meds.push(m); persist(); return m.id; }, name);
  const doAddMs = (P, title) => P.page.evaluate((title) => { const a = { id: uid(), babyId: state.activeBabyId, key: 'custom-' + uid(), title, cat: 'Custom', achievedAt: Date.now(), note: '' }; state.milestones.push(a); persist(); return a.id; }, title);

  const record = (kind, handle, realId, by, extra) => {
    reg[handle] = realId;
    const bag = kind === 'log' ? model.logs : kind === 'med' ? model.meds : model.ms;
    bag[realId] = Object.assign({ handle, by, deleted: false }, extra || {});
  };

  const step = async (act) => {
    const P = phones[act.who];
    switch (act.a) {
      case 'boot': {
        const O = await open('olive', 0, '', false, act.dark);
        if (!(await booted(O))) { violate('boot', 'the owner never booted into a family of her own'); return 'fatal'; }
        const w = await who(O); O.uid = w.uid; O.member = true; hid = w.hid;
        const babyId = await O.page.evaluate(() => {
          state.babies = [{ id: 'b' + Math.random().toString(36).slice(2, 7), name: 'Pip', birth: Date.now() - 40 * 86400000, sex: 'M', routines: [], doctors: [], allergies: [] }];
          state.activeBabyId = state.babies[0].id; persist();
          return state.babies[0].id;
        });
        /* The baby is an acknowledged edit like any other, checked at every checkpoint. Until 14 Nov the boot
           named Olive straight after persist() and never checked the baby, so sessions could run on a household
           with no baby on the server, and two "timer" findings came from that. Now boot waits until the server
           holds the baby, unless the action asks for the rushed order (one boot in five), and a baby that is
           missing is reported as itself. */
        model.babies[babyId] = { handle: act.n, by: 'olive' }; model.babyId = babyId; reg[act.n] = babyId;
        if (!act.rushName) {
          for (const stop = Date.now() + 15000; Date.now() < stop; await sleep(250)) {
            const hh = await adminGet('households/' + hid).catch(() => null);
            if (hh && hh.app && (hh.app.babies || []).some((x) => x && x.id === babyId)) break;
          }
        }
        await setName(O, 'Olive');
        await sleep(1200);
        return 'ok';
      }
      case 'second': {
        if (!usable('olive')) return 'skip';
        const S = await open('olive2', act.skewMs, '', true, act.dark);
        S.email = phones.olive.email;
        if (!(await booted(S))) { violate('boot', 'Olive\'s second phone (clock ' + act.skewMs / 3600000 + ' h) never booted'); return 'ok'; }
        const w = await who(S); S.uid = w.uid; S.member = w.hid === hid;
        if (!S.member) violate('boot', 'Olive\'s second phone booted into a different family: ' + w.hid);
        return 'ok';
      }
      case 'inviteLink': {
        if (!usable('olive')) return 'skip';
        const l = await P.page.evaluate(() => window.LL.createInviteLink({ role: 'caregiver', relationship: 'Auntie' }).then((x) => x, (e) => ({ err: e && (e.code || e.message) })));
        if (!l || !l.token) { violate('legit-denied', 'the owner could not make an invite link: ' + JSON.stringify(l)); return 'ok'; }
        tokens[act.for] = l.token; return 'ok';
      }
      case 'inviteEmail': {
        if (!usable('olive')) return 'skip';
        const r = await P.page.evaluate((email) => {
          const u = window.LL.auth.currentUser;
          return Promise.all([
            window.LL.db.collection('invites').doc(email).set({ householdId: window.LL.householdId, role: 'caregiver', relationship: 'Granny', name: '', invitedBy: u.uid, status: 'pending', fromEmail: u.email.toLowerCase(), invitedByName: 'Olive' }),
            window.LL.db.doc('households/' + window.LL.householdId).update(new firebase.firestore.FieldPath('pendingInvites', email), { name: '', relationship: 'Granny', role: 'caregiver', at: Date.now() }),
          ]).then(() => 'ok', (e) => e && e.code);
        }, emailOf(act.for));
        if (r !== 'ok') violate('legit-denied', 'the owner could not invite by email: ' + r);
        tokens[act.for] = 'email'; return 'ok';
      }
      case 'joinLink': {
        if (!tokens[act.who] || tokens[act.who] === 'email') return 'skip';
        const N = await open(act.who, act.skewMs, '&join=' + encodeURIComponent(tokens[act.who]), false, act.dark);
        if (!(await booted(N, 45000))) { violate('join', act.who + ' (clock ' + Math.round(act.skewMs / 3600000) + ' h) never booted after opening the link'); N.gone = true; return 'ok'; }
        const w = await who(N); N.uid = w.uid;
        if (w.hid !== hid) { violate('join', act.who + ' (clock ' + Math.round(act.skewMs / 3600000) + ' h) opened the link and landed in ' + w.hid + ', not the family'); N.gone = true; return 'ok'; }
        N.member = true; await setName(N, act.who); return 'ok';
      }
      case 'answerEmail': {
        if (tokens[act.who] !== 'email') return 'skip';
        const N = await open(act.who, act.skewMs, '', false, act.dark);
        if (!(await waitSheet(N))) { violate('join', act.who + ' (clock ' + Math.round(act.skewMs / 3600000) + ' h) was never asked about the invite'); N.gone = true; return 'ok'; }
        await tap(N, act.yes ? 'Join the family' : 'Start my own Cubby');
        if (!(await booted(N, 45000))) { violate('join', act.who + ' never booted after answering ' + (act.yes ? 'yes' : 'no')); N.gone = true; return 'ok'; }
        const w = await who(N); N.uid = w.uid;
        if (act.yes && w.hid !== hid) { violate('join', act.who + ' said yes and is not in the family'); N.gone = true; return 'ok'; }
        if (!act.yes && w.hid === hid) { violate('join', act.who + ' said no and was joined anyway'); }
        if (act.yes) { N.member = true; await setName(N, act.who); } else N.gone = true;
        return 'ok';
      }
      case 'log': {
        if (!usable(act.who)) return 'skip';
        const id = await doLog(P, act.kind, act.note);
        record('log', act.n, id, act.who, { note: act.note, kind: act.kind });
        return 'ok';
      }
      case 'editLog': case 'delLog': {
        const id = reg[act.ref];
        if (!usable(act.who) || !id || !model.logs[id] || model.logs[id].deleted || model.logs[id].unknown) return 'skip';
        const r = await P.page.evaluate((id, del, note) => {
          const e = state.events.find((x) => x.id === id); if (!e) return 'missing';
          if (del) { e.deleted = true; e.deletedBy = window.LL.auth.currentUser.uid; e.deletedAt = Date.now(); }
          else { e.notes = note; e.editedBy = window.LL.auth.currentUser.uid; e.editedAt = Date.now(); }
          persist(); return 'ok';
        }, id, act.a === 'delLog', act.note || '');
        if (r === 'missing') { if (model.logs[id].settled) violate('converge', act.who + ' cannot see entry ' + act.ref + ' (made by ' + model.logs[id].by + ') that the last checkpoint saw on every phone'); return 'skip'; }
        if (act.a === 'delLog') model.logs[id].deleted = true; else model.logs[id].note = act.note;
        return 'ok';
      }
      case 'addMed': { if (!usable(act.who)) return 'skip'; record('med', act.n, await doAddMed(P, act.name), act.who, { dose: '5' }); return 'ok'; }
      case 'editMed': case 'delMed': {
        const id = reg[act.ref];
        if (!usable(act.who) || !id || !model.meds[id] || model.meds[id].deleted) return 'skip';
        const r = await P.page.evaluate((id, del, dose) => {
          const m = state.meds.find((x) => x.id === id); if (!m) return 'missing';
          if (del) state.meds = state.meds.filter((x) => x.id !== id); else m.dose = dose;
          persist(); return 'ok';
        }, id, act.a === 'delMed', act.dose || '');
        if (r === 'missing') { if (model.meds[id].settled) violate('converge', act.who + ' cannot see medicine ' + act.ref + ' that the last checkpoint saw on every phone'); return 'skip'; }
        if (act.a === 'delMed') model.meds[id].deleted = true; else model.meds[id].dose = act.dose;
        return 'ok';
      }
      case 'addMilestone': { if (!usable(act.who)) return 'skip'; record('ms', act.n, await doAddMs(P, act.title), act.who); return 'ok'; }
      case 'delMilestone': {
        const id = reg[act.ref];
        if (!usable(act.who) || !id || !model.ms[id] || model.ms[id].deleted) return 'skip';
        await P.page.evaluate((id) => { state.milestones = state.milestones.filter((x) => x.id !== id); persist(); }, id);
        model.ms[id].deleted = true; return 'ok';
      }
      case 'timerStart': {
        if (!usable(act.who)) return 'skip';
        /* The sleep timer belongs to a baby; with none on this phone the app offers no timer, so neither does this. */
        const r = await P.page.evaluate(() => { if (!state.babies.length) return 'nobaby'; const t = timersFor(state.activeBabyId); if (t.sleep) return 'running'; t.sleep = { start: Date.now() }; persist(); return t.sleep.start; });
        if (r === 'nobaby') return 'skip';
        if (r !== 'running') { model.timer = true; model.timerBy = act.who; }
        return 'ok';
      }
      case 'timerStop': {
        if (!usable(act.who)) return 'skip';
        const r = await P.page.evaluate(() => {
          if (!state.babies.length) return 'nobaby';
          const before = new Set(state.events.map((e) => e.id));
          const t = (state.timers[state.activeBabyId] || {}).sleep; if (!t) return null;
          stopSleep(state.activeBabyId);
          const made = state.events.filter((e) => !before.has(e.id));
          return made.length ? made[0].id : 'asked';
        });
        if (r === 'nobaby') return 'skip';
        if (r && r !== 'asked') { model.timer = false; record('log', act.n, r, act.who, { note: '', kind: 'sleep' }); }
        return 'ok';
      }
      case 'offline': case 'online': {
        if (!usable(act.who)) return 'skip';
        const off = act.a === 'offline';
        await P.page.setOfflineMode(off); await P.page.evaluate((o) => { window.__offline = o; }, off); P.online = !off;
        return 'ok';
      }
      case 'reloadMidSave': {
        if (!usable(act.who)) return 'skip';
        const id = await doLog(P, act.kind, act.note);
        record('log', act.n, id, act.who, { note: act.note, kind: act.kind, reload: act.delayMs });
        await sleep(act.delayMs);
        await P.page.reload({ waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
        if (!(await booted(P, 40000))) violate('boot', act.who + ' did not come back after a reload');
        return 'ok';
      }
      case 'race': {
        if (!usable(act.who) || !usable(act.other)) return 'skip';
        const X = phones[act.who], Y = phones[act.other];
        const f = act.kind === 'addMed' ? (Q, s) => doAddMed(Q, act.label + s) : act.kind === 'log' ? (Q, s) => doLog(Q, 'feed', act.label + s) : (Q, s) => doAddMs(Q, act.label + s);
        // Both inside one 350 ms debounce window: fired together, no await between them.
        // The gap comes from the action (seeded), so a replay races the same way; old saved lists had none.
        const gap = act.delayMs !== undefined ? act.delayMs : Math.floor(Math.random() * 200);
        const [i1, i2] = await Promise.all([f(X, 'a'), sleep(gap).then(() => f(Y, 'b'))]);
        const kind = act.kind === 'addMed' ? 'med' : act.kind === 'log' ? 'log' : 'ms';
        record(kind, act.n + '.0', i1, act.who, { note: act.label + 'a', dose: '5', race: true });
        record(kind, act.n + '.1', i2, act.other, { note: act.label + 'b', dose: '5', race: true });
        return 'ok';
      }
      case 'visit': {
        if (!usable(act.who)) return 'skip';
        if (act.w320) await P.page.setViewport({ width: 320, height: 640, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
        await P.page.evaluate((t) => { try { go(t); } catch (e) {} }, act.tab);
        await sleep(700);
        if (act.w320) {
          /* What a person can PAN, not what scrollWidth says. The viewport takes html's overflow, or body's when
             html's is visible (CSS overflow propagation); Cubby sets body{overflow:hidden} and scrolls inside
             #scroll, so the document itself never pans, whatever a decoration does to its scrollWidth (the
             night theme's header wash is 150% wide on purpose). #scroll counts unless it clips. */
          const over = await P.page.evaluate(() => { const d = document.scrollingElement || document.documentElement; const s = document.getElementById('scroll');
            const ovx = (el) => (el ? getComputedStyle(el).overflowX : 'visible'), pans = (o) => !/hidden|clip/.test(o);
            const vp = ovx(document.documentElement) !== 'visible' ? ovx(document.documentElement) : ovx(document.body);
            /* Name what sticks out: the outermost elements past the right edge that no scroller of their own contains. */
            const lim = window.innerWidth, wide = [];
            const clipped = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return p.id !== 'scroll'; } return false; };
            document.querySelectorAll('body *').forEach((el) => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.right > lim + 1 && getComputedStyle(el).position !== 'fixed' && !clipped(el)) wide.push(el); });
            const outer = wide.filter((el) => !wide.includes(el.parentElement));
            const name = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
            return { doc: pans(vp) ? d.scrollWidth - window.innerWidth : 0, scroll: s && pans(ovx(s)) ? s.scrollWidth - s.clientWidth : 0, wide: outer.slice(0, 3).map(name) }; });
          if (over.doc > 1 || over.scroll > 1) violate('scroll320', 'the ' + act.tab + ' tab scrolls sideways at 320 px by ' + Math.max(over.doc, over.scroll) + ' px' + (over.wide.length ? ' (past the edge: ' + over.wide.join(', ') + ')' : ''));
          await P.page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
        }
        return 'ok';
      }
      case 'remove': {
        const T = phones[act.target];
        if (!usable('olive') || !T || !T.member || T.removed || T.gone) return 'skip';
        if (!phones.olive.online) { await phones.olive.page.setOfflineMode(false); phones.olive.online = true; await phones.olive.page.evaluate(() => { window.__offline = false; }); }
        await phones.olive.page.evaluate(() => window.openFamily(''));
        try { await phones.olive.page.waitForSelector('.ll-rm[data-uid="' + T.uid + '"]', { timeout: 10000 }); } catch (e) { violate('remove', 'Family & sharing never listed ' + act.target + ' with a Remove button'); return 'ok'; }
        await phones.olive.page.evaluate((u) => document.querySelector('.ll-rm[data-uid="' + u + '"]').click(), T.uid);
        await sleep(600);
        const ok = await phones.olive.page.evaluate(() => { const x = [...document.querySelectorAll('#sheet button')].find((y) => y.textContent.trim() === 'Remove'); if (!x) return false; x.click(); return true; });
        if (!ok) { violate('remove', 'the Remove confirm never offered its button'); return 'ok'; }
        await sleep(1500);
        await phones.olive.page.evaluate(() => { try { document.getElementById('llModalOv').remove(); } catch (e) {} try { closeSheet(); } catch (e) {} });
        T.removed = true; T.removedAt = Date.now();
        return 'ok';
      }
      case 'deleteAccount': {
        if (!usable(act.who)) return 'skip';
        if (!P.online) { await P.page.setOfflineMode(false); P.online = true; }
        /* Deleting an account asks for a sign-in under four minutes old before it deletes anything
           (store-firebase.js freshSignIn: Firebase deletes a login only soon after a sign-in), and a password
           session has no sheet to be asked again, so a phone that signed in earlier in a long session was refused
           at the door (reauth_unsupported) and reported here as a violation. She proves it is her again first,
           as the app asks a parent to. */
        /* opts.skipReauth is the self-test's plant: this line taken out, which must turn a deletion after a stale
           sign-in into a refusal (reauth_unsupported). */
        const again = opts.skipReauth ? 'ok' : await P.page.evaluate((e, p) => window.LL.auth.currentUser.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(e, p))
          .then(() => 'ok', (x) => (x && (x.code || x.message)) || 'failed'), P.email, PW);
        if (again !== 'ok') violate('legit-denied', act.who + ' could not sign in again before deleting her account: ' + again);
        /* Through the app's own Delete (doDeleteAccount, what the confirm sheet runs), so what she sees at the end is
           judged as well; what LL.deleteAccount threw on the way is kept. */
        const r = await P.page.evaluate(async () => {
          const real = window.LL.deleteAccount;
          let threw = null;
          window.LL.deleteAccount = () => real().catch((e) => { threw = (e && (e.code || e.message)) || 'failed'; throw e; });
          try { await doDeleteAccount(); } finally { window.LL.deleteAccount = real; }
          return threw || 'ok';
        });
        // Her other phones: the same account, signed in elsewhere (Olive's second phone).
        const mine = Object.entries(phones).filter(([, Q]) => Q !== P && Q.uid && Q.uid === P.uid && !Q.closed);
        if (r !== 'ok') violate('legit-denied', act.who + ' could not delete her own account: ' + r);
        else {
          // Finished means she has left the family, as the server holds it, not only that the call resolved.
          const hh = await adminGet('households/' + hid).catch(() => null);
          if (hh && hh.members && Object.prototype.hasOwnProperty.call(hh.members, P.uid)) violate('delete', act.who + ' deleted her account and is still in the family');
          /* And she sees that it finished. Firebase signs her out as the login goes, so the sign-in screen is up; the
             goodbye must be on top of it. From July to November 2026 it lay under it (z-index 4000 against 99999):
             she saw a plain sign-in screen, and Continue with Google made her a new, empty account. */
          await P.page.waitForFunction(() => !!(window.LL && window.LL.auth && !window.LL.auth.currentUser && document.getElementById('llAuthOv') && document.getElementById('cb-del-goodbye')), { timeout: 8000 }).catch(() => {});
          const look = await P.page.evaluate(() => {
            const at = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
            return { top: !at ? 'none' : at.closest('#cb-del-goodbye') ? 'goodbye' : at.closest('#llAuthOv') ? 'signin' : at.closest('#ll-access-lost') ? 'access-lost' : (at.id || at.tagName.toLowerCase()),
              out: !window.LL.auth.currentUser, signIn: !!document.getElementById('llAuthOv'), goodbye: !!document.getElementById('cb-del-goodbye') };
          }).catch((e) => ({ top: 'unreadable: ' + e.message }));
          if (look.top !== 'goodbye') violate('delete', act.who + ' deleted her account and the goodbye is not what she sees: the centre of her screen is ' + look.top);
          /* Her user record is gone (step 3), and stays gone. Her other phone, still signed in on a token that outlives
             the account, loses the family when she leaves it and writes her pointer there; that write used to make the
             record again, under an account that no longer exists (SAR-5). Waited for: that phone shows "You're no
             longer in this family" (the write goes with it), then 2 s for it to land. */
          const others = [];
          for (const [w2, Q] of mine) {
            const lost = await Q.page.waitForFunction(() => !!document.getElementById('ll-access-lost'), { timeout: 12000 }).then(() => true, () => false);
            others.push({ phone: w2, lost });
          }
          if (mine.length) await sleep(2000);
          const userDoc = await adminGet('users/' + P.uid).catch(() => null);
          P.selfNote = Object.assign({}, P.selfNote || {}, { finished: look, others, userDoc: !!userDoc });
          if (userDoc) violate('delete', act.who + ' deleted her account and her user record is on the server again' + (mine.length ? ' (her other phone wrote it back)' : '') + ': ' + JSON.stringify(userDoc).slice(0, 160));
        }
        const hers = [act.who].concat(mine.map(([w2]) => w2));
        Object.values(model.logs).forEach((m) => { if (hers.includes(m.by)) m.unknown = true; });   // what deletion keeps of her entries is not this harness's question
        P.gone = true; P.member = false;
        mine.forEach(([, Q]) => { Q.gone = true; Q.member = false; });
        return 'ok';
      }
      case 'settle': return settle(!!act.final, act.n);
      /* Self-test only: her deletion stops at its very last step, the login itself (the Auth emulator's account delete
         fails on the wire), after she has left the family. On the real SDK she must then be signed out, not left on
         this phone's copy of a family that now refuses her (store-firebase.js signOutAfterStop), and still signed out
         once the page is reloaded. She signs in again, as the sign-in screen tells her, lands in a new Cubby of her
         own (her user record went with the first attempt), and deletes; that one finishes, and her account is gone
         from the Auth emulator. */
      case 'deleteStopsAtLogin': {
        if (!usable(act.who)) return 'skip';
        if (!P.online) { await P.page.setOfflineMode(false); P.online = true; }
        const signIn = () => P.page.evaluate((e, p) => window.LL.auth.currentUser.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(e, p))
          .then(() => 'ok', (x) => (x && (x.code || x.message)) || 'failed'), P.email, PW);
        const del = () => P.page.evaluate(() => window.LL.deleteAccount().then(() => ({ r: 'ok' }), (e) => ({ r: (e && (e.code || e.message)) || 'failed', stage: (e && e.cubbyDeletion) || '' })));
        const out = { again: await signIn() };
        await P.page.setRequestInterception(true);
        const cut = (r) => { if (r.method() === 'POST' && /accounts:delete/.test(r.url())) r.abort('failed').catch(() => {}); else r.continue().catch(() => {}); };
        P.page.on('request', cut);
        try { out.first = await del(); } finally { P.page.off('request', cut); await P.page.setRequestInterception(false); }
        await sleep(2500);   // past the household listener's 1.5 s re-check
        out.after = await P.page.evaluate(() => ({ out: !window.LL.auth.currentUser, signIn: !!document.getElementById('llAuthOv'), note: !!document.getElementById('ll-access-lost') }));
        const hh = (await adminGet('households/' + hid).catch(() => null)) || {};
        out.left = !Object.prototype.hasOwnProperty.call(hh.members || {}, P.uid);
        if (!(out.first.r === 'auth/network-request-failed' && out.first.stage === 'login')) violate('delete', act.who + '\'s deletion was meant to stop at the login and did not: ' + JSON.stringify(out.first));
        else if (!out.left) violate('delete', act.who + '\'s deletion stopped at the login with her still in the family');
        else if (!out.after.out || !out.after.signIn || out.after.note) violate('delete', act.who + ' was not left signed out on the sign-in screen after her deletion stopped at the login: ' + JSON.stringify(out.after));
        else if (!(out.reloaded = await P.page.reload({ waitUntil: 'networkidle2', timeout: 45000 }).then(() => sleep(4000)).then(() => P.page.evaluate(() => {
          const ov = document.getElementById('llAuthOv');
          return !!(window.LL && window.LL.auth && !window.LL.auth.currentUser && ov && /Continue with Google/.test(ov.textContent));
        })).catch((e) => 'reload failed: ' + e.message)) || out.reloaded !== true) violate('delete', act.who + ' was not still signed out on the sign-in screen after a reload: ' + out.reloaded);
        else {
          await P.page.evaluate((e, p) => window.LL.auth.signInWithEmailAndPassword(e, p).then(() => true), P.email, PW);
          try { await P.page.waitForFunction((old) => !!(window.LL.householdId && window.LL.householdId !== old && !document.getElementById('llAuthOv')), { timeout: 40000 }, hid); } catch (e) {}
          out.hid2 = await P.page.evaluate(() => window.LL.householdId);
          const fam2 = out.hid2 && out.hid2 !== hid ? await adminGet('households/' + out.hid2).catch(() => null) : null;
          if (!fam2 || (fam2.members || {})[P.uid] !== 'owner' || (fam2.app && (fam2.app.babies || []).length)) violate('delete', act.who + ' signed in again and did not land in an empty Cubby of her own: ' + JSON.stringify({ hid2: out.hid2, members: fam2 && fam2.members, babies: fam2 && fam2.app && fam2.app.babies }));
          else {
            out.second = await del();
            const look = await fetch(`http://localhost:${AUTH_PORT}/identitytoolkit.googleapis.com/v1/projects/${process.env.GCLOUD_PROJECT || EXEC_PROJECT}/accounts:lookup`,
              { method: 'POST', headers: ADMIN, body: JSON.stringify({ localId: [P.uid] }) }).then((x) => x.json()).catch(() => ({}));
            const fam3 = await adminGet('households/' + out.hid2).catch(() => null);
            if (out.second.r !== 'ok') violate('legit-denied', act.who + ' signed in again and could not finish deleting her account: ' + out.second.r);
            else if ((look.users || []).length) violate('delete', act.who + ' finished deleting and her account is still on the Auth emulator');
            else if (!fam3 || typeof fam3.deleteAfter !== 'number' || Object.keys(fam3.members || {}).length) violate('delete', act.who + '\'s new Cubby was not flagged for deletion with nobody in it: ' + JSON.stringify(fam3 && { members: fam3.members, deleteAfter: fam3.deleteAfter }));
          }
        }
        P.selfNote = out;
        Object.values(model.logs).forEach((m) => { if (m.by === act.who) m.unknown = true; });
        P.gone = true; P.member = false;
        return 'ok';
      }
      /* Self-test only: her sign-in made act.agoMs old on the Auth emulator (its lastLoginAt is what a refreshed token
         carries as auth_time), checked from her phone the way the app reads it before it deletes an account. */
      case 'staleSignIn': {
        if (!usable(act.who)) return 'skip';
        const u = await fetch(`http://localhost:${AUTH_PORT}/identitytoolkit.googleapis.com/v1/projects/${process.env.GCLOUD_PROJECT || EXEC_PROJECT}/accounts:update`,
          { method: 'POST', headers: ADMIN, body: JSON.stringify({ localId: P.uid, lastLoginAt: String(Date.now() - act.agoMs) }) });
        const age = await P.page.evaluate(() => window.LL.auth.currentUser.getIdTokenResult(true).then((t) => Date.parse(t.issuedAtTime) - Date.parse(t.authTime), () => -1));
        P.signInAge = age;
        if (!u.ok || age < act.agoMs - 60000) violate('harness', 'could not make ' + act.who + '\'s sign-in ' + Math.round(act.agoMs / 60000) + ' min old: ' + u.status + ', age ' + age);
        return 'ok';
      }
      /* Self-test only: a stylesheet on one phone (a planted layout bug). */
      case 'plantCss': { if (!usable(act.who)) return 'skip'; await P.page.addStyleTag({ content: act.css }); return 'ok'; }
      /* Self-test only: one blob key is emptied on a phone and saved, as an overwrite would leave it, so the
         checkpoint must report the baby (or whatever was there) as missing on the server and on the phone.
         On the phone, not by an admin write on the server: the phone may re-push its own copy over a server-
         side wipe, and a plant that only sometimes lands proves nothing. */
      case 'stompBlob': {
        if (!usable(act.who)) return 'skip';
        await P.page.evaluate((k) => { state[k] = []; persist(); }, act.key);
        return 'ok';
      }
      default: return 'skip';
    }
  };

  /* Cheap checks, after every step. */
  const quick = async (label) => {
    for (const [w, P] of Object.entries(phones)) {
      if (P.closed) continue;
      let s = null;
      try { s = await P.page.evaluate(() => ({ unh: window.__unh.splice(0), toasts: window.__toasts.slice(-5), loader: window.__loader, loaderUp: !!document.getElementById('loaderOv') })); } catch (e) { continue; }
      P.errs.splice(0).forEach((e) => violate('pageerror', w + ': ' + e, label));
      (s.unh || []).filter((u) => !(P.removed || P.gone)).forEach((u) => violate('unhandled', w + ': ' + u, label));
      const legit = P.member && !P.removed && !P.gone;
      if (legit) P.denied.splice(0).forEach((d) => violate('legit-denied', w + ': ' + d, label)); else P.denied.length = 0;
      if (legit && (s.toasts || []).some((t) => /wasn’t allowed to save/.test(t))) { violate('legit-denied', w + ' was told "Cubby wasn’t allowed to save that"', label); await P.page.evaluate(() => { window.__toasts = []; }); }
      if (s.loader && s.loader.worst > 12000) { violate('loader', w + ': the loading overlay stayed up ' + Math.round(s.loader.worst / 1000) + ' s online', label); await P.page.evaluate(() => { window.__loader.worst = 0; }); }
      if (s.loader && s.loader.since && P.online && legit) {
        const upFor = await P.page.evaluate(() => performance.now() - window.__loader.since);
        if (upFor > 12000) { violate('loader', w + ': the loading overlay has been up ' + Math.round(upFor / 1000) + ' s online', label); await P.page.evaluate(() => { window.__loader.since = performance.now(); }); }
      }
    }
  };

  /* The checkpoint: everyone online, then wait for every phone and the server to agree with the model. */
  async function settle(final, at) {
    for (const P of Object.values(phones)) if (!P.online && !P.closed) { await P.page.setOfflineMode(false); await P.page.evaluate(() => { window.__offline = false; }).catch(() => {}); P.online = true; }
    const deadline = Date.now() + (opts.settleMs || 25000);
    let problems = [];
    const live = Object.entries(phones).filter(([, P]) => P.member && !P.removed && !P.gone && !P.closed);
    do {
      await sleep(1500);
      problems = [];
      const hh = (await adminGet('households/' + hid)) || {};
      const app = hh.app || {};
      const evs = await adminList('households/' + hid + '/events');
      const sEv = {}; evs.forEach((e) => { sEv[e.id] = e; });
      const sMed = {}; (app.meds || []).forEach((m) => { sMed[m.id] = m; });
      const sMs = {}; (app.milestones || []).forEach((m) => { sMs[m.id] = m; });
      const sBaby = {}; (app.babies || []).forEach((x) => { if (x && x.id) sBaby[x.id] = x; });
      /* The timer is keyed on the model's baby, on the server and on every phone alike. It used to read the
         server's babies[0] and each phone's activeBabyId, which are different keys when the server has no
         baby, so a timer that had converged was reported as "stopped". */
      const babyId = model.babyId;
      const sTimer = !!(babyId && app.timers && app.timers[babyId] && app.timers[babyId].sleep);
      const views = {};
      for (const [w, P] of live) {
        try { views[w] = await P.page.evaluate((bid) => ({ ev: state.events.map((e) => [e.id, !!e.deleted, e.notes || '']), meds: state.meds.map((m) => [m.id, m.dose]), ms: state.milestones.map((m) => m.id),
          babies: (state.babies || []).map((x) => x && x.id), timer: !!(bid && (state.timers[bid] || {}).sleep) }), babyId); }
        catch (e) { problems.push(w + ' could not be read: ' + e.message); }
      }
      for (const [id, m] of Object.entries(model.babies)) {
        const where = 'baby ' + m.handle + ' by ' + m.by;
        if (!sBaby[id]) problems.push('server is missing the ' + where);
        for (const [w, v] of Object.entries(views)) if (!v.babies.includes(id)) problems.push(w + '\'s phone is missing the ' + where);
      }
      for (const [id, m] of Object.entries(model.logs)) {
        if (m.unknown) continue;
        const s = sEv[id];
        const where = (m.race ? 'raced ' : '') + (m.reload !== undefined ? 'reloaded-' + m.reload + 'ms ' : '') + m.kind + ' entry ' + m.handle + ' by ' + m.by;
        if (!s) problems.push('server is missing the ' + where);
        else if (!!s.deleted !== m.deleted) problems.push('server has the ' + where + (m.deleted ? ' NOT deleted' : ' deleted'));
        else if (!m.deleted && (s.notes || '') !== m.note) problems.push('server has the ' + where + ' with note "' + s.notes + '", not "' + m.note + '"');
        for (const [w, v] of Object.entries(views)) {
          const e = v.ev.find((x) => x[0] === id);
          if (!e) problems.push(w + '\'s phone is missing the ' + where);
          else if (e[1] !== m.deleted) problems.push(w + '\'s phone has the ' + where + (m.deleted ? ' NOT deleted' : ' deleted'));
          else if (!m.deleted && e[2] !== m.note) problems.push(w + '\'s phone has the ' + where + ' with note "' + e[2] + '"');
        }
      }
      for (const [id, m] of Object.entries(model.meds)) {
        const where = (m.race ? 'raced ' : '') + 'medicine ' + m.handle + ' by ' + m.by;
        if (m.deleted ? !!sMed[id] : !sMed[id]) problems.push('server ' + (m.deleted ? 'still has the deleted ' : 'is missing the ') + where);
        else if (!m.deleted && sMed[id].dose !== m.dose) problems.push('server has the ' + where + ' at dose ' + sMed[id].dose + ', not ' + m.dose);
        for (const [w, v] of Object.entries(views)) {
          const e = v.meds.find((x) => x[0] === id);
          if (m.deleted ? !!e : !e) problems.push(w + '\'s phone ' + (m.deleted ? 'still has the deleted ' : 'is missing the ') + where);
          else if (!m.deleted && e[1] !== m.dose) problems.push(w + '\'s phone has the ' + where + ' at dose ' + e[1]);
        }
      }
      for (const [id, m] of Object.entries(model.ms)) {
        const where = (m.race ? 'raced ' : '') + 'milestone ' + m.handle + ' by ' + m.by;
        if (m.deleted ? !!sMs[id] : !sMs[id]) problems.push('server ' + (m.deleted ? 'still has the deleted ' : 'is missing the ') + where);
        for (const [w, v] of Object.entries(views)) { const has = v.ms.includes(id); if (m.deleted ? has : !has) problems.push(w + '\'s phone ' + (m.deleted ? 'still has the deleted ' : 'is missing the ') + where); }
      }
      /* A timer is only judged where its baby is: a lost baby is reported above, once, as itself. */
      if (model.timer !== null && babyId && sBaby[babyId]) {
        if (sTimer !== model.timer) problems.push('server has the sleep timer ' + (sTimer ? 'running' : 'stopped') + ', but ' + model.timerBy + ' ' + (model.timer ? 'started' : 'stopped') + ' it last');
        for (const [w, v] of Object.entries(views)) if (v.babies.includes(babyId) && v.timer !== model.timer) problems.push(w + '\'s phone shows the sleep timer ' + (v.timer ? 'running' : 'stopped'));
      }
    } while (problems.length && Date.now() < deadline);
    problems.slice(0, 6).forEach((p) => violate('converge', p, at || 'settle'));
    /* CHAOS_DEBUG=1 (with --replay): what the server and each phone actually hold when a checkpoint fails. */
    if (process.env.CHAOS_DEBUG && problems.length) {
      const hh = (await adminGet('households/' + hid)) || {}, app = hh.app || {};
      console.log('    [debug] server meds: ' + JSON.stringify((app.meds || []).map((m) => [m.id, m.name])) + ' milestones: ' + JSON.stringify((app.milestones || []).map((m) => [m.id, m.title])));
      for (const [w, P] of live) console.log('    [debug] ' + w + ' meds: ' + JSON.stringify(await P.page.evaluate(() => state.meds.map((m) => [m.id, m.name])).catch((e) => e.message)));
      console.log('    [debug] model meds: ' + JSON.stringify(Object.entries(model.meds).map(([id, m]) => [id, m.handle, m.by, m.deleted])));
      console.log('    [debug] server babies: ' + JSON.stringify((app.babies || []).map((x) => x && x.id)) + ' timers: ' + JSON.stringify(app.timers || {}) + ' model baby: ' + model.babyId + ' timer: ' + model.timer);
      for (const [w, P] of live) console.log('    [debug] ' + w + ' babies/active/timers: ' + JSON.stringify(await P.page.evaluate(() => [(state.babies || []).map((x) => x && x.id), state.activeBabyId, state.timers]).catch((e) => e.message)));
    }
    /* Only a clean checkpoint vouches for what every phone holds; a later "cannot see it" is then the
       app's, not a consequence of the problem this checkpoint already reported. */
    if (!problems.length) [model.logs, model.meds, model.ms].forEach((bag) => Object.values(bag).forEach((m) => { m.settled = true; }));
    /* A removed member reads nothing, from the server. */
    for (const [w, P] of Object.entries(phones)) {
      if (!P.removed || P.closed || P.removedChecked) continue;
      const r = await P.page.evaluate((h) => Promise.all([
        window.LL.db.doc('households/' + h).get({ source: 'server' }).then((d) => (d.exists ? 'read' : 'none'), (e) => e && e.code),
        window.LL.db.collection('households/' + h + '/events').get({ source: 'server' }).then((q) => 'read ' + q.size, (e) => e && e.code),
      ]), hid).catch((e) => ['error ' + e.message]);
      if (r.some((x) => /^read/.test(String(x)))) violate('removed-reads', w + ' was removed and can still read: ' + JSON.stringify(r));
      /* And her own user record says so: no family, and the one she lost remembered (account deletion finds her
         records there through it). Her phone writes it when it shows "You're no longer in this family", as an update,
         which Firestore refuses for a record that is not there (SAR-5); every way into a family writes that record,
         so for a live account it is always there. */
      let ptr = null;
      for (let k = 0; k < 20; k++) {
        ptr = await adminGet('users/' + P.uid).catch(() => null);
        if (ptr && ptr.householdId === null && (ptr.formerHouseholdIds || []).includes(hid)) break;
        await sleep(500);
      }
      if (!(ptr && ptr.householdId === null && (ptr.formerHouseholdIds || []).includes(hid))) violate('removed-pointer', w + ' was removed and her own record does not say so: ' + JSON.stringify(ptr).slice(0, 160));
      P.selfNote = Object.assign({}, P.selfNote || {}, { pointer: ptr, family: hid });
      P.removedChecked = true;
    }
    return 'ok';
  }

  let i = 0;
  try {
    for (const act of actions) {
      i++;
      let out;
      curStep = act.n;
      try { out = await step(act); }
      catch (e) { violate('harness', act.a + ' threw ' + String(e.message || e).slice(0, 160), act.n); out = 'error'; }
      steps.push({ n: act.n, a: act.a, who: act.who, out });
      await quick(act.n).catch(() => {});
      if (out === 'fatal' || (opts.stopAt && V.length >= opts.stopAt)) break;
    }
  } finally {
    for (const P of Object.values(phones)) { try { await P.ctx.close(); } catch (e) {} }
  }
  return { sid, violations: V, steps, ages: Object.fromEntries(Object.entries(phones).map(([w, P]) => [w, P.signInAge])),
    notes: Object.fromEntries(Object.entries(phones).map(([w, P]) => [w, P.selfNote])) };
}

/* ---------- flake check and shrinking ---------- */
const sigOf = (v) => v.sig;
async function reproduces(actions, sig, tag) {
  const r = await runSession(actions, { tag });
  return r.violations.some((v) => sigOf(v) === sig);
}
/* Keep an action's prerequisites: who joins needs her invite, an edit needs the thing it edits. */
function closure(all, keep) {
  const byN = {}; all.forEach((x) => { byN[x.n] = x; });
  const need = new Set(keep.map((x) => x.n));
  const req = (x) => {
    const out = ['L1'];
    if (x.ref) out.push(String(x.ref).split('.')[0]);
    if (x.a === 'joinLink' || x.a === 'answerEmail') { const inv = all.find((y) => (y.a === 'inviteLink' || y.a === 'inviteEmail') && y.for === x.who); if (inv) out.push(inv.n); }
    const joiner = (name) => all.find((y) => (y.a === 'joinLink' || y.a === 'answerEmail' || y.a === 'second') && y.who === name);
    [x.who, x.other, x.target].filter(Boolean).forEach((name) => { if (name !== 'olive') { const j = joiner(name); if (j) out.push(j.n); } });
    return out;
  };
  let grew = true;
  while (grew) { grew = false; for (const n of [...need]) for (const d of req(byN[n] || {})) if (byN[d] && !need.has(d)) { need.add(d); grew = true; } }
  return all.filter((x) => need.has(x.n));
}
async function shrink(actions, sig, budget) {
  // ddmin over the non-structural actions, with a final settle always kept so the invariant is checked.
  const fin = actions[actions.length - 1];
  let cur = actions.slice(0, -1);
  let n = 2, runs = 0;
  while (cur.length >= 2 && runs < budget) {
    const size = Math.ceil(cur.length / n);
    let reduced = false;
    for (let s = 0; s < cur.length && runs < budget; s += size) {
      const complement = cur.slice(0, s).concat(cur.slice(s + size));
      const cand = closure(actions, complement).filter((x) => x !== fin);
      if (cand.length >= cur.length) continue;
      runs++;
      if (await reproduces(cand.concat([fin]), sig, 'k')) { cur = cand; n = Math.max(n - 1, 2); reduced = true; break; }
    }
    if (!reduced) { if (n >= cur.length) break; n = Math.min(cur.length, n * 2); }
  }
  return { actions: cur.concat([fin]), runs };
}

/* ---------- the run ---------- */
function writeFailure(seed, sessionNo, v, actions, verdict) {
  fs.mkdirSync(OUT, { recursive: true });
  let file = path.join(OUT, seed + '.json');
  for (let k = 2; fs.existsSync(file); k++) file = path.join(OUT, seed + '-' + k + '.json');
  fs.writeFileSync(file, JSON.stringify({ seed, session: sessionNo, invariant: v.inv, violation: v.detail, sig: v.sig, verdict, actions }, null, 1));
  return { file, repro: 'node tools/chaos.js --replay=' + file };
}
async function hunt(seed, minutes, label) {
  const t0 = Date.now();
  const findings = [];
  const seenSig = new Set();
  let sessions = 0;
  /* Re-runs and shrinking may run past the box, but not forever: a bug found in the last minute still
     gets its three re-runs, and anything past this budget is "unchecked", never silently "flaky". */
  const budgetEnd = t0 + minutes * 60000 + 15 * 60000;
  while (Date.now() - t0 < minutes * 60000) {
    sessions++;
    const sSeed = seed * 1000 + sessions;
    const actions = generate(sSeed, 18 + rng(sSeed).int(14));
    const t1 = Date.now();
    const r = await runSession(actions, { tag: 'c' });
    console.log('  session ' + sessions + ' (seed ' + sSeed + ', ' + actions.length + ' actions, ' + Math.round((Date.now() - t1) / 1000) + ' s): ' + (r.violations.length ? r.violations.length + ' violation(s)' : 'clean'));
    /* One bug usually breaks several invariants at once (a lost medicine is missing from the server AND
       from every phone, at every later checkpoint). So the flake check is per SESSION: the same list is
       re-run three times and every new signature is counted in each re-run. The first run of 2026-11-13
       re-ran per signature instead and spent its whole box re-checking one bug six ways. */
    const fresh = [];
    for (const v of r.violations) {
      if (seenSig.has(v.sig)) { const f = findings.find((x) => x.sig === v.sig); if (f) f.seenAgain++; continue; }
      seenSig.add(v.sig); fresh.push(v);
    }
    if (!fresh.length) continue;
    fresh.forEach((v) => console.log('    ' + v.inv + ': ' + v.detail));
    const counts = {}; let reruns = 0;
    for (let k = 0; k < 3 && Date.now() < budgetEnd; k++) {
      const rr = await runSession(actions, { tag: 'f' });
      reruns++;
      new Set(rr.violations.map(sigOf)).forEach((x) => { counts[x] = (counts[x] || 0) + 1; });
    }
    /* Shrink once per session, for its EARLIEST real violation: the later ones are usually its echoes. */
    let primary = null, saved = actions, runs = 0;
    for (const v of fresh) {
      const again = counts[v.sig] || 0;
      const verdict = again >= 2 ? 'real' : reruns < 3 ? 'unchecked' : 'flaky';
      if (verdict === 'real' && !primary) {
        primary = v;
        if (Date.now() < budgetEnd) { const sh = await shrink(actions, v.sig, 8); saved = sh.actions; runs = sh.runs; }
      }
      const isPrimary = v === primary;
      const w = writeFailure(sSeed, sessions, v, isPrimary ? saved : actions, verdict);
      const id = 'CH-' + crypto.createHash('sha1').update(v.sig).digest('hex').slice(0, 6);
      findings.push({ id, inv: v.inv, detail: v.detail, sig: v.sig, verdict, reproduced: again + '/' + reruns,
        shrunkTo: isPrimary ? 'shrunk to ' + saved.length + ' of ' + actions.length + ' actions (' + runs + ' shrink runs)' : (primary ? 'not shrunk (same session as CH-' + crypto.createHash('sha1').update(primary.sig).digest('hex').slice(0, 6) + ')' : 'not shrunk'),
        seed: sSeed, session: sessions, file: w.file, repro: w.repro, seenAgain: 0 });
      console.log('    -> ' + id + ' ' + verdict + ' (' + again + '/' + reruns + ' re-runs)' + (isPrimary ? ', shrunk to ' + saved.length + ' actions' : '') + '; repro: ' + w.repro);
    }
  }
  return { label, seed, minutes, sessions, findings };
}
function writeReport(res) {
  fs.mkdirSync(OUT, { recursive: true });
  const base = path.join(OUT, 'chaos-' + res.seed);
  fs.writeFileSync(base + '.json', JSON.stringify(res, null, 1));
  const md = ['# Chaos, seed ' + res.seed, '', res.sessions + ' family sessions in ' + res.minutes + ' min against the real app, rules and emulators.', '',
    res.findings.length ? '| id | invariant | verdict | what | shrunk | repro |\n|---|---|---|---|---|---|\n' + res.findings.map((f) =>
      '| ' + f.id + ' | ' + f.inv + ' | ' + f.verdict + ' (' + f.reproduced + ') | ' + f.detail.replace(/\|/g, '/') + ' | ' + f.shrunkTo + ' | `' + f.repro + '` |').join('\n') : 'No invariant broken.', ''];
  fs.writeFileSync(base + '.md', md.join('\n'));
  return base;
}

/* A replay's verdict. Any broken invariant is a failed replay: it used to exit 0 on "OTHER VIOLATIONS", so a
   saved list whose signature had been folded since (race-meds.json, six losses printed) read as clean. */
function replayVerdict(violations, sig) {
  if (violations.some((v) => v.sig === sig)) return { verdict: 'REPRODUCED', code: 1 };
  return violations.length ? { verdict: 'OTHER', code: 2 } : { verdict: 'CLEAN', code: 0 };
}

/* The self-test's fixed script: two phones, a few everyday writes, and a diaper. */
const SELF_SCRIPT = [
  { a: 'boot', who: 'olive', n: 'L1' }, { a: 'inviteLink', who: 'olive', for: 'nina', n: 'L2' }, { a: 'joinLink', who: 'nina', skewMs: 0, n: 'L3' },
  { a: 'settle', n: 'L4' }, { a: 'log', who: 'olive', kind: 'feed', note: 'f1', n: 'L5' }, { a: 'addMed', who: 'nina', name: 'Calpol', n: 'L6' },
  { a: 'log', who: 'nina', kind: 'diaper', note: 'd1', n: 'L7' }, { a: 'visit', who: 'olive', tab: 'log', w320: true, n: 'L8' },
  { a: 'log', who: 'olive', kind: 'sleep', note: 's1', n: 'L9' }, { a: 'settle', n: 'L10', final: true },
];
/* And a deletion: Nina joins, logs, and deletes her account with a sign-in ten minutes old. And one that stops at the
   login (STOP_SCRIPT): signed out, she signs in again and deletes. */
const DELETE_SCRIPT = [
  { a: 'boot', who: 'olive', n: 'L1' }, { a: 'inviteLink', who: 'olive', for: 'nina', n: 'L2' }, { a: 'joinLink', who: 'nina', skewMs: 0, n: 'L3' },
  { a: 'settle', n: 'L4' }, { a: 'log', who: 'nina', kind: 'feed', note: 'f1', n: 'L5' }, { a: 'settle', n: 'L6' },
  { a: 'staleSignIn', who: 'nina', agoMs: 10 * 60000, n: 'L7' }, { a: 'deleteAccount', who: 'nina', n: 'L8' }, { a: 'settle', n: 'L9', final: true },
];
const STOP_SCRIPT = DELETE_SCRIPT.slice(0, 6).concat([{ a: 'deleteStopsAtLogin', who: 'nina', n: 'L7' }, { a: 'settle', n: 'L8', final: true }]);
/* And a family's exit (EXIT_SCRIPT): Olive, on two phones, removes Nina, whose own record must then say she has no
   family; then Olive deletes her account on one phone, the last one out. The goodbye must be what she sees, and her
   other phone, told she is no longer in the family, must not write her user record back. */
const EXIT_SCRIPT = [
  { a: 'boot', who: 'olive', n: 'L1' }, { a: 'second', who: 'olive2', skewMs: 0, n: 'L2' }, { a: 'inviteLink', who: 'olive', for: 'nina', n: 'L3' },
  { a: 'joinLink', who: 'nina', skewMs: 0, n: 'L4' }, { a: 'settle', n: 'L5' }, { a: 'log', who: 'nina', kind: 'feed', note: 'f1', n: 'L6' },
  { a: 'remove', who: 'olive', target: 'nina', n: 'L7' }, { a: 'settle', n: 'L8' },
  { a: 'deleteAccount', who: 'olive', n: 'L9' }, { a: 'settle', n: 'L10', final: true },
];
const PLANT = {
  file: '/app/store-firebase.js',
  from: '        writes.push(eventsRef.doc(docKey(id)).set(Object.assign({ authorId: cur[id].authorId || uidNow }, cur[id]))',
  to: '        if (cur[id].type === \'diaper\') return; // PLANTED BY tools/chaos.js --self-test: nappies never leave the phone\n        writes.push(eventsRef.doc(docKey(id)).set(Object.assign({ authorId: cur[id].authorId || uidNow }, cur[id]))',
};

(async () => {
  const web = await startWeb();
  const served = await fetch(`http://localhost:${WEB_PORT}/app/store-firebase.js`).then((r) => r.text()).catch(() => '');
  if (served !== fs.readFileSync(path.join(ROOT, 'app', 'store-firebase.js'), 'utf8')) { console.log('FAIL the web server on ' + WEB_PORT + ' is not serving this checkout'); process.exit(1); }
  const quiet = console.warn; console.warn = () => {};
  let code = 0;
  try {
    if (REPLAY) {
      const j = JSON.parse(fs.readFileSync(REPLAY, 'utf8'));
      console.log('\nchaos replay: ' + j.actions.length + ' actions from ' + REPLAY + ' (expecting ' + j.invariant + ': ' + j.violation + ')');
      const r = await runSession(j.actions, { tag: 'r' });
      r.violations.forEach((v) => console.log('  ' + v.inv + ': ' + v.detail));
      const rv = replayVerdict(r.violations, j.sig);
      console.log(rv.verdict === 'REPRODUCED' ? 'REPRODUCED' : rv.verdict === 'OTHER' ? 'OTHER VIOLATIONS (not the saved signature ' + j.sig + ')' : 'CLEAN (not reproduced)');
      console.log('REPLAY: ' + rv.verdict);
      code = rv.code;
    } else if (SELF) {
      let fail = 0;
      const ok = (n, c, x) => { if (c) console.log('  ok   ' + n); else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 400) : '')); } };
      console.log('\nchaos self-test: first the generator, then the real app with one planted bug (diaper entries never leave the phone)');
      const crossNow = crossTouches(generate, 400);
      ok('the generator keeps a new item on its own phone until a checkpoint (400 seeds, ' + crossNow + ' cross-phone touches)', crossNow === 0);
      const unlocked = generate.toString().replace('lockedThisSegment.add(it.n); } });', '} });');
      const crossOld = unlocked === generate.toString() ? -1 : crossTouches(new Function('rng', 'NEWCOMERS', 'DAY', 'return ' + unlocked)(rng, NEWCOMERS, DAY), 400);
      ok('and the same count catches a generator without that lock (' + crossOld + ' touches)', crossOld > 0);
      const nameSig = (inv, d) => inv + ':' + String(d).replace(/[0-9a-f]{6,}|\d+/gi, '#').slice(0, 60);   // the signature before 13 Nov
      const lostA = 'server is missing the raced medicine L10.0 by rosa', lostB = 'server is missing the raced medicine L10.1 by olive2';
      ok('one lost write is one signature, whichever racing phone lost it (the old signature split it in two)',
        sigFor('converge', lostA) === sigFor('converge', lostB) && nameSig('converge', lostA) !== nameSig('converge', lostB));
      const src = fs.readFileSync(path.join(ROOT, 'app', 'store-firebase.js'), 'utf8');
      ok('the plant site is in store-firebase.js exactly once', src.split(PLANT.from).length === 2);
      OVERRIDE = { [PLANT.file]: src.replace(PLANT.from, PLANT.to) };
      const m = await runSession(SELF_SCRIPT, { tag: 'm' });
      const lost = m.violations.find((v) => v.inv === 'converge' && /diaper entry L7/.test(v.detail));
      ok('a session catches it: the nappy never reaches the server', !!lost, m.violations.map((v) => v.detail));
      const other = m.violations.filter((v) => !/diaper/.test(v.detail));
      if (other.length) console.log('  note the mutant run also saw ' + other.length + ' other violation(s), judged below against the real app: ' + other.map((v) => v.detail).slice(0, 3).join('; '));
      if (lost) {
        let again = 0; for (let k = 0; k < 2; k++) if (await reproduces(SELF_SCRIPT, lost.sig, 'f')) again++;
        ok('the flake check calls it real (' + again + '/2 re-runs)', again === 2);
        const s = await shrink(SELF_SCRIPT, lost.sig, 4);
        ok('the shrinker cuts ' + SELF_SCRIPT.length + ' actions to ' + s.actions.length + ' in ' + s.runs + ' runs, keeping the nappy and what it needs',
          s.actions.length < SELF_SCRIPT.length && s.actions.some((x) => x.n === 'L7') && s.actions.some((x) => x.n === 'L3'), s.actions.map((x) => x.n + ':' + x.a));
        const w = writeFailure('selftest', 0, lost, s.actions, 'planted');
        ok('and saves a replayable list', fs.existsSync(w.file), w.file);
      }
      OVERRIDE = {};
      /* The baby is checked like every other blob edit. Plant the loss directly (the phone's blob loses its
         babies and saves that) and the checkpoint must name it, on the server and on the phone. */
      const STOMP = [{ a: 'boot', who: 'olive', n: 'L1' }, { a: 'settle', n: 'L2' }, { a: 'stompBlob', who: 'olive', key: 'babies', n: 'L3' }, { a: 'settle', n: 'L4', final: true }];
      const st = await runSession(STOMP, { tag: 'b' });
      const babyGone = st.violations.filter((v) => v.inv === 'converge' && /missing the baby L1/.test(v.detail));
      ok('a baby wiped from the blob is caught, on the server and on the phone', babyGone.some((v) => /^server/.test(v.detail)) && babyGone.some((v) => /^olive's phone/.test(v.detail)), st.violations.map((v) => v.detail));
      ok('and before the wipe the boot had the baby on the server and the phone (the first checkpoint was clean)', !st.violations.some((v) => v.step === 'L2'), st.violations.filter((v) => v.step === 'L2').map((v) => v.detail));
      /* The 320 px check judges what a person can pan. A real overflow inside the scroller is caught; the night
         theme's wide header wash, which body{overflow:hidden} keeps from ever panning, is not a finding. */
      const PAN = [{ a: 'boot', who: 'olive', n: 'L1', dark: true }, { a: 'visit', who: 'olive', tab: 'log', w320: true, n: 'L2' },
        { a: 'plantCss', who: 'olive', css: '#scroll > *:first-child{min-width:420px}', n: 'L3' }, { a: 'visit', who: 'olive', tab: 'home', w320: true, n: 'L4' }];
      const pan = await runSession(PAN, { tag: 'p' });
      const panV = pan.violations.filter((v) => v.inv === 'scroll320');
      ok('a page that really pans sideways at 320 px is caught (a planted 420 px row in the scroller)', panV.some((v) => v.step === 'L4'), pan.violations.map((v) => v.step + ' ' + v.detail));
      ok('and night mode\'s header wash, clipped by body{overflow:hidden}, is not a sideways scroll', !panV.some((v) => v.step === 'L2'), panV.map((v) => v.step + ' ' + v.detail));
      ok('and a replay that breaks some OTHER invariant fails (exit 2), never reads as clean',
        replayVerdict([{ sig: 'b' }], 'a').code === 2 && replayVerdict([{ sig: 'a' }], 'a').code === 1 && replayVerdict([], 'a').code === 0);
      /* Deleting an account asks for a sign-in under four minutes old before it deletes anything (store-firebase.js
         freshSignIn), and a password session has no sheet to be asked again, so the deleteAccount action signs her
         phone in again first. A session short enough for a gate never gets that old, so the plant makes it so on the
         Auth emulator, and the same deletion without the sign-in again must then be refused at the door. */
      const del = await runSession(DELETE_SCRIPT, { tag: 'd' });
      const delStep = (r) => (r.steps.find((x) => x.n === 'L8') || {}).out;
      const delBad = del.violations.filter((v) => /legit-denied|delete|harness/.test(v.inv));
      ok('a member whose sign-in is ten minutes old (' + Math.round((del.ages.nina || 0) / 60000) + ' min, read from her phone) deletes her account: her phone signs in again, the deletion finishes, and she is out of the family',
        delStep(del) === 'ok' && (del.ages.nina || 0) >= 9 * 60000 && !delBad.length, { step: delStep(del), age: del.ages.nina, violations: delBad.map((v) => v.inv + ': ' + v.detail) });
      /* A resolved deletion must leave her out of the family: planted to skip the leave, it resolves with her still in. */
      const LEAVE = { from: '      if (hhRef && !lostHere) {\n        var leaveRef = hhRef,', to: '      if (false) {   // PLANTED BY tools/chaos.js --self-test: the leave is skipped\n        var leaveRef = hhRef,' };
      ok('the leave plant site is in store-firebase.js exactly once', src.split(LEAVE.from).length === 2);
      OVERRIDE = { [PLANT.file]: src.replace(LEAVE.from, LEAVE.to) };
      const kept = await runSession(DELETE_SCRIPT, { tag: 'l' });
      OVERRIDE = {};
      ok('and a deletion planted to skip the leave, which resolves with her still in the family, is caught',
        kept.violations.some((v) => v.inv === 'delete' && /deleted her account and is still in the family/.test(v.detail)), kept.violations.map((v) => v.inv + ': ' + v.detail));
      const noRe = await runSession(DELETE_SCRIPT, { tag: 'n', skipReauth: true });
      ok('and with that sign-in taken out, the same deletion is refused at the door (reauth_unsupported), so the line is what passes it',
        noRe.violations.some((v) => v.inv === 'legit-denied' && /could not delete her own account: reauth_unsupported/.test(v.detail)), noRe.violations.map((v) => v.inv + ': ' + v.detail));
      const stop = await runSession(STOP_SCRIPT, { tag: 'o' });
      const stopBad = stop.violations.filter((v) => /legit-denied|delete|harness|pageerror|unhandled/.test(v.inv)), sn = stop.notes.nina || {};
      ok('on the real SDK, a deletion that stops at the login (its account delete failing on the wire) leaves her signed out of the family she has left; she signs in again, lands in a new Cubby of her own, and deleting finishes',
        !stopBad.length && !!sn.first && sn.first.stage === 'login' && !!sn.second && sn.second.r === 'ok', { violations: stopBad.map((v) => v.inv + ': ' + v.detail), note: sn });
      const dn = del.notes.nina || {};
      ok('and the deletion that finished ends on the goodbye: the centre of her screen, over the sign-in screen Firebase\'s sign-out brought up',
        !!dn.finished && dn.finished.top === 'goodbye' && dn.finished.out && dn.finished.signIn && dn.userDoc === false, dn);
      /* A family's exit, on the real SDK: a removal on a live account writes her pointer (an update: her record is there,
         made by her own join), and an account deleted on one phone stays deleted from the other. */
      const ex = await runSession(EXIT_SCRIPT, { tag: 'x' });
      const exBad = ex.violations.filter((v) => /legit-denied|delete|remove|harness|pageerror|unhandled|converge/.test(v.inv)), xo = ex.notes.olive || {}, xn = ex.notes.nina || {};
      ok('Olive removes Nina (joined by link, so her record is her own join\'s): Nina\'s record then says she has no family and remembers the one she lost',
        !exBad.length && !!xn.pointer && xn.pointer.householdId === null && (xn.pointer.formerHouseholdIds || []).includes(xn.family), { violations: exBad.map((v) => v.inv + ': ' + v.detail), nina: xn });
      ok('then Olive deletes her account on one phone: the goodbye is what she sees, and her second phone, told she is no longer in the family, leaves her user record deleted',
        !exBad.length && !!xo.finished && xo.finished.top === 'goodbye' && xo.finished.out && xo.finished.signIn
          && (xo.others || []).length === 1 && xo.others[0].lost === true && xo.userDoc === false, { violations: exBad.map((v) => v.inv + ': ' + v.detail), olive: xo });
      /* The same exit with the goodbye back at z-index 4000 and the second phone's pointer written as a merge, as both were
         until November 2026: each must be caught. */
      const idx = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
      const BYE = { from: 'position:fixed;inset:0;z-index:100003;', to: 'position:fixed;inset:0;z-index:4000;' };
      const PTR = { from: '.update(pointer).catch(', to: '.set(pointer, { merge: true }).catch(' };
      ok('the goodbye and pointer plant sites are each in their file exactly once', idx.split(BYE.from).length === 2 && src.split(PTR.from).length === 2);
      OVERRIDE = { '/app/index.html': idx.replace(BYE.from, BYE.to), [PLANT.file]: src.replace(PTR.from, PTR.to) };
      const exP = await runSession(EXIT_SCRIPT, { tag: 'y' });
      OVERRIDE = {};
      ok('planted with the goodbye under the sign-in screen, a finished deletion is caught: the centre of her screen is the sign-in screen',
        exP.violations.some((v) => v.inv === 'delete' && /goodbye is not what she sees: the centre of her screen is signin/.test(v.detail)), exP.violations.map((v) => v.inv + ': ' + v.detail));
      ok('and planted with the old pointer write (a merge, which makes the record), her second phone writes her user record back after the deletion, and that is caught',
        exP.violations.some((v) => v.inv === 'delete' && /user record is on the server again \(her other phone wrote it back\)/.test(v.detail)), exP.violations.map((v) => v.inv + ': ' + v.detail));
      console.log('\nthe same script against the real app');
      /* The harness's own rule: a violation counts only if the same list breaks it again in 2 of 3 runs.
         So a timing-dependent app race this short script can hit is reported here as a flake (and named),
         and only a repeatable break turns the gate red. */
      const g = await runSession(SELF_SCRIPT, { tag: 'g' });
      const realOnes = [];
      for (const v of g.violations) {
        let again = 0; for (let k = 0; k < 2; k++) if (await reproduces(SELF_SCRIPT, v.sig, 'g')) again++;
        console.log('  ' + (again >= 1 ? 'REAL ' : 'flake') + ' ' + v.inv + ': ' + v.detail + ' (' + (again + 1) + '/3 runs)');
        if (again >= 1) realOnes.push(v);
      }
      ok('no invariant is broken repeatably', realOnes.length === 0, realOnes.map((v) => v.inv + ': ' + v.detail));
      console.log('\nCHAOS SELF-TEST: ' + (fail ? 'FAIL' : 'PASS'));
      code = fail ? 1 : 0;
    } else {
      console.log('\nchaos: seed ' + SEED + ', ' + MINUTES + ' min, emulators fs:' + FS_PORT + ' auth:' + AUTH_PORT + ', app :' + WEB_PORT);
      const res = await hunt(SEED, MINUTES, 'chaos');
      const base = writeReport(res);
      console.log('\n' + res.sessions + ' sessions, ' + res.findings.length + ' finding(s): ' + ['real', 'flaky', 'unchecked'].map((k) => res.findings.filter((f) => f.verdict === k).length + ' ' + k).join(', '));
      res.findings.forEach((f) => console.log('  ' + f.id + ' [' + f.verdict + ' ' + f.reproduced + '] ' + f.inv + ': ' + f.detail + '\n      repro: ' + f.repro));
      console.log('  report: ' + base + '.md');
      console.log('\nCHAOS: ' + (res.findings.some((f) => f.verdict === 'real') ? 'REAL FINDINGS' : res.findings.length ? 'FLAKES ONLY' : 'CLEAN'));
      code = res.findings.some((f) => f.verdict === 'real') ? 1 : 0;
    }
  } finally {
    console.warn = quiet;
    try { if (browser) await browser.close(); } catch (e) {}
    web.close();
  }
  process.exit(code);
})().catch((e) => { console.error(e); process.exit(2); });
