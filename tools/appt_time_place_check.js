#!/usr/bin/env node
/* Her appointment letter says "Tuesday 14th, 3:15pm, St Mary's" and Cubby had nowhere to put it.
 *
 * An antenatal appointment was {week, title, note}. No date, no time, no place anywhere in the
 * pregnancy stage, so everything downstream was an estimate of something she already knew for
 * certain: the home card said "in about 3 weeks", the Care list said "Week 20", and the
 * add-to-calendar file back-computed a day from her due date and then asked her to confirm it with
 * the clinic. The one screen in Cubby whose whole job is "where do I have to be, and when" was
 * guessing, while the letter sat on her fridge.
 *
 * The .ics was worse than a guess. It used a fresh uid() for its UID, carried no SEQUENCE and had
 * no cancel path, so the clinic moving her scan by a week left her with two wrong all-day events in
 * her calendar and nothing in Cubby that could take either of them back. exportDoseCourse forty
 * lines below already carries a comment about never leaving an orphan.
 *
 * And the ordering was wrong in a way that hurt at the end: "next" was the lowest week number with
 * week >= this week, so a scan she booked for a Monday that falls inside week 21 dropped off her
 * home card three days BEFORE she went to it, and off the report she prints to take with her.
 *
 * WHAT THIS GATE HOLDS
 *   - the date, the time and the place have a place to go, in both appointment sheets, and a
 *     second save does not wipe them
 *   - a date is the answer wherever there is one, and the week is still the whole answer where
 *     there is not: Home, the Care list, the prep sheet and the printed report all agree
 *   - order and "still ahead of her" follow the date when there is one, so the visit she is going
 *     to on Thursday outranks the scan booked for a later week
 *   - the file is a real timed VEVENT with LOCATION and an alarm she can travel on, a stable UID,
 *     a rising SEQUENCE, and a cancel that a calendar will accept
 *   - the export receipt is a fact about a PERSON, kept per uid in localStorage, never written onto
 *     the owner-owned journey record. A partner tapping "Add to my calendar" must not mutate her
 *     record: applyPregJourney (app/store-firebase.js) reads any unsent local edit as a pending
 *     write and pins his `appts` array from then on, so she could move her scan and he would sit on
 *     the old list for the rest of the pregnancy.
 *
 * WHAT IT DOES NOT COVER, so a PASS is not read as more than it is. The harness runs the app in
 * local mode and injects window.LL by hand, so app/store-firebase.js is never loaded and
 * firestore.rules is never evaluated. The claim that a non-owner's write would never sync is read
 * from the source; what is exercised here is that no such write is attempted.
 *
 *   PORT=9473 node tools/serve.js &
 *   node tools/appt_time_place_check.js http://localhost:9473
 *
 * Pass an explicit base URL. The default is deliberately NOT 8080: a live server from another
 * checkout on a shared port answers 200 and gets graded happily, reporting PASS on work you never
 * wrote.
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:9473';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, WEEK = 7 * 86400000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };
/* Every section runs inside this, so a missing function is one counted failure and the sections
   after it still run. A gate that dies at the first ReferenceError reports exit 2 for a full revert
   and hides how many of its own assertions would have survived the feature being gone, which is the
   number that says whether the gate is worth keeping. */
const section = async (title, fn) => {
  console.log('\n' + title);
  try { await fn(); } catch (e) { fail++; console.log('  FAIL the section ran at all\n         got: ' + (e && e.message ? e.message : String(e))); }
};

/* Pinned to 13:00 local. The hour is load-bearing three times over: an appointment at 09:00 today
   is in the past while the DAY is not (section 4), its two-hour alarm is therefore already gone
   (section 6), and a date-only event's nine-in-the-morning alert is behind us too. A clock stuck at
   08:00 would hide all three. */
const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;
const at = (dayOffset, h, m) => { const d = new Date(now + dayOffset * DAY); d.setHours(h, m, 0, 0); return d.getTime(); };
const compact = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()); };
// Unfolds RFC 5545 line folding before matching, so a long DESCRIPTION cannot fake a miss.
const unfold = (s) => s.replace(/\r\n[ \t]/g, '');

const MAYA = 'uidMaya', SAM = 'uidSam';

// A 20-week pregnancy owned by Maya: one appointment behind her, two ahead.
const preg = (over) => Object.assign({
  id: 'p1', ownerUid: MAYA, stage: 'expecting',
  dueDate: now + 20 * WEEK, lmp: now - 20 * WEEK, cycleLen: 28, periods: [],
  country: 'uk', precon: [], careTeam: [],
  appts: [
    { id: 'a0', week: 12, title: 'Booking appointment', note: '', done: true, at: now - 8 * WEEK },
    { id: 'a1', week: 20, title: '20 week scan', note: '', done: false, at: null },
    { id: 'a2', week: 25, title: 'Midwife check', note: '', done: false, at: null },
  ],
  symptoms: [], weights: [], bp: [], kicks: [], contractions: [], birthPlan: '', bag: [],
  moments: [], conditions: {}, glucose: [], urine: [], supplements: [], supplementLog: [], nausea: [],
  glucoseUnit: 'mmol', bornBabyId: null, createdAt: now - 20 * WEEK,
  visitQs: [{ id: 'q1', text: 'Is my baby growing on track?', done: false }],
}, over || {});
const seed = (p) => ({
  babies: [], activeBabyId: null, events: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], notes: [], pregnancy: p,
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

  /* Which checkout is actually answering on that port? A dead server exits 2, but a live server
     belonging to another agent's tree gets graded happily. apptWhenLabel exists only in this
     branch, so its absence means one of exactly two things and the banner says which, so a red run
     is never misread as a broken feature. */
  const marker = await page.evaluate(() => typeof window.apptWhenLabel === 'function');
  console.log(marker
    ? '  [checkout] ' + BASE + ' is serving a tree that has apptWhenLabel. Good.'
    : '  [checkout] WARNING: ' + BASE + ' is serving a tree with NO apptWhenLabel.\n'
      + '             Either the change is reverted, or this port belongs to another checkout.\n'
      + '             Every assertion below is expected to fail. Check the port first.');

  /* Sign in as somebody. window.LL.pregIsOwner is copied verbatim from store-firebase.js so the
     gate exercises the real ownership predicate rather than a stub of its own invention. */
  const signIn = (who) => page.evaluate((w) => {
    window.LL = window.LL || {};
    window.LL.auth = { currentUser: { uid: w } };
    window.LL.role = (w === 'uidMaya') ? 'owner' : 'caregiver';
    window.LL.members = { uidMaya: 'owner', uidSam: 'caregiver' };
    window.LL.memberInfo = { uidMaya: { name: 'Maya Rao', relationship: 'Mama Bear' }, uidSam: { name: 'Sam Rao', relationship: 'Papa Bear' } };
    window.LL.pregIsOwner = function () {
      var u = window.LL.auth.currentUser; if (!u) return true;
      var p = state.pregnancy; if (!p) return true;
      if (p.ownerUid && p.ownerUid !== 'local') return p.ownerUid === u.uid;
      return window.LL.role === 'owner';
    };
    window.LL.matIsOwner = window.LL.pregIsOwner;
    window.LL.matCanRead = function () { return window.LL.pregIsOwner(); };
    window.LL.pregJourneyShared = function () { return ['uidSam']; };
    localStorage.setItem('cubby-quick-uid', w);
  }, who);

  const load = async (s, who) => {
    await page.evaluate((x) => {
      localStorage.setItem('little-log-v1', JSON.stringify(x));
      Object.keys(localStorage).forEach((k) => {
        if (k.indexOf('cubby-theme') === 0 || k.indexOf('cubby-appt-ics') === 0) localStorage.removeItem(k);
      });
      localStorage.setItem('cubby-quick-uid', 'uidMaya');
    }, s);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1400);
    await signIn(who || MAYA);
    // saveFile is the single exit for every file Cubby writes, so stubbing it catches the .ics
    // without a download, exactly as the app calls it. persist() has been swapped by
    // store-firebase for a debounced cloud push, so counting calls is the only way from here to
    // tell a committed change from one held in memory.
    await page.evaluate(() => {
      window.__toasts = []; window.toast = function (m) { window.__toasts.push(m); };
      window.__saved = null; window.saveFile = function (href, name, msg) { window.__saved = { href: href, name: name, msg: msg }; };
      window.__persists = 0; const _p = window.persist; window.__realPersist = _p; window.persist = function () { window.__persists++; return _p.apply(this, arguments); };
    });
    await sleep(200);
  };

  // Runs the export the way the row does, then reads back the bytes her calendar would get.
  const exportAppt = (id) => page.evaluate(async (aid) => {
    window.__saved = null; window.__toasts = [];
    addApptToCalendar(aid);
    const out = { toasts: window.__toasts.slice(), saved: !!window.__saved, name: window.__saved ? window.__saved.name : null, text: null };
    if (window.__saved) out.text = await fetch(window.__saved.href).then((r) => r.text());
    return out;
  }, id);

  // Fills the three new fields in whichever appointment sheet is open, through the real controls.
  const fillWhen = async (dayTs, hhmm, place) => {
    const d = new Date(dayTs);
    // The date strip is a tap that opens the shared crafted calendar, not a text field.
    await page.evaluate(() => { const s = document.querySelector('#sheet .time-strip'); if (s) s.click(); });
    await sleep(250);
    await page.evaluate((y, m, day) => {
      const st = window._dp && window._dp.apD;
      // Walk the picker to the right month with its own arrows rather than reaching into state.
      let guard = 0;
      while (st && (st.y !== y || st.m !== m) && guard++ < 30) {
        const back = (st.y > y || (st.y === y && st.m > m));
        const btn = document.querySelector('.dp-h .dp-nav[aria-label="' + (back ? 'Previous month' : 'Next month') + '"]');
        if (!btn) break; btn.click();
      }
      const cell = [].slice.call(document.querySelectorAll('.dp-c')).find((b) => b.textContent.trim() === String(day) && !b.disabled);
      if (cell) cell.click();
      const done = document.querySelector('.cu-btn'); if (done) done.click();
    }, d.getFullYear(), d.getMonth(), d.getDate());
    await sleep(200);
    if (hhmm) await page.evaluate((v) => { const t = document.getElementById('apTm'); t.value = v; t.dispatchEvent(new Event('input', { bubbles: true })); }, hhmm);
    if (place) { await page.click('#apP'); await page.type('#apP', place); }
  };

  await section('1. the letter on her fridge has somewhere to go', async () => {
    await load(seed(preg()));
    const r = await page.evaluate(() => {
      pregGo('care'); openAddAppt();
      const s = document.getElementById('sheet');
      const box = (el) => { if (!el) return null; const c = getComputedStyle(el), b = el.getBoundingClientRect();
        return { w: Math.round(b.width), h: Math.round(b.height), painted: c.visibility === 'visible' && c.display !== 'none' && parseFloat(c.opacity) > 0.5 }; };
      const strip = s.querySelector('.time-strip');
      return { date: !!s.querySelector('#apD'), strip: box(strip), stripOn: strip ? strip.getAttribute('onclick') : null,
        time: box(s.querySelector('#apTm')), place: box(s.querySelector('#apP')),
        // innerText is the rendered sheet. Never document.body.textContent, which contains the
        // inline script's own source and would match every one of these words on any tree.
        txt: (s.innerText || '').replace(/\s+/g, ' ').trim(), week: !!s.querySelector('#apW'),
        // textContent, not innerText, for the labels: .field label is uppercased in CSS, and an
        // assertion on the shouted version tests the stylesheet rather than the words.
        labels: [].slice.call(s.querySelectorAll('.field label')).map((e) => e.textContent.trim()) };
    });
    ok('Add appointment offers a date', r.date === true && !!r.strip && r.strip.painted === true, r);
    ok('through the shared in-sheet picker, not a bare input', /openDateModal\('apD'\)/.test(r.stripOn || ''), r.stripOn);
    ok('it offers a time', !!r.time && r.time.painted === true && r.time.h > 20, r.time);
    ok('and a place', !!r.place && r.place.painted === true && r.place.w > 200, r.place);
    ok('all three say optional, because the letter often has not arrived yet',
      r.labels.indexOf('Date (optional)') >= 0 && r.labels.indexOf('Time (optional)') >= 0 && r.labels.indexOf('Where (optional)') >= 0, r.labels);
    ok('the week stays, and is still what she is asked for first', r.week === true, r);
    ok('and the sheet says which one Cubby will go by', /go by that instead of the week/i.test(r.txt), r.txt.slice(0, 300));
    /* Measured, not eyeballed. `.csub` is styled only inside a .stat-card, so a footnote wearing it
       in a sheet renders at full body size in full ink and shouts over the fields it is explaining.
       Four comments in app/index.html already warn about it and this line was written wearing it. */
    const hint = await page.evaluate(() => {
      const el = [].slice.call(document.querySelectorAll('#sheet div')).find((d) => /go by that instead of the week/.test(d.textContent) && d.children.length === 0);
      if (!el) return null;
      const c = getComputedStyle(el), body = getComputedStyle(document.body);
      return { size: parseFloat(c.fontSize), bodySize: parseFloat(body.fontSize), colour: c.color, ink: getComputedStyle(document.querySelector('#sheet h2')).color };
    });
    ok('the explaining line is a footnote, not a second headline', !!hint && hint.size <= 14 && hint.size < hint.bodySize, hint);
    ok('and is quieter than the sheet it sits in', !!hint && hint.colour !== hint.ink, hint);

    const edit = await page.evaluate(() => {
      closeSheet(); openApptEdit('a1');
      const s = document.getElementById('sheet');
      return { date: !!s.querySelector('#apD'), time: !!s.querySelector('#apTm'), place: !!s.querySelector('#apP') };
    });
    ok('and the same three are on an appointment she already has', edit.date && edit.time && edit.place, edit);
  });

  await section('2. she types in what the letter says, and it is kept', async () => {
    await load(seed(preg()));
    await page.evaluate(() => { pregGo('care'); openApptEdit('a1'); });
    await sleep(200);
    await fillWhen(now + 9 * DAY, '15:15', "St Mary's");
    const saved = await page.evaluate(() => { saveAppt('a1'); const a = state.pregnancy.appts.find((x) => x.id === 'a1'); return { when: a.when, timed: a.timed, place: a.place, week: a.week, at: a.at, done: a.done }; });
    ok('the day she picked is stored', saved.when === at(9, 15, 15), { got: saved.when, want: at(9, 15, 15) });
    ok('the time with it', saved.timed === true, saved);
    ok('and the place', saved.place === "St Mary's", saved);
    ok('the week is untouched, because the schedule is still written in weeks', saved.week === 20, saved);
    ok('and `at` still means the day she ticked it off, not the day she is going', saved.at === null && saved.done === false, saved);

    /* A second save is where a half-built version loses it: the sheet re-renders from the record,
       and a field that does not pre-fill silently writes an empty value back over a real one. */
    const again = await page.evaluate(() => {
      openApptEdit('a1');
      const s = document.getElementById('sheet');
      const pre = { d: document.getElementById('apD').value, t: document.getElementById('apTm').value, p: document.getElementById('apP').value };
      document.getElementById('apN').value = 'Bring the folder';
      saveAppt('a1');
      const a = state.pregnancy.appts.find((x) => x.id === 'a1');
      return { pre: pre, when: a.when, timed: a.timed, place: a.place, note: a.note };
    });
    ok('reopening it shows the date she saved', /^\d{4}-\d{2}-\d{2}$/.test(again.pre.d), again.pre);
    ok('the time she saved', again.pre.t === '15:15', again.pre);
    ok('the place she saved', again.pre.p === "St Mary's", again.pre);
    ok('and saving a note again does not wipe any of them', again.when === at(9, 15, 15) && again.timed === true && again.place === "St Mary's" && again.note === 'Bring the folder', again);

    // No date given: the week is still the only answer there is, and nothing is invented.
    await page.evaluate(() => { closeSheet(); openApptEdit('a2'); saveAppt('a2'); });
    const bare = await page.evaluate(() => { const a = state.pregnancy.appts.find((x) => x.id === 'a2'); return { when: a.when, timed: a.timed, place: a.place, week: a.week }; });
    ok('an appointment with no date saved gets no date invented for it', bare.when === null && bare.timed === false, bare);
    ok('and keeps its week', bare.week === 25, bare);
  });

  await section('3. Home names the day rather than guessing at it', async () => {
    await load(seed(preg({ appts: [
      { id: 'a1', week: 20, title: '20 week scan', done: false, at: null, when: at(9, 15, 15), timed: true, place: "St Mary's" },
      { id: 'a2', week: 25, title: 'Midwife check', done: false, at: null },
    ] })));
    const r = await page.evaluate(() => {
      pregGo('home');
      const c = document.querySelector('#scroll .next-appt');
      return { t: c ? c.querySelector('.na-t').innerText.trim() : null, s: c ? c.querySelector('.na-s').innerText.replace(/\s+/g, ' ').trim() : null,
        weekday: new Date(state.pregnancy.appts[0].when).toLocaleDateString(undefined, { weekday: 'long' }) };
    });
    ok('the card is about the appointment she has a date for', /20 week scan/.test(r.t || ''), r);
    ok('and names the actual day', r.s && r.s.indexOf(r.weekday) === 0, r);
    ok('with the time on it', /3:15|15:15/.test(r.s || ''), r);
    ok('and the place', /St Mary's/.test(r.s || ''), r);
    ok('the estimate is GONE, not printed beside the fact', !/in about|around week/i.test(r.s || ''), r);

    // Positive control: strip the date and the old wording must come straight back, because for an
    // appointment the clinic has not written to her yet it is the only honest answer there is.
    const bare = await page.evaluate(() => {
      const a = state.pregnancy.appts[0];
      a.when = null; a.timed = false; a.week = 24;   // the clinic has not written to her yet
      pregGo('home');
      const c = document.querySelector('#scroll .next-appt');
      return c ? c.querySelector('.na-s').innerText.replace(/\s+/g, ' ').trim() : null;
    });
    ok('with no date it still says roughly when', /in about 4 weeks/.test(bare || ''), bare);
    ok('and still names the week', /around week 24/.test(bare || ''), bare);
  });

  await section('4. the visit she is going to on Thursday comes first', async () => {
    /* Week order and date order disagree here on purpose: the growth scan is week 34 but she has it
       booked for the day after tomorrow, and the week-25 midwife check has no date at all. */
    await load(seed(preg({ appts: [
      { id: 'aOld', week: 40, title: 'Late booking', done: false, at: null, when: at(-1, 10, 0), timed: true },
      { id: 'aScan', week: 34, title: 'Growth scan', done: false, at: null, when: at(2, 9, 30), timed: true, place: 'Level 3' },
      { id: 'aMw', week: 25, title: 'Midwife check', done: false, at: null },
    ] })));
    const r = await page.evaluate(() => {
      const next = pregNextAppt();
      pregGo('care');
      const rows = [].slice.call(document.querySelectorAll('#scroll .appt-row .ar-t')).map((e) => e.innerText.trim());
      return { next: next ? next.id : null, rows: rows };
    });
    ok('the dated one two days away is next, not the lower week number', r.next === 'aScan', r);
    ok('yesterday stops being next the moment its day is over', r.next !== 'aOld', r);
    ok('the Care list is in the same order as the card calls next', r.rows.length === 3 && r.rows[0] === 'Late booking' && r.rows[1] === 'Growth scan' && r.rows[2] === 'Midwife check', r.rows);

    // The one that used to fall off three days early: booked inside week 21 while she is in week 21,
    // its own week number already behind her.
    const late = await page.evaluate(() => {
      state.pregnancy.appts = [{ id: 'aLate', week: 19, title: 'Anomaly scan', done: false, at: null, when: Date.now() + 3 * 86400000, timed: true }];
      const n = pregNextAppt(); pregGo('home');
      const c = document.querySelector('#scroll .next-appt');
      return { id: n ? n.id : null, txt: c ? c.innerText.replace(/\s+/g, ' ').trim() : null };
    });
    ok('an appointment whose WEEK has passed but whose DAY has not is still next', late.id === 'aLate', late);
    ok('and it is on her home screen', /Anomaly scan/.test(late.txt || ''), late);

    // Earlier today. The day is not over, so it is still the appointment she is thinking about.
    const today = await page.evaluate((t) => {
      state.pregnancy.appts = [{ id: 'aToday', week: 20, title: 'Bloods', done: false, at: null, when: t, timed: true }];
      const n = pregNextAppt();
      return n ? n.id : null;
    }, at(0, 9, 0));
    ok('this morning still counts as today', today === 'aToday', today);

    // A done appointment never comes back, whatever its date says.
    const done = await page.evaluate((t) => {
      state.pregnancy.appts = [{ id: 'aDone', week: 20, title: 'Bloods', done: true, at: Date.now(), when: t, timed: true },
        { id: 'aNext', week: 25, title: 'Midwife check', done: false, at: null }];
      const n = pregNextAppt(); return n ? n.id : null;
    }, at(3, 9, 0));
    ok('one she has already been to is not offered again', done === 'aNext', done);
  });

  await section('5. the prep sheet and the printed report say the same thing', async () => {
    await load(seed(preg({ appts: [
      { id: 'a1', week: 19, title: '20 week scan', done: false, at: null, when: at(4, 15, 15), timed: true, place: "St Mary's" },
    ] })));
    const r = await page.evaluate(() => {
      openVisitPrep('a1');
      const s = document.getElementById('sheet');
      return { sheet: (s.innerText || '').replace(/\s+/g, ' ').trim(), report: pregVisitSummary(),
        weekday: new Date(state.pregnancy.appts[0].when).toLocaleDateString(undefined, { weekday: 'long' }) };
    });
    ok('the prep sheet leads with the day she is going', r.sheet.indexOf(r.weekday) > 0, r.sheet.slice(0, 160));
    ok('and the place', /St Mary's/.test(r.sheet), r.sheet.slice(0, 160));
    ok('the report counts it as upcoming even though its week number has passed', /1 upcoming/.test(r.report), r.report.split('\n').filter((l) => /upcoming/.test(l)));
    ok('and prints the day and the place, not a week guess', new RegExp('next .*' + r.weekday).test(r.report) && /St Mary's/.test(r.report), r.report.split('\n').filter((l) => /next/.test(l)));
  });

  await section('6. the file her calendar gets is a real appointment', async () => {
    await load(seed(preg({ appts: [
      { id: 'a1', week: 20, title: '20 week scan', done: false, at: null, when: at(9, 15, 15), timed: true, place: "St Mary's" },
    ] })));
    const e = await exportAppt('a1');
    const t = unfold(e.text || '');
    ok('a file is written', e.saved === true && /BEGIN:VCALENDAR/.test(t), e.name);
    ok('at the time she was given, in her own timezone, not floated to UTC', t.indexOf('DTSTART:' + compact(at(9, 15, 15)) + 'T151500') >= 0 && !/DTSTART:[0-9T]+Z/.test(t), t.split('\r\n').filter((l) => /DTSTART/.test(l)));
    ok('it lasts an amount of time rather than being a stripe across the whole day', /^(DURATION|DTEND)/m.test(t.replace(/\r\n/g, '\n')), t.split('\r\n').filter((l) => /DURATION|DTEND/.test(l)));
    ok('the place is in the event, so her phone can navigate to it', /LOCATION:St Mary's/.test(t), t.split('\r\n').filter((l) => /LOCATION/.test(l)));
    ok('it alerts her early enough to travel', /TRIGGER:-PT2H/.test(t), t.split('\r\n').filter((l) => /TRIGGER/.test(l)));
    ok('the UID is this appointment, forever', t.indexOf('UID:cubby-appt-a1@little-cubby.com') >= 0, t.split('\r\n').filter((l) => /UID/.test(l)));
    ok('it carries a SEQUENCE', /SEQUENCE:\d+/.test(t), t.split('\r\n').filter((l) => /SEQUENCE/.test(l)));
    ok('and stops telling her to confirm a date she already has', !/Confirm the exact date/i.test(t), t.split('\r\n').filter((l) => /DESCRIPTION/.test(l)));
    ok('the questions she wrote are one tap from the alert', /little-cubby\.com\/app\/\?tab=care/.test(t), t.split('\r\n').filter((l) => /DESCRIPTION/.test(l)));

    // A date with no time must not invent one: that is an all-day event, alerted the morning before.
    await load(seed(preg({ appts: [{ id: 'a1', week: 20, title: '20 week scan', done: false, at: null, when: at(9, 12, 0), timed: false }] })));
    const d = unfold((await exportAppt('a1')).text || '');
    ok('a date with no time is an all-day event', d.indexOf('DTSTART;VALUE=DATE:' + compact(at(9, 12, 0))) >= 0, d.split('\r\n').filter((l) => /DTSTART/.test(l)));
    ok('and no clock time is made up for it', !/DTSTART:[0-9]{8}T/.test(d), d.split('\r\n').filter((l) => /DTSTART/.test(l)));
    ok('alerted the morning before, not at midnight', /TRIGGER:-PT15H/.test(d), d.split('\r\n').filter((l) => /TRIGGER/.test(l)));

    // No date at all: the old estimate, still saying out loud that it is one.
    await load(seed(preg({ appts: [{ id: 'a1', week: 25, title: 'Midwife check', done: false, at: null }] })));
    const g = unfold((await exportAppt('a1')).text || '');
    ok('with no date it still exports something', /BEGIN:VEVENT/.test(g), g.slice(0, 80));
    ok('and still says it is an estimate to check with the clinic', /Confirm the exact date and time with your clinic/.test(g), g.split('\r\n').filter((l) => /DESCRIPTION/.test(l)));

    // An alarm that already went off is noise, so it is left out entirely.
    await load(seed(preg({ appts: [{ id: 'a1', week: 20, title: 'Bloods', done: false, at: null, when: at(0, 9, 0), timed: true }] })));
    const past = unfold((await exportAppt('a1')).text || '');
    ok('an appointment earlier today still exports', /BEGIN:VEVENT/.test(past), past.slice(0, 80));
    ok('with no alarm for a moment that has gone', !/BEGIN:VALARM/.test(past), past.split('\r\n').filter((l) => /ALARM|TRIGGER/.test(l)));
  });

  await section('7. the clinic moves it, and her calendar follows', async () => {
    await load(seed(preg({ appts: [
      { id: 'a1', week: 20, title: '20 week scan', done: false, at: null, when: at(9, 15, 15), timed: true, place: "St Mary's" },
    ] })));
    const first = unfold((await exportAppt('a1')).text || '');
    const seq1 = +(/SEQUENCE:(\d+)/.exec(first) || [])[1];

    // She reopens it and moves it a week, the way the letter told her to.
    await page.evaluate(() => { pregGo('care'); openApptEdit('a1'); });
    await sleep(200);
    await fillWhen(now + 16 * DAY, '09:40', null);
    const tst = await page.evaluate(() => { window.__toasts = []; saveAppt('a1'); const a = state.pregnancy.appts.find((x) => x.id === 'a1'); return { toasts: window.__toasts.slice(), when: a.when }; });
    ok('the new day is stored', tst.when === at(16, 9, 40), { got: tst.when, want: at(16, 9, 40) });
    ok('and she is told her calendar needs the update', /add it again to update your calendar/i.test((tst.toasts[0] || '')), tst.toasts);

    const second = unfold((await exportAppt('a1')).text || '');
    const seq2 = +(/SEQUENCE:(\d+)/.exec(second) || [])[1];
    ok('the second file is the SAME event, not a second one', (second.match(/UID:cubby-appt-a1@little-cubby\.com/g) || []).length === 1 && first.indexOf('UID:cubby-appt-a1@little-cubby.com') >= 0, [first.match(/UID:.*/), second.match(/UID:.*/)]);
    ok('with a higher SEQUENCE, which is the only thing that makes a calendar replace it', seq2 > seq1, { seq1: seq1, seq2: seq2 });
    ok('and the new time on it', second.indexOf('T094000') >= 0 && second.indexOf('T151500') < 0, second.split('\r\n').filter((l) => /DTSTART/.test(l)));
  });

  await section('8. she can take it back out again', async () => {
    await load(seed(preg({ appts: [
      { id: 'a1', week: 20, title: '20 week scan', done: false, at: null, when: at(9, 15, 15), timed: true, place: "St Mary's" },
    ] })));
    const before = await page.evaluate(() => {
      openVisitPrep('a1'); const s = document.getElementById('sheet');
      return { txt: (s.innerText || '').replace(/\s+/g, ' ').trim() };
    });
    ok('before she has added it there is nothing to take back', !/take this off my calendar/i.test(before.txt), before.txt.slice(0, 240));
    ok('and the row invites her to add it', /add to my calendar/i.test(before.txt), before.txt.slice(0, 240));

    const after = await exportAppt('a1');
    const sheet = await page.evaluate(() => {
      const s = document.getElementById('sheet');
      return { txt: (s.innerText || '').replace(/\s+/g, ' ').trim(), open: s.classList.contains('show') };
    });
    ok('adding it takes her back to the same sheet', sheet.open === true, sheet);
    ok('which now offers to update rather than to add', /update my calendar/i.test(sheet.txt) && !/add to my calendar/i.test(sheet.txt), sheet.txt.slice(0, 240));
    ok('and says what tapping it again will do', /updates the same entry/i.test(sheet.txt), sheet.txt.slice(0, 300));
    const foot = await page.evaluate(() => {
      const el = [].slice.call(document.querySelectorAll('#sheet div')).find((d) => /updates the same entry/.test(d.textContent) && d.children.length === 0);
      if (!el) return null;
      const c = getComputedStyle(el), b = el.getBoundingClientRect();
      const prev = el.previousElementSibling ? el.previousElementSibling.getBoundingClientRect() : null;
      return { size: parseFloat(c.fontSize), top: Math.round(b.top), prevBottom: prev ? Math.round(prev.bottom) : null };
    });
    ok('quietly, under the row it explains', !!foot && foot.size <= 14, foot);
    ok('and not pulled up on top of it', !!foot && foot.prevBottom !== null && foot.top >= foot.prevBottom, foot);
    ok('the take-back is there', /take this off my calendar/i.test(sheet.txt), sheet.txt.slice(0, 300));

    const cancel = await page.evaluate(async () => {
      window.__saved = null; window.__toasts = [];
      cancelApptCalendar('a1');
      const text = window.__saved ? await fetch(window.__saved.href).then((r) => r.text()) : null;
      openVisitPrep('a1');
      // The reassurance rides on saveFile's own message, which is where every other exporter puts
      // it, so read it from there rather than from the toast queue.
      return { text: text, name: window.__saved ? window.__saved.name : null, msg: window.__saved ? window.__saved.msg : null,
        txt: (document.getElementById('sheet').innerText || '').replace(/\s+/g, ' ').trim() };
    });
    const c = unfold(cancel.text || '');
    ok('a cancel file is written', /METHOD:CANCEL/.test(c) && /STATUS:CANCELLED/.test(c), c.slice(0, 200));
    ok('for the same event', c.indexOf('UID:cubby-appt-a1@little-cubby.com') >= 0, c.split('\r\n').filter((l) => /UID/.test(l)));
    ok('outranking the one she already has', +(/SEQUENCE:(\d+)/.exec(c) || [])[1] > +(/SEQUENCE:(\d+)/.exec(unfold(after.text)) || [])[1], [c.match(/SEQUENCE:.*/), unfold(after.text).match(/SEQUENCE:.*/)]);
    ok('and it is honest that her Calendar app has the last word', /delete it in your Calendar app/i.test(cancel.msg || ''), cancel.msg);
    ok('the sheet goes back to offering to add it', /add to my calendar/i.test(cancel.txt) && !/take this off my calendar/i.test(cancel.txt), cancel.txt.slice(0, 240));

    // Removing the appointment must take its calendar entry with it, or the one entry she can no
    // longer reach from anywhere in Cubby is the one still alerting her.
    await load(seed(preg({ appts: [{ id: 'a1', week: 20, title: '20 week scan', done: false, at: null, when: at(9, 15, 15), timed: true }] })));
    await exportAppt('a1');
    const del = await page.evaluate(async () => {
      window.__saved = null;
      deleteAppt('a1');
      const text = window.__saved ? await fetch(window.__saved.href).then((r) => r.text()) : null;
      return { text: text, left: (state.pregnancy.appts || []).length };
    });
    ok('removing the appointment removes it', del.left === 0, del);
    ok('and cancels the calendar entry rather than orphaning it', /METHOD:CANCEL/.test(unfold(del.text || '')), (del.text || '').slice(0, 120));
  });

  await section('9. the receipt belongs to a person, not to her journey', async () => {
    await load(seed(preg({ appts: [
      { id: 'a1', week: 20, title: '20 week scan', done: false, at: null, when: at(9, 15, 15), timed: true, place: "St Mary's" },
    ] })));
    const own = await page.evaluate(() => JSON.stringify(state.pregnancy));
    const r = await page.evaluate(async () => {
      window.__persists = 0;
      addApptToCalendar('a1');
      const a = state.pregnancy.appts.find((x) => x.id === 'a1');
      return { keys: Object.keys(a), persists: window.__persists, json: JSON.stringify(state.pregnancy),
        mine: localStorage.getItem('cubby-appt-ics:uidMaya'), his: localStorage.getItem('cubby-appt-ics:uidSam') };
    });
    ok('nothing is written onto the appointment record', r.keys.indexOf('ics') < 0, r.keys);
    ok('the journey is byte for byte what it was', r.json === own, { was: own.length, now: r.json.length });
    ok('and no cloud write is even attempted', r.persists === 0, r.persists);
    ok('the receipt is filed under her uid', !!r.mine && r.mine.indexOf('a1') >= 0, r.mine);
    ok('and nowhere else', !r.his, r.his);

    /* The partner. He can read her journey and reach this sheet from the home card, so he must be
       able to put her scan in HIS calendar, and doing it must not touch her record: applyPregJourney
       treats any unsent local edit as a pending write and pins his appts array from then on. */
    await signIn(SAM);
    const sam = await page.evaluate(async () => {
      openVisitPrep('a1');
      const before = (document.getElementById('sheet').innerText || '').replace(/\s+/g, ' ').trim();
      const snap = JSON.stringify(state.pregnancy);
      window.__persists = 0;
      addApptToCalendar('a1');
      return { before: before, snap: snap, after: JSON.stringify(state.pregnancy), persists: window.__persists,
        his: localStorage.getItem('cubby-appt-ics:uidSam'), owner: pregJourneyIsOwner(),
        sheet: (document.getElementById('sheet').innerText || '').replace(/\s+/g, ' ').trim() };
    });
    ok('he is not the owner of this journey', sam.owner === false, sam.owner);
    ok('her export does not tell him something is in HIS calendar', /add to my calendar/i.test(sam.before) && !/update my calendar/i.test(sam.before), sam.before.slice(0, 240));
    ok('he can still put her scan in his own calendar', !!sam.his && sam.his.indexOf('a1') >= 0, sam.his);
    // Diff, not length: bumping a seq in place changes the bytes without changing the count.
    ok('and doing it does not touch a single byte of her journey', sam.after === sam.snap,
      sam.after === sam.snap ? null : { was: sam.snap.slice(0, 240), now: sam.after.slice(0, 240) });
    ok('so nothing of his is left pending against a doc he can never write', sam.persists === 0, sam.persists);
    ok('and his sheet now offers the update', /update my calendar/i.test(sam.sheet), sam.sheet.slice(0, 240));
  });

  await section('10. it all survives the phone being closed', async () => {
    await load(seed(preg({ appts: [
      { id: 'a1', week: 20, title: '20 week scan', done: false, at: null },
    ] })));
    await page.evaluate(() => { pregGo('care'); openApptEdit('a1'); });
    await sleep(200);
    await fillWhen(now + 9 * DAY, '15:15', "St Mary's");
    await page.evaluate(() => saveAppt('a1'));
    await exportAppt('a1');
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1400);
    await signIn(MAYA);
    const r = await page.evaluate(() => {
      const a = state.pregnancy.appts.find((x) => x.id === 'a1');
      pregGo('home');
      const card = document.querySelector('#scroll .next-appt');
      openVisitPrep('a1');
      return { when: a.when, timed: a.timed, place: a.place,
        card: card ? card.innerText.replace(/\s+/g, ' ').trim() : null,
        sheet: (document.getElementById('sheet').innerText || '').replace(/\s+/g, ' ').trim() };
    });
    ok('the date she typed is still there after a reload', r.when === at(9, 15, 15) && r.timed === true, r);
    ok('the place too', r.place === "St Mary's", r);
    ok('her home card still names the day', /St Mary's/.test(r.card || '') && !/in about/.test(r.card || ''), r.card);
    ok('and Cubby still remembers that this one is in her calendar', /update my calendar/i.test(r.sheet) && /take this off my calendar/i.test(r.sheet), r.sheet.slice(0, 240));
  });

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'APPT-TIME-PLACE: FAIL' : 'APPT-TIME-PLACE: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
