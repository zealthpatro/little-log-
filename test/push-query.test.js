/* The cron's Firestore query, proved against a real Firestore rather than reasoned about.
 *
 * `sendPushReminders` used to page the ENTIRE /users collection every 15 minutes, and
 * `purgeDeletedHouseholds` did the same over /households: 96 runs/day x (every user + every
 * household) in reads whether or not anything was due, against Spark's 50k/day. That capped the
 * product at roughly 260 users and made the CRON the binding constraint on growth, not the app.
 *
 * Both now use a single-field range query. Push is CRITICAL-only (medicine), so getting the field
 * path, the operator or the absent/null semantics wrong means a dose reminder silently never fires.
 * That is exactly the kind of claim that must not rest on reasoning, so this asserts it end to end:
 *
 *   - a user whose nextAt has passed IS returned
 *   - a user whose nextAt is in the future is NOT
 *   - a user with NO nextAt field at all is NOT (this is what makes the whole change pay off:
 *     everyone who never enabled push costs zero reads)
 *   - a user with nextAt EXPLICITLY NULL is NOT returned. Firestore comparison filters are
 *     TYPE-SCOPED: `<= <integer>` only ever matches numbers, so a null is excluded. (An earlier
 *     version of this comment claimed the opposite -- that null sorts before numbers and would
 *     therefore match for ever. This assertion is what disproved it.) Writing null would in fact
 *     be safe; the client still deletes the field with FieldValue.delete() and the Worker still
 *     clears it via an updateMask with the value omitted, because an absent field is left out of
 *     the single-field index altogether rather than merely failing to match.
 *
 * Run: cd test && npm run test:pushquery   (starts the emulator, which sets FIRESTORE_EMULATOR_HOST)
 *
 * The emulator loads firestore.rules, which correctly denies an unauthenticated client, so seeding
 * uses the emulator's `Bearer owner` admin credential to bypass rules the same way the Worker's
 * service account does in production. Rules themselves are covered by rules-test.js, not here.
 */
const HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
const PROJECT = 'demo-cubby';
const BASE = `http://${HOST}/v1/projects/${PROJECT}/databases/(default)/documents`;
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ('  ' + JSON.stringify(x)) : '')); } };

// Mirrors fsQuery() in worker.js. Kept in lockstep by the source assertions at the bottom.
async function fsQuery(collectionId, fieldPath, op, value, limit, selectFields) {
  const sq = {
    from: [{ collectionId }],
    where: { fieldFilter: { field: { fieldPath }, op, value: { integerValue: String(value) } } },
    orderBy: [{ field: { fieldPath }, direction: 'ASCENDING' }],
    limit: limit || 300
  };
  if (selectFields) sq.select = { fields: selectFields.map(f => ({ fieldPath: f })) };
  const r = await fetch(BASE + ':runQuery', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ structuredQuery: sq })
  });
  if (!r.ok) return null;
  const j = await r.json();
  if (!Array.isArray(j)) return null;
  return j.map(e => e && e.document).filter(Boolean);
}
const put = (coll, id, fields) => fetch(`${BASE}/${coll}?documentId=${id}`, {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ fields })
}).then(r => r.ok || Promise.reject(new Error(coll + '/' + id + ' seed failed: ' + r.status)));
const pushDoc = (o) => ({ push: { mapValue: { fields: o } } });
const ids = (docs) => (docs || []).map(d => d.name.split('/').pop()).sort();

(async () => {
  const NOW = 1800000000000, PAST = NOW - 60000, FUTURE = NOW + 3600000;

  await put('users', 'due-now', pushDoc({ enabled: { booleanValue: true }, nextAt: { integerValue: String(PAST) } }));
  await put('users', 'due-later', pushDoc({ enabled: { booleanValue: true }, nextAt: { integerValue: String(FUTURE) } }));
  await put('users', 'never-enabled', pushDoc({ enabled: { booleanValue: false } }));
  await put('users', 'no-push-map', { acq: { stringValue: 'organic' } });
  await put('users', 'null-nextat', pushDoc({ enabled: { booleanValue: true }, nextAt: { nullValue: null } }));

  console.log('users where push.nextAt <= now:');
  const got = await fsQuery('users', 'push.nextAt', 'LESS_THAN_OR_EQUAL', NOW, 500);
  ok('query succeeded (field path + operator are valid)', got !== null, got);
  const g = ids(got);
  ok('the due user IS returned', g.includes('due-now'), g);
  ok('a future reminder is NOT returned', !g.includes('due-later'), g);
  ok('a user who never enabled push is NOT returned', !g.includes('never-enabled'), g);
  ok('a user with no push map at all is NOT returned', !g.includes('no-push-map'), g);
  ok('an explicitly NULL nextAt is NOT returned (range filters are type-scoped)', !g.includes('null-nextat'), g);
  ok('exactly one document read for five users', g.length === 1, g);

  console.log('\nhouseholds where deleteAfter <= now:');
  await put('households', 'expired', { deleteAfter: { integerValue: String(PAST) }, ownerId: { stringValue: 'u1' } });
  await put('households', 'in-grace', { deleteAfter: { integerValue: String(FUTURE) }, ownerId: { stringValue: 'u2' } });
  await put('households', 'live-family', { ownerId: { stringValue: 'u3' } });
  const hh = await fsQuery('households', 'deleteAfter', 'LESS_THAN_OR_EQUAL', NOW, 50, ['deleteAfter']);
  const h = ids(hh);
  ok('query succeeded', hh !== null, hh);
  ok('a lapsed household IS returned', h.includes('expired'), h);
  ok('a household still in its 30-day grace is NOT returned', !h.includes('in-grace'), h);
  ok('a household never flagged for deletion is NOT returned', !h.includes('live-family'), h);
  ok('exactly one document read for three households', h.length === 1, h);
  ok('select mask kept the payload to deleteAfter only',
     hh && hh[0] && Object.keys(hh[0].fields || {}).join(',') === 'deleteAfter',
     hh && hh[0] && hh[0].fields);

  console.log('\nworker.js and this test agree:');
  const src = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8');
  ok("worker queries 'push.nextAt'", src.includes("'users', 'push.nextAt', 'LESS_THAN_OR_EQUAL'"));
  ok("worker queries 'deleteAfter'", src.includes("'households', 'deleteAfter', 'LESS_THAN_OR_EQUAL'"));
  ok('worker no longer pages /households', !src.includes("'/households?pageSize"));
  ok('the only /users paging left is the one-time backfill',
     (src.match(/'\/users\?pageSize/g) || []).length === 1);
  const app = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
  ok('the client writes nextAt with the index', app.includes('nextAt: slice.length ? slice[0].at'));
  ok('the client DELETES nextAt rather than nulling it',
     app.includes('firebase.firestore.FieldValue.delete()}},{merge:true})'));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
