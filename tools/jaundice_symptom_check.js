#!/usr/bin/env node
/* The observation Cubby had no slot for.
 *
 * Jaundice is the commonest reason a newborn goes back into hospital, and the triad a paediatrician
 * acts on is yellowing plus a sleepy or poorly feeding baby plus few wet nappies. Cubby logged the
 * second and the third and had nowhere at all to put the first: SYMPTOMS ran Fever, Cough, Runny
 * nose and never mentioned colour. A mother who noticed her four-day-old going yellow, told the app
 * nothing because it asked nothing, and handed a clinician a page of feeds and nappies with the
 * one thing she had actually been worried about missing from it.
 *
 * Three ways that could have been half-fixed, and each is checked here:
 *   - a chip alone. "Mild / moderate / severe" asks a parent for a verdict she cannot make. How far
 *     down the body the colour has reached is the fact worth writing, so this one symptom swaps the
 *     toggle, and swapping it must not leak: pick the yellow, pick tummy, pick Cough, and the log
 *     must not receive "Cough (tummy)".
 *   - silence on save. The fever path already answers; the yellow used to get a four-word toast.
 *   - the number that reads as dehydration. The nappy count printed beside the yellow dates comes
 *     from days that may hold no nappy log at all, and "0" on a clinical page is a finding. Nothing
 *     logged is not zero, and getting that wrong would manufacture half of the triad.
 *
 *   PORT=9282 node tools/serve.js &
 *   node tools/jaundice_symptom_check.js http://localhost:9282
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:9282';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, HOUR = 3600000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

// Midday, so every seeded "yesterday" and "the day before" lands squarely inside its own calendar
// day and the day grouping is not being tested against a midnight edge by accident.
const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;
const YELLOW = 'Skin or eyes look yellow';

const seed = (over) => Object.assign({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 6 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
  activeBabyId: 'b1', events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
}, over || {});

// Every seeded event carries babyId, because the whole clinical page is scoped by activeBabyId and
// a helper that quietly omitted it would test nothing.
const ev = (o) => Object.assign({ babyId: 'b1', authorId: 'local' }, o);
const yellowAt = (id, t, where) => ev({ id, type: 'symptom', symptom: YELLOW, severity: where, notes: '', time: t });
const nappyAt = (id, t, kind) => ev({ id, type: 'diaper', kind, time: t });

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
    await sleep(1200);
  };
  // A real tap on a real element: find it by the words a parent reads, then click it.
  const clickText = (sel, text) => page.evaluate((sel, text) => {
    const el = [...document.querySelectorAll(sel)].find((n) => (n.textContent || '').trim().toLowerCase() === text.toLowerCase());
    if (!el) return false;
    el.click(); return true;
  }, sel, text);
  const sheet = () => page.evaluate(() => {
    const s = document.getElementById('sheet');
    return { open: !!(s && s.classList.contains('show')), txt: (s ? s.innerText : '').replace(/\s+/g, ' ').trim() };
  });
  const lineOf = (text, re) => (text.split('\n').filter((l) => re.test(l)));
  /* The old assertions read the nappy line with /\d/ and /\b2\b/, which the digits inside "Aug 21"
     satisfy on their own, so a line that never printed a count at all went green. Parse it into
     day -> value instead and assert the value.
     "  Wet nappies on those days: Aug 20: 2, Aug 21: none logged" -> {'Aug 20':'2','Aug 21':'none logged'} */
  const nappyMap = (line) => {
    const out = {};
    ((line || '').split(':').slice(1).join(':')).split(',').forEach((part) => {
      const m = part.match(/^\s*(.+?)\s*:\s*(.+?)\s*$/);
      if (m) out[m[1]] = m[2];
    });
    return out;
  };
  // Same for the yellow line: "Skin or eyes looked yellow: Aug 20 (face), Aug 21 (chest)".
  const yellowDates = (line) => ((line || '').split(':').slice(1).join(':').match(/\d{1,2}/g) || []);
  /* The label is built page-side, not here: node and Chrome can disagree on the default locale and
     a gate that goes red because two runtimes spell "Aug" differently is worse than no gate. */
  const dLbl = (t) => page.evaluate((x) => new Date(x).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), t);
  // The exact record the sheet writes, captured in block 3 and booted from cold in block 7.
  let written = null;

  console.log('\n1. the symptom exists, and it exists on day six of a life');
  {
    await load(seed());
    const r = await page.evaluate(() => {
      openSymptom();
      const chips = [...document.querySelectorAll('#sheet .chip')].map((c) => c.textContent.trim());
      return { chips, n: chips.length, ageDays: Math.round((now() - activeBaby().birth) / 86400000) };
    });
    ok('the baby under test is six days old, which is when this matters', r.ageDays === 6, r.ageDays);
    ok('"Skin or eyes look yellow" is offered', r.chips.indexOf(YELLOW) >= 0, r.chips);
    // >= 0 as well as <= 2, because indexOf on a list that does not contain it is -1 and a bare
    // "<= 2" is a green light for the exact absence this gate exists to catch.
    ok('and it is offered early, not last, at the age that needs it', r.chips.indexOf(YELLOW) >= 0 && r.chips.indexOf(YELLOW) <= 2, r.chips);
    ok('no other chip was lost to make room', r.n === 15, r);
  }

  console.log('\n2. one toggle, two questions');
  {
    await load(seed());
    await page.evaluate(() => openSymptom());
    const before = await page.evaluate(() => [...document.querySelectorAll('#sheet .unit-toggle button')].map((b) => b.textContent.trim().toLowerCase()));
    ok('an ordinary symptom still asks how bad it is', before.join(',') === 'mild,moderate,severe', before);

    ok('the yellow chip is tappable', await clickText('#sheet .chip', YELLOW) === true);
    const after = await page.evaluate(() => ({
      btns: [...document.querySelectorAll('#sheet .unit-toggle button')].map((b) => b.textContent.trim().toLowerCase()),
      label: [...document.querySelectorAll('#sheet .field label')].map((l) => l.textContent.trim()).join(' | '),
      sel: symptomDraft.severity,
      txt: document.getElementById('sheet').innerText.replace(/\s+/g, ' '),
    }));
    ok('it asks how far the colour reaches instead', after.btns.join(',') === 'face,chest,tummy,legs', after.btns);
    ok('four places, not three', after.btns.length === 4, after.btns);
    ok('the label stops saying Severity', !/severity/i.test(after.label), after.label);
    ok('the draft is seeded with the first place, never left on "mild"', after.sel === 'face', after.sel);
    ok('and it says which way the colour travels', /starts at the face/i.test(after.txt), after.txt.slice(0, 240));

    /* The leak. Pick the yellow, pick tummy, then pick an ordinary symptom: the scale must go back
       AND the value with it, or the shared log receives "Cough (tummy)" forever. */
    ok('tummy is tappable', await clickText('#sheet .unit-toggle button', 'Tummy') === true);
    ok('and it takes', await page.evaluate(() => symptomDraft.severity) === 'tummy');
    ok('the Cough chip is tappable', await clickText('#sheet .chip', 'Cough') === true);
    const back = await page.evaluate(() => ({
      btns: [...document.querySelectorAll('#sheet .unit-toggle button')].map((b) => b.textContent.trim().toLowerCase()),
      sel: symptomDraft.severity,
    }));
    ok('leaving the yellow restores mild / moderate / severe', back.btns.join(',') === 'mild,moderate,severe', back.btns);
    ok('and "tummy" does not follow the parent to Cough', back.sel === 'mild', back.sel);
  }

  console.log('\n3. saving it is answered, not shrugged at');
  {
    await load(seed());
    await page.evaluate(() => openSymptom());
    await clickText('#sheet .chip', YELLOW);
    await clickText('#sheet .unit-toggle button', 'Chest');
    await clickText('#sheet .btn-primary', 'Log symptom');
    await sleep(300);
    written = await page.evaluate(() => state.events.filter((e) => e.type === 'symptom'));
    ok('exactly one symptom is written', written.length === 1, written);
    ok('with the place she chose, in the field every reader already prints',
      written.length === 1 && written[0].symptom === YELLOW && written[0].severity === 'chest', written);

    const s = await sheet();
    ok('a sheet answers rather than a toast disappearing', s.open === true, s);
    ok('it names the person to ask today', /midwife, health visitor or doctor/i.test(s.txt), s.txt.slice(0, 300));
    /* Midwife and health visitor are a UK community-postnatal pair. Cubby also ships the India
       schedule and US spellings, and a second caregiver has no "your midwife" either. Naming only
       those two leaves a real family with nobody to call, so the doctor is named alongside them. */
    ok('and the doctor is named alongside them, not only in the UK sentence', /doctor/i.test(s.txt), s.txt.slice(0, 300));
    ok('in two short sentences, not one strung together with two "and"s',
      !/on its own, and it is worth/i.test(s.txt), s.txt.slice(0, 300));
    ok('it says today, not "soon"', /today/i.test(s.txt), s.txt.slice(0, 300));
    ok('it repeats back where she saw it', /as far as the chest/i.test(s.txt), s.txt.slice(0, 300));
    ok('it still refuses to be medical advice', /not medical advice/i.test(s.txt));
    ok('it offers the page she would hand over', /summary for the doctor/i.test(s.txt));
    ok('and it passes the 3am test: no verdict, no alarm word', !/(urgent|emergency|danger|serious|abnormal)/i.test(s.txt), s.txt.slice(0, 300));

    /* The explainer button was never actually pressed, so the gate had no idea whether the slug it
       points at exists. A ghost button that opens nothing is worse than no button on this sheet. */
    ok('the explainer button is there', /What the yellowing means/i.test(s.txt), s.txt.slice(0, 300));
    // closeSheet() animates, so the carousel is measured after it settles, not in the same tick.
    const clicked = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('#sheet button')].find((b) => /What the yellowing means/i.test(b.textContent));
      if (!btn) return false;
      btn.click(); return true;
    });
    await sleep(900);
    const read = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());
    ok('and pressing it opens a real read, not an empty sheet', clicked && /jaundice/i.test(read), read.slice(0, 300));
    ok('the read it opens is the one about the yellow spreading downward', /spreading downward|top of the head/i.test(read), read.slice(0, 400));
  }

  console.log('\n4. the sentence changes with the age, and it fires only for the yellow');
  {
    await load(seed({ babies: [{ id: 'b1', name: 'Wren', birth: now - 300 * DAY, sex: 'M', routines: [], doctors: [], allergies: [] }] }));
    const older = await page.evaluate(() => {
      symptomDraft = { symptom: 'Skin or eyes look yellow', severity: 'face' };
      saveSymptom();
      const s = document.getElementById('sheet');
      return { open: s.classList.contains('show'), txt: s.innerText.replace(/\s+/g, ' ') };
    });
    ok('a ten-month-old still gets an answer', older.open === true, older);
    ok('but not a midwife, who is not in her life any more', !/midwife/i.test(older.txt), older.txt.slice(0, 240));
    ok('it points at the doctor instead', /doctor or health visitor/i.test(older.txt), older.txt.slice(0, 240));
    /* "Yellow skin or eyes at this age IS worth" does not agree, and leading on the age quietly
       tells her the age is the worrying part. Both branches open on the same word. */
    ok('the sentence agrees with its subject', !/skin or eyes at this age is/i.test(older.txt), older.txt.slice(0, 240));
    ok('and it leads on the yellowing, not on how old he is', /Yellowing at this age/.test(older.txt), older.txt.slice(0, 240));

    /* "Nothing happened" is not proof a rule fired, so the control writes a real event and checks
       BOTH that the log grew and that no sheet was raised. */
    await load(seed());
    const cough = await page.evaluate(() => {
      symptomDraft = { symptom: 'Cough', severity: 'mild' };
      saveSymptom();
      const s = document.getElementById('sheet');
      return { n: state.events.filter((e) => e.type === 'symptom').length, open: s.classList.contains('show') };
    });
    ok('an ordinary symptom is still written', cough.n === 1, cough);
    ok('and is still quiet: no sheet in her face for a cough', cough.open === false, cough);
  }

  console.log('\n5. the doctor page pairs it with the nappies from the same days');
  {
    /* Two yellow days. The older one has nappies logged, the newer one has none at all, which is
       the case where a plain count would print a dehydration signal nobody observed. */
    await load(seed({ events: [
      yellowAt('y1', now - 2 * DAY, 'face'),
      yellowAt('y2', now - 1 * DAY, 'chest'),
      nappyAt('d1', now - 2 * DAY - HOUR, 'wet'),
      nappyAt('d2', now - 2 * DAY - 2 * HOUR, 'both'),
      nappyAt('d3', now - 2 * DAY - 3 * HOUR, 'dirty'),
      ev({ id: 's1', type: 'symptom', symptom: 'Cough', severity: 'mild', notes: '', time: now - 2 * HOUR }),
    ] }));
    const t = await page.evaluate(() => visitSummary(7));
    const yl = lineOf(t, /looked yellow/);
    const nl = lineOf(t, /Wet nappies on/);
    const sl = lineOf(t, /^Symptoms:/);
    const d2 = await dLbl(now - 2 * DAY), d1 = await dLbl(now - 1 * DAY);
    const map = nappyMap(nl[0]);
    ok('the yellow reaches the page', yl.length === 1, t);
    ok('printed once, not once per event', (t.match(/looked yellow/g) || []).length === 1, t);
    // Two DIFFERENT dates. "Aug 21 (face, chest)" is one date with two extents and used to satisfy
    // the old /\d/ + comma-count pair on its own.
    ok('with both dates, and they are two different days', yellowDates(yl[0]).join(',') === [d2, d1].map((s) => s.match(/\d+/)[0]).join(','), yl[0]);
    ok('and where it reached on each', /\(face\)/.test(yl[0]) && /\(chest\)/.test(yl[0]), yl[0]);
    ok('the wet-nappy count is printed next to it', nl.length === 1, t);
    ok('two wet nappies counted on the day that had them, "both" included', map[d2] === '2', map);
    ok('the day nobody logged a nappy says so', map[d1] === 'none logged', map);
    /* The old assertion here was "never prints a zero", which is not what the code does and not
       what it should do: a day she logged nappies on and none were wet IS a zero, and hiding it
       would be the same lie as inventing one. What must never happen is a NUMBER standing in for a
       day with no nappy log at all. Probe D below prints the honest zero. */
    ok('and a day with no nappy log is never given a number', !/^\d+$/.test(map[d1]), map);
    ok('the label agrees with two dates', /Wet nappies on those days:/.test(nl[0]), nl[0]);
    ok('the ordinary symptom still prints in its own line', sl.length === 1 && /Cough/.test(sl[0]), sl);
    ok('and the yellow is not said twice by appearing there too', sl.length === 1 && !/yellow/i.test(sl[0]), sl);
    ok('the printed report is built from the same text and carries it', /looked yellow/.test(await page.evaluate(() => visitSummary(14, { noIllness: true }))));

    /* PROBE D: she logged nappies all day and not one of them was wet. That zero is the observation
       a clinician acts on, so it has to print, and it has to print as a number. */
    await load(seed({ events: [
      yellowAt('y1', now - 1 * DAY, 'chest'),
      nappyAt('d1', now - 1 * DAY - HOUR, 'dirty'),
      nappyAt('d2', now - 1 * DAY - 2 * HOUR, 'dirty'),
    ] }));
    const zt = await page.evaluate(() => visitSummary(7));
    const zm = nappyMap(lineOf(zt, /Wet nappies on/)[0]);
    ok('a day of dirty nappies and no wet ones prints the zero, it does not hide it', zm[d1] === '0', zm);
    // One date, so the label has to be singular. "Wet nappies on those days: Aug 21" is a typo on
    // the page a parent hands over.
    ok('and one date gets "that day", not "those days"', /Wet nappies on that day:/.test(lineOf(zt, /Wet nappies on/)[0]), lineOf(zt, /Wet nappies on/)[0]);

    /* The report surface itself, not just the string it is built from: openDoctorReport() writes
       into a new window, so window.open is stubbed and the written HTML read back. */
    const rep = await page.evaluate(() => {
      let html = '';
      const real = window.open;
      window.open = () => ({ document: { write: (h) => { html = h; }, close() {} }, focus() {} });
      try { openDoctorReport(); } catch (e) { html = 'THREW: ' + e.message; } finally { window.open = real; }
      return html;
    });
    ok('openDoctorReport itself renders, it is not only its input string that was tested', /Last 14 days/.test(rep), rep.slice(0, 200));
    ok('and the printable page carries the yellow and its nappies', /looked yellow/.test(rep) && /Wet nappies on/.test(rep), rep.slice(0, 400));
  }

  console.log('\n6. no data, someone else\'s data, and a second look on the same day');
  {
    await load(seed({ events: [ev({ id: 's1', type: 'symptom', symptom: 'Cough', severity: 'mild', notes: '', time: now - 2 * HOUR })] }));
    const none = await page.evaluate(() => visitSummary(7));
    ok('a week with no yellow prints no yellow line', !/looked yellow/.test(none), none);
    ok('and no orphan nappy line under it', !/Wet nappies on/.test(none), none);

    await load(seed({
      babies: [{ id: 'b1', name: 'Robin', birth: now - 6 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] },
        { id: 'b2', name: 'Wren', birth: now - 400 * DAY, sex: 'M', routines: [], doctors: [], allergies: [] }],
      events: [Object.assign(yellowAt('y9', now - 1 * DAY, 'legs'), { babyId: 'b2' })],
    }));
    const mine = await page.evaluate(() => visitSummary(7));
    ok('the other child\'s yellow stays on the other child\'s page', !/looked yellow/.test(mine), mine);
    const theirs = await page.evaluate(() => { state.activeBabyId = 'b2'; return visitSummary(7); });
    ok('and it is genuinely on his', /looked yellow/.test(theirs) && /\(legs\)/.test(theirs), theirs);

    // Looked again the same evening and it had spread. One date, both places, not two rows.
    await load(seed({ events: [
      yellowAt('y1', now - 1 * DAY - 6 * HOUR, 'face'),
      yellowAt('y2', now - 1 * DAY, 'chest'),
      nappyAt('d1', now - 1 * DAY - HOUR, 'wet'),
    ] }));
    const two = await page.evaluate(() => visitSummary(7));
    const yl = lineOf(two, /looked yellow/)[0] || '';
    const nl = lineOf(two, /Wet nappies on/)[0] || '';
    ok('two looks on one day are one date', (yl.match(/\(/g) || []).length === 1, yl);
    ok('carrying both places, in the order she saw them', /\(face, chest\)/.test(yl), yl);
    // The old test here was (nl.match(/\d/g)||[]).length >= 1, which the "21" in "Aug 21" answers
    // on its own. The count is the thing being tested, so the count is what is read.
    const oneDay = await dLbl(now - 1 * DAY);
    ok('and one nappy count, not the same day twice', Object.keys(nappyMap(nl)).length === 1, nappyMap(nl));
    ok('and that count is the one wet nappy she logged', nappyMap(nl)[oneDay] === '1', nappyMap(nl));
  }

  console.log('\n7. an open illness does not swallow it, and a reload does not lose it');
  {
    await load(seed({
      illnesses: [{ id: 'i1', babyId: 'b1', name: 'Cold', startedAt: now - 3 * DAY, endedAt: null }],
      events: [
        Object.assign(yellowAt('y1', now - 1 * DAY, 'chest'), { illnessId: 'i1' }),
        ev({ id: 's1', type: 'symptom', symptom: 'Cough', severity: 'mild', notes: '', time: now - 1 * DAY, illnessId: 'i1' }),
        nappyAt('d1', now - 1 * DAY - HOUR, 'wet'),
      ],
    }));
    const t = await page.evaluate(() => visitSummary(7));
    const ill = lineOf(t, /^\s+Symptoms:/);
    ok('the episode block still lists the cough', ill.length === 1 && /Cough/.test(ill[0]), t);
    ok('but not the yellow, which has its own lines', ill.length === 1 && !/yellow/i.test(ill[0]), ill);
    ok('and the yellow still prints, exactly once, with its nappies', (t.match(/looked yellow/g) || []).length === 1 && /Wet nappies on/.test(t), t);

    /* A cold boot on the record the SHEET actually wrote, not on a hand-typed lookalike. It cannot
       be "save, then reload" in this harness: store-firebase.js:2155 replaces persist() with a
       cloud push the moment it attaches, so a UI write never reaches localStorage here and a
       reload would be measuring the harness. Block 3 captured the real object; this boots it. */
    /* "written.length === 1" alone passed on a reverted build while holding a COUGH record, and
       then fed that cough into the cold boot below. What it is has to be asserted, not just that
       there is one of it. */
    ok('block 3 captured the record the sheet wrote', !!written && written.length === 1
      && written[0].symptom === YELLOW && written[0].severity === 'chest', written);
    await load(seed({ events: [written[0], nappyAt('d1', now - HOUR, 'wet'), nappyAt('d2', now - 2 * HOUR, 'wet')] }));
    const after = await page.evaluate(() => visitSummary(7));
    const nl = lineOf(after, /Wet nappies on/)[0] || '';
    ok('a fresh boot reads that record back onto the page', /looked yellow/.test(after) && /\(chest\)/.test(after), after);
    ok('with today\'s two wet nappies beside it', nappyMap(nl)[await dLbl(written[0].time)] === '2', nappyMap(nl));
  }

  console.log('\n8. the boundary day: the count is the day, not the tail of the day');
  {
    /* THE ONE ARRANGEMENT EVERY OTHER FIXTURE AVOIDS. Every block above seeds at now-1d or now-2d,
       comfortably interior to a 7-day window. `since` is a CLOCK-time cut (now() - days*DAY), so
       the oldest calendar day in any window is always a partial day, and the count taken from the
       windowed event list was the count of that day's tail. Jaundice peaks on days 3 to 7 and the
       onset day is the one a clinician asks about first, which is precisely the day sitting on the
       7-day boundary at the first appointment.
       Clock is 13:00. The yellow is at 14:00 on the boundary day, inside the window. Five wet
       nappies that morning are OUTSIDE it, one at 15:00 is inside. The day's answer is six. */
    const D7 = now - 7 * DAY;                       // 13:00, seven days ago = `since` for a 7-day window
    const bDay = await dLbl(D7);
    const morning = [1, 2, 3, 4, 5].map((h, i) => nappyAt('m' + i, D7 - h * HOUR, 'wet'));
    await load(seed({
      babies: [{ id: 'b1', name: 'Robin', birth: now - 9 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
      events: [yellowAt('y1', D7 + HOUR, 'chest'), nappyAt('a1', D7 + 2 * HOUR, 'wet')].concat(morning)
        .concat([1, 2, 3, 4, 5].map((d, i) => nappyAt('f' + i, now - d * DAY, 'wet'))),
    }));
    const seven = await page.evaluate(() => visitSummary(7));
    const fourteen = await page.evaluate(() => visitSummary(14));
    const m7 = nappyMap(lineOf(seven, /Wet nappies on/)[0]);
    const m14 = nappyMap(lineOf(fourteen, /Wet nappies on/)[0]);
    ok('the boundary-day yellow is on the 7-day page at all', /looked yellow/.test(seven), seven);
    ok('and its nappy count is the whole day, all six', m7[bDay] === '6', m7);
    ok('the 14-day report agrees, to the nappy', m14[bDay] === m7[bDay], { m7: m7[bDay], m14: m14[bDay] });
    /* Which button she pressed is not a clinical fact. Before the fix these two printed 1 and 6
       off one record, and the parent has no way of knowing which page she is holding. */
    ok('one record cannot mean two different things depending on which button she pressed',
      m7[bDay] === m14[bDay] && m7[bDay] === '6', { m7, m14 });

    /* Worse variant: every nappy that day logged before the cut. The page used to assert nothing
       was written down on a day she logged five. */
    await load(seed({
      babies: [{ id: 'b1', name: 'Robin', birth: now - 9 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
      events: [yellowAt('y1', D7 + HOUR, 'chest')].concat(morning),
    }));
    const only = nappyMap(lineOf(await page.evaluate(() => visitSummary(7)), /Wet nappies on/)[0]);
    ok('five nappies logged before the cut are not "none logged"', only[bDay] !== 'none logged', only);
    ok('they are five', only[bDay] === '5', only);
  }

  console.log('\n9. the words a second caregiver reads');
  {
    /* "as far as the face" implies travel and the face is where the colour starts. */
    await load(seed());
    const faceTxt = await page.evaluate(() => {
      symptomDraft = { symptom: 'Skin or eyes look yellow', severity: 'face' };
      saveSymptom();
      return document.getElementById('sheet').innerText.replace(/\s+/g, ' ');
    });
    ok('the face is where it starts, so it is not "as far as" the face', !/as far as the face/i.test(faceTxt), faceTxt.slice(0, 200));
    ok('and it still repeats back what she saw', /Saved on the face/i.test(faceTxt), faceTxt.slice(0, 200));

    /* The timeline row. mild / moderate / severe carry themselves as bare words; "legs" does not,
       and the person reading the row is often not the person who tapped it. */
    await load(seed({ events: [yellowAt('y1', now - 2 * HOUR, 'legs')] }));
    const row = await page.evaluate(() => {
      go('log');
      const items = [...document.querySelectorAll('#app .tl-item')].map((n) => n.innerText.replace(/\s+/g, ' ').trim());
      return { items, detail: eventDetail(state.events.find((e) => e.id === 'y1')) };
    });
    const yrow = row.items.find((s) => /yellow/i.test(s)) || '';
    ok('the yellow has a row on the Log tab', !!yrow, row.items.slice(0, 4));
    ok('and it says where the colour reached, not a bare "legs"', /as far as the legs/i.test(yrow), yrow);
    ok('the row text comes from eventDetail, so every timeline that uses it says the same',
      /^as far as the legs/.test(row.detail), row.detail);

    // The illness card's Recent symptoms row prints the same field and must say the same thing.
    await load(seed({
      illnesses: [{ id: 'i1', babyId: 'b1', name: 'Cold', startedAt: now - 2 * DAY, endedAt: null }],
      events: [Object.assign(yellowAt('y1', now - 2 * HOUR, 'legs'), { illnessId: 'i1' })],
    }));
    const card = await page.evaluate(() => { go('health'); setHealthTab('illness'); return document.getElementById('app').innerText.replace(/\s+/g, ' '); });
    ok('the illness card says it the same way', /as far as the legs/i.test(card), card.slice(0, 400));

    // An ordinary symptom is untouched: "mild" stays "mild", with no preposition bolted on.
    await load(seed({ events: [ev({ id: 's1', type: 'symptom', symptom: 'Cough', severity: 'mild', notes: '', time: now - 2 * HOUR })] }));
    const plain = await page.evaluate(() => eventDetail(state.events.find((e) => e.id === 's1')));
    ok('and an ordinary symptom is left alone', plain === 'mild', plain);
  }

  console.log('\n10. a mis-tap can be corrected, not only deleted');
  {
    /* Before this, openEdit had no branch for type "symptom": "when" and "delete", nothing else.
       That was survivable while severity was a soft adjective. It is now the observation printed on
       the doctor page, and deleting and re-logging loses the date the colour was first seen. */
    await load(seed({ events: [yellowAt('y1', now - 1 * DAY, 'legs')] }));
    const opened = await page.evaluate(() => {
      openEdit('y1');
      const s = document.getElementById('sheet');
      return {
        btns: [...s.querySelectorAll('#eSev button')].map((b) => b.textContent.trim().toLowerCase()),
        on: (s.querySelector('#eSev .on') || {}).textContent,
        label: [...s.querySelectorAll('.field label')].map((l) => l.textContent.trim()).join(' | '),
      };
    });
    ok('the edit sheet offers the extent', opened.btns.join(',') === 'face,chest,tummy,legs', opened.btns);
    ok('and asks it in the same words the log sheet did', /How far it reaches/.test(opened.label), opened.label);
    ok('with what she actually chose already on', (opened.on || '').trim().toLowerCase() === 'legs', opened.on);
    const fixed = await page.evaluate(() => {
      // Guarded, not asserted-by-throwing: with no extent control this whole block used to die on a
      // TypeError and the run printed no counts at all, which reads like a broken gate rather than
      // a missing feature.
      const btn = [...document.querySelectorAll('#eSev button')].find((b) => b.textContent.trim().toLowerCase() === 'chest');
      if (!btn) return { sev: 'NO EXTENT CONTROL IN THE EDIT SHEET', time: 0, hist: [] };
      btn.click();
      saveEdit('y1');
      const e = state.events.find((x) => x.id === 'y1');
      return { sev: e.severity, time: e.time, hist: (e.history || []).map((h) => h.field) };
    });
    ok('a correction sticks', fixed.sev === 'chest', fixed);
    ok('and it keeps the date the colour was first seen', fixed.time === now - 1 * DAY, fixed);
    ok('and it is recorded as an edit, not a silent overwrite', fixed.hist.indexOf('severity') >= 0, fixed.hist);
    const back = await page.evaluate(() => visitSummary(7));
    ok('the doctor page prints the corrected extent', /\(chest\)/.test(back) && !/\(legs\)/.test(back), lineOf(back, /looked yellow/)[0]);

    // An ordinary symptom gets the ordinary scale in the same place, and no jaundice words.
    await load(seed({ events: [ev({ id: 's1', type: 'symptom', symptom: 'Cough', severity: 'moderate', notes: '', time: now - 1 * DAY })] }));
    const co = await page.evaluate(() => {
      openEdit('s1');
      const s = document.getElementById('sheet');
      return {
        btns: [...s.querySelectorAll('#eSev button')].map((b) => b.textContent.trim().toLowerCase()),
        label: [...s.querySelectorAll('.field label')].map((l) => l.textContent.trim()).join(' | '),
      };
    });
    ok('a cough is edited on mild / moderate / severe', co.btns.join(',') === 'mild,moderate,severe', co.btns);
    ok('and it is still called Severity there', /Severity/.test(co.label) && !/How far/.test(co.label), co.label);
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'JAUNDICE: FAIL' : 'JAUNDICE: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
