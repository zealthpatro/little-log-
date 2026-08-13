/* Home must not contradict itself.
 *
 * Three defects this locks down, all found by auditing the rendered screen rather than the source:
 *
 *  1. A nap in progress has no `end`. Both the "Last sleep" chip and the "Sleep today" total
 *     filtered on `e.end`, so during a nap the screen showed "Sleeping 47:26" in the banner,
 *     "Last sleep ·" directly under it and "0m Sleep today" under that. Same baby, same minute.
 *  2. fmtSince dropped "ago" in the 1-24h band, so "2h 15m" under a label reading "Last sleep"
 *     said how long she SLEPT rather than how long ago she woke.
 *  3. Counts were rendered against hardcoded plurals ("1 Feeds today", "1 feeds - 1 diapers"),
 *     and one screen called the same thing Diaper, Last diaper, Diapers today and 1 nappy change.
 *
 * Asserts against the DOM the app actually paints, at 390 and 320. The app scrolls inside #scroll,
 * so everything here reads from that node.
 *
 *   PORT=8123 node tools/serve.js &
 *   node tools/home_truth_check.js http://localhost:8123
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8123';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

/* The page's clock is SHIFTED to 13:00 today, and the fixtures are written against that same clock.
 *
 * Without this the gate grades a different screen depending on the hour it is run at: "Sleep today"
 * and "Feeds today" bucket by dayKey, so an event placed "200 minutes ago" is today's at noon and
 * yesterday's at 02:00, and the first run of this file reported the app failing to count events it
 * had itself pushed into yesterday. Shifted rather than frozen, so the one-second tick still runs. */
const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;
// Real shapes, read off commitEvent(): the type is `diaper`, a feed carries `method`, a finished
// sleep carries `end`, and a RUNNING nap is not an event at all - it lives in state.timers.
const base = (over) => Object.assign({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 90 * DAY, sex: 'F', routines: [] }],
  activeBabyId: 'b1', events: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, growth: 1, album: 1, health: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], pregnancy: null, notes: []
}, over || {});
const ev = (type, minsAgo, extra) => Object.assign({ id: 'e' + type + minsAgo, type, babyId: 'b1', time: now - minsAgo * 60000 }, extra || {});

const STATES = {
  // A nap running for 47 minutes, plus one finished 30-minute nap earlier today.
  'nap-running': base({
    timers: { b1: { sleep: { start: now - 47 * 60000 } } },
    events: [ev('sleep', 200, { end: now - 170 * 60000 }), ev('feed', 90, { method: 'bottle', amount: 110, unit: 'ml' }), ev('diaper', 120, { kind: 'wet' })],
  }),
  // Exactly one of each, which is what a first day looks like: the plural trap.
  'one-of-each': base({
    events: [ev('feed', 200, { method: 'bottle', amount: 90, unit: 'ml' }), ev('diaper', 240, { kind: 'wet' }), ev('sleep', 400, { end: now - 310 * 60000 })],
  }),
  // Nothing logged: the empty chip.
  'empty': base({}),
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const seen = {};
  for (const [name, seed] of Object.entries(STATES)) {
    for (const width of [390, 320]) {
      const page = await browser.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      // Theme is three-way and defaults to System; headless Chrome reports dark, so pin it.
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
      // Must be installed before any app script runs: now() is `() => Date.now()` and dayKey is
      // `new Date(ts)`, so shifting both is enough to move the app's whole notion of "today".
      await page.evaluateOnNewDocument((shift) => {
        const R = Date;
        function D(...a) { return a.length === 0 ? new R(R.now() + shift) : new R(...a); }
        D.prototype = R.prototype; D.now = () => R.now() + shift; D.parse = R.parse; D.UTC = R.UTC;
        window.Date = D;
      }, OFFSET);
      await page.setViewport({ width, height: 1400, deviceScaleFactor: 1 });
      await page.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });
      await page.evaluate((s) => {
        localStorage.setItem('little-log-v1', JSON.stringify(s));
        localStorage.setItem('cubby-quick-uid', 'local');
        Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
      }, seed);
      await page.reload({ waitUntil: 'networkidle2' });
      await sleep(1600);
      await page.evaluate(() => { try { go('home'); } catch (e) {} });
      await sleep(600);

      const m = await page.evaluate(() => {
        const sc = document.getElementById('scroll') || document.body;
        const chips = [].slice.call(sc.querySelectorAll('.since-card')).map((c) => ({
          k: (c.querySelector('.k') || {}).textContent || '', v: (c.querySelector('.v') || {}).textContent || '',
        }));
        const cells = [].slice.call(sc.querySelectorAll('.today-strip .cell')).map((c) => ({
          big: (c.querySelector('.big') || {}).textContent || '', cap: (c.querySelector('.cap') || {}).textContent || '',
          sum: (c.querySelector('.big') || {}).getAttribute ? (c.querySelector('.big').getAttribute('data-sum') || '') : '',
        }));
        const banner = (sc.querySelector('.active-banner .time') || {}).textContent || '';
        // Every element fmtSince paints. These are the ONLY places the "ago" rule applies: a bare
        // "1h 17m" in "Sleep today" is a duration and is correct, which is what makes a whole-page
        // text scan the wrong instrument here.
        const sinces = [].slice.call(sc.querySelectorAll('[data-since]')).map((e) => e.textContent.trim());
        // Right edge past the viewport with no scrolling ancestor = a real overflow, unlike
        // documentElement.scrollWidth which body's overflow-x:hidden inflates for nothing.
        const over = [].slice.call(sc.querySelectorAll('*')).filter((el) => {
          if (el.getBoundingClientRect().right <= window.innerWidth + 1) return false;
          let n = el.parentElement; while (n && n !== document.body) { const ox = getComputedStyle(n).overflowX; if (ox === 'auto' || ox === 'scroll') return false; n = n.parentElement; }
          return true;
        }).map((el) => (el.className || el.tagName) + '');
        return { chips, cells, banner, sinces, over: [...new Set(over)], text: sc.textContent || '' };
      });
      seen[name + '@' + width] = { ...m, errs };
      await page.close();
    }
  }
  await browser.close();

  const S = (k) => seen[k];
  for (const w of [390, 320]) {
    console.log('\n=== ' + w + 'px ===');
    const nap = S('nap-running@' + w), one = S('one-of-each@' + w), emp = S('empty@' + w);

    console.log(' a nap in progress');
    ok('the banner is counting it', /\d+:\d\d/.test(nap.banner), nap.banner);
    const sleepChip = nap.chips.find((c) => /sleep/i.test(c.k));
    ok('the chip does NOT say the sleep is unknown', sleepChip && sleepChip.v.trim() !== '·' && sleepChip.v.trim() !== 'not yet', sleepChip);
    ok('the chip says she is asleep now', sleepChip && /asleep now/i.test(sleepChip.v), sleepChip && sleepChip.v);
    const sleepCell = nap.cells.find((c) => /sleep/i.test(c.cap));
    ok('"Sleep today" is not 0m while a nap runs', sleepCell && sleepCell.big.trim() !== '0m', sleepCell);
    // 30 finished + 47 running = 1h 17m, allowing a minute of drift for page setup.
    ok('it counts the running nap ON TOP of the finished one (~1h 17m)', sleepCell && /^1h 1[6-9]m$/.test(sleepCell.big.trim()), sleepCell && sleepCell.big);
    ok('and it is wired to keep ticking', sleepCell && /^\d+\|\d+$/.test(sleepCell.sum), sleepCell && sleepCell.sum);
    // The day line at the BOTTOM of home used the same `e.end` filter. Fixing only the strip would
    // have moved the contradiction one scroll further down instead of removing it: 1h 17m in the
    // middle of the screen and "0.5h sleep" at the foot of it.
    const dayLine = (nap.text.match(/\d+ feeds? · [\d.]+h sleep · \d+ nappy[a-z ]*/) || [])[0] || '';
    ok('the day line at the foot agrees too (1.3h, not 0.5h)', /1\.3h sleep/.test(dayLine), dayLine || nap.text.slice(nap.text.indexOf('THE DAY'), nap.text.indexOf('THE DAY') + 90));
    ok('no page errors', nap.errs.length === 0, nap.errs);

    console.log(' elapsed time always reads as elapsed');
    // 90 min since the feed -> "1h 30m ago", not the bare "1h 30m" that reads as a duration.
    const feedChip = nap.chips.find((c) => /feed/i.test(c.k));
    ok('an hours-old event says "ago"', feedChip && /\dh \d+m ago/.test(feedChip.v), feedChip && feedChip.v);
    const strays = [].concat(nap.sinces, one.sinces).filter((t) => !/(\bago$|^just now$)/.test(t));
    ok('EVERY elapsed value on the screen says so', strays.length === 0, strays);
    ok('and there are some to check', nap.sinces.length > 0, nap.sinces);

    console.log(' one of each: the plural trap');
    const oneFeed = one.cells.find((c) => /feed/i.test(c.cap));
    const oneNap = one.cells.find((c) => /nappy|nappies|diaper/i.test(c.cap));
    // The nappy caption carries the earned-cue dot, so its textContent has a trailing marker.
    ok('"1 Feed today", not "1 Feeds today"', oneFeed && /^1$/.test(oneFeed.big.trim()) && /^Feed today$/.test(oneFeed.cap.trim()), oneFeed);
    ok('"1 Nappy today", not "1 Nappies today"', oneNap && /^1$/.test(oneNap.big.trim()) && /^Nappy today/.test(oneNap.cap.trim()), oneNap);
    ok('no page errors', one.errs.length === 0, one.errs);

    console.log(' one word for one thing');
    ok('home never says "diaper"', !/diaper/i.test(one.text), (one.text.match(/[A-Za-z]*[Dd]iaper[a-z]*/g) || []).slice(0, 4));
    ok('the chip is labelled "Last nappy"', one.chips.some((c) => /^last nappy$/i.test(c.k.trim())), one.chips.map((c) => c.k));

    console.log(' nothing logged yet');
    const emptyChip = emp.chips.find((c) => /feed/i.test(c.k));
    ok('the empty chip uses words, not a bare dot', emptyChip && emptyChip.v.trim() === 'not yet', emptyChip && emptyChip.v);

    console.log(' layout');
    for (const [k, v] of Object.entries(seen)) {
      if (!k.endsWith('@' + w)) continue;
      ok('no horizontal overflow in ' + k.split('@')[0], v.over.length === 0, v.over);
    }
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'HOME-TRUTH: FAIL' : 'HOME-TRUTH: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
