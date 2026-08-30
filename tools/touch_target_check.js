#!/usr/bin/env node
/* EVERY CONTROL REACHES 44px, BECAUSE THIS APP IS USED ONE-HANDED.
 *
 * Measured 2026-08-30 at 390px, before this gate existed: 85 of 496 rendered controls came in under
 * 44px on an axis and 27 were under the WCAG 2.5.8 AA floor of 24x24. Those are not decorative
 * controls. Twenty-three of them were the symptom picker at 40px tall, and one of those chips reads
 * "Skin or eyes look yellow". The explainer dot was 20x20 on twelve surfaces. The "Show me" button
 * on the one card that explains what any of the logging is for was 185x34, a primary call to action
 * shrunk by an inline override.
 *
 * WHY THIS GATE MEASURES HIT AREAS AND NOT BOXES.
 * A control can clear 44px in two honest ways: by growing its box, or by keeping the size it is
 * drawn at and carrying a transparent ::after that is 44px. The second way is the only one available
 * to a 20px dot beside a heading or a link inside a running sentence, because growing those boxes
 * moves type on every screen. So a gate that reads getBoundingClientRect would fail the correct fix
 * and pass a wrong one. This gate walks outward from each control's centre with
 * document.elementFromPoint and records how far the point keeps resolving to that control. Pseudo-
 * element expansion counts, because that is what a thumb actually hits, and a control that was only
 * made to LOOK bigger, or that has a neighbour sitting on top of it, cannot pass.
 *
 * It also checks the one way the pseudo mechanism goes wrong: an expanded hit area that swallows its
 * neighbour's centre, so she aims at one control and taps another. Every control whose centre does
 * not resolve to itself is looked at and named. A sheet, a scrim or the bottom bar on top of it is
 * the app working. One of the expanded controls on top of it is a bug.
 *
 * The floor is read from --tap-min in :root rather than kept here, so this file can never disagree
 * with the stylesheet about what the floor IS.
 *
 *   PORT=19427 node tools/serve.js &
 *   node tools/touch_target_check.js http://localhost:19427
 *   node tools/touch_target_check.js http://localhost:19427 --report     (print the spread, exit 0)
 *   node tools/touch_target_check.js http://localhost:19427 --self-test  (plant defects, prove red)
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = path.join(__dirname, '..');
const BASE = (process.argv[2] || '').startsWith('http') ? process.argv[2] : 'http://localhost:8123';
const REPORT = process.argv.includes('--report');
const SELFTEST = process.argv.includes('--self-test');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + (typeof x === 'string' ? x : JSON.stringify(x)) : '')); } };

/* Pinned clock, same shape as tools/quality_check.js: an app whose copy changes with the hour cannot
   be measured against a moving one. 13:00 keeps every surface in its daytime wording. */
const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

const seed = () => ({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
  activeBabyId: 'b1', events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: {} },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
});

/* ---- the floor, read from the stylesheet ---- */
const html = fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');
const declared = /(--tap-min):\s*([0-9]+)px/.exec(html);
const TAP = declared ? parseInt(declared[2], 10) : 0;
/* Deleting the token must not switch the measurement off. If the scale is gone the token assertions
   go red AND the sweep still measures against 44, so a revert reports the real damage instead of a
   quiet zero. This is the difference between a gate and a gesture. */
const FLOOR = TAP || 44;
/* WCAG 2.5.8 AA is 24x24; 44 is the Apple/WCAG-AAA figure and the one this app holds itself to.
   AA is checked separately so a regression that takes a control from 44 to 30 reads differently
   from one that takes it to 18. */
const AA = 24;

/* ---- the measurement, run inside the page ---- */
/* Everything below runs in the browser. It is a string-built function so the whole probe crosses
   the bridge once per surface rather than once per control: 500 controls x 4 walks x a round trip
   is minutes, and inside the page it is milliseconds. */
const PROBE = () => {
  const SEL = 'button,a,input,select,textarea,[onclick],[role="button"],[tabindex]';
  const LIMIT = 60;                       // walking past 60px tells us nothing we need
  const out = [];
  const seenEl = new Set();
  document.querySelectorAll(SEL).forEach((el) => {
    if (seenEl.has(el)) return;
    seenEl.add(el);
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return;
    if (cs.pointerEvents === 'none') return;
    /* A control whose centre is off screen cannot be probed at all: elementFromPoint returns null
       outside the viewport, so there is nothing to measure. It is skipped here and picked up at the
       other scroll depth, which is why every tab is swept at the top and at the bottom. */
    const vw = window.innerWidth, vh = window.innerHeight;
    const cx = Math.round((r.left + r.right) / 2), cy = Math.round((r.top + r.bottom) / 2);
    if (cx < 0 || cy < 0 || cx >= vw || cy >= vh) return;
    /* App chrome, meaning the layers that are SUPPOSED to be on top: an open sheet and its scrim, the
       bottom bar, the top bar, the quick-add button, a toast. */
    const OVERLAY = '#sheet,.sheet,.scrim,#reportOv,.picker-ov,.ov,.nav,.qadd,.toast,.topbar';
    const isChrome = (t) => !!(t && t.closest && t.closest(OVERLAY))
      || (() => { for (let n = t; n && n !== document.body; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') return true; } return false; })();
    /* Three answers, not two. true = the point belongs to this control. null = we ran out of screen.
       'chrome' = a bar or a sheet is on top of it, which truncates what she can reach right now but
       says nothing about how big the control is; that axis is judged on its drawn box instead. */
    const owns = (x, y) => {
      if (x < 0 || y < 0 || x >= vw || y >= vh) return null;
      const t = document.elementFromPoint(x, y);
      if (t && (t === el || el.contains(t))) return true;
      /* An ANCESTOR showing through is the ordinary edge of a control: the sheet body around a chip
         is where the chip stops. Only a layer that is genuinely over the top counts as chrome, so a
         control shrunk inside an open sheet is still measured and still fails. Without this the
         sheet would excuse every control in it. */
      if (t && t.contains(el)) return false;
      return isChrome(t) ? 'chrome' : false;
    };
    const centre = owns(cx, cy);
    /* When the centre is not owned, WHAT is sitting on it decides whether this is a finding. A sheet
       or its scrim covering the page behind it is the app working correctly, and those controls
       simply cannot be probed while it is open. A neighbouring control's expanded hit area sitting
       on this one is the failure the expansion mechanism can cause, so the occluder is recorded by
       name and judged rather than counted. */
    let occluder = null;
    if (centre !== true) {
      const t = document.elementFromPoint(cx, cy);
      if (t) {
        const oc = (typeof t.className === 'string' ? t.className : '').split(' ').filter(Boolean);
        /* Same surface or not. An expander only STEALS from a control she can currently reach: both
           have to be standing in the same layer. A teach dot inside an open sheet landing on a row
           on the page behind it is not a theft, it is a sheet doing its job, and the row is not
           tappable at all while it is open. Comparing the nearest overlay ancestor of each keeps the
           finding for two controls sharing one surface, which is the case that actually hurts. */
        const surfOf = (n) => (n && n.closest ? n.closest(OVERLAY) : null);
        occluder = { cls: oc[0] || t.tagName.toLowerCase(), id: t.id || '', chrome: centre === 'chrome',
          sameSurface: surfOf(el) === surfOf(t) };
      }
    }
    /* A walk that stops because it reached the edge of the screen has not found the edge of the
       target; the screen is the limit there, and the OS gives edge slop of its own. Those axes are
       recorded as edge-limited and excluded from the verdict rather than counted as a failure we
       could not fix. */
    const walk = (dx, dy) => {
      let n = 0;
      for (; n < LIMIT; n++) {
        const o = owns(cx + dx * (n + 1), cy + dy * (n + 1));
        if (o === null) return { n, edge: true, chrome: false };
        if (o === 'chrome') return { n, edge: false, chrome: true };
        if (o !== true) return { n, edge: false, chrome: false };
      }
      return { n, edge: false, chrome: false };
    };
    const L = walk(-1, 0), R = walk(1, 0), U = walk(0, -1), D = walk(0, 1);
    /* The DESIGNED target: the element's box unioned with any absolutely positioned ::before/::after
       it carries, read straight from CSS geometry. This is only ever used as the fallback for an
       axis a bar was sitting on, where elementFromPoint can measure what she can reach today but not
       how big the control is. Reading it from CSS rather than from the drawn box is the whole point:
       the dot is drawn at 20 and designed at 44, and a fallback to the drawn box would fail the
       correct fix. */
    let dx1 = r.left, dy1 = r.top, dx2 = r.right, dy2 = r.bottom;
    ['::before', '::after'].forEach((p) => {
      const ps = getComputedStyle(el, p);
      if (!ps || ps.content === 'none' || ps.position !== 'absolute' || ps.pointerEvents === 'none') return;
      const w = parseFloat(ps.width), h = parseFloat(ps.height);
      if (!(w > 0 && h > 0)) return;
      const mx = (r.left + r.right) / 2, my = (r.top + r.bottom) / 2;
      dx1 = Math.min(dx1, mx - w / 2); dx2 = Math.max(dx2, mx + w / 2);
      dy1 = Math.min(dy1, my - h / 2); dy2 = Math.max(dy2, my + h / 2);
    });
    const cls = (typeof el.className === 'string' ? el.className : '').split(' ').filter(Boolean)[0] || el.tagName.toLowerCase();
    out.push({
      cls, occluder,
      centreOwned: centre === true,
      hitW: L.n + R.n + 1, hitH: U.n + D.n + 1,
      edgeW: L.edge || R.edge, edgeH: U.edge || D.edge,
      chromeW: L.chrome || R.chrome, chromeH: U.chrome || D.chrome,
      boxW: +r.width.toFixed(1), boxH: +r.height.toFixed(1),
      designW: +(dx2 - dx1).toFixed(1), designH: +(dy2 - dy1).toFixed(1),
      txt: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30),
    });
  });
  return { controls: out, tapMin: getComputedStyle(document.documentElement).getPropertyValue('--tap-min').trim() };
};

/* A control fails on an axis that is short and was not cut off by something outside its control:
   the edge of the screen, or a bar or sheet painting over content that is scrolled underneath it.
   Chrome-truncated axes are not waved through, they are handed to designClears() below, which holds
   them to the size the control was BUILT to. A bar can hide part of a target. It cannot excuse a
   target that was never 44px in the first place. */
const short = (c, floor) => (c.hitW < floor && !c.edgeW && !c.chromeW) || (c.hitH < floor && !c.edgeH && !c.chromeH);
const chromeCut = (c) => c.chromeW || c.chromeH;
const designClears = (c, floor) => (!c.chromeW || c.designW >= floor) && (!c.chromeH || c.designH >= floor);
/* The classes whose hit area this design system expands with a transparent ::after. If one of these
   turns up as the thing sitting on another control's centre, the expansion has gone too far and she
   would aim at one control and tap another. That is the only way the mechanism fails, so it is named
   here rather than inferred. */
const EXPANDERS = ['lg-i', 'link-inline', 'wwa-t', 'sec-act', 'gr-more', 'tip-x', 'ds-arrow', 'gs-x'];

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
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
    await page.evaluate(() => localStorage.setItem('cubby-quick-uid', 'local'));
    await page.evaluate((x) => {
      localStorage.setItem('little-log-v1', JSON.stringify(x));
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
    }, seed());
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1800);
  };

  /* The surfaces. Four tabs, then the sheets opened by name the way tools/quality_check.js does,
     then Home again with Get started dismissed, because the one card carrying the "Show me" CTA
     only renders once the checklist is out of the way. */
  const sweep = async (theme) => {
    const found = [];
    const take = async (where) => {
      const r = await page.evaluate(PROBE);
      r.controls.forEach((c) => found.push(Object.assign({ surface: where, theme }, c)));
      return r.tapMin;
    };
    let computedTap = '';
    for (const tab of ['home', 'log', 'album', 'health']) {
      await page.evaluate((s) => { try { go(s); } catch (e) {} }, tab);
      await sleep(900);
      computedTap = await take(tab) || computedTap;
      /* One scroll depth per tab: half the controls on Home start below the fold. */
      await page.evaluate(() => { const s = document.getElementById('scroll'); if (s) s.scrollTop = s.scrollHeight; });
      await sleep(500);
      await take(tab + ':bottom');
      await page.evaluate(() => { const s = document.getElementById('scroll'); if (s) s.scrollTop = 0; });
      await sleep(300);
    }
    for (const op of ['openSymptom', 'openActivity', 'openSettings', 'openFeed', 'openDiaper', 'openGrowth', 'openFamily']) {
      const opened = await page.evaluate((o) => { try { if (!window[o]) return false; window[o](); return true; } catch (e) { return false; } }, op);
      await sleep(800);
      if (opened) await take(op);
      await page.evaluate(() => { try { closeSheet(); } catch (e) {} });
      await sleep(400);
    }
    await page.evaluate(() => { try { go('home'); dismissTip('getstarted'); } catch (e) {} });
    await sleep(900);
    await take('home:guide');
    return { found, computedTap };
  };

  await boot('light');
  const light = await sweep('light');
  await boot('dark');
  const dark = await sweep('dark');
  const raw = light.found.concat(dark.found);
  /* A control under an open sheet, its scrim, or a fixed bar cannot be probed: elementFromPoint
     returns the thing on top, which is the app behaving correctly. Those are set aside and judged in
     section 4 by WHAT is on top of them, not counted as small. Everything else is measurable and is
     held to the floor. */
  const all = raw.filter((c) => c.centreOwned);
  const occluded = raw.filter((c) => !c.centreOwned);

  /* The theft line can only ever report an ABSENCE, so a green one is indistinguishable from a
     filter that stopped matching. This stages a real theft and makes the same predicate find it: a
     dot is dropped exactly on the centre of a reachable control with no sheet open, so victim and
     dot share the page and sameSurface is true. If this comes back empty the detector is broken, not
     the app, and the line below it is worthless. */
  await boot('light');
  await page.evaluate(() => { try { go('health'); } catch (e) {} });
  await sleep(900);
  const bait = await page.evaluate(() => {
    const v = Array.prototype.slice.call(document.querySelectorAll('.add-row,.btn-ghost,.btn-primary'))
      .find((e) => { const r = e.getBoundingClientRect(); return r.width > 60 && r.height > 20 && r.top > 90 && r.bottom < 700; });
    if (!v) return '';
    const r = v.getBoundingClientRect();
    const d = document.createElement('span');
    d.className = 'lg-i'; d.textContent = 'i';
    d.style.cssText = 'position:fixed;z-index:9;width:20px;height:20px;left:' +
      (r.left + r.width / 2 - 10) + 'px;top:' + (r.top + r.height / 2 - 10) + 'px;';
    document.body.appendChild(d);
    return (v.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30);
  });
  const baited = bait ? (await page.evaluate(PROBE)).controls : [];
  const caught = baited.filter((c) => !c.centreOwned && c.occluder && c.occluder.sameSurface
    && EXPANDERS.indexOf(c.occluder.cls) >= 0);

  console.log('\n1. the floor is declared once, and the browser agrees with the file');
  ok('--tap-min is declared in :root', TAP > 0, declared ? declared[0] : 'not found');
  ok('and it is the 44px a thumb needs', TAP === 44, TAP + 'px');
  /* Measured, not merely present: the token could be declared and then shadowed, or declared inside
     a media block that does not apply. This is what the running page resolves it to. */
  ok('the running page resolves it to the same value, so nothing shadows it',
    light.computedTap === TAP + 'px' && dark.computedTap === TAP + 'px',
    { light: light.computedTap, dark: dark.computedTap });

  console.log('\n2. the sweep actually saw the app (a clean run on an empty page is not a pass)');
  ok('enough controls were measured to mean anything', all.length >= 400,
    all.length + ' probed, ' + occluded.length + ' set aside as covered');
  ok('both themes contributed', light.found.length > 300 && dark.found.length > 300,
    { light: light.found.length, dark: dark.found.length });
  ok('the page threw nothing while we drove it', errs.length === 0, errs.slice(0, 3));
  const count = (c) => all.filter((a) => a.cls === c).length;
  /* Named because each was a measured failure before this gate. If a refactor deletes or renames one
     of them, the absence assertion below would go green for the wrong reason; this is the pairing. */
  ok('the symptom and food chips were on screen', count('chip') >= 20, count('chip') + ' .chip');
  ok('the explainer dot was on screen', count('lg-i') >= 12, count('lg-i') + ' .lg-i');
  ok('the inline links were on screen', count('link-inline') >= 4, count('link-inline') + ' .link-inline');
  ok('the vaccine setup answers were on screen', count('vs-btn') >= 10, count('vs-btn') + ' .vs-btn');

  console.log('\n3. every measured hit area clears the floor');
  const failures = all.filter((c) => short(c, FLOOR));
  const aaFailures = all.filter((c) => short(c, AA));
  const byCls = {};
  failures.forEach((f) => {
    byCls[f.cls] = byCls[f.cls] || { n: 0, ex: [] };
    byCls[f.cls].n++;
    if (byCls[f.cls].ex.length < 2) byCls[f.cls].ex.push('hit ' + f.hitW + 'x' + f.hitH + ' box ' + f.boxW + 'x' + f.boxH + ' "' + f.txt + '" (' + f.theme + '/' + f.surface + ')');
  });
  const summary = Object.entries(byCls).sort((a, b) => b[1].n - a[1].n)
    .map(([k, v]) => v.n + ' x .' + k + ': ' + v.ex.join(' | ')).join('\n         ');
  /* A ceiling rather than a bare rule, for the same reason the type scale has one: surfaces this
     harness cannot reach will surface controls it has never measured, and a gate that fails on its
     first honest discovery gets deleted instead of fixed. It measured 0 on 2026-08-30. Lower it if
     it ever needs lowering; never raise it to make a run go green. */
  const CEILING = Number(process.env.TAP_CEILING || 0);
  ok('nothing is under ' + FLOOR + 'px on an axis', failures.length <= CEILING,
    failures.length + ' short of ' + FLOOR + 'px, ceiling ' + CEILING + '\n         ' + summary);
  ok('and nothing is under the WCAG 2.5.8 AA floor of ' + AA + 'x' + AA, aaFailures.length === 0,
    aaFailures.length + ' under AA');
  /* The pairing for the chrome exclusion above. Scrolled content going under the top bar is normal,
     so those axes are judged on the drawn box; this is the assertion that makes that safe. */
  const cut = all.filter(chromeCut);
  ok('a control that a bar was sitting on was still BUILT to ' + FLOOR + 'px', cut.every((c) => designClears(c, FLOOR)),
    cut.filter((c) => !designClears(c, FLOOR)).slice(0, 4).map((c) => '.' + c.cls + ' designed ' + c.designW + 'x' + c.designH + ' "' + c.txt + '"'));
  ok('and some control really was cut by a bar, so that line is not passing on an empty set',
    cut.length > 0, cut.length + ' chrome-truncated axes');

  console.log('\n4. the fix is a hit area, not a redesign, and it does not steal from its neighbour');
  /* The point of the pseudo-element mechanism is that the DOT STAYS 20px. If a later change grows
     the box instead, the picture has changed and somebody should have to say so out loud. */
  const dots = all.filter((a) => a.cls === 'lg-i');
  ok('the explainer dot is still drawn at 20px', dots.length > 0 && dots.every((d) => d.boxW <= 22 && d.boxH <= 22),
    dots.slice(0, 2).map((d) => d.boxW + 'x' + d.boxH));
  ok('and its measured hit area is 44 anyway, which is the whole trick',
    dots.length > 0 && dots.every((d) => d.hitW >= FLOOR && d.hitH >= FLOOR),
    dots.slice(0, 2).map((d) => d.hitW + 'x' + d.hitH));
  const inline = all.filter((a) => a.cls === 'link-inline');
  ok('an inline link keeps its 16px line box', inline.length > 0 && inline.every((d) => d.boxH <= 22), inline.slice(0, 2).map((d) => d.boxW + 'x' + d.boxH));
  ok('and reaches ' + FLOOR + ' in the hand', inline.length > 0 && inline.every((d) => d.hitH >= FLOOR), inline.slice(0, 2).map((d) => d.hitW + 'x' + d.hitH));
  /* The one failure mode this mechanism has. An expanded hit area sitting on a neighbour's centre
     means she aims at one control and taps another, which at 3am is worse than a small target. */
  const stolen = occluded.filter((c) => c.occluder && c.occluder.sameSurface && EXPANDERS.indexOf(c.occluder.cls) >= 0);
  ok('no expanded hit area has taken a neighbour\'s centre', stolen.length === 0,
    stolen.slice(0, 4).map((s) => '.' + s.occluder.cls + ' is sitting on .' + s.cls + ' "' + s.txt + '" (' + s.theme + '/' + s.surface + ')'));
  /* Paired with the line above so it cannot pass on an empty set: every control that WAS covered was
     covered by a sheet, a scrim or a fixed bar, which is the app working. If something else turns up
     here it is a new kind of occlusion and somebody should look at it. */
  ok('and something WAS covered, so the line above is not passing on an empty set',
    occluded.length > 20, occluded.length + ' controls were under a sheet, the bar or the scrim');
  /* Paired the other way round: the line above has to be capable of going red at all. */
  ok('and a STAGED theft on the same surface is still caught, so that line can go red',
    bait !== '' && caught.length > 0,
    bait === '' ? 'no bait control found' : 'baited "' + bait + '", caught ' + caught.length);
  /* The false positive this replaced. A dot inside an open sheet landing on a row on the page behind
     it is the sheet working, and that row is not tappable at all while it is open. */
  ok('and a dot inside a sheet is not blamed for the page behind it',
    occluded.some((c) => c.occluder && EXPANDERS.indexOf(c.occluder.cls) >= 0 && !c.occluder.sameSurface),
    'no cross-surface pair seen, so this exclusion is untested');
  const oddOcclusion = occluded.filter((c) => !c.occluder || !c.occluder.chrome);
  ok('and everything that was covered was covered by app chrome, not by another control',
    oddOcclusion.length === 0,
    oddOcclusion.slice(0, 5).map((s) => '.' + s.cls + ' "' + s.txt + '" under .' + (s.occluder ? s.occluder.cls : 'nothing') + ' (' + s.theme + '/' + s.surface + ')'));
  const cta = all.filter((a) => /^Show me$/.test(a.txt) && a.cls === 'btn-primary');
  ok('the "Show me" CTA on the guide card is a full-size primary button again',
    cta.length > 0 && cta.every((c) => c.hitH >= FLOOR && c.boxH >= FLOOR), cta.map((c) => c.boxW + 'x' + c.boxH));

  if (REPORT) {
    const edge = all.filter((c) => c.edgeW || c.edgeH).length;
    console.log('\nmeasurements: ' + all.length + '   short: ' + failures.length + '   edge-limited (excluded): ' + edge);
    const spread = {};
    all.forEach((a) => { const k = Math.min(a.hitW, a.hitH); spread[k] = (spread[k] || 0) + 1; });
    console.log('smallest measured hit axis: ' + Math.min(...all.map((a) => Math.min(a.hitW, a.hitH))) + 'px');
    Object.entries(spread).map(([k, v]) => [+k, v]).sort((a, b) => a[0] - b[0]).slice(0, 12)
      .forEach(([k, v]) => console.log('  ' + String(k).padStart(3) + 'px  ' + v));
  }

  if (SELFTEST) {
    /* A GATE NOBODY WATCHED FAIL IS NOT EVIDENCE. Three planted defects, each aimed at a different
       way this measurement could be lying, run against the real page. */
    console.log('\n5. SELF-TEST: the measurement goes red on planted defects');
    await page.evaluate(() => { try { go('log'); openSymptom(); } catch (e) {} });
    await sleep(900);
    const plant = async (css) => {
      await page.evaluate((c) => {
        const s = document.createElement('style'); s.id = 'plant'; s.textContent = c;
        document.head.appendChild(s);
      }, css);
      await sleep(300);
      const r = await page.evaluate(PROBE);
      await page.evaluate(() => { const s = document.getElementById('plant'); if (s) s.remove(); });
      await sleep(200);
      return r.controls;
    };
    const clean = (await page.evaluate(PROBE)).controls;
    ok('the untouched sheet measures clean, so the planted runs mean something',
      clean.filter((c) => short(c, FLOOR)).length === 0, clean.filter((c) => short(c, FLOOR)).slice(0, 3));

    // (a) a genuinely shrunken control
    const a = await plant('.chip{min-height:0!important;padding:2px 15px!important;}');
    ok('a 22px chip is caught', a.filter((c) => c.cls === 'chip' && short(c, FLOOR)).length >= 10,
      a.filter((c) => c.cls === 'chip').slice(0, 2).map((c) => c.hitW + 'x' + c.hitH));

    // (b) a VISUAL-ONLY fix: the box says 44, an overlay means the thumb never reaches it
    const b = await plant('.chip{position:relative;} .chip::before{content:"";position:absolute;inset:-2px;background:transparent;z-index:5;} .chip-row::after{content:"";position:absolute;inset:0;z-index:99;} .chip-row{position:relative;}');
    ok('a control that only LOOKS 44 because something sits on top of it is caught',
      b.filter((c) => c.cls === 'chip' && !c.centreOwned).length >= 10,
      b.filter((c) => c.cls === 'chip').slice(0, 2).map((c) => ({ centre: c.centreOwned, box: c.boxW + 'x' + c.boxH })));

    // (c) the false-positive check: a comfortably large control must NOT be flagged
    const c = await plant('.chip{min-height:70px!important;}');
    ok('a 70px chip is NOT flagged, so the measurement is not just failing everything',
      c.filter((x) => x.cls === 'chip').length > 0 && c.filter((x) => x.cls === 'chip' && short(x, FLOOR)).length === 0,
      c.filter((x) => x.cls === 'chip').slice(0, 2).map((x) => x.hitW + 'x' + x.hitH));
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'TOUCH-TARGET: FAIL' : 'TOUCH-TARGET: PASS');
  process.exit(REPORT && !fail ? 0 : (fail ? 1 : 0));
})().catch((e) => { console.error(e); console.log('\nTOUCH-TARGET: FAIL'); process.exit(1); });
