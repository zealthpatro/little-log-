#!/usr/bin/env node
/* THE HOME SCREEN AT 3AM.
 *
 * What was wrong for a real parent. Measured at 03:12 on a 390x844 phone, one hand, baby on the
 * other arm: the largest thing on the screen was a 263px full-brightness photo of her baby that
 * advanced itself every 4.5 seconds. Feed and Sleep started at y=555 with their subtitles clipped
 * by the nav, and Nappy showed 47 of its 144 pixels. The one thing she opened Cubby to do was the
 * thing she had to scroll for, while the screen moved on its own.
 *
 * The fix is layout only, and it is silent: between 23:00 and 05:00 the quick log row moves above
 * the hero and the slideshow holds on one photo. Nothing is hidden, nothing is dimmed, nothing is
 * announced, and it reverts by itself the next time home paints after 5am.
 *
 * So this gate checks the things that are easy to get wrong:
 *   - the order really flips, at the right hour, in both directions;
 *   - the photo is STILL rather than gone, and the day case proves the wait is long enough that
 *     "it did not advance" means something;
 *   - the photo is on screen, in pixels. "Full height and undimmed" is true of an element parked
 *     below the nav with none of it showing, which is what this layout did before the tips line
 *     moved down with it, so heroTop is asserted and not merely collected;
 *   - the whole quick log row clears the nav, WITH a nap timer banner up, which is the commonest
 *     3am state and the one where Nappy was still losing 64 of its 144 pixels;
 *   - the order is decided once per visit and does not change under a screen she is already
 *     holding: a repaint across 05:00 used to throw the Feed tile 506px down the page;
 *   - the night screen is the same blocks as the day screen, only reordered: nothing added, nothing
 *     removed, no banner, no "night mode";
 *   - the pregnancy home, an empty album, a single photo, a save and a reload are all untouched.
 *
 * Pass the base URL. There is no default, because a gate that quietly grades whatever is already
 * listening on a shared port has graded the wrong tree in this repo before.
 *
 *   PORT=9317 node tools/serve.js &
 *   node tools/night_home_check.js http://localhost:9317
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2];
if (!BASE) { console.error('usage: node tools/night_home_check.js http://localhost:<port>'); process.exit(2); }
const SHOTS = process.env.SHOT_DIR || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, HOUR = 3600000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

/* One 1x1 jpeg, three ids. The bytes do not matter; what matters is that heroPhotos() returns more
   than one, because a single photo never had a timer to stop and would pass this gate by accident. */
const PX = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
const photoRows = (n) => Array.from({ length: n }, (_, i) => ({ id: 'ph' + i, babyId: 'b1', photoId: 'p' + i, at: Date.now() - i * DAY }));
const photoBytes = (n) => Array.from({ length: n }, (_, i) => 'p' + i).reduce((m, k) => (m[k] = PX, m), {});

const clockAt = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); };

const seed = (now, over) => Object.assign({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
  activeBabyId: 'b1', events: [{ id: 'f1', type: 'feed', babyId: 'b1', method: 'bottle', amount: 120, unit: 'ml', time: now - 2 * HOUR, authorId: 'local' }],
  illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: photoRows(3), vaccines: {}, pregnancy: null, notes: [],
}, over || {});

/* Read straight off the laid-out page: which top-level blocks home printed, in which order, and
   where the tiles and the photo actually ended up in pixels. Everything here is real DOM and real
   geometry; nothing reads a variable the app set for itself. */
const READ = () => {
  const kids = Array.from(document.querySelectorAll('#scroll .fade-in > *'));
  const sig = kids.map((el) => el.tagName.toLowerCase() + '.' + (el.getAttribute('class') || ''));
  const iHero = kids.findIndex((el) => el.classList.contains('hero') || el.classList.contains('hero-invite'));
  const iTitle = kids.findIndex((el) => el.classList.contains('sec-title') && /Quick log/.test(el.textContent || ''));
  const iActions = kids.findIndex((el) => el.classList.contains('actions'));
  const slides = Array.from(document.querySelectorAll('#scroll .hero-slide'));
  const dots = Array.from(document.querySelectorAll('#scroll .hero-dots span'));
  const hero = document.querySelector('#scroll .hero');
  const hr = hero ? hero.getBoundingClientRect() : null;
  const cs = hero ? getComputedStyle(hero) : null;
  const nav = document.querySelector('.nav');
  const navTop = nav ? nav.getBoundingClientRect().top : null;
  const tiles = Array.from(document.querySelectorAll('#scroll .actions .action')).map((b) => {
    const hint = b.querySelector('.hint');
    return { label: (b.querySelector('.label') || {}).textContent || '', top: Math.round(b.getBoundingClientRect().top),
      bottom: Math.round(b.getBoundingClientRect().bottom), hintBottom: hint ? Math.round(hint.getBoundingClientRect().bottom) : null };
  });
  return {
    sig, iHero, iTitle, iActions, navTop, tiles,
    slides: slides.length, dots: dots.length,
    active: slides.findIndex((s) => s.classList.contains('active')),
    activeCount: slides.filter((s) => s.classList.contains('active')).length,
    dotOn: dots.findIndex((d) => d.classList.contains('on')),
    dotOnCount: dots.filter((d) => d.classList.contains('on')).length,
    heroTop: hr ? Math.round(hr.top) : null, heroH: hr ? Math.round(hr.height) : null,
    heroOpacity: cs ? cs.opacity : null, heroFilter: cs ? cs.filter : null, heroDisplay: cs ? cs.display : null,
    imgs: document.querySelectorAll('#scroll .hero img').length,
    running: typeof heroTimer !== 'undefined' && heroTimer !== null,
    words: (document.querySelector('#scroll') || {}).innerText || '',
  };
};

/* READ carries the whole screen so any assertion can reach for what it needs; a failure only wants
   the handful of numbers it turned on. */
const brief = (r) => ({ iHero: r.iHero, iTitle: r.iTitle, iActions: r.iActions, slides: r.slides, dots: r.dots,
  active: r.active, activeCount: r.activeCount, dotOn: r.dotOn, dotOnCount: r.dotOnCount, imgs: r.imgs,
  running: r.running, heroH: r.heroH, heroTop: r.heroTop, navTop: r.navTop,
  heroOpacity: r.heroOpacity, heroFilter: r.heroFilter, heroDisplay: r.heroDisplay });

/* The tile labels are live: Sleep reads "Wake up" while a nap runs and Feed reads "Nursing" while a
   nursing timer does, so matching the literal words would quietly find two tiles out of three in
   the one state this screen exists for. Matched by what the tile IS, and each one returned once. */
const FEED = /^(feed|nursing)$/i, SLEEP = /^(sleep|wake up)$/i, NAPPY = /^nappy$/i;
const threeOf = (tiles) => [FEED, SLEEP, NAPPY].map((re) => tiles.find((t) => re.test((t.label || '').trim()))).filter(Boolean);
const feedTop = (r) => { const t = (r.tiles || []).find((x) => FEED.test((x.label || '').trim())); return t ? t.top : null; };
/* Move the page's clock on without reloading it, the way an hour passing while she holds the phone
   moves it on. Nothing is re-seeded and nothing is scrolled: only the clock and one repaint. */
const TICK = (mins) => {
  const R = Date, sh = mins * 60000;
  function D(...a) { return a.length === 0 ? new R(R.now() + sh) : new R(...a); }
  D.prototype = R.prototype; D.now = () => R.now() + sh; D.parse = R.parse; D.UTC = R.UTC;
  window.Date = D;
  render();
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const errs = [];

  /* A page per clock, because the hour under test has to be true from the very first paint: the
     layout is decided at render time, not adjusted afterwards. */
  const openAt = async (h, m) => {
    const shift = clockAt(h, m) - Date.now();
    const page = await browser.newPage();
    page.on('pageerror', (e) => errs.push(e.message));
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await page.evaluateOnNewDocument((sh) => {
      const R = Date;
      function D(...a) { return a.length === 0 ? new R(R.now() + sh) : new R(...a); }
      D.prototype = R.prototype; D.now = () => R.now() + sh; D.parse = R.parse; D.UTC = R.UTC;
      window.Date = D;
    }, shift);
    await page.setViewport({ width: 390, height: 844 });
    await page.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });
    await page.evaluate(() => localStorage.setItem('cubby-quick-uid', 'local'));
    return page;
  };
  const load = async (page, s, bytes) => {
    await page.evaluate((x, b) => {
      localStorage.setItem('little-log-v1', JSON.stringify(x));
      localStorage.setItem('little-log-photos-v1', JSON.stringify(b || {}));
      /* seen moved to a per-person localStorage key; the copy in state.settings is inert now, so
         seeding only that one left every case below rendering a first-run screen. */
      localStorage.setItem('cubby-seen-local', JSON.stringify({ home: 1, log: 1, album: 1, health: 1, welcome: 1 }));
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
    }, s, bytes || {});
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1400);
  };

  const night = await openAt(3, 12);
  const day = await openAt(15, 0);
  let nightTiles = null, nightNav = null;

  console.log('\n1. at 03:12 the thing she came to do is above the photo');
  {
    await load(night, seed(clockAt(3, 12)), photoBytes(3));
    const r = await night.evaluate(READ);
    ok('the quick log heading is on the page at all', r.iTitle >= 0, r.sig);
    ok('the hero is on the page at all', r.iHero >= 0, r.sig);
    ok('the heading comes before the photo', r.iTitle >= 0 && r.iHero >= 0 && r.iTitle < r.iHero, { iTitle: r.iTitle, iHero: r.iHero });
    ok('and the tiles sit straight under their heading', r.iActions === r.iTitle + 1, { iTitle: r.iTitle, iActions: r.iActions });
    ok('so the photo is below the tiles, not above them', r.iActions < r.iHero, { iActions: r.iActions, iHero: r.iHero });
    ok('there are tiles to reorder (five of them)', r.tiles.length === 5, r.tiles.map((t) => t.label));
    /* The three answers at 3am. Whole, subtitles and all, above the nav, without scrolling: at
       03:12 before this change Feed and Sleep began at y=555 with their subtitles cut off and
       Nappy showed 47 of its 144 pixels. Counted, because [].every() is true and a row that
       rendered nothing would sail through. */
    const three = threeOf(r.tiles);
    ok('Feed, Sleep and Nappy are all in the row', three.length === 3, r.tiles.map((t) => t.label));
    ok('all three are whole on screen without scrolling', three.length === 3 && three.filter((t) => t.bottom <= r.navTop).length === 3, { three, navTop: r.navTop });
    ok('and none of their subtitles is clipped by the nav', three.length === 3 && three.filter((t) => t.hintBottom !== null && t.hintBottom <= r.navTop).length === 3, { three, navTop: r.navTop });
    /* Not just the three. The last tile in the row was losing its bottom third to the nav, which is
       the same defect one seat along, and it is the tile a customised row can put Feed in. */
    ok('every tile in the row clears the nav, not only the three', r.tiles.length > 0 && r.tiles.filter((t) => t.bottom <= r.navTop).length === r.tiles.length, { tiles: r.tiles, navTop: r.navTop });
    nightTiles = r.tiles; nightNav = r.navTop;
  }

  console.log('\n1b. with a nap running, which is what 3am usually looks like');
  {
    /* A running nap puts a 107px banner above the row, and it is the state a parent is most likely
       to be in when she opens this screen in the dark: she is logging the next thing while the last
       one is still counting. With the banner up, moving the row above the photo alone still left
       Nappy showing 80 of its 144 pixels with its subtitle behind the nav, so the row is measured
       in the state that pushes it hardest, not only in the empty one. Sleep reads "Wake up" here. */
    const napAt = clockAt(3, 12) - 47 * 60 * 1000;
    const napping = await openAt(3, 12);
    await load(napping, seed(clockAt(3, 12), { timers: { b1: { sleep: { start: napAt } } } }), photoBytes(3));
    const r = await napping.evaluate(READ);
    ok('the timer banner really is up', /\bwake up\b/i.test(r.words) || r.tiles.some((t) => /wake up/i.test(t.label)), r.tiles.map((t) => t.label));
    ok('the tiles are above the photo here too', r.iTitle >= 0 && r.iHero >= 0 && r.iTitle < r.iHero, { iTitle: r.iTitle, iHero: r.iHero });
    const three = threeOf(r.tiles);
    ok('feed, sleep and nappy are all still findable while a timer runs', three.length === 3, r.tiles.map((t) => t.label));
    ok('and all three are whole above the nav with the banner up', three.length === 3 && three.filter((t) => t.bottom <= r.navTop).length === 3, { three, navTop: r.navTop });
    ok('with no subtitle clipped by the nav', three.length === 3 && three.filter((t) => t.hintBottom !== null && t.hintBottom <= r.navTop).length === 3, { three, navTop: r.navTop });
    if (SHOTS) await napping.screenshot({ path: SHOTS + '/night-home-0312-nap.png' });
    await napping.close();
  }

  console.log('\n2. the photo is still there, full size, undimmed. it just holds still');
  {
    const before = await night.evaluate(READ);
    ok('all three photos are in the DOM', before.slides === 3 && before.imgs === 3, brief(before));
    ok('the dots are still there, one per photo', before.dots === 3, brief(before));
    ok('the first photo is showing, and only one is', before.active === 0 && before.activeCount === 1, brief(before));
    ok('with its dot lit, and only one dot', before.dotOn === 0 && before.dotOnCount === 1, brief(before));
    ok('the hero is full height, not shrunk', before.heroH > 200, before.heroH);
    ok('nothing dims it', before.heroOpacity === '1' && before.heroFilter === 'none' && before.heroDisplay !== 'none', brief(before));
    /* Every property above is equally true of a photo parked below the nav with none of it on the
       screen, which is exactly where this layout put it before the tips line moved down with it:
       heroTop 795 against a nav at 746, zero pixels of her baby's face, at scrollTop 0. Full size
       and undimmed is not the same claim as visible, so this asserts the pixels. */
    ok('and the top of the photo is on screen, not parked behind the nav', before.heroTop !== null && before.navTop !== null && before.heroTop < before.navTop, { heroTop: before.heroTop, navTop: before.navTop });
    ok('no interval is armed', before.running === false, before.running);
    await sleep(10000);                       // two and a bit turns of the 4500ms carousel
    const after = await night.evaluate(READ);
    ok('ten seconds later it has NOT advanced', after.active === 0 && after.activeCount === 1, brief(after));
    ok('and the lit dot has not moved either', after.dotOn === 0 && after.dotOnCount === 1, brief(after));
    ok('the photo did not vanish while we watched', after.slides === 3 && after.imgs === 3, brief(after));
    /* Two shots, because home scrolls inside #scroll and a viewport capture alone would never show
       the photo this block is about. The second one is the proof it is still whole and bright. */
    if (SHOTS) {
      await night.screenshot({ path: SHOTS + '/night-home-0312.png' });
      await night.evaluate(() => { const h = document.querySelector('#scroll .hero'); if (h) h.scrollIntoView({ block: 'center' }); });
      await sleep(400);
      await night.screenshot({ path: SHOTS + '/night-home-0312-hero.png' });
      await night.evaluate(() => { const s = document.querySelector('#scroll'); if (s) s.scrollTo(0, 0); });
      await sleep(200);
    }
  }

  console.log('\n3. at 15:00 nothing changed: photo first, and it still moves');
  {
    await load(day, seed(clockAt(15, 0)), photoBytes(3));
    const r = await day.evaluate(READ);
    ok('the photo comes first in the day', r.iHero >= 0 && r.iTitle > r.iHero, { iHero: r.iHero, iTitle: r.iTitle });
    ok('the tiles are still under their heading', r.iActions === r.iTitle + 1, { iTitle: r.iTitle, iActions: r.iActions });
    ok('the carousel is armed', r.running === true, r.running);
    ok('it starts on the first photo', r.active === 0, r);
    await sleep(10000);                       // the SAME wait as the night case, so 'it did not move' means something
    const after = await day.evaluate(READ);
    ok('after the same ten seconds it HAS advanced', after.active > 0 && after.activeCount === 1, brief(after));
    ok('and the lit dot moved with it', after.dotOn === after.active && after.dotOnCount === 1, brief(after));
    if (SHOTS) await day.screenshot({ path: SHOTS + '/day-home-1500.png' });

    /* The point of the whole change, in pixels. Same seed, same phone, same tiles: at night they
       are a photo's height further up the page, and more of them are whole above the nav. */
    console.log('       day tiles:   ' + JSON.stringify(r.tiles) + '  nav ' + r.navTop);
    console.log('       night tiles: ' + JSON.stringify(nightTiles) + '  nav ' + nightNav);
    const byLabel = (list, l) => list.find((t) => t.label.trim().toLowerCase() === l);
    const moved = ['feed', 'sleep', 'nappy'].map((l) => {
      const a = byLabel(r.tiles, l), b = byLabel(nightTiles, l);
      return a && b ? a.top - b.top : null;
    });
    ok('all three tiles are higher up at night, by more than 100px each', moved.length === 3 && moved.filter((m) => m !== null && m > 100).length === 3, moved);
    const wholeDay = r.tiles.filter((t) => t.bottom <= r.navTop).length;
    const wholeNight = nightTiles.filter((t) => t.bottom <= nightNav).length;
    ok('and more of the row is whole above the nav at night', wholeNight > wholeDay, { wholeNight, wholeDay });
  }

  console.log('\n4. it says nothing about it: the same blocks, reordered');
  {
    const n = await night.evaluate(READ);
    const d = await day.evaluate(READ);
    const sortedN = n.sig.slice().sort(), sortedD = d.sig.slice().sort();
    ok('the night screen has the same number of blocks as the day screen', n.sig.length === d.sig.length && n.sig.length > 5, { night: n.sig.length, day: d.sig.length });
    ok('and exactly the same blocks, only in a different order', JSON.stringify(sortedN) === JSON.stringify(sortedD), { night: n.sig, day: d.sig });
    ok('the order really is different', JSON.stringify(n.sig) !== JSON.stringify(d.sig), n.sig);
    ok('no banner announcing a mode', !/night mode|dark mode|night view|quiet mode|3am mode/i.test(n.words), n.words.slice(0, 200));
    ok('and nothing telling her she should be asleep', !/should be asleep|go to sleep|get some sleep|try to sleep|bedtime for you/i.test(n.words), n.words.slice(0, 200));
  }

  console.log('\n5. the boundary, from both sides');
  {
    /* Guarded, so a missing rule is one named failure instead of a ReferenceError that kills the
       run before the DOM checks below ever get to speak. */
    const fn = await night.evaluate(() => {
      if (typeof isNightHome !== 'function') return null;
      const at = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return isNightHome(d.getTime()); };
      return { h2259: at(22, 59), h2300: at(23, 0), h0000: at(0, 0), h0459: at(4, 59), h0500: at(5, 0), h1200: at(12, 0) };
    }) || {};
    ok('there is a rule about the hour at all', typeof fn.h0000 === 'boolean', fn);
    ok('22:59 is not night', fn.h2259 === false, fn);
    ok('23:00 is', fn.h2300 === true, fn);
    ok('midnight is', fn.h0000 === true, fn);
    ok('04:59 still is', fn.h0459 === true, fn);
    ok('05:00 is not, so it reverts by itself', fn.h0500 === false, fn);
    ok('and the middle of the afternoon certainly is not', fn.h1200 === false, fn);

    const late = await openAt(22, 59);
    await load(late, seed(clockAt(22, 59)), photoBytes(3));
    const rl = await late.evaluate(READ);
    ok('a minute before eleven the page is still the day page', rl.iHero < rl.iTitle && rl.running === true, { iHero: rl.iHero, iTitle: rl.iTitle, running: rl.running });
    await late.close();

    const just = await openAt(23, 1);
    await load(just, seed(clockAt(23, 1)), photoBytes(3));
    const rj = await just.evaluate(READ);
    ok('a minute after, the tiles are on top and the photo is still', rj.iTitle < rj.iHero && rj.running === false, { iTitle: rj.iTitle, iHero: rj.iHero, running: rj.running });
    await just.close();

    const dawn = await openAt(5, 1);
    await load(dawn, seed(clockAt(5, 1)), photoBytes(3));
    const rd = await dawn.evaluate(READ);
    ok('at 05:01 it is the day page again, with no reset to do', rd.iHero < rd.iTitle && rd.running === true, { iHero: rd.iHero, iTitle: rd.iTitle, running: rd.running });
    await dawn.close();
  }

  console.log('\n6. eleven strikes while she is holding the phone: the photo stops, the page does not move');
  {
    /* The keep-it-cycling early return in initHero exists so a repaint does not snap her back to
       photo one. If the night check sat after it, a phone left open from the evening would keep
       advancing all night, which is the exact case this whole change is about.

       The ORDER is a different question and gets the opposite answer. Home repaints on every save
       and on every listener burst, so reading the clock live meant a paint that happened to cross a
       boundary reordered the screen under her hands. That is why the order is latched per visit,
       and it is why this block asserts the tiles stay put: a green here used to be defending a
       460px jump. */
    const evening = await openAt(22, 58);
    await load(evening, seed(clockAt(22, 58)), photoBytes(3));
    const before = await evening.evaluate(READ);
    ok('it is cycling at 22:58', before.running === true, before.running);
    ok('and it is the day order to begin with', before.iHero >= 0 && before.iTitle > before.iHero, brief(before));
    ok('with the Feed tile somewhere real', feedTop(before) !== null, before.tiles);
    await evening.evaluate(TICK, 3);                   // three minutes later: 23:01
    const after = await evening.evaluate(READ);
    ok('the next paint after eleven stops the carousel', after.running === false, brief(after));
    ok('but the order does NOT change under her hands', after.iHero >= 0 && after.iTitle > after.iHero, brief(after));
    /* Not "not a pixel": the greeting and the last-feed row are clock-dependent copy on main and
       already rewrap at this boundary, which is 37px measured here and nothing to do with this
       change. What is being caught is the reorder, which threw this tile 531px. A line of copy is
       the ceiling. */
    ok('and the Feed tile has not jumped a screen', feedTop(after) !== null && Math.abs(feedTop(after) - feedTop(before)) < 80, { before: feedTop(before), after: feedTop(after) });
    ok('the photos are all still there', after.slides === 3, brief(after));
    await evening.evaluate(() => go('log'));
    await sleep(400);
    await evening.evaluate(() => go('home'));
    await sleep(400);
    const back = await evening.evaluate(READ);
    ok('coming back to home is when the night order arrives', back.iTitle >= 0 && back.iHero >= 0 && back.iTitle < back.iHero, brief(back));
    ok('and the photo is still held', back.running === false, brief(back));
    await evening.close();
  }

  console.log('\n6b. the 05:02 feed, phone picked back up mid-feed');
  {
    /* She starts feeding at 04:55 with home open and the phone face down. At 05:02 she picks it up
       to log it and something repaints: a listener, the timer, the tab becoming visible. Reading
       the clock live threw the Feed tile 506px down an 844px screen at that exact moment, which is
       the scenario this whole item exists for, arriving six hours late. */
    const dawn = await openAt(4, 58);
    await load(dawn, seed(clockAt(4, 58)), photoBytes(3));
    const b0 = await dawn.evaluate(READ);
    ok('at 04:58 it is the night order', b0.iTitle >= 0 && b0.iHero >= 0 && b0.iTitle < b0.iHero, brief(b0));
    ok('and Feed is on screen above the nav', feedTop(b0) !== null && feedTop(b0) < b0.navTop, { feedTop: feedTop(b0), navTop: b0.navTop });
    await dawn.evaluate(TICK, 4);                      // 05:02
    const b1 = await dawn.evaluate(READ);
    ok('a repaint at 05:02 keeps the order she was looking at', b1.iTitle >= 0 && b1.iHero >= 0 && b1.iTitle < b1.iHero, brief(b1));
    ok('the Feed tile is within a line of where she left it', feedTop(b1) !== null && Math.abs(feedTop(b1) - feedTop(b0)) < 80, { before: feedTop(b0), after: feedTop(b1) });
    ok('so it is still above the nav, not below the fold', feedTop(b1) !== null && feedTop(b1) < b1.navTop, { feedTop: feedTop(b1), navTop: b1.navTop });
    await dawn.evaluate(() => go('log'));
    await sleep(400);
    await dawn.evaluate(() => go('home'));
    await sleep(400);
    const b2 = await dawn.evaluate(READ);
    ok('and it goes back to the day order the next time she opens home', b2.iHero >= 0 && b2.iTitle > b2.iHero, brief(b2));
    ok('with the carousel running again', b2.running === true, brief(b2));
    await dawn.close();
  }

  console.log('\n7. no photos, and one photo');
  {
    const none = await openAt(3, 12);
    await load(none, seed(clockAt(3, 12), { photos: [] }), {});
    const rn = await none.evaluate(READ);
    ok('with an empty album the invite still shows', rn.iHero >= 0, rn.sig);
    ok('and the tiles are above it', rn.iTitle >= 0 && rn.iHero >= 0 && rn.iTitle < rn.iHero, { iTitle: rn.iTitle, iHero: rn.iHero });
    ok('there is nothing to cycle', rn.running === false && rn.slides === 0, brief(rn));
    await none.close();

    const one = await openAt(3, 12);
    await load(one, seed(clockAt(3, 12), { photos: photoRows(1) }), photoBytes(1));
    const ro = await one.evaluate(READ);
    ok('one photo still shows at night', ro.slides === 1 && ro.imgs === 1 && ro.active === 0, brief(ro));
    ok('one photo gets no dots', ro.dots === 0, brief(ro));
    ok('and no interval', ro.running === false, brief(ro));
    ok('the tiles are still above it', ro.iTitle >= 0 && ro.iHero >= 0 && ro.iTitle < ro.iHero, { iTitle: ro.iTitle, iHero: ro.iHero });
    await one.close();
  }

  console.log('\n8. a save at 3am, and a reload at 3am');
  {
    /* Re-seeded: every page above shares one localStorage jar, so the single-photo case in 7 is
       what a reload here would otherwise pick up. */
    await load(night, seed(clockAt(3, 12)), photoBytes(3));
    const r0 = await night.evaluate(READ);
    ok('starting from the night order', r0.iTitle >= 0 && r0.iHero >= 0 && r0.iTitle < r0.iHero, brief(r0));
    const r1 = await night.evaluate(() => {
      saveDiaper('wet');
      const kids = Array.from(document.querySelectorAll('#scroll .fade-in > *'));
      return { n: state.events.filter((e) => e.type === 'diaper').length,
        iHero: kids.findIndex((el) => el.classList.contains('hero')),
        iTitle: kids.findIndex((el) => el.classList.contains('sec-title') && /Quick log/.test(el.textContent || '')),
        running: heroTimer !== null, slides: document.querySelectorAll('#scroll .hero-slide').length,
        active: Array.from(document.querySelectorAll('#scroll .hero-slide')).findIndex((s) => s.classList.contains('active')) };
    });
    ok('the nappy is written', r1.n === 1, r1);
    ok('the repaint keeps the tiles on top', r1.iTitle >= 0 && r1.iHero >= 0 && r1.iTitle < r1.iHero, r1);
    ok('and does not quietly re-arm the carousel', r1.running === false, r1);
    ok('the photo is back on the first slide, not gone', r1.slides === 3 && r1.active === 0, r1);
    await night.reload({ waitUntil: 'networkidle2' });
    await sleep(1400);
    const r2 = await night.evaluate(READ);
    ok('a reload at 3am comes back to the night order', r2.iTitle >= 0 && r2.iHero >= 0 && r2.iTitle < r2.iHero, brief(r2));
    ok('with the photo still held', r2.running === false && r2.slides === 3 && r2.active === 0, brief(r2));
  }

  console.log('\n8b. the same night, on the narrowest phone this app supports');
  {
    /* 320px is where every hint wraps and the row grows 16px a tile. Coverage, not a red-green:
       this one passed before the change too. It is here to record the honest residual, because two
       things at 320 are NOT fixed and no reordering can fix them: the fifth tile loses 9px to the
       nav, and with a nap timer banner up Nappy loses 40 of its 144 with its subtitle behind the
       nav. There is nothing left above the row to move. The three she came for are whole in the
       ordinary case, and that is what this asserts. */
    const narrow = await openAt(3, 12);
    await narrow.setViewport({ width: 320, height: 844 });
    await load(narrow, seed(clockAt(3, 12)), photoBytes(3));
    const r = await narrow.evaluate(READ);
    const three = threeOf(r.tiles);
    ok('at 320 the tiles are still above the photo', r.iTitle >= 0 && r.iHero >= 0 && r.iTitle < r.iHero, { iTitle: r.iTitle, iHero: r.iHero });
    ok('at 320 feed, sleep and nappy are whole above the nav', three.length === 3 && three.filter((t) => t.bottom <= r.navTop).length === 3, { three, navTop: r.navTop });
    ok('at 320 none of their subtitles is clipped', three.length === 3 && three.filter((t) => t.hintBottom !== null && t.hintBottom <= r.navTop).length === 3, { three, navTop: r.navTop });
    const over = await narrow.evaluate(() => { const s = document.querySelector('#scroll'); return s.scrollWidth > s.clientWidth; });
    ok('and nothing runs off the side', over === false, over);
    if (SHOTS) await narrow.screenshot({ path: SHOTS + '/night-home-0312-320.png' });
    await narrow.close();
  }

  console.log('\n9. the pregnancy home is not touched by any of this');
  {
    const pregState = (now) => ({
      babies: [], activeBabyId: null, events: [], illnesses: [],
      settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, welcome: 1 } },
      timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, notes: [],
      pregnancy: { dueDate: now + 100 * DAY, ownerId: 'local', stage: 'pregnant', careTeam: [], appts: [], moments: [], journey: { saved: {} } },
    });
    const readPreg = () => {
      const sc = document.querySelector('#scroll');
      const kids = sc ? Array.from(sc.children) : [];
      return { sig: kids.map((el) => el.tagName.toLowerCase() + '.' + (el.getAttribute('class') || '')),
        hero: document.querySelectorAll('#scroll .hero').length,
        secs: Array.from(document.querySelectorAll('#scroll .sec-title')).map((el) => (el.textContent || '').trim()) };
    };
    const pn = await openAt(3, 12);
    await load(pn, pregState(clockAt(3, 12)), {});
    const a = await pn.evaluate(readPreg);
    await pn.close();
    const pd = await openAt(15, 0);
    await load(pd, pregState(clockAt(15, 0)), {});
    const b = await pd.evaluate(readPreg);
    await pd.close();
    ok('the pregnancy home actually rendered something', a.sig.length > 0 && a.secs.length > 0, a);
    ok('it has no baby hero to hold still', a.hero === 0, a);
    ok('its sections are in the same order at 3am as at 3pm', JSON.stringify(a.secs) === JSON.stringify(b.secs), { night: a.secs, day: b.secs });
    ok('and so is its layout', JSON.stringify(a.sig) === JSON.stringify(b.sig), { night: a.sig, day: b.sig });
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'NIGHT-HOME: FAIL' : 'NIGHT-HOME: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
