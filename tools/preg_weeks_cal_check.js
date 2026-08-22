#!/usr/bin/env node
/* The week turning was the only recurring thing in pregnancy, and nothing marked it anywhere.
 *
 * pregWeek() is derived on every render, so the hero read "Week 24" on Monday night and "Week 25"
 * on Tuesday afternoon with nothing in between to say so. For a stage whose logging cadence is
 * close to zero, that turn is the single recurring reason to open Cubby, and the product neither
 * marked it in the app nor put it anywhere she would see it with the app shut. A mother who did
 * not open Cubby for nine days found week 24 had silently become week 26.
 *
 * Two things now exist and this gate holds both to their promises.
 *
 *   THE MARKER. One line in the hero, the first time she opens after the week has turned, and then
 *   never again for that week. It must not fire on her very first sight of a pregnancy (nobody
 *   knows whether that week turned today or six days ago), it must not fire when an edited due date
 *   moves the count backwards, it must say "starts today" only on the day it actually starts, and
 *   it must be per person so her partner gets his own first sight rather than inheriting hers.
 *   Quiet mode's whole promise is that week counts stay off her screen, so quiet mode gets nothing.
 *
 *   THE CALENDAR. One all-day marker per remaining week, in her own calendar, carrying the deep
 *   link back. Three ways that can hurt someone, all of them checked here: an alarm at midnight
 *   (TRIGGER:PT0S on an all-day event means 00:00, and waking a pregnant woman to tell her the
 *   fruit changed is the exact failure this product exists to avoid); a second export laying a
 *   duplicate set beside the first instead of updating it; and, the serious one, a pregnancy that
 *   ends while sixteen "Week 30, about the size of a butternut squash" events keep arriving for
 *   months. endPregnancy nulls state.pregnancy and the holding screen replaces the whole app, so
 *   the take-back has to be reachable FROM the holding screen or it does not exist at all.
 *
 *   PORT=9358 node tools/serve.js &
 *   node tools/preg_weeks_cal_check.js http://localhost:9358
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:9358';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, WEEK = 7 * DAY;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

// Mid-morning, so "today" is unambiguous on both sides of a boundary written in whole days.
const CLOCK = (() => { const d = new Date(); d.setHours(10, 30, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

/* pregWeek() with a due date is `40 - round((due-now)/WEEK)`, so week n begins at
   due - (40.5-n)*WEEK. Both helpers below are written from that inverse rather than from a naive
   "due minus (40-n) weeks", which is half a week out and would grade the wrong day.
   `agoMs` pulls the due date EARLIER, which is what puts the turn of week n in the past: she is
   further along than a due date of today-plus-15-and-a-half-weeks would make her. */
const dueForWeek = (n, agoMs) => now + (40.5 - n) * WEEK - (agoMs || 0) - 1000;

const preg = (over) => Object.assign({
  id: 'p1', ownerUid: 'local', stage: 'expecting',
  dueDate: dueForWeek(24), lmp: null, cycleLen: 28, periods: [], country: 'uk',
  precon: [], careTeam: [], appts: [], symptoms: [], weights: [], bp: [], kicks: [], contractions: [],
  birthPlan: '', bag: [], moments: [], conditions: {}, glucose: [], urine: [], supplements: [],
  supplementLog: [], nausea: [], moodLog: [], guesses: [], gentle: { afterLoss: false, noNumbers: false },
  glucoseUnit: 'mmol', bornBabyId: null, createdAt: now - 24 * WEEK,
}, over || {});
const seed = (p) => ({
  babies: [], activeBabyId: null, events: [], illnesses: [], notes: [], milestones: [], meds: [],
  photos: [], vaccines: {}, timers: {},
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, welcome: 1 } },
  pregnancy: p,
});

(async () => {
  // A gate on a shared default port has already graded somebody else's checkout in this repo and
  // reported failures that were not in the code under test. Prove the tree first.
  let src = '';
  try { src = await (await fetch(BASE + '/app/index.html')).text(); } catch (e) { src = ''; }
  ok('the tree served at ' + BASE + ' is the one carrying this change',
    /function pregWeeksIcsText/.test(src) && /wh-new/.test(src) && /function pregWeekRolled/.test(src),
    src ? src.length + ' bytes, marker missing' : 'could not fetch');

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

  // A reload is the only honest way to test "the first open after the week rolled": the decision is
  // cached for the page load on purpose, so a re-render cannot snatch the line back mid-session.
  const load = async (s, who) => {
    await page.evaluate((x, u) => {
      localStorage.setItem('little-log-v1', JSON.stringify(x));
      localStorage.setItem('cubby-quick-uid', u);
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
    }, s, who || 'local');
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1300);
    await page.evaluate(() => {
      window.__toasts = []; window.toast = function (m) { window.__toasts.push(m); };
      window.__saved = null; window.saveFile = function (href, name, msg) { window.__saved = { href: href, name: name, msg: msg }; };
    });
    await sleep(150);
  };
  // Read the real hero out of the real DOM. NOT document.body.textContent: this file's own inline
  // script is in there and would happily match every string this gate looks for.
  const hero = () => page.evaluate(() => {
    const h = document.querySelector('.week-hero'), n = h && h.querySelector('.wh-new');
    return { week: h ? (h.querySelector('.wh-week') || {}).textContent : null, roll: n ? n.textContent.trim() : null };
  });
  const calRow = () => page.evaluate(() => {
    const rows = [].filter.call(document.querySelectorAll('.add-row'), (r) => (r.getAttribute('onclick') || '').indexOf('openWeeksCalendar') === 0);
    return rows.length ? rows[0].textContent.trim() : null;
  });
  /* The other door, and the one the first cut of this feature did not have: the way to reach the
     markers once the sheet above can no longer be opened. It is deliberately looked for by its
     onclick and not by its wording, so renaming the copy does not quietly delete the coverage. */
  const offRow = () => page.evaluate(() => {
    const el = [].filter.call(document.querySelectorAll('.add-row,.alert-pill,.prof-card'),
      (r) => /openWeeksTakeBack/.test(r.getAttribute('onclick') || r.innerHTML || ''))[0];
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
  });
  const seenKey = () => page.evaluate(() => localStorage.getItem('cubby-preg-week-seen:' + localStorage.getItem('cubby-quick-uid')));
  /* Both records deliberately outlive a reload and outlive state.pregnancy, which is the whole
     point of them, so they also outlive a section. One run of this gate graded a cancel sequence of
     4 against an expectation of 2 because the previous section had already exported twice. Every
     section starts from a person who has never used this feature unless it says otherwise. */
  const wipe = () => page.evaluate(() => Object.keys(localStorage).forEach((k) => {
    if (/^cubby-preg-weeks:|^cubby-preg-week-seen:/.test(k)) localStorage.removeItem(k);
  }));
  const click = async (sel) => {
    const hit = await page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.click(); return true; }, sel);
    if (!hit) ok('a real control exists to click for ' + sel, false);
    return hit;
  };
  // The .ics as it is actually written: the blob handed to saveFile, read back byte for byte.
  const savedIcs = () => page.evaluate(() => window.__saved ? fetch(window.__saved.href).then((r) => r.text()) : null);
  const section = async (name, fn) => { console.log('\n' + name); try { await fn(); } catch (e) { ok(name + ' ran to the end', false, String((e && e.message) || e)); } };
  const count = (s, re) => (String(s).match(re) || []).length;

  await section('1. the week turns, and it is marked exactly once', async () => {
    await wipe();
    await load(seed(preg({ dueDate: dueForWeek(24) })));
    let h = await hero();
    ok('week 24 is on the hero', /Week 24/.test(h.week || ''), h);
    ok('her very first sight says nothing, because nobody knows when that week turned', h.roll === null, h);
    ok('but it is remembered', (await seenKey()) === '24', await seenKey());

    await load(seed(preg({ dueDate: dueForWeek(24) })));
    h = await hero();
    ok('opening again in the same week still says nothing', h.roll === null, h);

    await load(seed(preg({ dueDate: dueForWeek(25) })));
    h = await hero();
    ok('the week turns and the hero says so', h.roll === 'Week 25 starts today', h);
    ok('the marker is on the hero, not a card she has to dismiss',
      await page.evaluate(() => !!document.querySelector('.week-hero .wh-new')), h);
    ok('the new week is remembered', (await seenKey()) === '25', await seenKey());

    await load(seed(preg({ dueDate: dueForWeek(25) })));
    h = await hero();
    ok('seeing it is what dismisses it: the next open is quiet again', h.roll === null, h);
  });

  await section('2. it never says "today" on a day that is not the day', async () => {
    await wipe();
    await load(seed(preg({ dueDate: dueForWeek(24) })));
    await load(seed(preg({ dueDate: dueForWeek(25, 3 * DAY) })));
    const h = await hero();
    ok('she opens three days late and is told the truth', h.roll === 'Week 25 has started', h);
    ok('and it is still week 25 on the hero', /Week 25/.test(h.week || ''), h);
  });

  await section('3. it never announces a week she has already lived', async () => {
    await wipe();
    await load(seed(preg({ dueDate: dueForWeek(30) })));
    ok('week 30 is banked', (await seenKey()) === '30', await seenKey());
    // An edited due date, or a whole new pregnancy: the count goes backwards.
    await load(seed(preg({ dueDate: dueForWeek(22) })));
    let h = await hero();
    ok('the count moves backwards and nothing is announced', h.roll === null, h);
    ok('and it re-anchors quietly rather than sulking at 30', (await seenKey()) === '22', await seenKey());
    await load(seed(preg({ dueDate: dueForWeek(23) })));
    h = await hero();
    ok('the next real turn from the new anchor still works', h.roll === 'Week 23 starts today', h);
  });

  await section('4. quiet mode gets none of it', async () => {
    await wipe();
    await load(seed(preg({ dueDate: dueForWeek(24), gentle: { afterLoss: false, noNumbers: true } })));
    await load(seed(preg({ dueDate: dueForWeek(25), gentle: { afterLoss: false, noNumbers: true } })));
    const h = await hero();
    ok('no week-roll line in quiet mode', h.roll === null, h);
    ok('and no week number leaked into the hero either', !/Week \d/.test(h.week || ''), h);
    ok('and no offer to write "Week 25" into her calendar forever', (await calRow()) === null, await calRow());
  });

  await section('5. the calendar row appears only when there is something true to offer', async () => {
    await wipe();
    await load(seed(preg({ dueDate: dueForWeek(24) })));
    ok('at week 24 she is offered her weeks', /Put my weeks in my calendar/.test((await calRow()) || ''), await calRow());

    await load(seed(preg({ dueDate: dueForWeek(41) })));
    ok('at week 41 there is nothing ahead, so no row', (await calRow()) === null, await calRow());

    await load(seed(preg({ dueDate: null, lmp: null })));
    ok('no due date and no last period means no dates to write, so no row', (await calRow()) === null, await calRow());

    await load(seed(preg({ dueDate: dueForWeek(24), bornBabyId: 'b1' })));
    ok('after the baby arrives the weeks stop being offered', (await calRow()) === null, await calRow());
    ok('and somebody who never added any is not offered a take-back either', (await offRow()) === null, await offRow());

    await load(seed(preg({ stage: 'planning', dueDate: null, lmp: now - 20 * DAY })));
    ok('the trying stage is not offered pregnancy weeks', (await calRow()) === null, await calRow());
  });

  await section('6. what actually gets written into her calendar', async () => {
    await wipe();
    await load(seed(preg({ dueDate: dueForWeek(24) })));
    const r = await page.evaluate(() => {
      const wks = pregWeeksAhead();
      return { wks: wks, ics: pregWeeksIcsText(wks, 1), first: pregWeekStart(wks[0]) };
    });
    ok('one event per remaining week, 25 through 41', r.wks.length === 17 && r.wks[0] === 25 && r.wks[16] === 41, r.wks);
    ok('and the file holds exactly that many events, not zero', count(r.ics, /BEGIN:VEVENT/g) === 17, count(r.ics, /BEGIN:VEVENT/g));
    ok('every one is all-day', count(r.ics, /DTSTART;VALUE=DATE:/g) === 17, count(r.ics, /DTSTART;VALUE=DATE:/g));
    ok('every one carries the alarm, and it is a display at nine in the morning',
      count(r.ics, /TRIGGER:PT9H/g) === 17 && count(r.ics, /ACTION:DISPLAY/g) === 17, r.ics.slice(0, 400));
    ok('no midnight alarm anywhere in the file', !/TRIGGER:PT0S/.test(r.ics), r.ics.slice(0, 200));
    ok('and nothing fires the day before, the way an appointment does', !/TRIGGER:-P/.test(r.ics), r.ics.slice(0, 200));
    ok('the title is the week and the size, as the hero says it',
      /SUMMARY:Week 25 · about the size of a cauliflower/.test(r.ics), (r.ics.match(/SUMMARY:[^\r\n]*/) || [])[0]);
    ok('week 41 is titled from the book too', /SUMMARY:Week 41 · about the size of a pumpkin/.test(r.ics), null);
    ok('every event carries the deep link back to the week',
      count(r.ics, /\/app\/\?tab=week/g) === 17, count(r.ics, /\/app\/\?tab=week/g));
    ok('the uids are stable per week, so a re-export can find them again',
      /UID:cubby-pregweek-25@little-cubby\.com/.test(r.ics) && count(r.ics, /UID:cubby-pregweek-/g) === 17, null);
    ok('a week is not an appointment, so it does not make her look busy',
      count(r.ics, /TRANSP:TRANSPARENT/g) === 17, count(r.ics, /TRANSP:TRANSPARENT/g));

    // Charter: marking a week that has arrived is not a countdown.
    ok('no countdown language reaches her calendar', !/to go|days left|remaining|weeks left/i.test(r.ics), (r.ics.match(/.{0,40}(to go|days left|remaining).{0,40}/i) || [])[0]);

    const pad = (n) => String(n).padStart(2, '0');
    const dayOf = (ms) => { const d = new Date(ms); return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()); };
    const starts = (r.ics.match(/DTSTART;VALUE=DATE:(\d{8})/g) || []).map((s) => s.slice(-8));
    ok('the first event lands on the day the app itself will turn the week', starts[0] === dayOf(r.first), { got: starts[0], want: dayOf(r.first) });
    ok('nothing is written into the past', starts.length === 17 && starts.every((s) => s >= dayOf(now)), starts.slice(0, 3));
    ok('the dates are strictly increasing, one per week', starts.length === 17 && starts.every((s, i) => i === 0 || s > starts[i - 1]), starts.slice(0, 3));
  });

  await section('7. she taps it, and then taps it again a month later', async () => {
    await wipe();
    await load(seed(preg({ dueDate: dueForWeek(24) })));
    await click('.add-row[onclick^="openWeeksCalendar"]');
    await sleep(300);
    let sheet = await page.evaluate(() => (document.getElementById('sheet').innerText || '').replace(/\s+/g, ' ').trim());
    ok('the sheet says how many, and what the first one is', /Add 17 weeks/.test(sheet) && /Week 25/.test(sheet), sheet.slice(0, 200));
    ok('a first-time sheet offers no take-back, because there is nothing to take back', !/Take these off/.test(sheet), sheet.slice(0, 240));
    /* An .ics event cannot open an app. It carries a url inside its description that she has to see
       and tap, and saying otherwise promises her something the file does not do. */
    ok('it does not claim the calendar entry opens Cubby by itself', !/opens Cubby/i.test(sheet), (sheet.match(/.{0,50}opens Cubby.{0,30}/i) || [])[0]);
    ok('it says what is actually in the event: a link back', /with a link back to Cubby for that week/.test(sheet), sheet.slice(0, 300));

    await click('#sheet .btn-primary');
    await sleep(300);
    const one = await page.evaluate(() => ({ rec: JSON.parse(localStorage.getItem('cubby-preg-weeks:local') || 'null'), file: window.__saved && window.__saved.name }));
    ok('the export is recorded so it can be undone later', one.rec && one.rec.seq === 1 && one.rec.from === 25 && one.rec.to === 41, one.rec);
    ok('and a real file was handed over', one.file === 'cubby-pregnancy-weeks.ics', one.file);
    const icsA = await savedIcs();
    ok('the saved file is a publish with 17 events', /METHOD:PUBLISH/.test(icsA) && count(icsA, /BEGIN:VEVENT/g) === 17, count(icsA, /BEGIN:VEVENT/g));

    // Every other add-row on this screen is a verb. A statement stops reading as tappable.
    ok('the row still asks her to do something, now that there is something to update', /Update my weeks in my calendar/.test((await calRow()) || ''), await calRow());
    ok('and the take-back does not also barge onto a screen whose sheet already carries it', (await offRow()) === null, await offRow());
    await click('.add-row[onclick^="openWeeksCalendar"]');
    await sleep(300);
    sheet = await page.evaluate(() => (document.getElementById('sheet').innerText || '').replace(/\s+/g, ' ').trim());
    ok('the second sheet offers to take them off again', /Take these off my calendar/.test(sheet), sheet.slice(0, 240));

    /* The repeat-export note is a footnote, and .csub is styled only inside .stat-card: out here it
       renders at full body size in full ink, welded to the bottom of the pink button, louder than
       the sheet's own subtitle and reading like an error. Measured off the real box, in the real
       sheet, at 390px — not asserted from the source. */
    const note = await page.evaluate(() => {
      const els = [].filter.call(document.querySelectorAll('#sheet div'), (d) => /^You added these before/.test(d.textContent.trim()));
      if (!els.length) return null;
      const el = els[els.length - 1], cs = getComputedStyle(el);
      const h2 = document.querySelector('#sheet h2'), sub = document.querySelector('#sheet .sub');
      const btn = document.querySelector('#sheet .btn-primary');
      return { cls: el.className, size: parseFloat(cs.fontSize), color: cs.color,
        gap: Math.round(el.getBoundingClientRect().top - btn.getBoundingClientRect().bottom),
        subSize: sub ? parseFloat(getComputedStyle(sub).fontSize) : null,
        subColor: sub ? getComputedStyle(sub).color : null,
        h2Size: h2 ? parseFloat(getComputedStyle(h2).fontSize) : null };
    });
    ok('the note exists to be measured', !!note, note);
    ok('it is a footnote, not a shout: no louder than the sheet subtitle it sits under',
      !!note && note.size <= note.subSize && note.size < note.h2Size, note);
    ok('and it is the soft ink the rest of the small print uses, not full ink',
      !!note && note.color === note.subColor, note);
    // .csub welds it to the button at a 0px gap. A naive negative margin overlaps the pink instead.
    ok('it stands clear of the button above rather than sitting on it', !!note && note.gap >= 6, note);
    await click('#sheet .btn-primary');
    await sleep(300);
    const two = await page.evaluate(() => JSON.parse(localStorage.getItem('cubby-preg-weeks:local') || 'null'));
    ok('a second save bumps the sequence rather than starting again', two && two.seq === 2, two);
    const icsB = await savedIcs();
    ok('and the file says so, on every event', count(icsB, /SEQUENCE:2/g) === 17, count(icsB, /SEQUENCE:2/g));
    const uidsA = (icsA.match(/UID:[^\r\n]+/g) || []).join('|'), uidsB = (icsB.match(/UID:[^\r\n]+/g) || []).join('|');
    ok('same uids, so her calendar updates the same 17 entries instead of holding 34',
      uidsA === uidsB && uidsA.split('|').length === 17, { a: uidsA.length, b: uidsB.length });
  });

  await section('8. the pregnancy ends, and the calendar can be taken back', async () => {
    await wipe();
    await load(seed(preg({ dueDate: dueForWeek(24) })));
    await click('.add-row[onclick^="openWeeksCalendar"]');
    await sleep(250);
    await click('#sheet .btn-primary');
    await sleep(300);
    ok('she has 17 week markers in her calendar', !!(await page.evaluate(() => JSON.parse(localStorage.getItem('cubby-preg-weeks:local') || 'null'))), null);

    await page.evaluate(() => endPregnancy(false));
    await sleep(600);
    const gone = await page.evaluate(() => state.pregnancy);
    ok('the pregnancy is gone from the app', gone === null, gone);
    const holding = await page.evaluate(() => {
      const el = [].filter.call(document.querySelectorAll('.prof-card'), (c) => /openWeeksTakeBack/.test(c.getAttribute('onclick') || ''))[0];
      return { has: !!el, txt: el ? el.textContent.replace(/\s+/g, ' ').trim() : null,
        lossScreen: /Take all the time you need/.test(document.querySelector('.ob-card') ? document.querySelector('.ob-card').innerText : '') };
    });
    ok('she is on the holding screen', holding.lossScreen, holding);
    ok('and the only screen she can still reach offers to take the markers off', holding.has, holding);
    ok('worded as an offer, not a chore', /whenever you want to/i.test(holding.txt || ''), holding.txt);

    /* Every other card on this screen opens something, and this one wears the same chevron. On the
       one screen in the product where somebody is tapping around numb and not reading, a chevron
       that fires an irreversible action in one tap is the wrong way round. */
    await page.evaluate(() => { window.__saved = null; });   // the export above already used it
    await click('.prof-card[onclick^="openWeeksTakeBack"]');
    await sleep(300);
    const tap1 = await page.evaluate(() => ({
      saved: !!window.__saved, rec: localStorage.getItem('cubby-preg-weeks:local'),
      sheet: (document.getElementById('sheet').innerText || '').replace(/\s+/g, ' ').trim(),
    }));
    ok('one tap on a numb screen writes nothing yet', tap1.saved === false, tap1.saved);
    ok('and forgets nothing yet either, so the door is still there', tap1.rec !== null, tap1.rec);
    ok('it asks first, and offers a way back out', /Take them off my calendar/.test(tap1.sheet) && /Leave them for now/.test(tap1.sheet), tap1.sheet.slice(0, 260));
    ok('and it does not push her either way', /Some people like to keep them/.test(tap1.sheet), tap1.sheet.slice(0, 260));

    await click('#sheet .btn-danger');
    await sleep(300);
    const cancel = await savedIcs();
    ok('the take-back is a real cancel file', /METHOD:CANCEL/.test(cancel), (cancel || '').slice(0, 120));
    ok('for all 17 of them, not just the next one',
      count(cancel, /STATUS:CANCELLED/g) === 17 && count(cancel, /UID:cubby-pregweek-/g) === 17, count(cancel, /STATUS:CANCELLED/g));
    ok('it names the same uids the publish used, or her calendar would ignore it',
      /UID:cubby-pregweek-25@little-cubby\.com/.test(cancel) && /UID:cubby-pregweek-41@little-cubby\.com/.test(cancel), null);
    ok('and the sequence is higher than the publish it is cancelling', count(cancel, /SEQUENCE:2/g) === 17, count(cancel, /SEQUENCE:2/g));
    const after = await page.evaluate(() => ({
      rec: localStorage.getItem('cubby-preg-weeks:local'),
      row: !![].filter.call(document.querySelectorAll('.prof-card'), (c) => /openWeeksTakeBack/.test(c.getAttribute('onclick') || ''))[0],
    }));
    ok('the record is cleared', after.rec === null, after.rec);
    ok('and the offer does not linger on a screen she is trying to leave', after.row === false, after);
  });

  /* "Move on from this screen" sends her back to the start screen, where there is no baby home and
     no pregnancy Home and therefore no door at all. So the one screen that has the door has to say
     what leaving it costs, and the way back has to be one tap. */
  await section('9a. leaving the quiet screen says what it leaves behind', async () => {
    await wipe();
    await load(seed(preg({ dueDate: dueForWeek(24) })));
    await click('.add-row[onclick^="openWeeksCalendar"]');
    await sleep(250);
    await click('#sheet .btn-primary');
    await sleep(300);
    await page.evaluate(() => { closeSheet(); endPregnancy(false); });
    await sleep(700);
    await click('.ob-card button.btn-ghost[onclick^="endLossHolding"]');
    await sleep(350);
    const warn = await page.evaluate(() => (document.getElementById('sheet').innerText || '').replace(/\s+/g, ' ').trim());
    ok('she is told the markers do not leave with the screen',
      /Your week markers stay in your calendar unless you take them off first/.test(warn), warn.slice(0, 320));
    ok('and nothing about it is her fault or her job', !/should|must|need to|forgot/i.test(warn), warn.slice(0, 320));
    ok('with a one-tap way back to the card that offers it', /Not yet/.test(warn), warn.slice(0, 320));

    // And the same sheet says nothing at all to somebody who never wrote to a calendar.
    await wipe();
    await load(seed(preg({ dueDate: dueForWeek(24) })));
    await page.evaluate(() => endPregnancy(false));
    await sleep(700);
    await click('.ob-card button.btn-ghost[onclick^="endLossHolding"]');
    await sleep(350);
    const quiet = await page.evaluate(() => (document.getElementById('sheet').innerText || '').replace(/\s+/g, ' ').trim());
    ok('and a calendar she never wrote to is never mentioned', !/week markers/i.test(quiet), quiet.slice(0, 320));
    await page.evaluate(() => closeSheet());
    await sleep(400);
  });

  await section('9. a loss with nothing exported offers nothing', async () => {
    await wipe();
    await load(seed(preg({ dueDate: dueForWeek(24) })));
    await page.evaluate(() => endPregnancy(false));
    await sleep(600);
    const r = await page.evaluate(() => ({
      lossScreen: /Take all the time you need/.test(document.querySelector('.ob-card') ? document.querySelector('.ob-card').innerText : ''),
      row: !![].filter.call(document.querySelectorAll('.prof-card'), (c) => /openWeeksTakeBack/.test(c.getAttribute('onclick') || ''))[0],
      support: /If you need support/.test(document.querySelector('.ob-card').innerText),
    }));
    ok('the holding screen is still the holding screen', r.lossScreen && r.support, r);
    ok('and nobody is asked about a calendar they never wrote to', r.row === false, r);
  });

  await section('10. it is hers, not the household\'s', async () => {
    await wipe();
    await load(seed(preg({ dueDate: dueForWeek(24) })), 'mama');
    await click('.add-row[onclick^="openWeeksCalendar"]');
    await sleep(250);
    await click('#sheet .btn-primary');
    await sleep(300);
    ok('mama has her weeks in her calendar', !!(await page.evaluate(() => JSON.parse(localStorage.getItem('cubby-preg-weeks:mama') || 'null'))), null);
    // Same household blob, same week: a second person picking up the phone.
    await load(seed(preg({ dueDate: dueForWeek(25) })), 'papa');
    const r = await page.evaluate(() => ({
      mine: JSON.parse(localStorage.getItem('cubby-preg-weeks:papa') || 'null'),
      hers: JSON.parse(localStorage.getItem('cubby-preg-weeks:mama') || 'null'),
      row: (([].filter.call(document.querySelectorAll('.add-row'), (x) => (x.getAttribute('onclick') || '').indexOf('openWeeksCalendar') === 0)[0]) || {}).textContent,
    }));
    ok('papa is not told his calendar has anything in it', r.mine === null, r.mine);
    ok('hers is untouched by his', r.hers && r.hers.seq === 1, r.hers);
    ok('and he is offered it fresh', /Put my weeks in my calendar/.test((r.row || '').trim()), r.row);
    const h = await hero();
    ok('his first sight of week 25 is his own, not a leftover of hers', h.roll === null, h);
    await load(seed(preg({ dueDate: dueForWeek(26) })), 'papa');
    ok('and the week turns for him on his own clock', (await hero()).roll === 'Week 26 starts today', await hero());
  });

  /* The outcome for almost everybody who taps this, and the one the first cut of it did not handle
     at all. endPregnancy was reasoned about at length; welcomeBaby was not. On a birth the markers
     do not stop: pregWeeksAhead() empties, the row that hosted the take-back hides itself, the
     pregnancy Home stops rendering, and "Week 40 · about the size of a pumpkin" keeps landing at
     nine in the morning every Saturday with nothing anywhere in the app that can reach it. */
  await section('11. the baby arrives, and the markers do not stop on their own', async () => {
    await wipe();
    await load(seed(preg({ dueDate: dueForWeek(24) })));
    await click('.add-row[onclick^="openWeeksCalendar"]');
    await sleep(250);
    await click('#sheet .btn-primary');
    await sleep(300);
    const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('cubby-preg-weeks:local') || 'null'));
    ok('she has 17 markers, named one by one and dated to the last of them',
      rec && rec.wks && rec.wks.length === 17 && rec.wks[0] === 25 && rec.until > Date.now(), rec);

    // The real birth transition, in the shape welcomeBaby leaves behind: a baby exists, the
    // pregnancy points at it, and the whole app is the baby's now.
    const born = seed(preg({ dueDate: dueForWeek(24), bornBabyId: 'b1', birthAt: now }));
    born.babies = [{ id: 'b1', name: 'Wren', color: '#e7a7b4', birth: now, country: 'uk' }];
    born.activeBabyId = 'b1';
    await load(born);
    const r = await page.evaluate(() => ({
      ahead: pregWeeksAhead().length,
      stranded: pregWeeksStranded(),
      rec: !!pregWeeksIcsRec(),
      preg: !!document.querySelector('.week-hero'),
    }));
    ok('the pregnancy screen is gone, and with it every route the old row had', r.preg === false && r.ahead === 0, r);
    ok('but her calendar still holds them, and the app still knows their names', r.rec && r.stranded, r);
    const door = await offRow();
    ok('so the baby side carries the door instead of dropping it', door !== null, door);
    ok('worded for somebody who has just given birth, not for a settings screen',
      /still in your calendar/i.test(door || '') && /whenever you like/i.test(door || ''), door);
    ok('and it does not offer to add any more weeks to a pregnancy that has ended', (await calRow()) === null, await calRow());

    await click('[onclick^="openWeeksTakeBack"]');
    await sleep(300);
    await click('#sheet .btn-danger');
    await sleep(350);
    const cancel = await savedIcs();
    ok('and it really takes all 17 off, not the handful that were left',
      /METHOD:CANCEL/.test(cancel || '') && count(cancel, /STATUS:CANCELLED/g) === 17, count(cancel, /STATUS:CANCELLED/g));
    ok('including the weeks that had already gone by, which her calendar still holds',
      /UID:cubby-pregweek-25@little-cubby\.com/.test(cancel || '') && /UID:cubby-pregweek-41@little-cubby\.com/.test(cancel || ''), null);
    ok('and then the door goes, because there is nothing behind it', (await offRow()) === null, await offRow());

    // And it takes itself down on its own once the last marker has been and gone.
    await page.evaluate((t) => localStorage.setItem('cubby-preg-weeks:local',
      JSON.stringify({ seq: 1, wks: [25, 26], from: 25, to: 26, until: t - 9 * 86400000, pid: 'p1', at: t - 60 * 86400000 })), now);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1300);
    ok('a record whose last marker is already past asks her for nothing', (await offRow()) === null, await offRow());
  });

  /* Every fixture above is built from a due date. About a third of the mothers who set this up give
     a last period instead, and nothing in the gate had ever walked that branch: breaking it outright
     used to leave the file 68 for 68. */
  await section('12. a last period instead of a due date', async () => {
    await wipe();
    const lmpFor = (n) => now - n * WEEK - 3 * DAY;   // week n turned three days ago
    await load(seed(preg({ dueDate: null, lmp: lmpFor(24) })));
    const r = await page.evaluate(() => ({
      wk: pregWeek(), ahead: pregWeeksAhead(), start: pregWeekStart(25),
      ics: pregWeeksIcsText(pregWeeksAhead(), 1),
    }));
    ok('the week comes out of her last period', r.wk === 24, r.wk);
    ok('and she is offered her weeks exactly as if she had given a due date',
      /Put my weeks in my calendar/.test((await calRow()) || ''), await calRow());
    ok('with every remaining week in it, not an empty file', r.ahead.length === 17 && r.ahead[0] === 25 && r.ahead[16] === 41, r.ahead);
    ok('week 25 begins where pregWeek() itself will turn it, to the second',
      r.start !== null && Math.abs(r.start - (lmpFor(24) + 25 * WEEK)) < 1000, { got: r.start, want: lmpFor(24) + 25 * WEEK });
    const pad = (n) => String(n).padStart(2, '0');
    const dayOf = (ms) => { const d = new Date(ms); return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()); };
    const starts = (r.ics.match(/DTSTART;VALUE=DATE:(\d{8})/g) || []).map((s) => s.slice(-8));
    ok('and the file she gets is dated from that, not from nothing',
      starts.length === 17 && starts[0] === dayOf(lmpFor(24) + 25 * WEEK), { got: starts[0], want: dayOf(lmpFor(24) + 25 * WEEK) });

    // The hero marker has to come off the same arithmetic.
    await load(seed(preg({ dueDate: null, lmp: now - 25 * WEEK })));
    ok('and the week turns on the hero for her too', (await hero()).roll === 'Week 25 starts today', await hero());
  });

  /* The record deliberately outlives the pregnancy that wrote it. That is what makes the take-back
     reachable after a loss, and it is also what let a brand new pregnancy be told her weeks were
     already in her calendar when she had added nothing at all. */
  await section('13. a new pregnancy is not handed the last one\'s calendar', async () => {
    await wipe();
    await load(seed(preg({ id: 'p1', dueDate: dueForWeek(24) })));
    await click('.add-row[onclick^="openWeeksCalendar"]');
    await sleep(250);
    await click('#sheet .btn-primary');
    await sleep(300);

    await load(seed(preg({ id: 'p2', dueDate: dueForWeek(30), createdAt: now })));
    ok('she has added nothing for this one, and is not told otherwise',
      /Put my weeks in my calendar/.test((await calRow()) || ''), await calRow());
    ok('but the markers from before are still coming, and she can still reach them', (await offRow()) !== null, await offRow());
    await click('.add-row[onclick^="openWeeksCalendar"]');
    await sleep(300);
    const sheet = await page.evaluate(() => (document.getElementById('sheet').innerText || '').replace(/\s+/g, ' ').trim());
    ok('and the sheet does not claim she added these before', !/You added these before/.test(sheet), sheet.slice(0, 260));
    ok('it offers the eleven weeks she actually has left', /Add 11 weeks/.test(sheet), sheet.slice(0, 200));

    await click('#sheet .btn-primary');
    await sleep(300);
    const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('cubby-preg-weeks:local') || 'null'));
    /* Weeks 25 to 30 belong to the pregnancy before this one and are still sitting in her calendar
       at their old dates. A record that only remembered 31..41 could never name them again. */
    ok('the earlier weeks are still remembered, or the take-back could never find them',
      rec && rec.wks.length === 17 && rec.wks[0] === 25 && rec.wks[16] === 41, rec && rec.wks);
    ok('and it now belongs to this pregnancy', rec && rec.pid === 'p2', rec && rec.pid);
    ok('the row says so', /Update my weeks in my calendar/.test((await calRow()) || ''), await calRow());

    await click('.add-row[onclick^="openWeeksCalendar"]');
    await sleep(250);
    await click('#sheet .btn-danger');
    await sleep(350);
    const cancel = await savedIcs();
    ok('and the take-back names every week ever written, not just the last batch',
      count(cancel, /STATUS:CANCELLED/g) === 17 && /UID:cubby-pregweek-25@little-cubby\.com/.test(cancel || ''), count(cancel, /STATUS:CANCELLED/g));
  });

  /* saveFile goes through the native bridge in the App Store build. If it throws, nothing reached
     her calendar, and the two records must not have moved: one would tell her the weeks are in a
     calendar that never saw them, the other would take the door away and leave the markers. */
  await section('14. a save that fails must not lie about her calendar', async () => {
    await wipe();
    await load(seed(preg({ dueDate: dueForWeek(24) })));
    await page.evaluate(() => { window.saveFile = function () { throw new Error('no bridge'); }; });
    await click('.add-row[onclick^="openWeeksCalendar"]');
    await sleep(250);
    await click('#sheet .btn-primary');
    await sleep(300);
    const bad = await page.evaluate(() => ({ rec: localStorage.getItem('cubby-preg-weeks:local'), t: window.__toasts.slice() }));
    ok('nothing reached her calendar, so nothing is written down', bad.rec === null, bad.rec);
    ok('and she is told plainly, without blame', /Could not add to calendar/.test(bad.t.join('|')), bad.t);
    ok('the row has not started claiming otherwise', /Put my weeks in my calendar/.test((await calRow()) || ''), await calRow());

    await page.evaluate(() => { closeSheet(); window.__toasts = []; window.saveFile = function (h, n, m) { window.__saved = { href: h, name: n, msg: m }; }; });
    await sleep(450);
    await click('.add-row[onclick^="openWeeksCalendar"]');
    await sleep(250);
    await click('#sheet .btn-primary');
    await sleep(300);
    ok('with a save that works it is written down', !!(await page.evaluate(() => JSON.parse(localStorage.getItem('cubby-preg-weeks:local') || 'null'))), null);

    await page.evaluate(() => { window.__toasts = []; window.saveFile = function () { throw new Error('no bridge'); }; });
    await click('.add-row[onclick^="openWeeksCalendar"]');
    await sleep(250);
    await click('#sheet .btn-danger');
    await sleep(300);
    const c = await page.evaluate(() => ({ rec: localStorage.getItem('cubby-preg-weeks:local'), t: window.__toasts.slice() }));
    ok('a take-back that never reached her calendar leaves the door open to try again', c.rec !== null, c.rec);
    ok('and says so rather than pretending', /Could not remove them/.test(c.t.join('|')), c.t);
  });

  /* The roll decision is cached for the page load on purpose. Sign out and back in as her partner
     without a reload and that cache would hand him her decision, which is the one thing the per-uid
     key exists to stop. */
  await section('15. a second person picks up the same phone, without a reload', async () => {
    await wipe();
    await load(seed(preg({ dueDate: dueForWeek(24) })));
    await load(seed(preg({ dueDate: dueForWeek(25) })));
    ok('the week turned for her', (await hero()).roll === 'Week 25 starts today', await hero());
    const r = await page.evaluate(() => {
      localStorage.setItem('cubby-quick-uid', 'papa2');
      const his = pregWeekRolled();
      return { his: his, hers: localStorage.getItem('cubby-preg-week-seen:local'), mine: localStorage.getItem('cubby-preg-week-seen:papa2') };
    });
    ok('his very first sight of the week is his own, not the tail of hers', r.his === 0, r);
    ok('and it is banked under his name, not left unrecorded', r.mine === '25', r);
    ok('hers is untouched', r.hers === '25', r);
  });

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'PREG-WEEKS-CAL: FAIL' : 'PREG-WEEKS-CAL: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
