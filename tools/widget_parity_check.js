/* The widgets' copy and buttons come from one file, and this holds the rules for them (plan 1, Task 4).
 *
 *   node tools/widget_parity_check.js                judge this checkout
 *   node tools/widget_parity_check.js --self-test    first stage thirteen failures in temporary copies of the
 *                                                    inputs (each must be caught, for its reason), then judge
 *   node tools/widget_parity_check.js --root=<dir>   judge another tree (what the self-test runs)
 *
 *   1. generated files are fresh   the generated files are what tools/widget_gen.js would write.
 *   2. QUICK_ACTIONS               the markers, the widget fields, health, and the shortcuts_check row regex.
 *   3. copy rules                  voice, placeholders, platforms, differences, a11y keys, month-day keys.
 *   4. the reference model         docs/widgets/widget-fixtures.json is the model's output over the copy file's
 *                                  cases; every hand-written expectation agrees; the bytes are zone-free.
 * Later tasks add the native halves. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { generate, readQuickActions, readAllActions } = require('./widget_gen');
const { createModel } = require('./widget_model');

const ARGS = process.argv.slice(2);
const SELF_TEST = ARGS.includes('--self-test');
const ROOT_ARG = (ARGS.find((a) => a.startsWith('--root=')) || '').slice(7);
const ROOT = ROOT_ARG ? path.resolve(ROOT_ARG) : path.join(__dirname, '..');
const REAL = path.join(__dirname, '..');
const INPUTS = ['docs/widgets/widget-copy.json', 'workers/shared/since-rules.mjs', 'workers/shared/widget-rules.mjs',
  'app/since-rules.js', 'app/index.html', 'docs/widgets/widget-fixtures.json'];

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log('  ok   ' + name);
  else { fails++; console.log('  FAIL ' + name + (detail !== undefined ? '\n         ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); }
};
const section = (n) => console.log('\n' + n);
const rd = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const BANNED = ['don\'t forget', 'last chance', 'time for', 'streak', 'goal', 'total', 'Pro'];
const PROPER = ['Cubby', 'Smart Rotate', 'AM', 'PM'];
const PLACEHOLDERS = ['name', 'names', 'time', 'day', 'by', 'age'];
const SURFACES = ['gallery', 'home', 'small', 'lock', 'a11y', 'line', 'config', 'app'];
/* Copied from tools/shortcuts_check.js; asserted byte-equal to that file's line so the two cannot drift. */
const ROW_RE_LITERAL = "/\\{k:'([a-z]+)',\\s*s:\\[([^\\]]*)\\],\\s*label:'([^']*)',\\s*hint:(?:'([^']*)'|\\([^)]*\\)=>)/g";

const TABLE = {
  feed: { go: 'feed', inPlace: false, perBaby: false, platforms: null, places: ['small', 'shortcut'] },
  sleep: { go: 'sleep', inPlace: true, perBaby: false, platforms: null, places: ['small', 'shortcut'] },
  diaper: { go: 'diaper', inPlace: false, perBaby: false, platforms: null, places: ['small', 'shortcut'] },
  pump: { go: 'pump', inPlace: false, perBaby: false, platforms: null, places: ['medium4', 'small', 'shortcut'] },
  measure: { go: 'measure', inPlace: false, perBaby: false, platforms: null, places: ['shortcut'] },
  activity: { go: 'activity', inPlace: false, perBaby: false, platforms: null, places: ['medium4', 'small', 'shortcut'] },
  milestone: { go: 'milestone', inPlace: false, perBaby: false, platforms: null, places: ['shortcut'] },
  voice: { go: 'voice', inPlace: false, perBaby: false, platforms: ['android'], places: ['medium4', 'small', 'shortcut'] },
  health: { go: 'health', inPlace: false, perBaby: true, platforms: null, places: ['medium4', 'small'] },
};

function sortK(v) { if (Array.isArray(v)) return v.map(sortK); if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach((k) => { o[k] = sortK(v[k]); }); return o; } return v; }
function sameObj(a, b) { return JSON.stringify(sortK(a)) === JSON.stringify(sortK(b)); }

/* A hand-written `expect` is a deep partial of the model's answer: objects check the keys they name, arrays must
 * be the same length (use {} for a row you do not pin), and `intent`, `url` and `moment` are compared whole, so a
 * stray `starts` on a start or a moment where the case says null fails. Returns a description or null. */
const WHOLE = { intent: 1, url: 1, moment: 1 };
function diffPartial(exp, act, key, where) {
  if (WHOLE[key]) return sameObj(exp, act) ? null : where + ': expected ' + JSON.stringify(exp) + ' got ' + JSON.stringify(act);
  if (Array.isArray(exp)) {
    if (!Array.isArray(act) || act.length !== exp.length) return where + ': expected ' + exp.length + ' items, got ' + (Array.isArray(act) ? act.length : JSON.stringify(act));
    for (let i = 0; i < exp.length; i++) { const d = diffPartial(exp[i], act[i], '', where + '[' + i + ']'); if (d) return d; }
    return null;
  }
  if (exp && typeof exp === 'object') {
    if (!act || typeof act !== 'object') return where + ': expected an object, got ' + JSON.stringify(act);
    for (const k of Object.keys(exp)) { const d = diffPartial(exp[k], act[k], k, where ? where + '.' + k : k); if (d) return d; }
    return null;
  }
  return exp === act ? null : where + ': expected ' + JSON.stringify(exp) + ' got ' + JSON.stringify(act);
}

function judge() {
  section('1. generated files are fresh');
  let out = {};
  try { out = generate(ROOT); } catch (e) { ok('generate() runs', false, e.message); }
  Object.keys(out).forEach((rel) => {
    let have = null;
    try { have = rd(rel); } catch (e) { /* missing */ }
    ok('generated files are fresh: ' + rel, have === out[rel], have === null ? 'missing' : 'differs from what tools/widget_gen.js writes');
  });

  section('2. QUICK_ACTIONS');
  const html = rd('app/index.html');
  const count = (s, t) => s.split(t).length - 1;
  ok('the QUICK_ACTIONS markers appear once each',
    count(html, '/* WIDGET-QUICK-ACTIONS-BEGIN */') === 1 && count(html, '/* WIDGET-QUICK-ACTIONS-END */') === 1);
  let rows = null, all = null;
  try { rows = readQuickActions(ROOT); all = readAllActions(ROOT); } catch (e) { ok('QUICK_ACTIONS can be read', false, e.message); }
  if (rows) {
    const got = {};
    rows.forEach((r) => { got[r.key] = { go: r.go, inPlace: r.inPlace, perBaby: r.perBaby, platforms: r.platforms, places: r.places }; });
    ok('the widget fields equal the contract table exactly', sameObj(got, TABLE), got);
    const health = all.find((r) => r.key === 'health');
    ok('health is on no in-app surface (s:[])', !!health && health.stages.length === 0, health);
    ok('health is per baby', !!rows.find((r) => r.key === 'health' && r.perBaby), rows.find((r) => r.key === 'health'));
    ok('kicks, contractions, symptom and mood carry no widget',
      ['kicks', 'contractions', 'symptom', 'mood'].every((k) => { const r = all.find((x) => x.key === k); return r && !r.widget; }));
  }
  const sc = fs.readFileSync(path.join(REAL, 'tools/shortcuts_check.js'), 'utf8').split('\n')
    .find((l) => /^\s*const re = \/\\\{k:'/.test(l));
  ok('the row regex is byte-equal to the one in tools/shortcuts_check.js', !!sc && sc.trim() === 'const re = ' + ROW_RE_LITERAL + ';', sc);
  const blockM = /const QUICK_ACTIONS=\[([\s\S]*?)\n\];/.exec(html);
  if (blockM) {
    const re = new RegExp(ROW_RE_LITERAL.slice(1, ROW_RE_LITERAL.lastIndexOf('/')), 'g');
    const seen = (blockM[1].match(re) || []).length;
    const opens = count(blockM[1].replace(/^\s*\/\/.*$/gm, ''), '{k:\'');
    ok('the shortcuts_check row regex matches every row', seen === opens && seen > 0, { seen, opens });
  } else ok('the QUICK_ACTIONS block is found', false);

  section('3. copy rules');
  const copy = JSON.parse(rd('docs/widgets/widget-copy.json'));
  const strings = copy.strings || {};
  const keys = Object.keys(strings);
  const labels = all ? all.map((r) => r.label) : [];
  ok('banned equals the contract list', JSON.stringify(copy.banned) === JSON.stringify(BANNED), copy.banned);
  ok('properNouns equals the contract list', JSON.stringify(copy.properNouns) === JSON.stringify(PROPER), copy.properNouns);
  const bad = (pred) => keys.filter((k) => !pred(k, strings[k]));
  const kb = bad((k) => /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/.test(k));
  ok('keys are dotted lowerCamel names', keys.length > 0 && !kb.length, kb);
  const on = bad((k, s) => Array.isArray(s.on) && s.on.length > 0 && s.on.every((x) => SURFACES.includes(x)));
  ok('every string is on at least one of the eight surfaces', !on.length, on);
  const pl = bad((k, s) => Array.isArray(s.platforms) && s.platforms.length > 0 && s.platforms.every((x) => x === 'ios' || x === 'android'));
  ok('platforms are ios and android only', !pl.length, pl);
  const ph = bad((k, s) => (s.text.match(/\{[^}]*\}/g) || []).every((p) => PLACEHOLDERS.includes(p.slice(1, -1))));
  ok('only the six placeholders appear', !ph.length, ph.map((k) => k + ': ' + strings[k].text));
  const em = bad((k, s) => s.text.indexOf('\u2014') < 0);
  ok('no em-dash', !em.length, em);
  const bn = bad((k, s) => !BANNED.filter((b) => b !== 'Pro').some((b) => s.text.toLowerCase().includes(b.toLowerCase())) && !/\bPro\b/.test(s.text));
  ok('no banned phrase', !bn.length, bn.map((k) => k + ': ' + strings[k].text));
  const cap = [];
  const properWords = new Set(PROPER.join(' ').split(' '));
  // Button names, only mid-sentence in prose that names the buttons (config, app), and only as a WHOLE label:
  // "Say it" is exempt, "Say Hello" is not. insideLabel(words, i) is true when word i sits in a run of words
  // that spells one of the labels exactly.
  const labelRuns = labels.map((l) => l.split(/\s+/).filter(Boolean));
  const strip = (w) => w.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
  const insideLabel = (words, i) => labelRuns.some((run) => {
    for (let st = Math.max(0, i - run.length + 1); st <= i && st + run.length <= words.length; st++) {
      if (run.every((rw, j) => strip(words[st + j]) === rw)) return true;
    }
    return false;
  });
  keys.forEach((k) => {
    const t = strings[k].text.replace(/\{[^}]*\}/g, '').trim();
    const words = t.split(/\s+/).filter(Boolean);
    words.forEach((w, i) => {
      const clean = w.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
      if (!/^[A-Z]/.test(clean) || properWords.has(clean) || i === 0) return;
      if (insideLabel(words, i) && (strings[k].on.includes('config') || strings[k].on.includes('app'))) return;
      if (/[.?!]$/.test(words[i - 1])) return;
      cap.push(k + ': ' + clean);
    });
  });
  ok('sentence case: no stray capital words', !cap.length, cap);
  const lq = keys.filter((k) => strings[k].on.includes('lock') && strings[k].text.includes('?'));
  ok('no question mark on the lock screen', !lq.length, lq);

  const diffs = copy.differences || [];
  const dk = diffs.map((d) => d.key);
  const oneP = keys.filter((k) => strings[k].platforms.length === 1).concat(['actions.voice']);
  ok('every one-platform key and actions.voice is declared in differences', oneP.every((k) => dk.includes(k)), oneP.filter((k) => !dk.includes(k)));
  const dbad = diffs.filter((d) => !(strings[d.key] || d.key === 'actions.voice') || typeof d.why !== 'string' || d.why.length < 20);
  ok('every differences key is real, with a reason of 20+ characters', !dbad.length, dbad.map((d) => d.key));
  const aKeys = [];
  (rows || []).forEach((r) => {
    if (!r.places.some((p) => p === 'medium4' || p === 'small')) return;
    aKeys.push(['a11y.' + (r.key === 'diaper' ? 'nappy' : r.key === 'voice' ? 'sayIt' : r.key) + 'For', r.label]);
  });
  const abad = aKeys.filter(([k, l]) => !(strings[k] && strings[k].text.startsWith(l)));
  ok('every widget button has an a11y "For" key that starts with its label', aKeys.length > 0 && !abad.length, abad);

  const mBad = [];
  [['moment', null], ['small.moment', '{name}'], ['twins.moment', '{names}'], ['a11y.moment', '{name}']].forEach(([pre, who]) => {
    const depth = pre.split('.').length + 1;
    const have = keys.filter((k) => k.startsWith(pre + '.') && k.split('.').length === depth).map((k) => k.slice(pre.length + 1)).sort();
    if (JSON.stringify(have) !== JSON.stringify(['month1', 'months', 'year1', 'years'])) mBad.push(pre + ' has ' + have.join(','));
    ['month1', 'months', 'year1', 'years'].forEach((n) => {
      const s = strings[pre + '.' + n];
      if (!s) return;
      const plural = n === 'months' || n === 'years';
      if (s.text.includes('{age}') !== plural) mBad.push(pre + '.' + n + ' {age}');
      if (who && !s.text.includes(who)) mBad.push(pre + '.' + n + ' ' + who);
      if (who === '{name}' && s.text.includes('{names}')) mBad.push(pre + '.' + n + ' has {names}');
      if (s.platforms.length !== 2) mBad.push(pre + '.' + n + ' platforms');
    });
  });
  ok('moment keys: the sixteen F10 strings are complete', !mBad.length, mBad);

  section('4. the reference model and its fixtures');
  const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'docs/widgets/widget-copy.json'))).digest('hex');
  let fx = null;
  try { fx = JSON.parse(rd('docs/widgets/widget-fixtures.json')); } catch (e) { /* missing or not JSON */ }
  ok('fixtures: widget-fixtures.json exists and its source is widget-copy.json\'s sha256', !!fx && fx.source === sha, fx ? { have: fx.source, want: sha } : 'missing');
  if (fx) {
    ok('fixtures: tz is UTC', fx.tz === 'UTC', fx.tz);
    ok('fixtures: napCases equal widget-copy.json\'s', sameObj(fx.napCases, copy.napCases || []), fx.napCases);
  }
  const cases = copy.cases || [];
  ok('fixtures: the copy file has cases with unique names', cases.length > 0 && new Set(cases.map((c) => c.name)).size === cases.length, cases.length);
  let model = null;
  try { model = createModel(copy, rows || readQuickActions(ROOT)); } catch (e) { ok('the model builds', false, e.message); }
  if (model) {
    const made = cases.map((c) => { try { return { name: c.name, input: c.input, expect: model(c.input) }; } catch (e) { return { name: c.name, error: e.message }; } });
    ok('fixtures equal renderModel over cases', !!fx && sameObj(fx.fixtures, made), fx ? 'differs from the model\'s output; run node tools/widget_gen.js' : 'missing');
    cases.forEach((c, n) => {
      const got = made[n];
      if (got.error) { ok('case ' + c.name + ' agrees', false, got.error); return; }
      const d = c.expect ? diffPartial(c.expect, got.expect, '', '') : 'has no hand-written expect, so nothing pins it';
      ok('case ' + c.name + ' agrees', !d, d);
    });
  }
  const zone = (tz) => spawnSync(process.execPath, ['-e', 'process.stdout.write(require(process.argv[1]).generate(process.argv[2])["docs/widgets/widget-fixtures.json"])',
    path.join(__dirname, 'widget_gen.js'), ROOT], { env: Object.assign({}, process.env, { TZ: tz }), encoding: 'utf8', maxBuffer: 1 << 27 });
  const zu = zone('UTC'), zc = zone('Pacific/Chatham');
  ok('zone-free: the fixtures are the same bytes under TZ=Pacific/Chatham as under TZ=UTC',
    zu.status === 0 && zc.status === 0 && zu.stdout.length > 100 && zu.stdout === zc.stdout, zu.status !== 0 ? zu.stderr : zc.status !== 0 ? zc.stderr : 'bytes differ');
}

/* ---- self-test ---------------------------------------------------------------------------------- */
const edit = (rel, fn) => [rel, fn];
const jsonEdit = (fn) => edit('docs/widgets/widget-copy.json', (s) => { const o = JSON.parse(s); fn(o); return JSON.stringify(o, null, 2); });
const PLANTS = [
  ['a) a space appended to app/since-rules.js', 'generated files are fresh', [edit('app/since-rules.js', (s) => s + ' ')]],
  ['b) an em-dash in status.lastFeed', 'no em-dash', [jsonEdit((o) => { o.strings['status.lastFeed'].text = 'Last \u2014 feed'; })]],
  ['c) "Last Feed" capitalised', 'sentence case', [jsonEdit((o) => { o.strings['status.lastFeed'].text = 'Last Feed'; })]],
  ['d) "Time for a nap" in line.notSaved', 'no banned phrase', [jsonEdit((o) => { o.strings['line.notSaved'].text = 'Time for a nap'; })]],
  ['e) a question mark in lock.woke', 'no question mark on the lock screen', [jsonEdit((o) => { o.strings['lock.woke'].text = 'woke {time}?'; })]],
  ['f) status.lastFeed marked ios only', 'every one-platform key', [jsonEdit((o) => { o.strings['status.lastFeed'].platforms = ['ios']; })]],
  ['g) perBaby:true removed from the Health row', 'health is per baby', [edit('app/index.html', (s) => s.replace("widget:{go:'health', perBaby:true,", "widget:{go:'health',"))]],
  ['h) {baby} in header.updated', 'only the six placeholders', [jsonEdit((o) => { o.strings['header.updated'].text = 'Updated {baby}'; })]],
  ['i) "total" removed from banned', 'banned equals the contract list', [jsonEdit((o) => { o.banned = o.banned.filter((b) => b !== 'total'); })]],
  ['m) twins.moment.year1 deleted', 'moment keys', [jsonEdit((o) => { delete o.strings['twins.moment.year1']; })]],
  ['j) staleMs 21600001 without regenerating', 'fixtures: widget-fixtures.json exists and its source', [jsonEdit((o) => { o.rules.staleMs = 21600001; })]],
  ['k) a hand-written expectation changed: Asleep now to Asleep', 'case medium-a-asleep-now agrees', [jsonEdit((o) => { o.cases.find((c) => c.name === 'medium-a-asleep-now').expect.rows[1].value = 'Asleep'; })]],
  ['l) the fixtures file says tz Europe/London', 'fixtures: tz is UTC', [edit('docs/widgets/widget-fixtures.json', (s) => s.replace('"tz": "UTC"', '"tz": "Europe/London"'))]],
  ['n) "Say Hello" in app.healthSwitched (a word of a label is not a label)', 'sentence case', [jsonEdit((o) => { o.strings['app.healthSwitched'].text = 'Your widget now says Say Hello until {name} is better.'; })], true],
  ['n2) "Say Feed": every word is a label word but the run is no label', 'sentence case', [jsonEdit((o) => { o.strings['app.healthSwitched'].text = 'Your widget now says Say Feed until {name} is better.'; })], true],
  ['q) `export async function z(){}` planted in since-rules.mjs (the strip cannot read it)', 'generate() runs', [edit('workers/shared/since-rules.mjs', (s) => s + 'export async function z() {}\n')]],
  ['r) a new exported function missing from FN_NAMES', 'generate() runs', [edit('workers/shared/since-rules.mjs', (s) => s + 'export function extra() {}\n')]],
  ['o) a case with its hand-written expect removed', 'case medium-a-asleep-now agrees', [jsonEdit((o) => { delete o.cases.find((c) => c.name === 'medium-a-asleep-now').expect; })], true],
  // A companion that must PASS: the whole label "Say it" mid-sentence in config prose is still exempt. Without it,
  // the plant above could be red because the matcher got stricter than intended.
  ['p) the whole label "Say it" mid-sentence in a config string still passes', null, [jsonEdit((o) => { o.strings['config.description'].text += ' Tap Say it to talk.'; })], true],
];
function stage(edits, regen) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-parity-'));
  for (const rel of INPUTS) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.copyFileSync(path.join(REAL, rel), path.join(dir, rel));
  }
  for (const [rel, fn] of edits) {
    const f = path.join(dir, rel);
    const before = fs.readFileSync(f, 'utf8');
    const after = fn(before);
    if (after === before) { fs.rmSync(dir, { recursive: true, force: true }); return { error: 'edit changed nothing in ' + rel }; }
    fs.writeFileSync(f, after);
  }
  if (regen) {   // the edit is to the copy file; bring every generated file in step so only the rule under test can fail
    const out = generate(dir);
    Object.keys(out).forEach((rel) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), out[rel]); });
  }
  return { dir };
}
function runOn(dir) {
  return new Promise((res) => {
    const ch = spawn(process.execPath, [__filename, '--root=' + dir], { stdio: ['ignore', 'pipe', 'pipe'] });
    let o = '';
    ch.stdout.on('data', (d) => { o += d; });
    ch.stderr.on('data', (d) => { o += d; });
    ch.on('close', (code) => res({ code, out: o }));
  });
}
async function selfTest() {
  console.log('\nwidget parity self-test: each failure is staged in a temporary copy and must be caught for its reason\n');
  let bad = 0, caught = 0;
  const base = stage([]);
  const b = await runOn(base.dir);
  fs.rmSync(base.dir, { recursive: true, force: true });
  if (b.code === 0) console.log('  ok   an unaltered copy passes, so every red below is the staging\'s');
  else { bad++; console.log('  FAIL an unaltered copy does not pass:\n' + b.out.split('\n').filter((l) => /FAIL/.test(l)).join('\n')); }
  for (const [name, expect, edits, regen] of PLANTS) {
    const t = stage(edits, regen);
    if (t.error) { bad++; console.log('  FAIL not staged: ' + name + ' (' + t.error + ')'); continue; }
    const r = await runOn(t.dir);
    fs.rmSync(t.dir, { recursive: true, force: true });
    if (expect === null) {
      if (r.code === 0) { caught++; console.log('  ok   still passes: ' + name); }
      else { bad++; console.log('  FAIL should pass: ' + name + '\n' + r.out.split('\n').filter((l) => /FAIL/.test(l)).join('\n')); }
      continue;
    }
    const hit = r.out.split('\n').some((l) => l.startsWith('  FAIL ' + expect));
    if (r.code !== 0 && hit) { caught++; console.log('  ok   caught: ' + name + '  [FAIL ' + expect + ']'); }
    else { bad++; console.log('  FAIL not caught: ' + name + (r.code === 0 ? ' (the gate passed)' : ' (red, but not for: ' + expect + ')')); }
  }
  console.log('\nself-test: ' + caught + ' of ' + PLANTS.length + ' plants caught' + (bad ? ', ' + bad + ' problem(s)' : ''));
  console.log('WIDGET-PARITY SELF-TEST: ' + (bad ? 'FAIL' : 'PASS'));
  return bad;
}
(async () => {
  let failed = 0;
  if (SELF_TEST) failed += await selfTest();
  judge();
  failed += fails;
  console.log('\nWIDGET-PARITY: ' + (failed ? 'FAIL' : 'PASS'));
  process.exit(failed ? 1 : 0);
})();
