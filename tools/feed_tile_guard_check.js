#!/usr/bin/env node
/* THE RUNNING FEED TIMER WAS INVISIBLE EVERYWHERE EXCEPT HOME, AND THE FEED TILE LIED ABOUT IT.
 *
 * A mother starts a nursing timer at 03:12 and goes to Log to check when the last nappy was. From
 * that tab, and from Album and from Health, there was no elapsed time and no Stop button anywhere:
 * the banner was built inside renderHome and rendered from nowhere else. To end the feed she had to
 * navigate back to Home first, on the tab a one-handed parent is least likely to be on.
 *
 * Meanwhile the Feed tile on Home carried on reading "Feed · breast, bottle, solids" with the timer
 * counting up eight pixels above it. Sleep has flipped to "Wake up · stop the timer" for a long time,
 * so the same gesture on the same screen meant two different things depending on which tile you hit.
 *
 * The fix is NOT to make Feed stop the timer the way Sleep does. Feed is four logs behind one tile,
 * and a mother whose baby refused the breast taps Feed to log the bottle she gave instead: a blind
 * stop would write a nursing session that never happened into the record she hands a clinician. So
 * the tile tells the truth, names both doors, and the one-tap stop is the banner, which now stands
 * on every tab.
 *
 * And a timer left running through the night is a real thing, so stopping one has to ask rather than
 * write. stopFeed had no cap at all: breakfast wrote a nine-hour breastfeed filed at 02:39, silently,
 * into the same record. FEED_MAX_MS now diverts to openFeedCorrect the way SLEEP_MAX_MS diverts to
 * openSleepCorrect. Sections 16 to 18 bind that; section 5 binds that the second door never stops.
 *
 * That question sheet then had to learn whose feed it was asking about. It was a straight copy of
 * openSleepCorrect with that function's baby-name lookup dropped, so with twins the two banners named
 * both babies and the sheet covering them named neither, while saving against a babyId out of sight.
 * Section 19 binds it, on the banner route and on the "Finish it now" route that arrives with no
 * banner at all, and holds the one-baby wording to the letter so the common case cannot drift.
 *
 * Already shipped and deliberately NOT rebuilt here: startFeedTimer's own guard against a second
 * start overwriting a running one (tools/quality_check.js section 3). This gate re-asserts it only
 * to prove the tile change did not weaken it.
 *
 *   PORT=8123 node tools/serve.js &
 *   node tools/feed_tile_guard_check.js http://localhost:8123
 *
 * Self-test: `node tools/feed_tile_guard_check.js <url-of-a-tree-without-this-change>` must go RED.
 * It does: section 0 fails four preconditions and sections 2, 4, 5, 11, 15, 16, 17, 18, 19 fail on
 * top, and because every section is wrapped they all still report instead of aborting at the first
 * throw. Reverting only openFeedCorrect's name lookup and leaving the rest alone is 108/5, with all
 * five in section 19 and the one-baby lines still green: 113/0 restored.
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8123';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, HOUR = 3600000, MIN = 60000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };
/* Every block runs inside this. A full revert used to abort the file at the first ReferenceError,
 * which meant the gate could not say WHICH half regressed and never reached the banner-on-every-tab
 * half at all: its biggest behavioural claim went unreported on exactly the run that mattered. */
const section = async (title, fn) => {
  console.log('\n' + title);
  try { await fn(); } catch (e) { fail++; console.log('  FAIL this section threw, so the rest of it never ran\n         got: ' + JSON.stringify(String((e && e.message) || e))); }
};

// 03:12, because that is the hour this whole item is about.
const CLOCK = (() => { const d = new Date(); d.setHours(3, 12, 0, 0); return d.getTime(); })();
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
  // The tiles are real buttons in the real #scroll, read the way a thumb finds them. Never from
  // document.body.textContent: that string contains the inline script's own source, so every
  // assertion in this file would pass against a file that shipped none of this.
  const tileIn = (sel) => page.evaluate((s) => {
    const box = document.querySelector(s);
    if (!box) return null;
    return [...box.querySelectorAll('button.action')].map((b) => ({
      label: (b.querySelector('.label') || {}).textContent || '',
      hint: (b.querySelector('.hint') || {}).textContent || '',
      onclick: b.getAttribute('onclick') || '',
    }));
  }, sel);
  const feedTile = async (sel) => {
    const all = await tileIn(sel);
    if (!all) return null;
    return all.find((t) => /openFeed\(\)|openFeedRunning\(\)/.test(t.onclick)) || null;
  };
  const banners = () => page.evaluate(() => [...document.querySelectorAll('#scroll .active-banner')].map((b) => ({
    lbl: (b.querySelector('.lbl') || {}).textContent || '',
    time: (b.querySelector('.time') || {}).textContent || '',
    timerAttr: (b.querySelector('[data-timer]') || {}).getAttribute ? b.querySelector('[data-timer]').getAttribute('data-timer') : null,
    stop: (b.querySelector('.stop-btn') || {}).getAttribute ? b.querySelector('.stop-btn').getAttribute('onclick') : null,
  })));
  const sheetText = () => page.evaluate(() => { const s = document.getElementById('sheet'); return ((s && s.innerText) || '').replace(/\s+/g, ' '); });

  await section('0. the pieces this whole file is about actually exist', async () => {
    await load(seed());
    const r = await page.evaluate(() => ({
      running: typeof runningFeed, sheet: typeof openFeedRunning,
      banners: typeof timerBanners, correct: typeof openFeedCorrect,
      cap: typeof FEED_MAX_MS === 'number' ? FEED_MAX_MS : null,
    }));
    ok('runningFeed is defined', r.running === 'function', r);
    ok('openFeedRunning is defined', r.sheet === 'function', r);
    ok('timerBanners is defined', r.banners === 'function', r);
    ok('openFeedCorrect is defined', r.correct === 'function', r);
    ok('and a feed timer has an upper bound at all', r.cap > 0 && r.cap <= 12 * HOUR, r);
  });

  await section('1. with nothing running, the Feed tile is still the ordinary door', async () => {
    await load(seed());
    const t = await feedTile('#scroll .actions');
    ok('the tile is there on an empty log', !!t, t);
    ok('it opens the feed sheet', /^openFeed\(\)/.test((t || {}).onclick || ''), t);
    ok('and it is labelled Feed, not Nursing', (t || {}).label === 'Feed', t);
    const b = await banners();
    ok('and no banner is invented out of nothing', b.length === 0, b);
  });

  await section('2. while a nursing timer runs, the tile says so', async () => {
    await load(seed({ timers: { b1: { feed: { start: now - 18 * MIN, side: 'left' } } } }));
    const t = await feedTile('#scroll .actions');
    ok('the tile now reads Nursing', (t || {}).label === 'Nursing', t);
    ok('and offers the stop in as many words', /stop/i.test((t || {}).hint || ''), t);
    // A hint promising only a stop hid the one remaining door to the bottle: with the tile flipped,
    // nothing else on the surface says a mother can still log something that is not a breastfeed.
    ok('and names the other door too, so the bottle is not hidden behind a Stop', /log something else/i.test((t || {}).hint || ''), t);
    ok('it no longer opens the plain feed sheet', !/^openFeed\(\)/.test((t || {}).onclick || ''), t);
    ok('it goes to the two-door sheet instead', /openFeedRunning/.test((t || {}).onclick || ''), t);
    const still = await page.evaluate(() => !!(state.timers.b1 && state.timers.b1.feed));
    ok('and painting the tile did not touch the timer', still === true, still);
  });

  await section('3. the floating quick-log button flips the same way', async () => {
    const t = await page.evaluate(() => {
      openQuickLog();
      const s = document.getElementById('sheet');
      const b = [...s.querySelectorAll('button.action')].find((x) => /openFeed/.test(x.getAttribute('onclick') || ''));
      return b ? { label: (b.querySelector('.label') || {}).textContent, hint: (b.querySelector('.hint') || {}).textContent, onclick: b.getAttribute('onclick') } : null;
    });
    ok('the round button shows Nursing too', (t || {}).label === 'Nursing', t);
    ok('with the same door', /openFeedRunning/.test((t || {}).onclick || ''), t);
    await page.evaluate(() => closeSheet());
    await sleep(450);
  });

  await section('4. the two doors are honest about what each one does', async () => {
    await load(seed({ timers: { b1: { feed: { start: now - 18 * MIN, side: 'left' } } } }));
    const r = await page.evaluate(() => {
      openFeedRunning();
      const s = document.getElementById('sheet');
      const txt = (s.innerText || '').replace(/\s+/g, ' ');
      const primary = s.querySelector('.btn-primary');
      const ghost = [...s.querySelectorAll('.btn-ghost')].map((b) => ({ t: b.textContent.trim(), on: b.getAttribute('onclick') }));
      // Read the two clock strings out of the app's own formatter so the assertion below compares
      // like with like instead of hard-coding a format this file does not own.
      return { txt, primaryText: primary ? primary.textContent.trim() : null, primaryOn: primary ? primary.getAttribute('onclick') : null, ghost,
        startClock: fmtClock(state.timers.b1.feed.start), nowClock: fmtClock(now()) };
    });
    ok('it names which side is running', /left side/i.test(r.txt), r.txt.slice(0, 160));
    // Was a tautology: it matched the word "started", which the template always emits. Replacing
    // fmtClock(t.start) with fmtClock(now()) sailed through. Now it reads the literal 2:54 AM and
    // insists the 3:12 AM she tapped at is NOT what the sheet shows her.
    ok('and the clock time nursing began, not the time she tapped',
      r.startClock !== r.nowClock && r.txt.indexOf(r.startClock) >= 0 && r.txt.indexOf(r.nowClock) < 0, r);
    ok('and how long it has run', /18m/.test(r.txt), r.txt.slice(0, 160));
    ok('the primary door is the stop', /stop/i.test(r.primaryText || '') && /stopFeed/.test(r.primaryOn || ''), r);
    ok('the second door is the rest of the feed sheet', r.ghost.some((g) => /openFeed\(\)/.test(g.on || '')), r.ghost);
    // The whole design rests on this one: the second door must not stop the timer on the way past.
    // /openFeed\(\)/ alone still matched stopFeed('b1');openFeed(), which is the exact harm.
    ok('and the second door stops nothing on its way', r.ghost.every((g) => !/stopFeed|delete .*feed/.test(g.on || '')), r.ghost);
    ok('and it says plainly that the second door leaves the timer alone', /leaves the timer running/i.test(r.txt), r.txt.slice(0, 240));
  });

  await section('4b. both sides is a real answer on the feed sheet, so it has to read like one', async () => {
    await load(seed({ timers: { b1: { feed: { start: now - 6 * MIN, side: 'both' } } } }));
    const txt = await page.evaluate(() => { openFeedRunning(); return (document.getElementById('sheet').innerText || '').replace(/\s+/g, ' '); });
    ok('it reads "Both sides"', /both sides/i.test(txt), txt.slice(0, 160));
    ok('and never "Both side"', !/both side[,\s]/i.test(txt), txt.slice(0, 160));
    await page.evaluate(() => closeSheet());
    await sleep(450);
  });

  await section('5. the second door reaches a bottle without writing a nursing session', async () => {
    // The whole reason Feed does not blind-stop: baby refused the breast, she gives a bottle.
    // Pressed as a thumb presses it. Calling openFeed() by hand instead never proved the BUTTON
    // was safe, only that the function it should call is.
    await load(seed({ timers: { b1: { feed: { start: now - 18 * MIN, side: 'left' } } } }));
    const r = await page.evaluate(() => {
      openFeedRunning();
      const s = document.getElementById('sheet');
      [...s.querySelectorAll('.btn-ghost')][0].click();
      return { sheet: ((document.getElementById('sheet').innerText) || '').replace(/\s+/g, ' ').slice(0, 60),
        timerAlive: !!(state.timers.b1 && state.timers.b1.feed),
        events: state.events.length };
    });
    ok('the feed sheet is genuinely open', /Feed/.test(r.sheet), r);
    ok('the nursing timer is still running', r.timerAlive === true, r);
    ok('and nothing was written on the way through', r.events === 0, r);
    const r2 = await page.evaluate(() => {
      feedDraft.method = 'bottle'; feedDraft.amount = 60; feedDraft.unit = 'ml';
      saveBottle();
      const f = state.events.filter((e) => e.type === 'feed');
      return { n: f.length, method: f[0] && f[0].method, amount: f[0] && f[0].amount,
        timerAlive: !!(state.timers.b1 && state.timers.b1.feed) };
    });
    ok('the bottle logs as a bottle', r2.n === 1 && r2.method === 'bottle' && r2.amount === 60, r2);
    ok('and the timer she is still running survives it', r2.timerAlive === true, r2);
  });

  await section('6. the stop door writes exactly one feed, measured from the timer', async () => {
    await load(seed({ timers: { b1: { feed: { start: now - 18 * MIN, side: 'right' } } } }));
    const r = await page.evaluate(() => {
      openFeedRunning();
      const s = document.getElementById('sheet');
      s.querySelector('.btn-primary').click();
      const f = state.events.filter((e) => e.type === 'feed');
      return { n: f.length, side: f[0] && f[0].side, method: f[0] && f[0].method,
        startedAt: f[0] && f[0].time, dur: f[0] && f[0].dur,
        // Measured in the page, against the page's own clock: the gate has been running for a few
        // seconds by now, so comparing to the seeded constant would fail on drift alone.
        durVsClock: f[0] ? Math.abs(f[0].dur - (now() - f[0].time)) : null,
        cleared: !(state.timers.b1 && state.timers.b1.feed) };
    });
    ok('one feed, not two', r.n === 1, r);
    ok('it keeps the side the timer was started on', r.side === 'right', r);
    ok('it is filed at the time nursing began, not at the tap', Math.abs(r.startedAt - (now - 18 * MIN)) < 5000, r);
    ok('and it carries the 18 minutes', r.dur >= 18 * MIN && r.dur < 19 * MIN, r);
    ok('the duration is start-to-stop and nothing else', r.durVsClock < 2000, r);
    ok('the timer is gone afterwards', r.cleared === true, r);
    const t = await feedTile('#scroll .actions');
    ok('and the tile is a plain door again', /^openFeed\(\)/.test((t || {}).onclick || '') && (t || {}).label === 'Feed', t);
  });

  await section('7. a second stop on the same timer cannot double-write', async () => {
    await load(seed({ timers: { b1: { feed: { start: now - 12 * MIN, side: 'left' } } } }));
    const r = await page.evaluate(() => {
      stopFeed('b1'); stopFeed('b1');
      return { n: state.events.filter((e) => e.type === 'feed').length };
    });
    ok('two taps on Stop write one feed', r.n === 1, r);
    // And the tile she is now looking at cannot send her back into a sheet about a timer that is gone.
    const r2 = await page.evaluate(() => {
      openFeedRunning();
      const s = document.getElementById('sheet');
      return { txt: (s.innerText || '').replace(/\s+/g, ' ').slice(0, 40) };
    });
    ok('and openFeedRunning with no timer just opens the feed sheet', !/A feed is running/i.test(r2.txt), r2);
  });

  await section('8. somebody else’s timer does not flip this baby’s tile', async () => {
    await load(seed({
      babies: [{ id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] },
        { id: 'b2', name: 'Wren', birth: now - 60 * DAY, sex: 'M', routines: [], doctors: [], allergies: [] }],
      activeBabyId: 'b1', timers: { b2: { feed: { start: now - 20 * MIN, side: 'left' } } },
    }));
    const t = await feedTile('#scroll .actions');
    ok('Robin has no timer, so Robin’s tile still says Feed', (t || {}).label === 'Feed', t);
    const b = await banners();
    ok('but Wren’s running feed is still shown, named', b.length === 1 && /Wren/.test(b[0].lbl), b);
    const r = await page.evaluate(() => { state.activeBabyId = 'b2'; render(); return null; });
    const t2 = await feedTile('#scroll .actions');
    ok('and switching to Wren flips the tile', (t2 || {}).label === 'Nursing', [t2, r]);
  });

  await section('9. the banner stands on every tab, not only Home', async () => {
    await load(seed({ timers: { b1: { feed: { start: now - 18 * MIN, side: 'left' } } } }));
    for (const v of ['home', 'log', 'album', 'health']) {
      await page.evaluate((x) => go(x), v);
      await sleep(250);
      const b = await banners();
      ok('on ' + v + ' there is a running-feed banner', b.length === 1 && /Nursing/.test(b[0].lbl), { v, b });
      ok('on ' + v + ' it carries a live elapsed time', b[0] && /\d/.test(b[0].time) && b[0].timerAttr === String(now - 18 * MIN), { v, b });
      ok('on ' + v + ' there is a Stop within reach', b[0] && /stopFeed/.test(b[0].stop || ''), { v, b });
    }
  });

  await section('10. stopping from another tab works and leaves her where she was', async () => {
    await page.evaluate(() => go('log'));
    await sleep(250);
    const r = await page.evaluate(() => {
      document.querySelector('#scroll .active-banner .stop-btn').click();
      return { view: view, timer: !!(state.timers.b1 && state.timers.b1.feed),
        n: state.events.filter((e) => e.type === 'feed').length };
    });
    ok('the feed is logged from the Log tab', r.n === 1, r);
    ok('the timer is cleared', r.timer === false, r);
    // The handler used to read stopFeed('b1')(), which stopped the feed and then threw. The
    // "no page errors" line at the foot of this file is the assertion that catches it; this one
    // says out loud that pressing Stop is a supported thing to do.
    ok('and pressing Stop threw nothing', errs.filter((e) => /is not a function/.test(e)).length === 0, errs.slice(0, 3));
    ok('and she is not thrown back to Home', r.view === 'log', r);
    const b = await banners();
    ok('the banner leaves with the timer', b.length === 0, b);
  });

  await section('11. a nap and a feed at once: both banners, and only Home is asked a question', async () => {
    // Fourteen hours, not forty minutes. The old fixture was under the twelve-hour nudge, so the
    // forgotten-nap line was absent on Home too and "it stays on Home" could not fail.
    await load(seed({ timers: { b1: { sleep: { start: now - 14 * HOUR }, feed: { start: now - 6 * MIN, side: 'both' } } } }));
    const b = await banners();
    ok('home shows both timers', b.length === 2, b);
    const tiles = await tileIn('#scroll .actions');
    const f = tiles.find((x) => /openFeedRunning/.test(x.onclick));
    const s = tiles.find((x) => /stopSleep/.test(x.onclick));
    ok('the feed tile reads Nursing', f && f.label === 'Nursing', f);
    ok('the sleep tile still reads Wake up, untouched', s && s.label === 'Wake up', s);
    const home = await page.evaluate(() => { const w = document.querySelector('#scroll .ww-line'); return w ? w.innerText.replace(/\s+/g, ' ') : null; });
    ok('home does ask about the fourteen-hour nap', !!home && /did it end earlier/i.test(home), home);
    await page.evaluate(() => go('health'));
    await sleep(250);
    const b2 = await banners();
    ok('and Health carries both of them too', b2.length === 2, b2);
    // A question needs answering, so it belongs on the surface she reads, not on top of the album
    // she came to look at. Dropping `withOverrun &&` puts it on all four tabs; this is the line
    // that notices.
    ok('but the forgotten-nap question stays on Home, where it can be answered',
      (await page.evaluate(() => !document.querySelector('#scroll .ww-line'))) === true);
  });

  await section('12. the start path is still guarded, and this change did not weaken it', async () => {
    await load(seed({ timers: { b1: { feed: { start: now - 18 * MIN, side: 'left' } } } }));
    const r = await page.evaluate(() => {
      const before = state.timers.b1.feed.start;
      startFeedTimer();
      const s = document.getElementById('sheet');
      return { txt: (s ? s.innerText : '').replace(/\s+/g, ' '),
        same: state.timers.b1.feed && state.timers.b1.feed.start === before,
        n: state.events.filter((e) => e.type === 'feed').length };
    });
    ok('a second start still warns rather than overwriting', /already running/i.test(r.txt), r.txt.slice(0, 160));
    ok('the 18 minutes are still there', r.same === true, r);
    ok('and nothing was written behind her back', r.n === 0, r);
  });

  await section('13. a reload with the timer still running comes back the same', async () => {
    await load(seed({ timers: { b1: { feed: { start: now - 25 * MIN, side: 'right' } } } }));
    const t = await feedTile('#scroll .actions');
    ok('the tile is still flipped after a cold boot', (t || {}).label === 'Nursing', t);
    await page.evaluate(() => go('album'));
    await sleep(250);
    const b = await banners();
    ok('and Album still carries the banner', b.length === 1 && /Nursing/.test(b[0].lbl), b);
  });

  await section('14. an eighteen-month-old: no feed tile, and More logs still works', async () => {
    // The child stage drops feed from the tiles entirely and puts it behind More logs. The guard
    // must not resurrect a tile there.
    await load(seed({ babies: [{ id: 'b1', name: 'Robin', birth: now - 700 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }] }));
    const r = await page.evaluate(() => {
      const tiles = [...document.querySelectorAll('#scroll .actions button.action')].map((b) => (b.querySelector('.label') || {}).textContent);
      openMoreLogs();
      const s = document.getElementById('sheet');
      const feed = [...s.querySelectorAll('button.action')].find((b) => /openFeed\(\)/.test(b.getAttribute('onclick') || ''));
      return { tiles, moreDoor: !!feed, keys: Object.keys(state.timers) };
    });
    ok('a toddler home has no Feed tile at all', r.tiles.indexOf('Feed') < 0 && r.tiles.indexOf('Nursing') < 0, r.tiles);
    ok('More logs still reaches the feed sheet', r.moreDoor === true, r);
    ok('and no undefined timer key was written', r.keys.indexOf('undefined') < 0, r.keys);
    await page.evaluate(() => closeSheet());
    await sleep(450);
  });

  await section('15. pregnancy: the guard is silent and writes nothing', async () => {
    await load(seed({ babies: [], activeBabyId: null,
      pregnancy: { stage: 'expecting', dueDate: now + 100 * DAY, ownerUid: 'local', appts: [], symptoms: [] } }));
    const r = await page.evaluate(() => {
      try { openQuickLog(); } catch (e) { return { err: String(e) }; }
      const s = document.getElementById('sheet');
      return { tiles: [...s.querySelectorAll('button.action')].map((b) => (b.querySelector('.label') || {}).textContent),
        keys: Object.keys(state.timers || {}) };
    });
    ok('the pregnancy quick log opens without throwing', !r.err, r);
    ok('and offers no feed tile', (r.tiles || []).indexOf('Nursing') < 0 && (r.tiles || []).indexOf('Feed') < 0, r.tiles);
    // Called on purpose with no id, because that is the only state that can reach it that way and
    // timersFor() CREATES the key it is asked for: without the id check, one paint writes a junk
    // key into the household blob every household member then syncs. Counted, not name-matched:
    // the key it invents is "null" or "undefined" depending on what activeBabyId happens to hold,
    // and looking for one literal spelling let the other one through.
    const r2 = await page.evaluate(() => {
      const before = Object.keys(state.timers || {}).length;
      const got = runningFeed();
      return { got, before, keys: Object.keys(state.timers || {}), active: state.activeBabyId };
    });
    ok('runningFeed with no baby at all answers no, quietly', r2.got === null && !r2.active, r2);
    ok('and invents no timer key on the way', r2.keys.length === r2.before && r2.keys.length === 0, r2.keys);
    await page.evaluate(() => closeSheet());
    await sleep(450);
  });

  await section('16. a timer left running all night is asked about, never written', async () => {
    /* 02:39, the baby refuses the breast, she logs the bottle through the second door and sleeps.
       At 11:39 she taps the tile. Stopping it silently wrote a NINE-HOUR breastfeed filed at 02:39
       into the record a clinician reads, and evEnd() then read "since last feed" as if she were
       nursing at that very moment. */
    await load(seed({ timers: { b1: { feed: { start: now - 9 * HOUR, side: 'left' } } } }));
    const r = await page.evaluate(() => {
      openFeedRunning();
      const s = document.getElementById('sheet');
      const p = s.querySelector('.btn-primary');
      return { txt: (s.innerText || '').replace(/\s+/g, ' '), primaryText: p.textContent.trim(), primaryOn: p.getAttribute('onclick') };
    });
    ok('the sheet still says how long it has run', /9h/.test(r.txt), r.txt.slice(0, 200));
    ok('and the primary promises a question, not a silent log', /when it ended/i.test(r.primaryText) && !/log it/i.test(r.primaryText), r);
    const r2 = await page.evaluate(() => {
      document.getElementById('sheet').querySelector('.btn-primary').click();
      const s = document.getElementById('sheet');
      return { txt: ((s && s.innerText) || '').replace(/\s+/g, ' '),
        n: state.events.filter((e) => e.type === 'feed').length,
        alive: !!(state.timers.b1 && state.timers.b1.feed) };
    });
    ok('tapping it wrote no feed at all', r2.n === 0, r2);
    ok('the timer is still hers to correct', r2.alive === true, r2);
    ok('and she is asked when it ended', /when did this feed end/i.test(r2.txt), r2.txt.slice(0, 200));
    ok('the question says how long it ran and when it started', /9h/.test(r2.txt) && /since/i.test(r2.txt), r2.txt.slice(0, 260));
    ok('and it offers to leave the timer alone', /keep the timer running/i.test(r2.txt), r2.txt.slice(0, 300));
    const r3 = await page.evaluate(() => {
      logTimes.end = state.timers.b1.feed.start + 20 * 60000;
      saveFeedCorrect('b1');
      const f = state.events.filter((e) => e.type === 'feed');
      return { n: f.length, dur: f[0] && f[0].dur, time: f[0] && f[0].time, side: f[0] && f[0].side,
        alive: !!(state.timers.b1 && state.timers.b1.feed) };
    });
    ok('her answer writes one feed', r3.n === 1, r3);
    ok('twenty minutes long, not nine hours', r3.dur === 20 * MIN, r3);
    ok('still filed at the minute nursing began', Math.abs(r3.time - (now - 9 * HOUR)) < 5000, r3);
    ok('keeping the side she started on', r3.side === 'left', r3);
    ok('and the timer is finally cleared', r3.alive === false, r3);
  });

  await section('17. the banner Stop asks the same question, from whatever tab she is on', async () => {
    await load(seed({ timers: { b1: { feed: { start: now - 9 * HOUR, side: 'right' } } } }));
    await page.evaluate(() => go('album'));
    await sleep(250);
    const r = await page.evaluate(() => {
      document.querySelector('#scroll .active-banner .stop-btn').click();
      const s = document.getElementById('sheet');
      return { txt: ((s && s.innerText) || '').replace(/\s+/g, ' '),
        n: state.events.filter((e) => e.type === 'feed').length,
        alive: !!(state.timers.b1 && state.timers.b1.feed), view: view };
    });
    ok('no nine-hour feed appears from the Album tab either', r.n === 0, r);
    ok('she is asked instead', /when did this feed end/i.test(r.txt), r.txt.slice(0, 200));
    ok('the timer survives the question', r.alive === true, r);
    // Forgetting it is the third answer: no feed invented, no timer left nagging.
    const r2 = await page.evaluate(() => {
      const s = document.getElementById('sheet');
      [...s.querySelectorAll('.btn-ghost')].find((b) => /forget/i.test(b.textContent)).click();
      return ((document.getElementById('sheet').innerText) || '').replace(/\s+/g, ' ');
    });
    ok('forgetting it confirms first', /forget this timer/i.test(r2), r2.slice(0, 160));
    await page.evaluate(() => document.getElementById('sheet').querySelector('.btn-primary').click());
    await sleep(400);
    const r3 = await page.evaluate(() => ({ n: state.events.filter((e) => e.type === 'feed').length, alive: !!(state.timers.b1 && state.timers.b1.feed) }));
    ok('and then logs nothing and removes the timer', r3.n === 0 && r3.alive === false, r3);
  });

  await section('18. a timer with no side saved still has one name', async () => {
    // Timers written before sides were recorded carry no side. The banner used to read FEEDING
    // eight pixels above a tile reading Nursing: one running thing under two names.
    await load(seed({ timers: { b1: { feed: { start: now - 10 * MIN } } } }));
    const b = await banners();
    ok('the banner says Nursing, the same word the tile says', b.length === 1 && /nursing/i.test(b[0].lbl) && !/feeding/i.test(b[0].lbl), b);
    const t = await feedTile('#scroll .actions');
    ok('and the tile is flipped all the same', (t || {}).label === 'Nursing', t);
    const txt = await page.evaluate(() => { openFeedRunning(); return (document.getElementById('sheet').innerText || '').replace(/\s+/g, ' '); });
    ok('the sheet claims no side it does not know', /started/i.test(txt) && !/ side,/i.test(txt), txt.slice(0, 160));
    await page.evaluate(() => closeSheet());
    await sleep(450);
  });

  await section('19. with twins, the question that replaces the banners says whose feed it is', async () => {
    /* Two banners read "Robin · Nursing · left" and "Wren · Nursing · right". The sheet that covers
       them both said "The timer has been running 9h ... tell us when it finished", naming neither,
       while saving against a babyId she could not see. openSleepCorrect has looked the name up all
       along. Sections 16 and 17 never caught it because their fixture has one baby.
       The name goes in the sub, not the h2: app/teach-data.js:88 matches this sheet by its title
       ("when did this feed end"), so a name in the heading would quietly take the "what is this?"
       dot away from every twin household. The last line of this section is what says so. */
    const twins = {
      babies: [{ id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] },
        { id: 'b2', name: 'Wren', birth: now - 60 * DAY, sex: 'M', routines: [], doctors: [], allergies: [] }],
      activeBabyId: 'b1',
      timers: { b1: { feed: { start: now - 12 * MIN, side: 'left' } }, b2: { feed: { start: now - 9 * HOUR, side: 'right' } } },
    };
    await load(seed(twins));
    const b = await banners();
    ok('both banners name their own baby', b.length === 2 && /Robin/.test(b[0].lbl) && /Wren/.test(b[1].lbl), b);
    // Wren's Stop is the door. Nine hours, so it diverts to the question instead of writing.
    const r = await page.evaluate(() => {
      [...document.querySelectorAll('#scroll .active-banner')]
        .find((x) => /Wren/.test(x.querySelector('.lbl').textContent)).querySelector('.stop-btn').click();
      const s = document.getElementById('sheet');
      return { sub: ((s.querySelector('.sub') || {}).textContent || '').replace(/\s+/g, ' '),
        txt: ((s && s.innerText) || '').replace(/\s+/g, ' '),
        dot: !!s.querySelector('h2 .lg-i'),
        primary: (s.querySelector('.btn-primary') || {}).getAttribute ? s.querySelector('.btn-primary').getAttribute('onclick') : '' };
    });
    ok('the question says whose timer it is, right at the front', /^wren's timer has been running/i.test(r.sub), r.sub.slice(0, 120));
    ok('and never Robin, who is the baby on screen', !/robin/i.test(r.txt), r.txt.slice(0, 300));
    ok('so it is not the unnamed "the timer" any more', !/^the timer/i.test(r.sub), r.sub.slice(0, 80));
    ok('the ask at the end names her too, the way sleep asks when Wren woke', /when wren finished/i.test(r.sub), r.sub.slice(0, 400));
    ok('and Wren is who the answer is saved against', /saveFeedCorrect\('b2'\)/.test(r.primary || ''), r.primary);
    // teach-data matches this sheet by its title, so naming her in the h2 instead would have
    // stripped this from every twin household without a single test noticing.
    ok('and twins keep the "what is this?" dot on the heading', r.dot === true, r);
    await page.evaluate(() => closeSheet());
    await sleep(450);

    /* The worse route. Wren is the baby on screen, her nine-hour timer is still running, and
       starting a new one offers "Finish it now". That lands on this same sheet with no banner
       above it at all, so the sheet is the only thing that can say whose feed is being closed. */
    await load(seed(Object.assign({}, twins, { activeBabyId: 'b2' })));
    await page.evaluate(() => { startFeedTimer(); });
    await sleep(350);
    const c = await page.evaluate(() => (((document.getElementById('sheet') || {}).innerText) || '').replace(/\s+/g, ' '));
    ok('starting a second one offers to finish the first', /finish it now/i.test(c), c.slice(0, 200));
    await page.evaluate(() => {
      [...document.getElementById('sheet').querySelectorAll('button')].find((x) => /finish it now/i.test(x.textContent)).click();
    });
    await sleep(700);
    const r2 = await page.evaluate(() => {
      const s = document.getElementById('sheet');
      return { h2: ((s && s.querySelector('h2')) || {}).textContent || '',
        sub: ((s.querySelector('.sub') || {}).textContent || '').replace(/\s+/g, ' '),
        n: state.events.filter((e) => e.type === 'feed').length,
        alive: !!(state.timers.b2 && state.timers.b2.feed) };
    });
    ok('"Finish it now" asks rather than writes', r2.n === 0 && r2.alive === true, r2);
    ok('the question really did arrive', /when did this feed end/i.test(r2.h2), r2.h2);
    ok('and with no banner left to explain it, it still names Wren twice', (r2.sub.match(/wren/gi) || []).length === 2, r2.sub.slice(0, 400));
    await page.evaluate(() => closeSheet());
    await sleep(450);

    // A name is a thing a parent types, so it goes through escapeHtml the way openSleepCorrect's does.
    await load(seed(Object.assign({}, twins, {
      babies: [twins.babies[0], Object.assign({}, twins.babies[1], { name: 'Wren <3' })],
      activeBabyId: 'b2',
    })));
    const r3 = await page.evaluate(() => {
      openFeedCorrect('b2');
      const d = document.getElementById('sheet').querySelector('.sub');
      return { txt: d.textContent, kids: d.children.length };
    });
    ok('a name with a bracket in it stays text, not markup', /Wren <3's timer/.test(r3.txt) && r3.kids === 0, r3);
    await page.evaluate(() => closeSheet());
    await sleep(450);

    /* And the common case must read exactly as it did. One baby needs no name here: she knows who
       she was nursing, and "Robin's feed" would only sound like Cubby talking about a stranger. */
    await load(seed({ timers: { b1: { feed: { start: now - 9 * HOUR, side: 'left' } } } }));
    const one = await page.evaluate(() => {
      openFeedCorrect('b1');
      const s = document.getElementById('sheet');
      return { sub: (s.querySelector('.sub').textContent || '').replace(/\s+/g, ' ') };
    });
    ok('with one baby it is still "The timer has been running", word for word',
      /^The timer has been running 9h[\d m]*, since /.test(one.sub), one.sub.slice(0, 120));
    ok('and the ask is still "when it finished", with no name anywhere', /when it finished\.$/i.test(one.sub) && !/robin/i.test(one.sub), one.sub.slice(0, 400));
    await page.evaluate(() => closeSheet());
    await sleep(450);
  });

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'FEED-TILE-GUARD: FAIL' : 'FEED-TILE-GUARD: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
