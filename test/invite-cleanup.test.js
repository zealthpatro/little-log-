/* tools/invite_cleanup.js, against the Firestore AND Auth emulators, with the real rules.
 * 2026-11-12 security audit: rules-ex-member-rejoin, identity-rejoin-after-removal, and the
 * skeptic's round-1 finding that the first proposed cleanup (matching memberEmails) would miss the
 * removed member, because removeMember and deleteAccount delete that doc.
 *
 * What it proves:
 *   - the hole is real first: under the NEW rules a removed member with a lingering co-owner invite
 *     rejoins AS OWNER with one batch (if this ever stops succeeding the test says so, because then
 *     the "refused after" half proves nothing)
 *   - the dry run changes nothing and prints no address, uid or household id
 *   - --apply deletes the used and dead invites (joined, removed, household gone, household being
 *     deleted) and their pending rows, keeps the genuinely pending ones, and clears a bogus deletion
 *     flag on a family that still has people in it, while a real deletion flag stays
 *   - afterwards the removed member's rejoin is refused
 *   - the script refuses to run on half an emulator setup, or with no credentials at all
 *
 *   node test/invite-cleanup.test.js          (self-hosting: starts both emulators itself)
 * Ports are overridable so it never collides with another suite: FS_PORT, AUTH_PORT.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FS_PORT = Number(process.env.FS_PORT) || 8667;
const AUTH_PORT = Number(process.env.AUTH_PORT) || 9667;
const PROJECT = 'demo-cubby-cleanup';
const TOOL = path.join(ROOT, 'tools', 'invite_cleanup.js');

/* ---------- outer phase: both emulators up, then re-run ourselves inside them ---------- */
if (!process.env.INVITE_CLEANUP_INNER) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-cleanup-'));
  fs.copyFileSync(path.join(ROOT, 'firestore.rules'), path.join(scratch, 'firestore.rules'));
  fs.writeFileSync(path.join(scratch, 'firebase.json'), JSON.stringify({
    firestore: { rules: 'firestore.rules' },
    emulators: { firestore: { port: FS_PORT }, auth: { port: AUTH_PORT }, ui: { enabled: false } }
  }));
  const firebaseBin = path.join(__dirname, 'node_modules', '.bin', 'firebase');
  const javaBin = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin') : '/opt/homebrew/opt/openjdk/bin';
  const env = Object.assign({}, process.env, { INVITE_CLEANUP_INNER: '1', PATH: javaBin + ':' + process.env.PATH });
  try {
    execFileSync(firebaseBin, [
      'emulators:exec', '--only', 'firestore,auth', '--project', PROJECT,
      '--config', path.join(scratch, 'firebase.json'),
      `node ${JSON.stringify(__filename)}`
    ], { cwd: scratch, env, stdio: 'inherit' });
  } catch (e) { process.exitCode = e.status || 1; }
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) {}
  return;
}

/* ---------- inner phase ---------- */
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const firebase = require('firebase/compat/app').default || require('firebase/compat/app');
require('firebase/compat/firestore');
// Admin Auth only to make the emulator accounts (with fixed uids). It lives in tools/node_modules.
const adminFrom = (m) => require(require.resolve(m, { paths: [path.join(ROOT, 'tools')] }));
const { initializeApp } = adminFrom('firebase-admin/app');
const { getAuth } = adminFrom('firebase-admin/auth');

const FV = firebase.firestore.FieldValue;
const FP = firebase.firestore.FieldPath;
const DAY = 86400000;

let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; console.log('  FAIL ' + n + (extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 400) : '')); }
};
async function check(name, p) {
  try { await p; ok(name, true); } catch (e) { ok(name, false, ((e && e.message) || String(e)).split('\n')[0]); }
}

// Distinctive ids, so "the output names nobody" is a real search and not a search for "H".
const HID = 'hhFamilyMaple7';       // a live family
const HID_BOGUS = 'hhBogusFlag3';   // a live family someone flagged under the old rules
const HID_DYING = 'hhReallyLeaving9'; // the last one out flagged it: a real deletion
const HID_GONE = 'hhLongGone5';     // never existed / already purged
const UID = { owner: 'uidOwnerOlive', removed: 'uidRemovedRex', joined: 'uidJoinedJo', stranger: 'uidOtherKim', bogusOwner: 'uidBogusBea' };
const EM = { removed: 'rex.removed@example.test', joined: 'jo.joined@example.test', pending: 'pat.pending@example.test',
  stranger: 'kim.elsewhere@example.test', gone: 'gus.gone@example.test', dying: 'dee.dying@example.test' };

function runTool(args, envPatch) {
  const env = Object.assign({}, process.env, envPatch || {});
  // Never let a developer's real key reach this child, whatever their shell has exported.
  delete env.GOOGLE_APPLICATION_CREDENTIALS;
  Object.keys(envPatch || {}).forEach((k) => { if (envPatch[k] === null) delete env[k]; });
  const r = spawnSync('node', [TOOL].concat(args || []), { env, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
const names = () => Object.values(EM).concat(Object.values(UID), [HID, HID_BOGUS, HID_DYING, HID_GONE]);
const leaks = (out) => names().filter((s) => out.includes(s)).concat(out.includes('@') ? ['@'] : []);
// Key-sorted JSON, so two reads of the same data compare equal whatever order the maps come back in.
const stable = (v) => (v && typeof v === 'object' && !Array.isArray(v))
  ? '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'
  : Array.isArray(v) ? '[' + v.map(stable).join(',') + ']' : JSON.stringify(v);
const count = (out, label) => { const m = out.split('\n').find((l) => l.includes(label)); return m ? Number(m.trim().split(/\s+/).pop()) : NaN; };

(async () => {
  console.log('\ninvite cleanup, against the emulators with the real rules\n');
  const env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') } });
  const seedDb = (fn) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));
  const readAdmin = async (p) => { let d; await seedDb(async (db) => { d = await db.doc(p).get(); }); return d; };
  const dumpAll = async () => {
    const out = {};
    await seedDb(async (db) => {
      for (const c of ['invites', 'households']) {
        const s = await db.collection(c).get();
        s.docs.forEach((d) => { out[c + '/' + d.id] = d.data(); });
      }
    });
    return stable(out);
  };

  const auth = getAuth(initializeApp({ projectId: PROJECT }, 'seed'));
  // Accounts: the removed member and the joined member exist; so does someone who was never in this
  // family. The genuinely pending invitee has not signed up yet.
  await auth.createUser({ uid: UID.removed, email: EM.removed });
  await auth.createUser({ uid: UID.joined, email: EM.joined });
  await auth.createUser({ uid: UID.stranger, email: EM.stranger });

  const seed = () => seedDb(async (db) => {
    await env.clearFirestore();
    await db.doc('households/' + HID).set({
      ownerId: UID.owner, members: { [UID.owner]: 'owner', [UID.joined]: 'caregiver' },
      memberInfo: { [UID.owner]: { name: 'Olive', role: 'owner' }, [UID.joined]: { name: 'Jo', role: 'caregiver' } },
      // Rex was removed. removeMember deleted his memberEmails doc, which is why the cleanup cannot
      // look addresses up there.
      formerMemberInfo: { [UID.removed]: { name: 'Rex', relationship: 'Uncle', avatar: null } },
      pendingInvites: { [EM.removed]: { name: 'Rex', role: 'owner', at: 1 }, [EM.joined]: { name: 'Jo', role: 'caregiver', at: 1 },
        [EM.pending]: { name: 'Pat', role: 'caregiver', at: 1 }, [EM.stranger]: { name: 'Kim', role: 'caregiver', at: 1 } },
      app: { babies: [] }
    });
    await db.doc('households/' + HID_BOGUS).set({ ownerId: UID.bogusOwner, members: { [UID.bogusOwner]: 'owner' },
      memberInfo: { [UID.bogusOwner]: { name: 'Bea', role: 'owner' } }, deleteAfter: Date.now() + 10 * DAY, deletionRequestedBy: 'uidSomeStranger', app: { babies: [] } });
    await db.doc('households/' + HID_DYING).set({ ownerId: 'uidLastOut', members: {}, memberInfo: {},
      deleteAfter: Date.now() + 30 * DAY, deletionRequestedBy: 'uidLastOut' });
    // The lingering ones (joins made before invites were spent) and the real pending ones.
    await db.doc('invites/' + EM.removed).set({ householdId: HID, role: 'owner', invitedBy: UID.owner });
    await db.doc('invites/' + EM.joined).set({ householdId: HID, role: 'caregiver', invitedBy: UID.owner });
    await db.doc('invites/' + EM.pending).set({ householdId: HID, role: 'caregiver', invitedBy: UID.owner });
    await db.doc('invites/' + EM.stranger).set({ householdId: HID, role: 'caregiver', invitedBy: UID.owner });
    await db.doc('invites/' + EM.gone).set({ householdId: HID_GONE, role: 'caregiver' });
    await db.doc('invites/' + EM.dying).set({ householdId: HID_DYING, role: 'caregiver' });
  });

  // Rex's way back in: one batch, the join plus deleting his own invite (what the rules require).
  const rexRejoins = () => {
    const db = env.authenticatedContext(UID.removed, { email: EM.removed }).firestore();
    const b = db.batch();
    b.update(db.doc('households/' + HID), new FP('pendingInvites', EM.removed), FV.delete(),
      'members.' + UID.removed, 'owner', 'memberInfo.' + UID.removed, { name: 'Rex', role: 'owner', relationship: 'Uncle' });
    b.delete(db.doc('invites/' + EM.removed));
    return b.commit();
  };

  console.log('1. the hole, before any cleanup (the rejoin must SUCCEED, or the rest proves nothing)');
  await seed();
  await check('a removed member rejoins AS OWNER with his lingering co-owner invite', assertSucceeds(rexRejoins()));

  console.log('\n2. it refuses to run without the right credentials');
  await seed();
  const before0 = await dumpAll();
  const half = runTool(['--apply'], { FIREBASE_AUTH_EMULATOR_HOST: null });
  ok('Firestore emulator without the Auth emulator: refused (exit 2)', half.code === 2, half.out);
  const none = runTool(['--apply'], { FIREBASE_AUTH_EMULATOR_HOST: null, FIRESTORE_EMULATOR_HOST: null });
  ok('no emulators and no GOOGLE_APPLICATION_CREDENTIALS: refused (exit 2)', none.code === 2, none.out);
  ok('and neither refusal changed anything', (await dumpAll()) === before0);

  console.log('\n3. dry run');
  const dry = runTool([]);
  ok('exits 0', dry.code === 0, dry.out);
  ok('says it is a dry run', /dry run, nothing changed/.test(dry.out), dry.out);
  ok('changed nothing at all', (await dumpAll()) === before0);
  ok('prints no address, uid or household id', leaks(dry.out).length === 0, leaks(dry.out));
  // The companion to that absence check: the same matcher does find each kind when it is printed.
  ok('(the leak matcher finds an address, a uid and a household id when they are there)',
    leaks('x ' + EM.pending).length > 0 && leaks('x ' + UID.removed).length > 0 && leaks('x ' + HID_BOGUS).length > 0);
  ok('counts: would delete 1 joined, 1 removed, 1 gone, 1 being deleted',
    count(dry.out, 'already joined') === 1 && count(dry.out, 'removed or left') === 1
    && count(dry.out, 'household gone') === 1 && count(dry.out, 'household being deleted') === 1, dry.out);
  ok('counts: keeps 1 pending with an account, 1 with none; 1 flag to clear',
    count(dry.out, 'account exists') === 1 && count(dry.out, 'no account yet') === 1 && count(dry.out, 'flag on a family with people') === 1, dry.out);

  console.log('\n4. --apply');
  const applied = runTool(['--apply']);
  ok('exits 0', applied.code === 0, applied.out);
  ok('prints no address, uid or household id', leaks(applied.out).length === 0, leaks(applied.out));
  ok('the removed member\'s invite is gone', !(await readAdmin('invites/' + EM.removed)).exists);
  ok('the joined member\'s invite is gone', !(await readAdmin('invites/' + EM.joined)).exists);
  ok('the invite into a household that is gone is gone', !(await readAdmin('invites/' + EM.gone)).exists);
  ok('the invite into a household being deleted is gone', !(await readAdmin('invites/' + EM.dying)).exists);
  ok('the genuinely pending invite (no account yet) survives', (await readAdmin('invites/' + EM.pending)).exists);
  ok('the invite for an account that was never in this family survives', (await readAdmin('invites/' + EM.stranger)).exists);
  const h = (await readAdmin('households/' + HID)).data();
  ok('the used pending rows are cleared, the real ones kept',
    !(EM.removed in h.pendingInvites) && !(EM.joined in h.pendingInvites) && (EM.pending in h.pendingInvites) && (EM.stranger in h.pendingInvites), Object.keys(h.pendingInvites));
  ok('the family itself is untouched (members, tombstone)', h.members[UID.joined] === 'caregiver' && !!h.formerMemberInfo[UID.removed] && !(UID.removed in h.members));
  const hb = (await readAdmin('households/' + HID_BOGUS)).data();
  ok('the bogus deletion flag is gone, the family kept', !('deleteAfter' in hb) && !('deletionRequestedBy' in hb) && hb.members[UID.bogusOwner] === 'owner', hb);
  const hd = (await readAdmin('households/' + HID_DYING)).data();
  ok('a real deletion flag (nobody left) stays', typeof hd.deleteAfter === 'number' && hd.deletionRequestedBy === 'uidLastOut', hd);

  console.log('\n5. the hole, after the cleanup');
  await check('the removed member\'s rejoin is now refused', assertFails(rexRejoins()));

  console.log('\n6. running it again');
  const again = runTool(['--apply']);
  ok('a second --apply deletes nothing more', again.code === 0 && count(again.out, 'already joined') === 0
    && count(again.out, 'removed or left') === 0 && count(again.out, 'flag on a family with people') === 0, again.out);

  await env.cleanup();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'INVITE-CLEANUP: FAIL' : 'INVITE-CLEANUP: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
