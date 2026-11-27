/* After a sign-out, nothing on the page still describes the family that was left, while the next account waits
 * for its own.
 *
 * The REAL app/store-firebase.js client against the Firestore + Auth emulators and the real rules, one tab, two
 * accounts, no reload. The household snapshot sets window.LL.householdId, members, memberInfo, formerMemberInfo,
 * hhPending, hhPendingLinks, pro and role, and sign-out (teardown) used to leave all eight behind: from the door
 * until the next account's first household snapshot, the page still named the previous family, its roster, its
 * owner role and its Pro (S21 skeptic, 26 Nov 2026; the same family of bug as
 * docs/postmortems/2026-11-19-pre-sign-in-data-reaches-next-account.md). Her sign-in's own state stayed too: an
 * invite still to offer her (pendingInvite, pendingInviteQueue), a join just made (justJoined), her first run
 * (needsIdentity, and the flag that it was shown, so the next account's own first run was skipped).
 *
 *   A  Ann (owner; her family has a caregiver, Zinnia, a former nanny, a pending invite, a link and Pro) signs in. Every
 *      matcher below first finds Ann's family in her own session: her id and roster in window.LL, Pro on,
 *      her family sheet naming Zinnia, her feedback stamped with her family's id.
 *   S  Ann logs out (LL.signOut). At the door, none of the eight fields names her family, and nothing of her
 *      sign-in's own state is left (staged in her session as resolveHousehold leaves it when she is mid-identity).
 *   G  Bea, a new account, signs in on the same tab and her household snapshot is HELD in the SDK (the server
 *      answers as usual; the test decides when the app hears it). In that gap:
 *        G1 none of the eight fields names Ann's family (Bea's own family is not known yet either)
 *        G2 feedback Bea sends is not stamped with Ann's family id (the feedback rule checks only the uid,
 *           so a stale id is accepted by the server: this is the one write a stale value really lands)
 *        G3 nothing on the page so much as TRIES a write naming Ann's family (feedback, an invite link Bea asks
 *           for): a spy on the SDK's write calls, since the rules refuse the link on either tree
 *        G4 the family sheet (seen to render) shows none of Ann's roster
 *        G5 Pro is not on (Ann's family has it, Bea's does not)
 *      Then the snapshot is let through: Bea boots into her own family, window.LL describes it, and she gets her
 *      own first run, as Ann did.
 *      Not staged: the avatar claim. It writes only for a uid in memberInfo, and Bea is never in Ann's, so it tries
 *      nothing on either tree (and the rules would refuse it).
 *   E  Ann signs back in (everything of hers is back), then is signed out from elsewhere (auth.signOut, the way
 *      another tab or a revoked session lands): the eight fields are cleared there too.
 *
 * Every "none of X" assertion uses the same matcher that first finds X in Ann's own session (section A, and the
 * staged sign-in state just before S).
 *
 *   node test/stale-family-memory-emulator.test.js
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
const FS_PORT = Number(process.env.FS_PORT) || 8797;
const AUTH_PORT = Number(process.env.AUTH_PORT) || 9797;
const WEB_PORT = Number(process.env.WEB_PORT) || 8798;
const HUB_PORT = Number(process.env.HUB_PORT) || 0, LOG_PORT = Number(process.env.LOG_PORT) || 0, WS_PORT = Number(process.env.WS_PORT) || 0;
const EXEC_PROJECT = 'demo-cubby-stalefamily';
const PAGE_PROJECT = 'little-log-a9caa'; // the id app/firebase-init.js gives the SDK; emulator only
const RULES_FILE = process.env.RULES_FILE || path.join(ROOT, 'firestore.rules');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PW = 'emulator-only-pw-stalefamily';
const FIELDS = ['householdId', 'members', 'memberInfo', 'formerMemberInfo', 'hhPending', 'hhPendingLinks', 'pro', 'role'];

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
if (!process.env.STALE_FAMILY_INNER) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-stalefamily-'));
  fs.copyFileSync(RULES_FILE, path.join(scratch, 'firestore.rules'));
  fs.writeFileSync(path.join(scratch, 'firebase.json'), JSON.stringify({
    firestore: { rules: 'firestore.rules' },
    emulators: Object.assign({ firestore: Object.assign({ port: FS_PORT }, WS_PORT ? { websocketPort: WS_PORT } : {}), auth: { port: AUTH_PORT }, ui: { enabled: false } },
      HUB_PORT ? { hub: { port: HUB_PORT } } : {}, LOG_PORT ? { logging: { port: LOG_PORT } } : {})
  }));
  const firebaseBin = path.join(__dirname, 'node_modules', '.bin', 'firebase');
  const javaBin = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin') : '/opt/homebrew/opt/openjdk/bin';
  const env = Object.assign({}, process.env, { STALE_FAMILY_INNER: '1', PATH: javaBin + ':' + process.env.PATH });
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
function toValue(x) {
  if (x === null || x === undefined) return { nullValue: null };
  if (typeof x === 'boolean') return { booleanValue: x };
  if (typeof x === 'number') return Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x };
  if (typeof x === 'string') return { stringValue: x };
  if (Array.isArray(x)) return { arrayValue: { values: x.map(toValue) } };
  const fields = {}; Object.keys(x).forEach((k) => { fields[k] = toValue(x[k]); }); return { mapValue: { fields } };
}
async function adminGet(p) {
  const r = await fetch(FS_DOCS + p, { headers: ADMIN });
  if (r.status === 404) return null;
  const j = await r.json();
  return fromValue({ mapValue: { fields: j.fields || {} } });
}
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
/* Set top-level fields of a document as the server (the billing Worker writes pro this way). */
async function adminPatch(p, obj) {
  const mask = Object.keys(obj).map((k) => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  const fields = {}; Object.keys(obj).forEach((k) => { fields[k] = toValue(obj[k]); });
  const r = await fetch(FS_DOCS + p + '?' + mask, { method: 'PATCH', headers: ADMIN, body: JSON.stringify({ fields }) });
  return r.ok;
}
async function until(fn, ms) {
  const stop = Date.now() + (ms || 10000);
  let v;
  while (Date.now() < stop) { v = await fn(); if (v) return v; await sleep(100); }
  return v;
}

/* ---------- inner phase ---------- */
(async () => {
  console.log('\nafter a sign-out nothing on the page still describes the family that was left, real client, real rules (' + (process.env.RULES_FILE ? 'RULES_FILE=' + RULES_FILE : 'firestore.rules') + ')\n');
  const serveProc = spawn('node', [path.join(ROOT, 'tools', 'serve.js')],
    { stdio: 'ignore', env: Object.assign({}, process.env, { PORT: String(WEB_PORT) }) });
  process.on('exit', () => { try { serveProc.kill(); } catch (e) {} });
  for (let i = 0; i < 40 && (await get(`http://localhost:${WEB_PORT}/app/`)).status !== 200; i++) await sleep(250);
  const servedStore = await fetch(`http://localhost:${WEB_PORT}/app/store-firebase.js`).then((r) => r.text()).catch(() => '');
  ok('the static server serves THIS checkout\'s store-firebase.js, byte for byte', servedStore === fs.readFileSync(path.join(ROOT, 'app', 'store-firebase.js'), 'utf8'));

  const puppeteer = require(path.join(ROOT, 'tools', 'node_modules', 'puppeteer-core'));
  const dl = require(path.join(ROOT, 'tools', 'gate_downloads.js'));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', downloadBehavior: dl.downloadBehavior(),
    args: ['--no-sandbox', '--disable-gpu', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1'] });
  const errs = [], offHostAnswered = [], consoleErrs = [];
  const AUTH_PROJECT = process.env.GCLOUD_PROJECT || EXEC_PROJECT;
  const appUrl = () => `http://localhost:${WEB_PORT}/app/?fsemu=${FS_PORT}&authemu=${AUTH_PORT}`;
  const ready = (page) => page.waitForFunction(() => !!(window.LL && window.LL.auth && window.LL.auth.signInWithEmailAndPassword), { timeout: 20000 });
  const makeAccount = async (email) => {
    const made = await fetch(`http://localhost:${AUTH_PORT}/identitytoolkit.googleapis.com/v1/projects/${AUTH_PROJECT}/accounts`,
      { method: 'POST', headers: ADMIN, body: JSON.stringify({ email, password: PW, emailVerified: true }) }).then((r) => r.json()).catch(() => ({}));
    if (!made.localId) throw new Error('could not make the emulator account: ' + JSON.stringify(made).slice(0, 200));
    return made.localId;
  };
  const signIn = (page, email) => page.evaluate((e, p) => window.LL.auth.signInWithEmailAndPassword(e, p).then(() => true), email, PW);
  const atDoor = (page) => page.waitForFunction(() => !window.LL.auth.currentUser && !!document.getElementById('llAuthOv'), { timeout: 15000 }).then(() => true, () => false);
  const hidOf = async (uid) => ((await adminGet('users/' + uid)) || {}).householdId || null; // the server's word, never the page's
  /* Booted AS this account into the family its own users doc names (checked against the server). */
  const booted = async (page, uid, ms) => {
    const stop = Date.now() + (ms || 45000);
    while (Date.now() < stop) {
      const on = await page.evaluate(() => ({ uid: window.LL.auth.currentUser && window.LL.auth.currentUser.uid, hid: window.LL.householdId || null, door: !!document.getElementById('llAuthOv') }));
      if (on.uid === uid && on.hid && !on.door && on.hid === await hidOf(uid)) return true;
      await sleep(200);
    }
    console.log('    (not booted as ' + uid + ': ' + JSON.stringify(await page.evaluate(() => ({ uid: window.LL.auth.currentUser && window.LL.auth.currentUser.uid, hid: window.LL.householdId || null }))) + ')');
    return false;
  };

  /* What of Ann's family the page holds right now: the ONE matcher every section uses. It looks for her family's
     id, any of its people's uids or names, its owner role and its Pro anywhere in the eight fields. */
  const traceOf = (page, mk) => page.evaluate((k, fields) => {
    const LL = window.LL || {}, hits = [];
    fields.forEach((f) => {
      const s = JSON.stringify(LL[f] === undefined ? null : LL[f]) || '';
      [k.hid].concat(k.uids, k.names).forEach((t) => { if (t && s.includes(t)) hits.push(f + ':' + t); });
    });
    // Bea has no former members, invites or links of her own: any row there is someone else's family's.
    ['formerMemberInfo', 'hhPending', 'hhPendingLinks'].forEach((f) => { if (LL[f] && Object.keys(LL[f]).length) hits.push(f + ':any'); });
    if (LL.role === 'owner' && k.ownerRole) hits.push('role:owner');
    if (LL.pro && LL.pro.active) hits.push('pro:active');
    let pro = null; try { pro = typeof isPro === 'function' ? isPro() : null; } catch (e) {}
    return { hits, isPro: pro, hid: LL.householdId === undefined ? null : LL.householdId, role: LL.role === undefined ? null : LL.role };
  }, mk, FIELDS);
  /* What of one sign-in's own state the page holds: an invite to offer, a queue of them, a join just made, a
     first run still owed. */
  const sessionOf = (page) => page.evaluate(() => {
    const LL = window.LL || {}, hits = [];
    if (LL.pendingInvite) hits.push('pendingInvite');
    if ((LL.pendingInviteQueue || []).length) hits.push('pendingInviteQueue');
    if (LL.justJoined) hits.push('justJoined');
    if (LL.needsIdentity) hits.push('needsIdentity');
    return hits;
  });
  /* A spy on every write the SDK is asked for (set, update, add, in a batch or not), kept as path + data text. It
     records what the page TRIES, whatever the rules then say. */
  const installWriteSpy = (page) => page.evaluate(() => {
    if (window.__writes) return true;
    window.__writes = [];
    const f = window.firebase && window.firebase.firestore;
    if (!f || !f.WriteBatch || !f.DocumentReference || !f.CollectionReference) return false;
    const text = (a) => { try { return JSON.stringify(a); } catch (e) { return String(a); } };
    const wrap = (proto, name, pathOf) => {
      const orig = proto[name];
      proto[name] = function () {
        try { window.__writes.push({ op: name, path: pathOf(this, arguments), data: text(Array.prototype.slice.call(arguments, pathOf.skip || 0)) }); } catch (e) {}
        return orig.apply(this, arguments);
      };
    };
    const refPath = (self) => self.path, argPath = (self, a) => (a[0] && a[0].path) || '';
    argPath.skip = 1;
    wrap(f.DocumentReference.prototype, 'set', refPath);
    wrap(f.DocumentReference.prototype, 'update', refPath);
    wrap(f.CollectionReference.prototype, 'add', refPath);
    wrap(f.WriteBatch.prototype, 'set', argPath);
    wrap(f.WriteBatch.prototype, 'update', argPath);
    return true;
  });
  const writesNaming = (page, hid) => page.evaluate((h) => (window.__writes || []).filter((w) => (w.path || '').includes(h) || (w.data || '').includes(h)).map((w) => w.op + ' ' + w.path), hid);
  const resetWrites = (page) => page.evaluate(() => { window.__writes = []; });
  /* The family sheet's text, as a person would read it, then closed again. */
  const familySheetText = async (page) => {
    const t = await page.evaluate(async () => {
      try { window.openFamily(); } catch (e) { return 'threw: ' + e.message; }
      await new Promise((r) => setTimeout(r, 400));
      const ov = document.getElementById('llModalOv');
      const txt = ov ? ov.innerText : '';
      if (ov) ov.remove();
      return txt;
    });
    return t || '';
  };
  const namesIn = (text, mk) => mk.names.filter((n) => text.includes(n));
  /* Send feedback the way a person does (the sheet, its text box, Send) and return the row the server holds. */
  const sendFeedback = async (page, uid, tag) => {
    await page.evaluate((t) => {
      window.openFeedback();
      document.getElementById('llFbText').value = t;
      document.getElementById('llFbSend').click();
    }, tag);
    const row = await until(async () => (await adminList('feedback')).find((d) => d.data.uid === uid && d.data.text === tag), 10000);
    await page.evaluate(() => { const ov = document.getElementById('llModalOv'); if (ov) ov.remove(); });
    return row ? row.data : null;
  };
  /* Every invite link the server holds for a family, made by one person. */
  const linksFor = async (hid, uid) => (await adminList('inviteLinks')).filter((d) => d.data.householdId === hid && d.data.invitedBy === uid);
  /* Hold the household snapshot in the SDK: a listener on households/{id} attached while window.__holdHh is on
     gets the server's answers queued, and hears them only when the test calls window.__releaseHh(). */
  const installHold = (page) => page.evaluate(() => {
    if (window.__hhHeld) return true;
    window.__hhHeld = []; window.__holdHh = false;
    const f = window.firebase && window.firebase.firestore;
    if (!f || !f.DocumentReference) return false;
    const orig = f.DocumentReference.prototype.onSnapshot;
    f.DocumentReference.prototype.onSnapshot = function () {
      const args = Array.prototype.slice.call(arguments);
      if (!window.__holdHh || !/^households\/[^/]+$/.test(this.path || '')) return orig.apply(this, args);
      const i = args.findIndex((a) => typeof a === 'function');
      if (i < 0) return orig.apply(this, args);
      const next = args[i], rec = { path: this.path, held: true, queue: [] };
      window.__hhHeld.push(rec);
      args[i] = function (snap) { if (rec.held) rec.queue.push(snap); else next(snap); };
      rec.release = () => { rec.held = false; const q = rec.queue; rec.queue = []; q.forEach((s) => next(s)); };
      return orig.apply(this, args);
    };
    window.__releaseHh = () => { window.__holdHh = false; window.__hhHeld.forEach((r) => r.release()); };
    return true;
  });

  const P = await (async () => {
    const ctx = await browser.createBrowserContext({ downloadBehavior: dl.downloadBehavior() });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 300)); });
    page.on('response', (rs) => { try { const h = new URL(rs.url()).hostname; if (h && h !== 'localhost' && h !== '127.0.0.1') offHostAnswered.push(h); } catch (e) {} });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await page.goto(appUrl(), { waitUntil: 'networkidle2', timeout: 45000 });
    await ready(page);
    return page;
  })();

  /* ================================================================================================ */
  console.log('A. Ann signs in, makes an invite link; her family has a caregiver, a former nanny, a pending invite and Pro');
  const annUid = await makeAccount('ann@stalefamily.test');
  const beaUid = await makeAccount('bea@stalefamily.test');
  ok('(the write spy is installed in the SDK)', await installWriteSpy(P));
  await signIn(P, 'ann@stalefamily.test');
  ok('Ann boots into a family of her own', await booted(P, annUid));
  const hidA = await hidOf(annUid);
  ok('(a brand-new owner with nothing logged, she is owed her first run: needsIdentity)', (await sessionOf(P)).includes('needsIdentity'), await sessionOf(P));
  const annLink = await P.evaluate(() => window.LL.createInviteLink({ relationship: 'Friend' }).then((r) => !!r, (e) => 'threw: ' + e.message));
  ok('(the write spy sees her link\'s writes naming her family)', (await writesNaming(P, hidA)).some((w) => /inviteLinks/.test(w)), await writesNaming(P, hidA));
  ok('(an invite link she asks for is made for her family, and its row is on the household)', annLink === true && (await linksFor(hidA, annUid)).length === 1, { annLink, links: await linksFor(hidA, annUid) });
  const zinUid = 'zinniaCaregiver0001';
  const hhA = (await adminGet('households/' + hidA)) || {};
  const seeded = await adminPatch('households/' + hidA, {
    members: Object.assign({}, hhA.members || {}, { [zinUid]: 'caregiver' }),
    memberInfo: Object.assign({}, hhA.memberInfo || {}, {
      [annUid]: Object.assign({}, (hhA.memberInfo || {})[annUid] || {}, { name: 'Annabelle Quill', relationship: 'Mama Bear', role: 'owner' }),
      [zinUid]: { name: 'Zinnia Marlowe', relationship: 'Godmother', role: 'caregiver' }
    }),
    formerMemberInfo: { formerXyloUid0001: { name: 'Xylo Brandt', relationship: 'Nanny' } },
    pendingInvites: { 'yarrow@stalefamily.test': { name: 'Yarrow', relationship: 'Grandma', role: 'caregiver', at: Date.now() } },
    pro: { active: true, plan: 'annual', until: Date.now() + 30 * 86400000 }
  });
  ok('(the server takes Ann\'s family as seeded: Zinnia, a former nanny, an invite, Pro)', seeded);
  const mk = { hid: hidA, uids: [annUid, zinUid, 'formerXyloUid0001'], names: ['Zinnia', 'Godmother', 'Annabelle', 'Xylo', 'yarrow@stalefamily.test'], ownerRole: true };
  const mine = await until(async () => { const t = await traceOf(P, mk); return t.hits.includes('pro:active') && t.hits.includes('memberInfo:Zinnia') ? t : null; }, 10000);
  ok('(the matcher finds Ann\'s family in all eight fields in her own session)',
    !!mine && FIELDS.every((f) => mine.hits.some((h) => h.split(':')[0] === f)), mine || await traceOf(P, mk));
  ok('(and Pro is on for her: isPro())', !!mine && mine.isPro === true, mine);
  const annSheet = await familySheetText(P);
  ok('(her family sheet renders and names Zinnia)', annSheet.includes('Family & sharing') && namesIn(annSheet, mk).includes('Zinnia'), annSheet.slice(0, 300));
  const annFb = await sendFeedback(P, annUid, 'ann-feedback-stalefamily');
  ok('(feedback she sends is stamped with her family\'s id)', !!annFb && annFb.householdId === hidA, annFb);
  /* What resolveHousehold leaves when she has an offer from another family and is still finishing her identity
     (maybePromptPendingInvite waits for her), and a join it just made. */
  await P.evaluate(() => {
    window.LL.pendingInvite = { householdId: 'otherFamilyOffer01', invitedByName: 'Wren', relationship: 'Auntie' };
    window.LL.pendingInviteQueue = [{ householdId: 'otherFamilyOffer02', invitedByName: 'Moss' }];
    window.LL.justJoined = { invitedBy: 'wrenUid0001', role: 'caregiver' };
  });
  const annSession = await sessionOf(P);
  ok('(the matcher finds all four of her sign-in\'s own state)', ['pendingInvite', 'pendingInviteQueue', 'justJoined', 'needsIdentity'].every((k) => annSession.includes(k)), annSession);

  /* ================================================================================================ */
  console.log('S. Ann logs out: at the door nothing names her family');
  await P.evaluate(() => window.LL.signOut());
  ok('Ann is at the door', await atDoor(P));
  await sleep(300);
  const door = await traceOf(P, mk);
  ok('S none of the eight fields names Ann\'s family at the door', door.hits.length === 0, door);
  ok('S Pro is off at the door', door.isPro === false, door);
  const doorSession = await sessionOf(P);
  ok('S and nothing of her sign-in\'s own state is left: no invite to offer, no join, no first run owed', doorSession.length === 0, doorSession);
  await resetWrites(P);

  /* ================================================================================================ */
  console.log('G. Bea signs in on the same tab; her household snapshot is held');
  ok('(the hold is installed in the SDK)', await installHold(P));
  await P.evaluate(() => { window.__holdHh = true; });
  await signIn(P, 'bea@stalefamily.test');
  const inGap = await until(async () => {
    const s = await P.evaluate(() => ({ uid: window.LL.auth.currentUser && window.LL.auth.currentUser.uid, held: (window.__hhHeld || []).map((r) => ({ path: r.path, queued: r.queue.length })) }));
    return s.uid && s.held.some((r) => r.queued > 0) ? s : null;
  }, 20000);
  const hidB = await hidOf(beaUid);
  ok('(Bea is signed in, her family exists on the server, and its snapshot reached the SDK and is held)',
    !!inGap && !!hidB && hidB !== hidA && inGap.held.some((r) => r.path === 'households/' + hidB), { inGap, hidA, hidB });
  await sleep(800); // anything else startSync attaches has had its first answer
  const gap = await traceOf(P, mk);
  ok('G1 in the gap, none of the eight fields names Ann\'s family', gap.hits.length === 0, gap);
  ok('G1 and Bea\'s own family is not claimed before its snapshot either (householdId not yet set)', !gap.hid, gap);
  const beaFb = await sendFeedback(P, beaUid, 'bea-feedback-in-the-gap');
  ok('(feedback Bea sends in the gap reaches the server)', !!beaFb, beaFb);
  ok('G2 and is not stamped with Ann\'s family id', !!beaFb && beaFb.householdId !== hidA, beaFb);
  const beaLink = await P.evaluate(() => window.LL.createInviteLink({ relationship: 'Friend' }).then((r) => (r ? 'made' : null), (e) => 'threw: ' + e.message));
  await sleep(500);
  ok('G3 nothing on the page tried a write naming Ann\'s family since she left (feedback, the link Bea asked for)', (await writesNaming(P, hidA)).length === 0, { beaLink, writes: await writesNaming(P, hidA) });
  const gapSheet = await familySheetText(P);
  ok('G4 the family sheet renders in the gap', gapSheet.includes('Family & sharing'), gapSheet.slice(0, 200));
  ok('G4 and shows none of Ann\'s roster, invites or links', namesIn(gapSheet, mk).length === 0, { names: namesIn(gapSheet, mk), text: gapSheet.slice(0, 300) });
  ok('G5 Pro is not on in the gap', gap.isPro === false, gap);
  await P.evaluate(() => window.__releaseHh());
  ok('the snapshot let through: Bea boots into her own family', await booted(P, beaUid));
  const beaOn = await P.evaluate(() => ({ hid: window.LL.householdId, role: window.LL.role, members: Object.keys(window.LL.members || {}), pro: window.LL.pro }));
  ok('and window.LL describes it: her id, her owner role, herself alone, no Pro', beaOn.hid === hidB && beaOn.role === 'owner' && beaOn.members.length === 1 && beaOn.members[0] === beaUid && !beaOn.pro, beaOn);
  const beaTrace = await traceOf(P, mk);
  ok('and still nothing of Ann\'s family', beaTrace.hits.filter((h) => h !== 'role:owner').length === 0, beaTrace);
  /* A tree that clears needsIdentity but still remembers Ann's first run was shown leaves Bea none owed. */
  const beaSession = await until(async () => { const x = await sessionOf(P); return x.includes('needsIdentity') ? x : null; }, 5000);
  ok('F Bea, a brand-new owner too, is owed her own first run, as Ann was', !!beaSession, await sessionOf(P));
  ok('F and is offered none of Ann\'s invites or joins', !!beaSession && beaSession.length === 1, beaSession);

  /* ================================================================================================ */
  console.log('E. Ann signs back in; then she is signed out from elsewhere');
  await P.evaluate(() => window.LL.signOut());
  ok('Bea is at the door', await atDoor(P));
  await signIn(P, 'ann@stalefamily.test');
  ok('Ann boots into her own family again', await booted(P, annUid));
  const back = await until(async () => { const t = await traceOf(P, mk); return t.isPro === true && t.hits.includes('memberInfo:Zinnia') ? t : null; }, 10000);
  ok('E her roster and Pro are back', !!back, back || await traceOf(P, mk));
  await P.evaluate(() => window.LL.auth.signOut()); // no LL.signOut: auth goes first, as from another tab
  ok('Ann is at the door', await atDoor(P));
  await sleep(300);
  const elsewhere = await traceOf(P, mk);
  ok('E none of the eight fields names her family after a sign-out from elsewhere', elsewhere.hits.length === 0 && elsewhere.isPro === false, elsewhere);

  await P.browserContext().close();
  /* ================================================================================================ */
  if (consoleErrs.length) console.log('\n  (console errors seen, for reading: ' + JSON.stringify([...new Set(consoleErrs)].slice(0, 8)) + ')');
  ok('no page errors', errs.length === 0, errs.slice(0, 4));
  ok('nothing off localhost was ever answered', offHostAnswered.length === 0, [...new Set(offHostAnswered)]);

  await browser.close();
  serveProc.kill();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('STALE-FAMILY-MEMORY: ' + (fail ? 'FAIL' : 'PASS') + '\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('threw:', e); process.exit(1); });
