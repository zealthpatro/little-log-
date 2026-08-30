#!/usr/bin/env node
/* THE DESIGN DOC HAS TO BE CHECKABLE OR IT BECOMES DECORATION.
 *
 * design/DESIGN-SYSTEM.md is the app's design anchor. Anchors rot. DESIGN.md at the repo root still
 * publishes a "type ramp (the only sizes to use)" of 40/30/24/20/17/15/13/12/11 that the app has
 * never shipped; the real scale is thirteen --fs-* roles in :root and four of DESIGN.md's nine
 * numbers are not on it. Nobody lied. The code moved and the prose did not, and there was nothing
 * that could tell.
 *
 * So this gate does not check the app against a design standard. It checks the DOCUMENT against the
 * app, in both directions:
 *
 *   - change a number in app/index.html and not in the doc -> red
 *   - change a number in the doc and not in app/index.html -> red
 *
 * Nothing here is hardcoded that the doc also states. Every expected value is PARSED OUT OF THE DOC
 * and every actual value is re-derived from source or measured in a real browser. A gate that keeps
 * its own copy of the thing it checks is one edit away from asserting a world that no longer exists,
 * which is the same failure as the doc it is guarding. tools/type_scale_check.js reads the scale
 * from :root for exactly this reason; this file reads its expectations from the markdown.
 *
 * Two consequences worth knowing before you get a red run:
 *
 *   1. Counts move. If another branch adds twelve .btn-ghost sites, section 4's count is wrong and
 *      this goes red. That is the gate working. Update the doc in the same commit; do not widen the
 *      assertion.
 *   2. Contrast is RECOMPUTED from the hexes in :root, not copied from the doc. If someone retunes
 *      --ink-faint, every ratio in section 3 has to be rewritten, and the gate tells you which.
 *
 *   PORT=19417 node tools/serve.js &
 *   node tools/design_doc_check.js http://localhost:19417
 *   node tools/design_doc_check.js --self-test    # plants six defects, proves each one goes red
 *
 * Pass an explicit base URL. serve.js defaults to :8080, which in a worktree is somebody else's
 * checkout, and you will grade code that is not yours.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');

const ROOT = path.join(__dirname, '..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:8080';
const SELFTEST = process.argv.includes('--self-test');
/* --self-test re-runs this same file against mutated COPIES of the doc, so the assertions under
   test are the real ones and not a parallel reimplementation of them. DESIGN_DOC points a child run
   at the copy. FAST skips the browser section, and is only honoured for a child run, because a gate
   that can be told to skip its own measurements from the command line is not a gate. */
const DOC = process.env.DESIGN_DOC || path.join(ROOT, 'design/DESIGN-SYSTEM.md');
const FAST = !!(process.env.DESIGN_DOC && process.env.DESIGN_DOC_SELFTEST_FAST);

if (SELFTEST) {
  const { execFileSync } = require('child_process');
  const os = require('os');
  const src = fs.readFileSync(path.join(ROOT, 'design/DESIGN-SYSTEM.md'), 'utf8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'designdoc-'));
  /* Each case is a single edit to the DOC, of the kind that happens when the code moves and the
     prose does not. If any of these still passes, the gate is decoration too. */
  const cases = [
    ['a type-scale role drifts by 1px', s => s.replace('| `--fs-body` | 13 |', '| `--fs-body` | 14 |'), false],
    ['the :root token count is one out', s => s.replace('**77** custom properties', '**78** custom properties'), false],
    ['a contrast ratio is stale', s => s.replace('| `--ink-faint` | 5.20 |', '| `--ink-faint` | 5.30 |'), false],
    ['the dead-token count is understated', s => s.replace('| `:root` tokens referenced by nothing | 3 |', '| `:root` tokens referenced by nothing | 2 |'), false],
    ['the longest transition is wrong', s => s.replace('is **900ms**', 'is **800ms**'), false],
    ['the distance from the AI-default cream is flattering', s => s.replace('**7/255**', '**3/255**'), false],
    ['a measured component geometry is stale', s => s.replace('| `.icon-btn` | 44 x 44 |', '| `.icon-btn` | 48 x 48 |'), true],
    ['the doc unchanged', s => s, true],
  ];
  let sp = 0, sf = 0;
  cases.forEach(([name, mut, needsBrowser], i) => {
    const f = path.join(dir, 'case' + i + '.md');
    const body = mut(src);
    if (body === src && name !== 'the doc unchanged') { sf++; console.log('  FAIL ' + name + '\n         the mutation matched nothing, so this case proves nothing'); return; }
    fs.writeFileSync(f, body);
    const env = Object.assign({}, process.env, { DESIGN_DOC: f });
    if (!needsBrowser) env.DESIGN_DOC_SELFTEST_FAST = '1';
    let code = 0;
    try { execFileSync(process.execPath, [__filename, BASE], { env, stdio: 'pipe' }); } catch (e) { code = e.status || 1; }
    const shouldFail = name !== 'the doc unchanged';
    const good = shouldFail ? code !== 0 : code === 0;
    if (good) { sp++; console.log('  ok   ' + name + (shouldFail ? ' -> RED' : ' -> GREEN')); }
    else { sf++; console.log('  FAIL ' + name + '\n         expected ' + (shouldFail ? 'a red run' : 'a green run') + ', got exit ' + code); }
  });
  console.log('\n' + sp + ' passed, ' + sf + ' failed');
  console.log(sf ? 'DESIGN-DOC-SELFTEST: FAIL' : 'DESIGN-DOC-SELFTEST: PASS');
  process.exit(sf ? 1 : 0);
}

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + (typeof x === 'string' ? x : JSON.stringify(x)) : '')); }
};
/* Almost every assertion here is "the doc says N, the code says M". Writing that out 40 times hides
   the interesting part, which is what N and M are when they disagree. */
const eq = (n, expected, actual) => ok(n, expected === actual, 'doc says ' + expected + ', code says ' + actual);
const near = (n, expected, actual, tol) => ok(n, expected !== undefined && Math.abs(expected - actual) <= tol,
  'doc says ' + expected + ', measured ' + actual);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------
// source
// ---------------------------------------------------------------------------------------------
const html = fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');
const blocks = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
const MAIN = blocks[0] || '';
const jsNames = fs.readdirSync(path.join(ROOT, 'app')).filter((f) => f.endsWith('.js')).sort();
const jsSrc = {}; jsNames.forEach((f) => { jsSrc[f] = fs.readFileSync(path.join(ROOT, 'app', f), 'utf8'); });
const ALL = html + '\n' + jsNames.map((f) => jsSrc[f]).join('\n');

const rootStart = MAIN.indexOf(':root{');
const nightStart = MAIN.indexOf('[data-theme="night"]{');
const ROOT_BLK = MAIN.slice(rootStart, nightStart);
const NIGHT_BLK = MAIN.slice(nightStart, MAIN.indexOf('\n}', nightStart));
const declIn = (s) => [...new Set([...s.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]))];
const hexOf = (blk, name) => {
  const m = blk.match(new RegExp('(?:^|[;{\\s])' + name + ':\\s*(#[0-9A-Fa-f]{6})'));
  return m ? m[1].toUpperCase() : null;
};

// ---------------------------------------------------------------------------------------------
// contrast, recomputed from the shipped hexes rather than copied from anywhere
// ---------------------------------------------------------------------------------------------
const chan = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
const linz = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = (h) => { const [r, g, b] = chan(h); return 0.2126 * linz(r) + 0.7152 * linz(g) + 0.0722 * linz(b); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return +(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05))).toFixed(2); };

// ---------------------------------------------------------------------------------------------
// the doc, parsed
// ---------------------------------------------------------------------------------------------
if (!fs.existsSync(DOC)) {
  console.log('  FAIL design/DESIGN-SYSTEM.md does not exist. It is the thing this gate checks.');
  console.log('\n0 passed, 1 failed');
  console.log('DESIGN-DOC: FAIL');
  process.exit(1);
}
const doc = fs.readFileSync(DOC, 'utf8');

/* Doc parsing. Every helper returns undefined when the doc does not make the claim at all, which is
   itself a failure: a number that quietly disappears from the doc must not quietly pass. */
const D = {
  scale: (t) => { const o = {}; [...t.matchAll(/\|\s*`(--fs-[a-z]+)`\s*\|\s*(\d+)\s*\|/g)].forEach((m) => { o[m[1]] = +m[2]; }); return o; },
  num: (t, re) => { const m = t.match(re); return m ? +m[1] : undefined; },
  nums: (t, re) => { const m = t.match(re); return m ? m.slice(1).map(Number) : undefined; },
  /* A row like: | `.icon-btn` | 44 x 44 | ... */
  boxes: (t) => { const o = {}; [...t.matchAll(/\|\s*`(\.[a-z-]+(?: input)?)`\s*\|\s*([\d.]+) x ([\d.]+)\s*\|/g)].forEach((m) => { o[m[1]] = [+m[2], +m[3]]; }); return o; },
  /* A contrast row like: | `--ink` | 15.07 | 14.10 | 13.05 | inside a named section. The doc bolds
     the cells it wants you to stop on, so the bold markers have to be optional here. They were not,
     and the first run of this gate matched the wrong table and reported a defect that was mine. */
  ladder: (t, tok, cols) => {
    const m = t.match(new RegExp('\\|\\s*`' + tok + '`\\s*\\|' + Array(cols).fill('\\s*\\*{0,2}([\\d.]+)\\*{0,2}\\s*\\|').join('')));
    return m ? m.slice(1).map(Number) : undefined;
  },
};
const sec = (n) => { // the text of one numbered section, so a regex cannot match the wrong table
  const m = doc.match(new RegExp('\\n## ' + n + '\\.[\\s\\S]*?(?=\\n## |$)'));
  return m ? m[0] : '';
};

// ---------------------------------------------------------------------------------------------
(async () => {
  console.log('\n1. the type scale in the doc IS the type scale in :root');
  const declared = {};
  [...ROOT_BLK.matchAll(/(--fs-[a-z]+):\s*([0-9.]+)px/g)].forEach((m) => { declared[m[1]] = parseFloat(m[2]); });
  const docScale = D.scale(sec(1));
  eq('the doc lists as many roles as :root declares', Object.keys(docScale).length, Object.keys(declared).length);
  const wrong = Object.keys(declared).filter((k) => docScale[k] !== declared[k]);
  ok('every role in :root has the same px in the doc', wrong.length === 0,
    wrong.map((k) => k + ' code=' + declared[k] + ' doc=' + (docScale[k] === undefined ? 'ABSENT' : docScale[k])));
  /* The absence half of that pair: a role the doc invents would otherwise slip through, because the
     loop above only walks what the code declares. */
  const invented = Object.keys(docScale).filter((k) => declared[k] === undefined);
  ok('and the doc invents no role the stylesheet does not declare', invented.length === 0, invented);

  const [dSheets, dInline, dInjected] = D.nums(sec(1), /The app has \*\*(\d+)\*\* stylesheets: (\d+) `<style>` blocks[\s\S]{0,80}?and (\d+) injected/) || [];
  eq('stylesheet count: <style> blocks in index.html', dInline, blocks.length);
  const injectors = jsNames.filter((f) => /createElement\(\s*['"]style['"]\s*\)/.test(jsSrc[f]));
  eq('stylesheet count: app/*.js files that inject one', dInjected, injectors.length);
  eq('and they add up to the total the doc states', dSheets, blocks.length + injectors.length);

  const [dTok, dLit] = D.nums(sec(1), /written as a token \*\*(\d+)\*\* times and as a literal \*\*(\d+)\*\* times/) || [];
  eq('font-size token uses in the main stylesheet', dTok, (MAIN.match(/font-size:\s*var\(--fs-/g) || []).length);
  eq('font-size literals in the main stylesheet', dLit, (MAIN.match(/font-size:\s*[0-9.]+px/g) || []).length);

  /* Counted exactly the way tools/type_scale_check.js counts, so the two gates can never disagree
     about what "outside the stylesheet" means. */
  const outside = [];
  const collect = (t) => [...t.matchAll(/font-size:\s*([0-9.]+)px/g)].forEach((m) => outside.push(m[1]));
  blocks.slice(1).forEach(collect); collect(html.replace(MAIN, '')); jsNames.forEach((f) => collect(jsSrc[f]));
  const [dOut, dDist] = D.nums(sec(1), /\*\*(\d+)\*\* literals survive at \*\*(\d+)\*\* distinct values/) || [];
  ok('the literal ratchet has not risen above the doc\'s number', dOut !== undefined && outside.length <= dOut,
    'doc ceiling ' + dOut + ', counted ' + outside.length);
  eq('and the doc\'s distinct-value count is today\'s', dDist, new Set(outside).size);
  const halves = outside.filter((v) => !Number.isInteger(parseFloat(v)));
  const dHalf = D.num(sec(1), /\|\s*half-pixel literals anywhere\s*\|\s*(\d+)\s*\|/);
  ok('the half-pixel ratchet has not risen', dHalf !== undefined && halves.length <= dHalf,
    'doc ceiling ' + dHalf + ', counted ' + halves.length);

  const dGreet = D.num(sec(1), /`\.greeting` at \*\*(\d+)px\*\*/);
  const greetSrc = (jsSrc['cubby-extras.js'] || '').match(/\.greeting\{[^}]*font-size:(\d+)px/);
  eq('the off-scale greeting is still the size the doc says it is', dGreet, greetSrc ? +greetSrc[1] : null);
  ok('and it is still off the scale, which is why the doc records it',
    dGreet !== undefined && !Object.values(declared).includes(dGreet), dGreet + ' vs scale ' + JSON.stringify(Object.values(declared)));

  console.log('\n2. the token census in the doc IS the token census in the code');
  const [dRoot, dNight, dRef] = D.nums(sec(2), /\*\*(\d+)\*\* custom properties are declared in `:root`\. \*\*(\d+)\*\*[\s\S]{0,120}?\*\*(\d+)\*\* distinct properties are referenced/) || [];
  eq(':root declarations', dRoot, declIn(ROOT_BLK).length);
  eq('night overrides', dNight, declIn(NIGHT_BLK).length);
  const used = [...new Set([...ALL.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1]))];
  eq('distinct properties referenced with var()', dRef, used.length);

  const declaredCss = new Set(declIn(ALL));
  const declaredJs = new Set([...ALL.matchAll(/setProperty\(\s*['"](--[a-z0-9-]+)['"]/g)].map((m) => m[1]));
  const dead = declIn(ROOT_BLK).filter((d) => !used.includes(d));
  const dDead = D.num(sec(2), /\|\s*`:root` tokens referenced by nothing\s*\|\s*(\d+)\s*\|/);
  eq('dead :root tokens', dDead, dead.length);
  /* Presence half: the doc names them, so a rename in the code has to be a rename in the doc too. */
  ok('and the doc names each dead token by name', dead.every((d) => sec(2).includes('`' + d + '`')), dead);
  ok('every token the doc calls dead really is declared in :root, so this is debt and not a typo',
    dead.every((d) => new RegExp(d + '\\s*:').test(ROOT_BLK)), dead);

  const dUndeclCss = D.num(sec(2), /\|\s*properties referenced but declared in no stylesheet\s*\|\s*(\d+)\s*\|/);
  const dNowhere = D.num(sec(2), /\|\s*properties referenced and declared nowhere at all\s*\|\s*(\d+)\s*\|/);
  eq('properties referenced but not declared in any stylesheet', dUndeclCss, used.filter((u) => !declaredCss.has(u)).length);
  eq('properties declared nowhere at all', dNowhere, used.filter((u) => !declaredCss.has(u) && !declaredJs.has(u)).length);
  ok('the three the doc excuses really are set at runtime by _sheetAccent',
    ['--accent', '--accent-soft', '--accent-tint-ink'].every((t) => declaredJs.has(t)), [...declaredJs]);

  const DEAD_INK = ['feed', 'note', 'diaper', 'pump', 'star', 'preg', 'danger', 'med'];
  const inkRefs = DEAD_INK.reduce((n, a) => n + (ALL.match(new RegExp('var\\(--on-' + a + ',', 'g')) || []).length, 0);
  eq('references to the eight undeclared per-accent inks', D.num(sec(2), /referenced \*\*(\d+)\*\* times as\s*\n?`var\(--on-X/), inkRefs);
  ok('and --on-sleep, the one the doc says survives, is genuinely declared',
    /--on-sleep\s*:/.test(ROOT_BLK), 'not found in :root');

  const dRad = D.num(sec(2), /are all \*\*(\d+)px\*\*/);
  const radii = ['--radius', '--radius-sm', '--r-card', '--r-dense'].map((k) => { const m = ROOT_BLK.match(new RegExp(k + ':\\s*(\\d+)px')); return m ? +m[1] : null; });
  ok('the four radius names really do encode one number, and it is the doc\'s', radii.every((r) => r === dRad), { doc: dRad, code: radii });
  eq('--r-tap is the second value', D.num(sec(2), /`--r-tap` \(\*\*(\d+)px\*\*/), (ROOT_BLK.match(/--r-tap:\s*(\d+)px/) || [])[1] * 1);

  console.log('\n3a. the contrast tables are recomputed from the hexes in :root');
  const L = (n) => hexOf(ROOT_BLK, n), N = (n) => hexOf(NIGHT_BLK, n);
  const s3 = sec(3);
  const lightLadder = { '--ink': [L('--surface'), L('--surface-2'), L('--bg')] };
  ['--ink', '--ink-soft', '--ink-faint'].forEach((tok) => {
    const docRow = D.ladder(s3.slice(0, s3.indexOf('**Night, the ink ladder**')), tok, 3);
    const real = lightLadder['--ink'].map((bg) => ratio(L(tok), bg));
    ok('light: ' + tok + ' on surface / surface-2 / page', JSON.stringify(docRow) === JSON.stringify(real),
      'doc ' + JSON.stringify(docRow) + ' recomputed ' + JSON.stringify(real));
  });
  const nightBgs = ['--surface', '--surface-2', '--surface-3', '--surface-4'].map(N);
  ['--ink', '--ink-soft', '--ink-faint'].forEach((tok) => {
    const docRow = D.ladder(s3.slice(s3.indexOf('**Night, the ink ladder**')), tok, 4);
    const real = nightBgs.map((bg) => ratio(N(tok), bg));
    ok('night: ' + tok + ' across all four elevation rungs', JSON.stringify(docRow) === JSON.stringify(real),
      'doc ' + JSON.stringify(docRow) + ' recomputed ' + JSON.stringify(real));
  });
  ['--feed', '--danger'].forEach((tok) => {
    const docRow = D.ladder(s3.slice(s3.indexOf('**Fill is not ink.**')), tok, 2);
    const real = [ratio(L(tok), L('--surface')), ratio(L(tok + '-ink'), L('--surface'))];
    ok('fill vs ink rung: ' + tok, JSON.stringify(docRow) === JSON.stringify(real),
      'doc ' + JSON.stringify(docRow) + ' recomputed ' + JSON.stringify(real));
  });
  const onAccBlk = s3.slice(s3.indexOf('**Ink on a fill is'), s3.indexOf('**The focus ring fails'));
  const FILLS = ['--star', '--feed', '--pump', '--diaper', '--note', '--danger', '--preg'];
  const onAccWrong = FILLS.filter((f) => {
    const docRow = D.ladder(onAccBlk, f, 2);
    const fillHex = hexOf(ROOT_BLK, f) || (f === '--star' ? hexOf(MAIN, '--star') : null);
    if (!fillHex || !docRow) return true;
    return docRow[0] !== ratio(L('--on-accent'), fillHex) || docRow[1] !== ratio('#FFFFFF', fillHex);
  });
  ok('ink on every accent fill, --on-accent against #fff', onAccWrong.length === 0, onAccWrong);
  ok('--on-sleep is the one polarity flip, and white really does beat --on-accent there',
    ratio(L('--on-sleep'), L('--sleep')) > ratio(L('--on-accent'), L('--sleep')),
    'white ' + ratio(L('--on-sleep'), L('--sleep')) + ' vs on-accent ' + ratio(L('--on-accent'), L('--sleep')));

  const ringBlk = s3.slice(s3.indexOf('**The focus ring fails'));
  const ringWrong = [['--surface', 0], ['--bg', 1], ['--surface-2', 2]].filter(([bg]) => {
    const docRow = D.ladder(ringBlk, bg, 2);
    return !docRow || docRow[0] !== ratio(L('--feed'), L(bg)) || docRow[1] !== ratio(N('--feed'), N(bg));
  });
  ok('the focus ring table, both themes', ringWrong.length === 0, ringWrong.map((r) => r[0]));
  /* The doc calls this an open defect. If someone fixes it, the doc is wrong and must be rewritten,
     so assert the defect is still there rather than asserting it is absent. */
  const ringRule = MAIN.match(/:focus-visible\{outline:2px solid var\((--[a-z-]+),var\((--[a-z-]+)\)\)/);
  ok('the ring still falls back to a category hue outside a sheet, as the doc records',
    !!ringRule && ringRule[2] === '--feed', ringRule ? ringRule.slice(1) : 'rule not found');
  const FLOOR_TEXT = D.num(s3, /\|\s*Body text\s*\|\s*\*\*([\d.]+):1\*\*/);
  const FLOOR_NONTEXT = D.num(s3, /\|\s*Non-text[^|]*\|\s*\*\*([\d.]+):1\*\*/);
  eq('the doc states the WCAG text floor', FLOOR_TEXT, 4.5);
  eq('the doc states the WCAG non-text floor', FLOOR_NONTEXT, 3);
  ok('every rung of both ink ladders clears the text floor the doc states',
    [...lightLadder['--ink'].flatMap((bg) => ['--ink', '--ink-soft', '--ink-faint'].map((t) => ratio(L(t), bg))),
      ...nightBgs.flatMap((bg) => ['--ink', '--ink-soft', '--ink-faint'].map((t) => ratio(N(t), bg)))]
      .every((r) => r >= FLOOR_TEXT), 'a rung fell below ' + FLOOR_TEXT);

  console.log('\n3b. motion');
  const trDur = [];
  [...ALL.matchAll(/transition:[^;{}]*/g)].forEach((t) => [...t[0].matchAll(/([0-9.]+)(m?s)\b/g)]
    .forEach((m) => trDur.push(m[2] === 's' ? Math.round(parseFloat(m[1]) * 1000) : parseFloat(m[1]))));
  const tally = {}; trDur.forEach((d) => { tally[d] = (tally[d] || 0) + 1; });
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  const [dMode, dModeN, dTotal] = D.nums(s3, /\*\*(\d+)ms\*\* \| the app's own mode: (\d+) of (\d+) transition durations/) || [];
  eq('the modal transition duration', dMode, +top[0][0]);
  eq('how many uses that mode has', dModeN, top[0][1]);
  eq('total transition durations counted', dTotal, trDur.length);
  eq('the longest transition in the app', D.num(s3, /longest transition in the app is \*\*(\d+)ms\*\*/), Math.max(...trDur));
  const [dRmAll, dRmMain] = D.nums(s3, /\*\*(\d+)\*\* across the app, \*\*(\d+)\*\* in the main stylesheet/) || [];
  eq('prefers-reduced-motion blocks app-wide', dRmAll, (ALL.match(/prefers-reduced-motion/g) || []).length);
  eq('prefers-reduced-motion blocks in the main stylesheet', dRmMain, (MAIN.match(/prefers-reduced-motion/g) || []).length);

  console.log('\n4. the component vocabulary');
  const s4 = sec(4);
  const sheets = blocks.concat(jsNames.filter((f) => /createElement\(\s*['"]style['"]\s*\)/.test(jsSrc[f])).map((f) => jsSrc[f]));
  const clsAll = new Set(); sheets.forEach((s) => [...s.matchAll(/\.([a-z][a-z0-9-]{1,})\s*[,{ :.]/g)].forEach((m) => clsAll.add(m[1])));
  const clsMain = new Set([...MAIN.matchAll(/\.([a-z][a-z0-9-]{1,})\s*[,{ :.]/g)].map((m) => m[1]));
  const [dAllCls, dMainCls] = D.nums(s4, /\*\*(\d+)\*\* distinct class names carry a rule across the eleven stylesheets, \*\*(\d+)\*\*/) || [];
  eq('distinct class names carrying a rule, all stylesheets', dAllCls, clsAll.size);
  eq('and in the main stylesheet alone', dMainCls, clsMain.size);

  const CANON =[...s4.matchAll(/^\|[^|]*\|\s*`(\.[a-z0-9. -]+?)`\s*\|/gm)].map((m) => m[1]);
  ok('the doc names a canonical component for at least a dozen jobs', CANON.length >= 12, CANON.length + ': ' + CANON.join(' '));
  /* Presence: every canonical name must have a real rule somewhere, or the vocabulary is fiction. */
  /* A canonical name can be a compound (`.btn-ghost.btn-danger`) or a descendant (`.field input`).
     Every dotted class in it has to have a rule, or the vocabulary is naming something that does
     not exist. */
  const orphans = CANON.filter((c) => (c.match(/\.[a-z0-9-]+/g) || [])
    .some((cls) => !new RegExp('\\' + cls + '\\s*[,{:. ]').test(ALL)));
  ok('and every canonical name has a CSS rule behind it', orphans.length === 0, orphans);
  const selCounts = { sel: 11, on: 9, active: 2, 'icon-on': 1 };
  const dSel = D.nums(s4, /`\.sel` carries (\d+) selector uses[\s\S]{0,60}?against\s*\n?(\d+) for `\.on`, (\d+) for `\.active` and (\d+) for `\.icon-on`/) || [];
  const realSel = ['sel', 'on', 'active', 'icon-on'].map((s) => (MAIN.match(new RegExp('\\.[a-z0-9-]+\\.' + s + '\\b', 'g')) || []).length);
  ok('the four spellings of "selected" are counted correctly', JSON.stringify(dSel) === JSON.stringify(realSel),
    'doc ' + JSON.stringify(dSel) + ' code ' + JSON.stringify(realSel));
  ok('and .sel really is the most-used one, which is why it is canonical',
    realSel[0] === Math.max(...realSel), realSel);
  void selCounts;
  ok('.chip.sel still hardcodes --feed rather than following --accent, as the doc records',
    /\.chip\.sel\{[^}]*var\(--feed\)/.test(MAIN), 'rule changed: the doc must be rewritten');

  const dUse = D.nums(s4, /`\.btn-ghost` \*\*(\d+)\*\*, `\.btn-primary` \*\*(\d+)\*\*,\s*\n?`\.chip` \*\*(\d+)\*\*, `\.set-item` \*\*(\d+)\*\*/) || [];
  const realUse = ['btn-ghost', 'btn-primary', 'chip', 'set-item']
    .map((c) => (html.match(new RegExp('class="[^"]*\\b' + c + '\\b', 'g')) || []).length);
  ok('component usage counts', JSON.stringify(dUse) === JSON.stringify(realUse),
    'doc ' + JSON.stringify(dUse) + ' code ' + JSON.stringify(realUse));
  const dRatio = D.num(s4, /outnumbers the primary ([\d.]+) to 1/);
  near('and the ghost-to-primary ratio the doc draws from them', dRatio, +(realUse[0] / realUse[1]).toFixed(2), 0.005);

  console.log('\n5-6. slop calibration and the borrowed rules');
  const s5 = sec(5), s6 = sec(6);
  const dDefault = (s5.match(/near `(#[0-9A-Fa-f]{6})`/) || [])[1];
  const dOurs = (s5.match(/Cubby's `--bg` is `(#[0-9A-Fa-f]{6})`/) || [])[1];
  eq('the doc quotes our real --bg', dOurs, L('--bg'));
  const delta = Math.max(...chan(dOurs).map((c, i) => Math.abs(c - chan(dDefault)[i])));
  eq('the channel distance from the AI-default cream', D.num(s5, /\*\*(\d+)\/255\*\* off the named default/), delta);
  eq('and the contrast ratio between them', D.num(s5, /contrast ratio of \*\*([\d.]+):1\*\*/), ratio(dOurs, dDefault));
  ok('the skill the doc cites is a file that exists on this machine',
    fs.existsSync((s5.match(/\(`(~[^`]*SKILL\.md)`\)/) || [])[1] ? (s5.match(/\(`(~[^`]*SKILL\.md)`\)/) || [])[1].replace('~', process.env.HOME) : '/nope'),
    'cited path not found');
  /* An anchor nobody links to is an anchor nobody reads. DESIGN.md and design/README.md are where a
     person actually lands, so both have to point here or this file quietly becomes a private note. */
  ['DESIGN.md', 'design/README.md'].forEach((f) => {
    const p = path.join(ROOT, f);
    ok(f + ' exists and points at this design system',
      fs.existsSync(p) && fs.readFileSync(p, 'utf8').includes('design/DESIGN-SYSTEM.md'), f);
  });

  const [dFr, dCav] = D.nums(s6, /\*\*(\d+)\*\* references across the app against \*\*(\d+)\*\* for `Caveat`/) || [];
  eq('Fraunces references', dFr, (ALL.match(/Fraunces/g) || []).length);
  eq('Caveat references', dCav, (ALL.match(/Caveat/g) || []).length);
  ok('and the brand serif is still the minority face, which is the discipline the doc claims',
    dFr < (ALL.match(/Nunito Sans/g) || []).length * 3, 'Fraunces ' + dFr);

  if (FAST) {
    console.log('\n7. SKIPPED (self-test child run, source assertions only)');
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    console.log(fail ? 'DESIGN-DOC: FAIL' : 'DESIGN-DOC: PASS');
    process.exit(fail ? 1 : 0);
  }

  console.log('\n7. measured in a real browser at 390px, both themes');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
  const OFFSET = CLOCK - Date.now(); const now = CLOCK; const DAY = 86400000;
  const seed = () => ({
    babies: [{ id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
    activeBabyId: 'b1', events: [{ id: 'f1', type: 'feed', babyId: 'b1', method: 'bottle', ml: 120, time: now - 3600000 }],
    illnesses: [], settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
    timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
  });
  const measured = {};
  for (const theme of ['light', 'night']) {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument((shift) => {
      const R = Date; function Dt(...a) { return a.length === 0 ? new R(R.now() + shift) : new R(...a); }
      Dt.prototype = R.prototype; Dt.now = () => R.now() + shift; Dt.parse = R.parse; Dt.UTC = R.UTC; window.Date = Dt;
    }, OFFSET);
    await page.setViewport({ width: 390, height: 844 });
    await page.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });
    await page.evaluate(() => localStorage.setItem('cubby-quick-uid', 'local'));
    await page.evaluate((x, th) => { localStorage.setItem('little-log-v1', JSON.stringify(x)); localStorage.setItem('cubby-theme:local', th); }, seed(), theme);
    await page.reload({ waitUntil: 'networkidle2' }); await sleep(1700);
    await page.evaluate((th) => document.documentElement.setAttribute('data-theme', th), theme);
    await sleep(350);
    measured[theme] = await page.evaluate(async () => {
      const box = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), fs: c.fontSize, td: c.transitionDuration }; };
      const before = { '.icon-btn': box('.icon-btn'), '.qadd': box('.qadd'), '.nav-btn': box('.nav-btn'), '.action': box('.action'), '.greeting': box('.greeting') };
      try { openSymptom(); } catch (e) { /* the sheet is where the chips and the primary live */ }
      await new Promise((r) => setTimeout(r, 700));
      const sh = document.getElementById('sheet');
      return Object.assign(before, {
        '.btn-primary': box('#sheet .btn-primary'), '.field input': box('#sheet .field input, #sheet .field textarea'),
        '.chip': box('#sheet .chip'), chips: document.querySelectorAll('#sheet .chip').length,
        theme: document.documentElement.getAttribute('data-theme'),
        sheetTd: sh ? getComputedStyle(sh).transitionDuration : null,
        scale: ['micro', 'body', 'input', 'burst'].reduce((o, k) => (o['--fs-' + k] = getComputedStyle(document.documentElement).getPropertyValue('--fs-' + k).trim(), o), {}),
      });
    });
    await page.close();
  }
  await browser.close();

  ok('both themes really did render as different themes', measured.light.theme === 'light' && measured.night.theme === 'night',
    [measured.light.theme, measured.night.theme]);
  const docBoxes = D.boxes(s3);
  const boxWrong = Object.keys(docBoxes).filter((k) => {
    const m = measured.light[k], n = measured.night[k];
    return !m || !n || m.w !== docBoxes[k][0] || m.h !== docBoxes[k][1] || n.w !== docBoxes[k][0] || n.h !== docBoxes[k][1];
  });
  ok('every component geometry in the doc matches the browser, in both themes', boxWrong.length === 0,
    boxWrong.map((k) => k + ' doc ' + docBoxes[k].join('x') + ' light ' + (measured.light[k] ? measured.light[k].w + 'x' + measured.light[k].h : 'MISSING')
      + ' night ' + (measured.night[k] ? measured.night[k].w + 'x' + measured.night[k].h : 'MISSING')));
  ok('and the doc measured at least six components, so the line above is not passing on an empty table',
    Object.keys(docBoxes).length >= 6, Object.keys(docBoxes));

  const TOUCH = D.num(s3, /\|\s*Primary target[^|]*\|\s*\*\*(\d+) x \d+\*\*/);
  const MIN = D.num(s3, /\|\s*Absolute minimum[^|]*\|\s*\*\*(\d+) x \d+\*\*/);
  eq('the doc states the 44px primary target floor', TOUCH, 44);
  eq('the doc states the 24px absolute floor', MIN, 24);
  ok('.icon-btn really sits exactly at the 44px floor the doc claims for it',
    measured.light['.icon-btn'].w === TOUCH && measured.light['.icon-btn'].h === TOUCH, measured.light['.icon-btn']);
  const dChipH = D.num(s3, /\|\s*`\.chip` height in px\s*\|\s*(\d+)\s*\|/);
  eq('the chip is still the height the doc records as short', dChipH, measured.light['.chip'].h);
  ok('and it is still short of the floor, which is why the ratchet exists', dChipH < TOUCH, dChipH + ' vs ' + TOUCH);
  eq('and there are still as many of them in the symptom sheet as the doc says',
    D.num(s3, /\|\s*chips in the symptom sheet\s*\|\s*(\d+)\s*\|/), measured.light.chips);
  eq('min-height:44px rules in the main stylesheet',
    D.num(s3, /carries \*\*(\d+)\*\* `min-height:44px` rules/), (MAIN.match(/min-height:\s*44px/g) || []).length);

  eq('the input floor is honoured where it matters: the sheet field computes to 16px',
    '16px', measured.light['.field input'].fs);
  eq('the off-scale greeting renders at the size the doc says', dGreet + 'px', measured.light['.greeting'].fs);

  const CEIL = D.num(s3, /\|\s*Ceiling on the logging path\s*\|\s*\*\*(\d+)ms\*\*/);
  const msOf = (td) => Math.max(...String(td).split(',').map((s) => parseFloat(s) * 1000));
  const overCeil = ['.action', '.chip', '.qadd', '.icon-btn', '.btn-primary', '.nav-btn']
    .filter((k) => measured.light[k] && msOf(measured.light[k].td) > CEIL);
  ok('nothing on the logging path animates for longer than the doc\'s ceiling', overCeil.length === 0,
    overCeil.map((k) => k + ' ' + measured.light[k].td));
  ok('and the sheet itself sits exactly at that ceiling', msOf(measured.light.sheetTd) === CEIL,
    'doc ' + CEIL + 'ms, measured ' + measured.light.sheetTd);

  const scaleWrong = Object.keys(measured.light.scale).filter((k) => measured.light.scale[k] !== declared[k] + 'px' || measured.night.scale[k] !== declared[k] + 'px');
  ok('the scale the browser resolves is the scale the source declares, in both themes', scaleWrong.length === 0,
    scaleWrong.map((k) => k + ' light ' + measured.light.scale[k] + ' night ' + measured.night.scale[k]));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'DESIGN-DOC: FAIL' : 'DESIGN-DOC: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); console.log('DESIGN-DOC: FAIL'); process.exit(1); });
