#!/usr/bin/env node
/* The trying-stage home showed a woman two things about the same body, one under the other, and
 * only one of them was hers.
 *
 * "Your cycles so far" was built from cycleLengths(), her actual recorded starts. The fertile
 * window directly above it was built from p.cycleLen, the single number she typed into the setup
 * sheet in month one and may never have opened again. So a woman whose card said "your last four
 * cycles ran 33 to 35 days" was handed a window placed on 28, roughly a week early, every month.
 *
 * The same stale 28 decided when Cubby stopped believing itself: fertileEstimate goes stale ten
 * days past the predicted next period, so on day 39 of a cycle that has never once come in under
 * 33 days, a woman trying to conceive was told "it's been a while since the last one we know
 * about... if you think you might be pregnant, take a test". Cubby invented a late period out of
 * a number it had already been given the evidence to replace, at the exact moment she is least
 * able to hold it lightly.
 *
 * The window now comes from her own cycles once there are two: her shortest and longest set both
 * ends, the card names the source, and cycleLen is the first-cycle fallback and nothing more.
 *
 * A first cut of this anchored the staleness gate on the MEDIAN of her cycles, and two reviewers
 * reproduced the same harm coming back through the other door: a median sits below her longest by
 * definition, so on cycles of 29, 30, 31 and 45 days Cubby declared her period late on day 42,
 * three days before her own longest recorded cycle was even due, on the same screen that said
 * "your last four cycles ran 29 to 45 days". Cases 5 and 5b below are that reproduction, and they
 * fail against the median build. The grace period is her LONGEST cycle plus ten days.
 *
 * The same reviewers found the ✨ headline stuck on for two thirds of every month on an irregular
 * body (a 24-38 day range gives a 21-day span), two cards stacked both telling her to take a test,
 * and a period start that vanished on reload because persist() writes nowhere without a household.
 * Cases 12, 5b and 11 are those three.
 *
 *   PORT=9312 node tools/serve.js &
 *   node tools/cycle_median_check.js http://localhost:9312
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:9312';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

// 09:00. Every date in here is a whole number of days from the pinned clock, so no assertion can
// land on a boundary that only exists because the suite happened to run near midnight.
const CLOCK = (() => { const d = new Date(); d.setHours(9, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

const HONEST = 'Even careful estimates pick the wrong day most of the time, so hold it lightly.';
const WIDE = "That's a wide stretch because it reaches from your shortest cycle to your longest.";

/* THE SPEC, stated here in the words it was agreed in rather than copied as offsets from the
   implementation. Ovulation lands a luteal phase before the next period; the fertile window is
   the five days before it (sperm), ovulation day itself, and the day after (egg). Everything the
   gate expects is derived from these three numbers, so changing the implementation's -19/-13 to
   -18/-12 turns cases 1, 2, 6, 7, 8 and 12 red instead of sliding through. */
const LUTEAL = 14, BEFORE = 5, AFTER = 1;
const WINDOW_DAYS = BEFORE + 1 + AFTER;      // 7 for a body whose cycles all run the same length
const STALE_GRACE = 10;                      // days past the next period her LONGEST cycle implies
const TIGHT = 10;                            // wider than this and it is no longer a "window"

/* gaps = the cycle lengths she actually lived, oldest first; endsAgo = days since the newest
   period start. Returns the period-start list the app stores, so every case below is described
   the way a woman would describe it ("34, 35 and 36 days, and I'm on day 40") rather than in
   absolute milliseconds. */
const starts = (gaps, endsAgo) => {
  const out = [now - endsAgo * DAY];
  for (let i = gaps.length - 1; i >= 0; i--) out.unshift(out[0] - gaps[i] * DAY);
  return out;
};
const planning = (over) => Object.assign({
  id: 'p1', ownerUid: 'local', stage: 'planning', dueDate: null, lmp: null, cycleLen: 28,
  periods: [], tryingSince: null, country: 'gb', precon: [],
  careTeam: [], appts: [], symptoms: [], weights: [], bp: [], kicks: [], contractions: [],
  birthPlan: '', bag: [], moments: [], conditions: {}, glucose: [], urine: [], supplements: [],
  supplementLog: [], nausea: [], glucoseUnit: 'mmol', bornBabyId: null, observations: [],
  createdAt: now - 200 * DAY,
}, over || {});
// A record with a real period history: lmp stays the newest start, the way savePeriodUpdate keeps it.
const withCycles = (gaps, endsAgo, cycleLen) => {
  const h = starts(gaps, endsAgo);
  return planning({ periods: h, lmp: h[h.length - 1], cycleLen: cycleLen });
};
const seed = (p) => ({ babies: [], activeBabyId: null, events: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], notes: [], pregnancy: p });

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

  const settle = async () => {
    await sleep(1400);
    await page.evaluate(() => { try { window.__toasts = []; window.toast = function (m) { window.__toasts.push(m); }; } catch (e) {} });
    await sleep(200);
  };
  const load = async (s) => {
    await page.evaluate((x) => {
      localStorage.setItem('little-log-v1', JSON.stringify(x));
      Object.keys(localStorage).forEach((k) => {
        // The card is opt-out per person and the two-week-wait card is dismissed per cycle; a
        // dismissal left over from an earlier case would hide the thing under test.
        if (k.indexOf('cubby-theme') === 0 || k.indexOf('cubby-fertile-hidden') === 0 || k.indexOf('cubby-tww-hidden') === 0) localStorage.removeItem(k);
      });
    }, s);
    await page.reload({ waitUntil: 'networkidle2' });
    await settle();
  };

  /* Reads the rendered card, never document.body.textContent (which contains the inline script's
     own source and would match every string in this file). Returns the count of matching cards
     too: "the wrong copy is absent" is worthless if the card never rendered at all. */
  const card = () => page.evaluate(() => {
    const titles = Array.from(document.querySelectorAll('.pc-t'))
      .filter((e) => /fertile window|last period|Update your period/i.test(e.textContent || ''));
    const el = titles[0];
    const wrap = el && el.parentElement ? el.parentElement : null;
    const body = wrap ? wrap.querySelector('.pc-b') : null;
    const ico = wrap && wrap.parentElement ? wrap.parentElement.querySelector('.pc-ico') : null;
    return { n: titles.length,
      title: el ? (el.textContent || '').trim() : null,
      ico: ico ? (ico.textContent || '').trim() : null,
      body: body ? (body.textContent || '').replace(/\s+/g, ' ').trim() : null };
  });
  /* Every card on the trying home that suggests she take a test. Two of them on one screen is the
     defect; the obs prompt's "Test results, body signs" is not a suggestion and stays out. */
  const testCards = () => page.evaluate(() => Array.from(document.querySelectorAll('.preg-card'))
    .map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim())
    .filter((t) => /take a test|a test might tell you/i.test(t)));
  const bodies = () => page.evaluate(() => Array.from(document.querySelectorAll('.pc-b')).map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()));
  /* The dates the SPEC says the card should carry, formatted by Chrome in the page so the
     comparison is against its own locale output, but computed from state.pregnancy.lmp and the
     constants above rather than from anything fertileEstimate returned. */
  const windowDates = (lo, hi) => page.evaluate((a, b, lut, bef, aft) => {
    const p = state.pregnancy, D = 86400000;
    const f = (ms) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const openMs = Math.max(p.lmp, p.lmp + (a - lut - bef) * D), closeMs = p.lmp + (b - lut + aft) * D;
    return { start: f(openMs), end: f(closeMs), lmp: f(p.lmp),
      width: Math.round((closeMs - openMs) / D) + 1 };
  }, lo, hi, LUTEAL, BEFORE, AFTER);
  const est = () => page.evaluate(() => {
    const fe = fertileEstimate();
    return { fe: fe, cl: cycleLengths(), lmp: state.pregnancy && state.pregnancy.lmp };
  });

  console.log('\n1. month one: the number she typed is still all we have');
  {
    await load(seed(withCycles([], 6, 31)));
    const r = await est();
    ok('no completed cycles yet', r.cl.length === 0, r.cl);
    ok('so nothing is claimed about a source', r.fe.from === 0, r.fe);
    const s = await windowDates(31, 31);
    const c = await card();
    ok('the window card is on screen, once', c.n === 1, c);
    ok('and it is placed on her typed 31 days', c.body === 'Somewhere around ' + s.start + ' to ' + s.end + '. ' + HONEST, { got: c.body, want: s });
    ok('with no source line, because there is no source', c.body.indexOf('from your last') < 0, c.body);
    // The spec, restated: five days before ovulation through the day after it, ovulation a luteal
    // phase before the next period. On one settled length that is exactly seven days.
    ok('a settled cycle gets exactly the ' + WINDOW_DAYS + '-day window, no wider', r.fe.span === WINDOW_DAYS, r.fe);
    ok('which is what the dates on screen span', s.width === WINDOW_DAYS, s);
  }

  console.log('\n2. four real cycles beat a setup number she never went back to');
  {
    // 33, 34, 33, 35 days. cycleLen is the stale 28 from month one.
    await load(seed(withCycles([33, 34, 33, 35], 8, 28)));
    const r = await est();
    ok('four completed cycles are read', r.cl.length === 4 && r.cl.join(',') === '33,34,33,35', r.cl);
    ok('and named as the source', r.fe.from === 4, r.fe);
    const mine = await windowDates(33, 35);
    const stale = await windowDates(28, 28);
    const c = await card();
    ok('one fertile-window card', c.n === 1 && /fertile window/i.test(c.title || ''), c);
    ok('the window spans her shortest to her longest cycle', c.body.indexOf('Somewhere around ' + mine.start + ' to ' + mine.end) === 0, { got: c.body, want: mine });
    /* Whole dates, not substrings. This was `indexOf(stale.start) < 0` and it went red on a CORRECT
       card: her window read "Sep 6 to Sep 14" and the 28-day start was "Sep 1", which is a substring
       of "Sep 14". The gate was reporting a fertile-window regression that did not exist, and the
       matching `end` line passed only by luck, because "Sep 7" happened not to collide. A gate that
       is red for a reason it does not name teaches people to ignore the suite. */
    const absent = (d) => !new RegExp('\\b' + String(d).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(c.body);
    ok('the old 28-day start is nowhere in it', absent(stale.start), { got: c.body, stale: stale });
    ok('nor the old 28-day end', absent(stale.end), { got: c.body, stale: stale });
    /* Paired, so the two lines above cannot quietly become no-ops: the same matcher, run against a
       body that really does carry the 28-day dates, has to find them. */
    ok('and that matcher would still catch a real 28-day card',
       new RegExp('\\b' + stale.start + '\\b').test('Somewhere around ' + stale.start + ' to ' + stale.end + ', from your last four cycles.'),
       'the staleness matcher has stopped matching anything');
    ok('the card says where the dates came from', c.body.indexOf('from your last four cycles') > 0, c.body);
    ok('the honesty line survives word for word', c.body.slice(-HONEST.length) === HONEST, c.body);
    // The app's own two ends, not the gate's: a single circled day is the one thing this card
    // has always refused to be.
    ok('and it is still a range, never a day to circle', r.fe.start !== r.fe.end, r.fe);
    ok('two days wider than a settled body, because she is two days more varied', r.fe.span === WINDOW_DAYS + 2, r.fe);
    // The neighbour card must not switch register: "from your last four cycles" above
    // "Your last 4 cycles" was two voices in one screenshot.
    const b = await bodies();
    ok('the look-back card spells the count out too', b.some((t) => t.indexOf('Your last four cycles ran 33 to 35 days.') === 0), b);
    ok('and no card on the screen says "Your last 4"', !b.some((t) => /Your last 4 /.test(t)), b);
  }

  console.log('\n3. Cubby stops inventing a late period out of a stale number');
  {
    // Her cycles have never come in under 34 days. She is on day 40.
    await load(seed(withCycles([34, 35, 36], 40, 28)));
    const c = await card();
    ok('day 40 of a 35-day body is not "update your period"', !/Update your period/i.test(c.title || ''), c);
    ok('she is not told to take a test', (c.body || '').indexOf('take a test') < 0, c);
    ok('the window is still hers, from three cycles', (c.body || '').indexOf('from your last three cycles') > 0, c);
  }

  console.log('\n4. but a genuinely late one is still noticed, on her longest cycle plus ten');
  {
    /* Her longest is 36, so the grace runs to day 46. The boundary itself is left alone on
       purpose: the page's clock keeps running while the suite does, so an assertion pinned to the
       exact millisecond of day 46 would flip on how long Chrome took to boot. Day 45 and day 47
       bracket it to within one day and never flake. */
    await load(seed(withCycles([34, 35, 36], 36 + STALE_GRACE - 1, 28)));
    const edge = await est();
    ok('a day inside the grace is not late', edge.fe.stale !== true, edge.fe);
    await load(seed(withCycles([34, 35, 36], 36 + STALE_GRACE + 1, 28)));
    const c = await card();
    ok('the stale card comes back the day after', /Update your period/i.test(c.title || ''), c);
    ok('gently, with the test mentioned once', (c.body || '').indexOf('take a test') > 0, c);
    const r = await est();
    ok('and fertileEstimate says stale, not a window', r.fe.stale === true && !r.fe.start, r.fe);
  }

  console.log('\n5. an irregular body is not told her period is late before her own longest cycle is due');
  {
    /* 29, 30, 31 and then a 45-day month, and she is on day 42. Reviewers reproduced the median
       build declaring her late here: median 31 plus ten is day 41, three days before the 45-day
       cycle sitting in her own record is even due, directly above a card reading "your last four
       cycles ran 29 to 45 days". The grace runs from her LONGEST, so day 42 is her window. */
    await load(seed(withCycles([29, 30, 31, 45], 42, 40)));
    const r = await est();
    ok('all four gaps count as cycles', r.cl.join(',') === '29,30,31,45', r.cl);
    ok('day 42 is not late for a body that has run 45 days', r.fe.stale !== true, r.fe);
    const c = await card();
    ok('so she keeps her window instead of being asked to update', !/Update your period/i.test(c.title || ''), c);
    ok('and nothing on that card tells her to take a test', (c.body || '').indexOf('take a test') < 0, c);
    ok('the dates are still her own spread', c.body.indexOf('from your last four cycles') > 0, c.body);
    const mine = await windowDates(29, 45);
    ok('shortest to longest, exactly', c.body.indexOf('Somewhere around ' + mine.start + ' to ' + mine.end) === 0, { got: c.body, want: mine });

    // The grace itself: 45 + 10, bracketed a day either side (see case 4 on the clock).
    await load(seed(withCycles([29, 30, 31, 45], 45 + STALE_GRACE - 1, 40)));
    ok('day 54 is still inside the grace', (await est()).fe.stale !== true);
    await load(seed(withCycles([29, 30, 31, 45], 45 + STALE_GRACE + 1, 40)));
    ok('and day 56 is where Cubby finally asks', (await est()).fe.stale === true);
  }

  console.log('\n5b. never two cards on one screen both telling her to take a test');
  {
    // Day 46: past her longest (45), so the two-week-wait card is eligible. It must be the only
    // one. The median build showed this card AND the stale card together.
    await load(seed(withCycles([29, 30, 31, 45], 46, 40)));
    const t = await testCards();
    ok('one card mentions a test, gently, and only one', t.length === 1, t);
    ok('and it is the quiet two-week-wait one', /a test might tell you more/i.test(t[0] || ''), t);
    // Day 60: the stale card is up now. The two-week-wait card must stand down rather than stack.
    await load(seed(withCycles([29, 30, 31, 45], 60, 40)));
    const c = await card();
    ok('now the update door is showing', /Update your period/i.test(c.title || ''), c);
    const t2 = await testCards();
    ok('still exactly one card about a test', t2.length === 1, t2);
    ok('and it is the one with the door on it', /Update your period|take a test 🤍/i.test(t2[0] || ''), t2);
  }

  console.log('\n6. a gap that is not a cycle stays out of the maths');
  {
    // A break of 150 days, then 27, 28 and 29-day cycles. cycleLengths drops the break.
    await load(seed(withCycles([150, 27, 28, 29], 7, 28)));
    const r = await est();
    ok('the 150-day break is not a cycle', r.cl.join(',') === '27,28,29', r.cl);
    const c = await card();
    ok('the card counts three, not four', (c.body || '').indexOf('from your last three cycles') > 0, c);
    const mine = await windowDates(27, 29);
    ok('and the break never widens the window', c.body.indexOf('Somewhere around ' + mine.start + ' to ' + mine.end) === 0, { got: c.body, want: mine });
    ok('nor the grace period: it runs off her longest cycle of 29, not the 150-day break', r.fe.stale !== true, r.fe);
    ok('and the window is only as wide as 27 to 29 makes it', r.fe.span === WINDOW_DAYS + 2, r.fe);
  }

  console.log('\n7. a long history is capped at six, and says six');
  {
    await load(seed(withCycles([26, 27, 28, 29, 30, 31, 32, 33], 5, 28)));
    const r = await est();
    ok('only the last six cycles are kept', r.cl.join(',') === '28,29,30,31,32,33', r.cl);
    const c = await card();
    ok('the card says six, spelled out', (c.body || '').indexOf('from your last six cycles') > 0, c);
    const mine = await windowDates(28, 33);
    ok('and the dropped 26-day cycle does not set the start', c.body.indexOf('Somewhere around ' + mine.start + ' to ' + mine.end) === 0, { got: c.body, want: mine });
  }

  console.log('\n8. a very short cycle cannot date the window before the period itself');
  {
    // cycleLengths() accepts anything from 15 days, and 15 - 14 - 5 is four days BEFORE the start.
    await load(seed(withCycles([15, 16, 17], 3, 28)));
    const r = await est();
    ok('three short cycles are read', r.cl.join(',') === '15,16,17', r.cl);
    const s = await windowDates(15, 17);
    const c = await card();
    // Against what the app rendered, not against the gate's own Math.max: the clamp is the thing
    // under test, so the assertion has to be able to see it missing.
    ok('the window opens on the period start, not before it', r.fe.start === s.lmp, { fe: r.fe, lmp: s.lmp });
    ok('and that is what the card shows', c.body.indexOf('Somewhere around ' + s.start + ' to ' + s.end) === 0, { got: c.body, want: s });
    ok('still a range, not one day', r.fe.start !== r.fe.end, r.fe);
  }

  console.log('\n9. nothing recorded, nothing claimed');
  {
    await load(seed(planning()));
    const r = await est();
    ok('no lmp means no estimate at all', r.fe === null, r.fe);
    const c = await card();
    ok('she is invited to add a period', /Add your last period/i.test(c.title || ''), c);
    ok('and no source is named', (c.body || '').indexOf('from your last') < 0, c);
  }

  console.log('\n10. her cycles are hers: a partner sees none of this');
  {
    await load(seed(withCycles([33, 34, 33, 35], 8, 28)));
    const before = await card();
    ok('she sees the card', before.n === 1, before);
    const r = await page.evaluate(() => {
      window.LL = { auth: { currentUser: { uid: 'local' } }, members: { local: 'owner' },
        memberInfo: { local: { name: 'Sam', relationship: 'Papa Bear' } } };
      render();
      const titles = Array.from(document.querySelectorAll('.pc-t')).map((e) => (e.textContent || '').trim());
      const bodies = Array.from(document.querySelectorAll('.pc-b')).map((e) => (e.textContent || '').trim());
      const g = document.querySelector('.greeting');
      return { carrier: viewerIsCarrier(), titles: titles, joined: bodies.join(' | '),
        greeting: g ? (g.textContent || '').trim() : null };
    });
    ok('he is not the carrier', r.carrier === false, r);
    // A positive control that only his home can satisfy: "he has cards of his own" was true of
    // any card at all, including hers.
    ok('he is on the partner home, not a blank screen', /Getting ready, together/.test(r.greeting || ''), r.greeting);
    ok('none of them is the window', r.titles.filter((t) => /fertile window/i.test(t)).length === 0, r.titles);
    ok('and none of them counts her cycles', r.joined.indexOf('from your last') < 0, r.joined);
  }

  console.log('\n11. the day she logs a period, the window moves with her, and it survives a relaunch');
  {
    // Three cycles of 33, 34, 33 and she is on day 33 today.
    await load(seed(withCycles([33, 34, 33], 33, 28)));
    const before = await card();
    ok('three cycles before the tap', (before.body || '').indexOf('from your last three cycles') > 0, before);
    const saved = await page.evaluate(() => {
      openPeriodUpdate();
      const f = new Date();
      const ymd = f.getFullYear() + '-' + String(f.getMonth() + 1).padStart(2, '0') + '-' + String(f.getDate()).padStart(2, '0');
      document.getElementById('puDate').value = ymd;
      savePeriodUpdate();
      return { periods: state.pregnancy.periods.length, lmp: state.pregnancy.lmp, cl: cycleLengths() };
    });
    await sleep(600);
    ok('the start is filed', saved.periods === 5, saved);
    ok('and closes a fourth cycle', saved.cl.join(',') === '33,34,33,33', saved.cl);
    const after = await card();
    ok('the card now counts four', (after.body || '').indexOf('from your last four cycles') > 0, after);
    ok('and the dates have moved', after.body !== before.body, { before: before.body, after: after.body });
    const mine = await windowDates(33, 34);
    ok('onto the new period start', after.body.indexOf('Somewhere around ' + mine.start + ' to ' + mine.end) === 0, { got: after.body, want: mine });

    /* The honest relaunch: nothing re-seeded by hand, just a reload, the way her phone does it.
       store-firebase.js replaces persist() with a cloud push (store-firebase.js:2155) and pushNow
       returns on the spot with no household, so before this a woman tracking alone before she
       signs in or joins a circle wrote her period start nowhere and lost it the moment she came
       back. The earlier version of this case re-seeded localStorage itself and so passed straight
       through that loss. */
    const stored = await page.evaluate(() => {
      try { return (JSON.parse(localStorage.getItem('little-log-v1')) || {}).pregnancy.periods.length; }
      catch (e) { return -1; }
    });
    ok('the start reached the device, not just the screen', stored === 5, stored);
    await page.reload({ waitUntil: 'networkidle2' });
    await settle();
    const back = await card();
    ok('and a real relaunch rebuilds the same window', back.body === after.body, { after: after.body, back: back.body });
    ok('with the fourth cycle still counted', (back.body || '').indexOf('from your last four cycles') > 0, back);
  }

  console.log('\n12. a wide spread stays honest instead of turning into a month-long ✨');
  {
    /* Cycles of 24, 31, 26 and 38 days give a 21-day span inside a ~31-day cycle. Headlining that
       as "You may be in your fertile window" lights the card up for two thirds of every month,
       forever, for exactly the women most anxious about it. Day 12 is inside the span. */
    await load(seed(withCycles([24, 31, 26, 38], 12, 28)));
    const r = await est();
    const wide = await windowDates(24, 38);
    ok('the span really is wide', r.fe.span === wide.width && r.fe.span > TIGHT, { fe: r.fe, want: wide });
    ok('and today really is inside it', r.fe.inWindow === true, r.fe);
    const c = await card();
    ok('but it is not headlined as a window she is in', c.title === 'A rough fertile window', c);
    ok('and it does not sparkle', c.ico === '🗓️', c);
    ok('it says why it is wide', (c.body || '').indexOf(WIDE) > 0, c.body);
    ok('about the arithmetic, never about her body', !/vary|irregular|unpredictable/i.test(c.body || ''), c.body);
    ok('the honesty line is still last', c.body.slice(-HONEST.length) === HONEST, c.body);

    // A settled body must be untouched: 7 days, in window, still the ✨ card.
    await load(seed(withCycles([28, 28, 28], 12, 28)));
    const s = await est();
    const c2 = await card();
    ok('a settled body still gets the seven-day window', s.fe.span === WINDOW_DAYS, s.fe);
    ok('and still gets the ✨ headline when she is in it', c2.title === 'You may be in your fertile window' && c2.ico === '✨', c2);
    ok('with no wide-stretch line on it', (c2.body || '').indexOf(WIDE) < 0, c2.body);

    /* And the window can never still be open after the period her own longest cycle predicts:
       both ends now come from the same number. 20 and 60 day cycles is the extreme cycleLengths()
       admits either side of. */
    await load(seed(withCycles([20, 60], 10, 28)));
    const x = await est();
    const ext = await windowDates(20, 60);
    const c3 = await card();
    ok('the extreme spread is read as it is', x.cl.join(',') === '20,60', x.cl);
    ok('the window closes a luteal phase before her longest cycle is due', ext.width === 60 - 20 + WINDOW_DAYS, ext);
    ok('so it never runs past the period that cycle predicts', x.fe.span < 60, x.fe);
    ok('and 47 days is never called a window she is in', c3.title === 'A rough fertile window' && c3.ico === '🗓️', c3);
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'CYCLE-MEDIAN: FAIL' : 'CYCLE-MEDIAN: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
