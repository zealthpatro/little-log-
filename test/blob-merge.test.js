/* The merge that keeps a pending edit alive across a household snapshot, judged on the REAL functions.
 *
 * test/blob-sync.test.js proves the lost-update fix end to end against the emulators, but the emulator
 * tier is not run by the pre-push hook. This is the tree-tier half: it lifts the functions out of
 * app/store-firebase.js and app/index.html by name (no mirror that can drift), runs them in a sandbox,
 * and walks the snapshot handler's own sequence: hold the pending edits, apply the server's copy,
 * put the edits back, take the baseline, give each held key the server's copy as its baseline.
 *
 *   node test/blob-merge.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

const STORE = fs.readFileSync(path.join(__dirname, '..', 'app', 'store-firebase.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
// The whole `function name(...) {...}` declaration, by brace matching (strings and comments in these
// functions hold no braces that matter; the result is compiled, so a bad cut fails loudly).
function lift(src, name) {
  const m = new RegExp('\\n\\s*(?:async\\s+)?function ' + name + '\\s*\\(').exec(src);
  if (!m) return null;
  let i = src.indexOf('{', m.index), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(m.index, j + 1);
  }
  return null;
}
const NAMES = ['stableStringify', 'idListOf', 'ser3', 'mergeIdList', 'plainObj', 'mergeBlobValue', 'sharedSettings',
  'appBlobFromState', 'applyAppBlob', 'snapshotBlobBase', 'holdPendingBlobEdits', 'reapplyPendingBlobEdits'];
const parts = NAMES.map((n) => [n, lift(STORE, n)]);
const norm = lift(INDEX, 'normalizeLoadedState');
ok('app/index.html has normalizeLoadedState', !!norm);
const S0 = (x) => JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().reduce((o, kk) => { o[kk] = v[kk]; return o; }, {}) : v));
if (norm) {
console.log('\n1. a medicine with no babyId never carries undefined (Firestore refuses it)');
{
  const hasUndefined = (o) => { let bad = false; (function walk(v) { if (v === undefined) bad = true; else if (v && typeof v === 'object') Object.keys(v).forEach((k) => walk(v[k])); })(o); return bad; };
  const nb = { state: {}, applyTheme: () => {}, uid: () => 'u1' };
  vm.createContext(nb); vm.runInContext(norm, nb);
  nb.normalizeLoadedState({ babies: [{ id: 'b1' }], meds: [{ id: 'm1', babyId: 'b1' }, { id: 'm2' }, { id: 'm3', subject: { kind: 'baby', id: undefined } }] });
  const m = nb.state.meds;
  ok('a medicine with a babyId still names its baby', S0(m[0].subject) === S0({ kind: 'baby', id: 'b1' }), m[0].subject);
  ok('one without gets a subject with no id at all', S0(m[1].subject) === S0({ kind: 'baby' }) && !('id' in m[1].subject), m[1].subject);
  ok('an older build\'s id:undefined is repaired', !('id' in m[2].subject), m[2].subject);
  ok('nothing undefined is left anywhere in the medicines', !hasUndefined(m));
  const again = S0(m); nb.normalizeLoadedState(nb.state);
  ok('and it is idempotent', S0(nb.state.meds) === again);
}
}
const missing = parts.filter((p) => !p[1]).map((p) => p[0]);
ok('app/store-firebase.js has every function this judges', !missing.length, missing);
if (missing.length) { console.log('\n' + pass + ' passed, ' + fail + ' failed\nBLOB-MERGE: FAIL'); process.exit(1); }

const sb = {
  state: {}, blobBase: null, pushTimer: null, pushWhenHydrated: false,
  legacyBlobPreg: null, legacyBlobPresent: [], LEGACY_BLOB_KEYS: ['pregnancy', 'mhealth', 'maternalHealth'],
  ing: () => ({ blob: (a) => a }), applyTheme: () => {}, uid: () => 'u' + Math.random().toString(36).slice(2, 8),
};
vm.createContext(sb);
vm.runInContext(parts.map((p) => p[1]).join('\n') + '\n' + (norm || ''), sb); // applyAppBlob runs the real normalizeLoadedState
const S = (x) => sb.stableStringify(x);
const clone = (x) => JSON.parse(JSON.stringify(x));
const merge = (b, l, r) => sb.mergeBlobValue(b, l, r);
const ids = (a) => (a || []).map((x) => x.id).join(',');

console.log('\n2. lists of records merge record by record');
{
  const A = { id: 'a', n: 1 }, B = { id: 'b', n: 1 };
  let m = merge([A], [A, { id: 'l', n: 1 }], [A, { id: 'r', n: 1 }]);
  ok('a record added on each side: both kept, the server\'s order first', ids(m) === 'a,r,l', m);
  m = merge([A, B], [A], [A, B]);
  ok('deleted here, untouched there: deleted', ids(m) === 'a', m);
  m = merge([A, B], [A, B], [A]);
  ok('deleted there, untouched here: deleted', ids(m) === 'a', m);
  m = merge([A, B], [{ id: 'a', n: 7 }, B], [{ id: 'a', n: 5 }, { id: 'b', n: 9 }]);
  ok('both changed the same record: this phone wins it, whole', m.find((x) => x.id === 'a').n === 7, m);
  ok('and the record only the other phone changed is theirs', m.find((x) => x.id === 'b').n === 9, m);
  m = merge([A, B], [{ id: 'a', n: 7 }, B], [B]);
  ok('changed here, deleted there: this phone wins, the record stays', ids(m) === 'b,a', m);
  m = merge([A, B], [A, B], [{ id: 'a', n: 2 }, B, { id: 'c' }]);
  ok('untouched here: exactly the server\'s list', S(m) === S([{ id: 'a', n: 2 }, B, { id: 'c' }]), m);
  m = merge(['x'], ['x', 'y'], ['x', 'z']);
  ok('a list without ids cannot be merged by record: this phone\'s list', S(m) === S(['x', 'y']), m);
  m = merge([A], [A, { id: 'a', n: 3 }], [A, { id: 'r' }]);
  ok('two records sharing an id: no merge, this phone\'s list', S(m) === S([A, { id: 'a', n: 3 }]), m);
  ok('ids are whole: 1 and "1" are different records', ids(merge([], [{ id: 1 }], [{ id: '1' }])) === '1,1');
}

console.log('\n3. everything else merges where the two phones changed different things');
{
  let m = merge({}, { bpip: {} }, { bpip: { sleep: { start: 5 } } });
  ok('an empty timers entry the render made does not stop the other phone\'s nap', S(m) === S({ bpip: { sleep: { start: 5 } } }), m);
  m = merge({ bpip: { sleep: { start: 5 } } }, { bpip: { sleep: { start: 5 } } }, { bpip: {} });
  ok('a timer the other phone stopped stays stopped', S(m) === S({ bpip: {} }), m);
  m = merge({ unit: 'ml', wUnit: 'kg' }, { unit: 'oz', wUnit: 'kg' }, { unit: 'ml', wUnit: 'lb' });
  ok('a setting each: both kept', S(m) === S({ unit: 'oz', wUnit: 'lb' }), m);
  m = merge({ unit: 'ml' }, { unit: 'oz' }, { unit: 'ml', extra: 1 });
  ok('a key only the server added is kept', S(m) === S({ unit: 'oz', extra: 1 }), m);
  m = merge({ unit: 'ml', gone: 1 }, { unit: 'oz', gone: 1 }, { unit: 'ml' });
  ok('a key only the server deleted stays deleted', S(m) === S({ unit: 'oz' }), m);
  m = merge({ v: 1 }, { v: 2 }, { v: 3 });
  ok('the same value changed on both: this phone wins', S(m) === S({ v: 2 }), m);
  m = merge({ chores: [{ id: 'c1' }] }, { chores: [{ id: 'c1' }, { id: 'c2' }] }, { chores: [{ id: 'c1' }, { id: 'c3' }] });
  ok('records nested inside a map merge by record too', ids(m.chores) === 'c1,c3,c2', m);
  ok('local untouched: the server\'s value, even its delete', merge({ a: 1 }, { a: 1 }, undefined) === undefined);
}

console.log('\n4. the snapshot handler\'s own sequence, with the real applyAppBlob');
function snapshot(server) { // exactly the order the onSnapshot handler runs them in
  const held = sb.holdPendingBlobEdits();
  sb.applyAppBlob(clone(server));
  const kept = held ? sb.reapplyPendingBlobEdits(held) : null;
  sb.blobBase = sb.snapshotBlobBase();
  if (kept) Object.keys(kept).forEach((k) => { sb.blobBase[k] = kept[k]; });
}
const dirtyKeys = () => { const b = sb.appBlobFromState(); return Object.keys(b).filter((k) => sb.blobBase[k] !== S(b[k])); };
{
  const server0 = { babies: [{ id: 'bpip', name: 'Pip' }], meds: [{ id: 'm0' }], settings: { unit: 'ml' }, timers: {}, vaccines: {} };
  sb.state = { settings: { theme: 'night', push: { on: true } } };
  sb.pushTimer = null; snapshot(server0);
  ok('first snapshot: nothing to push', dirtyKeys().length === 0, dirtyKeys());
  ok('per-device theme and push survive the apply', sb.state.settings.theme === 'night' && sb.state.settings.push.on === true);

  // Nina adds a medicine; the push is pending (debounce). Her render also made an empty timers entry.
  sb.state.meds.push({ id: 'mN' }); sb.state.timers.bpip = {}; sb.pushTimer = 1;
  // Olive's write arrives: her medicine and her nap timer.
  const server1 = clone(server0); server1.meds.push({ id: 'mO' }); server1.timers = { bpip: { sleep: { start: 9 } } };
  snapshot(server1);
  ok('Nina\'s pending medicine is still in her state', ids(sb.state.meds) === 'm0,mO,mN', sb.state.meds);
  ok('and still dirty, so the pending push writes it', dirtyKeys().indexOf('meds') >= 0, dirtyKeys());
  ok('Olive\'s nap timer applies, Nina\'s empty entry did not hide it', !!(sb.state.timers.bpip && sb.state.timers.bpip.sleep));
  ok('and timers are not dirty, so Nina\'s push cannot stop the nap', dirtyKeys().indexOf('timers') < 0, dirtyKeys());
  ok('per-device theme and push are still hers', sb.state.settings.theme === 'night' && sb.state.settings.push.on === true);

  // The push lands (baseline advances as pushNow's .then does), then the echo arrives.
  const b = sb.appBlobFromState(); Object.keys(b).forEach((k) => { sb.blobBase[k] = S(b[k]); }); sb.pushTimer = null;
  const server2 = clone(server1); server2.meds = clone(sb.state.meds);
  snapshot(server2);
  ok('after the echo nothing is dirty', dirtyKeys().length === 0, dirtyKeys());

  // A pending settings edit keeps the local value, and the per-device fields.
  sb.state.settings.unit = 'oz'; sb.pushTimer = 1;
  const server3 = clone(server2); server3.settings = { unit: 'ml', wUnit: 'lb' };
  snapshot(server3);
  ok('a pending settings edit is kept, the other phone\'s setting arrives', sb.state.settings.unit === 'oz' && sb.state.settings.wUnit === 'lb', sb.state.settings);
  ok('settings stay dirty, and theme/push are still per-device', dirtyKeys().indexOf('settings') >= 0 && sb.state.settings.theme === 'night', sb.state.settings);

  // Control: with no push pending the server's copy wins, as it always did.
  sb.pushTimer = null; sb.state.meds.push({ id: 'unsaved' });
  snapshot(server3);
  ok('no push pending: the server\'s copy is applied as before', ids(sb.state.meds) === ids(server3.meds), sb.state.meds);
}

console.log('\n4b. two snapshots land inside ONE pending window (review A-V1)');
/* Nina's push stays pending (she keeps editing, or she is waiting out a retry) while TWO of Olive's
   saves arrive. Merged against the baseline from before the first one, Olive's second version of a
   record looked changed on both sides, so Nina's copy of the first version won and was pushed over it,
   and a record Olive added and then deleted looked added on Nina's side and came back. */
function pushAll() { // pushNow's dirty check, and its baseline advance once the write lands
  const b = sb.appBlobFromState(), out = {};
  Object.keys(b).forEach((k) => { if (sb.blobBase[k] !== S(b[k])) { out[k] = clone(b[k]); sb.blobBase[k] = S(b[k]); } });
  sb.pushTimer = null;
  return out;
}
const doses = (list) => (list || []).map((m) => m.id + ':' + m.dose).join(',');
{
  const P = { type: 'asNeeded' };
  const s0 = { babies: [{ id: 'bpip' }, { id: 'btwin' }], meds: [{ id: 'mX', dose: '1', pattern: P }, { id: 'mK', dose: '1', pattern: P }], settings: {}, timers: {}, vaccines: {} };
  sb.state = { settings: {} }; sb.blobBase = null; sb.pushTimer = null; snapshot(s0);
  // Nina adds a medicine (her render also made an empty timers entry); her push is pending.
  sb.state.meds.push({ id: 'mN', dose: '2', pattern: P }); sb.state.timers.btwin = {}; sb.pushTimer = 1;
  // Olive: dose 1 -> 2, adds mY, starts Pip's nap (snapshot 1), then dose 2 -> 3, deletes mY, stops the nap (snapshot 2).
  const s1 = clone(s0); s1.meds[0].dose = '2'; s1.meds.push({ id: 'mY', dose: '1', pattern: P }); s1.timers = { bpip: { sleep: { start: 5 } } };
  snapshot(s1);
  ok('after the first: Nina sees Olive\'s dose 2 and her new medicine, and keeps her own', doses(sb.state.meds) === 'mX:2,mK:1,mY:1,mN:2', doses(sb.state.meds));
  const s2 = clone(s1); s2.meds[0].dose = '3'; s2.meds = s2.meds.filter((m) => m.id !== 'mY'); s2.timers = { bpip: {} };
  snapshot(s2);
  ok('after the second: Nina sees Olive\'s LATEST dose (3)', doses(sb.state.meds).indexOf('mX:3') >= 0, doses(sb.state.meds));
  ok('and the medicine Olive deleted is gone from her screen', !sb.state.meds.some((m) => m.id === 'mY'), doses(sb.state.meds));
  ok('and Pip\'s nap is stopped on her screen', !(sb.state.timers.bpip && sb.state.timers.bpip.sleep), sb.state.timers);
  const wrote = pushAll();
  ok('Nina\'s push carries her own medicine', (wrote.meds || []).some((m) => m.id === 'mN'), doses(wrote.meds));
  ok('and Olive\'s latest dose (3), not the 2 it replaced', (wrote.meds || []).some((m) => m.id === 'mX' && m.dose === '3'), doses(wrote.meds));
  ok('and does not bring back the medicine Olive deleted', !(wrote.meds || []).some((m) => m.id === 'mY'), doses(wrote.meds));
  ok('and does not restart the nap Olive stopped', !(wrote.timers && wrote.timers.bpip && wrote.timers.bpip.sleep), wrote.timers);
  // A third snapshot in the window, where both phones changed the same medicine: still this phone's.
  sb.state.meds.find((m) => m.id === 'mN').dose = '4'; sb.pushTimer = 1;
  const s3 = clone(s2); s3.meds = clone(wrote.meds); s3.meds.find((m) => m.id === 'mN').dose = '9'; s3.meds.find((m) => m.id === 'mK').dose = '6';
  snapshot(s3);
  const w3 = pushAll();
  ok('when both changed the same medicine, this phone\'s edit still wins it', (w3.meds || []).some((m) => m.id === 'mN' && m.dose === '4'), doses(w3.meds));
  ok('and the other phone\'s edit to another medicine is kept', (w3.meds || []).some((m) => m.id === 'mK' && m.dose === '6') && (w3.meds || []).some((m) => m.id === 'mX' && m.dose === '3'), doses(w3.meds));
}

console.log('\n5. app/store-firebase.js is wired that way');
{
  const h = STORE.indexOf('var held = holdPendingBlobEdits();');
  const a = STORE.indexOf('applyingRemote = true; applyAppBlob(d.app); applyingRemote = false;');
  const r = STORE.indexOf('var keptBase = held ? reapplyPendingBlobEdits(held) : null;');
  const s = STORE.indexOf('blobBase = snapshotBlobBase();', r);
  const k = STORE.indexOf('if (keptBase) Object.keys(keptBase).forEach(function (k) { blobBase[k] = keptBase[k]; });');
  ok('pending edits are held BEFORE the server\'s copy is applied', h > 0 && a > h, { h, a });
  ok('and put back right after it', r > a && r - a < 200, { a, r });
  ok('held keys take the server\'s copy as their baseline, AFTER the baseline is taken', s > r && k > s, { r, s, k });
  ok('the timers-only special case is gone', !/if \(!pushTimer\) state\.timers/.test(STORE));
  ok('a synchronous throw from update() becomes a rejected write', /try \{ hhWrite = hhRef\.update\(upd\); \} catch \(e\) \{ hhWrite = Promise\.reject\(e\); \}/.test(STORE));
  const mig = lift(STORE, 'maybeMigrateLegacyJourney') || '';
  ok('the legacy journey move deletes every legacy key still present', /legacyBlobPresent\.slice\(\)/.test(mig) && /FieldValue\.delete\(\)/.test(mig));
  ok('and only after her journey is confirmed on the server', mig.indexOf("get({ source: 'server' })") > 0 && mig.indexOf("get({ source: 'server' })") < mig.indexOf('FieldValue.delete()'));
  ok('and a move the server does not confirm stops before the strip', /if \(still\.length\) throw/.test(mig) && mig.indexOf('if (still.length) throw') < mig.indexOf('FieldValue.delete()'));
}

console.log('\n6. a legacy journey is moved only by the phone whose move it is (review A-V4)');
/* The move lands her journey and health in the PRIVATE docs of whoever runs it, and then strips the
   shared copy. Run by the wrong owner, it hides a co-owner's own pregnancy from her for good. */
{
  const fn = lift(STORE, 'legacyJourneyMovedHere');
  ok('app/store-firebase.js has legacyJourneyMovedHere', !!fn);
  if (fn) {
    const lj = {}; vm.createContext(lj); vm.runInContext(fn, lj);
    const M = { olive: 'owner', nina: 'caregiver', omar: 'owner' };
    const here = (legacy, uid, role) => lj.legacyJourneyMovedHere(legacy, uid, role, M);
    ok('it names a caregiver in the circle: the owner\'s phone leaves it alone', here({ ownerUid: 'nina' }, 'olive', 'owner') === false);
    ok('and her own phone moves it, though she is not an owner', here({ ownerUid: 'nina' }, 'nina', 'caregiver') === true);
    ok('it names a co-owner: the other owner\'s phone leaves it alone', here({ ownerUid: 'omar' }, 'olive', 'owner') === false);
    ok('and the co-owner it names moves it', here({ ownerUid: 'omar' }, 'omar', 'owner') === true);
    ok('it names this owner: she moves it', here({ ownerUid: 'olive' }, 'olive', 'owner') === true);
    ok('it names nobody: the household owner moves it, as before', here({ stage: 'pregnant' }, 'olive', 'owner') === true);
    ok('and a caregiver does not', here({ stage: 'pregnant' }, 'nina', 'caregiver') === false);
    ok('"local" is nobody', here({ ownerUid: 'local' }, 'olive', 'owner') === true && here({ ownerUid: 'local' }, 'nina', 'caregiver') === false);
    ok('someone who has left the circle is nobody', here({ ownerUid: 'gone' }, 'olive', 'owner') === true && here({ ownerUid: 'gone' }, 'nina', 'caregiver') === false);
    ok('a name that is only on Object.prototype is nobody', here({ ownerUid: 'constructor' }, 'olive', 'owner') === true);
    ok('an empty legacy key: the household owner, as before', here(null, 'olive', 'owner') === true && here(null, 'nina', 'caregiver') === false);
    const mig = lift(STORE, 'maybeMigrateLegacyJourney') || '';
    const at = mig.indexOf('legacyJourneyMovedHere(');
    ok('the move asks it before anything is marked done or read', at > 0 && at < mig.indexOf('pregMigrated = true') && at < mig.indexOf('readServer()'), at);
    ok('and no owner-only check stops the member it names', !/window\.LL\.role !== 'owner'\) return/.test(mig));
  }
}

(async () => {
console.log('\n6b. a phone that may not move a legacy journey never drops it, so no waiting retry strips it unmoved (review A-V5)');
/* The owner's move fails once (a flaky read), so a retry waits. The member the legacy copy names then comes
   back into the circle, and the next snapshot finds it is not the owner's move any more. That skip used to
   drop the stashed copy; the waiting retry then saw no copy, took it for "a legacy key with nothing in it",
   and deleted app.pregnancy without moving her journey or her health anywhere. Run on the REAL function,
   with the household doc, the server reads and the retry timer stubbed. */
{
  const mm = lift(STORE, 'maybeMigrateLegacyJourney'), lj = lift(STORE, 'legacyJourneyMovedHere');
  ok('app/store-firebase.js has maybeMigrateLegacyJourney and legacyJourneyMovedHere', !!mm && !!lj);
  const flush = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };
  const run = (opts) => {
    const updates = [], timers = [], server = { up: !!opts.up, journey: !!opts.journey, cats: opts.cats || {} };
    const snap = (exists, data) => ({ exists, data: () => (exists ? data : undefined) });
    const docRef = (p) => ({
      path: p,
      get: () => {
        if (!server.up) return Promise.reject(Object.assign(new Error('staged unavailable'), { code: 'unavailable' }));
        if (/\/pregnancy\/[^/]+$/.test(p)) return Promise.resolve(snap(server.journey, { ownerUid: opts.uid, data: {} }));
        const c = p.split('/').pop();
        return Promise.resolve(snap(!!server.cats[c], { data: server.cats[c] || {} }));
      },
      collection: (c) => ({ doc: (d) => docRef(p + '/' + c + '/' + d) }),
    });
    const ctx = {
      pregMigrated: false, legacyBlobPresent: ['pregnancy'], legacyBlobPreg: clone(opts.legacy), pregOwner: null,
      state: {}, pregShared: [], knownPregJourney: null, knownMat: {}, applyingRemote: false,
      MAT_CATS: { health: ['weights', 'bp'], careteam: ['careTeam'], conditions: ['conditions'], mood: ['moodLog'] },
      auth: { currentUser: { uid: opts.uid } },
      window: { LL: { role: opts.role, members: clone(opts.members), serverTimestamp: () => 'TS' } },
      firebase: { firestore: { FieldValue: { delete: () => 'DELETE' } } },
      hhRef: { path: 'households/h1', collection: (c) => ({ doc: (d) => docRef('households/h1/' + c + '/' + d) }), update: (u) => { updates.push(u); return Promise.resolve(); } },
      ensureMaternalListeners() {}, applyPregJourney() {}, applyMatDoc() {}, scheduledPush() {},
      syncPregJourney: () => Promise.resolve(), syncMaternal: () => Promise.resolve(),
      console: { warn() {}, log() {} }, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, Promise,
    };
    vm.createContext(ctx); vm.runInContext(lj + '\n' + mm, ctx);
    return { ctx, updates, timers, server, strips: () => updates.filter((u) => u['app.pregnancy'] === 'DELETE').length };
  };
  if (mm && lj) {
    // The control: the matcher below can see a strip. Named nobody, already moved: only the strip is owed.
    const c = run({ uid: 'olive', role: 'owner', members: { olive: 'owner' }, up: true, journey: true, cats: { health: { bp: [1] }, careteam: { careTeam: [1] } }, legacy: { stage: 'pregnant', bp: [1], careTeam: [1] } });
    c.ctx.maybeMigrateLegacyJourney(); await flush();
    ok('(control) a copy that names nobody and is already moved is stripped by the owner', c.strips() === 1, c.updates);
    // The attack.
    const legacy = { ownerUid: 'xena', stage: 'pregnant', dueDate: 1, bp: [{ id: 'b1' }], careTeam: [{ id: 'c1' }] };
    const a = run({ uid: 'olive', role: 'owner', members: { olive: 'owner', nina: 'caregiver' }, up: false, legacy });
    a.ctx.maybeMigrateLegacyJourney(); await flush();
    ok('her move fails on a flaky read: nothing stripped, a retry waits', a.strips() === 0 && a.timers.length === 1 && a.ctx.pregMigrated === false, { strips: a.strips(), timers: a.timers.length });
    a.ctx.window.LL.members.xena = 'caregiver'; // the member the copy names comes back into the circle
    a.ctx.maybeMigrateLegacyJourney(); await flush(); // her snapshot: not the owner's move any more
    ok('the snapshot after she is back moves nothing and strips nothing', a.strips() === 0);
    a.server.up = true; a.timers[0].fn(); await flush(); // the waiting retry
    ok('and the retry that was already waiting does not strip her copy unmoved', a.strips() === 0, a.updates);
    ok('the copy is still held for her own phone to move', !!a.ctx.legacyBlobPreg && a.ctx.legacyBlobPreg.ownerUid === 'xena', a.ctx.legacyBlobPreg);
  }
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
console.log(fail ? 'BLOB-MERGE: FAIL' : 'BLOB-MERGE: PASS');
process.exit(fail ? 1 : 0);
})();
