#!/usr/bin/env node
/* The first entry used to buy her nothing.
 *
 * saveDiaper ended in toast('Nappy logged · wet') for two seconds, and renderGetStarted returns ''
 * the moment the household has a baby and a log. So the parent who did exactly what she was asked
 * watched the only structure on the screen disappear and got the word "logged" in exchange. Nowhere
 * did Cubby say what her own log would be able to answer once there was a bit of it, which is the
 * whole reason to write the second one. Median time from sign-in to first log is 282.6 hours and no
 * household has reached day seven.
 *
 * One line, once: "That is the first one. From here, when Robin last fed, slept and had a nappy is
 * the top of your home screen." A statement of capability. No count, no next step, no target, and
 * it never comes back.
 *
 * What this gate is really guarding, in order of how badly each one would hurt:
 *   - a parent with months of history being told about a screen she has read every day since March
 *   - the line surviving into tomorrow, or into every visit to Home all evening, which turns one
 *     kind sentence into the checklist-that-refuses-to-end the get-started card was rescued from
 *   - it firing over a home screen that still says "not yet" three times, because the first entry
 *     was a temperature or because she undid it
 *   - it appearing at all in the quiet-after-loss mode
 *   - it being spent on a paint that never happened, when she logs from the Log tab
 *
 *   PORT=9758 node tools/serve.js &
 *   node tools/first_entry_line_check.js http://localhost:9758
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/* No default. A fallback port grades whatever happens to be listening on it, which in this repo is
   usually another checkout: the reviewer of this very change lost two minutes to a serve.js that had
   died on EADDRINUSE while curl happily returned the main tree. Pass the URL you proved. */
const BASE = process.argv[2];
if (!BASE) { console.error('usage: node tools/first_entry_line_check.js http://localhost:<port>   (shasum the served app/index.html against your tree first)'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, HOUR = 3600000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

// 10:00, plainly inside the waking day: nothing here should depend on the hour, and a check that
// only runs in the afternoon is not a check.
const CLOCK = (() => { const d = new Date(); d.setHours(10, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

const seed = (over) => Object.assign({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
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

  /* A reload every time, because "never repeated" is a claim about what survives a boot and the
     ledger this writes lives in localStorage. The seen map is wiped unless a case asks to keep it,
     so one case cannot silently retire the line for the next. */
  const load = async (s, opts) => {
    opts = opts || {};
    await page.evaluate((x, keepSeen) => {
      localStorage.setItem('little-log-v1', JSON.stringify(x));
      if (!keepSeen) localStorage.removeItem('cubby-seen-local');
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
    }, s, !!opts.keepSeen);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1400);
    await page.evaluate(() => { window.LL = { auth: { currentUser: { uid: 'local' } }, role: 'owner', householdId: 'h1', members: { local: 'owner' }, memberInfo: { local: { name: 'Maya' } } }; });
  };

  /* The real DOM of the real home screen, never document.body.textContent: that string contains the
     inline script's own source, so every sentence this gate looks for is already "on the page"
     whether it rendered or not, and an assertion against it passes with the feature deleted. */
  /* [data-tip="firstentry"], not just .ww-line. The line deliberately borrows the wake-window
     line's class and slot, so an unscoped selector would let any wake-window line answer "is the
     first-entry line on screen" — every null assertion below would then be measuring the wrong
     element. Case 14b holds the attribute itself in place. */
  const homeLine = () => page.evaluate(() => {
    const el = document.querySelector('#scroll .ww-line[data-tip="firstentry"]');
    if (!el) return null;
    const t = el.querySelector('.ww-t');
    return { text: (t ? t.textContent : '').replace(/\s+/g, ' ').trim(),
      buttons: [...el.querySelectorAll('button')].map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim()) };
  });
  const sinceCells = () => page.evaluate(() => [...document.querySelectorAll('#scroll .since-card')]
    .map((c) => ({ k: c.querySelector('.k').textContent.trim(), v: c.querySelector('.v').textContent.trim() })));
  /* Absent reads as empty rather than throwing, so a tree with the feature taken out reports every
     assertion it breaks instead of dying on the first null and looking like one small problem. */
  const T = (l) => (l && l.text) || '';
  const B = (l) => (l && l.buttons) || [];

  console.log('\n1. the very first nappy says what the home screen can now answer');
  {
    await load(seed());
    const before = await sinceCells();
    ok('the three cards start out saying nothing at all', before.length === 3 && before.every((c) => c.v === 'not yet') && before.filter((c) => c.v === 'not yet').length === 3, before);
    ok('and there is no line before she has logged', (await homeLine()) === null);
    await page.evaluate(() => { saveDiaper('wet'); });
    await sleep(120);
    const line = await homeLine();
    ok('the line is on the home screen after the first nappy', !!line && T(line).length > 0, line);
    ok('it opens by naming what just happened, not by counting it', /^That is the first one\./.test(T(line)), T(line));
    ok('it states the capability, using this baby\'s name', /when Robin last fed, slept and had a nappy is the top of your home screen/.test(T(line)), T(line));
    const cells = await sinceCells();
    ok('and it is telling the truth: the nappy card no longer says "not yet"', cells[2].k === 'Last nappy' && cells[2].v !== 'not yet', cells);
  }

  console.log('\n2. no count, no next step, no target');
  {
    /* Every one of these is anchored on the line actually being there. "There is no number in it"
       is trivially true of a line that does not exist, and a charter check that a missing feature
       passes is the kind of green that hides a hole. */
    const line = await homeLine();
    ok('there is no number anywhere in it', !!line && !/\d/.test(T(line)), T(line));
    ok('it asks for nothing: no "log", "add", "try", "keep", "next"', !!line && !/\b(log|add|try|keep|next|now tap|why not)\b/i.test(T(line)), T(line));
    ok('and the only control on it is the way out', B(line).length === 1 && /hide/i.test(B(line)[0]), B(line));
    const cta = await page.evaluate(() => [...document.querySelectorAll('#scroll .ww-line .btn-primary, #scroll .ww-line a, #scroll .ww-line .add-row')].length);
    ok('no call to action is hiding in it', !!line && cta === 0, cta);
  }

  console.log('\n3. a parent with months of history is never told about a screen she reads daily');
  {
    const evs = [];
    for (let d = 0; d < 40; d++) evs.push({ id: 'f' + d, type: 'feed', babyId: 'b1', method: 'bottle', amount: 120, unit: 'ml', time: now - d * DAY - 3 * HOUR, authorId: 'local' });
    await load(seed({ events: evs }));
    ok('nothing on arrival', (await homeLine()) === null);
    await page.evaluate(() => { saveDiaper('wet'); });
    await sleep(120);
    const line = await homeLine();
    ok('and her forty-first entry says nothing new at her', line === null, line);
    const n = await page.evaluate(() => state.events.length);
    ok('the nappy still got written, which was never in doubt', n === 41, n);
    /* The control this case was missing. Three absences in a row are three free passes on a tree
       with the feature deleted; the identical fixture with the history taken off has to speak. */
    await load(seed());
    await page.evaluate(() => { saveDiaper('wet'); });
    await sleep(120);
    ok('CONTROL: the same nappy, in a Cubby with no history, does get the line', (await homeLine()) !== null);
  }

  console.log('\n4. once. not tomorrow, and not every time she walks back onto Home');
  {
    await load(seed());
    await page.evaluate(() => { saveDiaper('wet'); });
    await sleep(120);
    ok('shown the first time', (await homeLine()) !== null);
    await page.evaluate(() => { render(); render(); });
    await sleep(80);
    ok('it does not flicker away on the next repaint while she is reading it', (await homeLine()) !== null);
    await page.evaluate(() => go('log'));
    await sleep(150);
    await page.evaluate(() => go('home'));
    await sleep(150);
    ok('gone once she has been somewhere else and come back', (await homeLine()) === null);
    await load(seed({ events: [{ id: 'd1', type: 'diaper', kind: 'wet', babyId: 'b1', time: now - HOUR, authorId: 'local' }] }), { keepSeen: true });
    ok('and gone tomorrow, because the ledger survived the reload', (await homeLine()) === null);
    const spent = await page.evaluate(() => !!JSON.parse(localStorage.getItem('cubby-seen-local') || '{}').tip_firstentry);
    ok('the ledger says so in writing', spent === true);
  }

  console.log('\n5. a second write in the same minute retires it, the way it retires undo');
  {
    await load(seed());
    await page.evaluate(() => { saveDiaper('wet'); });
    await sleep(120);
    ok('there after the first', (await homeLine()) !== null);
    await page.evaluate(() => { saveDiaper('dirty'); });
    await sleep(120);
    const line = await homeLine();
    ok('gone after the second', line === null, line);
    const n = await page.evaluate(() => state.events.filter((e) => e.type === 'diaper').length);
    ok('both nappies were written', n === 2, n);
  }

  console.log('\n6. a fumbled double tap is one nappy and one line, not two of either');
  {
    await load(seed());
    await page.evaluate(() => { saveDiaper('wet'); saveDiaper('wet'); });
    await sleep(120);
    const r = await page.evaluate(() => ({ n: state.events.length, lines: document.querySelectorAll('#scroll .ww-line[data-tip="firstentry"]').length }));
    ok('the duplicate write is still swallowed', r.n === 1, r);
    ok('and the swallowed tap does not take the line down with it', r.lines === 1, r);
  }

  console.log('\n7. a first entry the three cards cannot show does not get announced');
  {
    await load(seed());
    await page.evaluate(() => { addEvent({ type: 'temperature', temp: 37.2, unit: 'C', time: now(), illnessId: null }); render(); });
    await sleep(120);
    const cells = await sinceCells();
    ok('the home screen still says "not yet" three times', cells.filter((c) => c.v === 'not yet').length === 3, cells);
    ok('so nothing claims she can now see her last feed there', (await homeLine()) === null);
    await page.evaluate(() => { saveDiaper('wet'); });
    await sleep(120);
    ok('her first NAPPY still gets the line, it was only waiting', (await homeLine()) !== null);
  }

  console.log('\n8. logged from another tab, the line waits for her instead of being spent on a paint she never saw');
  {
    await load(seed());
    await page.evaluate(() => go('log'));
    await sleep(150);
    await page.evaluate(() => { saveDiaper('wet'); });
    await sleep(150);
    const onLog = await page.evaluate(() => document.querySelectorAll('#scroll .ww-line').length);
    ok('nothing is drawn on the Log tab, which has no since-row to point at', onLog === 0, onLog);
    await page.evaluate(() => go('home'));
    await sleep(150);
    ok('and it is waiting for her when she gets to Home', (await homeLine()) !== null);
    await page.evaluate(() => go('album'));
    await sleep(150);
    await page.evaluate(() => go('home'));
    await sleep(150);
    ok('spent only once she has actually read it', (await homeLine()) === null);
  }

  console.log('\n9. she can put it away herself');
  {
    await load(seed());
    await page.evaluate(() => { saveDiaper('wet'); });
    await sleep(120);
    ok('there', (await homeLine()) !== null);
    const clicked = await page.evaluate(() => { const x = document.querySelector('#scroll .ww-line .ww-x'); if (!x) return false; x.click(); return true; });
    ok('there is an × on it to tap', clicked === true);
    await sleep(150);
    ok('one tap on the × and it is gone', clicked && (await homeLine()) === null);
    await page.evaluate(() => { render(); });
    await sleep(80);
    ok('and it stays gone', (await homeLine()) === null);
  }

  console.log('\n10. undo takes the sentence back with the entry');
  {
    await load(seed());
    await page.evaluate(() => { saveDiaper('wet'); });
    await sleep(120);
    ok('there', (await homeLine()) !== null);
    await page.evaluate(() => document.querySelector('#toast .toast-act').click());
    await sleep(150);
    const cells = await sinceCells();
    ok('the entry is gone', (await page.evaluate(() => state.events.length)) === 0);
    ok('the home screen says "not yet" again', cells.filter((c) => c.v === 'not yet').length === 3, cells);
    ok('so "that is the first one" is not left hanging over it', (await homeLine()) === null);
    await page.evaluate(() => { saveDiaper('dirty'); });
    await sleep(120);
    ok('and the entry she meant to make gets the line instead', (await homeLine()) !== null);
  }

  console.log('\n11. a nap timer is a first entry too, and it does not go through commitEvent');
  {
    await load(seed({ timers: { b1: { sleep: { start: now - 40 * 60000 } } } }));
    ok('nothing while it is running', (await homeLine()) === null);
    await page.evaluate(() => stopSleep('b1'));
    await sleep(150);
    const line = await homeLine();
    ok('the line arrives when the nap is written', !!line, line);
    ok('and it is the same sentence', /^That is the first one\./.test(T(line)), T(line));
  }

  console.log('\n11b. and so does the timer nobody stopped, which is a fourth write door again');
  {
    /* stopFeed diverts anything over four hours to openFeedCorrect rather than writing a whole-night
       nursing session, and saveFeedCorrect pushes to state.events on its own. A parent whose very
       first entry arrives through that door is exactly the one who most needs telling what she now
       has, and the arming rule has to reach every door or it reaches none. */
    await load(seed({ timers: { b1: { feed: { start: now - 9 * HOUR, side: 'left' } } } }));
    await page.evaluate(() => stopFeed('b1'));
    await sleep(200);
    const diverted = await page.evaluate(() => /When did this feed end\?/.test(document.querySelector('#sheet') ? document.querySelector('#sheet').textContent : ''));
    ok('the overlong timer diverts to the correction sheet rather than writing nine hours', diverted === true);
    ok('and nothing is announced while nothing is written', (await homeLine()) === null);
    await page.evaluate(() => { setWhen('end', now() - 8 * 3600000); saveFeedCorrect('b1'); });
    await sleep(200);
    const n = await page.evaluate(() => state.events.filter((e) => e.type === 'feed').length);
    ok('the corrected feed is written', n === 1, n);
    ok('and it gets the line too', (await homeLine()) !== null);
  }

  console.log('\n12. the quiet mode stays quiet');
  {
    await load(seed({ lossHolding: { local: { at: now - 3 * DAY } } }));
    const holding = await page.evaluate(() => !!myLossHolding());
    ok('she is in the quiet mode', holding === true);
    await page.evaluate(() => { saveDiaper('wet'); });
    await sleep(150);
    ok('logging introduces nothing at her', (await homeLine()) === null);
    const spent = await page.evaluate(() => !!JSON.parse(localStorage.getItem('cubby-seen-local') || '{}').tip_firstentry);
    ok('and it was not silently spent, so she still gets it when she is ready', spent === false);
    /* The control. A silence proves nothing on its own: the same seed with the holding taken off has
       to speak, or this case is only measuring a broken fixture. */
    await load(seed());
    await page.evaluate(() => { saveDiaper('wet'); });
    await sleep(150);
    ok('CONTROL: the identical seed without the holding does show it', (await homeLine()) !== null);
  }

  console.log('\n13. someone else\'s history counts, because the screen already answers');
  {
    const papaFeed = { id: 'p1', type: 'feed', babyId: 'b1', method: 'bottle', amount: 90, unit: 'ml', time: now - 5 * HOUR, authorId: 'uidPapa' };
    const asJoiner = () => page.evaluate(() => { window.LL.role = 'caregiver'; window.LL.members = { local: 'caregiver', uidPapa: 'owner' }; saveDiaper('wet'); });
    await load(seed({ events: [papaFeed] }));
    await asJoiner();
    await sleep(150);
    const line = await homeLine();
    ok('a joiner arriving to a family that logs is not told the screen is new', line === null, line);
    /* And the control again, so the silence above is the history talking and not the role. A joiner
       who is genuinely the first person to log in this Cubby gets the same sentence anyone does. */
    await load(seed());
    await asJoiner();
    await sleep(150);
    ok('CONTROL: the same joiner, first in an empty Cubby, does get it', (await homeLine()) !== null);
  }

  console.log('\n14. twins: the row on screen is the row the sentence is about');
  {
    /* The nappy, feed, pump and sleep sheets all offer Robin / Wren / Both. targetsResolved() lets
       a write land on a baby who is not on screen, and when it does, the three cards this sentence
       points at still read "not yet". Arming on the household's log announced that write in the
       ACTIVE twin's name, and burned the once-per-person mark doing it. */
    const twins = () => seed({
      babies: [
        { id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] },
        { id: 'b2', name: 'Wren', birth: now - 60 * DAY, sex: 'M', routines: [], doctors: [], allergies: [] },
      ], activeBabyId: 'b1' });
    await load(twins());
    await page.evaluate(() => { targetSetOne('b2'); saveDiaper('wet'); });
    await sleep(150);
    const cells = await sinceCells();
    ok('Wren\'s nappy leaves Robin\'s three cards saying "not yet"', cells.filter((c) => c.v === 'not yet').length === 3, cells);
    const line = await homeLine();
    ok('so nothing tells her Robin\'s row now answers, and nothing says Wren in Robin\'s place', line === null, line);
    const wrote = await page.evaluate(() => state.events.map((e) => e.babyId + ':' + e.type));
    ok('the nappy was still written, against Wren', JSON.stringify(wrote) === JSON.stringify(['b2:diaper']), wrote);
    const spent = await page.evaluate(() => !!JSON.parse(localStorage.getItem('cubby-seen-local') || '{}').tip_firstentry);
    ok('and her one shot was not spent on it', spent === false);
    /* The half that made it unrecoverable: Robin's genuine first nappy, the moment this exists for. */
    await page.evaluate(() => { targetSetOne('b1'); saveDiaper('wet'); });
    await sleep(150);
    const line2 = await homeLine();
    ok('Robin\'s own first nappy gets the line', !!line2, line2);
    ok('and it names Robin, the baby whose cards just changed', /when Robin last fed/.test(T(line2)), T(line2));
    const cells2 = await sinceCells();
    ok('which is true: Robin\'s nappy card has stopped saying "not yet"', cells2[2].v !== 'not yet', cells2);
  }

  console.log('\n14b. and "Both" still counts, because the row on screen is one of them');
  {
    const twins = () => seed({
      babies: [
        { id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] },
        { id: 'b2', name: 'Wren', birth: now - 60 * DAY, sex: 'M', routines: [], doctors: [], allergies: [] },
      ], activeBabyId: 'b1' });
    await load(twins());
    await page.evaluate(() => { logTargets = ['b1', 'b2']; saveDiaper('wet'); });
    await sleep(150);
    const line = await homeLine();
    ok('one nappy for both twins does get the line', !!line, line);
    ok('named for the one on screen', /when Robin last fed/.test(T(line)), T(line));
    /* And the element is the one this gate thinks it is reading. Without the attribute every null
       assertion in this file is answered by whatever .ww-line happens to be in the slot. */
    const tagged = await page.evaluate(() => {
      const all = [...document.querySelectorAll('#scroll .ww-line')];
      return { all: all.length, tagged: all.filter((e) => e.getAttribute('data-tip') === 'firstentry').length };
    });
    ok('the line carries data-tip="firstentry", so it cannot be confused with the wake-window line', tagged.tagged === 1, tagged);
  }

  console.log('\n15. she switched babies between logging and looking');
  {
    /* switchBaby() goes to Home. An armed line that ignored which baby it was armed for would paint
       the other twin's name over a row that still says "not yet", and spend the mark there. */
    await load(seed({
      babies: [
        { id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] },
        { id: 'b2', name: 'Wren', birth: now - 60 * DAY, sex: 'M', routines: [], doctors: [], allergies: [] },
      ], activeBabyId: 'b1' }));
    await page.evaluate(() => go('log'));
    await sleep(150);
    await page.evaluate(() => { targetSetOne('b1'); saveDiaper('wet'); });
    await sleep(150);
    await page.evaluate(() => { state.activeBabyId = 'b2'; go('home'); });
    await sleep(200);
    const cells = await sinceCells();
    ok('Wren\'s cards say "not yet", because it was Robin who was logged', cells.filter((c) => c.v === 'not yet').length === 3, cells);
    ok('so nothing is said over Wren\'s row', (await homeLine()) === null);
    const spent = await page.evaluate(() => !!JSON.parse(localStorage.getItem('cubby-seen-local') || '{}').tip_firstentry);
    ok('and nothing was spent there either', spent === false);
    await page.evaluate(() => { state.activeBabyId = 'b1'; render(); });
    await sleep(150);
    const line = await homeLine();
    ok('it is still waiting on Robin\'s screen, where it is true', !!line && /when Robin last fed/.test(T(line)), T(line));
  }

  console.log('\n16. a ticked ritual is a real feed, and it is the fifth write door');
  {
    /* toggleRoutine pushes routinePayload(r) straight into state.events and RITUAL_TYPES covers
       feed, sleep and nappy. A parent who set her rituals up in the wizard and ticked one first got
       nothing, and then never could: her cards had stopped saying "not yet". */
    const withRitual = () => seed({ babies: [{ id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', doctors: [], allergies: [],
      routines: [{ id: 'r1', title: 'Morning bottle', evType: 'feed', time: '08:00', done: {} }] }] });
    await load(withRitual());
    await page.evaluate(() => go('log'));
    await sleep(150);
    await page.evaluate(() => toggleRoutine('r1'));
    await sleep(200);
    const wrote = await page.evaluate(() => state.events.filter((e) => e.type === 'feed').length);
    ok('ticking it writes a real feed', wrote === 1, wrote);
    ok('nothing is drawn on the Log tab, where the rituals live', (await page.evaluate(() => document.querySelectorAll('#scroll .ww-line[data-tip="firstentry"]').length)) === 0);
    await page.evaluate(() => go('home'));
    await sleep(200);
    const cells = await sinceCells();
    ok('her feed card has stopped saying "not yet"', cells[0].k === 'Last feed' && cells[0].v !== 'not yet', cells);
    const line = await homeLine();
    ok('and the line is waiting for her on Home', !!line, line);
    ok('same sentence, her baby\'s name', /^That is the first one\./.test(T(line)) && /when Robin last fed/.test(T(line)), T(line));
  }

  console.log('\n16b. un-ticking it takes the sentence back the way undo does');
  {
    const withRitual = () => seed({ babies: [{ id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', doctors: [], allergies: [],
      routines: [{ id: 'r1', title: 'Morning bottle', evType: 'feed', time: '08:00', done: {} }] }] });
    await load(withRitual());
    await page.evaluate(() => toggleRoutine('r1'));
    await sleep(200);
    ok('shown after the tick', (await homeLine()) !== null);
    await page.evaluate(() => toggleRoutine('r1'));
    await sleep(200);
    const cells = await sinceCells();
    ok('un-ticking puts the row back to "not yet"', cells.filter((c) => c.v === 'not yet').length === 3, cells);
    const spent = await page.evaluate(() => !!JSON.parse(localStorage.getItem('cubby-seen-local') || '{}').tip_firstentry);
    ok('so the mark is given back, and her real first entry still gets it', spent === false);
    await page.evaluate(() => { saveDiaper('wet'); });
    await sleep(150);
    ok('proved by logging one', (await homeLine()) !== null);
  }

  console.log('\n17. a new sibling, written down on purpose: the guard is the ROW, not the household');
  {
    /* Case 3 and this one look alike and are not. There, the same row had been answering since
       March and the line would have been telling her about a screen she reads daily. Here the row
       on screen said "not yet" three times until this entry, because it is a different child's row.
       The household guard could not tell them apart: it blocked the twin whose own row was empty.
       The trade this makes is deliberate and narrow, and the per-person ledger keeps it small:
       anyone who already saw this sentence with their first baby never sees it again. */
    const evs = [];
    for (let d = 0; d < 40; d++) evs.push({ id: 'f' + d, type: 'feed', babyId: 'b1', method: 'bottle', amount: 120, unit: 'ml', time: now - d * DAY - 3 * HOUR, authorId: 'local' });
    await load(seed({
      babies: [
        { id: 'b1', name: 'Robin', birth: now - 700 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] },
        { id: 'b2', name: 'Wren', birth: now - 2 * DAY, sex: 'M', routines: [], doctors: [], allergies: [] },
      ], activeBabyId: 'b2', events: evs }));
    const before = await sinceCells();
    ok('the newborn\'s row says "not yet" three times', before.filter((c) => c.v === 'not yet').length === 3, before);
    ok('and nothing is said before she logs', (await homeLine()) === null);
    await page.evaluate(() => { saveDiaper('wet'); });
    await sleep(150);
    const line = await homeLine();
    ok('her newborn\'s first nappy gets the line', !!line, line);
    ok('named for the newborn, whose row it is', /when Wren last fed/.test(T(line)), T(line));
    /* And the boundary holds: switch back to the two-year-old, whose row has answered for a year,
       and there is nothing there. */
    await load(seed({
      babies: [
        { id: 'b1', name: 'Robin', birth: now - 700 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] },
        { id: 'b2', name: 'Wren', birth: now - 2 * DAY, sex: 'M', routines: [], doctors: [], allergies: [] },
      ], activeBabyId: 'b1', events: evs }));
    await page.evaluate(() => { saveDiaper('wet'); });
    await sleep(150);
    ok('the sibling with a year of history is still told nothing', (await homeLine()) === null);
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'FIRST-ENTRY-LINE: FAIL' : 'FIRST-ENTRY-LINE: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
