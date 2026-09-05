#!/usr/bin/env node
/* The one field in Cubby with no second writer, and the numbers that have to follow it.
 *
 * A cold does not begin on the day you find a minute to type it in. It begins on the Tuesday you
 * first heard the cough, and you log it on the Thursday you finally stop. `startedAt` was stamped
 * once by startIllness and by nothing else in the file, and illnesses live in state.illnesses
 * rather than state.events, so openEdit could not reach them either. Two things that a parent
 * actually reads were therefore wrong for the whole illness and could not be put right:
 *
 *   - "Day 1 · since Thursday", for as long as it lasted, on the card she checks every morning.
 *   - "Medicine given this illness", which filters on e.time >= ill.startedAt, so Tuesday's and
 *     Wednesday's Calpol were silently missing from the one screen she reads out in the surgery.
 *
 * The same boundary bug bit inside a single day: an illness logged at 2pm hid the dose given at 8am
 * that morning, so startIllness now anchors the start at the beginning of the day.
 *
 * And moving the start is only half a fix on its own. Temperatures and symptoms were scoped by
 * `illnessId === ill.id`, but saveTemp stamps that from activeIllness(), which was null for every
 * reading taken BEFORE the record existed. Backdating moved the header and left the fever numbers
 * behind: an authoritative "day 3, since Aug 19" over a list missing the two highest readings,
 * which is worse than the old visibly-wrong header she used to correct out loud. Section 9 is that
 * case, end to end, including the doctor page that used to contradict itself on one sheet.
 *
 *   PORT=9414 node tools/serve.js &
 *   node tools/illness_start_check.js http://localhost:9414
 *   node tools/illness_start_check.js http://localhost:9414 --self-test
 *
 * --self-test reverts the two load-bearing rules INSIDE the page and requires the probes that cover
 * them to go red. A gate that has never failed is a guess.
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ARGS = process.argv.slice(2);
const SELF_TEST = ARGS.indexOf('--self-test') >= 0;
const BASE = ARGS.filter((a) => a.indexOf('--') !== 0)[0] || 'http://localhost:9414';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, HOUR = 3600000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

// 13:00, so "logged this afternoon" and "the dose at breakfast" are genuinely the same calendar day.
// The DAY is pinned too, and it is the same lesson relative_when_check learned on 1 September. This
// gate's fixture ends an illness at now-5d and asks the calendar about the day after. The clock was
// pinned to 13:00 but the date floated, so on 5 September the illness ended on 31 August, the day
// after was 1 September, the grid on screen was August, and pick(1) found AUGUST 1st, which is
// rightly selectable. "the day after it is not" went red against correct code, and would have for
// the first five days of every month. Mid-month keeps now-9d, now-5d, now-5d+1 and now+1 inside one
// calendar page forever, and the premise assertion below says so out loud.
const CLOCK = (() => { const d = new Date(); d.setDate(15); d.setHours(13, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;
const dayStart = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const at = (daysAgo, h, mins) => dayStart(now - daysAgo * DAY) + h * HOUR + (mins || 0) * 60000;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };

const seed = (over) => Object.assign({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 200 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
  activeBabyId: 'b1', events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
}, over || {});

const cold = (over) => Object.assign({ id: 'i1', babyId: 'b1', name: 'Cold', startedAt: dayStart(now), endedAt: null, notes: '' }, over || {});

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  /* No service worker. puppeteer.launch gives a throwaway profile today, so nothing stale is cached
     between runs, but index.html registers sw.js on any http origin with no e2e guard: the moment
     anyone folds this into a harness with a userDataDir it would start grading a cached build.
     That trap has cost this repo real time. Refuse the registration outright. */
  await page.evaluateOnNewDocument(() => {
    try { navigator.serviceWorker.register = () => Promise.reject(new Error('e2e: no sw')); } catch (e) {}
  });
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
    // Toasts are captured rather than silenced: section 13 reads the words a parent is actually told.
    await page.evaluate(() => { try { window.__toasts = []; window.toast = function (m) { window.__toasts.push(String(m)); }; } catch (e) {} });
  };
  // Land on the illness sub-tab the way a parent does, so every assertion below is about the DOM
  // she is actually looking at rather than the return value of a function nobody called.
  const openHealth = () => page.evaluate(() => { go('health'); setHealthTab('illness'); });
  // Rows as painted, with their text, so "there are no rows" can never read the same as "the rows
  // are all correct". Every .every() below is paired with a count.
  const rowsNow = () => page.evaluate(() => [].slice.call(document.querySelectorAll('#scroll .tl-item'))
    .map((x) => ({ t: x.textContent.replace(/\s+/g, ' ').trim(), c: x.getAttribute('onclick') || '' })));

  console.log('\n1. the card says which day it is, and offers a way to correct it');
  {
    await load(seed({ illnesses: [cold({ startedAt: dayStart(now - 2 * DAY) })] }));
    await openHealth();
    const r = await page.evaluate(() => {
      const lbl = document.querySelector('#scroll .med-due .lbl');
      return { lbl: lbl ? lbl.textContent.replace(/\s+/g, ' ').trim() : null,
        onclick: lbl ? (lbl.getAttribute('onclick') || '') : null };
    });
    ok('a cold that started the day before yesterday reads Day 3', /^Day 3 /.test(r.lbl || ''), r);
    ok('the since line names the day it started', /since \w/.test(r.lbl || ''), r);
    ok('and it says out loud that it can be changed', / change$/.test(r.lbl || ''), r);
    ok('the since line is the tap target', /openIllnessStart\('i1'\)/.test(r.onclick || ''), r);

    const opened = await page.evaluate(() => {
      document.querySelector('#scroll .med-due .lbl').click();
      const inp = document.getElementById('illStart');
      const strip = document.querySelector('#sheet .time-strip');
      return { has: !!inp, val: inp ? inp.value : null, strip: !!strip,
        h2: (document.querySelector('#sheet h2') || {}).textContent || '',
        save: !!(document.querySelector('#sheet [onclick*="saveIllnessStart"]')) };
    });
    ok('tapping it opens a sheet', /when did it start/i.test(opened.h2), opened);
    ok('the house date picker is in it, not a new control', opened.has && opened.strip, opened);
    ok('pre-filled with the day it currently claims', opened.val === ymd(now - 2 * DAY), opened);
    ok('and it can be saved', opened.save === true, opened);
  }

  console.log('\n2. Thursday, logging the cold that started on Tuesday');
  {
    await load(seed({ illnesses: [cold()] }));
    await openHealth();
    const r = await page.evaluate((v) => {
      openIllnessStart('i1');
      const inp = document.getElementById('illStart');
      inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true }));
      saveIllnessStart('i1');
      const i = state.illnesses[0];
      return { startedAt: i.startedAt, hist: i.history || [], by: i.editedBy, at: i.editedAt, card: renderIllness() };
    }, ymd(now - 2 * DAY));
    ok('the start moves to the day she picked', r.startedAt === dayStart(now - 2 * DAY), { got: r.startedAt, want: dayStart(now - 2 * DAY) });
    ok('anchored at the START of that day, so nothing on it is cut off', r.startedAt === dayStart(r.startedAt), r.startedAt);
    ok('one history entry, the way saveEdit writes one', r.hist.length === 1, r.hist);
    ok('it names the field', r.hist[0] && r.hist[0].field === 'startedAt', r.hist[0]);
    ok('it keeps the value it moved away from', r.hist[0] && r.hist[0].from === dayStart(now), r.hist[0]);
    ok('and the value it moved to', r.hist[0] && r.hist[0].to === dayStart(now - 2 * DAY), r.hist[0]);
    ok('it records who and when', !!(r.hist[0] && r.hist[0].by && r.hist[0].at), r.hist[0]);
    ok('the record is stamped as edited', r.by === 'local' && typeof r.at === 'number', { by: r.by, at: r.at });
    ok('the card stops saying Day 1', !/Day 1 /.test(r.card), (r.card.match(/Day \d+[^<]*/) || [])[0]);
    ok('and says Day 3', /Day 3 /.test(r.card), (r.card.match(/Day \d+[^<]*/) || [])[0]);

    // Saving the same day again is not an edit. A second history entry would put a second
    // "edited by Maya" on a record nobody edited.
    const r2 = await page.evaluate((v) => {
      openIllnessStart('i1');
      const inp = document.getElementById('illStart');
      inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true }));
      saveIllnessStart('i1');
      const i = state.illnesses[0];
      return { startedAt: i.startedAt, n: (i.history || []).length };
    }, ymd(now - 2 * DAY));
    ok('saving the same day a second time changes nothing', r2.startedAt === dayStart(now - 2 * DAY), r2);
    ok('and writes no second history entry', r2.n === 1, r2);
  }

  console.log('\n3. the doses that were being dropped');
  {
    await load(seed({
      illnesses: [cold()],
      events: [
        { id: 'm0', type: 'medicine', babyId: 'b1', medName: 'Calpol', dose: '5', unit: 'ml', time: now - 10 * DAY },
        { id: 'm1', type: 'medicine', babyId: 'b1', medName: 'Calpol', dose: '5', unit: 'ml', time: now - 2 * DAY },
        { id: 'm2', type: 'medicine', babyId: 'b1', medName: 'Calpol', dose: '5', unit: 'ml', time: now - 1 * DAY },
      ] }));
    await openHealth();
    const before = await page.evaluate(() => renderIllness());
    ok('with the start still on today, the earlier doses are missing', !/Medicine given this illness/.test(before), before.slice(0, 200));

    await page.evaluate((v) => {
      openIllnessStart('i1');
      const inp = document.getElementById('illStart');
      inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true }));
      saveIllnessStart('i1');
      go('health'); setHealthTab('illness');
    }, ymd(now - 3 * DAY));
    const html = await page.evaluate(() => renderIllness());
    /* Counted by what the row SAYS, never by the attribute under test. The old version filtered the
       row list by /openEdit/ and then asserted that every row matched /openEdit/, which is true of
       the empty array you get when the onclick is gone. */
    const dose = (await rowsNow()).filter((x) => /Calpol/.test(x.t));
    ok('backdating brings the section back', /Medicine given this illness/.test(html), html.slice(0, 200));
    ok('both doses inside the episode are listed', dose.length === 2, dose);
    ok('the dose from seven days before it started is NOT', !dose.some((x) => /m0/.test(x.c)), dose);
    ok('every dose row opens the edit sheet', dose.length === 2 && dose.every((x) => /openEdit\('m\d'\)/.test(x.c)), dose);
  }

  console.log('\n4. the same boundary inside one day: logged at 2pm, dose given at breakfast');
  {
    await load(seed({ events: [
      { id: 'm1', type: 'medicine', babyId: 'b1', medName: 'Calpol', dose: '5', unit: 'ml', time: at(0, 8) },
    ] }));
    const r = await page.evaluate(() => {
      startIllness('Cold');
      const i = state.illnesses[0];
      return { startedAt: i.startedAt, by: i.by, html: renderIllness() };
    });
    ok('a new illness starts at the beginning of the day, not at the minute she tapped', r.startedAt === dayStart(now), { got: r.startedAt, want: dayStart(now), clock: now });
    ok('so this morning\'s dose is on the card straight away', /Medicine given this illness/.test(r.html), r.html.slice(0, 300));
    ok('and the record remembers who logged it', r.by === 'local', r.by);
    ok('and it is day one', /Day 1 /.test(r.html), (r.html.match(/Day \d+[^<]*/) || [])[0]);
  }

  console.log('\n5. temperature: readings you can reach and correct, without a verdict on any of them');
  {
    await load(seed({
      illnesses: [cold({ startedAt: dayStart(now - 2 * DAY) })],
      events: [
        { id: 't1', type: 'temperature', babyId: 'b1', illnessId: 'i1', temp: 38.4, unit: 'C', time: now - 2 * DAY },
        { id: 't2', type: 'temperature', babyId: 'b1', illnessId: 'i1', temp: 37.2, unit: 'C', time: now - 3 * HOUR },
        { id: 't9', type: 'temperature', babyId: 'b1', illnessId: 'iOLD', temp: 39.1, unit: 'C', time: now - 40 * DAY },
      ] }));
    await openHealth();
    const html = await page.evaluate(() => renderIllness());
    const temp = (await rowsNow()).filter((x) => /°/.test(x.t));
    ok('the readings are listed, not only drawn', /Recent readings/.test(html), html.slice(0, 200));
    ok('and the heading does not repeat the chart above it', !/Temperature readings/.test(html), (html.match(/sec-title">[^<]*/g) || []));
    ok('both readings from this episode are there', temp.length === 2, temp);
    ok('a reading from an older episode is not', !temp.some((x) => /t9/.test(x.c)), temp);
    ok('newest first', /37\.2/.test((temp[0] || {}).t || ''), temp[0]);
    ok('each row opens the edit sheet', temp.length === 2 && temp.every((x) => /openEdit\('t\d'\)/.test(x.c)), temp);
    ok('no row carries a verdict on the number', !/fever/i.test((html.split('Recent readings')[1] || '').split('sec-title')[0] || ''), (html.split('Recent readings')[1] || '').slice(0, 200));

    const ed = await page.evaluate(() => {
      document.querySelectorAll('#scroll .tl-item').forEach((x) => { if (/37\.2/.test(x.textContent)) x.click(); });
      return { h2: (document.querySelector('#sheet h2') || {}).textContent || '',
        when: !!document.querySelector('#sheet .time-strip'),
        temp: (document.getElementById('eTemp') || {}).value,
        save: !!document.querySelector('#sheet [onclick*="saveEdit"]') };
    });
    ok('tapping a reading really opens it', /temperature/i.test(ed.h2), ed);
    ok('with the when control, which is the correction that was unreachable', ed.when === true, ed);
    ok('and a save', ed.save === true, ed);
    /* The row invites the tap; the sheet has to deliver the edit it promised. A mistyped 3.78° with
       only "when" and "delete" leaves a wrong number on the doctor page and no way to fix it. */
    ok('the reading itself is editable, not just its time', ed.temp === '37.2', ed);
    const fixed = await page.evaluate(() => {
      // Guarded, so a missing field reports as a failed assertion rather than crashing the run.
      const f = document.getElementById('eTemp'); if (f) f.value = '37.8';
      saveEdit('t2');
      const e = state.events.find((x) => x.id === 't2');
      return { temp: e.temp, hist: (e.history || []).map((h) => h.field) };
    });
    ok('correcting it writes the new reading', fixed.temp === 37.8, fixed);
    ok('and records the correction the way every other edit does', fixed.hist.indexOf('temp') >= 0, fixed);
  }

  console.log('\n6. nothing to show, and somebody else\'s entry');
  {
    await load(seed());
    await openHealth();
    const empty = await page.evaluate(() => ({ html: renderIllness(), sheet: !!document.getElementById('illStart') }));
    ok('with no illness the card is the well one', /Everyone's well/.test(empty.html), empty.html.slice(0, 120));
    ok('and offers no start date to change', !/openIllnessStart/.test(empty.html), empty.html.slice(0, 200));

    await load(seed({ illnesses: [cold()], events: [
      { id: 'm1', type: 'medicine', babyId: 'b1', medName: 'Calpol', dose: '5', unit: 'ml', time: now - 2 * HOUR, authorId: 'partner' },
    ] }));
    await openHealth();
    const owner = await page.evaluate(() => {
      document.querySelectorAll('#scroll .tl-item').forEach((x) => { if (/Calpol/.test(x.textContent)) x.click(); });
      return { h2: (document.querySelector('#sheet h2') || {}).textContent || '',
        save: !!document.querySelector('#sheet [onclick*="saveEdit"]'),
        dose: (document.getElementById('eDose') || {}).value };
    });
    ok('an owner can fix a dose the other parent logged', owner.save === true, owner);
    ok('and the dose amount is editable there too', owner.dose === '5', owner);
    /* The same row, seen by the caregiver half of the circle. The rule the rest of the app enforces
       has to hold on this newly tappable row too, or making it tappable quietly widens who can edit.
       The sheet has to have OPENED for the refusal to mean anything: "nothing happened" and "the
       rule was enforced" produce the same false otherwise. */
    const other = await page.evaluate(() => {
      closeSheet(); window.LL = window.LL || {}; window.LL.role = 'caregiver'; go('health'); setHealthTab('illness');
      document.querySelectorAll('#scroll .tl-item').forEach((x) => { if (/Calpol/.test(x.textContent)) x.click(); });
      return { open: /medicine|calpol/i.test((document.querySelector('#sheet h2') || {}).textContent || ''),
        save: !!document.querySelector('#sheet [onclick*="saveEdit"]'),
        del: !!document.querySelector('#sheet [onclick*="deleteEvent"]'),
        note: (document.querySelector('#sheet .preg-disclaim') || {}).textContent || '' };
    });
    ok('the caregiver\'s tap does open the entry', other.open === true, other);
    ok('a caregiver opening the other parent\'s dose gets no save', other.open === true && other.save === false, other);
    ok('and no delete', other.open === true && other.del === false, other);
    ok('but is told who can change it, not just refused', /can change this entry/.test(other.note), other.note);
  }

  console.log('\n7. a past illness: reachable, and clamped at every end');
  {
    const ended = { id: 'i2', babyId: 'b1', name: 'Tummy bug', startedAt: dayStart(now - 9 * DAY), endedAt: dayStart(now - 5 * DAY) + 11 * HOUR, notes: '' };
    await load(seed({ illnesses: [ended] }));
    await openHealth();
    const r = await page.evaluate(() => {
      document.querySelectorAll('#scroll .tl-item').forEach((x) => { if (/Tummy bug/.test(x.textContent)) x.click(); });
      return { html: document.getElementById('sheet').innerHTML,
        reach: !!document.querySelector('#sheet [onclick*="openIllnessStart"]') };
    });
    ok('the past illness sheet offers the start date', r.reach === true, r.html.slice(0, 300));

    // The calendar itself must not offer a day after it cleared up. Real cells, real disabled.
    const cal = await page.evaluate((endYmd, dayAfter) => {
      openIllnessStart('i2');
      openDateModal('illStart');
      const cells = [].slice.call(document.querySelectorAll('.dp-g .dp-c'));
      const pick = (d) => cells.find((c) => c.textContent === String(d));
      return { n: cells.length, endOn: (function (c) { return c ? !c.disabled : null; })(pick(+endYmd.slice(8))),
        afterOff: (function (c) { return c ? c.disabled : null; })(pick(+dayAfter.slice(8))) };
    }, ymd(ended.endedAt), ymd(ended.endedAt + DAY));
    /* The premise the two lines below rest on, stated so it fails loudly instead of silently: the cells
       are matched by day-of-month text, so end and day-after must sit on the SAME calendar page. */
    ok('the fixture keeps the end and the day after in one month, so day numbers are unambiguous',
      ymd(ended.endedAt).slice(0, 7) === ymd(ended.endedAt + DAY).slice(0, 7), { end: ymd(ended.endedAt), after: ymd(ended.endedAt + DAY) });
    ok('the calendar opened with real day cells', cal.n > 20, cal);
    ok('the day it cleared up is selectable', cal.endOn === true, cal);
    ok('the day after it is not', cal.afterOff === true, cal);

    // And the guard holds in the function, not only in the widget it was drawn with.
    const guard = await page.evaluate((after, tomorrow) => {
      const out = {};
      try { cuCloseModal(); } catch (e) {}
      openIllnessStart('i2');
      document.getElementById('illStart').value = after;
      saveIllnessStart('i2');
      out.afterEnd = state.illnesses[0].startedAt;
      openIllnessStart('i2');
      document.getElementById('illStart').value = tomorrow;
      saveIllnessStart('i2');
      out.future = state.illnesses[0].startedAt;
      openIllnessStart('i2');
      document.getElementById('illStart').value = '';
      saveIllnessStart('i2');
      out.blank = state.illnesses[0].startedAt;
      out.hist = (state.illnesses[0].history || []).length;
      return out;
    }, ymd(ended.endedAt + DAY), ymd(now + DAY));
    ok('a start after the day it ended is refused', guard.afterEnd === ended.startedAt, guard);
    ok('a start in the future is refused', guard.future === ended.startedAt, guard);
    ok('an empty date is refused', guard.blank === ended.startedAt, guard);
    ok('and none of the three left a history entry', guard.hist === 0, guard);

    const good = await page.evaluate((v) => {
      openIllnessStart('i2');
      document.getElementById('illStart').value = v;
      saveIllnessStart('i2');
      go('health'); setHealthTab('illness');
      const row = [].slice.call(document.querySelectorAll('#scroll .tl-item')).find((x) => /Tummy bug/.test(x.textContent));
      return { startedAt: state.illnesses[0].startedAt, row: row ? row.textContent.replace(/\s+/g, ' ').trim() : null };
    }, ymd(now - 11 * DAY));
    ok('a genuinely earlier day IS accepted', good.startedAt === dayStart(now - 11 * DAY), good);
    ok('and the history row recounts the days', /6 days/.test(good.row || ''), good.row);

    /* And it cannot be pushed back over the episode before it. "Medicine given this illness" has no
       other lower boundary, so a start dragged behind the last cold would relabel that cold's
       Calpol as part of this one, on the card and in the doctor's copy. */
    await load(seed({
      illnesses: [
        cold({ startedAt: dayStart(now - 2 * DAY) }),
        { id: 'i0', babyId: 'b1', name: 'Croup', startedAt: dayStart(now - 12 * DAY), endedAt: at(6, 10), notes: '' },
      ],
      events: [{ id: 'm9', type: 'medicine', babyId: 'b1', medName: 'Nurofen', dose: '5', unit: 'ml', time: at(8, 9) }] }));
    await openHealth();
    const overlap = await page.evaluate((tooFar) => {
      openIllnessStart('i1');
      const minAttr = _dp.illStart ? _dp.illStart.min : null;
      document.getElementById('illStart').value = tooFar;
      saveIllnessStart('i1');
      go('health'); setHealthTab('illness');
      return { min: minAttr, startedAt: illnessById('i1').startedAt,
        toast: (window.__toasts || []).slice(-1)[0] || '',
        html: renderIllness() };
    }, ymd(now - 8 * DAY));
    ok('the calendar floor is the day the last illness ended', overlap.min === ymd(now - 6 * DAY), overlap.min);
    ok('a start behind the previous episode is refused', overlap.startedAt === dayStart(now - 2 * DAY), overlap);
    ok('and she is told why, in plain words', /before the last illness ended/.test(overlap.toast), overlap.toast);
    ok('so the previous illness\'s dose is not relabelled', !/Nurofen/.test(overlap.html), (overlap.html.match(/Nurofen/g) || []));
  }

  console.log('\n8. it leaves the screen it was typed on: the blob, the report, the next paint');
  {
    /* A reload cannot be the assertion here: store-firebase.js:2127 swaps persist() for the
       Firestore push, so with no signed-in user nothing is written back to localStorage in this
       harness. What matters is that the correction goes through the app's ONE write path rather
       than living in a rendered string, so persist is spied on instead. */
    await load(seed({ illnesses: [cold()], events: [
      { id: 'm1', type: 'medicine', babyId: 'b1', medName: 'Calpol', dose: '5', unit: 'ml', time: now - 3 * DAY },
      { id: 'm2', type: 'medicine', babyId: 'b1', medName: 'Calpol', dose: '5', unit: 'ml', time: now - 1 * DAY },
    ] }));
    const r = await page.evaluate((v) => {
      let saves = 0; const real = window.persist;
      window.persist = function () { saves++; return real.apply(null, arguments); };
      openIllnessStart('i1');
      document.getElementById('illStart').value = v;
      saveIllnessStart('i1');
      window.persist = real;
      go('health'); setHealthTab('illness');
      const lbl = document.querySelector('#scroll .med-due .lbl');
      return { saves: saves, summary: visitSummary(14),
        lbl: lbl ? lbl.textContent.replace(/\s+/g, ' ').trim() : null };
    }, ymd(now - 4 * DAY));
    ok('the correction is written, once, through the app\'s own save path', r.saves === 1, r.saves);
    ok('the card counts from the corrected day', /^Day 5 /.test(r.lbl || ''), r.lbl);
    ok('the doctor summary starts the episode where she said it started', /Started .+, day 5, still going/.test(r.summary), (r.summary.match(/Started[^\n]*/) || [])[0]);
    ok('and both doses now count as given during it', /Calpol 5 ml x2/.test(r.summary), (r.summary.match(/Given during it:[^\n]*/) || [])[0]);

    const who = await page.evaluate(() => {
      openIllnessStart('i1');
      return (document.getElementById('sheet').textContent || '').replace(/\s+/g, ' ');
    });
    ok('reopening the sheet says the date was edited before', /edited by/.test(who), who.slice(0, 200));
  }

  console.log('\n9. the readings taken BEFORE anyone had time to log the illness');
  {
    /* The whole point of moving the start. Cold noticed Tuesday, logged Thursday. The 39.1 on
       Tuesday evening and the 38.4 on Wednesday morning were taken when activeIllness() was null,
       so saveTemp stamped illnessId:null on both. Scoping the list by illnessId alone meant
       backdating moved the header and left the two highest readings behind, and the doctor page
       printed the 39.1 as belonging to no illness at all, two inches under a block claiming the
       episode had one reading. */
    await load(seed({
      illnesses: [cold()],
      events: [
        { id: 't1', type: 'temperature', babyId: 'b1', temp: 39.1, unit: 'C', time: at(2, 19) },
        { id: 't2', type: 'temperature', babyId: 'b1', temp: 38.4, unit: 'C', time: at(1, 8) },
        { id: 't3', type: 'temperature', babyId: 'b1', illnessId: 'i1', temp: 37.9, unit: 'C', time: at(0, 11) },
        { id: 't8', type: 'temperature', babyId: 'b1', temp: 38.7, unit: 'C', time: at(5, 9) },
        { id: 't9', type: 'temperature', babyId: 'b1', illnessId: 'iOLD', temp: 39.8, unit: 'C', time: at(40, 9) },
        { id: 'y1', type: 'symptom', babyId: 'b1', symptom: 'Cough', severity: 'moderate', time: at(2, 20) },
        { id: 'm1', type: 'medicine', babyId: 'b1', medName: 'Calpol', dose: '2.5', unit: 'ml', time: at(2, 19) },
        { id: 'm2', type: 'medicine', babyId: 'b1', medName: 'Calpol', dose: '2.5', unit: 'ml', time: at(1, 8) },
      ] }));
    await openHealth();
    const b4 = (await rowsNow()).filter((x) => /°/.test(x.t));
    ok('before the correction only today\'s reading is on the episode', b4.length === 1, b4);

    await page.evaluate((v) => {
      openIllnessStart('i1');
      document.getElementById('illStart').value = v;
      saveIllnessStart('i1');
      go('health'); setHealthTab('illness');
    }, ymd(now - 2 * DAY));
    const after = await rowsNow();
    const temp = after.filter((x) => /°/.test(x.t));
    const html = await page.evaluate(() => renderIllness());
    ok('moving the start brings Tuesday\'s and Wednesday\'s readings with it', temp.length === 3, temp);
    ok('the 39.1 that was taken before the record existed is listed', temp.some((x) => /39\.1/.test(x.t)), temp);
    ok('and so is the 38.4', temp.some((x) => /38\.4/.test(x.t)), temp);
    ok('the reading from five days ago, outside the episode, is not', !temp.some((x) => /38\.7/.test(x.t)), temp);
    ok('nor the one that belongs to an older episode', !temp.some((x) => /39\.8/.test(x.t)), temp);
    ok('the chart counts all three, so it matches the list under it', /3 readings · °C/.test(html), (html.match(/\d+ readings[^<]*/) || [])[0]);
    ok('the symptom noted on Tuesday comes back too', after.some((x) => /Cough/.test(x.t)), after.map((x) => x.t));

    const rep = await page.evaluate(() => visitSummary(14));
    const block = (rep.match(/Illness: Cold[\s\S]*?(?=\n\n|$)/) || [''])[0];
    ok('the doctor page says the episode had three readings', /Temperature: 3 readings/.test(block), block);
    ok('and names the real peak', /highest 39\.1°C/.test(block), block);
    ok('and counts both fever readings', /2 at or above the fever line/.test(block), block);
    /* The contradiction is the harm, not just the omission: the same 39.1 used to appear once
       inside the episode and once in the flat fortnight line as belonging to no illness. */
    ok('the peak is stated once on the sheet, not twice', (rep.match(/39\.1/g) || []).length === 1, (rep.match(/^.*39\.1.*$/gm) || []));
    ok('a reading outside the episode still reports on its own', /Temperature: 1 reading\(s\), max 38\.7/.test(rep), (rep.match(/^Temperature:[^\n]*/m) || [])[0]);
    ok('the doses she gave before logging it are counted too', /Calpol 2\.5 ml x2/.test(rep), (rep.match(/Given during it:[^\n]*/) || [])[0]);
  }

  console.log('\n10. the day count is a count of days, on both screens');
  {
    /* A record stamped at 23:30 last night. floor((now - then)/24h)+1 says day 1 at lunchtime
       today; she is looking at the second day of it. Same arithmetic, same failure, one hour at a
       time, across a spring DST change. */
    await load(seed({ illnesses: [cold({ startedAt: at(1, 23, 30) })] }));
    await openHealth();
    const card = await page.evaluate(() => {
      const lbl = document.querySelector('#scroll .med-due .lbl');
      return lbl ? lbl.textContent.replace(/\s+/g, ' ').trim() : null;
    });
    ok('a cold that began late last night reads Day 2 this afternoon', /^Day 2 /.test(card || ''), card);
    const home = await page.evaluate(() => {
      go('home');
      const p = [].slice.call(document.querySelectorAll('#scroll .alert-pill .ap-t')).map((x) => x.textContent.replace(/\s+/g, ' ').trim());
      return p;
    });
    ok('and the home pill agrees with the card', home.some((x) => /Cold · day 2/.test(x)), home);
  }

  console.log('\n11. a record nobody changed is not stamped as changed');
  {
    /* Every illness logged before the start was anchored at midnight carries a wall-clock stamp.
       Comparing the picked midnight against that raw number called all of them a change: she opens
       the sheet to check the date, sees it is right, saves, and the other parent gets an
       "edited by" line on a record nobody touched. */
    const legacy = cold({ id: 'i0', startedAt: at(7, 4) });
    await load(seed({ illnesses: [legacy] }));
    await openHealth();
    const r = await page.evaluate(() => {
      openIllnessStart('i0');
      const pre = document.getElementById('illStart').value;
      saveIllnessStart('i0');
      const i = state.illnesses[0];
      return { pre: pre, startedAt: i.startedAt, hist: (i.history || []).length, by: i.editedBy,
        toast: (window.__toasts || []).slice(-1)[0] || '',
        // closeSheet drops the .show class; the markup stays for the slide-out.
        shown: document.getElementById('sheet').classList.contains('show') };
    });
    ok('the picker is pre-filled with the day it really claims', r.pre === ymd(now - 7 * DAY), r);
    ok('saving it untouched leaves the start exactly where it was', r.startedAt === at(7, 4), { got: r.startedAt, want: at(7, 4) });
    ok('writes no history entry', r.hist === 0, r);
    ok('and stamps nobody as having edited it', !r.by, r);
    ok('it says so kindly, not as a diff', /already the start date/.test(r.toast), r.toast);
    ok('and the sheet closes rather than sitting there', r.shown === false, r);
  }

  console.log('\n12. who may move the start');
  {
    /* The dose row two inches above refuses a caregiver editing the other parent's entry. Adding a
       second writer to the shared illness record without the same rule would let anyone rewrite the
       episode while the row beside it says they cannot. */
    await load(seed({ illnesses: [cold({ by: 'partner' })] }));
    await openHealth();
    const care = await page.evaluate((v) => {
      window.LL = window.LL || {}; window.LL.role = 'caregiver';
      openIllnessStart('i1');
      const out = { picker: !!document.getElementById('illStart'),
        save: !!document.querySelector('#sheet [onclick*="saveIllnessStart"]'),
        note: (document.querySelector('#sheet .preg-disclaim') || {}).textContent || '',
        h2: (document.querySelector('#sheet h2') || {}).textContent || '' };
      /* And the function itself refuses, not only the sheet that draws it. Any input the sheet may
         have rendered goes first: leaving it there means $('#illStart') finds the picker's own
         value (today), the no-change guard swallows the call, and this assertion passes whether the
         permission check exists or not. */
      const stale = document.getElementById('illStart'); if (stale) stale.remove();
      const inp = document.createElement('input');
      inp.type = 'hidden'; inp.id = 'illStart'; inp.value = v;
      document.body.appendChild(inp);
      saveIllnessStart('i1');
      out.startedAt = illnessById('i1').startedAt;
      out.hist = (illnessById('i1').history || []).length;
      out.toast = (window.__toasts || []).slice(-1)[0] || '';
      inp.remove();
      return out;
    }, ymd(now - 4 * DAY));
    ok('the sheet still opens and names the record', /when did it start/i.test(care.h2), care);
    ok('but a caregiver is offered no date to pick', care.picker === false, care);
    ok('and no save', care.save === false, care);
    ok('she is told who can change it', /can change when this started/.test(care.note), care.note);
    ok('the save refuses even when called directly', care.startedAt === dayStart(now), { got: care.startedAt, want: dayStart(now) });
    ok('and leaves no history entry behind', care.hist === 0, care);
    ok('with a reason, not a silent no-op', /logger or an owner/.test(care.toast), care.toast);

    const own = await page.evaluate(() => {
      closeSheet(); window.LL.role = 'owner'; openIllnessStart('i1');
      return { picker: !!document.getElementById('illStart'),
        save: !!document.querySelector('#sheet [onclick*="saveIllnessStart"]') };
    });
    ok('an owner can still correct it', own.picker === true && own.save === true, own);

    await load(seed({ illnesses: [cold({ by: 'local' })] }));
    await openHealth();
    const mine = await page.evaluate(() => {
      window.LL = window.LL || {}; window.LL.role = 'caregiver';
      openIllnessStart('i1');
      return { picker: !!document.getElementById('illStart') };
    });
    ok('and so can the caregiver who logged it herself', mine.picker === true, mine);

    await load(seed({ illnesses: [cold()] }));
    await openHealth();
    const legacy = await page.evaluate(() => {
      window.LL = window.LL || {}; window.LL.role = 'caregiver';
      openIllnessStart('i1');
      return { picker: !!document.getElementById('illStart') };
    });
    ok('a record from before this shipped is not locked away from its own circle', legacy.picker === true, legacy);
  }

  console.log('\n13. the words on the sheet');
  {
    await load(seed({ illnesses: [{ id: 'i2', babyId: 'b1', name: 'Tummy bug', startedAt: dayStart(now - 9 * DAY), endedAt: at(5, 11), notes: '' }] }));
    await openHealth();
    const t = await page.evaluate(() => {
      document.querySelectorAll('#scroll .tl-item').forEach((x) => { if (/Tummy bug/.test(x.textContent)) x.click(); });
      openIllnessStart('i2');
      return (document.getElementById('sheet').textContent || '').replace(/\s+/g, ' ').trim();
    });
    /* Reached from Past illnesses, "When did it start?" alone does not say WHICH record she is
       about to rewrite, and there can be several. */
    ok('the sheet names the illness she is editing', /Tummy bug\./.test(t), t.slice(0, 160));
    ok('and answers the question she actually has', /first day you noticed it, even if you logged it later/i.test(t), t.slice(0, 200));
    ok('it does not explain the app\'s internals to her', !/day count/i.test(t) && !/follow from this/i.test(t), t.slice(0, 200));
    ok('no em-dash anywhere on it', t.indexOf('—') < 0, t.slice(0, 200));
    ok('no title case on the label', /First day/.test(t) && !/First Day/.test(t), t.slice(0, 200));

    const said = await page.evaluate((tomorrow, afterEnd) => {
      window.__toasts = [];
      openIllnessStart('i2');
      document.getElementById('illStart').value = tomorrow; saveIllnessStart('i2');
      openIllnessStart('i2');
      document.getElementById('illStart').value = afterEnd; saveIllnessStart('i2');
      openIllnessStart('i2');
      document.getElementById('illStart').value = ''; saveIllnessStart('i2');
      return window.__toasts.slice();
    }, ymd(now + DAY), ymd(now - 4 * DAY));
    ok('a future day is refused in the house phrasing', said.indexOf('That is in the future') >= 0, said);
    ok('a day after they recovered is refused gently', said.indexOf('That is after they got better') >= 0, said);
    ok('an empty date asks rather than scolds', said.indexOf('Pick a day') >= 0, said);
    ok('nothing said to her contains an em-dash', !said.some((x) => x.indexOf('—') >= 0), said);
    ok('and nothing blames her', !said.some((x) => /should|must|failed|invalid|error/i.test(x)), said);
  }

  console.log('\n14. a dose is words, not a number');
  {
    /* The medicine rows on the illness card are tappable now, and the sheet behind them has to hold
       what a dose actually is. Dose is free text everywhere it is written: mDose (index.html:9190)
       carries no type at all, saveMed stores $('#mDose').value.trim(), and the unit list offers
       tablet, drops and tsp. So "half tablet", "1/2", "0.5-1" and the comma decimal much of the
       world writes are all real stored values. A number input discards every one of them, and
       Chrome renders an EMPTY box with no explanation: on the screen she reads out in the surgery
       that looks like no dose was ever recorded, and the moment she types a figure into the empty
       box it replaces a value she was never shown.
       (The temperature twin above is a number box on purpose. saveTemp only ever writes
       +v.toFixed(1), so there is no free text there to lose.) */
    const doses = ['half tablet', '1/2', '0.5-1', '2,5', '2.5'];
    await load(seed({
      illnesses: [cold()],
      events: doses.map((d, i) => ({ id: 'd' + i, type: 'medicine', babyId: 'b1', medName: 'Calpol', dose: d, unit: 'tablet', time: at(0, 8 + i) })),
    }));
    await openHealth();
    // Every row opened for real, one at a time, and read back by what the box SAYS.
    const shown = await page.evaluate(() => {
      const out = [];
      [].slice.call(document.querySelectorAll('#scroll .tl-item')).forEach((row) => {
        if (!/Calpol/.test(row.textContent)) return;
        row.click();
        const f = document.getElementById('eDose');
        out.push({ row: row.textContent.replace(/\s+/g, ' ').trim(), field: f ? f.value : null,
          type: f ? (f.getAttribute('type') || 'text') : null, ph: f ? (f.getAttribute('placeholder') || '') : null });
        closeSheet();
      });
      return out;
    });
    ok('all five doses are on the card and all five open a sheet with a dose field', shown.length === 5 && shown.every((x) => x.field !== null), shown);
    doses.forEach((d) => ok('the sheet shows ' + JSON.stringify(d) + ' exactly as it was logged', shown.some((x) => x.field === d), shown.map((x) => x.field)));
    ok('so no dose row ever opens on a blank box', shown.every((x) => x.field !== ''), shown.map((x) => x.field));
    ok('the field is not a number box, which is what threw the words away', shown.every((x) => x.type !== 'number'), shown.map((x) => x.type));
    ok('and an empty one would still say what belongs in it', shown.every((x) => x.ph), shown.map((x) => x.ph));

    // The correction the tap promises. Typed with stray spaces, the way a thumb types at 3am.
    const fix = await page.evaluate(() => {
      go('health'); setHealthTab('illness');
      const row = [].slice.call(document.querySelectorAll('#scroll .tl-item')).find((x) => /half tablet/.test(x.textContent));
      if (row) row.click();
      const f = document.getElementById('eDose');
      const seen = f ? f.value : null;
      if (f) f.value = '  one tablet  ';
      saveEdit('d0');
      const e = state.events.find((x) => x.id === 'd0');
      return { seen: seen, dose: e.dose, hist: (e.history || []).filter((h) => h.field === 'dose'),
        toast: (window.__toasts || []).slice(-1)[0] || '' };
    });
    ok('she is shown the wrong dose before she is asked to fix it', fix.seen === 'half tablet', fix);
    ok('a wrongly logged dose can be corrected in words', fix.dose === 'one tablet', fix);
    ok('trimmed the way the medicine sheet trims it', fix.hist.length === 1 && fix.hist[0].to === 'one tablet', fix.hist);
    ok('and the record keeps what it moved away from', fix.hist.length === 1 && fix.hist[0].from === 'half tablet', fix.hist);
    ok('she is told it saved', /^Updated$/.test(fix.toast), fix.toast);

    // Opening a dose only to check it, which is the likeliest tap of all, must change nothing.
    const untouched = await page.evaluate(() => {
      closeSheet(); go('health'); setHealthTab('illness');
      const row = [].slice.call(document.querySelectorAll('#scroll .tl-item')).find((x) => /0\.5-1/.test(x.textContent));
      if (row) row.click();
      saveEdit('d2');
      const e = state.events.find((x) => x.id === 'd2');
      return { dose: e.dose, hist: (e.history || []).length, by: e.editedBy || null };
    });
    ok('checking a dose and saving leaves it exactly as it was', untouched.dose === '0.5-1', untouched);
    ok('and stamps nobody as having edited it', untouched.hist === 0 && !untouched.by, untouched);

    // What the surgery screen ends up saying.
    const out = await page.evaluate(() => {
      closeSheet(); go('health'); setHealthTab('illness');
      return { rows: [].slice.call(document.querySelectorAll('#scroll .tl-item')).map((x) => x.textContent.replace(/\s+/g, ' ').trim()),
        rep: visitSummary(14) };
    });
    ok('the corrected dose is on the card', out.rows.some((x) => /one tablet/.test(x)), out.rows);
    ok('the comma decimal survived to the doctor page', /Calpol 2,5 tablet/.test(out.rep), (out.rep.match(/Given during it:[^\n]*/) || [])[0]);
    ok('and so did the fraction', /Calpol 1\/2 tablet/.test(out.rep), (out.rep.match(/Given during it:[^\n]*/) || [])[0]);
    ok('and the range', /Calpol 0\.5-1 tablet/.test(out.rep), (out.rep.match(/Given during it:[^\n]*/) || [])[0]);
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));

  /* ---- --self-test: prove the two load-bearing rules can actually go red ----
     Both are global function declarations, so reassigning window.<name> genuinely replaces what
     renderIllness calls. This puts the pre-fix behaviour back inside a live page and requires the
     probes that cover it to flip. */
  let selfBad = 0;
  if (SELF_TEST) {
    console.log('\n--self-test: revert each rule in the page and require the probe to fail');
    const chk = (n, c, x) => { if (c) { console.log('  ok   ' + n); } else { selfBad++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };
    await load(seed({
      illnesses: [cold({ startedAt: dayStart(now - 2 * DAY) })],
      events: [
        { id: 't1', type: 'temperature', babyId: 'b1', temp: 39.1, unit: 'C', time: at(2, 19) },
        { id: 't3', type: 'temperature', babyId: 'b1', illnessId: 'i1', temp: 37.9, unit: 'C', time: at(0, 11) },
      ] }));
    await openHealth();
    const good = await page.evaluate(() => document.querySelectorAll('#scroll .tl-item').length);
    const broke = await page.evaluate(() => {
      window.inIllness = function (e, ill) { return !!(e && ill && e.illnessId === ill.id); };
      go('health'); setHealthTab('illness');
      return document.querySelectorAll('#scroll .tl-item').length;
    });
    chk('with the episode rule in place, the pre-record reading is listed', good === 2, good);
    chk('with it reverted the reading vanishes, so section 9 can fail', broke === 1, broke);

    await load(seed({ illnesses: [cold({ startedAt: at(1, 23, 30) })] }));
    await openHealth();
    const day2 = await page.evaluate(() => (document.querySelector('#scroll .med-due .lbl') || {}).textContent || '');
    const day1 = await page.evaluate(() => {
      window.illnessDays = function (ill, until) { return Math.max(0, Math.floor(((until || now()) - ill.startedAt) / 86400000)) + 1; };
      go('health'); setHealthTab('illness');
      return (document.querySelector('#scroll .med-due .lbl') || {}).textContent || '';
    });
    chk('with calendar days, last night\'s cold reads Day 2', /^Day 2 /.test(day2), day2);
    chk('with the old arithmetic it reads Day 1, so section 10 can fail', /^Day 1 /.test(day1), day1);
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (SELF_TEST) console.log('self-test: ' + (selfBad ? selfBad + ' probe(s) could not go red' : 'both rules proved failable'));
  console.log((fail || selfBad) ? 'ILLNESS-START: FAIL' : 'ILLNESS-START: PASS');
  process.exit((fail || selfBad) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
