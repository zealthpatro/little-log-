#!/usr/bin/env node
/* The best thing Cubby ever did for a pregnant woman was created in silence and then locked in.
 *
 * savePregnancy takes ONE date and writes 7 to 13 named, sourced antenatal appointments out of
 * pregnancy-data.js, off fifteen verified national schedules. That is the strongest cold-start
 * proof anywhere in the product: it is Cubby knowing something real about a woman who has typed a
 * due date and nothing else. The baby side has said so for months, in vaxProofLine, on the last
 * screen of setup. The pregnancy side said nothing at all. There was no pregProofLine in the file.
 *
 * And the plan could not leave the app. addApptToCalendar wrote ONE appointment, from a button
 * three taps inside openVisitPrep, under `UID: uid()+'@little-cubby.com'` — a fresh random uid on
 * every tap. So a mother who exported her 20-week scan twice had two of them in her calendar, both
 * alarming, with no way to tell Cubby to take either back. There was no whole-plan export at all:
 * thirteen visits meant thirteen trips into thirteen sheets.
 *
 * What this gate holds to its promises:
 *
 *   THE LINE IS TRUE. It counts the appointments the plan actually holds, names the schedule it
 *   came from, and is silent where there is nothing to claim: the planning stage, a custom plan
 *   with no visits in it yet, and after the baby is born.
 *
 *   IT NEVER OFFERS A DATE SHE HAS ALREADY LIVED. A mother who sets up at week 30 has her booking
 *   visit behind her. Putting it in her calendar with an alarm on it is the one thing this must not
 *   do, and it is the exact bug the vaccine row shipped with and had to be fixed for.
 *
 *   THE ALARM IS NOT MIDNIGHT. On an all-day event -P1D and -P2D both resolve to 00:00. The
 *   doctor-appointment export already learned this the hard way. And an alarm whose moment has
 *   already gone is not written at all.
 *
 *   A SECOND EXPORT UPDATES, IT DOES NOT DUPLICATE. Stable UID, rising SEQUENCE, and a visit she
 *   has since ticked off goes out CANCELLED rather than being quietly dropped from the file and
 *   left ringing in her calendar for something that is not happening.
 *
 *   THERE IS A WAY BACK OUT AFTER A LOSS. However this pregnancy ends the calendar carries on.
 *   Thirteen entries named "20-week (anomaly) scan", each with its own alert, are a far harder
 *   thing to be left holding than a piece of fruit, and the pregnancy Home that offered them is
 *   gone at exactly the moment they matter.
 *
 *   PORT=9743 node tools/serve.js &
 *   node tools/preg_proof_line_check.js http://localhost:9743
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:9743';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, WEEK = 7 * DAY;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

// Mid-morning, so "yesterday", "today" and "tomorrow" are unambiguous either side of a boundary
// written in whole days, and an all-day alarm 39 hours back lands on a day this gate can name.
const CLOCK = (() => { const d = new Date(); d.setHours(10, 30, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

/* pregWeek() with a due date is `40 - round((due-now)/WEEK)`, and pregApptDate is
   `due - (40-k)*WEEK`. Put the due date exactly (40-W) weeks out and the two line up on one clean
   rule this whole gate is written from: the appointment at plan-week k falls (k-W) weeks from now,
   so k > W is future and k <= W is behind her. */
const dueForWeek = (W) => now + (40 - W) * WEEK;

const preg = (over) => Object.assign({
  id: 'p1', ownerUid: 'local', stage: 'expecting',
  dueDate: dueForWeek(12), lmp: null, cycleLen: 28, periods: [], country: 'uk',
  precon: [], careTeam: [], appts: [], symptoms: [], weights: [], bp: [], kicks: [], contractions: [],
  birthPlan: '', bag: [], moments: [], conditions: {}, glucose: [], urine: [], supplements: [],
  supplementLog: [], nausea: [], moodLog: [], guesses: [], gentle: { afterLoss: false, noNumbers: false },
  glucoseUnit: 'mmol', bornBabyId: null, createdAt: now - 12 * WEEK,
}, over || {});
const seed = (p, over) => Object.assign({
  babies: [], activeBabyId: null, events: [], illnesses: [], notes: [], milestones: [], meds: [],
  photos: [], vaccines: {}, timers: {},
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, welcome: 1 } },
  pregnancy: p,
}, over || {});

(async () => {
  /* A gate on a shared port has already graded somebody else's checkout in this repo, and it
     happened twice while this change was being written: two other worktrees had taken the first two
     ports tried. Prove the tree before trusting a single number below it. */
  let src = '';
  try { src = await (await fetch(BASE + '/app/index.html')).text(); } catch (e) { src = ''; }
  ok('the tree served at ' + BASE + ' is the one carrying this change',
    /function pregProofLine/.test(src) && /function exportAntenatalSchedule/.test(src) && /function pregApptCalendarRow/.test(src),
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
  /* The appointments are not typed by anyone: savePregnancy maps PREG.antenatal[country].items into
     state.pregnancy.appts the instant she gives a date, and that mapping is the thing under test, so
     the gate builds its plan the same way out of the same file rather than hand-writing a list that
     could drift from the shipped schedules. The id carries the pregnancy id, exactly as a real one
     does, so a second pregnancy cannot reuse the first one's calendar entries. */
  const loadP = async (p, who) => {
    await load(seed(p), who);
    if (p && p.stage !== 'planning' && !(p.appts && p.appts.length)) {
      await page.evaluate(() => {
        const cc = pregCountryKey(state.pregnancy.country);
        state.pregnancy.appts = ((window.PREG && PREG.antenatal[cc] && PREG.antenatal[cc].items) || [])
          .map((it, i) => ({ id: 'a-' + state.pregnancy.id + '-' + i, week: it.week, title: it.title, note: it.note, done: false, at: null }));
        render();
      });
      await sleep(300);
    }
  };
  /* The record deliberately outlives a reload and outlives state.pregnancy, which is the entire
     point of it, so it also outlives a section. Every section starts from a woman who has never
     used this feature unless it says otherwise. */
  const wipe = () => page.evaluate(() => Object.keys(localStorage).forEach((k) => {
    if (/^cubby-preg-appts:|^cubby-preg-weeks:|^cubby-preg-week-seen:/.test(k)) localStorage.removeItem(k);
  }));
  /* Read the real sheet out of the real DOM, never document.body.textContent: this file's own
     inline script is inside body text and would happily match every string this gate looks for. */
  const sheetText = () => page.evaluate(() => {
    const s = document.getElementById('sheet');
    return (s && s.classList.contains('show')) ? s.textContent.replace(/\s+/g, ' ').trim() : null;
  });
  const sheetButtons = () => page.evaluate(() => {
    const s = document.getElementById('sheet');
    if (!s || !s.classList.contains('show')) return [];
    return [].map.call(s.querySelectorAll('button,.add-row'), (b) => ({
      t: b.textContent.replace(/\s+/g, ' ').trim(), on: b.getAttribute('onclick') || '' }));
  });
  // Looked up by its handler and not by its wording, so renaming the copy cannot quietly delete the
  // coverage this row is here to provide.
  const rowFor = (fn) => page.evaluate((f) => {
    const el = [].filter.call(document.querySelectorAll('.add-row,.alert-pill,.prof-card,button'),
      (r) => new RegExp(f).test(r.getAttribute('onclick') || r.innerHTML || ''))[0];
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
  }, fn);
  // The .ics exactly as it was written: the blob handed to saveFile, read back byte for byte.
  const savedIcs = () => page.evaluate(() => window.__saved ? fetch(window.__saved.href).then((r) => r.text()) : null);
  const rec = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('cubby-preg-appts:' + localStorage.getItem('cubby-quick-uid')) || 'null'); } catch (e) { return null; } });
  const uids = (s) => (String(s).match(/^UID:.*$/gm) || []).map((l) => l.trim());
  const count = (s, re) => (String(s).match(re) || []).length;
  const section = async (name, fn) => { console.log('\n' + name); try { await fn(); } catch (e) { ok(name + ' ran to the end', false, String((e && e.message) || e)); } };

  await section('1. the plan Cubby built in silence is finally said out loud', async () => {
    await wipe();
    await loadP(preg({ dueDate: dueForWeek(12), country: 'uk' }));
    const r = await page.evaluate(() => {
      const p = state.pregnancy, wks = (p.appts || []).map((a) => a.week).sort((a, b) => a - b);
      return { line: pregProofLine(), n: (p.appts || []).length, first: wks[0], last: wks[wks.length - 1] };
    });
    ok('the NHS plan really does hold 13 appointments', r.n === 13, r);
    ok('there is a line at all', !!r.line, r);
    ok('it counts the appointments the plan actually holds',
      new RegExp('\\b' + r.n + ' appointments\\b').test(r.line || ''), r);
    ok('it names the span, first week to last', new RegExp('week ' + r.first + ' to week ' + r.last).test(r.line || ''), r);
    ok('and where the plan came from', /United Kingdom \(NHS\)/.test(r.line || ''), r);
    ok('worded as a sentence, not a label dropped into one',
      /based on the United Kingdom \(NHS\) schedule\.$/.test(r.line || ''), r);
    ok('no em-dash, house voice', !/—/.test(r.line || ''), r);

    // The line has to reach a screen, not just return from a function nobody calls.
    await page.evaluate(() => { closeSheet(); openOnboardInvite(); });
    await sleep(250);
    const t = await sheetText();
    ok('the last screen of setup shows it', /13 appointments/.test(t || ''), t);
    ok('and offers the plan itself', /See your appointment plan/.test(t || ''), t);
    const bs = await sheetButtons();
    const exp = bs.filter((b) => /exportAntenatalSchedule/.test(b.on));
    ok('with a real whole-plan export beside it', exp.length === 1, bs.map((b) => b.on));
    /* MEASURED, not counted. "Put the appointments still ahead in my calendar" rendered at 70px in
       this centre-aligned ghost button against 47px for every neighbour, wrapping to a lone centred
       orphan reading "calendar". A character budget would have been a guess; the height is the bug. */
    const btnH = await page.evaluate(() => {
      const b = [].filter.call(document.querySelectorAll('#sheet button'), (x) => /exportAntenatalSchedule/.test(x.getAttribute('onclick') || ''))[0];
      const n = [].filter.call(document.querySelectorAll('#sheet button.btn-ghost'), (x) => !/exportAntenatalSchedule/.test(x.getAttribute('onclick') || ''))[0];
      return { mine: b ? b.offsetHeight : 0, neighbour: n ? n.offsetHeight : 0, txt: b ? b.textContent.trim() : '' };
    });
    ok('and it fits on one line, like every other ghost button on the sheet',
      btnH.neighbour > 0 && btnH.mine > 0 && btnH.mine <= btnH.neighbour + 4, btnH);
    /* No number on the export button, and it is the vaccine row's lesson rather than a matter of
       taste: the line above counts the whole plan and the button offers only what is still ahead,
       and two numbers that disagree three rows apart read as a bug. */
    ok('and the button prints no count of its own', exp.length === 1 && !/\d/.test(exp[0].t), exp);
  });

  await section('2. it stays quiet where there is nothing to claim', async () => {
    await wipe();
    await loadP(preg({ stage: 'planning', dueDate: null, appts: [] }));
    let r = await page.evaluate(() => ({ line: pregProofLine(), ahead: pregApptsAhead().length }));
    ok('trying to conceive has no antenatal plan, so no line', r.line === '', r);
    ok('and nothing to put in a calendar', r.ahead === 0, r);
    await page.evaluate(() => { closeSheet(); openOnboardInvite(); });
    await sleep(250);
    let bs = await sheetButtons();
    /* An absence assertion needs a presence assertion under it or it free-passes on an empty sheet:
       sheetButtons() returns [] when nothing is showing, so "offers no export" also passed when
       openOnboardInvite opened nothing at all. */
    ok('the planning sheet really did open', bs.length > 0 && /Invite someone/.test((await sheetText()) || ''), bs.map((b) => b.t));
    ok('the planning sheet offers no export', bs.filter((b) => /exportAntenatalSchedule/.test(b.on)).length === 0, bs.map((b) => b.on));

    await loadP(preg({ country: 'custom', appts: [] }));
    r = await page.evaluate(() => ({ line: pregProofLine(), n: (state.pregnancy.appts || []).length }));
    ok('a custom plan with nothing in it yet claims nothing', r.line === '' && r.n === 0, r);

    /* A custom plan with appointments IN it is the reachable case, and it read
       "…based on Your own plan." Title Case mid-sentence, and the sentence saying itself back to
       itself. pregApptIcsText already got this right by testing sk!=='custom'; the line did not. */
    await loadP(preg({ country: 'custom', dueDate: dueForWeek(12),
      appts: [{ id: 'c1', week: 16, title: 'Antenatal check', note: '', done: false, at: null },
        { id: 'c2', week: 20, title: 'Scan', note: '', done: false, at: null }] }));
    r = await page.evaluate(() => ({ line: pregProofLine() }));
    ok('a custom plan with visits in it does get a line', /2 appointments/.test(r.line || ''), r);
    ok('and it does not say her plan is based on her own plan', !/own plan/i.test(r.line || ''), r);
    ok('it names no source at all, because a plan she typed herself has none',
      !/based on/i.test(r.line || ''), r);
    ok('nor drops a title-cased label into the middle of a sentence',
      !/, based on [A-Z]/.test(r.line || ''), r);

    /* One appointment read "from week 20 to week 20", which reads as a bug and not as a plan. */
    await loadP(preg({ country: 'custom', dueDate: dueForWeek(12),
      appts: [{ id: 'c1', week: 20, title: 'Scan', note: '', done: false, at: null }] }));
    r = await page.evaluate(() => ({ line: pregProofLine() }));
    ok('a single visit is named once, not as a span from itself to itself',
      /1 appointment, at week 20\./.test(r.line || '') && !/week 20 to week 20/.test(r.line || ''), r);

    /* "waiting" is a claim about the future. At week 30 with seven visits ticked off it still said
       so, and at week 41 with nothing ahead it said so beside an export button that had correctly
       taken itself away: the sheet announced a plan that was waiting and offered no way to use it. */
    await loadP(preg({ dueDate: dueForWeek(30) }));
    r = await page.evaluate(() => {
      pregApptsAhead().slice(0, 3).forEach((x) => { x.a.done = true; });
      return { line: pregProofLine(), ahead: pregApptsAhead().length };
    });
    ok('at week 30 with visits ticked off, some are still ahead', r.ahead === 3, r);
    ok('and the whole plan is still counted, because it really is sitting in Care',
      /13 appointments/.test(r.line || ''), r);
    await loadP(preg({ dueDate: dueForWeek(41) }));
    r = await page.evaluate(() => ({ line: pregProofLine(), ahead: pregApptsAhead().length }));
    ok('at week 41 nothing at all is still ahead', r.ahead === 0, r);
    ok('so the line stops calling the plan one that is waiting', !/waiting/i.test(r.line || ''), r);
    ok('but still says where it is, because it is still there', /in Care: 13 appointments/.test(r.line || ''), r);

    /* "based on United Kingdom (NHS)." is a label, not a sentence, and the generic branch put a
       middot inside prose. */
    await loadP(preg({ dueDate: dueForWeek(12), country: 'ng' }));
    r = await page.evaluate(() => ({ line: pregProofLine(), key: pregCountryKey(state.pregnancy.country) }));
    ok('an unlisted country falls to the WHO-aligned plan', r.key === 'generic', r);
    ok('and its line reads as a sentence, with no middot in the middle of it',
      !/·/.test(r.line || '') && /based on the WHO-aligned schedule for /.test(r.line || ''), r);

    /* After the birth the plan is history, and pregApptsAhead is what stops "book your 41-week
       check" being offered to a woman holding her baby. */
    await loadP(preg({ dueDate: dueForWeek(12), bornBabyId: 'b1' }));
    r = await page.evaluate(() => ({ line: pregProofLine(), ahead: pregApptsAhead().length }));
    ok('once the baby is here the line stops', r.line === '', r);
    ok('and so does the offer', r.ahead === 0, r);
  });

  await section('3. it never offers a date she has already lived', async () => {
    await wipe();
    // Week 30 on the NHS plan: booking, dating scan, 16-week check, the anomaly scan, whooping
    // cough, the 25-week check and the 28-week bloods are all behind her.
    await loadP(preg({ dueDate: dueForWeek(30) }));
    const r = await page.evaluate(() => {
      const p = state.pregnancy;
      const future = (p.appts || []).filter((a) => a.week > 30).length;
      const past = (p.appts || []).filter((a) => a.week <= 30).length;
      return { future: future, past: past, ahead: pregApptsAhead().map((x) => x.a.week) };
    });
    ok('the plan genuinely has visits behind her', r.past === 7, r);
    ok('and visits still to come', r.future === 6, r);
    ok('the offer holds exactly the ones still to come', r.ahead.length === r.future, r);
    ok('and not one of them is in the past', r.ahead.length > 0 && r.ahead.every((w) => w > 30), r);

    // Ticked off is the other kind of past: she has been, whatever the calendar says.
    const r2 = await page.evaluate(() => {
      const p = state.pregnancy, next = pregApptsAhead()[0].a;
      next.done = true;
      return { gone: next.week, ahead: pregApptsAhead().map((x) => x.a.week), n: pregApptsAhead().length };
    });
    ok('a visit she has ticked off drops out of the offer', r2.ahead.indexOf(r2.gone) === -1 && r2.n === 5, r2);
  });

  await section('4. the file itself, one entry per visit', async () => {
    await wipe();
    await loadP(preg({ dueDate: dueForWeek(12) }));
    await page.evaluate(() => exportAntenatalSchedule());
    await sleep(120);
    const ics = await savedIcs();
    const want = await page.evaluate(() => pregApptsAhead().length);
    ok('eleven visits are still ahead at week 12', want === 11, want);
    ok('and the file carries exactly that many entries', count(ics, /BEGIN:VEVENT/g) === want, count(ics, /BEGIN:VEVENT/g));
    ok('every one of them all-day', count(ics, /DTSTART;VALUE=DATE:/g) === want, count(ics, /DTSTART;VALUE=DATE:/g));
    ok('each with its own stable uid', uids(ics).length === want && new Set(uids(ics)).size === want, uids(ics));
    ok('the uid names the appointment, not its position in a shrinking list',
      uids(ics).every((u) => /^UID:cubby-appt-.+@little-cubby\.com$/.test(u)) && uids(ics).length === want, uids(ics).slice(0, 2));
    ok('a sequence, so a re-import is allowed to win', count(ics, /^SEQUENCE:1$/gm) === want, ics && ics.match(/^SEQUENCE:.*$/gm));
    ok('it says the dates are worked out and must be confirmed',
      count(ics, /confirm the exact date with your clinic/g) === want, count(ics, /confirm the exact date with your clinic/g));
    /* One verb for one act, and it is "confirm". The event said "book the exact date" while the
       alarm on the same event said "Confirm the date": two instructions for one thing, eleven times
       over, and on most national plans the midwife is the one who books. */
    ok('and it never hands her a booking she does not have to make', !/\bbook\b/i.test(ics), (ics.match(/.{0,30}book.{0,30}/i) || [])[0]);

    /* x12. The missing DTEND is one of the three bugs this change set out to fix in the single-visit
       export, and counting DTSTART alone could not see it: an all-day VEVENT with no DTEND is read
       as zero-length by some calendars and silently widened by others. */
    ok('every entry carries an end date, not just a start',
      count(ics, /DTEND;VALUE=DATE:/g) === want, count(ics, /DTEND;VALUE=DATE:/g));
    ok('and the end is the morning after the start, so one visit is one day',
      (ics.match(/DTSTART;VALUE=DATE:(\d{8})\r?\nDTEND;VALUE=DATE:(\d{8})/g) || []).length === want
      && (ics.match(/DTSTART;VALUE=DATE:(\d{8})\r?\nDTEND;VALUE=DATE:(\d{8})/g) || []).every((m) => {
        const d = m.match(/(\d{8})[\s\S]*?(\d{8})/), s = d[1], e = d[2];
        const dt = new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8) + 1);
        const p = (n) => String(n).padStart(2, '0');
        return e === dt.getFullYear() + p(dt.getMonth() + 1) + p(dt.getDate());
      }), (ics.match(/DTSTART;VALUE=DATE:\d{8}\r?\nDTEND;VALUE=DATE:\d{8}/g) || []).slice(0, 2));
    ok('and carries the way back into Cubby', count(ics, /little-cubby\.com\/app\/\?tab=care/g) === want, count(ics, /tab=care/g));

    /* THE MIDNIGHT TRAP. On an all-day event DTSTART is 00:00, so -P1D and -P2D are both alarms at
       the top of a night. -PT39H is 09:00 two days before: a morning, with a working day left in it
       to ring the clinic. */
    ok('the alert is not midnight', !/TRIGGER:-P\d+D/.test(ics) && !/TRIGGER:PT0S/.test(ics), ics && ics.match(/TRIGGER:.*/g));
    ok('it is the morning two days before', count(ics, /TRIGGER:-PT39H/g) === want, ics && ics.match(/TRIGGER:.*/g));
    /* Compared against TODAY WHERE SHE IS. _icsDay writes a local YYYYMMDD; comparing it to
       toISOString().slice(0,10) compares local against UTC, and past about UTC+10:30 the 10:30 pin
       slips a day and this assertion quietly loosens. Not live on this machine, which is exactly
       why it had to be fixed before it travelled. */
    const today = (() => { const d = new Date(now), p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()); })();
    ok('nothing in the file is dated before today',
      (ics.match(/DTSTART;VALUE=DATE:(\d{8})/g) || []).length === want
      && (ics.match(/DTSTART;VALUE=DATE:(\d{8})/g) || []).every((d) => d.slice(-8) > today),
      ics && ics.match(/DTSTART;VALUE=DATE:\d{8}/g));

    ok('and she is told a file was saved, not that anything was added', /Saved\. Open it/.test((await page.evaluate(() => window.__saved.msg)) || ''),
      await page.evaluate(() => window.__saved.msg));
  });

  await section('5. an alarm that has already gone is not written', async () => {
    await wipe();
    /* Due date pulled back six days, so the week-13 appointment falls TOMORROW and its
       09:00-two-days-before alert was yesterday morning. That is the whole point of the section and
       it is set by pregApptDate, which is untouched here.
       She is at 12+6. This line used to assert week 13 and its comment said so out loud ("pregWeek()
       still rounds to 13"), which is the rounding bug written down as an expectation: Math.round
       named days 4, 5 and 6 of every week as the next week. pregWeek() now floors completed weeks,
       so 12+6 answers 12, the way a gestation is actually spoken. */
    await load(seed(preg({
      dueDate: now + 28 * WEEK - 6 * DAY,
      appts: [{ id: 'a-soon', week: 13, title: 'Antenatal check', note: '', done: false, at: null },
        { id: 'a-far', week: 20, title: '20-week (anomaly) scan', note: '', done: false, at: null }],
    })));
    const w = await page.evaluate(() => pregWeek());
    ok('she is at 12+6, which is week 12', w === 12, w);
    const t = await page.evaluate(() => { const a = pregApptsAhead(); return a.map((x) => Math.round((x.t - Date.now()) / 3600000)); });
    ok('one visit is tomorrow and one is weeks out', t.length === 2 && t[0] > 12 && t[0] < 36 && t[1] > 24 * 40, t);
    await page.evaluate(() => exportAntenatalSchedule());
    await sleep(120);
    const ics = await savedIcs();
    ok('both visits are in the file', count(ics, /BEGIN:VEVENT/g) === 2, count(ics, /BEGIN:VEVENT/g));
    ok('but only the one whose alert is still to come carries an alarm', count(ics, /BEGIN:VALARM/g) === 1, ics && ics.match(/TRIGGER:.*/g));
    ok('and it is the far one', /20-week[\s\S]*BEGIN:VALARM/.test(ics) && !/Antenatal check[\s\S]{0,200}BEGIN:VALARM/.test(ics), ics);
  });

  await section('6. a second export updates, it does not duplicate', async () => {
    await wipe();
    await loadP(preg({ dueDate: dueForWeek(12) }));
    await page.evaluate(() => exportAntenatalSchedule());
    await sleep(120);
    const first = await savedIcs();
    const rec1 = await rec();
    await page.evaluate(() => exportAntenatalSchedule());
    await sleep(120);
    const second = await savedIcs();
    const rec2 = await rec();
    ok('the same eleven uids come back, not eleven new ones',
      uids(first).length === 11 && uids(first).join('|') === uids(second).join('|'), { a: uids(first).length, b: uids(second).length });
    ok('the sequence goes up, so the calendar may take the newer file', rec1.seq === 1 && rec2.seq === 2, [rec1.seq, rec2.seq]);
    ok('and it survives a reload, because it is hers and not the household\'s', (await (async () => { await loadP(preg({ dueDate: dueForWeek(12) })); return rec(); })()).seq === 2, await rec());

    /* The visit she has been to is already in her calendar with an alarm on it. Dropping it from
       the file leaves it there ringing for something that is not happening. */
    const gone = await page.evaluate(() => { const a = pregApptsAhead()[0].a; a.done = true; return a.id; });
    await page.evaluate(() => exportAntenatalSchedule());
    await sleep(120);
    const third = await savedIcs();
    ok('a visit she has since been to goes out cancelled', count(third, /STATUS:CANCELLED/g) === 1, third && third.match(/STATUS:CANCELLED/g));
    ok('under the very uid it was written with', new RegExp('UID:cubby-appt-' + gone + '@').test(third), gone);
    ok('and the ten still ahead are re-published beside it', count(third, /BEGIN:VEVENT/g) === 11 && count(third, /TRIGGER:-PT39H/g) === 10,
      { events: count(third, /BEGIN:VEVENT/g), alarms: count(third, /TRIGGER:-PT39H/g) });
  });

  await section('7. the single-visit button no longer leaves duplicates behind', async () => {
    await wipe();
    await loadP(preg({ dueDate: dueForWeek(12) }));
    const id = await page.evaluate(() => pregApptsAhead()[0].a.id);
    await page.evaluate((i) => addApptToCalendar(i), id);
    await sleep(120);
    const a = uids(await savedIcs());
    await page.evaluate((i) => addApptToCalendar(i), id);
    await sleep(120);
    const b = uids(await savedIcs());
    ok('one visit, one entry', a.length === 1 && b.length === 1, [a, b]);
    ok('tapping it twice writes the SAME uid, so her calendar updates rather than doubles', a[0] === b[0], [a[0], b[0]]);
    await page.evaluate(() => exportAntenatalSchedule());
    await sleep(120);
    const whole = uids(await savedIcs());
    ok('and the whole-plan file owns that same entry rather than laying a second one beside it',
      whole.length === 11 && whole.indexOf(a[0]) !== -1, { one: a[0], whole: whole.length });
  });

  await section('8. the door is on the tab, and her partner gets one too', async () => {
    await wipe();
    await loadP(preg({ dueDate: dueForWeek(12) }));
    await page.evaluate(() => { closeSheet(); pregGo('care'); });
    await sleep(300);
    const row = await rowFor('openApptsCalendar');
    ok('the Care tab offers it', !!row && /calendar/i.test(row), row);
    ok('above the appointment list, not under it', await page.evaluate(() => {
      const r = document.querySelector('.add-row.cal-row'), first = document.querySelector('.appt-row');
      return !!(r && first && (r.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING));
    }), row);

    /* Her partner is the one driving her there. He may take a copy, and taking it must not write a
       single byte into her journey: the record is a per-person localStorage key precisely because
       only the owner may write /pregnancy/{owner}. */
    await loadP(preg({ ownerUid: 'uidMaya', dueDate: dueForWeek(12) }), 'uidPapa');
    await page.evaluate(() => { closeSheet(); pregGo('care'); });
    await sleep(300);
    const hisRow = await rowFor('openApptsCalendar');
    ok('he is offered it too, read-only tab and all', !!hisRow, hisRow);
    const r = await page.evaluate(() => {
      const before = JSON.stringify(state.pregnancy);
      exportAntenatalSchedule();
      return { same: before === JSON.stringify(state.pregnancy),
        his: !!localStorage.getItem('cubby-preg-appts:uidPapa'),
        hers: !!localStorage.getItem('cubby-preg-appts:uidMaya') };
    });
    await sleep(120);
    ok('his export writes nothing at all into her pregnancy', r.same === true, r);
    ok('it is filed under him', r.his === true, r);
    ok('and not under her', r.hers === false, r);
  });

  await section('9. after a loss, there is still a way to take them off', async () => {
    await wipe();
    await loadP(preg({ dueDate: dueForWeek(12) }));
    await page.evaluate(() => exportAntenatalSchedule());
    await sleep(120);
    const before = await rec();
    ok('eleven dates are in her calendar', (before.keys || []).length === 11, before && before.keys && before.keys.length);

    // The pregnancy ends. state.pregnancy is gone and the holding screen replaces the whole app.
    await load(seed(null, { lossHolding: { local: { at: now } } }));
    const r = await page.evaluate(() => ({
      stranded: pregApptsStranded(), arriving: pregApptsStillArriving(), preg: state.pregnancy,
      holding: !!document.querySelector('.ob-card'),
    }));
    ok('the holding screen is what she is looking at', r.holding === true && r.preg === null, r);
    ok('and the dates are still arriving with nothing left to stop them', r.arriving === true && r.stranded === true, r);
    /* p15 merged appointments into the week-markers door; p8 shipped first with a SEPARATE
       openApptTakeBack beside it, and that is what is live. What the woman on this screen needs is
       unchanged either way: a way to stop the appointments arriving, named for appointments. Assert
       that, not which of the two designs provides it. Both doors are checked so a merge that drops
       one goes red here rather than leaving her dates arriving with nothing to stop them. */
    const apptDoor = await rowFor('openApptTakeBack');
    const weekDoor = await rowFor('openWeeksTakeBack');
    ok('so the holding screen carries the door', !!(apptDoor || weekDoor) && /calendar/i.test(apptDoor || weekDoor), { apptDoor, weekDoor });
    ok('named for what is actually still coming, not for week markers she never added',
      !!apptDoor && /appointment/i.test(apptDoor), { apptDoor, weekDoor });

    await page.evaluate(() => openWeeksTakeBack());
    await sleep(250);
    const bs = await sheetButtons();
    const off = bs.filter((b) => /cancelPregAppts/.test(b.on));
    ok('the sheet offers exactly one take-back', off.length === 1, bs.map((b) => b.on));
    ok('and no week-marker button, because she never added any', bs.filter((b) => /cancelPregWeeks/.test(b.on)).length === 0, bs.map((b) => b.on));

    await page.evaluate(() => cancelPregAppts());
    await sleep(150);
    const ics = await savedIcs();
    ok('the take-back publishes a real cancel', /METHOD:CANCEL/.test(ics) && !/METHOD:PUBLISH/.test(ics), ics && ics.slice(0, 120));
    ok('for every one of the eleven', count(ics, /STATUS:CANCELLED/g) === 11, count(ics, /STATUS:CANCELLED/g));
    ok('under the uids they were written with', uids(ics).join('|') === (before.keys || []).map((k) => 'UID:cubby-appt-' + k.id + '@little-cubby.com').join('|'), uids(ics).slice(0, 2));
    ok('at a higher sequence than the file that created them', count(ics, /^SEQUENCE:2$/gm) === 11, ics && ics.match(/^SEQUENCE:.*$/gm));
    ok('it does not name her lost pregnancy back at her', !/anomaly|Booking|whooping/i.test(ics), ics && ics.match(/^SUMMARY:.*$/m));
    ok('and the record is forgotten, so the door takes itself down', (await rec()) === null, await rec());
    ok('with the door gone from the screen', await page.evaluate(() => { closeSheet(); render(); return !pregApptsStranded(); }));

    // Honest about the one thing Cubby cannot do: reach into her calendar itself.
    ok('and she is told plainly that her Calendar app has the last word',
      /delete them in your Calendar app/i.test((await page.evaluate(() => window.__saved.msg)) || ''),
      await page.evaluate(() => window.__saved.msg));
  });

  await section('10. a record from a pregnancy that is over does not follow the next one in', async () => {
    await wipe();
    await loadP(preg({ id: 'p1', dueDate: dueForWeek(12) }));
    await page.evaluate(() => exportAntenatalSchedule());
    await sleep(120);
    const old = await rec();
    ok('the record knows which pregnancy wrote it', old.pid === 'p1', old && old.pid);

    // A new pregnancy, months later. Different id, different appointment ids.
    await loadP(preg({ id: 'p2', dueDate: dueForWeek(12), createdAt: now }));
    const r = await page.evaluate(() => ({ mine: pregApptIcsMine(), stranded: pregApptsStranded() }));
    ok('the old record is not claimed by the new pregnancy', r.mine === null, r);
    ok('so she is not told her appointments are already in her calendar', r.stranded === true, r);
    await page.evaluate(() => { closeSheet(); openApptsCalendar(); });
    await sleep(250);
    const t = await sheetText();
    ok('and the sheet offers to add them, rather than to add them again', /Add 11 appointments/.test(t || ''), t);

    await page.evaluate(() => exportAntenatalSchedule(1));
    await sleep(150);
    const ics = await savedIcs();
    ok('exporting the new plan cancels the old pregnancy\'s dates in the same breath',
      count(ics, /STATUS:CANCELLED/g) === (old.keys || []).length, count(ics, /STATUS:CANCELLED/g));
    ok('and publishes the new eleven', count(ics, /BEGIN:VEVENT/g) === 11 + (old.keys || []).length, count(ics, /BEGIN:VEVENT/g));
    ok('the record now belongs to this pregnancy', (await rec()).pid === 'p2', await rec());
  });

  await section('11. and after the birth, on the only lane the baby side has', async () => {
    /* A loss is not the only way this ends. welcomeBaby leaves the pregnancy in place, empties
       everything still ahead of her and hands the whole screen to the baby, so the Care tab that
       offered the dates is gone while "38-week antenatal check" is still in her calendar with an
       alert on it. This alert lane is the only surface on the baby side that can carry the way out.
       Written after a mutation run: taking the appointment half back out of pregIcsStranded left
       every other assertion in this file green, which is exactly the hole a gate is for. */
    await wipe();
    await loadP(preg({ dueDate: dueForWeek(38) }));
    await page.evaluate(() => exportAntenatalSchedule());
    await sleep(120);
    const n = (await rec()).keys.length;
    ok('she put her last visits in her calendar before the birth', n > 0, n);

    await page.evaluate(() => {
      state.babies = [{ id: 'b1', name: 'Robin', birth: Date.now(), sex: 'F', routines: [], doctors: [], allergies: [] }];
      state.activeBabyId = 'b1'; state.pregnancy.bornBabyId = 'b1'; render();
    });
    await sleep(400);
    const r = await page.evaluate(() => ({
      ahead: pregApptsAhead().length, stranded: pregApptsStranded(),
      weeks: pregWeeksStranded(), alert: pregWeeksLeftAlert().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      onScreen: !!document.querySelector('.alert-pill button[onclick*="openWeeksTakeBack"]'),
    }));
    ok('nothing is left to offer her', r.ahead === 0, r);
    ok('but the dates she already wrote are still coming', r.stranded === true, r);
    ok('and she never added week markers, so that half is silent', r.weeks === false, r);
    ok('the baby home carries the way out', r.onScreen === true, r);
    ok('and it names the appointment dates, not weeks she never added',
      /appointment/i.test(r.alert) && !/week/i.test(r.alert), r.alert);
  });

  await section('12. it never deletes a scan she has not been to', async () => {
    /* THE ONE A REVIEWER REPRODUCED. `gone` was "in the last file, and not in pregApptsAhead()", and
       pregApptsAhead() excludes on t > now(). That is the right guard for OFFERING (never put a date
       she has lived into her calendar) and the wrong one for CANCELLING: it conflates ticked-done,
       deleted, and merely past Cubby's own estimate. The NHS books the anomaly scan anywhere in
       weeks 18 to 21 and this file's own DESCRIPTION tells her to confirm the date with her clinic,
       so on the morning Cubby guessed, with the scan still ahead of her and Home still calling it
       her next appointment, a second export deleted it out of her calendar. */
    await wipe();
    await loadP(preg({ id: 'p1', dueDate: dueForWeek(12) }));
    await page.evaluate(() => exportAntenatalSchedule());
    await sleep(120);
    ok('eleven dates go into her calendar at week 12', (await rec()).keys.length === 11, (await rec()).keys.length);

    // Nine weeks pass. Same pregnancy, same appointment ids, nothing ticked off by anyone.
    await loadP(preg({ id: 'p1', dueDate: dueForWeek(21) }));
    const state21 = await page.evaluate(() => {
      const a20 = (state.pregnancy.appts || []).filter((x) => x.week === 20)[0];
      const nx = pregNextAppt();
      return { wk: pregWeek(), done: a20 ? a20.done : null, id: a20 ? a20.id : null,
        ahead: pregApptsAhead().map((x) => x.a.week), next: nx ? { wk: nx.week, done: nx.done } : null };
    });
    ok('she is at week 21 now', state21.wk === 21, state21);
    ok('and has ticked nothing off, because she has not been yet', state21.done === false, state21);
    ok('the app itself still calls the 20-week scan an appointment of hers',
      !!state21.next && state21.next.done === false, state21);
    ok('while the offer has already dropped it, which is correct for offering',
      state21.ahead.indexOf(20) === -1, state21);

    await page.evaluate(() => exportAntenatalSchedule());
    await sleep(120);
    const ics = await savedIcs();
    ok('and yet not one thing is cancelled, because she dealt with none of them',
      count(ics, /STATUS:CANCELLED/g) === 0, (ics.match(/UID:[^\r\n]*\r?\n[\s\S]{0,200}?STATUS:CANCELLED/g) || []).slice(0, 3));
    ok('her anomaly scan in particular is left exactly where it is',
      ics.indexOf('UID:cubby-appt-' + state21.id + '@') === -1, state21.id);
    ok('and it is still on the record, so the take-back can still reach it',
      ((await rec()).keys || []).some((k) => k.id === state21.id), (await rec()).keys);

    /* And the guard it replaces still has to do its job: a visit she really has dealt with must go
       out cancelled, or she is left with an alarm ringing for something that is not happening. */
    const ticked = await page.evaluate(() => { const a = (state.pregnancy.appts || []).filter((x) => x.week === 20)[0]; a.done = true; return a.id; });
    await page.evaluate(() => exportAntenatalSchedule());
    await sleep(120);
    const after = await savedIcs();
    ok('once she ticks it off, that one does go out cancelled',
      count(after, /STATUS:CANCELLED/g) === 1 && new RegExp('UID:cubby-appt-' + ticked + '@').test(after), count(after, /STATUS:CANCELLED/g));
    ok('and it is gone from the record with it', !((await rec()).keys || []).some((k) => k.id === ticked), (await rec()).keys);

    /* An appointment deleted off the plan altogether is the third case, and it must cancel too. */
    const killed = await page.evaluate(() => {
      const a = (state.pregnancy.appts || []).filter((x) => x.week === 25)[0];
      state.pregnancy.appts = (state.pregnancy.appts || []).filter((x) => x.week !== 25);
      return a.id;
    });
    await page.evaluate(() => exportAntenatalSchedule());
    await sleep(120);
    const gone = await savedIcs();
    ok('a visit she removed from the plan goes out cancelled too',
      new RegExp('UID:cubby-appt-' + killed + '@[\\s\\S]{0,200}?STATUS:CANCELLED').test(gone), killed);
  });

  await section('13. her partner reads all of this, and none of it is his', async () => {
    /* Three lines above this row the Care tab already forks: "so Maya's own plan may look a little
       different". The new sheet dropped the fork, so on his screen it read "Your appointments in
       your calendar" for appointments that are hers, and "worked out from your due date, so each one
       asks you to confirm the date with your clinic" to a man with no due date and no clinic. */
    await wipe();
    await loadP(preg({ ownerUid: 'uidMaya', dueDate: dueForWeek(12) }), 'uidPapa');
    await page.evaluate(() => {
      window.LL = window.LL || {};
      window.LL.pregIsOwner = () => false;
      window.LL.memberInfo = Object.assign({}, window.LL.memberInfo || {}, { uidMaya: { name: 'Maya Rao' } });
      closeSheet(); render();
    });
    await sleep(300);
    ok('he really is a non-owner on this journey', (await page.evaluate(() => pregJourneyIsOwner())) === false);
    await page.evaluate(() => openApptsCalendar());
    await sleep(250);
    const t = await sheetText();
    const h2 = await page.evaluate(() => { const h = document.querySelector('#sheet h2'); return h ? h.textContent.replace(/\s+/g, ' ').trim() : null; });
    ok('the sheet opened for him at all', !!t && /all-day entry/.test(t), t);
    ok('and it says whose appointments these are', /Maya's appointments in your calendar/.test(h2 || ''), h2);
    ok('it never tells him he has a due date', !/your due date/i.test(t || ''), t);
    ok('nor a clinic of his own to confirm with', !/with your clinic/i.test(t || ''), t);
    ok('and it does not promise him she will not be told, in words about her',
      !/nobody else is told/i.test(t || '') && /Maya is not told/.test(t || ''), t);
    // The info dot has to survive the forked heading, which is what the `aka` in teach-data is for.
    ok('the explainer dot still finds the sheet under its other name',
      await page.evaluate(() => !!document.querySelector('#sheet h2 .lg-i')), h2);

    // And her own screen keeps the second person it earned.
    await wipe();
    await loadP(preg({ dueDate: dueForWeek(12) }));
    await page.evaluate(() => { window.LL && (window.LL.pregIsOwner = () => true); closeSheet(); openApptsCalendar(); });
    await sleep(250);
    const hers = await sheetText();
    ok('she is still spoken to directly', /Your appointments in your calendar/.test(hers || '') && /your due date/.test(hers || ''), hers);
    /* Legible privacy, which is the whole wedge: Cubby shares nothing AND the entry carries the
       visit's name into whichever calendar she picks, often a work or family one. Both, or the
       promise is true of Cubby and untrue of the outcome. */
    ok('and told plainly what lands in the calendar she chooses',
      /Cubby shares nothing/.test(hers || '') && /pick a calendar only you see/.test(hers || ''), hers);
  });

  await section('14. the take-back names two things when there are two', async () => {
    await wipe();
    await loadP(preg({ dueDate: dueForWeek(12) }));

    // Appointments only, opened the way the loss screen opens it.
    await page.evaluate(() => exportAntenatalSchedule());
    await sleep(120);
    await page.evaluate(() => { closeSheet(); openWeeksTakeBack(); });
    await sleep(250);
    let t = await sheetText();
    let bs = await sheetButtons();
    ok('the appointments-only sheet is open', bs.filter((b) => /cancelPregAppts/.test(b.on)).length === 1, bs.map((b) => b.on));
    /* "Some people like to keep them" is true of a week marker, which can be a keepsake. Said about
       eleven alarms named "20-week (anomaly) scan" two days after a loss, it fails outright. */
    ok('and it does not suggest anyone keeps antenatal alerts on purpose',
      !/Some people like to keep them/.test(t || ''), t);
    ok('while still offering, never pushing', /take them off whenever you want to/i.test(t || ''), t);

    // Both sets live. Two buttons, two taps, and the sub has to say so.
    await page.evaluate(() => { closeSheet(); openWeeksCalendar(); });
    await sleep(200);
    await page.evaluate(() => exportPregWeeks());
    await sleep(200);
    const bothRec = await page.evaluate(() => ({ w: !!pregWeeksIcsRec(), a: !!pregApptIcsRec() }));
    ok('she has week markers and appointment dates in her calendar', bothRec.w && bothRec.a, bothRec);
    await page.evaluate(() => { closeSheet(); openWeeksTakeBack(); });
    await sleep(250);
    t = await sheetText();
    bs = await sheetButtons();
    ok('the sheet carries both take-backs',
      bs.filter((b) => /cancelPregWeeks/.test(b.on)).length === 1 && bs.filter((b) => /cancelPregAppts/.test(b.on)).length === 1, bs.map((b) => b.on));
    ok('and says plainly that they are two separate taps, not one',
      /two separate things/i.test(t || ''), t);
    ok('with no keepsake line over the appointment alerts', !/Some people like to keep them/.test(t || ''), t);

    /* Tapping the first of two near-identical red buttons used to close the sheet and say
       "Removed." while every appointment alert was still live. */
    await page.evaluate(() => cancelPregWeeks());
    await sleep(200);
    const msg = await page.evaluate(() => window.__saved && window.__saved.msg);
    ok('taking the weeks off says the weeks came off', /week markers are off/i.test(msg || ''), msg);
    ok('and does not let her believe the appointment alerts went with them',
      !/^Removed\./.test(msg || '') && /appointment dates are still coming/i.test(msg || ''), msg);
    ok('the appointment dates really are still there', await page.evaluate(() => pregApptsStillArriving()) === true);
    await page.evaluate(() => cancelPregAppts());
    await sleep(200);
    const msg2 = await page.evaluate(() => window.__saved && window.__saved.msg);
    ok('and the last one off gets the plain, honest line',
      /delete them in your Calendar app/i.test(msg2 || ''), msg2);

    /* Weeks alone must keep the sentence it earned: a week marker really can be a keepsake. */
    await wipe();
    await loadP(preg({ dueDate: dueForWeek(12) }));
    await page.evaluate(() => { closeSheet(); openWeeksCalendar(); });
    await sleep(200);
    await page.evaluate(() => exportPregWeeks());
    await sleep(200);
    await page.evaluate(() => { closeSheet(); openWeeksTakeBack(); });
    await sleep(250);
    t = await sheetText();
    ok('the weeks-only sheet still says some people like to keep them',
      /Some people like to keep them/.test(t || ''), t);
  });

  await section('15. every row it adds fits the row it lands in', async () => {
    /* x18 in the audit: pregStrandedLabel() had zero coverage, because its only caller is on the
       live-pregnancy week view and nothing here read it. Hardcoding it to the week-marker wording
       left the whole file green, and that function exists for exactly one reason: never to tell a
       woman her week markers are the problem when the problem is her appointment dates. */
    await wipe();
    await loadP(preg({ id: 'p1', dueDate: dueForWeek(12) }));
    await page.evaluate(() => exportAntenatalSchedule());
    await sleep(120);
    // A new pregnancy strands the old record: appointments stranded, weeks never used.
    await loadP(preg({ id: 'p2', dueDate: dueForWeek(12), createdAt: now }));
    let l = await page.evaluate(() => ({ w: pregWeeksStranded(), a: pregApptsStranded(), label: pregStrandedLabel() }));
    ok('appointment dates alone are stranded', l.a === true && l.w === false, l);
    ok('and the row names appointments, not week markers she never added',
      /appointment/i.test(l.label) && !/week marker/i.test(l.label), l.label);

    // Both stranded: the old pregnancy's weeks and its appointment dates.
    await loadP(preg({ id: 'p1', dueDate: dueForWeek(12) }));
    await page.evaluate(() => { closeSheet(); openWeeksCalendar(); });
    await sleep(200);
    await page.evaluate(() => exportPregWeeks());
    await sleep(200);
    await loadP(preg({ id: 'p3', dueDate: dueForWeek(12), createdAt: now }));
    l = await page.evaluate(() => ({ w: pregWeeksStranded(), a: pregApptsStranded(), label: pregStrandedLabel() }));
    ok('both halves are stranded now', l.w === true && l.a === true, l);
    ok('and the row does not claim only one of them', !/week markers off/i.test(l.label), l.label);

    // Weeks alone, which is the shipped wording and must not have moved.
    await wipe();
    await loadP(preg({ id: 'p1', dueDate: dueForWeek(12) }));
    await page.evaluate(() => { closeSheet(); openWeeksCalendar(); });
    await sleep(200);
    await page.evaluate(() => exportPregWeeks());
    await sleep(200);
    await loadP(preg({ id: 'p4', dueDate: dueForWeek(12), createdAt: now }));
    l = await page.evaluate(() => ({ w: pregWeeksStranded(), a: pregApptsStranded(), label: pregStrandedLabel() }));
    ok('week markers alone are stranded', l.w === true && l.a === false, l);
    ok('and the row still says week markers', /week markers/i.test(l.label), l.label);

    /* MEASURED in the real row. The Care tab add-row is ~350px wide and a one-line row is ~44px;
       "Put the appointments still ahead in my calendar" rendered at 72px. Both of these labels land
       in that row, so both are measured in it rather than counted in characters. */
    await wipe();
    await loadP(preg({ dueDate: dueForWeek(12) }));
    await page.evaluate(() => { closeSheet(); pregGo('care'); });
    await sleep(350);
    /* One line is measured off the row's own computed box rather than off a neighbour, because on
       the Care tab there is no second add-row to compare it with, and a hardcoded pixel count would
       drift the first time the padding changes. */
    const linesIn = (sel) => page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      // How many line boxes the text actually painted. Not a character budget and not a pixel
      // constant: the wrap itself, read back out of the layout.
      const rg = document.createRange(); rg.selectNodeContents(el);
      const tops = {}; [].forEach.call(rg.getClientRects(), (r) => { if (r.height > 1) tops[Math.round(r.top)] = 1; });
      return { lines: Object.keys(tops).length, h: el.offsetHeight, width: el.offsetWidth, txt: el.textContent.trim() };
    }, sel);
    const h = await linesIn('.add-row.cal-row');
    ok('the Care tab row is really on screen and really narrow', !!h && h.h > 0 && h.width > 0 && h.width < 400, h);
    ok('and its label paints one line, not two', !!h && h.lines === 1, h);

    // And the stranded row, in the same 350px, in its longest branch.
    await page.evaluate(() => exportAntenatalSchedule());
    await sleep(120);
    await page.evaluate(() => { closeSheet(); openWeeksCalendar(); });
    await sleep(200);
    await page.evaluate(() => exportPregWeeks());
    await sleep(200);
    await loadP(preg({ id: 'p9', dueDate: dueForWeek(12), createdAt: now }));
    await page.evaluate(() => { closeSheet(); pregGo('week'); });
    await sleep(350);
    const s = await page.evaluate(() => {
      const r = [].filter.call(document.querySelectorAll('.add-row'), (x) => /openWeeksTakeBack/.test(x.getAttribute('onclick') || ''))[0];
      if (!r) return null;
      const rg = document.createRange(); rg.selectNodeContents(r);
      const tops = {}; [].forEach.call(rg.getClientRects(), (x) => { if (x.height > 1) tops[Math.round(x.top)] = 1; });
      return { lines: Object.keys(tops).length, h: r.offsetHeight, width: r.offsetWidth, txt: r.textContent.trim() };
    });
    ok('the stranded take-back row is on the week view', !!s && s.h > 0 && /calendar/i.test(s.txt || ''), s);
    ok('in its longest branch, both halves stranded', !!s && !/week markers off/i.test(s.txt || ''), s);
    ok('and its label paints one line too', !!s && s.lines === 1, s);
  });

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'PREG-PROOF-LINE: FAIL' : 'PREG-PROOF-LINE: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
