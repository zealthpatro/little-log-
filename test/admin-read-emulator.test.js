/* The admin's reads, proven against a REAL Firestore and a REAL Auth (the emulators), not a stub.
 *
 *   node test/admin-read-emulator.test.js      stands up its own Firestore and Auth emulators, then runs
 *
 * The trap catalogue: a REST shape is proven on the emulator, never only on a recorder. This drives the
 * admin Worker's masked reader (get with mask.fieldPaths, batchGet with a mask, runQuery with select,
 * where and orderBy, COUNT aggregation), its Auth listing (accounts:batchGet) and the full refresh against
 * SAMPLE families seeded with recognisable content (workers/admin/dev/sample.mjs), then asserts:
 *   - the real server honours every mask: no Firestore answer the reader received carries a value outside
 *     what it asked for (notes, doses, the journal, push tokens, the loss archive, a forged users.email);
 *   - nothing planted reaches D1 or any page;
 *   - the stages, the per-day rows and the incremental updatedAt pass come out right on the real engine;
 *   - the hold reader's REAL 404 reads as held.
 * Ports default to 7711-7715 (override FS_PORT, AUTH_PORT, HUB_PORT, LOG_PORT, WS_PORT).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const PROJECT = 'demo-cubby-admin';
const FS_PORT = Number(process.env.FS_PORT) || 7711;
const AUTH_PORT = Number(process.env.AUTH_PORT) || 7712;
const HUB_PORT = Number(process.env.HUB_PORT) || 7713;
const LOG_PORT = Number(process.env.LOG_PORT) || 7714;
const WS_PORT = Number(process.env.WS_PORT) || 7715;

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-admin-emu-'));
  fs.writeFileSync(path.join(scratch, 'closed.rules'),
    "rules_version = '2';\nservice cloud.firestore { match /databases/{db}/documents { match /{document=**} { allow read, write: if false; } } }\n");
  fs.writeFileSync(path.join(scratch, 'firebase.json'), JSON.stringify({
    firestore: { rules: 'closed.rules' },
    emulators: { firestore: { port: FS_PORT, websocketPort: WS_PORT }, auth: { port: AUTH_PORT }, hub: { port: HUB_PORT }, logging: { port: LOG_PORT }, ui: { enabled: false } },
  }));
  const firebaseBin = process.env.FIREBASE_BIN || path.join(__dirname, 'node_modules', '.bin', 'firebase');
  const javaBin = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin') : '/opt/homebrew/opt/openjdk/bin';
  const env = Object.assign({}, process.env, { PATH: javaBin + ':' + process.env.PATH });
  try {
    execFileSync(firebaseBin, ['emulators:exec', '--only', 'firestore,auth', '--project', PROJECT, '--config', path.join(scratch, 'firebase.json'),
      'node ' + JSON.stringify(__filename)], { cwd: scratch, env, stdio: 'inherit' });
  } catch (e) { process.exitCode = e.status || 1; }
  return;
}

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 400) : '')); } };
const done = () => { console.log('\n' + pass + ' passed, ' + fail + ' failed'); console.log(fail ? 'ADMIN-READ-EMU: FAIL' : 'ADMIN-READ-EMU: PASS'); process.exit(fail ? 1 : 0); };

const FSE = process.env.FIRESTORE_EMULATOR_HOST, AUE = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const ROOT = process.env.ADMIN_ROOT || path.join(__dirname, '..');   // a temp copy, to watch it go red on a mutant
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const OWNER = { authorization: 'Bearer owner' };
const DOCS = 'http://' + FSE + '/v1/projects/' + PROJECT + '/databases/(default)/documents';
const ITK = 'http://' + AUE + '/identitytoolkit.googleapis.com/v1/projects/' + PROJECT;
/* Content that the MASKS (not the reducers) must keep out of every Firestore answer. Values inside masked
   fields by design (a baby's name inside app.babies, invitee keys inside pendingInvites, memberInfo's
   photo, an entry's time) are dropped by the reducers instead, and are checked against D1 and the pages. */
const MASKED_OUT = ['ZZ-NOTE-7731', 'ZZ-DOSE-7731', 'ZZ-AMOUNT-7731', 'ZZ-SYMPTOM-7731', 'ZZ-TEMPERATURE-7731', 'ZZ-MHEALTH-7731',
  'ZZ-PHOTO-7731', 'ZZ-JOURNAL-7731', 'ZZ-KICKS-7731', 'ZZPUSHTOKEN7731', 'ZZ-DUE-MEDICINE', 'ZZ-ARCHIVE-7731', 'zz-forged@example.com',
  'ZZ-FORGED-NAME', 'ZZ-FEEDBACK-7731'];

(async () => {
  const { toFsFields } = await imp('workers/shared/fs-values.mjs');
  const S = await imp('workers/admin/dev/sample.mjs');
  const F = await imp('workers/admin/dev/fixture.mjs');
  const R = await imp('workers/shared/fs-read.mjs');
  console.log('\nadmin reads on the real emulators (Firestore ' + FSE + ', Auth ' + AUE + ')');

  await fetch('http://' + FSE + '/emulator/v1/projects/' + PROJECT + '/databases/(default)/documents', { method: 'DELETE' });
  await fetch('http://' + AUE + '/emulator/v1/projects/' + PROJECT + '/accounts', { method: 'DELETE' });
  const world = S.sampleWorld({ content: true, hostile: true, projectId: PROJECT });
  for (const [p, f] of world.docs) {
    const r = await fetch(DOCS + '/' + p, { method: 'PATCH', headers: Object.assign({ 'content-type': 'application/json' }, OWNER), body: JSON.stringify({ fields: toFsFields(f) }) });
    if (!r.ok) { ok('seeded ' + p, false, r.status + ' ' + (await r.text()).slice(0, 200)); done(); }
  }
  for (const a of world.accounts) {
    const r = await fetch(ITK + '/accounts', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, OWNER),
      body: JSON.stringify({ localId: a.localId, email: a.email, emailVerified: true, displayName: 'ZZ-FORGED-NAME', password: 'not-a-real-password-' + a.localId }) });
    if (!r.ok) { ok('seeded the Auth account ' + a.localId, false, r.status + ' ' + (await r.text()).slice(0, 200)); done(); }
  }
  const probe = await (await fetch(DOCS + '/households/HHID_sample_maya/events/e_zz_time', { headers: OWNER })).text();
  ok('the seed really holds content (an entry with a planted note, read with the owner key)', probe.includes('ZZ-NOTE-7731'));

  /* The Worker's fetch: Google's token endpoint and the Access certs stay fake; Firestore and Identity
     Toolkit go to the REAL emulators. Every Firestore answer is kept, to grep. */
  const answers = [], strays = [];
  const fx = await F.buildFixture({ projectId: PROJECT, firestoreBase: 'http://' + FSE + '/v1', authBase: 'http://' + AUE + '/identitytoolkit.googleapis.com/v1',
    fetchImpl: (fake) => async (input, init) => {
      const url = String(input && input.url ? input.url : input);
      if (url === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({ access_token: 'owner', expires_in: 3600 }), { headers: { 'content-type': 'application/json' } });
      if (url.includes('/cdn-cgi/access/certs')) return fake.fetchImpl(input, init);
      if (!url.startsWith('http://' + FSE + '/') && !url.startsWith('http://' + AUE + '/')) { strays.push(url); throw new Error('stray fetch ' + url); }
      const r = await fetch(url, init);
      if (url.startsWith('http://' + FSE + '/')) answers.push({ url, body: await r.clone().text() });
      return r;
    } });

  console.log('\n1. the full refresh runs on the real engines');
  const report = await fx.tickUntilDone();
  ok('the refresh finished its daily pass with no error', report && !report.dailyError && !report.incrementalError && report.auth && !report.auth.error, report);
  ok('no request left for a real Google host', strays.length === 0, strays);
  const hh = (hid) => fx.admin.raw.prepare('SELECT * FROM dir_households WHERE hid = ?').get(hid);
  ok('every sample household is in the directory', fx.admin.raw.prepare('SELECT COUNT(*) AS n FROM dir_households').get().n === 9, fx.admin.raw.prepare('SELECT hid FROM dir_households').all());
  ok('every Auth account is in it, with its verified address (accounts:batchGet)', fx.admin.raw.prepare('SELECT COUNT(*) AS n FROM dir_people WHERE email IS NOT NULL').get().n === world.accounts.length);
  ok('Leena, her journey shared with Omar: "Pregnant" (masked list of pregnancy)', hh('HHID_sample_leena').stage_detail === 'Pregnant', hh('HHID_sample_leena'));
  ok('Zara, her journey shared with nobody: "No stage shared"', hh('HHID_sample_zara').stage === 'none' && hh('HHID_sample_zara').stage_detail === 'No stage shared');
  ok('Nora, trying and shared: counted as trying, labelled "No stage shared"', hh('HHID_sample_nora').stage === 'trying' && hh('HHID_sample_nora').stage_detail === 'No stage shared');
  ok('Maya: a baby of two months, two people logging (runQuery with select, where and orderBy)', hh('HHID_sample_maya').stage_detail === 'Baby · 2 months' && hh('HHID_sample_maya').authors_7d === 2);
  const mayaEvents = [...world.docs.keys()].filter((k) => k.startsWith('households/HHID_sample_maya/events/')).length;
  ok('the COUNT aggregation matches what is there (' + mayaEvents + ')', hh('HHID_sample_maya').entries_total === mayaEvents, hh('HHID_sample_maya').entries_total);
  const days = fx.admin.raw.prepare("SELECT day, entries, authors FROM dir_household_days WHERE hid = 'HHID_sample_maya' ORDER BY day").all();
  ok('seven UTC days of rows for Maya, each with two authors', days.length === 7 && days.every((d) => d.authors === 2), days);
  ok('Dana, quiet for ten days: a last entry day, no recent days', hh('HHID_sample_dana').last_entry_day === '2026-11-03' && fx.admin.raw.prepare("SELECT COUNT(*) AS n FROM dir_household_days WHERE hid = 'HHID_sample_dana'").get().n === 0, hh('HHID_sample_dana'));
  const users = fx.admin.raw.prepare("SELECT acq_source, push_on, quiet, tz, team_notes FROM dir_people WHERE uid = 'UID_sample_maya'").get();
  ok('her settings came through the masked batchGet', users.acq_source === 'instagram' && users.push_on === 1 && users.quiet === '22-7' && users.tz === 'Asia/Dubai' && users.team_notes === 'on', users);

  console.log('\n2. the real server honoured every mask');
  const leaked = [];
  for (const a of answers) for (const z of MASKED_OUT) if (a.body.includes(z)) leaked.push(z + ' in ' + a.url.split('/documents')[1]);
  ok('not one of ' + answers.length + ' Firestore answers carried a value outside its mask', answers.length > 20 && leaked.length === 0, leaked.slice(0, 6));

  console.log('\n3. nothing planted reaches D1 or a page');
  const nos = fx.admin.raw.prepare('SELECT display_no FROM dir_households').all().map((r) => r.display_no);
  const paths = ['/?own=show', '/records?tab=people&own=show', '/records?tab=households&own=show', '/records.csv?tab=people&own=show', '/records?tab=access'];
  for (const n of nos) paths.push('/household/' + n);
  const pages = [];
  for (const p of paths) { const r = await fx.request(p); pages.push({ p, status: r.status, body: await r.text() }); }
  ok('every page answered 200', pages.every((p) => p.status === 200), pages.filter((p) => p.status !== 200).map((p) => p.p + ' ' + p.status));
  const dump = fx.admin.dump();
  const found = [];
  for (const z of S.ZZ) { if (dump.includes(z)) found.push(z + ' in D1'); for (const p of pages) if (p.body.includes(z)) found.push(z + ' in ' + p.p); }
  ok('not one planted value in D1 or any page (' + S.ZZ.length + ' values, ' + pages.length + ' pages)', found.length === 0, found.slice(0, 8));
  const maya = pages.find((p) => p.p === '/household/' + hh('HHID_sample_maya').display_no);
  ok('the household page read fresh from the emulator and counts entries and photos', maya && new RegExp(mayaEvents + ', plus 1 photo<').test(maya.body), maya && maya.body.match(/Entries in total<\/span><span>[^<]*/));

  console.log('\n4. the 15-minute pass on a real updatedAt query');
  await fetch(DOCS + '/households/HHID_sample_dana?updateMask.fieldPaths=updatedAt&updateMask.fieldPaths=memberInfo', { method: 'PATCH', headers: Object.assign({ 'content-type': 'application/json' }, OWNER),
    body: JSON.stringify({ fields: toFsFields({ updatedAt: new Date(fx.now() + 60000), memberInfo: { UID_sample_dana: { name: 'Dana R', relationship: 'Mum' }, UID_sample_sam: { name: 'Sam', relationship: 'Dad' } } }) }) });
  fx.setNow(fx.now() + 15 * 60000);
  const r2 = await fx.tick();
  ok('a household whose updatedAt moved is re-read on the next tick', r2 && r2.incremental >= 1 && fx.admin.raw.prepare("SELECT name FROM dir_people WHERE uid = 'UID_sample_dana'").get().name === 'Dana R', r2);

  console.log('\n5. the hold reader on the real server');
  const reader = R.createReader({ projectId: PROJECT, base: 'http://' + FSE + '/v1', getToken: async () => 'owner' });
  const put = (p, f) => fetch(DOCS + '/' + p, { method: 'PATCH', headers: Object.assign({ 'content-type': 'application/json' }, OWNER), body: JSON.stringify({ fields: toFsFields(f) }) });
  await put('households/HHID_hold_null', { app: { lossHolding: null } });
  await put('households/HHID_hold_set', { app: { lossHolding: { UID_sample_x: { at: 1 } } } });
  await put('households/HHID_hold_absent', { app: { babies: [] } });
  ok('null on the real server reads NOT held', (await R.holdRead(reader, 'HHID_hold_null')) === false);
  ok('a per-uid entry reads held', (await R.holdRead(reader, 'HHID_hold_set')) === true);
  ok('the field absent reads held', (await R.holdRead(reader, 'HHID_hold_absent')) === true);
  ok('a household the server does not have (a real 404) reads held', (await R.holdRead(reader, 'HHID_no_such_household')) === true);

  done();
})().catch((e) => { console.log('  FAIL threw ' + (e && e.stack)); fail++; done(); });
