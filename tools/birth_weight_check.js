#!/usr/bin/env node
/* Birth weight was a caption, not a number.
 *
 * It lived on the baby as a free-text string ("e.g. 3.4 kg or 7 lb 8 oz") whose only reader was the
 * poster renderer. So the single figure the first fortnight turns on could not be computed, plotted
 * or reported: the growth chart plots growthEvents() only, so a newborn had NO day-zero dot, and the
 * doctor report printed "Latest growth" with nothing to compare it against.
 *
 * Worse, welcomeBaby — the one moment Cubby is with a mother hours after birth — asked for name,
 * time, sex and country and did not ask for the weight her midwife will ask about at every early
 * visit, so she had to carry it on a scrap of paper past the app that exists to hold it.
 *
 * The fix is deliberately small: a typed number stored as a normal growth event AT the birth
 * timestamp. Every existing reader then picks it up for free, and one line appears under Latest
 * weight while it is still the question:
 *
 *     3.31 kg · 90 g below birth weight · day 4
 *
 * No colour, no target, no verdict. A difference from her OWN baby's starting number, never from a
 * population. Newborns lose weight and regain it; saying whether that is fine is the midwife's job,
 * and Cubby's job is to have the number ready when she asks.
 *
 *   PORT=8123 node tools/serve.js &
 *   node tools/birth_weight_check.js http://localhost:8123
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8123';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

const baby = (over) => Object.assign({ id: 'b1', name: 'Robin', birth: now - 4 * DAY, sex: 'F', country: 'who', routines: [], doctors: [], allergies: [] }, over || {});
const seed = (over) => Object.assign({
  babies: [baby()], activeBabyId: 'b1', events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
}, over || {});

// A growth event written at birth, as the app writes it.
const bwEvent = (kg, at) => ({ id: 'bw1', type: 'growth', babyId: 'b1', time: at, weight: kg, wUnit: 'kg', birthWeight: true });

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.evaluateOnNewDocument((shift) => {
    const R = Date;
    function D(...a) { return a.length === 0 ? new R(R.now() + shift) : new R(...a); }
    D.prototype = R.prototype; D.now = () => R.now() + shift; D.parse = R.parse; D.UTC = R.UTC;
    window.Date = D;
  }, OFFSET);
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });
  await page.evaluate(() => localStorage.setItem('cubby-quick-uid', 'local'));
  const load = async (s) => {
    await page.evaluate((x) => {
      localStorage.setItem('little-log-v1', JSON.stringify(x));
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
    }, s);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1400);
    await page.evaluate(() => { try { window.__toasts = []; window.toast = function (m) { window.__toasts.push(m); }; } catch (e) {} });
    await sleep(200);
  };

  console.log('\n1. the app asks for it at the one moment she has it in her hand');
  {
    await load(seed({
      babies: [], activeBabyId: null,
      pregnancy: { stage: 'pregnant', due: now + 10 * DAY, country: 'in', lmp: now - 270 * DAY },
    }));
    const r = await page.evaluate(() => {
      openWelcomeBaby();
      const s = document.getElementById('sheet');
      return { has: !!s.querySelector('#wbWt'), unit: !!s.querySelector('#wbWtUkg'),
        type: s.querySelector('#wbWt') ? s.querySelector('#wbWt').getAttribute('type') : null,
        txt: (s.innerText || '').replace(/\s+/g, ' ') };
    });
    ok('the welcome sheet has a birth weight field', r.has === true, r.txt.slice(0, 200));
    ok('it is a number, not a sentence', r.type === 'number', r);
    ok('with a kg/lb choice, because the unit is hers', r.unit === true, r);
    ok('and it is optional, because some mothers do not have it yet', /optional/i.test(r.txt), r.txt.slice(0, 240));
    ok('it says why it is worth typing', /midwife|visit/i.test(r.txt), r.txt.slice(0, 300));

    const ph = await page.evaluate(() => {
      const n = document.getElementById('wbWt'), before = n.placeholder;
      birthWUnit('wbWtU', 'lb');
      return { before, after: n.placeholder, on: document.getElementById('wbWtUlb').classList.contains('on') };
    });
    ok('switching to lb selects lb', ph.on === true, ph);
    ok('and the example number follows, so lb does not show a 3.4 lb baby', ph.before === '3.4' && ph.after === '7.5', ph);

    /* Abandon the sheet mid-choice and come back. The toggle is rebuilt from settings, so anything
       remembered from last time is a lie on screen and 3.4 kg silently becomes 3.4 lb. */
    const stale = await page.evaluate(() => {
      birthWUnit('wbWtU', 'lb');
      closeSheet(); openWelcomeBaby();
      document.getElementById('wbWt').value = '3.4';
      const shown = document.getElementById('wbWtUkg').classList.contains('on') ? 'kg' : 'lb';
      return { shown, read: readBirthWeight('wbWt', 'wbWtU') };
    });
    ok('reopening the sheet shows her own unit again', stale.shown === 'kg', stale);
    ok('and what gets stored matches what is on screen', stale.read && stale.read.wUnit === 'kg', stale);
    await page.evaluate(() => { closeSheet(); openWelcomeBaby(); });

    const w = await page.evaluate(() => {
      document.getElementById('wbName').value = 'Robin';
      document.getElementById('wbWt').value = '3.4';
      welcomeBaby();
      const b = state.babies[0];
      const g = state.events.filter((e) => e.type === 'growth');
      return { n: g.length, weight: g[0] && g[0].weight, unit: g[0] && g[0].wUnit,
        atBirth: !!(g[0] && b && g[0].time === b.birth), caption: b && b.birthWeight };
    });
    ok('typing it writes one growth measurement', w.n === 1, w);
    ok('at the birth timestamp, so it is the FIRST dot on the chart', w.atBirth === true, w);
    ok('with the number she typed', w.weight === 3.4 && w.unit === 'kg', w);
    ok('and the poster caption still gets its text', /3\.4\s*kg/.test(w.caption || ''), w);
  }

  console.log('\n2. day four: one line, her own baby\'s number, no verdict');
  {
    await load(seed({ events: [
      bwEvent(3.4, now - 4 * DAY),
      { id: 'g2', type: 'growth', babyId: 'b1', time: now - 3600000, weight: 3.31, wUnit: 'kg' },
    ] }));
    const r = await page.evaluate(() => {
      const html = renderGrowthSection();
      return { html, txt: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), line: birthWeightLine() };
    });
    ok('the line is there', r.line.length > 0, r.txt.slice(0, 200));
    ok('it shows where she is now', /3\.31 kg/.test(r.txt), r.txt.slice(0, 300));
    ok('the gap in grams, which is how a midwife says it', /90 g below birth weight/.test(r.txt), r.txt.slice(0, 300));
    ok('and the day, because that is what makes it readable', /day 4/.test(r.txt), r.txt.slice(0, 300));
    ok('no colour is used to grade it', !/color:\s*var\(--(med|preg|feed|sleep)/.test(r.line), r.line);
    ok('no target, no percentile, no verdict', !/(normal|healthy|concern|should|percentile|expected)/i.test(r.line), r.line);
  }

  console.log('\n3. above birth weight reads as gain, not as a pass mark');
  {
    await load(seed({ events: [
      bwEvent(3.4, now - 10 * DAY),
      { id: 'g2', type: 'growth', babyId: 'b1', time: now - 3600000, weight: 3.62, wUnit: 'kg' },
    ], babies: [baby({ birth: now - 10 * DAY })] }));
    const r = await page.evaluate(() => birthWeightLine().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    ok('it says grams above', /220 g above birth weight/.test(r), r);
    ok('and still says nothing about whether that is good', !/good|great|on track|well done/i.test(r), r);
  }

  console.log('\n4. it knows when to stop talking');
  {
    // Four weeks old: past the window where "against birth weight" is the question.
    await load(seed({ babies: [baby({ birth: now - 28 * DAY })], events: [
      bwEvent(3.4, now - 28 * DAY),
      { id: 'g2', type: 'growth', babyId: 'b1', time: now - 3600000, weight: 4.2, wUnit: 'kg' },
    ] }));
    ok('after three weeks the line is gone', (await page.evaluate(() => birthWeightLine())) === '', 'still shown');

    await load(seed({ events: [bwEvent(3.4, now - 4 * DAY)] }));
    ok('and it says nothing when the only measurement IS the birth weight',
      (await page.evaluate(() => birthWeightLine())) === '', 'compared a number to itself');
  }

  console.log('\n5. skipping it costs nothing');
  {
    await load(seed({ events: [{ id: 'g2', type: 'growth', babyId: 'b1', time: now - 3600000, weight: 3.31, wUnit: 'kg' }] }));
    const r = await page.evaluate(() => ({ line: birthWeightLine(), section: renderGrowthSection().length, report: visitSummary(30) }));
    ok('no line without a birth weight', r.line === '', r.line);
    ok('the growth section still renders', r.section > 100, r.section);
    ok('and the doctor report does not invent one', !/Birth weight/.test(r.report), r.report.slice(0, 200));
  }

  console.log('\n6. the doctor report carries it');
  {
    await load(seed({ events: [
      bwEvent(3.4, now - 4 * DAY),
      { id: 'g2', type: 'growth', babyId: 'b1', time: now - 3600000, weight: 3.31, wUnit: 'kg' },
    ] }));
    const r = await page.evaluate(() => visitSummary(30));
    ok('it prints the birth weight', /Birth weight: 3\.4 kg/.test(r), r.slice(0, 400));
    ok('above the latest, so the pair reads in order', r.indexOf('Birth weight') < r.indexOf('Latest growth'), r.slice(0, 400));
  }

  console.log('\n7. babies added before this get their dot back without retyping');
  {
    // The caption every existing baby already has, and nothing else.
    await load(seed({ babies: [baby({ birthWeight: '3.4 kg' })] }));
    const r = await page.evaluate(() => {
      openBirthDetails();
      saveBabyDetails('b1');
      const g = state.events.filter((e) => e.type === 'growth');
      return { n: g.length, w: g[0] && g[0].weight, u: g[0] && g[0].wUnit,
        atBirth: !!(g[0] && g[0].time === state.babies[0].birth), caption: state.babies[0].birthWeight };
    });
    ok('an old "3.4 kg" caption becomes a real day-zero dot', r.n === 1 && r.w === 3.4 && r.u === 'kg', r);
    ok('placed at birth', r.atBirth === true, r);
    ok('and her own wording is left exactly as she typed it', r.caption === '3.4 kg', r);
  }

  console.log('\n8. pounds and ounces are how half the world says it');
  {
    await load(seed({ babies: [baby({ birthWeight: '7 lb 8 oz' })] }));
    const r = await page.evaluate(() => {
      openBirthDetails(); saveBabyDetails('b1');
      const g = state.events.filter((e) => e.type === 'growth')[0];
      return { w: g && g.weight, u: g && g.wUnit, caption: state.babies[0].birthWeight };
    });
    ok('"7 lb 8 oz" is 7.5 lb', r.w === 7.5 && r.u === 'lb', r);
    ok('and it is NOT rewritten as 7.5 lb behind her back', r.caption === '7 lb 8 oz', r);

    const p = await page.evaluate(() => ['3400 g', '3.4kg', '3.4', 'about seven pounds ish', ''].map((s) => parseBirthWeight(s)));
    ok('grams work', p[0] && p[0].weight === 3.4 && p[0].wUnit === 'kg', p[0]);
    ok('no space works', p[1] && p[1].weight === 3.4, p[1]);
    ok('a bare number takes her own unit', p[2] && p[2].wUnit === 'kg', p[2]);
    ok('and a sentence is left alone rather than guessed at', p[3] === null && p[4] === null, [p[3], p[4]]);
  }

  console.log('\n9. clearing it clears the dot, and saving twice does not double it');
  {
    await load(seed({ babies: [baby({ birthWeight: '3.4 kg' })] }));
    const r = await page.evaluate(() => {
      openBirthDetails(); saveBabyDetails('b1');
      openBirthDetails(); saveBabyDetails('b1');
      const twice = state.events.filter((e) => e.type === 'growth').length;
      openBirthDetails();
      document.getElementById('dWt').value = '';
      saveBabyDetails('b1');
      return { twice, after: state.events.filter((e) => e.type === 'growth').length };
    });
    ok('saving details twice leaves ONE day-zero dot', r.twice === 1, r);
    ok('and emptying the field removes it', r.after === 0, r);
  }

  console.log('\n10. deleting the measurement and typing it again brings it back');
  {
    await load(seed({ babies: [baby({ birthWeight: '3.4 kg' })],
      events: [Object.assign(bwEvent(3.4, now - 4 * DAY), { deleted: true })] }));
    const r = await page.evaluate(() => {
      const before = growthEvents().length;                 // the chart cannot see a deleted one
      openBirthDetails(); saveBabyDetails('b1');
      return { before, after: growthEvents().length, n: state.events.filter((e) => e.type === 'growth').length };
    });
    ok('a deleted birth weight is invisible to the chart', r.before === 0, r);
    ok('re-entering it brings the same one back rather than adding a second', r.after === 1 && r.n === 1, r);
  }

  console.log('\n11. the chart actually starts at day zero');
  {
    await load(seed({ events: [
      bwEvent(3.4, now - 4 * DAY),
      { id: 'g2', type: 'growth', babyId: 'b1', time: now - 3600000, weight: 3.31, wUnit: 'kg' },
    ] }));
    const r = await page.evaluate(() => {
      const g = growthEvents().filter((e) => e.weight);
      return { first: g[0] && g[0].weight, n: g.length, delta: renderGrowthSection().indexOf('Latest weight') > -1 };
    });
    ok('the earliest weight the chart plots is the birth weight', r.first === 3.4 && r.n === 2, r);
    ok('and the Latest weight box is still there', r.delta === true, r);
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'BIRTH-WEIGHT: FAIL' : 'BIRTH-WEIGHT: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
