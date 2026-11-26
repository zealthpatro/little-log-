#!/usr/bin/env node
/* How many households were touched by a data-integrity bug, read-only and in aggregate.
 *
 *   node tools/prod_counts.js              read production with tools/serviceAccountKey.json, print numbers only
 *   node tools/prod_counts.js --key <path> the same key from another place (it is never copied or printed)
 *   node tools/prod_counts.js --self-test  synthetic SDK; needs no key, proves the run makes no write
 *
 * It prints NUMBERS ONLY: no household id, uid, email, name or entry content ever reaches stdout.
 *
 * Reads, and nothing else: households, users, the events collection group, and Auth listUsers. Every call
 * goes through readOnly(), an allowlist facade: anything that is not one of those four reads throws before
 * it reaches the SDK. The self-test runs the real collect() against a recording stub SDK and fails if any
 * method outside READ_METHODS is called, then plants a write through the same recorder to prove it catches
 * one (a recorder that cannot go red proves nothing).
 *
 * What each number means:
 *   a1  households holding an entry whose authorId is a real account that is not a current member. The rules
 *       require authorId == the writer's uid, so on the server this is mostly a caregiver who was removed
 *       (logs stay, access goes), not the leak.
 *   a2  the next-account leak (postmortem 2026-11-19, corrective action 4): households that share an entry id
 *       or a baby id with another household. The leak copied entries and babies by id and restamped the
 *       author, so a shared id is its footprint. "Exact" copies also match type and time.
 *   b   entries still stamped authorId 'local'.
 *   c   orphan households: no members, or every member's account is gone from Auth.
 *   d   totals, and households with an entry written (server createTime/updateTime) in the last 7 and 30 days.
 */
const path = require('path');

const DAY = 86400000;
const FIX_AT = Date.parse('2026-11-20T00:00:00Z'); // v379 reached main 19-20 Nov; copies are split around this
const READ_METHODS = new Set(['collection', 'collectionGroup', 'get', 'listUsers']);

const msOf = (t) => (t && typeof t.toMillis === 'function') ? t.toMillis() : (typeof t === 'number' ? t : 0);

/* The only way collect() reaches Firestore or Auth. */
function readOnly(db, auth) {
  return Object.freeze({
    collection: (name) => db.collection(name).get(),
    group: (name) => db.collectionGroup(name).get(),
    listUsers: (token) => auth.listUsers(1000, token),
  });
}

async function collect(ro) {
  const [hhSnap, usersSnap, evSnap] = await Promise.all([ro.collection('households'), ro.collection('users'), ro.group('events')]);
  const authUids = new Set();
  let token;
  do { const page = await ro.listUsers(token); page.users.forEach((u) => authUids.add(u.uid)); token = page.pageToken; } while (token);
  const households = hhSnap.docs.map((d) => {
    const h = d.data() || {};
    return { id: d.id, members: Object.keys(h.members || {}), babyIds: ((h.app && h.app.babies) || []).map((b) => b && b.id).filter(Boolean).map(String) };
  });
  const events = evSnap.docs.map((d) => {
    const e = d.data() || {};
    const parent = d.ref.parent.parent;
    return { hh: parent ? parent.id : null, id: d.id, authorId: e.authorId || '', type: e.type || '', time: msOf(e.time),
      written: Math.max(msOf(d.createTime), msOf(d.updateTime)), created: msOf(d.createTime) };
  }).filter((e) => e.hh);
  return { households, events, authUids, userDocs: usersSnap.size };
}

function count(data, now) {
  const { households, events, authUids, userDocs } = data;
  const byId = new Map(households.map((h) => [h.id, h]));
  const memberOf = new Map(households.map((h) => [h.id, new Set(h.members)]));

  // a1
  const a1 = new Set(); const a1Gone = new Set();
  for (const e of events) {
    if (!e.authorId || e.authorId === 'local' || !memberOf.has(e.hh) || memberOf.get(e.hh).has(e.authorId)) continue;
    a1.add(e.hh); if (!authUids.has(e.authorId)) a1Gone.add(e.hh);
  }

  // a2: entry ids and baby ids seen in more than one household
  const evGroups = new Map();
  for (const e of events) { if (!evGroups.has(e.id)) evGroups.set(e.id, []); evGroups.get(e.id).push(e); }
  const sharedEvHh = new Set(); const copyHh = new Set(); const copyHhBefore = new Set(); const copyHhAfter = new Set();
  let sharedEvIds = 0, exactCopies = 0, copiesBefore = 0, copiesAfter = 0;
  for (const g of evGroups.values()) {
    const hhs = new Set(g.map((e) => e.hh));
    if (hhs.size < 2) continue;
    sharedEvIds++; hhs.forEach((h) => sharedEvHh.add(h));
    const first = g.slice().sort((x, y) => (x.created || Infinity) - (y.created || Infinity))[0];
    for (const e of g) {
      if (e === first || e.hh === first.hh) continue;
      if (e.type === first.type && e.time === first.time) exactCopies++;
      copyHh.add(e.hh);
      if (e.created && e.created < FIX_AT) { copiesBefore++; copyHhBefore.add(e.hh); } else { copiesAfter++; copyHhAfter.add(e.hh); }
    }
  }
  const babyHh = new Map();
  for (const h of households) for (const b of new Set(h.babyIds)) { if (!babyHh.has(b)) babyHh.set(b, new Set()); babyHh.get(b).add(h.id); }
  const sharedBabyHh = new Set(); let sharedBabyIds = 0;
  for (const s of babyHh.values()) if (s.size > 1) { sharedBabyIds++; s.forEach((h) => sharedBabyHh.add(h)); }
  const anyShared = new Set([...sharedEvHh, ...sharedBabyHh]);

  // b
  const local = events.filter((e) => e.authorId === 'local');
  const localHh = new Set(local.map((e) => e.hh));

  // c
  let noMembers = 0, allGone = 0;
  for (const h of households) {
    if (!h.members.length) noMembers++;
    else if (h.members.every((u) => !authUids.has(u))) allGone++;
  }

  // d
  const lastWrite = new Map();
  for (const e of events) if (e.written > (lastWrite.get(e.hh) || 0)) lastWrite.set(e.hh, e.written);
  const activeIn = (days) => households.filter((h) => (lastWrite.get(h.id) || 0) > now - days * DAY).length;
  const withAnyEvent = households.filter((h) => lastWrite.has(h.id)).length;
  const multiMember = households.filter((h) => h.members.length > 1).length;
  const memberAccounts = new Set(households.flatMap((h) => h.members));
  const orphanEvents = events.filter((e) => !byId.has(e.hh)).length;

  return {
    a1_households_with_nonmember_author: a1.size, a1_of_which_author_account_deleted: a1Gone.size,
    a2_households_sharing_an_entry_or_baby_id: anyShared.size,
    a2_households_sharing_an_entry_id: sharedEvHh.size, a2_shared_entry_ids: sharedEvIds,
    a2_households_holding_a_later_copy: copyHh.size, a2_exact_copies_type_and_time: exactCopies,
    a2_copies_created_before_20nov: copiesBefore, a2_households_with_copy_before_20nov: copyHhBefore.size,
    a2_copies_created_from_20nov: copiesAfter, a2_households_with_copy_from_20nov: copyHhAfter.size,
    a2_households_sharing_a_baby_id: sharedBabyHh.size, a2_shared_baby_ids: sharedBabyIds,
    b_entries_authorId_local: local.length, b_households_with_local_entries: localHh.size,
    c_orphan_households_no_members: noMembers, c_orphan_households_all_members_deleted: allGone,
    d_households_total: households.length, d_auth_accounts: authUids.size, d_user_docs: userDocs,
    d_accounts_in_a_household: memberAccounts.size, d_multi_member_households: multiMember,
    d_households_with_any_entry: withAnyEvent, d_households_active_7d: activeIn(7), d_households_active_30d: activeIn(30),
    d_entries_total: events.length, d_entries_under_a_missing_household: orphanEvents,
  };
}

/* ---- self-test: a recording stub SDK that fails on any call outside READ_METHODS ---- */
function recorder(calls, fixture) {
  const ts = (ms) => ({ toMillis: () => ms });
  const snap = (docs) => ({ size: docs.length, docs });
  const docOf = (id, data, parentId, created) => ({ id, data: () => data, createTime: ts(created || 0), updateTime: ts(created || 0),
    ref: { parent: { parent: parentId ? { id: parentId } : null } } });
  const wrap = (obj) => new Proxy(obj, { get(t, k) {
    if (typeof k !== 'string' || k === 'then') return t[k];
    return (...args) => { calls.push(k); if (!READ_METHODS.has(k)) throw new Error('write attempted: ' + k); return t[k](...args); };
  } });
  const query = (docs) => wrap({ get: async () => snap(docs), doc: () => wrap({ set: async () => {}, update: async () => {}, delete: async () => {} }), add: async () => {} });
  const db = wrap({
    collection: (n) => query(n === 'households' ? fixture.households.map((h) => docOf(h.id, h.data)) : fixture.users.map((u) => docOf(u, {}))),
    collectionGroup: () => query(fixture.events.map((e) => docOf(e.id, e.data, e.hh, e.created))),
    batch: () => ({}), runTransaction: async () => {}, recursiveDelete: async () => {}, bulkWriter: () => ({}),
  });
  const auth = wrap({ listUsers: async () => ({ users: fixture.auth.map((uid) => ({ uid })) }), deleteUser: async () => {}, updateUser: async () => {} });
  return { db, auth };
}

async function selfTest() {
  let fails = 0;
  const ok = (cond, what) => { console.log((cond ? '  ok   ' : '  FAIL ') + what); if (!cond) fails++; };
  const now = Date.parse('2026-11-27T12:00:00Z');
  const old = Date.parse('2026-11-10T08:00:00Z');
  const fixture = {
    auth: ['ann', 'bea', 'cy'],
    users: ['ann', 'bea', 'cy'],
    households: [
      { id: 'H1', data: { members: { ann: 'owner', cy: 'caregiver' }, app: { babies: [{ id: 'b1' }] } } },
      { id: 'H2', data: { members: { bea: 'owner' }, app: { babies: [{ id: 'b1' }] } } },         // got Ann's baby
      { id: 'H3', data: { members: {} } },                                                          // no members
      { id: 'H4', data: { members: { gone: 'owner' } } },                                           // every member deleted
    ],
    events: [
      { hh: 'H1', id: 'e1', data: { authorId: 'ann', type: 'feed', time: 5 }, created: old },
      { hh: 'H2', id: 'e1', data: { authorId: 'bea', type: 'feed', time: 5 }, created: old + DAY }, // copied, restamped, before the fix
      { hh: 'H1', id: 'e2', data: { authorId: 'removed', type: 'sleep', time: 6 }, created: now - 2 * DAY }, // a removed caregiver
      { hh: 'H2', id: 'e3', data: { authorId: 'local', type: 'nappy', time: 7 }, created: now - 20 * DAY },
    ],
  };
  console.log('\nprod_counts self-test\n');
  const calls = [];
  const { db, auth } = recorder(calls, fixture);
  let c;
  try { c = count(await collect(readOnly(db, auth)), now); } catch (e) { ok(false, 'collect ran without a write: ' + e.message); }
  ok(calls.length > 0 && calls.every((k) => READ_METHODS.has(k)), 'the real collect() called only ' + [...READ_METHODS].join(', ') + ' (' + calls.length + ' calls)');
  if (c) {
    ok(c.a1_households_with_nonmember_author === 1 && c.a1_of_which_author_account_deleted === 1, 'a1 finds the removed caregiver\'s entry');
    ok(c.a2_households_sharing_an_entry_or_baby_id === 2 && c.a2_households_holding_a_later_copy === 1 && c.a2_exact_copies_type_and_time === 1, 'a2 finds the copied entry and baby, and names one household as the copy');
    ok(c.a2_copies_created_before_20nov === 1 && c.a2_copies_created_from_20nov === 0, 'a2 dates the copy before the fix');
    ok(c.b_entries_authorId_local === 1, 'b finds the entry stamped local');
    ok(c.c_orphan_households_no_members === 1 && c.c_orphan_households_all_members_deleted === 1, 'c finds both kinds of orphan');
    ok(c.d_households_total === 4 && c.d_auth_accounts === 3 && c.d_households_active_7d === 1 && c.d_households_active_30d === 2, 'd counts totals and the 7 and 30 day windows');
    const text = JSON.stringify(c);
    ok(!/ann|bea|cy|H[1-4]|e[1-3]|b1|removed|gone/.test(text.replace(/"[a-z0-9_]+":/g, '')), 'the output holds numbers only, no id from the fixture');
  }
  // Absence companion: a clean base reads zero on every leak signal.
  const clean = { auth: ['ann'], users: ['ann'], households: [{ id: 'H1', data: { members: { ann: 'owner' }, app: { babies: [{ id: 'b1' }] } } }],
    events: [{ hh: 'H1', id: 'e1', data: { authorId: 'ann', type: 'feed', time: 1 }, created: now - DAY }] };
  const cc = count(await collect(readOnly(recorder([], clean).db, recorder([], clean).auth)), now);
  ok(cc.a1_households_with_nonmember_author + cc.a2_households_sharing_an_entry_or_baby_id + cc.b_entries_authorId_local + cc.c_orphan_households_no_members + cc.c_orphan_households_all_members_deleted === 0, 'a clean base reads zero on a, b and c');
  // Red: the recorder must catch a write, or its green above means nothing.
  const planted = [];
  const r = recorder(planted, fixture);
  let caught = false;
  try { await r.db.collection('households').doc('H1').set({}); } catch (e) { caught = /write attempted: (doc|set)/.test(e.message); }
  ok(caught && planted.includes('doc'), 'a planted write (collection().doc().set()) is caught by the recorder');
  let caughtAuth = false;
  try { await r.auth.deleteUser('ann'); } catch (e) { caughtAuth = /write attempted: deleteUser/.test(e.message); }
  ok(caughtAuth, 'a planted Auth write (deleteUser) is caught by the recorder');
  ok(Object.isFrozen(readOnly(r.db, r.auth)) && Object.keys(readOnly(r.db, r.auth)).sort().join() === 'collection,group,listUsers', 'readOnly() exposes only collection, group and listUsers');
  console.log(fails ? '\n  ' + fails + ' failed\n' : '\n  all passed\n');
  process.exit(fails ? 1 : 0);
}

async function main() {
  if (process.argv.includes('--self-test')) return selfTest();
  const { initializeApp, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const { getAuth } = require('firebase-admin/auth');
  let sa;
  const ki = process.argv.indexOf('--key');
  try { sa = require(ki > 0 ? path.resolve(process.argv[ki + 1]) : path.join(__dirname, 'serviceAccountKey.json')); }
  catch (e) { console.error('Missing tools/serviceAccountKey.json (read-only use; see tools/ops.js).'); process.exit(1); }
  const app = initializeApp({ credential: cert(sa) }, 'prod-counts');
  const c = count(await collect(readOnly(getFirestore(app), getAuth(app))), Date.now());
  console.log(JSON.stringify(Object.assign({ generatedAt: new Date().toISOString() }, c), null, 2));
}

main().catch((e) => { console.error('prod_counts failed: ' + (e && e.message)); process.exit(1); });
