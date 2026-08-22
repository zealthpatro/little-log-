#!/usr/bin/env node
/* YESTERDAY, AS FOUR FACTS.
 *
 * A midwife or health visitor asks the same thing at every early visit: how did yesterday go. How
 * many feeds, how many wet, how many dirty, how long was the longest stretch without a feed. Every
 * one of those numbers was already in a two-week-old's log and Cubby assembled none of them into
 * that shape. sinceCard answers when the last one was, the today strip answers how many so far,
 * and visitSummary prints a fortnight of averages, which is the one shape that actively hides the
 * question: a first-week baby's yesterday is averaged away against the days around it. So a mother
 * sat in her own front room with the app open scrolled the timeline and counted rows out loud.
 *
 * What this gate holds:
 *  - the card exists on the Log surface for a newborn and states the facts, correctly counted
 *  - the longest stretch is measured from the END of a feed, not its start, and may cross midnight
 *  - it is measured from a high-water mark, so a top-up logged inside a long feed invents no stretch
 *  - a stretch longer than the day is a hole in the record, not a stretch, and is never printed
 *  - a stretch that has not closed yet is never printed, so no number grows while she reads it
 *  - a term nobody wrote is dropped, never printed as "0 feeds"; an observed zero still prints
 *  - nothing logged yesterday prints NO card, never "0 feeds · 0 wet · 0 dirty"
 *  - the nappy total is stated, so the card reconciles with the timeline group below it
 *  - it leaves at three weeks on the Log surface and at a month on visitSummary
 *  - another baby's rows and another day's rows never leak into the count, and twins are named
 *  - no target, no verdict, no status colour anywhere on the card, in either theme
 *
 * The base URL is REQUIRED and has no default. A default port is how a gate ends up grading a
 * different checkout that happens to own it, which has already happened in this repo.
 *
 *   PORT=9631 node tools/serve.js &
 *   node tools/yesterday_card_check.js http://localhost:9631
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2];
if (!BASE) { console.error('usage: node tools/yesterday_card_check.js http://localhost:<port>   (no default: a default port grades whatever checkout owns it)'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, HOUR = 3600000, MIN = 60000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

// 09:00 today, so "yesterday" is an unambiguous whole calendar day behind us and a stretch running
// through midnight is genuinely closed by a feed that belongs to today.
const CLOCK = (() => { const d = new Date(); d.setHours(9, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;
// The same midnight boundary the app computes, stepped by calendar date rather than by subtracting
// a fixed day, so this gate does not disagree with the code on a clock-change night.
const DAY_END = (() => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); })();
const DAY_START = (() => { const d = new Date(DAY_END); d.setDate(d.getDate() - 1); d.setHours(0, 0, 0, 0); return d.getTime(); })();
// A time yesterday, in hours after yesterday's midnight. Negative hours reach the day before it.
const y = (h, m) => DAY_START + h * HOUR + (m || 0) * MIN;
// A time today.
const t = (h, m) => DAY_END + h * HOUR + (m || 0) * MIN;

let _n = 0;
const feed = (time, over) => Object.assign({ id: 'f' + (++_n), type: 'feed', babyId: 'b1', method: 'breast', time: time, authorId: 'local' }, over || {});
const nappy = (time, kind, over) => Object.assign({ id: 'd' + (++_n), type: 'diaper', babyId: 'b1', kind: kind, time: time, authorId: 'local' }, over || {});
const babe = (days, over) => Object.assign({ id: 'b1', name: 'Robin', birth: now - days * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }, over || {});

const seed = (over) => Object.assign({
  babies: [babe(12)],
  activeBabyId: 'b1', events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
}, over || {});

/* A full, ordinary yesterday for a twelve-day-old: nine feeds, seven wet, three dirty, and a
   longest closed gap of 22:00 to 02:10, which is 4h 10m. */
const FULL_DAY = () => [
  feed(y(1, 0)), feed(y(4, 0)), feed(y(6, 30)), feed(y(9, 0)), feed(y(11, 30)),
  feed(y(14, 0)), feed(y(16, 30)), feed(y(19, 0)), feed(y(22, 0)),
  nappy(y(1, 10), 'wet'), nappy(y(4, 10), 'wet'), nappy(y(7, 0), 'both'), nappy(y(11, 0), 'wet'),
  nappy(y(14, 20), 'wet'), nappy(y(17, 0), 'both'), nappy(y(20, 0), 'dirty'), nappy(y(22, 30), 'wet'),
  // one feed early today, which is what CLOSES the overnight gap that began at 22:00
  feed(t(2, 10)),
];

(async () => {
  /* protocolTimeout: a full run reloads twenty-odd times and one section died on the default
     Runtime.callFunctionOn timeout under load. Piped through `tail` the shell then reported exit 0,
     so a crash could be read as a pass by anything that trusts the pipeline exit code. */
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', protocolTimeout: 180000, args: ['--no-sandbox', '--disable-gpu'] });
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
    /* domcontentloaded, not networkidle2. Once the service worker is warm it goes on fetching art
       and fonts in the background, and a run that reloads fifteen times eventually hangs waiting
       for a network that is never idle. Nothing here needs the images; the sleep is what waits for
       the app to boot and paint. */
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 40000 });
    await sleep(1600);
  };
  /* Walk to the Log surface the way a parent does, through the real tab, and read the real card out
     of the real DOM. Never document.body.textContent here: this page's inline script is part of it,
     so every string in the source would "pass". */
  const readCard = () => page.evaluate(() => {
    go('log'); setLogTab('log');
    const el = document.querySelector('.yest-card');
    if (!el) return { present: false, count: document.querySelectorAll('.yest-card').length };
    const g = (s) => { const n = el.querySelector(s); return n ? n.textContent.replace(/\s+/g, ' ').trim() : null; };
    const recap = document.querySelector('#scroll button[onclick*="openDayRecap"]');
    return {
      present: true, count: document.querySelectorAll('.yest-card').length,
      head: g('.yc-h'), facts: g('.yc-f'), sub: g('.yc-s'),
      tappable: !!(el.getAttribute('onclick') || el.querySelector('[onclick]')),
      /* Any middot living OUTSIDE a nowrap span can be left stranded at the end of a wrapped line,
         which is what put a lone "·" at the end of line one at 390px. */
      looseDot: [...el.querySelector('.yc-f').childNodes].some((n) => n.nodeType === 3 && n.textContent.indexOf('\u00b7') >= 0),
      // above the recap button, which is the top of the rest of the Log surface
      aboveRecap: recap ? !!(el.compareDocumentPosition(recap) & Node.DOCUMENT_POSITION_FOLLOWING) : null,
      width: Math.round(el.getBoundingClientRect().width),
    };
  });

  /* IDENTITY, printed and asserted. Every negative assertion in this file ("no card at twenty-one
     days", "no zero row") passes for free against a build where the feature does not exist at all,
     so on its own no upper-bound check here can go red. This one can, and it is the first thing
     that runs: it names the checkout under the URL out loud before any grading happens. */
  console.log('\n0. this is the build under test');
  {
    await load(seed({ events: FULL_DAY() }));
    const id = await page.evaluate(() => ({
      card: typeof window.yesterdayCard, facts: typeof window.yesterdayFacts,
      parts: typeof window.yesterdayFactParts, htmlLen: document.documentElement.outerHTML.length,
    }));
    console.log('       IDENT ' + JSON.stringify(id) + ' @ ' + BASE);
    ok('yesterdayCard is on the page', id.card === 'function', id);
    ok('yesterdayFacts is on the page', id.facts === 'function', id);
    ok('yesterdayFactParts is on the page', id.parts === 'function', id);
  }

  console.log('\n1. an ordinary yesterday for a twelve-day-old, stated as facts');
  {
    const r = await readCard();
    ok('the card is on the Log surface', r.present === true, r);
    ok('exactly one of it', r.count === 1, r);
    ok('the heading names yesterday', /^Yesterday\b/.test(r.head || ''), r);
    ok('and dates it, so it is never mistaken for today', /\d/.test((r.head || '').replace('Yesterday', '')), r);
    ok('nine feeds', /\b9 feeds\b/.test(r.facts || ''), r);
    ok('seven wet', /\b7 wet\b/.test(r.facts || ''), r);
    ok('three dirty', /\b3 dirty\b/.test(r.facts || ''), r);
    ok('longest stretch between feeds 4h 10m', /longest stretch between feeds 4h 10m/.test(r.facts || ''), r);
    /* "gap without a feed" doubles the absence. Same number, no deficit in the wording. */
    ok('and never worded as a gap without a feed', r.present === true && !/gap without/i.test(r.facts || ''), r);
    /* The card said "7 wet · 3 dirty" while the timeline group two inches below said "8 nappies",
       because a `both` nappy is one row in two columns. Two Yesterday headings on one scroll whose
       arithmetic does not reconcile invites "which one is right?" on a page she may show a midwife. */
    ok('the nappy TOTAL is stated too, so it reconciles with the timeline', /\b8 nappies \(7 wet, 3 dirty\)/.test(r.facts || ''), r);
    const groupSum = await page.evaluate(() => {
      // The day-head this card sits above: the group LABELLED Yesterday, not simply the first one,
      // which is today's.
      const h = [...document.querySelectorAll('#scroll .day-group .day-head')]
        .find((n) => /yesterday/i.test(n.childNodes[0] ? n.childNodes[0].textContent : ''));
      const sum = h && h.querySelector('.day-sum');
      return sum ? sum.textContent.replace(/\s+/g, ' ').trim() : null;
    });
    ok('and the timeline group really does say 8 nappies', /\b8 nappies\b/.test(groupSum || ''), groupSum);
    ok('it is wide on a 390px phone', r.width > 300 && r.width <= 390, r);
    ok('it sits above the rest of the Log surface', r.aboveRecap === true, r);
    ok('it is a statement, not a tap target', r.tappable === false, r);
    ok('no separator can be stranded at the end of a wrapped line', r.present === true && r.looseDot === false, r);
    ok('it says what it is a record of', /written down/i.test(r.sub || ''), r);
    // One baby: naming her would be noise, and there is nothing to disambiguate.
    ok('a single baby is not named on the card', r.present === true && !/for Robin/.test(r.sub || ''), r);
    // Nothing is missing on a full day, so no caveat is bolted on.
    ok('and nothing is claimed to be missing', r.present === true && !/was logged|were logged/i.test(r.sub || ''), r);
    /* The invariant the whole refutation turned on. A day has 24 hours in it; any stretch longer
       than that is a hole in the record wearing a heading that says Yesterday. */
    const big = (r.facts || '').match(/(\d+)h/);
    ok('no stretch longer than the day it is filed under', !big || Number(big[1]) <= 24, r.facts);
  }

  console.log('\n2. no verdict, no target, no status colour');
  {
    const r = await readCard();
    const all = [r.head, r.facts, r.sub].join(' ');
    const banned = ['should', 'normal', 'expected', 'target', 'goal', 'low', 'high', 'enough',
      'average', 'behind', 'on track', 'ideal', 'recommended', 'too few', 'at least'];
    const hit = banned.filter((w) => new RegExp('\\b' + w + '\\b', 'i').test(all));
    /* r.present, or this reads a missing card as the empty string and passes on a build with no
       card at all. The two style checks beside it were written with that guard; this one was not. */
    ok('no judging word anywhere in the card', r.present === true && hit.length === 0, { present: r.present, hit: hit, all: all });
    const styled = await page.evaluate(() => {
      const el = document.querySelector('.yest-card');
      // A missing card is a FAILURE of this check, not a crash of the whole run. Throwing here once
      // took the remaining eleven sections down with it and reported nothing about them.
      if (!el) return { missing: true };
      // Resolve --ink through a real probe rather than trusting a hex literal, so a theme change
      // cannot quietly turn this assertion into a comparison of two stale strings.
      const probe = document.createElement('span');
      probe.style.color = 'var(--ink)'; el.appendChild(probe);
      const ink = getComputedStyle(probe).color; probe.remove();
      const cs = getComputedStyle(el);
      return { facts: getComputedStyle(el.querySelector('.yc-f')).color, ink: ink,
        border: cs.borderTopWidth + '/' + cs.borderLeftWidth };
    });
    ok('the facts are in ordinary ink', !styled.missing && styled.facts === styled.ink, styled);
    ok('and the card carries no alarm border', !styled.missing && styled.border === '0px/0px', styled);
    /* The whole run is emulated light, so the "ordinary ink, no alarm border" check had never seen
       the theme half this app's parents read it in at 3am. */
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 40000 });
    await sleep(1600);
    const dark = await page.evaluate(() => {
      go('log'); setLogTab('log');
      const el = document.querySelector('.yest-card');
      if (!el) return { missing: true };
      const probe = document.createElement('span');
      probe.style.color = 'var(--ink)'; el.appendChild(probe);
      const ink = getComputedStyle(probe).color; probe.remove();
      const cs = getComputedStyle(el);
      return { facts: getComputedStyle(el.querySelector('.yc-f')).color, ink: ink, bg: cs.backgroundColor,
        border: cs.borderTopWidth + '/' + cs.borderLeftWidth };
    });
    ok('in dark mode the card is still there', dark.missing !== true, dark);
    ok('in dark mode the facts are still ordinary ink', !dark.missing && dark.facts === dark.ink, dark);
    ok('and dark mode adds no alarm border either', !dark.missing && dark.border === '0px/0px', dark);
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  }

  console.log('\n3. the gap is measured from the END of a feed, not the start of it');
  {
    /* One nursing session at 20:00 that ran 90 minutes, next feed at 01:00 today. Start to start is
       5h. The baby came off the breast at 21:30, so the honest gap is 3h 30m. Reading it from the
       start would tell a clinician about a stretch that never happened. */
    await load(seed({ events: [
      feed(y(16, 0)), feed(y(18, 0)), feed(y(20, 0), { dur: 90 * MIN }), feed(t(1, 0)),
      nappy(y(17, 0), 'wet'),
    ] }));
    const r = await readCard();
    ok('the stretch is 3h 30m, from when the feed ended', /longest stretch between feeds 3h 30m\b/.test(r.facts || ''), r);
    ok('not the 5h between the two start times', r.present === true && !/\b5h\b/.test(r.facts || ''), r);
  }

  console.log('\n4. a gap that has not closed yet is never printed');
  {
    /* Two feeds yesterday morning and nothing logged since. It is 9am. The open stretch is a day
       long and counting, and printing it would put a number on the card that grew while she read
       it, on the page she is about to read out to a midwife. */
    await load(seed({ events: [
      feed(y(7, 0)), feed(y(9, 0)), nappy(y(8, 0), 'wet'), nappy(y(13, 0), 'dirty'),
    ] }));
    const r = await readCard();
    ok('the counts it does know are still stated', /\b2 feeds\b/.test(r.facts || '') && /\b1 wet\b/.test(r.facts || ''), r);
    ok('the closed 2h stretch is the answer', /longest stretch between feeds 2h\b/.test(r.facts || ''), r);
    ok('the open day-long stretch is not', r.present === true && !/24h|\b1d\b|\b25h|\b26h/.test(r.facts || ''), r);

    // One feed and nothing after it: there is no closed gap at all, so the fourth fact is simply
    // absent rather than invented.
    await load(seed({ events: [feed(y(10, 0)), nappy(y(11, 0), 'wet')] }));
    const s = await readCard();
    ok('a single feed still gets a card', s.present === true, s);
    ok('and reads "1 feed", not "1 feeds"', /\b1 feed\b/.test(s.facts || '') && !/1 feeds/.test(s.facts || ''), s);
    ok('with no stretch claimed', s.present === true && !/longest/.test(s.facts || ''), s);
  }

  console.log('\n5. a gap wholly outside yesterday is not yesterday\'s gap');
  {
    /* An eight-hour stretch on the day before yesterday, and a fed yesterday. The parent counting
       timeline rows could not tell these apart at a glance; the card must. */
    await load(seed({ events: [
      feed(y(-16, 0)), feed(y(-8, 0)), feed(y(-2, 0)),   // 08:00, 16:00 and 22:00 the day before
      feed(y(4, 0)), feed(y(9, 0)), feed(y(15, 0)), feed(t(1, 0)),
      nappy(y(10, 0), 'wet'),
    ] }));
    const r = await readCard();
    ok('yesterday counts three feeds, not six', /\b3 feeds\b/.test(r.facts || ''), r);
    // 15:00 yesterday to 01:00 today is 10h and does touch yesterday, so that is the answer.
    ok('the overnight stretch that touches yesterday is the answer', /longest stretch between feeds 10h\b/.test(r.facts || ''), r);
    ok('the 8h from the day before is not', r.present === true && !/\b8h\b/.test(r.facts || ''), r);

    /* And the mirror case: a night with nothing logged from 21:00 the evening before until 07:00
       yesterday is ten hours of yesterday's morning with no feed in it, and it counts. */
    await load(seed({ events: [
      feed(y(-3, 0)), feed(y(7, 0)), feed(y(10, 0)), feed(y(13, 0)), feed(y(16, 0)), feed(t(0, 30)),
      nappy(y(8, 0), 'wet'),
    ] }));
    const s = await readCard();
    ok('a stretch running INTO yesterday counts too', /longest stretch between feeds 10h\b/.test(s.facts || ''), s);
    ok('and the feeds before midnight are still not yesterday\'s', /\b4 feeds\b/.test(s.facts || ''), s);
  }

  console.log('\n6. nothing logged yesterday prints no card at all');
  {
    // Diligent today, nothing yesterday. "0 feeds · 0 wet · 0 dirty" is a sentence about her.
    await load(seed({ events: [feed(t(2, 0)), feed(t(6, 0)), nappy(t(3, 0), 'wet')] }));
    const r = await readCard();
    ok('no card', r.present === false, r);
    const zeros = await page.evaluate(() => {
      const el = document.querySelector('#scroll');
      return el ? /0 feeds|0 wet|0 dirty/.test(el.innerText) : null;
    });
    ok('and no zero row anywhere on the Log surface', zeros === false, zeros);
    /* Positive control, one row apart. Without it "no card" passes on any build where the card was
       never written, and this whole section grades nothing. */
    await load(seed({ events: [feed(t(2, 0)), feed(t(6, 0)), nappy(t(3, 0), 'wet'), nappy(y(20, 0), 'wet')] }));
    const c = await readCard();
    ok('one nappy yesterday and the card is back', c.present === true, c);
    ok('stating the one thing it knows', /\b1 nappy \(1 wet, 0 dirty\)/.test(c.facts || ''), c);
  }

  console.log('\n7. only a nap yesterday is also nothing to state');
  {
    await load(seed({ events: [
      { id: 's1', type: 'sleep', babyId: 'b1', time: y(13, 0), end: y(15, 0), authorId: 'local' },
      feed(t(2, 0)),
    ] }));
    const r = await readCard();
    ok('no card off a nap alone', r.present === false, r);
    // Positive control: the same nap, plus one feed, and the card appears.
    await load(seed({ events: [
      { id: 's1', type: 'sleep', babyId: 'b1', time: y(13, 0), end: y(15, 0), authorId: 'local' },
      feed(y(13, 30)), feed(t(2, 0)),
    ] }));
    const c = await readCard();
    ok('a nap plus one feed does get a card', c.present === true, c);
  }

  console.log('\n8. it leaves at three weeks, and not a day early');
  {
    await load(seed({ events: FULL_DAY(), babies: [babe(20)] }));
    const a = await readCard();
    ok('at twenty days old the card is there', a.present === true, a);
    ok('still with the facts', /9 feeds/.test(a.facts || '') && /longest stretch/.test(a.facts || ''), a);

    await load(seed({ events: FULL_DAY(), babies: [babe(21)] }));
    const b = await readCard();
    ok('at twenty-one days it is gone', b.present === false, b);

    await load(seed({ events: FULL_DAY(), babies: [babe(200)] }));
    const c = await readCard();
    ok('and a six-month-old never sees it', c.present === false, c);
  }

  console.log('\n9. a baby born yesterday, and a baby born today');
  {
    // Born 18:00 yesterday: the day is real but partial, and the card has to say so or the counts
    // read as a whole day's worth.
    await load(seed({
      babies: [babe(0, { birth: y(18, 0) })],
      events: [feed(y(19, 0)), feed(y(22, 30)), feed(t(3, 0)), nappy(y(20, 0), 'wet')],
    }));
    const a = await readCard();
    ok('day one has a card', a.present === true, a);
    ok('two feeds, not a whole day of them', /\b2 feeds\b/.test(a.facts || ''), a);
    /* On the heading, beside the day it qualifies. On the sub it read as "this is the record since
       she was born", when what it means is "yesterday only started when she was born". */
    ok('the heading says the day started at birth', /from birth/i.test(a.head || ''), a);
    ok('and the sub is left clean', a.present === true && !/from birth/i.test(a.sub || ''), a);

    // Born 02:00 TODAY. Yesterday is before this baby existed; a row filed there is a mistake and
    // must not be handed back as a fact about her.
    await load(seed({
      babies: [babe(0, { birth: t(2, 0) })],
      events: [feed(t(3, 0)), feed(t(6, 0)), nappy(y(23, 0), 'wet')],
    }));
    const b = await readCard();
    ok('a baby born today gets no yesterday', b.present === false, b);
  }

  console.log('\n10. another baby in the same family is another baby');
  {
    const mine = [feed(y(9, 0)), feed(y(13, 0)), feed(t(1, 0)), nappy(y(10, 0), 'wet')];
    const theirs = [
      Object.assign(feed(y(8, 0)), { babyId: 'b2' }),
      Object.assign(feed(y(11, 0)), { babyId: 'b2' }),
      Object.assign(nappy(y(12, 0), 'dirty'), { babyId: 'b2' }),
    ];
    await load(seed({
      babies: [babe(10), babe(10, { id: 'b2', name: 'Wren', sex: 'M' })],
      events: mine.concat(theirs),
    }));
    const r = await readCard();
    ok('two feeds, hers alone', /\b2 feeds\b/.test(r.facts || ''), r);
    ok('one wet, hers alone', /\b1 wet\b/.test(r.facts || ''), r);
    ok('and no dirty borrowed from her brother', /\b0 dirty\b/.test(r.facts || ''), r);
    /* Counts alone are not enough with two babies in the house. An unlabelled card is unreadable
       exactly where it matters most, and multiples are the peak population for a newborn card.
       openFeedCorrect already names the baby when there is more than one; so does this. */
    ok('the card names which baby it is about', /for Robin/.test(r.sub || ''), r);
    ok('and does not name the other one', r.present === true && !/Wren/.test([r.head, r.facts, r.sub].join(' ')), r);
  }

  console.log('\n11. a deleted row stops counting, and today never lands on yesterday');
  {
    await load(seed({ events: FULL_DAY() }));
    const before = await readCard();
    ok('nine to start with', /\b9 feeds\b/.test(before.facts || ''), before);
    const after = await page.evaluate(() => {
      // She takes back a double-tap from yesterday the way the app does it, then the card repaints.
      const f = state.events.filter((e) => e.type === 'feed' && !e.deleted);
      f[0].deleted = true; persist(); render(); go('log'); setLogTab('log');
      const el = document.querySelector('.yest-card');
      return el ? el.querySelector('.yc-f').textContent.replace(/\s+/g, ' ').trim() : null;
    });
    ok('the deleted feed is gone from the count', /\b8 feeds\b/.test(after || ''), after);
    const later = await page.evaluate(() => {
      saveDiaper('wet'); go('log'); setLogTab('log');
      const el = document.querySelector('.yest-card');
      return { facts: el ? el.querySelector('.yc-f').textContent.replace(/\s+/g, ' ').trim() : null,
        wetToday: state.events.filter((e) => e.type === 'diaper' && !e.deleted && e.time >= Date.now() - 60000).length };
    });
    /* One assertion, not two: "saveDiaper wrote a row" on its own is pre-existing app behaviour and
       passes on a build with no card at all. What this gate is entitled to hold is that a row
       written NOW did not land on yesterday, which needs both halves to be true at once. */
    ok('a nappy written just now does not move yesterday', later.wetToday === 1 && /\b7 wet\b/.test(later.facts || ''), later);
  }

  console.log('\n12. it survives a reload, because a midwife visit is not one session');
  {
    await load(seed({ events: FULL_DAY() }));
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 40000 });
    await sleep(1600);
    const r = await readCard();
    ok('same card after a reload', r.present === true && /\b9 feeds\b/.test(r.facts || ''), r);
  }

  console.log('\n13. visitSummary carries the same block while the baby is under a month');
  {
    await load(seed({ events: FULL_DAY() }));
    const r = await page.evaluate(() => {
      const txt = visitSummary(7);
      const lines = txt.split('\n');
      return { txt: txt, i: lines.findIndex((l) => /^Yesterday \(/.test(l)),
        f: lines.findIndex((l) => /^Feeds:/.test(l)), line: (lines.find((l) => /^Yesterday \(/.test(l)) || null) };
    });
    ok('the summary states yesterday', r.i >= 0, r.txt.slice(0, 400));
    ok('with the same facts', /9 feeds · 8 nappies \(7 wet, 3 dirty\) · longest stretch between feeds 4h 10m/.test(r.line || ''), r.line);
    ok('above the fortnight totals it would otherwise be averaged into', r.i >= 0 && r.f > r.i, { i: r.i, f: r.f });

    await load(seed({ events: FULL_DAY(), babies: [babe(31)] }));
    const old = await page.evaluate(() => visitSummary(14));
    ok('at thirty-one days the block is gone from the summary', !/^Yesterday \(/m.test(old), old.slice(0, 300));
    ok('and the summary still prints its own totals', /^Feeds:/m.test(old), old.slice(0, 300));

    /* The card leaves at three weeks but the summary keeps it to a month, which is the whole point:
       the discharge visit and the six-week check still ask about yesterday. */
    await load(seed({ events: FULL_DAY(), babies: [babe(25)] }));
    const mid = await readCard();
    const midTxt = await page.evaluate(() => visitSummary(7));
    ok('at twenty-five days: no card', mid.present === false, mid);
    ok('at twenty-five days: still in the summary', /^Yesterday \(/m.test(midTxt), midTxt.slice(0, 300));
  }

  console.log('\n14. the summary never contradicts itself on an empty window');
  {
    await load(seed({ events: [] }));
    const r = await page.evaluate(() => visitSummary(7));
    ok('nothing logged: no yesterday line', !/^Yesterday \(/m.test(r), r.slice(0, 200));
    ok('and the honest sentence is still there', /nothing to summarise/.test(r), r.slice(0, 300));
  }

  console.log('\n15. a hole in the record before yesterday is not yesterday\'s longest stretch');
  {
    /* The whole of an ordinary yesterday, plus ONE feed row two and a half days before it, which is
       what a household with a 282-hour median time to first log actually looks like. The stretch
       from that row to yesterday's first feed is 64 hours. Yesterday is unchanged: all nine feeds
       are still there and the honest answer is still the 22:00 to 02:10 overnight.
       Printing 64h reports the hole, under a heading that says Yesterday, on the card she reads out
       to a midwife holding a twelve-day-old. */
    await load(seed({ events: FULL_DAY().concat([feed(y(-63, 0))]) }));
    const r = await readCard();
    ok('yesterday still counts nine feeds', /\b9 feeds\b/.test(r.facts || ''), r);
    ok('and the stretch is still the 4h 10m overnight', /longest stretch between feeds 4h 10m/.test(r.facts || ''), r);
    ok('the 64h hole is not reported as a stretch', r.present === true && !/\b64h|\b63h|\b65h/.test(r.facts || ''), r);
    ok('nothing longer than the day itself is printed', r.present === true && !/\b(2[5-9]|[3-9]\d|\d{3})h\b/.test(r.facts || ''), r);
    const line = await page.evaluate(() => (visitSummary(14).split('\n').find((l) => /^Yesterday \(/.test(l)) || null));
    ok('and the clinical page does not carry it either', /4h 10m/.test(line || '') && !/64h/.test(line || ''), line);
  }

  console.log('\n16. a day with no feed rows says so, instead of printing "0 feeds"');
  {
    /* Last feed written down two days ago, two nappies written down yesterday, feeding again today.
       "0 feeds" beside a 46h number is the signature of a starving newborn, and it is an artefact of
       which button got pressed. Note that a day with no feed row in it can never have a stretch
       shorter than the day, so no stretch is printed here at all. */
    await load(seed({ events: [
      feed(y(-24, 0)), nappy(y(9, 0), 'wet'), nappy(y(15, 0), 'wet'), feed(t(7, 0)),
    ] }));
    const r = await readCard();
    ok('the card is there, because two nappies were written down', r.present === true, r);
    ok('the nappies are stated', /\b2 nappies \(2 wet, 0 dirty\)/.test(r.facts || ''), r);
    ok('"0 feeds" is not printed', r.present === true && !/0 feed/.test(r.facts || ''), r);
    ok('and no stretch is invented from the hole', r.present === true && !/longest|46h|55h/.test(r.facts || ''), r);
    ok('the card says which kind of row is missing', /no feeds were logged/i.test(r.sub || ''), r);
    const line = await page.evaluate(() => (visitSummary(14).split('\n').find((l) => /^Yesterday \(/.test(l)) || null));
    ok('the clinical page prints no "0 feeds" either', line && !/0 feed/.test(line), line);
    ok('and carries the same caveat', /\(no feeds logged\)/.test(line || ''), line);

    /* The shorter hole from the same family: six hours before midnight, one wet and one dirty. */
    await load(seed({ events: [
      feed(y(-6, 0)), nappy(y(10, 0), 'wet'), nappy(y(14, 0), 'dirty'), feed(t(7, 0)),
    ] }));
    const f = await readCard();
    ok('a 37h hole prints no feed count', f.present === true && !/0 feed/.test(f.facts || ''), f);
    ok('and no 37h stretch', f.present === true && !/37h|longest/.test(f.facts || ''), f);
    ok('just the nappies that were written down', /\b2 nappies \(1 wet, 1 dirty\)/.test(f.facts || ''), f);
  }

  console.log('\n17. a day with no nappy rows says so, instead of printing "0 wet · 0 dirty"');
  {
    /* The other half of the same fault. "0 wet" for a twelve-day-old is the dehydration flag. */
    await load(seed({ events: FULL_DAY().filter((e) => e.type !== 'diaper') }));
    const r = await readCard();
    ok('the feeds are stated', /\b9 feeds\b/.test(r.facts || ''), r);
    ok('and the stretch with them', /longest stretch between feeds 4h 10m/.test(r.facts || ''), r);
    ok('"0 wet" is not printed', r.present === true && !/0 wet/.test(r.facts || ''), r);
    ok('"0 dirty" is not printed', r.present === true && !/0 dirty/.test(r.facts || ''), r);
    ok('the card says the nappies were never written', /no nappies were logged/i.test(r.sub || ''), r);
    const line = await page.evaluate(() => (visitSummary(14).split('\n').find((l) => /^Yesterday \(/.test(l)) || null));
    ok('the clinical page prints no "0 wet" either', line && !/0 wet/.test(line), line);
    ok('and carries the same caveat', /\(no nappies logged\)/.test(line || ''), line);

    /* A zero she DID observe still prints: nappies were logged, none of them were dirty. That is a
       fact about the baby rather than about the typing, and dropping it would lose it. */
    await load(seed({ events: [feed(y(9, 0)), feed(y(13, 0)), feed(t(1, 0)), nappy(y(10, 0), 'wet'), nappy(y(16, 0), 'wet')] }));
    const z = await readCard();
    ok('an observed zero survives', /\b2 nappies \(2 wet, 0 dirty\)/.test(z.facts || ''), z);
    ok('and no missing-row caveat is bolted on', z.present === true && !/were logged/i.test(z.sub || ''), z);
  }

  console.log('\n18. a top-up logged inside a long feed invents no stretch');
  {
    /* 10:00 for three hours, a short top-up at 11:00 while it is still running, next feed at 14:00.
       Reading only the row before drops the anchor back to 11:00 and reports 3h. She was being fed
       until 13:00, so the honest answer is 1h, and 3h on a clinical page is a stretch that never
       happened. */
    await load(seed({ events: [
      feed(y(10, 0), { dur: 3 * HOUR }), feed(y(11, 0)), feed(y(14, 0)), nappy(y(12, 0), 'wet'),
    ] }));
    const r = await readCard();
    ok('the stretch is 1h, from the end of the long feed', /longest stretch between feeds 1h\b/.test(r.facts || ''), r);
    ok('not the 3h back to the enclosed top-up', r.present === true && !/\b3h\b/.test(r.facts || ''), r);
    ok('and all three feeds are still counted', /\b3 feeds\b/.test(r.facts || ''), r);
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'YESTERDAY-CARD: FAIL' : 'YESTERDAY-CARD: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
