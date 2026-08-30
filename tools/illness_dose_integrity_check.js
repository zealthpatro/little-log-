#!/usr/bin/env node
/* TWO WAYS THE HEALTH TAB TOLD A PARENT SOMETHING THAT WAS NOT TRUE.
 *
 * A. "Reopen this illness" destroyed the recovery date, and could strand the record.
 *    resumeIllness was one line: `i.endedAt=null`. No question, nothing written down, nothing to put
 *    it back with, and the date it threw away is the first thing a clinician asks for. It also ran
 *    with no guard: the card shows activeIllness() (the newest episode with NO end date) and the
 *    history list below shows the ones that HAVE one, so an episode with neither is in neither.
 *    Reopening the ear infection while the cold was still running left two open at once, the cold
 *    won the card because it started later, and the ear infection fell out of the app entirely — no
 *    way left to see it, end it or delete it, its recovery date already gone.
 *
 * B. A dose stamped in the FUTURE read as GIVEN.
 *    routinePayload stamps a ritual's event at today at the ritual's set time (routineEventTime),
 *    so ticking an 8pm "evening medicine" at 1pm writes a dose seven hours ahead; the same skew
 *    arrives without rituals whenever two caregivers' phone clocks disagree, which is this
 *    feature's whole case. lastDose() was unbounded at the future end, so at one in the afternoon
 *    the row told the second parent "Last dose 8:00 PM · by Mama Bear" about a dose nobody had
 *    given; the everyX course re-anchored to it and moved the next amoxicillin from 6pm to 2am,
 *    skipping the real one; the set-times path treated the future dose as having covered the 8am
 *    slot that had genuinely passed; and the too-soon guard, comparing now()-last.time against the
 *    interval, matched on the negative and offered to talk about a dose "-7h ago". renderIllness
 *    listed it under "Medicine given this illness" hours before it happened.
 *    medLimitBreach was bounded at both ends for exactly this reason. Everything reading through
 *    lastDose was not. A dose that has not happened yet is not a dose that was given.
 *
 * WHAT A PASS HERE MEANS, and what it does not.
 *   - It attests the client behaviour on a pinned clock at 13:00 local, driven through the real DOM
 *     of the illness and medicine sub-tabs of Health. It says nothing about sync: the harness
 *     runs the app in local mode (cubby-quick-uid=local), so store-firebase.js never loads and
 *     firestore.rules is never evaluated.
 *   - It does NOT claim ritual ticks stop writing future stamps. routinePayload is unchanged and
 *     deliberately so: a set-time ritual event belongs at its set time. The claim is only that
 *     nothing downstream counts such a row as given before it happens.
 *   - Section 8's doctor-report half is a REGRESSION guard, not a fix: illnessSummary already
 *     bounded its dose list at the end of the episode, so that assertion is green on both sides of
 *     the fix. The card beside it was not bounded, and that half does go red.
 *
 * Every absence assertion below is paired with a presence assertion, and every .every() with a
 * count, so a blank screen cannot pass for free.
 *
 *   PORT=19621 node tools/serve.js &
 *   node tools/illness_dose_integrity_check.js http://localhost:19621
 *   node tools/illness_dose_integrity_check.js http://localhost:19621 --self-test
 *
 * Pass an explicit base URL. The default is deliberately NOT 8080 or 8123: a stale server from
 * another checkout on a shared port grades that tree and reports PASS on work you never wrote.
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ARGS = process.argv.slice(2);
const SELF_TEST = ARGS.indexOf('--self-test') >= 0;
const BASE = ARGS.filter((a) => a.indexOf('--') !== 0)[0] || 'http://localhost:19621';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, HOUR = 3600000, MIN = 60000;

let pass = 0, fail = 0, selfBad = 0;
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); }
};
// A self-test probe asserts the OPPOSITE, with the pre-fix code put back inside the live page. It
// does not count towards pass/fail; it counts towards "this gate has been watched go red".
const red = (n, c, x) => {
  if (c) { console.log('  red  ' + n); }
  else { selfBad++; console.log('  NOT-RED ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); }
};

// 13:00 local today. Every fixture below is placed either side of that hour on purpose.
const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;
const at = (h, m) => { const d = new Date(CLOCK); d.setHours(h, m || 0, 0, 0); return d.getTime(); };
const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

const seed = (over) => Object.assign({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 300 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
  activeBabyId: 'b1', events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
}, over || {});

const ill = (o) => Object.assign({ id: 'i1', babyId: 'b1', name: 'Cold', startedAt: dayStart(now - 6 * DAY), endedAt: dayStart(now - 3 * DAY) + 10 * HOUR, notes: '', by: 'local' }, o || {});
const amox = (o) => Object.assign({ id: 'm1', babyId: 'b1', name: 'Amoxicillin', dose: '5', unit: 'ml', active: true, remind: true, createdAt: now - 5 * DAY, pattern: { type: 'everyX', hours: 6 } }, o || {});
const dose = (o) => Object.assign({ id: 'd1', type: 'medicine', babyId: 'b1', medId: 'm1', medName: 'Amoxicillin', dose: '5', unit: 'ml', time: at(12, 0), authorId: 'local' }, o || {});

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  /* index.html registers sw.js on any http origin with no e2e guard. A throwaway profile saves us
     today, but the moment this is folded into a harness with a userDataDir a stale worker would
     serve an old bundle while the run reported PASS. That trap has cost this repo real time. */
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
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0 || k.indexOf('cubby-med-alerts') === 0) localStorage.removeItem(k); });
    }, s);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1400);
    // Toasts are captured rather than silenced: a refusal that says nothing is the failure mode.
    await page.evaluate(() => { try { window.__toasts = []; window.toast = function (m) { window.__toasts.push(String(m)); }; } catch (e) {} });
    await sleep(150);
  };
  const openHealth = () => page.evaluate(() => { go('health'); setHealthTab('illness'); });
  // Medicine is a sub-tab of Health, not a Home section: renderHomeMeds is reached through
  // renderHealth. Read the row a parent actually looks at, not the string a function returns.
  const openMeds = () => page.evaluate(() => { go('health'); setHealthTab('meds'); });
  const medRow = () => page.evaluate(() => {
    const c = [].slice.call(document.querySelectorAll('#scroll .med-card')).find((x) => /Amoxicillin/.test(x.textContent));
    return c ? c.textContent.replace(/\s+/g, ' ').trim() : '';
  });
  // The sheet, never document.body: body.textContent carries the inline script's own source, so a
  // regex over it will happily match the very string it is meant to prove absent.
  const sheet = () => page.evaluate(() => {
    const s = document.getElementById('sheet');
    if (!s || !s.classList.contains('show')) return { open: false, txt: '', clicks: [] };
    return { open: true, txt: (s.textContent || '').replace(/\s+/g, ' ').trim(),
      clicks: [].slice.call(s.querySelectorAll('[onclick]')).map((b) => ({ t: (b.textContent || '').replace(/\s+/g, ' ').trim(), c: b.getAttribute('onclick') || '' })) };
  });

  console.log('\n1. reopening asks first, and keeps the day they got better');
  {
    await load(seed({ illnesses: [ill({ name: 'Cold' })] }));
    await openHealth();
    const row = await page.evaluate(() => {
      const r = [].slice.call(document.querySelectorAll('#scroll .tl-item')).map((x) => x.getAttribute('onclick') || '');
      return { rows: r.length, reopen: r.filter((c) => /reopenIllness/.test(c)).length };
    });
    ok('the recovered cold is on screen as a past illness', row.rows === 1 && row.reopen === 1, row);

    await page.evaluate(() => reopenIllness('i1'));
    const s1 = await sheet();
    ok('its sheet offers to reopen it', s1.open && s1.clicks.some((b) => /resumeIllness/.test(b.c)), s1);

    const asked = await page.evaluate(() => {
      const before = state.illnesses[0].endedAt;
      resumeIllness('i1');
      const s = document.getElementById('sheet');
      return { before, after: state.illnesses[0].endedAt,
        open: !!(s && s.classList.contains('show')),
        txt: (s ? s.textContent : '').replace(/\s+/g, ' ').trim() };
    });
    ok('tapping it asks before it changes anything', asked.open === true, asked.txt.slice(0, 160));
    ok('and nothing is written until she answers', asked.after === asked.before && asked.after > 0, asked);
    ok('the question names the illness', /Reopen the Cold\?/.test(asked.txt), asked.txt.slice(0, 160));
    ok('and says the recovery date stays on the record', /recovery date of .* stays on the record/i.test(asked.txt), asked.txt.slice(0, 300));
    ok('it says what happens, warmly, with no jargon and no em-dash', /goes back to being the illness you are tracking/i.test(asked.txt) && asked.txt.indexOf('—') < 0, asked.txt.slice(0, 300));

    const backedOut = await page.evaluate(() => { closeSheet(); return state.illnesses[0].endedAt; });
    ok('backing out leaves the record exactly as it was', backedOut === asked.before, { backedOut, was: asked.before });

    const done = await page.evaluate(() => {
      const was = state.illnesses[0].endedAt;
      reopenIllness('i1'); resumeIllness('i1'); __confirmYes();
      return new Promise((r) => setTimeout(() => {
        const i = state.illnesses[0];
        r({ was, endedAt: i.endedAt, hist: i.history || [], editedBy: i.editedBy, editedAt: i.editedAt });
      }, 250));
    });
    ok('confirming does reopen it', done.endedAt === null, done);
    // Indexed defensively on purpose: with the pre-fix code there is no history at all, and a gate
    // that throws on the broken tree reports nothing instead of reporting the breakage.
    const h0 = done.hist[0] || {};
    ok('the recovery date is kept, not destroyed', done.hist.length === 1 && h0.field === 'endedAt' && h0.from === done.was && done.was > 0, done);
    ok('and the history says who reopened it and when', h0.to === null && !!h0.by && h0.at > 0 && done.editedBy === h0.by, done);

    await openHealth();
    const after = await page.evaluate(() => ({
      lbl: (document.querySelector('#scroll .med-due .nm') || {}).textContent || '',
      past: document.querySelectorAll('#scroll .tl-item[onclick*="reopenIllness"]').length,
    }));
    ok('it is the illness being tracked again', /Cold/.test(after.lbl), after);
    ok('and it has left the past list, so it is in exactly one place', after.past === 0, after);
  }

  console.log('\n2. it refuses while another illness is still running, and says which');
  {
    await load(seed({ illnesses: [
      ill({ id: 'i1', name: 'Ear infection', startedAt: dayStart(now - 9 * DAY), endedAt: dayStart(now - 7 * DAY) + 9 * HOUR }),
      ill({ id: 'i2', name: 'Cold', startedAt: dayStart(now - 2 * DAY), endedAt: null }),
    ] }));
    await openHealth();
    await page.evaluate(() => reopenIllness('i1'));
    const s = await sheet();
    ok('the sheet still opens on the ear infection', s.open === true, s.txt.slice(0, 120));
    ok('it does not offer a reopen button', !s.clicks.some((b) => /resumeIllness/.test(b.c)), s.clicks);
    ok('it says which record is in the way, by name', /The Cold is still going/.test(s.txt), s.txt.slice(0, 240));
    ok('and it says what to do about it', /Mark that one recovered first/i.test(s.txt), s.txt.slice(0, 240));
    ok('the other two doors on the sheet still work', s.clicks.some((b) => /openIllnessStart/.test(b.c)) && s.clicks.some((b) => /deleteIllness/.test(b.c)), s.clicks);

    // The button is not the rule. A deep link, a stale sheet or a mis-tap is the second door.
    const forced = await page.evaluate(() => {
      const was = state.illnesses.find((x) => x.id === 'i1').endedAt;
      window.__toasts = [];
      resumeIllness('i1');
      return new Promise((r) => setTimeout(() => r({ was, endedAt: state.illnesses.find((x) => x.id === 'i1').endedAt,
        open: state.illnesses.filter((x) => !x.endedAt).length, toasts: window.__toasts.slice() }), 250));
    });
    ok('calling it directly refuses too', forced.endedAt === forced.was && forced.was > 0, forced);
    ok('it does not refuse silently', forced.toasts.some((t) => /still going/i.test(t)), forced.toasts);
    ok('and only one illness is running', forced.open === 1, forced);

    await openHealth();
    const reach = await page.evaluate(() => ({
      active: (document.querySelector('#scroll .med-due .nm') || {}).textContent || '',
      past: [].slice.call(document.querySelectorAll('#scroll .tl-item[onclick*="reopenIllness"]')).map((x) => x.textContent.replace(/\s+/g, ' ').trim()),
    }));
    ok('the cold is still the one being tracked', /Cold/.test(reach.active), reach);
    ok('and the ear infection is still reachable, not stranded', reach.past.length === 1 && /Ear infection/.test(reach.past[0]), reach);
  }

  console.log('\n3. it refuses when a later illness was logged after it');
  {
    await load(seed({ illnesses: [
      ill({ id: 'i1', name: 'Cold', startedAt: dayStart(now - 12 * DAY), endedAt: dayStart(now - 10 * DAY) + 9 * HOUR }),
      ill({ id: 'i2', name: 'Tummy bug', startedAt: dayStart(now - 5 * DAY), endedAt: dayStart(now - 3 * DAY) + 9 * HOUR }),
    ] }));
    await openHealth();
    await page.evaluate(() => reopenIllness('i1'));
    const older = await sheet();
    ok('the older record does not offer a reopen', !older.clicks.some((b) => /resumeIllness/.test(b.c)), older.clicks);
    ok('and it explains why, naming the record in the way', /You logged the Tummy bug after this one/.test(older.txt), older.txt.slice(0, 260));
    ok('it offers the way forward instead of a dead end', /Log a new illness instead/.test(older.txt), older.txt.slice(0, 260));

    await page.evaluate(() => { closeSheet(); reopenIllness('i2'); });
    const newest = await sheet();
    // Paired with the two absences above: the control is absent where it would break the record and
    // present where it works, so "no button anywhere" cannot pass this section.
    ok('the most recent record does still offer it', newest.clicks.some((b) => /resumeIllness/.test(b.c)), newest.clicks);

    const both = await page.evaluate(() => {
      closeSheet(); window.__toasts = [];
      const was = state.illnesses.find((x) => x.id === 'i1').endedAt;
      resumeIllness('i1');
      return new Promise((r) => setTimeout(() => r({ was, endedAt: state.illnesses.find((x) => x.id === 'i1').endedAt, toasts: window.__toasts.slice() }), 250));
    });
    ok('forcing it still refuses, and says so', both.endedAt === both.was && both.toasts.some((t) => /Tummy bug/.test(t)), both);
  }

  console.log('\n3b. a record the old reopen already stranded is reachable again');
  {
    // Exactly the shape the old one-line reopen left behind: two episodes open at once, the later
    // one on the card, the earlier one in neither list and its recovery date already gone.
    await load(seed({ illnesses: [
      ill({ id: 'i1', name: 'Ear infection', startedAt: dayStart(now - 9 * DAY), endedAt: null }),
      ill({ id: 'i2', name: 'Cold', startedAt: dayStart(now - 2 * DAY), endedAt: null }),
    ] }));
    await openHealth();
    const seen = await page.evaluate(() => ({
      active: (document.querySelector('#scroll .med-due .nm') || {}).textContent || '',
      past: [].slice.call(document.querySelectorAll('#scroll .tl-item[onclick*="reopenIllness"]')).map((x) => x.textContent.replace(/\s+/g, ' ').trim()),
    }));
    ok('the cold is on the card, as before', /Cold/.test(seen.active), seen);
    ok('and the stranded ear infection is on screen, once', seen.past.length === 1 && /Ear infection/.test(seen.past[0]), seen);
    ok('the row says nobody ever marked it better', /not marked better yet/.test(seen.past[0] || ''), seen.past);

    await page.evaluate(() => reopenIllness('i1'));
    const s = await sheet();
    ok('its sheet offers the door it needs, not a reopen', s.open && s.clicks.some((b) => /endIllness/.test(b.c)) && !s.clicks.some((b) => /resumeIllness/.test(b.c)), s.clicks);
    ok('and it can still be deleted', s.clicks.some((b) => /deleteIllness/.test(b.c)), s.clicks);

    const closed = await page.evaluate(() => {
      endIllness('i1');
      return { endedAt: state.illnesses.find((x) => x.id === 'i1').endedAt, open: state.illnesses.filter((x) => !x.endedAt).length };
    });
    ok('marking it recovered works', closed.endedAt > 0 && closed.open === 1, closed);
  }

  console.log('\n4. a dose stamped in the future is not "the last dose"');
  {
    // 12:00 was really given. 20:00 is tonight's ritual, ticked early at 13:00.
    await load(seed({ meds: [amox()], events: [
      dose({ id: 'd1', time: at(12, 0) }),
      dose({ id: 'd2', time: at(20, 0) }),
    ] }));
    const r = await page.evaluate(() => {
      const l = lastDose('m1');
      return { t: l ? l.time : null, line: lastDoseLine(medById('m1')), all: medDoses(medById('m1')).length };
    });
    ok('both rows are still on record, nothing was deleted', r.all === 2, r);
    ok('the last dose is the one that was actually given', r.t === at(12, 0), { got: r.t, want: at(12, 0), future: at(20, 0) });
    ok('the row says 12:00 PM', /12:00 PM/.test(r.line), r.line);
    ok('and never claims tonight\'s 8:00 PM dose was given', !/8:00 PM/.test(r.line), r.line);

    await openMeds();
    const home = await medRow();
    ok('the medicine row on screen exists and shows the real last dose', /Last dose 12:00 PM/.test(home), home);
    ok('and does not show the future one there', home.length > 0 && !/Last dose 8:00 PM/.test(home), home);
  }

  console.log('\n5. it does not push the course along');
  {
    await load(seed({ meds: [amox({ pattern: { type: 'everyX', hours: 6 } })], events: [
      dose({ id: 'd1', time: at(12, 0) }),
      dose({ id: 'd2', time: at(20, 0) }),
    ] }));
    const due = await page.evaluate(() => medNextDue(medById('m1')));
    ok('the next dose is six hours after the real one, at 6:00 PM', due === at(18, 0), { got: due, want: at(18, 0), ifFutureCounted: at(20, 0) + 6 * 3600000 });
    ok('it is not anchored on the dose that has not happened', due !== at(20, 0) + 6 * HOUR, due);
    await openMeds();
    const shown = await medRow();
    ok('and the row says Next 6:00 PM', /Next 6:00 PM/.test(shown), shown);
  }

  console.log('\n6. it does not cancel a set-time slot that genuinely passed');
  {
    const daily = { type: 'daily', times: ['08:00', '20:00'] };
    await load(seed({ meds: [amox({ pattern: daily })], events: [dose({ id: 'd2', time: at(20, 0) })] }));
    const missed = await page.evaluate(() => medNextDue(medById('m1')));
    ok('this morning\'s 8am dose is still owed', missed === at(8, 0), { got: missed, want: at(8, 0), ifFutureCounted: at(20, 0) });
    await openMeds();
    const row = await medRow();
    ok('and the row says so plainly', /overdue/i.test(row), row);

    // Paired the other way, or "always overdue" would pass the assertion above for free.
    await load(seed({ meds: [amox({ pattern: daily })], events: [dose({ id: 'd0', time: at(8, 5) }), dose({ id: 'd2', time: at(20, 0) })] }));
    const covered = await page.evaluate(() => medNextDue(medById('m1')));
    ok('a real 8:05 dose does clear that slot', covered === at(20, 0), { got: covered, want: at(20, 0) });
  }

  console.log('\n7. it does not raise the "already logged" question about a dose nobody gave');
  {
    await load(seed({ meds: [amox()], events: [dose({ id: 'd2', time: at(20, 0) })] }));
    const before = await page.evaluate(() => state.events.filter((e) => e.type === 'medicine' && !e.deleted).length);
    await page.evaluate(() => logDose('m1'));
    await sleep(200);
    const s = await sheet();
    ok('no question is raised', s.open === false, s.txt.slice(0, 220));
    ok('and no negative interval is printed anywhere', !/-\d+[hms]\s*ago/.test(s.txt), s.txt.slice(0, 220));
    const after = await page.evaluate(() => state.events.filter((e) => e.type === 'medicine' && !e.deleted).length);
    ok('the dose she is giving now is written straight down', after === before + 1, { before, after });
    await openMeds();
    const rowNow = await medRow();
    ok('and the row now shows a dose at 1:00 PM', /Last dose 1:00 PM/.test(rowNow), rowNow);

    // The guard itself is not switched off: a genuinely recent dose still earns the one question.
    await load(seed({ meds: [amox()], events: [dose({ id: 'd1', time: now - 40 * MIN })] }));
    await page.evaluate(() => logDose('m1'));
    await sleep(200);
    const s2 = await sheet();
    ok('a real dose 40 minutes ago still raises it', s2.open === true && /A dose is already logged/.test(s2.txt), s2.txt.slice(0, 220));
    ok('with a sane interval, not a negative one', /40m ago/.test(s2.txt), s2.txt.slice(0, 220));
  }

  console.log('\n8. it is not counted as medicine given this illness');
  {
    await load(seed({
      illnesses: [ill({ id: 'i1', name: 'Chest infection', startedAt: dayStart(now - 3 * DAY), endedAt: null })],
      meds: [amox()],
      events: [dose({ id: 'd1', time: at(12, 0) }), dose({ id: 'd2', time: at(20, 0) })],
    }));
    await openHealth();
    const card = await page.evaluate(() => {
      const t = [].slice.call(document.querySelectorAll('#scroll .sec-title')).find((x) => /Medicine given this illness/i.test(x.textContent));
      if (!t) return { found: false, rows: [] };
      const rows = []; let n = t.nextElementSibling;
      while (n && !n.classList.contains('sec-title')) { if (n.classList.contains('tl-item')) rows.push(n.textContent.replace(/\s+/g, ' ').trim()); n = n.nextElementSibling; }
      return { found: true, rows };
    });
    ok('the card does have a medicine section', card.found === true, card);
    ok('and it lists exactly one dose', card.rows.length === 1, card);
    ok('the one that was given, at 12:00 PM', /12:00 PM/.test(card.rows[0] || ''), card.rows);
    ok('never tonight\'s 8:00 PM', card.rows.every((t) => !/8:00 PM/.test(t)) && card.rows.length === 1, card.rows);

    // The doctor page. illnessSummary was already bounded at the end of the episode, so this half is
    // a regression guard rather than a fix, and it is green on both sides of the change.
    const doc = await page.evaluate(() => illnessSummary(now() - 14 * 86400000, now()));
    const given = (doc.split('\n').find((l) => /Given during it:/.test(l)) || '');
    ok('the doctor page names the medicine', /Amoxicillin/.test(given), given);
    ok('and counts it once, not twice', !/x2/.test(given), given);

    // Paired: two doses that really were given DO read as two, so "never x2" is not free.
    await load(seed({
      illnesses: [ill({ id: 'i1', name: 'Chest infection', startedAt: dayStart(now - 3 * DAY), endedAt: null })],
      meds: [amox()],
      events: [dose({ id: 'd1', time: at(6, 0) }), dose({ id: 'd3', time: at(12, 0) })],
    }));
    const two = await page.evaluate(() => illnessSummary(now() - 14 * 86400000, now()));
    ok('two real doses do read as two', /Amoxicillin 5 ml x2/.test(two), (two.split('\n').find((l) => /Given during it:/.test(l)) || ''));
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));

  if (SELF_TEST) {
    /* Both rules put back the way they were, inside the live page, so the assertions above are
       proved failable rather than merely green. A gate nobody has watched go red is not evidence. */
    console.log('\nself-test: the pre-fix code, back inside the running app');
    {
      await load(seed({ illnesses: [ill({ name: 'Cold' })] }));
      const r = await page.evaluate(() => {
        window.resumeIllness = function (id) { const i = (state.illnesses || []).find((x) => x.id === id); if (i) i.endedAt = null; persist(); closeSheet(); healthTab = 'illness'; render(); };
        const was = state.illnesses[0].endedAt;
        resumeIllness('i1');
        const s = document.getElementById('sheet');
        const i = state.illnesses[0];
        return { was, endedAt: i.endedAt, hist: (i.history || []).length, asked: !!(s && s.classList.contains('show')) };
      });
      red('the old reopen asked nothing', r.asked === false, r);
      red('and destroyed the recovery date with nothing kept', r.endedAt === null && r.hist === 0 && r.was > 0, r);
    }
    {
      await load(seed({ meds: [amox()], events: [dose({ id: 'd1', time: at(12, 0) }), dose({ id: 'd2', time: at(20, 0) })] }));
      const r = await page.evaluate(() => {
        window.lastDose = function (medId) {
          const m = medById(medId), bid = (m && m.babyId) || state.activeBabyId;
          return (state.events || []).filter((e) => e && !e.deleted && e.type === 'medicine' && e.medId === medId && e.babyId === bid).sort((a, b) => b.time - a.time)[0];
        };
        return { line: lastDoseLine(medById('m1')), due: medNextDue(medById('m1')) };
      });
      red('the old lastDose read the future dose as given', /8:00 PM/.test(r.line), r.line);
      red('and pushed the next dose to 2:00 AM', r.due === at(20, 0) + 6 * 3600000, { got: r.due, want: at(20, 0) + 6 * 3600000 });
    }
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (SELF_TEST) console.log('self-test: ' + (selfBad ? selfBad + ' probe(s) could not go red' : 'all 4 probes proved failable'));
  console.log((fail || selfBad) ? 'ILLNESS-DOSE-INTEGRITY: FAIL' : 'ILLNESS-DOSE-INTEGRITY: PASS');
  process.exit((fail || selfBad) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
