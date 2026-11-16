#!/usr/bin/env node
/* Every role, every collection, against the REAL firestore.rules on the emulator, judged by a model of
 * what the rules are FOR. Each disagreement is printed with the exact request.
 *
 *   node tools/fuzz_rules.js [--seed=N] [--seconds=300] [--out=DIR] [--rules=FILE]
 *   node tools/fuzz_rules.js --seed=N --op=K        replay op K of seed N alone (a fresh household)
 *   node tools/fuzz_rules.js --self-test            four planted rule bugs must each be caught by a sweep,
 *                                                   then one sweep of the real rules must agree with the model
 *
 * Self-hosting: it starts its own Firestore emulator (FS_PORT, HUB_PORT, LOG_PORT, WS_PORT, which
 * tools/gates.js hands it free) and loads each rules file into its own demo project, so the real rules
 * and the mutants share one emulator and never see each other's data.
 *
 * THE MODEL (ALLOW below) is written from the rules' intent, the way test/rules-test.js and
 * test/household-guard.test.js state it, not transcribed from the rules: who may read a household
 * (its members), who may write what (a caregiver: the app blob, updatedAt and her own circle entry; an
 * owner: everything but pro, maternal keys in the blob and an unsafe deletion), who joins (an invitee
 * with a proven address, in one batch that spends the invite; a link holder, in one batch that claims and
 * consumes the link), what is never shared (mood), and what no client touches (newsletter, ops, codes,
 * ledgers, config writes, a household delete, any list of inviteLinks or config).
 *
 * Roles: O owner, O2 co-owner, C caregiver, R removed member, I invitee by email (proven), U the same
 * kind of invitee with an UNPROVEN address, S a signed-in stranger holding a live link, A anonymous.
 * Every op runs against a freshly seeded household of its own, so one op's write cannot change the
 * next op's answer, and op K of a seed can be replayed alone.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ARGS = process.argv.slice(2);
const arg = (k, d) => { const a = ARGS.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const SELF = ARGS.includes('--self-test');
const SEED = Number(arg('seed', SELF ? 777 : Date.now() % 1e9));
const SECONDS = Number(arg('seconds', SELF ? 0 : 300));
const OUT = arg('out', os.tmpdir());
const ONLY_OP = arg('op', null);
const RULES_FILE = arg('rules', path.join(ROOT, 'firestore.rules'));
const FS_PORT = Number(process.env.FS_PORT) || 8747;
const HUB_PORT = Number(process.env.HUB_PORT) || 0, LOG_PORT = Number(process.env.LOG_PORT) || 0, WS_PORT = Number(process.env.WS_PORT) || 0;

/* ---------- outer phase: one emulator, then re-run ourselves inside it ---------- */
if (!process.env.FUZZ_RULES_INNER) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-fuzz-rules-'));
  fs.writeFileSync(path.join(scratch, 'firestore.rules'), fs.readFileSync(RULES_FILE, 'utf8'));
  // No singleProjectMode: the real rules and each mutant live in their own demo project.
  fs.writeFileSync(path.join(scratch, 'firebase.json'), JSON.stringify({
    firestore: { rules: 'firestore.rules' },
    emulators: Object.assign({ firestore: Object.assign({ port: FS_PORT }, WS_PORT ? { websocketPort: WS_PORT } : {}), ui: { enabled: false } },
      HUB_PORT ? { hub: { port: HUB_PORT } } : {}, LOG_PORT ? { logging: { port: LOG_PORT } } : {}),
  }));
  const firebaseBin = path.join(ROOT, 'test', 'node_modules', '.bin', 'firebase');
  const javaBin = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin') : '/opt/homebrew/opt/openjdk/bin';
  const env = Object.assign({}, process.env, { FUZZ_RULES_INNER: '1', PATH: javaBin + ':' + process.env.PATH });
  try {
    execFileSync(firebaseBin, ['emulators:exec', '--only', 'firestore', '--project', 'demo-fz', '--config', path.join(scratch, 'firebase.json'),
      'node ' + JSON.stringify(__filename) + ' ' + ARGS.map((a) => JSON.stringify(a)).join(' ')], { cwd: scratch, env, stdio: 'inherit' });
  } catch (e) { process.exitCode = e.status || 1; }
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) {}
  return;
}

/* ---------- inner phase ---------- */
const { initializeTestEnvironment } = require(path.join(ROOT, 'test', 'node_modules', '@firebase', 'rules-unit-testing'));
const firebase = require(path.join(ROOT, 'test', 'node_modules', 'firebase', 'compat', 'app')).default;
require(path.join(ROOT, 'test', 'node_modules', 'firebase', 'compat', 'firestore'));
const FV = firebase.firestore.FieldValue, FP = firebase.firestore.FieldPath, TS = firebase.firestore.Timestamp;
const DAY = 86400000;

function rng(seed) {
  let a = seed >>> 0;
  const r = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.int = (n) => Math.floor(r() * n); r.pick = (xs) => xs[r.int(xs.length)];
  return r;
}

const ACTORS = {
  O: { uid: 'O', email: 'o@x.test', verified: true }, O2: { uid: 'O2', email: 'o2@x.test', verified: true },
  C: { uid: 'C', email: 'c@x.test', verified: true }, R: { uid: 'R', email: 'r@x.test', verified: true },
  I: { uid: 'I', email: 'i@x.test', verified: true }, U: { uid: 'U', email: 'u@x.test', verified: false },
  S: { uid: 'S', email: 's@x.test', verified: true }, A: null,
};
const NAMES = Object.keys(ACTORS);
const SIGNED = NAMES.filter((n) => n !== 'A');
const MEMBERS = ['O', 'O2', 'C'], OWNERS = ['O', 'O2'];
const cleanApp = () => ({ babies: [{ id: 'b1', name: 'Pip' }], settings: {}, milestones: [], meds: [], vaccines: {}, illnesses: [], photos: [], timers: {} });

/* The household every op starts from. k = op number, so every op has its own ids. */
function world(k) {
  const H = 'H' + k, now = Date.now();
  const tok = { live: 'tokLive' + k, used: 'tokUsed' + k, exp: 'tokExp' + k };
  const docs = {};
  docs['households/' + H] = {
    ownerId: 'O', members: { O: 'owner', O2: 'owner', C: 'caregiver' },
    memberInfo: { O: { name: 'Olive', role: 'owner' }, O2: { name: 'Otto', role: 'owner' }, C: { name: 'Cara', role: 'caregiver' } },
    formerMemberInfo: { R: { name: 'Rae' } },
    pendingInvites: { 'i@x.test': { role: 'caregiver', at: 1 }, 'u@x.test': { role: 'caregiver', at: 1 } },
    pendingLinks: { [tok.live]: { at: 1 } }, app: cleanApp(), updatedAt: 1,
  };
  const P = 'households/' + H + '/';
  docs[P + 'events/e1'] = { authorId: 'O', type: 'feed', time: 1 };
  docs[P + 'events/e2'] = { authorId: 'C', type: 'sleep', time: 2 };
  docs[P + 'photos/p1'] = { authorId: 'C', at: 1 };
  docs[P + 'notes/nCircle'] = { createdBy: 'O', audience: 'circle', text: 'hi' };
  docs[P + 'notes/nToC'] = { createdBy: 'O', audience: 'C', text: 'for you' };
  docs[P + 'notes/nPriv'] = { createdBy: 'O', audience: 'O', text: 'mine' };
  docs[P + 'memberEmails/O'] = { email: 'o@x.test' };
  docs[P + 'memberEmails/C'] = { email: 'c@x.test' };
  docs[P + 'memberEmails/R'] = { email: 'r@x.test' };
  docs[P + 'mhealth/O/cat/weight'] = { ownerUid: 'O', sharedWith: ['C'], entries: [] };
  docs[P + 'mhealth/O/cat/mood'] = { ownerUid: 'O', sharedWith: ['C'], entries: [] };   // hostile: mood must not open even so
  docs[P + 'pregnancy/O'] = { ownerUid: 'O', sharedWith: ['O2'], data: { precon: { folic: false }, dueDate: 1 }, updatedAt: 1 };
  docs[P + 'pregnancy/O/photos/ph1'] = { at: 1 };
  docs['invites/i@x.test'] = { householdId: H, role: 'caregiver', invitedBy: 'O' };
  docs['invites/u@x.test'] = { householdId: H, role: 'caregiver', invitedBy: 'O' };
  docs['inviteLinks/' + tok.live] = { householdId: H, role: 'caregiver', usedBy: null, expiresAt: TS.fromMillis(now + DAY), invitedBy: 'O' };
  docs['inviteLinks/' + tok.used] = { householdId: H, role: 'caregiver', usedBy: 'Z', consumed: true, expiresAt: TS.fromMillis(now + DAY) };
  docs['inviteLinks/' + tok.exp] = { householdId: H, role: 'caregiver', usedBy: null, expiresAt: TS.fromMillis(now - 1000) };
  docs['config/app'] = { v: 1 };
  docs['feedback/f1'] = { text: 'x' };
  for (const n of SIGNED) { docs['users/' + n] = { householdId: H }; docs['waitlist/' + n] = { email: ACTORS[n].email }; }
  return { H, P, tok, docs, now };
}

/* ---------- THE MODEL: op templates, each with who it is FOR ---------- */
const self = (a) => a;   // the actor's own id, in templates that write "your own" thing
const memberInfoOf = (a, role) => ({ name: 'New ' + a, role });
const T = [];
const t = (id, allow, run) => T.push({ id, allow, run });
/* reads */
t('read household', MEMBERS, (db, w) => db.doc('households/' + w.H).get());
t('read an event', MEMBERS, (db, w) => db.doc(w.P + 'events/e1').get());
t('list events', MEMBERS, (db, w) => db.collection(w.P + 'events').get());
t('read a circle note', MEMBERS, (db, w) => db.doc(w.P + 'notes/nCircle').get());
t('read a note addressed to the caregiver', ['O', 'C'], (db, w) => db.doc(w.P + 'notes/nToC').get());
t('read the owner\'s private note', ['O'], (db, w) => db.doc(w.P + 'notes/nPriv').get());
t('read the owner\'s address', OWNERS, (db, w) => db.doc(w.P + 'memberEmails/O').get());
t('read the caregiver\'s address', ['C', 'O', 'O2'], (db, w) => db.doc(w.P + 'memberEmails/C').get());
t('read shared maternal weight', ['O', 'C'], (db, w) => db.doc(w.P + 'mhealth/O/cat/weight').get());
t('read mood, even with a sharedWith list planted', ['O'], (db, w) => db.doc(w.P + 'mhealth/O/cat/mood').get());
t('read the pregnancy journey', ['O', 'O2'], (db, w) => db.doc(w.P + 'pregnancy/O').get());
t('read a pregnancy photo', ['O', 'O2'], (db, w) => db.doc(w.P + 'pregnancy/O/photos/ph1').get());
t('read the email invite addressed to I', ['I'], (db, w) => db.doc('invites/i@x.test').get());
t('read the invite for an unproven address', [], (db, w) => db.doc('invites/u@x.test').get());
t('get an invite link by its token', SIGNED, (db, w) => db.doc('inviteLinks/' + w.tok.live).get());
t('LIST invite links', [], (db, w) => db.collection('inviteLinks').limit(5).get());
t('read your own users doc', SIGNED, (db, w, a) => db.doc('users/' + (a || 'A')).get());
t('read the owner\'s users doc', ['O'], (db, w) => db.doc('users/O').get());
t('get remote config', SIGNED, (db, w) => db.doc('config/app').get());
t('LIST config', [], (db, w) => db.collection('config').get());
for (const c of ['newsletter', 'ops', 'pageStats', 'signinCodes', 'pushLedger', 'campaigns']) t('read ' + c, [], (db) => db.doc(c + '/O').get());
t('read feedback', [], (db) => db.doc('feedback/f1').get());
t('read your own waitlist row', SIGNED, (db, w, a) => db.doc('waitlist/' + (a || 'A')).get());
/* Reads and LISTS the first model never made (Nov 2026). A planted hole that let any signed-in account read
   every family's baby photos passed as AGREE over 3232 ops, because no template read or listed
   households/{hid}/photos. Every collection now has its get AND its list asked of every role; a list is its
   own question, because a rule that reads well for one document can still open the whole collection. */
t('read a household photo', MEMBERS, (db, w) => db.doc(w.P + 'photos/p1').get());
t('LIST household photos', MEMBERS, (db, w) => db.collection(w.P + 'photos').get());
t('LIST circle notes (audience == circle)', MEMBERS, (db, w) => db.collection(w.P + 'notes').where('audience', '==', 'circle').get());
t('LIST the notes addressed to you', MEMBERS, (db, w, a) => db.collection(w.P + 'notes').where('audience', '==', a || 'A').get());
t('LIST the notes you wrote', MEMBERS, (db, w, a) => db.collection(w.P + 'notes').where('createdBy', '==', a || 'A').get());
t('LIST every note, unfiltered', [], (db, w) => db.collection(w.P + 'notes').get());
t('LIST every member\'s address', OWNERS, (db, w) => db.collection(w.P + 'memberEmails').get());
t('LIST the owner\'s maternal categories', ['O'], (db, w) => db.collection(w.P + 'mhealth/O/cat').get());
t('LIST every pregnancy journey, unfiltered', [], (db, w) => db.collection(w.P + 'pregnancy').get());
t('LIST the owner\'s pregnancy photos', ['O', 'O2'], (db, w) => db.collection(w.P + 'pregnancy/O/photos').get());
t('LIST households', [], (db) => db.collection('households').limit(5).get());
t('LIST invites', [], (db) => db.collection('invites').limit(5).get());
t('LIST users', [], (db) => db.collection('users').limit(5).get());
t('LIST the waitlist', [], (db) => db.collection('waitlist').limit(5).get());
t('LIST feedback', [], (db) => db.collection('feedback').limit(5).get());
for (const c of ['newsletter', 'ops', 'pageStats', 'signinCodes', 'pushLedger', 'campaigns']) t('LIST ' + c, [], (db) => db.collection(c).limit(5).get());
/* No rule matches a collection-group query, so each must be refused to everyone: one would read every
   family's photos, entries or addresses at once. */
for (const g of ['photos', 'events', 'notes', 'memberEmails', 'cat']) t('collection-group query of every family\'s ' + g, [], (db) => db.collectionGroup(g).limit(5).get());
/* subcollection writes */
t('log an event as yourself', MEMBERS, (db, w, a) => db.doc(w.P + 'events/new').set({ authorId: a || null, type: 'feed', time: 3 }));
t('log an event signed as the owner', ['O'], (db, w) => db.doc(w.P + 'events/new').set({ authorId: 'O', type: 'feed', time: 3 }));
t('edit the owner\'s event', OWNERS, (db, w) => db.doc(w.P + 'events/e1').update({ note: 'x' }));
t('edit the caregiver\'s event', MEMBERS, (db, w) => db.doc(w.P + 'events/e2').update({ note: 'x' }));
t('re-sign the caregiver\'s event as yourself', ['C'], (db, w, a) => db.doc(w.P + 'events/e2').update({ authorId: a || null }));
t('delete the owner\'s event', OWNERS, (db, w) => db.doc(w.P + 'events/e1').delete());
t('delete the caregiver\'s event', MEMBERS, (db, w) => db.doc(w.P + 'events/e2').delete());
t('add a photo as yourself', MEMBERS, (db, w, a) => db.doc(w.P + 'photos/new').set({ authorId: a || null, at: 2 }));
t('edit the caregiver\'s photo', MEMBERS, (db, w) => db.doc(w.P + 'photos/p1').update({ caption: 'x' }));
t('delete the caregiver\'s photo', MEMBERS, (db, w) => db.doc(w.P + 'photos/p1').delete());
t('leave a circle note as yourself', MEMBERS, (db, w, a) => db.doc(w.P + 'notes/new').set({ createdBy: a || null, audience: 'circle', text: 'x' }));
t('edit the owner\'s circle note', ['O'], (db, w) => db.doc(w.P + 'notes/nCircle').update({ text: 'edited' }));
t('re-address the owner\'s circle note', [], (db, w) => db.doc(w.P + 'notes/nCircle').update({ audience: 'O' }));
t('delete the owner\'s circle note', ['O'], (db, w) => db.doc(w.P + 'notes/nCircle').delete());
t('record your own proven address', MEMBERS, (db, w, a) => db.doc(w.P + 'memberEmails/' + (a || 'A')).set({ email: a ? ACTORS[a].email : 'x' }));
t('overwrite the caregiver\'s address', OWNERS, (db, w) => db.doc(w.P + 'memberEmails/C').set({ email: 'evil@x.test' }));
t('delete the caregiver\'s address', ['C', 'O', 'O2'], (db, w) => db.doc(w.P + 'memberEmails/C').delete());
t('delete the removed member\'s own leftover address', ['R', 'O', 'O2'], (db, w) => db.doc(w.P + 'memberEmails/R').delete());
t('write your own maternal weight', MEMBERS, (db, w, a) => db.doc(w.P + 'mhealth/' + (a || 'A') + '/cat/weight').set({ ownerUid: a || null, sharedWith: [], entries: [] }));
t('write the owner\'s maternal weight', ['O'], (db, w) => db.doc(w.P + 'mhealth/O/cat/weight').set({ ownerUid: 'O', sharedWith: [], entries: [] }));
t('share your mood', [], (db, w, a) => db.doc(w.P + 'mhealth/' + (a || 'A') + '/cat/mood').set({ ownerUid: a || null, sharedWith: ['O'], entries: [] }));
t('tick the shared preparation checklist', ['O', 'O2'], (db, w) => db.doc(w.P + 'pregnancy/O').update({ 'data.precon.folic': true, updatedAt: 2 }));
t('move the due date', ['O'], (db, w) => db.doc(w.P + 'pregnancy/O').update({ 'data.dueDate': 2 }));
t('widen who the journey is shared with', ['O'], (db, w, a) => db.doc(w.P + 'pregnancy/O').update({ sharedWith: ['O2', 'C', a || 'A'] }));
t('delete the pregnancy journey', ['O'], (db, w) => db.doc(w.P + 'pregnancy/O').delete());
t('add a pregnancy photo', ['O'], (db, w) => db.doc(w.P + 'pregnancy/O/photos/new').set({ at: 2 }));
/* the household document */
t('save the app blob', MEMBERS, (db, w) => db.doc('households/' + w.H).update({ 'app.settings.x': 1, updatedAt: 2 }));
t('put pregnancy into the shared blob', [], (db, w) => db.doc('households/' + w.H).update({ 'app.pregnancy': { dueDate: 1 } }));
t('turn on Pro from the client', [], (db, w) => db.doc('households/' + w.H).update({ pro: { active: true } }));
t('rename yourself in the circle', MEMBERS, (db, w, a) => db.doc('households/' + w.H).update({ ['memberInfo.' + (a || 'A') + '.name']: 'Renamed' }));
t('rename the owner in the circle', OWNERS, (db, w) => db.doc('households/' + w.H).update({ 'memberInfo.O.name': 'Hacked' }));
t('make yourself an owner', OWNERS, (db, w, a) => db.doc('households/' + w.H).update({ ['members.' + (a || 'A')]: 'owner' }));
t('remove the caregiver', OWNERS, (db, w) => db.doc('households/' + w.H).update({ 'members.C': FV.delete(), 'memberInfo.C': FV.delete() }));
t('leave the circle properly', MEMBERS, (db, w, a) => db.doc('households/' + w.H).update({ ['members.' + (a || 'A')]: FV.delete(), ['memberInfo.' + (a || 'A')]: FV.delete(), ['formerMemberInfo.' + (a || 'A')]: { name: 'Left' } }));
t('schedule deletion with people still in it', [], (db, w, a) => db.doc('households/' + w.H).update({ deleteAfter: w.now + 30 * DAY, deletionRequestedBy: a || null }));
t('close the family as the last one out', OWNERS, (db, w, a) => db.doc('households/' + w.H).update({ members: {}, memberInfo: {}, deleteAfter: w.now + 30 * DAY, deletionRequestedBy: a || null }));
t('close the family for tomorrow\'s purge', [], (db, w, a) => db.doc('households/' + w.H).update({ members: {}, memberInfo: {}, deleteAfter: w.now + DAY, deletionRequestedBy: a || null }));
t('clear the pending invites list', OWNERS, (db, w) => db.doc('households/' + w.H).update({ pendingInvites: {} }));
t('delete the household', [], (db, w) => db.doc('households/' + w.H).delete());
t('create a household of your own', SIGNED, (db, w, a) => db.doc('households/N' + w.H).set({ ownerId: a || null, members: { [a || 'A']: 'owner' }, memberInfo: { [a || 'A']: memberInfoOf(a, 'owner') }, app: cleanApp() }));
t('create a household with Pro already on', [], (db, w, a) => db.doc('households/N' + w.H).set({ ownerId: a || null, members: { [a || 'A']: 'owner' }, pro: { active: true }, app: cleanApp() }));
t('create a household naming someone else owner', ['O'], (db, w) => db.doc('households/N' + w.H).set({ ownerId: 'O', members: { O: 'owner' }, app: cleanApp() }));
/* joining */
const emailJoin = (db, w, a, opts) => {
  const me = a ? ACTORS[a] : { uid: 'A', email: 'a@x.test' };
  const upd = { ['members.' + me.uid]: (opts && opts.role) || 'caregiver', ['memberInfo.' + me.uid]: memberInfoOf(a, (opts && opts.role) || 'caregiver') };
  const b = db.batch();
  b.update(db.doc('households/' + w.H), new FP('pendingInvites', me.email), FV.delete(), ...Object.entries(upd).flat());
  if (!(opts && opts.keepInvite)) b.delete(db.doc('invites/' + me.email));
  return b.commit();
};
/* For someone already in the family the same batch is only a write to her own circle entry (and an owner's
   household write is an owner's business), and deleting an invite addressed to your own proven address is
   always yours to do. So the question these lines ask is about the people outside: only I may come in,
   only by spending the invite, and only in the role it names. */
t('join by email invite, spending it', ['I', 'C', 'O', 'O2'], (db, w, a) => emailJoin(db, w, a));
t('join by email invite, keeping it', MEMBERS, (db, w, a) => emailJoin(db, w, a, { keepInvite: true }));
t('join by email invite as an owner', OWNERS, (db, w, a) => emailJoin(db, w, a, { role: 'owner' }));
const linkJoin = (db, w, a, which, opts) => {
  const uid = a || 'A', token = w.tok[which];
  const b = db.batch();
  b.update(db.doc('inviteLinks/' + token), { usedBy: uid, consumed: true });
  if (!(opts && opts.claimOnly)) {
    const role = (opts && opts.role) || 'caregiver';
    b.update(db.doc('households/' + w.H), { joinToken: token, ['members.' + uid]: role, ['memberInfo.' + uid]: memberInfoOf(a, role), ['pendingLinks.' + token]: FV.delete() });
  }
  return b.commit();
};
/* A live link is a live link: whoever holds it and is not in the family may join, the removed member
   included (removing someone cancels the links she could have seen; that is the client's job and
   test/circle-manage.test.js's). */
/* An owner may edit her own family's links and her own household, so every link batch below is an owner's
   write for O and O2; the question each line asks is about everyone else. */
t('join by a live link', ['R', 'I', 'U', 'S', 'O', 'O2'], (db, w, a) => linkJoin(db, w, a, 'live'));
t('claim a live link without joining', OWNERS, (db, w, a) => linkJoin(db, w, a, 'live', { claimOnly: true }));
t('join by a spent link', OWNERS, (db, w, a) => linkJoin(db, w, a, 'used'));
t('join by an expired link', OWNERS, (db, w, a) => linkJoin(db, w, a, 'exp'));
t('join by a link as an owner', OWNERS, (db, w, a) => linkJoin(db, w, a, 'live', { role: 'owner' }));
/* invites and links */
t('invite someone by email', OWNERS, (db, w) => db.doc('invites/new' + w.H.toLowerCase() + '@x.test').set({ householdId: w.H, role: 'caregiver', invitedBy: 'O' }));
t('invite someone as an admin', [], (db, w) => db.doc('invites/new' + w.H.toLowerCase() + '@x.test').set({ householdId: w.H, role: 'admin' }));
t('invite, signed with your own proven address', OWNERS, (db, w, a) => db.doc('invites/new' + w.H.toLowerCase() + '@x.test').set({ householdId: w.H, role: 'caregiver', fromEmail: a ? ACTORS[a].email : 'x', invitedByName: 'Me' }));
t('invite, signed with somebody else\'s address', [], (db, w) => db.doc('invites/new' + w.H.toLowerCase() + '@x.test').set({ householdId: w.H, role: 'caregiver', fromEmail: 'midwife@x.test', invitedByName: 'Your midwife' }));
t('withdraw I\'s invite', ['I', 'O', 'O2'], (db) => db.doc('invites/i@x.test').delete());
t('withdraw the unproven address\'s invite', OWNERS, (db) => db.doc('invites/u@x.test').delete());
t('re-point I\'s invite at another family', [], (db) => db.doc('invites/i@x.test').update({ householdId: 'Elsewhere' }));
t('mint an invite link', OWNERS, (db, w) => db.doc('inviteLinks/new' + w.H).set({ householdId: w.H, role: 'caregiver', usedBy: null, expiresAt: TS.fromMillis(w.now + DAY) }));
t('mint an owner link', [], (db, w) => db.doc('inviteLinks/new' + w.H).set({ householdId: w.H, role: 'owner', usedBy: null, expiresAt: TS.fromMillis(w.now + DAY) }));
t('cancel the live link', OWNERS, (db, w) => db.doc('inviteLinks/' + w.tok.live).delete());
t('extend the live link', OWNERS, (db, w) => db.doc('inviteLinks/' + w.tok.live).update({ expiresAt: TS.fromMillis(w.now + 2 * DAY) }));
/* everything else */
for (const c of ['newsletter', 'ops', 'pageStats', 'signinCodes', 'pushLedger', 'campaigns', 'config']) t('write ' + c, [], (db, w, a) => db.doc(c + '/' + (a || 'A')).set({ x: 1 }));
t('send feedback in your own name', SIGNED, (db, w, a) => db.collection('feedback').add({ text: 'hi', uid: a ? ACTORS[a].uid : 'A' }));
t('send feedback in someone else\'s name', [], (db, w, a) => db.collection('feedback').add({ text: 'hi', uid: a === 'O' ? 'C' : 'O' }));
t('write your own users doc', SIGNED, (db, w, a) => db.doc('users/' + (a || 'A')).set({ householdId: w.H }));
t('write the owner\'s users doc', ['O'], (db, w) => db.doc('users/O').set({ householdId: 'Elsewhere' }));
t('join the Pro waitlist', SIGNED, (db, w, a) => db.doc('waitlist/' + (a || 'A')).set({ email: 'x' }));

/* ---------- running ops ---------- */
function opsFor(seed, sweep) {
  // A sweep is every (template, actor) pair once, in a seeded order: what the self-test and the start of
  // every run do, so a short box still covers everything. After it, pairs are drawn at random.
  const r = rng(seed);
  const pairs = [];
  for (let i = 0; i < T.length; i++) for (const a of NAMES) pairs.push([i, a]);
  for (let i = pairs.length - 1; i > 0; i--) { const j = r.int(i + 1); [pairs[i], pairs[j]] = [pairs[j], pairs[i]]; }
  return { next: (k) => (k < pairs.length ? pairs[k] : [r.int(T.length), r.pick(NAMES)]), sweepLen: pairs.length, sweep };
}

async function makeEnv(projectId, rules) {
  const env = await initializeTestEnvironment({ projectId, firestore: { rules } });
  env.__fz = { projectId, rules };
  return env;
}
/* Even with each op's app deleted, the client SDK keeps some state per app it has ever seen: a 330 s box
   reached 2.4 GB resident. So every RECYCLE ops the whole test environment is torn down and rebuilt
   (same project, same rules, same emulator), which frees all of it and bounds a long nightly box. */
const RECYCLE = 1500;
async function recycled(env) {
  const { projectId, rules } = env.__fz;
  await env.cleanup();
  return makeEnv(projectId, rules);
}
async function runOp(env, k, ti, actor) {
  const w = world(k);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const b = db.batch();
    for (const [p, d] of Object.entries(w.docs)) b.set(db.doc(p), d);
    await b.commit();
  });
  const a = ACTORS[actor];
  /* A fresh client per op, so no op inherits another's cache or pending writes, and DELETED after it:
     every context the library hands out keeps its own Firebase app alive until env.cleanup(), and a
     5-minute box ran a 4 GB heap out of memory at 194 s that way (2026-11-13). */
  const ctx = a ? env.authenticatedContext(a.uid, { email: a.email, email_verified: a.verified }) : env.unauthenticatedContext();
  const db = ctx.firestore();
  let got, code = null;
  try { await T[ti].run(db, w, a ? actor : null); got = true; }
  catch (e) { code = (e && e.code) || String(e).slice(0, 80); got = false; }
  finally {
    const app = ctx.app; ctx.destroyed = true; ctx.app = undefined;
    if (env.contexts && env.contexts.delete) env.contexts.delete(ctx);
    if (app) await app.delete().catch(() => {});
  }
  const want = T[ti].allow.includes(actor);
  return { k, op: T[ti].id, actor, want, got, code: code && code !== 'permission-denied' ? code : null };
}

async function campaign(box, seed, seconds, label, minOps) {   // box.env is replaced as it recycles
  const plan = opsFor(seed);
  const t0 = Date.now();
  const dis = new Map();
  let n = 0, errs = 0;
  while (n < minOps || Date.now() - t0 < seconds * 1000) {
    const [ti, actor] = plan.next(n);
    if (n && n % RECYCLE === 0) box.env = await recycled(box.env);
    const v = await runOp(box.env, n, ti, actor);
    if (v.code) errs++;
    if (v.want !== v.got) {
      const key = v.op + '|' + actor;
      if (!dis.has(key)) dis.set(key, Object.assign({ count: 0 }, v));
      dis.get(key).count++;
    }
    n++;
  }
  return { label, seed, ops: n, sweep: plan.sweepLen, errors: errs, disagreements: [...dis.values()] };
}

/* Planted rule bugs. Each replacement must match exactly once, so a moved rule says so. */
function plants(src) {
  const out = [];
  const one = (name, re, to, expect) => {
    const m = src.match(re);
    if (!m || src.split(m[0]).length !== 2) { out.push({ name, error: 'plant site not found once (firestore.rules moved: update plants())' }); return; }
    out.push({ name, rules: src.replace(re, to), expect });
  };
  one('any member may delete anyone\'s event',
    /(match \/events\/\{eventId\} \{[\s\S]*?)allow delete: if request\.auth != null && request\.auth\.uid in pm\(\)\s*&& \( pm\(\)\[request\.auth\.uid\] == 'owner' \|\| resource\.data\.authorId == request\.auth\.uid \);/,
    "$1allow delete: if request.auth != null && request.auth.uid in pm();", /delete the owner's event/);
  one('invite links can be listed',
    /(allow get: if request\.auth != null;\s*)allow list: if false;(\s*\/\/ Only the household's own owner mints one)/,
    '$1allow list: if request.auth != null;$2', /LIST invite links/);
  one('any signed-in account may read a family\'s photos',
    /(match \/photos\/\{photoId\} \{\s*)allow read: if request\.auth != null && request\.auth\.uid in pm\(\);/,
    '$1allow read: if request.auth != null;', /household photo/);
  one('a caregiver may change members',
    /changedKeys\(\)\.hasOnly\(\['app', 'updatedAt', 'memberInfo'\]\)/,
    "changedKeys().hasOnly(['app', 'updatedAt', 'memberInfo', 'members'])", /make yourself an owner|remove the caregiver|leave the circle/);
  return out;
}

function writeReport(results, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const real = results.find((r) => r.label === 'firestore.rules');
  const base = path.join(outDir, 'fuzz-rules-' + (real ? real.seed : SEED));
  (real ? real.disagreements : []).forEach((d) => {
    d.id = 'FR-' + crypto.createHash('sha1').update(d.op + '|' + d.actor).digest('hex').slice(0, 6);
    d.repro = 'node tools/fuzz_rules.js --seed=' + real.seed + ' --op=' + d.k;
  });
  fs.writeFileSync(base + '.json', JSON.stringify(results, null, 1));
  const md = ['# Rules fuzz' + (real ? ', seed ' + real.seed : ''), ''];
  for (const r of results) {
    md.push('## ' + r.label + ': ' + r.ops + ' ops (a full sweep is ' + r.sweep + '), ' + r.disagreements.length + ' disagreement(s)', '');
    if (r.disagreements.length) md.push('| id | op | role | model | emulator | repro |', '|---|---|---|---|---|---|', ...r.disagreements.map((d) =>
      '| ' + (d.id || '-') + ' | ' + d.op + ' | ' + d.actor + ' | ' + (d.want ? 'allow' : 'deny') + ' | ' + (d.got ? 'allowed' : 'denied') + (d.code ? ' (' + d.code + ')' : '') + ' | ' + (d.repro ? '`' + d.repro + '`' : '') + ' |'), '');
  }
  fs.writeFileSync(base + '.md', md.join('\n'));
  return base;
}

(async () => {
  const realRules = fs.readFileSync(RULES_FILE, 'utf8');
  const quiet = console.warn; console.warn = () => {};
  if (ONLY_OP !== null) {
    const env = await makeEnv('demo-fz-replay', realRules);
    const plan = opsFor(SEED);
    const [ti, actor] = plan.next(Number(ONLY_OP));
    const v = await runOp(env, Number(ONLY_OP), ti, actor);
    console.log(JSON.stringify(Object.assign({ request: T[ti].run.toString() }, v), null, 1));
    console.log(v.want === v.got ? 'AGREES' : 'DISAGREES: the model says ' + (v.want ? 'allow' : 'deny') + ', the emulator ' + (v.got ? 'allowed' : 'denied'));
    process.exit(v.want === v.got ? 0 : 1);
  }
  let failed = 0;
  const results = [];
  console.log('\nfuzz_rules: ' + T.length + ' op templates x ' + NAMES.length + ' roles; emulator ' + process.env.FIRESTORE_EMULATOR_HOST);
  if (SELF) {
    console.log('\nself-test: four planted rule bugs, one sweep each, must each disagree with the model');
    let i = 0;
    for (const p of plants(realRules)) {
      if (p.error) { console.log('  FAIL ' + p.name + ': ' + p.error); failed++; continue; }
      const box = { env: await makeEnv('demo-fz-mut' + (++i), p.rules) };
      const r = await campaign(box, SEED, 0, 'mutant: ' + p.name, opsFor(SEED).sweepLen);
      results.push(r);
      const hit = r.disagreements.filter((d) => p.expect.test(d.op));
      if (hit.length) console.log('  ok   planted "' + p.name + '" is caught: ' + hit.map((d) => d.op + ' as ' + d.actor + ' (' + (d.got ? 'allowed' : 'denied') + ')').slice(0, 3).join('; '));
      else { console.log('  FAIL planted "' + p.name + '" was NOT caught in ' + r.ops + ' ops'); failed++; }
      await box.env.cleanup();
    }
  }
  const box = { env: await makeEnv('demo-fz-real', realRules) };
  const r = await campaign(box, SEED, SECONDS, 'firestore.rules', opsFor(SEED).sweepLen);
  results.push(r);
  const base = writeReport(results, OUT);
  console.log('\nthe real rules: ' + r.ops + ' ops in ' + (SECONDS || 'one sweep, ') + (SECONDS ? ' s' : '') + ' seed ' + r.seed + ', ' + r.errors + ' non-permission errors');
  for (const d of r.disagreements) console.log('  DISAGREE ' + d.id + ' ' + d.op + ' as ' + d.actor + ': model ' + (d.want ? 'allow' : 'deny') + ', emulator ' + (d.got ? 'allowed' : 'denied') + (d.code ? ' (' + d.code + ')' : '') + ' x' + d.count + '\n           repro: ' + d.repro);
  if (!r.disagreements.length) console.log('  model and rules agree on every op');
  console.log('  report: ' + base + '.md');
  console.warn = quiet;
  await box.env.cleanup();
  if (SELF) {
    /* The real rules must agree with the model on a full sweep: a disagreement is either a rules bug or a
       model that no longer states the intent. Either way it blocks, and the report says which op. */
    if (r.disagreements.length) { console.log('  FAIL the real rules disagree with the model on ' + r.disagreements.length + ' (op, role) pair(s)'); failed++; }
    console.log('\nFUZZ-RULES SELF-TEST: ' + (failed ? 'FAIL' : 'PASS'));
    process.exit(failed ? 1 : 0);
  }
  console.log('\nFUZZ-RULES: ' + (r.disagreements.length ? 'DISAGREEMENTS ' + r.disagreements.length : 'AGREE'));
  process.exit(r.disagreements.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
