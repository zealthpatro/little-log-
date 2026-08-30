#!/usr/bin/env node
/* .csub IS THE SECONDARY LINE, WHEREVER IT IS.
 *
 * For most of this app's life the only rule was `.stat-card .csub`. Every use outside a stat card
 * -- and most uses are, because they live in sheets -- fell back to inherited body: 16px at full ink
 * and weight 400, which reads as a second paragraph rather than the quiet line under something.
 *
 * The evidence it was known and worked around: SIX separate comments in app/index.html tell the next
 * developer to write `.sub` instead, e.g. ".sub and not .csub: csub is only ever styled inside
 * .stat-card, so out here it renders at full ink and reads as a second paragraph." A class that
 * needs a comment explaining when not to use it is a broken class.
 *
 * The fix is a split, not a new rule: the base carries the treatment, and `.stat-card .csub` keeps
 * ONLY the margin that is genuinely about being inside a card, so nothing inside one moves.
 *
 * This gate holds both halves, because either alone would let the bug back:
 *   - outside a card, .csub must be the small quiet treatment      (the bug)
 *   - inside a card, it must be that treatment PLUS the spacing    (the regression risk)
 *
 *   PORT=8123 node tools/serve.js &
 *   node tools/csub_check.js http://localhost:8123
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8123';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };
const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now(); const now = CLOCK;

const SHEETS = ['openFeed', 'openDiaper', 'openGrowth', 'openMed', 'openNote', 'openBirthDetails', 'openDoctor', 'openSettings'];

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.evaluateOnNewDocument((shift) => {
    const R = Date; function D(...a) { return a.length === 0 ? new R(R.now() + shift) : new R(...a); }
    D.prototype = R.prototype; D.now = () => R.now() + shift; D.parse = R.parse; D.UTC = R.UTC; window.Date = D;
  }, OFFSET);
  await page.setViewport({ width: 390, height: 844 });

  const ev = [];
  for (let i = 0; i < 12; i++) ev.push({ id: 'f' + i, type: 'feed', babyId: 'b1', method: 'bottle', amount: 120, unit: 'ml', time: now - i * 7 * 3600000 });
  for (let i = 0; i < 5; i++) ev.push({ id: 'g' + i, type: 'growth', babyId: 'b1', time: now - i * 14 * DAY, weight: 6.2 - i * 0.3, wUnit: 'kg', height: 62 - i, hUnit: 'cm' });
  const seed = {
    babies: [{ id: 'b1', name: 'Robin', birth: now - 90 * DAY, sex: 'F', country: 'who', routines: [], doctors: [], allergies: [] }],
    activeBabyId: 'b1', events: ev, illnesses: [],
    settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
    timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
  };

  /* The treatment is read from the TOKENS, not hard-coded here, so changing --fs-small on purpose
     moves the gate with the design instead of against it. */
  const expected = async () => page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const px = (v) => { const d = document.createElement('div'); d.style.fontSize = v; document.body.appendChild(d);
      const r = getComputedStyle(d).fontSize; d.remove(); return r; };
    return { fs: px(cs.getPropertyValue('--fs-small').trim()), soft: cs.getPropertyValue('--ink-soft').trim() };
  });

  for (const theme of ['light', 'night']) {
    console.log('\n' + (theme === 'light' ? '1' : '2') + '. [' + theme + '] the quiet line is quiet everywhere');
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme === 'night' ? 'dark' : 'light' }]);
    await page.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });
    await page.evaluate((x) => { localStorage.setItem('cubby-quick-uid', 'local'); localStorage.setItem('little-log-v1', JSON.stringify(x)); }, seed);
    await page.reload({ waitUntil: 'networkidle2' }); await sleep(1500);
    const want = await expected();

    const seen = [];
    for (const v of ['home', 'log', 'album', 'health']) {
      await page.evaluate((x) => go(x), v); await sleep(400);
      seen.push(...await page.evaluate(() => [...document.querySelectorAll('.csub')].map((e) => {
        const c = getComputedStyle(e);
        return { inCard: !!e.closest('.stat-card'), fs: c.fontSize, w: c.fontWeight, col: c.color, mb: c.marginBottom };
      })));
    }
    await page.evaluate(() => { go('log'); if (typeof setLogTab === 'function') setLogTab('stats'); }); await sleep(800);
    const inCard = await page.evaluate(() => [...document.querySelectorAll('.stat-card .csub')].map((e) => {
      const c = getComputedStyle(e); return { fs: c.fontSize, w: c.fontWeight, col: c.color, mb: c.marginBottom };
    }));
    for (const fn of SHEETS) {
      const opened = await page.evaluate((f) => { try { if (typeof window[f] === 'function') { window[f](); return true; } } catch (e) {} return false; }, fn);
      if (!opened) continue; await sleep(300);
      seen.push(...await page.evaluate(() => [...document.querySelectorAll('#sheet .csub')].map((e) => {
        const c = getComputedStyle(e);
        return { inCard: !!e.closest('.stat-card'), fs: c.fontSize, w: c.fontWeight, col: c.color, mb: c.marginBottom };
      })));
      await page.evaluate(() => { try { closeSheet(); } catch (e) {} }); await sleep(150);
    }

    const out = seen.filter((x) => !x.inCard);
    /* Presence pair: an empty list would satisfy every "nothing is wrong" line below for free. */
    ok('there are .csub lines outside a stat card to judge', out.length >= 8, out.length + ' measured');
    ok('and stat cards really rendered, so the inside check means something', inCard.length >= 3, inCard.length + ' inside');

    const wrongSize = out.filter((x) => x.fs !== want.fs);
    ok('outside a card it is the small size, not inherited body', wrongSize.length === 0,
      wrongSize.length + ' at the wrong size, want ' + want.fs + ': ' + [...new Set(wrongSize.map((x) => x.fs))].join(', '));
    const wrongWeight = out.filter((x) => x.w !== '600');
    ok('and it carries the secondary weight, not 400', wrongWeight.length === 0,
      wrongWeight.length + ' at the wrong weight: ' + [...new Set(wrongWeight.map((x) => x.w))].join(', '));

    ok('inside a card it is the same size', inCard.every((x) => x.fs === want.fs), [...new Set(inCard.map((x) => x.fs))]);
    ok('the same weight', inCard.every((x) => x.w === '600'), [...new Set(inCard.map((x) => x.w))]);
    /* The half that catches a careless "simplification": folding the two rules back into one would
       either lose the card spacing or leak it onto every sheet. */
    ok('and it KEEPS the card spacing the base rule must not carry', inCard.every((x) => x.mb === '18px'), [...new Set(inCard.map((x) => x.mb))]);
    ok('while outside a card it carries no card spacing', out.every((x) => x.mb !== '18px'), [...new Set(out.map((x) => x.mb))]);
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'CSUB: FAIL' : 'CSUB: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
