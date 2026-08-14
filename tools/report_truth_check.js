/* The doctor report must never make a well-fed baby look starved.
 *
 * visitSummary(days) used to divide every total by `days` flat, which is 14 for the doctor report.
 * A five-day-old has not lived fourteen days, so a textbook-normal newborn on eight feeds and six
 * wet nappies a day printed as ~2.9 feeds and ~2.1 nappies a day. A paediatrician reads that as
 * inadequate intake and dehydration, on the one page in Cubby written to be read by a clinician.
 * The same arithmetic hit every family who had installed Cubby recently, at any age.
 *
 * Drives the REAL visitSummary in a browser rather than a copy of it, with the page clock pinned so
 * the fixtures mean the same thing whatever hour this runs at.
 *
 *   PORT=8123 node tools/serve.js &
 *   node tools/report_truth_check.js http://localhost:8123
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8123';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();

// A baby fed and changed like a real one, for `logDays` days.
const mk = (birthDaysAgo, logDays, per) => {
  const evs = [];
  for (let day = 0; day < logDays; day++) {
    for (let i = 0; i < per.feed; i++) evs.push({ id: 'f' + day + '_' + i, type: 'feed', babyId: 'b1', method: 'breast', dur: 15 * 60000, time: CLOCK - day * DAY - i * 2 * 3600000 });
    for (let i = 0; i < per.diaper; i++) evs.push({ id: 'd' + day + '_' + i, type: 'diaper', babyId: 'b1', kind: 'wet', time: CLOCK - day * DAY - i * 3 * 3600000 });
    evs.push({ id: 's' + day, type: 'sleep', babyId: 'b1', time: CLOCK - day * DAY - 8 * 3600000, end: CLOCK - day * DAY - 5 * 3600000 });
  }
  evs.sort((a, b) => b.time - a.time);
  return { babies: [{ id: 'b1', name: 'Wren', birth: CLOCK - birthDaysAgo * DAY, sex: 'F', routines: [], allergies: [] }],
    events: evs, meds: [], milestones: [], photos: [], vaccines: {}, illnesses: [], notes: [], timers: {} };
};

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
  await page.setViewport({ width: 390, height: 900 });
  await page.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });
  await page.evaluate(() => localStorage.setItem('cubby-quick-uid', 'local'));
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1600);
  const report = (seed) => page.evaluate((s) => { Object.assign(state, s); state.activeBabyId = 'b1'; return visitSummary(14); }, seed);
  const num = (t, re) => { const m = t.match(re); return m ? parseFloat(m[1]) : null; };

  console.log('\n1. a healthy five-day-old is not reported as underfed');
  {
    const t = await report(mk(5, 5, { feed: 8, diaper: 6 }));
    const f = num(t, /Feeds:.*~([\d.]+)\/day/), d = num(t, /Nappies:.*~([\d.]+)\/day/);
    ok('feeds land near the eight a day actually logged', f >= 7 && f <= 9.5, { feedsPerDay: f, text: t.split('\n').slice(0, 6) });
    ok('nappies land near the six a day actually logged', d >= 5 && d <= 7.5, { nappiesPerDay: d });
    ok('and NOT the old 14-day answer (~2.9 feeds, ~2.1 nappies)', f > 4 && d > 3, { f, d });
    ok('the window says five days, not fourteen', /Window: the last 5 days/.test(t), t.split('\n')[2]);
    ok('and says why, in terms a clinician can act on', /born inside this window/.test(t), t.split('\n')[3]);
  }

  console.log('\n2. a three-month-old whose family installed Cubby three days ago');
  {
    const t = await report(mk(90, 3, { feed: 7, diaper: 6 }));
    const f = num(t, /Feeds:.*~([\d.]+)\/day/);
    ok('averages use the three days of history, not fourteen', f >= 6 && f <= 8.5, { feedsPerDay: f });
    ok('and the reason is the log, not the birth', /there is no log before that/.test(t), t.split('\n')[3]);
  }

  console.log('\n3. coverage is stated, and is never nonsense');
  {
    for (const [label, seed] of [['5d', mk(5, 5, { feed: 8, diaper: 6 })], ['3d', mk(90, 3, { feed: 7, diaper: 6 })], ['14d', mk(200, 14, { feed: 6, diaper: 5 })]]) {
      const t = await report(seed);
      const m = t.match(/Entries logged on (\d+) of those (\d+) days/);
      ok(label + ': coverage line present and n <= window', !!m && +m[1] <= +m[2], m ? m[0] : t.split('\n').slice(0, 6));
    }
  }

  console.log('\n4. too little history to average is said, not faked');
  {
    const t = await report({ babies: [{ id: 'b1', name: 'Wren', birth: CLOCK - 20 * DAY, sex: 'F', routines: [], allergies: [] }],
      events: [{ id: 'f1', type: 'feed', babyId: 'b1', method: 'bottle', amount: 90, unit: 'ml', time: CLOCK - 2 * 3600000 }],
      meds: [], milestones: [], photos: [], vaccines: {}, illnesses: [], notes: [], timers: {} });
    ok('one feed in two hours is NOT extrapolated to a daily rate', !/\/day/.test(t), t);
    ok('the window is stated in hours', /the last \d+ hours/.test(t), t.split('\n')[2]);
    ok('no coverage line, because "of those 0 days" is meaningless', !/Entries logged on/.test(t));
    ok('sleep says none logged, not "0s"', /Sleep: none logged/.test(t) && !/0s/.test(t), t);
  }

  console.log('\n5. an empty window says so instead of printing zeros');
  {
    const t = await report({ babies: [{ id: 'b1', name: 'Wren', birth: CLOCK - 20 * DAY, sex: 'F', routines: [], allergies: ['penicillin'] }],
      events: [], meds: [{ id: 'm1', babyId: 'b1', name: 'Vitamin D', dose: '1', unit: 'drops', active: true }],
      milestones: [], photos: [], vaccines: {}, illnesses: [], notes: [], timers: {} });
    ok('it does not print "Feeds: 0"', !/Feeds: 0/.test(t), t);
    ok('it names the limit of the document', /record of what was written down/.test(t));
    ok('but allergies still print, because they are always clinically relevant', /Allergies: Penicillin/.test(t));
    ok('and so do active medicines', /Medicines: Vitamin D/.test(t));
  }

  ok('no page errors throughout', errs.length === 0, errs);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'REPORT-TRUTH: FAIL' : 'REPORT-TRUTH: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
