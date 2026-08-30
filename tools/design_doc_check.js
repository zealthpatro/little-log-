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
 * WHY THIS FILE WAS REWRITTEN, AND THE RULE THAT CAME OUT OF IT.
 *
 * The first version matched SENTENCES. It asserted that the doc contained the words "are all
 * **16px**" and "`--r-tap` (**26px**". Then the radius consolidation landed, the paragraph was
 * corrected to describe the seven-token scale that actually shipped, and eleven assertions went red
 * because the prose had been FIXED. A gate that punishes you for correcting the wording teaches you
 * to leave the wording wrong, which is the precise failure the document exists to prevent, so the
 * gate shipped unwired rather than softened.
 *
 * It now reads three shapes and none of them is a sentence:
 *
 *   1. A table row whose first cell is a backticked name. The LIST of names always comes from
 *      :root, never from the doc, so a token the stylesheet declares and the doc forgets is an
 *      absent row rather than silence. Reword the last column all you like.
 *   2. A ratchet row, found by one distinctive word in its label rather than the whole label.
 *   3. A bolded number that follows a backticked name.
 *
 * That is written at the top of the doc too, because the person who has to keep it true is the
 * person editing the doc, not the person editing this file.
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
 *   node tools/design_doc_check.js --self-test    # plants defects, proves each one goes red
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
     prose does not. If any of these still passes, the gate is decoration too.

     The last two are the ones this rewrite exists for. A REWORDED sentence around an untouched
     number has to stay green, or the gate is back to punishing corrections; a DELETED token row has
     to go red, because the list of tokens comes from :root and a doc that quietly drops one is
     exactly how this file got out of date in the first place. */
  const cases = [
    ['a type-scale role drifts by 1px', (s) => s.replace('| `--fs-body` | 13 |', '| `--fs-body` | 14 |'), false],
    ['a radius role drifts by 1px', (s) => s.replace('| `--r-card` | 16 |', '| `--r-card` | 17 |'), false],
    ['a motion role drifts by 10ms', (s) => s.replace('| `--mo-enter` | 350 |', '| `--mo-enter` | 360 |'), false],
    ['an elevation rung is stale', (s) => s.replace('| `--elev-lift` | 0 5px 14px |', '| `--elev-lift` | 0 5px 12px |'), false],
    ['a radius row is deleted from the doc entirely', (s) => s.replace(/\n\| `--r-pill` \| 999 \|[^\n]*/, ''), false],
    ['the :root token count is one out', (s) => s.replace('**98** custom properties', '**99** custom properties'), false],
    ['a contrast ratio is stale', (s) => s.replace('| `--ink-faint` | 5.20 |', '| `--ink-faint` | 5.30 |'), false],
    ['a focus-ring ratio is stale', (s) => s.replace('| `--focus` on `--surface` | 15.07 |', '| `--focus` on `--surface` | 15.70 |'), false],
    ['the dead-token count is understated', (s) => s.replace('| `:root` tokens referenced by nothing | 5 |', '| `:root` tokens referenced by nothing | 4 |'), false],
    ['one bucket of the motion distribution is wrong', (s) => s.replace('| 200 | 11 |', '| 200 | 12 |'), false],
    ['the longest transition is wrong', (s) => s.replace('is **900ms**', 'is **800ms**'), false],
    ['the distance from the AI-default cream is flattering', (s) => s.replace('**7/255**', '**3/255**'), false],
    ['a measured component geometry is stale', (s) => s.replace('| `.icon-btn` | 44 x 44 |', '| `.icon-btn` | 48 x 48 |'), true],
    ['a sentence around a number is REWORDED, and the number is untouched',
      (s) => s.replace(/They\s*\nare the smear between card and control/, 'They are the smear between a card corner and a control corner'), false, 'green'],
    ['a ratchet label is REWORDED and its number is untouched',
      (s) => s.replace('| half-pixel literals anywhere |', '| half-pixel font sizes, anywhere in the app |'), false, 'green'],
    /* A second row carrying the same anchor word means the anchor has stopped identifying one row,
       and a number read from whichever row happened to come first is not evidence of anything. */
    ['a ratchet anchor stops identifying exactly one row',
      (s) => s.replace('| half-pixel literals anywhere | 29 | `tools/type_scale_check.js` |',
        '| half-pixel literals anywhere | 29 | `tools/type_scale_check.js` |\n| half-pixel literals in the sheets | 29 | `tools/type_scale_check.js` |'), false],
    ['the doc unchanged', (s) => s, true, 'green'],
  ];
  let sp = 0, sf = 0;
  cases.forEach(([name, mut, needsBrowser, want], i) => {
    const f = path.join(dir, 'case' + i + '.md');
    const body = mut(src);
    if (body === src && name !== 'the doc unchanged') { sf++; console.log('  FAIL ' + name + '\n         the mutation matched nothing, so this case proves nothing'); return; }
    fs.writeFileSync(f, body);
    const env = Object.assign({}, process.env, { DESIGN_DOC: f });
    if (!needsBrowser) env.DESIGN_DOC_SELFTEST_FAST = '1';
    let code = 0, out = '';
    try { execFileSync(process.execPath, [__filename, BASE], { env, stdio: 'pipe' }); } catch (e) { code = e.status || 1; out = String(e.stdout || ''); }
    const shouldFail = want !== 'green';
    const good = shouldFail ? code !== 0 : code === 0;
    if (good) { sp++; console.log('  ok   ' + name + (shouldFail ? ' -> RED' : ' -> GREEN')); }
    else {
      sf++;
      console.log('  FAIL ' + name + '\n         expected ' + (shouldFail ? 'a red run' : 'a green run') + ', got exit ' + code);
      out.split('\n').filter((l) => /FAIL/.test(l)).slice(0, 4).forEach((l) => console.log('       ' + l.trim()));
    }
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
/* A class named only inside a CSS comment does not carry a rule, and section 4 counts class names
   that carry a rule. Comments are stripped from the STYLESHEETS only: doing the same to a .js file
   would eat any regex literal containing a slash-star, and those files are scanned whole. */
const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const MAIN_NC = decomment(MAIN);
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
/* Every token in :root whose name starts with `prefix` and whose value is a plain number in `unit`.
   This is the half of the contract that comes from the CODE. The doc never gets to decide which
   tokens exist. */
const scaleIn = (blk, prefix, unit) => {
  const o = {};
  [...blk.matchAll(new RegExp('(' + prefix + '[a-z0-9-]+):\\s*([0-9.]+)' + unit + '\\s*;', 'g'))].forEach((m) => { o[m[1]] = parseFloat(m[2]); });
  return o;
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
const rx = (s) => s.replace(/[-[\]{}()*+?.,\\^$|#]/g, '\\$&');

/* Doc parsing. Every helper returns undefined when the doc does not make the claim at all, which is
   itself a failure: a number that quietly disappears from the doc must not quietly pass. */
const D = {
  /* SHAPE 1. The row whose first cell is `name`, with `cells` cells after it, bold markers dropped.
     Nothing here matches prose, so rewriting the last column is free. */
  row: (t, name, cells) => {
    const m = t.match(new RegExp('^\\|\\s*`' + rx(name) + '`\\s*\\|' + Array(cells).fill('([^|]*)\\|').join(''), 'm'));
    return m ? m.slice(1).map((c) => c.replace(/\*/g, '').trim()) : undefined;
  },
  /* SHAPE 1, when the row's first cell is a number and the last column is prose. */
  num: (t, re) => { const m = t.match(re); return m ? +m[1] : undefined; },
  nums: (t, re) => { const m = t.match(re); return m ? m.slice(1).map(Number) : undefined; },
  /* SHAPE 2. A ratchet row found by ONE distinctive word in its LABEL, which is the first cell. The
     rest of the label is the author's to rewrite. The word must identify exactly one row: zero
     matches means the row was deleted, and two means the anchor has stopped identifying anything,
     and both are the same failure, which is why both come back undefined and the caller reports
     "doc says undefined" against a real number. */
  ratchet: (t, word) => {
    const all = [...t.matchAll(new RegExp('^\\|[^|\\n]*' + rx(word) + '[^|\\n]*\\|\\s*\\*{0,2}([\\d.]+)\\*{0,2}[^|\\n]*\\|', 'gmi'))];
    return all.length === 1 ? +all[0][1] : undefined;
  },
  /* SHAPE 3. A bolded number that follows a backticked name, close enough to be in the same
     sentence. The words in between belong to whoever is writing, and a line wrap is allowed because
     this file is hard-wrapped at 100 columns. A pipe is not, so this can never reach into a table
     row and read a cell that belongs to something else. */
  after: (t, name, unit) => {
    const m = t.match(new RegExp('`' + rx(name) + '`[^|]{0,120}?\\*\\*([\\d.]+)' + (unit || '') + '\\*\\*'));
    return m ? +m[1] : undefined;
  },
  /* A row like: | `.icon-btn` | 44 x 44 | ... */
  boxes: (t) => { const o = {}; [...t.matchAll(/\|\s*`(\.[a-z0-9-]+(?: input)?)`\s*\|\s*([\d.]+) x ([\d.]+)\s*\|/g)].forEach((m) => { o[m[1]] = [+m[2], +m[3]]; }); return o; },
  /* A contrast row like: | `--ink` | 15.07 | 14.10 | 13.05 | inside a named section. The doc bolds
     the cells it wants you to stop on, so the bold markers have to be optional here. They were not,
     and the first run of this gate matched the wrong table and reported a defect that was mine. */
  ladder: (t, tok, cols) => {
    const m = t.match(new RegExp('\\|\\s*`' + tok + '`\\s*\\|' + Array(cols).fill('\\s*\\*{0,2}([\\d.]+)\\*{0,2}\\s*\\|').join('')));
    return m ? m.slice(1).map(Number) : undefined;
  },
  /* The two-column | ms | Uses | histogram, read whole. Asserting the whole distribution rather
     than only its top entry is both stronger and immune to a tie for the mode, and there IS a tie:
     150 and 200 are level, which is the doc's own argument for having a scale. */
  histogram: (t) => {
    const h = t.indexOf('| ms | Uses |');
    if (h < 0) return undefined;
    const body = t.slice(h).split('\n').slice(2);
    const o = {};
    for (const line of body) {
      const m = line.match(/^\|\s*(\d+)\s*\|\s*(\d+)\s*\|/);
      if (!m) break;
      o[m[1]] = +m[2];
    }
    return Object.keys(o).length ? o : undefined;
  },
};
const sec = (n) => { // the text of one numbered section, so a regex cannot match the wrong table
  const m = doc.match(new RegExp('\\n## ' + n + '\\.[\\s\\S]*?(?=\\n## |$)'));
  return m ? m[0] : '';
};

/* The shape of every token-scale check in this file: take the token LIST from :root, demand a row
   per token in the doc, and pair the "code has no token the doc invents" absence with it. Reused
   for type, radius and motion so all three fail the same way and read the same way. */
function checkScale(label, section, prefix, unit, docUnitStrip) {
  const declared = scaleIn(ROOT_BLK, prefix, unit);
  const names = Object.keys(declared);
  ok(label + ': :root declares a scale at all, so the rest of this is not passing on an empty set',
    names.length > 0, prefix + ' matched nothing in :root');
  const docRows = {};
  [...section.matchAll(new RegExp('^\\|\\s*`(' + prefix + '[a-z0-9-]+)`\\s*\\|\\s*\\*{0,2}([\\d.]+)\\s*' + (docUnitStrip || '') + '\\*{0,2}\\s*\\|', 'gm'))]
    .forEach((m) => { docRows[m[1]] = parseFloat(m[2]); });
  const wrong = names.filter((k) => docRows[k] !== declared[k]);
  ok(label + ': every token :root declares has a row in the doc with the same number', wrong.length === 0,
    wrong.map((k) => k + ' code=' + declared[k] + ' doc=' + (docRows[k] === undefined ? 'NO ROW' : docRows[k])));
  const invented = Object.keys(docRows).filter((k) => declared[k] === undefined);
  ok(label + ': and the doc invents no token the stylesheet does not declare', invented.length === 0, invented);
  return declared;
}

// ---------------------------------------------------------------------------------------------
(async () => {
  console.log('\n1. the type scale in the doc IS the type scale in :root');
  const declared = checkScale('type', sec(1), '--fs-', 'px');

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
  const dOut = D.ratchet(sec(1), 'outside');
  const dDist = D.num(sec(1), /\*\*(\d+)\*\* distinct values/);
  ok('the literal ratchet has not risen above the doc\'s number', dOut !== undefined && outside.length <= dOut,
    'doc ceiling ' + dOut + ', counted ' + outside.length);
  eq('and the doc\'s distinct-value count is today\'s', dDist, new Set(outside).size);
  const halves = outside.filter((v) => !Number.isInteger(parseFloat(v)));
  const dHalf = D.ratchet(sec(1), 'half-pixel');
  ok('the half-pixel ratchet has not risen', dHalf !== undefined && halves.length <= dHalf,
    'doc ceiling ' + dHalf + ', counted ' + halves.length);

  const dGreet = D.after(sec(1), '.greeting', 'px');
  const greetSrc = (jsSrc['cubby-extras.js'] || '').match(/\.greeting\{[^}]*font-size:(\d+)px/);
  eq('the off-scale greeting is still the size the doc says it is', dGreet, greetSrc ? +greetSrc[1] : null);
  ok('and it is still off the scale, which is why the doc records it',
    dGreet !== undefined && !Object.values(declared).includes(dGreet), dGreet + ' vs scale ' + JSON.stringify(Object.values(declared)));

  console.log('\n2. the token census in the doc IS the token census in the code');
  const s2 = sec(2);
  const [dRoot, dNight, dRef] = D.nums(s2, /\*\*(\d+)\*\* custom properties are declared in `:root`\. \*\*(\d+)\*\*[\s\S]{0,120}?\*\*(\d+)\*\* distinct properties are referenced/) || [];
  eq(':root declarations', dRoot, declIn(ROOT_BLK).length);
  eq('night overrides', dNight, declIn(NIGHT_BLK).length);
  const used = [...new Set([...ALL.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1]))];
  eq('distinct properties referenced with var()', dRef, used.length);

  const declaredCss = new Set(declIn(ALL));
  const declaredJs = new Set([...ALL.matchAll(/setProperty\(\s*['"](--[a-z0-9-]+)['"]/g)].map((m) => m[1]));
  const dead = declIn(ROOT_BLK).filter((d) => !used.includes(d));
  eq('dead :root tokens', D.ratchet(s2, 'nothing'), dead.length);
  /* Presence half: the doc names them, so a rename in the code has to be a rename in the doc too. */
  ok('and the doc names each dead token by name', dead.every((d) => s2.includes('`' + d + '`')), dead);
  ok('every token the doc calls dead really is declared in :root, so this is debt and not a typo',
    dead.every((d) => new RegExp(d + '\\s*:').test(ROOT_BLK)), dead);

  eq('properties referenced but not declared in any stylesheet',
    D.ratchet(s2, 'no stylesheet'), used.filter((u) => !declaredCss.has(u)).length);
  eq('properties declared nowhere at all',
    D.ratchet(s2, 'nowhere'), used.filter((u) => !declaredCss.has(u) && !declaredJs.has(u)).length);
  ok('the three the doc excuses really are set at runtime by _sheetAccent',
    ['--accent', '--accent-soft', '--accent-tint-ink'].every((t) => declaredJs.has(t)), [...declaredJs]);

  const DEAD_INK = ['feed', 'note', 'diaper', 'pump', 'star', 'preg', 'danger', 'med'];
  const inkRefs = DEAD_INK.reduce((n, a) => n + (ALL.match(new RegExp('var\\(--on-' + a + ',', 'g')) || []).length, 0);
  eq('references to the eight undeclared per-accent inks', D.num(s2, /referenced \*\*(\d+)\*\* times as\s*\n?`var\(--on-X/), inkRefs);
  ok('and --on-sleep, the one the doc says survives, is genuinely declared',
    /--on-sleep\s*:/.test(ROOT_BLK), 'not found in :root');

  /* Radius, elevation and motion all arrived in the same pass and all three had no entry in the
     doc at all. They are checked the same way the type scale is: the list comes from :root. */
  checkScale('radius', s2, '--r-', 'px', '(?:px)?');
  checkScale('motion', s2, '--mo-', 'ms', '(?:ms)?');

  const elevCode = {};
  [...ROOT_BLK.matchAll(/(--elev-[a-z0-9-]+):\s*([^;]+);/g)].forEach((m) => {
    elevCode[m[1]] = m[2].replace(/var\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  });
  ok('elevation: :root declares a ramp at all', Object.keys(elevCode).length > 0, elevCode);
  const elevWrong = Object.keys(elevCode).filter((k) => {
    const r = D.row(s2, k, 2);
    return !r || r[0].replace(/\s+/g, ' ').trim() !== elevCode[k];
  });
  ok('elevation: every rung in :root has a row in the doc with the same offset and blur', elevWrong.length === 0,
    elevWrong.map((k) => k + ' code "' + elevCode[k] + '" doc "' + ((D.row(s2, k, 2) || ['NO ROW'])[0]) + '"'));
  const elevInvented = [...s2.matchAll(/^\|\s*`(--elev-[a-z0-9-]+)`/gm)].map((m) => m[1]).filter((k) => !elevCode[k]);
  ok('elevation: and the doc invents no rung the stylesheet does not declare', elevInvented.length === 0, elevInvented);
  eq('elevation: uses of the ramp in the main stylesheet',
    D.after(s2, 'var(--elev-*)'), (MAIN.match(/var\(--elev-/g) || []).length);
  const shadowLit = (MAIN.match(/box-shadow:\s*[0-9-]/g) || []).length;
  const dShadow = D.after(s2, 'box-shadow');
  ok('the hand-typed box-shadow ratchet has not risen', dShadow !== undefined && shadowLit <= dShadow,
    'doc ceiling ' + dShadow + ', counted ' + shadowLit);

  const radLit = [...MAIN.matchAll(/border-radius:\s*([0-9.]+)px/g)].map((m) => m[1]);
  const dRadLit = D.after(s2, 'border-radius');
  ok('the literal border-radius ratchet has not risen', dRadLit !== undefined && radLit.length <= dRadLit,
    'doc ceiling ' + dRadLit + ', counted ' + radLit.length);
  eq('and the doc\'s distinct-radius count is today\'s', D.num(s2, /\*\*(\d+)\*\* distinct sizes/), new Set(radLit).size);
  ok('both curves the doc names are declared in :root',
    ['--ease-out', '--ease-fade'].every((t) => new RegExp(t + '\\s*:').test(ROOT_BLK) && s2.includes('`' + t + '`')),
    declIn(ROOT_BLK).filter((d) => d.startsWith('--ease-')));

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
  const onAccBlk = s3.slice(s3.indexOf('**Ink on a fill is'), s3.indexOf('**The focus ring'));
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

  /* THE FOCUS RING. The doc used to call this an open defect and the gate used to assert the defect
     was still there. It has since been fixed and themed, so both halves had to be rewritten. The
     shape below is the general one for a claim that something is CORRECT: recompute the numbers,
     assert the rule really does reference the tokens the doc names (presence), and assert it does
     NOT reference the thing the doc says it stopped using (absence). Either half alone can pass on
     a rule that has been deleted. */
  const FLOOR_TEXT = D.num(s3, /\|\s*Body text\s*\|\s*\*\*([\d.]+):1\*\*/);
  const FLOOR_NONTEXT = D.num(s3, /\|\s*Non-text[^|]*\|\s*\*\*([\d.]+):1\*\*/);
  const ringRow = (against) => {
    const m = s3.match(new RegExp('\\|\\s*`--focus`[^|`\\n]*`' + rx(against) + '`\\s*\\|\\s*\\*{0,2}([\\d.]+)\\*{0,2}\\s*\\|\\s*\\*{0,2}([\\d.]+)\\*{0,2}\\s*\\|'));
    return m ? [+m[1], +m[2]] : undefined;
  };
  const ringWrong = ['--surface', '--bg', '--surface-2'].filter((bg) => {
    const r = ringRow(bg);
    return !r || r[0] !== ratio(L('--focus'), L(bg)) || r[1] !== ratio(N('--focus'), N(bg));
  });
  ok('the focus ring against every surface the doc lists, both themes', ringWrong.length === 0,
    ringWrong.map((bg) => bg + ' doc ' + JSON.stringify(ringRow(bg)) + ' recomputed ' + JSON.stringify([ratio(L('--focus'), L(bg)), ratio(N('--focus'), N(bg))])));
  const haloRow = ringRow('--focus-halo');
  ok('the ring-against-halo row, both themes',
    !!haloRow && haloRow[0] === ratio(L('--focus'), L('--focus-halo')) && haloRow[1] === ratio(N('--focus'), N('--focus-halo')),
    'doc ' + JSON.stringify(haloRow) + ' recomputed ' + JSON.stringify([ratio(L('--focus'), L('--focus-halo')), ratio(N('--focus'), N('--focus-halo'))]));
  ok('and the two-tone pair clears the non-text floor on its own, which is the whole technique',
    FLOOR_NONTEXT !== undefined && ratio(L('--focus'), L('--focus-halo')) >= FLOOR_NONTEXT && ratio(N('--focus'), N('--focus-halo')) >= FLOOR_NONTEXT,
    'floor ' + FLOOR_NONTEXT);
  const focusRule = decomment(MAIN).match(/[^{}\n]*:focus-visible[^{}\n]*\{([^}]*outline[^}]*)\}/);
  ok('PRESENCE: the shipped rule really does draw the ring from --focus and --focus-halo',
    !!focusRule && /var\(--focus\)/.test(focusRule[1]) && /var\(--focus-halo\)/.test(focusRule[1]),
    focusRule ? focusRule[0] : 'no :focus-visible rule with an outline found');
  ok('ABSENCE: and it no longer falls back to a category hue, which is what the doc says changed',
    !!focusRule && !/var\(\s*--accent\s*,/.test(focusRule[1]) && !/--feed|--sleep|--diaper|--pump|--note|--preg|--danger|--star|--med/.test(focusRule[1]),
    focusRule ? focusRule[1] : 'no rule');
  ok('and both ring tokens are themed, so the absence above is not passing on a deleted rule',
    ['--focus', '--focus-halo'].every((t) => L(t) && N(t)), { light: [L('--focus'), L('--focus-halo')], night: [N('--focus'), N('--focus-halo')] });

  eq('the doc states the WCAG text floor', FLOOR_TEXT, 4.5);
  eq('the doc states the WCAG non-text floor', FLOOR_NONTEXT, 3);
  ok('every rung of both ink ladders clears the text floor the doc states',
    [...lightLadder['--ink'].flatMap((bg) => ['--ink', '--ink-soft', '--ink-faint'].map((t) => ratio(L(t), bg))),
      ...nightBgs.flatMap((bg) => ['--ink', '--ink-soft', '--ink-faint'].map((t) => ratio(N(t), bg)))]
      .every((r) => r >= FLOOR_TEXT), 'a rung fell below ' + FLOOR_TEXT);

  console.log('\n3b. motion');
  const trDecls = [...ALL.matchAll(/transition:[^;{}]*/g)].map((m) => m[0]);
  const trDur = [];
  trDecls.forEach((t) => [...t.matchAll(/([0-9.]+)(m?s)\b/g)]
    .forEach((m) => trDur.push(m[2] === 's' ? Math.round(parseFloat(m[1]) * 1000) : parseFloat(m[1]))));
  const tally = {}; trDur.forEach((d) => { tally[d] = (tally[d] || 0) + 1; });
  eq('transition declarations app-wide', D.ratchet(s3, 'app-wide'), trDecls.length);
  eq('of those, already on a --mo-* token', D.ratchet(s3, 'tokenised'), trDecls.filter((d) => /var\(--mo-/.test(d)).length);
  const dLitDecls = D.ratchet(s3, 'carrying a literal');
  ok('the literal-transition ratchet has not risen', dLitDecls !== undefined && trDecls.filter((d) => /[0-9.]+m?s\b/.test(d)).length <= dLitDecls,
    'doc ceiling ' + dLitDecls + ', counted ' + trDecls.filter((d) => /[0-9.]+m?s\b/.test(d)).length);
  /* The whole histogram, not just the mode. The old gate asserted only the top entry, and 150 and
     200 are now tied at 11, so "the mode" is not even a well-defined thing to assert. */
  const docHist = D.histogram(s3);
  ok('the literal-duration distribution in the doc IS the one in the code',
    !!docHist && JSON.stringify(docHist) === JSON.stringify(tally), 'doc ' + JSON.stringify(docHist) + ' code ' + JSON.stringify(tally));
  eq('total literal durations', D.num(s3, /That is \*\*(\d+)\*\* literal durations/), trDur.length);
  eq('and how many distinct values they land at', D.num(s3, /\*\*(\d+)\*\*\s*\n?distinct values/), Object.keys(tally).length);
  eq('the longest transition in the app', D.num(s3, /longest is \*\*(\d+)ms\*\*/), Math.max(...trDur));
  const [dRmAll, dRmMain] = D.nums(s3, /\*\*(\d+)\*\* across the app, \*\*(\d+)\*\* in the main stylesheet/) || [];
  eq('prefers-reduced-motion blocks app-wide', dRmAll, (ALL.match(/prefers-reduced-motion/g) || []).length);
  eq('prefers-reduced-motion blocks in the main stylesheet', dRmMain, (MAIN.match(/prefers-reduced-motion/g) || []).length);

  console.log('\n4. the component vocabulary');
  const s4 = sec(4);
  const sheets = blocks.map(decomment).concat(jsNames.filter((f) => /createElement\(\s*['"]style['"]\s*\)/.test(jsSrc[f])).map((f) => jsSrc[f]));
  const clsAll = new Set(); sheets.forEach((s) => [...s.matchAll(/\.([a-z][a-z0-9-]{1,})\s*[,{ :.]/g)].forEach((m) => clsAll.add(m[1])));
  const clsMain = new Set([...MAIN_NC.matchAll(/\.([a-z][a-z0-9-]{1,})\s*[,{ :.]/g)].map((m) => m[1]));
  const [dAllCls, dMainCls] = D.nums(s4, /\*\*(\d+)\*\* distinct class names carry a rule across the eleven stylesheets, \*\*(\d+)\*\*/) || [];
  eq('distinct class names carrying a rule, all stylesheets', dAllCls, clsAll.size);
  eq('and in the main stylesheet alone', dMainCls, clsMain.size);

  const CANON = [...s4.matchAll(/^\|[^|]*\|\s*`(\.[a-z0-9. -]+?)`\s*\|/gm)].map((m) => m[1]);
  ok('the doc names a canonical component for at least a dozen jobs', CANON.length >= 12, CANON.length + ': ' + CANON.join(' '));
  /* Presence: every canonical name must have a real rule somewhere, or the vocabulary is fiction.
     A canonical name can be a compound (`.btn-ghost.btn-danger`) or a descendant (`.field input`).
     Every dotted class in it has to have a rule, or the vocabulary is naming something that does
     not exist. */
  const orphans = CANON.filter((c) => (c.match(/\.[a-z0-9-]+/g) || [])
    .some((cls) => !new RegExp('\\' + cls + '\\s*[,{:. ]').test(ALL)));
  ok('and every canonical name has a CSS rule behind it', orphans.length === 0, orphans);
  const dSel = D.nums(s4, /`\.sel` carries (\d+) selector uses[\s\S]{0,60}?against\s*\n?(\d+) for `\.on`, (\d+) for `\.active` and (\d+) for `\.icon-on`/) || [];
  const realSel = ['sel', 'on', 'active', 'icon-on'].map((s) => (MAIN.match(new RegExp('\\.[a-z0-9-]+\\.' + s + '\\b', 'g')) || []).length);
  ok('the four spellings of "selected" are counted correctly', JSON.stringify(dSel) === JSON.stringify(realSel),
    'doc ' + JSON.stringify(dSel) + ' code ' + JSON.stringify(realSel));
  ok('and .sel really is the most-used one, which is why it is canonical',
    realSel[0] === Math.max(...realSel), realSel);
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
  const dOurs = (s5.match(/`--bg` is `(#[0-9A-Fa-f]{6})`/) || [])[1];
  eq('the doc quotes our real --bg', dOurs, L('--bg'));
  const delta = Math.max(...chan(dOurs).map((c, i) => Math.abs(c - chan(dDefault)[i])));
  eq('the channel distance from the AI-default cream', D.num(s5, /\*\*(\d+)\/255\*\*/), delta);
  eq('and the contrast ratio between them', D.num(s5, /ratio of \*\*([\d.]+):1\*\*/), ratio(dOurs, dDefault));
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
  eq('the reduced-motion block count in section 6 agrees with section 3',
    D.num(s6, /Adopted, (\d+) blocks/), dRmAll);

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
      const box = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), fs: c.fontSize, td: c.transitionDuration, br: c.borderRadius }; };
      const before = { '.icon-btn': box('.icon-btn'), '.qadd': box('.qadd'), '.nav-btn': box('.nav-btn'), '.action': box('.action'), '.greeting': box('.greeting'), '.lg-i': box('.lg-i') };
      try { openSymptom(); } catch (e) { /* the sheet is where the chips and the primary live */ }
      await new Promise((r) => setTimeout(r, 700));
      const sh = document.getElementById('sheet');
      const cs = getComputedStyle(document.documentElement);
      return Object.assign(before, {
        '.btn-primary': box('#sheet .btn-primary'), '.field input': box('#sheet .field input, #sheet .field textarea'),
        '.chip': box('#sheet .chip'), chips: document.querySelectorAll('#sheet .chip').length,
        theme: document.documentElement.getAttribute('data-theme'),
        sheetTd: sh ? getComputedStyle(sh).transitionDuration : null,
        ring: { focus: cs.getPropertyValue('--focus').trim().toUpperCase(), halo: cs.getPropertyValue('--focus-halo').trim().toUpperCase() },
        scale: ['micro', 'body', 'input', 'burst'].reduce((o, k) => (o['--fs-' + k] = cs.getPropertyValue('--fs-' + k).trim(), o), {}),
        mo: ['quick', 'enter'].reduce((o, k) => (o['--mo-' + k] = cs.getPropertyValue('--mo-' + k).trim(), o), {}),
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
  /* The chip used to be the doc's headline defect at 40px. It was grown, so this became an
     assertion that it CLEARS the floor. On its own that could pass on a chip that had vanished from
     the sheet, so it is paired with the count of them. */
  ok('the chip now clears the primary floor, which is what the doc records',
    measured.light['.chip'].h >= TOUCH && measured.night['.chip'].h >= TOUCH,
    'light ' + measured.light['.chip'].h + ' night ' + measured.night['.chip'].h);
  eq('and there are still as many of them in the symptom sheet as the doc says',
    D.after(s3, '.chip', ''), measured.light.chips);
  /* The one control the doc says is DRAWN under the floor and reaches it through a hit area. This
     is the absence half of the touch story: growing the drawn box has to fail here, exactly as
     shrinking the hit area fails in tools/touch_target_check.js. */
  ok('.lg-i is still drawn at the size the doc records, not quietly grown',
    !!docBoxes['.lg-i'] && measured.light['.lg-i'] && measured.light['.lg-i'].w === docBoxes['.lg-i'][0],
    'doc ' + JSON.stringify(docBoxes['.lg-i']) + ' measured ' + JSON.stringify(measured.light['.lg-i']));
  ok('and it really is under the floor as drawn, so the sentence above is not a tautology',
    !!docBoxes['.lg-i'] && docBoxes['.lg-i'][0] < TOUCH, docBoxes['.lg-i']);
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
  ok('and the ceiling is the --mo-enter token rather than a number the doc chose',
    measured.light.mo['--mo-enter'] === CEIL + 'ms', 'token ' + measured.light.mo['--mo-enter'] + ', doc ceiling ' + CEIL + 'ms');

  const scaleWrong = Object.keys(measured.light.scale).filter((k) => measured.light.scale[k] !== declared[k] + 'px' || measured.night.scale[k] !== declared[k] + 'px');
  ok('the scale the browser resolves is the scale the source declares, in both themes', scaleWrong.length === 0,
    scaleWrong.map((k) => k + ' light ' + measured.light.scale[k] + ' night ' + measured.night.scale[k]));
  ok('the ring tokens the browser resolves are the ones the contrast table was computed from',
    measured.light.ring.focus === L('--focus') && measured.night.ring.focus === N('--focus')
    && measured.light.ring.halo === L('--focus-halo') && measured.night.ring.halo === N('--focus-halo'),
    { light: measured.light.ring, night: measured.night.ring });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'DESIGN-DOC: FAIL' : 'DESIGN-DOC: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); console.log('DESIGN-DOC: FAIL'); process.exit(1); });
