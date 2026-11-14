/* A removed mother erases her own pregnancy records, from the note that tells her she was removed and
 * from account deletion. November 2026 review, D2. The rules half is test/removed-records.test.js;
 * this is the app half, with the REAL rules and the real Auth SDK (the circle-manage harness).
 *
 *   A. Mia has a journey, private health (mood included) and pregnancy photos in Olive's family.
 *      Olive removes her while her Cubby is open. On "You're no longer in this family" a quieter
 *      second button appears under "Back to sign in": "Delete my pregnancy records from that family".
 *      It is a full touch target, readable in Light and in Night, and fits 320px. One real tap opens
 *      the app's own confirm ON TOP of the note, with the agreed words; Keep keeps everything; Delete
 *      erases her journey, every health category and every photo, says so in a toast drawn above the
 *      note, and touches nobody else's records.
 *   B. Rae is removed with no records there: the button never appears. (A is the companion that
 *      stages records and makes the same matcher find it.) When her session ends some other way than
 *      the note's own button, the note still goes with it.
 *   C. Mona is removed while her Cubby is closed. She opens it, reads the note, taps "Back to sign
 *      in" and signs in again in the same page: the note goes, she lands in a new Cubby of her own, and
 *      when she later deletes her account her records in Olive's family go first, not only her own
 *      users document, and her new Cubby is closed behind her like anyone's last one out.
 *   D. Kim deletes her account straight from the note's session (the family this phone still has
 *      open is the one she lost): it finishes, and her records there go.
 *   E. Lia is removed, then let back in while the note is still up, and deletes her account from that
 *      session: the server, not the note, decides she is in the family, so she leaves it like anyone
 *      and is not left behind as a member with no account.
 *
 *   node test/removed-records-ui.test.js
 *   RULES_FILE=/abs/old.rules RULES_ARE_OLD=1 node test/removed-records-ui.test.js
 *       the deploy window: this client under rules that refuse an ex-member. The button must not
 *       appear (nothing is offered that cannot be done), account deletion must still finish, and her
 *       records simply stay where they were, as they always have.
 *   RULES_FILE=/abs/other.rules node test/removed-records-ui.test.js   grade other rules, new expectations
 *   SHOT_DIR=/abs/dir ...   also save screenshots
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
const FS_PORT = Number(process.env.FS_PORT) || 8747;
const AUTH_PORT = Number(process.env.AUTH_PORT) || 9747;
const WEB_PORT = Number(process.env.WEB_PORT) || 8748;
const HUB_PORT = Number(process.env.HUB_PORT) || 0, LOG_PORT = Number(process.env.LOG_PORT) || 0, WS_PORT = Number(process.env.WS_PORT) || 0;
const EXEC_PROJECT = 'demo-cubby-removed';
const PAGE_PROJECT = 'little-log-a9caa'; // the id app/firebase-init.js gives the SDK; emulator only
const RULES_FILE = process.env.RULES_FILE || path.join(ROOT, 'firestore.rules');
const OLD = process.env.RULES_ARE_OLD === '1';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PW = 'emulator-only-pw-removed';
const BTN = 'Delete my pregnancy records from that family';

let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; console.log('  FAIL ' + n + (extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 500) : '')); }
  return !!c;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (url) => new Promise((res) => {
  http.get(url, (r) => { r.resume(); res({ status: r.statusCode }); }).on('error', () => res({ status: 0 }));
});

/* ---------- outer phase: both emulators up, then re-run ourselves inside them ---------- */
if (!process.env.REMOVED_RECORDS_INNER) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-removed-'));
  fs.copyFileSync(RULES_FILE, path.join(scratch, 'firestore.rules'));
  fs.writeFileSync(path.join(scratch, 'firebase.json'), JSON.stringify({
    firestore: { rules: 'firestore.rules' },
    emulators: Object.assign({ firestore: Object.assign({ port: FS_PORT }, WS_PORT ? { websocketPort: WS_PORT } : {}), auth: { port: AUTH_PORT }, ui: { enabled: false } },
      HUB_PORT ? { hub: { port: HUB_PORT } } : {}, LOG_PORT ? { logging: { port: LOG_PORT } } : {})
  }));
  const firebaseBin = path.join(__dirname, 'node_modules', '.bin', 'firebase');
  const javaBin = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin') : '/opt/homebrew/opt/openjdk/bin';
  const env = Object.assign({}, process.env, { REMOVED_RECORDS_INNER: '1', PATH: javaBin + ':' + process.env.PATH });
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

/* ---------- emulator admin access (bypasses the rules; seeds and reads back) ---------- */
const FS_DOCS = `http://localhost:${FS_PORT}/v1/projects/${PAGE_PROJECT}/databases/(default)/documents/`;
const ADMIN = { 'content-type': 'application/json', authorization: 'Bearer owner' };
function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  const fields = {}; Object.keys(v).forEach((k) => { fields[k] = toValue(v[k]); });
  return { mapValue: { fields } };
}
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
async function adminSet(p, data) {
  const r = await fetch(FS_DOCS + p, { method: 'PATCH', headers: ADMIN, body: JSON.stringify({ fields: toValue(data).mapValue.fields }) });
  if (r.status !== 200) throw new Error('seed ' + p + ' ' + r.status + ' ' + (await r.text()).slice(0, 200));
}
async function adminGet(p) {
  const r = await fetch(FS_DOCS + p, { headers: ADMIN });
  if (r.status === 404) return null;
  const j = await r.json();
  return fromValue({ mapValue: { fields: j.fields || {} } });
}
async function adminList(p) {
  const r = await fetch(FS_DOCS + p + '?pageSize=300', { headers: ADMIN });
  if (r.status !== 200) return [];
  const j = await r.json();
  return (j.documents || []).map((d) => d.name.split('/').pop());
}
async function until(fn, ms) {
  const stop = Date.now() + (ms || 10000);
  let v;
  while (Date.now() < stop) { v = await fn(); if (v) return v; await sleep(250); }
  return v;
}

/* ---------- inner phase ---------- */
(async () => {
  console.log('\na removed mother\'s own records (' + (process.env.RULES_FILE ? 'rules: ' + RULES_FILE : 'firestore.rules') + (OLD ? ', graded as the OLD rules' : '') + ')\n');
  const serveProc = spawn('node', [path.join(ROOT, 'tools', 'serve.js')],
    { stdio: 'ignore', env: Object.assign({}, process.env, { PORT: String(WEB_PORT) }) });
  // Never leave it behind: an orphan keeps the port and serves its tree to the next run.
  process.on('exit', () => { try { serveProc.kill(); } catch (e) {} });
  for (let i = 0; i < 40 && (await get(`http://localhost:${WEB_PORT}/app/`)).status !== 200; i++) await sleep(250);
  const servedStore = await fetch(`http://localhost:${WEB_PORT}/app/store-firebase.js`).then((r) => r.text()).catch(() => '');
  ok('the static server serves THIS checkout\'s store-firebase.js, byte for byte', servedStore === fs.readFileSync(path.join(ROOT, 'app', 'store-firebase.js'), 'utf8'));

  const puppeteer = require(path.join(ROOT, 'tools', 'node_modules', 'puppeteer-core'));
  const dl = require(path.join(ROOT, 'tools', 'gate_downloads.js'));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', downloadBehavior: dl.downloadBehavior(),
    args: ['--no-sandbox', '--disable-gpu', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1'] });
  const errs = [], offHostAnswered = [];
  const AUTH_PROJECT = process.env.GCLOUD_PROJECT || EXEC_PROJECT;
  const makeAccount = async (email, uid) => {
    const r = await fetch(`http://localhost:${AUTH_PORT}/identitytoolkit.googleapis.com/v1/projects/${AUTH_PROJECT}/accounts`,
      { method: 'POST', headers: ADMIN, body: JSON.stringify({ email, password: PW, emailVerified: true, localId: uid }) });
    const j = await r.json().catch(() => ({}));
    if (!j.localId) throw new Error('could not make the emulator account for ' + email + ': ' + JSON.stringify(j).slice(0, 200));
    return j.localId;
  };
  const appUrl = () => `http://localhost:${WEB_PORT}/app/?fsemu=${FS_PORT}&authemu=${AUTH_PORT}`;
  const TOASTS = () => {
    window.__toasts = [];
    document.addEventListener('DOMContentLoaded', () => {
      try { const t = window.toast; if (typeof t === 'function' && !t.__w) { const w = function (m) { window.__toasts.push(String(m)); return t.apply(this, arguments); }; w.__w = 1; window.toast = w; } } catch (e) {}
    });
  };
  const wire = (page, who) => {
    page.on('pageerror', (e) => errs.push(who + ': ' + e.message));
    page.on('response', (rs) => { try { const h = new URL(rs.url()).hostname; if (h && h !== 'localhost' && h !== '127.0.0.1') offHostAnswered.push(h); } catch (e) {} });
  };
  const open = async (ctx, who) => {
    const page = await ctx.newPage();
    wire(page, who);
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    // Light unless a check says otherwise: the Mac running this may be in dark mode, and "system" follows it.
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await page.evaluateOnNewDocument(TOASTS);
    await page.goto(appUrl(), { waitUntil: 'networkidle2', timeout: 45000 });
    await page.waitForFunction(() => !!(window.LL && window.LL.auth && window.LL.auth.signInWithEmailAndPassword), { timeout: 20000 });
    return page;
  };
  const signIn = (page, email) => page.evaluate((e, p) => window.LL.auth.signInWithEmailAndPassword(e, p).then(() => true), email, PW);
  const person = async (email, uid) => {
    const ctx = await browser.createBrowserContext({ downloadBehavior: dl.downloadBehavior() });
    const page = await open(ctx, email);
    await makeAccount(email, uid);
    await signIn(page, email);
    return page;
  };
  const booted = async (page, ms) => {
    try {
      await page.waitForFunction(() => !!(window.LL && window.LL.householdId && typeof state !== 'undefined' && !document.getElementById('llAuthOv')), { timeout: ms || 40000 });
      return true;
    } catch (e) { return false; }
  };
  const hid = (page) => page.evaluate(() => (window.LL && window.LL.householdId) || null);
  const noteUp = (page, ms) => until(() => page.evaluate(() => { const o = document.getElementById('ll-access-lost'); return !!(o && /no longer in this family/.test(o.innerText)); }), ms || 15000);
  /* The matcher, one for both answers: is the second button DRAWN? Read from the layout, never from
     the hidden attribute: an inline display beats [hidden], and a matcher that trusted the attribute
     once passed "never shown" over a button sitting on screen. */
  const recBtn = (page) => page.evaluate(() => {
    const b = document.getElementById('ll-al-rec');
    if (!b) return { present: false, shown: false };
    const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
    const hit = r.height > 0 ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
    return { present: true, shown: r.height > 0 && r.width > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && !!hit && (hit === b || b.contains(hit)),
      text: b.textContent.trim(), h: r.height, w: r.width, left: r.left, right: r.right, top: r.top };
  });
  const centre = (page, sel, text) => page.evaluate((sel, text) => {
    const el = [...document.querySelectorAll(sel)].find((x) => text === undefined || x.textContent.trim() === text);
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, onTop: !!hit && (hit === el || el.contains(hit)), hit: hit ? (hit.tagName + '#' + hit.id) : null };
  }, sel, text);
  const realTap = async (page, sel, text) => {
    const c = await centre(page, sel, text);
    if (!c) return { found: false };
    await sleep(150);
    const c2 = await centre(page, sel, text);
    await page.mouse.click(c2.x, c2.y);
    return Object.assign({ found: true }, c2);
  };
  const sheetText = (page) => page.evaluate(() => { const s = document.getElementById('sheet'); return s && s.classList.contains('show') ? s.innerText : ''; });
  const waitSheet = async (page, re, ms) => {
    try { await page.waitForFunction((src) => { const s = document.getElementById('sheet'); return !!(s && s.classList.contains('show') && new RegExp(src).test(s.innerText)); }, { timeout: ms || 8000 }, re); return true; }
    catch (e) { return false; }
  };
  // The second button's text against the note's own background, as drawn.
  const recContrast = (page) => page.evaluate(() => {
    const b = document.getElementById('ll-al-rec'), ov = document.getElementById('ll-access-lost');
    if (!b || !ov) return null;
    const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lum = (c) => { const v = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
    const fg = getComputedStyle(b).color, bg = getComputedStyle(ov).backgroundColor;
    const a = lum(rgb(fg)), c = lum(rgb(bg));
    return { ratio: Math.round(((Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05)) * 100) / 100, fg, bg, theme: document.documentElement.getAttribute('data-theme') };
  });
  const shot = async (page, name) => { if (process.env.SHOT_DIR) { await sleep(450); await page.screenshot({ path: path.join(process.env.SHOT_DIR, name + '.png') }); } };

  /* ---- Olive's family. Everyone is seeded in directly: how they joined is not what is under test. ---- */
  const H = 'HREMOVED';
  const crew = { olive: 'u-olive', mia: 'u-mia', rae: 'u-rae', mona: 'u-mona', kim: 'u-kim', lia: 'u-lia', pat: 'u-pat' };
  const members = {}, memberInfo = {};
  Object.keys(crew).forEach((k) => { members[crew[k]] = k === 'olive' ? 'owner' : 'caregiver'; memberInfo[crew[k]] = { name: k[0].toUpperCase() + k.slice(1), role: members[crew[k]], relationship: k === 'pat' ? 'Papa Bear' : 'Mama Bear', setupDone: true }; });
  const hhDoc = () => ({ ownerId: crew.olive, members: Object.assign({}, members), memberInfo: Object.assign({}, memberInfo),
    app: { babies: [{ id: 'b1', name: 'Pip', birth: Date.now() - 40 * 86400000, sex: 'M', routines: [], doctors: [], allergies: [] }] } });
  await adminSet('households/' + H, hhDoc());
  for (const k of Object.keys(crew)) await adminSet('users/' + crew[k], { householdId: H });
  // Pat's own records, which nobody's deletion may touch.
  await adminSet('households/' + H + '/mhealth/' + crew.pat + '/cat/health', { ownerUid: crew.pat, category: 'health', data: {}, sharedWith: [] });
  await adminSet('households/' + H + '/pregnancy/' + crew.pat, { ownerUid: crew.pat, data: { stage: 'expecting' }, sharedWith: [] });
  await adminSet('households/' + H + '/pregnancy/' + crew.pat + '/photos/pp1', { data: 'PAT-BYTES', authorId: crew.pat });

  const remove = async (uid) => {
    const d = hhDoc();
    Object.keys(crew).forEach((k) => { if (removed.has(crew[k]) || crew[k] === uid) { delete d.members[crew[k]]; delete d.memberInfo[crew[k]]; } });
    removed.add(uid);
    await adminSet('households/' + H, d);
  };
  const removed = new Set();
  // Olive lets someone back in: everyone else removed so far stays out.
  const readd = async (uid) => {
    removed.delete(uid);
    const d = hhDoc();
    Object.keys(crew).forEach((k) => { if (removed.has(crew[k])) { delete d.members[crew[k]]; delete d.memberInfo[crew[k]]; } });
    await adminSet('households/' + H, d);
  };
  // Her records, written by her own app while she is a member, in the shapes it sends them.
  const PX = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
  const writeRecords = (page) => page.evaluate((H, PX) => {
    const uid = window.LL.auth.currentUser.uid, db = window.LL.db, ts = firebase.firestore.FieldValue.serverTimestamp();
    const hh = db.collection('households').doc(H);
    return Promise.all([
      hh.collection('mhealth').doc(uid).collection('cat').doc('health').set({ ownerUid: uid, category: 'health', data: { weights: [{ at: 1, kg: 70 }] }, sharedWith: ['u-pat'], updatedAt: ts }),
      hh.collection('mhealth').doc(uid).collection('cat').doc('mood').set({ ownerUid: uid, category: 'mood', data: { moodLog: [{ at: 1, note: 'low' }] }, sharedWith: [], updatedAt: ts }),
      hh.collection('mhealth').doc(uid).collection('cat').doc('careteam').set({ ownerUid: uid, category: 'careteam', data: { careTeam: [] }, sharedWith: [], updatedAt: ts }),
      hh.collection('pregnancy').doc(uid).set({ ownerUid: uid, data: { stage: 'expecting', precon: [] }, sharedWith: ['u-pat'], updatedAt: ts }),
      hh.collection('pregnancy').doc(uid).collection('photos').doc('bump1').set({ data: PX, authorId: uid }),
      hh.collection('pregnancy').doc(uid).collection('photos').doc('scan2').set({ data: PX, authorId: uid }),
    ]).then(() => 'ok', (e) => e && e.code);
  }, H, PX);
  const recordsLeft = async (uid) => {
    const cats = await adminList('households/' + H + '/mhealth/' + uid + '/cat');
    const photos = await adminList('households/' + H + '/pregnancy/' + uid + '/photos');
    const journey = !!(await adminGet('households/' + H + '/pregnancy/' + uid));
    return { cats: cats.length, photos: photos.length, journey };
  };
  const none = (r) => r.cats === 0 && r.photos === 0 && !r.journey;
  /* Everything she wrote is still there. At least three categories: her own app may add the fourth
     (conditions) by itself while she is still a member, when its listener folds hers back in. */
  const all = (r) => r.cats >= 3 && r.photos === 2 && r.journey;
  const patIntact = async () => {
    const r = await recordsLeft(crew.pat);
    return r.cats === 1 && r.photos === 1 && r.journey;
  };

  /* ================================================================================================ */
  console.log('A. Mia is removed with her Cubby open, and erases her own records from the note');
  const M = await person('mia@removed.test', crew.mia);
  ok('Mia boots into Olive\'s family', (await booted(M)) && (await hid(M)) === H);
  ok('her app saves her journey, health and photos there, as a member', (await writeRecords(M)) === 'ok');
  ok('(they are on the server)', all(await recordsLeft(crew.mia)), await recordsLeft(crew.mia));
  await remove(crew.mia);
  ok('Olive removes her, and she is told she is no longer in this family', !!(await noteUp(M)));
  const ptrA = await until(async () => { const u = await adminGet('users/' + crew.mia); return u && u.householdId === null ? u : null; }, 8000);
  ok('her pointer is cleared, and the family she lost is remembered on her own users doc', !!ptrA && (ptrA.formerHouseholdIds || []).includes(H), ptrA);
  if (OLD) {
    await sleep(5000);
    const b = await recBtn(M);
    ok('OLD RULES: the second button never appears, so nothing is offered that cannot be done', !b.shown, b);
    ok('OLD RULES: and her records are where they were', all(await recordsLeft(crew.mia)), await recordsLeft(crew.mia));
  } else {
    const b = await until(async () => { const r = await recBtn(M); return r.shown ? r : null; }, 10000);
    ok('a second button appears: "' + BTN + '"', !!b && b.text === BTN, b || (await recBtn(M)));
  }
  if (!OLD && !(await recBtn(M)).shown) ok('(the rest of A taps that button, so it cannot run without it)', false);
  else if (!OLD) {
    const geo = await M.evaluate(() => {
      const a = document.getElementById('ll-al-btn').getBoundingClientRect(), b = document.getElementById('ll-al-rec').getBoundingClientRect();
      const ca = getComputedStyle(document.getElementById('ll-al-btn')), cb = getComputedStyle(document.getElementById('ll-al-rec'));
      return { below: b.top >= a.bottom, aBg: ca.backgroundColor, bBg: cb.backgroundColor, aW: ca.fontWeight, bW: cb.fontWeight, h: b.height };
    });
    ok('under "Back to sign in"', geo.below, geo);
    ok('and quieter than it: no fill of its own, lighter weight', /rgba\(0, 0, 0, 0\)|transparent/.test(geo.bBg) && Number(geo.bW) < Number(geo.aW), geo);
    ok('a full 44px touch target', geo.h >= 44, geo);
    const cl = await recContrast(M);
    ok('its words read at 4.5:1 or better in Light', !!cl && cl.theme === 'light' && cl.ratio >= 4.5, cl);
    await shot(M, 'removed-note-light-390');
    await M.evaluate(() => document.documentElement.setAttribute('data-theme', 'night'));
    await sleep(200);
    const cn = await recContrast(M);
    ok('and in Night', !!cn && cn.theme === 'night' && cn.ratio >= 4.5, cn);
    await shot(M, 'removed-note-night-390');
    for (const w of [320, 390]) {
      await M.setViewport({ width: w, height: w === 320 ? 568 : 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      await sleep(250);
      const f = await M.evaluate(() => ({ side: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        r: document.getElementById('ll-al-rec').getBoundingClientRect().right, vw: innerWidth, onTop: (() => { const b = document.getElementById('ll-al-rec'), r = b.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && (h === b || b.contains(h)); })() }));
      ok('at ' + w + 'px in Night it fits, nothing scrolls sideways, and it is tappable', f.side <= 0 && f.r <= f.vw && f.onTop, f);
      await shot(M, 'removed-note-night-' + w);
    }
    await M.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await M.setViewport({ width: 320, height: 568, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const cl320 = await recContrast(M);
    ok('back in Light at 320px it still reads at 4.5:1', !!cl320 && cl320.theme === 'light' && cl320.ratio >= 4.5, cl320);
    await shot(M, 'removed-note-light-320');
    await M.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });

    const t1 = await realTap(M, '#ll-al-rec');
    ok('she taps it (a real tap, on top)', t1.found && t1.onTop, t1);
    ok('the confirm opens', await waitSheet(M, 'Delete your pregnancy records\\?'));
    await sleep(500);
    const st = await sheetText(M);
    ok('titled "Delete your pregnancy records?"', /^Delete your pregnancy records\?/m.test(st), st);
    ok('saying what goes, and that it cannot be undone', st.includes('This removes your journey, health notes and pregnancy photos from that family’s Cubby. It can’t be undone.'), st);
    const del = await centre(M, '#sheet button', 'Delete'), keep = await centre(M, '#sheet button', 'Keep');
    ok('"Delete" and "Keep" are drawn ON TOP of the note, where her finger is', !!del && del.onTop && !!keep && keep.onTop, { del, keep });
    ok('"Delete" is the danger colour', await M.evaluate(() => { const b = [...document.querySelectorAll('#sheet button')].find((x) => x.textContent.trim() === 'Delete'); return !!b && /var\(--diaper\)/.test(b.getAttribute('style') || ''); }));
    await shot(M, 'removed-confirm-390');
    await realTap(M, '#sheet button', 'Keep');
    await sleep(700);
    ok('Keep closes it and keeps everything', !(await sheetText(M)) && all(await recordsLeft(crew.mia)), await recordsLeft(crew.mia));
    ok('and the button is still there for later', (await recBtn(M)).shown);
    ok('and the sheet goes back to its own stacking', await M.evaluate(() => document.getElementById('sheet').style.zIndex === '' && document.getElementById('scrim').style.zIndex === ''));

    await realTap(M, '#ll-al-rec');
    ok('she taps it again', await waitSheet(M, 'Delete your pregnancy records\\?'));
    await sleep(500);
    if (process.env.SHOT_DIR) {   // the confirm over the note, in Night at 320px, for a person to look at
      await M.evaluate(() => document.documentElement.setAttribute('data-theme', 'night'));
      await M.setViewport({ width: 320, height: 568, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      await shot(M, 'removed-confirm-night-320');
      await M.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
      await M.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      await sleep(300);
    }
    await realTap(M, '#sheet button', 'Delete');
    const tt = await until(async () => (await M.evaluate(() => window.__toasts || [])).find((x) => x === 'Your pregnancy records are deleted.'), 10000);
    ok('a toast says "Your pregnancy records are deleted."', !!tt, await M.evaluate(() => window.__toasts));
    const tz = await M.evaluate(() => { const t = document.getElementById('toast'); return { show: t.classList.contains('show'), z: Number(getComputedStyle(t).zIndex), text: t.textContent }; });
    ok('drawn above the note, not behind it', tz.show && tz.z > 3000, tz);
    await shot(M, 'removed-deleted-toast-390');
    if (process.env.SHOT_DIR) {
      await M.evaluate(() => document.documentElement.setAttribute('data-theme', 'night'));
      await M.setViewport({ width: 320, height: 568, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      await shot(M, 'removed-deleted-toast-night-320');
      await M.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
      await M.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    }
    const left = await until(async () => { const r = await recordsLeft(crew.mia); return none(r) ? r : null; }, 8000);
    ok('her journey, every health category (mood too) and every photo are gone', !!left, await recordsLeft(crew.mia));
    ok('Pat\'s records are untouched', await patIntact());
    ok('the button goes, since there is nothing left to delete', !(await recBtn(M)).shown);
    const ptrA2 = await until(async () => { const u = await adminGet('users/' + crew.mia); return u && !(u.formerHouseholdIds || []).includes(H) ? u : null; }, 8000);
    ok('and her users doc no longer points account deletion at that family', !!ptrA2, await adminGet('users/' + crew.mia));
  }
  await M.browserContext().close();

  /* ================================================================================================ */
  console.log('\nB. Rae is removed with no records there');
  const Rp = await person('rae@removed.test', crew.rae);
  ok('Rae boots into Olive\'s family', (await booted(Rp)) && (await hid(Rp)) === H);
  await remove(crew.rae);
  ok('she is told she is no longer in this family', !!(await noteUp(Rp)));
  await sleep(5000);
  const rb = await recBtn(Rp);
  ok('the second button is on the page but never shown: she has nothing there', rb.present && !rb.shown, rb);
  // Her session ends without the note's button (it expired, or was signed out elsewhere): the note goes too.
  await Rp.evaluate(() => window.LL.auth.signOut());
  ok('signed out any other way, the note goes with the session', (await until(() => Rp.evaluate(() => !document.getElementById('ll-access-lost')), 8000)) === true,
    await Rp.evaluate(() => ({ note: !!document.getElementById('ll-access-lost'), user: !!window.LL.auth.currentUser })));
  await Rp.browserContext().close();

  /* ================================================================================================ */
  console.log('\nC. Mona is removed while her Cubby is closed, starts again, and deletes her account');
  const ctxC = await browser.createBrowserContext({ downloadBehavior: dl.downloadBehavior() });
  let C = await open(ctxC, 'mona@removed.test');
  await makeAccount('mona@removed.test', crew.mona);
  await signIn(C, 'mona@removed.test');
  ok('Mona boots into Olive\'s family', (await booted(C)) && (await hid(C)) === H);
  ok('her app saves her records there', (await writeRecords(C)) === 'ok');
  await C.close();
  await remove(crew.mona);
  C = await open(ctxC, 'mona@removed.test (next launch)');
  ok('next launch, she is told she is no longer in this family', !!(await noteUp(C, 25000)));
  const ptrC = await until(async () => { const u = await adminGet('users/' + crew.mona); return u && u.householdId === null && (u.formerHouseholdIds || []).includes(H) ? u : null; }, 8000);
  ok('and the family she lost is remembered', !!ptrC, await adminGet('users/' + crew.mona));
  await C.evaluate(() => { window.__samePage = 'yes'; document.getElementById('ll-al-btn').click(); });
  ok('"Back to sign in" signs her out', !!(await until(() => C.evaluate(() => !(window.LL.auth.currentUser)), 8000)));
  await sleep(800);
  // In the same page, as she would: "Back to sign in" does not reload.
  await signIn(C, 'mona@removed.test').catch(() => {});
  const reBooted = await booted(C, 45000);
  /* Polled, not read once. The session she just left started its boot failsafe (startSync's 3.5s
     timer) a moment before the note, and when it fires during this sign-in it marks the app booted
     about 40ms before her new Cubby's first snapshot names it: in that gap window.LL.householdId still
     says H. Measured: 4 runs in 33 read H there and then the new id 40ms later, with her pointer
     already on the new one. Landing in H for real would leave it on H, and fail here. */
  const newHid = await until(async () => { const h = await hid(C); return h && h !== H ? h : null; }, 10000);
  const ptrNew = await until(async () => { const u = await adminGet('users/' + crew.mona); return u && u.householdId && u.householdId !== H ? u.householdId : null; }, 8000);
  ok('she signs in again and lands in a new Cubby of her own', reBooted && !!newHid && newHid === ptrNew,
    await C.evaluate(() => ({ hid: window.LL.householdId, uid: window.LL.auth.currentUser && window.LL.auth.currentUser.uid,
      overlay: ((document.getElementById('llAuthOv') || {}).innerText || '').slice(0, 160), note: !!document.getElementById('ll-access-lost') })));
  const monaHid = newHid;
  const cover = await C.evaluate(() => {
    const o = document.getElementById('ll-access-lost');
    const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return { samePage: window.__samePage === 'yes', note: !!o, covering: !!o && !!hit && o.contains(hit) };
  });
  ok('in the same page, and the note is gone: her new Cubby is not hidden under it', cover.samePage && !cover.note, cover);
  ok('(her records are still in Olive\'s family at this point)', all(await recordsLeft(crew.mona)), await recordsLeft(crew.mona));
  const cd = await C.evaluate(() => window.LL.deleteAccount().then(() => 'ok', (e) => (e && (e.code || e.message)) || String(e)));
  ok('she deletes her account, and it finishes', cd === 'ok', cd);
  const monaHh = await adminGet('households/' + monaHid);
  ok('her new Cubby, where she was the only one, is closed behind her (not mistaken for the family she lost)',
    !!monaHh && Object.keys(monaHh.members || {}).length === 0 && monaHh.deletionRequestedBy === crew.mona, monaHh && { members: monaHh.members, by: monaHh.deletionRequestedBy });
  if (OLD) ok('OLD RULES: her records in Olive\'s family stay where they were, as they always have', all(await recordsLeft(crew.mona)), await recordsLeft(crew.mona));
  else ok('her journey, health and photos in Olive\'s family went with it', none(await recordsLeft(crew.mona)), await recordsLeft(crew.mona));
  ok('her users doc is gone', (await adminGet('users/' + crew.mona)) === null);
  ok('Pat\'s records are untouched', await patIntact());
  await ctxC.close();

  /* ================================================================================================ */
  console.log('\nD. Kim deletes her account from the session that shows the note');
  const K = await person('kim@removed.test', crew.kim);
  ok('Kim boots into Olive\'s family', (await booted(K)) && (await hid(K)) === H);
  ok('her app saves her records there', (await writeRecords(K)) === 'ok');
  await remove(crew.kim);
  ok('she is told she is no longer in this family', !!(await noteUp(K)));
  const kd = await K.evaluate(() => window.LL.deleteAccount().then(() => 'ok', (e) => (e && (e.code || e.message)) || String(e)));
  ok('her account deletion finishes (there is no family to leave)', kd === 'ok', kd);
  if (OLD) ok('OLD RULES: her records stay where they were', all(await recordsLeft(crew.kim)), await recordsLeft(crew.kim));
  else ok('and her records in that family went first', none(await recordsLeft(crew.kim)), await recordsLeft(crew.kim));
  ok('Olive\'s family is not flagged or changed by it', await (async () => { const h = await adminGet('households/' + H); return !!h && !h.deleteAfter && h.ownerId === crew.olive && !!(h.members || {})[crew.olive]; })());
  await K.browserContext().close();

  /* ================================================================================================ */
  console.log('\nE. Lia is removed, let back in while the note is up, and deletes her account from that session');
  const L = await person('lia@removed.test', crew.lia);
  ok('Lia boots into Olive\'s family', (await booted(L)) && (await hid(L)) === H);
  ok('her app saves her records there', (await writeRecords(L)) === 'ok');
  await remove(crew.lia);
  ok('she is told she is no longer in this family', !!(await noteUp(L)));
  await readd(crew.lia);
  ok('(Olive lets her back in; the note is still up on her phone)', !!(((await adminGet('households/' + H)) || {}).members || {})[crew.lia] && !!(await L.evaluate(() => !!document.getElementById('ll-access-lost'))));
  const ld = await L.evaluate(() => window.LL.deleteAccount().then(() => 'ok', (e) => (e && (e.code || e.message)) || String(e)));
  ok('her account deletion finishes', ld === 'ok', ld);
  const hl = await adminGet('households/' + H);
  ok('she really was in the family, so she left it like anyone: no member left behind with no account',
    !!hl && !(hl.members || {})[crew.lia] && !(hl.memberInfo || {})[crew.lia] && !!(hl.formerMemberInfo || {})[crew.lia],
    hl && { members: Object.keys(hl.members || {}), former: Object.keys(hl.formerMemberInfo || {}) });
  ok('and her records there went first', none(await recordsLeft(crew.lia)), await recordsLeft(crew.lia));
  ok('Pat\'s records are untouched', await patIntact());
  await L.browserContext().close();

  ok('no page errors', errs.length === 0, errs.slice(0, 4));
  ok('nothing off localhost was ever answered', offHostAnswered.length === 0, [...new Set(offHostAnswered)]);
  await browser.close();
  serveProc.kill();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('REMOVED-RECORDS-UI: ' + (fail ? 'FAIL' : 'PASS') + '\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('threw:', e); process.exit(1); });
