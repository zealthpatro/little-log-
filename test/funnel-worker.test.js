/* The funnel's Worker half: the step counter, the daily snapshot, the erasure count, the Monday digest.
 *
 *   node test/funnel-worker.test.js
 *
 * D1 is real SQLite here (node:sqlite), not a fake, so the upserts are exercised as written.
 * Firestore is a recorder that answers from fixtures and logs every URL it was asked for, which is how
 * this proves the snapshot never requests her private health, her loss archive, or anyone's name:
 * not by reading the code, but by watching what it actually fetched.
 */
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { generateKeyPairSync } = require('crypto');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '\n         ' + JSON.stringify(detail).slice(0, 400) : '')); }
};

/* A D1-shaped shim over a real SQLite database. */
function makeD1() {
  const db = new DatabaseSync(':memory:');
  const prepare = (sql) => {
    let args = [];
    const st = {
      bind: (...a) => { args = a; return st; },
      run: async () => { db.prepare(sql).run(...args); return { success: true }; },
      first: async () => { const r = db.prepare(sql).get(...args); return r ? Object.assign({}, r) : null; },
      all: async () => ({ results: db.prepare(sql).all(...args).map((r) => Object.assign({}, r)) }),
    };
    return st;
  };
  return { prepare, batch: async (sts) => { for (const s of sts) await s.run(); return []; }, raw: db };
}

const DAY = 86400000;
const NOW = Date.UTC(2026, 8, 28, 1, 0, 0);          // a Monday, 01:00 UTC
const HH = 'HHID_live_q1', HH2 = 'HHID_founder_q2', OWNER = 'UID_owner_q3', CARE = 'UID_care_q4', FOUNDER = 'UID_founder_q5';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = { project_id: 'little-log-a9caa', client_email: 'x@y.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };

const ts = (ms) => ({ timestampValue: new Date(ms).toISOString() });
const int = (n) => ({ integerValue: String(n) });
const str = (x) => ({ stringValue: x });
const hhDoc = (id, owner, members, babies) => ({
  name: 'projects/p/databases/(default)/documents/households/' + id,
  fields: {
    createdAt: ts(NOW - 5 * DAY), ownerId: str(owner),
    members: { mapValue: { fields: Object.fromEntries(Object.entries(members).map(([u, r]) => [u, str(r)])) } },
    app: { mapValue: { fields: { babies: { arrayValue: { values: babies.map(() => ({ mapValue: { fields: { name: str('Bo') } } })) } } } } },
  },
});
const evDoc = (t, author, type) => ({ name: 'x/events/e' + t, fields: { time: int(t), authorId: str(author), type: str(type) } });

/* The Firestore recorder. */
function firestore(opts) {
  opts = opts || {};
  const seen = [];
  const fetchImpl = async (url, init) => {
    url = String(url); seen.push(url);
    const j = (o, status) => ({ ok: (status || 200) < 300, status: status || 200, json: async () => o, text: async () => JSON.stringify(o) });
    if (url.indexOf('oauth2.googleapis.com') >= 0) return j({ access_token: 'tok' });
    if (url.indexOf('api.resend.com') >= 0) { (opts.mail || []).push(JSON.parse(init.body)); return j({ id: 'm' }); }
    if (opts.failAll) return j({ error: 'down' }, 503);
    if (url.endsWith(':runQuery')) {
      return j([hhDoc(HH, OWNER, { [OWNER]: 'owner', [CARE]: 'caregiver' }, [1]), hhDoc(HH2, FOUNDER, { [FOUNDER]: 'owner' }, [1, 2])].map((d) => ({ document: d })));
    }
    if (url.indexOf('/households/' + HH + '/events') >= 0) {
      const many = opts.manyEvents ? Array.from({ length: opts.manyEvents }, (_, i) => evDoc(NOW - 4 * DAY + i, OWNER, 'feed')) : [];
      return j({ documents: [evDoc(NOW - 4 * DAY, OWNER, 'feed'), evDoc(NOW - 4 * DAY + 3600000, CARE, 'diaper')].concat(many) });
    }
    if (url.indexOf('/households/' + HH2 + '/events') >= 0) return j({ documents: [evDoc(NOW - DAY, FOUNDER, 'feed')] });
    if (url.indexOf('/pregnancy') >= 0) return j({});
    if (url.indexOf('/users/') >= 0) return j({ fields: { acq: { mapValue: { fields: { source: str('instagram') } } } } });
    if (url.indexOf('/invites?') >= 0) return j({ documents: [{ name: 'x/invites/a', fields: { householdId: str(HH) } }] });
    if (url.indexOf('/inviteLinks?') >= 0) return j({});
    if (url.indexOf('/waitlist?') >= 0) return j({ documents: [{ name: 'x/waitlist/' + OWNER, fields: { uid: str(OWNER) } }] });
    return j({}, 404);
  };
  return { fetchImpl, seen };
}

(async () => {
  const mod = await import('file://' + path.join(__dirname, '..', 'worker.js'));
  const F = mod.__funnel;
  const realFetch = globalThis.fetch;
  const withFetch = async (impl, fn) => { globalThis.fetch = impl; try { return await fn(); } finally { globalThis.fetch = realFetch; } };
  const req = (body, headers, method) => new Request('https://little-cubby.com/api/step', {
    method: method || 'POST',
    headers: Object.assign({ origin: 'https://little-cubby.com', 'content-type': 'application/json' }, headers || {}),
    body: method === 'GET' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  const valid = { event: 'onboarding.step_reached', props: { step: 'stage_chosen', stage: 'baby' } };
  const count = (d1) => { try { return d1.raw.prepare('SELECT COALESCE(SUM(n),0) AS n FROM funnel_steps').get().n; } catch (e) { return 0; } };

  console.log('\nfunnel worker: counter, snapshot, erasure, digest\n');

  console.log('1. POST /api/step stores a count and nothing else');
  let d1 = makeD1(); let env = { GAMES_DB: d1 };
  let r = await F.recordStep(req(valid), env);
  ok('a step in the plan is accepted with 204', r.status === 204, r.status);
  await F.recordStep(req(valid), env);
  const row = d1.raw.prepare('SELECT * FROM funnel_steps').all().map((x) => Object.assign({}, x));
  ok('two calls are ONE row with n = 2, an atomic upsert', row.length === 1 && row[0].n === 2, row);
  ok('the stored key is the event and its two enum values, nothing more',
     row[0].key === 'onboarding.step_reached|stage=baby|step=stage_chosen', row[0].key);
  ok('the table has no column that could hold a person', Object.keys(row[0]).sort().join(',') === 'day,key,n', Object.keys(row[0]));

  console.log('\n2. it refuses everything that is not a counted step');
  const before = count(d1);
  r = await F.recordStep(req(valid, { origin: 'https://evil.example' }), env);
  ok('another origin is refused with 403', r.status === 403, r.status);
  r = await F.recordStep(req({ event: 'user.email', props: { step: 'stage_chosen', stage: 'baby' } }), env);
  ok('an event outside the plan is refused with 400', r.status === 400, r.status);
  r = await F.recordStep(req({ event: 'pro.sheet_viewed', props: { stage: 'baby', entry_point: 'settings', uid: 'x' } }), env);
  ok('an extra property is refused', r.status === 400, r.status);
  r = await F.recordStep(req({ event: 'pro.sheet_viewed', props: { stage: 'baby', entry_point: 'me@example.com' } }), env);
  ok('a value outside the enum is refused', r.status === 400, r.status);
  r = await F.recordStep(req('{"event":"' + 'x'.repeat(600) + '"}'), env);
  ok('a body over 512 bytes is refused with 413', r.status === 413, r.status);
  r = await F.recordStep(req('not json'), env);
  ok('malformed JSON is refused with 400', r.status === 400, r.status);
  ok('and none of those refusals wrote anything', count(d1) === before, { before, after: count(d1) });
  r = await F.recordStep(req(valid), Object.assign({}, env, { STEP_RATE_LIMITER: { limit: async () => ({ success: false }) } }));
  ok('a caller over the rate limit gets 429 and no count', r.status === 429 && count(d1) === before, r.status);
  r = await F.recordStep(req(valid), {});
  ok('with no database it answers 503 rather than throwing', r.status === 503, r.status);
  r = await mod.default.fetch(req(null, {}, 'GET'), env, {});
  ok('GET /api/step is 405 through the real router', r.status === 405, r.status);
  r = await mod.default.fetch(req(valid), env, {});
  ok('POST /api/step is routed to the counter', r.status === 204, r.status);

  console.log('\n3. the snapshot reads only what the plan allows');
  d1 = makeD1();
  env = { GAMES_DB: d1, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA), INTERNAL_UIDS: FOUNDER };
  let fs = firestore();
  await withFetch(fs.fetchImpl, () => F.runFunnelSnapshot(env, NOW));
  let snap = Object.assign({}, d1.raw.prepare('SELECT * FROM funnel_snapshots').get());
  ok('a snapshot row is written and marked ok', snap.ok === 1, snap);
  const urls = fs.seen.join('\n');
  ok('it never requested her private health (mhealth)', urls.indexOf('mhealth') < 0);
  ok('it never requested her loss archive (pregnancyArchive)', urls.indexOf('pregnancyArchive') < 0);
  ok('it never requested memberInfo, where names live', urls.indexOf('memberInfo') < 0);
  const evUrl = fs.seen.find((u) => u.indexOf('/events?') >= 0) || '';
  ok('care logs are read with a mask of exactly time, authorId, type',
     /mask\.fieldPaths=time/.test(evUrl) && /mask\.fieldPaths=authorId/.test(evUrl) && /mask\.fieldPaths=type/.test(evUrl)
     && (evUrl.match(/mask\.fieldPaths=/g) || []).length === 3, evUrl);
  const userUrl = fs.seen.find((u) => u.indexOf('/users/') >= 0) || '';
  ok('the user doc is read for attribution only', /mask\.fieldPaths=acq/.test(userUrl) && (userUrl.match(/mask\.fieldPaths=/g) || []).length === 2, userUrl);
  /* Paired with the three "never requested" lines: they must not pass because nothing was fetched. */
  ok('and it did read the cohort, logs and invites, so those lines are not passing on silence',
     fs.seen.some((u) => u.endsWith(':runQuery')) && !!evUrl && fs.seen.some((u) => u.indexOf('/invites?') >= 0));

  const body = JSON.parse(snap.body);
  ok('the stored snapshot carries no household id or uid', [HH, HH2, OWNER, CARE, FOUNDER].every((id) => snap.body.indexOf(id) < 0));
  ok('the founder\'s household is excluded by INTERNAL_UIDS', body.households.internal_excluded === 1 && body.households.total === 1, body.households);
  ok('two authors on one day reach the wedge', body.funnel.baby.shared_logging === 1, body.funnel.baby);
  ok('the invite and the waitlist are attributed', body.funnel.baby.invite_sent === 1 && body.funnel.baby.pro_waitlisted === 1, body.funnel.baby);
  ok('it records how many Firestore reads it spent', typeof body.reads === 'number' && body.reads > 0, body.reads);

  console.log('\n4. once a day, and a failure is recorded, never swallowed');
  fs = firestore();
  await withFetch(fs.fetchImpl, () => F.runFunnelSnapshot(env, NOW + 3600000));
  ok('a second tick the same day reads nothing from Firestore', fs.seen.filter((u) => u.indexOf('firestore') >= 0).length === 0, fs.seen.length);

  d1 = makeD1(); env = { GAMES_DB: d1, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) };
  await withFetch(firestore({ failAll: true }).fetchImpl, () => F.runFunnelSnapshot(env, NOW));
  snap = Object.assign({}, d1.raw.prepare('SELECT * FROM funnel_snapshots').get());
  ok('a Firestore outage is recorded as ok = 0 WITH its reason', snap.ok === 0 && /503/.test(snap.reason || ''), snap);
  await withFetch(firestore({ failAll: true }).fetchImpl, () => F.runFunnelSnapshot(env, NOW + 1));
  await withFetch(firestore({ failAll: true }).fetchImpl, () => F.runFunnelSnapshot(env, NOW + 2));
  fs = firestore({ failAll: true });
  await withFetch(fs.fetchImpl, () => F.runFunnelSnapshot(env, NOW + 3));
  snap = Object.assign({}, d1.raw.prepare('SELECT * FROM funnel_snapshots').get());
  ok('it stops after three attempts in a day instead of hammering a broken dependency',
     snap.attempts === 3 && fs.seen.filter((u) => u.indexOf('firestore') >= 0).length === 0, snap.attempts);

  d1 = makeD1(); env = { GAMES_DB: d1, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) };
  await withFetch(firestore({ manyEvents: 16000 }).fetchImpl, () => F.runFunnelSnapshot(env, NOW));
  snap = Object.assign({}, d1.raw.prepare('SELECT * FROM funnel_snapshots').get());
  ok('past the read budget it ABANDONS and says why, rather than spending the product\'s quota',
     snap.ok === 0 && /budget/.test(snap.reason || ''), snap.reason);

  console.log('\n5. erasure is counted, because it leaves nothing else behind');
  d1 = makeD1();
  await F.countAccountDeleted({ GAMES_DB: d1 });
  const del = d1.raw.prepare('SELECT key, n FROM funnel_steps').all().map((x) => Object.assign({}, x));
  ok('one erasure is one aggregate count', del.length === 1 && del[0].key === 'account.deleted|role=owner|stage=unknown' && del[0].n === 1, del);

  console.log('\n6. the Monday digest');
  d1 = makeD1(); const mail = [];
  env = { GAMES_DB: d1, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA), ALERT_EMAIL: 'founder@example.com', RESEND_API_KEY: 'rk', INTERNAL_UIDS: FOUNDER };
  await withFetch(firestore({ mail }).fetchImpl, async () => { await F.runFunnelSnapshot(env, NOW); await F.maybeSendFunnelDigest(env, NOW); });
  ok('on a Monday, with a snapshot, one digest goes to ALERT_EMAIL', mail.length === 1 && mail[0].to === 'founder@example.com', mail.length);
  ok('its subject leads with the wedge', /two people logging/.test((mail[0] || {}).subject || ''), (mail[0] || {}).subject);
  ok('and it reports the snapshot job\'s own health first', /Snapshot job healthy/.test((mail[0] || {}).html || ''));
  await withFetch(firestore({ mail }).fetchImpl, () => F.maybeSendFunnelDigest(env, NOW + 3600000));
  ok('a second tick that Monday does not send it again', mail.length === 1, mail.length);
  const mail2 = [];
  await withFetch(firestore({ mail: mail2 }).fetchImpl, () => F.maybeSendFunnelDigest(env, NOW + DAY));
  ok('Tuesday sends nothing', mail2.length === 0);
  const mail3 = [];
  await withFetch(firestore({ mail: mail3 }).fetchImpl, () => F.maybeSendFunnelDigest(Object.assign({}, env, { ALERT_EMAIL: '' }), NOW + 7 * DAY));
  ok('with no ALERT_EMAIL it sends nothing and does not throw', mail3.length === 0);

  d1 = makeD1(); const mail4 = [];
  env = { GAMES_DB: d1, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA), ALERT_EMAIL: 'founder@example.com', RESEND_API_KEY: 'rk' };
  await withFetch(firestore({ failAll: true, mail: mail4 }).fetchImpl, async () => { await F.runFunnelSnapshot(env, NOW); await F.maybeSendFunnelDigest(env, NOW); });
  ok('when the snapshot failed, the digest SAYS it failed, in the subject',
     mail4.length === 1 && /FAILED/.test(mail4[0].subject) && /failed on 1 of the last 1/.test(mail4[0].html), mail4[0] && mail4[0].subject);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('FUNNEL-WORKER: ' + (fail ? 'FAIL' : 'PASS') + '\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('threw:', e); process.exit(1); });
