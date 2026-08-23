#!/usr/bin/env node
/* The kick counter promised her a usual and never worked one out.
 *
 * teach-data.js sells this sheet as "you learn what usual looks like for your baby, which is the
 * thing that makes a change worth mentioning", and its own sub line says "your own normal pattern
 * matters most". Then finishKicks filed {start, end, count} and the sheet printed five raw rows of
 * clock times, and nothing anywhere in the app ever compared them. So the learning was left to a
 * woman lying in the dark at 38 weeks, counting, trying to remember whether last Tuesday took
 * twenty minutes or fifty, at the one moment in this whole product where she is least able to do
 * arithmetic. That is the moment the sheet exists for.
 *
 * Now three or more counts that reached ten produce one sentence above the tap button, in the past
 * tense, from her own numbers: "Your last six counts that reached 10 took about 20 to 35 minutes."
 * And when the count in progress runs past the top of that range, nothing is coloured and no verdict
 * is given; the line the sheet has always carried at the bottom, about not waiting and calling her
 * midwife, moves up out of the scrolling list of old sessions to sit beside the count.
 *
 * What this gate holds shut:
 *
 *   1. Sessions she stopped early are not baseline. "Stop and save" files a count of three when the
 *      phone rings, and that measures how long she sat down for, not how long her baby took. Five
 *      saved sessions of which two reached ten must produce no sentence at all, because the
 *      sentence claims they reached ten. The written proposal says "three or more saved sessions"
 *      and is wrong about the code on exactly this point.
 *   2. The window is six AND twenty eight days, so neither a slow night at 28 weeks nor a pattern
 *      from a month ago can be read back to her at 38 weeks as her usual.
 *   3. The sentence says "counts that reached 10", never "sessions", because the Recent list four
 *      lines below prints the abandoned ones and would contradict it on her own screen. And it says
 *      10, matching "aim for 10" above it and "10 movements" below it.
 *   4. A GAPPED session never triggers the past-longest line, however many times she taps. The
 *      first version of this guard read kickResumed, which tapKick clears on the first tap, so one
 *      tap on a session picked up across a five-hour gap printed "you are past the longest of those"
 *      with the maternity-unit line hoisted up beside it. Almost all of the minutes it warned her
 *      about were the phone locked. That is the worst thing this sheet could do, and §9 is the
 *      reproduction. The guard now reads kickGapped, which nothing clears for the life of the
 *      session, and every positive fixture below reaches the state through a genuinely live count.
 *   5. A gapped session saved to ten is filed gapped and stays out of the arithmetic, or the hours
 *      the phone was locked widen her usual until a slow night looks ordinary.
 *   6. A count that reached ten never triggers it. She got there.
 *   7. A non-owner never triggers it. He can tap this button on his own phone; pregResumeSession is
 *      owner-gated but tapKick is not, so his idle tapping used to become a reading about her baby.
 *   8. The past-longest line carries no number of its own. It used to end "about 35 minutes", the
 *      baseline, glued to a clause whose subject was her current count, over "36m so far".
 *   9. Nothing is coloured, in either state, and the safety line appears exactly once.
 *
 *   PORT=9633 node tools/serve.js &
 *   node tools/kick_baseline_check.js http://localhost:9633
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:9633';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, MIN = 60000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

// A filed session: it started `agoDays` ago and ran `mins` minutes to `count` movements.
let sid = 0;
const sess = (agoDays, mins, count) => {
  const start = now - agoDays * DAY;
  return { id: 'k' + (++sid), start: start, end: start + mins * MIN, count: count === undefined ? 10 : count };
};
const preg = (weeks, over) => Object.assign({
  id: 'p1', ownerUid: 'local', stage: 'expecting',
  dueDate: now + (40 - weeks) * 7 * DAY, lmp: now - weeks * 7 * DAY, cycleLen: 28, periods: [],
  country: 'us', precon: [], careTeam: [{ id: 'c1', name: 'Midwife team', phone: '+44 20 7946 0000' }],
  appts: [], symptoms: [], weights: [], bp: [], kicks: [], contractions: [], birthPlan: '', bag: [],
  moments: [], conditions: {}, glucose: [], urine: [], supplements: [], supplementLog: [], nausea: [],
  glucoseUnit: 'mmol', bornBabyId: null, createdAt: now - weeks * 7 * DAY,
}, over || {});
const seed = (p) => ({ babies: [], activeBabyId: null, events: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], notes: [], pregnancy: p });

const USUAL = /(Your|The) last (one|two|three|four|five|six|\d+) counts that reached 10 took about ([0-9 to]+) minutes\./;
// Any sentence at all that hands her a range for how long a count takes. Kept deliberately loose so
// a reworded overclaim cannot slip through the assertions that demand silence.
const ANY_RANGE = /(counts|sessions) (that )?(reached|reaching) (10|ten)/i;
const PAST = /has been going longer than any of those/;

(async () => {
  // A gate on the default port once graded a different agent's checkout and reported failures that
  // were not in the code under test. That happened again while this one was being written: another
  // worktree had already taken the first port chosen. Prove the served tree carries this change
  // before believing a single number below.
  let src = '';
  try { src = await (await fetch(BASE + '/app/index.html')).text(); } catch (e) { src = ''; }
  ok('the tree being served at ' + BASE + ' is the one carrying this change',
    /function kickBaseline\(/.test(src) && /kick-usual/.test(src), src ? src.length + ' bytes, no marker' : 'could not fetch');

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  // The shift is read live off window.__shift rather than captured, so a fixture can age a session
  // that is already live IN MEMORY. Without that, the only way to reach a long-running count is to
  // restore one from p.kickOpen, which is exactly the gapped path this feature must stay silent on:
  // a gate built that way can only ever certify the bug.
  await page.evaluateOnNewDocument((shift) => {
    window.__shift = shift;
    const R = Date;
    function D(...a) { return a.length === 0 ? new R(R.now() + window.__shift) : new R(...a); }
    D.prototype = R.prototype; D.now = () => R.now() + window.__shift; D.parse = R.parse; D.UTC = R.UTC;
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
    await page.reload({ waitUntil: 'networkidle2' });   // resets window.__shift with the document
    await sleep(1400);
    await page.evaluate(() => { try { window.__toasts = []; window.toast = function (m) { window.__toasts.push(m); }; } catch (e) {} });
    await sleep(200);
  };
  // Read the sheet's real DOM. Never document.body.textContent: this app's whole source sits in an
  // inline <script> inside the body, so body text contains the very strings under test and would
  // hand back a pass on a page that renders nothing.
  const sheet = async () => { await sleep(280); return page.evaluate(() => {
    const s = document.getElementById('sheet');
    if (!s) return { txt: '', usual: null, watches: 0 };
    const u = s.querySelector('.kick-usual'), big = s.querySelector('.kick-big');
    const watch = Array.from(s.querySelectorAll('.kick-watch'));
    const first = watch[0], row = s.querySelector('.log-list-item');
    const cs = (el) => { const c = getComputedStyle(el); return { color: c.color, bg: c.backgroundColor }; };
    const txt = (s.innerText || '').replace(/\s+/g, ' ').trim();
    return {
      txt: txt,
      usual: u ? u.textContent.replace(/\s+/g, ' ').trim() : null,
      usualStyle: u ? cs(u) : null,
      subStyle: s.querySelector('.sub:not(.kick-usual)') ? cs(s.querySelector('.sub:not(.kick-usual)')) : null,
      usualBeforeButton: !!(u && big && (u.compareDocumentPosition(big) & Node.DOCUMENT_POSITION_FOLLOWING)),
      usualVisible: !!(u && u.getBoundingClientRect().height > 0),
      watchNodes: watch.length,
      watchTexts: (txt.match(/Contact your midwife or maternity unit straight away/g) || []).length,
      watchStyle: first ? cs(first) : null,
      watchAboveRecent: !!(first && row && (first.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING)
        && first.getBoundingClientRect().top < row.getBoundingClientRect().top),
      recentRows: s.querySelectorAll('.log-list-item').length,
      firstRow: row ? (row.innerText || '').replace(/\s+/g, ' ').trim() : null,
      count: s.querySelector('.kb-n') ? s.querySelector('.kb-n').textContent.trim() : null,
      hint: s.querySelector('.kb-c') ? s.querySelector('.kb-c').textContent.trim() : null,
    };
  }); };
  // A click that lands on nothing turns every assertion after it into a tautology, silently, inside
  // a run that still reports PASS.
  const click = async (sel) => {
    const hit = await page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.click(); return true; }, sel);
    if (!hit) ok('a real control exists to click for ' + sel, false);
    return hit;
  };
  const open = async () => { await page.evaluate(() => { closeSheet(); openKickCounter(); }); return sheet(); };
  const rec = () => page.evaluate(() => JSON.parse(JSON.stringify(state.pregnancy)));
  // Move the wall clock forward under a session that is already live in memory. This is how a real
  // count gets long: she started it here, in the app, and has been sitting with it.
  const advance = (mins) => page.evaluate((m) => { window.__shift += m * 60000; }, mins);
  // She opens the sheet with no session on the record, taps once, and sits there for `mins`.
  const liveCount = async (p, mins, taps) => {
    await load(seed(p));
    await page.evaluate(() => { closeSheet(); openKickCounter(); });
    await click('.kick-big');
    await advance(mins);
    for (let i = 0; i < (taps || 1); i++) await click('.kick-big');
    return sheet();
  };
  const section = async (name, fn) => {
    console.log('\n' + name);
    try { await fn(); } catch (e) { ok(name + ' ran to the end', false, String((e && e.message) || e)); }
  };

  // Captured once from a sheet that is definitely not in the past-her-longest state, then compared
  // against the same element when it is. "Do not colour anything" has to be measured, not assumed.
  let calmWatch = null, calmSub = null;
  const THREE = [sess(9, 21), sess(6, 27), sess(3, 34)];   // 20 to 35 minutes

  await section('1. with nothing to go on, the sheet says nothing', async () => {
    await load(seed(preg(30)));
    const s = await open();
    ok('a first-ever count gets no baseline sentence', s.usual === null, s.usual);
    ok('and no invented range leaks into the sheet at all', !USUAL.test(s.txt) && !ANY_RANGE.test(s.txt), s.txt.slice(0, 200));
    ok('the safety line is there exactly once, as it always was', s.watchTexts === 1 && s.watchNodes === 1, { nodes: s.watchNodes, texts: s.watchTexts });
    calmWatch = s.watchStyle; calmSub = s.subStyle;
    ok('and it is a real rendered element with a measured colour', !!(calmWatch && calmWatch.color), calmWatch);
  });

  await section('2. two full counts are a pair, not a usual', async () => {
    await load(seed(preg(31, { kicks: [sess(6, 21), sess(3, 34)] })));
    const s = await open();
    ok('two sessions is below the floor', s.usual === null, s.usual);
    ok('and both are on the record, so this is the rule firing and not an empty list', (await rec()).kicks.length === 2, (await rec()).kicks.length);
    ok('the recent list still shows them', s.recentRows === 2, s.recentRows);
    // Silence is also what a missing feature looks like. Add the third and the sentence must arrive,
    // or "below the floor" above was never measuring the floor.
    await load(seed(preg(31, { kicks: [sess(6, 21), sess(4, 27), sess(3, 34)] })));
    const s2 = await open();
    ok('the third one earns it', s2.usual === 'Your last three counts that reached 10 took about 20 to 35 minutes.', s2.usual);
  });

  await section('3. counts she stopped early are not a baseline, however many there are', async () => {
    // This is the proposal's mistake. Five saved sessions, three of them abandoned at three or four
    // movements because the phone rang. Averaging those in would say she reaches ten in about five
    // minutes and make every honest full count look slow.
    await load(seed(preg(31, { kicks: [sess(9, 4, 3), sess(8, 6, 4), sess(6, 21), sess(4, 5, 2), sess(2, 34)] })));
    const s = await open();
    const p = await rec();
    ok('five sessions are saved', p.kicks.length === 5, p.kicks.length);
    ok('exactly two of them reached ten', p.kicks.filter((k) => k.count >= 10).length === 2, p.kicks.map((k) => k.count));
    ok('so there is still no sentence', s.usual === null, s.usual);
    ok('and nothing claims a range built out of counts that never reached ten', !ANY_RANGE.test(s.txt), s.txt.slice(0, 200));
    await page.evaluate(() => { state.pregnancy.kicks[0].count = 10; });
    const s2 = await open();
    ok('the moment a third one reaches ten, the sentence arrives',
      s2.usual === 'Your last three counts that reached 10 took about 5 to 35 minutes.', s2.usual);
  });

  await section('4. the sentence says what it actually measured, in the numeral the sheet already uses', async () => {
    // Three full counts, and the two most recent sessions are abandoned. "Your last three sessions"
    // would be false, and the Recent list directly below would be the proof: the first row she sees
    // is a count of four. The sentence has to be about counts that reached 10, not about sessions.
    await load(seed(preg(38, { kicks: [sess(20, 21), sess(18, 27), sess(16, 34), sess(3, 6, 3), sess(1, 8, 4)] })));
    const s = await open();
    ok('the top of her recent list is an abandoned count', /4 movements/.test(s.firstRow || ''), s.firstRow);
    ok('so the sentence must not call the baseline "her last three sessions"', !/last three sessions/i.test(s.txt), s.usual);
    ok('it names counts that reached 10', s.usual === 'Your last three counts that reached 10 took about 20 to 35 minutes.', s.usual);
    ok('and it writes 10 as a numeral, like "aim for 10" above it and "10 movements" below it',
      !/reached ten/i.test(s.txt) && /reached 10 /.test(s.usual || ''), s.usual);
  });

  await section('5. three full counts earn the sentence, above the tap button', async () => {
    await load(seed(preg(32, { kicks: [sess(9, 4, 3), sess(6, 21), sess(4, 27), sess(2, 34)] })));
    const s = await open();
    ok('the sentence is there', s.usual === 'Your last three counts that reached 10 took about 20 to 35 minutes.', s.usual);
    ok('the abandoned count is not in the arithmetic, or the range would start at 5', !/about 5 to/.test(s.usual || ''), s.usual);
    ok('it sits above the tap button, where she is looking', s.usualBeforeButton, s.usualBeforeButton);
    ok('and it is actually rendered, not a zero-height node', s.usualVisible, s.usualVisible);
    ok('it reads in the same calm ink as the sub line above it', s.usualStyle && calmSub && s.usualStyle.color === calmSub.color, { line: s.usualStyle, sub: calmSub });
    ok('no verdict, no target, no count of what was missed', !/should|target|normal range|too slow|good|well done/i.test(s.usual || ''), s.usual);
    ok('the safety line is still exactly once, still at the bottom', s.watchTexts === 1 && !s.watchAboveRecent, { texts: s.watchTexts, above: s.watchAboveRecent });
  });

  await section('6. the window is six, so an old slow night cannot widen tonight', async () => {
    const old = [sess(27, 180), sess(25, 150), sess(24, 120)];
    const recent6 = [sess(9, 21), sess(8, 24), sess(7, 26), sess(5, 29), sess(3, 31), sess(1, 34)];
    await load(seed(preg(36, { kicks: old.concat(recent6) })));
    const s = await open();
    ok('nine full sessions are on the record, all inside the age window', (await rec()).kicks.length === 9, (await rec()).kicks.length);
    ok('the sentence counts six, not nine', /last six counts/.test(s.usual || ''), s.usual);
    ok('and the three-hour nights are outside it', s.usual === 'Your last six counts that reached 10 took about 20 to 35 minutes.', s.usual);
  });

  await section('7. and the window has an age, so a pattern from a month ago is not read back to her', async () => {
    // Six is a count, not a date. Someone who counts once a fortnight carries six sessions across
    // five months, and the sentence would present a night from week 28 as her usual at week 38 with
    // nothing on screen saying how old it is.
    await load(seed(preg(38, { kicks: [sess(60, 21), sess(45, 27), sess(31, 34), sess(29, 30)] })));
    const s = await open();
    ok('four full counts are on the record', (await rec()).kicks.length === 4, (await rec()).kicks.length);
    ok('but every one of them is over four weeks old, so she is told nothing', s.usual === null, s.usual);
    ok('and no stale range leaks into the sheet', !ANY_RANGE.test(s.txt), s.txt.slice(0, 200));
    // Mixed: three fresh ones qualify, and the old slow nights must not widen them.
    await load(seed(preg(38, { kicks: [sess(60, 180), sess(45, 150), sess(31, 120)].concat(THREE) })));
    const s2 = await open();
    ok('with three fresh counts it speaks again, and only about those three',
      s2.usual === 'Your last three counts that reached 10 took about 20 to 35 minutes.', s2.usual);
  });

  await section('8. when her counts are all alike, it says one number rather than a fake range', async () => {
    await load(seed(preg(33, { kicks: [sess(7, 24), sess(5, 25), sess(3, 26)] })));
    const s = await open();
    ok('one number, no "to"', s.usual === 'Your last three counts that reached 10 took about 25 minutes.', s.usual);
  });

  await section('9. a live count still inside her usual is left alone', async () => {
    const s = await liveCount(preg(36, { kicks: THREE.slice() }), 10);
    ok('the session is live and elapsed is being shown', /so far/.test(s.txt) && s.count === '2', { count: s.count, txt: s.txt.slice(0, 160) });
    ok('the baseline sentence is there', /last three counts that reached 10/.test(s.usual || ''), s.usual);
    ok('but nothing says she is past anything', !PAST.test(s.txt), s.txt.slice(0, 240));
    ok('and the safety line stays at the bottom, once', s.watchTexts === 1 && !s.watchAboveRecent, { texts: s.watchTexts, above: s.watchAboveRecent });
  });

  await section('10. past her own longest, on a count she has been sitting with, the line comes up beside it', async () => {
    // Started here, in the app, with nothing in p.kickOpen to restore. This is the only honest way
    // to reach fifty minutes: the whole fifty were minutes she was counting.
    const s = await liveCount(preg(36, { kicks: THREE.slice() }), 50);
    ok('fifty minutes in, on a usual that tops out at thirty five', s.count === '2' && /so far/.test(s.txt), { count: s.count, txt: s.txt.slice(0, 160) });
    ok('it names her own range first', /Your last three counts that reached 10 took about 20 to 35 minutes\./.test(s.usual || ''), s.usual);
    ok('then states the fact about this count', / This one has been going longer than any of those\./.test(s.usual || ''), s.usual);
    ok('and carries no number of its own to be mistaken for her elapsed time',
      (s.usual || '').split(/\bminutes\b/).length === 2 && !/about 35 minutes\. *$/.test(s.usual || ''), s.usual);
    ok('the safety line has moved up out of the old-session list', s.watchAboveRecent, { above: s.watchAboveRecent, rows: s.recentRows });
    ok('and it was moved, not duplicated', s.watchTexts === 1 && s.watchNodes === 1, { nodes: s.watchNodes, texts: s.watchTexts });
    ok('there are old sessions below it for it to have moved above', s.recentRows === 3, s.recentRows);
    ok('nothing is coloured: same ink as the calm sheet', s.watchStyle && calmWatch && s.watchStyle.color === calmWatch.color, { over: s.watchStyle, calm: calmWatch });
    ok('and the same background: no alarm panel', s.watchStyle && calmWatch && s.watchStyle.bg === calmWatch.bg, { over: s.watchStyle, calm: calmWatch });
    ok('the sentence is her own past, not a diagnosis or an instruction to panic', !/danger|urgent|abnormal|warning|emergency|risk/i.test(s.usual || ''), s.usual);
    // The single-number baseline has to read as English here too, and used to fork to "past that".
    const s2 = await liveCount(preg(33, { kicks: [sess(7, 24), sess(5, 25), sess(3, 26)] }), 40);
    ok('and it reads the same way against a single-number usual',
      s2.usual === 'Your last three counts that reached 10 took about 25 minutes. This one has been going longer than any of those.', s2.usual);
  });

  await section('11. a session picked up after the app was shut never says it, however many times she taps', async () => {
    // THE REPRODUCTION. She counted four movements in five minutes, the phone locked, she dozed off,
    // and she opens the app again inside the resume window. The gap is where she was not using the
    // app, not where her baby was not moving. The guard used to be kickResumed, which tapKick clears
    // on the first tap, so one tap turned 39 locked minutes into "you are past the longest of those"
    // with the maternity-unit line hoisted up beside it, at 36 weeks, at midnight.
    const p = preg(37, { kicks: THREE.slice() });
    const t = await page.evaluate(() => Date.now());
    p.kickOpen = { start: t - 5 * 3600000, last: t - 4 * MIN, count: 4 };
    await load(seed(p));
    const s = await open();
    ok('it is genuinely the resumed state', /Picked up from/.test(s.txt) && s.count === '4', { count: s.count, txt: s.txt.slice(0, 160) });
    ok('five hours of gap does not become a warning', !PAST.test(s.txt), s.txt.slice(0, 240));
    ok('the safety line stays where it was', s.watchTexts === 1 && !s.watchAboveRecent, { texts: s.watchTexts, above: s.watchAboveRecent });
    ok('her usual is still stated, because that part is only about the past', /last three counts that reached 10/.test(s.usual || ''), s.usual);
    // One tap. This is the entire interaction, and it is where it used to break.
    await click('.kick-big');
    const s2 = await sheet();
    ok('after she taps, the count is hers again', s2.count === '5', s2.count);
    ok('and it STILL does not tell her she is past her longest', !PAST.test(s2.txt), s2.txt.slice(0, 240));
    ok('the safety line has still not been hoisted up beside the count', !s2.watchAboveRecent && s2.watchTexts === 1, { above: s2.watchAboveRecent, texts: s2.watchTexts });
    // Nor on the second, nor the fifth: the guard is for the life of the session, not for one tap.
    for (let i = 0; i < 4; i++) await click('.kick-big');
    const s3 = await sheet();
    ok('nor after five taps', s3.count === '9' && !PAST.test(s3.txt), { count: s3.count, txt: s3.txt.slice(0, 200) });
    ok('and the safety line is still at the bottom, exactly once', s3.watchTexts === 1 && !s3.watchAboveRecent, { texts: s3.watchTexts, above: s3.watchAboveRecent });
  });

  await section('12. a gapped session saved to ten does not become part of her usual', async () => {
    // Same session, tapped to ten and saved. finishKicks files end = last tap, so its recorded five
    // hours are mostly a locked phone. Averaged in, her usual becomes "20 to 300 minutes" and no
    // slow night could ever be past it again.
    const p = preg(37, { kicks: THREE.slice() });
    const t = await page.evaluate(() => Date.now());
    p.kickOpen = { start: t - 5 * 3600000, last: t - 4 * MIN, count: 9 };
    await load(seed(p));
    await page.evaluate(() => openKickCounter());
    await click('.kick-big');
    const s = await sheet();
    ok('she has just reached ten on the picked-up session', s.count === '10', s.count);
    await click('[onclick="finishKicks()"]');
    const rp = await rec();
    ok('it is filed', rp.kicks.length === 4, rp.kicks.length);
    ok('and it is filed as gapped', rp.kicks[3].gapped === true, rp.kicks[3]);
    const s2 = await open();
    ok('so her usual is unchanged, still built from the three real counts',
      s2.usual === 'Your last three counts that reached 10 took about 20 to 35 minutes.', s2.usual);
    ok('the five hours never reach the range', !/to 300|to 295|to 305/.test(s2.usual || ''), s2.usual);
  });

  await section('13. a count that reached ten is never told it took too long', async () => {
    const s = await liveCount(preg(38, { kicks: THREE.slice() }), 95, 9);
    ok('she has just reached ten', s.count === '10' && s.hint === 'All done 🎉', { count: s.count, hint: s.hint });
    ok('after ninety five minutes, which is well past her longest', /so far/.test(s.txt), s.txt.slice(0, 200));
    ok('and she is told nothing about being late', !PAST.test(s.txt), s.txt.slice(0, 240));
    ok('the safety line is back at the bottom, once', s.watchTexts === 1 && !s.watchAboveRecent, { texts: s.watchTexts, above: s.watchAboveRecent });
  });

  await section('14. the sentence updates when she saves the count that completes it', async () => {
    await load(seed(preg(34, { kicks: [sess(8, 21), sess(5, 34)] })));
    let s = await open();
    ok('two full counts, so no sentence yet', s.usual === null, s.usual);
    for (let i = 0; i < 10; i++) await click('.kick-big');
    await click('[onclick="finishKicks()"]');
    const p = await rec();
    ok('the third is filed with ten movements', p.kicks.length === 3 && p.kicks[2].count === 10, p.kicks.map((k) => k.count));
    ok('and it is not marked gapped, because she counted it right here', !p.kicks[2].gapped, p.kicks[2]);
    s = await open();
    ok('and now the sheet has a usual to tell her', /last three counts that reached 10/.test(s.usual || ''), s.usual);
    // Everything here has gone through persist(), so it must survive the app being closed.
    await load(seed(p));
    s = await open();
    ok('which survives a reload, because it is derived from what was saved', /last three counts that reached 10/.test(s.usual || ''), s.usual);
  });

  await section('15. a partner reading her journey', async () => {
    // The journey reaches him by consent and the kicks are on it, so hiding the sentence from him
    // would be hiding the thing he is there to help with. But it is not his count, and tapKick is
    // not owner-gated: he can build a live session on his own phone, and it must never become a
    // reading about her baby.
    const p = preg(36, { ownerUid: 'her-uid', kicks: THREE.slice() });
    p.kickOpen = { start: now - 90 * MIN, last: now - 30000, count: 4 };
    await load(seed(p));
    // In ?e2e=1 there is no signed-in user, and matIsOwner answers true when auth.currentUser is
    // null, so seeding a foreign ownerUid alone does NOT produce a non-owner. Stub the one function
    // the gate is actually about, the way preg_session_resume_check does.
    await page.evaluate(() => { window.LL = window.LL || {}; window.LL.matIsOwner = function () { return false; }; });
    ok('this really is a non-owner view', await page.evaluate(() => pregIsOwner() === false), await page.evaluate(() => pregIsOwner()));
    const s = await open();
    ok('he reads her usual, in words that are true for him', s.usual === 'The last three counts that reached 10 took about 20 to 35 minutes.', s.usual);
    ok('it is not addressed to him as if the counts were his', !/^Your/.test(s.usual || ''), s.usual);
    ok('he is not handed her live count', s.count === '0' && s.hint === 'Tap to start', { count: s.count, hint: s.hint });
    ok('and nothing on his screen claims she is past her longest', !PAST.test(s.txt), s.txt.slice(0, 240));
    ok('the safety line is intact on his copy too', s.watchTexts === 1, s.watchTexts);
    // He taps. tapKick builds a session in memory whatever pregResumeSession says, so he can sit
    // there past the top of her range on his own phone.
    await click('.kick-big');
    await advance(90);
    await click('.kick-big');
    const s2 = await sheet();
    ok('he can build a live count of his own', s2.count === '2' && /so far/.test(s2.txt), { count: s2.count, txt: s2.txt.slice(0, 160) });
    ok('ninety minutes of his tapping says nothing about her baby', !PAST.test(s2.txt), s2.txt.slice(0, 240));
    ok('and the safety line is not hoisted up on his sheet either', !s2.watchAboveRecent && s2.watchTexts === 1, { above: s2.watchAboveRecent, texts: s2.watchTexts });
    ok('he is still reading the neutral wording', !/^Your/.test(s2.usual || ''), s2.usual);
  });

  await section('16. the stage boundary and junk on the record', async () => {
    // Before 28 weeks, in the trying stage, and after the birth, the counter is still a function
    // somebody can reach; it must not throw, and it must not invent a usual out of nothing.
    await load(seed(preg(20)));
    const s = await open();
    ok('at twenty weeks with no counts, no sentence', s.usual === null, s.usual);
    const safe = await page.evaluate(() => {
      const p = state.pregnancy, keep = p.kicks, t = Date.now();
      const out = {};
      p.kicks = null; out.nullList = kickBaseline();
      p.kicks = [null, undefined, {}, { count: 10 }, { count: 10, start: 5, end: 4 }]; out.junk = kickBaseline();
      p.kicks = [0, 1, 2].map((i) => ({ count: 10, start: t - (i + 1) * 3600000, end: t - (i + 1) * 3600000 + 60000 }));
      out.tiny = kickBaseline(); out.tinyLine = kickUsualLine(kickBaseline());
      p.kicks = [0, 1, 2].map((i) => ({ count: 10, start: t - (i + 1) * 3600000, end: t - (i + 1) * 3600000 + 60000, gapped: true }));
      out.allGapped = kickBaseline();
      p.kicks = keep;
      const saved = state.pregnancy; state.pregnancy = null; out.noPreg = kickBaseline(); state.pregnancy = saved;
      return out;
    });
    ok('a missing kicks list is survivable', safe.nullList === null, safe);
    ok('null and half-written rows are ignored rather than thrown on', safe.junk === null, safe);
    ok('no pregnancy at all is survivable', safe.noPreg === null, safe);
    ok('a one-minute session never rounds down to "about 0 minutes"', safe.tiny && safe.tiny.lo === 5 && safe.tiny.hi === 5, safe.tiny);
    ok('and reads as a sentence', safe.tinyLine === 'Your last three counts that reached 10 took about 5 minutes.', safe.tinyLine);
    ok('a record of nothing but gapped sessions produces no usual at all', safe.allGapped === null, safe.allGapped);
  });

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'KICK-BASELINE: FAIL' : 'KICK-BASELINE: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
