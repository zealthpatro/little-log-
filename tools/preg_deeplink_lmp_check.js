#!/usr/bin/env node
/* Two ways a pregnancy record could be rewritten by something that was never a decision.
 *
 * 1. ?stage=planning DESTROYED AN ENTIRE PREGNANCY ON ONE TAP.
 *    runDeepLink routed every ?stage=planning link straight into openPlanningSetup with no stage
 *    guard, while the sibling branch one line below it (?stage=expecting) had always checked
 *    hasPreg first. openPlanningSetup renders its FIRST-RUN variant whenever the record is not
 *    already planning ("We're trying 🌱 … Lovely. We'll keep it gentle"), and its primary button
 *    is savePlanning, whose else-branch assigns state.pregnancy WHOLESALE. So one tap on "Start"
 *    took an expecting mother's due date, care team, every appointment and its outcome, her blood
 *    pressure, her weights, her birth plan, her period history and her observations, put a blank
 *    planning record in their place, archived nothing, asked nothing, offered no undo, and let
 *    persist() sync the loss to everyone in her circle.
 *    Nothing shipped emits that URL today, which made it a loaded gun rather than a firing one:
 *    it is guessable, it is in a router that ships, and the fix is the guard the branch beside it
 *    already had. Section 1 taps the button. On the unguarded build the sheet is there to tap and
 *    the record is gone; on the fixed build there is nothing to tap and she is on her own journey.
 *
 * 2. CORRECTING A DATE FABRICATED CLINICAL HISTORY.
 *    periodHistory() folded the legacy single p.lmp in beside p.periods, which was right when
 *    p.lmp could only ever be a start she logged. Two doors stopped that being true.
 *    confirmPositiveTest writes a CORRECTED first-day (the field is prefilled with her latest
 *    recorded start, so changing it is a correction of that start), and saveEditPregnancy
 *    back-derives p.lmp from the due date every single time a dating scan moves it. Either one,
 *    folded in beside four real starts, printed a FIFTH "period start date" on the page she hands
 *    a doctor, dated after the LMP her pregnancy was being counted from, and cycleLengths() then
 *    measured a cycle to it: a 13-day correction printed an 18-day cycle she never had. Every
 *    pregnancy gets a dating scan, so the second door is universal.
 *    Fixed by making the fold a migration and only a migration (it runs when there is no recorded
 *    history at all, so pre-history households still lose nothing), and by having
 *    confirmPositiveTest correct the start in place instead of writing a date beside it.
 *    The rule sections 2 and 4 assert: this page may only ever name dates she entered herself.
 *
 * WHAT THIS DOES NOT COVER, so a PASS is not read as more than it is.
 *   - The harness runs the app in local mode (cubby-quick-uid=local): store-firebase.js never
 *     loads, so persist() reaches nothing and firestore.rules is never evaluated. A PASS attests
 *     to the ROUTER and the RECORD, not to the server.
 *   - Section 1.6 sweeps the deep-link table for other destructive destinations by fingerprinting
 *     the record around each route. It proves no listed destination REWRITES the record on
 *     arrival. It does not tap through the sheets those destinations open.
 *   - Whether an 18-day cycle is plausible is not a question this gate (or the app) can answer.
 *     The corrected rule is narrower and checkable: every date the report prints is a date she
 *     entered, and every cycle length is measured between two of them.
 *
 *   PORT=19741 node tools/serve.js &
 *   node tools/preg_deeplink_lmp_check.js http://localhost:19741
 *
 * Pass an explicit base URL. The default is deliberately NOT 8080 or 8123: a live server from
 * another checkout on a shared port answers 200 and gets graded happily, and this project has
 * already had an agent grade main and report a clean pass on work it never wrote. The [checkout]
 * banner below says which tree answered.
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:19741';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

// 13:00, so no assertion lands on a boundary that only exists because the suite ran near midnight.
const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;
const PREG_TERM = 280 * DAY;
const ymd = (t) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
// Same locale format ttcVisitSummary prints its dates in (fd = toLocaleDateString()).
const printed = (t) => new Date(t).toLocaleDateString('en-US');

/* gaps = the cycle lengths she actually lived, oldest first; endsAgo = days since the newest
   start. Written the way she would describe it ("29, 30 and 31 days, and my last was a month ago")
   rather than in absolute milliseconds. Every start is at 08:00, the way savePeriodUpdate stores
   them. */
const starts = (gaps, endsAgo) => {
  const base = new Date(now - endsAgo * DAY); base.setHours(8, 0, 0, 0);
  const out = [base.getTime()];
  for (let i = gaps.length - 1; i >= 0; i--) out.unshift(out[0] - gaps[i] * DAY);
  return out;
};
const planning = (over) => Object.assign({
  id: 'pTTC', ownerUid: 'local', stage: 'planning', dueDate: null, lmp: null, cycleLen: 28,
  periods: [], tryingSince: '2025-09', country: 'gb', precon: [], observations: [],
  careTeam: [], appts: [], symptoms: [], weights: [], bp: [], kicks: [], contractions: [],
  birthPlan: '', bag: [], moments: [], conditions: {}, glucose: [], urine: [], supplements: [],
  supplementLog: [], nausea: [], glucoseUnit: 'mmol', bornBabyId: null, createdAt: now - 300 * DAY,
}, over || {});
const trying = (gaps, endsAgo, cycleLen, over) => {
  const h = starts(gaps, endsAgo);
  return planning(Object.assign({ periods: h, lmp: h[h.length - 1], cycleLen: cycleLen || 28 }, over || {}));
};
/* The record defect 1 measured the loss against: everything a woman 30 weeks in has put into it.
   Fingerprinted whole in section 1 and section 4, so a destination that quietly drops one field is
   caught by the sweep rather than by whichever key someone thought to name.
   Note the shape of starts(): three GAPS is four START DATES. Named here once, because reading it
   as "three starts" is exactly the off-by-one that made this file fail a report that was right. */
const EXP_STARTS = 4, EXP_CYCLES = 3;
const EXPECTING = (over) => {
  const h = starts([29, 30, 31], 200);
  return Object.assign(planning({
    id: 'pEXP', stage: 'expecting', periods: h, lmp: h[h.length - 1], cycleLen: 31,
    dueDate: now + 70 * DAY,
    careTeam: [{ id: 'c1', name: 'Ama Boateng', role: 'Midwife', phone: '020 7946 0812' }],
    appts: [{ id: 'a1', week: 20, title: 'Anomaly scan', note: 'All looked well, placenta anterior',
      done: true, at: now - 40 * DAY, fundal: 21, position: 'cephalic' }],
    bp: [{ id: 'bp1', at: now - 6 * DAY, sys: 118, dia: 74 }],
    weights: [{ id: 'w1', at: now - 6 * DAY, kg: 68.4 }],
    birthPlan: 'Low lights please',
    observations: [{ at: now - 210 * DAY, tags: ['Cramps'], note: 'a quiet day' }],
  }), over || {});
};
const seed = (p, over) => Object.assign({
  babies: [], activeBabyId: null, events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, notes: [], pregnancy: p,
}, over || {});

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

  /* Which checkout actually answered? Read the two fixed functions' own source: the guard is the
     only reason runDeepLink mentions pregGo, and the fold is the only reason periodHistory tests
     list.length. Absent, that means exactly one of two things, and the banner says which so a red
     run is never misread as "the fix is broken" when it is really "wrong port". */
  const marker = await page.evaluate(() => ({
    // Anchored on the branch OPENING, not just on "planning … pregGo" appearing somewhere in the
    // function: the unguarded build says stage==='planning' too, and mentions pregGo in the
    // expecting branch below, so the loose form reported the reverted tree as fixed.
    guard: typeof runDeepLink === 'function' && /stage==='planning'\)\{\s*if\(hasPreg/.test(String(runDeepLink)),
    fold: typeof periodHistory === 'function' && /!list\.length/.test(String(periodHistory)),
  }));
  console.log((marker.guard && marker.fold)
    ? '  [checkout] ' + BASE + ' is serving a tree that has both fixes in source. Good.'
    : '  [checkout] WARNING: ' + BASE + ' is serving a tree missing ' + JSON.stringify(marker) + '.\n'
      + '             Either the fix is reverted, or this port belongs to another checkout.\n'
      + '             The assertions below are expected to fail. Check the port first.');

  await page.evaluate(() => localStorage.setItem('cubby-quick-uid', 'local'));

  const settle = async () => {
    await sleep(1300);
    await page.evaluate(() => { try { window.__toasts = []; window.toast = function (m) { window.__toasts.push(m); }; } catch (e) {} });
    await sleep(150);
  };
  const put = (s) => page.evaluate((x) => {
    localStorage.setItem('little-log-v1', JSON.stringify(x));
    Object.keys(localStorage).forEach((k) => {
      if (k.indexOf('cubby-theme') === 0 || k.indexOf('cubby-fertile-hidden') === 0 || k.indexOf('cubby-tww-hidden') === 0) localStorage.removeItem(k);
    });
    try { sessionStorage.removeItem('cubby-dl'); } catch (e) {}
  }, s);
  // Plain load, no link.
  const load = async (s) => { await put(s); await page.reload({ waitUntil: 'networkidle2' }); await settle(); };
  /* Arrive the way she would: a real URL with the deep-link query on it. stashDeepLink puts it in
     sessionStorage at load, scheduleDeepLink polls, maybeRunDeepLink fires runDeepLink 350ms
     later. Nothing here calls runDeepLink by hand. */
  const arrive = async (s, qs) => {
    await put(s);
    await page.goto(BASE + '/app/?e2e=1&' + qs, { waitUntil: 'networkidle2', timeout: 40000 });
    await settle();
    await sleep(900);
  };

  // The open sheet, read from the rendered element. Never document.body.textContent: that string
  // contains the inline script's own source, so every assertion in this file would match it.
  const sheet = () => page.evaluate(() => {
    const s = document.getElementById('sheet');
    const open = !!(s && s.classList.contains('show'));
    const h2 = s ? s.querySelector('h2') : null;
    return {
      open: open,
      h2: h2 ? (h2.textContent || '').replace(/\s+/g, ' ').trim() : null,
      txt: open ? (s.innerText || '').replace(/\s+/g, ' ').trim() : '',
      handlers: open ? [].slice.call(s.querySelectorAll('[onclick]')).map((e) => e.getAttribute('onclick')) : [],
      primary: open && s.querySelector('.btn-primary') ? (s.querySelector('.btn-primary').getAttribute('onclick') || '') : null,
    };
  });
  // What is on the screen behind the sheet, and every handler the whole document offers.
  const screen = () => page.evaluate(() => {
    const sc = document.getElementById('scroll');
    return {
      txt: sc ? (sc.innerText || '').replace(/\s+/g, ' ').trim() : '',
      docHandlers: [].slice.call(document.querySelectorAll('[onclick]')).map((e) => e.getAttribute('onclick')),
    };
  });
  // Tap the primary button of whatever sheet is open. Returns what it tapped, or null.
  const tapPrimary = async () => {
    const r = await page.evaluate(() => {
      const s = document.getElementById('sheet');
      if (!s || !s.classList.contains('show')) return null;
      const b = s.querySelector('.btn-primary');
      if (!b) return null;
      const h = b.getAttribute('onclick') || '';
      b.click();
      return h;
    });
    await sleep(600);
    return r;
  };
  const rec = () => page.evaluate(() => {
    const p = state.pregnancy;
    if (!p) return null;
    return {
      id: p.id, stage: p.stage, dueDate: p.dueDate, lmp: p.lmp, cycleLen: p.cycleLen,
      careTeam: (p.careTeam || []).length, appts: (p.appts || []).length,
      apptNote: ((p.appts || [])[0] || {}).note || null,
      bp: (p.bp || []).length, weights: (p.weights || []).length,
      birthPlan: p.birthPlan || '', periods: (p.periods || []).slice(),
      observations: (p.observations || []).length, tryingSince: p.tryingSince || null,
      history: (typeof periodHistory === 'function' ? periodHistory(p) : []),
      cycles: (typeof cycleLengths === 'function' ? cycleLengths(p) : []),
      archive: (state.pregnancyArchive || []).length,
    };
  });
  // The doctor report, read out of the rendered overlay, then closed again.
  const report = () => page.evaluate(() => {
    if (typeof openTtcDoctorReport !== 'function') return null;
    openTtcDoctorReport();
    const ov = document.getElementById('reportOv');
    const pre = ov ? ov.querySelector('pre') : null;
    const t = pre ? (pre.innerText || '') : null;
    if (ov) ov.remove();
    return t;
  });
  /* Every date the report prints as a period start, in the order it prints them.
     Only BULLET lines count. ttcVisitSummary puts "Cycle lengths: …" straight after the last bullet
     with no blank line between, so a block-until-blank-line read swallowed it as a fifth "date" and
     every count in this file was off by one against a report that was actually correct. */
  const reportStarts = (txt) => {
    if (!txt) return { n: null, dates: [] };
    const m = txt.match(/Period start dates \((\d+) recorded\):\n([\s\S]*?)(?:\n\s*\n|$)/);
    if (!m) return { n: 0, dates: [] };
    const dates = m[2].split('\n').filter((l) => /^\s*•\s/.test(l)).map((l) => l.replace(/^\s*•\s*/, '').trim());
    return { n: +m[1], dates: dates };
  };
  // The real date field: open the modal and tap a day, the way a thumb does it.
  const pickDate = async (id, when) => {
    await page.evaluate((i, v) => { openDateModal(i); _dpPick(i, v); if (typeof cuCloseModal === 'function') cuCloseModal(); }, id, when);
    await sleep(250);
  };

  console.log('\n1. ?stage=planning can no longer offer to replace a pregnancy');
  {
    const before = EXPECTING();
    await arrive(seed(before), 'stage=planning');
    const sh = await sheet();
    const sc = await screen();
    /* PRESENCE first: the link routed and she landed on her own journey. A bare "no sheet" would
       pass just as happily on a blank white screen. */
    ok('she lands on her pregnancy, not on a setup sheet',
      /week/i.test(sc.txt) && sc.txt.length > 40, sc.txt.slice(0, 200));
    ok('no "We\'re trying" sheet is open on top of it', !(sh.open && /We're trying/.test(sh.h2 || '')), sh);
    ok('and nothing anywhere on the screen is wired to savePlanning',
      sc.docHandlers.length > 0 && !sc.docHandlers.some((h) => h.indexOf('savePlanning(') >= 0),
      sc.docHandlers.filter((h) => h.indexOf('savePlanning') >= 0));
    // Tap it anyway. On the unguarded build this is the one tap that took everything.
    const tapped = await tapPrimary();
    ok('there is no Start button to tap', tapped === null || tapped.indexOf('savePlanning') < 0, tapped);
    const after = await rec();
    ok('her record is the same record', after && after.id === 'pEXP' && after.stage === 'expecting', after);
    ok('her due date is still there', after && after.dueDate === before.dueDate, after && after.dueDate);
    ok('her care team is still there', after && after.careTeam === 1, after && after.careTeam);
    ok('her appointment and its outcome are still there',
      after && after.appts === 1 && /placenta anterior/.test(after.apptNote || ''), after && after.apptNote);
    ok('her blood pressure and weights are still there', after && after.bp === 1 && after.weights === 1, after);
    ok('her birth plan is still there', after && after.birthPlan === 'Low lights please', after && after.birthPlan);
    ok('her four period dates are still there', after && after.periods.length === EXP_STARTS, after && after.periods);
    ok('her observation is still there', after && after.observations === 1, after && after.observations);
    ok('and nothing was quietly archived instead', after && after.archive === 0, after && after.archive);
  }

  console.log('\n2. the same link still works for the woman it was written for');
  {
    // Already trying: this is the safe edit-in-place variant, and it must still open.
    await arrive(seed(trying([29, 30, 31], 31)), 'stage=planning');
    const sh = await sheet();
    ok('a woman already trying still gets her setup sheet', sh.open && /We're trying/.test(sh.h2 || ''), sh.h2);
    ok('and it is the edit variant, not the first-run one', /whenever they change/i.test(sh.txt), sh.txt.slice(0, 200));
    const tapped = await tapPrimary();
    ok('its Save is savePlanning', (tapped || '').indexOf('savePlanning') >= 0, tapped);
    const after = await rec();
    ok('saving updates in place and keeps her history',
      after && after.id === 'pTTC' && after.stage === 'planning' && after.periods.length === 4, after);

    // Nobody at all: the first-run door, untouched.
    await arrive(seed(null), 'stage=planning');
    const sh2 = await sheet();
    ok('someone with no record at all still gets the first-run sheet',
      sh2.open && /We're trying/.test(sh2.h2 || '') && /keep it gentle/i.test(sh2.txt), sh2.h2);

    // A baby at home: "we're trying 🌱" is the wrong door, and it stays shut.
    await arrive(seed(null, { babies: [{ id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }], activeBabyId: 'b1' }), 'stage=planning');
    const sh3 = await sheet();
    const sc3 = await screen();
    ok('a parent with a baby at home lands on the baby home', /Robin/.test(sc3.txt), sc3.txt.slice(0, 160));
    ok('and is not asked to start trying', !(sh3.open && /We're trying/.test(sh3.h2 || '')), sh3);
  }

  console.log('\n3. the sibling branches are unchanged');
  {
    const before = EXPECTING();
    await arrive(seed(before), 'stage=expecting');
    const sc = await screen();
    const after = await rec();
    ok('?stage=expecting still opens her journey', /week/i.test(sc.txt), sc.txt.slice(0, 160));
    ok('and leaves her record alone', after && after.dueDate === before.dueDate && after.appts === 1, after);

    await arrive(seed(null), 'stage=expecting');
    const sh = await sheet();
    ok('with no record it still asks for a due date', sh.open && /due date/i.test(sh.txt), sh.h2);
  }

  console.log('\n4. no other destination in the deep-link table rewrites the record');
  {
    /* The sweep defect 1 asks for. Fingerprint the whole record around each arrival: a destination
       that drops one field is caught here rather than by whichever key someone thought to name. */
    const DESTS = ['stage=planning', 'stage=expecting', 'stage=baby', 'tab=care', 'tab=home',
      'go=doctorreport', 'go=bag', 'go=birthplan', 'go=kicks', 'go=mood', 'go=danger', 'go=guide', 'go=reads'];
    const base = EXPECTING();
    /* The baseline is the record after a PLAIN load with no link on the URL, never the raw seed
       object. Boot fills defaults in (it seeds visitQs, the questions-for-the-midwife list), so
       comparing arrivals against the seed reported all thirteen destinations as destructive and
       therefore said nothing about any of them. The real question is narrower and answerable: does
       arriving VIA the link leave the record in a different state than arriving without one.
       Generated `id` keys are dropped at every depth before comparing, and only those: uid() is
       random per boot, so visitQs differs between any two loads while its text is identical. Every
       date, name, note and flag is still compared, and the paired assertion below checks the
       fingerprint really does still carry her content rather than having been normalised to mush. */
    const fingerprint = () => page.evaluate(() => {
      const strip = (v) => Array.isArray(v) ? v.map(strip)
        : (v && typeof v === 'object')
          ? Object.keys(v).sort().reduce((o, k) => { if (k !== 'id') o[k] = strip(v[k]); return o; }, {})
          : v;
      return JSON.stringify(strip(state.pregnancy || null));
    });
    await load(seed(base));
    const fp0 = await fingerprint();
    ok('the no-link baseline still carries her whole record',
      /"stage":"expecting"/.test(fp0) && /Ama Boateng/.test(fp0) && /placenta anterior/.test(fp0)
      && /Low lights please/.test(fp0) && base.periods.every((t) => fp0.indexOf(String(t)) >= 0),
      fp0.length);
    const moved = [];
    for (const d of DESTS) {
      await arrive(seed(base), d);
      const p = await fingerprint();
      if (p !== fp0) moved.push(d);
    }
    ok('all ' + DESTS.length + ' destinations left the record identical', moved.length === 0, moved);
    // Paired presence: the sweep is only worth something if the links were actually routed.
    await arrive(seed(base), 'go=bag');
    const sh = await sheet();
    ok('and the links really were routing (go=bag opened the bag)', sh.open && /bag/i.test(sh.h2 || ''), sh.h2);
  }

  console.log('\n5. correcting the first day on the positive-test sheet corrects the start she logged');
  {
    // Her four starts, cycles 29/30/31, the newest a month ago. Correct it back 13 days.
    const t = trying([29, 30, 31], 31);
    const oldLast = t.periods[3], newLast = oldLast - 13 * DAY;
    await load(seed(t));
    await page.evaluate(() => { const b = [].slice.call(document.querySelectorAll('[onclick]')).find((e) => (e.getAttribute('onclick') || '').indexOf('openPositiveTest(') >= 0); if (b) b.click(); });
    await sleep(500);
    const sh = await sheet();
    ok('the positive-test sheet opens from her home', sh.open && /positive test/i.test(sh.h2 || ''), sh.h2);
    await pickDate('ptLmp', ymd(newLast));
    await tapPrimary();
    const r = await rec();
    ok('she is expecting now', r && r.stage === 'expecting', r && r.stage);
    ok('she still has exactly the four starts she entered', r && r.periods.length === 4, r && r.periods);
    ok('the corrected date replaced the one it corrected',
      r && r.periods.indexOf(newLast) >= 0 && r.periods.indexOf(oldLast) < 0, r && r.periods);
    ok('and the history the report reads matches the record exactly',
      r && r.history.length === 4 && r.history.every((h) => r.periods.indexOf(h) >= 0), r && r.history);
    ok('no start is dated after the LMP her pregnancy is counted from',
      r && Math.max.apply(null, r.periods) <= r.lmp, r && { last: r.periods[3], lmp: r.lmp });
    const txt = await report();
    const rs = reportStarts(txt);
    ok('the report says four recorded, and prints four', rs.n === 4 && rs.dates.length === 4, rs);
    ok('every date it prints is a date she entered',
      rs.dates.length === 4 && rs.dates.every((d) => r.periods.map(printed).indexOf(d) >= 0), rs.dates);
    ok('the date she never entered is not on the page she hands a doctor',
      rs.dates.indexOf(printed(oldLast)) < 0, rs.dates);
    ok('and every cycle length is measured between two dates she entered',
      r.cycles.length === 3 && r.cycles.every((c, i) => c === Math.round((r.periods[i + 1] - r.periods[i]) / DAY)), r && r.cycles);
  }

  console.log('\n6. the everyday two-day correction, and the typo that would rewrite history');
  {
    const t = trying([29, 30, 31], 31);
    const oldLast = t.periods[3], newLast = oldLast - 2 * DAY;
    await load(seed(t));
    await page.evaluate(() => openPositiveTest());
    await sleep(400);
    await pickDate('ptLmp', ymd(newLast));
    await tapPrimary();
    const r = await rec();
    const rs = reportStarts(await report());
    ok('a two-day correction leaves four starts, not five', r && r.periods.length === 4 && rs.n === 4, { p: r && r.periods.length, n: rs.n });
    ok('and prints the corrected date, once', rs.dates.filter((d) => d === printed(newLast)).length === 1, rs.dates);
    ok('and not the date it replaced', rs.dates.indexOf(printed(oldLast)) < 0, rs.dates);

    /* A date landing on or before the start BEFORE the latest one is not a correction of the
       latest one, and rewriting history to fit it would delete a start she logged. It is left
       alone: p.lmp stands by itself and the report still names only her own dates. */
    const t2 = trying([29, 30, 31], 31);
    const early = t2.periods[1] - 3 * DAY;
    await load(seed(t2));
    await page.evaluate(() => openPositiveTest());
    await sleep(400);
    await pickDate('ptLmp', ymd(early));
    await tapPrimary();
    const r2 = await rec();
    const rs2 = reportStarts(await report());
    ok('a wild date deletes none of her starts', r2 && r2.periods.length === 4, r2 && r2.periods);
    ok('and the report still names only the four she entered',
      rs2.n === 4 && rs2.dates.length === 4 && rs2.dates.every((d) => r2.periods.map(printed).indexOf(d) >= 0), rs2);
  }

  console.log('\n7. a dating scan moves the due date without inventing a period');
  {
    const p = EXPECTING();
    await load(seed(p));
    await page.evaluate(() => openEditPregnancy());
    await sleep(400);
    const sh = await sheet();
    ok('the Due date & schedule sheet opens', sh.open && /Due date/i.test(sh.h2 || ''), sh.h2);
    await pickDate('epDue', ymd(p.dueDate + 5 * DAY));
    await tapPrimary();
    const r = await rec();
    ok('the due date really moved five days', r && Math.round((r.dueDate - p.dueDate) / DAY) === 5, r && r.dueDate);
    ok('her recorded starts are untouched', r && r.periods.length === EXP_STARTS, r && r.periods);
    /* The scan really did move p.lmp off her own dates. Without this the three assertions below
       would pass on a build where saveEditPregnancy never wrote p.lmp at all. */
    ok('and the scan really did derive a new LMP off her own dates',
      r && r.periods.indexOf(r.lmp) < 0, { lmp: r && r.lmp, periods: r && r.periods });
    const rs = reportStarts(await report());
    ok('the report says four recorded, and prints four', rs.n === EXP_STARTS && rs.dates.length === EXP_STARTS, rs);
    ok('the derived LMP is not among them',
      rs.dates.length === EXP_STARTS && rs.dates.indexOf(printed(r.lmp)) < 0 && rs.dates.every((d) => r.periods.map(printed).indexOf(d) >= 0), { lmp: printed(r.lmp), dates: rs.dates });
    /* Not just the COUNT of cycles. On the unguarded build the phantom start landed eight days
       before her real one, cycleLengths() drops anything under fifteen days, and the count came
       out at three either way, so a count-only assertion passed while the report beneath it was
       printing a date she never entered. Measure the cycles against her own consecutive dates. */
    ok('and every cycle is still measured between two dates she entered',
      r && r.cycles.length === EXP_CYCLES
      && r.cycles.every((c, i) => c === Math.round((r.periods[i + 1] - r.periods[i]) / DAY)), r && r.cycles);
  }

  console.log('\n8. households from before the period history still lose nothing');
  {
    /* The fold is a migration and only a migration. A record written before p.periods existed has
       one genuine start in p.lmp and no history at all, and it must still appear. */
    const legacy = planning({ periods: [], lmp: starts([], 20)[0] });
    delete legacy.periods;
    await load(seed(legacy));
    const r = await rec();
    ok('her one legacy date is still her history', r && r.history.length === 1 && r.history[0] === legacy.lmp, r && r.history);
    const rs = reportStarts(await report());
    ok('and the report prints it', rs.n === 1 && rs.dates.length === 1 && rs.dates[0] === printed(legacy.lmp), rs);
  }

  console.log('\n9. the dating maths is untouched, and the two writers still agree');
  {
    /* Not a defect, a guard on the line section 7 edits. dueFromLmp and lmpFromDue are inverses
       through the SAME cycle length, so a positive test followed by opening the due-date sheet and
       pressing Save with nothing changed must land on the same two numbers it started with. If a
       later change makes one of them read a different cycle length, her LMP walks a few days every
       time she saves, and section 7's "no phantom start" would still pass while the date the
       pregnancy is counted from quietly drifted. */
    const t = trying([29, 30, 31], 31, 31);
    await load(seed(t));
    await page.evaluate(() => openPositiveTest());
    await sleep(400);
    await tapPrimary();
    const before = await rec();
    ok('the positive test dated her from her own last period',
      before && before.stage === 'expecting' && before.lmp === t.periods[3], before && { lmp: before.lmp });
    ok('and used the cycle length on her record, not a bare 280 days',
      before && Math.round((before.dueDate - before.lmp) / DAY) === 283, before && Math.round((before.dueDate - before.lmp) / DAY));
    await page.evaluate(() => openEditPregnancy());
    await sleep(400);
    const shE = await sheet();
    ok('the Due date sheet opens on it', shE.open && /Due date/i.test(shE.h2 || ''), shE.h2);
    await tapPrimary();
    const after = await rec();
    ok('saving with nothing changed leaves the due date alone', after.dueDate === before.dueDate, { before: before.dueDate, after: after.dueDate });
    ok('and her LMP does not drift', after.lmp === before.lmp, { drift: Math.round((after.lmp - before.lmp) / DAY) });
    ok('and it still invented no period start', after.periods.length === 4 && after.history.length === 4, after.periods);
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'PREG-DEEPLINK-LMP: FAIL' : 'PREG-DEEPLINK-LMP: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
