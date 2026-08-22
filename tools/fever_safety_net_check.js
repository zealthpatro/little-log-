#!/usr/bin/env node
/* The fever sheet used to answer "when do I call?" with care advice and a made-up clock.
 *
 * Every parent who logged 38.6 saw the same second sentence: "Keep them comfortable and hydrated.
 * Reach out to your doctor if the fever is high, lasts more than a day or two, or they just seem
 * unwell." Three things wrong with that at three in the morning.
 *
 *   CARE ADVICE. Cubby does not tell anyone how to care for a sick child. "Comfortable and
 *   hydrated" is the one line in the baby stage that did.
 *
 *   CIRCULAR. "If the fever is high" is printed on a sheet that only opens because the reading is
 *   already at or above the fever line. It answers the question with the question.
 *
 *   AN INVENTED DURATION. "A day or two" is a clinical waiting time with no source behind it, on a
 *   product where every other clinical number cites one, and where openTemp's own teaching row
 *   promises guidance "comes from published sources and is never Cubby telling you what is
 *   happening to your child". A parent whose baby has a non-fading rash on hour six was being told,
 *   in Cubby's calm voice, that a day or two is the shape of this.
 *
 * What replaces it is a safety net rather than a clock: the things that would mean calling sooner,
 * in plain words, every one of them from the NHS page the sheet links to, with that page's own
 * five days as the only duration on it.
 *
 * This gate opens the real sheets, clicks the real buttons and reads the real DOM. It never reads
 * document.body.textContent: the inline script's own source lives there and would match every
 * banned phrase in this file, passing a check on the strings it is meant to catch.
 *
 *   PORT=9268 node tools/serve.js &
 *   node tools/fever_safety_net_check.js http://localhost:9268
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/* No default. A bare `node tools/fever_safety_net_check.js` used to fall through to :8080-ish and
   quietly grade whichever checkout happened to be serving there, which has already produced one
   green report against a tree that did not contain this change at all. */
const BASE = process.argv[2];
if (!BASE) { console.error('usage: node tools/fever_safety_net_check.js http://localhost:<port>\n(no default: an implicit port grades whichever checkout is serving there)'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, HOUR = 3600000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

// 03:00. The hour this sheet is written for, and pinned so the gate reads the same at any hour.
const CLOCK = (() => { const d = new Date(); d.setHours(3, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

const seed = (over) => Object.assign({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 180 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
  activeBabyId: 'b1', events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
}, over || {});

/* The exact copy this whole item exists to remove, plus the shapes it could come back as. Care
   advice and an unsourced waiting time are the two failure modes, so both are patterns rather than
   one literal string: "48 hours" would be the same mistake in different words. */
const BANNED = [
  [/comfortable and hydrated/i, 'care advice (comfortable and hydrated)'],
  [/hydrat/i, 'care advice (hydration)'],
  [/paracetamol|ibuprofen|calpol|sponge|tepid/i, 'care advice (treatment)'],
  [/if the fever is high/i, 'the circular clause'],
  /* Spelled-out numbers too. The digit-only version passed "two days" and "three days", so the
     exact mistake this item exists to delete could come back in words and still score 65/65.
     "five days" is the one allowed duration and it is checked for by name below, not here. */
  [/a day or two|a couple of days|\b\d+\s*(?:hours?|days?)\b|\b(?:one|two|three|four|six|seven|ten|twelve|twenty-four|forty-eight)\s+(?:hours?|days?)\b/i, 'a duration Cubby invented'],
];

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

  // Only ever the sheet element. #sheet is the one subtree that cannot contain the page's own
  // source, which is what makes these assertions mean anything.
  const sheet = () => page.evaluate(() => {
    const s = document.getElementById('sheet');
    const h2 = s.querySelector('h2');
    let title = '';
    if (h2) h2.childNodes.forEach((n) => { if (n.nodeType === 3) title += n.textContent; });
    return {
      shown: s.classList.contains('show'),
      title: title.trim(),
      text: (s.innerText || '').replace(/\s+/g, ' ').trim(),
      rows: [...s.querySelectorAll('.danger-row .dr-t')].map((e) => e.textContent.trim()),
      /* Every direct div child that is not a row, a sub or the disclaimer is a group heading.
         Without this a template that dropped the two heads and rendered eleven undifferentiated
         signs — losing "now" versus "today", the clinical point of the list — passed every check. */
      heads: [...s.querySelectorAll('div')].filter((e) => e.parentElement === s && !e.className && e.children.length === 0).map((e) => e.textContent.trim()).filter(Boolean),
      // Computed, not authored: the two groups must not read as one wall of the same emergency red.
      dots: [...s.querySelectorAll('.danger-row .dr-dot')].map((e) => getComputedStyle(e).color),
      buttons: [...s.querySelectorAll('button')].map((b) => b.textContent.trim()),
      links: [...s.querySelectorAll('a[href]')].map((a) => ({ href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') })),
      back: !!s.querySelector('.sheet-back'),
    };
  });
  const clickText = (re) => page.evaluate((src) => {
    const r = new RegExp(src, 'i');
    const b = [...document.querySelectorAll('#sheet button')].find((x) => r.test(x.textContent));
    if (!b) return false;
    b.click(); return true;
  }, re.source);
  /* Reports whether the arrow was there AND clicked. The old inline `if (b) b.click()` meant a tree
     with no back arrow left the fever sheet on screen, so the next assertion — "back returns to the
     fever" — passed precisely because nothing had happened. Two of those free passes were measured
     on a tree with no safety net at all. */
  const clickBack = () => page.evaluate(() => { const b = document.querySelector('#sheet .sheet-back'); if (!b) return false; b.click(); return true; });
  // A real fever, logged the way a parent logs one: the sheet, the field, the button.
  const logTemp = async (v) => {
    await page.evaluate(() => openTemp());
    await sleep(250);
    await page.evaluate((val) => { const i = document.getElementById('tVal'); if (i) { i.value = String(val); i.dispatchEvent(new Event('input', { bubbles: true })); } }, v);
    await page.evaluate(() => { const b = [...document.querySelectorAll('#sheet button')].find((x) => /log temperature/i.test(x.textContent)); if (b) b.click(); });
    await sleep(400);
  };

  console.log('\n1. the fever sheet no longer gives care advice or a waiting time');
  {
    await load(seed());
    await logTemp(38.6);
    const s = await sheet();
    ok('logging 38.6 opens the fever sheet', s.shown && /fever/i.test(s.title), s);
    ok('it still names the line it crossed', /38\.6.*fever line/i.test(s.text), s.text);
    BANNED.forEach(([re, what]) => ok('the fever sheet is free of ' + what, !re.test(s.text), s.text));
    ok('and it says what does matter instead', /does not say when to call/i.test(s.text), s.text);
    ok('the disclaimer survived the rewrite', /n.t medical advice/i.test(s.text), s.text);
  }

  console.log('\n2. the safety net is one tap from the fever, and comes back');
  {
    const clicked = await clickText(/call sooner/);
    ok('the fever sheet offers the way to it', clicked === true);
    await sleep(300);
    const s = await sheet();
    ok('it opens a sheet of its own', s.shown && s.title === 'When to call sooner', s);
    ok('with a back arrow, so the fever sheet is not lost', s.back === true, s);
    /* Eleven signs, counted. `rows.every(...)` on an empty list is true, and an empty list is exactly
       what a broken template renders, so the count is the assertion and every() is the detail. */
    ok('it renders eleven signs', s.rows.length === 11, s.rows);
    ok('and every one of them has words in it', s.rows.length === 11 && s.rows.every((t) => t.length > 12), s.rows);
    ok('the emergency signs are there in plain words',
      /glass against it/i.test(s.text) && /fit, also called a seizure/i.test(s.text) && /floppy/i.test(s.text), s.text);
    ok('so are the ones that mean a call today',
      /wet nappies/i.test(s.text) && /not wanting to feed/i.test(s.text) && /not themself/i.test(s.text), s.text);
    ok('it names calling, not waiting', /call/i.test(s.text) && !/wait and see|no need to/i.test(s.text), s.text);
    ok('and it hands the last word back to her', /something feels wrong to you/i.test(s.text), s.text);

    /* THE TWO GROUPS, WHICH ARE THE LIST'S ONLY CLINICAL CONTENT.
       Eleven signs in one undifferentiated block does not tell a parent which of them means ring
       now and which means ring in the morning, and that distinction is the reason to have a list
       at all rather than a paragraph. Heads and dot colour are both asserted, because either one
       alone can be dropped and leave the other looking fine. */
    ok('the list is split into now and today', s.heads.length === 2, s.heads);
    ok('the first group says call straight away', /straight away/i.test(s.heads[0] || ''), s.heads);
    ok('the second says a call to your doctor today', /doctor today/i.test(s.heads[1] || ''), s.heads);
    /* "if you see" demanded a visible object, and five of the eleven are states: "if you see hard to
       wake" breaks in the mouth of someone reading them as a checklist. */
    ok('and both take states as well as sights', s.heads.length === 2 && s.heads.every((h) => /if you notice/i.test(h)) && !/if you see/i.test(s.text), s.heads);
    ok('eleven dots, one per sign', s.dots.length === 11, s.dots);
    ok('the six urgent signs share one colour', new Set(s.dots.slice(0, 6)).size === 1, s.dots);
    ok('the five that mean today are visibly calmer', new Set(s.dots).size === 2 && s.dots[6] !== s.dots[0], s.dots);

    const had = await clickBack();
    ok('the back arrow is really there to click', had === true);
    await sleep(250);
    const b = await sheet();
    ok('back returns to the fever, not to nothing', had === true && b.shown && /fever/i.test(b.title), b);
  }

  console.log('\n3. the one duration on it is the source\'s, and the source is linked');
  {
    const reopened = await clickText(/call sooner/);
    ok('the safety net reopens from the fever sheet', reopened === true);
    await sleep(300);
    const s = await sheet();
    ok('and it is the safety net being read, not the fever sheet again', s.title === 'When to call sooner', s.title);
    ok('five days is on the list', /five days/i.test(s.text), s.text);
    // Written as a word on purpose: any digit-and-unit here would be a number with no page behind it.
    BANNED.forEach(([re, what]) => ok('the safety net is free of ' + what, !re.test(s.text), s.text));
    ok('the sheet names whose list this is, not just links it', /NHS/.test(s.text), s.text);
    const src = s.links.filter((l) => /^https:\/\/www\.nhs\.uk\//.test(l.href));
    ok('exactly one source link, and it is the NHS', src.length === 1, s.links);
    /* The canonical path, not the one that 301s to it. This gate never fetches the URL on purpose:
       a check that needs the network is a check that goes red on a train, and a red gate nobody
       believes is worse than no gate. What it can prove offline is that the href is the page the
       code comment claims, so a silent edit back to /conditions/ is caught. */
    ok('and it is the page itself, not the redirect', src.length === 1 && /^https:\/\/www\.nhs\.uk\/symptoms\/fever-in-children\/$/.test(src[0].href), s.links);
    ok('it opens away from the app', src.length === 1 && src[0].target === '_blank', s.links);
    ok('and it cannot reach back into it', src.length === 1 && /noopener/.test(src[0].rel || ''), s.links);
    ok('the sheet says the list is not a diagnosis', /Nothing here is a diagnosis/i.test(s.text), s.text);
    /* The footer credits the source and then gets out of the way. It used to argue Cubby's
       editorial position — "so the five days is theirs and not ours" — inside a sheet a frightened
       parent is reading at 3am, which is the product defending itself instead of helping her. */
    ok('the footer credits the source without arguing its case', /From the NHS page on fever in children\./.test(s.text) && !/theirs and not ours/i.test(s.text), s.text);
    // No UK-only institution in the reassurance: this app also ships to India and the US.
    ok('and the reassuring line names no country\'s health service', !/\bnurse\b|\bNHS 111\b|\b111\b/i.test(s.text), s.text);
  }

  console.log('\n4. a newborn is never handed a list that reads as permission to wait');
  {
    await load(seed({ babies: [{ id: 'b1', name: 'Wren', birth: now - 45 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }] }));
    await logTemp(38.2);
    const f = await sheet();
    ok('under 3 months, the fever sheet still says call promptly', /under 3 months/i.test(f.text) && /prompt call/i.test(f.text), f.text);
    /* Asserted, not assumed. When this click silently returned false the next check re-read the
       still-open FEVER sheet, whose under-3-months line contains both "under 3 months" and "prompt
       call" — so it went green against a tree with no safety net in it at all. */
    const opened = await clickText(/call sooner/);
    ok('the newborn fever sheet offers the safety net too', opened === true);
    await sleep(300);
    const s = await sheet();
    ok('and it is the safety net on screen, not the fever sheet still', s.title === 'When to call sooner', s.title);
    ok('and the list repeats it before the first sign', s.title === 'When to call sooner' && /under 3 months/i.test(s.text) && /prompt call/i.test(s.text), s.text);
    ok('the signs are all still there for her', s.rows.length === 11, s.rows);
    BANNED.forEach(([re, what]) => ok('the newborn path is free of ' + what, !re.test(s.text), s.text));
  }

  console.log('\n5. the boundary is this baby\'s age, not the household\'s');
  {
    await load(seed({
      babies: [{ id: 'b1', name: 'Wren', birth: now - 45 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] },
        { id: 'b2', name: 'Robin', birth: now - 400 * DAY, sex: 'M', routines: [], doctors: [], allergies: [] }],
      activeBabyId: 'b2',
    }));
    const older = await page.evaluate(() => feverGuidance());
    ok('the toddler gets the safety-net sentence', /does not say when to call/i.test(older), older);
    ok('and not the newborn one', !/under 3 months/i.test(older), older);
    const younger = await page.evaluate(() => { state.activeBabyId = 'b1'; return feverGuidance(); });
    ok('switching to the 45-day-old switches the sentence', /under 3 months/i.test(younger), younger);
  }

  console.log('\n6. no baby, no illness, second reading, reload');
  {
    // Nobody set up yet: the sheet is still openable from the answer search and must not throw.
    await load(seed({ babies: [], activeBabyId: null }));
    const before = errs.length;
    // Called through a try so a tree without the function reports a red row rather than aborting
    // the run, which would leave every check after this one unreported.
    const reached = await page.evaluate(() => { try { openFeverSafetyNet(); return true; } catch (e) { return String(e); } });
    ok('openFeverSafetyNet is callable on its own', reached === true, reached);
    await sleep(250);
    const s = await sheet();
    ok('with no baby at all it still renders', s.shown && s.rows.length === 11, s);
    ok('and throws nothing on the way', errs.length === before, errs.slice(0, 3));

    await load(seed({ events: [{ id: 't0', type: 'temperature', babyId: 'b1', temp: 38.4, unit: 'C', time: now - 6 * HOUR, authorId: 'local' }] }));
    await logTemp(38.9);
    const two = await page.evaluate(() => state.events.filter((e) => e.type === 'temperature').length);
    ok('a second reading writes a second event', two === 2, two);
    const s2 = await sheet();
    ok('and the second fever sheet is the rewritten one too', /does not say when to call/i.test(s2.text), s2.text);
    BANNED.forEach(([re, what]) => ok('the second reading is free of ' + what, !re.test(s2.text), s2.text));
  }

  console.log('\n7. the same net from a fever logged without a thermometer');
  {
    await load(seed());
    await page.evaluate(() => { openSymptom(); });
    await sleep(250);
    await page.evaluate(() => { symptomDraft.symptom = 'Fever'; saveSymptom(); });
    await sleep(350);
    const n = await sheet();
    ok('saving the Fever chip opens its own sheet', n.shown && /fever/i.test(n.title), n);
    BANNED.forEach(([re, what]) => ok('that sheet is free of ' + what, !re.test(n.text), n.text));
    const clicked = await clickText(/call sooner/);
    ok('it offers the safety net too', clicked === true);
    await sleep(300);
    const s = await sheet();
    ok('and reaches the same eleven signs', s.title === 'When to call sooner' && s.rows.length === 11, s);
    /* The buttons either side of this one close the sheet before they open theirs. This one must
       not, or the way back to "Noted, a fever" disappears from a sheet a parent is reading mid-scare. */
    const had2 = await clickBack();
    ok('that sheet keeps a real back arrow too', had2 === true);
    await sleep(250);
    const b2 = await sheet();
    ok('and back lands on the fever again, not on an empty screen', had2 === true && b2.shown && /fever/i.test(b2.title), b2);
  }

  /* THE CASE THAT MADE THE FIRST VERSION OF THIS CHANGE WORTHLESS TO HALF THE HOUSEHOLD.
     Every earlier section reaches the safety net from openFeverNudge, which fires synchronously
     inside saveTemp, in the browser of the person who pressed save, and dies on "Got it". The other
     parent syncs the reading, opens Cubby, sees the Fever logged pill, and until now had no
     tappable route to the eleven signs anywhere in the app: not Home, not Health, not Log, and not
     the guide, whose chapter row is prose with no button. The only way to read the list was to log
     a fever of your own.

     So this section never calls openFeverSafetyNet(). It walks the screens and clicks what is
     actually on them. `page.evaluate(() => openFeverSafetyNet())` is not a door. */
  const doorsOnScreen = () => page.evaluate(() => [...document.querySelectorAll('[onclick]')]
    .filter((el) => !el.closest('#sheet') && el.offsetParent !== null)
    .map((el) => el.getAttribute('onclick'))
    .filter((s) => /openFeverSafetyNet/.test(s)));

  console.log('\n8. the parent who did not log it can still reach the list');
  {
    // The shape a synced partner's reading arrives in: someone else's authorId, no nudge ever fired.
    await load(seed({ events: [{ id: 't1', type: 'temperature', babyId: 'b1', temp: 38.6, unit: 'C', time: now - 3 * HOUR, authorId: 'partner' }] }));
    const home = await page.evaluate(() => [...document.querySelectorAll('.alert-pill')].map((p) => (p.innerText || '').replace(/\s+/g, ' ').trim()));
    ok('Home shows the fever someone else logged', home.some((t) => /fever logged/i.test(t) && /38\.6/.test(t)), home);
    const doors = await doorsOnScreen();
    ok('and Home carries a control that opens the safety net', doors.length >= 1, { doors, home });
    // The summary was the pill's only action before this change and must not have been displaced.
    ok('without taking the summary away from that pill', home.some((t) => /fever logged/i.test(t) && /summary/i.test(t)), home);
    const tapped = await page.evaluate(() => {
      const el = [...document.querySelectorAll('[onclick]')].find((x) => !x.closest('#sheet') && x.offsetParent !== null && /openFeverSafetyNet/.test(x.getAttribute('onclick')));
      if (!el) return false; el.click(); return true;
    });
    ok('tapping it really opens the sheet', tapped === true);
    await sleep(350);
    const s = await sheet();
    ok('the eleven signs, with nothing logged by this parent', s.shown && s.title === 'When to call sooner' && s.rows.length === 11, s);
    BANNED.forEach(([re, what]) => ok('the second parent\'s copy is free of ' + what, !re.test(s.text), s.text));
    await page.evaluate(() => closeSheet());
    await sleep(200);
  }

  console.log('\n9. and the illness screen keeps a door open while it is running');
  {
    await load(seed({
      illnesses: [{ id: 'i1', babyId: 'b1', name: 'Cold', startedAt: now - 2 * DAY, endedAt: null, notes: '', by: 'partner' }],
      events: [{ id: 't2', type: 'temperature', babyId: 'b1', temp: 38.4, unit: 'C', time: now - 5 * HOUR, illnessId: 'i1', authorId: 'partner' }],
    }));
    await page.evaluate(() => { go('health'); healthTab = 'illness'; render(); });
    await sleep(500);
    const doors = await doorsOnScreen();
    ok('the illness screen offers the safety net during a fever', doors.length >= 1, doors);
    /* And only during a fever. On a cold with no temperature it is a fever list offered unasked,
       which is the app raising an alarm nobody reached for. */
    await load(seed({ illnesses: [{ id: 'i1', babyId: 'b1', name: 'Cold', startedAt: now - 2 * DAY, endedAt: null, notes: '', by: 'partner' }] }));
    await page.evaluate(() => { go('health'); healthTab = 'illness'; render(); });
    await sleep(500);
    const none = await doorsOnScreen();
    ok('and stays quiet on an illness with no fever in it', none.length === 0, none);
  }

  console.log('\n10. the sheet is registered with the teaching layer');
  {
    const r = await page.evaluate(() => {
      const d = window.CubbyTeachData;
      const row = d && d.rows && d.rows.openFeverSafetyNet;
      return row ? { one: row.one, fn: row.fn, excluded: !!(d.noTeach && d.noTeach.openFeverSafetyNet) } : null;
    });
    ok('there is a row for it', !!r, r);
    ok('with a one-line answer under 140 chars', !!r && r.one.length > 0 && r.one.length <= 140, r);
    ok('pointing at the function that opens it', !!r && r.fn === 'openFeverSafetyNet()', r);
    ok('and it is not also excluded', !!r && r.excluded === false, r);
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'FEVER-SAFETY-NET: FAIL' : 'FEVER-SAFETY-NET: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
