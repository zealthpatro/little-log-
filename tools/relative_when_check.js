#!/usr/bin/env node
/* "Actually that was twenty minutes ago" used to cost two nested scrollers.
 *
 * openWhenPicker is the one "when did this happen" control behind every log sheet, and the only way
 * to move a time by twenty minutes was to drag a sixty-cell minute column through a 200px window:
 * 3020px of content, so 3:12 to 2:45 is 1584px of one-handed scrolling, at 3am, with a baby on the
 * other arm. Above it sat a full month calendar taking 357px to answer a question that is almost
 * never the one that is wrong about a nappy logged ten minutes late.
 *
 * So: five relative chips that set the time and close in one tap, and the month grid folded behind
 * one row unless the value handed in is genuinely somewhere else in the year. The columns underneath
 * are untouched, because "quarter past" still has to be reachable.
 *
 * The clock is pinned to 01:20 so the midnight case is the ordinary case: at 01:20, "2 hours ago" is
 * yesterday, and a chip that only moved the time would file last night's feed on the wrong day.
 * Pinning the hour is not enough on its own: block 13 leaves the host timezone entirely and replays
 * the chips through a daylight-saving fall-back, where the same wall clock happens twice.
 *
 *   PORT=9563 node tools/serve.js &
 *   node tools/relative_when_check.js http://localhost:9563
 *
 * The url is required, with no default. A worktree that grades whatever happens to hold a hardcoded
 * port grades another checkout, and this repo has watched that pass a tree it never loaded.
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2];
if (!BASE) {
  console.error('usage: node tools/relative_when_check.js http://localhost:<port>   (no default: name the tree you mean)');
  process.exit(2);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, MIN = 60000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

// 01:20, the hour this control is actually used in, and the hour where "2 hours ago" is yesterday.
// The DAY is pinned too, and that is not tidiness. It floated before, and on the 1st of the month the
// grid block below picked "day 2", which is TOMORROW, and the calendar correctly refuses a future date
// (app/cubby-extras.js:536 says so in as many words). So this gate went red on 1 September against
// perfectly good code, reporting a broken date picker that was never broken. Mid-month, and the
// whole class of month-boundary flakes goes with it.
const CLOCK = (() => { const d = new Date(); d.setDate(15); d.setHours(1, 20, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

const seed = (over) => Object.assign({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 90 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
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
    await sleep(1400);
  };

  /* The picker is always reached the way a parent reaches it: open a real log sheet, tap the real
     time strip. Calling openWhenPicker straight would test a function, not a door. */
  const openViaNappySheet = async () => {
    await page.evaluate(() => { closeSheet(); openDiaper(); });
    await sleep(450);
    await page.click('.time-strip');
    await sleep(250);
  };
  const modalUp = () => page.evaluate(() => !!document.getElementById('cuModalOv'));
  /* Every tap goes through here and reports whether there was anything to tap. A gate that throws on
     the first missing control never reaches the other twelve things it was written to check, so the
     absence of a control is an assertion like any other and the run carries on past it. */
  const tap = async (sel) => {
    const there = await page.evaluate((s) => !!document.querySelector(s), sel);
    if (there) await page.click(sel);
    await sleep(150);
    return there;
  };
  const chipLabels = () => page.evaluate(() => Array.from(document.querySelectorAll('.cu-relrow .cu-rel')).map((b) => b.textContent.trim()));
  /* Every relative assertion is made against the page's own clock at the moment of reading, so a
     second lost to a click cannot make a true value look false, and a chip that quietly rounded to
     the wrong minute still cannot pass. */
  const agoFacts = (ms) => page.evaluate((v) => {
    const n = Date.now(); const d = new Date(v); const t = new Date(n);
    return { v, delta: n - v, secondsDropped: v % 60000 === 0,
      day: d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(),
      today: t.getFullYear() + '-' + (t.getMonth() + 1) + '-' + t.getDate(),
      yesterday: (() => { const y = new Date(n - 86400000); return y.getFullYear() + '-' + (y.getMonth() + 1) + '-' + y.getDate(); })() };
  }, ms);
  const inWindow = (f, mins) => f.delta >= mins * MIN && f.delta < (mins + 1) * MIN;

  console.log('\n1. the shortcuts are there, and the columns underneath are untouched');
  {
    await load(seed());
    await openViaNappySheet();
    ok('tapping the time strip opens the picker', await modalUp() === true);
    const labels = await chipLabels();
    ok('there are exactly five relative chips', labels.length === 5, labels);
    ok('and they read as a parent would say it', JSON.stringify(labels) === JSON.stringify(['Just now', '15 minutes ago', '30 minutes ago', '1 hour ago', '2 hours ago']), labels);
    /* One row, one register. "15 min ago" next to "1 hour ago" abbreviates the minutes and spells out
       the hours, so five pills read in one glance switch from a unit symbol to a word halfway across. */
    ok('minutes are spelled out, like the hours beside them', labels.every((l) => !/\bmin\b/.test(l)), labels);
    const geom = await page.evaluate(() => {
      const top = (s) => { const el = document.querySelector(s); return el ? el.getBoundingClientRect().top : null; };
      return { rowTop: top('.cu-relrow'), colTop: top('.cu-time'), dispTop: top('#cuWDisp'),
        mins: document.querySelectorAll('#cuM .cu-tcell').length,
        hours: document.querySelectorAll('#cuH .cu-tcell').length,
        ampm: document.querySelectorAll('.cu-tap .cu-tcell').length };
    });
    ok('the row sits above the columns, not below them', geom.rowTop !== null && geom.rowTop < geom.colTop, geom);
    ok('and under the time it is changing, so it reads as a shortcut', geom.rowTop !== null && geom.rowTop > geom.dispTop, geom);
    ok('the minute column still has all sixty minutes', geom.mins === 60, geom);
    ok('the hour column still has all twelve hours', geom.hours === 12, geom);
    ok('AM and PM are still there', geom.ampm === 2, geom);
  }

  console.log('\n2. one tap says it, and the sheet gets out of the way');
  {
    ok('there is a "30 min ago" to tap', await tap('.cu-relrow .cu-rel[data-mins="30"]') === true);
    ok('the picker closes on the tap, no second Done', await modalUp() === false);
    const got = await page.evaluate(() => getWhen('when'));
    const f = await agoFacts(got);
    ok('the time is thirty minutes back, to the minute', inWindow(f, 30), f);
    ok('with seconds dropped, exactly as Done would write it', f.secondsDropped === true, f);
    const strip = await page.evaluate(() => {
      const el = document.querySelector('.ts-label[data-slot="when"]');
      return { label: el ? el.textContent.trim() : null, expect: whenLabel(getWhen('when')) };
    });
    ok('the strip behind the sheet says the new time', strip.label === strip.expect && !!strip.label, strip);

    const ev = await page.evaluate(() => { saveDiaper('wet'); const e = state.events.filter((x) => x.type === 'diaper'); return { n: e.length, time: e[0] && e[0].time }; });
    ok('one nappy is written', ev.n === 1, ev);
    const ef = await agoFacts(ev.time);
    ok('and it is stamped thirty minutes ago, not now', inWindow(ef, 30), ef);
  }

  console.log('\n3. reloading keeps the time she chose');
  {
    /* store-firebase swaps persist() for a cloud push, so nothing this browser writes reaches
       localStorage on its own. The state is mirrored by hand and reloaded, which is the part that
       actually matters here: the picker has to hand back a plain number. A Date object or a NaN
       both survive in memory and both come back null through JSON, and the nappy loses its time. */
    const before = await page.evaluate(() => {
      localStorage.setItem('little-log-v1', JSON.stringify(state));
      return state.events.filter((e) => e.type === 'diaper')[0].time;
    });
    ok('what was written is a plain number, storable as it stands', typeof before === 'number' && Number.isFinite(before), before);
    await page.reload({ waitUntil: 'networkidle2' }); await sleep(1400);
    const after = await page.evaluate(() => { const e = state.events.filter((x) => x.type === 'diaper'); return { n: e.length, time: e[0] && e[0].time }; });
    ok('the nappy survives the reload', after.n === 1, after);
    ok('with the same stamp, not re-stamped to load time', after.time === before, { before, after });
    const f = await agoFacts(after.time);
    ok('and it still reads as half an hour ago after the reload', inWindow(f, 30), f);
  }

  console.log('\n4. "just now" can never land in the future');
  {
    await load(seed());
    await openViaNappySheet();
    ok('there is a "Just now" to tap', await tap('.cu-relrow .cu-rel[data-mins="0"]') === true);
    const f = await agoFacts(await page.evaluate(() => getWhen('when')));
    /* Two minutes, not sixty. The window used to read `f.delta < 60 * MIN` with MIN = 60000, so it
       spanned a full hour: a "Just now" that silently wrote 45 minutes ago passed this line. One
       whole minute for the truncation, one more for the click and the read. */
    ok('it is now, or the last whole minute, never ahead of the clock', f.delta >= 0 && f.delta < 2 * MIN, f);
    /* The strip seeds itself from now() with milliseconds on it, so a clean minute is proof a chip
       wrote this rather than proof the fallback was left where it was. */
    ok('and it is a clean minute, written by the chip, not the raw clock the strip seeded', f.secondsDropped === true, f);
    ok('and it is stamped today', f.day === f.today, f);
  }

  console.log('\n5. at twenty past one, two hours ago is yesterday');
  {
    await load(seed());
    await openViaNappySheet();
    const clock = await page.evaluate(() => { const d = new Date(); return d.getHours() + ':' + d.getMinutes(); });
    ok('the clock really is in the small hours', /^1:2\d$/.test(clock), clock);
    ok('there is a "2 hours ago" to tap', await tap('.cu-relrow .cu-rel[data-mins="120"]') === true);
    const f = await agoFacts(await page.evaluate(() => getWhen('when')));
    ok('two hours back is a true two hours, not a wrapped clock face', inWindow(f, 120), f);
    ok('and it is filed under yesterday, where it happened', f.day === f.yesterday, f);
  }

  console.log('\n6. one hour ago, on the other side of the same midnight, stays today');
  {
    await load(seed());
    await openViaNappySheet();
    ok('there is a "1 hour ago" to tap', await tap('.cu-relrow .cu-rel[data-mins="60"]') === true);
    const f = await agoFacts(await page.evaluate(() => getWhen('when')));
    ok('an hour back is an hour', inWindow(f, 60), f);
    ok('and it is a clean minute, written by the chip', f.secondsDropped === true, f);
    ok('and 00:20 is still today', f.day === f.today, f);
  }

  console.log('\n7. the month grid is folded away, and one row opens it');
  {
    await load(seed());
    await openViaNappySheet();
    const shut = await page.evaluate(() => {
      const w = document.getElementById('cuCalWrap'), t = document.getElementById('cuCalToggle');
      return { display: getComputedStyle(w).display, h: w.getBoundingClientRect().height,
        label: t ? t.textContent.trim() : null, expanded: t ? t.getAttribute('aria-expanded') : null,
        cells: document.querySelectorAll('#cuCal .dp-c[data-d]').length };
    });
    ok('the calendar is not on screen for a time logged today', shut.display === 'none', shut);
    ok('and takes no height, so the columns come up the sheet', shut.h === 0, shut);
    ok('the row that opens it says what it is for', shut.label === 'A different day', shut);
    ok('and announces itself as shut', shut.expanded === 'false', shut);
    ok('the grid is still built, so opening it costs nothing', shut.cells >= 28, shut);

    const before = await page.evaluate(() => document.getElementById('cuWDisp').textContent.trim());
    ok('there is a row to tap', await tap('#cuCalToggle') === true);
    const open = await page.evaluate(() => {
      const w = document.getElementById('cuCalWrap'), t = document.getElementById('cuCalToggle');
      return { display: w ? getComputedStyle(w).display : null, h: w ? w.getBoundingClientRect().height : 0,
        label: t ? t.textContent.trim() : null, expanded: t ? t.getAttribute('aria-expanded') : null,
        disp: document.getElementById('cuWDisp').textContent.trim() };
    });
    // The transition, not the end state: a calendar that was never hidden is also "not hidden now".
    ok('one tap brings the month back', shut.display === 'none' && open.display === 'block' && open.h > 100, { shut, open });
    ok('the row now offers to put it away again', open.label === 'Hide the calendar', open);
    ok('and announces itself as open', open.expanded === 'true', open);
    ok('opening the calendar does not touch the chosen time', open.disp === before, { before, open });

    await tap('#cuCalToggle');
    const shutAgain = await page.evaluate(() => ({ display: getComputedStyle(document.getElementById('cuCalWrap')).display, disp: document.getElementById('cuWDisp').textContent.trim() }));
    ok('and it folds away again', shutAgain.display === 'none', shutAgain);
    ok('still without touching the chosen time', shutAgain.disp === before, { before, shutAgain });
  }

  console.log('\n8. a date that is not today or yesterday opens with the month already showing');
  {
    await load(seed());
    /* The state of this sheet is measured against the ordinary one, not on its own. A calendar that
       was never hidden is also "showing from the start", and a shortcut row that is always there is
       also "there for a log made today": both halves are read in the same block so the claim is the
       difference between the two doors and cannot pass on code that has no difference to make. */
    const readSheet = () => page.evaluate(() => {
      const h = document.querySelector('#cuModalOv .cu-head h2'), w = document.getElementById('cuCalWrap'), t = document.getElementById('cuCalToggle');
      return { title: h ? h.textContent.trim() : null,
        display: w ? getComputedStyle(w).display : null,
        label: t ? t.textContent.trim() : null,
        expanded: t ? t.getAttribute('aria-expanded') : null,
        rels: document.querySelectorAll('.cu-relrow .cu-rel').length,
        cap: (document.querySelector('.cu-relcap') || {}).textContent };
    });
    await page.evaluate(() => { openWhenPicker(Date.now(), function () {}, 'Time'); });
    await sleep(200);
    const today = await readSheet();
    await page.evaluate(() => cuCloseModal());
    // The born-date door: openWhenPicker is handed a value months back, and hiding the only control
    // that shows where in the year she is would be worse than the scrolling it saves.
    await page.evaluate(() => { window.__pick = null; openWhenPicker(Date.now() - 90 * 86400000, function (m) { window.__pick = m; }, 'Born on'); });
    await sleep(200);
    const born = await readSheet();
    ok('it is the born-date door', born.title === 'Born on', born);
    ok('the month is showing from the start, where a log made today hides it', today.display === 'none' && born.display === 'block', { today, born });
    ok('and the row offers to hide it, not to open it', born.label === 'Hide the calendar' && born.expanded === 'true', born);
    /* "Just now" as the first control on a date months back is one tap from rewriting a baby's
       birthday, with no confirmation and nothing to undo it with. The shortcuts belong to the sheet
       that is logging a moment, so they go where the calendar comes. */
    ok('and the one-tap shortcuts are gone, where a log made today has all five', today.rels === 5 && born.rels === 0, { today, born });
    ok('and the caption goes with them, not left over a row that is not there', !!today.cap && born.cap === undefined, { today, born });
    await page.evaluate(() => cuCloseModal());

    // The caller-side off switch, for a field that is never logging a moment even when it is today's.
    await page.evaluate(() => { openWhenPicker(Date.now(), function () {}, 'Photo date', { rel: false }); });
    await sleep(200);
    const off = await readSheet();
    ok('a caller can turn the shortcuts off outright', off.rels === 0, off);
    ok('without losing the rest of the sheet', off.title === 'Photo date' && off.label === 'A different day', off);
    await page.evaluate(() => cuCloseModal());

    // Yesterday is the boundary: still an ordinary log, so the month stays folded.
    await page.evaluate(() => { openWhenPicker(Date.now() - 86400000, function () {}, 'When?'); });
    await sleep(200);
    const yest = await page.evaluate(() => ({ display: getComputedStyle(document.getElementById('cuCalWrap')).display, disp: document.getElementById('cuWDisp').textContent.trim() }));
    ok('yesterday keeps the month folded', yest.display === 'none', yest);
    ok('and the sheet says so in words instead', /^Yesterday/.test(yest.disp), yest);
    await page.evaluate(() => cuCloseModal());
  }

  console.log('\n9. Today and Yesterday still work, and the new chips did not steal their wiring');
  {
    await load(seed());
    await page.evaluate(() => { window.__pick = null; openWhenPicker(Date.now() - 90 * 86400000, function (m) { window.__pick = m; }, 'When?'); });
    await sleep(200);
    await page.click('.cu-daterow .cu-chip[data-day="-1"]'); await sleep(120);
    const disp = await page.evaluate(() => document.getElementById('cuWDisp').textContent.trim());
    ok('Yesterday still moves the day', /^Yesterday/.test(disp), disp);
    await page.click('#cuWDone'); await sleep(150);
    const f = await agoFacts(await page.evaluate(() => window.__pick));
    ok('and Done writes a real number, not NaN', Number.isFinite(f.v), f);
    ok('landing on yesterday, keeping the time it came in with', f.day === f.yesterday, f);

    await page.evaluate(() => { window.__pick = null; openWhenPicker(Date.now() - 5 * 86400000, function (m) { window.__pick = m; }, 'When?'); });
    await sleep(200);
    await page.click('.cu-daterow .cu-chip[data-day="0"]'); await sleep(120);
    await page.click('#cuWDone'); await sleep(150);
    const f2 = await agoFacts(await page.evaluate(() => window.__pick));
    ok('Today still works too', Number.isFinite(f2.v) && f2.day === f2.today, f2);
  }

  console.log('\n10. the columns still commit by hand, for the times no chip covers');
  {
    await load(seed());
    await openViaNappySheet();
    await tap('#cuCalToggle');   // setup, not an assertion: block 7 already owns the toggle
    // Strictly in the PAST. The calendar refuses a future date, so a day after today is not a
    // selection failure, it is the control working.
    const day = await page.evaluate(() => Math.max(1, new Date().getDate() - 1));
    await page.click('#cuCal .dp-c[data-d="' + day + '"]'); await sleep(120);
    const onDay = await page.evaluate(() => { const on = document.querySelector('#cuCal .dp-c.dp-on'); return on ? +on.getAttribute('data-d') : null; });
    ok('picking a day off the grid selects it', onDay === day, { onDay, day });
    await page.click('#cuH .cu-tcell[data-v="4"]'); await sleep(80);
    await page.click('#cuM .cu-tcell[data-v="45"]'); await sleep(80);
    await page.click('.cu-tap .cu-tcell[data-ap="AM"]'); await sleep(80);
    const disp = await page.evaluate(() => document.getElementById('cuWDisp').textContent.trim());
    ok('the display follows the columns', /4:45 AM$/.test(disp), disp);
    await page.click('#cuWDone'); await sleep(150);
    const out = await page.evaluate(() => { const v = getWhen('when'); const d = new Date(v); return { v, da: d.getDate(), h: d.getHours(), mi: d.getMinutes(), s: d.getSeconds() }; });
    ok('and Done writes exactly that', out.da === day && out.h === 4 && out.mi === 45 && out.s === 0, out);
  }

  console.log('\n11. opening it a second time seeds from the answer, and nothing stacks');
  {
    await load(seed());
    await openViaNappySheet();
    ok('there is a "15 min ago" to tap', await tap('.cu-relrow .cu-rel[data-mins="15"]') === true);
    const first = await page.evaluate(() => getWhen('when'));
    await tap('.time-strip'); await sleep(200);
    const second = await page.evaluate(() => {
      const d0 = document.getElementById('cuWDisp');
      return {
        rels: document.querySelectorAll('.cu-relrow .cu-rel').length,
        rows: document.querySelectorAll('.cu-relrow').length,
        toggles: document.querySelectorAll('#cuCalToggle').length,
        disp: d0 ? d0.textContent.trim() : null,
        expect: (function () { const d = new Date(getWhen('when')); const h = (d.getHours() % 12) || 12; return h + ':' + ('0' + d.getMinutes()).slice(-2) + ' ' + (d.getHours() < 12 ? 'AM' : 'PM'); })(),
      };
    });
    ok('still five chips on the second open, not ten', second.rels === 5, second);
    ok('one shortcut row and one toggle, no leftovers from the first open', second.rows === 1 && second.toggles === 1, second);
    ok('and it opens showing the time she already chose', !!second.disp && second.disp.indexOf(second.expect) > -1, second);
    // A second chip on top of the first is measured from the clock, not from the value already held.
    ok('the second open offers the chips too', await tap('.cu-relrow .cu-rel[data-mins="30"]') === true);
    const f = await agoFacts(await page.evaluate(() => getWhen('when')));
    ok('correcting 15 to 30 gives thirty minutes ago, not forty-five', inWindow(f, 30), { f, first });
  }

  console.log('\n12. the time being chosen never leaves the screen');
  {
    /* The whole point of folding the calendar away is that the sheet fits. It only fits if the card
       is not also scrolled out from under her: scrollIntoView on the selected hour used to drag the
       card up 62px the instant the picker opened, so the title and the date she was setting were
       above the fold before she touched anything. */
    await load(seed());
    await openViaNappySheet();
    await sleep(700);   // the columns scroll smoothly; let them settle before measuring
    const fit = await page.evaluate(() => {
      const card = document.querySelector('.cu-card'), disp = document.getElementById('cuWDisp');
      const h2 = document.querySelector('.cu-card .cu-head h2'), done = document.getElementById('cuWDone');
      const cr = card.getBoundingClientRect();
      const inside = (el) => { const r = el.getBoundingClientRect(); return r.top >= cr.top - 1 && r.bottom <= cr.bottom + 1; };
      return { cardScrollTop: Math.round(card.scrollTop), overflow: card.scrollHeight - Math.round(cr.height),
        title: inside(h2), disp: inside(disp), done: inside(done), vh: innerHeight, cardH: Math.round(cr.height) };
    });
    ok('the whole sheet fits on a 390px phone with nothing to scroll', fit.overflow === 0, fit);
    ok('and it opens at the top instead of jumping', fit.cardScrollTop === 0, fit);
    ok('so the title, the chosen time and Done are all on screen at once', fit.title && fit.disp && fit.done, fit);

    const cols = await page.evaluate(() => {
      const cent = (id) => {
        const c = document.getElementById(id), on = c.querySelector('.cu-tcell.on');
        if (!on) return null;
        const cr = c.getBoundingClientRect(), br = on.getBoundingClientRect();
        return { scrollTop: Math.round(c.scrollTop), off: Math.round((br.top + br.height / 2) - (cr.top + cr.height / 2)),
          inView: br.top >= cr.top - 1 && br.bottom <= cr.bottom + 1, label: on.textContent.trim() };
      };
      return { m: cent('cuM'), h: cent('cuH') };
    });
    ok('the minute column still scrolls itself to the current minute', !!cols.m && cols.m.scrollTop > 0 && Math.abs(cols.m.off) <= 2, cols);
    /* 1am cannot be centred: it is the first cell, and the column runs out of room above it. What
       matters is that it is on screen, which is what the old scrollIntoView also settled for. */
    ok('and the current hour is on screen in its own column', !!cols.h && cols.h.inView === true && cols.h.label === '1', cols);
    await page.click('#cuH .cu-tcell[data-v="8"]'); await sleep(700);
    const hourFar = await page.evaluate(() => {
      const c = document.getElementById('cuH'), on = c.querySelector('.cu-tcell.on');
      const cr = c.getBoundingClientRect(), br = on.getBoundingClientRect();
      return { label: on.textContent.trim(), scrollTop: Math.round(c.scrollTop), off: Math.round((br.top + br.height / 2) - (cr.top + cr.height / 2)),
        card: Math.round(document.querySelector('.cu-card').scrollTop) };
    });
    ok('an hour with room around it is centred in its column', hourFar.label === '8' && hourFar.scrollTop > 0 && Math.abs(hourFar.off) <= 2, hourFar);
    ok('and picking it does not scroll the card either', hourFar.card === 0, hourFar);

    // A minute far from the current one: the column moves, the card must not.
    await page.click('#cuM .cu-tcell[data-v="5"]'); await sleep(700);
    const after = await page.evaluate(() => {
      const c = document.getElementById('cuM'), on = c.querySelector('.cu-tcell.on');
      const cr = c.getBoundingClientRect(), br = on.getBoundingClientRect();
      return { label: on.textContent.trim(), off: Math.round((br.top + br.height / 2) - (cr.top + cr.height / 2)),
        card: Math.round(document.querySelector('.cu-card').scrollTop), disp: document.getElementById('cuWDisp').textContent.trim() };
    });
    ok('tapping a distant minute recentres that column', after.label === '05' && Math.abs(after.off) <= 2, after);
    ok('and does not drag the card up with it', after.card === 0, after);
    ok('and the display says the new minute', /:05 (AM|PM)$/.test(after.disp), after);

    /* The one sheet that is still taller than the phone is the one opened on a date months back,
       and there the chosen date is pinned so it survives the scroll down to Done. */
    await page.evaluate(() => { cuCloseModal(); openWhenPicker(Date.now() - 90 * 86400000, function () {}, 'Born on'); });
    await sleep(800);
    const born = await page.evaluate(() => {
      const card = document.querySelector('.cu-card');
      card.scrollTop = card.scrollHeight;   // she scrolls down to Done
      const cr = card.getBoundingClientRect(), dr = document.getElementById('cuWDisp').getBoundingClientRect();
      const st = document.querySelector('.cu-stick');
      return { sticky: st ? getComputedStyle(st).position : null,
        onScreen: dr.top >= cr.top - 1 && dr.bottom <= cr.bottom + 1,
        text: document.getElementById('cuWDisp').textContent.trim(),
        scrolled: Math.round(card.scrollTop) > 0 };
    });
    ok('that sheet really does have to be scrolled', born.scrolled === true, born);
    ok('and the date she is setting is still on screen at the bottom of it', born.onScreen === true, born);
    ok('because it is pinned rather than redrawn', born.sticky === 'sticky', born);
    await page.evaluate(() => cuCloseModal());
  }

  console.log('\n13. what pins is the whole top of the card, and nothing shows above it');
  {
    /* Pinning the 49px time line on its own took the sheet's heading off the screen and sliced the
       chip rows through the middle as they slid behind a floating line of type: 23px of a 38px pill
       showing under "Today · 1:20 AM", the sheet no longer saying what it was. It read as a
       rendering fault. This is the reachable state, not a synthetic one: the calendar opens itself
       on any date months back, and that is the one sheet tall enough to have to be scrolled. */
    const band = async (theme) => {
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
      await load(seed());
      await page.evaluate(() => { cuCloseModal && cuCloseModal(); openWhenPicker(Date.now() - 90 * 86400000, function () {}, 'Born on'); });
      await sleep(700);
      const out = [];
      for (const pos of [0, 200, 1e6]) {
        out.push(await page.evaluate((p) => {
          const card = document.querySelector('.cu-card'); card.scrollTop = p;
          const st = document.querySelector('.cu-stick');
          if (!st) return { p, band: null };
          const cr = card.getBoundingClientRect(), sr = st.getBoundingClientRect();
          const h2 = document.querySelector('.cu-card .cu-head h2').getBoundingClientRect();
          const disp = document.getElementById('cuWDisp').getBoundingClientRect();
          /* What is actually painted at the very top of the card. The negative margins that bleed
             the band to the card's edges also shift its sticky constraint, and with top:0 it parked
             18px down: a strip of the card through which the chip rows slid, above the pinned band,
             clipped by the rounded corner. Nobody would call that a design. */
          const hit = document.elementFromPoint(Math.round(cr.left + cr.width / 2), Math.round(cr.top + 4));
          const bg = getComputedStyle(st).backgroundColor;
          return { p, band: true, scrollTop: Math.round(card.scrollTop),
            headIn: h2.top >= cr.top - 1 && h2.bottom <= sr.bottom + 1,
            dispIn: disp.top >= cr.top - 1 && disp.bottom <= sr.bottom + 1,
            flush: Math.round(sr.top - cr.top),
            topIsBand: !!hit && (hit === st || st.contains(hit)),
            topIs: hit ? (hit.className || hit.tagName) : null, bg,
            opaque: /^rgb\(/.test(bg) && !/rgba\([^)]*,\s*0?\.\d+\)/.test(bg),
            shadow: getComputedStyle(st).boxShadow };
        }, pos));
        await sleep(120);
      }
      await page.evaluate(() => cuCloseModal());
      return out;
    };
    for (const theme of ['light', 'dark']) {
      const rows = await band(theme);
      const label = theme === 'light' ? 'in Day' : 'in Night';
      ok('there is one pinned band, not a pinned line ' + label, rows.every((r) => r.band === true), rows);
      ok('the sheet still says what it is at every scroll position ' + label, rows.every((r) => r.headIn === true), rows);
      ok('and the time being set never leaves it ' + label, rows.every((r) => r.dispIn === true), rows);
      ok('the band sits flush to the top of the card ' + label, rows.every((r) => r.flush === 0), rows);
      ok('so the top of the card is the band, not a strip of chips sliding past it ' + label, rows.every((r) => r.topIsBand === true), rows);
      ok('and the band is opaque, not a see-through slab ' + label, rows.every((r) => r.opaque === true), rows);
      ok('with a soft edge, so the overlap reads as deliberate ' + label, rows.every((r) => r.shadow && r.shadow !== 'none'), rows);
    }
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  }

  console.log('\n14. eight pills doing three things: the five that commit look like it');
  {
    /* Every control here rendered as the same 38px outline pill. Five of them file a timestamp and
       shut the sheet, two set only the day, and one opened a drawer while renaming itself. At 3am,
       one-handed, the difference between "this closes and files a time" and "this nudges a field"
       has to be visible before the tap. */
    await load(seed());
    await openViaNappySheet();
    const look = await page.evaluate(() => {
      const cs = (el) => el && getComputedStyle(el);
      const rel = document.querySelector('.cu-rel'), day = document.querySelector('.cu-daterow .cu-chip[data-day]');
      const cap = document.querySelector('.cu-relcap'), tog = document.getElementById('cuCalToggle');
      const card = document.querySelector('.cu-card');
      const r = (el) => el ? el.getBoundingClientRect() : null;
      return {
        relFill: cs(rel) && cs(rel).backgroundColor, dayFill: cs(day) && cs(day).backgroundColor,
        relH: rel ? Math.round(r(rel).height) : 0, dayH: day ? Math.round(r(day).height) : 0,
        cap: cap ? cap.textContent.trim() : null,
        capAbove: cap && rel ? r(cap).bottom <= r(rel).top + 1 : false,
        togIsChip: tog ? tog.classList.contains('cu-chip') : null,
        togH: tog ? Math.round(r(tog).height) : 0,
        togOwnRow: (tog && day) ? r(tog).top >= r(day).bottom - 1 : false,
        togWide: (tog && card) ? Math.round(r(card).width) - Math.round(r(tog).width) <= 41 : false,
        togInDayRow: tog ? !!tog.closest('.cu-daterow') : null,
      };
    });
    ok('the chips that commit are filled, the ones that set a field are not', !!look.relFill && look.relFill !== look.dayFill, look);
    ok('and they are a 44px target, not the 38px one they borrowed', look.relH >= 44, look);
    ok('a caption says the row is a shortcut, not more fields', look.cap === 'Set it in one tap', look);
    ok('and it sits above the row it names', look.capAbove === true, look);
    /* "A different day" is a disclosure, not a third day you can pick. Beside Today and Yesterday it
       read, for one beat, as a value. */
    ok('the calendar row has left the row of days', look.togInDayRow === false && look.togOwnRow === true, look);
    ok('and is a full-width row rather than a pill', look.togIsChip === false && look.togWide === true, look);
    ok('at a 44px target too', look.togH >= 44, look);

    /* Both themes, on the real card fill. The caption is 12.5px, which is normal-size text for AA
       whatever its weight, and the tone the other small labels use came out at 3.23:1 on white. */
    for (const theme of ['light', 'dark']) {
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
      await load(seed());
      await openViaNappySheet();
      const c = await page.evaluate(() => {
        const px = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
        const al = (s) => (s.startsWith('rgba') ? Number(s.match(/,\s*([\d.]+)\)$/)[1]) : 1);
        const lum = (v) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(v[0]) + 0.7152 * f(v[1]) + 0.0722 * f(v[2]); };
        const ratio = (a, b) => { const A = lum(a), B = lum(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };
        // Null-safe: a control this block is about may simply not exist, and a gate that throws
        // there never reaches the blocks after it. Missing reads as 0, which fails, which is right.
        const cs = (s, k) => { const e = document.querySelector(s); return e ? getComputedStyle(e)[k] : 'rgb(0,0,0)'; };
        const card = px(cs('.cu-card', 'backgroundColor'));
        const flat = (s) => { const a = al(s), v = px(s); return a < 1 ? v.map((x, i) => x * a + card[i] * (1 - a)) : v; };
        const there = (s) => !!document.querySelector(s);
        return {
          cap: there('.cu-relcap') ? ratio(px(cs('.cu-relcap', 'color')), card) : 0,
          rel: there('.cu-rel') ? ratio(px(cs('.cu-rel', 'color')), flat(cs('.cu-rel', 'backgroundColor'))) : 0,
          tog: there('.cu-caltog') ? ratio(px(cs('.cu-caltog', 'color')), card) : 0,
        };
      });
      const l = theme === 'light' ? 'in Day' : 'in Night';
      ok('the caption clears AA on the card ' + l, c.cap >= 4.5, c);
      ok('the filled chips clear AA on their own fill ' + l, c.rel >= 4.5, c);
      ok('and so does the calendar row ' + l, c.tog >= 4.5, c);
    }
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await page.evaluate(() => cuCloseModal());
  }

  console.log('\n15. a one-tap "2 hours ago" on Woke up cannot book a 23 hour nap');
  {
    /* savePastSleep rolls "woke up" to the next day whenever it lands at or before "fell asleep",
       which was written when the end strip was a time with no date on it. The chips put any time on
       either strip in one tap, so tapping "2 hours ago" on Woke up while Fell asleep sits an hour
       back turned a slip into a silent 23 hour nap, confirmed with a cheerful toast. The roll is
       kept for the real case, a nap that ends after midnight, and bounded to a length a nap can be. */
    await load(seed());
    await page.evaluate(() => { closeSheet(); openPastSleep(true); }); await sleep(450);
    await page.evaluate(() => { setWhen('when', Date.now() - 60 * 60000); setWhen('end', Date.now() - 120 * 60000); });
    await page.evaluate(() => savePastSleep()); await sleep(250);
    const bad = await page.evaluate(() => ({
      naps: state.events.filter((e) => e.type === 'sleep').length,
      toast: (document.getElementById('toast') || {}).textContent || null,
    }));
    ok('woke up before fell asleep writes nothing at all', bad.naps === 0, bad);
    ok('and says so, warmly, instead of filing 23 hours', /have another look at the times/i.test(bad.toast || ''), bad);

    /* The case the roll exists for: both strips on one date, asleep at 11pm and awake at 1am, so
       the end genuinely belongs to the next morning. Still one nap, still two hours. */
    await load(seed());
    await page.evaluate(() => { closeSheet(); openPastSleep(true); }); await sleep(450);
    await page.evaluate(() => {
      const d = new Date(Date.now() - 86400000); d.setHours(23, 0, 0, 0); setWhen('when', d.getTime());
      const e = new Date(Date.now() - 86400000); e.setHours(1, 0, 0, 0); setWhen('end', e.getTime());
    });
    await page.evaluate(() => savePastSleep()); await sleep(250);
    const good = await page.evaluate(() => { const e = state.events.filter((x) => x.type === 'sleep')[0]; return e ? { n: 1, dur: e.end - e.time } : { n: 0 }; });
    ok('a nap that ends after midnight is still logged', good.n === 1, good);
    ok('and is two hours long, not twenty six', good.dur === 2 * 3600000, good);
  }

  console.log('\n16. the night the clocks go back, on the second pass through 1am');
  {
    /* Pinning the hour fixes the hour and leaves the zone to whatever machine is running the gate.
       So this block leaves the host timezone entirely. America/New_York, 2026-11-01 01:15:04 EST:
       the second pass through 1am, after 02:00 EDT rolled back to 01:00. Local y/mo/da/h/m is not a
       bijection in that hour, so a chip that computed the right instant, spread it over wall-clock
       components and rebuilt it landed on the FIRST 1:15, an hour earlier than the clock in her hand.
       Measured on the un-fixed code: "Just now" filed 60 minutes back and "15 minutes ago" 75.

       The label is a separate thing and is not fixable here: during the repeated hour "1:45 AM"
       really is 30 minutes ago, and no picker can say which 1:45 it means without naming the zone.
       What is asserted is the instant, which is the thing that gets stored, sorted and read back. */
    const TARGET = Date.UTC(2026, 10, 1, 6, 15, 4);   // 01:15:04 EST, the repeated hour
    const p2 = await browser.newPage();
    const errs2 = []; p2.on('pageerror', (e) => errs2.push(e.message));
    await p2.emulateTimezone('America/New_York');
    await p2.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await p2.evaluateOnNewDocument((shift) => {
      const R = Date;
      function D(...a) { return a.length === 0 ? new R(R.now() + shift) : new R(...a); }
      D.prototype = R.prototype; D.now = () => R.now() + shift; D.parse = R.parse; D.UTC = R.UTC;
      window.Date = D;
    }, TARGET - Date.now());
    await p2.setViewport({ width: 390, height: 844 });
    await p2.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });
    await p2.evaluate(() => localStorage.setItem('cubby-quick-uid', 'local'));
    await p2.evaluate((x) => localStorage.setItem('little-log-v1', JSON.stringify(x)),
      seed({ babies: [{ id: 'b1', name: 'Robin', birth: TARGET - 90 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }] }));
    await p2.reload({ waitUntil: 'networkidle2' }); await sleep(1400);

    const where = await p2.evaluate(() => {
      const d = new Date();
      return { off: d.getTimezoneOffset(), h: d.getHours(), m: d.getMinutes(), zone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    });
    ok('the browser really is in New York on the far side of the change', where.zone === 'America/New_York' && where.off === 300, where);
    ok('and the clock really is on the second pass through 1am', where.h === 1 && where.m === 15, where);

    // The real door, the same one block 1 uses: open a nappy sheet, tap the strip, tap a chip.
    await p2.evaluate(() => { closeSheet(); openDiaper(); }); await sleep(450);
    for (const mins of [0, 15, 30, 60, 120]) {
      await p2.click('.time-strip'); await sleep(300);
      const there = await p2.evaluate((m) => !!document.querySelector('.cu-relrow .cu-rel[data-mins="' + m + '"]'), mins);
      if (!there) { ok('there is a "' + mins + ' minute" chip to tap across the change', false, { mins }); continue; }
      await p2.click('.cu-relrow .cu-rel[data-mins="' + mins + '"]'); await sleep(200);
      const f = await p2.evaluate(() => { const v = getWhen('when'); return { v, delta: Date.now() - v, clean: v % 60000 === 0 }; });
      ok('"' + mins + ' minutes ago" is ' + mins + ' true minutes ago, not an hour out',
        f.delta >= mins * MIN && f.delta < (mins + 2) * MIN, { mins, deltaMin: +(f.delta / MIN).toFixed(2), f });
      ok('and it is never ahead of the clock in her hand (' + mins + ')', f.delta >= 0, f);
      ok('and still a clean minute across the change (' + mins + ')', f.clean === true, f);
    }
    ok('no page errors in the repeated hour', errs2.length === 0, errs2.slice(0, 3));
    await p2.close();
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'RELATIVE-WHEN: FAIL' : 'RELATIVE-WHEN: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
