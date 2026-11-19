process.env.TZ = 'UTC';
/* Home-screen widgets: the shared since-rules (plan 1, Section A).
 *
 *   node test/widget-snapshot.test.js
 *
 * Every assertion runs against BOTH copies, workers/shared/since-rules.mjs (imported) and the generated
 * app/since-rules.js (run in a vm with a window), and the two are compared. The app's own sinceAnchor,
 * ageString and monthiversary are lifted out of app/index.html, so a drift in either side goes red.
 * Fixtures are UTC (roadmap 2.3); monthMoments works in local time and TZ is pinned above. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 500) : '')); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (v) => Array.isArray(v) ? v.map(sorted) : (v && typeof v === 'object') ? Object.keys(v).sort().reduce((o, k) => { o[k] = sorted(v[k]); return o; }, {}) : v;
const deepEqual = (a, b) => same(sorted(a), sorted(b));

/* Lift one top-level function out of index.html (brace matching), as source text. */
function lift(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('index.html has no function ' + name);
  let j = src.indexOf('{', i), depth = 0;
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) break; }
  return src.slice(i, j + 1);
}

const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 17, 3, 14);
const U = Date.UTC;

(async () => {
  const idx = read('app/index.html');
  const mjs = await import(pathToFileURL(path.join(ROOT, 'workers/shared/since-rules.mjs')).href);
  const win = {};
  vm.runInNewContext(read('app/since-rules.js'), { window: win });
  const copies = { mjs, js: win.CubbySince };
  const copy = JSON.parse(read('docs/widgets/widget-copy.json'));

  /* Run one check against both copies; both must hold. */
  const both = (name, fn) => {
    const res = Object.keys(copies).map((k) => { try { return [k, !!fn(copies[k])]; } catch (e) { return [k, false, e.message]; } });
    ok(name, res.every((r) => r[1]), res.filter((r) => !r[1]).map((r) => r[0] + (r[2] ? ': ' + r[2] : '')).join(', '));
  };

  console.log('copies');
  ok('the browser copy defines every function, the constants and the copy map',
     ['sinceAnchor', 'babyAnchors', 'healthOpen', 'isTwins', 'ageOf', 'monthMoments', 'sleepEventId', 'snapshotBaby', 'RULES', 'DEFAULTS', 'SNAPSHOT_VERSIONS']
       .every((k) => k in win.CubbySince) && typeof win.CubbyWidgetCopy === 'object');

  // The app's own functions, lifted.
  const home = vm.runInNewContext('(' + lift(idx, 'sinceAnchor') + ')');
  const homeAge = vm.runInNewContext('const now=()=>' + NOW + ';(' + lift(idx, 'ageString') + ')');
  const appMv = (birth, at) => {
    const R = Date;
    function D(...a) { return a.length === 0 ? new R(at) : new R(...a); }
    D.prototype = R.prototype; D.now = () => at; D.parse = R.parse; D.UTC = R.UTC;
    return vm.runInNewContext('(' + lift(idx, 'monthiversary') + ')', { activeBaby: () => ({ birth }), Date: D })();
  };

  console.log('A1 sinceAnchor');
  const evs1 = [{ time: 1000, end: 5000 }, { time: 1000 }, { time: 1000, dur: 600 }, { time: 1000, dur: 0 }, { time: 1000, dur: -3 }, { time: 7, end: 0 }];
  const cases = [];
  ['sleep', 'feed', 'diaper'].forEach((t) => { evs1.forEach((ev) => cases.push({ t, ev })); cases.push({ t, ev: null }); });
  both('A1 sinceAnchor equals Home (lifted index.html:5151)', (m) => cases.every((c) => m.sinceAnchor(c.t, c.ev) === home(c.t, c.ev)));
  ok('A1 the lift is real: Home anchors a sleep at its end, a feed at its end', home('sleep', { time: 1, end: 9 }) === 9 && home('feed', { time: 1, dur: 5 }) === 6);

  console.log('A2 babyAnchors');
  const e2 = [
    { id: 'f-new', type: 'feed', babyId: 'b1', time: NOW - 1000, deleted: true },
    { id: 'f-old', type: 'feed', babyId: 'b1', time: NOW - 5000 },
    { id: 'f-other', type: 'feed', babyId: 'b2', time: NOW - 10 },
    { id: 's-open', type: 'sleep', babyId: 'b1', time: NOW - 20 },
    { id: 's-ended', type: 'sleep', babyId: 'b1', time: NOW - 9000, end: NOW - 8000 },
    { id: 'd1', type: 'diaper', babyId: 'b1', time: NOW - 7000 },
  ];
  const e2b = [
    { id: 'feed-100', type: 'feed', babyId: 'b1', time: NOW - 150 * 60000, dur: 40 * 60000 },
    { id: 'bottle-130', type: 'feed', babyId: 'b1', time: NOW - 90 * 60000 },
  ];
  both('A2 a deleted newer feed is ignored', (m) => m.babyAnchors(e2, 'b1').feed.id === 'f-old');
  both('A2 an open sleep is ignored; the ended one counts', (m) => m.babyAnchors(e2, 'b1').sleep.id === 's-ended');
  both('A2 newest by time, as Home: bottle at 1:30 beats a feed from 1:00 lasting 40 min', (m) => m.babyAnchors(e2b, 'b1').feed.id === 'bottle-130');
  both('A2 nappy found, and a baby with nothing gets nulls', (m) => m.babyAnchors(e2, 'b1').nappy.id === 'd1' && same(m.babyAnchors(e2, 'b9'), { feed: null, sleep: null, nappy: null }));
  both('A2 does not reorder the caller\'s array', (m) => { const c = e2.slice(); m.babyAnchors(c, 'b1'); return same(c, e2); });

  console.log('A3 healthOpen');
  const ill = (d, x) => [{ id: 'i1', babyId: 'b1', startedAt: NOW - d * DAY, ...x }];
  const temp = (d, x) => ({ id: 't' + d, type: 'temperature', babyId: 'b1', time: NOW - d * DAY, ...x });
  const H = (m, ills, evs, bid = 'b1') => m.healthOpen(ills, evs, bid, NOW);
  both('A3 open, started 3 days ago', (m) => H(m, ill(3), []) === true);
  both('A3 open, started 20 days ago, no entries since: Health goes back (F5)', (m) => H(m, ill(20), []) === false);
  both('A3 the same with a temperature 2 days ago', (m) => H(m, ill(20), [temp(2)]) === true);
  both('A3 a symptom and a medicine count too', (m) => H(m, ill(20), [{ ...temp(2), type: 'symptom' }]) === true && H(m, ill(20), [{ ...temp(2), type: 'medicine' }]) === true && H(m, ill(20), [{ ...temp(2), type: 'feed' }]) === false);
  both('A3 a deleted temperature does not count', (m) => H(m, ill(20), [temp(2, { deleted: true })]) === false);
  both('A3 an ended illness: false', (m) => H(m, ill(3, { endedAt: NOW - DAY }), []) === false);
  both('A3 another baby: her illness is not his, her temperature does not reopen his',
       (m) => H(m, ill(3, { babyId: 'b2' }), []) === false && H(m, ill(20), [temp(2, { babyId: 'b2' })]) === false);
  both('A3 the 14-day edge: 1 ms inside is open, exactly 14 days is closed',
       (m) => H(m, ill(0, { startedAt: NOW - 1209600000 + 1 }), []) === true && H(m, ill(0, { startedAt: NOW - 1209600000 }), []) === false);

  console.log('A4 isTwins');
  const kid = (id, birth) => ({ id, name: id, birth });
  const T = (m, a, b) => m.isTwins([kid('b1', U(2026, 10, 16, Math.floor(a / 100), a % 100)), kid('b2', U(2026, 10, 17, Math.floor(b / 100), b % 100))]);
  const base = U(2026, 10, 16, 12, 0);
  both('A4 twins born 23:50 and 00:10', (m) => T(m, 2350, 10) === true);
  both('A4 exactly 24h apart: twins; 24h + 1ms: siblings', (m) => m.isTwins([kid('b1', base), kid('b2', base + DAY)]) === true && m.isTwins([kid('b1', base), kid('b2', base + DAY + 1)]) === false);
  both('A4 three babies born together: never twins', (m) => m.isTwins([kid('b1', NOW), kid('b2', NOW), kid('b3', NOW)]) === false);
  both('A4 a missing or non-finite birth: never twins', (m) => m.isTwins([kid('b1', NOW), kid('b2', null)]) === false
    && m.isTwins([kid('b1', NOW), kid('b2', undefined)]) === false && m.isTwins([kid('b1', NOW), kid('b2', NaN)]) === false);
  both('A4 one baby: never twins', (m) => m.isTwins([kid('b1', NOW)]) === false);

  console.log('A5 ageOf');
  const pl = (a) => a.n + ' ' + a.unit + (a.n === 1 ? '' : 's') + ' old';
  const words = [];
  [0, 1, 13, 14, 59, 60, 729, 730, 800, 1500].forEach((d) => {
    const b = NOW - d * DAY;
    words.push({ d, home: homeAge(b), ours: (m) => pl(m.ageOf(b, NOW)) });
  });
  both('A5 ageOf at days 0,1,13,14,59,60,729,730 reads as ageString does', (m) => words.every((w) => w.ours(m) === w.home));
  both('A5 no birth or a birth in the future: null', (m) => m.ageOf(null, NOW) === null && m.ageOf(undefined, NOW) === null && m.ageOf(NOW + 2 * DAY, NOW) === null);

  console.log('A6 snapshotBaby');
  const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  const sb = (m, baby, extra) => m.snapshotBaby({ baby, events: [], illnesses: [], nap: null, now: NOW, label: () => null, ...extra });
  both('A6 25 emoji become 20 whole code points (Review Focus 3)', (m) => { const n = sb(m, kid('b1', NOW), {}).name.length && sb(m, { id: 'b1', name: '\u{1F600}'.repeat(25), birth: NOW }, {}).name; return Array.from(n).length === 20 && !LONE_SURROGATE.test(n); });
  both('A6 an Arabic name is kept, and trimmed', (m) => sb(m, { id: 'b1', name: '  ريم ', birth: NOW }, {}).name === 'ريم');
  both('A6 key order is the contract\'s, moments last', (m) => same(Object.keys(sb(m, kid('b1', NOW), {})), ['id', 'name', 'age', 'last', 'by', 'nap', 'healthOpen', 'moments']));
  const evs6 = [
    { id: 'f', type: 'feed', babyId: 'b1', time: NOW - 3 * 3600000, dur: 600000, authorId: 'u1' },
    { id: 's', type: 'sleep', babyId: 'b1', time: NOW - 5 * 3600000, end: NOW - 4 * 3600000, authorId: 'u2' },
  ];
  both('A6 last is the anchor, by is the label of the author, null when absent', (m) => {
    const s = sb(m, kid('b1', NOW - 30 * DAY), { events: evs6, label: (id) => (id === 'u1' ? 'Dad' : null) });
    return s.last.feed === NOW - 3 * 3600000 + 600000 && s.last.sleep === NOW - 4 * 3600000 && s.last.nappy === null
      && s.by.feed === 'Dad' && s.by.sleep === null && s.by.nappy === null;
  });
  both('A6 nap is { start, ack } when start is finite, else null', (m) => same(sb(m, kid('b1', NOW), { nap: { start: 5, ack: 9 } }).nap, { start: 5, ack: 9 })
    && same(sb(m, kid('b1', NOW), { nap: { start: 5 } }).nap, { start: 5, ack: null }) && sb(m, kid('b1', NOW), { nap: { start: 'x' } }).nap === null);

  console.log('A7 sleepEventId');
  both('A7 sleepEventId', (m) => m.sleepEventId('b1', 1700000000000) === 'sleep-b1-1700000000000');

  console.log('A8 rules');
  both('A8 RULES equal widget-copy.json, pendingMs included', (m) => deepEqual(m.RULES, copy.rules) && m.RULES.pendingMs === 10000);
  both('A8 DEFAULTS and SNAPSHOT_VERSIONS equal widget-copy.json', (m) => deepEqual(m.DEFAULTS, copy.defaults) && deepEqual(m.SNAPSHOT_VERSIONS, copy.snapshot.versions));
  ok('A8 CubbyWidgetCopy holds exactly the strings that are on "app"', deepEqual(win.CubbyWidgetCopy,
     Object.keys(copy.strings).filter((k) => copy.strings[k].on.includes('app')).reduce((o, k) => { o[k] = copy.strings[k].text; return o; }, {})));

  console.log('A9 the module stays pure');
  const dirty = (t) => /lossHolding|fetch\(/.test(t);
  ok('A9 the matcher is not blind: it finds both planted tokens', dirty('x = lossHolding') && dirty('await fetch(u)') && !dirty('const a = 1'));
  const clean = ['workers/shared/since-rules.mjs', 'workers/shared/widget-rules.mjs', 'app/since-rules.js'].every((p) => !dirty(read(p)));
  ok('A9 since-rules.mjs and widget-rules.mjs never mention lossHolding or fetch(', clean);

  console.log('A10 monthMoments (F10)');
  const MM = (m, birth, now = NOW, count) => m.monthMoments(birth, now, count);
  const ROBIN = U(2026, 7, 17, 9, 0);
  const mo = (y, m, d, unit, n) => ({ at: U(y, m, d), unit, n });
  both('A10 the day itself: month 3 today (before the birth hour), then month 4',
       (m) => same(MM(m, ROBIN), [mo(2026, 10, 17, 'month', 3), mo(2026, 11, 17, 'month', 4)]));
  both('A10 the day before: tomorrow\'s month 3 comes first',
       (m) => same(MM(m, ROBIN, U(2026, 10, 16, 23, 59, 59, 999)), [mo(2026, 10, 17, 'month', 3), mo(2026, 11, 17, 'month', 4)]));
  both('A10 the day after: month 3 is gone, months 4 and 5',
       (m) => same(MM(m, ROBIN, U(2026, 10, 18, 0, 0)), [mo(2026, 11, 17, 'month', 4), mo(2027, 0, 17, 'month', 5)]));
  both('A10 a birth on 31 Jan: month 1 is 3 Mar (setMonth overflow), month 2 is 31 Mar',
       (m) => same(MM(m, U(2026, 0, 31, 9, 0), U(2026, 2, 1, 12, 0)), [mo(2026, 2, 3, 'month', 1), mo(2026, 2, 31, 'month', 2)]));
  ok('A10 a birth on 31 Jan matches the app: monthiversary() says 1 on 3 Mar and null on 2 Mar',
     appMv(U(2026, 0, 31, 9, 0), U(2026, 2, 3, 12, 0)) === 1 && appMv(U(2026, 0, 31, 9, 0), U(2026, 2, 2, 12, 0)) === null);
  both('A10 month 12 reads as 1 year, then month 13',
       (m) => same(MM(m, U(2025, 10, 17, 9, 0)), [mo(2026, 10, 17, 'year', 1), mo(2026, 11, 17, 'month', 13)]));
  both('A10 month 23, then month 24 as 2 years',
       (m) => same(MM(m, U(2024, 11, 17, 9, 0)), [mo(2026, 10, 17, 'month', 23), mo(2026, 11, 17, 'year', 2)]));
  both('A10 month 24 is 2 years; 25 to 35 are skipped, so 3 years comes next',
       (m) => same(MM(m, U(2024, 10, 17, 9, 0)), [mo(2026, 10, 17, 'year', 2), mo(2027, 10, 17, 'year', 3)]));
  both('A10 month 25 is skipped: nothing today, 3 and 4 years next',
       (m) => same(MM(m, U(2024, 9, 17, 9, 0)), [mo(2027, 9, 17, 'year', 3), mo(2028, 9, 17, 'year', 4)]));
  both('A10 born today: the birth day is never a moment; month 1 is 17 Dec',
       (m) => same(MM(m, U(2026, 10, 17, 1, 0)), [mo(2026, 11, 17, 'month', 1), mo(2027, 0, 17, 'month', 2)]));
  both('A10 no birth date: [] for null, undefined and NaN', (m) => [null, undefined, NaN].every((b) => same(MM(m, b), [])));
  both('A10 count: 1 gives one, the default gives two, 0 gives none', (m) => MM(m, ROBIN, NOW, 1).length === 1 && MM(m, ROBIN).length === 2 && MM(m, ROBIN, NOW, 0).length === 0);
  both('A10 snapshotBaby carries moments: monthMoments of its birth, [] with none',
       (m) => same(sb(m, kid('b1', ROBIN), {}).moments, MM(m, ROBIN)) && same(sb(m, kid('b2', null), {}).moments, []));

  console.log('A11 the two copies and the generator agree');
  const outs = (m) => ({
    a: cases.map((c) => m.sinceAnchor(c.t, c.ev)), b: m.babyAnchors(e2, 'b1'), h: [H(m, ill(3), []), H(m, ill(20), [temp(2)])],
    t: T(m, 2350, 10), age: [0, 13, 14, 60, 730].map((d) => m.ageOf(NOW - d * DAY, NOW)), mm: MM(m, ROBIN),
    s: sb(m, kid('b1', ROBIN), { events: evs6, label: (id) => id }), id: m.sleepEventId('b1', 5), R: m.RULES, D: m.DEFAULTS, V: m.SNAPSHOT_VERSIONS,
  });
  ok('A11 the .mjs and the generated .js return deepEqual results', deepEqual(outs(mjs), outs(win.CubbySince)));
  const gen = require('../tools/widget_gen.js').generate(ROOT);
  ok('A11 every generated file on disk is what the generator writes now',
     Object.keys(gen).every((p) => read(p) === gen[p]), Object.keys(gen).filter((p) => read(p) !== gen[p]).join(', '));
  ok('A11 index.html loads since-rules.js before native-bridge.js; the service worker precaches it',
     idx.indexOf('<script defer src="since-rules.js"></script>') > 0 && idx.indexOf('since-rules.js') < idx.indexOf('<script defer src="native-bridge.js">')
     && read('app/sw.js').includes("'/app/since-rules.js',"));

  console.log('\nWIDGET-SNAPSHOT: ' + (fail ? 'FAIL' : 'PASS') + ' (' + pass + ' ok, ' + fail + ' failed)');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL ' + (e && e.stack || e)); console.log('\nWIDGET-SNAPSHOT: FAIL'); process.exit(1); });
