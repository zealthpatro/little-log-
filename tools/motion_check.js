#!/usr/bin/env node
/* MOTION HAS TO BE MEASURED, AND REDUCED MOTION HAS TO BE MEASURED HARDEST.
 *
 * Counted 2026-08-30, before this gate existed: 71 custom properties in app/index.html and NOT ONE
 * of them a duration or an easing. Every transition and animation in a 19,000-line file was a
 * hand-written literal: 20 distinct time values across 64 declarations, with .12 .14 .15 .18 .2 .22
 * all sitting in the same 100ms band and nobody able to say which was which or why. Same shape of
 * decay the type scale had, same fix: name the ROLE, not the number.
 *
 * But the reason this axis matters more here than a type scale does is the second half. Reduced
 * motion was handled by three per-selector `animation:none` rules in the stylesheet and four more
 * injected from JS, and between them they stilled seven things out of the sixty-odd that move. The
 * home photo carousel kept dissolving every 4.5 seconds. The sheet still sprang up off the bottom
 * of the screen. The "leave a note" pill pulsed forever. Someone who turns Reduce Motion on in iOS
 * has usually done it because movement makes her ill or makes her lose her place, and Cubby is
 * opened one-handed at 3am by someone already frightened.
 *
 * So this gate does not check that tokens exist. Existence is worthless: a var(--mo-quik) typo
 * computes to 0s and a stylesheet full of them would still "have tokens". It drives a real browser
 * and reads back the values the browser actually resolved, in both motion modes, and every absence
 * assertion is paired with a presence assertion so it can never pass on an empty page:
 *
 *   - nothing moves under reduce  IS PAIRED WITH  the sheet still arrives, the spinner still spins
 *   - the carousel does not advance under reduce  IS PAIRED WITH  it DOES advance without it
 *
 * The scale itself is read from :root at runtime rather than duplicated in here, for the same
 * reason the type-scale gate does it: a gate that keeps its own copy of the thing it checks is one
 * edit away from asserting a world that no longer exists.
 *
 *   PORT=19633 node tools/serve.js &
 *   node tools/motion_check.js http://localhost:19633
 *   node tools/motion_check.js http://localhost:19633 --self-test   (plant defects, prove it reddens)
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = path.join(__dirname, '..');
const BASE = (process.argv[2] || '').indexOf('http') === 0 ? process.argv[2] : 'http://localhost:8123';
const SELFTEST = process.argv.includes('--self-test');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + (typeof x === 'string' ? x : JSON.stringify(x)) : '')); } };
/* Two units in play and they are easy to confuse into a silent pass: getComputedStyle on a custom
   property hands back the author's own token text ("350ms"), while getComputedStyle on
   transition-duration always normalises to seconds ("0.35s"). One helper that reads both. */
const toMs = (v) => { const s = String(v).trim(); if (!s) return NaN; return Math.round(/ms\s*$/.test(s) ? parseFloat(s) : parseFloat(s) * 1000); };
/* Same trap on the easing side, and it caught this gate out on its first run: the token as authored
   is "cubic-bezier(.2,.9,.3,1)" and the same curve read back off an element is
   "cubic-bezier(0.2, 0.9, 0.3, 1)". Comparing the strings compares typography, not curves, so pull
   the four control points out and compare those. */
const bez = (v) => { const m = String(v).match(/cubic-bezier\(([^)]*)\)/); return m ? m[1].split(',').map((x) => parseFloat(x)).join(',') : String(v).trim(); };

/* Pinned to 13:00 for the same reason every other gate here pins it: initHero deliberately refuses
   to run the carousel between 23:00 and 05:00, so an unpinned clock would make section 3's carousel
   assertions pass at night for entirely the wrong reason. */
const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

/* Three photos, because renderHero only emits .hero-slide nodes when this baby has some and
   initHero only arms the timer when there are at least two. photoSrc will not resolve these ids to
   real bytes, which does not matter: the gate measures the slide elements and the timer, not the
   pictures. */
const seed = {
  babies: [{ id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
  activeBabyId: 'b1', events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [],
  photos: [{ id: 'p1', babyId: 'b1', photoId: 'x1', time: now - 3 * DAY },
    { id: 'p2', babyId: 'b1', photoId: 'x2', time: now - 2 * DAY },
    { id: 'p3', babyId: 'b1', photoId: 'x3', time: now - 1 * DAY }],
  vaccines: {}, pregnancy: null, notes: [],
};

/* The four looping animations. A loop PERIOD is not a transition duration and never was: a spinner
   turning once every 800ms and a sheet arriving in 350ms are not two points on one scale, and
   forcing them onto one would be cargo-culting the idea rather than using it. They stay literals,
   and they are enumerated here so that a NEW one cannot appear without this gate noticing. */
const LOOPS = [800, 1800, 2200, 18000];

/* Probes for the things that are only in the DOM when something is happening: a loader overlay, a
   running-timer banner, the tips ticker, a nudging note pill. Injected off-screen so the gate can
   measure them in both motion modes without having to drive four different flows to reach them. */
const PROBE = '<div id="__moprobe" style="position:fixed;left:-9999px;top:0;">'
  /* .loader-ov is itself position:fixed;inset:0, so left alone it would escape this off-screen
     wrapper and cover the whole viewport, and every later assertion that clicks or measures the
     real app would be measuring a scrim. Pinned to static; that changes nothing about its timing. */
  + '<div class="loader-ov" style="position:static;"><div class="loader-spin"></div></div>'
  + '<div class="active-banner"><span class="pulse"></span></div>'
  + '<div class="ticker"><div class="roll"><b>tip</b></div></div>'
  + '<button class="ds-add pulse">note</button>'
  + '</div>';


(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });

  /* One boot per motion mode. prefers-reduced-motion is a media feature the page reads at parse
     time and initHero reads at run time, so it has to be set BEFORE navigation, not toggled after:
     a page that loaded with motion and then had the feature flipped is not the page an iOS user
     with Reduce Motion on ever sees. */
  const boot = async (reduce, theme) => {
    const page = await browser.newPage();
    page.on('pageerror', () => {});
    await page.emulateMediaFeatures([
      { name: 'prefers-color-scheme', value: theme === 'night' ? 'dark' : 'light' },
      { name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' },
    ]);
    await page.evaluateOnNewDocument((shift) => {
      const R = Date;
      function D(...a) { return a.length === 0 ? new R(R.now() + shift) : new R(...a); }
      D.prototype = R.prototype; D.now = () => R.now() + shift; D.parse = R.parse; D.UTC = R.UTC;
      window.Date = D;
    }, OFFSET);
    await page.setViewport({ width: 390, height: 844 });
    await page.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });
    await page.evaluate((s) => {
      localStorage.setItem('cubby-quick-uid', 'local');
      localStorage.setItem('little-log-v1', JSON.stringify(s));
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
    }, seed);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1400);
    await page.evaluate((p) => { go('home'); document.body.insertAdjacentHTML('beforeend', p); }, PROBE);
    await sleep(400);
    return page;
  };

  /* --self-test plants the exact defects this gate is meant to catch, so that "it passed" is a
     claim somebody has watched fail. Without this the gate is an opinion. */
  const plant = async (page, what) => page.evaluate((w) => {
    const s = document.createElement('style'); s.id = '__plant';
    if (w === 'literal') s.textContent = '.qadd{transition:transform 0.23s!important;}';
    if (w === 'collide') s.textContent = ':root{--mo-quick:200ms!important;}';
    if (w === 'reduce') s.textContent = '@media(prefers-reduced-motion:reduce){.sheet{transition-duration:.36s!important;}}';
    if (w === 'spinner') s.textContent = '@media(prefers-reduced-motion:reduce){.loader-spin{animation:none!important;}}';
    document.head.appendChild(s);
  }, what);

  /* Every element on the page, every comma-separated slot of transition-duration and
     animation-duration, as whole milliseconds. This is the assertion that cannot be faked by a
     stylesheet that merely mentions the tokens. */
  const sweep = (page) => page.evaluate(() => {
    const out = { trans: {}, anim: {}, loops: {}, n: 0 };
    document.querySelectorAll('*').forEach((el) => {
      const c = getComputedStyle(el);
      const round = (v) => Math.round(parseFloat(v) * 1000);
      (c.transitionDuration || '').split(',').forEach((v) => { const n = round(v); if (n > 0) { out.trans[n] = (out.trans[n] || 0) + 1; out.n++; } });
      const its = (c.animationIterationCount || '').split(',');
      (c.animationDuration || '').split(',').forEach((v, i) => {
        const n = round(v); if (!(n > 0)) return;
        const inf = (its[i] || its[0] || '').trim() === 'infinite';
        (inf ? out.loops : out.anim)[n] = ((inf ? out.loops : out.anim)[n] || 0) + 1;
        out.n++;
      });
    });
    return out;
  });

  const styleOf = (page, sel, props) => page.evaluate((s, p) => {
    const el = document.querySelector(s); if (!el) return null;
    const c = getComputedStyle(el); const o = {};
    p.forEach((k) => { o[k] = c[k]; });
    return o;
  }, sel, props);

  // ---------------------------------------------------------------- 1
  console.log('\n1. the scale is a scale, read out of :root by the browser that resolved it');
  const page = await boot(false, 'light');
  const scale = await page.evaluate(() => {
    const c = getComputedStyle(document.documentElement);
    const names = ['--mo-tap', '--mo-quick', '--mo-settle', '--mo-enter', '--mo-cross', '--mo-dissolve', '--mo-stagger'];
    const out = {};
    names.forEach((n) => { const v = c.getPropertyValue(n).trim(); if (v) out[n] = v; });
    out.__ease = { out: c.getPropertyValue('--ease-out').trim(), fade: c.getPropertyValue('--ease-fade').trim() };
    return out;
  });
  const steps = Object.keys(scale).filter((k) => k !== '__stagger' && k !== '__ease' && k !== '--mo-stagger')
    .map((k) => ({ name: k, ms: toMs(scale[k]) }));
  ok('a motion scale is declared in :root', steps.length >= 5, steps);
  /* Every line in this section re-tests steps.length rather than leaning on the one above it.
     `[].every(...)` is true and `new Set([]).size === 0` is true, so against a tree with no scale
     at all these would have printed green under a red headline: a vacuous pass is how a gate
     teaches people to skim past it. */
  ok('every step is a whole millisecond, because 155ms is a value nobody chose',
    steps.length > 0 && steps.every((s) => Number.isInteger(s.ms) && s.ms > 0), steps);
  ok('steps are unique, so two roles cannot silently be the same speed',
    steps.length > 0 && new Set(steps.map((s) => s.ms)).size === steps.length, steps.map((s) => s.name + ':' + s.ms));
  const sorted = [...steps].sort((a, b) => a.ms - b.ms);
  ok('and they ascend', steps.length > 0 && sorted.every((s, i) => i === 0 || s.ms > sorted[i - 1].ms), sorted.map((s) => s.ms));
  /* 100ms is the threshold below which a change reads as instantaneous rather than as motion, and
     above roughly 500ms a one-handed tap starts to feel like the app is thinking. The one value
     allowed past that is the photo dissolve, the only thing here meant to be slow. The steps.length
     guard is load-bearing and not decoration: run against a tree with no scale at all, this line
     threw on sorted[0] and took the other 40 assertions down with it, which is the one failure mode
     a gate may not have. It has to survive the defect it detects and still report the whole page. */
  ok('the fast end is not so fast it flickers, and the working range tops out at half a second',
    steps.length > 0 && sorted[0].ms >= 100 && sorted.filter((s) => s.ms <= 500).length >= 5, sorted.map((s) => s.ms));
  ok('there are exactly two authored curves, not a bezier per surface',
    /^cubic-bezier/.test(scale.__ease.out) && /^cubic-bezier/.test(scale.__ease.fade)
      && scale.__ease.out !== scale.__ease.fade, scale.__ease);

  // ---------------------------------------------------------------- 2
  console.log('\n2. what actually moves on screen is ON the scale, measured');
  const allowed = new Set(steps.map((s) => s.ms).concat([toMs(scale['--mo-stagger'] || '0s')]));
  const s1 = await sweep(page);
  const offTrans = Object.keys(s1.trans).map(Number).filter((v) => !allowed.has(v));
  const offAnim = Object.keys(s1.anim).map(Number).filter((v) => !allowed.has(v));
  ok('the page really is animated, so the two lines below are not passing on a blank slate',
    s1.n > 40, s1.n + ' timed slots measured');
  /* A RATCHET, not a rule, and the reason is worth writing down. The motion scale landed in the same
     pass as the radius and elevation consolidation, and the two rewrite the same declarations: taking
     both meant a twenty-eight-way hand merge of one-line CSS, which is how a stylesheet quietly loses
     a rule. So the tokens and the reduced-motion floor shipped, the sheet, the scrim and the tap
     feedback moved onto them, and the remaining transitions stayed literals under a ceiling that may
     fall and may not rise. Same bargain tools/type_scale_check.js struck with the inline font sizes,
     and the same instruction: lower these when you migrate some, never raise them. */
  const OFF_TRANS = Number(process.env.MOTION_TRANS_CEILING || 22);
  const OFF_ANIM = Number(process.env.MOTION_ANIM_CEILING || 6);
  ok('off-scale transitions have not grown', offTrans.length <= OFF_TRANS,
    offTrans.length + ' off-scale, ceiling ' + OFF_TRANS + ': ' + offTrans.join(', ') + ' (scale: ' + [...allowed].sort((a, b) => a - b).join(', ') + ')');
  ok('off-scale finite animations have not grown', offAnim.length <= OFF_ANIM, offAnim.length + ' off-scale, ceiling ' + OFF_ANIM + ': ' + offAnim.join(', '));
  /* Paired so the ratchet cannot pass on a stylesheet with no motion in it at all. */
  ok('and the scale is genuinely in use, not merely declared',
    Object.keys(s1.trans).map(Number).filter((v) => allowed.has(v)).length > 0,
    'on-scale transition durations: ' + Object.keys(s1.trans).map(Number).filter((v) => allowed.has(v)).join(', '));
  const loops = Object.keys(s1.loops).map(Number).sort((a, b) => a - b);
  /* Absence pair for the carve-out above: the loop periods are allowed to be literals, but only
     these four, so nobody can smuggle a fresh hand-picked duration in by adding `infinite`. */
  ok('the only literals left are the four known loop periods', loops.every((l) => LOOPS.indexOf(l) >= 0), loops);
  ok('and all four are still there', LOOPS.every((l) => loops.indexOf(l) >= 0), loops);

  const sheet = await page.evaluate(async () => {
    openSettings(); await new Promise((r) => setTimeout(r, 500));
    const el = document.getElementById('sheet'); const c = getComputedStyle(el);
    const sc = getComputedStyle(document.getElementById('scrim'));
    return { dur: c.transitionDuration, ease: c.transitionTimingFunction, top: Math.round(el.getBoundingClientRect().top),
      scrimDur: sc.transitionDuration, scrimEase: sc.transitionTimingFunction };
  });
  ok('the sheet arrives on --mo-enter with the house curve, not a hand-typed .36s',
    toMs(sheet.dur) === toMs(scale['--mo-enter']) && bez(sheet.ease) === bez(scale.__ease.out), sheet);
  /* The pair for the line above: both curves are actually in service. A "two curves" check that only
     ever finds one of them in use is checking a declaration, not a design. */
  ok('and the scrim behind it fades on the other curve, so both are really in use',
    toMs(sheet.scrimDur) === toMs(scale['--mo-enter']) && bez(sheet.scrimEase) === bez(scale.__ease.fade), sheet);

  const hero1 = await page.evaluate(async () => {
    closeSheet(); go('home'); await new Promise((r) => setTimeout(r, 600));
    const sl = [...document.querySelectorAll('#scroll .hero-slide')];
    const before = sl.findIndex((s) => s.classList.contains('active'));
    const dur = sl.length ? getComputedStyle(sl[0]).transitionDuration : null;
    const armed = typeof heroTimer !== 'undefined' && heroTimer !== null;
    await new Promise((r) => setTimeout(r, 5200));
    const after = [...document.querySelectorAll('#scroll .hero-slide')].findIndex((s) => s.classList.contains('active'));
    return { n: sl.length, before, after, dur, armed };
  });
  ok('the home carousel exists and is armed with motion on', hero1.n >= 2 && hero1.armed === true, hero1);
  ok('it dissolves on --mo-dissolve', hero1.dur && toMs(hero1.dur) === toMs(scale['--mo-dissolve']), hero1.dur);
  ok('and it really does advance, which is what section 3 has to stop', hero1.after !== hero1.before, hero1);

  const spin1 = await styleOf(page, '#__moprobe .loader-spin', ['animationDuration', 'animationIterationCount']);
  ok('the loader spinner spins with motion on', spin1 && toMs(spin1.animationDuration) === 800 && spin1.animationIterationCount === 'infinite', spin1);

  if (SELFTEST) {
    console.log('\n   [self-test] planting an off-scale literal, then two roles at the same speed');
    await plant(page, 'literal');
    const s = await sweep(page);
    ok('[self-test] an off-scale .23s transition is CAUGHT',
      Object.keys(s.trans).map(Number).some((v) => !allowed.has(v)), Object.keys(s.trans));
    await page.evaluate(() => { const e = document.getElementById('__plant'); if (e) e.remove(); });
    await plant(page, 'collide');
    const collided = await page.evaluate((names) => {
      const c = getComputedStyle(document.documentElement);
      return names.map((n) => c.getPropertyValue(n).trim());
    }, steps.map((x) => x.name));
    const cms = collided.map(toMs);
    ok('[self-test] --mo-quick set equal to --mo-settle is CAUGHT by the uniqueness rule',
      new Set(cms).size !== cms.length, cms);
    await page.evaluate(() => { const e = document.getElementById('__plant'); if (e) e.remove(); });
  }
  await page.close();

  // ---------------------------------------------------------------- 3
  console.log('\n3. Reduce Motion: nothing moves, and the app still works');
  for (const theme of ['light', 'night']) {
    const p = await boot(true, theme);
    const s2 = await sweep(p);
    /* Under reduce everything collapses to 1ms, which Chrome reports as 0.001s and this rounds to
       1. Not 0: transitionend still has to fire for anything closing on that event. */
    const moving = Object.keys(s2.trans).map(Number).concat(Object.keys(s2.anim).map(Number)).filter((v) => v > 1);
    ok('[' + theme + '] nothing on the page transitions or animates for longer than 1ms', moving.length === 0, moving);
    ok('[' + theme + '] and the sweep actually looked at a rendered app', s2.n > 20, s2.n + ' timed slots');

    const spin2 = await styleOf(p, '#__moprobe .loader-spin', ['animationDuration', 'animationIterationCount']);
    ok('[' + theme + '] the loader spinner is the one exception and still turns',
      spin2 && toMs(spin2.animationDuration) === 800 && spin2.animationIterationCount === 'infinite', spin2);
    const pulse2 = await styleOf(p, '#__moprobe .active-banner .pulse', ['animationIterationCount']);
    const note2 = await styleOf(p, '#__moprobe .ds-add', ['animationIterationCount']);
    ok('[' + theme + '] the running-timer dot and the note pill stop looping instead of looping at 1ms',
      pulse2 && pulse2.animationIterationCount === '1' && note2 && note2.animationIterationCount === '1', { pulse2, note2 });
    const roll2 = await styleOf(p, '#__moprobe .ticker .roll', ['animationName', 'transform']);
    ok('[' + theme + '] the tips ticker is stopped at the top, not parked on its last frame',
      roll2 && roll2.animationName === 'none' && (roll2.transform === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(roll2.transform)), roll2);

    const sheet2 = await p.evaluate(async () => {
      openSettings(); await new Promise((r) => setTimeout(r, 400));
      const el = document.getElementById('sheet'); const r = el.getBoundingClientRect();
      return { dur: getComputedStyle(el).transitionDuration, bottom: Math.round(r.bottom), h: Math.round(r.height), vh: window.innerHeight };
    });
    /* The presence half of "nothing moves": the sheet has to be ON SCREEN, not merely still. A
       reduced-motion rule that broke the transform would leave it parked below the fold and every
       absence assertion above would still be green. */
    ok('[' + theme + '] the sheet no longer springs', toMs(sheet2.dur) <= 1, sheet2.dur);
    ok('[' + theme + '] but it has still arrived, on screen and reachable', sheet2.bottom <= sheet2.vh + 2 && sheet2.h > 100, sheet2);

    const hero2 = await p.evaluate(async () => {
      closeSheet(); go('home'); await new Promise((r) => setTimeout(r, 600));
      const sl = [...document.querySelectorAll('#scroll .hero-slide')];
      const before = sl.findIndex((s) => s.classList.contains('active'));
      const armed = typeof heroTimer !== 'undefined' && heroTimer !== null;
      const dur = sl.length ? getComputedStyle(sl[0]).transitionDuration : null;
      await new Promise((r) => setTimeout(r, 5200));
      const after = [...document.querySelectorAll('#scroll .hero-slide')].findIndex((s) => s.classList.contains('active'));
      return { n: sl.length, before, after, armed, dur };
    });
    ok('[' + theme + '] the photos are still there, all three of them', hero2.n === 3, hero2);
    ok('[' + theme + '] initHero never arms the carousel', hero2.armed === false, hero2);
    ok('[' + theme + '] and after five seconds she is still looking at the same photo',
      hero2.after === hero2.before && hero2.after === 0, hero2);

    if (SELFTEST && theme === 'light') {
      console.log('\n   [self-test] restoring the sheet spring and killing the spinner');
      await plant(p, 'reduce');
      const d = await p.evaluate(() => getComputedStyle(document.getElementById('sheet')).transitionDuration);
      ok('[self-test] a sheet that still springs under reduce is CAUGHT', toMs(d) > 1, d);
      await p.evaluate(() => { const e = document.getElementById('__plant'); if (e) e.remove(); });
      await plant(p, 'spinner');
      const sp = await styleOf(p, '#__moprobe .loader-spin', ['animationName']);
      ok('[self-test] a spinner frozen under reduce is CAUGHT', sp && sp.animationName === 'none', sp);
      await p.evaluate(() => { const e = document.getElementById('__plant'); if (e) e.remove(); });
    }
    await p.close();
  }
  await browser.close();

  // ---------------------------------------------------------------- 4
  console.log('\n4. the stylesheet holds absolutely; the rest of the app holds to a ratchet');
  const html = fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');
  const MAIN = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  /* The browser sweep above can only see rules that matched something that was rendered. This is
     the other half: it reads the source, so a literal on a surface no gate happens to visit is
     still caught. The two together are what make the rule absolute inside this stylesheet. */
  const decls = [...MAIN.matchAll(/(?:^|[;{])\s*(?:transition|animation)(?:-duration|-delay)?\s*:\s*([^;}]+)/g)];
  const lits = decls.filter((m) => /(?:^|[\s,:(])\d*\.?\d+m?s\b/.test(m[1]) && !/infinite/.test(m[1]) && !/^\s*(?:1ms|0s)\s*!?/.test(m[1]));
  ok('stylesheet time literals have not grown', lits.length <= Number(process.env.MOTION_CSS_CEILING || 38),
    lits.length + ' left: ' + lits.map((m) => m[1].trim()).join(' | '));
  const tokenUses = [...MAIN.matchAll(/(?:transition|animation)[^;}]*var\(--(?:mo-|ease-)/g)];
  ok('and it really is using the tokens, so the line above is not passing on a stylesheet with no motion in it',
    tokenUses.length >= 15, tokenUses.length + ' declarations reference a motion token');

  /* Inline style="" and the six JS-injected stylesheets cannot be migrated in one pass without a
     visual regression on every surface at once, so they get a RATCHET rather than a rule: 15 is
     today's true count, measured 2026-08-30. Lower it as they migrate. Never raise it to go green. */
  const CEILING = Number(process.env.MOTION_CEILING || 15);
  const RX = /(?:transition|animation)(?:-duration|-delay)?\s*:\s*[^;}"'`]*?(\d*\.?\d+m?s)/g;
  let outside = [];
  const collect = (txt, where) => { let m; RX.lastIndex = 0; while ((m = RX.exec(txt))) outside.push({ v: m[1], where }); };
  collect(html.replace(MAIN, ''), 'index.html outside the main stylesheet');
  fs.readdirSync(path.join(ROOT, 'app')).filter((f) => f.endsWith('.js'))
    .forEach((f) => collect(fs.readFileSync(path.join(ROOT, 'app', f), 'utf8'), 'app/' + f));
  ok('the ratchet holds: time literals outside the stylesheet have not grown', outside.length <= CEILING,
    outside.length + ' literals, ceiling ' + CEILING + '. Lower it when you migrate some; never raise it.');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'MOTION: FAIL' : 'MOTION: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); console.log('\nMOTION: FAIL'); process.exit(1); });
