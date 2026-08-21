#!/usr/bin/env node
/* The illness has to be ON the page built for the doctor.
 *
 * renderIllness has held the whole story since it was written: the name, the day count, the
 * temperature series, the symptoms tied to that episode and the doses given during it. Neither
 * visitSummary nor openDoctorReport ever touched state.illnesses. So a parent in a waiting room
 * because of a five-day tummy bug handed over a page listing temperatures and symptoms as loose
 * facts in a flat fortnight, which never said there was an illness, when it started, or that it was
 * still going. That is the first question a clinician asks.
 *
 * The cases that matter are the ones a flat window hides: an episode that started BEFORE the
 * window and is still running, and readings that belong to an older episode and must not be
 * attributed to this one.
 *
 *   PORT=8123 node tools/serve.js &
 *   node tools/illness_report_check.js http://localhost:8123
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8123';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, HOUR = 3600000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

const base = (over) => Object.assign({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 200 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
  activeBabyId: 'b1', events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
}, over || {});
const feedsFor = (n) => Array.from({ length: n }, (_, i) => ({ id: 'f' + i, type: 'feed', babyId: 'b1',
  method: 'bottle', amount: 120, unit: 'ml', time: now - i * 4 * HOUR }));

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
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1500);
  const summary = (seed) => page.evaluate((s) => {
    Object.assign(state, s); state.activeBabyId = 'b1';
    try { window.toast = function () {}; } catch (e) {}
    return visitSummary(14);
  }, seed);

  console.log('\n1. a five-day tummy bug, still going: the reason for the appointment');
  {
    const t = await summary(base({
      illnesses: [{ id: 'i1', babyId: 'b1', name: 'Tummy bug', startedAt: now - 4 * DAY, endedAt: null, notes: '' }],
      events: feedsFor(20).concat([
        { id: 't1', type: 'temperature', babyId: 'b1', illnessId: 'i1', temp: 38.4, unit: 'C', time: now - 4 * DAY },
        { id: 't2', type: 'temperature', babyId: 'b1', illnessId: 'i1', temp: 38.9, unit: 'C', time: now - 3 * DAY },
        { id: 't3', type: 'temperature', babyId: 'b1', illnessId: 'i1', temp: 37.4, unit: 'C', time: now - 1 * DAY },
        { id: 'y1', type: 'symptom', babyId: 'b1', illnessId: 'i1', symptom: 'Diarrhoea', severity: 'moderate', time: now - 4 * DAY },
        { id: 'y2', type: 'symptom', babyId: 'b1', illnessId: 'i1', symptom: 'Poor feeding', severity: 'mild', time: now - 2 * DAY },
        { id: 'm1', type: 'medicine', babyId: 'b1', medName: 'Calpol', dose: '5', unit: 'ml', time: now - 3 * DAY },
        { id: 'm2', type: 'medicine', babyId: 'b1', medName: 'Calpol', dose: '5', unit: 'ml', time: now - 2 * DAY },
      ]) }));
    ok('the illness is named at all', /Illness: Tummy bug/.test(t), t.slice(0, 400));
    ok('it says when it started and which day it is', /Started .+, day 5, still going/.test(t), (t.match(/Started[^\n]*/) || [])[0]);
    ok('the temperature series is scoped to the episode', /Temperature: 3 readings/.test(t), (t.match(/Temperature:[^\n]*/) || [])[0]);
    ok('it names the highest and when', /highest 38\.9°C on/.test(t), (t.match(/Temperature:[^\n]*/) || [])[0]);
    ok('and counts the ones at or above the fever line', /2 at or above the fever line/.test(t), (t.match(/Temperature:[^\n]*/) || [])[0]);
    ok('symptoms carry their severity', /Diarrhoea \(moderate\)/.test(t) && /Poor feeding \(mild\)/.test(t), (t.match(/Symptoms:[^\n]*/) || [])[0]);
    ok('medicine given during it is counted', /Calpol 5 ml x2/.test(t), (t.match(/Given during it:[^\n]*/) || [])[0]);
    ok('the illness comes BEFORE the feeds', t.indexOf('Illness:') < t.indexOf('Feeds:'), { ill: t.indexOf('Illness:'), feeds: t.indexOf('Feeds:') });
  }

  console.log('\n2. an episode that started before the window is still reported');
  {
    // 20 days ago, still running. A flat 14-day summary would never mention it.
    const t = await summary(base({
      illnesses: [{ id: 'i1', babyId: 'b1', name: 'Chest cold', startedAt: now - 20 * DAY, endedAt: null, notes: '' }],
      events: feedsFor(10) }));
    ok('it appears even though it began outside the window', /Illness: Chest cold/.test(t), t.slice(0, 300));
    ok('and the day count is from its real start, day 21', /day 21, still going/.test(t), (t.match(/Started[^\n]*/) || [])[0]);
  }

  console.log('\n3. a recovered episode says so, with its dates');
  {
    const t = await summary(base({
      illnesses: [{ id: 'i1', babyId: 'b1', name: 'Ear infection', startedAt: now - 9 * DAY, endedAt: now - 5 * DAY, notes: 'Left ear' }],
      events: feedsFor(10) }));
    ok('it reads as recovered, not ongoing', /recovered/.test(t) && !/still going/.test(t), (t.match(/Illness[\s\S]{0,120}/) || [])[0]);
    ok('with a start and an end date', /^ {2}\S.* to .+, 5 days, recovered$/m.test(t), (t.match(/^ {2}.*recovered$/m) || [])[0]);
    ok('the parent note is carried', /Note: Left ear/.test(t));
  }

  console.log('\n4. readings from an OLDER episode are not attributed to this one');
  {
    const t = await summary(base({
      illnesses: [
        { id: 'i1', babyId: 'b1', name: 'Cold', startedAt: now - 3 * DAY, endedAt: null, notes: '' },
        { id: 'i0', babyId: 'b1', name: 'Croup', startedAt: now - 40 * DAY, endedAt: now - 35 * DAY, notes: '' },
      ],
      events: feedsFor(10).concat([
        { id: 't1', type: 'temperature', babyId: 'b1', illnessId: 'i1', temp: 38.1, unit: 'C', time: now - 2 * DAY },
        { id: 't0', type: 'temperature', babyId: 'b1', illnessId: 'i0', temp: 39.8, unit: 'C', time: now - 38 * DAY },
      ]) }));
    const cold = (t.match(/Illness: Cold[\s\S]*?(?=Illness:|$)/) || [''])[0];
    ok('the current episode counts only its own reading', /Temperature: 1 reading/.test(cold), cold.slice(0, 200));
    ok('and does NOT borrow the old 39.8', !/39\.8/.test(cold), cold.slice(0, 200));
    ok('the older, fully-outside episode is not reported at all', !/Croup/.test(t), (t.match(/Illness:[^\n]*/g) || []));
  }

  console.log('\n5. no illness: the report is exactly as it was');
  {
    const t = await summary(base({ events: feedsFor(10) }));
    ok('no illness section appears', !/Illness/.test(t), t.slice(0, 200));
    ok('and the feeds still lead', /Feeds:/.test(t));
  }

  console.log('\n6. an illness but nothing else logged does not say "nothing to summarise"');
  {
    const t = await summary(base({
      illnesses: [{ id: 'i1', babyId: 'b1', name: 'Fever', startedAt: now - 2 * DAY, endedAt: null, notes: '' }],
      events: [] }));
    ok('the illness is still reported', /Illness: Fever/.test(t), t.slice(0, 300));
    ok('and it does not claim there is nothing to summarise', !/nothing to summarise/.test(t), (t.match(/No .*logged[^\n]*/) || [])[0]);
    ok('it says what IS missing, precisely', /only the illness above is recorded/.test(t), (t.match(/No .*logged[^\n]*/) || [])[0]);
  }

  console.log('\n7. the printed report gives it its own heading, once');
  {
    const r = await page.evaluate((s) => {
      Object.assign(state, s); state.activeBabyId = 'b1';
      let html = '';
      const realOpen = window.openPrintable;
      window.openPrintable = function (h) { html = h; };
      try { window.__proTaste = true; openDoctorReport(); } finally { window.openPrintable = realOpen; }
      return { html: html, h2s: (html.match(/<h2>[^<]*<\/h2>/g) || []) };
    }, base({
      illnesses: [{ id: 'i1', babyId: 'b1', name: 'Tummy bug', startedAt: now - 4 * DAY, endedAt: null, notes: '' }],
      events: feedsFor(12) }));
    ok('the report was generated', r.html.length > 200, r.html.slice(0, 120));
    ok('there is an Illness heading', r.h2s.some((h) => /Illness/.test(h)), r.h2s);
    ok('it sits ABOVE Last 14 days', r.html.indexOf('<h2>Illness</h2>') < r.html.indexOf('Last 14 days'), r.h2s);
    ok('the episode is not printed twice', (r.html.match(/Illness: Tummy bug/g) || []).length === 1,
      (r.html.match(/Illness: Tummy bug/g) || []).length);
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'ILLNESS-REPORT: FAIL' : 'ILLNESS-REPORT: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
