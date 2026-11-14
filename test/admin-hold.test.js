/* The hold reader fails CLOSED (spec §5.1, S12): "never during a hard time" must stay true when the
 * field moves, breaks or cannot be read.
 *
 *   node test/admin-hold.test.js               the suite
 *   node test/admin-hold.test.js --self-test   also break the rule in a temp copy and require RED
 *
 * Held unless the read succeeded AND the field is present with a shape known to be empty. The companion
 * stagings prove the same matcher DOES say not-held for null and {}, and held for {uid: {at}} and the
 * legacy {at}, so this gate cannot be green for free. (The AdminWrites half arrives with phase 4 and must
 * join this gate then.)
 */
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');
const { selfTest } = require('./helpers/admin-selftest');

const ROOT = process.env.ADMIN_ROOT || path.join(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + JSON.stringify(x) : '')); } };

(async () => {
  const R = await imp('workers/shared/fs-read.mjs');
  const { createFakeGoogle } = await imp('workers/admin/dev/fake-google.mjs');
  const HID = 'HHID_sample_hold';
  async function held(app, opts) {
    opts = opts || {};
    const docs = new Map();
    if (app !== undefined) docs.set('households/' + HID, { ownerId: 'UID_sample_x', app });
    const fake = createFakeGoogle({ docs, projectId: 'cubby-sample', honorMask: true });
    if (opts.fault) fake.state.fault = opts.fault;
    const reader = R.createReader({ projectId: 'cubby-sample', getToken: async () => 't', fetchImpl: fake.fetchImpl, timeoutMs: 80 });
    const v = await R.holdRead(reader, HID);
    const asked = fake.seen.filter((s) => s.url.includes('/documents/households/'));
    return { v, masks: asked.map((s) => new URL(s.url).searchParams.getAll('mask.fieldPaths')) };
  }
  const hold = 'lossHolding';
  console.log('\nadmin hold reader: absent, moved, odd or unreadable means HELD');

  console.log('\ncompanions first: the matcher can say not-held, and can say held');
  ok('null (the app writes null when empty) reads NOT held', (await held({ [hold]: null })).v === false);
  ok('an empty map reads NOT held', (await held({ [hold]: {} })).v === false);
  ok('a per-uid map {uid: {at}} reads held', (await held({ [hold]: { UID_sample_x: { at: 1 } } })).v === true);
  ok('the legacy {at} shape reads held', (await held({ [hold]: { at: 1763000000000 } })).v === true);

  console.log('\nand everything else is held');
  ok('the field absent', (await held({ babies: [] })).v === true);
  ok('the field moved (app.loss.holding)', (await held({ loss: { holding: null } })).v === true);
  ok('a non-map value (a string)', (await held({ [hold]: 'no' })).v === true);
  ok('a non-map value (false)', (await held({ [hold]: false })).v === true);
  ok('a non-map value (an array)', (await held({ [hold]: [] })).v === true);
  ok('a non-map value (a number)', (await held({ [hold]: 0 })).v === true);
  ok('no app at all', (await held({})).v === true);
  ok('a 404 on the household', (await held(undefined)).v === true);
  ok('a 500', (await held({ [hold]: null }, { fault: async () => new Response('{}', { status: 500 }) })).v === true);
  ok('a 403', (await held({ [hold]: null }, { fault: async () => new Response('{}', { status: 403 }) })).v === true);
  ok('a network error', (await held({ [hold]: null }, { fault: async () => { throw new Error('ECONNRESET'); } })).v === true);
  ok('a timeout', (await held({ [hold]: null }, { fault: (u, m, b, init) => new Promise((_, rej) => { if (init.signal) init.signal.addEventListener('abort', () => rej(new Error('aborted'))); }) })).v === true);
  ok('a body that is not JSON', (await held({ [hold]: null }, { fault: async () => new Response('<html>', { status: 200 }) })).v === true);

  console.log('\nand it asks for that one field, nothing more');
  const r = await held({ [hold]: null, babies: [{ name: 'ZZ-BABYNAME-7731' }] });
  ok('one request, masked to the one field', r.masks.length === 1 && r.masks[0].length === 1 && r.masks[0][0] === 'app.' + hold, r.masks);
  let refused = false;
  try { const reader = R.createReader({ projectId: 'cubby-sample', getToken: async () => 't', fetchImpl: async () => new Response('{}') }); await reader.holdGet(Symbol('hold'), 'households/' + HID, 'app.babies'); }
  catch (e) { refused = e instanceof R.ReadRefused; }
  ok('nobody else can use its door: a lookalike capability is refused', refused);

  if (process.argv.includes('--self-test') && !process.env.ADMIN_MUTANT) {
    selfTest(__filename, [
      { name: 'a read error reads not-held', file: 'workers/shared/fs-read.mjs', find: '  } catch (e) {\n    return true;\n  }\n}', replace: '  } catch (e) {\n    return false;\n  }\n}' },
      { name: 'an absent field reads not-held', file: 'workers/shared/fs-read.mjs', find: "if (!v || typeof v !== 'object') return true;", replace: "if (!v || typeof v !== 'object') return false;" },
      { name: 'a 404 reads not-held', file: 'workers/shared/fs-read.mjs', find: 'if (!r || r.status !== 200) return true;', replace: 'if (!r || r.status !== 200) return r.status !== 404;' },
      { name: 'an unknown shape reads not-held', file: 'workers/shared/fs-read.mjs', find: "      return Object.keys(f).length !== 0;\n    }\n    return true;", replace: "      return Object.keys(f).length !== 0;\n    }\n    return false;" },
    ], ok);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('ADMIN-HOLD: ' + (fail ? 'FAIL' : 'PASS'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL threw ' + (e && e.stack)); console.log('ADMIN-HOLD: FAIL'); process.exit(1); });
