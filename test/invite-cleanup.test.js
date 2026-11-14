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
 *   - round 2: a removed member who deletes his OWN account before the cleanup (one Identity Toolkit
 *     call with his own token, skipping the app's deleteAccount) cannot make it keep his invite and
 *     come back after --apply with a fresh sign-up. An invite nobody has joined with is kept only when
 *     it is a caregiver invite into a family nobody has left; anything else is deleted (the owner can
 *     re-send it). Both halves of that rule are tested on their own (a co-owner invite into a family
 *     with no tombstone, and a caregiver invite into a family someone left), and so is the variant
 *     where he signs up again BEFORE the cleanup runs.
 *   - a live family that carries a bogus deletion flag keeps its genuine pending invites
 *   - the script refuses to run on half an emulator setup, or with no credentials at all
 *   - section 7, one invite per family (invites/{email}/from/{hid}): an old address-keyed invite it
 *     deletes leaves the pendingInvites row alone when the same family's own invite to that address
 *     is live (they share the row), and a family's own invite is deleted only when nobody can use it
 *     (household gone or being deleted, she is already in that family, or it names another
 *     household); a genuinely pending one is kept
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
const HUB_PORT = Number(process.env.HUB_PORT) || 0, LOG_PORT = Number(process.env.LOG_PORT) || 0, WS_PORT = Number(process.env.WS_PORT) || 0;
const PROJECT = 'demo-cubby-cleanup';
const TOOL = path.join(ROOT, 'tools', 'invite_cleanup.js');

/* ---------- outer phase: both emulators up, then re-run ourselves inside them ---------- */
if (!process.env.INVITE_CLEANUP_INNER) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-cleanup-'));
  fs.copyFileSync(path.join(ROOT, 'firestore.rules'), path.join(scratch, 'firestore.rules'));
  fs.writeFileSync(path.join(scratch, 'firebase.json'), JSON.stringify({
    firestore: { rules: 'firestore.rules' },
    emulators: Object.assign({ firestore: Object.assign({ port: FS_PORT }, WS_PORT ? { websocketPort: WS_PORT } : {}), auth: { port: AUTH_PORT }, ui: { enabled: false } },
      HUB_PORT ? { hub: { port: HUB_PORT } } : {}, LOG_PORT ? { logging: { port: LOG_PORT } } : {})
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
// A family with no tombstones: nobody has left it, or (Ross) they left before formerMemberInfo existed.
const HID_CALM = 'hhQuietOak4';
const UID = { owner: 'uidOwnerOlive', removed: 'uidRemovedRex', joined: 'uidJoinedJo', stranger: 'uidOtherKim', bogusOwner: 'uidBogusBea',
  calmOwner: 'uidOwnerCal',
  // Removed members who delete their own account before the cleanup, and the uids they get when
  // they sign up again with the same address. Ray: co-owner invite, family with a tombstone (the
  // skeptic's case). Rae: caregiver invite, family with a tombstone. Ross: co-owner invite, removed
  // before tombstones existed. Roy: caregiver invite, signs up again BEFORE the cleanup runs.
  ray: 'uidRayGone', rayAgain: 'uidRayAgain', rae: 'uidRaeGone', raeAgain: 'uidRaeAgain',
  ross: 'uidRossGone', rossAgain: 'uidRossAgain', roy: 'uidRoyGone', royAgain: 'uidRoyAgain' };
const EM = { removed: 'rex.removed@example.test', joined: 'jo.joined@example.test', pending: 'pat.pending@example.test',
  stranger: 'kim.elsewhere@example.test', gone: 'gus.gone@example.test', dying: 'dee.dying@example.test',
  bogusPending: 'bo.bogusfam@example.test',
  ray: 'ray.selfgone@example.test', rae: 'rae.selfgone@example.test', ross: 'ross.oldbuild@example.test', roy: 'roy.backearly@example.test',
  // Section 7, one invite per family: Kai has an old address-keyed invite AND his family's own one.
  kai: 'kai.twodoors@example.test', fGone: 'fay.famgone@example.test', fDying: 'fin.famdying@example.test',
  fPending: 'flo.fampending@example.test', fOdd: 'fox.famodd@example.test' };
const AUTH_URL = () => 'http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST + '/identitytoolkit.googleapis.com/v1/';
async function idt(p, body) {
  const r = await fetch(AUTH_URL() + p + '?key=fake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
// What the attacker does: sign in, then delete his own account with his own ID token (the same as
// currentUser.delete() in devtools). The app's deleteAccount, which would delete his invite, never runs.
async function selfDelete(email) {
  const s = await idt('accounts:signInWithPassword', { email, password: 'pw-123456', returnSecureToken: true });
  if (!s.idToken) throw new Error('sign-in for self-delete failed: ' + JSON.stringify(s.error || s).slice(0, 120));
  const d = await idt('accounts:delete', { idToken: s.idToken });
  if (d && d.error) throw new Error('self-delete failed: ' + JSON.stringify(d.error).slice(0, 120));
}

function runTool(args, envPatch) {
  const env = Object.assign({}, process.env, envPatch || {});
  // Never let a developer's real key reach this child, whatever their shell has exported.
  delete env.GOOGLE_APPLICATION_CREDENTIALS;
  Object.keys(envPatch || {}).forEach((k) => { if (envPatch[k] === null) delete env[k]; });
  const r = spawnSync('node', [TOOL].concat(args || []), { env, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
const names = () => Object.values(EM).concat(Object.values(UID), [HID, HID_BOGUS, HID_DYING, HID_GONE, HID_CALM]);
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
  // The four who delete their own accounts before the cleanup runs. Roy signs up again straight away.
  for (const k of ['ray', 'rae', 'ross', 'roy']) await auth.createUser({ uid: UID[k], email: EM[k], password: 'pw-123456' });
  for (const k of ['ray', 'rae', 'ross', 'roy']) await selfDelete(EM[k]);
  const gone = [];
  for (const k of ['ray', 'rae', 'ross', 'roy']) { try { await auth.getUserByEmail(EM[k]); } catch (e) { gone.push(k); } }
  ok('(setup) each of them deleted his own account with his own token', gone.length === 4, gone);
  await auth.createUser({ uid: UID.royAgain, email: EM.roy });

  const seed = () => seedDb(async (db) => {
    await env.clearFirestore();
    await db.doc('households/' + HID).set({
      ownerId: UID.owner, members: { [UID.owner]: 'owner', [UID.joined]: 'caregiver' },
      memberInfo: { [UID.owner]: { name: 'Olive', role: 'owner' }, [UID.joined]: { name: 'Jo', role: 'caregiver' } },
      // Rex was removed. removeMember deleted his memberEmails doc, which is why the cleanup cannot
      // look addresses up there.
      formerMemberInfo: { [UID.removed]: { name: 'Rex', relationship: 'Uncle', avatar: null },
        [UID.ray]: { name: 'Ray', relationship: 'Uncle', avatar: null }, [UID.rae]: { name: 'Rae', relationship: 'Aunt', avatar: null },
        [UID.roy]: { name: 'Roy', relationship: 'Cousin', avatar: null } },
      pendingInvites: { [EM.removed]: { name: 'Rex', role: 'owner', at: 1 }, [EM.joined]: { name: 'Jo', role: 'caregiver', at: 1 },
        [EM.ray]: { name: 'Ray', role: 'owner', at: 1 }, [EM.rae]: { name: 'Rae', role: 'caregiver', at: 1 },
        [EM.roy]: { name: 'Roy', role: 'caregiver', at: 1 } },
      app: { babies: [] }
    });
    // Nobody in its tombstone. Ross was removed by an older build that wrote no formerMemberInfo.
    await db.doc('households/' + HID_CALM).set({
      ownerId: UID.calmOwner, members: { [UID.calmOwner]: 'owner' }, memberInfo: { [UID.calmOwner]: { name: 'Cal', role: 'owner' } },
      pendingInvites: { [EM.pending]: { name: 'Pat', role: 'caregiver', at: 1 }, [EM.stranger]: { name: 'Kim', role: 'caregiver', at: 1 },
        [EM.ross]: { name: 'Ross', role: 'owner', at: 1 } },
      app: { babies: [] }
    });
    await db.doc('households/' + HID_BOGUS).set({ ownerId: UID.bogusOwner, members: { [UID.bogusOwner]: 'owner' },
      memberInfo: { [UID.bogusOwner]: { name: 'Bea', role: 'owner' } }, deleteAfter: Date.now() + 10 * DAY, deletionRequestedBy: 'uidSomeStranger',
      pendingInvites: { [EM.bogusPending]: { name: 'Bo', role: 'caregiver', at: 1 } }, app: { babies: [] } });
    await db.doc('households/' + HID_DYING).set({ ownerId: 'uidLastOut', members: {}, memberInfo: {},
      deleteAfter: Date.now() + 30 * DAY, deletionRequestedBy: 'uidLastOut' });
    // The lingering ones (joins made before invites were spent) and the real pending ones.
    await db.doc('invites/' + EM.removed).set({ householdId: HID, role: 'owner', invitedBy: UID.owner });
    await db.doc('invites/' + EM.joined).set({ householdId: HID, role: 'caregiver', invitedBy: UID.owner });
    await db.doc('invites/' + EM.ray).set({ householdId: HID, role: 'owner', invitedBy: UID.owner });
    await db.doc('invites/' + EM.rae).set({ householdId: HID, role: 'caregiver', invitedBy: UID.owner });
    await db.doc('invites/' + EM.roy).set({ householdId: HID, role: 'caregiver', invitedBy: UID.owner });
    await db.doc('invites/' + EM.pending).set({ householdId: HID_CALM, role: 'caregiver', invitedBy: UID.calmOwner });
    await db.doc('invites/' + EM.stranger).set({ householdId: HID_CALM, role: 'caregiver', invitedBy: UID.calmOwner });
    await db.doc('invites/' + EM.ross).set({ householdId: HID_CALM, role: 'owner', invitedBy: UID.calmOwner });
    // A genuine pending invite into the family someone flagged under the old rules (it is live).
    await db.doc('invites/' + EM.bogusPending).set({ householdId: HID_BOGUS, role: 'caregiver', invitedBy: UID.bogusOwner });
    await db.doc('invites/' + EM.gone).set({ householdId: HID_GONE, role: 'caregiver' });
    await db.doc('invites/' + EM.dying).set({ householdId: HID_DYING, role: 'caregiver' });
  });

  // Rex's way back in: one batch, the join plus deleting his own invite (what the rules require).
  const rexRejoins = () => {
    const db = env.authenticatedContext(UID.removed, { email: EM.removed, email_verified: true }).firestore();
    const b = db.batch();
    b.update(db.doc('households/' + HID), new FP('pendingInvites', EM.removed), FV.delete(),
      'members.' + UID.removed, 'owner', 'memberInfo.' + UID.removed, { name: 'Rex', role: 'owner', relationship: 'Uncle' });
    b.delete(db.doc('invites/' + EM.removed));
    return b.commit();
  };

  // The same way back in for anyone, with whatever uid his current sign-up has.
  const rejoin = (uid, email, hid, role, name) => {
    const db = env.authenticatedContext(uid, { email, email_verified: true }).firestore();
    const b = db.batch();
    b.update(db.doc('households/' + hid), new FP('pendingInvites', email), FV.delete(),
      new FP('members', uid), role, new FP('memberInfo', uid), { name, role, relationship: 'Family' });
    b.delete(db.doc('invites/' + email));
    return b.commit();
  };
  // And what an owner who got back in does next: removes the original owner.
  const removeOwner = (uid, hid, ownerUid) => {
    const db = env.authenticatedContext(uid).firestore();
    return db.doc('households/' + hid).update(new FP('members', ownerUid), FV.delete(), 'ownerId', uid);
  };

  console.log('1. the hole, before any cleanup (the rejoin must SUCCEED, or the rest proves nothing)');
  await seed();
  await check('a removed member rejoins AS OWNER with his lingering co-owner invite', assertSucceeds(rexRejoins()));
  // The rules never look at Auth: a fresh sign-up is just a new uid with the same address.
  await check('a removed member who deleted his account and signed up again rejoins AS OWNER',
    assertSucceeds(rejoin(UID.rayAgain, EM.ray, HID, 'owner', 'Ray')));
  await check('...and then removes the original owner', assertSucceeds(removeOwner(UID.rayAgain, HID, UID.owner)));
  await check('the same with a co-owner invite into a family with no tombstone', assertSucceeds(rejoin(UID.rossAgain, EM.ross, HID_CALM, 'owner', 'Ross')));
  await check('the same with a caregiver invite into a family someone left', assertSucceeds(rejoin(UID.raeAgain, EM.rae, HID, 'caregiver', 'Rae')));
  await check('the same when he signed up again before the cleanup', assertSucceeds(rejoin(UID.royAgain, EM.roy, HID, 'caregiver', 'Roy')));

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
  ok('counts: would delete 3 not joined with no account (Ray, Rae, Ross) and 1 with an account (Roy), saying the owner may need to re-send',
    count(dry.out, 'not joined, no account') === 3 && count(dry.out, 'not joined, has an account') === 1
    && /not joined, no account[^\n]*re-send/.test(dry.out), dry.out);
  ok('counts: keeps 1 pending with an account, 2 with none; 1 flag to clear',
    count(dry.out, 'account exists') === 1 && count(dry.out, 'no account yet') === 2 && count(dry.out, 'flag on a family with people') === 1, dry.out);
  ok('counts: the kept ones are 3 caregiver invites and 0 co-owner invites',
    count(dry.out, 'kept, caregiver invites') === 3 && count(dry.out, 'kept, co-owner invites') === 0, dry.out);

  console.log('\n4. --apply');
  const applied = runTool(['--apply']);
  ok('exits 0', applied.code === 0, applied.out);
  ok('prints no address, uid or household id', leaks(applied.out).length === 0, leaks(applied.out));
  ok('the removed member\'s invite is gone', !(await readAdmin('invites/' + EM.removed)).exists);
  ok('the joined member\'s invite is gone', !(await readAdmin('invites/' + EM.joined)).exists);
  ok('the invite into a household that is gone is gone', !(await readAdmin('invites/' + EM.gone)).exists);
  ok('the invite into a household being deleted is gone', !(await readAdmin('invites/' + EM.dying)).exists);
  ok('a genuinely pending caregiver invite (no account yet) into a family nobody has left survives', (await readAdmin('invites/' + EM.pending)).exists);
  ok('a caregiver invite for an account that was never in that family survives', (await readAdmin('invites/' + EM.stranger)).exists);
  ok('the self-deleted member\'s co-owner invite is gone (family with a tombstone)', !(await readAdmin('invites/' + EM.ray)).exists);
  ok('the self-deleted member\'s caregiver invite into a family someone left is gone', !(await readAdmin('invites/' + EM.rae)).exists);
  ok('a co-owner invite with no account, into a family with no tombstone, is gone', !(await readAdmin('invites/' + EM.ross)).exists);
  ok('the invite of the member who signed up again before the cleanup is gone', !(await readAdmin('invites/' + EM.roy)).exists);
  ok('the live family with a bogus deletion flag keeps its genuine pending invite', (await readAdmin('invites/' + EM.bogusPending)).exists);
  const h = (await readAdmin('households/' + HID)).data();
  ok('the used and deleted invites\' pending rows are cleared',
    !(EM.removed in h.pendingInvites) && !(EM.joined in h.pendingInvites) && !(EM.ray in h.pendingInvites)
    && !(EM.rae in h.pendingInvites) && !(EM.roy in h.pendingInvites), Object.keys(h.pendingInvites));
  const hc = (await readAdmin('households/' + HID_CALM)).data();
  ok('the real pending rows are kept, the deleted co-owner one is cleared',
    (EM.pending in hc.pendingInvites) && (EM.stranger in hc.pendingInvites) && !(EM.ross in hc.pendingInvites), Object.keys(hc.pendingInvites));
  ok('the family itself is untouched (members, tombstone)', h.members[UID.joined] === 'caregiver' && !!h.formerMemberInfo[UID.removed] && !(UID.removed in h.members));
  const hb = (await readAdmin('households/' + HID_BOGUS)).data();
  ok('the bogus deletion flag is gone, the family kept', !('deleteAfter' in hb) && !('deletionRequestedBy' in hb) && hb.members[UID.bogusOwner] === 'owner', hb);
  ok('and that family\'s pending row is kept', !!(hb.pendingInvites && hb.pendingInvites[EM.bogusPending]), hb.pendingInvites);
  const hd = (await readAdmin('households/' + HID_DYING)).data();
  ok('a real deletion flag (nobody left) stays', typeof hd.deleteAfter === 'number' && hd.deletionRequestedBy === 'uidLastOut', hd);

  console.log('\n5. the hole, after the cleanup');
  await check('the removed member\'s rejoin is now refused', assertFails(rexRejoins()));
  // The ones who deleted their own accounts sign up again, with the same addresses.
  for (const k of ['ray', 'rae', 'ross']) await auth.createUser({ uid: UID[k + 'Again'], email: EM[k] });
  await check('the member who deleted his account and signed up again can no longer rejoin as owner',
    assertFails(rejoin(UID.rayAgain, EM.ray, HID, 'owner', 'Ray')));
  await check('...so he cannot remove the original owner either', assertFails(removeOwner(UID.rayAgain, HID, UID.owner)));
  await check('nor with a co-owner invite into a family with no tombstone', assertFails(rejoin(UID.rossAgain, EM.ross, HID_CALM, 'owner', 'Ross')));
  await check('nor with a caregiver invite into a family someone left', assertFails(rejoin(UID.raeAgain, EM.rae, HID, 'caregiver', 'Rae')));
  await check('nor when he signed up again before the cleanup ran', assertFails(rejoin(UID.royAgain, EM.roy, HID, 'caregiver', 'Roy')));
  const ho = (await readAdmin('households/' + HID)).data();
  ok('the original owner is still the owner', ho.members[UID.owner] === 'owner' && ho.ownerId === UID.owner, ho.members);

  console.log('\n6. running it again');
  const again = runTool(['--apply']);
  ok('a second --apply deletes nothing more', again.code === 0 && count(again.out, 'already joined') === 0
    && count(again.out, 'removed or left') === 0 && count(again.out, 'flag on a family with people') === 0, again.out);

  console.log('\n7. one invite per family, beside the address-keyed one');
  await seedDb(async (db) => {
    // Kai's old address-keyed co-owner invite into a family someone has left (deleted, as in 4), and
    // his family's own invite to him, made since; the two share his row on Olive's list.
    await db.doc('invites/' + EM.kai).set({ householdId: HID, role: 'owner', invitedBy: UID.owner });
    await db.doc('invites/' + EM.kai + '/from/' + HID).set({ householdId: HID, role: 'caregiver', invitedBy: UID.owner });
    await db.doc('households/' + HID).update(new FP('pendingInvites', EM.kai), { name: 'Kai', role: 'caregiver', at: 2, perFamily: true });
    await db.doc('invites/' + EM.fGone + '/from/' + HID_GONE).set({ householdId: HID_GONE, role: 'caregiver' });
    await db.doc('invites/' + EM.fDying + '/from/' + HID_DYING).set({ householdId: HID_DYING, role: 'caregiver' });
    await db.doc('invites/' + EM.joined + '/from/' + HID).set({ householdId: HID, role: 'caregiver', invitedBy: UID.owner });
    await db.doc('households/' + HID).update(new FP('pendingInvites', EM.joined), { name: 'Jo', role: 'caregiver', at: 2, perFamily: true });
    await db.doc('invites/' + EM.fPending + '/from/' + HID_CALM).set({ householdId: HID_CALM, role: 'caregiver', invitedBy: UID.calmOwner });
    await db.doc('invites/' + EM.fOdd + '/from/' + HID_CALM).set({ householdId: HID, role: 'owner' });
  });
  const dry7 = runTool([]);
  ok('the dry run reads the six family invites', count(dry7.out, 'family invites read') === 6, dry7.out);
  ok('and names nobody', leaks(dry7.out).length === 0, leaks(dry7.out));
  const fam7 = runTool(['--apply']);
  ok('--apply exits 0', fam7.code === 0, fam7.out);
  ok('and names nobody', leaks(fam7.out).length === 0, leaks(fam7.out));
  ok('Kai\'s old address-keyed co-owner invite is deleted, as before', !(await readAdmin('invites/' + EM.kai)).exists);
  ok('his family\'s own invite to him is untouched', (await readAdmin('invites/' + EM.kai + '/from/' + HID)).exists);
  const h7 = (await readAdmin('households/' + HID)).data();
  ok('and the row they share stays on Olive\'s list', !!(h7.pendingInvites || {})[EM.kai], Object.keys(h7.pendingInvites || {}));
  ok('a family invite into a household that is gone is deleted', !(await readAdmin('invites/' + EM.fGone + '/from/' + HID_GONE)).exists);
  ok('one into a household being deleted is deleted', !(await readAdmin('invites/' + EM.fDying + '/from/' + HID_DYING)).exists);
  ok('one for someone already in that family is deleted', !(await readAdmin('invites/' + EM.joined + '/from/' + HID)).exists);
  ok('and its row with it', !(h7.pendingInvites || {})[EM.joined], Object.keys(h7.pendingInvites || {}));
  ok('one that names another household than its own is deleted', !(await readAdmin('invites/' + EM.fOdd + '/from/' + HID_CALM)).exists);
  ok('(companion) a genuinely pending family invite is kept', (await readAdmin('invites/' + EM.fPending + '/from/' + HID_CALM)).exists);
  ok('counts: 1 gone, 1 being deleted, 1 already in, 1 naming another, 2 kept, 1 row left for the family\'s own',
    count(fam7.out, 'family invite, household gone') === 1 && count(fam7.out, 'family invite, household being deleted') === 1
    && count(fam7.out, 'family invite, already in that family') === 1 && count(fam7.out, 'family invite naming another household') === 1
    && count(fam7.out, 'family invites still pending') === 2 && count(fam7.out, 'rows left for the family') === 1, fam7.out);

  /* 8. Lane B, P4. Runs after section 7, because its seed clears the emulator. Hana joined Mia's family by link with a Hide My Email address while Mia's email
     invite to Hana's REAL address was still waiting; Mia removed her. That invite lets her back in.
     It is matched by the name on it against the removed member's tombstone: whole name, trimmed, any
     case. "Hana Lee" is somebody else; an invite with no name matches no one, and neither does a
     deletion's tombstone, which keeps no name. */
  console.log('\n8. her invite to another address, matched by the name of someone removed');
  const HID_HME = 'hhWillowHme6';
  const HM = { real: 'hana.real@example.test', lee: 'hana.lee@example.test', noname: 'nameless@example.test' };
  await auth.createUser({ uid: 'uidHanaHme', email: 'hana.hme@privaterelay.example.test' });
  const hmeSeed = () => seedDb(async (db) => {
    await env.clearFirestore();
    await db.doc('households/' + HID_HME).set({ ownerId: 'uidOwnerMia', members: { uidOwnerMia: 'owner' },
      memberInfo: { uidOwnerMia: { name: 'Mia', role: 'owner' } },
      formerMemberInfo: { uidHanaHme: { name: 'Hana', relationship: 'Auntie', avatar: null }, uidLeftByDeleting: { name: '', relationship: 'Nanny', avatar: null } },
      pendingInvites: { [HM.real]: { name: ' hana ', role: 'caregiver', at: 1 }, [HM.lee]: { name: 'Hana Lee', role: 'caregiver', at: 1 }, [HM.noname]: { name: '', role: 'caregiver', at: 1 } },
      app: { babies: [] } });
    await db.doc('invites/' + HM.real).set({ householdId: HID_HME, role: 'caregiver', invitedBy: 'uidOwnerMia', name: ' hana ' });
    await db.doc('invites/' + HM.lee).set({ householdId: HID_HME, role: 'caregiver', invitedBy: 'uidOwnerMia', name: 'Hana Lee' });
    await db.doc('invites/' + HM.noname).set({ householdId: HID_HME, role: 'caregiver', invitedBy: 'uidOwnerMia' });
  });
  const hanaBack = () => rejoin('uidHanaReal', HM.real, HID_HME, 'caregiver', 'Hana');
  await hmeSeed();
  await check('(the hole) with her real address Hana writes herself back in', assertSucceeds(hanaBack()));
  await hmeSeed();
  const hDry = runTool([]);
  ok('the dry run counts her invite on its own line: 1, not the other Hana\'s, not the nameless one',
    count(hDry.out, 'under the name of someone removed') === 1, hDry.out);
  ok('and prints no address, uid or household id', leaks(hDry.out).length === 0 && !hDry.out.includes(HID_HME) && !hDry.out.includes('hana'), hDry.out);
  const hApply = runTool(['--apply']);
  ok('--apply deletes her invite', hApply.code === 0 && !(await readAdmin('invites/' + HM.real)).exists, hApply.out);
  ok('and its row', !(HM.real in ((await readAdmin('households/' + HID_HME)).data().pendingInvites || {})));
  await check('after which she cannot write herself back in', assertFails(hanaBack()));
  /* The name match must decide on its own, not only ride along with "a family someone has left"
     (which happens to delete every not-joined invite here as well). So run the tool with that clause
     cut out: her invite must still go, and the other two must stay. */
  const SRC = fs.readFileSync(TOOL, 'utf8');
  const CLAUSE = ' || size(d.formerMemberInfo) > 0)';
  const mutant = SRC.split(CLAUSE).join(')');
  ok('(the mutant really drops the "someone has left" clause)', SRC.includes(CLAUSE) && !mutant.includes(CLAUSE));
  const mutantFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-cleanup-mutant-')), 'invite_cleanup.js');
  fs.writeFileSync(mutantFile, mutant);
  const runMutant = () => {
    const env2 = Object.assign({}, process.env, { NODE_PATH: path.join(ROOT, 'tools', 'node_modules') });
    delete env2.GOOGLE_APPLICATION_CREDENTIALS;
    const r = spawnSync('node', [mutantFile, '--apply'], { env: env2, encoding: 'utf8' });
    return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
  };
  await hmeSeed();
  const m1 = runMutant();
  ok('with only the name match, her invite is still deleted', m1.code === 0 && !(await readAdmin('invites/' + HM.real)).exists, m1.out);
  ok('the other Hana\'s invite is kept (a whole name, not a first name)', (await readAdmin('invites/' + HM.lee)).exists);
  ok('and so is the invite with no name (an empty name matches nobody, nor a tombstone with none)', (await readAdmin('invites/' + HM.noname)).exists);
  try { fs.rmSync(path.dirname(mutantFile), { recursive: true, force: true }); } catch (e) {}

  await env.cleanup();

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'INVITE-CLEANUP: FAIL' : 'INVITE-CLEANUP: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
