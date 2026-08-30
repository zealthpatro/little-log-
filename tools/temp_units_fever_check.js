#!/usr/bin/env node
/* FOUR WAYS THE HEALTH SURFACES SAID SOMETHING THAT WAS NOT TRUE.
 *
 * All four are on the pages a frightened parent reads at 3am or hands to a clinician, and three of
 * the four are the same mistake: a number was used without the unit it was written in.
 *
 *   1. THE PEAK, PICKED BY COMPARING °C AGAINST °F. Every temperature row carries its own `unit`,
 *      because `state.settings.tempUnit` lives in the SHARED household blob: a second caregiver
 *      flipping the toggle mid-illness leaves °C and °F rows side by side in one series, and so
 *      does a family that moved. isFever() has always normalised. The "highest" pick did not. It
 *      compared the raw numbers, so 101°F (38.3°C) beat 39.5°C, and the illness block on the
 *      doctor page understated the peak by 1.2°C and moved it to a different day.
 *
 *   2. THE SAME BUG AGAIN in visitSummary's "max" line, for readings that belong to no episode.
 *
 *   3. ONE TEMPERATURE MANUFACTURED A DAY OF ZEROS. The empty-window guard only catches a window
 *      holding NOTHING. Log a single fever and the report fell through to "Feeds: 0 total" and
 *      "Nappies: 0 total (wet 0, dirty 0)" — a febrile three-week-old handed over as never fed and
 *      never wet, which is half a dehydration triad Cubby invented, and it then contradicted
 *      itself lower down with "Wet nappies on that day: none logged". Sleep had carried the right
 *      treatment all along.
 *
 *   4. A PRETERM BABY LOST THE UNDER-THREE-MONTHS RULE, backwards. feverGuidance() has counted
 *      from the due date since the corrected-age item; openFeverSafetyNet() still counted from the
 *      birthday. A baby born at 33 + 4 and a hundred days old read "any fever is worth a prompt
 *      call" on the nudge, then opened the list behind it and found the softest thing on it was a
 *      temperature still there after five days. Correction only ever widens the rule.
 *
 *   5. THE CHART INVENTED A READING. svgLine cloned a lone point 24 hours earlier so the path had
 *      two ends, so one temperature drew a flat fever line across two days, with a plotted dot and
 *      a date, on a day the parent recorded nothing, under a caption that said "1 reading". The
 *      first weigh-in got the same treatment.
 *
 * This gate seeds the exact scenarios and reads the real rendered sheet and the real SVG. It never
 * reads document.body.textContent: the inline script's own source lives there, and every string
 * this file looks for appears in it, so a check written that way passes on a blank screen.
 *
 *   PORT=19427 node tools/serve.js &
 *   node tools/temp_units_fever_check.js http://localhost:19427
 *   node tools/temp_units_fever_check.js http://localhost:19427 --self-test
 *
 * --self-test puts the pre-fix behaviour back INSIDE a live page and requires the probe that
 * covers it to flip. It reaches three of the four rules, because three of them are global function
 * declarations with a seam. The fourth, the "none logged" lines, is written inline in
 * visitSummary and has no seam to replace; it was proved red the other way, against a copy of the
 * tree with app/index.html reverted to HEAD.
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/* No default. A bare run used to fall through to :8080 and quietly grade whichever checkout
   happened to be serving there, which has already produced one green report against a tree that
   did not contain the change at all. */
const ARGS = process.argv.slice(2);
const SELF_TEST = ARGS.indexOf('--self-test') >= 0;
const BASE = ARGS.filter((a) => a.indexOf('--') !== 0)[0];
if (!BASE) { console.error('usage: node tools/temp_units_fever_check.js http://localhost:<port> [--self-test]\n(no default: an implicit port grades whichever checkout is serving there)'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, HOUR = 3600000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

// 13:00, pinned, so a run at midnight reads the same as a run at noon.
const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

const baby = (over) => Object.assign({ id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }, over || {});
const seed = (over) => Object.assign({
  babies: [baby()],
  activeBabyId: 'b1', events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
}, over || {});
const temp = (id, t, v, u, ill) => ({ id: id, type: 'temperature', babyId: 'b1', temp: v, unit: u, time: t, illnessId: ill || null });

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
  };

  /* The REAL sheet, not the return value of the function under test. openVisitSummary renders the
     text into <pre class="visit-sum">, and that <pre> is the only subtree here that cannot contain
     the page's own source. */
  const report = () => page.evaluate(() => {
    openVisitSummary();
    const pre = document.querySelector('#sheet .visit-sum');
    return { shown: document.getElementById('sheet').classList.contains('show'),
      text: pre ? pre.textContent : null,
      lines: pre ? pre.textContent.split('\n').map((l) => l.trim()).filter(Boolean) : [] };
  });
  const lineWith = (r, re) => (r.lines.find((l) => re.test(l)) || null);
  const dLbl = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  console.log('\n1. the illness block picks the real peak, not the bigger number');
  {
    // 39.5°C on Monday, 101°F (38.3°C) on Wednesday. Raw-number comparison picks the 101.
    const hiT = now - 3 * DAY, loT = now - 1 * DAY;
    await load(seed({
      illnesses: [{ id: 'i1', babyId: 'b1', name: 'Cold', startedAt: now - 4 * DAY, endedAt: null }],
      events: [temp('t1', hiT, 39.5, 'C', 'i1'), temp('t2', loT, 101, 'F', 'i1')],
    }));
    const r = await report();
    const ln = lineWith(r, /^Temperature:/);
    ok('the sheet actually rendered', r.shown === true && !!r.text, r.shown);
    ok('the illness block is on it', /Illness: Cold/.test(r.text), r.lines.slice(0, 6));
    ok('there is a temperature line to read', !!ln, r.lines);
    ok('the highest is the 39.5°C', /highest 39\.5°C/.test(ln || ''), ln);
    ok('NOT the 101°F that is only a bigger number', !/highest 101°F/.test(ln || ''), ln);
    ok('and it is dated the day that reading was taken', ln.indexOf(dLbl(hiT)) >= 0, { ln: ln, want: dLbl(hiT) });
    ok('not the day of the °F reading', ln.indexOf(dLbl(loT)) < 0, { ln: ln, wrong: dLbl(loT) });
    // Pairs the absence above: the 101°F row was not dropped, it was compared and lost.
    ok('both readings are still counted', /2 readings/.test(ln || ''), ln);
    ok('and both are still over the fever line', /2 at or above the fever line/.test(ln || ''), ln);
  }

  console.log('\n2. it is a comparison, not a preference for °C');
  {
    // 103°F is 39.4°C and genuinely the peak. The fix must not simply always pick the Celsius row.
    await load(seed({
      illnesses: [{ id: 'i1', babyId: 'b1', name: 'Cold', startedAt: now - 4 * DAY, endedAt: null }],
      events: [temp('t1', now - 3 * DAY, 38, 'C', 'i1'), temp('t2', now - 1 * DAY, 103, 'F', 'i1')],
    }));
    let ln = lineWith(await report(), /^Temperature:/);
    ok('the °F reading wins when it really is the peak', /highest 103°F/.test(ln || ''), ln);
    ok('and the °C one does not', !/highest 38°C/.test(ln || ''), ln);

    // Order must not decide it either: same two rows, swapped in time.
    await load(seed({
      illnesses: [{ id: 'i1', babyId: 'b1', name: 'Cold', startedAt: now - 4 * DAY, endedAt: null }],
      events: [temp('t1', now - 3 * DAY, 101, 'F', 'i1'), temp('t2', now - 1 * DAY, 39.5, 'C', 'i1')],
    }));
    ln = lineWith(await report(), /^Temperature:/);
    ok('the peak is the same whichever came first', /highest 39\.5°C/.test(ln || ''), ln);
    ok('and still not the °F row', !/highest 101/.test(ln || ''), ln);
  }

  console.log('\n3. the window "max" line normalises too');
  {
    // No illness, so these fall through to visitSummary's own flat temperature line.
    await load(seed({ events: [
      temp('t1', now - 3 * DAY, 39.5, 'C'), temp('t2', now - 1 * DAY, 101, 'F'),
      { id: 'f1', type: 'feed', babyId: 'b1', method: 'bottle', amount: 120, unit: 'ml', time: now - 2 * HOUR },
    ] }));
    const r = await report();
    const ln = lineWith(r, /^Temperature: \d+ reading/);
    ok('there is a window temperature line', !!ln, r.lines);
    ok('max is the 39.5°C', /max 39\.5°C/.test(ln || ''), ln);
    ok('not the 101°F', !/max 101°F/.test(ln || ''), ln);
    ok('both readings still counted', /2 reading\(s\)/.test(ln || ''), ln);
    ok('both still flagged as fever', /2 fever reading\(s\)/.test(ln || ''), ln);
    ok('and a real feed still prints as a feed', !!lineWith(r, /^Feeds: 1 total/), r.lines);
  }

  console.log('\n4. one temperature does not manufacture a day of zeros');
  {
    await load(seed({
      babies: [baby({ name: 'Wren', birth: now - 21 * DAY, sex: 'M' })],
      events: [temp('t1', now - 2 * HOUR, 38.9, 'C')],
    }));
    const r = await report();
    ok('the reading that brought her here is on the page', /max 38\.9°C/.test(r.text), r.lines);
    ok('feeds say nobody wrote one down', !!lineWith(r, /^Feeds: none logged$/), r.lines);
    ok('and never "Feeds: 0 total"', !/Feeds: 0 total/.test(r.text), lineWith(r, /^Feeds:/));
    ok('nappies say nobody wrote one down', !!lineWith(r, /^Nappies: none logged$/), r.lines);
    ok('and never "wet 0, dirty 0"', !/wet 0, dirty 0/.test(r.text), lineWith(r, /^Nappies:/));
    ok('sleep keeps the treatment it always had', !!lineWith(r, /^Sleep: none logged$/), r.lines);
    ok('and the page says once what it is', (r.text.match(/record of what was written down/g) || []).length === 1,
      (r.text.match(/record of what was written down/g) || []).length);
  }

  console.log('\n5. a day that WAS logged still reads as counted');
  {
    const evs = [temp('t1', now - 2 * HOUR, 38.9, 'C')];
    for (let i = 0; i < 3; i++) evs.push({ id: 'f' + i, type: 'feed', babyId: 'b1', method: 'breast', side: 'left', dur: 15 * 60000, time: now - (3 + i) * HOUR });
    for (let i = 0; i < 4; i++) evs.push({ id: 'd' + i, type: 'diaper', babyId: 'b1', kind: i % 2 ? 'dirty' : 'wet', time: now - (2 + i) * HOUR });
    await load(seed({ babies: [baby({ name: 'Wren', birth: now - 21 * DAY, sex: 'M' })], events: evs }));
    const r = await report();
    ok('feeds are counted', !!lineWith(r, /^Feeds: 3 total/), r.lines);
    ok('and not called none', !/Feeds: none logged/.test(r.text), r.lines);
    ok('nappies are counted, with the split', !!lineWith(r, /^Nappies: 4 total.*wet 2, dirty 2/), r.lines);
    ok('and not called none', !/Nappies: none logged/.test(r.text), r.lines);
    ok('the caveat line does not repeat itself onto a full day',
      (r.text.match(/record of what was written down/g) || []).length === 0, r.lines);
  }

  console.log('\n6. a window holding nothing still says there is nothing to summarise');
  {
    await load(seed({ babies: [baby({ name: 'Wren', birth: now - 21 * DAY, sex: 'M' })] }));
    const r = await report();
    ok('it says so in plain words', /nothing to summarise/.test(r.text), r.lines);
    ok('and invents no zeros', !/Feeds: 0 total/.test(r.text) && !/wet 0, dirty 0/.test(r.text), r.lines);
    ok('and there IS a summary on screen to have read', /Cubby summary, Wren/.test(r.text), r.lines.slice(0, 3));
  }

  /* --------------------------------------------------------------------------------------------
     The fever safety net. Corrected age widens the under-three-months rule; it must never narrow
     it, and it must never disagree with the nudge that sits one tap above it. */
  const feverSheet = () => page.evaluate(() => {
    openFeverSafetyNet();
    const s = document.getElementById('sheet');
    const sub = s.querySelector('.sub');
    return { shown: s.classList.contains('show'),
      sub: sub ? sub.textContent.replace(/\s+/g, ' ').trim() : null,
      rows: [...s.querySelectorAll('.danger-row .dr-t')].map((e) => e.textContent.trim()),
      nudge: feverGuidance(), mo: babyMonths(), cmo: correctedMonths() };
  });

  console.log('\n7. a preterm baby KEEPS the under-three-months rule on the sheet');
  {
    // Born at 33 + 4, a hundred days old: 3.3 months by the calendar, 1.8 from the due date.
    await load(seed({ babies: [baby({ name: 'Ivy', birth: now - 100 * DAY, gestWeeks: 33, gestDays: 4 })] }));
    const r = await feverSheet();
    ok('the sheet opened', r.shown === true, r.shown);
    ok('the calendar really does say over 3 months', r.mo >= 3, r.mo);
    ok('and the due date really does say under 3', r.cmo < 3, r.cmo);
    ok('the rule is on the sheet', /under 3 months, any fever is worth a prompt call/i.test(r.sub || ''), r.sub);
    ok('and it says why, so the widening is legible', /due date, they are still under 3 months/i.test(r.sub || ''), r.sub);
    ok('the nudge above it says the same thing', /under 3 months/i.test(r.nudge || ''), r.nudge);
    ok('the eleven signs are still all there', r.rows.length === 11, r.rows.length);
    ok('including the five-day one, which used to be the softest thing on it',
      r.rows.some((x) => /still there after five days/i.test(x)), r.rows);
  }

  console.log('\n8. a term baby of the same age reads exactly what she read before');
  {
    await load(seed({ babies: [baby({ name: 'Robin', birth: now - 100 * DAY, gestWeeks: 40, gestDays: 0 })] }));
    const r = await feverSheet();
    ok('no under-3-months rule for a 3-month-old', !/under 3 months/i.test(r.sub || ''), r.sub);
    // Pairs that absence: the sub is present and carries its own words, so this is not a blank sheet.
    ok('but the sheet still says what it is', /Nothing here is a diagnosis/i.test(r.sub || ''), r.sub);
    ok('the eleven signs are there', r.rows.length === 11, r.rows.length);
    ok('and the nudge agrees with the sheet', !/under 3 months/i.test(r.nudge || ''), r.nudge);
  }

  console.log('\n9. a term newborn keeps the rule, so nothing was traded away');
  {
    await load(seed({ babies: [baby({ name: 'Robin', birth: now - 40 * DAY })] }));
    const r = await feverSheet();
    ok('the rule is on the sheet', /under 3 months, any fever is worth a prompt call/i.test(r.sub || ''), r.sub);
    ok('with no due-date sentence, because there is nothing to explain', !/due date/i.test(r.sub || ''), r.sub);
    ok('and the nudge agrees', /under 3 months/i.test(r.nudge || ''), r.nudge);
  }

  /* --------------------------------------------------------------------------------------------
     The chart. Real SVG off the real screen, counted rather than pattern-matched. */
  const chart = (sel) => page.evaluate((s) => {
    const cards = [...document.querySelectorAll('#scroll .stat-card')].filter((c) => {
      const h = c.querySelector('h3'); return h && h.textContent.trim() === s;
    });
    const c = cards[0], svg = c && c.querySelector('svg');
    return { cards: cards.length,
      csub: c ? c.querySelector('.csub').textContent.replace(/\s+/g, ' ').trim() : null,
      circles: svg ? svg.querySelectorAll('circle').length : -1,
      paths: svg ? svg.querySelectorAll('path').length : -1,
      texts: svg ? [...svg.querySelectorAll('text')].map((t) => t.textContent.trim()) : null };
  }, sel);

  console.log('\n10. one reading draws one reading');
  {
    const t = now - 3 * HOUR;
    await load(seed({
      illnesses: [{ id: 'i1', babyId: 'b1', name: 'Cold', startedAt: now - 1 * DAY, endedAt: null }],
      events: [temp('t1', t, 38.6, 'C', 'i1')],
    }));
    await page.evaluate(() => { go('health'); setHealthTab('illness'); });
    await sleep(300);
    const r = await chart('Temperature');
    ok('the temperature chart is on screen', r.cards === 1, r);
    ok('the caption says one reading', /^1 reading ·/.test(r.csub || ''), r.csub);
    ok('and exactly one dot is plotted', r.circles === 1, r);
    ok('with no line drawn between a reading and itself', r.paths === 0, r);
    ok('the day shown is the day she took it', (r.texts || []).indexOf(dLbl(t)) >= 0, { texts: r.texts, want: dLbl(t) });
    ok('and yesterday, which nobody logged, is nowhere on it',
      (r.texts || []).indexOf(dLbl(t - DAY)) < 0, { texts: r.texts, invented: dLbl(t - DAY) });
    ok('the value is still labelled', (r.texts || []).indexOf('38.6') >= 0, r.texts);
  }

  console.log('\n11. two readings still draw a line');
  {
    const a = now - 2 * DAY, b2 = now - 3 * HOUR;
    await load(seed({
      illnesses: [{ id: 'i1', babyId: 'b1', name: 'Cold', startedAt: now - 3 * DAY, endedAt: null }],
      events: [temp('t1', a, 38.2, 'C', 'i1'), temp('t2', b2, 39.1, 'C', 'i1')],
    }));
    await page.evaluate(() => { go('health'); setHealthTab('illness'); });
    await sleep(300);
    const r = await chart('Temperature');
    ok('the caption says two readings', /^2 readings ·/.test(r.csub || ''), r.csub);
    ok('two dots', r.circles === 2, r);
    ok('and the line and its fill are back', r.paths === 2, r);
    ok('both real days are labelled', (r.texts || []).indexOf(dLbl(a)) >= 0 && (r.texts || []).indexOf(dLbl(b2)) >= 0,
      { texts: r.texts, want: [dLbl(a), dLbl(b2)] });
  }

  console.log('\n12. the first weigh-in is not two weigh-ins either');
  {
    // No sex on the baby, so the growth card falls to svgLine rather than the percentile bands.
    const t = now - 4 * HOUR;
    await load(seed({
      babies: [baby({ sex: '' })],
      events: [{ id: 'g1', type: 'growth', babyId: 'b1', weight: 4.2, wUnit: 'kg', time: t }],
    }));
    await page.evaluate(() => { go('log'); setLogTab('stats'); });
    await sleep(300);
    const r = await chart('Weight');
    ok('the weight chart is on screen', r.cards === 1, r);
    ok('the caption says one measurement', /^1 measurement ·/.test(r.csub || ''), r.csub);
    ok('one dot', r.circles === 1, r);
    ok('no line', r.paths === 0, r);
    ok('dated the day it was taken', (r.texts || []).indexOf(dLbl(t)) >= 0, { texts: r.texts, want: dLbl(t) });
    ok('and no weigh-in invented for the day before',
      (r.texts || []).indexOf(dLbl(t - DAY)) < 0, { texts: r.texts, invented: dLbl(t - DAY) });
  }

  console.log('\n13. the sheets still carry their teaching rows');
  {
    const r = await page.evaluate(() => {
      const d = window.CubbyTeachData, rows = (d && d.rows) || {};
      return { net: !!rows.openFeverSafetyNet, netFn: rows.openFeverSafetyNet && rows.openFeverSafetyNet.fn,
        visit: !!rows.openVisitSummary, visitFn: rows.openVisitSummary && rows.openVisitSummary.fn };
    });
    ok('the safety net still has one', r.net === true && r.netFn === 'openFeverSafetyNet()', r);
    ok('and so does the visit summary', r.visit === true && r.visitFn === 'openVisitSummary()', r);
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));

  /* ---- --self-test: put each rule back the way it was and require the probe to flip ----
     All three are global function declarations, so assigning window.<name> genuinely replaces what
     the callers reach for. A gate nobody has watched fail is not evidence. */
  let selfBad = 0;
  if (SELF_TEST) {
    console.log('\n--self-test: revert each rule inside the page and require the probe to fail');
    const chk = (n, c, x) => { if (c) { console.log('  ok   ' + n); } else { selfBad++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

    // 1 + 2. tempC back to a raw pass-through: both peak picks compare °F against °C again.
    await load(seed({
      illnesses: [{ id: 'i1', babyId: 'b1', name: 'Cold', startedAt: now - 4 * DAY, endedAt: null }],
      events: [temp('t1', now - 3 * DAY, 39.5, 'C', 'i1'), temp('t2', now - 1 * DAY, 101, 'F', 'i1')],
    }));
    const goodPeak = lineWith(await report(), /^Temperature:/);
    await page.evaluate(() => { window.tempC = function (t) { return t; }; closeSheet(); });
    const badPeak = lineWith(await report(), /^Temperature:/);
    chk('normalised, the peak is 39.5°C', /highest 39\.5°C/.test(goodPeak || ''), goodPeak);
    chk('raw, it goes back to 101°F, so sections 1-3 can fail', /highest 101°F/.test(badPeak || ''), badPeak);

    // 4. correctedMonths back to chronological months: the preterm baby loses the rule again.
    await load(seed({ babies: [baby({ name: 'Ivy', birth: now - 100 * DAY, gestWeeks: 33, gestDays: 4 })] }));
    const goodSub = (await feverSheet()).sub;
    await page.evaluate(() => { window.correctedMonths = window.babyMonths; closeSheet(); });
    const badSub = (await feverSheet()).sub;
    chk('corrected, the sheet keeps the under-3-months rule', /under 3 months, any fever/i.test(goodSub || ''), goodSub);
    chk('chronological, it is dropped, so section 7 can fail', !/under 3 months/i.test(badSub || ''), badSub);

    // 5. svgLine handed a cloned point again: the invented day comes back.
    const t = now - 3 * HOUR;
    await load(seed({
      illnesses: [{ id: 'i1', babyId: 'b1', name: 'Cold', startedAt: now - 1 * DAY, endedAt: null }],
      events: [temp('t1', t, 38.6, 'C', 'i1')],
    }));
    await page.evaluate(() => { go('health'); setHealthTab('illness'); });
    await sleep(300);
    const goodChart = await chart('Temperature');
    await page.evaluate(() => {
      const orig = window.svgLine;
      window.svgLine = function (pts, c, u) { return orig(pts.length === 1 ? [{ t: pts[0].t - 86400000, v: pts[0].v }, pts[0]] : pts, c, u); };
      go('health'); setHealthTab('illness');
    });
    await sleep(300);
    const badChart = await chart('Temperature');
    chk('one point draws one dot', goodChart.circles === 1 && goodChart.paths === 0, goodChart);
    chk('cloning it draws two and a line, so sections 10 and 12 can fail',
      badChart.circles === 2 && badChart.paths === 2 && (badChart.texts || []).indexOf(dLbl(t - DAY)) >= 0, badChart);

    console.log('  note the "none logged" lines have no in-page seam; they were proved red against');
    console.log('       a copy of the tree with app/index.html reverted to HEAD.');
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (SELF_TEST) console.log('self-test: ' + (selfBad ? selfBad + ' probe(s) could not go red' : 'all three seams proved failable'));
  console.log((fail || selfBad) ? 'TEMP-UNITS-FEVER: FAIL' : 'TEMP-UNITS-FEVER: PASS');
  process.exit((fail || selfBad) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
