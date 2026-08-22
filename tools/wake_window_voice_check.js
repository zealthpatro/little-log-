#!/usr/bin/env node
/* The one forward-looking thing in the baby stage never spoke, and then one day just appeared.
 *
 * wakeWindow() has always returned {enough:false, have, need} when a parent's own logs cannot yet
 * carry a range, and NO CALLER READ IT. wakeWindowLine() said `if(!w||!w.enough) return ''`, so for
 * the first six naps of a baby's life the slot was empty, with nothing anywhere in the app saying
 * that the space existed or what would fill it. Against sixteen lifetime events across eleven real
 * households, no parent has ever seen the line at all. And once it was earned it lived in exactly
 * one place, on the home surface, gated behind "she is awake right now, and it is daytime, and she
 * has been awake between twenty minutes and six hours" — so the Log tab, the surface a parent opens
 * to LOOK at her fortnight rather than to log, never carried it.
 *
 * Two things now exist, and this gate holds both to the charter note on the proposal:
 *
 *   THE NOT-YET LINE, on home, just after a nap ends, at most twice ever PER BABY, dismissible. It
 *   must carry NO number: "never a count of what is missing" means she is never told she is three
 *   naps short. Its allowance is counted in naps spoken for, not in paints, because render() runs
 *   many times in ten minutes and counting paints would spend both turns on one nap. Its × must NOT
 *   silence the real line she has never seen.
 *
 *   THE LOG LINE, once the data supports it, in the cycleLengths register: a description of the
 *   past with no countdown, no target, no colour, and the same two-hour noise floor as home.
 *
 * FOUR THINGS THIS GATE EXISTS TO KEEP RED, all four reproduced as live failures in review:
 *
 *   NIGHT. The not-yet branch inherited `if(!wwIsDaytime(now())) return ''` by sitting below it, so
 *   it was dead from 20:00 to 06:00 — ten hours of every day, for exactly the parent it is built
 *   for, whose baby still naps round the clock. Sections 10 and 11 run on their own pages pinned to
 *   22:00 and 05:30. A gate that only ever runs at 13:00 cannot see this, so it must not only run
 *   at 13:00.
 *
 *   THE LOST MOMENT. Stop lives on the timer banner on every tab and stopSleep does not send her
 *   home, so a ten-minute window measured from the nap's end alone was simply never seen by the
 *   parent who stopped from Log. Section 12.
 *
 *   THE UNDO TAX. "Sleep logged" offers Undo and undoLast() hard-removes the event, so one
 *   corrected mis-tap used to cost a turn out of two. Section 13.
 *
 *   TWO PARENTS, TWO BABIES. The allowance is per person AND per baby: one twin must not eat the
 *   other twin's promise, and a partner arriving later gets her own two turns. Sections 8 and 14.
 *
 *   PORT=9657 node tools/serve.js &
 *   node tools/wake_window_voice_check.js http://localhost:9657
 *   node tools/wake_window_voice_check.js http://localhost:9657 --self-test
 *
 * --self-test puts the pre-fix behaviour back INSIDE a live page, one rule at a time, and requires
 * the probe that covers it to flip. A gate nobody has watched fail is not evidence.
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ARGS = process.argv.slice(2);
const BASE = ARGS.filter((a) => a.indexOf('--') !== 0)[0] || 'http://localhost:9657';
const SELF_TEST = ARGS.indexOf('--self-test') >= 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, MIN = 60000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

// 13:00 for the main run. Inside the app's own daytime window (6am to 8pm), which is the only time
// the REAL line is allowed to speak at all, so a green run here is not an accident of when it was
// run. It is emphatically not the only time the NOT-YET line must speak: sections 10 and 11.
const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
const now = CLOCK;

const dayAt = (daysAgo, h, m) => { const d = new Date(now); d.setDate(d.getDate() - daysAgo); d.setHours(h, m, 0, 0); return d.getTime(); };

const seed = (over) => Object.assign({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 200 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
  activeBabyId: 'b1', events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, growth: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
}, over || {});

/* One day of the fortnight: a nap 09:00-10:00, then a second nap `gapMin` after it woke. Every gap
   therefore BEGINS at 10:00, which is daytime, so all of them survive the night-waking filter. The
   next day's 09:00 nap is nineteen-odd hours after this one wakes, well over the six-hour ceiling,
   so no cross-day pair sneaks a phantom gap into the sample. Six days of this is TWELVE sleep
   events and SIX gaps, and section 15 holds the printed sentence to both numbers. */
function napPair(daysAgo, gapMin, id) {
  const aStart = dayAt(daysAgo, 9, 0), aEnd = dayAt(daysAgo, 10, 0);
  const bStart = aEnd + gapMin * MIN;
  return [
    { id: id + 'a', babyId: 'b1', type: 'sleep', time: aStart, end: aEnd },
    { id: id + 'b', babyId: 'b1', type: 'sleep', time: bStart, end: bStart + 60 * MIN },
  ];
}
function napDays(gapMins, babyId) {
  let out = [];
  gapMins.forEach((g, i) => { out = out.concat(napPair(i + 1, g, 'n' + i)); });
  if (babyId) out.forEach((e) => { e.babyId = babyId; e.id = babyId + e.id; });
  return out;
}
// Six gaps of 90, 90, 100, 100, 120, 120 minutes: quartiles land on 1h 30m and 2h, a 30-minute
// spread, comfortably inside the two-hour noise floor.
const ENOUGH = napDays([90, 90, 100, 100, 120, 120]);
// Same six days, but 25m to 5h: the quartiles are four and a half hours apart, which is noise.
const TOO_WIDE = napDays([25, 25, 30, 240, 300, 300]);
// ENOUGH plus a nap that ended forty minutes ago: the real home line's own conditions, awake now and
// inside the twenty-minute-to-six-hour window.
const ENOUGH_AWAKE = ENOUGH.concat([{ id: 'today', babyId: 'b1', type: 'sleep', time: now - 100 * MIN, end: now - 40 * MIN }]);

const errs = [];

/* A page pinned to a chosen hour. Its own page rather than a re-pin, because the Date shim is
   installed with evaluateOnNewDocument and cannot be moved once the app has loaded. This is the
   whole reason the night failure was invisible: one page at one hour cannot see it. */
async function pinnedPage(browser, hh, mm) {
  const clock = (() => { const d = new Date(); d.setHours(hh, mm || 0, 0, 0); return d.getTime(); })();
  const page = await browser.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.evaluateOnNewDocument((shift) => {
    const R = Date;
    function D(...a) { return a.length === 0 ? new R(R.now() + shift) : new R(...a); }
    D.prototype = R.prototype; D.now = () => R.now() + shift; D.parse = R.parse; D.UTC = R.UTC;
    window.Date = D;
  }, clock - Date.now());
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });
  await page.evaluate(() => localStorage.setItem('cubby-quick-uid', 'local'));
  return page;
}

/* Every probe a page can answer, bound to one page. Reads the real rendered nodes. Never
   document.body.textContent: the inline script is IN the body and would happily match every string
   this file looks for. */
function probes(page) {
  /* keepPrefs is the whole point of the dismissal tests: the ledgers and the hide flags live in
     localStorage and a reload must not be what clears them. Every other load starts clean, because
     a test that inherits the previous test's dismissal is measuring the previous test. */
  const load = async (s, keepPrefs) => {
    await page.evaluate((x, keep) => {
      localStorage.setItem('little-log-v1', JSON.stringify(x));
      /* Back to the owner every time. Section 14 signs in as the partner, and without this every
         later section reads keys under the wrong person and quietly measures nothing. */
      localStorage.setItem('cubby-quick-uid', 'local');
      /* Item 34's first-entry line shares .ww-line and DEFERS this one, on purpose: a baby's first
         nap is usually also her first entry, and two dismissible explainers stacked on one home
         screen is the opposite of calm. Every section below is about the wake-window line on its
         own, so this person has already been told what home answers. Section 16 is the one that
         removes this and tests the collision. */
      if (!keep) { try { const m = JSON.parse(localStorage.getItem('cubby-seen-local') || '{}');
        m.tip_firstentry = 1; localStorage.setItem('cubby-seen-local', JSON.stringify(m)); } catch (e) {} }
      if (!keep) Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-ww-') === 0) localStorage.removeItem(k); });
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
    }, s, !!keepPrefs);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1200);
  };
  /* unspendFirstEntryLine() GIVES THE MARK BACK on undo, by design, and section 14 reads as a
     different person under a different seen key. Both make item 34's line eligible again, and it
     legitimately wins the screen, so a wake-window section that did not re-state this would be
     measuring the deference instead of the thing it names. */
  const knowsHome = (u) => page.evaluate((x) => {
    try { const k = 'cubby-seen-' + x; const m = JSON.parse(localStorage.getItem(k) || '{}');
      m.tip_firstentry = 1; localStorage.setItem(k, JSON.stringify(m)); } catch (e) {}
  }, u || 'local');
  const lines = (uid) => page.evaluate((u) => {
    const els = Array.from(document.querySelectorAll('.ww-line'));
    const raw = localStorage.getItem('cubby-ww-notyet-' + u);
    /* The EFFECTIVE allowance, computed the way the app must: ids spoken for that are still in the
       record. Plain JS on purpose, so it returns 0 rather than throwing on a tree with none of
       this, and the assertion goes red instead of the run dying. */
    let spent = -1, entry = {};
    try {
      const l = JSON.parse(raw || '{}') || {};
      entry = (l.b && l.b[state.activeBabyId]) || {};
      const ev = state.events || [];
      spent = (entry.naps || []).filter((id) => ev.some((x) => x.id === id)).length;
      if (l.off) entry.off = 1;
    } catch (e) { spent = -1; }
    return {
      n: els.length,
      log: els.filter((e) => e.classList.contains('ww-log')).length,
      txt: els.map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()),
      aria: els.map((e) => { const x = e.querySelector('.ww-x'); return x ? x.getAttribute('aria-label') : null; }),
      ledger: raw,
      spent: spent,
      entry: entry,
      hidden: localStorage.getItem('cubby-ww-hidden-' + u),
      logHidden: localStorage.getItem('cubby-ww-log-hidden-' + u),
      wwKeys: Object.keys(localStorage).filter((k) => k.indexOf('cubby-ww-notyet-') === 0).sort(),
    };
  }, uid || 'local');
  const stopANap = (startAgoMin) => page.evaluate((mins) => {
    timersFor('b1').sleep = { start: now() - mins * 60000 };
    persist();
    stopSleep('b1');
  }, startAgoMin);
  /* Returns whether the node was actually there instead of throwing. A gate that dies on a missing
     node reports one failure and hides the twenty behind it, which is worthless when the whole
     point of running it against a reverted tree is to see the full red. */
  const clickX = (sel) => page.evaluate((s) => { const x = document.querySelector(s); if (!x) return false; x.click(); return true; }, sel);
  const toLog = async () => { await page.evaluate(() => { go('log'); setLogTab('log'); }); await sleep(400); };
  const toHome = async () => { await page.evaluate(() => go('home')); await sleep(300); };
  return { load, lines, stopANap, clickX, toLog, toHome, knowsHome };
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await pinnedPage(browser, 13, 0);
  const { load, lines, stopANap, clickX, toLog, toHome, knowsHome } = probes(page);

  console.log('\n1. the first nap of a baby\'s life gets an answer instead of an empty slot');
  {
    await load(seed());
    const before = await lines();
    ok('nothing before she has logged anything', before.n === 0, before);
    await stopANap(45);
    const r = await lines();
    ok('stopping the nap puts one line on home', r.n === 1, r);
    ok('it names her baby', /Robin/.test(r.txt[0] || ''), r.txt);
    ok('it says what this line will one day answer', /usually stays awake/.test(r.txt[0] || ''), r.txt);
    ok('it names the source as her family\'s own logs', /your family's logs/i.test(r.txt[0] || ''), r.txt);
    ok('it promises no forecast', /not a forecast/i.test(r.txt[0] || ''), r.txt);
    ok('it carries NO number, so she is never told how many naps she is short',
      !/\d/.test(r.txt[0] || 'x1'), r.txt);
    ok('and it is not the real range, which she has not earned',
      !/slept again between/.test(r.txt[0] || ''), r.txt);
    // "As you log naps" made the offer conditional on her labour, which tips a gift toward a chore.
    ok('it does not make the promise conditional on her logging harder',
      !/as you log/i.test(r.txt[0] || ''), r.txt);
    ok('its × says which surface it clears, not just "Hide this"',
      /home/i.test(r.aria[0] || ''), r.aria);
  }

  console.log('\n2. it is earned by the moment, not permanent furniture');
  {
    // Same too-thin history, but the nap ended forty minutes ago and nothing armed it: she was not
    // there when it happened and an hour later she is doing something else.
    await load(seed({ events: [{ id: 's1', babyId: 'b1', type: 'sleep', time: now - 100 * MIN, end: now - 40 * MIN }] }));
    const r = await lines();
    ok('forty minutes after an unarmed nap, home is quiet', r.n === 0, r);
    ok('and nothing was spent on a paint she never saw', r.spent === 0 && r.ledger === null, r);
  }

  console.log('\n3. at most twice, counted in naps and not in paints');
  {
    await load(seed());
    await stopANap(45);
    const one = await lines();
    ok('first nap: the line is up', one.n === 1, one);
    ok('and one turn is spent', one.spent === 1, one.ledger);

    // Six more paints of the same nap. This is the bug the ledger exists to prevent: home repaints
    // on every timer tick and tab return, and a paint counter would burn both turns in seconds.
    await page.evaluate(() => { for (let i = 0; i < 6; i++) render(); });
    const still = await lines();
    ok('six repaints of the SAME nap leave it up', still.n === 1, still);
    ok('and still cost exactly one turn', still.spent === 1, still.ledger);

    await stopANap(30);
    const two = await lines();
    ok('second nap: the line is up once more', two.n === 1, two);
    ok('and that is the second turn', two.spent === 2, two.ledger);

    await stopANap(20);
    const three = await lines();
    ok('third nap: it has said its piece and stays quiet', three.n === 0, three);
    ok('and the tally stops at two rather than climbing', three.spent === 2, three.ledger);
  }

  console.log('\n4. dismissed for good, without taking the real line with it, and with a way back');
  {
    await load(seed());
    await stopANap(45);
    const up = await lines();
    ok('the line is up to be dismissed', up.n === 1, up);
    ok('it carries an × at all', await clickX('.ww-line .ww-x'));
    await sleep(300);
    const gone = await lines();
    ok('the × closes it', gone.n === 0 && up.n === 1, gone);
    ok('and it is closed for good, not for this paint', gone.entry.off === 1, gone.ledger);
    ok('the real line is NOT collaterally hidden', gone.hidden === null, gone);

    // Irreversible, unannounced, one thumb was the whole objection. The tap answers for itself.
    ok('the dismissal offers Undo rather than being a one-way door', await clickX('#toast .toast-act'));
    await sleep(300);
    const back = await lines();
    ok('and Undo actually brings the line back', back.n === 1, back);
    ok('with the off flag cleared, not just the paint redone', !back.entry.off, back.ledger);

    ok('dismissing it again sticks', await clickX('.ww-line .ww-x'));
    await sleep(6000);   // let the Undo toast lapse rather than clicking it
    await stopANap(15);
    const after = await lines();
    ok('a later nap does not bring it back', after.n === 0, after);

    // The reload is the load-bearing half: a ledger that lives only in memory is not a promise.
    await load(seed({ events: ENOUGH_AWAKE }), true);
    const real = await lines();
    ok('once the fortnight can carry it, the real line appears anyway', real.n === 1, real);
    ok('and it is the range, not the promise', /slept again between/.test(real.txt[0] || ''), real.txt);
    ok('reading 1h 30m to 2h off her own six gaps', /1h 30m/.test(real.txt[0] || '') && /2h/.test(real.txt[0] || ''), real.txt);
  }

  console.log('\n5. the Log surface carries it once the data supports it');
  {
    await load(seed({ events: ENOUGH }));
    const home = await lines();
    ok('home stays quiet: she is not mid-wake-window', home.n === 0, home);
    await toLog();
    const r = await lines();
    ok('exactly one line on Log, not two', r.n === 1 && r.log === 1, r);
    ok('it is the range she actually logged', /between 1h 30m and 2h/.test(r.txt[0] || ''), r.txt);
    ok('it names her baby', /Robin/.test(r.txt[0] || ''), r.txt);
    // "In the day" reads as "back in the day" before it reads as "during daytime", and this phrase
    // carries the entire claim that nights are not in the sample.
    ok('it says the sample is daytime, in words that only mean daytime', /During the day/.test(r.txt[0] || ''), r.txt);
    ok('it names the window as her family\'s last 14 days', /your family's last 14 days/.test(r.txt[0] || ''), r.txt);
    ok('it uses the cycleLengths register', /Just what happened, not a forecast/.test(r.txt[0] || ''), r.txt);
    ok('and it is a description, never a schedule: no next nap, no due, no target',
      !/(next nap|due|should|try|aim|by \d)/i.test(r.txt[0] || ''), r.txt);
    ok('its × says it clears the timeline, not everything', /timeline/i.test(r.aria[0] || ''), r.aria);
  }

  console.log('\n6. with nothing to say it says nothing, on either surface');
  {
    await load(seed({ events: napPair(1, 90, 'only') }));   // two naps, one gap, five short
    await toLog();
    const r = await lines();
    ok('one gap is not a fortnight, so Log is empty', r.n === 0, r);

    // And the promise stays on home where it is earned. Putting it on Log too would be a second
    // voice for a state that is meant to speak once.
    await toHome();
    await stopANap(45);
    const h = await lines();
    ok('the not-yet line is on home', h.n === 1 && h.log === 0, h);
    await toLog();
    const l = await lines();
    ok('and it does not follow her to Log', l.n === 0, l);
  }

  console.log('\n7. a range four hours wide is noise, not insight');
  {
    await load(seed({ events: TOO_WIDE }));
    await toLog();
    const r = await lines();
    ok('Log stays quiet rather than printing 25m to 5h', r.n === 0, r);
    const w = await page.evaluate(() => { const x = wakeWindow(); return { enough: x.enough, n: x.n, spread: x.hi - x.lo }; });
    ok('even though the sample itself is big enough', w.enough === true && w.n === 6, w);
    ok('it is suppressed on width alone', w.spread > 2 * 3600000, w);
  }

  console.log('\n8. it is her baby\'s fortnight, and her baby\'s allowance, not the other baby\'s');
  {
    const twinBabies = [
      { id: 'b1', name: 'Robin', birth: now - 200 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] },
      { id: 'b2', name: 'Wren', birth: now - 200 * DAY, sex: 'M', routines: [], doctors: [], allergies: [] },
    ];
    await load(seed({ babies: twinBabies, activeBabyId: 'b1', events: napDays([90, 90, 100, 100, 120, 120], 'b2') }));
    await toLog();
    const r = await lines();
    ok('Robin has logged nothing, so Robin\'s Log says nothing', r.n === 0, r);

    await page.evaluate(() => { state.activeBabyId = 'b2'; persist(); render(); });
    await sleep(300);
    const r2 = await lines();
    ok('switching to Wren shows Wren\'s line', r2.n === 1 && /Wren/.test(r2.txt[0] || ''), r2);
    ok('and it never says Robin', !/Robin/.test(r2.txt[0] || ''), r2.txt);

    /* The allowance is per baby too. Twins: spend both of Robin's turns, then the parent of the
       other twin must still be told what that child's slot will say. A ledger keyed by person alone
       lets one twin eat the other twin's promise entirely. */
    await load(seed({ babies: twinBabies, activeBabyId: 'b1', events: [] }));
    await stopANap(45); await stopANap(30);
    const rob = await lines();
    ok('Robin has now had both of her turns', rob.spent === 2, rob.ledger);
    await page.evaluate(() => {
      state.activeBabyId = 'b2'; persist();
      timersFor('b2').sleep = { start: now() - 40 * 60000 }; persist();
      stopSleep('b2');
    });
    await sleep(400);
    const wren = await lines();
    ok('and Wren\'s first nap still gets its own promise', wren.n === 1 && /Wren/.test(wren.txt[0] || ''), wren);
    ok('counted against Wren\'s own allowance, not Robin\'s', wren.spent === 1, wren.ledger);
  }

  console.log('\n9. the × on Log clears the timeline only, and it is recoverable');
  {
    await load(seed({ events: ENOUGH }));
    await toLog();
    const up = await lines();
    ok('the line is up to be dismissed', up.n === 1, up);
    ok('it carries an × at all', await clickX('.ww-line.ww-log .ww-x'));
    await sleep(300);
    const gone = await lines();
    ok('it goes', gone.n === 0 && up.n === 1, gone);
    ok('and the flag is written, not just the paint skipped', gone.logHidden === '1', gone);
    /* The whole objection: one × on a browsing surface, where the gesture means "tidy this out of my
       timeline", used to permanently destroy the home line as well. */
    ok('it does NOT reach across and kill the home line too', gone.hidden === null, gone);

    ok('the dismissal offers Undo', await clickX('#toast .toast-act'));
    await sleep(400);
    const back = await lines();
    ok('and Undo brings the timeline line back', back.n === 1 && back.log === 1, back);
    ok('with the flag cleared on disk', back.logHidden === null, back);

    ok('dismissing it again sticks', await clickX('.ww-line.ww-log .ww-x'));
    await sleep(6000);   // let the Undo toast lapse
    await load(seed({ events: ENOUGH_AWAKE }), true);
    const home = await lines();
    ok('home still speaks, because she only tidied her timeline', home.n === 1 && /slept again between/.test(home.txt[0] || ''), home);
    await toLog();
    const log = await lines();
    ok('and Log stays quiet across a reload', log.n === 0, log);

    // And the home × is the mirror image: it clears home and leaves the timeline alone.
    await toHome();
    ok('home carries an × too', await clickX('.ww-line .ww-x'));
    await sleep(300);
    const h2 = await lines();
    ok('home goes quiet', h2.n === 0 && h2.hidden === '1', h2);
    ok('and it did not reach into the timeline flag', h2.logHidden === '1', h2);
  }

  console.log('\n10. 22:00: the promise is not a daytime feature');
  {
    /* wwIsDaytime is 6am to 8pm and belongs to the REAL line, which makes a live claim about the
       nap that is coming. The not-yet line claims nothing about now, and the parent it exists for
       is the one whose baby still naps round the clock. Inheriting that gate killed it for ten
       hours of every day, for exactly its own audience. */
    const night = await pinnedPage(browser, 22, 0);
    const P = probes(night);
    await P.load(seed());
    await P.stopANap(45);
    const r = await P.lines();
    ok('stopping a nap at 22:00 still gets an answer', r.n === 1, r);
    ok('and it is the promise, word for word', /usually stays awake/.test(r.txt[0] || ''), r.txt);
    ok('and the turn is actually reserved, not silently dropped', r.spent === 1, r.ledger);

    // The real line must stay daytime-gated: a range at 22:00 would be a bedtime prediction.
    await P.load(seed({ events: ENOUGH_AWAKE }));
    const real = await P.lines();
    ok('but the real range stays silent at 22:00, as it should', real.n === 0, real);
    await P.toLog();
    const log = await P.lines();
    ok('while the Log description reads the same at any hour', log.n === 1 && log.log === 1, log);
    await night.close();
  }

  console.log('\n11. 05:30: the same, on the other side of the night');
  {
    const dawn = await pinnedPage(browser, 5, 30);
    const P = probes(dawn);
    await P.load(seed());
    await P.stopANap(45);
    const r = await P.lines();
    ok('stopping a nap at 05:30 gets an answer', r.n === 1, r);
    ok('and it is the promise', /usually stays awake/.test(r.txt[0] || ''), r.txt);
    ok('and the turn is reserved', r.spent === 1, r.ledger);
    await dawn.close();
  }

  console.log('\n12. she stopped the nap from Log, so the promise waits for her on home');
  {
    /* Stop is on the timer banner on every tab and stopSleep does not send her home. A window
       measured from the nap's end alone meant the parent who stopped from Log and came back eleven
       minutes later never saw it for that nap at all. */
    /* Stopped through the REAL control, not through stopSleep() in JS: the timer banner sits on all
       four tabs, and the whole failure was that its Stop is reachable from a surface the line does
       not live on. A fixture that calls stopSleep directly cannot see a Stop that became
       unreachable. */
    await load(seed());
    await toLog();
    await page.evaluate(() => { timersFor('b1').sleep = { start: now() - 45 * 60000 }; persist(); render(); });
    await sleep(300);
    ok('Stop really is on the Log tab, where the line is not', await clickX('.active-banner .stop-btn'));
    await sleep(400);
    const onLog = await lines();
    ok('nothing appears on Log, which is right: the line lives on home', onLog.n === 0, onLog);
    ok('but the nap is held for her rather than lost', !!(onLog.entry && onLog.entry.arm), onLog.ledger);
    ok('and no turn is spent on a paint she never saw', onLog.spent === 0, onLog.ledger);

    // Eleven minutes pass before she opens home. The old ten-minute window has closed.
    await page.evaluate(() => {
      const e = (state.events || []).filter((x) => x.type === 'sleep' && x.end).sort((a, b) => b.end - a.end)[0];
      e.end = now() - 11 * 60000; persist();
    });
    await toHome();
    const r = await lines();
    ok('home shows her the promise when she gets there', r.n === 1, r);
    ok('and it is the promise, not the range', /usually stays awake/.test(r.txt[0] || ''), r.txt);
    ok('and only now is a turn spent', r.spent === 1, r.ledger);

    // But it is a moment, not a bookmark: a nap she stopped seven hours ago is not news.
    await load(seed());
    await toLog();
    await stopANap(45);
    await page.evaluate(() => {
      const e = (state.events || []).filter((x) => x.type === 'sleep' && x.end).sort((a, b) => b.end - a.end)[0];
      e.end = now() - 7 * 3600000; persist();
    });
    await toHome();
    const stale = await lines();
    ok('seven hours later the moment has passed and home is quiet', stale.n === 0, stale);
    ok('and the turn is still hers to spend', stale.spent === 0, stale.ledger);
  }

  console.log('\n13. a corrected mis-tap does not cost her half the allowance');
  {
    /* stopSleep ends in loggedToast(..., [_sid], 'sleep'), and undoLast() HARD-removes the event.
       A turn spent on a nap that never happened is a turn taken from a parent for being careful. */
    await load(seed());
    await stopANap(45);
    const one = await lines();
    ok('the nap spends a turn', one.spent === 1, one.ledger);

    await page.evaluate(() => undoLast());
    await knowsHome('local');   // undo handed the first-entry mark back; this section is not about that
    await sleep(400);
    const undone = await lines();
    ok('Undo takes the line away with the nap', undone.n === 0, undone);
    ok('and gives the turn back, because that nap never happened', undone.spent === 0, undone.ledger);

    await stopANap(40);
    const relog = await lines();
    ok('re-logging the same nap shows the promise again', relog.n === 1, relog);
    ok('and it is still her FIRST turn, not her second', relog.spent === 1, relog.ledger);
    ok('and the undone nap is not left lying in the ledger', (relog.entry.naps || []).length === 1, relog.ledger);

    await stopANap(30);
    const two = await lines();
    ok('so she still gets a genuine second turn', two.n === 1 && two.spent === 2, two.ledger);
  }

  console.log('\n14. the partner who arrives later gets her own two turns');
  {
    await load(seed());
    await stopANap(45); await stopANap(30);
    const owner = await lines();
    ok('the owner has spent both of hers', owner.spent === 2, owner.ledger);
    ok('under a key that names her', owner.wwKeys.join(',') === 'cubby-ww-notyet-local', owner.wwKeys);

    await page.evaluate(() => localStorage.setItem('cubby-quick-uid', 'partner'));
    await knowsHome('partner');
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1200);
    await stopANap(25);
    const partner = await lines('partner');
    ok('the partner is told what the slot will say', partner.n === 1, partner);
    ok('out of her own allowance', partner.spent === 1, partner.ledger);
    ok('written under her own key, not into the owner\'s', partner.wwKeys.join(',') === 'cubby-ww-notyet-local,cubby-ww-notyet-partner', partner.wwKeys);
    const ownerAfter = await lines('local');
    // Guarded rather than chained: on a tree with a flat, person-only ledger there is no .b at all,
    // and a TypeError here would kill the run and hide every section after it.
    let ownerNaps = -1;
    try { const l = JSON.parse(ownerAfter.ledger || '{}'); ownerNaps = ((l.b && l.b.b1 && l.b.b1.naps) || []).length; } catch (e) { ownerNaps = -1; }
    ok('and the owner\'s ledger is untouched by any of it', ownerNaps === 2, ownerAfter.ledger);
  }

  console.log('\n15. the printed sentence matches the record she can count herself');
  {
    /* w.n is the number of GAPS between naps, not the number of naps. The subtitle used to label it
       "naps", so a parent who logged twelve read "6 naps" and could only conclude that Cubby had
       lost half her record. Legibility is the wedge; a sample line that misstates the sample is the
       one thing this feature cannot afford. */
    await load(seed({ events: ENOUGH }));
    const counts = await page.evaluate(() => ({
      naps: (state.events || []).filter((e) => e.type === 'sleep' && e.end).length,
      gaps: wakeWindow().n,
    }));
    ok('the fixture really is twelve naps and six gaps', counts.naps === 12 && counts.gaps === 6, counts);
    await toLog();
    const r = await lines();
    ok('the line says six gaps between naps', /6 gaps between naps/.test(r.txt[0] || ''), r.txt);
    ok('and never claims she logged six naps', !/\b6 naps\b/.test(r.txt[0] || ''), r.txt);
    ok('nor calls a fortnight of her family\'s logs "your own"', !/your own logs/i.test(r.txt[0] || ''), r.txt);

    // Home and Log are one feature and must sign off the same way. Two closers for one dataset is
    // two voices for one parent.
    await load(seed({ events: ENOUGH_AWAKE }));
    const home = await lines();
    const homeTxt = home.txt[0] || '';
    await toLog();
    const log = await lines();
    const logTxt = log.txt[0] || '';
    ok('home carries the identical source sentence', /From 6 gaps between naps in your family's last 14 days\. Just what happened, not a forecast\./.test(homeTxt), homeTxt);
    ok('and so does Log', /From 6 gaps between naps in your family's last 14 days\. Just what happened, not a forecast\./.test(logTxt), logTxt);
    ok('so the feature does not sign off two different ways', !/Every day is different/.test(homeTxt + logTxt), [homeTxt, logTxt]);
  }

  console.log('\n16. loss holding silences both surfaces');
  {
    await load(seed({ events: ENOUGH_AWAKE }));
    await page.evaluate(() => { window.myLossHolding = function () { return true; }; render(); });
    await sleep(300);
    const h = await lines();
    ok('home carries nothing while she is holding a loss', h.n === 0, h);
    await toLog();
    const l = await lines();
    ok('and neither does Log', l.n === 0, l);
    await page.reload({ waitUntil: 'networkidle2' }); await sleep(800);
  }

  console.log('\n17. it stands down for the first-entry line, and keeps its turn');
  {
    /* A real first nap on a brand new household: item 34's line and this one are both due on the
       same paint. Without the deference she gets two explainers and two crosses at once. */
    await load(seed());
    await page.evaluate(() => { try { const m = JSON.parse(localStorage.getItem('cubby-seen-local') || '{}');
      delete m.tip_firstentry; localStorage.setItem('cubby-seen-local', JSON.stringify(m)); } catch (e) {} });
    await page.reload({ waitUntil: 'networkidle2' }); await sleep(1200);
    await stopANap(45);
    const r = await lines();
    ok('one line on home, not two', r.n === 1, r);
    ok('and it is the first-entry line that speaks', /top of your home screen/.test(r.txt[0] || ''), r.txt);
    ok('the wake-window promise is not made twice over', !/usually stays awake/.test((r.txt[0] || '')), r.txt);
    ok('and its turn is NOT spent on a line nobody saw', r.spent === 0, r);

    /* The next nap: the first-entry line is done, so the promise it deferred is still owed. */
    await page.evaluate(() => { dismissFirstEntryLine(); });
    await stopANap(50);
    const r2 = await lines();
    ok('the next nap gets the wake-window promise after all', /usually stays awake/.test(r2.txt[0] || ''), r2.txt);
    ok('and only then is a turn spent', r2.spent === 1, r2);
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));

  /* ---- --self-test: put the pre-fix behaviour back in a live page and require the probe to flip ----
     Every name below is a top-level function declaration in the inline script, so assigning
     window.<name> genuinely replaces what the render functions call. */
  let selfBad = 0;
  if (SELF_TEST) {
    console.log('\n--self-test: revert each rule in the page and require its probe to fail');
    const chk = (n, c, x) => { if (c) { console.log('  ok   ' + n); } else { selfBad++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

    /* (a) the daytime gate, put back over the not-yet branch. The branch's position cannot be moved
       from outside, so the pre-fix EFFECT is reproduced instead: the promise refused outside 6am to
       8pm. Run at 22:00, which is the hour the shipped code was silent. */
    const night = await pinnedPage(browser, 22, 0);
    const N = probes(night);
    await N.load(seed());
    await N.stopANap(45);
    const dayOn = await N.lines();
    chk('at 22:00 the promise is up', dayOn.n === 1, dayOn.n);
    await N.load(seed());
    await night.evaluate(() => {
      const orig = window.wwNotYetAllows;
      window.wwNotYetAllows = function (b, n) { return wwIsDaytime(now()) && orig(b, n); };
    });
    await N.stopANap(45);
    const dayOff = await N.lines();
    chk('with the daytime gate back over it the promise vanishes, so sections 10 and 11 can fail', dayOff.n === 0, dayOff.n);
    await night.close();

    // (b) the arm, reverted to a no-op: the nap stopped from Log is lost again.
    await load(seed());
    await page.evaluate(() => { window.wwNotYetArm = function () {}; });
    await toLog();
    await stopANap(45);
    await page.evaluate(() => {
      const e = (state.events || []).filter((x) => x.type === 'sleep' && x.end).sort((a, b) => b.end - a.end)[0];
      e.end = now() - 11 * 60000; persist();
    });
    await toHome();
    const noArm = await lines();
    chk('with wwNotYetArm a no-op the promise is lost again, so section 12 can fail', noArm.n === 0, noArm.n);

    // (c) the source sentence, reverted to the "naps" wording.
    await load(seed({ events: ENOUGH }));
    await page.evaluate(() => {
      window.wwSource = function (w) { return 'From the last ' + w.days + ' days of your own logs, ' + w.n + ' nap' + (w.n === 1 ? '' : 's') + '. Just what happened, not a forecast.'; };
    });
    await toLog();
    const oldSrc = await lines();
    chk('with the old subtitle it says "6 naps" again, so section 15 can fail', /6 naps/.test(oldSrc.txt[0] || ''), oldSrc.txt);

    // (d) the Log hide flag, reverted to the shared key.
    await load(seed({ events: ENOUGH }));
    await page.evaluate(() => { window.wwLogHidden = window.wwHidden; window.hideWwLog = window.hideWakeWindow; });
    await toLog();
    await clickX('.ww-line.ww-log .ww-x');
    await sleep(300);
    const shared = await lines();
    chk('with one shared key the Log × writes the home flag, so section 9 can fail', shared.hidden === '1', shared.hidden);
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (SELF_TEST) console.log('self-test: ' + (selfBad ? selfBad + ' probe(s) could not go red' : 'all four rules proved failable'));
  console.log((fail || selfBad) ? 'WAKE-WINDOW-VOICE: FAIL' : 'WAKE-WINDOW-VOICE: PASS');
  process.exit((fail || selfBad) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
