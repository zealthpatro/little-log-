/* What one person logged on a phone before signing in never reaches the next account that signs in there.
 *
 * The REAL app/store-firebase.js client against the Firestore + Auth emulators and the real rules.
 * While nobody is signed in (or before a household exists) persist() keeps the whole state in the
 * phone's own cache, little-log-v1 (with legacy photo bytes in little-log-photos-v1), and the first
 * sign-in that makes a brand-new household copies that cache into it (buildMigrationPayload). The
 * cache was never let go after that copy, so the next account with no household of its own to sign in
 * on the same phone ran the same migration and copied the first person's babies and entries into ITS
 * new household.
 *
 *   R  Ann logs signed out, signs in (her entries reach her family), signs out; the page reloads; Bea,
 *      a new account, signs in: Bea's family holds none of Ann's babies, entries or photos
 *   T  the same in one tab with no reload (Cleo, then Dana): nothing of Cleo's reaches Dana's family,
 *      including what Cleo logged signed in, and Dana's screen shows none of it
 *   U  the same tab again, and the next person (Gail) logs her own entry signed out before she signs in:
 *      Gail's entry reaches Gail's family, Hana's babies and entries do not
 *   V  Ivy is signed out from elsewhere (another tab, a revoked session) 350 ms after logging, before her push:
 *      her screen empties, Jo signs in in that tab and gets nothing of hers, and Ivy's unsent entry still
 *      reaches Ivy's own family when she signs back in
 *   O  the copy an OLDER build left (it migrated and kept the record): the next time its owner opens this
 *      build signed in, what her family holds leaves the record, an entry no family holds stays, and the
 *      next account gets nothing of hers
 *   D  Mia deletes her account with an entry still unsent: no outbox of hers is left on the phone (the V outbox
 *      is for a sign-out from elsewhere, never for a deletion)
 *   K  a parent's own pre-sign-in entries still reach her own new family (the migration still works)
 *   N  a migration the server refuses keeps every entry on the phone: nothing is let go before it lands
 *   H  Nora signs out while her family's full history read (hydrateFullHistory) is still out, and it lands
 *      after: none of her older entries comes back into memory, the next signed-out save writes none of them
 *      into the phone's record, and Pam, who signs in next in that tab, finishes her sign-in into a family of
 *      her own that holds her own entry and none of Nora's, with none of Nora's in memory
 *   H2 the same read FAILS after Rosa signed out and Sue's family is attached: Sue's family is still told its
 *      history is loading (window.cubbyHistoryPending), because that failure was about Rosa's family
 *   H3 Olive signs out with that read still out, Quinn (who has older entries of her own) signs in and her family
 *      attaches, and only THEN does Olive's read land: none of Olive's entries comes into memory under Quinn or
 *      into any family Quinn owns, Quinn's own history state is untouched (still loading, memory as it was), and
 *      Quinn's own read, landing after, still brings her older entries in. H lands its read while nobody is signed
 *      in, so a guard that only asks "is anyone signed in" or "is any family attached" passes H; H3 is the case
 *      that needs the read to be for the family attached now.
 *
 * H, H2 and H3 hold the read in the SDK, not in the app: the server answers it as usual and the test decides when
 * the answer reaches the app. None of them asserts that the next account's screen boots: after a sign-out with that
 * read still out it can stay on the loader, on v370 as well, which is its own lane (the post-mortem's residual
 * risk). What they assert is where the first family's data goes.
 *
 * R also signs Ann back in at the end: everything of hers is still in her family and on her screen.
 *
 * Every "none of X" assertion uses the same matcher that first finds X in X's owner's own family.
 *
 *   node test/next-account-cache-emulator.test.js
 *
 * Ports: FS_PORT, AUTH_PORT, WEB_PORT, HUB_PORT, LOG_PORT, WS_PORT.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FS_PORT = Number(process.env.FS_PORT) || 8787;
const AUTH_PORT = Number(process.env.AUTH_PORT) || 9787;
const WEB_PORT = Number(process.env.WEB_PORT) || 8788;
const HUB_PORT = Number(process.env.HUB_PORT) || 0, LOG_PORT = Number(process.env.LOG_PORT) || 0, WS_PORT = Number(process.env.WS_PORT) || 0;
const EXEC_PROJECT = 'demo-cubby-nextaccount';
const PAGE_PROJECT = 'little-log-a9caa'; // the id app/firebase-init.js gives the SDK; emulator only
const RULES_FILE = process.env.RULES_FILE || path.join(ROOT, 'firestore.rules');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PW = 'emulator-only-pw-nextaccount';

let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; console.log('  FAIL ' + n + (extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 700) : '')); }
  return !!c;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (url) => new Promise((res) => {
  http.get(url, (r) => { r.resume(); res({ status: r.statusCode }); }).on('error', () => res({ status: 0 }));
});

/* ---------- outer phase: both emulators up, then re-run ourselves inside them ---------- */
if (!process.env.NEXT_ACCOUNT_INNER) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-nextaccount-'));
  fs.copyFileSync(RULES_FILE, path.join(scratch, 'firestore.rules'));
  fs.writeFileSync(path.join(scratch, 'firebase.json'), JSON.stringify({
    firestore: { rules: 'firestore.rules' },
    emulators: Object.assign({ firestore: Object.assign({ port: FS_PORT }, WS_PORT ? { websocketPort: WS_PORT } : {}), auth: { port: AUTH_PORT }, ui: { enabled: false } },
      HUB_PORT ? { hub: { port: HUB_PORT } } : {}, LOG_PORT ? { logging: { port: LOG_PORT } } : {})
  }));
  const firebaseBin = path.join(__dirname, 'node_modules', '.bin', 'firebase');
  const javaBin = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin') : '/opt/homebrew/opt/openjdk/bin';
  const env = Object.assign({}, process.env, { NEXT_ACCOUNT_INNER: '1', PATH: javaBin + ':' + process.env.PATH });
  try {
    execFileSync(firebaseBin, [
      'emulators:exec', '--only', 'firestore,auth', '--project', EXEC_PROJECT,
      '--config', path.join(scratch, 'firebase.json'),
      `node ${JSON.stringify(__filename)}`
    ], { cwd: scratch, env, stdio: 'inherit' });
  } catch (e) { process.exitCode = e.status || 1; }
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) {}
  return;
}

/* ---------- emulator admin access (bypasses the rules; reads back) ---------- */
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
/* Every document in a collection, as { id, data }. */
async function adminList(p) {
  const out = [];
  let tok = '';
  for (let i = 0; i < 20; i++) {
    const r = await fetch(FS_DOCS + p + '?pageSize=300' + (tok ? '&pageToken=' + encodeURIComponent(tok) : ''), { headers: ADMIN });
    if (!r.ok) break;
    const j = await r.json();
    (j.documents || []).forEach((d) => out.push({ id: d.name.split('/').pop(), data: fromValue({ mapValue: { fields: d.fields || {} } }) }));
    if (!j.nextPageToken) break;
    tok = j.nextPageToken;
  }
  return out;
}
async function until(fn, ms) {
  const stop = Date.now() + (ms || 10000);
  let v;
  while (Date.now() < stop) { v = await fn(); if (v) return v; await sleep(100); }
  return v;
}

/* What of one person's a household holds: her babies (by id or name), her entries (by id or note) and
   her photos (by id). The SAME matcher is first pointed at her own family, where it must find all of
   it, so an empty answer for the next account's family means something. */
async function marksIn(hid, mk) {
  const hh = (await adminGet('households/' + hid)) || {};
  const babies = ((hh.app || {}).babies || []).filter((b) => mk.babyIds.includes(b.id) || mk.babyNames.includes(b.name));
  const events = (await adminList('households/' + hid + '/events')).filter((d) => mk.eventIds.includes(d.id) || mk.notes.includes(d.data.notes));
  const photos = (await adminList('households/' + hid + '/photos')).filter((d) => mk.photoIds.includes(d.id));
  return { babies: babies.map((b) => b.name), events: events.map((d) => d.data.notes || d.id), photos: photos.map((d) => d.id) };
}
const countOf = (m) => m.babies.length + m.events.length + m.photos.length;
/* The same question of EVERY household an account owns, the one her users doc names or not: a sign-in
   that failed half way leaves a household behind that nobody points at, and what it holds still left
   the phone. */
async function ownedBy(uid) { return (await adminList('households')).filter((d) => d.data.ownerId === uid).map((d) => d.id); }
async function marksInOwned(uid, mk) {
  const out = { households: [], babies: [], events: [], photos: [] };
  for (const hid of await ownedBy(uid)) {
    const m = await marksIn(hid, mk);
    out.households.push(hid); out.babies.push(...m.babies); out.events.push(...m.events); out.photos.push(...m.photos);
  }
  return out;
}
/* The same question of what a phone has in memory (what the next account sees on screen). */
const marksOnScreen = (page, mk) => page.evaluate((k) => ({
  babies: (state.babies || []).filter((b) => k.babyIds.includes(b.id) || k.babyNames.includes(b.name)).map((b) => b.name),
  events: (state.events || []).filter((e) => k.eventIds.includes(String(e.id)) || k.notes.includes(e.notes)).map((e) => e.notes || e.id),
  photos: []
}), mk);

/* ---------- inner phase ---------- */
(async () => {
  console.log('\nwhat one person logged before signing in never reaches the next account on that phone, real client, real rules (' + (process.env.RULES_FILE ? 'RULES_FILE=' + RULES_FILE : 'firestore.rules') + ')\n');
  const serveProc = spawn('node', [path.join(ROOT, 'tools', 'serve.js')],
    { stdio: 'ignore', env: Object.assign({}, process.env, { PORT: String(WEB_PORT) }) });
  process.on('exit', () => { try { serveProc.kill(); } catch (e) {} });
  for (let i = 0; i < 40 && (await get(`http://localhost:${WEB_PORT}/app/`)).status !== 200; i++) await sleep(250);
  const servedStore = await fetch(`http://localhost:${WEB_PORT}/app/store-firebase.js`).then((r) => r.text()).catch(() => '');
  ok('the static server serves THIS checkout\'s store-firebase.js, byte for byte', servedStore === fs.readFileSync(path.join(ROOT, 'app', 'store-firebase.js'), 'utf8'));
  const servedIndex = await fetch(`http://localhost:${WEB_PORT}/app/index.html`).then((r) => r.text()).catch(() => '');
  ok('and THIS checkout\'s index.html', servedIndex === fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8'));

  const puppeteer = require(path.join(ROOT, 'tools', 'node_modules', 'puppeteer-core'));
  const dl = require(path.join(ROOT, 'tools', 'gate_downloads.js'));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', downloadBehavior: dl.downloadBehavior(),
    args: ['--no-sandbox', '--disable-gpu', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1'] });
  const errs = [], offHostAnswered = [], consoleErrs = [];
  const AUTH_PROJECT = process.env.GCLOUD_PROJECT || EXEC_PROJECT;
  const appUrl = () => `http://localhost:${WEB_PORT}/app/?fsemu=${FS_PORT}&authemu=${AUTH_PORT}`;
  const ready = (page) => page.waitForFunction(() => !!(window.LL && window.LL.auth && window.LL.auth.signInWithEmailAndPassword), { timeout: 20000 });
  /* One browser context per phone: its own localStorage and IndexedDB, like a separate device. Two
     people on ONE phone share that context, which is the whole point here. */
  const openPhone = async () => {
    const ctx = await browser.createBrowserContext({ downloadBehavior: dl.downloadBehavior() });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 300)); });
    page.on('response', (rs) => { try { const h = new URL(rs.url()).hostname; if (h && h !== 'localhost' && h !== '127.0.0.1') offHostAnswered.push(h); } catch (e) {} });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await page.goto(appUrl(), { waitUntil: 'networkidle2', timeout: 45000 });
    await ready(page);
    return page;
  };
  /* Booted AS this account: signed in as her, the door gone, and the family on screen is the one her own
     users/{uid} doc names on the server. window.LL.householdId alone is not enough: sign-out leaves the
     last account's id there, so a phone still on its way in reads as booted into the previous family. */
  const booted = async (page, uid, ms) => {
    const stop = Date.now() + (ms || 45000);
    while (Date.now() < stop) {
      const on = await page.evaluate(() => ({ uid: window.LL.auth.currentUser && window.LL.auth.currentUser.uid, hid: window.LL.householdId || null, door: !!document.getElementById('llAuthOv') }));
      if (on.uid === uid && on.hid && !on.door) {
        const u = await adminGet('users/' + uid);
        if (u && u.householdId === on.hid) return true;
      }
      await sleep(200);
    }
    const why = await page.evaluate(() => ({ uid: window.LL.auth.currentUser && window.LL.auth.currentUser.uid, hid: window.LL.householdId || null, door: ((document.getElementById('llAuthOv') || {}).innerText || '').slice(0, 200) }));
    console.log('    (not booted as ' + uid + ': ' + JSON.stringify(why) + ', server users doc: ' + JSON.stringify(await adminGet('users/' + uid)) + ')');
    return false;
  };
  const makeAccount = async (email) => {
    const made = await fetch(`http://localhost:${AUTH_PORT}/identitytoolkit.googleapis.com/v1/projects/${AUTH_PROJECT}/accounts`,
      { method: 'POST', headers: ADMIN, body: JSON.stringify({ email, password: PW, emailVerified: true }) }).then((r) => r.json()).catch(() => ({}));
    if (!made.localId) throw new Error('could not make the emulator account: ' + JSON.stringify(made).slice(0, 200));
    return made.localId;
  };
  const signIn = (page, email) => page.evaluate((e, p) => window.LL.auth.signInWithEmailAndPassword(e, p).then(() => true), email, PW);
  /* Sign out the way the app's "Log out" does (doLogout -> window.LL.signOut), then wait for the door. */
  const signOut = async (page) => {
    await page.evaluate(() => window.LL.signOut());
    try {
      await page.waitForFunction(() => !window.LL.auth.currentUser && !!document.getElementById('llAuthOv'), { timeout: 15000 });
      return true;
    } catch (e) { return false; }
  };
  const hidOf = async (uid) => ((await adminGet('users/' + uid)) || {}).householdId || null; // the server's word, never the page's
  const cacheOf = (page) => page.evaluate(() => {
    let s = null, p = null;
    try { s = JSON.parse(localStorage.getItem('little-log-v1') || 'null'); } catch (e) {}
    try { p = JSON.parse(localStorage.getItem('little-log-photos-v1') || 'null'); } catch (e) {}
    return { events: ((s && s.events) || []).map((e) => ({ id: String(e.id), notes: e.notes, authorId: e.authorId })), babies: ((s && s.babies) || []).map((b) => ({ id: b.id, name: b.name })), photos: Object.keys(p || {}) };
  });
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  /* She logs on the phone while nobody is signed in: a baby and an entry, the way the app writes them
     (addEvent -> persist -> little-log-v1). A legacy photo cache rides along where asked: the photo
     key is only ever written by a pre-Firebase build now, and the migration still reads it. */
  const logSignedOut = (page, tag, opts) => page.evaluate((t, png, o) => {
    const b = { id: 'b' + t.toLowerCase(), name: 'Baby-of-' + t, birth: Date.now() - 20 * 86400000, sex: 'F', routines: [], doctors: [], allergies: [] };
    if (!(o && o.keepBabies)) { state.babies = [b]; state.activeBabyId = b.id; } else { state.babies.push(b); state.activeBabyId = b.id; }
    const id = addEvent({ type: 'diaper', kind: 'wet', time: Date.now() - 3600000, notes: t + '-before-sign-in' });
    if (o && o.photo) localStorage.setItem('little-log-photos-v1', JSON.stringify({ ['p' + t.toLowerCase()]: png }));
    return { babyId: b.id, babyName: b.name, eventId: String(id), note: t + '-before-sign-in', photoId: (o && o.photo) ? 'p' + t.toLowerCase() : null };
  }, tag, PNG, opts || {});
  const marksFrom = (logged, extra) => ({
    babyIds: [logged.babyId], babyNames: [logged.babyName],
    eventIds: [logged.eventId].concat((extra && extra.eventIds) || []), notes: [logged.note].concat((extra && extra.notes) || []),
    photoIds: logged.photoId ? [logged.photoId] : []
  });
  /* A slow full-history read, staged in the SDK and not in the app, from the next document on: every one-shot read
     of a family's whole events collection (hydrateFullHistory's get) is answered by the server as usual, and its
     answer reaches the app only when the test says so: heldRead(page, n, 'land') hands the snapshot over, 'fail'
     an error. A read's state turns 'landed' or 'failed' a task AFTER the app's own handlers have run on it, so a
     wait on that state is a wait for the app to have taken the answer. */
  const holdHistoryReads = (page) => page.evaluateOnNewDocument(() => {
    window.__heldReads = [];
    window.__releaseRead = (n, how) => { const r = window.__heldReads[n]; if (!r || r.state !== 'held') return false; r.go(how); return true; };
    const t = setInterval(() => {
      const f = window.firebase && window.firebase.firestore;
      if (!f || !f.Query || !f.CollectionReference) return;
      clearInterval(t);
      const orig = f.Query.prototype.get;
      f.Query.prototype.get = function () {
        const p = orig.apply(this, arguments);
        if (!(this instanceof f.CollectionReference) || !/\/events$/.test(this.path || '')) return p;
        const rec = { path: this.path, state: 'held' };
        window.__heldReads.push(rec);
        return new Promise((res, rej) => {
          rec.go = (how) => p.then((v) => {
            if (how === 'fail') rej(Object.assign(new Error('the held history read failed (staged by the test)'), { code: 'unavailable' }));
            else res(v);
            setTimeout(() => { rec.state = how === 'fail' ? 'failed' : 'landed'; }, 0);
          }, (e) => { rej(e); setTimeout(() => { rec.state = 'failed'; }, 0); });
        });
      };
    }, 2);
  });
  const heldReads = (page) => page.evaluate(() => ({ reads: (window.__heldReads || []).map((r) => ({ path: r.path, state: r.state })), pending: window.cubbyHistoryPending }));
  const heldRead = async (page, n, how) => {
    const went = await page.evaluate((i, h) => window.__releaseRead(i, h), n, how);
    const want = how === 'fail' ? 'failed' : 'landed';
    return went && !!(await until(async () => ((await heldReads(page)).reads[n] || {}).state === want, 10000));
  };

  /* ================================================================================================ */
  console.log('R. Ann logs signed out, signs in, signs out; the page reloads; Bea signs in on the same phone');
  {
    const P = await openPhone();
    const ann = await logSignedOut(P, 'Ann', { photo: true });
    await sleep(700);
    const c0 = await cacheOf(P);
    ok('(Ann\'s baby, entry and photo are in the phone\'s cache)', c0.events.some((e) => e.id === ann.eventId) && c0.babies.some((b) => b.id === ann.babyId) && c0.photos.includes(ann.photoId), c0);
    const annUid = await makeAccount('ann@nextaccount.test');
    /* What the record holds at the first moment her family is attached (the first household snapshot sets
       window.LL.householdId), before the full history read that could also let it go (letGoOfHeldHere). */
    await P.evaluate(() => {
      let v = window.LL.householdId;
      Object.defineProperty(window.LL, 'householdId', { configurable: true, get() { return v; },
        set(x) { if (x && !window.__recordAtAttach) window.__recordAtAttach = { record: localStorage.getItem('little-log-v1') || '', photos: localStorage.getItem('little-log-photos-v1') || '' }; v = x; } });
    });
    await signIn(P, 'ann@nextaccount.test');
    ok('Ann signs in and boots into a family of her own', await booted(P, annUid));
    const hidA = await hidOf(annUid);
    const mk = marksFrom(ann);
    const inA = await until(async () => { const m = await marksIn(hidA, mk); return countOf(m) === 3 ? m : null; }, 10000);
    ok('(the matcher finds Ann\'s baby, entry and photo in Ann\'s own family)', !!inA, await marksIn(hidA, mk));
    const atAttach = await P.evaluate(() => window.__recordAtAttach || null);
    ok('R the record let go of Ann\'s copy at the migration itself, before her family\'s first snapshot',
      !!atAttach && !atAttach.record.includes(ann.eventId) && !atAttach.record.includes(ann.babyId) && !atAttach.photos.includes(ann.photoId), atAttach);
    ok('Ann signs out', await signOut(P));
    await P.reload({ waitUntil: 'networkidle2', timeout: 45000 }); await ready(P);
    const beaUid = await makeAccount('bea@nextaccount.test');
    await signIn(P, 'bea@nextaccount.test');
    ok('Bea, a new account with no family, signs in on Ann\'s phone and boots into a family of her own', await booted(P, beaUid));
    const hidB = await hidOf(beaUid);
    ok('(Bea\'s family is not Ann\'s)', hidB && hidB !== hidA, { hidA, hidB });
    await sleep(1500); // anything the boot would write has landed
    const inB = await marksInOwned(beaUid, mk);
    ok('R no family Bea owns holds any of Ann\'s babies', inB.babies.length === 0, inB);
    ok('R none of Ann\'s entries', inB.events.length === 0, inB);
    ok('R none of Ann\'s photos', inB.photos.length === 0, inB);
    const scrB = await marksOnScreen(P, mk);
    ok('R and Bea\'s screen shows none of Ann\'s', countOf(scrB) === 0, scrB);
    const c1 = await cacheOf(P);
    ok('R (Ann\'s pre-sign-in copy no longer waits in the phone\'s cache)', !c1.events.some((e) => e.id === ann.eventId) && !c1.babies.some((b) => b.id === ann.babyId) && !c1.photos.includes(ann.photoId), c1);
    ok('Bea signs out', await signOut(P));
    await signIn(P, 'ann@nextaccount.test');
    ok('Ann signs back in on her phone, into her own family', await booted(P, annUid) && (await hidOf(annUid)) === hidA);
    const back = await until(async () => { const m = await marksIn(hidA, mk); return countOf(m) === 3 ? m : null; }, 10000);
    ok('R everything of Ann\'s is still in her family: her baby, her entry, her photo', !!back, await marksIn(hidA, mk));
    const backScr = await until(async () => { const m = await marksOnScreen(P, mk); return (m.babies.length === 1 && m.events.length === 1) ? m : null; }, 10000);
    ok('R and on her screen', !!backScr, await marksOnScreen(P, mk));
    await P.browserContext().close();
  }

  /* ================================================================================================ */
  console.log('\nT. the same in one tab: Cleo logs signed out, signs in, logs signed in, signs out; Dana signs in, no reload');
  {
    const P = await openPhone();
    const cleo = await logSignedOut(P, 'Cleo');
    await sleep(700);
    const cleoUid = await makeAccount('cleo@nextaccount.test');
    await signIn(P, 'cleo@nextaccount.test');
    ok('Cleo signs in and boots into a family of her own', await booted(P, cleoUid));
    const hidC = await hidOf(cleoUid);
    const signedInId = String(await P.evaluate(() => addEvent({ type: 'feed', method: 'bottle', amount: 90, time: Date.now() - 600000, notes: 'Cleo-signed-in' })));
    const mk = marksFrom(cleo, { eventIds: [signedInId], notes: ['Cleo-signed-in'] });
    const inC = await until(async () => { const m = await marksIn(hidC, mk); return (m.babies.length === 1 && m.events.length === 2) ? m : null; }, 10000);
    ok('(the matcher finds Cleo\'s baby and both her entries in Cleo\'s own family)', !!inC, await marksIn(hidC, mk));
    ok('Cleo signs out', await signOut(P));
    const danaUid = await makeAccount('dana@nextaccount.test');
    await signIn(P, 'dana@nextaccount.test');
    ok('Dana signs in in the same tab and boots into a family of her own', await booted(P, danaUid));
    const hidD = await hidOf(danaUid);
    ok('(Dana\'s family is not Cleo\'s)', hidD && hidD !== hidC, { hidC, hidD });
    await sleep(1500);
    const inD = await marksInOwned(danaUid, mk);
    ok('T no family Dana owns holds any of Cleo\'s babies', inD.babies.length === 0, inD);
    ok('T none of Cleo\'s entries, signed out or signed in', inD.events.length === 0, inD);
    const scrD = await marksOnScreen(P, mk);
    ok('T and Dana\'s screen shows none of Cleo\'s', countOf(scrD) === 0, scrD);
    await P.browserContext().close();
  }

  /* ================================================================================================ */
  console.log('\nU. one tab: Hana signs in and out; Gail logs her own entry signed out, then signs in');
  {
    const P = await openPhone();
    const hana = await logSignedOut(P, 'Hana');
    await sleep(700);
    const hanaUid = await makeAccount('hana@nextaccount.test');
    await signIn(P, 'hana@nextaccount.test');
    ok('Hana signs in and boots into a family of her own', await booted(P, hanaUid));
    const hidH = await hidOf(hanaUid);
    const signedInId = String(await P.evaluate(() => addEvent({ type: 'feed', method: 'bottle', amount: 70, time: Date.now() - 500000, notes: 'Hana-signed-in' })));
    const mkH = marksFrom(hana, { eventIds: [signedInId], notes: ['Hana-signed-in'] });
    ok('(the matcher finds Hana\'s baby and both her entries in Hana\'s own family)',
      !!(await until(async () => { const m = await marksIn(hidH, mkH); return (m.babies.length === 1 && m.events.length === 2) ? m : null; }, 10000)), await marksIn(hidH, mkH));
    ok('Hana signs out', await signOut(P));
    const gail = await logSignedOut(P, 'Gail', { keepBabies: true });
    await sleep(700);
    const gailUid = await makeAccount('gail@nextaccount.test');
    await signIn(P, 'gail@nextaccount.test');
    ok('Gail signs in and boots into a family of her own', await booted(P, gailUid));
    const hidG = await hidOf(gailUid);
    ok('(Gail\'s family is not Hana\'s)', hidG && hidG !== hidH, { hidH, hidG });
    await sleep(1500);
    const mkG = marksFrom(gail);
    const gailIn = await until(async () => { const m = await marksIn(hidG, mkG); return (m.babies.length === 1 && m.events.length === 1) ? m : null; }, 10000);
    ok('U Gail\'s own baby and entry, logged before she signed in, reach Gail\'s family', !!gailIn, await marksIn(hidG, mkG));
    const inG = await marksInOwned(gailUid, mkH);
    ok('U no family Gail owns holds any of Hana\'s babies', inG.babies.length === 0, inG);
    ok('U none of Hana\'s entries', inG.events.length === 0, inG);
    const scrG = await marksOnScreen(P, mkH);
    ok('U and Gail\'s screen shows none of Hana\'s', countOf(scrG) === 0, scrG);
    await P.browserContext().close();
  }

  /* ================================================================================================ */
  console.log('\nV. Ivy is signed out from elsewhere a moment after logging; Jo signs in in that tab; Ivy comes back');
  {
    const P = await openPhone();
    const ivyUid = await makeAccount('ivy@nextaccount.test');
    await signIn(P, 'ivy@nextaccount.test');
    ok('Ivy signs in and boots into a family of her own', await booted(P, ivyUid));
    const hidI = await hidOf(ivyUid);
    const bIvy = { id: 'bivy', name: 'Baby-of-Ivy', birth: Date.now() - 30 * 86400000, sex: 'M', routines: [], doctors: [], allergies: [] };
    await P.evaluate((b) => { state.babies = [b]; state.activeBabyId = b.id; persist(); }, bIvy);
    ok('(her baby reached her family)', !!(await until(async () => ((((await adminGet('households/' + hidI)) || {}).app || {}).babies || []).some((b) => b.id === 'bivy'), 8000)));
    /* Logged, then signed out from elsewhere before the 350 ms push: auth.signOut() straight away, the way
       another tab's sign-out or a revoked session reaches this one (no LL.signOut, so no flush). */
    const ivyId = String(await P.evaluate(() => { const id = addEvent({ type: 'feed', method: 'bottle', amount: 50, time: Date.now() - 300000, notes: 'Ivy-unsent' }); window.LL.auth.signOut(); return id; }));
    ok('(signed out, the door is up)', !!(await until(() => P.evaluate(() => !window.LL.auth.currentUser && !!document.getElementById('llAuthOv')), 10000)));
    await sleep(800);
    ok('(her entry had not reached her family when auth went)', !(await adminGet('households/' + hidI + '/events/' + ivyId)));
    const mkI = { babyIds: ['bivy'], babyNames: ['Baby-of-Ivy'], eventIds: [ivyId], notes: ['Ivy-unsent'], photoIds: [] };
    const scrI = await marksOnScreen(P, mkI);
    ok('V nothing of Ivy\'s is left in memory after the sign-out', countOf(scrI) === 0, scrI);
    const joUid = await makeAccount('jo@nextaccount.test');
    await signIn(P, 'jo@nextaccount.test');
    ok('Jo signs in in the same tab and boots into a family of her own', await booted(P, joUid));
    await P.evaluate(() => addEvent({ type: 'diaper', kind: 'wet', time: Date.now() - 60000, notes: 'Jo-own' })); // her own first entry: a push
    await sleep(2000);
    const inJ = await marksInOwned(joUid, mkI);
    ok('V no family Jo owns holds any of Ivy\'s babies or entries', inJ.babies.length + inJ.events.length === 0, inJ);
    const scrJ = await marksOnScreen(P, mkI);
    ok('V and Jo\'s screen shows none of Ivy\'s', countOf(scrJ) === 0, scrJ);
    ok('Jo signs out', await signOut(P));
    await signIn(P, 'ivy@nextaccount.test');
    ok('Ivy signs back in', await booted(P, ivyUid));
    const landed = await until(async () => adminGet('households/' + hidI + '/events/' + ivyId), 12000);
    ok('V the entry she logged before she was signed out reaches her own family', !!landed && landed.notes === 'Ivy-unsent', landed);
    ok('V authored by her', !!landed && landed.authorId === ivyUid, landed && landed.authorId);
    await P.browserContext().close();
  }

  /* ================================================================================================ */
  console.log('\nO. the copy an older build left: Kim opens this build signed in, then Lia signs in on her phone');
  {
    const P = await openPhone();
    const kim = await logSignedOut(P, 'Kim');
    await sleep(700);
    const kimRecord = await P.evaluate(() => localStorage.getItem('little-log-v1'));
    const kimUid = await makeAccount('kim@nextaccount.test');
    await signIn(P, 'kim@nextaccount.test');
    ok('Kim signs in and boots into a family of her own', await booted(P, kimUid));
    const hidK = await hidOf(kimUid);
    const mkK = marksFrom(kim);
    ok('(the matcher finds Kim\'s baby and entry in Kim\'s own family)', !!(await until(async () => { const m = await marksIn(hidK, mkK); return (m.babies.length === 1 && m.events.length === 1) ? m : null; }, 10000)), await marksIn(hidK, mkK));
    /* What a build without this fix leaves on the phone: it copied the record and kept it, byte for byte.
       Staged by writing back exactly the record it read, plus one entry somebody logged signed out that no
       family holds yet (it must never be let go). */
    const strangerId = 'strangerk' + Date.now().toString(36);
    await P.evaluate((r, sid) => { const s = JSON.parse(r); s.events.push({ id: sid, type: 'diaper', kind: 'dirty', time: Date.now() - 900000, notes: 'Nobody-yet' }); localStorage.setItem('little-log-v1', JSON.stringify(s)); }, kimRecord, strangerId);
    ok('(the older build\'s copy is on the phone again)', (await cacheOf(P)).events.some((e) => e.id === kim.eventId));
    await P.reload({ waitUntil: 'networkidle2', timeout: 45000 }); await ready(P);
    ok('Kim opens this build, still signed in', await booted(P, kimUid));
    const gone = await until(async () => { const c = await cacheOf(P); return (!c.events.some((e) => e.id === kim.eventId) && !c.babies.some((b) => b.id === kim.babyId)) ? c : null; }, 12000);
    ok('O what her family already holds leaves the phone\'s record', !!gone, await cacheOf(P));
    ok('O the entry no family holds yet stays on the phone', (await cacheOf(P)).events.some((e) => e.id === strangerId), await cacheOf(P));
    ok('Kim signs out', await signOut(P));
    await P.reload({ waitUntil: 'networkidle2', timeout: 45000 }); await ready(P);
    const liaUid = await makeAccount('lia@nextaccount.test');
    await signIn(P, 'lia@nextaccount.test');
    ok('Lia signs in on Kim\'s phone and boots into a family of her own', await booted(P, liaUid));
    await sleep(1500);
    const inL = await marksInOwned(liaUid, mkK);
    ok('O no family Lia owns holds any of Kim\'s babies or entries', inL.babies.length + inL.events.length === 0, inL);
    const scrL = await marksOnScreen(P, mkK);
    ok('O and Lia\'s screen shows none of Kim\'s', countOf(scrL) === 0, scrL);
    await P.browserContext().close();
  }

  /* ================================================================================================ */
  console.log('\nD. Mia deletes her account with an entry still unsent');
  {
    const P = await openPhone();
    const miaUid = await makeAccount('mia@nextaccount.test');
    await signIn(P, 'mia@nextaccount.test');
    ok('Mia signs in and boots into a family of her own', await booted(P, miaUid));
    await sleep(1500);
    // An entry in memory that no push has sent: exactly what the outbox for a sign-out from elsewhere would carry.
    await P.evaluate(() => { state.events.push({ id: 'miaunsent' + Date.now().toString(36), type: 'diaper', kind: 'wet', time: Date.now() - 60000, notes: 'Mia-unsent' }); });
    const res = await P.evaluate(() => window.LL.deleteAccount().then(() => 'resolved', (e) => String((e && (e.code || e.message)) || e)));
    ok('(her deletion finished)', res === 'resolved', res);
    ok('(and she is signed out)', !!(await until(() => P.evaluate(() => !window.LL.auth.currentUser), 15000)));
    await sleep(800);
    const keys = await P.evaluate((u) => Object.keys(localStorage).filter((k) => k.indexOf(u) >= 0), miaUid);
    ok('D no outbox of the deleted account is left on the phone', !keys.some((k) => k.indexOf('cubby-outbox:') === 0), keys);
    if (keys.length) console.log('    (other keys naming her uid, for reading: ' + JSON.stringify(keys) + ')');
    await P.browserContext().close();
  }

  /* ================================================================================================ */
  console.log('\nK. a parent\'s own pre-sign-in entries still reach her own new family');
  {
    const P = await openPhone();
    const eve = await logSignedOut(P, 'Eve', { photo: true });
    await sleep(700);
    const eveUid = await makeAccount('eve@nextaccount.test');
    await signIn(P, 'eve@nextaccount.test');
    ok('Eve signs in and boots into a family of her own', await booted(P, eveUid));
    const hidE = await hidOf(eveUid);
    const inE = await until(async () => { const m = await marksIn(hidE, marksFrom(eve)); return countOf(m) === 3 ? m : null; }, 10000);
    ok('K her baby, her entry and her photo are in her family', !!inE, await marksIn(hidE, marksFrom(eve)));
    await P.browserContext().close();
  }

  /* ================================================================================================ */
  console.log('\nN. a migration the server refuses lets go of nothing');
  {
    const P = await openPhone();
    const fay = await logSignedOut(P, 'Fay');
    /* An entry whose authorId is somebody else's uid: the rules refuse its create (authorId must be the
       writer), so the migration's writes cannot all land and resolveHousehold throws. */
    const foreignId = String(await P.evaluate(() => addEvent({ type: 'diaper', kind: 'dirty', time: Date.now() - 1800000, notes: 'Fay-foreign', authorId: 'someone-else-entirely' })));
    await sleep(700);
    await makeAccount('fay@nextaccount.test');
    await signIn(P, 'fay@nextaccount.test');
    const failed = await until(() => P.evaluate(() => !!document.getElementById('llAuthOv') && !window.LL.householdId), 20000);
    ok('(the refused migration does not boot her into a family)', !!failed, await P.evaluate(() => ({ hid: window.LL.householdId, ov: !!document.getElementById('llAuthOv') })));
    await sleep(1500);
    const cN = await cacheOf(P);
    ok('N both of her entries are still on the phone', cN.events.some((e) => e.id === fay.eventId) && cN.events.some((e) => e.id === foreignId), cN);
    ok('N and her baby', cN.babies.some((b) => b.id === fay.babyId), cN);
    await P.browserContext().close();
  }

  /* ================================================================================================ */
  console.log('\nH. Nora signs out while her family\'s full history read is still out; it lands after; Pam signs in in that tab');
  {
    const P = await openPhone();
    const noraUid = await makeAccount('nora@nextaccount.test');
    await signIn(P, 'nora@nextaccount.test');
    ok('Nora signs in and boots into a family of her own', await booted(P, noraUid));
    const hidN = await hidOf(noraUid);
    /* Two entries older than the four-month boot window: only the full history read brings them into memory. */
    const bN = { id: 'bnora', name: 'Baby-of-Nora', birth: Date.now() - 300 * 86400000, sex: 'F', routines: [], doctors: [], allergies: [] };
    const oldIds = (await P.evaluate((b) => {
      state.babies = [b]; state.activeBabyId = b.id;
      const ids = [addEvent({ type: 'diaper', kind: 'wet', time: Date.now() - 200 * 86400000, notes: 'Nora-old-1' }),
        addEvent({ type: 'feed', method: 'bottle', amount: 60, time: Date.now() - 210 * 86400000, notes: 'Nora-old-2' })];
      persist(); return ids;
    }, bN)).map(String);
    const mk = { babyIds: ['bnora'], babyNames: ['Baby-of-Nora'], eventIds: oldIds, notes: ['Nora-old-1', 'Nora-old-2'], photoIds: [] };
    ok('(the matcher finds her baby and both older entries in Nora\'s own family)',
      !!(await until(async () => { const m = await marksIn(hidN, mk); return (m.babies.length === 1 && m.events.length === 2) ? m : null; }, 10000)), await marksIn(hidN, mk));
    await holdHistoryReads(P);
    await P.reload({ waitUntil: 'networkidle2', timeout: 45000 }); await ready(P);
    ok('Nora opens Cubby again, still signed in', await booted(P, noraUid));
    const out = await until(async () => { const h = await heldReads(P); return h.reads.length ? h : null; }, 10000);
    const scr0 = await marksOnScreen(P, mk);
    ok('(her family\'s full history read is out, held, when she signs out: her older entries are not in memory yet)',
      !!out && out.reads.length === 1 && out.reads[0].state === 'held' && /\/events$/.test(out.reads[0].path) && out.pending === true && scr0.events.length === 0 && scr0.babies.length === 1, { out, scr0 });
    ok('Nora taps Log out', await signOut(P));
    ok('(memory is empty right after Log out)', countOf(await marksOnScreen(P, mk)) === 0, await marksOnScreen(P, mk));
    ok('(the read lands after she signed out, and the app has taken its answer)', await heldRead(P, 0, 'land'), await heldReads(P));
    const late = await marksOnScreen(P, mk);
    ok('H none of Nora\'s entries comes back into memory when that read lands', countOf(late) === 0, late);
    // The next person logs before she signs in: a save with no family attached writes memory into the phone's record.
    const pamId = String(await P.evaluate(() => addEvent({ type: 'diaper', kind: 'dirty', time: Date.now() - 120000, notes: 'Pam-before-sign-in' })));
    const rec = await until(async () => { const c = await cacheOf(P); return c.events.some((e) => e.id === pamId) ? c : null; }, 8000);
    ok('H that save writes none of Nora\'s entries into the phone\'s record', !!rec && !rec.events.some((e) => oldIds.includes(e.id)), rec || await cacheOf(P));
    const pamUid = await makeAccount('pam@nextaccount.test');
    await signIn(P, 'pam@nextaccount.test');
    const hidP = await until(() => hidOf(pamUid), 20000);
    ok('H Pam\'s sign-in finishes: the server names a family of her own', !!hidP && hidP !== hidN && (((await adminGet('households/' + hidP)) || {}).ownerId === pamUid), { hidP, hidN, users: await adminGet('users/' + pamUid) });
    const pamIn = hidP ? await until(async () => (await adminGet('households/' + hidP + '/events/' + pamId)), 10000) : null;
    ok('H and her own entry, logged before she signed in, reaches it', !!pamIn && pamIn.notes === 'Pam-before-sign-in', pamIn);
    await sleep(1500); // anything the sign-in would write has landed
    const inP = await marksInOwned(pamUid, mk);
    ok('H no family Pam owns holds any of Nora\'s entries or her baby', inP.events.length + inP.babies.length === 0, inP);
    const scrP = await marksOnScreen(P, mk);
    ok('H and none of Nora\'s is in memory under Pam', countOf(scrP) === 0, scrP);
    const pamScreen = await P.evaluate(() => ({ householdId: window.LL.householdId || null, door: ((document.getElementById('llAuthOv') || {}).innerText || '').slice(0, 60) }));
    console.log('    (Pam\'s screen, for reading and not asserted: ' + JSON.stringify(pamScreen) + ')');
    await P.browserContext().close();
  }

  /* ================================================================================================ */
  console.log('\nH2. the same read fails after Rosa signed out and Sue\'s family is attached in that tab');
  {
    const P = await openPhone();
    const rosaUid = await makeAccount('rosa@nextaccount.test');
    await signIn(P, 'rosa@nextaccount.test');
    ok('Rosa signs in and boots into a family of her own', await booted(P, rosaUid));
    ok('(once a family\'s whole history is read, the page says so: cubbyHistoryPending is false)',
      !!(await until(() => P.evaluate(() => window.cubbyHistoryPending === false), 10000)), await heldReads(P));
    await holdHistoryReads(P);
    await P.reload({ waitUntil: 'networkidle2', timeout: 45000 }); await ready(P);
    ok('Rosa opens Cubby again, still signed in', await booted(P, rosaUid));
    const out = await until(async () => { const h = await heldReads(P); return h.reads.length ? h : null; }, 10000);
    ok('(her family\'s full history read is out, held, and the page says history is still loading)',
      !!out && out.reads.length === 1 && out.reads[0].state === 'held' && out.pending === true, out);
    ok('Rosa taps Log out', await signOut(P));
    const sueUid = await makeAccount('sue@nextaccount.test');
    await signIn(P, 'sue@nextaccount.test');
    const hidS = await until(async () => { const h = await hidOf(sueUid); return (h && await P.evaluate((x) => window.LL.householdId === x, h)) ? h : null; }, 20000);
    ok('(Sue\'s own family is attached in that tab)', !!hidS, { hidS, page: await P.evaluate(() => window.LL.householdId || null) });
    const before = await heldReads(P);
    ok('(the read Rosa left behind fails now, and the app has taken that failure)', await heldRead(P, 0, 'fail'), await heldReads(P));
    const after = await heldReads(P);
    ok('H2 Sue\'s family is still told its history is loading: that failure was about Rosa\'s family', after.pending === true, { before, after });
    // Let anything still held go, so nothing waits on this test after it.
    await P.evaluate(() => (window.__heldReads || []).forEach((r, i) => { if (r.state === 'held') window.__releaseRead(i, 'land'); }));
    await sleep(300);
    await P.browserContext().close();
  }

  /* ================================================================================================ */
  console.log('\nH3. Olive signs out with her family\'s full history read still out; Quinn signs in and her family attaches; THEN that read lands');
  {
    /* Quinn already has a family with two older entries of her own, logged on another phone: her own full
       history read then has something to bring, and her history state has something to be disturbed. */
    const quinnUid = await makeAccount('quinn@nextaccount.test');
    const Q = await openPhone();
    await signIn(Q, 'quinn@nextaccount.test');
    ok('Quinn signs in on her own phone and boots into a family of her own', await booted(Q, quinnUid));
    const hidQ = await hidOf(quinnUid);
    const bQ = { id: 'bquinn', name: 'Baby-of-Quinn', birth: Date.now() - 300 * 86400000, sex: 'M', routines: [], doctors: [], allergies: [] };
    const qOldIds = (await Q.evaluate((b) => {
      state.babies = [b]; state.activeBabyId = b.id;
      const ids = [addEvent({ type: 'diaper', kind: 'dirty', time: Date.now() - 190 * 86400000, notes: 'Quinn-old-1' }),
        addEvent({ type: 'feed', method: 'bottle', amount: 70, time: Date.now() - 220 * 86400000, notes: 'Quinn-old-2' })];
      persist(); return ids;
    }, bQ)).map(String);
    const mkQ = { babyIds: ['bquinn'], babyNames: ['Baby-of-Quinn'], eventIds: qOldIds, notes: ['Quinn-old-1', 'Quinn-old-2'], photoIds: [] };
    ok('(the matcher finds her baby and both older entries in Quinn\'s own family)',
      !!(await until(async () => { const m = await marksIn(hidQ, mkQ); return (m.babies.length === 1 && m.events.length === 2) ? m : null; }, 10000)), await marksIn(hidQ, mkQ));
    await Q.browserContext().close();

    const P = await openPhone();
    const oliveUid = await makeAccount('olive@nextaccount.test');
    await signIn(P, 'olive@nextaccount.test');
    ok('Olive signs in and boots into a family of her own', await booted(P, oliveUid));
    const hidO = await hidOf(oliveUid);
    const bO = { id: 'bolive', name: 'Baby-of-Olive', birth: Date.now() - 300 * 86400000, sex: 'F', routines: [], doctors: [], allergies: [] };
    const oOldIds = (await P.evaluate((b) => {
      state.babies = [b]; state.activeBabyId = b.id;
      const ids = [addEvent({ type: 'diaper', kind: 'wet', time: Date.now() - 200 * 86400000, notes: 'Olive-old-1' }),
        addEvent({ type: 'feed', method: 'bottle', amount: 60, time: Date.now() - 210 * 86400000, notes: 'Olive-old-2' })];
      persist(); return ids;
    }, bO)).map(String);
    const mkO = { babyIds: ['bolive'], babyNames: ['Baby-of-Olive'], eventIds: oOldIds, notes: ['Olive-old-1', 'Olive-old-2'], photoIds: [] };
    ok('(the matcher finds her baby and both older entries in Olive\'s own family)',
      !!(await until(async () => { const m = await marksIn(hidO, mkO); return (m.babies.length === 1 && m.events.length === 2) ? m : null; }, 10000)), await marksIn(hidO, mkO));
    await holdHistoryReads(P);
    await P.reload({ waitUntil: 'networkidle2', timeout: 45000 }); await ready(P);
    ok('Olive opens Cubby again, still signed in', await booted(P, oliveUid));
    const readOf = (h, hid) => h.reads.findIndex((r) => r.path === 'households/' + hid + '/events');
    const out = await until(async () => { const h = await heldReads(P); return readOf(h, hidO) >= 0 ? h : null; }, 10000);
    const scr0 = await marksOnScreen(P, mkO);
    ok('(her family\'s full history read is out, held, when she signs out: her older entries are not in memory yet)',
      !!out && out.reads.length === 1 && out.reads[0].state === 'held' && out.pending === true && scr0.events.length === 0 && scr0.babies.length === 1, { out, scr0 });
    ok('Olive taps Log out', await signOut(P));
    await signIn(P, 'quinn@nextaccount.test');
    /* Quinn's family is attached when ITS full history read is out: startSync made eventsRef for her events
       and her first events snapshot asked for the rest. Hers is held too, so her history state can be read
       before and after Olive's read lands. */
    const both = await until(async () => { const h = await heldReads(P); return readOf(h, hidQ) >= 0 ? h : null; }, 20000);
    const nQ = both ? readOf(both, hidQ) : -1, nO = both ? readOf(both, hidO) : -1;
    ok('(Quinn\'s family is attached in that tab: her own full history read is out, held, and Olive\'s is still held)',
      !!both && nQ >= 0 && both.reads[nQ].state === 'held' && both.reads[nO].state === 'held' && (await P.evaluate((x) => window.LL.householdId === x, hidQ)), both);
    const quinnBefore = await P.evaluate(() => ({ pending: window.cubbyHistoryPending, ids: (state.events || []).map((e) => String(e.id)).sort() }));
    const qScr0 = await marksOnScreen(P, mkQ);
    ok('(Quinn\'s history is still loading: her older entries are not in memory yet)', quinnBefore.pending === true && qScr0.events.length === 0, { quinnBefore, qScr0 });
    ok('(the read Olive left behind lands now, with Quinn\'s family attached, and the app has taken its answer)', await heldRead(P, nO, 'land'), await heldReads(P));
    const late = await marksOnScreen(P, mkO);
    ok('H3 none of Olive\'s entries comes into memory under Quinn when that read lands', countOf(late) === 0, late);
    const quinnAfter = await P.evaluate(() => ({ pending: window.cubbyHistoryPending, ids: (state.events || []).map((e) => String(e.id)).sort() }));
    ok('H3 Quinn\'s own history state is undisturbed: still loading, and memory holds exactly what it held',
      quinnAfter.pending === true && JSON.stringify(quinnAfter.ids) === JSON.stringify(quinnBefore.ids), { quinnBefore, quinnAfter });
    // Quinn logs, so a push runs with whatever memory now holds.
    const qNewId = String(await P.evaluate(() => addEvent({ type: 'diaper', kind: 'wet', time: Date.now() - 60000, notes: 'Quinn-after-the-late-read' })));
    const qNew = await until(async () => (await adminGet('households/' + hidQ + '/events/' + qNewId)), 10000);
    ok('(Quinn\'s new entry reaches her family)', !!qNew && qNew.notes === 'Quinn-after-the-late-read', qNew);
    await sleep(1500); // anything that push would carry has landed
    const inQ = await marksInOwned(quinnUid, mkO);
    ok('H3 no family Quinn owns holds any of Olive\'s entries or her baby', inQ.events.length + inQ.babies.length === 0, inQ);
    ok('(Quinn\'s own history read lands now)', await heldRead(P, nQ, 'land'), await heldReads(P));
    const qDone = await until(async () => { const m = await marksOnScreen(P, mkQ); return m.events.length === 2 ? m : null; }, 8000);
    const pendingDone = await P.evaluate(() => window.cubbyHistoryPending);
    ok('H3 and it still does its work: Quinn\'s two older entries come into memory and her family is told its history is in',
      !!qDone && pendingDone === false, { qDone: qDone || await marksOnScreen(P, mkQ), pendingDone });
    const end = await marksOnScreen(P, mkO);
    ok('H3 and still none of Olive\'s is in memory under Quinn', countOf(end) === 0, end);
    await P.evaluate(() => (window.__heldReads || []).forEach((r, i) => { if (r.state === 'held') window.__releaseRead(i, 'land'); }));
    await sleep(300);
    await P.browserContext().close();
  }

  /* ================================================================================================ */
  if (consoleErrs.length) console.log('\n  (console errors seen, for reading: ' + JSON.stringify([...new Set(consoleErrs)].slice(0, 8)) + ')');
  ok('no page errors', errs.length === 0, errs.slice(0, 4));
  ok('nothing off localhost was ever answered', offHostAnswered.length === 0, [...new Set(offHostAnswered)]);

  await browser.close();
  serveProc.kill();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('NEXT-ACCOUNT-CACHE: ' + (fail ? 'FAIL' : 'PASS') + '\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('threw:', e); process.exit(1); });
