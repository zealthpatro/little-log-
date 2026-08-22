#!/usr/bin/env node
/* A RUNNING TIMER COULD ONLY BE STOPPED, AND STOPPING ALWAYS WROTE.
 *
 * The banner stated a fact and offered exactly one action, and that action always pushed an event
 * into the record the whole circle reads. So the two commonest ways a timer goes wrong had no exit
 * that was not itself a wrong record.
 *
 *   MIS-TAP. Reaching for Nappy at 3am and hitting Sleep started a nap. The only way out was Stop,
 *   which wrote a junk nap she then had to go and find in the timeline and delete.
 *
 *   NOTICED LATE. She forgets to stop until an hour after the baby woke. Stop writes a nap an hour
 *   too long, and correcting it afterwards goes through saveEdit, which stamps editedBy/editedAt
 *   and leaves "edited by Maya" on that row forever, for everybody.
 *
 * Every control needed already existed and every one was behind a trip wire: openSleepCorrect only
 * opened once a nap had run twelve hours (the nudge) or twenty-four (the stop), openFeedCorrect at
 * four, and "Forget this timer" was only ever offered from inside those two sheets. Under twelve
 * hours there was nothing. The banner is now tappable and carries all four doors at minute one, and
 * the start of a running timer can be moved, which nothing in the app could do before.
 *
 * The half the proposal did not foresee, and the half most likely to rot: openSleepCorrect and
 * openFeedCorrect diagnose a forgotten Stop OUT LOUD ("that is longer than a nap usually goes, so
 * it looks like Stop never got tapped"). True at four hours, a lie at twelve minutes, and told to a
 * parent who had just chosen "Stop at a different time" herself. Section 8 holds both sentences to
 * their own route, in both directions, so neither can leak into the other.
 *
 *   PORT=9346 node tools/serve.js &
 *   node tools/timer_banner_tap_check.js http://localhost:9346
 *
 * SELF-TEST, measured rather than asserted. Every fix below was reverted ON ITS OWN in a scratch
 * copy served on its own port (serve.js COPIED, never symlinked: __dirname resolves through a
 * symlink and serves the original tree, which is the wrong-checkout trap this file exists to
 * avoid), and the gate was run against it. Green tree: 154 passed, 0 failed.
 *
 *   whole change reverted to HEAD ............... 15 passed, 47 failed (15 sections died early)
 *   timeStrip's `src` (picker reads live timer) .. 8 red   sections 6b/6c/6d
 *   the "Done changed nothing" guard ............. 4 red   sections 6c/6d/6e
 *   Enter/Space on the banner .................... 2 red   section 1
 *   the ceiling toast wording .................... 4 red   section 7
 *   "started at" / "up to then" .................. 5 red   sections 8/9
 *   the control sheet's opening sentence ......... 8 red   sections 3/6/6b/11/12/13
 *   hideToast before the destructive confirm ..... 1 red   section 17
 *   .tb-tap (the orphaned separator) ............. 2 red   section 18
 *   .tb-when (the clock split across lines) ...... 1 red   section 18
 *   "Keep the timer running" returns to control .. 2 red   section 16
 *
 * KNOWN LIMIT, stated because a gate that hides its own blind spot is worse than one that fails:
 * section() catches a throw, records ONE fail and skips every remaining claim in that section. A
 * red total is therefore a floor and never a count, and a partial regression inside a section that
 * throws early is invisible. The summary now names every section that died early so nobody reads
 * "47 failed" as "47 things regressed".
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2];
if (!BASE) { console.error('usage: node tools/timer_banner_tap_check.js http://localhost:<your-port>\n(no default: a default base URL is how a gate ends up grading another agent\'s checkout)'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, HOUR = 3600000, MIN = 60000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };
/* Every block runs inside this. Against a tree without the change the first block throws a
 * ReferenceError on openTimerControl, and without the wrapper the file would abort there and never
 * report which of the fifteen claims actually regressed. */
const threw = [];
const section = async (title, fn) => {
  console.log('\n' + title);
  try { await fn(); } catch (e) { fail++; threw.push(title); console.log('  FAIL this section threw, so the rest of it never ran\n         got: ' + JSON.stringify(String((e && e.message) || e))); }
};

// 03:12, the hour a mis-tap actually happens, and far enough from midnight that a nap started
// forty minutes ago is still on the same calendar day.
const CLOCK = (() => { const d = new Date(); d.setHours(3, 12, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

const seed = (over) => Object.assign({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
  activeBabyId: 'b1', events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
}, over || {});

const napSeed = (mins, over) => seed(Object.assign({ timers: { b1: { sleep: { start: now - mins * MIN } } } }, over || {}));
const feedSeed = (mins, over) => seed(Object.assign({ timers: { b1: { feed: { start: now - mins * MIN, side: 'left' } } } }, over || {}));

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
    // Toasts are captured rather than watched: the real one fades, and a gate that races a CSS
    // transition is a gate that flakes at midnight on somebody else's machine.
    await page.evaluate(() => { window.__toasts = []; const t = window.toast; window.toast = function (m) { window.__toasts.push(m); return t.apply(null, arguments); }; });
    await sleep(150);
  };

  /* The real banner in the real #scroll, read the way a thumb finds it. NEVER via
     document.body.textContent: that string carries the inline script's own source, so an assertion
     against it would pass on a tree that shipped none of this. */
  const banners = () => page.evaluate(() => [...document.querySelectorAll('#scroll .active-banner')].map((b) => {
    const info = b.querySelector('.info');
    return {
      lbl: (b.querySelector('.lbl') || {}).textContent || '',
      timerAttr: b.querySelector('[data-timer]') ? b.querySelector('[data-timer]').getAttribute('data-timer') : null,
      tap: info ? info.getAttribute('onclick') : null,
      role: info ? info.getAttribute('role') : null,
      edit: b.querySelector('.info .sub .tb-edit') ? b.querySelector('.info .sub .tb-edit').textContent : null,
      // A parent aiming for "change" must not be able to hit Stop, so the two must not nest.
      stopInsideTap: !!(info && info.querySelector('.stop-btn')),
      stop: b.querySelector('.stop-btn') ? b.querySelector('.stop-btn').getAttribute('onclick') : null,
    };
  }));
  const sheet = () => page.evaluate(() => {
    const s = document.getElementById('sheet');
    if (!s || !s.classList.contains('show')) return { show: false };
    const h2 = s.querySelector('h2');
    let title = ''; if (h2) [...h2.childNodes].forEach((n) => { if (n.nodeType === 3) title += n.textContent; });
    return {
      show: true, h2: title.trim(), dot: !!(h2 && h2.querySelector('.lg-i')),
      sub: ((s.querySelector('.sub') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
      strip: ((s.querySelector('.time-strip .ts-label') || {}).textContent || '').trim(),
      stripCap: ((s.querySelector('.time-strip .ts-cap') || {}).textContent || '').trim(),
      stripTap: s.querySelector('.time-strip') ? s.querySelector('.time-strip').getAttribute('onclick') : null,
      // The pre-filled value behind the strip, plus the page's own clock to judge it against. The
      // label alone cannot carry this assertion: "3:12 AM" tips to "3:13 AM" partway through a run.
      // `logTimes` is a top-level `let`, so it is NOT on window and window.logTimes is undefined.
      // Reading it through the bare identifier is the difference between measuring the real
      // pre-fill and quietly measuring nothing.
      endVal: (typeof logTimes !== 'undefined' && logTimes) ? logTimes.end : null, pageNow: now(),
      btns: [...s.querySelectorAll('button')].map((b) => ({ t: b.textContent.trim(), on: b.getAttribute('onclick') || '' })).filter((b) => b.t !== '×' && b.t !== '‹' && b.t !== 'i'),
    };
  });
  const tapBanner = (i) => page.evaluate((n) => { document.querySelectorAll('#scroll .active-banner .info')[n].click(); }, i || 0);
  /* The picker is a cuModal, not a sheet, so none of the sheet helpers can see it. These three
     drive it exactly as a thumb does: open the Started row, read what it opened AT, move a wheel,
     press Done. Section 6 called setTimerStart() straight from JS and therefore never went near
     the one route a parent actually takes. */
  const tapStartRow = () => page.evaluate(() => { document.querySelector('#sheet .time-strip').click(); });
  const pickerAt = async () => {
    for (let i = 0; i < 40; i++) {
      const v = await page.evaluate(() => { const d = document.getElementById('cuWDisp'); return d ? d.textContent.replace(/\s+/g, ' ').trim() : null; });
      if (v) return v;
      await sleep(50);
    }
    return null;
  };
  const pickMinute = (m) => page.evaluate((v) => { document.querySelector('#cuM .cu-tcell[data-v="' + v + '"]').click(); }, m);
  const pickerDone = () => page.evaluate(() => { document.getElementById('cuWDone').click(); });
  const tapBack = () => page.evaluate(() => { const b = document.querySelector('#sheet .sheet-back'); if (!b) throw new Error('no back arrow on this sheet'); b.click(); });
  const tapSheet = (label) => page.evaluate((l) => {
    const b = [...document.querySelectorAll('#sheet button')].find((x) => x.textContent.trim() === l);
    if (!b) throw new Error('no sheet button labelled "' + l + '"');
    b.click();
  }, label);
  const st = () => page.evaluate(() => ({
    evs: state.events.length,
    sleeps: state.events.filter((e) => e.type === 'sleep').length,
    feeds: state.events.filter((e) => e.type === 'feed').length,
    deleted: state.events.filter((e) => e.deleted).length,
    edited: state.events.filter((e) => e.editedBy || e.editedAt).length,
    napStart: (((state.timers.b1 || {}).sleep) || {}).start || null,
    napAck: (((state.timers.b1 || {}).sleep) || {}).ack || null,
    feedStart: (((state.timers.b1 || {}).feed) || {}).start || null,
    first: state.events[0] ? { type: state.events[0].type, time: state.events[0].time, end: state.events[0].end || null, dur: state.events[0].dur || null } : null,
    toasts: (window.__toasts || []).slice(),
  }));

  await section('0. the pieces this whole file is about exist at all', async () => {
    await load(napSeed(12));
    const r = await page.evaluate(() => ({
      control: typeof window.openTimerControl === 'function',
      setStart: typeof window.setTimerStart === 'function',
      // timeStrip has to accept the third argument, or the start row silently falls back to
      // setWhen and "change" edits a draft nobody ever saves.
      strip3: /function\s+timeStrip\s*\(\s*slot\s*,\s*label\s*,\s*onPick/.test(String(window.timeStrip)),
      correctArity: window.openSleepCorrect.length >= 2 && window.openFeedCorrect.length >= 2,
    }));
    ok('openTimerControl exists', r.control === true, r);
    ok('setTimerStart exists', r.setStart === true, r);
    ok('timeStrip takes an onPick callback', r.strip3 === true, r);
    ok('the two correct sheets know whether they were chosen or triggered', r.correctArity === true, r);
  });

  await section('1. the banner is a control, not a read-out', async () => {
    await load(napSeed(12));
    const b = await banners();
    ok('exactly one banner for one running nap', b.length === 1, b);
    ok('its body is tappable', /openTimerControl\('sleep','b1'\)/.test(b[0].tap || ''), b[0]);
    ok('and announced as a button to assistive tech', b[0].role === 'button', b[0]);
    /* role="button" tabindex="0" with only an onclick is the promise this change made and did not
       keep: it takes focus, it announces as a button, and then the two keys that operate a button
       do nothing. Asserting the role alone let that ship. */
    const kb = await page.evaluate(() => {
      const el = document.querySelector('#scroll .active-banner .info');
      const shown = () => document.getElementById('sheet').classList.contains('show');
      el.focus(); const focused = document.activeElement === el;
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      const enter = shown(); closeSheet();
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      const space = shown(); closeSheet();
      return { focused, enter, space, name: el.textContent.replace(/\s+/g, ' ').trim(), aria: el.getAttribute('aria-label') };
    });
    ok('it takes keyboard focus', kb.focused === true, kb);
    ok('and Enter opens the control, because a div that says button must act like one', kb.enter === true, kb);
    ok('and so does Space', kb.space === true, kb);
    /* No aria-label on purpose, and this is the assertion that keeps it that way: an aria-label
       REPLACES the name, and the elapsed count lives nowhere else on the screen, so labelling this
       "change or stop this timer" would take the one number the banner exists for away from anyone
       reading it with a screen reader. The composed name has to keep both. */
    ok('and its name still carries the count and the affordance', kb.aria === null && /\d/.test(kb.name) && /change$/.test(kb.name), kb);
    ok('the affordance is visible, not hidden knowledge', b[0].edit === 'change', b[0]);
    ok('Stop is NOT inside the tap target, so a thumb aiming at change cannot write', b[0].stopInsideTap === false, b[0]);
    ok('Stop still stops', /stopSleep\('b1'\)/.test(b[0].stop || ''), b[0]);
    await tapBanner(0); await sleep(300);
    const s = await sheet();
    ok('tapping it opens the timer control', s.show === true && s.h2 === 'Nap timer', s);
    const a = await st();
    ok('and opening it writes NOTHING', a.evs === 0, a);
  });

  await section('2. reachable from every tab, because that is where the banner now stands', async () => {
    for (const tab of ['log', 'album', 'health']) {
      await load(napSeed(20));
      await page.evaluate((t) => go(t), tab); await sleep(500);
      const b = await banners();
      ok(tab + ': the banner is there and tappable', b.length === 1 && /openTimerControl\('sleep','b1'\)/.test(b[0].tap || ''), { tab, b });
      await tapBanner(0); await sleep(300);
      const s = await sheet();
      ok(tab + ': it opens the control', s.show === true && s.h2 === 'Nap timer', { tab, s });
    }
  });

  await section('3. all four doors, named honestly, on one sheet', async () => {
    await load(napSeed(12));
    await tapBanner(0); await sleep(300);
    const s = await sheet();
    const labels = s.btns.map((x) => x.t);
    ok('the start is stated as a clock time', s.stripCap === 'Started' && /3:0?0/.test(s.strip), s);
    ok('and the start row is what opens the picker', /openWhenPicker/.test(s.stripTap || '') && /setTimerStart\('sleep','b1'/.test(s.stripTap || ''), s);
    ok('Stop now', labels.indexOf('Stop now') !== -1, labels);
    ok('Stop at a different time', labels.indexOf('Stop at a different time') !== -1, labels);
    ok('Forget this timer', labels.indexOf('Forget this timer') !== -1, labels);
    ok('exactly three actions under the start row, no fourth invented door', s.btns.length === 3, labels);
    ok('and the sheet says what forgetting costs', /removes the timer and logs nothing/i.test(s.sub) || await page.evaluate(() => /removes the timer and logs nothing/i.test(document.getElementById('sheet').innerText)), s);
    /* A minute of slack on every elapsed string in this file. The clock is shifted, not frozen, so
       real seconds keep passing while the gate runs and fmtDur rounds to whole minutes: pinning
       "12m" exactly would turn a slow machine into a red build. The claim is the number, not the
       second. */
    ok('it opens with how long it has run', /^Running 1[23]m\./.test(s.sub), s);
    ok('then offers the three ways out rather than reading the timer back', /you can move the start, stop it at the right time, or forget it/i.test(s.sub), s);
    /* The Started row is forty pixels below this sentence and already carries the clock time and
       the day word. Saying it twice is the sheet talking to itself. */
    ok('and does not repeat the start time the row underneath already shows', !/3:0?0/.test(s.sub) && !/today/i.test(s.sub), s);
  });

  await section('4. the mis-tap, end to end: a nap started by accident leaves no trace', async () => {
    await load(seed());
    await page.evaluate(() => { startSleep(); }); await sleep(400);
    const before = await st();
    ok('the mis-tap started a timer', before.napStart !== null, before);
    await page.evaluate(() => go('home')); await sleep(400);
    await tapBanner(0); await sleep(300);
    await tapSheet('Forget this timer'); await sleep(300);
    const conf = await sheet();
    ok('forgetting asks first', conf.show === true && /forget/i.test(conf.h2), conf);
    await tapSheet('Forget it'); await sleep(400);
    const a = await st();
    ok('the timer is gone', a.napStart === null, a);
    ok('and NOTHING was written', a.evs === 0, a);
    ok('nothing landed in Recently deleted either, because a slip is not a decision', a.deleted === 0, a);
    const b = await banners();
    ok('the banner goes with it', b.length === 0, b);
  });

  await section('5. the ordinary path is untouched: Stop now still logs the nap', async () => {
    await load(napSeed(45));
    await tapBanner(0); await sleep(300);
    await tapSheet('Stop now'); await sleep(500);
    const a = await st();
    ok('one sleep event, not two', a.sleeps === 1 && a.evs === 1, a);
    ok('filed at the minute the timer started', a.first && Math.abs(a.first.time - (now - 45 * MIN)) < 2000, a);
    ok('ending about now', a.first && a.first.end > a.first.time && (a.first.end - now) < 5 * MIN, a);
    ok('the timer is cleared', a.napStart === null, a);
    ok('and it carries no edit stamp, because nothing was corrected after the fact', a.edited === 0, a);
  });

  await section('6. moving the start of a RUNNING timer, the thing nothing could do before', async () => {
    await load(napSeed(12));
    await tapBanner(0); await sleep(300);
    // She put the baby down and tapped Sleep, then spent ten minutes settling her: the nap really
    // began ten minutes after the tap.
    await page.evaluate((t) => setTimerStart('sleep', 'b1', t), now - 2 * MIN); await sleep(400);
    const a = await st();
    ok('the running timer now starts where she said', Math.abs(a.napStart - (now - 2 * MIN)) < 2000, a);
    ok('and she is told it took', a.toasts.some((m) => /start time changed/i.test(m)), a.toasts);
    const b = await banners();
    ok('the banner behind the sheet is the receipt: its clock moved too', b.length === 1 && Math.abs(Number(b[0].timerAttr) - (now - 2 * MIN)) < 2000, b);
    const s = await sheet();
    ok('the sheet stays open on the new value', s.show === true && s.h2 === 'Nap timer' && /^Running [23]m\./.test(s.sub), s);
    await tapSheet('Stop now'); await sleep(500);
    const c = await st();
    ok('stopping writes the corrected nap', c.sleeps === 1 && Math.abs(c.first.time - (now - 2 * MIN)) < 2000, c);
    ok('with NO editedBy on it, which is the whole point of fixing it before the write', c.edited === 0, c);
  });

  await section('6b. the same move, driven the way a thumb drives it, through the picker', async () => {
    /* Section 6 asserts the onclick STRING contains setTimerStart and then calls setTimerStart from
       JS. That skips openWhenPicker and Done entirely, which is the whole user-facing journey and
       the exact place the back-arrow bug lived. This section never calls the function by name. */
    await load(napSeed(12));
    await tapBanner(0); await sleep(300);
    const rowShows = (await sheet()).strip;
    await tapStartRow();
    const openedAt = await pickerAt();
    ok('the Started row opens the picker', openedAt !== null, openedAt);
    ok('and it opens on exactly what the row is showing', openedAt === rowShows, { picker: openedAt, row: rowShows });
    ok('which is the start, not the present', /3:0?0 AM/.test(openedAt) && !/3:1[0-9] AM/.test(openedAt), openedAt);
    await pickMinute(5); await sleep(150);
    await pickerDone(); await sleep(500);
    const a = await st();
    ok('the running timer moved to the minute she picked', Math.abs(a.napStart - (now - 7 * MIN)) < 2000, a);
    ok('and she is told it took', a.toasts.some((m) => /start time changed/i.test(m)), a.toasts);
    ok('with nothing written, because the timer is still running', a.evs === 0, a);
    const s2 = await sheet();
    ok('the control comes back on the new value', s2.show === true && s2.h2 === 'Nap timer' && /^Running [678]m\./.test(s2.sub), s2);
    ok('and the Started row now reads the new time', /3:05 AM/.test(s2.strip), s2);
  });

  await section('6c. the back arrow this change created: what the row shows is what the row opens', async () => {
    /* REPRODUCED before the fix, on both timers: openTimerControl sets logTimes={tstart}, "Stop at
       a different time" replaces the whole object with {end}, and sheetBack restores the parent's
       cached HTML but not its times. The Started row went on DISPLAYING 3:00 AM while getWhen
       fell through to now(), so Done on a picker she never touched moved a 3h12m nap forward 192
       minutes and toasted "Start time changed" at her. Neither guard fires: it is not in the
       future and it is not past the ceiling. */
    await load(napSeed(180));
    await tapBanner(0); await sleep(300);
    const before = (await st()).napStart;
    const shown = (await sheet()).strip;
    await tapSheet('Stop at a different time'); await sleep(450);
    const back = await page.evaluate(() => { const b = document.querySelector('#sheet .sheet-back'); if (!b) return null; const r = b.getBoundingClientRect(); const cs = getComputedStyle(b); return { w: Math.round(r.width), h: Math.round(r.height), vis: cs.visibility, op: cs.opacity }; });
    ok('the child sheet really does carry a tappable back arrow', !!back && back.w >= 40 && back.h >= 40 && back.vis === 'visible' && back.op === '1', back);
    await tapBack(); await sleep(450);
    let s2 = await sheet();
    ok('back lands on the timer control', s2.show === true && s2.h2 === 'Nap timer', s2);
    ok('and the Started row still shows the real start', s2.strip === shown && /12:1[12] AM/.test(s2.strip), { strip: s2.strip, shown });
    await tapStartRow();
    const at = await pickerAt();
    ok('the picker actually opened', at !== null, at);
    /* THE claim, stated as an equality rather than two regexes: whatever the Started row is
       showing is the value the picker opens at. Both render Today the same way (whenLabel and the
       picker's own dayWord agree inside today, which the shifted clock guarantees), so this is a
       direct comparison and cannot go vacuously true. */
    ok('and it opens on exactly what the row is showing', at === s2.strip, { picker: at, row: s2.strip });
    ok('which is the real start, not the present', /12:1[12] AM/.test(at) && !/3:1[0-9] AM/.test(at), at);
    await pickerDone(); await sleep(500);
    const a = await st();
    ok('Done without moving a wheel leaves the start exactly where it was', a.napStart === before, { after: a.napStart, before });
    ok('and claims nothing, because nothing changed', !a.toasts.some((m) => /start time changed/i.test(m)), a.toasts);
    ok('and writes no event on the way past', a.evs === 0, a);
    ok('no page error on the back route', errs.length === 0, errs.slice(0, 3));
  });

  await section('6d. the feed twin of the back route, measured the same way', async () => {
    await load(feedSeed(100));
    await tapBanner(0); await sleep(300);
    const before = (await st()).feedStart;
    await tapSheet('Stop at a different time'); await sleep(450);
    const child = await sheet();
    ok('the child sheet really opened, so the back arrow means something', child.show === true && child.h2 === 'When did this feed end?', child);
    await tapBack(); await sleep(450);
    const s2 = await sheet();
    ok('back lands on the nursing control', s2.show === true && s2.h2 === 'Nursing timer', s2);
    await tapStartRow();
    const at = await pickerAt();
    ok('the picker actually opened', at !== null, at);
    ok('and it opens on exactly what the Started row is showing', at === s2.strip, { picker: at, row: s2.strip });
    ok('which is the feed start, not the present', /1:3[12] AM/.test(at) && !/3:1[0-9] AM/.test(at), at);
    await pickerDone(); await sleep(500);
    const a = await st();
    ok('and the feed start does not move on its own', a.feedStart === before, { after: a.feedStart, before });
    ok('nor is she told it did', !a.toasts.some((m) => /start time changed/i.test(m)), a.toasts);
  });

  await section('6e. Done on the value it opened at is not a change, even with seconds on the clock', async () => {
    /* startSleep stamps now(), so a real timer carries seconds; the picker zeroes them. Comparing
       raw milliseconds would make every no-op look like a move, which is how "Start time changed"
       ended up firing over a start that had not moved, plus a push of the whole shared blob. */
    await load(napSeed(30, { timers: { b1: { sleep: { start: now - 30 * MIN + 37000 } } } }));
    await tapBanner(0); await sleep(300);
    await page.evaluate((t) => setTimerStart('sleep', 'b1', t), now - 30 * MIN); await sleep(350);
    const a = await st();
    ok('the same minute is left alone, seconds and all', a.napStart === now - 30 * MIN + 37000, { got: a.napStart, want: now - 30 * MIN + 37000 });
    ok('and Cubby does not confirm a change it did not make', !a.toasts.some((m) => /start time changed/i.test(m)), a.toasts);
    // ...and a real move in the same minute-aligned world still goes through.
    await page.evaluate((t) => setTimerStart('sleep', 'b1', t), now - 29 * MIN); await sleep(350);
    const b2 = await st();
    ok('a minute later IS a change and is written', b2.napStart === now - 29 * MIN, b2);
    ok('and that one is confirmed', b2.toasts.some((m) => /start time changed/i.test(m)), b2.toasts);
  });

  await section('7. a start Cubby will not accept, and one it should', async () => {
    await load(napSeed(30));
    await page.evaluate((t) => setTimerStart('sleep', 'b1', t), now + 20 * MIN); await sleep(300);
    let a = await st();
    ok('the future is refused', Math.abs(a.napStart - (now - 30 * MIN)) < 2000, a);
    ok('and said so out loud rather than silently ignored', a.toasts.some((m) => /in the future/i.test(m)), a.toasts);

    await load(napSeed(30));
    await page.evaluate((t) => setTimerStart('sleep', 'b1', t), now - 25 * HOUR); await sleep(300);
    a = await st();
    ok('a nap start past the 24h ceiling is refused', Math.abs(a.napStart - (now - 30 * MIN)) < 2000, a);
    /* "A nap cannot have been running that long" states a product ceiling as a fact about babies,
       two lines from where the app already hedges the same threshold with "longer than a nap
       usually goes". Say whose limit it is, and hand her the way out in the same breath. */
    ok('named as Cubby\'s ceiling, with a way out', a.toasts.some((m) => /cubby only tracks a nap up to 24 hours/i.test(m) && /stop the timer and log the nap by hand/i.test(m)), a.toasts);
    ok('and never tells her it could not have happened', !a.toasts.some((m) => /cannot have been running/i.test(m)), a.toasts);

    await load(feedSeed(30));
    await page.evaluate((t) => setTimerStart('feed', 'b1', t), now - 5 * HOUR); await sleep(300);
    a = await st();
    ok('a feed start past the 4h ceiling is refused', Math.abs(a.feedStart - (now - 30 * MIN)) < 2000, a);
    ok('and named as a feed, not a nap', a.toasts.some((m) => /cubby only tracks a feed up to 4 hours/i.test(m) && /log the feed by hand/i.test(m)), a.toasts);
    /* A four-hour cluster feed is a thing that happens to real nursing parents. Cubby may say it
       will not track one; it may not say one did not occur. */
    ok('and does not contradict a parent who just lived a four-hour feed', !a.toasts.some((m) => /cannot have been running/i.test(m)), a.toasts);

    await load(napSeed(30));
    await page.evaluate((t) => setTimerStart('sleep', 'b1', t), now - 5 * MIN); await sleep(300);
    a = await st();
    ok('moving the start LATER is a real correction and is accepted', Math.abs(a.napStart - (now - 5 * MIN)) < 2000, a);
    ok('and still nothing has been written', a.evs === 0, a);
  });

  await section('8. the two sentences stay on their own routes', async () => {
    /* Three hours, not twelve minutes, and that is the whole point of the number. The overrun
       default is start + min(ran, 1h), which AT TWELVE MINUTES equals now: seeded short, the
       "pre-filled at now" assertion below passes whether or not the voluntary branch exists, and a
       gate that cannot tell those two apart is decoration. At three hours the old default is
       now - 2h and the new one is now, two hours apart. Still well under the 24h cap, so this is
       an ordinary running nap with an ordinary banner, which is the case being claimed. */
    await load(napSeed(180));
    await tapBanner(0); await sleep(300);
    await tapSheet('Stop at a different time'); await sleep(400);
    let s = await sheet();
    ok('chosen mid-timer: the sheet opens', s.show === true && s.h2 === 'When did this nap end?', s);
    ok('and does NOT claim the timer looks wrong', !/longer than a nap usually goes/i.test(s.sub), s);
    ok('nor that Stop never got tapped', !/stop never got tapped/i.test(s.sub), s);
    // The overrun copy also ends "tell us when Robin woke", so matching that alone would be a free
    // pass. This is the clause only the chosen route has.
    /* "we will log that instead" pointed at nothing: on this route no event exists yet, so there
       is no "that" to replace. And "started 3:00 AM" is a label, not a clause. */
    ok('it just asks, and says what it will actually write', /we will log the nap up to then/i.test(s.sub) && /tell us when robin woke/i.test(s.sub), s);
    ok('with the preposition, because this is a sentence and not a banner label', /started at \d/.test(s.sub) && !/timer started \d/.test(s.sub), s);
    ok('and nothing is described as replacing a record that does not exist', !/instead/i.test(s.sub), s);
    ok('pre-filled at now, not a guess an hour after the start', Math.abs(s.endVal - s.pageNow) < 2 * MIN, { end: s.endVal, pageNow: s.pageNow, strip: s.strip });
    ok('and shown as today, in her own clock', /^Today · /.test(s.strip), s);
    let labels = s.btns.map((x) => x.t);
    ok('the way out is Keep the timer running', labels.indexOf('Keep the timer running') !== -1, labels);
    ok('and not a question nobody asked', labels.indexOf('No, they are still asleep') === -1, labels);
    await tapSheet('Keep the timer running'); await sleep(300);
    let a = await st();
    ok('backing out leaves the timer alone', Math.abs(a.napStart - (now - 180 * MIN)) < 2000, a);
    ok('and does NOT stamp ack, which would silence the twelve-hour nudge for a parent who only looked', a.napAck === null, a);

    // The overrun route must keep the copy it was built with. This is the regression half.
    await load(napSeed(13 * 60));
    await page.evaluate(() => openSleepCorrect('b1')); await sleep(400);
    s = await sheet();
    ok('triggered at thirteen hours: the diagnosis is still there', /longer than a nap usually goes/i.test(s.sub), s);
    ok('and still names the forgotten Stop', /stop never got tapped/i.test(s.sub), s);
    // The other half of the pre-fill claim: here now() is the one answer we are confident is wrong,
    // so this route still guesses an hour after the start rather than the present.
    ok('and it still pre-fills an hour in, not now', Math.abs(s.endVal - (now - 12 * HOUR)) < 2 * MIN, { end: s.endVal, pageNow: s.pageNow });
    labels = s.btns.map((x) => x.t);
    ok('with the answer Cubby asked for', labels.indexOf('No, they are still asleep') !== -1, labels);
    await tapSheet('No, they are still asleep'); await sleep(300);
    a = await st();
    ok('which does stamp ack, so the question is not asked again for six hours', a.napAck !== null, a);
  });

  await section('9. the feed twin, because two timers under one thumb must behave the same', async () => {
    // Two hours for the same reason section 8 uses three: the feed overrun default is
    // start + min(ran, 30m), which at nine minutes is also now.
    await load(feedSeed(120));
    const b = await banners();
    ok('the nursing banner is tappable too', b.length === 1 && /openTimerControl\('feed','b1'\)/.test(b[0].tap || ''), b);
    await tapBanner(0); await sleep(300);
    let s = await sheet();
    ok('it opens the nursing timer', s.show === true && s.h2 === 'Nursing timer', s);
    ok('with the same three doors', s.btns.length === 3 && s.btns.map((x) => x.t).join('|') === 'Stop now|Stop at a different time|Forget this timer', s.btns);
    ok('wired to the feed functions, not the sleep ones', /stopFeed/.test(s.btns[0].on) && /openFeedCorrect/.test(s.btns[1].on) && /discardRunningFeed/.test(s.btns[2].on), s.btns);
    await tapSheet('Stop at a different time'); await sleep(400);
    s = await sheet();
    ok('the feed question opens', s.show === true && s.h2 === 'When did this feed end?', s);
    ok('without the forgotten-Stop diagnosis', !/longer than a feed usually goes/i.test(s.sub) && /we will log the feed up to then/i.test(s.sub), s);
    ok('and the feed sentence carries the preposition too', /started at \d/.test(s.sub) && !/instead/i.test(s.sub), s);
    ok('pre-filled at now', Math.abs(s.endVal - s.pageNow) < 2 * MIN, { end: s.endVal, pageNow: s.pageNow, strip: s.strip });
    // And the four-hour trip keeps its own words, the same way the sleep one does.
    await load(feedSeed(5 * 60));
    await page.evaluate(() => openFeedCorrect('b1')); await sleep(400);
    s = await sheet();
    ok('the four-hour route still names the forgotten Stop', /longer than a feed usually goes/i.test(s.sub) && /stop never got tapped/i.test(s.sub), s);
    ok('and still pre-fills half an hour in, not now', Math.abs(s.endVal - (now - 4.5 * HOUR)) < 2 * MIN, { end: s.endVal, pageNow: s.pageNow });
    await load(feedSeed(9));
    await tapBanner(0); await sleep(300);
    await tapSheet('Stop now'); await sleep(500);
    const a = await st();
    ok('and Stop now writes one feed of the right length', a.feeds === 1 && a.evs === 1 && a.first.dur >= 9 * MIN && a.first.dur < 11 * MIN, a);
  });

  await section('10. the other parent stopped it from her own phone while this banner sat here', async () => {
    await load(napSeed(20));
    // Timers live in the shared blob, so this is not a hypothetical: it is a sync landing between
    // the paint and the tap.
    await page.evaluate(() => { delete state.timers.b1.sleep; openTimerControl('sleep', 'b1'); }); await sleep(400);
    const s = await sheet();
    ok('no sheet opens about a timer that is not there', s.show === false, s);
    const a = await st();
    ok('she is told why', a.toasts.some((m) => /already stopped/i.test(m)), a.toasts);
    ok('and nothing was written on the way past', a.evs === 0, a);
    ok('no page error', errs.length === 0, errs.slice(0, 3));
  });

  await section('11. she moves the start, the phone locks, she comes back to it', async () => {
    /* The moved start is SEEDED here rather than set and then reloaded, and that is a statement
       about the harness, not a shortcut. store-firebase.js:2155 replaces persist() with the cloud
       pusher the moment it loads, so under ?e2e=1, with no household to push to, NOTHING reaches
       localStorage: a plain saveDiaper survives in state and is gone after a reload too. So a
       reload here can only ever prove that the app reads a moved start back correctly, which is
       the half that is actually this change's to get right. setTimerStart writing into
       state.timers is bound in section 6 against the live object. */
    await load(napSeed(10));
    await page.reload({ waitUntil: 'networkidle2' }); await sleep(1400);
    const b = await banners();
    ok('the banner comes back tappable', b.length === 1 && /openTimerControl/.test(b[0].tap || ''), b);
    ok('counting from the moved start', Math.abs(Number(b[0].timerAttr) - (now - 10 * MIN)) < 2000, b);
    await tapBanner(0); await sleep(300);
    const s = await sheet();
    ok('and the control agrees with it', s.show === true && /^Running 1[01]m\./.test(s.sub), s);
    await page.evaluate(() => { window.__toasts = []; });
    // Two taps on Stop, the fumble this app is full of. The second must find no timer.
    await page.evaluate(() => { stopSleep('b1'); stopSleep('b1'); }); await sleep(400);
    const a = await st();
    ok('one nap, not two', a.sleeps === 1 && a.evs === 1, a);
    ok('filed from the moved start', Math.abs(a.first.time - (now - 10 * MIN)) < 2000, a);
    ok('and the timer is gone', a.napStart === null, a);
  });

  await section('12. twins: the sheet names whose timer it is, and opens the right one', async () => {
    await load(seed({
      babies: [{ id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] },
        { id: 'b2', name: 'Wren', birth: now - 60 * DAY, sex: 'M', routines: [], doctors: [], allergies: [] }],
      timers: { b1: { sleep: { start: now - 15 * MIN } }, b2: { sleep: { start: now - 40 * MIN } } },
    }));
    const b = await banners();
    ok('two banners, one each', b.length === 2, b.map((x) => x.tap));
    ok('and they point at different babies', /openTimerControl\('sleep','b1'\)/.test(b[0].tap || '') && /openTimerControl\('sleep','b2'\)/.test(b[1].tap || ''), b.map((x) => x.tap));
    await tapBanner(1); await sleep(300);
    const s = await sheet();
    ok('the second one names Wren', /^Wren’s timer, running/.test(s.sub) || /^Wren's timer, running/.test(s.sub), s);
    ok('and reports Wren\'s elapsed, not Robin\'s', /running 4[012]m/.test(s.sub) && !/running 1[4-7]m/.test(s.sub), s);
    await tapSheet('Stop now'); await sleep(500);
    const a = await st();
    const which = await page.evaluate(() => ({ b1: !!((state.timers.b1 || {}).sleep), b2: !!((state.timers.b2 || {}).sleep), on: (state.events[0] || {}).babyId }));
    ok('only Wren\'s timer stopped', which.b1 === true && which.b2 === false, which);
    ok('and the nap is filed against Wren', a.sleeps === 1 && which.on === 'b2', { a, which });
  });

  await section('13. one baby is never told her own name back', async () => {
    await load(napSeed(15));
    await tapBanner(0); await sleep(300);
    const s = await sheet();
    ok('the only child gets no name in front of the count', /^Running 1[56]m\./.test(s.sub), s);
    ok('and is not named at her', !/Robin/.test(s.sub), s);
  });

  await section('14. no baby, no banner, no crash', async () => {
    await load(seed({ babies: [], activeBabyId: null, timers: {}, pregnancy: { dueDate: now + 100 * DAY } }));
    const b = await banners();
    ok('the pregnancy stage carries no timer banner', b.length === 0, b);
    const r = await page.evaluate(() => { try { openTimerControl('sleep'); return { threw: false, show: document.getElementById('sheet').classList.contains('show') }; } catch (e) { return { threw: String(e.message) }; } });
    await sleep(200);
    ok('and calling the control with nothing running is a no-op, not an exception', r.threw === false && r.show === false, r);
    const a = await st();
    ok('with nothing written', a.evs === 0, a);
  });

  await section('16. backing out of "Stop at a different time" returns her to where she chose it', async () => {
    await load(napSeed(180));
    await tapBanner(0); await sleep(300);
    await tapSheet('Stop at a different time'); await sleep(450);
    await tapSheet('Keep the timer running'); await sleep(450);
    let s2 = await sheet();
    ok('she lands back on the control, not on the home screen', s2.show === true && s2.h2 === 'Nap timer', s2);
    let a = await st();
    ok('with the nap timer untouched', Math.abs(a.napStart - (now - 180 * MIN)) < 2000, a);
    ok('and still no ack stamped, so the twelve-hour nudge is not silenced', a.napAck === null, a);
    ok('and nothing written', a.evs === 0, a);
    await load(feedSeed(120));
    await tapBanner(0); await sleep(300);
    await tapSheet('Stop at a different time'); await sleep(450);
    await tapSheet('Keep the timer running'); await sleep(450);
    s2 = await sheet();
    ok('the feed twin comes back to the nursing control too', s2.show === true && s2.h2 === 'Nursing timer', s2);
    a = await st();
    ok('with the feed timer untouched', Math.abs(a.feedStart - (now - 120 * MIN)) < 2000, a);
  });

  await section('17. a success pill never sits over the button that destroys the timer', async () => {
    /* Measured at 390px before the fix: toast rect [703,748], "Forget it" rect [709,765]. Not a tap
       trap (pointer-events:none), but for 1.9s the label of the button that throws the nap away is
       read through a green success badge, and both are now one tap apart on the same sheet. */
    await load(napSeed(12));
    await tapBanner(0); await sleep(300);
    await page.evaluate((t) => setTimerStart('sleep', 'b1', t), now - 5 * MIN); await sleep(250);
    const up = await page.evaluate(() => document.getElementById('toast').classList.contains('show'));
    ok('moving the start does raise a pill, so this section is testing something', up === true, up);
    await tapSheet('Forget this timer'); await sleep(350);
    const r = await page.evaluate(() => {
      const t = document.getElementById('toast');
      const b = [...document.querySelectorAll('#sheet button')].find((x) => x.textContent.trim() === 'Forget it');
      if (!b) return { noButton: true };
      const tr = t.getBoundingClientRect(), br = b.getBoundingClientRect();
      return { shown: t.classList.contains('show'), op: getComputedStyle(t).opacity,
        overlap: !(tr.bottom <= br.top || tr.top >= br.bottom || tr.right <= br.left || tr.left >= br.right),
        toast: [Math.round(tr.top), Math.round(tr.bottom)], forget: [Math.round(br.top), Math.round(br.bottom)] };
    });
    ok('the confirm arrives with the pill already down', r.shown === false && r.op === '0', r);
    const a = await st();
    ok('and nothing was destroyed by asking', a.napStart !== null && a.evs === 0, a);
  });

  await section('18. 320px: the separator does not orphan the one affordance on the banner', async () => {
    await page.setViewport({ width: 320, height: 800 });
    await load(napSeed(12));
    /* The page-width claim is measured OUTSIDE the wrapper lookup on purpose: if .tb-tap is gone
       the first two assertions must go red on their own, and the overflow one must still be a real
       measurement rather than a read of undefined. */
    const geo = await page.evaluate(() => {
      const out = { docW: document.documentElement.scrollWidth, winW: window.innerWidth };
      const wrap = document.querySelector('#scroll .active-banner .info .sub .tb-tap');
      const edit = document.querySelector('#scroll .active-banner .info .sub .tb-edit');
      const when = document.querySelector('#scroll .active-banner .info .sub .tb-when');
      if (!wrap || !edit || !when) return Object.assign(out, { missing: true });
      const wr = wrap.getBoundingClientRect(), er = edit.getBoundingClientRect(), nr = when.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(when).lineHeight) || 18;
      return Object.assign(out, { ws: getComputedStyle(wrap).whiteSpace, whenWs: getComputedStyle(when).whiteSpace,
        drop: Math.round(er.top - wr.top), whenLines: Math.round(nr.height / lh), whenText: when.textContent.trim(), lh: Math.round(lh) });
    });
    ok('the dot and "change" are one unbreakable pair', geo.ws === 'nowrap', geo);
    ok('so "change" never falls to its own line under a trailing dot', geo.drop === 0, geo);
    /* The first fix for the orphaned dot pushed the break INSIDE the clock: "started 3:00" above
       "AM · change". A time split across two lines is worse than the problem being solved. */
    ok('and the clock time itself never splits across two lines', geo.whenWs === 'nowrap' && geo.whenLines === 1 && /^started \d{1,2}:\d{2} [AP]M$/.test(geo.whenText), geo);
    ok('and nothing overflows sideways at 320', geo.docW <= geo.winW, geo);
    await tapBanner(0); await sleep(300);
    const s2 = await sheet();
    ok('the control still opens at 320', s2.show === true && s2.h2 === 'Nap timer', s2);
    await page.setViewport({ width: 390, height: 844 });
  });

  await section('15. the new sheet is taught, on both of its headings', async () => {
    await load(napSeed(12));
    await tapBanner(0); await sleep(300);
    let s = await sheet();
    ok('Nap timer carries its info dot', s.dot === true, s);
    await load(feedSeed(12));
    await tapBanner(0); await sleep(300);
    s = await sheet();
    ok('and so does Nursing timer, which is the same function under another name', s.dot === true, s);
  });

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 4));
  await browser.close();
  /* One throw costs ONE fail and silently skips every claim behind it, so a red total is a floor,
     never a count. Name the sections that died so nobody reads 14/34 as "34 things regressed". */
  if (threw.length) console.log('\n' + threw.length + ' section(s) died early, so an unknown number of claims never ran:\n  ' + threw.join('\n  '));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'TIMER-BANNER-TAP: FAIL' : 'TIMER-BANNER-TAP: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
