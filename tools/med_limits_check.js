#!/usr/bin/env node
/* THE ONE CLASS OF MEDICINE THAT GOT NO QUESTION.
 *
 * logDose asks its calm "a dose is already logged" question only when medIntervalMs(m) is non-zero,
 * and medIntervalMs returns 0 for anything that is not everyX or daily. Infant paracetamol and
 * ibuprofen are the two medicines in a house with a baby, and both are almost always entered As
 * needed — so the class most likely to be double-dosed by two tired caregivers was the one class
 * that got no question at all. Tap Dose at 04:10 and it was simply written, with nothing said about
 * the dose the other parent gave at 02:00, or about the four already given since yesterday evening.
 *
 * The fix is two optional boxes on the As needed branch of the medicine sheet, filled in by the
 * parent off the bottle in her hand: hours between doses, and most in 24 hours. Cubby still invents
 * no interval and no dose. When a dose would go past one of THOSE numbers it shows the existing
 * confirmSheet with the written-down figure read back, and only then writes.
 *
 * What this gate holds down, all through the real UI and the real state:
 *   - blank boxes change nothing: the dose is written straight away, exactly as before
 *   - the boxes exist only on the As needed branch, and only fire there
 *   - neither box is pre-filled: "4 apart, 4 a day" IS the infant paracetamol regimen, and Cubby
 *     must never pre-type a dosing schedule into the field whose whole job is a safety limit
 *   - a limit left behind in the data after the medicine moves onto a schedule fires NOTHING
 *   - the sheet names the medicine, the real clock time, and the real person, and attributes the
 *     rule to the medicine rather than to whoever happens to be holding the phone
 *   - "Not now" writes no dose; "Log another" writes exactly one
 *   - the 24h window rolls: a dose 25 hours old is out, and the count follows it
 *   - another medicine's doses and another child's doses never count toward this one
 *   - A DOSE STAMPED IN THE FUTURE IS NOT A DOSE THAT WAS GIVEN. Rituals stamp their event at
 *     today at the ritual's set time (routineEventTime), so ticking an 8pm medicine ritual at 3pm
 *     writes a dose five hours ahead. Unbounded, that fired a spurious sheet and printed a NEGATIVE
 *     duration ("-54s ago") inside the medicine-safety dialog, and inflated the 24h count.
 *   - at 3am, nothing in the sheet points at a clock time that reads as later today
 *   - it survives a save, a reload, and a second save that clears the boxes
 *
 *   PORT=9457 node tools/serve.js &
 *   node tools/med_limits_check.js http://localhost:9457
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:9457';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, HOUR = 3600000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

// 15:00, so a dose 20 hours back lands at 19:00 YESTERDAY and a dose 25 hours back lands at 14:00
// yesterday. Two clock strings that cannot be confused, on either side of the rolling 24h edge.
const CLOCK = (() => { const d = new Date(); d.setHours(15, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;
// 03:10, the hour the sheet is actually read at. A dose 20 hours back lands at 07:10 YESTERDAY, and
// a time-only anchor prints "7:10 AM" — which at 3am reads as four hours from now.
const NIGHT = (() => { const d = new Date(); d.setHours(3, 10, 0, 0); return d.getTime(); })();
const NIGHT_OFFSET = NIGHT - Date.now();

// Written out here rather than borrowed from the page, so the expected clock string is independent
// of the fmtClock the app itself uses to build the sentence under test.
const clockOf = (ts) => { const d = new Date(ts); let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return h + ':' + String(m).padStart(2, '0') + ' ' + ap; };

const med = (over) => Object.assign({
  id: 'm1', babyId: 'b1', name: 'Infant paracetamol', dose: '2.5', unit: 'ml',
  pattern: { type: 'asNeeded', hours: 6, times: ['08:00', '20:00'] },
  remind: false, active: true, createdAt: now - 30 * DAY,
}, over || {});

// `at` is an absolute stamp, so a dose can be put in the FUTURE as easily as in the past.
const doseAt = (id, at, over) => Object.assign({
  id: id, type: 'medicine', babyId: 'b1', medId: 'm1', medName: 'Infant paracetamol',
  dose: '2.5', unit: 'ml', time: at, authorId: 'uidPapa',
}, over || {});
const dose = (id, ago, over) => doseAt(id, now - ago, over);

const seed = (over) => Object.assign({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 200 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
  activeBabyId: 'b1', events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
}, over || {});

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const errs = [];
  /* The page clock is pinned at document creation, so a run at a different hour needs its own page.
     Everything below reads `page` through the closure, so swapping it swaps the clock. */
  const mkPage = async (shift) => {
    const p = await browser.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await p.evaluateOnNewDocument((s) => {
      const R = Date;
      function D(...a) { return a.length === 0 ? new R(R.now() + s) : new R(...a); }
      D.prototype = R.prototype; D.now = () => R.now() + s; D.parse = R.parse; D.UTC = R.UTC;
      window.Date = D;
    }, shift);
    await p.setViewport({ width: 390, height: 844 });
    await p.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });
    await p.evaluate(() => localStorage.setItem('cubby-quick-uid', 'local'));
    return p;
  };
  let page = await mkPage(OFFSET);

  // The medicine cards live on the Health tab's Medicine segment, which is where a parent taps Dose
  // from. Everything below is a real tap on that real card.
  const toMeds = async () => {
    await page.evaluate(() => {
      if (typeof go === 'function') go('health');
      if (typeof setHealthTab === 'function') setHealthTab('meds');
    });
    await sleep(300);
  };
  const load = async (s) => {
    await page.evaluate((x) => {
      localStorage.setItem('little-log-v1', JSON.stringify(x));
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
    }, s);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1200);
    // Names, so "by Papa Bear" in the sentence under test is a real lookup and not a fallback.
    await page.evaluate(() => {
      window.LL = window.LL || {};
      window.LL.auth = { currentUser: { uid: 'local' } };
      window.LL.members = { local: 'owner', uidPapa: 'caregiver' };
      window.LL.memberInfo = { local: { name: 'Maya', relationship: 'Mama Bear' }, uidPapa: { name: 'Sam', relationship: 'Papa Bear' } };
      if (typeof render === 'function') render();
    });
    await toMeds();
  };

  const sheet = () => page.evaluate(() => {
    const s = document.getElementById('sheet');
    const shown = !!(s && s.classList.contains('show'));
    return {
      shown: shown,
      title: s && s.querySelector('h2') ? s.querySelector('h2').textContent.trim() : '',
      txt: s ? (s.textContent || '').replace(/\s+/g, ' ').trim() : '',
      primary: s && s.querySelector('.btn-primary') ? s.querySelector('.btn-primary').textContent.trim() : '',
      ghost: s && s.querySelector('.btn-ghost') ? s.querySelector('.btn-ghost').textContent.trim() : '',
    };
  });
  const doses = () => page.evaluate(() => (state.events || []).filter((e) => e.type === 'medicine' && !e.deleted).length);
  const cardText = () => page.evaluate(() => {
    const c = document.querySelector('.med-card .mc-body'); return c ? c.textContent.replace(/\s+/g, ' ').trim() : '';
  });
  /* Typing, but a missing box is a named FAILURE rather than a thrown selector error that kills the
     run: this gate has to be able to go all the way red on a tree without the fix, and report it. */
  const typeInto = async (sel, v) => {
    if (!(await page.$(sel))) return false;
    await page.type(sel, v);
    return true;
  };
  // Taps a button in whatever sheet is on screen, by its visible words. Returns false instead of
  // throwing when it is not there, for the same reason as typeInto.
  const tapSheetBtn = async (words) => {
    const hit = await page.evaluate((w) => {
      const rx = new RegExp(w, 'i');
      const b = Array.from(document.querySelectorAll('#sheet button')).find((x) => rx.test(x.textContent));
      if (!b) return false;
      b.click(); return true;
    }, words);
    await sleep(400);
    return hit;
  };
  // A real tap on the real Dose button of the real home card, not a call to logDose().
  const tapDose = async () => {
    const found = await page.evaluate(() => {
      const b = document.querySelector('.med-card .dose-btn');
      if (!b) return false; b.click(); return true;
    });
    await sleep(250);
    return found;
  };

  console.log('\n1. blank boxes change nothing at all');
  {
    await load(seed({ meds: [med()], events: [dose('d1', 1 * HOUR)] }));
    ok('the home card is there to tap', await tapDose(), null);
    const s = await sheet();
    ok('no question is asked, because no figure has been written down', s.shown === false, s.title);
    ok('and the dose is simply written', await doses() === 2, null);

    // Both figures written down, and not one dose on record: the very first dose of a new bottle
    // must go straight in. A limit with nothing to compare against is not a limit.
    await load(seed({ meds: [med({ pattern: { type: 'asNeeded', minGapH: 4, max24: 4 } })] }));
    await tapDose();
    const s2 = await sheet();
    ok('the first ever dose is never questioned', s2.shown === false, s2.txt.slice(0, 160));
    ok('and it is written', await doses() === 1, null);
  }

  console.log('\n2. the two boxes live on the As needed branch, and nowhere else');
  {
    await load(seed({ meds: [med({ pattern: { type: 'everyX', hours: 6, times: ['08:00'] } })] }));
    const before = await page.evaluate(() => {
      openMedManage('m1');
      return { gap: !!document.getElementById('mMinGap'), max: !!document.getElementById('mMax24') };
    });
    ok('a scheduled medicine does not offer them', before.gap === false && before.max === false, before);
    const after = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('#sheet .unit-toggle button'));
      const asNeeded = btns.find((b) => /as needed/i.test(b.textContent));
      if (!asNeeded) return { clicked: false };
      asNeeded.click();
      const g = document.getElementById('mMinGap'), m = document.getElementById('mMax24');
      return {
        clicked: true, gap: !!g, max: !!m,
        labels: Array.from(document.querySelectorAll('#sheet label')).map((l) => l.textContent.trim()),
        gapPh: g ? g.getAttribute('placeholder') : 'NO BOX', maxPh: m ? m.getAttribute('placeholder') : 'NO BOX',
        gapMin: g ? g.getAttribute('min') : 'NO BOX', maxMin: m ? m.getAttribute('min') : 'NO BOX',
        help: (document.getElementById('sheet').textContent || '').replace(/\s+/g, ' '),
      };
    });
    ok('tapping As needed reveals both', after.clicked === true && after.gap === true && after.max === true, after);
    /* Exactly these labels, in this order. A group heading above the pair rendered at the same 12px
       uppercase as the two real field labels, so three stacked labels read as three fields and the
       top one had no box under it. */
    ok('the labels are the four real fields and nothing above them',
      JSON.stringify(after.labels) === JSON.stringify(['Medicine name', 'Dose', 'Unit', 'Schedule', 'Hours between doses', 'Most in 24 hours']), after.labels);
    /* "4 hours apart, 4 in 24 hours" is the actual infant paracetamol regimen, and the medicine name
       placeholder right above says "e.g. Infant paracetamol". A greyed 4 in a safety-limit box is
       Cubby inventing a dosing schedule. Empty boxes. */
    ok('neither box is pre-filled with a regimen Cubby invented', !after.gapPh && !after.maxPh, { gap: after.gapPh, max: after.maxPh });
    // medSetLimit throws a 0 away silently, so the box must not invite one.
    ok('and neither box invites a value that is silently discarded', after.gapMin === '0.5' && after.maxMin === '1', { gap: after.gapMin, max: after.maxMin });
    ok('the line underneath says where the numbers come from', after.help.indexOf('Copy the limits off the bottle') > -1, after.help.slice(0, 200));
  }

  console.log('\n3. what she types is what is stored, and it survives a reload');
  {
    await load(seed({ meds: [med()] }));
    await page.evaluate(() => openMedManage('m1'));
    await sleep(150);
    const gapTyped = await typeInto('#mMinGap', '4');
    const maxTyped = await typeInto('#mMax24', '4');
    ok('both boxes are there to type into', gapTyped === true && maxTyped === true, { gapTyped, maxTyped });
    await page.click('#sheet .btn-primary');
    await sleep(400);
    const saved = await page.evaluate(() => { const p = state.meds[0].pattern; return { gap: p.minGapH, max: p.max24, gapT: typeof p.minGapH, maxT: typeof p.max24 }; });
    ok('both land on the medicine as numbers', saved.gap === 4 && saved.max === 4, saved);
    ok('numbers, not the input strings, because the comparison is arithmetic', saved.gapT === 'number' && saved.maxT === 'number', saved);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1200);
    const back = await page.evaluate(() => {
      openMedManage('m1');
      const g = document.getElementById('mMinGap'), m = document.getElementById('mMax24');
      return { gap: g ? g.value : null, max: m ? m.value : null };
    });
    ok('and they are still in the boxes after a reload', back.gap === '4' && back.max === '4', back);
  }

  console.log('\n4. the gap, read back with the medicine, the real time and the real person');
  {
    await load(seed({ meds: [med({ pattern: { type: 'asNeeded', minGapH: 4 } })], events: [dose('d1', 2 * HOUR)] }));
    /* The card's job is when, and by whom. A rule repeated here is unattributed — a second
       caregiver who never opened the sheet would read it as Cubby's dosing advice — and it pushes
       "Last dose · by Papa Bear", the line that answers the actual 2am question, into third place. */
    const body = await cardText();
    ok('the row still says plainly what kind of medicine it is', body.indexOf('As needed') > -1, body);
    ok('the row does not repeat a rule as if Cubby set it', body.indexOf('at least 4h') === -1 && body.indexOf('in 24h') === -1, body);
    ok('and the last dose and who gave it is still the second line', /Last dose .* · by Papa Bear/.test(body), body);
    await tapDose();
    const s = await sheet();
    ok('a sheet comes up', s.shown === true, s);
    ok('the title states why it is there, without a verdict', s.title === 'Before you log this', s.title);
    /* Not "You wrote": the person tapping Dose is very often not the person who typed the number,
       and Cubby must not put one caregiver's limit in the other's mouth. */
    ok('the rule is attributed to the medicine, not to whoever is holding the phone', s.txt.indexOf('Written down for this medicine: at least 4 hours between doses.') > -1, s.txt);
    ok('nobody is told they wrote something they did not', s.txt.indexOf('You wrote') === -1, s.txt);
    ok('it gives the real clock time of the last dose', s.txt.indexOf(clockOf(now - 2 * HOUR)) > -1, s.txt);
    // "the last one" is ambiguous on a child who has both paracetamol and ibuprofen on file.
    ok('it names the bottle, and who gave it', s.txt.indexOf('Papa Bear logged Infant paracetamol') > -1, s.txt);
    ok('it says how long ago, in the same words as the rest of the app', s.txt.indexOf('2h ago') > -1, s.txt);
    ok('nothing is written while it is on screen', await doses() === 1, null);
    ok('the way out is Not now', /not now/i.test(s.ghost), s);
    ok('and Not now writes no dose', await tapSheetBtn('not now') === true && await doses() === 1, null);
    await tapDose();
    ok('Log another writes exactly one', await tapSheetBtn('log another') === true && await doses() === 2, null);

    // Nobody on record as the author: still names the medicine, still no invented person.
    await load(seed({ meds: [med({ pattern: { type: 'asNeeded', minGapH: 4 } })], events: [dose('n1', 10 * 60000, { authorId: null })] }));
    await tapDose();
    const s2 = await sheet();
    ok('with no author on the dose it still names the medicine', s2.txt.indexOf('Infant paracetamol was logged 10m ago, at ' + clockOf(now - 10 * 60000) + '.') > -1, s2.txt);
  }

  console.log('\n5. most in 24 hours, counted off the written-down number');
  {
    // Four doses inside the window, the last of them 6h ago, so the 4h gap is NOT the thing that fires.
    await load(seed({
      meds: [med({ pattern: { type: 'asNeeded', minGapH: 4, max24: 4 } })],
      events: [dose('d1', 20 * HOUR), dose('d2', 14 * HOUR), dose('d3', 9 * HOUR), dose('d4', 6 * HOUR)],
    }));
    await tapDose();
    const s = await sheet();
    ok('the sheet comes up on the count alone', s.shown === true, s);
    ok('it quotes the ceiling as written down on the medicine', s.txt.indexOf('Written down for this medicine: no more than 4 in 24 hours.') > -1, s.txt);
    /* No ordinal and no clock anchor. fmtClock is time-only, so "the 5th since 7:10 AM" read at 3am
       points at a time that has not happened yet; and "the 5th" counts at her. How many, in the
       last 24 hours, is the figure she needs and it cannot be misread at any hour. */
    ok('it says how many this would make, in the last 24 hours', s.txt.indexOf('This one would make 5 in the last 24 hours.') > -1, s.txt);
    ok('it does not anchor the count to a bare clock time', s.txt.indexOf(' since ') === -1 && s.txt.indexOf('the 5th') === -1, s.txt);
    ok('and it does NOT also raise the gap, which is not breached', s.txt.indexOf('between doses') === -1, s.txt);
    ok('nothing written yet', await doses() === 4, null);
    ok('going ahead writes one, and only one', await tapSheetBtn('log another') === true && await doses() === 5, null);
  }

  console.log('\n6. the 24 hours roll: a dose 25 hours old is out of the count');
  {
    await load(seed({
      meds: [med({ pattern: { type: 'asNeeded', max24: 4 } })],
      events: [dose('d1', 25 * HOUR), dose('d2', 14 * HOUR), dose('d3', 9 * HOUR), dose('d4', 6 * HOUR)],
    }));
    await tapDose();
    const s = await sheet();
    ok('three inside the window is not four, so nothing is asked', s.shown === false, s.txt.slice(0, 160));
    ok('and the dose is written', await doses() === 5, null);
    // Now the same four, all inside the window: the count moves with it.
    await load(seed({
      meds: [med({ pattern: { type: 'asNeeded', max24: 4 } })],
      events: [dose('d1', 23 * HOUR), dose('d2', 14 * HOUR), dose('d3', 9 * HOUR), dose('d4', 6 * HOUR)],
    }));
    await tapDose();
    const s2 = await sheet();
    ok('with the oldest pulled inside the window it fires', s2.shown === true, s2.txt.slice(0, 160));
    ok('and counts every dose still inside it', s2.txt.indexOf('This one would make 5 in the last 24 hours.') > -1, s2.txt);
  }

  console.log('\n7. somebody else\'s doses are not hers to be warned about');
  {
    // Four doses in the window, but on a different bottle: same child, different medicine.
    await load(seed({
      meds: [med({ pattern: { type: 'asNeeded', minGapH: 4, max24: 4 } }), med({ id: 'm2', name: 'Ibuprofen' })],
      events: [dose('x1', 20 * HOUR, { medId: 'm2' }), dose('x2', 14 * HOUR, { medId: 'm2' }),
        dose('x3', 9 * HOUR, { medId: 'm2' }), dose('x4', 6 * HOUR, { medId: 'm2' })],
    }));
    const r = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.med-card'));
      const mine = cards.find((c) => /paracetamol/i.test(c.textContent));
      if (!mine) return false; mine.querySelector('.dose-btn').click(); return true;
    });
    await sleep(250);
    ok('the paracetamol card was the one tapped', r === true, null);
    const s = await sheet();
    ok('another medicine\'s four doses do not count toward this one', s.shown === false, s.txt.slice(0, 160));
    ok('and the dose is written', await doses() === 5, null);

    // Same medicine id, a sibling's record. lastDose scopes by baby; so must the count.
    await load(seed({
      babies: [{ id: 'b1', name: 'Robin', birth: now - 200 * DAY, sex: 'F', routines: [] },
        { id: 'b2', name: 'Wren', birth: now - 200 * DAY, sex: 'M', routines: [] }],
      meds: [med({ pattern: { type: 'asNeeded', minGapH: 4, max24: 4 } })],
      events: [dose('y1', 20 * HOUR, { babyId: 'b2' }), dose('y2', 14 * HOUR, { babyId: 'b2' }),
        dose('y3', 9 * HOUR, { babyId: 'b2' }), dose('y4', 2 * HOUR, { babyId: 'b2' })],
    }));
    await tapDose();
    const s2 = await sheet();
    ok('the other twin\'s doses are not this child\'s doses', s2.shown === false, s2.txt.slice(0, 160));
    ok('and nothing blocked the write', await doses() === 5, null);
  }

  console.log('\n8. a figure she can no longer see can never fire');
  {
    // She typed the two numbers, then moved this medicine onto a schedule. The boxes are gone from
    // the sheet, so the values must be inert: everyX has its own question and this must not add one.
    await load(seed({
      meds: [med({ pattern: { type: 'everyX', hours: 6, times: ['08:00'], minGapH: 4, max24: 4 } })],
      events: [dose('d1', 20 * HOUR), dose('d2', 14 * HOUR), dose('d3', 9 * HOUR), dose('d4', 7 * HOUR)],
    }));
    await tapDose();
    const s = await sheet();
    ok('no as-needed sheet on a scheduled medicine', s.txt.indexOf('Written down for this medicine') === -1, s.txt.slice(0, 160));
    ok('and the row does not claim a rule that is not being applied', (await cardText()).indexOf('at least 4h') === -1, null);
  }

  console.log('\n9. clearing a box turns the question back off');
  {
    await load(seed({ meds: [med({ pattern: { type: 'asNeeded', minGapH: 4, max24: 4 } })], events: [dose('d1', 1 * HOUR)] }));
    await tapDose();
    ok('it fires to begin with', (await sheet()).shown === true, null);
    await page.evaluate(() => closeSheet());
    await sleep(200);
    await page.evaluate(() => openMedManage('m1'));
    await sleep(150);
    const cleared = await page.evaluate(() => {
      let n = 0;
      ['mMinGap', 'mMax24'].forEach((id) => {
        const i = document.getElementById(id);
        if (!i) return;
        n++; i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true }));
      });
      return n;
    });
    ok('both boxes were there to clear', cleared === 2, cleared);
    await page.click('#sheet .btn-primary');
    await sleep(400);
    const p = await page.evaluate(() => { const q = state.meds[0].pattern; return { hasGap: 'minGapH' in q, hasMax: 'max24' in q }; });
    ok('an emptied box is not a zero: the key comes off entirely', p.hasGap === false && p.hasMax === false, p);
    const n0 = await doses();
    await tapDose();
    const s = await sheet();
    ok('and nothing is asked any more', s.shown === false, s.txt.slice(0, 160));
    ok('the dose goes straight in', await doses() === n0 + 1, null);
  }

  console.log('\n10. both breached at once says both, in one sheet, with one stem');
  {
    await load(seed({
      meds: [med({ pattern: { type: 'asNeeded', minGapH: 4, max24: 4 } })],
      events: [dose('d1', 20 * HOUR), dose('d2', 14 * HOUR), dose('d3', 9 * HOUR), dose('d4', 1 * HOUR)],
    }));
    await tapDose();
    const s = await sheet();
    ok('one sheet, not two', s.shown === true, s);
    ok('both rules are said once, in one sentence',
      s.txt.indexOf('Written down for this medicine: at least 4 hours between doses, and no more than 4 in 24 hours.') > -1, s.txt);
    ok('the stem is not repeated', (s.txt.match(/Written down for this medicine/g) || []).length === 1, s.txt);
    ok('and both facts follow it', s.txt.indexOf('Papa Bear logged Infant paracetamol 1h ago') > -1 && s.txt.indexOf('This one would make 5 in the last 24 hours.') > -1, s.txt);
    ok('it is not a warning, a target or a verdict', !/(warning|danger|too much|overdose|do not|should not)/i.test(s.txt), s.txt);
    ok('the way through is still hers to take', /log another/i.test(s.primary), s);
  }

  console.log('\n11. a dose stamped in the FUTURE is not a dose that was given (the ritual door)');
  {
    /* routinePayload stamps a ritual's event at today at the ritual's set time, so ticking an 8pm
       medicine ritual at 3pm writes a dose five hours ahead. Nothing has been given. Unbounded,
       `now()-last.time < gapH*3600000` is satisfied by every future dose, and fmtDur of a negative
       interval printed "-54s ago" into the medicine-safety dialog. The same skew arrives without
       rituals whenever two caregivers' phone clocks disagree, which is this feature's whole case. */
    await load(seed({
      babies: [{ id: 'b1', name: 'Robin', birth: now - 200 * DAY, sex: 'F', doctors: [], allergies: [],
        routines: [{ id: 'r1', title: 'Evening paracetamol', time: '20:00', assignee: null, evType: 'medicine', medId: 'm1', activity: null, medName: null, done: {} }] }],
      meds: [med({ pattern: { type: 'asNeeded', minGapH: 4, max24: 4 } })],
    }));
    // A real tap on the real ritual tick, on the real Rituals tab.
    const ticked = await page.evaluate(() => {
      if (typeof go === 'function') go('log');
      if (typeof setLogTab === 'function') setLogTab('rituals');
      const b = document.querySelector('.rt-check');
      if (!b) return false; b.click(); return true;
    });
    await sleep(500);
    ok('the ritual tick is there to tap', ticked === true, null);
    const ev = await page.evaluate(() => {
      const e = (state.events || []).find((x) => x.type === 'medicine' && !x.deleted);
      return e ? { medId: e.medId, ahead: Math.round((e.time - Date.now()) / 60000) } : null;
    });
    ok('and it wrote a dose against this medicine, stamped hours ahead of now', !!ev && ev.medId === 'm1' && ev.ahead > 60, ev);
    await toMeds();
    ok('the medicine card is still there to tap', await tapDose(), null);
    const s = await sheet();
    ok('a dose that has not happened yet raises no question', s.shown === false, s.txt.slice(0, 200));
    ok('and no negative duration is ever printed in a medicine sheet', !/-\d+\s*(s|m|h)\b/.test(s.txt), s.txt.slice(0, 200));
    ok('the dose is written, as it would have been before any of this', await doses() === 2, null);
  }

  console.log('\n12. a future dose does not fill up the 24 hour allowance either');
  {
    // Three real doses and one stamped three hours ahead. Three is not four.
    await load(seed({
      meds: [med({ pattern: { type: 'asNeeded', max24: 4 } })],
      events: [dose('d1', 20 * HOUR), dose('d2', 14 * HOUR), dose('d3', 9 * HOUR), doseAt('f1', now + 3 * HOUR)],
    }));
    await tapDose();
    const s = await sheet();
    ok('a dose nobody has given yet is not counted against the day', s.shown === false, s.txt.slice(0, 200));
    ok('and the dose is written', await doses() === 5, null);
    // The paired positive: swap the future dose for a real one 3 hours BACK and it fires.
    await load(seed({
      meds: [med({ pattern: { type: 'asNeeded', max24: 4 } })],
      events: [dose('d1', 20 * HOUR), dose('d2', 14 * HOUR), dose('d3', 9 * HOUR), dose('d4', 3 * HOUR)],
    }));
    await tapDose();
    const s2 = await sheet();
    ok('the same four, all actually given, do fire', s2.shown === true, s2.txt.slice(0, 200));
    ok('and count as four', s2.txt.indexOf('This one would make 5 in the last 24 hours.') > -1, s2.txt);
  }

  console.log('\n13. 3:10 AM, which is the hour this sheet is actually read at');
  {
    await page.close();
    page = await mkPage(NIGHT_OFFSET);
    const nDose = (id, ago) => doseAt(id, NIGHT - ago);
    await load(seed({
      babies: [{ id: 'b1', name: 'Robin', birth: NIGHT - 200 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
      meds: [med({ pattern: { type: 'asNeeded', max24: 4 } })],
      events: [nDose('d1', 20 * HOUR), nDose('d2', 14 * HOUR), nDose('d3', 8 * HOUR), nDose('d4', 5 * HOUR)],
    }));
    await tapDose();
    const s = await sheet();
    ok('the sheet still comes up at 3am', s.shown === true, s.txt.slice(0, 200));
    ok('it gives the number, not an ordinal to be counted at', s.txt.indexOf('This one would make 5 in the last 24 hours.') > -1, s.txt);
    /* The oldest in-window dose is 07:10 YESTERDAY. A time-only anchor prints "7:10 AM", which at
       3:10 AM reads as four hours from now: a frightened parent cannot tell whether Cubby is wrong
       or she is. Nothing in the count sentence may point at a clock at all. */
    ok('and nothing in it points at a clock time that has not happened yet', !/\d{1,2}:\d{2}\s*(AM|PM)/i.test(s.txt), s.txt);
    ok('nothing was written while it was on screen', await doses() === 4, null);
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'MED-LIMITS: FAIL' : 'MED-LIMITS: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
