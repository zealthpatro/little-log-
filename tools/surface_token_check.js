#!/usr/bin/env node
/* RADIUS, SHADOW AND SPACING: THE TOKENS THAT DID NOT MEAN ANYTHING.
 *
 * Counted 2026-08-30, before this gate existed:
 *
 *   RADIUS. Five tokens, and FOUR of them were 16px: --radius, --radius-sm, --r-card, --r-dense.
 *   Reaching for --radius-sm instead of --radius changed nothing except the reader's belief that it
 *   had. A vocabulary that promises a distinction it does not make is worse than no vocabulary,
 *   because it teaches the next person that the choice is arbitrary. Under those five tokens sat 22
 *   distinct literal radii across 178 declarations.
 *
 *   SHADOW. Two tokens, --shadow and --shadow-strong, and both were COLOURS. Not one of them
 *   carried an offset or a blur, so all 66 drop shadows in the stylesheet hand-wrote their own
 *   geometry: 21 distinct offset/blur triples. Four of them (0 3px 9px, 0 4px 10px, 0 4px 11px,
 *   0 4px 12px) were the same card at the same height, measured four separate times. And the colour
 *   was picked at random: 0 8px 22px appeared with --shadow AND with --shadow-strong in one file.
 *
 *   SPACING. Seven tokens, of which --gutter:20px was documented as "the page inset every card
 *   already uses" and was referenced ZERO times. The comment was true and the token was dead.
 *
 * This gate does not check that a token EXISTS. A token existing is what got us here. It boots the
 * real app in a real browser at 390px in both themes and reads computed styles off elements the
 * parent actually touches, then holds the source to a ratchet for what could not migrate at once.
 *
 *   PORT=19271 node tools/serve.js &
 *   node tools/surface_token_check.js http://localhost:19271
 *   node tools/surface_token_check.js http://localhost:19271 --report   (print the spread, exit 0)
 *
 * The gate reads the scale out of :root rather than keeping its own copy, the same way
 * tools/type_scale_check.js does, so this file can never disagree with the stylesheet about what
 * the scale IS. A gate holding a private copy of the thing it checks is one edit from asserting a
 * world that stopped existing.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = path.dirname(__dirname);
const BASE = (process.argv[2] || 'http://localhost:8123').replace(/\/$/, '');
const REPORT = process.argv.includes('--report');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + (typeof x === 'string' ? x : JSON.stringify(x)) : '')); } };

/* Pinned clock, so a run at 02:00 and a run at 14:00 grade the same pixels. */
const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

const seed = () => ({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
  activeBabyId: 'b1',
  events: [
    { id: 'e1', babyId: 'b1', type: 'feed', at: now - 2 * 3600000, method: 'bottle', ml: 120 },
    { id: 'e2', babyId: 'b1', type: 'diaper', at: now - 3600000, kind: 'wet' },
    { id: 'e3', babyId: 'b1', type: 'sleep', at: now - 5 * 3600000, mins: 90 },
  ],
  illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
});

/* ------------------------------------------------------------------ the source half of the gate */
const html = fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');
const MAIN = ([...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1])[0]) || '';

/* Read the scale out of :root. Only the FIRST :root block, so the night theme and the print
   override cannot be mistaken for extra steps. */
const rootBlock = (/:root\s*\{([\s\S]*?)\n\}/.exec(MAIN) || [, ''])[1];
const elev = [...rootBlock.matchAll(/(--elev-[a-z]+)\s*:\s*([^;]+);/g)].map((m) => {
  const raw = m[2].trim();
  const g = /^0\s+(-?\d+)px\s+(\d+)px\s+var\((--shadow[a-z-]*)\)$/.exec(raw);
  return { name: m[1], raw, y: g ? +g[1] : null, blur: g ? +g[2] : null, colour: g ? g[3] : null };
});
const radii = [...rootBlock.matchAll(/(--r-[a-z]+)\s*:\s*(\d+)px\s*;/g)].map((m) => ({ name: m[1], px: +m[2] }));

console.log('\n1. the elevation scale is made of shadows, not of colours');
ok('an elevation scale is declared in :root', elev.length >= 4, elev.length + ' levels');
/* The whole defect this replaces: --shadow and --shadow-strong are colours with no geometry. A
   level that fails to parse here is one that went back to being a colour, or a halo. */
ok('every level parses as offset + blur + a shadow colour token', elev.length > 0 && elev.every((e) => e.y !== null),
  elev.filter((e) => e.y === null).map((e) => e.name + ':' + e.raw));
ok('every level carries a DOWNWARD offset, because a zero-offset halo is decoration and not height',
  elev.length > 0 && elev.every((e) => e.y > 0), elev.map((e) => e.name + ' y=' + e.y));
ok('and a soft blur, at least twice the offset, so light falls on paper instead of stamping an edge',
  elev.length > 0 && elev.every((e) => e.blur >= e.y * 2), elev.map((e) => e.name + ' ' + e.y + '/' + e.blur));
const eSorted = [...elev];
ok('the levels ascend in offset with no two the same, so no two levels are the same height',
  eSorted.length > 0 && eSorted.every((e, i) => i === 0 || e.y > eSorted[i - 1].y), eSorted.map((e) => e.name + ':' + e.y));
ok('and ascend in blur with them, because a thing further from the page casts a softer shadow',
  eSorted.length > 0 && eSorted.every((e, i) => i === 0 || e.blur > eSorted[i - 1].blur), eSorted.map((e) => e.name + ':' + e.blur));
/* Colour used to be chosen at random. It is now a function of height, which is the only reason a
   scale beats twenty-one hand-written triples. */
const strongFrom = eSorted.findIndex((e) => e.colour === '--shadow-strong');
ok('the shadow colour steps with the height once and never steps back', strongFrom > 0 &&
  eSorted.every((e, i) => (i < strongFrom) === (e.colour === '--shadow')),
  eSorted.map((e) => e.name + ':' + e.colour));

console.log('\n2. the radius vocabulary makes only distinctions it actually makes');
ok('a radius scale is declared in :root', radii.length >= 4, radii.length + ' steps');
/* The original defect, asserted directly: four tokens, one value. */
ok('no two radius tokens share a value, which is exactly what --radius/--radius-sm/--r-card/--r-dense did',
  new Set(radii.map((r) => r.px)).size === radii.length, radii.map((r) => r.name + ':' + r.px));
ok('every step is a whole pixel', radii.length > 0 && radii.every((r) => Number.isInteger(r.px)), radii);
/* Absence, paired with the presence assertion on the next line so this cannot pass on an empty
   stylesheet. */
const legacy = ['--radius', '--radius-sm', '--r-dense'].filter((t) => MAIN.includes('var(' + t + ')'));
ok('the three duplicate radius tokens are gone from the stylesheet', legacy.length === 0, legacy);
const cardUses = (MAIN.match(/var\(--r-card\)/g) || []).length;
ok('and the one card radius that replaced them is carrying their work', cardUses >= 30, cardUses + ' uses of --r-card');

console.log('\n3. the ratchets: what could not migrate in one pass may fall and may not rise');
/* Same bargain tools/type_scale_check.js struck. 65 and 1 are today's TRUE counts, measured
   2026-08-30. A ratchet has to start at the real number or it fails on its first run and gets
   deleted for being noisy. Lower these as literals migrate; never raise one to go green. */
const brLits = [...MAIN.matchAll(/border-radius:\s*([^;}]+)/g)].map((m) => m[1].trim())
  .filter((v) => /\dpx/.test(v) && !/var\(/.test(v));
const R_CEIL = Number(process.env.RADIUS_CEILING || 65);
ok('radius literals in the stylesheet have not grown', brLits.length <= R_CEIL,
  brLits.length + ' literals, ceiling ' + R_CEIL + '. Lower it when you migrate some.');
const shAll = [...MAIN.matchAll(/box-shadow:\s*([^;}]+)/g)].map((m) => m[1].trim());
/* An inset ring and a 0 0 0 pulse are not elevation and are deliberately exempt. A drop shadow is
   anything with a real offset, and those all belong to the scale. */
const shOff = shAll.filter((v) => !/inset/.test(v) && !/^none/.test(v) && !/^0 0 0/.test(v) && !/var\(--elev-/.test(v));
const S_CEIL = Number(process.env.SHADOW_CEILING || 1);
ok('drop shadows written by hand instead of taken from the scale have not grown', shOff.length <= S_CEIL,
  shOff.length + ' off-scale: ' + shOff.join(' | '));
const onScale = shAll.filter((v) => /var\(--elev-/.test(v)).length;
ok('and the scale is doing the work, so the line above is not passing on a file with no shadows',
  onScale >= 50, onScale + ' shadows on the scale');

console.log('\n4. --gutter said it was the page inset and was referenced zero times');
let appTxt = html;
fs.readdirSync(path.join(ROOT, 'app')).filter((f) => /\.(js|css)$/.test(f))
  .forEach((f) => { appTxt += fs.readFileSync(path.join(ROOT, 'app', f), 'utf8'); });
ok('--gutter is wired to something now', (appTxt.match(/var\(--gutter[,)]/g) || []).length > 0,
  (appTxt.match(/var\(--gutter[,)]/g) || []).length + ' references');

/* SPACING, the honest verdict. The stylesheet's own comment already records that a universal 4px
   grid would move 510 of 805 values and was rejected as a redesign of a shipped app. So this gate
   does NOT pretend spacing is a scale. It measures how far from one it is and holds the number, so
   the drift is visible instead of invented. */
const spac = [];
[...MAIN.matchAll(/(?:^|[;{])\s*(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|bottom|left|right))?\s*:\s*([^;}]+)/g)]
  .forEach((m) => m[1].trim().split(/\s+/).forEach((v) => { const g = /^(-?[\d.]+)px$/.exec(v); if (g) spac.push(Math.abs(parseFloat(g[1]))); }));
const distinctSp = [...new Set(spac)].sort((a, b) => a - b);
const SP_CEIL = Number(process.env.SPACING_CEILING || 30);
ok('the spacing vocabulary has not grown wider', distinctSp.length <= SP_CEIL,
  distinctSp.length + ' distinct values across ' + spac.length + ', ceiling ' + SP_CEIL);

/* ----------------------------------------------------------------- the measured half of the gate */
/* A shadow's HEIGHT is its vertical offset and its blur; the colour is the theme's business and the
   x-offset and spread are zero everywhere here. Chrome computes "rgba(...) 0px 3px 9px 0px" while
   the token is authored "0 3px 9px var(--shadow)", so both get reduced to the same "y/blur" key
   before they are compared. Comparing the strings instead would fail on the unit alone. */
const GEO = (s) => {
  const n = (s.match(/(-?[\d.]+)px/g) || []).map((v) => parseFloat(v));
  const m = /^0\s+(-?[\d.]+)px\s+([\d.]+)px/.exec(String(s).trim());
  if (m) return m[1] + '/' + m[2];
  return n.length >= 3 ? n[1] + '/' + n[2] : '';
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((shift) => {
    const R = Date;
    function D(...a) { return a.length === 0 ? new R(R.now() + shift) : new R(...a); }
    D.prototype = R.prototype; D.now = () => R.now() + shift; D.parse = R.parse; D.UTC = R.UTC;
    window.Date = D;
  }, OFFSET);
  await page.setViewport({ width: 390, height: 844 });

  const readTheme = async (theme) => {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme === 'night' ? 'dark' : 'light' }]);
    await page.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });
    await page.evaluate((s, t) => {
      localStorage.setItem('cubby-quick-uid', 'local');
      localStorage.setItem('little-log-v1', JSON.stringify(s));
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
      localStorage.setItem('cubby-theme:local', t === 'night' ? 'night' : 'day');
    }, seed(), theme);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1500);
    return page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const tok = (n) => cs.getPropertyValue(n).trim();
      const out = { theme: document.documentElement.getAttribute('data-theme') || 'day', shadows: [], radii: [], tokens: {} };
      ['--elev-chip', '--elev-card', '--elev-lift', '--elev-float', '--elev-over', '--elev-modal',
       '--r-xs', '--r-ctl', '--r-card', '--r-lg', '--r-xl', '--r-pill', '--gutter'].forEach((n) => { out.tokens[n] = tok(n); });
      document.querySelectorAll('*').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const c = getComputedStyle(el);
        const sh = c.boxShadow;
        if (sh && sh !== 'none' && sh.indexOf('inset') < 0) {
          out.shadows.push({ sel: el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : el.tagName, v: sh, h: r.height });
        }
        const br = c.borderRadius;
        if (br && br !== '0px') out.radii.push({ sel: el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : el.tagName, v: br, h: r.height });
      });
      const sc = document.querySelector('.scroll') || document.querySelector('#scroll');
      out.inset = sc ? getComputedStyle(sc).paddingLeft : null;
      return out;
    });
  };

  const day = await readTheme('day');
  const night = await readTheme('night');

  console.log('\n5. MEASURED at 390px: every rendered drop shadow is one of the six heights');
  for (const m of [day, night]) {
    const label = m.theme === 'night' ? 'night' : 'day';
    /* Presence first. An absence assertion on a page that rendered nothing is a lie that passes. */
    ok('[' + label + '] the app rendered and is casting shadows to measure', m.shadows.length >= 15,
      m.shadows.length + ' shadowed elements');
    const scaleGeo = new Set(['--elev-chip', '--elev-card', '--elev-lift', '--elev-float', '--elev-over', '--elev-modal']
      .map((n) => GEO(m.tokens[n])).filter(Boolean));
    ok('[' + label + '] the six levels resolve to six distinct geometries', scaleGeo.size === 6, [...scaleGeo]);
    /* A ring is not a shadow. The pulse keyframes on the timer banner and the day-surface animate a
       0-offset 0-blur spread outward, and the selection rings do the same standing still; both are
       decoration drawn with box-shadow because CSS has no other way to draw a border that does not
       move layout. They are exempt from the elevation scale on purpose, and the assertion below
       checks the exemption cannot be abused: a ring has to actually BE a ring. */
    const rings = m.shadows.filter((s) => GEO(s.v) === '0/0');
    const drops = m.shadows.filter((s) => GEO(s.v) !== '0/0');
    ok('[' + label + '] every box-shadow exempted as a ring really has no offset and no blur',
      m.shadows.length > 0 && rings.every((s) => /^rgba?\([^)]*\)\s+0px\s+0px\s+0px/.test(s.v)), rings.map((s) => s.sel + ' ' + s.v).slice(0, 4));
    const strays = drops.filter((s) => !GEO(s.v) || !scaleGeo.has(GEO(s.v)));
    ok('[' + label + '] no rendered element casts a shadow that is not on the scale', strays.length === 0,
      strays.map((s) => s.sel + ' ' + s.v).slice(0, 6));
    const usedGeo = new Set(drops.map((s) => GEO(s.v)));
    ok('[' + label + '] and more than one height is actually in use, so the app is not flat',
      usedGeo.size >= 3, usedGeo.size + ' heights on screen');
  }

  console.log('\n6. MEASURED: height is a constant, colour is a theme');
  /* This is the property a real elevation scale has and twenty-one hand-written triples cannot: the
     same card sits the same distance off the page in both themes, and only the light changes. */
  const geoOf = (m) => [...new Set(m.shadows.map((s) => GEO(s.v)))].sort().join(' | ');
  ok('the set of shadow geometries is byte-identical between day and night', geoOf(day) === geoOf(night),
    'day: ' + geoOf(day) + '\n         night: ' + geoOf(night));
  const colOf = (m) => (/(rgba?\([^)]*\))/.exec(m.shadows.map((s) => s.v).join(' ')) || [])[1];
  ok('and the shadow colour is NOT identical, because night casts a different light',
    colOf(day) !== colOf(night), 'day ' + colOf(day) + ' / night ' + colOf(night));

  console.log('\n7. MEASURED: the card radius and the page inset');
  ok('the card radius measures 16px on the element, not just in the token', day.tokens['--r-card'] === '16px', day.tokens['--r-card']);
  const cards = day.radii.filter((r) => r.v === '16px');
  ok('and real elements are wearing it', cards.length >= 5, cards.length + ' elements at 16px: ' + cards.slice(0, 5).map((c) => c.sel).join(', '));
  ok('the page inset measures the gutter the token claims', day.inset === day.tokens['--gutter'],
    'inset ' + day.inset + ' vs --gutter ' + day.tokens['--gutter']);
  /* A pill has to actually be a pill. --r-pill went onto .toast and .chip on the argument that their
     30px was already past half their height; if a taller element takes it that argument breaks. */
  const pills = day.radii.filter((r) => parseFloat(r.v) >= 999);
  ok('every element on --r-pill is short enough that a pill is what it looks like',
    pills.length > 0 && pills.every((p) => p.h <= 64), pills.filter((p) => p.h > 64).map((p) => p.sel + ' h=' + p.h));
  ok('and something is actually using --r-pill', pills.length >= 1, pills.length + ' pills');

  console.log('\n8. MEASURED: the print path still erases every shadow');
  /* The elevation tokens nest var(--shadow) inside themselves, and @media print sets
     --shadow:transparent to keep the doctor report from printing grey smears around every card.
     Custom-property substitution is lazy, so this still works, but "still works" is a claim and this
     is the measurement of it. A future level that hard-codes an rgba() instead of taking the colour
     token would print a shadow onto a clinical page and nobody would notice until it was on paper. */
  const shadowOn = await page.evaluate(() => {
    const e = document.querySelector('.tip-static') || document.querySelector('.since-card') || document.querySelector('.set-item');
    return e ? getComputedStyle(e).boxShadow : null;
  });
  ok('a card is casting a real shadow on screen to begin with', !!shadowOn && shadowOn !== 'none' && !/rgba\([^)]*,\s*0\)/.test(shadowOn), shadowOn);
  await page.emulateMediaType('print');
  await sleep(300);
  const shadowPrint = await page.evaluate(() => {
    const e = document.querySelector('.tip-static') || document.querySelector('.since-card') || document.querySelector('.set-item');
    return e ? getComputedStyle(e).boxShadow : null;
  });
  ok('and printing turns that shadow fully transparent, through the new token', /rgba\([^)]*,\s*0\)/.test(String(shadowPrint)), shadowPrint);
  await page.emulateMediaType(null);

  if (REPORT) {
    console.log('\nelevation: ' + elev.map((e) => e.name.replace('--elev-', '') + ' ' + e.y + '/' + e.blur).join(' · '));
    console.log('radius:    ' + radii.map((r) => r.name.replace('--r-', '') + ' ' + r.px).join(' · '));
    const c = {}; brLits.forEach((v) => { c[v] = (c[v] || 0) + 1; });
    console.log('radius literals left (' + brLits.length + '): ' + Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' x' + v).join(', '));
    const sc = {}; spac.forEach((v) => { sc[v] = (sc[v] || 0) + 1; });
    console.log('spacing (' + spac.length + ' values, ' + distinctSp.length + ' distinct): ' +
      distinctSp.map((v) => v + '×' + sc[v]).join(' '));
    const on4 = spac.filter((v) => v % 4 === 0).length;
    console.log('  on a 4px grid: ' + on4 + '/' + spac.length + ' (' + (100 * on4 / spac.length).toFixed(1) + '%). This is not a scale and the stylesheet says so.');
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'SURFACE-TOKEN: FAIL' : 'SURFACE-TOKEN: PASS');
  process.exit(REPORT ? 0 : (fail ? 1 : 0));
})().catch((e) => { console.error(e); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); console.log('SURFACE-TOKEN: FAIL'); process.exit(1); });
