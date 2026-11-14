#!/usr/bin/env node
/* NO SCREEN SCROLLS SIDEWAYS AT 320px, IN LIGHT OR IN NIGHT.
 *
 * What was wrong for a real parent. In Night at 320px the home screen moved about 80px sideways
 * under her thumb. The only Night-only decoration in the app, the warm wash behind the header
 * (.topbar::before), is 150% of the header wide and centred with translateX(-50%), so at 320px it
 * spans -80px to 400px. Nothing clipped it, the document grew to 400px wide, and a sideways swipe
 * slid the whole app off the edge. In Light the wash does not exist, so Light never showed it.
 *
 * The fix clips the wash to the header's own width (overflow-x: clip on .topbar). The wash still
 * spills down behind the header, and #scroll is not touched: hiding overflow there would hide a
 * real overflow instead of fixing it, and this gate measures #scroll separately for exactly that.
 *
 * What this gate does, on a pinned day and hour:
 *   1. every tab at 320px, Light and Night: baby Home, Log, Album, Health (and its Medicine,
 *      Vaccines and Illness tabs), pregnancy Home, Moments, Care, and the planning screen; Home
 *      again at 03:12, where the night layout reorders it, and Home at 390px, the commonest phone,
 *      which the wash overran by 97px. For each, the document must not be
 *      wider than the screen, and neither may #scroll.
 *   2. the same matcher is shown an overflow on purpose, in #scroll and outside it, and must find
 *      both. A matcher that can only ever say "nothing sideways" proves nothing.
 *   3. the fix itself is undone in the live page (the header unclipped) in Night, and the matcher
 *      must find the 80px again. So the clip is what holds it, not luck. The fallback for WebKit
 *      without overflow clip (before Safari 16) is applied by hand to an unclipped header and must
 *      keep the page to the screen's width as well.
 *   4. the wash is still there in Night and still spills below the header (overflow-y visible),
 *      so the fix did not simply delete the one piece of Night atmosphere.
 *
 *   node tools/sideways_scroll_check.js http://127.0.0.1:<port>
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const dl = require('./gate_downloads');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2];
if (!BASE) { console.error('usage: node tools/sideways_scroll_check.js http://127.0.0.1:<port>'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, HOUR = 3600000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

/* The DAY is pinned as well as the hour: two gates here flaked on month boundaries. */
const at = (h, m) => new Date(2026, 9, 14, h, m, 0, 0).getTime();   // Wed 14 Oct 2026

const babyState = (now) => ({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
  activeBabyId: 'b1',
  events: [
    { id: 'f1', type: 'feed', babyId: 'b1', method: 'bottle', amount: 120, unit: 'ml', time: now - 2 * HOUR, authorId: 'local' },
    { id: 's1', type: 'sleep', babyId: 'b1', start: now - 5 * HOUR, end: now - 3 * HOUR, time: now - 5 * HOUR, authorId: 'local' },
    { id: 'n1', type: 'diaper', babyId: 'b1', kind: 'wet', time: now - 1 * HOUR, authorId: 'local' },
  ],
  illnesses: [], settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C' },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
});
const preg = (now, stage) => ({
  id: 'p1', ownerUid: 'local', stage: stage || 'expecting',
  dueDate: now + 16 * 7 * DAY, lmp: now - 24 * 7 * DAY, cycleLen: 28, periods: [],
  country: 'us', precon: [], careTeam: [{ id: 'c1', name: 'Midwife team', phone: '+44 20 7946 0000' }],
  appts: [], symptoms: [], weights: [], bp: [], kicks: [], contractions: [], birthPlan: '', bag: [],
  moments: [], conditions: {}, glucose: [], urine: [], supplements: [], supplementLog: [], nausea: [],
  glucoseUnit: 'mmol', bornBabyId: null, createdAt: now - 24 * 7 * DAY,
});
const pregState = (now, stage) => Object.assign(babyState(now), { babies: [], activeBabyId: null, events: [], pregnancy: preg(now, stage) });

/* Read straight off the laid-out page. */
const MEASURE = () => {
  const de = document.documentElement, sc = document.getElementById('scroll');
  return {
    theme: de.getAttribute('data-theme'),
    docW: de.scrollWidth, docCW: de.clientWidth,
    scW: sc ? sc.scrollWidth : null, scCW: sc ? sc.clientWidth : null,
    hasScroll: !!sc, hasTopbar: !!document.querySelector('.topbar'),
  };
};
const sideways = (m) => ({ doc: m.docW > m.docCW, scroll: m.hasScroll && m.scW > m.scCW });

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', downloadBehavior: dl.downloadBehavior(), args: ['--no-sandbox', '--disable-gpu'] });
  const errs = [];

  const open = async (clock, theme, state, width) => {
    const ctx = await browser.createBrowserContext({ downloadBehavior: dl.downloadBehavior() });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(e.message));
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await page.evaluateOnNewDocument((shift) => {
      const R = Date;
      function D(...a) { return a.length === 0 ? new R(R.now() + shift) : new R(...a); }
      D.prototype = R.prototype; D.now = () => R.now() + shift; D.parse = R.parse; D.UTC = R.UTC;
      window.Date = D;
    }, clock - Date.now());
    /* Before boot, so the very first paint is already in the theme under test. */
    await page.evaluateOnNewDocument((s, theme) => {
      try {
        localStorage.setItem('cubby-quick-uid', 'local');
        localStorage.setItem('little-log-v1', JSON.stringify(s));
        localStorage.setItem('cubby-seen-local', JSON.stringify({ home: 1, log: 1, album: 1, health: 1, welcome: 1 }));
        localStorage.setItem('cubby-theme:local', theme);
      } catch (e) {}
    }, state, theme);
    await page.setViewport({ width: width || 320, height: 640 });
    await page.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });
    await sleep(900);
    return page;
  };
  const visit = async (page, js) => { if (js) { await page.evaluate(js); await sleep(500); } return page.evaluate(MEASURE); };

  const BABY_TABS = [
    ['Home', "go('home')"], ['Log', "go('log')"], ['Album', "go('album')"], ['Health', "go('health')"],
    ['Health / Medicine', "go('health');setHealthTab('meds')"], ['Health / Vaccines', "go('health');setHealthTab('vaccines')"],
    ['Health / Illness', "go('health');setHealthTab('illness')"],
  ];
  const PREG_TABS = [['pregnancy Home', "pregGo('week')"], ['pregnancy Moments', "pregGo('moments')"], ['pregnancy Care', "pregGo('care')"]];

  for (const theme of ['light', 'night']) {
    console.log('\n1. every tab at 320px in ' + (theme === 'night' ? 'Night' : 'Light'));
    const day = at(13, 0);
    const b = await open(day, theme, babyState(day));
    ok('(the app really painted in ' + theme + ')', (await b.evaluate(() => document.documentElement.getAttribute('data-theme'))) === theme);
    for (const [name, js] of BABY_TABS) {
      const m = await visit(b, js);
      const s = sideways(m);
      ok(name + ': the page is no wider than the screen', m.hasTopbar && !s.doc, m);
      ok(name + ': #scroll is no wider than itself', m.hasScroll && !s.scroll, m);
    }
    await b.browserContext().close();

    const night = at(3, 12);
    const n = await open(night, theme, babyState(night));
    const mn = await visit(n, "go('home')");
    ok('Home at 03:12 (the night layout): no sideways scroll', mn.hasTopbar && !sideways(mn).doc && !sideways(mn).scroll, mn);
    await n.browserContext().close();

    // The wash is 150% of ANY phone's width, so the commonest phone is checked too, not only the smallest.
    const w390 = await open(day, theme, babyState(day), 390);
    const m390 = await visit(w390, "go('home')");
    ok('Home at 390px: no sideways scroll either', m390.hasTopbar && m390.docCW === 390 && !sideways(m390).doc && !sideways(m390).scroll, m390);
    await w390.browserContext().close();

    const p = await open(day, theme, pregState(day));
    for (const [name, js] of PREG_TABS) {
      const m = await visit(p, js);
      const s = sideways(m);
      ok(name + ': the page is no wider than the screen', m.hasTopbar && !s.doc, m);
      ok(name + ': #scroll is no wider than itself', m.hasScroll && !s.scroll, m);
    }
    await p.browserContext().close();

    const pl = await open(day, theme, pregState(day, 'planning'));
    const mp = await visit(pl);
    ok('planning screen: no sideways scroll', mp.hasTopbar && !sideways(mp).doc && !sideways(mp).scroll, mp);
    await pl.browserContext().close();
  }

  console.log('\n2. the matcher finds an overflow when there is one');
  {
    const day = at(13, 0);
    const pg = await open(day, 'light', babyState(day));
    await pg.evaluate("go('home')");
    const inScroll = await pg.evaluate((src) => {
      const x = document.createElement('div'); x.id = 'sw-stage'; x.style.cssText = 'width:420px;height:10px';
      document.getElementById('scroll').appendChild(x);
      const m = (0, eval)('(' + src + ')')(); x.remove(); return m;
    }, MEASURE.toString());
    ok('a 420px block inside #scroll is found as a #scroll overflow', sideways(inScroll).scroll, inScroll);
    const outside = await pg.evaluate((src) => {
      const x = document.createElement('div'); x.style.cssText = 'position:absolute;left:300px;top:0;width:100px;height:4px';
      document.getElementById('app').appendChild(x);
      const m = (0, eval)('(' + src + ')')(); x.remove(); return m;
    }, MEASURE.toString());
    ok('a block poking 80px past the right edge, outside #scroll, is found as a page overflow', sideways(outside).doc, outside);
    await pg.browserContext().close();
  }

  console.log('\n3. undo the clip in Night, and the 80px comes back');
  {
    const day = at(13, 0);
    const pg = await open(day, 'night', babyState(day));
    await pg.evaluate("go('home')");
    const unclipped = await pg.evaluate((src) => {
      const tb = document.querySelector('.topbar'); tb.style.overflowX = 'visible';
      const m = (0, eval)('(' + src + ')')(); tb.style.overflowX = ''; return m;
    }, MEASURE.toString());
    ok('with the header unclipped the page is wider than the screen again', sideways(unclipped).doc && unclipped.docW - unclipped.docCW >= 60, unclipped);
    const clipped = await pg.evaluate(MEASURE);
    ok('and with the clip back it is not', !sideways(clipped).doc, clipped);
    /* WebKit before Safari 16 has no overflow clip, so the page carries a fallback for it: an
       @supports not (overflow-x:clip) block that narrows the wash to the header. This Chrome supports
       clip, so the block is found in the stylesheet and its own declarations are applied by hand to an
       unclipped header, which is exactly what such a phone would draw. */
    const fallback = await pg.evaluate((src) => {
      let rule = null;
      for (const sh of document.styleSheets) {
        let rules; try { rules = sh.cssRules; } catch (e) { continue; }
        for (const r of rules) {
          if (r.conditionText && /not\s*\(\s*overflow-x\s*:\s*clip\s*\)/.test(r.conditionText)) {
            for (const inner of r.cssRules) if (/\.topbar::before/.test(inner.selectorText || '')) rule = inner;
          }
        }
      }
      if (!rule) return { found: false };
      const tb = document.querySelector('.topbar'); tb.style.overflowX = 'visible';
      const st = document.createElement('style'); st.textContent = rule.cssText; document.head.appendChild(st);
      const m = (0, eval)('(' + src + ')')();
      const w = parseFloat(getComputedStyle(tb, '::before').width), tw = tb.getBoundingClientRect().width;
      st.remove(); tb.style.overflowX = '';
      return Object.assign({ found: true, washW: w, topbarW: tw }, m);
    }, MEASURE.toString());
    ok('the fallback for phones without overflow clip is in the stylesheet', fallback.found, fallback);
    ok('and drawn unclipped, it keeps the page to the screen\'s width', fallback.found && !sideways(fallback).doc && fallback.washW <= fallback.topbarW + 0.5, fallback);

    console.log('\n4. the Night wash is still there, and still spills below the header');
    const wash = await pg.evaluate(() => {
      const tb = document.querySelector('.topbar'), b = getComputedStyle(tb, '::before'), cs = getComputedStyle(tb);
      return { content: b.content, width: parseFloat(b.width), topbarW: tb.getBoundingClientRect().width, height: parseFloat(b.height),
        topbarH: tb.getBoundingClientRect().height, ox: cs.overflowX, oy: cs.overflowY };
    });
    ok('the wash is drawn in Night', wash.content !== 'none' && wash.content !== 'normal', wash);
    ok('it is still wider than the header (clipped, not shrunk)', wash.width > wash.topbarW, wash);
    ok('the header clips sideways only', wash.ox === 'clip' && wash.oy === 'visible', wash);
    ok('so the wash still reaches below the header', wash.height > wash.topbarH, wash);
    await pg.browserContext().close();
  }

  ok('no page errors', errs.length === 0, errs.slice(0, 4));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('SIDEWAYS-320: ' + (fail ? 'FAIL' : 'PASS'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('threw:', e); process.exit(1); });
