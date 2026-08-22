#!/usr/bin/env node
/* THE VACCINE DATES WERE THE LAST THING ON THE SCREEN, AND NEVER OFFERED AT SETUP.
 *
 * Six marketing surfaces promise vaccine reminders. No vaccine has ever been pushed to anyone, so
 * the honest way Cubby keeps that promise is the calendar: the visits go into the parent's OWN
 * calendar, where they still ring when Cubby is closed. That is the strongest cold-start proof in
 * the baby stage, and it was the LAST row of a sub-tab, below the completion ring, the catch-up
 * card, the disclaimer, twenty-seven vaccine rows and two add-rows. Measured by this gate against
 * the old code, a ten-day-old on the UK schedule put it at y=3033 in an 844px viewport: three and
 * a half screens down, so a parent who never scrolled the vaccines tab to its end never learned
 * it existed.
 *
 * And the onboarding sheet, the one moment where country and birthday are both known for the first
 * time, already said "their vaccine plan is already waiting" and offered "See their vaccine plan",
 * then stopped short of the only thing that reaches her after she closes the app.
 *
 * This gate holds both: the row sits with the ring and above the list, and the onboarding sheet
 * offers the calendar.
 *
 * It also holds the two things moving it broke. NUMBERS: at the foot of the tab "these 7 visits" was
 * three screens from the ring's "0 of 27 recorded" and four rows from vaxProofLine's "8 visits";
 * beside them, both collide, and the frightened reading on a vaccine screen is "which twenty are
 * being dropped". The label now carries no count on either surface. IDENTITY: a UID was the visit's
 * INDEX in vaxUpcomingVisits, a list that shrinks every time a visit is recorded, so the second
 * export re-pointed all seven identifiers at different appointments. Promoting this to a primary
 * action on two surfaces is precisely what manufactures that second export.
 *
 *   PORT=9477 node tools/serve.js &
 *   node tools/vax_cal_row_check.js http://localhost:9477
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/* No default. A bare default sends this gate at whatever checkout happens to own the well-known port,
   which in this repo has already produced a clean pass measured against a completely different tree. */
const BASE = process.argv[2];
if (!BASE) { console.log('usage: PORT=<free port> node tools/serve.js &  then  node tools/vax_cal_row_check.js http://localhost:<that port>'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x).slice(0, 400) : '')); } };

// 13:00, so a baby "born today" was born earlier today: the at-birth visit is genuinely behind her.
const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

const seed = (over) => Object.assign({
  babies: [{ id: 'b1', name: 'Wren', birth: now - 10 * DAY, sex: 'F', country: 'GB', routines: [], doctors: [], allergies: [] }],
  activeBabyId: 'b1', events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
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
  await page.evaluate(() => localStorage.setItem('cubby-quick-uid', 'local'));

  const load = async (s) => {
    await page.evaluate((x) => {
      localStorage.setItem('little-log-v1', JSON.stringify(x));
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
    }, s);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1500);
  };

  /* Everything below reads real elements. document.body.textContent (and innerHTML) contain the
     inline script's own source on this page, so "Put ... in my calendar" matches the TEMPLATE that
     produced the row as happily as the row itself, and an assertion on it passes with the feature
     deleted from the render. */
  const VAX = () => page.evaluate(() => {
    go('health'); if (typeof healthGo === 'function') { try { healthGo('vaccines'); } catch (e) {} }
    const rows = [...document.querySelectorAll('.add-row')];
    const cal = rows.filter((e) => /in my calendar/.test(e.textContent || ''));
    const host = (cal[0] || rows[0] || document.querySelector('.ms-hero') || {}).parentElement;
    const kids = host ? [...host.children] : [];
    const at = (sel) => kids.findIndex((e) => e.matches(sel));
    const el = cal[0];
    const nav = document.querySelector('.nav');
    return {
      count: cal.length,
      text: el ? el.textContent.trim() : '',
      prev: el && el.previousElementSibling ? el.previousElementSibling.className : null,
      prevText: el && el.previousElementSibling ? el.previousElementSibling.textContent.trim() : '',
      prevHasRing: !!(el && el.previousElementSibling && el.previousElementSibling.querySelector('.ring svg circle')),
      // Computed, not the inline attribute: the row now leads the tab, so it must take the 16px
      // BLOCK gap rather than the 8px rhythm .add-row carries for rows inside one list.
      mb: el ? getComputedStyle(el).marginBottom : null,
      borderStyle: el ? getComputedStyle(el).borderTopStyle : null,
      iCal: el ? kids.indexOf(el) : -1,
      iHero: at('.ms-hero'), iSetup: at('.vx-setup'), iDisc: at('.disclaimer'),
      iFirstDose: at('.ms-row'), iAdd: kids.findIndex((e) => /Add a vaccine/.test(e.textContent || '')),
      doseRows: kids.filter((e) => e.matches('.ms-row')).length,
      top: el ? Math.round(el.getBoundingClientRect().top) : null,
      bottom: el ? Math.round(el.getBoundingClientRect().bottom) : null,
      // The row moved from the end of a list to the head of the tab, so the 8px row rhythm it
      // carries underneath is now landing on a card instead of another row.
      gapBelow: el && el.nextElementSibling
        ? Math.round(el.nextElementSibling.getBoundingClientRect().top - el.getBoundingClientRect().bottom) : null,
      nextTag: el && el.nextElementSibling ? el.nextElementSibling.className : null,
      navTop: nav ? Math.round(nav.getBoundingClientRect().top) : 844,
      upcoming: vaxUpcomingVisits(vaccinePlan()).length,
      planned: new Set(vaccinePlan().map((v) => v.dueMonths)).size,
    };
  });

  // A real click, with the .ics caught on its way to the download instead of being written to disk.
  const clickForIcs = (sel) => page.evaluate((s) => {
    let ics = '', msg = null; const RealBlob = window.Blob, realSave = window.saveFile;
    window.Blob = function (parts, opts) { ics = String(parts[0]); return new RealBlob(parts, opts); };
    window.saveFile = function (h, f, m) { msg = m; };
    const el = [...document.querySelectorAll(s.sel)].filter((e) => new RegExp(s.re).test(e.textContent || ''))[0];
    if (el) el.click();
    window.Blob = RealBlob; window.saveFile = realSave;
    return { clicked: !!el, ics, msg, vevents: (ics.match(/BEGIN:VEVENT/g) || []).length };
  }, sel);

  /* One VEVENT per UID, so two exports can be compared appointment by appointment. The bug this
     catches is that a UID used to be the visit's INDEX in a shrinking list, so every identifier
     silently moved to a different appointment on the second export. */
  const byUid = (ics) => {
    const out = {};
    String(ics).split('BEGIN:VEVENT').slice(1).forEach((b) => {
      const u = (b.match(/UID:(\S+)/) || [])[1]; if (!u) return;
      out[u] = { day: (b.match(/DTSTART;VALUE=DATE:(\d{8})/) || [])[1] || null,
        summary: (b.match(/SUMMARY:(.*)/) || [])[1] || '',
        seq: (b.match(/SEQUENCE:(\d+)/) || [])[1],
        cancelled: /STATUS:CANCELLED/.test(b) };
    });
    return out;
  };
  const uidCount = (ics) => (String(ics).match(/^UID:/gm) || []).length;

  console.log('\n1. a ten-day-old: the row sits with the ring, not three screens under it');
  {
    await load(seed());
    const r = await VAX();
    ok('the calendar row is on the vaccines screen, exactly one of it', r.count === 1, r);
    ok('it comes straight after the ring hero', r.prev === 'ms-hero', r);
    ok('and that really is the completion ring', r.prevHasRing === true, r);
    ok('the screen still lists the doses', r.doseRows > 6, r.doseRows);
    ok('the row is above every dose row', r.iCal >= 0 && r.iCal < r.iFirstDose, r);
    ok('above the disclaimer', r.iCal < r.iDisc, r);
    ok('above "Add a vaccine"', r.iCal < r.iAdd, r);
    ok('and visible on a 390x844 screen without scrolling', r.top > 0 && r.bottom < r.navTop, r);
    /* gapBelow alone is NOT a discriminator: with the row at the foot of the tab its next sibling is a
       .sec-title, which picks up 16px from the `.add-row + .sec-title` rule at index.html:467 and
       prints ok for free. The row's OWN computed margin-bottom is the property under test. */
    ok('it takes the 16px block gap into the card below, not the 8px row rhythm', r.mb === '16px' && r.gapBelow === 16, r);
    ok('and it is not dressed as a dashed "add something" row any more', r.borderStyle === 'solid', r);

    /* THE NUMBER COLLISION. The ring hero directly above prints the plan total twice ("0 of 27 done ·
       0 of 27 recorded"). This row used to print "these 7 visits" 16px under it, so the only reading
       available to a parent was that twenty of the twenty-seven were being left out, on the vaccine
       screen. And "these" pointed at a list that is now BELOW it. The row carries no count at all. */
    ok('the ring above it really does print the plan total', /\b\d+\b/.test(r.prevText) && r.planned !== r.upcoming, { prev: r.prevText, planned: r.planned, upcoming: r.upcoming });
    ok('so the row prints no number of its own to collide with it', !/\d/.test(r.text), r.text);
    ok('and it does not say "these", which had nothing left to point at', !/\bthese\b/i.test(r.text), r.text);
    ok('it names what it offers: the visits still ahead of her', /Put the visits still ahead in my calendar/.test(r.text), r.text);
  }

  console.log('\n2. tapping it still writes the calendar file');
  {
    const r = await clickForIcs({ sel: '.add-row', re: 'in my calendar' });
    const v = await VAX();
    ok('the row responds to a real click', r.clicked === true, r.clicked);
    ok('one entry per visit', r.vevents === v.upcoming && r.vevents > 0, { vevents: r.vevents, upcoming: v.upcoming });
    ok('all-day, because the clinic sets the hour', /DTSTART;VALUE=DATE:\d{8}/.test(r.ics));
    ok('no visit is dated in the past', (() => {
      const days = (r.ics.match(/DTSTART;VALUE=DATE:(\d{8})/g) || []).map((s) => s.slice(-8));
      const today = new Date(CLOCK); const p = (x) => String(x).padStart(2, '0');
      const t = today.getFullYear() + p(today.getMonth() + 1) + p(today.getDate());
      return days.length === v.upcoming && days.every((d) => d >= t);
    })(), r.ics.slice(0, 200));
    const m1 = byUid(r.ics);
    ok('every entry carries a revision number, so a re-import can supersede it', Object.keys(m1).length > 0 && Object.keys(m1).every((u) => m1[u].seq === '1'), m1);
    ok('no two entries in one file share a UID', uidCount(r.ics) === Object.keys(m1).length && uidCount(r.ics) === r.vevents, { uids: uidCount(r.ics), unique: Object.keys(m1).length, vevents: r.vevents });
    ok('a UID names the visit by its age, not by its place in a list', Object.keys(m1).every((u) => /^cubby-vax-b1-a[0-9_]+@/.test(u)), Object.keys(m1));
    ok('the toast does not claim the visits are already in her calendar', /^Saved\. Open it to add the visits to your calendar/.test(r.msg || ''), r.msg);
  }

  console.log('\n3. the onboarding sheet at minute two');
  {
    await load(seed());
    const r = await page.evaluate(() => {
      openOnboardInvite();
      const sh = document.getElementById('sheet');
      const btns = [...sh.querySelectorAll('button')].map((b) => b.textContent.trim());
      return { btns, n: btns.length,
        cal: btns.filter((t) => /in my calendar/.test(t)),
        plan: btns.filter((t) => /See their vaccine plan/.test(t)).length,
        first: btns.filter((t) => /^Log a/.test(t)).length,
        proof: vaxProofLine(),
        upcoming: vaxUpcomingVisits(vaccinePlan()).length,
        shown: sh.classList.contains('show') };
    });
    ok('the sheet offers the calendar', r.cal.length === 1, r.btns);
    ok('"See their vaccine plan" is still there beside it', r.plan === 1, r.btns);
    ok('and the first log is still the primary action', r.first === 1, r.btns);
    /* THE SECOND NUMBER COLLISION. vaxProofLine four rows above says "8 visits" (every distinct due
       age, the at-birth one included); the offer used to say "the next 7 visits", because that one is
       already behind her, and nothing on the sheet said so. The old assertion here only demanded the
       two numbers DIFFER, which is the disagreement, and it passed for free on `cal[0] || ''` when the
       button was missing altogether. The offer now carries no number, so it cannot disagree. */
    ok('the line above it really does print a count', /\b\d+\b/.test(r.proof) && r.cal.length === 1, { proof: r.proof, cal: r.cal });
    ok('and the offer prints none of its own to fight it', r.cal.length === 1 && !/\d/.test(r.cal[0]), { proof: r.proof, cal: r.cal[0] });
    ok('it is word for word the label on the vaccines tab, one string, no drift', r.cal[0] === '📅 Put the visits still ahead in my calendar', r.cal[0]);
    const c = await clickForIcs({ sel: '#sheet button', re: 'in my calendar' });
    ok('tapping it writes the same file', c.vevents === r.upcoming && c.vevents > 0, { vevents: c.vevents, upcoming: r.upcoming });
    ok('and the same honest toast, at the one moment she has never seen an .ics before', /^Saved\. Open it to add the visits to your calendar/.test(c.msg || ''), c.msg);
    const after = await page.evaluate(() => {
      const sh = document.getElementById('sheet');
      return { open: sh.classList.contains('show'),
        first: [...sh.querySelectorAll('button')].filter((b) => /^Log a/.test(b.textContent.trim())).length };
    });
    ok('the sheet stays open, so the first log is not lost to a download', after.open === true, after);
    ok('and the first-log button is still under her thumb', after.first === 1, after);
  }

  console.log('\n4. no birthday: nothing is offered, because there are no real dates');
  {
    await load(seed({ babies: [{ id: 'b1', name: 'Wren', birth: null, country: 'GB', routines: [] }] }));
    const r = await VAX();
    ok('no calendar row on the vaccines screen', r.count === 0, r);
    ok('the screen itself still renders', r.doseRows > 0, r.doseRows);
    const s = await page.evaluate(() => {
      openOnboardInvite();
      const btns = [...document.querySelectorAll('#sheet button')].map((b) => b.textContent.trim());
      return { cal: btns.filter((t) => /in my calendar/.test(t)).length, first: btns.filter((t) => /^Log a/.test(t)).length, n: btns.length };
    });
    ok('and none in the onboarding sheet', s.cal === 0, s);
    ok('the sheet is otherwise unharmed', s.first === 1 && s.n > 3, s);
  }

  console.log('\n5. the far end of the schedule: every visit already behind them');
  {
    await load(seed({ babies: [{ id: 'b1', name: 'Wren', birth: now - 30 * 365 * DAY, country: 'GB', routines: [] }] }));
    const r = await VAX();
    ok('nothing left to put in a calendar, so no row', r.count === 0, r);
    ok('and vaxUpcomingVisits agrees', r.upcoming === 0, r);
    const s = await page.evaluate(() => {
      openOnboardInvite();
      const btns = [...document.querySelectorAll('#sheet button')].map((b) => b.textContent.trim());
      return { cal: btns.filter((t) => /in my calendar/.test(t)).length,
        plan: btns.filter((t) => /See their vaccine plan/.test(t)).length, proof: vaxProofLine() };
    });
    ok('the sheet drops the calendar offer', s.cal === 0, s);
    ok('but still shows the plan, so absence is driven by the dates and not by the plan', s.plan === 1 && !!s.proof, s);
  }

  console.log('\n6. two babies: the row belongs to the one on screen');
  {
    await load(seed({
      babies: [{ id: 'b1', name: 'Wren', birth: now - 10 * DAY, country: 'GB', routines: [] },
        { id: 'b2', name: 'Ash', birth: null, country: 'GB', routines: [] }],
      activeBabyId: 'b2',
    }));
    const other = await VAX();
    ok('the sibling with no birthday gets no row', other.count === 0, other);
    await page.evaluate(() => { state.activeBabyId = 'b1'; persist(); render(); });
    await sleep(300);
    const mine = await VAX();
    ok('switching to the one with a birthday brings it back', mine.count === 1, mine);
    ok('driven by HER dates, and still the one label', mine.upcoming > 0 && mine.text === '📅 Put the visits still ahead in my calendar', mine);
    ok('still directly under the ring', mine.prev === 'ms-hero', mine);
  }

  console.log('\n7. a catch-up card does not push it back down');
  {
    // Nine months old with nothing recorded: doses well past due are "to confirm", which is what
    // renders vaxSetupCard. That card used to sit above the calendar row; it must not any more.
    await load(seed({ babies: [{ id: 'b1', name: 'Wren', birth: now - 275 * DAY, country: 'GB', routines: [] }] }));
    const r = await VAX();
    ok('the catch-up card is on screen', r.iSetup >= 0, r);
    ok('the calendar row is still first after the ring', r.prev === 'ms-hero', r);
    ok('and above the catch-up card', r.iCal < r.iSetup, r);
    ok('with a block gap into it, not a row gap', r.gapBelow === 16, r);
    ok('there are still visits ahead at nine months', r.upcoming > 0, r);
  }

  console.log('\n8. back from the clinic: a second save, live and then on the next boot');
  {
    await load(seed());
    const before = await VAX();
    const first = await clickForIcs({ sel: '.add-row', re: 'in my calendar' });
    const marked = await page.evaluate(() => {
      // Through the real path: open the soonest un-given doses and mark them, exactly as a parent
      // back from the clinic would, then read the row the re-render produced.
      const plan = vaccinePlan();
      const soonest = plan.filter((v) => !v.given && vxDueDate(v) > now()).sort((a, b) => vxDueDate(a) - vxDueDate(b))[0];
      const share = plan.filter((v) => !v.given && v.dueMonths === soonest.dueMonths);
      share.forEach((v) => { openVaccine(v.id); markVaccine(v.id); });
      return { cleared: share.length, given: vaccinePlan().filter((v) => v.given).length };
    });
    await sleep(400);
    const after = await VAX();
    ok('the doses were really recorded', marked.given === marked.cleared && marked.cleared > 0, marked);
    ok('the whole visit drops off the offer, not one dose of it', after.upcoming === before.upcoming - 1, { before: before.upcoming, after: after.upcoming });
    ok('the row survives the re-render unchanged, no number to go stale', after.count === 1 && after.text === before.text, { before: before.text, after: after.text });
    ok('it is still with the ring after the re-render', after.prev === 'ms-hero', after);

    /* THE SECOND EXPORT IS THE WHOLE POINT OF MOVING THIS ROW. Promoted to the head of the tab and
       into the onboarding sheet, it will be tapped more than once, which is exactly what the old file
       could not survive: UIDs were the visit's INDEX in vaxUpcomingVisits, a list that loses an entry
       every time a visit is recorded, so on the second export all seven identifiers slid onto a
       different appointment. Measured: cubby-vax-b1-0 moved from 2026-09-23 to 2026-10-21, and -6 was
       orphaned, leaving two entries on the same day for the same booster. A calendar that honours the
       UID rewrites six real appointments to the wrong date. This is a vaccine schedule. */
    const again = await clickForIcs({ sel: '.add-row', re: 'in my calendar' });
    const m1 = byUid(first.ics), m2 = byUid(again.ics);
    const still = Object.keys(m1).filter((u) => m2[u] && !m2[u].cancelled);
    const gone = Object.keys(m1).filter((u) => !m2[u] || m2[u].cancelled);
    ok('both exports really happened', first.vevents === before.upcoming && again.vevents >= after.upcoming && first.vevents > 1, { first: first.vevents, again: again.vevents, before: before.upcoming, after: after.upcoming });
    ok('the visits still ahead keep the identifiers they had', still.length === after.upcoming, { still: still.length, expected: after.upcoming });
    ok('and every one of them still points at the SAME date it did before', still.length > 0 && still.every((u) => m1[u].day === m2[u].day),
      still.filter((u) => m1[u].day !== m2[u].day).map((u) => u + ' ' + m1[u].day + ' -> ' + m2[u].day));
    ok('the visit she has been to is the only one that leaves, and it is the soonest one', gone.length === 1 && still.every((u) => m1[gone[0]].day < m1[u].day), { gone: gone.map((u) => m1[u].day), still: still.map((u) => m1[u].day) });
    ok('and it leaves cancelled rather than abandoned in her calendar', !!(m2[gone[0]] && m2[gone[0]].cancelled && m2[gone[0]].day === m1[gone[0]].day), { was: m1[gone[0]], now: m2[gone[0]] });
    ok('the second file is a higher revision, so a calendar may supersede the first', Object.keys(m2).every((u) => m2[u].seq === '2'), Object.keys(m2).map((u) => u + ':' + m2[u].seq));
    ok('and no UID is written twice inside it', uidCount(again.ics) === Object.keys(m2).length, { uids: uidCount(again.ics), unique: Object.keys(m2).length });

    /* The cold boot is seeded rather than reloaded after that save. app/store-firebase.js replaces
       persist() with a debounced Firestore push the moment it loads, so in a signed-out headless
       browser NOTHING a write makes reaches localStorage and a write-then-reload would only be
       measuring the harness. This is the same state a returning parent boots into. */
    const plan = await page.evaluate(() => JSON.parse(JSON.stringify(vaccinePlan())));
    const due = (v) => (now - 10 * DAY) + v.dueMonths * 30.44 * DAY;
    const firstAge = Math.min(...plan.filter((v) => due(v) > now).map((v) => v.dueMonths));
    const recorded = plan.map((v) => (v.dueMonths === firstAge ? Object.assign({}, v, { given: true, givenAt: now }) : v));
    ok('the seeded boot really has doses on it', recorded.filter((v) => v.given).length === marked.cleared, recorded.filter((v) => v.given).length);
    await load(seed({ vaccines: { b1: recorded } }));
    const back = await VAX();
    ok('the row is there on a cold boot with doses already recorded', back.count === 1, back);
    ok('still with the ring', back.prev === 'ms-hero', back);
    const cold = await clickForIcs({ sel: '.add-row', re: 'in my calendar' });
    ok('and it does not re-offer the visit she has already been to', back.upcoming === after.upcoming && cold.vevents === back.upcoming, { back: back.upcoming, after: after.upcoming, vevents: cold.vevents });
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'VAX-CAL-ROW: FAIL' : 'VAX-CAL-ROW: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
