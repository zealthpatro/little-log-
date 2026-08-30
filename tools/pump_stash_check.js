#!/usr/bin/env node
/* THE PUMP STASH, DECIDED.
 *
 * What was concretely wrong for a real mother: Cubby's teaching layer promised her a stash in three
 * places. "Your stash lives in one place." "Anyone in your circle can see the stash without asking
 * you for a number." "The person doing the night feed knows what is there, and you did not have to
 * tell them." There was no stash. Pump appeared in the timeline and nowhere else: not in the day
 * recap she shares with whoever is away, not in the doctor summary she reads out in a room, not in
 * the week at a glance. So the one log that costs the most effort was the one that vanished from the
 * day the moment it was done, and the app was calling that a feature.
 *
 * The decision was NOT to build a running balance. Cubby has never seen the freezer, so a balance
 * would start wrong for every mother who already has milk; content:'breastmilk' on a bottle does not
 * mean the milk came from a session Cubby holds, so the debit side is a guess that drifts one way
 * per household and eventually goes negative; and a number that falls every time the baby eats is a
 * fuel gauge whether or not anybody draws a target line under it. The full reasoning is written
 * above openPump in app/index.html.
 *
 * So this gate holds two things at once:
 *   1. The promises that outran the app are GONE from the shipped copy, and the honest ones are
 *      there in their place.
 *   2. Expressing is now visible where every other log is: the day recap, the doctor summary, and
 *      the week at a glance, in her own unit, correct across a unit change, a day boundary, another
 *      baby's events, a deleted entry, a second save and a reload.
 *   3. And it stays a record, never a balance: logging a bottle of breast milk must not move the
 *      number down. That is the assertion that goes red the day somebody wires up a debit.
 *
 *   PORT=9744 node tools/serve.js &
 *   node tools/pump_stash_check.js http://localhost:9744
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:9744';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, HOUR = 3600000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

/* Pinned to 13:00 today, so "yesterday" and "eight days ago" are unambiguous and the day-boundary
   cases below cannot flake by being run at ten past midnight. */
const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

const seed = (over) => Object.assign({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 90 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
  activeBabyId: 'b1', events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
}, over || {});

const pump = (id, tOffset, amount, unit, baby) => ({ id: id, type: 'pump', babyId: baby || 'b1', amount: amount, unit: unit || 'ml', side: 'both', time: now - tOffset });

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  /* The shift is a live window global rather than a closed-over constant, so a section can let three
     hours pass without reloading or relogging anything. §8b needs exactly that: the bug it pins is a
     total that changes with the wall clock while the log and the calendar day both stand still.
     Reset to OFFSET on every navigation, so the shift never leaks out of the section that set it. */
  await page.evaluateOnNewDocument((shift) => {
    window.__clockShift = shift;
    const R = Date;
    function D(...a) { return a.length === 0 ? new R(R.now() + window.__clockShift) : new R(...a); }
    D.prototype = R.prototype; D.now = () => R.now() + window.__clockShift; D.parse = R.parse; D.UTC = R.UTC;
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
  /* Pull the two copy files back over the SAME origin the app was served from, so this grades the
     tree that is actually running rather than whatever happens to be on disk beside the gate. */
  const fetchText = (path) => page.evaluate((p) => fetch(p, { cache: 'no-store' }).then((r) => r.text()), path);
  /* Every call into a pump helper goes through this. Against a tree where the helpers do not exist
     the bare call throws a ReferenceError inside page.evaluate, which kills the run at the third
     section and hides how much is actually red. A gate has to be able to report its own full
     failure, so a missing helper reads as the sentinel 'MISSING' and fails its assertion like any
     other wrong answer. */
  const PROBE = `function _try(f){ try { return f(); } catch (e) { return 'MISSING:' + (e && e.name); } }`;

  console.log('\n1. the promises that outran the app are gone, and honest ones stand in their place');
  {
    const guide = await fetchText('/app/log-guide.js');
    const teach = await fetchText('/app/teach-data.js');
    ok('log-guide.js no longer promises a stash', guide.indexOf('stash') === -1,
      guide.split('\n').filter((l) => l.indexOf('stash') !== -1).slice(0, 3));
    /* teach-data.js still has to SAY something about pumping, so an absence check on its own would
       pass just as well if somebody deleted the whole entry. Both halves are asserted. */
    ok('teach-data.js no longer promises a stash', teach.indexOf('stash') === -1,
      teach.split('\n').filter((l) => l.indexOf('stash') !== -1).slice(0, 3));
    ok('the pump guide row is still there and still says what it does',
      guide.indexOf("Your own rhythm, in one place") !== -1 && guide.indexOf('How much you expressed, which side, and when.') !== -1);
    ok('and the honest lines stand in their place',
      teach.indexOf('Every session in one place') !== -1 && teach.indexOf('with nothing added to it') !== -1);
    /* The teaching copy must not name the freezer EITHER. Pre-empting a balance by naming the number
       Cubby does not have introduces the comparison the whole decision exists to avoid, to the one
       reader whose supply is the thing she is most frightened of. The engine's own reasoning above
       openPump may say "freezer" as often as it likes; no string she reads may. */
    ok('and no copy she reads names a freezer', teach.indexOf('freezer') === -1 && guide.indexOf('freezer') === -1,
      (teach + guide).split('\n').filter((l) => l.indexOf('freezer') !== -1).slice(0, 3));
    ok('the no-target promise survived the rewrite', teach.indexOf('There is no target here') !== -1);
    /* Nowhere in the shipped app may there be a "left" / "remaining" number attached to milk. This
       is the guard against a later well-meant half-build. */
    const shell = await fetchText('/app/index.html');
    ok('the shell actually came back over the wire', shell.length > 500000, shell.length);
    const balanceWords = (shell.match(/milk (left|remaining)|stash balance|remaining in the freezer/gi) || []);
    ok('no shipped copy talks about milk left or remaining', balanceWords.length === 0, balanceWords);
  }

  console.log('\n2. the day recap carries what she expressed');
  {
    await load(seed({ events: [
      pump('p1', 2 * HOUR, 80), pump('p2', 5 * HOUR, 60), pump('p3', 9 * HOUR, 40),
      { id: 'f1', type: 'feed', babyId: 'b1', method: 'bottle', content: 'breastmilk', amount: 120, unit: 'ml', time: now - 3 * HOUR },
    ] }));
    const r = await page.evaluate(() => {
      const t = dayRecapText();
      return { line: (t.split('\n').find((l) => l.indexOf('Expressed') === 0) || null), all: t };
    });
    /* Stated outright, because the section below reports a missing helper as the string 'MISSING' so
       the run can finish. Without this, "the helpers exist" is only ever implied by other answers. */
    const defined = await page.evaluate(() => ['pumpSummary', 'pumpStatCard', 'fmtPumpAmount'].filter((n) => typeof window[n] !== 'function'));
    ok('the pump helpers are actually on the page', defined.length === 0, defined);
    ok('the recap has an Expressed line at all', r.line !== null, r.all);
    ok('with the session count and the total, in her unit', r.line === 'Expressed: 3 sessions (180 ml)', r.line);
    ok('and it sits with the milk lines, above sleep',
      r.all.indexOf('Expressed:') > r.all.indexOf('Feeds:') && r.all.indexOf('Expressed:') < r.all.indexOf('Sleep:'), r.all);
    /* The bottle of breast milk in this seed is deliberate. If a debit is ever wired in, 180 above
       becomes 60 and this test is the one that says so. */
    ok('a bottle of breast milk did not subtract from it', /180 ml/.test(r.line || ''), r.line);
  }

  console.log('\n3. a household that does not pump never reads a zero');
  {
    await load(seed({ events: [
      { id: 'f1', type: 'feed', babyId: 'b1', method: 'breast', side: 'left', dur: 18 * 60000, time: now - 2 * HOUR },
      { id: 'd1', type: 'diaper', babyId: 'b1', kind: 'wet', time: now - HOUR },
    ] }));
    const r = await page.evaluate(`(function(){ ${PROBE}
      return { recap: dayRecapText(), visit: visitSummary(7), sum: _try(function(){ return pumpSummary(babyEvents()); }) }; })()`);
    ok('no Expressed line in the day recap', r.recap.indexOf('Expressed') === -1, r.recap);
    ok('no Expressed line in the visit summary', r.visit.indexOf('Expressed') === -1, r.visit);
    ok('and the recap is otherwise a real recap, not empty', /Feeds: 1/.test(r.recap) && /Nappies: 1/.test(r.recap), r.recap);
    ok('pumpSummary says nothing rather than zero', r.sum === null, r.sum);
    const empties = await page.evaluate(`(function(){ ${PROBE}
      return { nul: _try(function(){ return pumpSummary(null); }), arr: _try(function(){ return pumpSummary([]); }), card: _try(function(){ return pumpStatCard([]); }) }; })()`);
    ok('and it survives being handed nothing at all', empties.nul === null && empties.arr === null && empties.card === '', empties);
  }

  console.log('\n4. the day boundary: yesterday is not today');
  {
    await load(seed({ events: [
      pump('p1', 1 * HOUR, 100),               // today
      pump('p2', 20 * HOUR, 90),               // yesterday evening, before the pinned 13:00
      pump('p3', 30 * HOUR, 70),               // yesterday morning
    ] }));
    const r = await page.evaluate(() => {
      const t = dayRecapText();
      return { line: t.split('\n').find((l) => l.indexOf('Expressed') === 0) || null,
        allThree: (visitSummary(7).split('\n').find((l) => l.indexOf('Expressed') === 0) || null) };
    });
    ok("today's recap counts today only", r.line === 'Expressed: 1 session (100 ml)', r.line);
    ok('and the week window counts all three', /3 sessions, 260 ml total/.test(r.allThree || ''), r.allThree);
  }

  console.log('\n5. the doctor summary: the window, the rate, and the shape of the line');
  {
    await load(seed({ events: [
      pump('p1', 1 * DAY, 100), pump('p2', 2 * DAY, 100), pump('p3', 3 * DAY, 100), pump('p4', 4 * DAY, 100),
      pump('old', 30 * DAY, 999),              // outside every window asked for below
      { id: 'f1', type: 'feed', babyId: 'b1', method: 'breast', side: 'left', dur: 15 * 60000, time: now - 6 * DAY },
    ] }));
    const r = await page.evaluate(() => {
      const t = visitSummary(7);
      const lines = t.split('\n');
      const i = lines.findIndex((l) => l.indexOf('Expressed') === 0);
      return { line: i < 0 ? null : lines[i], prev: i < 1 ? null : lines[i - 1], all: t };
    });
    ok('the Expressed line is on the page', r.line !== null, r.all);
    ok('it counts the window and not the whole log', /^Expressed: 4 sessions, 400 ml total/.test(r.line || ''), r.line);
    /* The denominator is the observed window, not the 7 days asked for: the oldest entry in range
       is the feed six days back, so 400 ml over six days is 67, not 57. Asserting the exact figure
       is the point, because a rate divided by the wrong denominator is the bug this page has been
       burned by before. */
    ok('and gives a per-day rate a clinician can read', /\(~67 ml\/day\)/.test(r.line || ''), r.line);
    /* Every one of these reads the line, so each is written to fail when there is no line at all.
       `(r.line || '').indexOf(...)` would have passed on a tree with no Expressed line whatsoever,
       which is the "nothing happened, therefore the rule fired" trap. */
    ok('it is a top-level line, not a bullet under Feeds', !!r.line && r.line.indexOf('  •') !== 0, r.line);
    ok('the 999 ml session from a month ago stayed out', !!r.line && r.line.indexOf('999') === -1, r.line);
    /* A window that is entirely outside the sessions must print no Expressed line, rather than
       "0 sessions" on the one page a mother reads out loud. */
    const two = await page.evaluate(() => visitSummary(1));
    ok('a window with no sessions prints no Expressed line', two.indexOf('Expressed') === -1, two);
  }

  console.log('\n6. mixed units add up in the unit she is thinking in now');
  {
    await load(seed({ events: [
      pump('p2', 1 * HOUR, 2, 'oz'),           // the most recent session is in oz
      pump('p1', 4 * HOUR, 60, 'ml'),
    ] }));
    const r = await page.evaluate(`(function(){ ${PROBE}
      return { line: dayRecapText().split('\\n').find(function(l){ return l.indexOf('Expressed') === 0; }) || null,
        sum: _try(function(){ return pumpSummary(babyEvents()); }) }; })()`);
    // 60 ml is 2.0288 oz, so the honest total is 4 oz, not "62" of anything.
    ok('the total is reported in the latest unit', (r.sum || {}).unit === 'oz', r.sum);
    ok('and it is converted, not concatenated', r.line === 'Expressed: 2 sessions (4 oz)', r.line);
    ok('two sessions counted, not one', (r.sum || {}).sessions === 2, r.sum);
  }
  {
    // The mirror case: the newest session is in ml, so the oz one converts up.
    await load(seed({ events: [pump('p2', 1 * HOUR, 50, 'ml'), pump('p1', 4 * HOUR, 3, 'oz')] }));
    const r = await page.evaluate(() => dayRecapText().split('\n').find((l) => l.indexOf('Expressed') === 0) || null);
    ok('and it converts the other way too', r === 'Expressed: 2 sessions (139 ml)', r);
  }

  console.log("\n7. someone else's baby, and something she deleted");
  {
    await load(seed({
      babies: [{ id: 'b1', name: 'Robin', birth: now - 90 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] },
               { id: 'b2', name: 'Wren', birth: now - 90 * DAY, sex: 'M', routines: [], doctors: [], allergies: [] }],
      events: [
        pump('p1', 2 * HOUR, 100),
        pump('p2', 3 * HOUR, 500, 'ml', 'b2'),                     // the twin's log
        Object.assign(pump('p3', 4 * HOUR, 300), { deleted: true }), // she took this one back
      ],
    }));
    const r = await page.evaluate(() => dayRecapText().split('\n').find((l) => l.indexOf('Expressed') === 0) || null);
    ok("the other baby's 500 ml is not on this baby's page", r === 'Expressed: 1 session (100 ml)', r);
    const other = await page.evaluate(() => { state.activeBabyId = 'b2'; return dayRecapText().split('\n').find((l) => l.indexOf('Expressed') === 0) || null; });
    ok('and switching to that baby shows her own', other === 'Expressed: 1 session (500 ml)', other);
  }

  console.log('\n8. the week at a glance, in the real DOM');
  {
    await load(seed({ events: [
      pump('p1', 1 * HOUR, 90), pump('p2', 1 * DAY, 90), pump('p3', 2 * DAY, 60),
      pump('old', 12 * DAY, 400),              // outside the seven days the card names
      { id: 'd1', type: 'diaper', babyId: 'b1', kind: 'wet', time: now - HOUR },
    ] }));
    const r = await page.evaluate(() => {
      view = 'log'; setLogTab('stats');
      const cards = Array.from(document.querySelectorAll('.stat-card'));
      const heads = cards.map((c) => { const h = c.querySelector('h3'); return h ? h.textContent.trim() : ''; });
      const card = cards.find((c) => { const h = c.querySelector('h3'); return h && h.textContent.trim() === 'Expressed'; });
      return { found: !!card, heads: heads,
        n: heads.filter((h) => h === 'Expressed').length,
        text: card ? card.innerText.replace(/\s+/g, ' ').trim() : null };
    });
    ok('the Expressed card is in the DOM beside the others', r.found === true, r.heads);
    /* Exactly one, and in the log block rather than adrift among the growth cards below it. The
       count of .stat-card as a whole is not the assertion: renderGrowthSection draws its own. */
    ok('exactly one Expressed card', r.n === 1, r.heads);
    ok('and it sits after the three log cards', r.heads.slice(0, 4).join(',') === 'Feeds,Sleep,Diapers,Expressed', r.heads);
    ok('it names the window it covers', /Last 7 days/.test(r.text || ''), r.text);
    ok('it states the sessions and the total', /3 sessions · 240 ml/.test(r.text || ''), r.text);
    // Same rule as above: an absent card must not satisfy an absence check.
    ok('the 400 ml from twelve days ago is not in it', !!r.text && r.text.indexOf('640') === -1, r.text);
    ok('and it says what the number is', /just what you wrote down/i.test(r.text || ''), r.text);
    ok('without naming a freezer she was never asked about', !!r.text && !/freezer|stash/i.test(r.text), r.text);
    ok('there is no target, goal or remaining anywhere on it', !!r.text && !/target|goal|remaining|left|should/i.test(r.text), r.text);

    /* THE ANTI-BALANCE ASSERTION. Log a bottle of breast milk, the one event a stash balance would
       debit, and the card must not move. This is the line that goes red if a running total is ever
       wired in behind this decision. */
    const after = await page.evaluate(() => {
      commitEvent({ type: 'feed', method: 'bottle', content: 'breastmilk', amount: 150, unit: 'ml', time: now() });
      view = 'log'; setLogTab('stats');
      const cards = Array.from(document.querySelectorAll('.stat-card'));
      const card = cards.find((c) => { const h = c.querySelector('h3'); return h && h.textContent.trim() === 'Expressed'; });
      return card ? card.innerText.replace(/\s+/g, ' ').trim() : null;
    });
    ok('a 150 ml bottle of breast milk does not debit it', /3 sessions · 240 ml/.test(after || ''), after);
    ok('and it never shows a minus sign', !!after && after.indexOf('-') === -1 && after.indexOf('−') === -1, after);
  }

  console.log('\n8b. "Last 7 days" means the seven days the bars beside it draw, at any hour');
  {
    /* The edge session is seeded at 7 days minus 2 hours: 15:00 on D-7. That is inside a rolling
       168-hour window read at 13:00 and outside the seven calendar days the three cards above this
       one are built from. Nothing in §8 ever lands in that 24-hour band, so the card's window could
       be widened by a whole day and every assertion up there still passed. */
    await load(seed({ events: [
      pump('p1', 1 * HOUR, 90), pump('p2', 1 * DAY, 90),
      pump('edge', 7 * DAY - 2 * HOUR, 400),
    ] }));
    const readCard = () => page.evaluate(() => {
      view = 'log'; setLogTab('stats');
      const card = Array.from(document.querySelectorAll('.stat-card')).find((c) => { const h = c.querySelector('h3'); return h && h.textContent.trim() === 'Expressed'; });
      return card ? card.innerText.replace(/\s+/g, ' ').trim() : null;
    });
    const at13 = await readCard();
    ok('the card is there to be read', at13 !== null, at13);
    ok('a session from the eighth calendar day back is not counted', /2 sessions · 180 ml/.test(at13 || ''), at13);
    ok('its 400 ml is nowhere on the card', !!at13 && at13.indexOf('400') === -1 && at13.indexOf('580') === -1, at13);
    /* Three hours pass. She logged nothing, edited nothing, and the calendar day did not turn. A
       total that moves here is a number drifting on its own, which is the exact failure the comment
       above openPump gives as the reason no balance was built. */
    await page.evaluate(() => { window.__clockShift += 3 * 3600000; });
    const at16 = await readCard();
    ok('and three hours later, same day, same log, it reads exactly the same', at16 === at13, { at13: at13, at16: at16 });
    await page.evaluate(() => { window.__clockShift -= 3 * 3600000; });
  }

  console.log('\n8c. the day recap is shareable, so it carries only her own sessions');
  {
    /* dayRecapText is the one surface here that leaves the device: openDayRecap subtitles it "for
       whoever's away" and its primary button calls navigator.share. Every circle member can open it.
       Expressed volume is the mother's body, not the baby's day, so it is gated to whoever logged
       it, using the ownership rule canEditEvent already states: no authorId counts as mine. */
    await load(seed({ events: [
      Object.assign(pump('p1', 2 * HOUR, 100), { authorId: 'local' }),
      pump('p2', 4 * HOUR, 60),                                            // legacy, unauthored
      Object.assign(pump('p3', 3 * HOUR, 500), { authorId: 'partner-uid' }),
    ] }));
    const r = await page.evaluate(() => {
      view = 'log'; setLogTab('stats');
      const card = Array.from(document.querySelectorAll('.stat-card')).find((c) => { const h = c.querySelector('h3'); return h && h.textContent.trim() === 'Expressed'; });
      return { recap: dayRecapText().split('\n').find((l) => l.indexOf('Expressed') === 0) || null,
        visit: visitSummary(7).split('\n').find((l) => l.indexOf('Expressed') === 0) || null,
        card: card ? card.innerText.replace(/\s+/g, ' ').trim() : null };
    });
    ok('the recap carries her own two sessions', r.recap === 'Expressed: 2 sessions (160 ml)', r.recap);
    ok("and not the 500 ml the other caregiver logged", !!r.recap && r.recap.indexOf('500') === -1 && r.recap.indexOf('660') === -1, r.recap);
    /* The gate is on the sheet that leaves the circle, and only there. Inside the circle the teaching
       copy promises "anyone in your circle can see what was expressed and when", so the week card and
       the doctor summary must still show all three. An over-broad gate goes red right here. */
    ok('the week card still shows the circle all three', /3 sessions · 660 ml/.test(r.card || ''), r.card);
    ok('and so does the doctor summary', /^Expressed: 3 sessions, 660 ml total/.test(r.visit || ''), r.visit);
    /* Read the same log as the other caregiver. If the recap line were a fixed filter rather than a
       gate on who is holding the phone, this would not move. */
    await page.evaluate(() => localStorage.setItem('cubby-quick-uid', 'partner-uid'));
    await page.reload({ waitUntil: 'networkidle2' }); await sleep(1400);
    const asOther = await page.evaluate(() => dayRecapText().split('\n').find((l) => l.indexOf('Expressed') === 0) || null);
    ok('the other caregiver gets their own, plus the unauthored one', asOther === 'Expressed: 2 sessions (560 ml)', asOther);
    ok('and her 100 ml is not in what they can forward', !!asOther && asOther.indexOf('660') === -1, asOther);
    await page.evaluate(() => localStorage.setItem('cubby-quick-uid', 'local'));
  }

  console.log('\n8d. an entry that arrived with no unit on it');
  {
    /* savePump and voice-log.js both always write a unit, so this is only reachable through imported
       or legacy data. It still has to be right: read as ml in an oz household, a 3 oz session was
       divided by 29.57 and printed as "0.1 oz". */
    const s = seed({ events: [{ id: 'p1', type: 'pump', babyId: 'b1', amount: 3, side: 'both', time: now - 2 * HOUR }] });
    s.settings.unit = 'oz';
    await load(s);
    const r = await page.evaluate(() => dayRecapText().split('\n').find((l) => l.indexOf('Expressed') === 0) || null);
    ok('it reads in the unit the household thinks in', r === 'Expressed: 1 session (3 oz)', r);
    ok('and is not divided down to a tenth of an ounce', !!r && r.indexOf('0.1') === -1, r);
  }

  console.log('\n9. a household that never pumps has no Expressed card');
  {
    await load(seed({ events: [{ id: 'd1', type: 'diaper', babyId: 'b1', kind: 'wet', time: now - HOUR }] }));
    const r = await page.evaluate(() => {
      view = 'log'; setLogTab('stats');
      const cards = Array.from(document.querySelectorAll('.stat-card'));
      return { heads: cards.map((c) => { const h = c.querySelector('h3'); return h ? h.textContent.trim() : ''; }) };
    });
    ok('no Expressed card at all', r.heads.indexOf('Expressed') === -1, r.heads);
    ok('and the three that belong are still drawn', r.heads.slice(0, 3).join(',') === 'Feeds,Sleep,Diapers', r.heads);
  }

  console.log('\n10. a second save, and a reload');
  {
    await load(seed({ events: [pump('p1', 2 * HOUR, 80)] }));
    const before = await page.evaluate(() => dayRecapText().split('\n').find((l) => l.indexOf('Expressed') === 0));
    ok('one session to start with', before === 'Expressed: 1 session (80 ml)', before);
    const after = await page.evaluate(() => {
      openPump(); pumpDraft.amount = 70; pumpDraft.unit = 'ml'; savePump();
      return { line: dayRecapText().split('\n').find((l) => l.indexOf('Expressed') === 0),
        n: state.events.filter((e) => e.type === 'pump').length };
    });
    ok('saving a pump adds exactly one session', after.n === 2, after);
    ok('and the recap grows by that amount, not by a guess', after.line === 'Expressed: 2 sessions (150 ml)', after.line);
    await page.reload({ waitUntil: 'networkidle2' }); await sleep(1400);
    const kept = await page.evaluate(() => dayRecapText().split('\n').find((l) => l.indexOf('Expressed') === 0));
    ok('and it is still there after a reload', kept === 'Expressed: 2 sessions (150 ml)', kept);
  }

  console.log('\n11. the pregnancy stage, where there is no baby to pump for');
  {
    await load(seed({ babies: [], activeBabyId: null,
      pregnancy: { id: 'p1', stage: 'expecting', dueDate: new Date(now + 100 * DAY).toISOString().slice(0, 10), moments: [], appts: [] } }));
    const r = await page.evaluate(() => {
      let threw = null;
      try { pumpSummary([]); pumpStatCard([]); dayRecapText(); } catch (e) { threw = String(e.message || e); }
      return { threw, view: view };
    });
    ok('nothing throws with no baby on screen', r.threw === null, r.threw);
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'PUMP STASH: FAIL' : 'PUMP STASH: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
