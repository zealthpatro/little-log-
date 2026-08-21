#!/usr/bin/env node
/* A forgotten sleep timer must not become a fact.
 *
 * Found by tools/edge_probe.js: a timer left running for three days showed "SLEEPING 72:00:11" with
 * no warning anywhere, and tapping Stop would have written a 72-hour sleep into the record the
 * doctor summary reads. The parent this happens to is the one who was too tired to tap Stop, which
 * is the parent the whole product is for.
 *
 * Four behaviours, all asserted against the real app:
 *   1. under 12h nothing changes, because most naps are normal
 *   2. over 12h a nudge appears and asks, rather than assuming
 *   3. the clock stops climbing at 24:00:00+ instead of reporting 72:00:11 as if it meant it
 *   4. Stop past 24h opens the correction sheet rather than writing the nap
 *
 *   PORT=8123 node tools/serve.js &
 *   node tools/sleep_timer_check.js http://localhost:8123
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

const seedWith = (hoursRunning, extra) => ({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 90 * DAY, sex: 'F', routines: [] }],
  activeBabyId: 'b1', events: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, growth: 1, album: 1, health: 1, welcome: 1 } },
  timers: { b1: { sleep: Object.assign({ start: now - hoursRunning * HOUR }, extra || {}) } },
  milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], pregnancy: null, notes: [],
});

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

  const load = async (seed) => {
    await page.evaluate((s) => {
      localStorage.setItem('little-log-v1', JSON.stringify(s));
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
    }, seed);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1400);
    await page.evaluate(() => { try { window.toast = function () {}; go('home'); } catch (e) {} });
    await sleep(400);
    return page.evaluate(() => ((document.getElementById('scroll') || document.body).innerText || ''));
  };

  console.log('\n1. a normal nap is left completely alone');
  {
    const t = await load(seedWith(0.7));
    ok('the banner counts it', /SLEEPING/.test(t) && /\d\d:\d\d/.test(t), t.slice(0, 60));
    ok('no nudge', !/Did it end earlier/i.test(t));
    ok('it still counts toward the day', !/0m\s*\n?\s*Sleep today/i.test(t), (t.match(/[\dhm ]+\s*Sleep today/i) || [])[0]);
  }

  console.log('\n2. over twelve hours, it asks');
  {
    const t = await load(seedWith(14));
    ok('a nudge appears', /Did it end earlier/i.test(t), t.slice(0, 200));
    ok('it says how long it has run', /14h/.test(t), (t.match(/been running[^.]*/i) || [])[0]);
    ok('and offers the correction directly', /Set when they woke/i.test(t));
    ok('the wording asks rather than accuses', !/forgot|failed|should have/i.test(t));
  }

  console.log('\n3. the clock stops climbing at 24 hours');
  {
    const t = await load(seedWith(72));
    ok('it does NOT report 72:00:xx', !/7[0-9]:\d\d:\d\d/.test(t), (t.match(/\d+:\d\d:\d\d/) || [])[0]);
    ok('it reads 24:00:00+', /24:00:00\+/.test(t), (t.match(/\d+:\d\d:\d\d\+?/) || [])[0]);
    const cap = await page.evaluate(() => {
      const el = document.querySelector('.active-banner .time');
      return { text: el && el.textContent, cap: el && el.dataset.cap };
    });
    ok('the tick knows the cap, so it stays capped as it runs', cap.cap === String(24 * 3600000), cap);
  }

  console.log('\n4. one forgotten timer cannot inflate the day, the recaps or the doctor summary');
  {
    await load(seedWith(72));
    const r = await page.evaluate(() => ({ live: liveNapMs(dayKey(now())), max: SLEEP_MAX_MS,
      summary: (visitSummary(14).match(/Sleep:[^\n]*/) || [])[0] }));
    ok('liveNapMs is capped at 24h', r.live <= r.max, r);
    ok('the doctor summary does not claim 72 hours', !/7[0-9](\.\d)?\s*h/.test(String(r.summary)), r.summary);
  }

  console.log('\n5. Stop past 24 hours asks instead of writing');
  {
    await load(seedWith(30));
    const r = await page.evaluate(() => {
      const before = state.events.filter((e) => e.type === 'sleep').length;
      stopSleep('b1');
      const sheet = document.getElementById('sheet');
      const h2 = sheet && sheet.querySelector('h2');
      return { before, after: state.events.filter((e) => e.type === 'sleep').length,
        stillRunning: !!(state.timers.b1 && state.timers.b1.sleep),
        title: h2 ? h2.textContent.replace(/\s+/g, ' ').trim() : null,
        hasPicker: !!(sheet && sheet.querySelector('[data-slot="end"], .ts-label')) };
    });
    ok('nothing was written', r.after === r.before, r);
    ok('the timer is still there, so nothing is lost', r.stillRunning === true);
    ok('it asks when the nap ended', /when did this nap end/i.test(r.title || ''), r.title);
    ok('using the standard time strip, not a one-off control', r.hasPicker === true);
  }

  console.log('\n6. the correction writes an honest nap');
  {
    await load(seedWith(30));
    const r = await page.evaluate(() => {
      openSleepCorrect('b1');
      setWhen('end', now() - 28 * 3600000);        // woke two hours after falling asleep
      saveSleepCorrect('b1');
      const s = state.events.filter((e) => e.type === 'sleep');
      return { n: s.length, dur: s.length ? Math.round((s[0].end - s[0].time) / 60000) : null,
        stillRunning: !!(state.timers.b1 && state.timers.b1.sleep) };
    });
    ok('one nap logged', r.n === 1, r);
    ok('two hours, not thirty', r.dur === 120, r);
    ok('the timer is cleared', r.stillRunning === false);
  }

  console.log('\n7. "still asleep" is a real answer, and is not asked again immediately');
  {
    await load(seedWith(14));
    const r = await page.evaluate(() => {
      openSleepCorrect('b1'); keepSleepRunning('b1');
      const t = (document.getElementById('scroll') || document.body).innerText || '';
      return { stillRunning: !!(state.timers.b1 && state.timers.b1.sleep),
        acked: !!(state.timers.b1.sleep || {}).ack, nudge: /Did it end earlier/i.test(t) };
    });
    ok('the timer keeps running', r.stillRunning === true);
    ok('the nudge goes quiet', r.nudge === false, r);
    ok('and it is recorded so it stays quiet for six hours', r.acked === true);
  }

  console.log('\n8. an impossible correction is refused');
  {
    await load(seedWith(30));
    const r = await page.evaluate(() => {
      openSleepCorrect('b1');
      setWhen('end', now() - 31 * 3600000);        // before they fell asleep
      saveSleepCorrect('b1');
      const a = state.events.filter((e) => e.type === 'sleep').length;
      setWhen('end', now() + 3600000);             // in the future
      saveSleepCorrect('b1');
      return { afterBefore: a, afterFuture: state.events.filter((e) => e.type === 'sleep').length };
    });
    ok('an end before the start writes nothing', r.afterBefore === 0, r);
    ok('an end in the future writes nothing', r.afterFuture === 0, r);
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'SLEEP-TIMER: FAIL' : 'SLEEP-TIMER: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
