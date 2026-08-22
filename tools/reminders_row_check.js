#!/usr/bin/env node
/* The Settings row that promised two channels Cubby does not have.
 *
 * It read "Gentle nudges for medicine, vaccines & rituals". Only the first of those three is real:
 *
 *   - syncReminderIndex builds the push queue from state.meds and nothing else, and says so in its
 *     own comment ("ONLY medicine is critical enough to push"). No vaccine has ever been pushed.
 *   - the rituals sheet admits outright, two thousand lines away, "Cubby does not send reminders
 *     for these yet".
 *
 * So a parent tapped a row that promised vaccine and ritual nudges, landed in a sheet that talks
 * only about medicine, and then either trusted a nudge that will never come or worked out that the
 * app had told her something untrue. Both are expensive in an app whose whole wedge is being the
 * one thing a frightened parent can believe at 3am.
 *
 * What is real for vaccines and for set dose times is the parent's OWN calendar: exportVaccineSchedule
 * and openDoseCalendar write .ics entries that her phone then alerts on. The row now names those two
 * true things, and the sheet says the same, always, not only in the branch where push is switched off.
 *
 * The second half of this gate is the harder half. Naming a SCREEN a parent cannot find is the same
 * untruth as naming a CHANNEL that does not exist, so the copy is now reachability-driven and every
 * state where a route is missing is tested here: a pregnancy (no baby, no vaccine list, no medicine
 * anywhere in the shell), a five-year-old whose visits are all behind her (vaxCalendarRow returns ''),
 * a mother holding a loss, and the !ready branch that used to say the calendar thing a second time.
 *
 *   PORT=9613 node tools/serve.js &
 *   node tools/reminders_row_check.js http://localhost:9613
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:9613';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, HOUR = 3600000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

// Mid-afternoon, so nothing under test is sitting on a midnight or quiet-hours boundary.
const CLOCK = (() => { const d = new Date(); d.setHours(14, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

const seed = (over) => Object.assign({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
  activeBabyId: 'b1', events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
}, over || {});

const DAILY_MED = { id: 'm1', babyId: 'b1', name: 'Infant paracetamol', dose: '2.5', unit: 'ml',
  pattern: { type: 'daily', times: ['08:00', '20:00'] }, remind: true, active: true };

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
    await sleep(1400);
  };

  /* The row, read out of the rendered sheet rather than out of the source. Returns the count too,
     because "the row that matches" being absent must never look the same as "the row is fine". */
  const readRow = () => page.evaluate(() => {
    try { closeSheet(); } catch (e) {}
    openSettings();
    const sheet = document.getElementById('sheet');
    const rows = Array.from(sheet.querySelectorAll('.set-item'))
      .filter((el) => /openReminders/.test(el.getAttribute('onclick') || ''));
    const r = rows[0];
    return {
      count: rows.length,
      title: r ? (r.querySelector('.si-body .a') || {}).textContent : null,
      sub: r ? ((r.querySelector('.si-body .b') || {}).textContent || '').replace(/\s+/g, ' ').trim() : null,
    };
  });

  /* Open the reminders sheet by CLICKING the row a parent taps, not by calling openReminders(), so
     a row wired to nothing would fail here rather than pass on a function that still works. */
  const clickRowAndReadSheet = () => page.evaluate(() => {
    const sheet = document.getElementById('sheet');
    const row = Array.from(sheet.querySelectorAll('.set-item'))
      .filter((el) => /openReminders/.test(el.getAttribute('onclick') || ''))[0];
    if (!row) return { opened: false };
    row.click();
    const s = document.getElementById('sheet');
    const h2 = s.querySelector('h2');
    let title = '';
    if (h2) for (const n of h2.childNodes) if (n.nodeType === 3) title += n.textContent;
    const subs = Array.from(s.querySelectorAll('.sub, .csub, .preg-disclaim'))
      .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim());
    const toggles = Array.from(s.querySelectorAll('.set-item'))
      .map((el) => ((el.querySelector('.si-body .a') || {}).textContent || '').trim());
    return { opened: true, title: title.trim(), subs, toggles, shown: s.classList.contains('show') };
  });

  /* Matches whichever honest variant the state earns. It used to be pinned to the both-routes
     sentence, which meant a state with only one real route looked like a missing line. The clause
     each variant may NOT contain is asserted where that state is set up (sections 5, 8, 9, 11). */
  const CAL_LINE = /can go into your own calendar, where your phone does the reminding/i;

  console.log('\n1. the Settings row names only what Cubby can actually do');
  {
    await load(seed());
    const r = await readRow();
    ok('there is exactly one reminders row in Settings', r.count === 1, r);
    ok('it is still called Reminders', r.title === 'Reminders', r);
    ok('the subtitle leads with dose alerts, the one channel that exists', /dose alert/i.test(r.sub || ''), r);
    ok('it no longer promises ritual nudges', !/ritual/i.test(r.sub || ''), r);
    ok('it names the calendar, which is how vaccine dates really reach her', /calendar/i.test(r.sub || ''), r);
    /* Vaccines may be mentioned, but only as something that goes in a calendar. "Nudges for
       vaccines" is the exact untruth this gate exists to stop coming back. This baby HAS visits
       ahead, so demand the word rather than letting a subtitle that never says "vaccine" pass for
       free the way `!/vaccine/.test(sub) || ...` used to. The states where it must be absent are
       sections 8 to 11. */
    ok('vaccines are named here, because this baby has visits ahead', /vaccine/i.test(r.sub || ''), r);
    ok('and they are described as calendar entries, never as nudges',
      /vaccine[\s\S]*calendar/i.test(r.sub || ''), r);
    ok('the old copy is gone', !/gentle nudges for medicine/i.test(r.sub || ''), r);
  }

  console.log('\n2. tapping the row opens a sheet that tells the same story');
  {
    const s = await clickRowAndReadSheet();
    ok('the row really opens the reminders sheet', s.opened === true && s.title === 'Reminders 🔔', s.title);
    ok('the sheet is on screen', s.shown === true, s);
    ok('the sheet says where the calendar route lives', s.subs.filter((t) => CAL_LINE.test(t)).length === 1,
      s.subs.filter((t) => /calendar/i.test(t)));
    ok('and it says it once, not twice', s.subs.filter((t) => /can go into your own calendar/i.test(t)).length === 1,
      s.subs.filter((t) => /calendar/i.test(t)));
    ok('the sheet states plainly that rituals are not nudged',
      s.subs.some((t) => /never for feeds, naps, rituals or milestones/i.test(t)), s.subs[0]);
    /* Three consent rows and no more. A fourth called Vaccines or Rituals would be the promise
       coming back in a different place. The other rows in this sheet are per-device switches
       ("Dose alerts in the app", and "Gentle reminders" wherever push is live), so account for
       every row rather than only counting the ones that look right. */
    const cats = s.toggles.filter((t) => /^(Dose reminders|New in Cubby|Offers)$/i.test(t));
    const devs = s.toggles.filter((t) => /^(Dose alerts in the app|Gentle reminders)$/i.test(t));
    ok('exactly three things Cubby may send you', cats.length === 3 && cats.every((t) => t.length > 0), s.toggles);
    ok('and every other row in the sheet is a device switch, nothing unaccounted for',
      s.toggles.length > 0 && s.toggles.length === cats.length + devs.length, s.toggles);
    ok('no toggle offers a vaccine or ritual channel', !s.toggles.some((t) => /vaccine|ritual/i.test(t)), s.toggles);
  }

  console.log('\n3. every clause of the new row is backed by a control that exists');
  {
    await load(seed());
    const vax = await page.evaluate(() => {
      try { closeSheet(); } catch (e) {}
      go('health'); setHealthTab('vaccines');
      const rows = Array.from(document.querySelectorAll('#scroll .add-row'))
        .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
        .filter((t) => /in my calendar/i.test(t));
      return { n: rows.length, rows: rows, plan: vaxUpcomingVisits(vaccinePlan()).length };
    });
    ok('a two-month-old has visits still ahead of her', vax.plan > 0, vax);
    ok('the vaccine list really offers to put them in her calendar', vax.n === 1, vax);

    await load(seed({ meds: [DAILY_MED] }));
    const dose = await page.evaluate(() => {
      try { closeSheet(); } catch (e) {}
      openMedManage('m1');
      const btns = Array.from(document.querySelectorAll('#sheet button, #sheet .add-row'))
        .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
        .filter((t) => /my calendar/i.test(t));
      const opener = Array.from(document.querySelectorAll('#sheet button'))
        .filter((el) => /openDoseCalendar/.test(el.getAttribute('onclick') || '')).length;
      return { n: btns.length, btns: btns, opener: opener };
    });
    ok('a set-times medicine really offers to put its doses in her calendar', dose.n === 1, dose);
    ok('and that button is wired to openDoseCalendar', dose.opener === 1, dose);
  }

  console.log('\n4. the two channels the row used to promise are still absent, so the fix is still needed');
  {
    await load(seed());
    const rit = await page.evaluate(() => {
      try { closeSheet(); } catch (e) {}
      openRoutinesEdit();
      return Array.from(document.querySelectorAll('#sheet .preg-disclaim, #sheet .csub'))
        .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
        .join(' | ');
    });
    const admits = /does not send reminders for these/i.test(rit);
    ok('the rituals sheet still admits it sends no reminders', admits, rit.slice(0, 160));
    const r = await readRow();
    /* Unconditional. This used to read `!admits || !/ritual/…`, which meant the day the rituals
       sheet reworded its own admission the assertion passed no matter what the row said. */
    ok('so the Settings row must not promise ritual nudges, and does not',
      !/ritual/i.test(r.sub || ''), { admits: admits, sub: r.sub });
    /* Push is built from state.meds alone. With a due vaccine and zero medicines there is nothing
       for the queue to carry, which is why the row cannot honestly say "nudges for vaccines". */
    const q = await page.evaluate(() => {
      const win = { from: Date.now(), to: Date.now() + 48 * 3600000 };
      const fires = (state.meds || []).reduce((n, m) => n + medFireTimes(m, win.from, win.to).length, 0);
      return { meds: (state.meds || []).length, fires: fires, vaxAhead: vaxUpcomingVisits(vaccinePlan()).length };
    });
    ok('with a vaccine due and no medicine there is nothing to push at all',
      q.vaxAhead > 0 && q.meds === 0 && q.fires === 0, q);
  }

  console.log('\n5. the row is honest for a parent with nothing logged, and for one who is not the owner');
  {
    await load(seed({ babies: [], activeBabyId: null }));
    const r = await readRow();
    ok('with no baby at all the reminders row is still there', r.count === 1, r);
    ok('and it still leads with dose alerts', /dose alert/i.test(r.sub || ''), r);
    /* It must NOT still read the same. There is no vaccine list and no medicine to open, so the two
       calendar clauses have nothing behind them. The old version of this assertion required the
       identical string in every state, which would have actively defended that untruth. */
    ok('but with no vaccine list to point at, it does not offer one', !/vaccine/i.test(r.sub || ''), r);
    ok('and it does not send her looking for a calendar line that is not there', !/calendar/i.test(r.sub || ''), r);
    const emptySheet = await clickRowAndReadSheet();
    ok('and the sheet it opens carries no calendar line either',
      emptySheet.subs.filter((t) => /your own calendar/i.test(t)).length === 0,
      emptySheet.subs.filter((t) => /calendar/i.test(t)));

    await load(seed());
    const asCaregiver = await page.evaluate(() => {
      window.LL = { auth: { currentUser: { uid: 'uidSam' } }, members: { local: 'owner', uidSam: 'caregiver' },
        memberInfo: { local: { name: 'Maya' }, uidSam: { name: 'Sam' } } };
      try { closeSheet(); } catch (e) {}
      openSettings();
      const rows = Array.from(document.querySelectorAll('#sheet .set-item'))
        .filter((el) => /openReminders/.test(el.getAttribute('onclick') || ''));
      return { count: rows.length, sub: rows[0] ? (rows[0].querySelector('.si-body .b').textContent || '').replace(/\s+/g, ' ').trim() : null };
    });
    ok('the second caregiver sees the row too', asCaregiver.count === 1, asCaregiver);
    ok('and is told the same true thing', /dose alert/i.test(asCaregiver.sub || '') && !/ritual/i.test(asCaregiver.sub || ''), asCaregiver);
  }

  console.log('\n6. muting dose alerts, saving, and coming back does not change the promise');
  {
    await load(seed({ meds: [DAILY_MED] }));
    const before = (await readRow()).sub;
    const off = await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll('#sheet .set-item'))
        .filter((el) => /openReminders/.test(el.getAttribute('onclick') || ''))[0];
      row.click();
      setMedAlerts(false);
      const s = document.getElementById('sheet');
      return {
        muted: typeof medAlertsMuted === 'function' ? medAlertsMuted() : null,
        subs: Array.from(s.querySelectorAll('.sub, .csub, .preg-disclaim')).map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim()),
      };
    });
    ok('dose alerts really went off', off.muted === true, off.muted);
    ok('a parent who muted alerts is still told about the calendar route',
      off.subs.filter((t) => CAL_LINE.test(t)).length === 1, off.subs.filter((t) => /calendar/i.test(t)));

    await page.reload({ waitUntil: 'networkidle2' }); await sleep(1400);
    const after = await readRow();
    /* Pinned to the literal string, not to `before`. Comparing the build against itself could only
       ever fail if the copy were nondeterministic, so it passed identically on the old code. */
    ok('after a reload the row still reads the honest thing, word for word',
      after.sub === 'Dose alerts, plus vaccine visits and dose times in your own calendar' && after.sub === before,
      { before: before, after: after.sub });
    const reopened = await clickRowAndReadSheet();
    ok('and reopening the sheet a second time shows the calendar line once, not twice',
      reopened.subs.filter((t) => CAL_LINE.test(t)).length === 1, reopened.subs.filter((t) => /calendar/i.test(t)));
  }

  console.log('\n7. an older child changes nothing about what Cubby promises');
  {
    await load(seed({ babies: [{ id: 'b1', name: 'Robin', birth: now - 900 * DAY, sex: 'F', country: 'uk', stageOverride: 'child', routines: [], doctors: [], allergies: [] }] }));
    const ahead = await page.evaluate(() => vaxUpcomingVisits(vaccinePlan()).length);
    ok('this child still has a visit ahead of her, so the vaccine clause is honest here', ahead > 0, ahead);
    const r = await readRow();
    ok('the child stage keeps one honest reminders row', r.count === 1 && /dose alert/i.test(r.sub || ''), r);
    ok('and it names the vaccine visits she really has coming', /vaccine visits/i.test(r.sub || ''), r);
    ok('and still no ritual promise', !/ritual/i.test(r.sub || ''), r);
  }

  console.log('\n8. a pregnancy has no vaccine list and no medicine, so the row offers neither');
  {
    /* The stage a parent is in for up to nine months before item 19's baby world exists. Every seed
       above hardcodes pregnancy:null, which is how the first version of this fix shipped a row and a
       sheet that sent an expecting mother looking for two screens that are not in her app. */
    await load(seed({ babies: [], activeBabyId: null,
      pregnancy: { stage: 'expecting', dueDate: now + 120 * DAY, country: 'GB' } }));
    const sweep = await page.evaluate(() => {
      try { closeSheet(); } catch (e) {}
      const hit = { vaccine: false, medicine: false, calendarRow: false };
      ['home', 'moments', 'care', 'health', 'log', 'album'].forEach((v) => {
        try { go(v); } catch (e) {}
        const t = ((document.getElementById('scroll') || {}).innerText || '');
        if (/vaccin/i.test(t)) hit.vaccine = true;
        if (/medicine/i.test(t)) hit.medicine = true;
        if (/in my calendar/i.test(t)) hit.calendarRow = true;
      });
      return hit;
    });
    ok('the pregnancy shell really has no vaccine list, no medicine and no calendar row anywhere',
      sweep.vaccine === false && sweep.medicine === false && sweep.calendarRow === false, sweep);
    const r = await readRow();
    ok('the reminders row is still reachable while expecting', r.count === 1 && r.title === 'Reminders', r);
    ok('and it does not promise her a vaccine list she does not have', !/vaccine/i.test(r.sub || ''), r);
    ok('and it does not send her hunting for a calendar line', !/calendar/i.test(r.sub || ''), r);
    ok('and it still says nothing about rituals', !/ritual/i.test(r.sub || ''), r);
    const s = await clickRowAndReadSheet();
    ok('the sheet still opens from the row while expecting', s.opened === true && s.title === 'Reminders 🔔', s.title);
    ok('and the sheet gives her no calendar directions either',
      s.subs.filter((t) => /your own calendar/i.test(t)).length === 0, s.subs.filter((t) => /calendar/i.test(t)));
  }

  console.log('\n9. once every visit is behind her, the vaccine clause goes with it');
  {
    /* vaxCalendarRow returns '' as soon as vaxUpcomingVisits() is empty. Section 3 only ever checked
       the row at 60 days, one age band away from where the claim it defends becomes false. */
    const OLD = { id: 'b1', name: 'Robin', birth: now - 2000 * DAY, sex: 'F', country: 'GB', routines: [], doctors: [], allergies: [] };
    await load(seed({ babies: [OLD] }));
    const vax = await page.evaluate(() => {
      try { closeSheet(); } catch (e) {}
      go('health'); setHealthTab('vaccines');
      return {
        ahead: vaxUpcomingVisits(vaccinePlan()).length,
        rows: Array.from(document.querySelectorAll('#scroll .add-row'))
          .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim()).filter((t) => /in my calendar/i.test(t)).length,
      };
    });
    ok('a five-year-old has no visit left ahead of her', vax.ahead === 0, vax);
    ok('so the vaccine list offers no calendar row at all', vax.rows === 0, vax);
    const r = await readRow();
    ok('and the Settings row stops naming vaccine visits', !/vaccine/i.test(r.sub || ''), r);
    const s = await clickRowAndReadSheet();
    ok('and the sheet stops telling her to look on the vaccine list',
      s.subs.filter((t) => /vaccine list/i.test(t)).length === 0, s.subs.filter((t) => /calendar/i.test(t)));

    /* Same child, one saved medicine with set times. Now exactly one route exists, and exactly one
       clause may be spoken: the dose half without the vaccine half. */
    await load(seed({ babies: [OLD], meds: [DAILY_MED] }));
    const r2 = await readRow();
    ok('with a set-times medicine the row names dose times', /dose times in your own calendar/i.test(r2.sub || ''), r2);
    ok('and still not vaccines', !/vaccine/i.test(r2.sub || ''), r2);
    const s2 = await clickRowAndReadSheet();
    const dosed = s2.subs.filter((t) => /your own calendar/i.test(t));
    ok('the sheet says the calendar thing exactly once', dosed.length === 1, dosed);
    ok('and points only at the saved medicine, never at the vaccine list',
      dosed.length === 1 && /saved medicine with set times/i.test(dosed[0]) && !/vaccine/i.test(dosed[0]), dosed);
    /* Nit from the voice audit: on a medicine the control is a ghost BUTTON that only appears once
       the medicine is saved, so "look for the calendar row" sent a parent adding her first medicine
       hunting for something that did not exist yet. */
    ok('it calls it the 📅 line, not a row', dosed.length === 1 && /📅 line/.test(dosed[0]) && !/calendar row/i.test(dosed[0]), dosed);
  }

  console.log('\n10. the branch where push is switched off says it once, not twice');
  {
    /* Headless Chrome always lands on ready:true (isNativeApp() is false and REMINDERS_LIVE is true),
       so the entire !ready rendering of this sheet was untested. remindersLive is a top-level function
       declaration, so it can be replaced on window to reach the branch a wrapper user actually sees. */
    await load(seed());
    const off = await page.evaluate(() => {
      window.remindersLive = function () { return false; };
      try { closeSheet(); } catch (e) {}
      openReminders();
      const s = document.getElementById('sheet');
      const subs = Array.from(s.querySelectorAll('.sub, .csub, .preg-disclaim'))
        .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim());
      return { subs: subs, disclaim: subs.filter((t) => /not switched on in the app yet/i.test(t)) };
    });
    ok('the not-yet-switched-on disclaimer really is on screen', off.disclaim.length === 1, off.disclaim);
    ok('and it no longer carries a calendar sentence of its own',
      off.disclaim.length === 1 && !/calendar/i.test(off.disclaim[0]), off.disclaim);
    /* Counts the WORD, not the new sentence's own phrasing. Counting "your own calendar" missed the
       real duplicate entirely, because the disclaimer's tail said "your phone's own calendar". */
    ok('so the whole sheet mentions the calendar exactly once',
      off.subs.filter((t) => /calendar/i.test(t)).length === 1,
      off.subs.filter((t) => /calendar/i.test(t)));
    await page.reload({ waitUntil: 'networkidle2' }); await sleep(1400);   // drop the stub
  }

  console.log('\n11. a mother holding a loss is not shown a baby-future word one layer deeper');
  {
    await load(seed({ babies: [], activeBabyId: null, lossHolding: { local: { at: now - 3 * DAY } } }));
    const r = await readRow();
    ok('the reminders row is still there in the quiet state', r.count === 1, r);
    ok('and it does not say vaccine', !/vaccine/i.test(r.sub || ''), r);
    const s = await clickRowAndReadSheet();
    ok('and neither does the sheet behind it',
      s.opened === true && !s.subs.some((t) => /vaccine/i.test(t)), s.subs.filter((t) => /vaccine/i.test(t)));
  }

  console.log('\n12. reading the row costs nothing: opening Settings must not write the household blob');
  {
    /* The reachability check has to ask the vaccine schedule a question, and the obvious way to ask
       it, vaccinePlan(), GENERATES the plan and persist()s it. That would turn merely opening
       Settings into a write of the shared household doc, which is a whole-field overwrite. */
    await load(seed({ vaccines: {} }));
    const w = await page.evaluate(() => {
      /* The first render generates the plan long before Settings is opened, so clear it here: the
         question is whether READING the row regenerates it, not whether the app ever does. */
      try { closeSheet(); } catch (e) {}
      if (state.vaccines) delete state.vaccines.b1;
      const real = window.persist; let n = 0;
      window.persist = function () { n++; return real.apply(this, arguments); };
      openSettings();
      const rows = Array.from(document.querySelectorAll('#sheet .set-item'))
        .filter((el) => /openReminders/.test(el.getAttribute('onclick') || ''));
      const sub = rows[0] ? (rows[0].querySelector('.si-body .b').textContent || '').replace(/\s+/g, ' ').trim() : null;
      const generated = !!(state.vaccines && state.vaccines.b1);
      window.persist = real;
      return { writes: n, sub: sub, generated: generated };
    });
    ok('the row still names the vaccine visits this baby has ahead', /vaccine visits/i.test(w.sub || ''), w);
    ok('and it worked it out without generating a vaccine plan', w.generated === false, w);
    ok('and without a single write', w.writes === 0, w);
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'REMINDERS-ROW: FAIL' : 'REMINDERS-ROW: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
