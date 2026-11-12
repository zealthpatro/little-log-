/* The purge cron must never erase a family that still has people in it.
 *
 * purgeDeletedHouseholds (worker.js) hard-deletes every household whose deleteAfter is due: events,
 * photos, notes, pregnancy, private health, then the household itself, with the service account and
 * with no backup to restore from. The app only ever sets deleteAfter as the LAST member leaves
 * (deleteAccount), so a due household with anyone still in members was flagged by somebody exceeding
 * their role. Until 2026-11-12 the rules let any caregiver do exactly that, and the cron believed it
 * (audit findings missed-1, rules-deleteafter-purge). The rules now refuse it; this is the second
 * lock, so a future rules gap cannot become a wipe on its own.
 *
 * Drives the REAL purgeDeletedHouseholds against a fake Firestore that honours the query's select
 * mask, so a fix that forgets to ask for `members` sees none and fails here, as it would in
 * production.
 *
 *   node test/purge-guard.test.js
 */
const path = require('path');
const { generateKeyPairSync } = require('crypto');

const ROOT = path.join(__dirname, '..');
const DOCS = 'https://firestore.googleapis.com/v1/projects/little-log-a9caa/databases/(default)/documents';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = { client_email: 'cron@little-log-a9caa.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 400) : '')); } };

const UPDATED = '2026-11-12T01:02:03.456789Z';
const PAST = Date.now() - 60000;
// Firestore REST shapes for the three due households.
const HH = {
  // The real thing: the last member left 30+ days ago. members is an empty map.
  hhLegit: { deleteAfter: { integerValue: String(PAST) }, deletionRequestedBy: { stringValue: 'uLast' }, ownerId: { stringValue: 'uLast' }, members: { mapValue: {} } },
  // The attack: a caregiver set deleteAfter = 1 while the family is still using Cubby.
  hhAttacked: { deleteAfter: { integerValue: '1' }, ownerId: { stringValue: 'uMum' },
    members: { mapValue: { fields: { uMum: { stringValue: 'owner' }, uNanny: { stringValue: 'caregiver' } } } } },
  // An old flag with no members field at all: nobody to protect, so it is purged as before.
  hhNoField: { deleteAfter: { integerValue: String(PAST) }, ownerId: { stringValue: 'uOld' } },
};

function makeWorld() {
  const w = { deleted: [], patches: [], listed: [], logs: [], selects: null, unexpected: [] };
  w.fetch = async (input, init) => {
    init = init || {};
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method || 'GET').toUpperCase();
    const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
    if (url === TOKEN_URL) return reply(200, { access_token: 'tok-test' });
    if (url === DOCS + ':runQuery' && method === 'POST') {
      const sq = JSON.parse(init.body).structuredQuery;
      w.selects = ((sq.select && sq.select.fields) || []).map((f) => f.fieldPath);
      // Honour the projection the way Firestore does: only the named fields come back.
      return reply(200, Object.keys(HH).map((hid) => {
        const fields = {};
        for (const f of w.selects) if (HH[hid][f]) fields[f] = HH[hid][f];
        return { document: { name: 'projects/little-log-a9caa/databases/(default)/documents/households/' + hid, fields, updateTime: UPDATED } };
      }));
    }
    if (url.startsWith(DOCS + '/households/') && method === 'GET') {
      w.listed.push(url.slice(DOCS.length));
      const m = url.slice(DOCS.length).match(/^\/households\/([^/]+)\/events\?/);
      // One event per household, so a purge that runs actually deletes something we can see.
      if (m) return reply(200, { documents: [{ name: 'projects/little-log-a9caa/databases/(default)/documents/households/' + m[1] + '/events/e1' }] });
      return reply(200, { documents: [] });
    }
    if (method === 'DELETE' && url.startsWith('https://firestore.googleapis.com/v1/')) {
      w.deleted.push(url.replace(/^https:\/\/firestore\.googleapis\.com\/v1\/(projects\/[^/]+\/databases\/\(default\)\/documents)?/, '').replace(/^\//, ''));
      return reply(200, {});
    }
    // The unflag is a documents:commit (precondition in the JSON body; the query-string form is
    // refused by a real Firestore, see test/purge-unflag-emulator.test.js). One write per commit.
    if (url === DOCS + ':commit' && method === 'POST') {
      const wr = ((JSON.parse(init.body || '{}').writes) || [])[0] || {};
      w.patches.push({ name: String((wr.update && wr.update.name) || '').split('/documents')[1] || '', write: wr });
      return reply(200, { writeResults: [{ updateTime: UPDATED }] });
    }
    w.unexpected.push(method + ' ' + url);
    return reply(404, {});
  };
  return w;
}

(async () => {
  console.log('\nthe purge cron and a household that still has people in it');
  const mod = await import('file://' + path.join(ROOT, 'worker.js'));
  const purge = mod.__purge && mod.__purge.purgeDeletedHouseholds;
  ok('worker.js exports __purge.purgeDeletedHouseholds, so this can be tested at all', typeof purge === 'function');
  if (typeof purge !== 'function') { console.log('\n' + pass + ' passed, ' + fail + ' failed\nPURGE-GUARD: FAIL'); process.exit(1); }

  const w = makeWorld();
  const realFetch = globalThis.fetch, realLog = console.log, realErr = console.error;
  globalThis.fetch = w.fetch;
  console.log = (...a) => w.logs.push(a.join(' '));
  console.error = (...a) => w.logs.push(a.join(' '));
  let res;
  try { res = await purge({ FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) }); }
  finally { globalThis.fetch = realFetch; console.log = realLog; console.error = realErr; }

  const touched = (hid) => w.deleted.filter((d) => d.indexOf('households/' + hid) === 0);
  ok('the query asks for members (a mask without it would see every family as empty)', (w.selects || []).includes('members'), w.selects);
  ok('a household whose last member left IS purged', touched('hhLegit').includes('households/hhLegit'), w.deleted);
  ok('and its records went first', touched('hhLegit').includes('households/hhLegit/events/e1'), w.deleted);
  ok('an old flag with no members field is purged as before', touched('hhNoField').includes('households/hhNoField'), w.deleted);
  ok('a household with people still in it is NOT deleted', !touched('hhAttacked').includes('households/hhAttacked'), w.deleted);
  ok('and not one of its records is deleted', touched('hhAttacked').length === 0, touched('hhAttacked'));
  ok('its records are not even listed', !w.listed.some((u) => u.indexOf('/households/hhAttacked/') === 0), w.listed);
  ok('the refusal is logged with the household id', w.logs.some((l) => /purge_refused_members/.test(l) && /hhAttacked/.test(l)), w.logs);
  const p = w.patches.find((x) => x.name === '/households/hhAttacked') || null;
  ok('the bogus flag is cleared, so the family\'s medicine reminders start again', !!p, w.patches);
  const mask = (p && p.write.updateMask && p.write.updateMask.fieldPaths) || [];
  ok('clearing exactly deleteAfter and deletionRequestedBy, nothing else',
    !!p && mask.length === 2 && mask.includes('deleteAfter') && mask.includes('deletionRequestedBy')
      && p.write.update && Object.keys(p.write.update.fields || {}).length === 0, p);
  ok('only if the household has not changed since it was read, as a JSON precondition',
    !!p && p.write.currentDocument && p.write.currentDocument.updateTime === UPDATED, p && p.write);
  ok('no other household is patched', w.patches.every((x) => x.name === '/households/hhAttacked'), w.patches);
  ok('the run reports two households purged', res && res.households === 2, res);
  ok('nothing unexpected was fetched', w.unexpected.length === 0, w.unexpected);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'PURGE-GUARD: FAIL' : 'PURGE-GUARD: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
