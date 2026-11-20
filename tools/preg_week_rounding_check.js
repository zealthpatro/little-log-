#!/usr/bin/env node
/* pregWeek() rounded, so the preterm rule ended three days early.
 *
 * A gestation is spoken in COMPLETED weeks plus days: 36+4 is "thirty-six weeks", not "thirty-seven".
 * pregWeek()'s lmp branch always knew that (Math.floor). Its due-date branch did not:
 *
 *     wk = 40 - Math.round((p.dueDate - now()) / PREG_MS_WEEK)
 *
 * Write the days she has completed as d. The due date sits 280-d days away, so the rounded term is
 * round(40 - d/7) = 40 - round(w + r/7) for d = 7w + r. r/7 crosses 0.5 at r = 4, so days 4, 5 and 6
 * of EVERY week were named as the next week. The error never ran both ways: it always read further
 * along, closer to term, less urgent.
 *
 * That is not a cosmetic off-by-one, because one clinical rule is keyed off this number.
 * openContractions computes `preterm = pregWeek() < 37` and, below 37 weeks, REPLACES the 5-1-1 card
 * outright with "Call now, whatever the timing says" - regular tightenings this early are worth a
 * call straight away and the 5-1-1 rule does not apply. At 36+4, 36+5 and 36+6 pregWeek() answered
 * 37, so a woman in preterm labour - the exact reader that card was written for - got term advice
 * instead: wait for five minutes apart, one minute long, one hour. And the doctor report she prints
 * for a clinician (pregVisitSummary) headed the page "Week 37" next to a correctly computed
 * "24 days to go", two numbers on one clinical page that cannot both be true.
 *
 * It leaked further than those two. She types "36 weeks 4 days" into setup; savePregnancy converts
 * that straight to a due date, so the app gave her back a different answer than the one she gave it.
 * Every week-keyed surface moved with it: pregNextAction's 36-week hospital-bag nudge, pregWeekData,
 * pregTri at the trimester boundaries, the moments library's suggested cards, the archived week at
 * a loss, and the "Week n" row in the baby switcher.
 *
 * Fixed at source, in the one function, counting completed days and flooring them:
 *
 *     wk = Math.floor((PREG_TERM - (p.dueDate - now())) / PREG_MS_WEEK)
 *
 * pregWeekStart(n) had to move with it and is the one paired change. It inverts pregWeek to find the
 * instant the week turns, and it had been written to mirror the rounding: `dueDate - (40.5-n)*week`.
 * With flooring the turn lands exactly on `dueDate - (40-n)*week`, which is also the arithmetic
 * pregApptDate has always used for the visits that sit beside those calendar markers, so the two
 * agree now where before they were half a week apart. Section 4 asserts the inversion directly
 * rather than trusting the algebra.
 *
 * Defect 6, on the same sheet: the 5-1-1 card's copy was fixed prose - "Contractions about 5 minutes
 * apart, lasting about a minute, for about an hour" - printed over a window that by construction
 * only ever holds the last hour, and fired on `recent.length >= 6`. Six contractions five minutes
 * apart is twenty minutes of data. The card told her the pattern had held for an hour when it had
 * held for twenty minutes, and that sentence is the one she reads down the phone to her midwife.
 * Firing at twenty minutes is the safe direction and stays; the card now reports HER measurement
 * ("You have timed 6 contractions over about 20 minutes, around 5 minutes apart and about a minute
 * each") and names the hour as what the rule looks for, not as something she has done.
 *
 * THE CLOCK IS PINNED, because section 4 once failed on a loaded machine (17 Nov 2026, load ~51).
 * It read Date.now() to place the due date, then asked pregWeek(), which reads the clock again
 * through now(), to agree with that placement to the millisecond: one ms early must answer n-1. If
 * the clock ticked between the two reads, and a descheduled renderer makes that likely, the ms
 * vanished and `before` came back n. Midnight was not the cause: that run reached this gate at
 * about 00:39, the page clock sat at 1 pm of the day the runner started, and pregWeek() and
 * pregWeekStart() read no local date at all. A page clock that ticks on every read fails the old
 * section 4 on all 36 weeks; a CPU-throttled page (rate 4) failed it in 2 runs of 60. So the
 * instants are pinned, not raced:
 *   - every document starts at 1 pm on 18 Nov 2026, local, however long the run has taken, so no
 *     seed made from CLOCK drifts (section 6's twelve contractions have only a three-minute margin,
 *     and the old once-per-run offset failed it when the page was reached four minutes in);
 *   - section 4 freezes the page clock (window.__clockPin) at the exact instant pregWeekStart(n)
 *     names and at the ms before it, on a plain afternoon, both sides of a local midnight, a month
 *     end and a year end, in both of pregWeek()'s branches.
 *
 * WHAT THIS DOES NOT COVER, so a PASS is not read as more than it is.
 *   - The lmp branch of pregWeek() is unchanged and was always correct. Section 2 pins the two
 *     branches to each other across a full 42-week sweep, which is what makes "fixed at source"
 *     checkable, but it does not prove either is the clinically right convention on its own.
 *   - This runs the app in local mode (cubby-quick-uid=local), so nothing here touches sync or
 *     firestore.rules.
 *   - The 5-1-1 THRESHOLD itself (freqMin<=6, durSec>=45, count>=6) is not under test. Section 6
 *     asserts only that the sentence describes the data actually timed. Whether six contractions is
 *     the right trigger is a clinical question this gate does not answer.
 *   - Section 5 reads pregVisitSummary()'s text, not the rendered PDF.
 *   - Section 4 proves the screen's week and pregWeekStart() agree at every instant. It does not
 *     say the week turns at local midnight: it turns at the time of day the anchor was stored
 *     (08:00 for a picked date, the minute she pressed save for "weeks along"). The surfaces that
 *     count calendar days can disagree with it for part of a day and are not under test here:
 *     pregDaysToGo() rounds where pregWeek() floors, and the weekly calendar marker is all-day on
 *     the date of pregWeekStart(n) with a 9 am alarm.
 *
 *   PORT=19437 node tools/serve.js &
 *   node tools/preg_week_rounding_check.js http://localhost:19437
 *
 * Pass an explicit base URL. The default is deliberately NOT 8080: a stale server from another
 * checkout on a shared port grades that tree and reports PASS on work you never wrote.
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:19437';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, MIN = 60000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

// Pinned to a DAY and an hour (18 Nov 2026, 1 pm local). Each document starts here (see the shim).
const CLOCK = new Date(2026, 10, 18, 13, 0, 0, 0).getTime();
const now = CLOCK;

/* Seeded the way savePregnancy() itself converts "how many weeks along are you?" into a stored
   record: lmp = now - (w*7+d) days, dueDate = lmp + 280 days. Seeding a due date by hand would have
   let the gate pick a number that happened to round correctly and call it a pass. */
const preg = (w, d, over) => {
  const lmp = now - (w * 7 + (d || 0)) * DAY;
  return Object.assign({
    id: 'p1', ownerUid: 'local', stage: 'expecting',
    dueDate: lmp + 280 * DAY, lmp: lmp, cycleLen: 28, periods: [],
    country: 'us', precon: [], careTeam: [{ id: 'c1', name: 'Midwife team', phone: '+44 20 7946 0000' }],
    appts: [], symptoms: [], weights: [], bp: [], kicks: [], contractions: [], birthPlan: '', bag: [],
    moments: [], conditions: {}, glucose: [], urine: [], supplements: [], supplementLog: [], nausea: [],
    glucoseUnit: 'mmol', bornBabyId: null, createdAt: lmp,
  }, over || {});
};
const seed = (p) => ({
  babies: [], activeBabyId: null, events: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], notes: [], pregnancy: p,
});

/* n contractions, `gapMin` apart, each `durSec` long, the last one ending a minute ago. The span the
   card may honestly claim is (n-1)*gapMin, which is the whole point of section 6. */
const contractions = (n, gapMin, durSec) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const st = now - MIN - (n - 1 - i) * gapMin * MIN - durSec * 1000;
    out.push({ id: 'c' + i, start: st, end: st + durSec * 1000 });
  }
  return out;
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  /* The shift is taken when each document starts, so every reload begins at CLOCK rather than at
     CLOCK plus however long the run has taken so far. __clockPin, when set, IS the time: section 4
     sets it and clears it inside one synchronous evaluate, so nothing else ever sees it. */
  await page.evaluateOnNewDocument((start) => {
    const R = Date, shift = start - R.now();
    window.__clockPin = null;
    const t = () => (window.__clockPin != null ? window.__clockPin : R.now() + shift);
    function D(...a) { return a.length === 0 ? new R(t()) : new R(...a); }
    D.prototype = R.prototype; D.now = t; D.parse = R.parse; D.UTC = R.UTC;
    window.Date = D;
  }, CLOCK);
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
  /* The sheet's OWN innerText. Never document.body.textContent: the page carries a ~12,000-line
     inline <script>, so its own source is in there and every regex below would match the code that
     writes the string rather than the string a mother reads. */
  const sheetText = () => page.evaluate(() => {
    const s = document.getElementById('sheet');
    return s ? (s.innerText || '').replace(/\s+/g, ' ').trim() : '';
  });

  console.log('\n1. pregWeek() answers in completed weeks, on the days the rounding moved');
  {
    /* Days 4, 5 and 6 are the whole defect: r/7 crosses 0.5 at r=4. Days 0-3 were already right and
       are here so a fix that broke THEM cannot hide behind three green lines. */
    await load(seed(preg(36, 4)));
    const sweep = await page.evaluate(() => {
      const out = [];
      for (let d = 0; d <= 6; d++) {
        const lmp = Date.now() - (36 * 7 + d) * 86400000;
        state.pregnancy.lmp = lmp; state.pregnancy.dueDate = lmp + 280 * 86400000;
        out.push({ d: d, wk: pregWeek(), daysToGo: pregDaysToGo() });
      }
      return out;
    });
    sweep.forEach((r) => ok('36+' + r.d + ' reads as week 36 (' + r.daysToGo + ' days to go)', r.wk === 36, r));
    ok('all seven days of week 36 answer 36', sweep.filter((r) => r.wk === 36).length === 7, sweep);
    ok('the sweep actually ran all seven days', sweep.length === 7, sweep.length);
  }

  console.log('\n2. the due-date branch and the lmp branch agree, every day of a whole pregnancy');
  {
    await load(seed(preg(20, 0)));
    const r = await page.evaluate(() => {
      const bad = []; let checked = 0;
      for (let d = 28; d <= 293; d++) {
        const lmp = Date.now() - d * 86400000;
        state.pregnancy.lmp = lmp; state.pregnancy.dueDate = lmp + 280 * 86400000;
        const fromDue = pregWeek();
        state.pregnancy.dueDate = null;
        const fromLmp = pregWeek();
        state.pregnancy.dueDate = lmp + 280 * 86400000;
        checked++;
        if (fromDue !== fromLmp) bad.push({ d: d, fromDue: fromDue, fromLmp: fromLmp });
        else if (fromDue !== Math.max(1, Math.min(42, Math.floor(d / 7)))) bad.push({ d: d, fromDue: fromDue, expected: Math.floor(d / 7) });
      }
      return { bad: bad, checked: checked };
    });
    ok('266 days checked, not an empty loop', r.checked === 266, r.checked);
    ok('no day disagrees between the two branches or with floor(days/7)', r.bad.length === 0, r.bad.slice(0, 6));
  }

  console.log('\n3. the preterm card, which is the reason this number matters');
  {
    /* 36+4 with regular tightenings. Under the rounding this read 37 and she got term advice. */
    await load(seed(preg(36, 4, { contractions: contractions(6, 5, 60) })));
    await page.evaluate(() => openContractions());
    const t = await sheetText();
    const wk = await page.evaluate(() => pregWeek());
    ok('at 36+4 pregWeek() is 36', wk === 36, wk);
    ok('the call-now card is on the screen', /Call now, whatever the timing says/i.test(t), t.slice(0, 260));
    ok('it names her real week, 36', /You are 36 weeks/.test(t), t.slice(0, 300));
    ok('it does not name 37', !/You are 37 weeks/.test(t), t.slice(0, 300));
    ok('the term 5-1-1 card is NOT shown instead', !/5-1-1 mark/i.test(t), t.slice(0, 300));
    ok('the sheet is the contraction timer, not a blank sheet', /Contraction timer/i.test(t) && t.length > 200, t.length);

    /* 36+6 is the last day the rule must still bite, and the furthest the rounding pushed her. */
    await load(seed(preg(36, 6, { contractions: contractions(6, 5, 60) })));
    await page.evaluate(() => openContractions());
    const t2 = await sheetText();
    ok('at 36+6 pregWeek() is still 36', (await page.evaluate(() => pregWeek())) === 36);
    ok('36+6 still gets the call-now card', /Call now, whatever the timing says/i.test(t2) && /You are 36 weeks/.test(t2), t2.slice(0, 260));

    /* 37+0 is the first day the rule must stop. A fix that just shifted the boundary fails here. */
    await load(seed(preg(37, 0, { contractions: contractions(6, 5, 60) })));
    await page.evaluate(() => openContractions());
    const t3 = await sheetText();
    ok('at 37+0 pregWeek() is 37', (await page.evaluate(() => pregWeek())) === 37);
    ok('37+0 gets the term 5-1-1 card', /5-1-1 mark/i.test(t3), t3.slice(0, 300));
    ok('37+0 does not get the preterm card', !/Call now, whatever the timing says/i.test(t3), t3.slice(0, 300));
  }

  console.log('\n4. pregWeekStart(n) inverts pregWeek() exactly, so the calendar matches the screen');
  {
    await load(seed(preg(20, 0)));
    const r = await page.evaluate(() => {
      /* The instants week n is made to begin on, built in the PAGE's own local time so "midnight" is
         the page's midnight whatever TZ the runner has: a plain afternoon, then both sides of a local
         midnight, of a month end and of a year end. */
      const L = (y, mo, d, h, mi, s, ms) => new Date(y, mo, d, h, mi, s, ms).getTime();
      const anchors = [
        ['1 pm', L(2026, 10, 18, 13, 0, 0, 0)],
        ['23:59:59.999', L(2026, 10, 18, 23, 59, 59, 999)],
        ['midnight', L(2026, 10, 19, 0, 0, 0, 0)],
        ['last ms of November', L(2026, 10, 30, 23, 59, 59, 999)],
        ['first ms of December', L(2026, 11, 1, 0, 0, 0, 0)],
        ['last ms of 2026', L(2026, 11, 31, 23, 59, 59, 999)],
        ['first ms of 2027', L(2027, 0, 1, 0, 0, 0, 0)],
      ];
      const W = 7 * 86400000, p = state.pregnancy;
      const saved = { lmp: p.lmp, dueDate: p.dueDate };
      // One matcher grades the real pair and three staged breaks, one aimed at each of its halves.
      const invert = (week, weekStart) => {
        const bad = []; let checked = 0;
        for (const [name, T] of anchors) {
          for (const branch of ['due', 'lmp']) {
            for (let n = 5; n <= 40; n++) {
              // Make week n begin at T in this branch, read the instant back out of weekStart(n), and
              // pin the clock ON it and one ms before it. Nothing here reads a running clock.
              if (branch === 'due') { p.lmp = null; p.dueDate = T + (40 - n) * W; }
              else { p.dueDate = null; p.lmp = T - n * W; }
              const start = weekStart(n);
              window.__clockPin = start; const at = week();
              window.__clockPin = start - 1; const before = week();
              window.__clockPin = null;
              checked++;
              if (start !== T || at !== n || before !== n - 1) bad.push({ anchor: name, branch: branch, n: n, at: at, before: before, startMinusT: start - T });
            }
          }
        }
        return { bad: bad, checked: checked };
      };
      try {
        const real = invert(pregWeek, pregWeekStart);
        // Start half: the pre-fix pair, Math.round in the due branch and the 40.5-n offset that mirrored it.
        const rounded = invert(
          () => (p.dueDate ? Math.max(1, Math.min(42, 40 - Math.round((p.dueDate - now()) / W))) : pregWeek()),
          (n) => (p.dueDate ? p.dueDate - (40.5 - n) * W : pregWeekStart(n)));
        // "at" half: a week counted from the start of the local day instead of the instant. It agrees
        // with pregWeekStart only at the three anchors that ARE a local midnight, which also proves those
        // anchors are the page's own midnights and not the runner's.
        const localDay = invert(() => {
          const d = new Date(now()); d.setHours(0, 0, 0, 0); const t = d.getTime();
          return Math.max(1, Math.min(42, p.dueDate ? Math.floor((PREG_TERM - (p.dueDate - t)) / W) : Math.floor((t - p.lmp) / W)));
        }, pregWeekStart);
        // "before" half: a week read one ms late, which is what a clock that ticked between two reads
        // did to the old version of this section on 17 Nov 2026.
        const late = invert(() => {
          const c = window.__clockPin; window.__clockPin = c + 1;
          try { return pregWeek(); } finally { window.__clockPin = c; }
        }, pregWeekStart);
        const sum = (x) => ({ checked: x.checked, bad: x.bad.length, anchors: Array.from(new Set(x.bad.map((b) => b.anchor))), branches: Array.from(new Set(x.bad.map((b) => b.branch))), sample: x.bad.slice(0, 2) });
        return {
          real: real,
          rounded: Object.assign(sum(rounded), { onStart: rounded.bad.every((b) => b.startMinusT === -W / 2) }),
          localDay: Object.assign(sum(localDay), { onAt: localDay.bad.every((b) => b.startMinusT === 0 && b.at === b.n - 1 && b.before === b.n - 1) }),
          late: Object.assign(sum(late), { onBefore: late.bad.every((b) => b.startMinusT === 0 && b.at === b.n && b.before === b.n) }),
        };
      } finally { window.__clockPin = null; p.lmp = saved.lmp; p.dueDate = saved.dueDate; }
    });
    ok('504 week-starts checked (36 weeks, 7 pinned instants, both branches), not an empty loop', r.real.checked === 504, r.real.checked);
    ok('every pregWeekStart(n) is the exact instant pregWeek() first answers n', r.real.bad.length === 0, r.real.bad.slice(0, 6));
    ok('the same matcher catches the pre-fix rounding pair, every due-branch start half a week early',
      r.rounded.bad === 252 && r.rounded.branches.join() === 'due' && r.rounded.onStart, r.rounded);
    ok('it catches a week counted from the local day, on "at", at every anchor except the three local midnights',
      r.localDay.bad === 288 && r.localDay.anchors.join() === '1 pm,23:59:59.999,last ms of November,last ms of 2026' && r.localDay.onAt, r.localDay);
    ok('it catches a week read one ms late, the old race, on "before", at all 504',
      r.late.bad === 504 && r.late.onBefore, r.late);
    const half = await page.evaluate(() => {
      // The old code offset by 40.5-n, which is half a week (302400000 ms) away from pregApptDate's
      // arithmetic for the very same week. If that offset came back, this catches it by name.
      state.pregnancy.dueDate = Date.now() + 20 * 7 * 86400000; state.pregnancy.lmp = null;
      return { start: pregWeekStart(20), appt: pregApptDate({ week: 20 }, state.pregnancy) };
    });
    ok('pregWeekStart and pregApptDate name the same instant for week 20', Math.abs(half.start - half.appt) < 1000, half);
  }

  console.log('\n5. the doctor report prints the week she is actually at');
  {
    await load(seed(preg(36, 4)));
    const r = await page.evaluate(() => {
      const s = pregVisitSummary();
      return { head: (s.split('\n')[0] || ''), wk: pregWeek(), dtg: pregDaysToGo() };
    });
    ok('the report has a header line to read', r.head.length > 10 && /Week \d+/.test(r.head), r.head);
    ok('it prints Week 36, not Week 37', /^Week 36 /.test(r.head), r.head);
    ok('the days-to-go beside it is 24 and agrees with the week', r.dtg === 24 && Math.floor((280 - 24) / 7) === 36, r);
    ok('it still names the trimester and the due date', /Third trimester/.test(r.head) && /due /.test(r.head), r.head);
  }

  console.log('\n6. the 5-1-1 card reports what she timed, not the rule read back at her');
  {
    /* Six contractions five minutes apart is twenty minutes of data, which is what fires the card. */
    await load(seed(preg(39, 0, { contractions: contractions(6, 5, 60) })));
    await page.evaluate(() => openContractions());
    const t = await sheetText();
    ok('the 5-1-1 card is on the screen', /5-1-1 mark/i.test(t), t.slice(0, 320));
    // Only the claim ABOUT HER DATA is forbidden. The rule may still name its own hour, and section
    // 6's last-but-two assertion requires that it does, so this cannot be widened into a ban on the
    // word and left to pass on a card that says nothing at all.
    ok('it does not claim the pattern she timed has run for about an hour', !/timed \d+ contractions over about an hour/i.test(t), t.slice(0, 400));
    ok('it says how many she timed', /You have timed 6 contractions/.test(t), t.slice(0, 400));
    ok('it says the real span, about 25 minutes', /over about 25 minutes/.test(t), t.slice(0, 400));
    ok('it still says how far apart and how long', /around 5 minutes apart/.test(t) && /about a minute each/.test(t), t.slice(0, 400));
    ok('the hour is named as what the rule looks for, not what she has done', /rule looks for that pattern holding for about an hour/i.test(t), t.slice(0, 460));
    ok('the call-your-provider line survives', /Many providers suggest calling now/.test(t), t.slice(0, 460));

    /* A pattern that HAS run for about an hour may say so. Without this the fix could have just
       deleted the word "hour" and gone green. */
    // 12 contractions five minutes apart span 55 minutes, which is the point the copy is allowed to
    // round up to "about an hour". contractionStats' window is the last hour exactly, so all 12 are
    // still inside it; a 13th would fall out of the window rather than lengthen the span.
    await load(seed(preg(39, 0, { contractions: contractions(12, 5, 60) })));
    await page.evaluate(() => openContractions());
    const t2 = await sheetText();
    ok('an hour of data does say about an hour', /You have timed 12 contractions over about an hour/.test(t2), t2.slice(0, 400));
    ok('the hour case counted 12, not a window that silently dropped rows', (await page.evaluate(() => contractionStats().count)) === 12);

    /* Voice: the sheet a frightened woman reads at 3am carries no em-dash and no medical verdict. */
    ok('no em-dash anywhere on the sheet', t.indexOf('—') === -1 && t2.indexOf('—') === -1, [t.slice(0, 120), t2.slice(0, 120)]);
    ok('the informational-only line is still there', /Informational only/.test(t) && /Informational only/.test(t2));
  }

  console.log('\n7. the week she typed in is the week the app gives back');
  {
    await load(seed(null));
    const r = await page.evaluate(() => {
      const out = [];
      for (const [w, d] of [[36, 4], [36, 5], [36, 6], [12, 4], [27, 5], [8, 6]]) {
        const lmp = Date.now() - (w * 7 + d) * 86400000;
        state.pregnancy = { id: 'p1', ownerUid: 'local', stage: 'expecting', lmp: lmp, dueDate: lmp + 280 * 86400000, appts: [], contractions: [], kicks: [], moments: [] };
        out.push({ typed: w + '+' + d, back: pregWeek(), tri: pregTri() });
      }
      return out;
    });
    r.forEach((x) => ok('typed ' + x.typed + ', app answers week ' + x.back, x.back === +x.typed.split('+')[0], x));
    ok('all six answers came back', r.length === 6, r.length);
    ok('27+5 is still the second trimester, not the third', r.find((x) => x.typed === '27+5').tri === 2, r.find((x) => x.typed === '27+5'));
    ok('12+4 is still the first trimester, not the second', r.find((x) => x.typed === '12+4').tri === 1, r.find((x) => x.typed === '12+4'));
  }

  console.log('\n8. the other week-keyed surfaces moved with it');
  {
    /* pregNextAction turns the hospital-bag nudge on at 36. Under the rounding 35+4 read 36 and a
       woman three days short of that was told to have her bag by the door. */
    await load(seed(preg(35, 4)));
    const a = await page.evaluate(() => ({ wk: pregWeek(), act: pregNextAction() }));
    ok('35+4 reads as week 35', a.wk === 35, a.wk);
    ok('35+4 gets a next-action, so this is not passing on a null', !!a.act, a.act);
    ok('35+4 is not yet told to have the hospital bag by the door', !/hospital bag/i.test(a.act.t), a.act.t);

    await load(seed(preg(36, 0)));
    const b = await page.evaluate(() => ({ wk: pregWeek(), act: pregNextAction() }));
    ok('36+0 reads as week 36', b.wk === 36, b.wk);
    ok('36+0 is the first day the bag nudge appears', /hospital bag/i.test(b.act && b.act.t), b.act);

    /* The baby switcher's "Week n" row, and quickPregWeek which gates the quick-log entries.
       openBabySheet early-returns into openAddEntry when there are no babies, so this seed needs a
       sibling or the section grades the wrong sheet - which is exactly what it did on the first run,
       and only the paired presence assertion caught it. */
    const withSib = seed(preg(27, 5));
    withSib.babies = [{ id: 'b1', name: 'Robin', birth: now - 400 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }];
    withSib.activeBabyId = 'b1';
    await load(withSib);
    const c = await page.evaluate(() => {
      openBabySheet();
      const s = document.getElementById('sheet');
      return { txt: s ? (s.innerText || '').replace(/\s+/g, ' ') : '', quick: quickPregWeek(), data: !!pregWeekData() };
    });
    ok('the switcher sheet has content to read', c.txt.length > 30, c.txt.slice(0, 160));
    ok('the switcher says Week 27', /Week 27\b/.test(c.txt), c.txt.slice(0, 200));
    ok('the switcher does not say Week 28', !/Week 28\b/.test(c.txt), c.txt.slice(0, 200));
    ok('quickPregWeek agrees with pregWeek', c.quick === 27, c.quick);
    ok('pregWeekData still resolves for that week', c.data === true, c.data);
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'PREG-WEEK-ROUNDING: FAIL' : 'PREG-WEEK-ROUNDING: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
