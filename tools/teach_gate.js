/* Blocking gate for the teaching layer (app/teach-data.js + app/teach.js).
 *
 * Three checks, because the governance doc says every guardrail needs an owner and a blocking
 * check, and because each of these has already failed once in design:
 *
 *   COVERAGE  every entry point in the app is either taught or excluded WITH A REASON. The count
 *             was wrong twice before it was right: a grep of app/index.html alone misses the
 *             runtime modules (openVoiceLog, openFamily, openFirstRun, the pickers), and four
 *             entry points are `window.X = function` assignments that no `function open*` pattern
 *             catches. openFamily is the circle screen — the biggest differentiator in the
 *             product — and it was missing from the first audit.
 *
 *   VOICE     mechanical, so quality cannot sag at entry ninety. The voice rule was already
 *             written down; this is what makes it enforceable.
 *
 *   LEDGER    simulated, not reasoned about. A check that only passes in the morning is not a
 *             check, so the clock is injected rather than read.
 *
 * Pure node, no browser: the ledger runs against stubbed window/localStorage so it cannot flake.
 *
 *   node tools/teach_gate.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let fails = 0, passes = 0;
function check(ok, what, detail) {
  if (ok) { passes++; }
  else { fails++; console.log('  FAIL  ' + what + (detail ? '\n        ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

/* ---------------------------------------------------------------- load the registry ---------- */
const win = {};
(function () {
  const src = fs.readFileSync(path.join(ROOT, 'app/teach-data.js'), 'utf8');
  new Function('window', src)(win);
})();
const REG = win.CubbyTeachData;
if (!REG) { console.log('FATAL: app/teach-data.js did not define CubbyTeachData'); process.exit(1); }
const ROWS = REG.rows, NO = REG.noTeach;

/* ---------------------------------------------------------------- 1. coverage ---------------- */
section('coverage');

// Same sweep the audit used, over the shell AND every runtime module. Data files and the service
// workers are excluded because they define no user-reachable screens.
const SKIP = /^(sw|firebase-messaging-sw|firebase-init|landing|native-bridge|journey-catalogue|.*-data)\.js$/;
function entryPoints() {
  const files = ['index.html'].concat(
    fs.readdirSync(path.join(ROOT, 'app')).filter(f => f.endsWith('.js') && !SKIP.test(f))
  );
  const found = {};
  const pats = [
    /(?:^|[^A-Za-z0-9_.])function\s+((?:open|show)[A-Z][A-Za-z0-9_]*)\s*\(/g,
    /window\.((?:open|show)[A-Z][A-Za-z0-9_]*)\s*=/g,
    /(?:const|let|var)\s+((?:open|show)[A-Z][A-Za-z0-9_]*)\s*=\s*function/g
  ];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, 'app', f), 'utf8');
    for (const p of pats) { let m; while ((m = p.exec(src))) if (!found[m[1]]) found[m[1]] = f; }
  }
  return found;
}
const live = entryPoints();
const liveNames = Object.keys(live);
const known = new Set(Object.keys(ROWS).concat(Object.keys(NO)));

const unregistered = liveNames.filter(n => !known.has(n));
check(unregistered.length === 0,
  'every entry point is taught or excluded',
  unregistered.length ? unregistered.length + ' unregistered: ' + unregistered.join(', ')
    + '\n        -> add to TEACH, or to NO_TEACH with a written reason' : '');

const ghosts = [...known].filter(n => !live[n]);
check(ghosts.length === 0,
  'no registry row points at an entry point that no longer exists',
  ghosts.length ? ghosts.join(', ') : '');

const bothPlaces = Object.keys(ROWS).filter(n => NO[n]);
check(bothPlaces.length === 0, 'no row is both taught and excluded', bothPlaces.join(', '));

const noReason = Object.keys(NO).filter(n => !NO[n] || String(NO[n]).trim().length < 12);
check(noReason.length === 0, 'every exclusion carries a written reason', noReason.join(', '));

check(liveNames.length === Object.keys(ROWS).length + Object.keys(NO).length,
  'counts reconcile (' + liveNames.length + ' live)');

/* ---------------------------------------------------------------- 2. voice ------------------- */
section('voice');

const GUILT = [/\byou haven'?t\b/i, /\bdon'?t forget\b/i, /\byou should\b/i, /\bmake sure you\b/i,
               /\bremember to\b/i, /\bfailed to\b/i, /\byou missed\b/i];
const JARGON = [/\bleverage\b/i, /\butilis?e\b/i, /\bseamless/i, /\bsimply\b/i, /\beffortless/i,
                /\brobust\b/i, /\bempower/i];
const rowIds = Object.keys(ROWS);

function voiceCheck(id, field, s) {
  const where = id + '.' + field;
  check(s.indexOf('—') === -1, 'no em-dash in ' + where, s);
  check(!GUILT.some(r => r.test(s)), 'no guilt in ' + where, s);
  check(!JARGON.some(r => r.test(s)), 'no jargon in ' + where, s);
  check(s.indexOf('  ') === -1, 'no double space in ' + where, s);
  check(/[.!?]$/.test(s.trim()), where + ' ends in a full stop', s);
  check(s[0] === s[0].toUpperCase(), where + ' starts with a capital', s);
}
rowIds.forEach(id => {
  const r = ROWS[id];
  check(!!r.one && r.one.trim().length > 0, id + ' has a one-line answer');
  if (r.one) {
    check(r.one.length <= 140, id + '.one is under 140 chars', r.one.length + ': ' + r.one);
    voiceCheck(id, 'one', r.one);
  }
  check(!!r.label && r.label.length <= 40, id + ' has a short label');
  /* Structural. A patch that inserted page fields at the wrong brace once nested the whole page
     INSIDE who:{...}. That parses, so it showed up only as "missing why" on a few rows rather than
     as the structural break it was. Unknown keys in who are now the loud failure they should be. */
  const WHO_KEYS = ['stage', 'role', 'months', 'circle', 'needs'];
  const ROW_KEYS = ['label', 'aka', 'fn', 'domain', 'depth', 'one', 'what', 'get', 'who', 'earn',
                    'faq', 'read', 'why', 'matters', 'how', 'payoff'];
  Object.keys(r.who || {}).forEach(k => check(WHO_KEYS.indexOf(k) !== -1,
    id + '.who has only known keys', 'unexpected: ' + k));
  Object.keys(r).forEach(k => check(ROW_KEYS.indexOf(k) !== -1,
    id + ' has only known keys', 'unexpected: ' + k));
  check(['one', 'chapter', 'page'].indexOf(r.depth) !== -1, id + ' has a valid depth');
  /* A chapter PROMISES two more fields. Declaring the depth and then not carrying the content is
     the failure mode this whole registry exists to prevent: a dot that opens a screen with a
     heading and nothing under it is worse than no dot. If it has no what and get, it is a
     one-liner and the row has to say so. */
  if (r.depth === 'chapter') {
    check(!!r.what, id + ' is a chapter and carries `what`');
    check(!!r.get, id + ' is a chapter and carries `get`');
    if (r.what) voiceCheck(id, 'what', r.what);
    if (r.get) voiceCheck(id, 'get', r.get);
  }

  // A page is the deepest tier: it exists for the capabilities whose benefit is not obvious from
  // the button, so it has to actually carry the benefit rather than just more words.
  if (r.depth === 'page') {
    check(!!r.why, id + ' page states why it is worth doing');
    check(Array.isArray(r.matters) && r.matters.length >= 3,
      id + ' page has at least three things that matter');
    check(Array.isArray(r.how) && r.how.length >= 3, id + ' page explains how it works');
    check(!!r.payoff, id + ' page ends on the payoff');
    if (r.why) voiceCheck(id, 'why', r.why);
    if (r.payoff) voiceCheck(id, 'payoff', r.payoff);
    (r.matters || []).forEach((m, i) => {
      check(Array.isArray(m) && m.length === 2, id + '.matters[' + i + '] is a heading and a body');
      if (Array.isArray(m) && m.length === 2) {
        check(m[0].length <= 46, id + '.matters[' + i + '] heading is short', m[0]);
        check(!/[.]$/.test(m[0]), id + '.matters[' + i + '] heading is not a sentence', m[0]);
        voiceCheck(id, 'matters[' + i + ']', m[1]);
      }
    });
    (r.how || []).forEach((h, i) => voiceCheck(id, 'how[' + i + ']', h));
  }
});

/* An absent read slug means NO read button, never an invented one. A teaching page that links to
   an article which does not exist is worse than one that links to nothing. */
(function () {
  const w2 = {};
  new Function('window', fs.readFileSync(path.join(ROOT, 'app/reads-data.js'), 'utf8'))(w2);
  const slugs = new Set();
  Object.keys(w2.READS || {}).forEach(g => (w2.READS[g] || []).forEach(r => slugs.add(r.s)));
  const linked = rowIds.filter(id => ROWS[id].read);
  linked.forEach(id => check(slugs.has(ROWS[id].read),
    id + '.read points at an article that exists', ROWS[id].read));
  check(slugs.size > 0, 'reads-data.js loaded (' + slugs.size + ' articles)');
})();

/* Every bottom sheet finds its teaching row by matching its own <h2> against these labels, so two
   rows normalising to the same string would silently point a sheet at the wrong capability. This is
   the assertion that whole mechanism rests on. */
(function () {
  const norm = s => String(s || '').toLowerCase()
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/&amp;/g, '&').replace(/[^a-z0-9 &]/g, '').replace(/\s+/g, ' ').trim();
  const seen = {};
  const clashes = [];
  rowIds.forEach(id => {
    const n = norm(ROWS[id].label);
    check(!!n, id + ' has a label that survives normalising', ROWS[id].label);
    if (seen[n]) clashes.push(n + ': ' + seen[n] + ' vs ' + id); else seen[n] = id;
  });
  check(clashes.length === 0,
    'no two labels collide once normalised (sheet matching would pick the wrong one)',
    clashes.join('; '));

  /* `aka` alternates are matched by substring, for sheets whose heading is built from data. That is
     a looser test than the label match, so it needs a tighter guard: no alternate may appear inside
     any other row's label or alternate, or adding a row later would silently steal somebody's dot. */
  const akas = [];
  rowIds.forEach(id => (ROWS[id].aka || []).forEach(a => akas.push([norm(a), id])));
  akas.forEach(([a, id]) => {
    check(a.length >= 4, id + ' alternate is long enough to be specific', a);
    rowIds.forEach(other => {
      if (other === id) return;
      check(norm(ROWS[other].label).indexOf(a) === -1,
        'alternate "' + a + '" (' + id + ') does not also match ' + other + "'s label");
      (ROWS[other].aka || []).forEach(b => check(norm(b).indexOf(a) === -1,
        'alternate "' + a + '" (' + id + ') does not also match ' + other + "'s alternate"));
    });
  });
  check(true, 'alternates checked (' + akas.length + ')');
})();

// Pro must never read as buyable before October 2026.
const proRow = ROWS.openPro;
check(!!proRow && !/\bbuy\b|\bsubscribe\b|\bpurchase\b/i.test(proRow.one),
  'Pro copy does not imply it is buyable', proRow && proRow.one);

// Mood is owner-only, and must stay owner-only in the answer search too.
check(ROWS.openMoodNote && ROWS.openMoodNote.who && ROWS.openMoodNote.who.role === 'owner',
  'mood is gated to the owner in the registry itself',
  'a caregiver finding it in search leaks the existence of a private record');

/* ---------------------------------------------------------------- 3. ledger ------------------ */
section('ledger');

const DAY = 86400000;
function makeLedger(ctxObj, clock) {
  const store = {};
  const sess = {};
  const w = {
    CubbyTeachData: REG,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    sessionStorage: {
      getItem: k => (k in sess ? sess[k] : null),
      setItem: (k, v) => { sess[k] = String(v); }
    },
    cubbyTeachCtx: () => ctxObj
  };
  const src = fs.readFileSync(path.join(ROOT, 'app/teach.js'), 'utf8');
  new Function('window', 'localStorage', 'sessionStorage', src)(w, w.localStorage, w.sessionStorage);
  w.CubbyTeach._now = clock;
  return { T: w.CubbyTeach, newSession: () => { for (const k in sess) delete sess[k]; } };
}
const T0 = 1770000000000;   // fixed clock. a check that only passes in the morning is not a check
function baseCtx(over) {
  return Object.assign({
    uid: 'u1', stage: 'baby', role: 'owner', months: 2, week: null,
    lossHolding: false, sheetOpen: false, installedAt: T0 - 3 * DAY
  }, over || {});
}

// -- nothing fires under lossHolding, and it is checked before scoring
{
  const c = baseCtx({ lossHolding: true });
  const { T } = makeLedger(c, () => T0);
  T.fire('fever'); T.fire('3-photos'); T.fire('first-log');
  check(T.eligible().length === 0, 'lossHolding leaves zero eligible cues');
  check(T.ask('openVisitSummary') === false, 'lossHolding refuses even the most urgent cue');
  check(T.explain('openVisitSummary') === 'loss', 'the refusal reason is loss, not a lost ranking');
}

// -- two cues cannot fire in one session
{
  const c = baseCtx();
  const { T } = makeLedger(c, () => T0);
  T.fire('fever'); T.fire('med-added');
  const first = T.eligible()[0], second = T.eligible()[1];
  check(T.ask(first) === true, 'the first cue of a session fires');
  check(T.ask(second) === false, 'a second cue in the same session does not');
  check(T.explain(second) === 'session-spent', 'and says why');
}

// -- THE ONE THAT MATTERS: a keepsake can never beat a fever, at any budget
{
  const c = baseCtx();
  const { T } = makeLedger(c, () => T0);
  T.fire('fever'); T.fire('3-photos');
  check(T.ask('openMemoryCard') === false, 'the keepsake cue loses to the fever cue');
  check(/^held-behind:/.test(T.explain('openMemoryCard')), 'and is held, not refused');
  check(T.eligible()[0] === 'openVisitSummary', 'health outranks memories in the ordering');
}

// -- held is not denied: it competes again tomorrow
{
  const c = baseCtx();
  let t = T0;
  const { T, newSession } = makeLedger(c, () => t);
  T.fire('fever'); T.fire('3-photos');
  T.ask('openVisitSummary');
  t += DAY; newSession();
  check(T.ask('openMemoryCard') === true, 'the held cue fires the next day once the winner is seen');
}

// -- the allowance decays, and is enforced
{
  const c = baseCtx();
  const { T } = makeLedger(c, () => T0);
  check(T._allowanceFor(1) === 3 && T._allowanceFor(14) === 3, 'first fortnight allows three a day');
  check(T._allowanceFor(15) === 2 && T._allowanceFor(60) === 2, 'to day sixty allows two');
  check(T._allowanceFor(61) === 1 && T._allowanceFor(900) === 1, 'after that, one');
}
{
  // Always ask for whatever the ledger itself ranks first, so this measures the BUDGET rather
  // than accidentally re-testing the ranking with a hand-picked order.
  const c = baseCtx();
  let t = T0;
  const { T, newSession } = makeLedger(c, () => t);
  ['fever', 'med-added', 'birthday-set', 'second-caregiver'].forEach(e => T.fire(e));
  let fired = 0;
  for (let i = 0; i < 6; i++) {
    const top = T.eligible()[0];
    if (top && T.ask(top)) fired++;
    t += 2 * 3600000; newSession();          // next session, past the cooldown, same day
  }
  check(fired === 3, 'exactly three fire on a day-3 allowance of three', 'fired ' + fired);
  check(T.explain(T.eligible()[0]) === 'no-allowance', 'the fourth is refused for budget');
}

// -- the ninety-minute cooldown
{
  const c = baseCtx();
  let t = T0;
  const { T, newSession } = makeLedger(c, () => t);
  T.fire('fever'); T.fire('med-added');
  T.ask(T.eligible()[0]);
  const next = T.eligible()[0];
  t += 30 * 60000; newSession();
  check(T.ask(next) === false, 'a cue thirty minutes later is refused');
  check(T.explain(next) === 'cooldown', 'for the cooldown, not the budget');
  t += 70 * 60000; newSession();
  check(T.ask(next) === true, 'and allowed once ninety minutes have passed');
}

// -- pull and push share one seen key
{
  const c = baseCtx();
  const { T } = makeLedger(c, () => T0);
  T.fire('7-days-logged');
  T.markSeen('openRoutinesEdit');            // she tapped the info dot
  check(T.ask('openRoutinesEdit') === false, 'reading it via the dot stops the nudge');
  check(T.explain('openRoutinesEdit') === 'seen', 'asking a question is never punished with a lecture');
}

// -- a stale trigger stops asking
{
  const c = baseCtx();
  let t = T0;
  const { T } = makeLedger(c, () => t);
  T.fire('3-photos');
  t += 11 * DAY;
  check(T.ask('openMemoryCard') === false, 'a trigger fired eleven days ago no longer fires');
  check(T.explain('openMemoryCard') === 'stale', 'and is stale rather than merely outranked');
}

// -- a row is never offered to somebody the shell would not open it for
{
  const c = baseCtx({ stage: 'pregnancy' });
  const { T } = makeLedger(c, () => T0);
  T.fire('birthday-set');
  check(T.ask('openVaccineCountry') === false, 'a baby-stage cue is not offered while expecting');
  check(T.explain('openVaccineCountry') === 'not-for-them', 'gated by who, before any scoring');
}

/* -- first-open coach marks share the one allowance -------------------------------------------
   Before this, four marks could fire in a single session if somebody tapped through four tabs on
   their first evening, which is the chained tour ONBOARDING.md rules out. Measured, not assumed:
   a fresh profile visiting home, log, album and health showed five cues. */
{
  const c = baseCtx();
  const { T, newSession } = makeLedger(c, () => T0);
  check(T.askMark('firstopen:home') === true, 'the first mark of a session fires');
  check(T.askMark('firstopen:log') === false, 'a second, different mark in the same session does not');
  check(T.askMark('firstopen:home') === true,
    'but re-asking the SAME mark stays true, or it would vanish on the next render');
}
{
  // the property that matters: a tab explaining itself never beats the parent's own data
  const c = baseCtx();
  const { T } = makeLedger(c, () => T0);
  T.fire('fever');
  check(T.askMark('firstopen:health') === false, 'a mark defers while an earned cue is eligible');
  check(T.ask('openVisitSummary') === true, 'and the earned cue takes the slot instead');
}
{
  const c = baseCtx();
  const { T } = makeLedger(c, () => T0);
  T.fire('fever');
  check(T.ask('openVisitSummary') === true, 'an earned cue fires');
  check(T.askMark('firstopen:health') === false, 'and no mark follows it in the same session');
}
{
  const c = baseCtx({ lossHolding: true });
  const { T } = makeLedger(c, () => T0);
  check(T.askMark('firstopen:home') === false, 'no mark renders under lossHolding');
}
{
  const c = baseCtx({ sheetOpen: true });
  const { T } = makeLedger(c, () => T0);
  check(T.askMark('firstopen:home') === false, 'no mark renders over an open sheet or Get started');
}

/* -- the monthly door ---------------------------------------------------------------------------
   The long tail: 44 rows carry no trigger and can never push, so a browse surface is the only way
   they get reached. One card a month, and the rules that stop it becoming a second nag. */
{
  const c = baseCtx();
  let t = T0;
  const { T } = makeLedger(c, () => t);
  check(T.doorDue() === false, 'no door in the first month, when everything is still new');
  t = T0 + 31 * DAY;
  check(T.doorDue() === true, 'the door opens after a month');
  const picked = T.unmet(8);
  check(picked.length >= 3, 'it only offers when there are at least three things to show');
  check(picked.every(id => ROWS[id].depth !== 'one'),
    'it never offers a one-liner, which would open onto nothing');
  /* Straight value order returned eight health rows, which reads as a health list rather than a
     look around. Ranking is right for choosing one cue and wrong for choosing a browse set. */
  const perDom = {};
  picked.forEach(id => { perDom[ROWS[id].domain] = (perDom[ROWS[id].domain] || 0) + 1; });
  check(Object.keys(perDom).length >= 3,
    'the door spans at least three domains, so it reads as a look around',
    JSON.stringify(perDom));
  check(Object.values(perDom).every(n => n <= 2), 'and never more than two from one domain',
    JSON.stringify(perDom));
  T.markDoor(picked);
  check(T.doorDue() === false, 'and not again the same month');
  t += 31 * DAY;
  check(T.doorDue() === true, 'but yes the month after');
  check(T.unmet(8).every(id => picked.indexOf(id) === -1),
    'and it never re-offers what it already showed');
}
{
  /* THE ONE THAT MATTERS. Being listed in a browse screen is not being taught. If the door marked
     rows seen, it would silently cancel the contextual nudge that had something better to say at a
     better moment, and the parent would simply never hear about it. */
  const c = baseCtx();
  let t = T0 + 31 * DAY;
  const { T, newSession } = makeLedger(c, () => t);
  T.markDoor(['openVisitSummary']);
  T.fire('fever');
  newSession();
  check(T.ask('openVisitSummary') === true,
    'a row shown in the door can still fire its own cue later',
    'the door must not write to `seen`');
}
{
  // it is the long tail, not the urgent thing
  const c = baseCtx();
  let t = T0 + 31 * DAY;
  const { T } = makeLedger(c, () => t);
  T.fire('fever');
  check(T.askMark('monthly-door') === false, 'the door waits while an earned cue is eligible');
}
{
  const c = baseCtx({ lossHolding: true });
  const { T } = makeLedger(c, () => T0 + 60 * DAY);
  check(T.doorDue() === false, 'no door under lossHolding');
  check(T.unmet(8).length === 0, 'and nothing is even offered to it');
}
{
  // the search index has to actually contain what a parent would type
  const hay = id => [ROWS[id].label, ROWS[id].one, ROWS[id].what, ROWS[id].get, ROWS[id].why,
                     ROWS[id].payoff].concat((ROWS[id].matters || []).map(m => m[0] + ' ' + m[1]))
                     .filter(Boolean).join(' ').toLowerCase();
  check(hay('openDiaper').indexOf('doctor') !== -1, 'searching "doctor" would reach nappies');
  check(hay('openVisitSummary').indexOf('doctor') !== -1, 'and the visit summary');
  check(hay('openMoodNote').indexOf('shared') !== -1, 'searching "shared" would reach mood');
  check(rowIds.every(id => hay(id).length > 20), 'every row has something searchable');
}

// -- depth ranks in the right order. A page is for the capabilities whose benefit is not obvious,
//    so it must never sit below a chapter or a one-liner with the same domain and trigger.
{
  const c = baseCtx();
  const { T } = makeLedger(c, () => T0);
  const mk = (domain, depth) => T._value({ domain: domain, depth: depth });
  check(mk('health', 'page') > mk('health', 'chapter'), 'a page outranks a chapter');
  check(mk('health', 'chapter') > mk('health', 'one'), 'a chapter outranks a one-liner');
  // and the property the whole ranking exists for, stated directly
  check(T._value(ROWS.openVisitSummary) > T._value(ROWS.openMemoryCard),
    'the visit summary always outranks a keepsake');
}

// -- an untriggered row can never push, by construction
{
  const c = baseCtx();
  const { T } = makeLedger(c, () => T0);
  const noEarn = Object.keys(ROWS).filter(k => !ROWS[k].earn);
  check(noEarn.length > 0, 'some rows deliberately carry no trigger (' + noEarn.length + ')');
  check(noEarn.every(id => T.ask(id) === false), 'and none of them can ever fire');
}

/* ---------------------------------------------------------------- report --------------------- */
const total = passes + fails;
console.log('\n' + (fails ? 'FAIL' : 'PASS') + ' — ' + passes + '/' + total + ' checks'
  + '   (' + liveNames.length + ' entry points, ' + Object.keys(ROWS).length + ' taught, '
  + Object.keys(ROWS).filter(k => ROWS[k].earn).length + ' with triggers)');
process.exit(fails ? 1 : 0);
