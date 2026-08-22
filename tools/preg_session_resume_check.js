#!/usr/bin/env node
/* The two labour tools used to lose the session in progress to anything that reloaded the page.
 *
 * kickSession and contractionRunning were module variables and nothing else. A phone call, a lock
 * screen, an iOS PWA relaunch or a service-worker update mid-session and the kick count was back at
 * zero with no record it ever happened, and a contraction being timed had simply gone. A woman
 * times contractions while she is in labour: that is the worst moment in this product to drop what
 * she has just given us, and it is also the moment she is least able to start again.
 *
 * The session now lives on the pregnancy record too, as p.kickOpen and p.contractionOpen, and is
 * picked up again the next time she opens the tool. Restoring has three ways of going wrong, and
 * each one is worse than losing the count, so this gate holds all three shut:
 *
 *   1. Staleness is measured from her last tap, not from when she began. Kicks resume after 45
 *      minutes of quiet, a contraction after 3 minutes. A count abandoned before bed must not greet
 *      her in the morning, and a timer she walked away from must never become, on one tap, a
 *      contraction minutes long that poisons the average duration and the 5-1-1 read.
 *   2. Nothing already filed comes back. applyPregJourney merges the journey doc key by key and
 *      never deletes, so a session saved on her phone lingers on her second signed-in device. It
 *      must not reappear there as a live session, and it must never be filed twice at the same
 *      start.
 *   3. A resumed session states no elapsed time. "Started 11:30 PM, 3h 40m so far" over a count of
 *      four is a reduced-movement reading invented out of the gap where she was not using the app,
 *      shown directly above the card that tells her to call. And a saved resumed count ends at her
 *      last tap, so the row in Recent is her counting rather than her night.
 *
 * Owner only, in both directions: her partner must never find a Stop button over her labour.
 *
 * In ?e2e=1 there is no cloud, and persist() is already overridden to the (no-op) push path, so
 * "reload" here means: take the pregnancy record exactly as the app left it, boot a fresh page on
 * it, and see what she gets. That is precisely what the journey doc round trip does in production.
 *
 *   PORT=9358 node tools/serve.js &
 *   node tools/preg_session_resume_check.js http://localhost:9358
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:9358';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, HOUR = 3600000, MIN = 60000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

// weeksPregnant -> a pregnancy record at that gestation.
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

(async () => {
  // A first run of this gate once graded a different checkout on the default port and reported four
  // failures that were not in the code under test. Prove the served tree is this one before
  // believing anything below.
  let src = '';
  try { src = await (await fetch(BASE + '/app/index.html')).text(); } catch (e) { src = ''; }
  ok('the tree being served at ' + BASE + ' is the one carrying this change',
    /KICK_GAP_MS/.test(src) && /Picked up from/.test(src), src ? src.length + ' bytes, no marker' : 'could not fetch');

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
    await page.evaluate(() => { try { window.__toasts = []; window.toast = function (m) { window.__toasts.push(m); }; } catch (e) {} });
    await sleep(200);
  };
  // The phone call, the lock screen, the service-worker update: boot a brand-new page on the record
  // as the app last left it. Nothing in memory survives this.
  const reboot = async () => {
    const p = await page.evaluate(() => JSON.parse(JSON.stringify(state.pregnancy)));
    await load(seed(p));
    return p;
  };
  const rec = () => page.evaluate(() => JSON.parse(JSON.stringify(state.pregnancy)));
  // CLOCK is fixed at the top of the run, but the page's clock keeps moving, so by the later
  // sections a seed written as "CLOCK minus 2m50s" is really three minutes old and a cut-off test
  // grades the wrong side of its own boundary. Seeds that sit close to a boundary are written
  // against the page's clock as it stands at that moment.
  const pnow = () => page.evaluate(() => Date.now());
  // A click that lands on nothing turns the assertion after it into a tautology, and it does that
  // silently in a run that reports PASS. A miss is a failure, loudly, at the point it happens.
  const click = async (sel) => {
    const hit = await page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.click(); return true; }, sel);
    if (!hit) ok('a real control exists to click for ' + sel, false);
    return hit;
  };
  // The sheet slides in, and innerText reports only what has actually been laid out, so read it
  // after the animation rather than racing it.
  const sheet = async () => { await sleep(250); return page.evaluate(() => {
    const s = document.getElementById('sheet');
    const n = s && s.querySelector('.kb-n'), c = s && s.querySelector('.kb-c');
    return { txt: ((s && s.innerText) || '').replace(/\s+/g, ' ').trim(),
      count: n ? n.textContent.trim() : null,
      hint: c ? c.textContent.trim() : null,
      hasFinish: !!(s && s.querySelector('[onclick="finishKicks()"]')),
      hasUndo: !!(s && s.querySelector('[onclick="undoKick()"]')) };
  }); };
  const sheetText = async () => { await sleep(250); return page.evaluate(() => (document.getElementById('sheet').innerText || '').replace(/\s+/g, ' ').trim()); };
  // On reverted code some of these sections throw part-way (reading kicks[0] of an empty array).
  // A regression should be read as a section-by-section diagnosis, not a stack trace, so a throw
  // counts as one failure and the remaining sections still run.
  const section = async (name, fn) => {
    console.log('\n' + name);
    try { await fn(); } catch (e) { ok(name + ' ran to the end', false, String((e && e.message) || e)); }
  };

  await section('1. a kick count in progress survives the phone being taken away', async () => {
    await load(seed(preg(30)));
    await page.evaluate(() => openKickCounter());
    for (let i = 0; i < 7; i++) { await click('.kick-big'); }
    const p = await rec();
    ok('seven taps are on the record, not only in memory', p.kickOpen && p.kickOpen.count === 7, p.kickOpen);
    ok('her last tap is recorded too, because that is what says she is still counting', typeof p.kickOpen.last === 'number' && p.kickOpen.last >= p.kickOpen.start, p.kickOpen);
    ok('an open count is NOT filed as a finished session', (p.kicks || []).length === 0, p.kicks);
    await reboot();
    const s = await sheet();
    ok('nothing is restored before she asks for it', s.txt === '', s.txt.slice(0, 80));
    await page.evaluate(() => openKickCounter());
    const s2 = await sheet();
    ok('reopening shows all seven, not zero', s2.count === '7', s2);
    ok('and says where it was picked up from', /Picked up from .*\. Tap when you next feel a movement\./.test(s2.txt), s2.txt.slice(0, 200));
    ok('with the way out still offered', s2.hasFinish && s2.hasUndo, s2);
  });

  await section('2. saving it clears the open session, so it cannot be counted twice', async () => {
    const before = await rec();
    ok('precondition: an open count is waiting', !!before.kickOpen, before.kickOpen);
    const startedBefore = before.kickOpen.start, lastBefore = before.kickOpen.last;
    await click('[onclick="finishKicks()"]');
    const p = await rec();
    ok('the session is filed once', (p.kicks || []).length === 1, p.kicks);
    ok('with the seven movements she counted', p.kicks[0].count === 7, p.kicks[0]);
    // A resume that throws the start away and stamps now() still renders a plausible sheet, and it
    // silently rewrites how long ten movements took, which is the whole clinical content of a count.
    ok('timed from when she actually started, not from the reload', p.kicks[0].start === startedBefore, { got: p.kicks[0].start, want: startedBefore });
    ok('and ending at her last tap, not at the moment she pressed save', p.kicks[0].end === lastBefore, { got: p.kicks[0].end, want: lastBefore });
    ok('and the open session is gone from the record', p.kickOpen === undefined, p.kickOpen);
    await reboot();
    await page.evaluate(() => openKickCounter());
    const s = await sheet();
    ok('so a reload after saving does not hand it back', s.count === '0', s);
    ok('and the sheet invites a fresh one', s.hint === 'Tap to start', s);
  });

  await section('3. a second count starts from scratch, not from the first one', async () => {
    await page.evaluate(() => openKickCounter());
    await click('.kick-big');
    await click('.kick-big');
    const p = await rec();
    ok('the new session counts two', p.kickOpen && p.kickOpen.count === 2, p.kickOpen);
    ok('and starts now, not at the earlier session', p.kickOpen.start >= p.kicks[0].end, { open: p.kickOpen.start, prev: p.kicks[0].end });
    await click('[onclick="undoKick()"]');
    const p2 = await rec();
    ok('undoing a tap is written through too', p2.kickOpen.count === 1, p2.kickOpen);
    await click('[onclick="cancelKicks()"]');
    const p3 = await rec();
    ok('cancelling wipes it from the record', p3.kickOpen === undefined, p3.kickOpen);
    ok('and files nothing', (p3.kicks || []).length === 1, p3.kicks);
  });

  await section('4. a count she gave up on hours ago does not come back pretending to be live', async () => {
    await load(seed(preg(30, { kickOpen: { start: now - 9 * HOUR, count: 4 } })));
    await page.evaluate(() => openKickCounter());
    const s = await sheet();
    ok('nine hours later it is not resumed', s.count === '0', s);
    ok('she is not told "4 movements, 9h so far"', !/so far/.test(s.txt), s.txt.slice(0, 160));
    const p = await rec();
    ok('and it is scrubbed, so no other phone picks it up either', p.kickOpen === undefined, p.kickOpen);
  });

  await section('5. the kick cut-off runs from her last tap, not from when she sat down', async () => {
    // The failure this closes: abandoned at 11:30 PM, four movements in, opened again at 3:10 AM.
    // Measured from the start it is 3h 40m, inside four hours, so it used to come back as live.
    await load(seed(preg(30, { kickOpen: { start: now - (3 * HOUR + 40 * MIN), count: 4, last: now - (3 * HOUR + 5 * MIN) } })));
    await page.evaluate(() => openKickCounter());
    const s = await sheet();
    ok('a count she stopped tapping on three hours ago is over', s.count === '0', s);
    ok('so she is never shown four movements over three and a half hours', !/so far/.test(s.txt), s.txt.slice(0, 200));
    // The same long-running count, still being tapped: that one is genuinely live and is kept.
    await load(seed(preg(30, { kickOpen: { start: now - (3 * HOUR + 40 * MIN), count: 4, last: now - 2 * MIN } })));
    await page.evaluate(() => openKickCounter());
    const s2 = await sheet();
    ok('but a long count she tapped two minutes ago is still hers', s2.count === '4', s2);
    let n = await pnow();
    await load(seed(preg(30, { kickOpen: { start: n - 2 * HOUR, count: 3, last: n - (45 * MIN - 30000) } })));
    await page.evaluate(() => openKickCounter());
    const s3 = await sheet();
    ok('just inside forty-five minutes of quiet still resumes', s3.count === '3', s3);
    n = await pnow();
    await load(seed(preg(30, { kickOpen: { start: n - 2 * HOUR, count: 3, last: n - (45 * MIN + 30000) } })));
    await page.evaluate(() => openKickCounter());
    const s4 = await sheet();
    ok('just outside forty-five minutes does not', s4.count === '0', s4);
  });

  await section('6. a resumed count never states a rate the app made up', async () => {
    await load(seed(preg(30, { kickOpen: { start: now - 30 * MIN, count: 4, last: now - 5 * MIN } })));
    await page.evaluate(() => openKickCounter());
    const s = await sheet();
    ok('her four movements are still there', s.count === '4', s);
    ok('and no elapsed time is asserted over them', !/so far/.test(s.txt), s.txt.slice(0, 220));
    ok('she is asked for the next movement instead', /Tap when you next feel a movement/.test(s.txt), s.txt.slice(0, 220));
    await click('[onclick="finishKicks()"]');
    const p = await rec();
    ok('and saving it files her counting, not the gap after it', p.kicks[0].end === now - 5 * MIN, { got: p.kicks[0].end, want: now - 5 * MIN, start: p.kicks[0].start });
    // The positive twin: a count running in this sitting does still show its elapsed line.
    await page.evaluate(() => openKickCounter());
    await click('.kick-big');
    const s2 = await sheet();
    ok('a count she is taking right now still shows how long she has been at it', /Started .* so far/.test(s2.txt), s2.txt.slice(0, 220));
    await click('[onclick="cancelKicks()"]');
  });

  await section('7. a contraction being timed survives a reload, and keeps its real start', async () => {
    await load(seed(preg(38)));
    await page.evaluate(() => openContractions());
    await click('[onclick="toggleContraction()"]');
    const p = await rec();
    ok('the running contraction is on the record', !!(p.contractionOpen && p.contractionOpen.start), p.contractionOpen);
    const started = p.contractionOpen.start;
    const live = await sheetText();
    ok('a contraction she just started shows its timer', /In progress · /.test(live), live.slice(0, 160));
    // She is mid-contraction and the phone reloads under her.
    await reboot();
    await page.evaluate(() => openContractions());
    const s = await sheetText();
    ok('it is still running when she comes back', /Stop, contraction ending/.test(s), s.slice(0, 160));
    ok('and the sheet says so', /In progress/.test(s), s.slice(0, 160));
    // Nothing ticks it, so a number carried across a reload would sit there frozen and stale on the
    // one screen where a stale number reads as broken.
    ok('without a frozen duration nobody is updating', !/In progress · /.test(s), s.slice(0, 160));
    await click('[onclick="toggleContraction()"]');
    const p2 = await rec();
    ok('stopping files exactly one contraction', (p2.contractions || []).length === 1, p2.contractions);
    ok('timed from before the reload, not from the reload', p2.contractions[0].start === started, { got: p2.contractions[0].start, want: started });
    ok('and the running flag is cleared', p2.contractionOpen === undefined, p2.contractionOpen);
  });

  await section('8. an abandoned contraction timer can never become a long contraction', async () => {
    await load(seed(preg(38, { contractionOpen: { start: now - 40 * MIN } })));
    await page.evaluate(() => openContractions());
    const s = await sheetText();
    ok('forty minutes on, it is not treated as running', /Start a contraction/.test(s), s.slice(0, 160));
    const p = await rec();
    ok('and the stale flag is dropped from the record', p.contractionOpen === undefined, p.contractionOpen);
    await click('[onclick="toggleContraction()"]');
    await click('[onclick="toggleContraction()"]');
    const p2 = await rec();
    ok('the next one she times is seconds long, not forty minutes', (p2.contractions[0].end - p2.contractions[0].start) < MIN, p2.contractions[0]);
  });

  await section('9. the contraction cut-off is shorter than a contraction can be', async () => {
    // Contractions run 30 to 70 seconds. Twelve minutes is certainly a timer left running, and one
    // tap on it used to file "Lasted 12m" and drag the average duration she reads to her midwife
    // from 50s to 3m.
    await load(seed(preg(38, {
      contractions: [0, 1, 2, 3, 4].map((i) => ({ id: 'c' + i, start: now - (50 - i * 9) * MIN, end: now - (50 - i * 9) * MIN + 50000 })),
      contractionOpen: { start: now - 12 * MIN },
    })));
    await page.evaluate(() => openContractions());
    const s = await sheetText();
    ok('a twelve-minute timer is not offered back to her as running', /Start a contraction/.test(s), s.slice(0, 200));
    ok('so the average she reads out is still her real contractions', /50s Lasting/.test(s), s.slice(0, 240));
    let n = await pnow();
    await load(seed(preg(38, { contractionOpen: { start: n - 150000 } })));
    await page.evaluate(() => openContractions());
    const s2 = await sheetText();
    ok('inside three minutes still resumes', /Stop, contraction ending/.test(s2), s2.slice(0, 120));
    n = await pnow();
    await load(seed(preg(38, { contractionOpen: { start: n - 210000 } })));
    await page.evaluate(() => openContractions());
    const s3 = await sheetText();
    ok('outside three minutes does not', /Start a contraction/.test(s3), s3.slice(0, 120));
  });

  await section('10. a session already saved on her phone never comes back on her other device', async () => {
    // applyPregJourney merges the journey doc key by key and never deletes, so the contraction she
    // stopped and saved on her phone leaves contractionOpen sitting on her iPad inside the window.
    await load(seed(preg(39, {
      contractions: [{ id: 'c1', start: now - 6 * MIN, end: now - 6 * MIN + 59000 }],
      contractionOpen: { start: now - 6 * MIN },
    })));
    await page.evaluate(() => openContractions());
    const s = await sheetText();
    ok('the contraction she already filed is not running on her second device', /Start a contraction/.test(s), s.slice(0, 200));
    const p = await rec();
    ok('and the leftover is scrubbed rather than left to be found again', p.contractionOpen === undefined, p.contractionOpen);
    ok('nothing was filed twice', (p.contractions || []).length === 1, p.contractions);

    await load(seed(preg(39, {
      kicks: [{ id: 'k1', start: now - 52 * MIN, end: now - 30 * MIN, count: 10 }],
      kickOpen: { start: now - 52 * MIN, count: 10, last: now - 30 * MIN },
    })));
    await page.evaluate(() => openKickCounter());
    const k = await sheet();
    ok('the kick count she already saved does not reopen as "10, all done"', k.count === '0', k);
    const pk = await rec();
    ok('and that leftover is scrubbed too', pk.kickOpen === undefined, pk.kickOpen);
    ok('her saved session is still there, exactly once', (pk.kicks || []).length === 1, pk.kicks);

    // And if the merge lands while the sheet is open, the session is live in memory and the read
    // check cannot help. Filing refuses the duplicate start on the way out.
    await load(seed(preg(39)));
    await page.evaluate(() => openContractions());
    await click('[onclick="toggleContraction()"]');
    await page.evaluate(() => { const p = state.pregnancy; p.contractions.push({ id: 'merged', start: p.contractionOpen.start, end: p.contractionOpen.start + 55000 }); });
    await click('[onclick="toggleContraction()"]');
    const p2 = await rec();
    ok('stopping a contraction her phone already filed does not file it again', (p2.contractions || []).length === 1, p2.contractions);

    await load(seed(preg(39)));
    await page.evaluate(() => openKickCounter());
    await click('.kick-big');
    await page.evaluate(() => { const p = state.pregnancy; p.kicks.push({ id: 'merged', start: p.kickOpen.start, end: p.kickOpen.last, count: 1 }); });
    await click('[onclick="finishKicks()"]');
    const p3 = await rec();
    ok('nor does saving a count her phone already filed', (p3.kicks || []).length === 1, p3.kicks);
  });

  await section('11. her partner never gets a Stop button over her labour', async () => {
    await load(seed(preg(38, { contractionOpen: { start: now - 2 * MIN }, kickOpen: { start: now - 5 * MIN, count: 3, last: now - 5 * MIN } })));
    await page.evaluate(() => { window.LL = window.LL || {}; window.LL.matIsOwner = function () { return false; }; });
    await page.evaluate(() => openContractions());
    const s = await sheetText();
    ok('a shared-with member does not resume her contraction', /Start a contraction/.test(s), s.slice(0, 140));
    await page.evaluate(() => openKickCounter());
    const k = await sheet();
    ok('nor her kick count', k.count === '0', k);
    const p = await rec();
    ok('and reading it on his phone leaves her record untouched', !!p.contractionOpen && p.kickOpen.count === 3, { c: p.contractionOpen, k: p.kickOpen });
    await click('.kick-big');
    const p2 = await rec();
    ok('his own tapping never overwrites her open count', p2.kickOpen.count === 3, p2.kickOpen);
    // Reopen the contraction sheet first: the kick counter replaced it, and a click into a sheet
    // that is no longer there proves nothing at all.
    await page.evaluate(() => openContractions());
    await click('[onclick="toggleContraction()"]');
    const p3 = await rec();
    ok('nor her running contraction', p3.contractionOpen && p3.contractionOpen.start === now - 2 * MIN, p3.contractionOpen);
    ok('and files nothing of his own on her record', (p3.contractions || []).length === 0, p3.contractions);
  });

  await section('12. nothing to resume is a quiet, working screen', async () => {
    await load(seed(preg(30)));
    await page.evaluate(() => openKickCounter());
    const s = await sheet();
    ok('a first-ever count opens at zero', s.count === '0', s);
    ok('with no session controls', !s.hasFinish && !s.hasUndo, s);
    const safe = await page.evaluate(() => {
      // A record that predates this build carries neither key, and a malformed one carries a
      // sessionless object; neither may throw on the screen she opens in labour.
      const a = pregResumeSession('kickOpen', 45 * 60000, 'kicks');
      state.pregnancy.contractionOpen = {};
      const b = pregResumeSession('contractionOpen', 180000, 'contractions');
      state.pregnancy.kickOpen = { start: Date.now(), count: 2 };
      const c = pregResumeSession('kickOpen', 45 * 60000, 'kicks');
      delete state.pregnancy.kickOpen;
      const saved = state.pregnancy; state.pregnancy = null;
      const d = pregResumeSession('kickOpen', 45 * 60000, 'kicks');
      pregWriteSession('kickOpen', { start: 1, count: 1 });
      state.pregnancy = saved;
      return { a, b, c: !!c, d };
    });
    ok('a record with no open session resumes nothing', safe.a === null, safe);
    ok('a malformed one is ignored rather than thrown on', safe.b === null, safe);
    ok('a session written by the old build, with no last tap, still resumes off its start', safe.c === true, safe);
    ok('and no pregnancy at all is survivable', safe.d === null, safe);
  });

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'PREG-SESSION-RESUME: FAIL' : 'PREG-SESSION-RESUME: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
