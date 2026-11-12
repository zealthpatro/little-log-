#!/usr/bin/env node
/* Every value another member can write, hostile, one class at a time, through the real ingest.
 *
 * tools/xss_sink_check.js seeds hostile text into the fields someone thought of. Round 1 of the
 * fix passed it and still left six ways to run script on the owner's phone, all in fields nobody
 * had listed: a birth place that lands UNQUOTED in a handler, a relationship capture's `at`, a
 * baby's allergies, growthSource (uppercased, which does not help against &#...; entities), the
 * shared units, and the pregnancy readings. A list of fields is only as good as the person who
 * wrote it, so this gate does not use one.
 *
 * It builds one realistic household (the shared blob, its events and notes, photos, the circle,
 * and a pregnancy journey a partner can read), then for each class below replaces EVERY leaf of
 * that class with a payload aimed at every context at once:
 *     1);__pwn(K);//             an UNQUOTED handler argument:  f(${v})
 *     \');__pwn(K);//            a single-quoted one, past a half escaper
 *     "><x-pwn ...><img onerror> an attribute, or markup
 *     onerror=&#95;&#95;...      the same call spelt in entities, which survives toUpperCase
 *     PWN-K-                     the marker that must still be on screen, as text
 * and feeds it through window.cubbyIngest exactly as store-firebase.js does, then walks the four
 * screens, the pregnancy tabs, and every open*() and render*() function the app has, with no
 * argument and with every id the household holds. Everywhere it asserts no injected element, no
 * injected handler that runs or no longer parses, no payload in a style/src/href, and no sentinel
 * call. A payload's K names the leaf that got through.
 *
 * Classes (one page boot each, so one class cannot hide another):
 *   text    every string leaf except the shape fields (type, units, kind...), which stay real so
 *           every record still renders; plus the map keys that are ids (photos, timers, vaccines)
 *   enum    the value-like shape fields: units, growthSource, country, side, colour, relation...
 *   select  the shape fields that pick what renders at all: type, method, kind, stage, sex, role
 *   number  every number leaf except clocks
 *   clock   every clock leaf (time, at, birth, start, dueDate...)
 *   absent  every field name the app's source reads, added hostile to every record that lacks it
 *
 * And so none of it passes on a blank screen: in each class the hostile marker must be on screen
 * as text for a minimum number of distinct leaves (and named free-text fields in the text class).
 * Section 1 keeps the six repros that beat round 1, by name, both through the ingest and past it.
 *
 * Plus a static rule: an UNQUOTED ${} inside an on*="..." attribute must be a numeric coercion
 * (hNum, Number) or a literal ternary, or one of the reviewed constants below, counted, so a new
 * one fails until someone looks at it.
 *
 *   node tools/xss_leaf_check.js http://localhost:9745
 *   node tools/xss_leaf_check.js --static-only
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const STATIC_ONLY = process.argv.includes('--static-only');
const BASE = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!BASE && !STATIC_ONLY) { console.error('usage: node tools/xss_leaf_check.js <base-url>'); process.exit(2); }
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 1600) : '')); } };

/* ------------------------------------------------------------------ static: unquoted handler ${} */
/* Every ${expr} inside an on*="..." attribute of a template literal that is NOT inside a '...' JS
   string. Those land as code, so a string there is a script. */
function unquotedHandlerExprs(src) {
  const out = [];
  const re = /\son[a-z]+="/g; let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length, inStr = false;
    const line = src.slice(0, m.index).split('\n').length;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '\n' || c === '"') break;
      if (c === '\\') { i++; continue; }
      if (c === "'") { inStr = !inStr; continue; }
      if (c === '$' && src[i + 1] === '{') {
        let d = 1, j = i + 2, q = null;
        for (; j < src.length && d; j++) {
          const ch = src[j];
          if (q) { if (ch === '\\') { j++; continue; } if (ch === q) q = null; continue; }
          if (ch === '`' || ch === '"' || ch === "'") { q = ch; continue; }
          if (ch === '{') d++; else if (ch === '}') d--;
        }
        const expr = src.slice(i + 2, j - 1).trim();
        if (!inStr) out.push({ line, expr });
        i = j - 1;
      }
    }
  }
  return out;
}
// A number the helper made, or a ternary whose both arms are literals: neither can carry a string.
const SAFE_UNQUOTED = /^(?:hNum|Number)\([^]*\)$|^[\w.!&|()=<>' ]+\?\s*(?:-?\d+(?:\.\d+)?|true|false|null|'[\w ]*')\s*:\s*(?:-?\d+(?:\.\d+)?|true|false|null|'[\w ]*')$/;
/* Reviewed: each is a constant, a loop index over a constant list, or handler code the same file
   builds from constants and hArg()/jArg() pieces. The count is part of the review: a NEW use of a
   familiar name still fails until someone reads it. */
const KNOWN = {
  'app/index.html': {
    reRender: 2,          // the caller's re-render function name, always a literal ('render', 'openFeed'...)
    "src||`getWhen('${hArg(slot)}')`": 1,           // timeStrip: callers pass code built with hArg
    "onPick||`setWhen('${hArg(slot)}',m);`": 1,
    ret: 2,               // a literal ';window.openFamily(...)' or ''
    action: 1,            // checklist rows: literal handler names
    mv: 1,                // monthiversary(): a month count computed from b.birth
    onclick: 1,           // actBtn(): every caller passes a literal, or code built with hArg
    openIt: 2, stopFn: 2, correctFn: 1, forgetFn: 1,   // the timer banner: built from hArg pieces
    "voluntary?`openTimerControl('feed','${hArg(babyId)}')`:'closeSheet()'": 1,
    m: 1,                 // [5,10,15,20,30,45]
    'p.onclick': 1,       // journey prompts: literal code, or built from a week number
    'x.i': 1,             // index into ASK_SUGGESTIONS
    n: 1,                 // [7,14,30] days
    i: 11,                // .map((x,i)) over a constant list (chips, presets, month slots)
    'act.go': 1,          // pregNextAction(): literal code
    "hasPreg?'viewingPreg=true;closeSheet();render()':'viewingPreg=true;openStartPregnancy()'": 1,
    "canWrite?`openApptEdit('${hArg(a.id)}')`:`openVisitPrep('${hArg(a.id)}')`": 1,
    scope: 1,             // '' or a quoted hArg'd id (removeKeptMemories)
    'r[3]': 1,            // den rows: literal code
    'o[0]': 1, editing: 10, // dose-pattern buttons [24,12,8,6,1]; editing is !!existing
    v: 1, key: 1,         // sticker sizes [0.09...]; slider keys are literal adjustment names
    'c.onclick': 1,       // memory candidates: literal code, or built with hNum/hArg
    uploadOnclick: 1, pickFn: 1,   // albumStrip callers pass literal code
  },
};
function staticRule() {
  console.log('\n0. no string can land unquoted in a handler');
  const files = ['app/index.html', 'app/teach-ui.js', 'app/log-guide.js', 'app/vax-card.js', 'app/voice-log.js', 'app/cubby-extras.js'];
  const bad = [], counts = {};
  files.forEach((f) => {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    unquotedHandlerExprs(src).forEach(({ line, expr }) => {
      if (SAFE_UNQUOTED.test(expr)) return;
      const known = (KNOWN[f] || {})[expr];
      if (known) { counts[f + '\0' + expr] = (counts[f + '\0' + expr] || 0) + 1; return; }
      bad.push(f + ':' + line + ' ${' + expr.slice(0, 90) + '}');
    });
  });
  Object.keys(KNOWN).forEach((f) => Object.keys(KNOWN[f]).forEach((e) => {
    const n = counts[f + '\0' + e] || 0;
    if (n > KNOWN[f][e]) bad.push(f + ': ${' + e.slice(0, 60) + '} appears ' + n + ' times, reviewed for ' + KNOWN[f][e]);
  }));
  ok('every unquoted ${} in a handler is a number, a literal, or a reviewed constant (' + bad.length + ' are not)', bad.length === 0, bad.slice(0, 20).join('\n         '));
  /* The rule must be able to see one, or the line above passes for free: the round-1 bug, planted. */
  const planted = '<div onclick="posterPick(\'style\',\'${hArg(x.k)}\',${hasDetails})"></div>'
    + '<b onclick="f(${r.at||\'null\'})"></b><b onclick="f(${hNum(r.at)})"></b><b onclick="f(${hasDetails?1:0})"></b>';
  const seen = unquotedHandlerExprs(planted).filter((x) => !SAFE_UNQUOTED.test(x.expr)).map((x) => x.expr);
  ok('the rule catches a planted ${hasDetails} and ${r.at||\'null\'}, and passes hNum() and a literal ternary', JSON.stringify(seen) === JSON.stringify(['hasDetails', "r.at||'null'"]), seen);

  /* Handler code built by concatenation instead of a template: "f('"+x+"')". Same rule. */
  const html = fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');
  const concat = [];
  html.split('\n').forEach((l, i) => {
    const re = /'"\s*\+\s*(?!(?:hArg|jArg)\()([^+"]+?)\s*\+\s*"'/g; let mm;
    while ((mm = re.exec(l))) concat.push((i + 1) + ' ' + mm[1]);
  });
  const plantedC = `x="go('"+e.id+"')"; y="go('"+hArg(e.id)+"')";`.match(/'"\s*\+\s*(?!(?:hArg|jArg)\()([^+"]+?)\s*\+\s*"'/g) || [];
  ok('and that rule catches a planted "go(\'"+e.id+"\')", and only that one', plantedC.length === 1, plantedC);
  ok('no handler built by "f(\'"+x+"\')" concatenation skips hArg (' + concat.length + ' do)', concat.length === 0, concat.slice(0, 10).join('\n         '));
}

/* ------------------------------------------------------------------ the household */
const DAY = 86400000;
// A fixed day AND hour: month boundaries flaked two clock-pinned gates in one week.
const CLOCK = new Date(2026, 10, 11, 13, 0, 0, 0).getTime();
const now = CLOCK;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const dayKeyOf = (ts) => { const d = new Date(ts); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); };

function household() {
  const B = 'lq3b1robin', B2 = 'lq3b2wren', ME = 'local', CG = 'uidCaregiver';
  const ev = (id, type, t, x) => Object.assign({ id, type, babyId: B, time: now - t, authorId: CG }, x || {});
  const app = {
    babies: [
      { id: B, name: 'Robin', fullName: 'Robin Ada Lee', birth: now - 200 * DAY, sex: 'F', color: '#F4A6B8', country: 'uk',
        growthSource: 'who', feedType: 'mixed', diet: 'veg', stageOverride: 'baby', solidsStarted: true, birthTimeSet: true,
        place: "St Mary's", town: 'Leeds', birthWeight: '3.4 kg', birthLength: '51 cm', headCirc: '35 cm', parents: 'Sam and Alex',
        birthNote: 'A quiet morning', gestWeeks: 39, gestDays: 2, blood: 'O+', sign: 'Leo', hasPet: true, petName: 'Biscuit', petType: 'dog',
        allergies: ['peanut', 'egg'], avatarPhotoId: 'ph1', vaxSetupSeen: true, createdAt: now - 200 * DAY,
        doctors: [{ id: 'dr1', role: 'Pediatrician', name: 'Dr Okafor', clinic: 'Hill Surgery', phone: '0113 496 0000', nextVisit: '2026-11-20' }],
        askQs: [{ id: 'aq1', text: 'Is this rash normal?', done: false }],
        routines: [{ id: 'rt1', title: 'Morning bottle', time: '08:00', assignee: CG, evType: 'feed', done: {} }] },
      { id: B2, name: 'Wren', birth: now - 200 * DAY, sex: 'M', color: 'var(--sleep)', country: 'uk', doctors: [], allergies: [], routines: [] },
    ],
    activeBabyId: B,
    settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', hcUnit: 'cm', tempUnit: 'C', householdName: 'The Lee family' },
    milestones: [{ id: 'ms1', babyId: B, key: 'smile', title: 'First smile', cat: 'Social', achievedAt: now - 120 * DAY, note: 'At Nana', photoId: 'ph1' }],
    meds: [
      { id: 'md1', name: 'Calpol', dose: '2.5', unit: 'ml', babyId: B, subject: { kind: 'baby', id: B }, active: true, pattern: { type: 'everyX', hours: 4 }, createdAt: now - 3 * DAY },
      { id: 'md2', name: 'Vitamin D', dose: '1', unit: 'drop', babyId: B, subject: { kind: 'baby', id: B }, active: true, pattern: { type: 'daily', times: ['08:00'] }, createdAt: now - 30 * DAY },
    ],
    vaccines: { [B]: { mmr: { at: now - 20 * DAY, given: true, note: 'Left thigh' } } },
    illnesses: [{ id: 'il1', babyId: B, name: 'Cold', startedAt: now - 2 * DAY, endedAt: null, notes: 'Runny nose', by: CG }],
    photos: [
      { id: 'pr1', babyId: B, photoId: 'ph1', caption: 'Park day', createdAt: now - DAY },
      { id: 'pr2', babyId: B, photoId: 'ph2', slot: 3, clean: true, caption: '3 months', createdAt: now - 100 * DAY },
    ],
    handoff: { text: 'Fed at 2', at: now - 3600000, by: CG },
    den: {
      chores: [{ id: 'dc1', text: 'Bins', who: 'Sam', done: false }], shopping: [{ id: 'ds1', text: 'Nappies', done: false }],
      meals: [{ id: 'dm1', day: 2, text: 'Soup' }], staff: [{ id: 'dst1', name: 'Mira', role: 'Nanny', phone: '0700', note: 'Tues' }],
      expenses: [{ id: 'de1', at: now - DAY, amount: 12.5, cat: 'baby', note: 'Wipes' }], weights: [{ id: 'dw1', at: now - DAY, who: 'Sam', kg: 80, unit: 'kg' }],
    },
    consents: [{ id: 'cs1', type: 'delete', scope: 'photos', label: 'Delete all photos', requestedBy: CG, requestedByName: 'Sam', at: now - 3600000, approvals: [CG], status: 'pending' }],
    guardians: [ME, CG],
    timers: { [B]: { feed: { start: now - 600000, side: 'L' } } },
    journey: {
      titles: { [B]: 'Robin, so far' }, dismissed: {},
      saved: { [B]: [{ id: 'js1', at: now - DAY, title: 'A good day', photoId: 'ph1' }] },
      rel: { [B]: [{ id: 'jr1', relation: 'nana', label: 'Nana', photoId: 'ph1', at: now - 5 * DAY }] },
    },
    lossHolding: null,
  };
  const events = [
    ev('ev1', 'feed', 3600000, { method: 'breast', side: 'L', dur: 600000, note: 'Sleepy feed', photoId: 'ph1' }),
    ev('ev2', 'feed', 7200000, { method: 'bottle', amount: 120, unit: 'ml', milk: 'formula' }),
    ev('ev3', 'feed', 9000000, { method: 'solids', food: 'Carrot', amount: 2, unit: 'tbsp', reaction: 'loved' }),
    ev('ev4', 'sleep', 14400000, { end: now - 10800000, where: 'cot' }),
    ev('ev5', 'diaper', 5400000, { kind: 'dirty', colour: 'yellow', notes: 'Fine' }),
    ev('ev6', 'pump', 20000000, { side: 'both', amount: 90, unit: 'ml' }),
    ev('ev7', 'medicine', 16000000, { medId: 'md1', medName: 'Calpol', dose: '2.5', unit: 'ml' }),
    ev('ev8', 'growth', 2 * DAY, { weight: 6.4, wUnit: 'kg', height: 62, hUnit: 'cm', head: 41, hcUnit: 'cm' }),
    ev('ev9', 'growth', 40 * DAY, { weight: 5.1, wUnit: 'kg', height: 57, hUnit: 'cm', head: 38, hcUnit: 'cm' }),
    ev('ev10', 'temperature', 30000000, { temp: 38.1, unit: 'C', illnessId: 'il1' }),
    ev('ev11', 'symptom', 32000000, { symptom: 'cough', severity: 'mild', notes: 'Dry', illnessId: 'il1' }),
    ev('ev12', 'vaccine', 20 * DAY, { vName: 'MMR', notes: 'Left thigh' }),
    ev('ev13', 'milestone', 120 * DAY, { title: 'First smile', notes: 'At Nana' }),
    ev('ev14', 'activity', 40000000, { title: 'Tummy time', dur: 900000, notes: 'Happy' }),
    ev('ev15', 'note', 45000000, { note: 'Teething?' }),
    ev('ev16', 'feed', 50000000, { method: 'water', amount: 30, unit: 'ml' }),
  ];
  const notes = [
    { id: 'nt1', text: 'Robin had a big lunch', createdBy: CG, createdByName: 'Sam', audience: 'circle', at: now - 1800000, day: dayKeyOf(now - 1800000), pinned: true },
    { id: 'nt2', text: 'Nap at 3', createdBy: ME, createdByName: 'Alex', audience: 'circle', at: now - 900000, day: dayKeyOf(now - 900000), pinned: false },
  ];
  const photos = { ph1: PNG, ph2: PNG, pp1: PNG };
  const members = { [ME]: 'owner', [CG]: 'caregiver' };
  const memberInfo = { [ME]: { name: 'Alex Lee', relationship: 'Mama Bear', role: 'owner' }, [CG]: { name: 'Sam Lee', relationship: 'Papa Bear', role: 'caregiver', avatar: 'cub-oat' } };
  const preg = {
    id: 'pg1', ownerUid: ME, stage: 'expecting', country: 'uk', dueDate: now + 10 * 7 * DAY, lmp: now - 30 * 7 * DAY, cycleLen: 28, createdAt: now - 30 * 7 * DAY,
    glucoseUnit: 'mmol', knownSex: 'F', babyName: 'Bean', birthPlan: 'Water birth if I can',
    appts: [{ id: 'ap1', week: 31, title: 'Midwife check', note: 'Bring notes', place: 'Hill Surgery', done: true, at: now - 3 * DAY, when: now + 3 * DAY, timed: true,
      sfh: 30, efw: 1600, hb: 120, bpSys: 118, bpDia: 76, position: 'Head down' }],
    careTeam: [{ id: 'ct1', name: 'Jo', role: 'Midwife', phone: '0113 496 0001' }],
    precon: [{ id: 'pc1', text: 'Folic acid', done: true, by: CG, addedBy: CG }],
    symptoms: [{ id: 'sy1', at: now - DAY, kind: 'nausea', note: 'Morning' }],
    moments: [{ id: 'mo1', week: 20, note: 'Bump at 20', photoId: 'pp1', at: now - 10 * 7 * DAY }],
    bag: [{ id: 'bg1', text: 'Snacks', done: false }], visitQs: [{ id: 'vq1', text: 'Is the baby head down?', done: false }],
    guesses: [{ id: 'gs1', uid: CG, name: 'Sam', guess: 'F', note: 'A feeling', at: now - DAY }],
    weights: [{ id: 'wt1', at: now - 7 * DAY, kg: 68.5, unit: 'kg' }],
    bp: [{ id: 'bp1', at: now - 2 * DAY, sys: 122, dia: 78 }],
    kicks: [{ id: 'kk1', start: now - DAY, end: now - DAY + 1200000, count: 10 }],
    contractions: [{ id: 'cn1', start: now - 7200000, end: now - 7140000 }],
    glucose: [{ id: 'gl1', at: now - DAY, val: 5.4, unit: 'mmol', context: 'fasting' }],
    urine: [{ id: 'ur1', at: now - DAY, result: 'clear' }],
    supplements: [{ id: 'sp1', name: 'Folic acid' }], supplementLog: [{ id: 'sl1', at: now - DAY, supplementId: 'sp1' }],
    nausea: [{ id: 'nz1', at: now - DAY, vomits: 2, keptFluids: true, water: 4 }],
    moodLog: [{ id: 'ml1', at: now - DAY, mood: 'tired', note: 'Long day' }],
    conditions: { gd: false }, gentle: { afterLoss: false, noNumbers: false },
    journey: { title: 'Bean, so far', dismissed: {} },
    gameCode: 'g123', hubCode: 'h123', hubGames: { duedate: 'dd1' },
  };
  return { app, events, notes, photos, members, memberInfo, preg };
}

/* Shape fields keep a record a record. SELECT picks what renders at all (a feed, a girl, an owner),
   so it gets a class of its own: with it hostile, much of the app has nothing to draw. */
const SELECT = new Set(['type', 'method', 'kind', 'stage', 'evType', 'status', 'scope', 'audience', 'role', 'sex', 'key', 'cat', 'time', 'times', 'day']);
const SHAPE = new Set(['type', 'method', 'kind', 'stage', 'evType', 'status', 'scope', 'audience', 'role', 'sex', 'unit', 'wUnit', 'hUnit',
  'hcUnit', 'tempUnit', 'glucoseUnit', 'growthSource', 'country', 'diet', 'feedType', 'stageOverride', 'cat', 'key', 'relation', 'guess',
  'severity', 'mood', 'context', 'result', 'side', 'time', 'times', 'day', 'nextVisit', 'knownSex', 'milk', 'reaction', 'where', 'colour', 'symptom', 'avatar']);
const CLOCK_KEYS = new Set(['time', 'at', 'birth', 'createdAt', 'start', 'end', 'startedAt', 'endedAt', 'achievedAt', 'dueDate', 'lmp', 'when', 'importedAt', 'givenAt', 'deletedAt']);
// Never replaced: the uid this page is signed in as, or the household's own key on it.
const KEEP_VALUE = new Set(['local']);

const ent = (s) => s.split('').map((c) => '&#' + c.charCodeAt(0) + ';').join('');
const PAY = (k) => '1);__pwn(' + k + ');//\\\');__pwn(' + k + ');//"><x-pwn data-t="' + k + '"></x-pwn><img src="/x-pwn-404" onerror="__pwn(' + k + ')">'
  + '<img src=/x-pwn-404 onerror=' + ent('__pwn(' + k + ')') + '>PWN-' + k + '-';

/* Replaces every leaf `pick` says yes to. The same original value gets the same payload, so a
   baby's id and every babyId that points at it stay joined (ingest maps both to one stand-in). */
function hostile(h, pick, withKeys) {
  const tags = [], byVal = new Map();
  const tagFor = (v, where) => {
    const key = typeof v + ':' + String(v);
    let k = byVal.get(key);
    if (k === undefined) { k = tags.length; byVal.set(key, k); tags.push({ value: v, paths: [] }); }
    if (tags[k].paths.length < 4) tags[k].paths.push(where);
    return PAY(k);
  };
  const walk = (o, where, parentKey) => {
    if (Array.isArray(o)) { o.forEach((v, i) => { if (v && typeof v === 'object') walk(v, where + '[' + i + ']', parentKey); else if (pick(parentKey, v)) o[i] = tagFor(v, where + '[' + i + ']'); }); return; }
    Object.keys(o).forEach((k) => {
      const v = o[k];
      if (v && typeof v === 'object') walk(v, where + '.' + k, k);
      else if (pick(k, v)) o[k] = tagFor(v, where + '.' + k);
    });
  };
  /* Map keys that are ids are written by the same people: the photo map, and a baby's timers,
     vaccines and journey captures. Renamed with the same payload as the ids that point at them. */
  if (withKeys) {
    const rekey = (m, where) => { if (!m || typeof m !== 'object') return; Object.keys(m).forEach((k) => { if (KEEP_VALUE.has(k)) return; const nk = tagFor(k, where + '{' + k + '}'); m[nk] = m[k]; delete m[k]; }); };
    rekey(h.photos, 'photos'); rekey(h.app.timers, 'app.timers'); rekey(h.app.vaccines, 'app.vaccines');
    ['titles', 'saved', 'rel'].forEach((k) => rekey(h.app.journey[k], 'app.journey.' + k));
  }
  Object.keys(h).forEach((k) => walk(h[k], k, k));
  return tags;
}
/* Every field name the source reads (a.b, a?.b), so a field nobody listed is still tried. */
function sourceFields() {
  const html = fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');
  const set = new Set();
  for (const m of html.matchAll(/\b(?:b|e|p|a|r|m|n|x|d|s|g|k|c|ev|ap|it|rec|ill|ms|row)\.([a-z][A-Za-z0-9]{1,24})\b/g)) set.add(m[1]);
  const NOT = /^(length|map|filter|forEach|find|some|every|join|push|slice|splice|indexOf|includes|sort|concat|reduce|keys|toString|value|trim|replace|split|test|match|get|set|has|style|classList|target|preventDefault|stopPropagation|key|then|catch|apply|call|bind|id|type|babyId|time|at|birth|start|end|ownerUid|subject|pattern|done|photoId|audience|createdBy|authorId|deleted|deletedAt|pinned|day|method|kind|stage|uid|by|addedBy|sharedWith|guardians|approvals|status|requestedBy|medId|data|docs|doc|size|code|message|innerHTML|textContent|width|height|naturalWidth|naturalHeight|src|files|checked|dataset|parentNode|querySelector|querySelectorAll|appendChild|remove|contains|focus|click|getContext|toFixed|getTime|getHours|getDate|getMonth|getFullYear|setHours|toISOString|charAt|charCodeAt|toLowerCase|toUpperCase|startsWith|endsWith|padStart|exec|delete|add|clear|entries|values|now|max|min|round|floor|abs|log)$/;
  return [...set].filter((f) => !NOT.test(f));
}
const HIDES = /^(deleted|hidden|removed|archived|private|priv|loss|lossHolding|imported|gapped|skipped|dismissed|ended|endedAt|done|given|missed|estimated|clean|childAck|noNumbers|afterLoss|paused|stopped|inactive|disabled|muted|draft|pending|failed|error|offline|locked|revoked|left|gone|discarded|trashed|expired|cancelled|canceled|outcome|retired|resolved|hide|mute|lost|isLoss|archivedAt|removedAt|hiddenAt)$/;
function addAbsent(h, fields) {
  fields = fields.filter((f) => !HIDES.test(f));
  const tags = [];
  const tagOf = (f) => { let k = tags.findIndex((t) => t.value === f); if (k < 0) { k = tags.length; tags.push({ value: f, paths: ['(absent) .' + f] }); } return PAY(k); };
  const walk = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 6) return;
    if (Array.isArray(o)) { o.forEach((v) => { if (v && typeof v === 'object' && !Array.isArray(v)) { fields.forEach((f) => { if (!(f in v)) v[f] = tagOf(f); }); walk(v, depth + 1); } }); return; }
    Object.keys(o).forEach((k) => walk(o[k], depth + 1));
  };
  walk(h.app, 0); walk(h.events, 0); walk(h.notes, 0); walk(h.preg, 0);
  fields.forEach((f) => { if (!(f in h.preg)) h.preg[f] = tagOf(f); });
  h.app.babies.forEach((b) => fields.forEach((f) => { if (!(f in b)) b[f] = tagOf(f); }));
  return tags;
}

/* ------------------------------------------------------------------ page side */
function pageSetup() {
  window.__pwnHits = [];
  window.__pwn = window.__PWN = function (k) { window.__pwnHits.push(String(k)); };
  window.__sandboxRun = function (code) {
    var hits = [];
    var stub = new Proxy(function () {}, {
      get: function (t, k) { if (k === Symbol.toPrimitive) return function () { return ''; }; if (k === 'then') return undefined; return stub; },
      apply: function () { return stub; }, construct: function () { return stub; }, set: function () { return true; }, has: function () { return true; },
    });
    var scope = new Proxy({}, {
      has: function () { return true; },
      get: function (t, k) {
        if (k === Symbol.unscopables) return undefined;
        if (typeof k === 'string' && /^__pwn$/i.test(k)) return function (x) { hits.push(String(x)); };
        return stub;
      },
      set: function () { return true; },
    });
    var fn;
    try { fn = new Function('__s', 'with(__s){' + code + '\n}'); } catch (e) { return { hits: hits, syntax: String(e && e.message || e) }; }
    try { fn.call(stub, scope); } catch (e) {}
    return { hits: hits };
  };
  // Returns [{k, what}] for every injection in the document.
  window.__scan = function () {
    var out = [];
    document.querySelectorAll('x-pwn').forEach(function (n) { out.push({ k: n.getAttribute('data-t'), what: 'injected <x-pwn>' }); });
    var all = document.querySelectorAll('*');
    for (var e = 0; e < all.length; e++) {
      var el = all[e], tag = el.tagName.toLowerCase();
      for (var a = 0; a < el.attributes.length; a++) {
        var n = el.attributes[a].name, v = el.attributes[a].value;
        if (n.indexOf('pwn') >= 0) out.push({ k: '?', what: 'injected attribute ' + n + ' on <' + tag + '>' });
        if (n.charCodeAt(0) === 111 && n.charCodeAt(1) === 110 && /__pwn/i.test(v)) {
          var r = window.__sandboxRun(v);
          r.hits.forEach(function (k) { out.push({ k: k, what: n + ' on <' + tag + '> runs __pwn :: ' + v.slice(0, 160) }); });
          if (r.syntax) { var mk = /PWN-(\d+)-|__pwn\((\d+)\)/i.exec(v); out.push({ k: mk ? (mk[1] || mk[2]) : '?', what: n + ' on <' + tag + '> no longer parses (' + r.syntax + ') :: ' + v.slice(0, 160) }); }
        }
        if (n === 'style' || n === 'src' || n === 'href' || n === 'srcset' || n === 'action' || n === 'formaction') {
          var vv = v.replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+\/=]+/g, 'data:');
          if (/pwn/i.test(vv) && !/^tel:|^mailto:/i.test(vv)) { var mk2 = /PWN-(\d+)-|pwn\((\d+)\)/i.exec(vv); out.push({ k: mk2 ? (mk2[1] || mk2[2]) : '?', what: n + ' on <' + tag + '> carries the payload :: ' + v.slice(0, 160) }); }
          if (/^\s*(javascript|vbscript|data:text)/i.test(vv)) out.push({ k: '?', what: n + ' on <' + tag + '> is a script URL :: ' + v.slice(0, 160) });
        }
      }
    }
    return out;
  };
  window.__shown = function (set) {
    ['scroll', 'sheet', 'xssProbe', 'llModalOv'].forEach(function (id) {
      var el = document.getElementById(id); if (!el) return;
      var t = el.textContent || '', re = /PWN-(\d+)-/gi, m;
      while ((m = re.exec(t))) set[m[1]] = 1;
    });
  };
}

/* One class: boot clean, ingest the hostile household the way store-firebase.js does, walk. */
async function runClass(browser, name, h, tags, must) {
  console.log('\n' + name + ': ' + tags.length + ' distinct hostile leaves');
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.evaluateOnNewDocument((t) => {
    const R = Date; function D(...a) { return a.length === 0 ? new R(t + (R.now() - D.__t0)) : new R(...a); }
    D.__t0 = R.now(); D.prototype = R.prototype; D.now = () => t + (R.now() - D.__t0); D.parse = R.parse; D.UTC = R.UTC; window.Date = D;
  }, CLOCK);
  await page.evaluateOnNewDocument(pageSetup);
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });
  await page.evaluate(() => {
    localStorage.setItem('little-log-v1', JSON.stringify({ babies: [{ id: 'b0', name: 'R', birth: Date.now() - 9e9 }], events: [], settings: { seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1, install: 1 } } }));
    localStorage.setItem('cubby-quick-uid', 'local'); localStorage.setItem('cubby-theme:local', 'light');
  });
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1200);
  const landed = await page.evaluate((hh) => {
    const I = window.cubbyIngest;
    if (!I) return { missing: true };
    // Exactly what store-firebase.js does where each snapshot lands.
    I.blob(hh.app);
    const events = hh.events.map((e) => I.event(e, e.id));
    const notes = hh.notes.map((n) => I.note(n, n.id));
    const photos = I.photos(hh.photos);
    const preg = I.blob(hh.preg);
    const seen = (state.settings && state.settings.seen) || {};
    Object.keys(hh.app).forEach((k) => { state[k] = hh.app[k]; });
    state.settings = Object.assign({}, hh.app.settings || {}, { seen: seen });
    state.events = events; state.notes = notes;
    try { normalizeLoadedState(state); } catch (e) {}
    PhotoStore.map = photos;
    window.LL = window.LL || {}; window.LL.members = hh.members; window.LL.memberInfo = hh.memberInfo; window.LL.role = 'owner';
    window.__preg = preg;
    window.__realFetch = window.__realFetch || window.fetch;
    window.fetch = function () { return Promise.reject(new Error('offline in the gate')); };
    window.open = function () { return null; };
    try { window.print = function () {}; } catch (e) {}
    return { babies: (state.babies || []).length, events: state.events.length };
  }, h);
  ok(name + ': the household landed through window.cubbyIngest', !landed.missing && landed.babies >= 1, landed);
  if (landed.missing) { await page.close(); return; }

  const html = fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');
  // Left out: they navigate away, print, start a payment, or open a picker that needs a real tap.
  const SKIP = /^(open(Sheet|DateModal|PickerOverlay|Pro|ProPortal|Printable|Article|ReadCarousel|ReadingRoom|Install|Import|DoctorReport|PregDoctorReport|TtcDoctorReport|DeleteAccount|WhenPicker)|render|renderSoon|renderGlobal)$/;
  const FNS = [...new Set([...html.matchAll(/^(?:async )?function ((?:open|render)[A-Za-z0-9]*)\(/gm)].map((m) => m[1]))].filter((n) => !SKIP.test(n));
  const found = new Map(), shown = {}; let calls = 0;
  const take = (where, list) => list.forEach((f) => { const key = f.k + ' ' + f.what.replace(/ :: .*/, ''); if (!found.has(key)) found.set(key, { where, f }); });

  const sweep = async (phase) => {
    const r = await page.evaluate(async (fns, phase) => {
      const ids = new Set();
      const add = (a) => (Array.isArray(a) ? a : []).forEach((x) => { if (x && x.id != null) ids.add(x.id); });
      add(state.events); add(state.meds); add(state.illnesses); add(state.milestones); add(state.photos); add(state.notes); add(state.consents); add(state.babies);
      (state.babies || []).forEach((b) => { add(b.routines); add(b.doctors); add(b.askQs); try { add(journeyRel(b.id)); } catch (e) {} });
      const p = state.pregnancy;
      if (p) ['appts', 'careTeam', 'precon', 'symptoms', 'moments', 'bag', 'visitQs', 'guesses', 'weights', 'bp', 'kicks', 'contractions', 'glucose', 'urine', 'supplements', 'nausea', 'moodLog'].forEach((k) => add(p[k]));
      (state.photos || []).forEach((x) => { if (x.photoId) ids.add(x.photoId); });
      const args = [...ids].slice(0, 60).concat([1, 3]);
      const out = [], shown = {}; let calls = 0;
      const probe = () => document.getElementById('xssProbe') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'xssProbe' }));
      for (const f of fns) {
        const fn = window[f]; if (typeof fn !== 'function') continue;
        const list = fn.length ? [undefined].concat(args) : [undefined];
        for (const a of list) {
          try { closeSheet(); } catch (e) {}
          calls++;
          try { const r = a === undefined ? fn() : fn(a); if (typeof r === 'string') probe().innerHTML = r; } catch (e) {}
          await new Promise((res) => setTimeout(res, 0));
          const s = window.__scan();
          if (s.length) out.push({ where: phase + ' ' + f + '(' + (a === undefined ? '' : String(a).slice(0, 14)) + ')', s: s.slice(0, 12) });
          window.__shown(shown);
          const pb = document.getElementById('xssProbe'); if (pb) pb.innerHTML = '';
        }
      }
      return { out, shown, calls };
    }, FNS, phase);
    calls += r.calls;
    r.out.forEach((x) => take(x.where, x.s));
    Object.assign(shown, r.shown);
  };
  const screens = async (phase, list, code) => {
    for (const v of list) {
      const s = await page.evaluate((v, code) => { try { closeSheet(); } catch (e) {} try { (new Function('v', code))(v); } catch (e) { return [{ k: '?', what: 'threw ' + e.message }]; } return null; }, v, code);
      await sleep(250);
      const r = await page.evaluate(() => { const sh = {}; window.__shown(sh); return { s: window.__scan(), sh }; });
      take(phase + ' ' + v, r.s.concat((s || []).filter((x) => !/^threw /.test(x.what))));
      Object.assign(shown, r.sh);
    }
  };

  await screens('screen', ['home', 'log', 'album', 'health'], "go(v); render();");
  if (process.env.XSS_LEAF_DEBUG) console.log(await page.evaluate(() => (document.getElementById('scroll') || {}).innerText.slice(0, 1500)));
  // The pieces tools/xss_sink_check.js walks that are not an open*() or render*() of their own.
  const PROBE = "var d=document.getElementById('xssProbe')||document.body.appendChild(Object.assign(document.createElement('div'),{id:'xssProbe'}));";
  await screens('piece', ['stats', 'milestones', 'family', 'who'], "if(v==='stats'){ go('log'); " + PROBE + " d.innerHTML=renderStats(); }"
    + " if(v==='milestones'){ albumTab='milestones'; go('album'); render(); }"
    + " if(v==='family'){ " + PROBE + " d.innerHTML=window.cubbyFamilyPortrait(); }"
    + " if(v==='who'){ " + PROBE + " d.innerHTML=glWhoChips(''); }");
  /* Sheets and screens that draw different things in different states: every tab, every feed
     method. A function walked only in its default state hides the branch the data reaches. */
  await screens('state', ["go('log');setLogTab('log')", "go('log');setLogTab('stats');setLogRange('month')", "go('log');setLogTab('rituals')",
    "go('health');setHealthTab('meds')", "go('health');setHealthTab('vaccines')", "go('health');setHealthTab('illness')",
    "go('album');setAlbumTab('photos')", "go('album');setAlbumTab('memories')", "go('album');setAlbumTab('milestones')",
    "openFeed();setFeedMethod('breast')", "openFeed();setFeedMethod('bottle')", "openFeed();setFeedMethod('solids')", "openFeed();setFeedMethod('water')"], 'eval(v)');
  await sweep('baby');
  await page.evaluate(() => { state.pregnancy = window.__preg; viewingPreg = true; try { ensurePregFields(state.pregnancy); } catch (e) {} });
  await screens('pregnancy', ['week', 'care', 'moments', 'body', 'prep', 'trying', 'log'], "viewingPreg=true; pregGo(v);");
  await sweep('pregnancy');
  await sleep(900);   // an injected <img> fires onerror after its 404 comes back
  const late = await page.evaluate(() => [...new Set(window.__pwnHits)]);
  late.forEach((k) => take('(late)', [{ k, what: 'sentinel ran' }]));

  const lines = [...found.values()].map(({ where, f }) => {
    const t = tags[+f.k];
    return (t ? t.paths.join(' | ') + ' = ' + JSON.stringify(String(t.value)).slice(0, 40) : 'leaf ' + f.k) + '\n           ' + f.what + '\n           at ' + where;
  });
  ok(name + ': nothing injected, no handler escaped, no sentinel ran (' + lines.length + ' findings)', lines.length === 0, lines.slice(0, 40).join('\n         '));
  const shownN = Object.keys(shown).length;
  ok(name + ': and the hostile values ARE on screen, as text (' + shownN + ' of ' + tags.length + ' leaves, need ' + must.min + ')', shownN >= must.min, shownN);
  (must.fields || []).forEach((fp) => {
    const k = tags.findIndex((t) => t.paths.some((p) => (fp instanceof RegExp ? fp.test(p) : p === fp)));
    ok(name + ': ' + String(fp) + ' is among them, shown as text', k >= 0 && shown[k], k < 0 ? 'no such leaf' : 'leaf ' + k + ' not shown');
  });
  const own = errs.filter((e) => !/firebase|network|Failed to fetch|ERR_|messaging|installations|offline in the gate/i.test(e));
  console.log('  (' + FNS.length + ' open/render functions, ' + calls + ' calls)');
  if (own.length) console.log('  note: page errors in ' + name + ' (data is hostile, so some are expected): ' + own.length + ' :: ' + own.slice(0, 3).join(' | ').slice(0, 300));
  await page.close();
}

/* ------------------------------------------------------------------ the six round 1 missed, by name */
/* The skeptic's repros, kept: each one ran script on the owner's phone against round 1. Run twice:
   through the ingest (the real path), and put straight into state past it, so the sink is graded on
   its own and the ingest is the second lock, not the only one. */
async function named(browser) {
  console.log('\n1. the six round 1 missed, by name');
  for (const mode of ['ingest', 'sink']) {
    const page = await browser.newPage();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await page.evaluateOnNewDocument(pageSetup);
    await page.setViewport({ width: 390, height: 844 });
    await page.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });
    await page.evaluate(() => {
      localStorage.setItem('little-log-v1', JSON.stringify({ babies: [{ id: 'b1', name: 'R', birth: Date.now() - 9e9, sex: 'F' }], activeBabyId: 'b1', events: [{ id: 'g1', type: 'growth', babyId: 'b1', time: Date.now() - 86400000, weight: 5, height: 60, head: 38 }], settings: { seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1, install: 1 } } }));
      localStorage.setItem('cubby-quick-uid', 'local');
    });
    await page.reload({ waitUntil: 'networkidle2' }); await sleep(1200);
    const r = await page.evaluate(async (mode, png) => {
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      const U = (t) => '<img src=/x-pwn-404 onerror="__pwn(\'' + t + '\')"><x-pwn data-t="' + t + '"></x-pwn>PWN-' + t + '-';
      const E = (t) => '<img src=/x-pwn-404 onerror="' + ('__pwn(\'' + t + '\')').split('').map((c) => '&#' + c.charCodeAt(0) + ';').join('') + '">';
      const Q = (t) => "1);__pwn('" + t + "');//";
      const app = {
        babies: [Object.assign({}, state.babies[0], { place: Q('place'), allergies: [U('allergy')], growthSource: E('growthSource') })],
        settings: Object.assign({}, state.settings, { hcUnit: U('hcUnit'), wUnit: U('wUnit'), hUnit: U('hUnit') }),
        journey: { rel: { b1: [{ id: 'jr1', relation: 'nana', label: 'Nana', photoId: 'ph1', at: Q('relAt') }] } },
      };
      const preg = { id: 'p1', ownerUid: 'local', stage: 'expecting', dueDate: Date.now() + 70 * 864e5, lmp: Date.now() - 200 * 864e5, cycleLen: 28,
        appts: [{ id: 'ap1', week: 31, title: 'Check', done: true, at: Date.now() - 864e5, sfh: U('sfh'), efw: U('efw'), hb: U('hb'), bpSys: U('bpSys'), bpDia: U('bpDia') }],
        bp: [{ id: 'bp1', at: Date.now() - 864e5, sys: U('sys'), dia: U('dia') }], kicks: [{ id: 'k1', start: Date.now() - 864e5, end: Date.now() - 863e5, count: U('count') }],
        glucose: [{ id: 'gl1', at: Date.now() - 864e5, val: U('val'), unit: 'mmol', context: 'fasting' }], nausea: [{ id: 'nz1', at: Date.now() - 864e5, vomits: U('vomits'), water: U('water'), keptFluids: true }],
        conditions: { bp: true, gd: true }, moments: [], precon: [] };
      if (mode === 'ingest') { window.cubbyIngest.blob(app); window.cubbyIngest.blob(preg); }
      Object.keys(app).forEach((k) => { state[k] = app[k]; });
      state.activeBabyId = 'b1'; PhotoStore.map = { ph1: png };
      try { window.toast = function () {}; } catch (e) {}
      const out = {}; const probe = () => document.getElementById('xssProbe') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'xssProbe' }));
      const check = async (name, run) => {
        window.__pwnHits = []; let err = null, scan = [], text = '';
        try { await run(); } catch (e) { err = e.message; }
        await wait(500);
        scan = window.__scan().map((x) => x.what.slice(0, 140));
        text = ['scroll', 'sheet', 'xssProbe'].map((id) => (document.getElementById(id) || {}).textContent || '').join(' ');
        out[name] = { err, hits: [...new Set(window.__pwnHits)], scan: scan.slice(0, 6), text: (text.match(/PWN-[a-zA-Z]+-/g) || []).filter((x, i, a) => a.indexOf(x) === i) };
        try { closeSheet(); } catch (e) {} const pb = document.getElementById('xssProbe'); if (pb) pb.innerHTML = '';
      };
      await check('place', async () => {
        openBirthPoster();
        const els = [...document.querySelectorAll('#sheet [onclick*="posterPick"], #sheet [onclick*="posterToggleDeco"], #sheet [onclick*="togglePosterPhoto"]')];
        out.placeHandlers = els.length;
        els.forEach((el) => { const x = window.__sandboxRun(el.getAttribute('onclick')); x.hits.forEach((k) => window.__pwnHits.push(k)); if (x.syntax) window.__pwnHits.push('syntax:' + x.syntax); });
        if (els[0]) els[0].click();
      });
      await check('relAt', async () => {
        const realMake = window.makeMomentFromPhoto; window.makeMomentFromPhoto = function () {};
        openRelView('jr1');
        const btn = document.querySelector('#sheet [onclick*="makeMomentFromPhoto"]'); out.relButton = !!btn;
        if (btn) { const x = window.__sandboxRun(btn.getAttribute('onclick')); x.hits.forEach((k) => window.__pwnHits.push(k)); if (x.syntax) window.__pwnHits.push('syntax:' + x.syntax); btn.click(); }
        window.makeMomentFromPhoto = realMake;
      });
      await check('allergies', async () => {
        go('health'); render(); await wait(150);
        openFeed(); setFeedMethod('solids'); await wait(150);   // the "Allergy watch" line on the solids sheet
        const sheet = document.getElementById('sheet').innerHTML; closeSheet(); probe().innerHTML = sheet;
        openFoodPrefs();
      });
      await check('stats', async () => { go('log'); probe().innerHTML = renderStats(); });
      state.pregnancy = preg; viewingPreg = true; try { ensurePregFields(preg); } catch (e) {}
      await check('preg', async () => {
        pregGo('care'); await wait(150);
        ['openBPWatch', 'openKickCounter', 'openGlucoseTracker', 'openNausea'].forEach((f) => { try { window[f](); const s = window.__scan(); if (s.length) window.__pwnHits.push(f + ':' + s[0].what.slice(0, 60)); window.__shown({}); } catch (e) {} });
      });
      return out;
    }, mode, PNG);
    const clean = (x) => x && !x.err && !x.hits.length && !x.scan.length;
    const why = (x) => JSON.stringify(x).slice(0, 600);
    ok(mode + ': a birth place of 1);__pwn(\'place\');// stays data in all ' + r.placeHandlers + ' birth-poster handlers', clean(r.place) && r.placeHandlers >= 8, why(r.place));
    ok(mode + ': a relationship capture\'s `at` of 1);__pwn(...);// stays data in the Together "Make a keepsake" button', clean(r.relAt) && r.relButton, why(r.relAt));
    ok(mode + ': allergies stay text on Health, on the solids sheet and in Food and allergies', clean(r.allergies), why(r.allergies));
    ok(mode + ': and the hostile allergy IS on screen, as text', r.allergies && r.allergies.text.some((t) => /^PWN-allergy-$/i.test(t)), why(r.allergies));
    ok(mode + ': growthSource spelt in entities (it survives toUpperCase) and hcUnit/wUnit/hUnit stay off the Stats screen\'s markup', clean(r.stats), why(r.stats));
    ok(mode + ': the pregnancy readings (visit SFH/EFW/Hb/BP, BP log, kicks, glucose, nausea) stay data', clean(r.preg), why(r.preg));
    await page.close();
  }
}

(async () => {
  staticRule();
  if (STATIC_ONLY) { console.log('\n' + pass + ' passed, ' + fail + ' failed'); console.log('XSS-LEAF: ' + (fail ? 'FAIL' : 'PASS')); process.exit(fail ? 1 : 0); }
  const puppeteer = require('puppeteer-core');
  const dl = require('./gate_downloads');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'], downloadBehavior: dl.downloadBehavior(), protocolTimeout: 600000 });
  // XSS_LEAF_ONLY=text (or absent, named...) runs one part, for working on it. The gate runs all.
  const ONLY = process.env.XSS_LEAF_ONLY || '';
  if (!ONLY || ONLY === 'named') await named(browser);
  const isClock = (k) => CLOCK_KEYS.has(k);
  const CLASSES = [
    { name: 'text', pick: (k, v) => typeof v === 'string' && !SHAPE.has(k) && !KEEP_VALUE.has(v), must: { min: 40, fields: [
      'app.babies[0].allergies[0]', /^app\.journey\.rel\.[^]+\[0\]\.label$/, 'app.babies[0].birthNote', 'app.babies[0].name', 'notes[0].text', 'preg.appts[0].title', 'memberInfo.uidCaregiver.relationship'] } },
    { name: 'enum', pick: (k, v) => typeof v === 'string' && SHAPE.has(k) && !SELECT.has(k) && !KEEP_VALUE.has(v), must: { min: 3 } },
    { name: 'select', pick: (k, v) => typeof v === 'string' && SELECT.has(k) && !KEEP_VALUE.has(v), must: { min: 1 } },
    { name: 'number', pick: (k, v) => typeof v === 'number' && !isClock(k), must: { min: 0 } },
    { name: 'clock', pick: (k, v) => typeof v === 'number' && isClock(k), must: { min: 0 } },
  ];
  for (const c of CLASSES.filter((x) => !ONLY || x.name === ONLY)) {
    const h = household();
    const tags = hostile(h, c.pick, c.name === 'text');
    await runClass(browser, c.name, h, tags, c.must);
  }
  if (!ONLY || ONLY === 'absent') {
    const h = household();
    const fields = sourceFields();
    const tags = addAbsent(h, fields);
    await runClass(browser, 'absent (' + fields.length + ' field names the source reads)', h, tags, { min: 5 });   // most names are read off other records: a wide net, not a display check
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('XSS-LEAF: ' + (fail ? 'FAIL' : 'PASS'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); console.log('XSS-LEAF: FAIL'); process.exit(1); });
