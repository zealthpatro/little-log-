/* A quick close keeps what she just logged, judged on the REAL functions (chaos CH-bd7f70).
 *
 * test/quick-close-emulator.test.js proves it end to end (a reload 40 ms after an entry, a phone that
 * ends the app 100 ms after she switches away), but the emulator tier is not run by the pre-push hook.
 * This is the tree-tier half. It lifts the functions out of app/store-firebase.js by name (no mirror that
 * can drift), runs them in a sandbox with Firestore stubbed, and checks:
 *   1  the wiring: pagehide (before Firestore's own handler) and visibilitychange send the waiting push
 *      and store the outbox; visible again clears it; the boot reads it back; sign-out clears it
 *   2  a page torn down inside the 350 ms debounce: the real pushNow issues the writes AND the outbox
 *      holds every entry write not yet acknowledged and every blob key whose push has not landed
 *   3  the next boot puts back only what has not moved: never a write Firestore kept, never a change
 *      made elsewhere since; an edit and a delete that never landed are put back
 *   4  a second write of one entry takes the acknowledged first as its base; visible again clears it
 *   5  the outbox empties as the writes land (2b), and nothing is stored when nothing is owed
 *
 *   node test/quick-close.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

const STORE = fs.readFileSync(path.join(__dirname, '..', 'app', 'store-firebase.js'), 'utf8');
// The whole `function name(...) {...}` declaration, by brace matching (the result is compiled, so a bad
// cut fails loudly).
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
const NAMES = ['stableStringify', 'sharedSettings', 'appBlobFromState', 'stripMeta', 'hhSig', 'holdPendingBlobEdits', 'pushNow',
  'evCanon', 'noteEvWrite', 'settleEvWrite', 'outboxKey', 'buildOutbox', 'saveOutbox', 'dropOutbox', 'readOutbox',
  'replayOutboxEvents', 'flushPendingPush', 'flushOnPageHide'];
const parts = NAMES.map((n) => [n, lift(STORE, n)]);
const missing = parts.filter((p) => !p[1]).map((p) => p[0]);
ok('app/store-firebase.js has every function this judges', !missing.length, missing);
if (missing.length) { console.log('\n' + pass + ' passed, ' + fail + ' failed\nQUICK-CLOSE: FAIL'); process.exit(1); }
const SRC = parts.map((p) => p[1]).join('\n');
const clone = (x) => JSON.parse(JSON.stringify(x));
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };

/* A phone: the real functions, with the household doc, the entries collection, localStorage, the
   clock and the page events stubbed. Every write stays pending until the test lets it land. */
function phone(opts) {
  opts = opts || {};
  const writes = [], store = new Map(opts.storage || []), listeners = [];
  const pending = (rec) => new Promise((res, rej) => { rec.land = res; rec.refuse = rej; writes.push(rec); });
  const ctx = {
    state: clone(opts.state || { events: [], meds: [], babies: [], settings: {} }),
    knownEvents: clone(opts.knownEvents || {}), unackedEv: {}, blobOut: 0, outboxSaved: false, replayEv: null, replayHold: null,
    blobBase: opts.blobBase === undefined ? null : clone(opts.blobBase),
    pushTimer: null, pushWhenHydrated: false, hhHydrated: opts.hydrated !== false, lastHhSig: null, pregOwner: null,
    auth: { currentUser: { uid: 'olive' } },
    window: { LL: { role: 'owner', members: { olive: 'owner' }, memberInfo: {}, serverTimestamp: () => 'TS' }, toast() {} },
    navigator: { onLine: true },
    hhRef: { id: 'h1', update: (upd) => pending({ kind: 'blob', upd }) },
    eventsRef: { doc: (id) => ({ set: (d) => pending({ kind: 'set', id, d }), delete: () => pending({ kind: 'delete', id }) }) },
    docKey: (id) => String(id),
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); },
    },
    ensureMaternalListeners() {}, syncPregJourney: () => Promise.resolve(), syncMaternal: () => Promise.resolve(), syncPregArchive: () => Promise.resolve(),
    setTimeout: () => 99, clearTimeout() {}, console: { warn() {}, log() {} }, Promise, JSON, Object, Date, Math, String,
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const win = { addEventListener: (t, fn, cap) => listeners.push({ on: 'window', t, fn, cap: cap === true || !!(cap && cap.capture) }) };
  const doc = { visibilityState: 'visible', addEventListener: (t, fn, cap) => listeners.push({ on: 'document', t, fn, cap: cap === true || !!(cap && cap.capture) }) };
  ctx.flushOnPageHide(win, doc);
  const fire = (on, t) => listeners.filter((l) => l.on === on && l.t === t).forEach((l) => l.fn({ type: t }));
  return {
    ctx, writes, store, listeners, doc,
    pagehide: () => fire('window', 'pagehide'),
    hide: () => { doc.visibilityState = 'hidden'; fire('document', 'visibilitychange'); },
    show: () => { doc.visibilityState = 'visible'; fire('document', 'visibilitychange'); },
    outbox: () => { const v = store.get('cubby-outbox:olive:h1'); return v ? JSON.parse(v) : null; },
  };
}
const S = (x) => JSON.stringify(x);
const MED = { id: 'mA', name: 'Calpol', dose: '2.5', unit: 'ml', babyId: 'bpip' };
const OLD = { id: 'e0', type: 'feed', time: 1000, amount: 60 };
const base = (p) => { const b = {}; const a = p.ctx.appBlobFromState(); Object.keys(a).forEach((k) => { b[k] = p.ctx.stableStringify(a[k]); }); return b; };

(async () => {
console.log('\n1. the wiring');
{
  const p = phone();
  const ph = p.listeners.filter((l) => l.on === 'window' && l.t === 'pagehide');
  ok('pagehide sends the waiting push', ph.length === 1 && ph[0].fn === p.ctx.flushPendingPush, ph.length);
  ok('in the capture phase, so it runs before Firestore\'s own pagehide handler queues its shutdown', ph.length === 1 && ph[0].cap, ph.map((l) => l.cap));
  ok('visibilitychange is listened to as well', p.listeners.some((l) => l.on === 'document' && l.t === 'visibilitychange'));
  ok('and the page is wired at load: flushOnPageHide(window, document)', /\n\s*flushOnPageHide\(window, document\);/.test(STORE));
  const ss = lift(STORE, 'startSync') || '';
  ok('the boot reads the outbox for this person and household', /readOutbox\(user\.uid, hid\)/.test(ss));
  ok('the first entries snapshot puts the entries back', /replayOutboxEvents\(/.test(ss));
  const hold = ss.indexOf('holdPendingBlobEdits()'), merged = ss.indexOf('replayHold', hold), apply = ss.indexOf('applyAppBlob(d.app)', hold);
  ok('the first household snapshot holds the blob edits BEFORE the server\'s copy is applied, like any pending edit', hold > 0 && merged > hold && merged < apply, { hold, merged, apply });
  const pn = lift(STORE, 'pushNow');
  ok('pushNow notes each entry write before issuing it and settles it when the server answers', /noteEvWrite\(id, knownEvents\[id\]\)[\s\S]*?settleEvWrite\(id, n, ser\)/.test(pn) && /noteEvWrite\(id, oldSer\)[\s\S]*?settleEvWrite\(id, n, undefined\)/.test(pn));
  ok('sign-out clears it (teardown)', /dropOutbox\(auth\.currentUser\.uid, hhRef\.id\)/.test(lift(STORE, 'teardown') || ''));
}

console.log('\n2. she logs an entry and adds a medicine, and the page is torn down before the push');
let saved;
{
  const p = phone({ state: { events: [clone(OLD)], meds: [], babies: [], settings: {} }, knownEvents: { e0: S(OLD) } });
  p.ctx.blobBase = base(p);
  const ev = { id: 'eA', type: 'diaper', kind: 'wet', time: 5000, authorId: 'olive' };
  p.ctx.state.events.push(ev); p.ctx.state.meds.push(clone(MED));
  p.ctx.pushTimer = 7; // persist() armed the 350 ms push
  const held = p.ctx.holdPendingBlobEdits(); // what a snapshot would hold right now
  p.pagehide();
  ok('the waiting push goes now: the entry write is issued', p.writes.some((w) => w.kind === 'set' && w.id === 'eA'), p.writes.map((w) => w.kind + ':' + (w.id || '')));
  ok('and the blob write with the medicine', p.writes.some((w) => w.kind === 'blob' && S((w.upd['app.meds'] || []).map((m) => m.id)) === '["mA"]'));
  ok('and the timer is spent', p.ctx.pushTimer === null);
  saved = p.outbox();
  ok('an outbox is stored, for this person and this household', !!saved && saved.v === 1, [...p.store.keys()]);
  ok('it holds the entry, as it was never on the server (base null)', !!saved && saved.events.eA && saved.events.eA.baseSer === null && saved.events.eA.evData.kind === 'wet', saved && saved.events);
  ok('and not the entry the server already holds', !!saved && !('e0' in saved.events), saved && Object.keys(saved.events));
  ok('it holds the medicine exactly as a snapshot would hold it (base, local, blobValue)', !!saved && !!held && S(saved.blob.meds) === S(clone(held.meds)), { saved: saved && saved.blob, held });
  ok('and no blob key nobody changed', !!saved && S(Object.keys(saved.blob)) === '["meds"]', saved && Object.keys(saved.blob));

  console.log('\n2b. it empties as the writes land');
  const land = (w) => { if (w) w.land(); };
  land(p.writes.find((w) => w.kind === 'set' && w.id === 'eA')); await settle();
  ok('the entry is acknowledged: it leaves the outbox, the medicine stays', !!p.outbox() && !p.outbox().events.eA && !!p.outbox().blob.meds, p.outbox());
  land(p.writes.find((w) => w.kind === 'blob')); await settle();
  ok('the medicine lands too: nothing is stored any more', p.outbox() === null, p.outbox());
}

console.log('\n3. the next boot puts back only what has not moved');
{
  if (!saved || !saved.events || !saved.events.eA) saved = { events: { eA: { baseSer: null, evData: { id: 'eA', kind: 'wet' } } }, blob: {} }; // judged anyway, on what section 2 should have stored
  const boot = (knownEvents, events) => { const p = phone({ knownEvents, state: { events: clone(events || []), meds: [], babies: [], settings: {} } }); return p; };
  let p = boot({}, []);
  ok('the entry the server never got (and this phone\'s cache does not hold) is put back', p.ctx.replayOutboxEvents(clone(saved.events)) === 1 && p.ctx.state.events.some((e) => e.id === 'eA' && e.kind === 'wet'), p.ctx.state.events);
  const ours = saved.events.eA.evData;
  p = boot({ eA: S(ours) }, [ours]);
  ok('a write Firestore did keep (the cache shows it) is not put back a second time', p.ctx.replayOutboxEvents(clone(saved.events)) === 0 && p.ctx.state.events.length === 1);
  const theirs = Object.assign({}, ours, { kind: 'dirty', notes: 'Nina' });
  p = boot({ eA: S(theirs) }, [theirs]);
  ok('a version written elsewhere since is not overwritten', p.ctx.replayOutboxEvents(clone(saved.events)) === 0 && p.ctx.state.events[0].notes === 'Nina', p.ctx.state.events);
  // An edit (moved to recently deleted) and a hard delete, both torn down before the push.
  const q = phone({ state: { events: [clone(OLD), { id: 'e1', type: 'feed', time: 2000 }], meds: [], babies: [], settings: {} }, knownEvents: { e0: S(OLD), e1: S({ id: 'e1', type: 'feed', time: 2000 }) } });
  q.ctx.blobBase = base(q);
  q.ctx.state.events[0].deleted = true;
  q.ctx.state.events = q.ctx.state.events.filter((e) => e.id !== 'e1');
  q.ctx.pushTimer = 7; q.pagehide();
  const ob = q.outbox();
  ok('(the edit and the delete are both in the outbox, each with the server\'s version as its base)', !!ob && !!ob.events.e0 && ob.events.e0.evData.deleted === true && !!ob.events.e1 && ob.events.e1.evData === null && !!ob.events.e1.baseSer, ob && ob.events);
  const obX = (ob && ob.events && ob.events.e0 && ob.events.e1) ? ob : { events: { // judged anyway, on what should have been stored
    e0: { baseSer: q.ctx.stableStringify(OLD), evData: Object.assign(clone(OLD), { deleted: true }) }, e1: { baseSer: q.ctx.stableStringify({ id: 'e1', type: 'feed', time: 2000 }), evData: null } } };
  p = boot({ e0: S(OLD), e1: S({ id: 'e1', type: 'feed', time: 2000 }) }, [clone(OLD), { id: 'e1', type: 'feed', time: 2000 }]);
  ok('the edit whose copy here still equals its base is put back', p.ctx.replayOutboxEvents(clone(obX.events)) === 2 && p.ctx.state.events.find((e) => e.id === 'e0').deleted === true);
  ok('and the delete that never landed is put back', !p.ctx.state.events.some((e) => e.id === 'e1'), p.ctx.state.events);
  const edited = Object.assign({}, OLD, { amount: 90 });
  p = boot({ e0: S(edited) }, [edited]);
  ok('an entry another phone edited since is left as it is', p.ctx.replayOutboxEvents({ e0: obX.events.e0 }) === 0 && !p.ctx.state.events[0].deleted && p.ctx.state.events[0].amount === 90, p.ctx.state.events);
  ok('a stored outbox of another shape is ignored', phone({ storage: [['cubby-outbox:olive:h1', '{"v":9}']] }).ctx.readOutbox('olive', 'h1') === null);
  // Read at boot, then hidden again before its first snapshot came: what was read is not lost.
  p = phone({ knownEvents: {} });
  p.ctx.blobBase = base(p);
  p.ctx.replayEv = clone(saved.events); p.ctx.replayHold = { meds: { base: '[]', local: [clone(MED)], blobValue: [clone(MED)] } };
  p.hide();
  const carried = p.outbox();
  ok('an outbox read at boot and not put back yet is carried over if she switches away again first', !!carried && !!carried.events.eA && !!carried.blob.meds, carried);
}

console.log('\n4. a second write of the same entry, and visible again');
{
  const p = phone({ state: { events: [clone(OLD)], meds: [], babies: [], settings: {} }, knownEvents: { e0: S(OLD) } });
  p.ctx.blobBase = base(p);
  p.ctx.state.events[0].amount = 70; p.ctx.pushTimer = 7; p.hide();
  ok('(she switches away: the waiting push goes now)', p.writes.filter((w) => w.kind === 'set').length === 1 && !!p.outbox());
  p.show();
  ok('visible again: the outbox goes, the page is the record', p.outbox() === null && p.ctx.outboxSaved === false);
  p.ctx.state.events[0].amount = 80; p.ctx.pushTimer = 7; p.pagehide();
  ok('(a second edit of it goes out while the first is still unacknowledged; its base is still the server\'s first version)', p.writes.filter((w) => w.kind === 'set').length === 2 && !!p.outbox() && p.outbox().events.e0.baseSer === p.ctx.stableStringify(OLD), p.outbox());
  const first = p.writes.filter((w) => w.kind === 'set')[0]; if (first) first.land(); await settle();
  const b = p.outbox() && p.outbox().events.e0 && p.outbox().events.e0.baseSer;
  ok('once the first is acknowledged, the server holds 70, and that is the second write\'s base', !!b && JSON.parse(b).amount === 70, b);
}

console.log('\n5. nothing owed, nothing stored');
{
  const p = phone({ state: { events: [clone(OLD)], meds: [], babies: [], settings: {}, timers: {} }, knownEvents: { e0: S(OLD) } });
  p.ctx.blobBase = base(p);
  p.ctx.state.timers = { bpip: {} }; // render code adds an empty timer entry without a save
  p.store.set('cubby-outbox:olive:h1', '{"v":1,"events":{},"blob":{}}');
  p.hide();
  ok('with no push waiting or out, a key that merely differs is not an edit: no outbox', p.outbox() === null, p.outbox());
  ok('and nothing was written', p.writes.length === 0, p.writes.length);
  const u = phone({ hydrated: false });
  u.ctx.state.events.push({ id: 'eZ' }); u.ctx.pushTimer = 7; u.pagehide();
  ok('a phone that has not read its household yet stores nothing it could not judge', u.outbox() === null);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
console.log(fail ? 'QUICK-CLOSE: FAIL' : 'QUICK-CLOSE: PASS');
process.exit(fail ? 1 : 0);
})();
