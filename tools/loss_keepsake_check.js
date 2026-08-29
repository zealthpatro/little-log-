#!/usr/bin/env node
/* The loss path stranded her calendar, and offered her one button that deleted every loss at once.
 *
 * renderLossHolding is the ONLY screen a woman can reach after a pregnancy ends with no baby to
 * return to. state.pregnancy is gone, Home is gone, Care is gone. Everything she needs a door to
 * has to have that door here, or it does not exist. Six things were wrong with it.
 *
 *  1. HER APPOINTMENTS WERE STRANDED. There are two pregnancy calendar receipts. cubby-preg-weeks
 *     holds the week markers; cubby-preg-appts holds the whole antenatal schedule she published in
 *     one go from Care. This screen asked pregWeeksStillArriving() and nothing else, so a mother
 *     who added her appointments and no week markers reached the holding screen with every scan
 *     alert still live in her phone's calendar and NO card offering to take them off, while a
 *     mother who still had a baby got exactly that door on her home screen from the identical
 *     storage state (pregWeeksLeftAlert has always asked pregIcsStranded). Fixed: the card asks
 *     pregIcsStranded() too.
 *  2. AND THE DOOR OUT SAID NOTHING ABOUT THEM. "Ready to move on?" closes that screen for good.
 *     It warned about week markers and about single visits, and never about the bulk schedule,
 *     which is the one that outnumbers everything else in her calendar.
 *  3. THE CARD WAS LABELLED FOR THE WRONG ROOM. It read "The week markers in your calendar" over a
 *     sheet headed "The appointment dates in your calendar". Fixed: pregStrandedTitle() gives the
 *     card the same three names the sheet gives itself.
 *  4. "REMOVE THESE MEMORIES" DELETED EVERY LOSS AT ONCE. One button sat at the bottom of the whole
 *     sheet calling removeKeptMemories() with no argument, and no argument matches every archive
 *     entry. A mother with two losses who wanted the recent one's photos gone lost the earlier
 *     one's too, for good, in two taps, over a confirm that never mentioned a second pregnancy.
 *     Fixed: never unscoped. With more than one, each pregnancy carries its own button; with
 *     exactly one, the single button still names it by id.
 *  5. SHE WAS SHOWN A PRICE LIST TO GET HER OWN TRYING RECORD OUT. "Your notes from trying" on the
 *     kept-memories sheet opened the report, and Print/Share ran the pdf taste: her first tap spent
 *     it silently, every tap after that closed the report and opened Pro headed "You've enjoyed
 *     your free tastes". This is a record of something that has ENDED and cannot be generated
 *     again, and openPro's own subtitle on that same sheet promises "your data and your privacy
 *     stay free, always". Fixed: an archived record is never charged and never carries the ✨.
 *  6. A MOMENT CARD SHE TITLED HERSELF READ "A moment". pregJCard falls back to a card it invents
 *     when the id is not in the catalogue, and that card's caption resolves through
 *     state.pregnancy, which is null on every screen this sheet is reached from after a loss. It
 *     came back as the literal string 'A moment', and being truthy it swallowed the title sitting
 *     right there on the archive entry. Fixed: the catalogue caption is trusted only when the card
 *     really is a catalogue one, which is the precedence pregJCardHtml already uses live.
 *  7. TWO LOSSES WERE FLATTENED INTO ONE LIST. The sheet sorted every entry's moments together by
 *     week, so "Week 11 · Second time" sat directly above "Week 8 · The first scan" as if they were
 *     one pregnancy. Fixed: grouped per pregnancy, newest first, each group saying when it was
 *     kept, which is the only way to tell two losses apart on a screen that must never name a baby.
 *
 * HOW THIS GATE IS BUILT, because a green run has to mean something.
 *   - never document.body.textContent: that string contains the inline script's own source, so an
 *     assertion on it can pass off the code that implements the bug as the words on the screen.
 *     Everything here reads real nodes out of the rendered sheet.
 *   - every absence assertion is paired with a presence assertion, and every .every() with a count,
 *     so nothing passes for free on a blank screen.
 *   - the delete is EXECUTED, not just read: section 5 runs the confirm and counts what survived.
 *
 * WHAT THIS DOES NOT COVER, so a PASS is not read as more than it is.
 *   - SCOPE. The harness runs in local mode (?e2e=1, cubby-quick-uid=local), so
 *     app/store-firebase.js never loads and firestore.rules is never evaluated. A PASS attests to
 *     what renders and what the handlers do to state, not to the server.
 *   - the .ics bytes. cancelPregAppts is asserted to be the handler behind the button and to clear
 *     the receipt; that her calendar app honours the CANCEL is appt_ics_check's ground, not this
 *     one's, and is in any case a request to her calendar and not something Cubby can enforce.
 *   - the second 📅 card. A woman who used BOTH calendar doors (the whole antenatal plan from Care,
 *     and single visits from a visit sheet) still gets two take-back cards on this screen, from
 *     openWeeksTakeBack and openApptTakeBack. Both are real, both work, and each sheet says which
 *     dates it is about. Merging them means a new sheet, a teach-data entry and another lane's
 *     function, so it is left alone deliberately and named here rather than quietly asserted away.
 *
 *   PORT=19417 node tools/serve.js &
 *   node tools/loss_keepsake_check.js http://localhost:19417
 *
 * Pass an explicit base URL. The default is deliberately NOT 8080: a live server from another
 * checkout on a shared port answers 200 and grades that tree instead of this one.
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:19417';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

const CLOCK = (() => { const d = new Date(); d.setHours(10, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

/* Her first loss, two years back, and the one that just happened. Both carry a scan she kept and a
   card she wrote in her own words, because that is the state in which one undifferentiated list and
   one unscoped delete button do their damage. The recent one also carries the year of dates she
   kept while trying, which is what the report row reads from. */
const OLD = {
  id: 'pOld', loss: true, endedAt: now - 720 * DAY, weeks: 8,
  moments: [{ id: 'm1', week: 8, at: now - 722 * DAY, note: 'The first scan', photoId: null }],
  journey: { pj_first_told: { at: now - 721 * DAY, note: 'She cried too', title: 'Telling my sister' } },
};
const NEW = {
  id: 'pNew', loss: true, endedAt: now - 9 * DAY, weeks: 11,
  moments: [{ id: 'm2', week: 11, at: now - 12 * DAY, note: 'Second time', photoId: null }],
  journey: { 'cust-abc123': { at: now - 11 * DAY, date: '2026-08-10', note: 'We named the day', title: 'Our own words' } },
  periods: [{ start: now - 400 * DAY }, { start: now - 372 * DAY }, { start: now - 344 * DAY }],
  observations: [{ at: now - 380 * DAY, note: 'felt different' }],
};

const seed = (over) => Object.assign({
  babies: [], activeBabyId: null, events: [], illnesses: [], notes: [],
  /* proTaste spent, which is the state the bereaved mother is in: her first tap on Print spent the
     single pdf taste silently, so every tap after that is the one that opens the price list. */
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', proTaste: { pdf: 1 },
    seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null,
  lossHolding: { local: { at: now - 2 * DAY } },
  pregnancyArchive: [OLD, NEW],
}, over || {});

/* The whole antenatal plan, published in one go from Care and still arriving. pid names a
   pregnancy that no longer exists, which is exactly what a loss leaves behind. */
const APPT_ICS = { seq: 1, pid: 'pNew', at: now - 40 * DAY, until: now + 40 * DAY,
  keys: [{ id: 'a1', d: '20260901' }, { id: 'a2', d: '20260915' }, { id: 'a3', d: '20261002' }] };
/* The week markers, the other receipt. */
const WEEK_ICS = { seq: 1, pid: 'pNew', at: now - 40 * DAY, until: now + 60 * DAY, wks: [12, 13, 14, 15], from: 12, to: 15 };

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
  /* Every request goes to the server on BASE, never to app/sw.js's cache. Without this a reload can
     be answered by a service worker holding the FIRST tree it saw, which is how a gate ends up
     grading code that is no longer on disk. */
  const cdp = await page.createCDPSession();
  await cdp.send('Network.setBypassServiceWorker', { bypass: true });
  await page.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });

  /* Which checkout is on that port? pregStrandedTitle exists only in the fixed tree, so its absence
     means one of exactly two things and the banner says which, rather than letting a red run be
     misread as a broken feature. */
  const marker = await page.evaluate(() => typeof window.pregStrandedTitle === 'function');
  console.log(marker
    ? '  [checkout] ' + BASE + ' is serving a tree that has pregStrandedTitle. Good.'
    : '  [checkout] NOTE: ' + BASE + ' is serving a tree with NO pregStrandedTitle.\n'
      + '             Either the change is reverted, or this port belongs to another checkout.');

  await page.evaluate(() => localStorage.setItem('cubby-quick-uid', 'local'));

  /* state, plus the two calendar receipts, which live outside state on purpose: they must outlive
     the pregnancy that wrote them, or the take-back has nothing left to name. */
  const load = async (s, appts, weeks) => {
    const put = async () => page.evaluate((x, a, w) => {
      localStorage.setItem('cubby-quick-uid', 'local');
      localStorage.setItem('little-log-v1', JSON.stringify(x));
      if (a) localStorage.setItem('cubby-preg-appts:local', JSON.stringify(a));
      else localStorage.removeItem('cubby-preg-appts:local');
      if (w) localStorage.setItem('cubby-preg-weeks:local', JSON.stringify(w));
      else localStorage.removeItem('cubby-preg-weeks:local');
      localStorage.removeItem('cubby-appt-ics:local');
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
    }, s, appts || null, weeks || null);
    /* A section that ran a delete left a persist() behind it. persist writes the same key this is
       about to write, so seeding without waiting for it means the next section reloads the PREVIOUS
       section's leftovers and reads as a failure of the fix. */
    await sleep(400);
    /* One retry, because a frame can detach under us between sections and a harness that dies there
       reports one failure instead of the whole picture. */
    try { await put(); } catch (e) { await page.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 }); await put(); }
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1400);
    await page.evaluate(() => {
      try { window.__toasts = []; window.toast = function (m) { window.__toasts.push(m); }; } catch (e) {}
      /* saveFile ends in a real download in the cancel paths. Stubbed so a section that taps
         "take them off" measures what Cubby did to the receipt, not what Chrome did to a file. */
      try { window.__saved = []; window.saveFile = function (u, n, t) { window.__saved.push(n); if (t) window.__toasts.push(t); }; } catch (e) {}
    });
    await sleep(150);
  };

  /* The holding screen's own cards, read as nodes. Never body.textContent. */
  const holdingCards = () => page.evaluate(() => {
    const w = document.querySelector('.ob-wrap');
    if (!w) return { screen: null, cards: [] };
    return {
      screen: (w.querySelector('.tag') || {}).textContent || '',
      cards: [].slice.call(w.querySelectorAll('.prof-card')).map((c) => ({
        a: ((c.querySelector('.a') || {}).textContent || '').trim(),
        b: ((c.querySelector('.b') || {}).textContent || '').trim(),
        on: c.getAttribute('onclick') || '',
      })),
    };
  });

  const sheet = () => page.evaluate(() => {
    const s = document.querySelector('#sheet.show');
    if (!s) return null;
    const h = s.querySelector('h2');
    return {
      /* The teaching dot appends an "i" into the h2, so the heading is read off the first text node
         rather than textContent, which would never equal the card label it is supposed to match. */
      h2: h ? (h.firstChild && h.firstChild.nodeValue ? h.firstChild.nodeValue : h.textContent).trim() : null,
      sub: ((s.querySelector('.sub') || {}).textContent || '').trim(),
      buttons: [].slice.call(s.querySelectorAll('button')).map((b) => ({
        t: (b.textContent || '').replace(/\s+/g, ' ').trim(), on: b.getAttribute('onclick') || '' })),
      secTitles: [].slice.call(s.querySelectorAll('.sec-title')).map((x) => (x.textContent || '').trim()),
      mcWeek: [].slice.call(s.querySelectorAll('.mc-week')).map((x) => (x.textContent || '').trim()),
      mcNote: [].slice.call(s.querySelectorAll('.mc-note')).map((x) => (x.textContent || '').trim()),
      mcDate: [].slice.call(s.querySelectorAll('.mc-date')).map((x) => (x.textContent || '').trim()),
      rows: [].slice.call(s.querySelectorAll('.set-item')).map((x) => ({
        a: ((x.querySelector('.a') || {}).textContent || '').trim(),
        b: ((x.querySelector('.b') || {}).textContent || '').trim(),
        on: x.getAttribute('onclick') || '' })),
    };
  });

  console.log('\n1. after a loss, the antenatal appointments in her calendar have a door');
  {
    // Appointments still arriving, NO week markers: the exact state that had no card at all.
    await load(seed(), APPT_ICS, null);
    const h = await holdingCards();
    ok('she is on the holding screen, not the upbeat chooser', /take all the time you need/i.test(h.screen || ''), h.screen);
    const cal = h.cards.filter((c) => /openWeeksTakeBack|openApptTakeBack/.test(c.on));
    /* Every one of these needs the card to EXIST as well as to read right, or the whole block goes
       green on the screen that has no door at all, which is the defect. */
    const c0 = cal[0] || { a: '', on: '' };
    ok('there is a card that reaches the calendar take-back', cal.length === 1, h.cards);
    ok('and it names the appointments', cal.length === 1 && /appointment/i.test(c0.a), cal);
    ok('and does NOT call them week markers', cal.length === 1 && !/week marker/i.test(c0.a), cal);
    const sup = h.cards.filter((c) => /If you need support/i.test(c.a));
    ok('the support card is still there beside it', sup.length === 1, h.cards.map((c) => c.a));

    const s = await page.evaluate(() => { try { openWeeksTakeBack(); } catch (e) {} return null; }).then(sheet);
    ok('the card opens a sheet', !!s, s);
    ok('the sheet is headed exactly what the card promised', !!s && cal.length === 1 && s.h2 === c0.a, { card: c0.a, sheet: s && s.h2 });
    const off = (s ? s.buttons : []).filter((b) => /cancelPregAppts/.test(b.on));
    ok('and it carries the take-off button, once', off.length === 1, s && s.buttons);
    ok('with a way to leave them, too', (s ? s.buttons : []).some((b) => /closeSheet/.test(b.on)), s && s.buttons);

    const after = await page.evaluate(() => {
      cancelPregAppts();
      return { rec: localStorage.getItem('cubby-preg-appts:local'), saved: (window.__saved || []).slice(),
        stranded: pregIcsStranded() };
    });
    ok('tapping it hands her a file', after.saved.length === 1 && /appointments-off/.test(after.saved[0]), after);
    ok('and the receipt is gone, so nothing is left arriving', after.rec === null && after.stranded === false, after);
  }

  console.log('\n2. the card is labelled for the room it opens, in all three states');
  {
    const titleFor = async (appts, weeks) => {
      await load(seed(), appts, weeks);
      const h = await holdingCards();
      const card = h.cards.filter((c) => /openWeeksTakeBack/.test(c.on))[0] || null;
      const s = card ? await page.evaluate(() => { try { openWeeksTakeBack(); } catch (e) {} return null; }).then(sheet) : null;
      await page.evaluate(() => { try { closeSheet(); } catch (e) {} });
      return { card: card && card.a, h2: s && s.h2 };
    };
    const a = await titleFor(APPT_ICS, null);
    const w = await titleFor(null, WEEK_ICS);
    const both = await titleFor(APPT_ICS, WEEK_ICS);
    ok('appointments only: card matches sheet', a.card && a.card === a.h2, a);
    ok('week markers only: card matches sheet', w.card && w.card === w.h2, w);
    ok('both: card matches sheet', both.card && both.card === both.h2, both);
    const set = [a.card, w.card, both.card];
    ok('and the three states are three different labels', new Set(set).size === 3, set);
    ok('the week-marker one says week markers', /week marker/i.test(w.card || ''), w);
    ok('and the appointments one does not', !/week marker/i.test(a.card || ''), a);
  }

  console.log('\n3. leaving the screen for good says what stays in her calendar');
  {
    await load(seed(), APPT_ICS, null);
    const body = await page.evaluate(() => {
      endLossHolding();
      const s = document.querySelector('#sheet.show');
      if (!s) return null;
      return { txt: ((s.querySelector('.sub') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
        confirm: [].slice.call(s.querySelectorAll('button')).map((b) => (b.textContent || '').trim()) };
    });
    ok('it asks before closing the only door', !!body && body.confirm.length >= 2, body);
    ok('and it says her appointments stay unless she takes them off', /appointments stay in your calendar/i.test((body || {}).txt || ''), body);
    ok('it still promises nothing kept is deleted', /nothing you kept is deleted/i.test((body || {}).txt || ''), body);
    ok('and it offers a way back, not just a way out', ((body || {}).confirm || []).some((t) => /not yet/i.test(t)), body);
  }

  console.log('\n4. two losses are two pregnancies, not one flat list');
  {
    await load(seed(), null, null);
    const s = await page.evaluate(() => { try { openKeptMemories(); } catch (e) {} return null; }).then(sheet);
    ok('the kept-memories sheet opens', !!s, s);
    const groups = (s ? s.secTitles : []).filter((t) => /^Kept |^What you kept$/.test(t));
    ok('there is one group heading per pregnancy', groups.length === 2, s && s.secTitles);
    ok('and the two headings are different', groups.length === 2 && groups[0] !== groups[1], groups);
    ok('the one she just lost is first', /2026/.test(groups[0] || '') || groups[0] === 'Kept August 2026', groups);
    // Her scans, in per-pregnancy order: the recent group's week 11 before the old group's week 8.
    const wk = (s ? s.mcWeek : []);
    ok('both scans are shown', wk.filter((t) => /^Week \d+$/.test(t)).length === 2, wk);
    ok('and the recent pregnancy comes first', wk.indexOf('Week 11') > -1 && wk.indexOf('Week 11') < wk.indexOf('Week 8'), wk);
    ok('with her own notes intact on both', s && s.mcNote.indexOf('Second time') > -1 && s.mcNote.indexOf('The first scan') > -1, s && s.mcNote);
  }

  console.log('\n5. "Remove these memories" removes ONE pregnancy, never every loss at once');
  {
    await load(seed(), null, null);
    const s = await page.evaluate(() => { try { openKeptMemories(); } catch (e) {} return null; }).then(sheet);
    const rm = (s ? s.buttons : []).filter((b) => /removeKeptMemories/.test(b.on));
    ok('there is a remove button for each pregnancy', rm.length === 2, rm);
    ok('and every one of them names an id', rm.length === 2 && rm.every((b) => /removeKeptMemories\('[^']+'\)/.test(b.on)), rm);
    ok('not one of them is unscoped', rm.length === 2 && !rm.some((b) => /removeKeptMemories\(\s*\)/.test(b.on)), rm);
    ok('they are scoped to two DIFFERENT ids', new Set(rm.map((b) => b.on)).size === 2, rm);
    /* And they do not read the same. Two identical permanent-delete buttons in one scroll is a
       mis-tap, and this is the scroll where she is tapping numb. Each says which pregnancy it is
       about, in the same words as the heading it sits under. */
    ok('and the two labels are not identical', new Set(rm.map((b) => b.t)).size === 2, rm.map((b) => b.t));
    ok('each label names its pregnancy', rm.length === 2 && rm.every((b) => /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b \d{4}$/.test(b.t)), rm.map((b) => b.t));

    /* TAPPED, not called. Calling removeKeptMemories('pNew') by hand asks whether the FUNCTION can
       be scoped, which it always could; the defect was that the sheet never passed it an id. So
       this clicks the button she would actually reach for: the first Remove on the sheet, which is
       the pregnancy she just lost because the groups run newest first. On the broken tree that is
       the one unscoped button at the bottom, and the count below is what it destroyed. */
    const conf = await page.evaluate(() => {
      const sh = document.querySelector('#sheet.show');
      const b = sh ? [].slice.call(sh.querySelectorAll('button')).filter((x) => /removeKeptMemories/.test(x.getAttribute('onclick') || ''))[0] : null;
      if (b) b.click();
      const c = document.querySelector('#sheet.show');
      if (!c) return null;
      return { txt: ((c.querySelector('.sub') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
        btns: [].slice.call(c.querySelectorAll('button')).map((b) => (b.textContent || '').trim()) };
    });
    ok('the confirm warns it cannot be undone', /can't be brought back|cannot be brought back/i.test((conf || {}).txt || ''), conf);
    ok('and it says everything else stays', /everything else stays/i.test((conf || {}).txt || ''), conf);
    ok('and it names which pregnancy this is', /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/.test((conf || {}).txt || ''), conf);
    ok('with "keep them" offered as plainly as "remove them"', ((conf || {}).btns || []).some((t) => /keep them/i.test(t)), conf);

    // Now actually do it, and count what survived. __confirmYes defers the callback by 50ms, so the
    // click and the count are two steps: measuring in the same tick reads the state before the
    // delete and passes a gate that has watched nothing happen.
    const clicked = await page.evaluate(() => {
      const c = document.querySelector('#sheet.show');
      const go = c ? [].slice.call(c.querySelectorAll('button')).filter((b) => /remove them/i.test(b.textContent || ''))[0] : null;
      if (go) go.click();
      return !!go;
    });
    ok('the confirm has a button that does it', clicked === true, clicked);
    await sleep(500);
    const after = await page.evaluate(() => {
      const A = (state.pregnancyArchive || []);
      const f = (id) => A.filter((x) => x.id === id)[0] || null;
      const n = (x) => x ? { m: (x.moments || []).length, j: Object.keys(x.journey || {}).length } : null;
      return { entries: A.length, oldE: n(f('pOld')), newE: n(f('pNew')), trying: f('pNew') ? (f('pNew').periods || []).length : -1 };
    });
    ok('the pregnancy she chose lost its photos and cards', after.newE && after.newE.m === 0 && after.newE.j === 0, after);
    ok('THE OTHER LOSS IS UNTOUCHED', after.oldE && after.oldE.m === 1 && after.oldE.j === 1, after);
    ok('both entries are still in the archive', after.entries === 2, after);
    ok('and her year of trying went nowhere', after.trying === 3, after);
  }

  console.log('\n6. one pregnancy: the single button is still scoped, and still honest');
  {
    await load(seed({ pregnancyArchive: [NEW] }), null, null);
    const s = await page.evaluate(() => { try { openKeptMemories(); } catch (e) {} return null; }).then(sheet);
    const rm = (s ? s.buttons : []).filter((b) => /removeKeptMemories/.test(b.on));
    ok('there is exactly one remove button', rm.length === 1, rm);
    ok('and it still carries the id rather than matching everything', /removeKeptMemories\('pNew'\)/.test((rm[0] || {}).on || ''), rm);
    ok('and it stays the plain label when there is only one', rm.length === 1 && rm[0].t === 'Remove these memories', rm);
    ok('no group heading is drawn when there is nothing to tell apart', (s ? s.secTitles : []).filter((t) => /^Kept /.test(t)).length === 0, s && s.secTitles);
    ok('her scan is still on the sheet', (s ? s.mcWeek : []).indexOf('Week 11') > -1, s && s.mcWeek);
  }

  console.log('\n7. a moment she titled herself keeps her words');
  {
    await load(seed(), null, null);
    const s = await page.evaluate(() => { try { openKeptMemories(); } catch (e) {} return null; }).then(sheet);
    ok('the card she wrote is shown under her own title', (s ? s.mcWeek : []).indexOf('Our own words') > -1, s && s.mcWeek);
    ok('and NOT as the placeholder "A moment"', (s ? s.mcWeek : []).indexOf('A moment') === -1, s && s.mcWeek);
    ok('the note she typed is there with it', (s ? s.mcNote : []).indexOf('We named the day') > -1, s && s.mcNote);
    ok('and the older card keeps its title too', (s ? s.mcWeek : []).indexOf('Telling my sister') > -1, s && s.mcWeek);
    ok('its date reads as a date, not as stored text', (s ? s.mcDate : []).some((d) => /Aug 10, 2026/.test(d)), s && s.mcDate);
    ok('the cards are labelled as cards she wrote', (s ? s.secTitles : []).filter((t) => /cards you wrote/i.test(t)).length === 2, s && s.secTitles);
  }

  console.log('\n8. her own trying record is never sold back to her');
  {
    await load(seed(), null, null);
    const row = await page.evaluate(() => {
      openKeptMemories();
      const c = document.querySelector('#sheet.show');
      const r = [].slice.call(c.querySelectorAll('.set-item')).filter((x) => /notes from trying/i.test(x.textContent || ''));
      return { n: r.length, on: r[0] ? r[0].getAttribute('onclick') : null, spent: tasteLeft('pdf') };
    });
    ok('the row to her trying record is on the sheet', row.n === 1, row);
    ok('and it is scoped to the archived entry', /openTtcDoctorReport\('pNew'\)/.test(row.on || ''), row);
    ok('her free pdf taste is already spent, as it would be', row.spent === 0, row);

    const rep = await page.evaluate(() => {
      openTtcDoctorReport('pNew');
      const ov = document.getElementById('reportOv');
      if (!ov) return null;
      return { btns: [].slice.call(ov.querySelectorAll('button')).map((b) => (b.textContent || '').trim()),
        body: ((ov.querySelector('pre') || {}).textContent || '').slice(0, 400) };
    });
    ok('the report opens', !!rep, rep);
    ok('and it holds her actual dates', /\d/.test((rep || {}).body || '') && ((rep || {}).body || '').length > 20, rep && rep.body.slice(0, 120));
    const btns = (rep || {}).btns || [];
    ok('Print is offered', btns.some((t) => /Print|Save/i.test(t)), btns);
    ok('Share is offered', btns.some((t) => /Share/i.test(t)), btns);
    ok('and NEITHER carries the ✨ price tag', btns.length >= 3 && !btns.some((t) => t.indexOf('✨') > -1), btns);

    const printed = await page.evaluate(() => {
      window.__printed = false; window.print = function () { window.__printed = true; };
      printTtcReport();
      return { printed: window.__printed, reportOpen: !!document.getElementById('reportOv'),
        pro: (function () { const s = document.querySelector('#sheet.show'); return s ? ((s.querySelector('h2') || {}).textContent || '').trim() : null; })(),
        left: tasteLeft('pdf') };
    });
    ok('Print actually prints', printed.printed === true, printed);
    ok('the report does not close under her', printed.reportOpen === true, printed);
    ok('and no price list is put in front of her', printed.pro === null, printed);

    const shared = await page.evaluate(() => {
      window.__copied = null;
      navigator.clipboard && (navigator.clipboard.writeText = function (t) { window.__copied = t; return Promise.resolve(); });
      shareTtcReport();
      return { reportOpen: !!document.getElementById('reportOv'),
        pro: (function () { const s = document.querySelector('#sheet.show'); return s ? ((s.querySelector('h2') || {}).textContent || '').trim() : null; })() };
    });
    ok('Share does not sell to her either', shared.pro === null && shared.reportOpen === true, shared);
  }

  console.log('\n9. the live trying record IS still a Pro treat, so this gate is not a paywall removal');
  {
    /* The archive is free because the record has ended and cannot be made again. A woman still
       trying, with her taste spent, is exactly who Pro is for. If this ever goes green the fix
       above has been widened into something nobody asked for. */
    await load(seed({ babies: [], lossHolding: null, pregnancyArchive: [],
      pregnancy: { id: 'pLive', stage: 'planning', ownerUid: 'local', createdAt: now - 200 * DAY,
        periods: [{ start: now - 90 * DAY }, { start: now - 62 * DAY }], observations: [], cycleLen: 28,
        appts: [], symptoms: [], weights: [], bp: [], supplements: [] } }), null, null);
    const live = await page.evaluate(() => {
      openTtcDoctorReport();
      const ov = document.getElementById('reportOv');
      if (!ov) return { open: false };
      const btns = [].slice.call(ov.querySelectorAll('button')).map((b) => (b.textContent || '').trim());
      window.__printed = false; window.print = function () { window.__printed = true; };
      printTtcReport();
      const s = document.querySelector('#sheet.show');
      return { open: true, btns: btns, printed: window.__printed,
        pro: s ? ((s.querySelector('h2') || {}).textContent || '').trim() : null,
        reportOpen: !!document.getElementById('reportOv') };
    });
    ok('the live report still opens to read, free', live.open === true, live);
    ok('and its buttons still carry the ✨', (live.btns || []).some((t) => t.indexOf('✨') > -1), live.btns);
    ok('with the taste spent, Print reaches Pro', live.printed === false && live.pro !== null, live);
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'LOSS-KEEPSAKE: FAIL' : 'LOSS-KEEPSAKE: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
