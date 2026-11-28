/* Calm Health: red is earned, "overdue" is never said, an empty day is not a zero day, nothing clips at 320px.
 *
 * From the 27 Nov 2026 UX review (canvas board 3A, "Earn the red"). The Experience Charter: "Red is earned,
 * rare, and always paired with a kind next step. The OVERDUE wall is the canonical violation." --med and
 * --danger are the same #D2654E, so every Health primary button (Add medicine, Log temperature, Log it, Log an
 * illness) was painted in the danger colour, and a daily vitamin read "overdue 41m".
 *
 *   1. No primary button on the Health screens and sheets is filled with the danger colour.
 *   2. A missed dose reads "due 41m ago": still not a countdown (medalarm keeps that half), never "overdue".
 *      The vaccine alert says what to do ("to catch up"), not that she is behind.
 *   3. A day with only a measurement on it does not head itself "0 feeds · 0m sleep · 0 nappies", which reads
 *      as a neglected baby. A day that has feeds keeps its full line, zeros included.
 *   4. At 320px the Add medicine "How often?" choices all sit inside the sheet ("Hourly" was cut off).
 *
 *   node test/calm-health.test.js [<base url of this tree's server>]
 * Fictional baby (Bo). Seen red on main 747bfdfe before the fix.
 */
'use strict';
const puppeteer = require('puppeteer-core');
const { downloadBehavior } = require('../tools/gate_downloads.js');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8080';
const DAY = 86400000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function seed(now) {
  const hhmm = (t) => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const ev = (id, type, t, x) => Object.assign({ id, type, babyId: 'b1', time: t, authorId: 'local' }, x || {});
  return {
    babies: [{ id: 'b1', name: 'Bo', birth: now - 70 * DAY, sex: 'M', routines: [], allergies: [], country: 'us' }],
    activeBabyId: 'b1',
    events: [
      ev('f1', 'feed', now - 2 * 3600000, { method: 'bottle', amount: 110, unit: 'ml' }),
      ev('t1', 'temperature', now - 5 * 3600000, { temp: 37.6, unit: 'C', illnessId: 'i1' }),
      // three days back: a measurement and nothing else
      ev('g1', 'growth', now - 3 * DAY, { weight: 5.6, wUnit: 'kg', height: 59, hUnit: 'cm' }),
    ],
    settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', country: 'us' },
    // a daily dose whose time passed 41 minutes ago, nothing given since
    meds: [{ id: 'm1', babyId: 'b1', name: 'Vitamin D drops', dose: '1', unit: 'drop', pattern: { type: 'daily', times: [hhmm(now - 41 * 60000)] },
      remind: true, active: true, createdAt: now - 60 * DAY }],
    illnesses: [{ id: 'i1', babyId: 'b1', name: 'Cold', startedAt: now - 2 * DAY, endedAt: null, notes: '', by: 'local' }],
    timers: {}, milestones: [], photos: [], vaccines: {}, notes: [], pregnancy: null,
  };
}

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'], downloadBehavior: downloadBehavior() });
  const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await p.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 60000 });
  // Avoid the minute boundary: the dose time is stored to the minute.
  const sec = await p.evaluate(() => new Date().getSeconds()); if (sec > 50) await sleep((61 - sec) * 1000);
  const now = await p.evaluate(() => Date.now());
  await p.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem('little-log-v1', JSON.stringify(s));
    localStorage.setItem('cubby-quick-uid', 'local');
    localStorage.setItem('cubby-seen-local', JSON.stringify({ home: 1, log: 1, album: 1, health: 1, welcome: 1, tip_heat: 1, tip_logguide: 1 }));
  }, seed(now));
  await p.reload({ waitUntil: 'networkidle2' });
  await sleep(1500);

  console.log('1. red is earned, not the colour of every Health button');
  const red = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const colour = (v) => { const d = document.createElement('div'); d.style.background = 'var(' + v + ')'; document.body.appendChild(d);
      const c = getComputedStyle(d).backgroundColor; d.remove(); return c; };
    // --med and --danger are one hex in Light and two in Night; a button in either is the alarm colour.
    const reds = [colour('--danger'), colour('--med')];
    const danger = reds[0];
    const hits = []; let seen = 0;
    const scan = (where) => document.querySelectorAll(where + ' .btn-primary').forEach((el) => {
      if (el.offsetParent === null) return; seen++;
      if (reds.includes(getComputedStyle(el).backgroundColor)) hits.push(el.textContent.trim().slice(0, 30));
    });
    go('health'); setHealthTab('illness'); await wait(300); scan('#scroll');
    const steps = ['openAddMed()', 'openTemp()', 'openStartIllness()'];
    for (const s of steps) { closeSheet(); await wait(200); eval(s); await wait(400); scan('#sheet'); }
    closeSheet(); await wait(200);
    // the well state's single call to action, with no illness running
    const ill = state.illnesses; state.illnesses = []; go('health'); setHealthTab('illness'); await wait(300); scan('#scroll'); state.illnesses = ill; go('home');
    return { danger, hits, seen };
  });
  ok('the danger colour is a real colour on this page (the probe is live)', /^rgb/.test(red.danger), red.danger);
  ok('the Health screens and sheets have primary buttons to judge (the probe is live)', red.seen >= 5, red.seen);
  ok('no Health primary button is filled with the danger colour', red.hits.length === 0, red.hits);

  console.log('\n2. a missed dose says when it was due, never "overdue"');
  const words = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = { unit: fmtDue(-41 * 60000), soon: fmtDue(-20000), future: fmtDue(90 * 60000) };
    go('home'); await wait(500);
    out.home = document.getElementById('scroll').innerText;
    go('health'); setHealthTab('meds'); await wait(400);
    out.meds = document.getElementById('scroll').innerText;
    // the vaccine alert, staged directly: one dose a parent has confirmed was missed
    const real = window.vaccineOverdue;
    window.vaccineOverdue = () => ({ name: 'DTaP (1st dose)', _due: Date.now() - 9 * 86400000 });
    go('home'); await wait(500);
    out.vax = document.getElementById('scroll').innerText;
    window.vaccineOverdue = real; go('home');
    return out;
  });
  ok('41 minutes late reads "due 41m ago"', words.unit === 'due 41m ago', words.unit);
  ok('under a minute still reads "due now"', words.soon === 'due now', words.soon);
  ok('a future dose is still a countdown', /^in /.test(words.future), words.future);
  ok('the home dose alert names the medicine (the probe is live)', /Vitamin D drops/.test(words.home), words.home.slice(0, 300));
  ok('home never says "overdue"', !/overdue/i.test(words.home), (words.home.match(/.{0,30}overdue.{0,30}/i) || [])[0]);
  ok('the Health medicine card says when it was due', /due \d+m ago/.test(words.meds), words.meds.slice(0, 300));
  ok('the Health medicine card never says "overdue"', !/overdue/i.test(words.meds), (words.meds.match(/.{0,30}overdue.{0,30}/i) || [])[0]);
  ok('the vaccine alert is on screen (the probe is live)', /DTaP/.test(words.vax), words.vax.slice(0, 300));
  ok('the vaccine alert says "to catch up", not "overdue"', /to catch up/i.test(words.vax) && !/overdue/i.test(words.vax),
    (words.vax.match(/.{0,40}DTaP.{0,40}/) || [])[0]);

  console.log('\n3. a measurement-only day is not a zero day');
  const days = await p.evaluate(async () => {
    go('log'); await new Promise((r) => setTimeout(r, 600));
    return [...document.querySelectorAll('.day-group')].map((g) => ({
      ids: [...g.querySelectorAll('[onclick*="openEdit"]')].map((n) => n.getAttribute('onclick')).join(' '),
      sum: ((g.querySelector('.day-sum') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
    }));
  });
  const mday = days.find((d) => /'g1'/.test(d.ids));
  const fday = days.find((d) => /'f1'/.test(d.ids));
  ok('the measurement day is on the timeline (the probe is live)', !!mday, days);
  ok('its header does not claim 0 feeds, 0m sleep and 0 nappies', mday && !/\b0 feeds\b|\b0m sleep\b|\b0 nappies\b/.test(mday.sum), mday);
  ok('it says what is there instead', mday && /\b1 entry\b/.test(mday.sum), mday);
  ok('a day with a feed keeps its full line, zeros included', fday && /1 feed · 0m sleep · 0 nappies/.test(fday.sum), fday);

  console.log('\n4. nothing clips at 320px');
  await p.setViewport({ width: 320, height: 640, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await sleep(300);
  const clip = await p.evaluate(async () => {
    closeSheet(); openAddMed(); await new Promise((r) => setTimeout(r, 500));
    const sheet = document.getElementById('sheet').getBoundingClientRect();
    const btns = [...document.querySelectorAll('#sheet .unit-toggle button')];
    return { n: btns.length, labels: btns.map((x) => x.textContent.trim()), sheetRight: sheet.right,
      out: btns.filter((x) => { const r = x.getBoundingClientRect(); return r.right > sheet.right + 0.5 || x.scrollWidth > x.clientWidth + 1; })
        .map((x) => x.textContent.trim()) };
  });
  ok('the "How often?" choices are on screen (the probe is live)', clip.labels.includes('Hourly'), clip.labels);
  ok('none of them runs past the sheet or clips its label', clip.out.length === 0, clip.out);

  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
