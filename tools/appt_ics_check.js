#!/usr/bin/env node
/* The appointment she typed in never left the app.
 *
 * A parent opens her baby's doctor, types "next appointment: 14 September", and taps Save. What
 * happens next is nothing. saveDoctorEntry writes nextVisit onto the doctor record and the only
 * code in the whole file that ever reads it again is upcomingVisit, which paints a pill on the home
 * screen on the three days before the date. To see it she has to already be inside Cubby, on the
 * right tab, in the right week. There is no push (REMINDERS_LIVE is false), no cron and no email,
 * so the one thing she trusted Cubby to remember for her was held somewhere she could only reach by
 * remembering it herself. Meanwhile the same file already ships three working .ics exports:
 * antenatal appointments, the vaccine schedule and a medicine course.
 *
 * This gate holds the fix to the same bar as those three:
 *   - the row only appears when there is a real, saved, future date behind it
 *   - the file is a valid all-day VEVENT, folded to 75 octets, with an alert at nine the morning
 *     before, and no alert at all when nine has already gone
 *   - the whole open sheet is what gets exported, not the date from the sheet and the clinic from
 *     an older record: a right date beside a wrong address sends her to the practice she left
 *   - the UID is stable per doctor and the SEQUENCE goes up, so adding it twice UPDATES her
 *     calendar rather than leaving two appointment dates in it
 *   - she can take it back out again, and removing the doctor takes it with her
 *   - the ?go=visit link in the description actually routes somewhere, which it did not before
 *
 *   PORT=9766 node tools/serve.js &
 *   node tools/appt_ics_check.js http://localhost:9766
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:9766';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };
/* Every section runs inside this, so a missing function is one counted failure and the sections
   after it still run. A gate that dies at the first ReferenceError reports "exit 2" for a full
   revert and hides how many of its own assertions would have survived the feature being gone,
   which is the number that says whether the gate is worth keeping. */
const section = async (title, fn) => {
  console.log('\n' + title);
  try { await fn(); } catch (e) { fail++; console.log('  FAIL the section ran at all\n         got: ' + (e && e.message ? e.message : String(e))); }
};

// Pinned to 13:00 local. Midday matters twice here: an all-day event built from a YYYY-MM-DD string
// is exactly where a UTC parse silently lands on the wrong calendar day, and the day-before alert is
// nine in the morning, so a clock stuck at 08:00 or at 23:30 would hide half of section 4.
const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;
const ymd = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
const compact = (s) => s.replace(/-/g, '');

const TODAY = ymd(now);
const TOMORROW = ymd(now + DAY);
const IN_TEN = ymd(now + 10 * DAY);
const IN_TWENTY = ymd(now + 20 * DAY);
const LAST_WEEK = ymd(now - 7 * DAY);

const doc = (over) => Object.assign({ id: 'd1', role: 'Pediatrician', name: 'Dr. Rao', clinic: 'Willow Clinic', phone: '01234 567890', nextVisit: IN_TEN }, over || {});
const baby = (docs, over) => Object.assign({ id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', routines: [], doctors: docs, allergies: [] }, over || {});

const seed = (over) => Object.assign({
  babies: [baby([doc()])],
  activeBabyId: 'b1', events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
}, over || {});

// Unfolds RFC 5545 line folding before matching, so a long DESCRIPTION cannot fake a miss.
const unfold = (s) => s.replace(/\r\n[ \t]/g, '');
const octets = (s) => Buffer.byteLength(s, 'utf8');

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
    // saveFile is the single exit for every file Cubby writes, so stubbing it here catches the .ics
    // without a download, exactly as it is called in the app.
    await page.evaluate(() => {
      window.__toasts = []; window.toast = function (m) { window.__toasts.push(m); };
      window.__saved = null; window.saveFile = function (href, name, msg) { window.__saved = { href: href, name: name, msg: msg }; };
      // persist() has been swapped by store-firebase for a debounced cloud push, so counting the
      // calls is the only way from here to tell a committed change from one held in memory.
      window.__persists = 0; window.persist = function () { window.__persists++; };
    });
    await sleep(200);
  };
  // Runs the export the way the row does, then reads back the bytes the parent's calendar would get.
  const exportFor = (id) => page.evaluate(async (docId) => {
    window.__saved = null; window.__toasts = [];
    exportDoctorVisit(docId);
    const out = { toasts: window.__toasts.slice(), saved: !!window.__saved, name: window.__saved ? window.__saved.name : null, msg: window.__saved ? window.__saved.msg : null, text: null };
    if (window.__saved) out.text = await fetch(window.__saved.href).then((r) => r.text());
    const d = (state.babies[0].doctors || []).find((x) => x.id === docId);
    out.rec = d ? { name: d.name, clinic: d.clinic, phone: d.phone, nextVisit: d.nextVisit, ics: d.ics || null } : null;
    return out;
  }, id);

  await section('1. the row is offered beside a real future appointment', async () => {
    await load(seed());
    const r = await page.evaluate(() => {
      openDoctorEdit('d1');
      const row = document.querySelector('#docCalRow .add-row');
      const cs = row ? getComputedStyle(row) : null;
      return { has: !!row, label: row ? row.textContent.trim() : null, onclick: row ? row.getAttribute('onclick') : null,
        w: row ? Math.round(row.getBoundingClientRect().width) : 0, h: row ? Math.round(row.getBoundingClientRect().height) : 0,
        // Rect alone would pass on visibility:hidden or opacity:0, which is a row she never sees.
        painted: !!(cs && cs.visibility === 'visible' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.5) };
    });
    ok('the sheet shows an add-to-calendar row', r.has === true, r);
    ok('worded for a parent, not for a developer', /put this visit in my calendar/i.test(r.label || ''), r.label);
    ok('and it is actually laid out, painted and visible at 390px', r.painted === true && r.h > 20 && r.w > 200, r);
    ok('it points at this doctor', /exportDoctorVisit\('d1'\)/.test(r.onclick || ''), r.onclick);
  });

  await section('2. nothing to promise, nothing offered', async () => {
    await load(seed({ babies: [baby([doc({ nextVisit: '' })])] }));
    /* Positive control in the same breath as the negative one. "No row" passes trivially against a
       tree where #docCalRow does not exist at all, so each absence is followed by picking a date in
       the open sheet and watching the row arrive. That second half is also the commonest path there
       is: a doctor already saved, no date yet, she picks one. */
    const empty = await page.evaluate((next) => {
      openDoctorEdit('d1');
      const before = !!document.querySelector('#docCalRow .add-row');
      const f = document.getElementById('docNext');
      f.value = next; f.dispatchEvent(new Event('input', { bubbles: true }));
      const row = document.querySelector('#docCalRow .add-row');
      return { before: before, after: !!row, label: row ? row.textContent.trim() : null };
    }, IN_TEN);
    ok('a doctor with no date gets no calendar row', empty.before === false, empty);
    ok('and picking a date brings the row to her, without a save', empty.after === true, empty);
    ok('worded as an add the first time', /put this visit in my calendar/i.test(empty.label || ''), empty.label);

    // A date that has already gone would put an alert in her calendar for a morning that is over.
    await load(seed({ babies: [baby([doc({ nextVisit: LAST_WEEK })])] }));
    const past = await page.evaluate((next) => {
      openDoctorEdit('d1');
      const before = !!document.querySelector('#docCalRow .add-row');
      const f = document.getElementById('docNext');
      f.value = next; f.dispatchEvent(new Event('input', { bubbles: true }));
      return { before: before, after: !!document.querySelector('#docCalRow .add-row') };
    }, IN_TEN);
    ok('a date already gone gets no calendar row', past.before === false, past);
    ok('and rebooking it brings the row back', past.after === true, past);

    // No saved record means no stable UID, so there is nothing a second export could update.
    await load(seed());
    const fresh = await page.evaluate((next) => {
      openDoctorEdit(null);
      const before = !!document.querySelector('#docCalRow .add-row');
      const f = document.getElementById('docNext');
      f.value = next; f.dispatchEvent(new Event('input', { bubbles: true }));
      return { before: before, after: !!document.querySelector('#docCalRow .add-row') };
    }, IN_TEN);
    ok('a doctor being added for the first time gets no row yet', fresh.before === false, fresh);
    ok('and still none once she picks a date, because there is nothing saved to hang it on', fresh.after === false, fresh);
  });

  await section('3. the file is one all-day appointment her calendar will accept', async () => {
    await load(seed());
    const r = await exportFor('d1');
    const raw = r.text || '';
    const t = unfold(raw);
    ok('a file is handed to the phone', r.saved === true, { saved: r.saved, toasts: r.toasts });
    ok('named after the doctor, not "download"', r.name === 'dr-rao-visit.ics', r.name);
    ok('it is a calendar publish', /^BEGIN:VCALENDAR\r\n/.test(t) && /METHOD:PUBLISH/.test(t) && /END:VCALENDAR$/.test(t), t.slice(0, 90));
    ok('exactly one event, not one per tap', (t.match(/BEGIN:VEVENT/g) || []).length === 1, t);
    ok('all-day on the day she typed', t.indexOf('DTSTART;VALUE=DATE:' + compact(IN_TEN)) >= 0, t);
    ok('ending the next day, so it occupies one day only', t.indexOf('DTEND;VALUE=DATE:' + compact(ymd(now + 11 * DAY))) >= 0, t);
    ok('no invented clock time anywhere', !/DTSTART:[0-9]{8}T/.test(t), t);
    ok('a UTC DTSTAMP in the shape RFC 5545 asks for', /\r\nDTSTAMP:[0-9]{8}T[0-9]{6}Z\r\n/.test(t), t);
    ok('the summary names the baby and the doctor', /SUMMARY:Robin's appointment: Dr\. Rao/.test(t), t);
    ok('the clinic rides along as the location', /LOCATION:Willow Clinic/.test(t), t);
    ok('the clinic phone is there to ring at 8am', /01234 567890/.test(t), t);
    ok("the description is about her baby, not about a second doctor", /Robin's care team and a summary of the last week are in the app/.test(t), t);
    ok('CRLF line endings, as RFC 5545 requires', t.indexOf('\r\n') > 0 && !/[^\r]\n/.test(t), t.slice(0, 60));
    /* 75 octets is the line limit in the spec. The description here is over 180 unfolded, which most
       calendars survive and some truncate, and a truncated DESCRIPTION is a lost link. */
    const lines = raw.split('\r\n');
    const longest = lines.reduce((m, l) => Math.max(m, octets(l)), 0);
    ok('no content line runs past the 75-octet limit', longest <= 75, { longest: longest, worst: lines.filter((l) => octets(l) > 75)[0] });
    ok('and the folding is reversible, so the deep link survives it', t.indexOf('https://little-cubby.com/app/?go=visit') >= 0, t);
  });

  await section('4. the alert lands in the morning, or it is not written at all', async () => {
    await load(seed());
    const r = await exportFor('d1');
    const t = unfold(r.text || '');
    /* TRIGGER on an all-day DTSTART counts back from midnight, so -P1D is 00:00 the previous day:
       a banner in the small hours, naming the baby, in a house where someone has just got her down.
       -PT15H is nine that morning. */
    ok('one alert, at nine the morning before', /BEGIN:VALARM\r\nTRIGGER:-PT15H\r\nACTION:DISPLAY/.test(t), t);
    ok('never the midnight -P1D the older exports use', t.indexOf('TRIGGER:-P1D') < 0, t);
    ok('the banner reads as a sentence, not as a filename with a colon in it', /DESCRIPTION:Robin's appointment is tomorrow\r\nEND:VALARM/.test(t), t);

    // Her appointment is today. The row is offered, because the address and the number are still
    // worth having, but nine yesterday morning has gone and a calendar drops a past alarm silently.
    await load(seed({ babies: [baby([doc({ nextVisit: TODAY })])] }));
    const rowToday = await page.evaluate(() => { openDoctorEdit('d1'); return !!document.querySelector('#docCalRow .add-row'); });
    const s = await exportFor('d1');
    const ts = unfold(s.text || '');
    ok("today's appointment can still go in her calendar", rowToday === true && s.saved === true, { rowToday: rowToday, saved: s.saved });
    ok('with the right day on it', ts.indexOf('DTSTART;VALUE=DATE:' + compact(TODAY)) >= 0, ts);
    ok('and no alarm she was never going to get', ts.indexOf('BEGIN:VALARM') < 0, ts);

    // Added this afternoon for tomorrow: nine this morning is also gone.
    await load(seed({ babies: [baby([doc({ nextVisit: TOMORROW })])] }));
    const s2 = await exportFor('d1');
    const t2 = unfold(s2.text || '');
    ok('a visit booked for tomorrow is saved too', s2.saved === true, s2);
    ok('and it also refuses to promise an alert that is already behind her', t2.indexOf('BEGIN:VALARM') < 0, t2);
  });

  await section('5. the UID is stable and the SEQUENCE goes up, so a second tap updates one entry', async () => {
    await load(seed());
    const a = await exportFor('d1');
    const b = await exportFor('d1');
    const ta = unfold(a.text || ''), tb = unfold(b.text || '');
    ok('the UID is derived from the doctor, not from a random id', /UID:cubby-doc-d1@little-cubby\.com/.test(ta), ta);
    ok('the same doctor gives the same UID on the second export', /UID:cubby-doc-d1@little-cubby\.com/.test(tb), tb);
    ok('the first export is SEQUENCE:1', /SEQUENCE:1\r\n/.test(ta), ta);
    ok('the second is SEQUENCE:2, so calendars treat it as an update', /SEQUENCE:2\r\n/.test(tb), tb);
    ok('and the bump is remembered on the doctor record', b.rec && b.rec.ics && b.rec.ics.seq === 2, b.rec);

    // The point of the stable UID: she does not end up with two appointment dates for one baby.
    const moved = await page.evaluate((next) => { state.babies[0].doctors[0].nextVisit = next; return next; }, IN_TWENTY);
    const c = await exportFor('d1');
    const tc = unfold(c.text || '');
    ok('moving the appointment reuses the same UID', /UID:cubby-doc-d1@little-cubby\.com/.test(tc), tc);
    ok('with a higher SEQUENCE', /SEQUENCE:3\r\n/.test(tc), tc);
    ok('and the new date in it', tc.indexOf('DTSTART;VALUE=DATE:' + compact(moved)) >= 0, tc);
  });

  await section('6. the sheet she has open is the sheet that gets exported', async () => {
    /* The failure this section exists for: she has changed practice. In one sitting she types the
       new doctor, the new clinic and the new number, picks the new date and taps the calendar row.
       Reading the date from the live field and the other three from the stored record produces an
       entry that is right about when and wrong about where, and the alert on the morning sends her
       to the practice she left, with its phone number. */
    await load(seed());
    const r = await page.evaluate(async (next) => {
      openDoctorEdit('d1');
      document.getElementById('docName').value = 'Dr. Ama Osei';
      document.getElementById('docClinic').value = 'Rosewood Clinic';
      document.getElementById('docPhone').value = '020 7000 1000';
      const f = document.getElementById('docNext');
      f.value = next; f.dispatchEvent(new Event('input', { bubbles: true }));
      window.__saved = null; window.__toasts = [];
      exportDoctorVisit('d1');
      const text = window.__saved ? await fetch(window.__saved.href).then((x) => x.text()) : '';
      const d = state.babies[0].doctors[0];
      return { text: text, name: window.__saved ? window.__saved.name : null, msg: window.__saved ? window.__saved.msg : null,
        rec: { name: d.name, clinic: d.clinic, phone: d.phone, nextVisit: d.nextVisit }, persists: window.__persists };
    }, IN_TWENTY);
    const t = unfold(r.text || '');
    ok('the date in the open field is what reaches her calendar, saved or not', t.indexOf('DTSTART;VALUE=DATE:' + compact(IN_TWENTY)) >= 0, t);
    ok('the doctor she just typed is the one in the summary', /SUMMARY:Robin's appointment: Dr\. Ama Osei/.test(t), t);
    ok('the clinic she just typed is the one in the location', /LOCATION:Rosewood Clinic/.test(t) && t.indexOf('Willow Clinic') < 0, t);
    ok('the number she just typed is the one she would ring', t.indexOf('020 7000 1000') >= 0 && t.indexOf('01234 567890') < 0, t);
    ok('and the file is named after her, not after the doctor she left', r.name === 'dr-ama-osei-visit.ics', r.name);
    ok('the record is brought into line on every field, so app and calendar agree',
      r.rec.name === 'Dr. Ama Osei' && r.rec.clinic === 'Rosewood Clinic' && r.rec.phone === '020 7000 1000' && r.rec.nextVisit === IN_TWENTY, r.rec);
    /* persist() is the only route out of memory. In the browser it is store-firebase's debounced
       cloud push, not a localStorage write, so the assertion is that the export commits at all:
       without this the moved date and the SEQUENCE die when she closes the tab, and her next
       export is SEQUENCE:1 again and lands as a duplicate rather than an update. */
    ok('and the change is committed, not just held in memory', r.persists >= 1, r.persists);
    // It writes without her pressing Save changes, so the toast has to own up to both halves.
    ok('the toast says it saved as well as added', /saved/i.test(r.msg || '') && /calendar/i.test(r.msg || ''), r.msg);

    // Nothing touched, nothing claimed: the same tap on an unedited sheet only reports the calendar.
    await load(seed());
    const quiet = await page.evaluate(async () => {
      openDoctorEdit('d1');
      window.__saved = null; exportDoctorVisit('d1');
      return window.__saved ? window.__saved.msg : null;
    });
    ok('but it does not claim a save when she changed nothing', /^Added, check your calendar/.test(quiet || ''), quiet);

    // Clearing the date is a real thing a parent does when a visit is cancelled.
    const cleared = await page.evaluate(() => {
      const f = document.getElementById('docNext');
      f.value = ''; f.dispatchEvent(new Event('input', { bubbles: true }));
      window.__saved = null; window.__toasts = [];
      exportDoctorVisit('d1');
      return { add: !!document.querySelector('#docCalRow .add-row'), saved: !!window.__saved, toasts: window.__toasts };
    });
    ok('clearing the date takes the add row away', cleared.add === false, cleared);
    ok('and no empty file is written even if it is called anyway', cleared.saved === false, cleared);
    ok('she is told what is missing, gently', /add the appointment date/i.test((cleared.toasts[0] || '')), cleared.toasts);
    // Emptying the name and the clinic is the one state Save itself refuses, so this refuses it too.
    const nameless = await page.evaluate((next) => {
      document.getElementById('docName').value = '';
      document.getElementById('docClinic').value = '';
      const f = document.getElementById('docNext');
      f.value = next; f.dispatchEvent(new Event('input', { bubbles: true }));
      window.__saved = null; window.__toasts = [];
      exportDoctorVisit('d1');
      return { saved: !!window.__saved, toasts: window.__toasts, storedName: state.babies[0].doctors[0].name };
    }, IN_TEN);
    ok('a sheet with no name and no clinic is refused, exactly as Save refuses it', nameless.saved === false, nameless);
    ok('with the same words Save uses', /add a name or clinic/i.test(nameless.toasts[0] || ''), nameless.toasts);
    ok('and it does not blank the doctor she already had', !!nameless.storedName, nameless);
  });

  await section('7. it survives the parts of a real record that are missing or awkward', async () => {
    // Name-less doctor: openDoctor lists these as their role, so the calendar should too.
    await load(seed({ babies: [baby([{ id: 'd9', role: 'Dentist', name: '', clinic: '', phone: '', nextVisit: IN_TEN }])] }));
    const r = await exportFor('d9');
    const t = unfold(r.text || '');
    ok('a doctor with only a role still exports', r.saved === true, r);
    ok('and is called by that role', /SUMMARY:Robin's appointment: Dentist/.test(t), t);
    ok('no empty LOCATION line for a clinic she never gave', !/LOCATION:\r\n/.test(t) && t.indexOf('LOCATION:') < 0, t);

    /* Clinic and no name is a saved, supported state: saveDoctorEntry accepts name OR clinic. Cubby
       has "Willow Clinic" sitting right there, so telling her calendar "the doctor" is a fact
       thrown away, and it sits in her week for a month. */
    await load(seed({ babies: [baby([{ id: 'd7', role: '', name: '', clinic: 'Willow Clinic', phone: '', nextVisit: IN_TEN }])] }));
    const r7 = await exportFor('d7');
    const t7 = unfold(r7.text || '');
    ok('a clinic with no doctor name is called by the clinic', /SUMMARY:Robin's appointment: Willow Clinic/.test(t7), t7);
    ok('never "the doctor" when she has told us the clinic', t7.indexOf("appointment: the doctor") < 0, t7);
    ok('and the file is named after the clinic', r7.name === 'willow-clinic-visit.ics', r7.name);

    // A baby with no name yet. Every other fallback in the file is warm and lowercase.
    await load(seed({ babies: [baby([doc()], { name: '' })] }));
    const r0 = await exportFor('d1');
    const t0 = unfold(r0.text || '');
    ok("a nameless baby is \"your baby\", not a Title Case common noun", /SUMMARY:your baby's appointment: Dr\. Rao/.test(t0), t0);
    ok('and the description says it the same way', /Your baby's care team/.test(t0), t0);

    // Commas and semicolons in a clinic name are RFC 5545 delimiters: unescaped they split the line.
    await load(seed({ babies: [baby([doc({ id: 'd2', name: 'Dr. Ali, MD', clinic: 'Oak; Elm Practice', nextVisit: IN_TEN })])] }));
    const r2 = await exportFor('d2');
    const t2 = unfold(r2.text || '');
    ok('a comma in the name is escaped, not deleted', /SUMMARY:Robin's appointment: Dr\. Ali\\, MD/.test(t2), t2);
    ok('a semicolon in the clinic is escaped too', /LOCATION:Oak\\; Elm Practice/.test(t2), t2);

    // Someone else's doctor, and a doctor that no longer exists.
    const ghost = await exportFor('d-nope');
    ok('an id that is not in this baby writes nothing at all', ghost.saved === false, ghost);
  });

  await section('8. she can take it back off her calendar', async () => {
    /* An add with no remove is the wrong shape for this. A visit gets called off; a practice moves;
       and in the state runDeepLink itself has a guard for, a mother has lost the baby whose name is
       on that alert. Under an add-only export the only way to stop it was to delete the doctor, and
       the entry stayed in her phone even then. The medicine course already ships both halves. */
    await load(seed());
    const first = await exportFor('d1');
    ok('the entry is in her calendar to start with', first.rec.ics && first.rec.ics.seq === 1, first.rec);
    const row = await page.evaluate(() => {
      openDoctorEdit('d1');
      const el = document.querySelector('#docCalRow');
      const add = el ? el.querySelector('.add-row') : null;
      return { label: add ? add.textContent.trim() : null, html: el ? el.innerHTML : '',
        canRemove: !!(el && el.querySelector('[onclick*="cancelDoctorVisit"]')),
        removeLabel: el && el.querySelector('[onclick*="cancelDoctorVisit"]') ? el.querySelector('[onclick*="cancelDoctorVisit"]').textContent.trim() : null };
    });
    ok('the row now offers to update it, not to add it a second time', /update this visit in my calendar/i.test(row.label || ''), row.label);
    ok('and says out loud that a second tap is not a second entry', /updates the same entry/i.test(row.html), row.html);
    ok('there is a way to take it back off her calendar', row.canRemove === true, row);
    ok('worded in her voice, not as "cancel event"', /take this off my calendar/i.test(row.removeLabel || ''), row.removeLabel);

    const c = await page.evaluate(async () => {
      window.__saved = null; window.__toasts = [];
      cancelDoctorVisit('d1');
      const text = window.__saved ? await fetch(window.__saved.href).then((x) => x.text()) : '';
      const d = state.babies[0].doctors[0];
      const el = document.querySelector('#docCalRow');
      return { text: text, name: window.__saved ? window.__saved.name : null, msg: window.__saved ? window.__saved.msg : null,
        ics: d.ics || null, stillOffered: !!(el && el.querySelector('[onclick*="cancelDoctorVisit"]')) };
    });
    const tc = unfold(c.text || '');
    ok('a real cancel file is written', /METHOD:CANCEL/.test(tc) && /STATUS:CANCELLED/.test(tc), tc);
    ok('against the same UID, so it finds the entry she has', /UID:cubby-doc-d1@little-cubby\.com/.test(tc), tc);
    ok('at a higher SEQUENCE, or the calendar would ignore it', /SEQUENCE:2\r\n/.test(tc), tc);
    ok('naming the day it was for', tc.indexOf('DTSTART;VALUE=DATE:' + compact(IN_TEN)) >= 0, tc);
    ok('the record forgets the entry, so the next add starts clean', c.ics === null, c.ics);
    ok('and the row stops offering to remove something that is gone', c.stillOffered === false, c);
    ok('honest about what a cancel can and cannot do', /delete it in your Calendar app/i.test(c.msg || ''), c.msg);

    // Removing the doctor has to take the alarm with her: after that there is no row left to tap.
    await load(seed());
    await exportFor('d1');
    const del = await page.evaluate(async () => {
      window.__saved = null; window.__toasts = [];
      deleteDoctor('d1');
      const text = window.__saved ? await fetch(window.__saved.href).then((x) => x.text()) : '';
      return { text: text, doctors: (state.babies[0].doctors || []).length, toasts: window.__toasts.slice() };
    });
    ok('removing the doctor also withdraws the appointment', /METHOD:CANCEL/.test(unfold(del.text || '')), del);
    ok('under that doctor\'s UID', /UID:cubby-doc-d1@little-cubby\.com/.test(unfold(del.text || '')), del.text);
    ok('and the doctor is still removed', del.doctors === 0, del);

    // A doctor who was never exported must not hand her a cancel file out of nowhere.
    await load(seed());
    const plain = await page.evaluate(() => {
      window.__saved = null; window.__toasts = [];
      deleteDoctor('d1');
      return { saved: !!window.__saved, toasts: window.__toasts.slice(), doctors: (state.babies[0].doctors || []).length };
    });
    ok('a doctor who was never added to her calendar is just removed', plain.saved === false && plain.doctors === 0, plain);
    ok('with the plain word she already knows', plain.toasts.indexOf('Removed') >= 0, plain.toasts);
  });

  await section('9. the link in the description goes somewhere', async () => {
    await load(seed());
    const r = await exportFor('d1');
    const t = unfold(r.text || '');
    ok('the description carries the deep link', /https:\/\/little-cubby\.com\/app\/\?go=visit/.test(t), t);
    // Before this change ?go=visit was not a route: BABY_GO had feed, diaper, sleep and temp only,
    // so an alert tapped from her calendar dropped her on a generic home screen.
    const run = (go) => page.evaluate(async (g) => {
      closeSheet();
      // A closed sheet keeps its display, its visibility and every word of its innerText, so "it
      // still says care team" proves nothing about what just happened. Blank it, and the control
      // then holds whichever order these two run in.
      const old = document.querySelector('.sheet, #sheet'); if (old) old.innerHTML = '';
      await new Promise((r2) => setTimeout(r2, 250));
      runDeepLink({ go: g });
      await new Promise((r2) => setTimeout(r2, 450));
      const sh = document.querySelector('.sheet, #sheet');
      const r3 = sh ? sh.getBoundingClientRect() : null;
      return { onScreen: !!(sh && sh.classList.contains('show') && r3 && r3.height > 100 && r3.top < window.innerHeight - 100),
        care: !!(sh && /care team/i.test(sh.innerText || '')) };
    }, go);
    // Deliberately after the real one: this is the ordering the control has to survive.
    const routed = await run('visit');
    ok('?go=visit lands on a sheet that is actually on screen', routed.onScreen === true, routed);
    ok('and it is the care team and visit log', routed.care === true, routed);
    const nothing = await run('notathing');
    ok('an unknown go key opens nothing, so this test can fail', nothing.onScreen === false, nothing);
    ok('and does not leave her on the care team', nothing.care === false, nothing);
  });

  await section('10. a second session picks up the SEQUENCE where the first left off', async () => {
    /* A record that already carries an ics stamp is what comes back from the cloud on her next
       phone, or after a reload. Restarting the count at 1 there would make every later export look
       older than the entry already sitting in her calendar, and calendars ignore a SEQUENCE that
       has not gone up: the moved appointment would silently never move. */
    await load(seed({ babies: [baby([doc({ nextVisit: IN_TWENTY, ics: { seq: 4, date: IN_TEN, at: now - 3 * DAY } })])] }));
    const r = await page.evaluate(() => { openDoctorEdit('d1'); return !!document.querySelector('#docCalRow .add-row'); });
    ok('the row is offered again on the next visit to the sheet', r === true, r);
    const e = await exportFor('d1');
    const t = unfold(e.text || '');
    ok('the SEQUENCE carries on from the stored one', /SEQUENCE:5\r\n/.test(t), t);
    ok('under the same UID, so it updates the entry she already has', /UID:cubby-doc-d1@little-cubby\.com/.test(t), t);
    ok('and carries the date the record now holds', t.indexOf('DTSTART;VALUE=DATE:' + compact(IN_TWENTY)) >= 0, t);
    ok('the stamp on the record moves with it', e.rec.ics.seq === 5 && e.rec.ics.date === IN_TWENTY, e.rec);
  });

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'APPT-ICS: FAIL' : 'APPT-ICS: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
