#!/usr/bin/env node
/* THE SAME COMPONENT, BUILT TWICE.
 *
 * Measured 2026-08-30 on this tree, before this gate existed. Six pairs of selectors carried
 * SIX OR MORE identical declarations each, which is well past coincidence:
 *
 *   14  #logGuide .lg-row == #logGuide .md-r      log-guide.js and teach-ui.js
 *   10  #logGuide .lg-x   == #vaxCard .vc-x       log-guide.js and vax-card.js
 *    8  .baby-item        == .med-card            app/index.html, two sections apart
 *    8  #logGuide         == #vaxCard             the two overlay frames
 *    6  .gl-rail          == .jr-rail             app/index.html
 *    6  #logGuide .lg-rs  == #logGuide .md-o
 *
 * The first one is the argument for this file in a single line. Rename the class and .lg-row and
 * .md-r are byte-identical, thirteen declarations each; all four of their children match too; their
 * markup builders are twins; and they are BOTH scoped to #logGuide, which is the same DOM node.
 * They rendered next to each other, on the same screen, as two components. Nobody was careless.
 * They live in two files, and a file cannot see the file next to it.
 *
 * Deleting those six is a morning's work. The durable half is the gate, because the next duplicate
 * will be written by somebody who has never read this file and has no way to know that the row they
 * need already exists two directories away. So this does not look for .lg-row. It looks for the
 * CLASS of mistake: two selectors, anywhere in the app's stylesheets, whose declaration bodies are
 * identical after normalisation.
 *
 * Shaped after tools/type_scale_check.js: the rule is read out of the source rather than kept as a
 * second copy here, and whatever cannot be fixed today gets a written ratchet instead of a lowered
 * bar.
 *
 * WHY TWO THRESHOLDS. A one- or two-declaration rule repeating is a coincidence, not a component:
 * {display:none} and {flex:1;min-width:0} are the CSS equivalent of two functions that both return
 * true. Above that there is a band where a repeat is a shared TYPE RAMP typed out again (a 12px
 * soft subtitle exists five times here under five names) and a band where it is unmistakably one
 * object built twice. So:
 *   HEAVY (6 or more declarations) is a RULE. Zero, or an allowlist entry with a written reason.
 *   BAND (3 to 5) is a RATCHET. Today's true count, measured. It may fall and may not rise.
 * Every heavy pair standing when this gate was written was FOLDED rather than allowlisted, because
 * an allowlist that opens by excusing real duplicates teaches the next reader that it is the place
 * duplicates go to be forgiven. Folding took two shapes, and both count as fixed here:
 *   - a canonical component, when the two also share their markup (.ov-row, .stat-tile);
 *   - one rule under two selectors, when the two are different objects that happen to wear the same
 *     treatment (.baby-item,.med-card and .gl-rail,.jr-rail). The point of the gate is that one
 *     edit reaches both, not that every list item in the app has to answer to the same name.
 *
 * WHY THE ALLOWLIST NEEDS A SENTENCE. An allowlist of bare selector names is a list of things
 * somebody once wanted gone, and it never shrinks. Every entry here must carry its reason in prose:
 * the gate fails on a missing reason, on a reason under 30 characters, and on an entry that no
 * longer matches anything, so the list cannot outlive the duplicates it excuses. It is empty today.
 * --self-test proves that machinery still bites, since an empty list never exercises it.
 *
 *   PORT=19463 node tools/serve.js &
 *   node tools/component_dupe_check.js http://localhost:19463
 *   node tools/component_dupe_check.js --self-test http://localhost:19463
 *   node tools/component_dupe_check.js --report http://localhost:19463   (list every pair, exit 0)
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ARGS = process.argv.slice(2).filter((a) => a.indexOf('--') !== 0);
const SELF_TEST = process.argv.includes('--self-test');
const REPORT = process.argv.includes('--report');
const BASE = ARGS[0] || 'http://localhost:8080';
const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 12);

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + (typeof x === 'string' ? x : JSON.stringify(x)) : '')); }
};

/* Ports get reused on this machine, and a gate that grades ANOTHER checkout reports a clean pass on
   code that does not contain the change. Shasum the served bytes against disk before believing a
   single measurement below. */
const proveListener = async () => {
  for (const f of ['/app/index.html', '/app/log-guide.js', '/app/teach-ui.js', '/app/vax-card.js']) {
    const r = await fetch(BASE + f);
    if (!r.ok) throw new Error('GET ' + f + ' -> ' + r.status);
    const served = sha(Buffer.from(await r.text()));
    const local = sha(fs.readFileSync(path.join(ROOT, f)));
    console.log('  listener ' + f + ' served=' + served + ' disk=' + local);
    if (served !== local) {
      console.error('\nCOMPONENT-DUPE: ABORT. ' + BASE + ' is not serving this checkout (' + f + ').');
      console.error('Start this tree\'s server on a free port and pass it as argv[2].');
      process.exit(3);
    }
  }
};

/* ---------------------------------------------------------------------------------------------
   1. THE ALLOWLIST. The key is the two selectors joined by ' == ', sorted, exactly as --report
   prints them. The value is why this particular repeat is genuinely a coincidence rather than one
   component built twice. Write a sentence a stranger can act on, not "intentional".
   --------------------------------------------------------------------------------------------- */
const ALLOW = {
  // empty on purpose. Every 6+ duplicate found on 2026-08-30 was folded, not excused.
};

/* ---------------------------------------------------------------------------------------------
   2. THE SCAN. Every stylesheet the app ships: the <style> blocks in app/index.html plus the CSS
   that app/*.js injects at runtime as string constants. The JS is handled by pulling out its string
   literals in order and joining them, which copes with the '' + '…' + '…' shape all of those files
   use without this gate needing to know any of them by name.
   --------------------------------------------------------------------------------------------- */
const MIN_DECLS = 3;   // below this a repeat is a coincidence, not a component
const HEAVY = 6;       // at or above this a repeat is one object built twice, and it is a hard fail
/* 23 is not a target. It is today's true count of 3-to-5-declaration repeats, measured 2026-08-30
   AFTER the overlay shell and the stat tile were folded together (it was 29 before). A ratchet has
   to START at the real number or it fails on its first run and gets deleted. Lower it whenever you
   merge a pair; never raise it to make a run go green. Most of what is left is the shared subtitle
   ramp -- 12px/600/--ink-soft living under five names -- which is a type-scale job rather than a
   component job, and belongs to whoever migrates .csub. */
const BAND_CEILING = Number(process.env.DUPE_CEILING || 23);

const stringsOf = (js) => {
  const out = [];
  let i = 0;
  while (i < js.length) {
    const c = js[i];
    if (c === '/' && js[i + 1] === '/') { while (i < js.length && js[i] !== '\n') i++; continue; }
    if (c === '/' && js[i + 1] === '*') { i = js.indexOf('*/', i + 2); if (i < 0) break; i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1, buf = '';
      while (j < js.length) {
        if (js[j] === '\\') { buf += js[j + 1]; j += 2; continue; }
        if (js[j] === c) break;
        buf += js[j]; j++;
      }
      out.push(buf); i = j + 1; continue;
    }
    i++;
  }
  return out;
};

/* A brace-aware walk rather than a regex, so a rule nested in @media or @supports is keyed together
   with its at-rule prelude. Without that, .stat-tile at top level and .stat-tile inside the 359px
   query look like the same selector to the grouper, and every responsive override in the file reads
   as a duplicate of the rule it is overriding. */
const rulesOf = (css, where) => {
  const rules = [];
  const stack = [];
  let i = 0, buf = '';
  while (i < css.length) {
    if (css[i] === '/' && css[i + 1] === '*') { i = css.indexOf('*/', i + 2); if (i < 0) break; i += 2; continue; }
    const c = css[i];
    if (c === '{') {
      const prelude = buf.trim(); buf = ''; i++;
      if (prelude.charAt(0) === '@') { stack.push(prelude); continue; }
      let depth = 1, body = '';
      while (i < css.length && depth > 0) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') { depth--; if (!depth) break; }
        body += css[i]; i++;
      }
      i++;
      rules.push({ selector: prelude, body, at: stack.join(' '), where });
      continue;
    }
    if (c === '}') { stack.pop(); buf = ''; i++; continue; }
    buf += c; i++;
  }
  return rules;
};

/* Normalise so that formatting cannot hide a duplicate and cannot invent one: split on top-level
   semicolons (a url(a;b) or a data: URI would otherwise be cut in half), trim, drop empties, and
   SORT, because two rules that say the same things in a different order are still the same rule. */
const normalise = (body) => {
  const decls = [];
  let d = '', par = 0;
  for (const ch of body) {
    if (ch === '(') par++;
    if (ch === ')') par--;
    if (ch === ';' && par === 0) { decls.push(d); d = ''; continue; }
    d += ch;
  }
  decls.push(d);
  return decls.map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean).sort();
};

const sheets = [];
const html = fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');
[...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].forEach((m, i) => sheets.push({ css: m[1], where: 'app/index.html <style> #' + (i + 1) }));
fs.readdirSync(path.join(ROOT, 'app')).filter((f) => f.endsWith('.js')).forEach((f) => {
  const js = fs.readFileSync(path.join(ROOT, 'app', f), 'utf8');
  /* Only the literals that ARE css. Without this filter a plain string sitting next to a rule gets
     glued onto it and becomes part of the next selector: 'use strict' + '#logGuide{…}' parses as a
     selector called "use strict #logGuide", and log-guide.js and vax-card.js then look like they
     duplicate each other over a rule neither file contains. */
  const css = stringsOf(js).filter((s) => /\{[^{}]*:[^{}]*\}/.test(s)).join('\n');
  sheets.push({ css, where: 'app/' + f });
});

const rules = [];
sheets.forEach((s) => rulesOf(s.css, s.where).forEach((r) => {
  const decls = normalise(r.body);
  /* Only real rules. A string literal that happened to contain braces yields a selector full of
     spaces and punctuation, or declarations with no colon in them. Neither is CSS. */
  if (!decls.length || !decls.every((d) => d.indexOf(':') > 0)) return;
  if (!/^[.#a-zA-Z[:*]/.test(r.selector) || r.selector.length > 160) return;
  rules.push({ ...r, decls, key: r.at + '||' + decls.join(';') });
}));

const byKey = new Map();
rules.forEach((r) => {
  if (r.decls.length < MIN_DECLS) return;
  if (!byKey.has(r.key)) byKey.set(r.key, []);
  const seen = byKey.get(r.key);
  if (!seen.some((x) => x.selector === r.selector)) seen.push(r);
});

const dupes = [];
byKey.forEach((group) => {
  if (group.length < 2) return;
  dupes.push({
    pair: group.map((g) => g.selector).sort().join(' == '),
    decls: group[0].decls.length,
    where: [...new Set(group.map((g) => g.where))],
  });
});
dupes.sort((a, b) => b.decls - a.decls);

console.log('\n1. the scan sees the whole app, not one file');
ok('every stylesheet the app ships was read, injected ones included', sheets.length >= 8, sheets.length + ' sheets');
ok('and they yielded real CSS rules, so the scan is not passing on an empty parse',
  rules.length > 900, rules.length + ' rules parsed');
ok('the parse found the canonical overlay row, which proves the JS-string reader still works',
  rules.some((r) => r.selector === '.ov-row' && r.decls.length >= 12),
  (rules.find((r) => r.selector === '.ov-row') || {}).decls);

console.log('\n2. no component is built twice');
const unexcused = dupes.filter((d) => !ALLOW[d.pair]);
const heavy = unexcused.filter((d) => d.decls >= HEAVY);
const band = unexcused.filter((d) => d.decls < HEAVY);
ok('no two selectors share an identical declaration body of ' + HEAVY + '+ declarations',
  heavy.length === 0,
  heavy.map((d) => d.pair + '  (' + d.decls + ' decls, ' + d.where.join(' + ') + ')'));
ok('the ratchet holds: ' + MIN_DECLS + '-to-' + (HEAVY - 1) + '-declaration repeats have not grown',
  band.length <= BAND_CEILING,
  band.length + ' repeats, ceiling ' + BAND_CEILING + '. Lower the ceiling when you merge a pair; never raise it.');
/* Paired with the two lines above. If the grouper quietly stopped grouping, "zero duplicates" would
   be a lie that reads exactly like a pass, so prove it can still see the ones that are meant to be
   there: the band is not empty, and two differently-ordered copies still land on one key. */
ok('and the grouper still finds duplicates, so the line above is a measurement and not a no-op',
  band.length > 0, band.length + ' repeats in the 3-to-5 band');
const probe = normalise('display:flex;align-items:center;gap:12px');
ok('two rules written in a different order still hash to one key',
  probe.length === 3 && probe.join(';') === normalise('gap:12px;  display:flex;\nalign-items:center').join(';'), probe);

console.log('\n3. the allowlist is honest');
const badReason = Object.keys(ALLOW).filter((k) => (ALLOW[k] || '').trim().length < 30);
ok('every allowlisted pair carries a written reason of at least 30 characters', badReason.length === 0, badReason);
const stale = Object.keys(ALLOW).filter((k) => !dupes.some((d) => d.pair === k));
ok('no allowlist entry outlived the duplicate it excused', stale.length === 0, stale);
ok('and nothing 6+ is being excused rather than fixed, which is what an allowlist decays into',
  Object.keys(ALLOW).every((k) => (dupes.find((d) => d.pair === k) || { decls: 0 }).decls < HEAVY),
  Object.keys(ALLOW));

console.log('\n4. the six measured duplicates are gone, and their replacements exist');
const jsOf = (f) => fs.readFileSync(path.join(ROOT, 'app', f), 'utf8');
const guide = jsOf('log-guide.js'), teach = jsOf('teach-ui.js'), vax = jsOf('vax-card.js');
/* Match on the PARSED rules and on rendered markup, never on a raw grep of the file: the comments
   left at each deletion site name the classes they replaced, and a grep would read a file's own
   explanation of the fix as evidence the thing is still there. */
const sel = (s) => rules.filter((r) => r.selector === s || r.selector.split(',').map((x) => x.trim()).includes(s));
const markup = guide + teach + vax + html;
const gone = (names) => names.filter((n) => sel(n).length > 0 || new RegExp('class="[^"]*\\b' + n.slice(1) + '\\b').test(markup));
const OLD_ROW = ['.lg-row', '.md-r', '.lg-rmid', '.md-m', '.lg-rt', '.md-t', '.lg-rs', '.md-o', '.lg-chev', '.md-c'];
const OLD_TILE = ['.avg-row', '.avg-box', '.gx-stat', '.gx-box'];
ok('the ten old overlay-row selectors are gone from CSS and from markup', gone(OLD_ROW).length === 0, gone(OLD_ROW));
ok('.lg-top, .vc-top, .lg-x and .vc-x are gone from CSS and from markup',
  gone(['.lg-top', '.vc-top', '.lg-x', '.vc-x']).length === 0, gone(['.lg-top', '.vc-top', '.lg-x', '.vc-x']));
ok('the four old stat-tile selectors are gone from CSS and from markup', gone(OLD_TILE).length === 0, gone(OLD_TILE));
['.ov-screen', '.ov-bar', '.ov-x', '.ov-row', '.stat-tiles', '.stat-tile'].forEach((s) => {
  ok(s + ' is declared exactly once', sel(s).length === 1, sel(s).map((r) => r.where));
});
ok('every canonical rule lives in the app stylesheet, not inside one overlay\'s private sheet',
  ['.ov-screen', '.ov-bar', '.ov-x', '.ov-row', '.stat-tile'].every((s) => (sel(s)[0] || {}).where === 'app/index.html <style> #1'),
  ['.ov-screen', '.ov-bar', '.ov-x', '.ov-row', '.stat-tile'].map((s) => s + ' -> ' + (sel(s)[0] || {}).where));
/* The hairline is 1.5px in the source. Chrome rounds a fractional border down to one device pixel
   at dpr 1, so the browser half below cannot read this value back and it has to be asserted here. */
ok('the canonical row still carries the 1.5px hairline the two originals had',
  (sel('.ov-row')[0] || { decls: [] }).decls.includes('border:1.5px solid var(--line)'),
  (sel('.ov-row')[0] || {}).decls);
/* The app-wide reduced-motion block shortens transitions, and .ov-row:active is not a transition:
   the transform applies instantly. Each overlay used to cancel it by hand and the fold has to keep
   doing that, so check the cancel survived and that it is declared once rather than three times. */
const rmOvRow = rules.filter((r) => /reduced-motion/.test(r.at) && r.selector === '.ov-row:active');
ok('the reduced-motion cancel for the row survived the fold, exactly once',
  rmOvRow.length === 1 && rmOvRow[0].decls.join(';') === 'transform:none',
  rmOvRow.map((r) => r.where + ' ' + r.decls.join(';')));
ok('the canonical tile carries min-width:0, which only one of the two originals had',
  (sel('.stat-tile')[0] || { decls: [] }).decls.includes('min-width:0'), (sel('.stat-tile')[0] || {}).decls);
ok('all three overlays wear the shared frame and the shared bar',
  /ov-screen/.test(guide) && /ov-screen/.test(vax) && /ov-bar/.test(guide) && /ov-bar/.test(vax) && /ov-bar/.test(teach), null);
ok('and both row-rendering files build the shared row',
  /class="ov-row"/.test(guide) && /class="ov-row"/.test(teach), null);
ok('the two folded rules really are one rule under two selectors, not two rules again',
  sel('.baby-item').length === 1 && sel('.med-card').length === 1
    && sel('.baby-item')[0].selector === '.baby-item,.med-card'
    && sel('.gl-rail')[0].selector === '.gl-rail,.jr-rail',
  [sel('.baby-item').map((r) => r.selector), sel('.gl-rail').map((r) => r.selector)]);

/* ---------------------------------------------------------------------------------------------
   3. THE BROWSER HALF. A class name in a file proves nothing about what a parent sees. These are
   computed values off the real DOM at 390px, on every affected surface, in both themes.
   --------------------------------------------------------------------------------------------- */
const CLOCK = (() => { const d = new Date(); d.setHours(10, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const DAY = 86400000, HOUR = 3600000;
const now = CLOCK;

const SEED = {
  babies: [{ id: 'b1', name: 'Robin', birth: now - 120 * DAY, sex: 'F', country: 'gb', routines: [], doctors: [], allergies: [] }],
  activeBabyId: 'b1',
  events: [
    { id: 'e1', type: 'feed', babyId: 'b1', method: 'bottle', amount: 120, unit: 'ml', time: now - 3 * HOUR, authorId: 'local' },
    { id: 'e3', type: 'diaper', babyId: 'b1', kind: 'wet', time: now - 4 * HOUR, authorId: 'local' },
    { id: 'e4', type: 'sleep', babyId: 'b1', start: now - 8 * HOUR, end: now - 6 * HOUR, time: now - 8 * HOUR, authorId: 'local' },
    { id: 'e5', type: 'growth', babyId: 'b1', weight: 6.85, wUnit: 'kg', height: 62.4, hUnit: 'cm', head: 41.8, hcUnit: 'cm', time: now - 2 * DAY, authorId: 'local' },
    { id: 'e6', type: 'growth', babyId: 'b1', weight: 6.2, wUnit: 'kg', height: 60.1, hUnit: 'cm', head: 40.9, hcUnit: 'cm', time: now - 32 * DAY, authorId: 'local' },
  ],
  illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
};

/* One JSON string per row, so "every row on both surfaces is the same component" can be one
   assertion over a Set rather than a list of pairwise comparisons that grows with the vocabulary. */
const shape = (r) => JSON.stringify({
  display: r.display, gap: r.gap, radius: r.radius, border: r.border, padding: r.padding,
  minHeight: r.minHeight, tSize: r.tSize, tWeight: r.tWeight, sSize: r.sSize, chevSize: r.chevSize,
});

(async () => {
  await proveListener();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.evaluateOnNewDocument((shift) => {
    const R = Date;
    function D(...a) { return a.length === 0 ? new R(R.now() + shift) : new R(...a); }
    D.prototype = R.prototype; D.now = () => R.now() + shift; D.parse = R.parse; D.UTC = R.UTC;
    window.Date = D;
  }, OFFSET);
  await page.setViewport({ width: 390, height: 844 });

  const boot = async (theme) => {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
    await page.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });
    await page.evaluate((s) => {
      localStorage.setItem('cubby-quick-uid', 'local');
      localStorage.setItem('little-log-v1', JSON.stringify(s));
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
    }, SEED);
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(() => typeof state !== 'undefined' && (state.events || []).some((e) => e.id === 'e5'), { timeout: 20000 });
    await sleep(800);
  };

  // Walk to the tiles the way a parent does: the Log tab, then the Stats segment.
  const openStats = async () => {
    await page.evaluate(() => {
      go('log');
      const seg = [...document.querySelectorAll('.seg button')].find((b) => b.textContent.trim() === 'Stats');
      if (seg) seg.click();
    });
    await sleep(600);
  };

  /* Both tile rows live on the Stats screen at once, one above the other, so a bare .stat-tile query
     returns all six and any claim about "the Stats tiles" would silently be about Growth's too. The
     ids pick the instance. Horizontal overflow is read off the row and off #scroll, never off the
     document: Cubby scrolls inside #scroll, and the document's own scrollWidth is wider than the
     viewport on every screen because of the sign-in overlay parked off to one side. */
  const tileGeom = (which) => page.evaluate((rowSel) => {
    const olds = document.querySelectorAll('.avg-box,.gx-box,.avg-row,.gx-stat').length;
    const row = document.querySelector(rowSel);
    const tiles = [...(row ? row.querySelectorAll('.stat-tile') : [])].map((t) => {
      const cs = getComputedStyle(t), n = t.querySelector('.n'), l = t.querySelector('.l');
      const r = t.getBoundingClientRect();
      return {
        radius: cs.borderRadius, padding: cs.padding, shadow: cs.boxShadow, bg: cs.backgroundColor,
        minWidth: cs.minWidth,
        nSize: n ? getComputedStyle(n).fontSize : null,
        nWrap: n ? getComputedStyle(n).whiteSpace : null,
        nLines: n ? Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).fontSize)) : 0,
        lSize: l ? getComputedStyle(l).fontSize : null,
        h: Math.round(r.height), w: Math.round(r.width),
        text: (n ? n.textContent : '').trim(),
      };
    });
    const sc = document.getElementById('scroll');
    return {
      olds, tiles,
      cls: row ? row.className : null,
      rowSpills: !!row && row.scrollWidth > row.clientWidth + 1,
      spills: !!sc && sc.scrollWidth > sc.clientWidth + 1,
    };
  }, which);

  const ovGeom = (id) => page.evaluate((frameId) => {
    const olds = document.querySelectorAll('.lg-row,.md-r,.lg-rmid,.md-m,.lg-rt,.md-t,.lg-rs,.md-o,.lg-chev,.md-c,.lg-top,.vc-top,.lg-x,.vc-x').length;
    const rows = [...document.querySelectorAll('#' + frameId + ' .ov-row')].map((b) => {
      const cs = getComputedStyle(b);
      const t = b.querySelector('.ov-row-t'), s = b.querySelector('.ov-row-s'), c = b.querySelector('.ov-row-chev');
      return {
        display: cs.display, gap: cs.gap, radius: cs.borderRadius, border: cs.borderTopWidth,
        padding: cs.padding, minHeight: cs.minHeight, bg: cs.backgroundColor, colour: cs.color,
        h: Math.round(b.getBoundingClientRect().height),
        tSize: t ? getComputedStyle(t).fontSize : null,
        tWeight: t ? getComputedStyle(t).fontWeight : null,
        sSize: s ? getComputedStyle(s).fontSize : null,
        chevSize: c ? getComputedStyle(c).fontSize : null,
        label: t ? t.textContent.trim() : null,
      };
    });
    const bars = [...document.querySelectorAll('#' + frameId + ' .ov-bar')].map((b) => {
      const cs = getComputedStyle(b);
      return { display: cs.display, gap: cs.gap, align: cs.alignItems };
    });
    const xb = document.querySelector('#' + frameId + ' .ov-x');
    const x = xb ? (() => {
      const cs = getComputedStyle(xb), r = xb.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), radius: cs.borderRadius, size: cs.fontSize, bg: cs.backgroundColor };
    })() : null;
    const f = document.querySelector('#' + frameId + '.ov-screen');
    const frame = f ? (() => {
      const cs = getComputedStyle(f), r = f.getBoundingClientRect();
      return { pos: cs.position, z: cs.zIndex, display: cs.display, dir: cs.flexDirection,
        w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left) };
    })() : null;
    return { olds, rows, bars, x, frame };
  }, id);

  const measured = {};
  for (const theme of ['light', 'dark']) {
    await boot(theme);
    await openStats();
    const stats = await tileGeom('#avgTiles');
    const growth = await tileGeom('#gxTiles');

    await page.evaluate(() => { if (typeof cubbyOpenGuide === 'function') cubbyOpenGuide(); });
    await sleep(500);
    const guideOv = await ovGeom('logGuide');
    await page.evaluate(() => { if (window.CubbyGuide) window.CubbyGuide.close(); });
    await sleep(250);

    await page.evaluate(() => { if (window.CubbyTeachUI) window.CubbyTeachUI.door(); });
    await sleep(500);
    const doorOv = await ovGeom('logGuide');
    await page.evaluate(() => { if (window.CubbyGuide) window.CubbyGuide.close(); });
    await sleep(250);

    await page.evaluate(() => { if (window.CubbyVaxCard) window.CubbyVaxCard.begin(false); });
    await sleep(600);
    const vaxOv = await ovGeom('vaxCard');
    await page.evaluate(() => { if (window.CubbyVaxCard) window.CubbyVaxCard.close(); });
    await sleep(250);

    measured[theme] = { stats, growth, guideOv, doorOv, vaxOv };
  }

  console.log('\n5. the stat tile: one component, both surfaces, both themes');
  for (const theme of ['light', 'dark']) {
    const { stats, growth } = measured[theme];
    ok('[' + theme + '] Stats renders 3 canonical tiles and no old ones',
      stats.tiles.length === 3 && stats.olds === 0, { tiles: stats.tiles.length, olds: stats.olds });
    ok('[' + theme + '] Growth renders 3 canonical tiles and no old ones',
      growth.tiles.length === 3 && growth.olds === 0, { tiles: growth.tiles.length, olds: growth.olds });
    /* The measured values, not "a token exists": a 16px radius, 15px of padding, min-width:0 so a
       flex child can shrink, and a 24px number that cannot wrap onto a second line. */
    ok('[' + theme + '] every Stats tile is 16px round, 15px padded, min-width:0',
      stats.tiles.length === 3 && stats.tiles.every((t) => t.radius === '16px' && t.padding === '15px' && t.minWidth === '0px'),
      stats.tiles.map((t) => [t.radius, t.padding, t.minWidth]));
    ok('[' + theme + '] the Stats number is 24px, one line, and cannot wrap',
      stats.tiles.length === 3 && stats.tiles.every((t) => t.nSize === '24px' && t.nWrap === 'nowrap' && t.nLines === 1),
      stats.tiles.map((t) => [t.text, t.nSize, t.nWrap, t.nLines]));
    ok('[' + theme + '] the Stats label is 12px', stats.tiles.length === 3 && stats.tiles.every((t) => t.lSize === '12px'), stats.tiles.map((t) => t.lSize));
    ok('[' + theme + '] Stats and Growth tiles share one surface and one shadow',
      stats.tiles[0] && growth.tiles[0] && stats.tiles[0].bg === growth.tiles[0].bg && stats.tiles[0].shadow === growth.tiles[0].shadow,
      { stats: stats.tiles[0] && [stats.tiles[0].bg, stats.tiles[0].shadow], growth: growth.tiles[0] && [growth.tiles[0].bg, growth.tiles[0].shadow] });
    /* The three-across row is still allowed to be tighter, and it is a modifier on the shared tile
       rather than a second tile. Head circumference makes the row three wide and three tiles of
       15px padding do not fit 390px without the number wrapping, so this difference was chosen. */
    ok('[' + theme + '] the Growth row wears the three-across modifier',
      growth.cls === 'stat-tiles tiles-3', growth.cls);
    ok('[' + theme + '] and it keeps its deliberate 18px number and 13px/10px padding',
      growth.tiles.length === 3 && growth.tiles.every((t) => t.nSize === '18px' && t.padding === '13px 10px'),
      growth.tiles.map((t) => [t.text, t.nSize, t.padding]));
    ok('[' + theme + '] all three Growth tiles are the same height, so the labels line up',
      new Set(growth.tiles.map((t) => t.h)).size === 1, growth.tiles.map((t) => [t.text, t.h]));
    ok('[' + theme + '] neither tile row spills sideways at 390px',
      stats.tiles.length === 3 && growth.tiles.length === 3 && !stats.rowSpills && !growth.rowSpills && !stats.spills && !growth.spills,
      { statsRow: stats.rowSpills, growthRow: growth.rowSpills, scroller: stats.spills || growth.spills });
  }
  ok('the tile really is theme-aware, so the two theme passes above are two different renders',
    measured.light.stats.tiles[0] && measured.dark.stats.tiles[0]
      && measured.light.stats.tiles[0].bg !== measured.dark.stats.tiles[0].bg,
    { light: measured.light.stats.tiles[0] && measured.light.stats.tiles[0].bg, dark: measured.dark.stats.tiles[0] && measured.dark.stats.tiles[0].bg });

  console.log('\n6. the overlay shell: three screens, one frame, one bar, one row');
  for (const theme of ['light', 'dark']) {
    const g = measured[theme].guideOv, d = measured[theme].doorOv, v = measured[theme].vaxOv;
    ok('[' + theme + '] the log guide renders canonical rows and no old ones',
      g.rows.length >= 6 && g.olds === 0, { rows: g.rows.length, olds: g.olds });
    ok('[' + theme + '] the monthly door renders canonical rows and no old ones',
      d.rows.length >= 3 && d.olds === 0, { rows: d.rows.length, olds: d.olds });
    ok('[' + theme + '] the row is 16px round, 44px minimum, 13px/14px padded, with a real border',
      g.rows.length > 0 && g.rows.every((r) => r.radius === '16px' && r.minHeight === '44px' && r.padding === '13px 14px' && parseFloat(r.border) > 0),
      g.rows.slice(0, 1).map((r) => [r.radius, r.border, r.minHeight, r.padding]));
    ok('[' + theme + '] its title is 15px/800, its sub is 13px and its chevron is 15px',
      g.rows.length > 0 && g.rows.every((r) => r.tSize === '15px' && r.tWeight === '800' && r.sSize === '13px' && r.chevSize === '15px'),
      g.rows.slice(0, 1).map((r) => [r.tSize, r.tWeight, r.sSize, r.chevSize]));
    ok('[' + theme + '] every row in the guide is the same shape as every row in the door',
      g.rows.length > 0 && d.rows.length > 0 && new Set(g.rows.concat(d.rows).map(shape)).size === 1,
      [...new Set(g.rows.concat(d.rows).map(shape))]);
    ok('[' + theme + '] and the rows carry real labels, so the shape check is not comparing empties',
      g.rows.length > 0 && d.rows.length > 0 && g.rows.every((r) => r.label && r.label.length > 1) && d.rows.every((r) => r.label && r.label.length > 1),
      g.rows.slice(0, 2).map((r) => r.label));
    ok('[' + theme + '] the shared header bar renders once per overlay, 10px gap, centred, on all three',
      [g, d, v].every((o) => o.bars.length === 1 && o.bars[0].display === 'flex' && o.bars[0].gap === '10px' && o.bars[0].align === 'center'),
      [g.bars, d.bars, v.bars]);
    ok('[' + theme + '] the close disc is 44x44 and round on the guide and on the vaccine card',
      [g, v].every((o) => o.x && o.x.w === 44 && o.x.h === 44 && o.x.radius === '50%' && o.x.size === '15px'),
      [g.x, v.x]);
    ok('[' + theme + '] the guide and the vaccine card wear the same close disc, down to the fill',
      g.x && v.x && g.x.bg === v.x.bg, [g.x && g.x.bg, v.x && v.x.bg]);
    /* The frame moved out of two id-scoped rules into one shared class, which is a specificity drop
       from (1,0,0) to (0,1,0). If anything in the app stylesheet now outranks it the overlay stops
       covering the screen, so this measures the actual box rather than the class list. */
    ok('[' + theme + '] both frames still fill all 390x844 at z-index 100002',
      [g, v].every((o) => o.frame && o.frame.pos === 'fixed' && o.frame.z === '100002' && o.frame.display === 'flex'
        && o.frame.dir === 'column' && o.frame.w === 390 && o.frame.h === 844 && o.frame.top === 0 && o.frame.left === 0),
      [g.frame, v.frame]);
  }
  ok('the row really is theme-aware too',
    measured.light.guideOv.rows[0] && measured.dark.guideOv.rows[0]
      && measured.light.guideOv.rows[0].bg !== measured.dark.guideOv.rows[0].bg,
    { light: measured.light.guideOv.rows[0] && measured.light.guideOv.rows[0].bg,
      dark: measured.dark.guideOv.rows[0] && measured.dark.guideOv.rows[0].bg });

  if (REPORT) {
    console.log('\nevery identical-body pair in the app (' + MIN_DECLS + '+ declarations):');
    dupes.forEach((d) => console.log('  ' + String(d.decls).padStart(3) + '  ' + (ALLOW[d.pair] ? 'allowed  ' : '         ') + d.pair + '   [' + d.where.join(' + ') + ']'));
    console.log('rules parsed: ' + rules.length + ' across ' + sheets.length + ' sheets');
  }

  if (SELF_TEST) {
    console.log('\nself-test: the assertions that must be able to go red');
    const before = fail;
    ok('(self-test) a deliberately false claim fails', false, 'expected');
    ok('(self-test) the harness counted it', fail === before + 1, { before, after: fail });
    /* Prove the detector still detects, by feeding it a duplicate. A scanner that has quietly
       stopped scanning reports the same "0 duplicates" as a clean tree. */
    const fake = rulesOf('.a{display:flex;gap:12px;color:red}\n.b{color:red;display:flex;gap:12px}', 'self-test');
    const keys = fake.map((r) => normalise(r.body).join(';'));
    ok('(self-test) the scanner groups two differently-ordered copies as one', keys[0] === keys[1], keys);
    /* And prove the allowlist validator bites. It is empty today, so nothing above exercises it: a
       broken reason check would sit here for months looking exactly like a passing one. */
    const FAKE_ALLOW = { '.a == .b': 'too short', '.c == .d': 'a reason long enough to be a real sentence about why' };
    const short = Object.keys(FAKE_ALLOW).filter((k) => FAKE_ALLOW[k].trim().length < 30);
    ok('(self-test) the allowlist rejects a reason under 30 characters', short.length === 1 && short[0] === '.a == .b', short);
    const fakeStale = Object.keys(FAKE_ALLOW).filter((k) => !dupes.some((d) => d.pair === k));
    ok('(self-test) and it spots an entry that matches no live duplicate', fakeStale.length === 2, fakeStale);
    pass -= 1; fail -= 1; // unwind the deliberate failure so the verdict is about the app
    console.log('  (self-test failure unwound; ' + pass + ' passed / ' + fail + ' failed carried forward)');
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'COMPONENT-DUPE: FAIL' : 'COMPONENT-DUPE: PASS');
  process.exit(REPORT ? 0 : (fail ? 1 : 0));
})().catch((e) => { console.error(e); process.exit(2); });
