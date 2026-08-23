#!/usr/bin/env node
/* THE TWO THINGS THE DOCTOR PAGE COULD NOT SAY.
 *
 * WHY THE FAMILY CAME. The pregnancy journey has had visitQs since it was written, so a mother can
 * carry her questions into the room. The baby stage never got the instrument, so the page a parent
 * hands a paediatrician opened with feed averages and never once said what she actually wanted to
 * ask. Ten minutes, a baby who is not having a good day, and the one question she came with is the
 * one thing she has to remember unaided.
 *
 * HOW THE BABY WAS BORN. Cubby has stored the gestation and a typed birth weight for weeks and
 * neither reached the report. A baby born at 33 weeks + 4 days handed over a page identical to a
 * term baby's: no gestation, no corrected age, and the birth weight stranded between the nappy
 * notes and the latest growth. The growth chart already plots by corrected age; the one surface
 * written to be read by a clinician did not know the baby was early at all.
 *
 * And the page must say each thing EXACTLY ONCE. This file already learned that lesson with the
 * illness block, so the report asks visitSummary to leave out what it prints under its own heading.
 *
 *   PORT=9417 node tools/serve.js &
 *   node tools/things_to_ask_check.js http://localhost:9417
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:9417';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, HOUR = 3600000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

// Mid-morning, so nothing here depends on which side of midnight the run happens to land.
const CLOCK = (() => { const d = new Date(); d.setHours(10, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

const seed = (over) => Object.assign({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
  activeBabyId: 'b1', events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
}, over || {});

// A birth weight is an ordinary growth event carrying birthWeight:true at t=birth. Same shape
// setBirthWeight writes, so nothing here depends on a private helper.
const bwEvent = (birth, kg) => ({ id: 'gw0', type: 'growth', babyId: 'b1', time: birth, weight: kg, wUnit: 'kg', birthWeight: true });

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
    await sleep(1200);
  };
  // The sheet's own markup, never document.body.textContent: the page carries its whole inline
  // script in the DOM and reading the body would let the source of a function pass for its output.
  const sheetText = () => page.evaluate(() => {
    const s = document.getElementById('sheet');
    return s ? s.innerText.replace(/\s+/g, ' ').trim() : '';
  });

  /* Cubby's sheets animate in and the app scrolls inside its own container, so an element can be in
     the DOM, correct, and still have no clickable point. A bare page.click dies with "not clickable"
     and kills the run, which is indistinguishable from a broken feature. Wait, scroll, then click. */
  const tapEl = async (sel) => {
    /* Cubby's sheets animate in and the app scrolls inside #scroll, so an element can be present and
       correct and still have no clickable point: page.click then throws "not clickable" and kills the
       whole run, which reads exactly like a broken feature. Wait for it to EXIST (not `visible`,
       which is the wrong question for a field inside a scroller), scroll it into view, try the real
       click, and fall back to a real in-page click plus focus. The keystrokes that follow are still
       genuine; only the pointer is synthesised, and the pointer is not what any of this is testing. */
    await page.waitForSelector(sel, { timeout: 8000 });
    await page.evaluate((x) => { const el = document.querySelector(x); if (el) el.scrollIntoView({ block: 'center' }); }, sel);
    await sleep(200);
    try {
      await page.click(sel);
    } catch (e) {
      await page.evaluate((x) => {
        const el = document.querySelector(x); if (!el) return;
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        if (typeof el.focus === 'function') el.focus();
      }, sel);
    }
    await sleep(120);
  };

  console.log('\n1. the add row is on the doctor sheet, and nothing is written just by opening it');
  {
    // One feed, so the fortnight below has real numbers to sit under rather than the empty-window
    // sentence: the ordering assertion in section 5 is about the agenda outranking the counting.
    await load(seed({ events: [{ id: 'f1', type: 'feed', babyId: 'b1', method: 'bottle', amount: 120, unit: 'ml', time: now - 2 * HOUR }] }));
    const r = await page.evaluate(() => {
      openDoctor();
      const b = state.babies[0];
      return { input: !!document.getElementById('aqNew'), rows: document.querySelectorAll('#sheet .bag-row').length,
        chips: [].map.call(document.querySelectorAll('#sheet .chip-row .chip'), (c) => c.textContent),
        stored: b.askQs === undefined };
    });
    ok('there is an add-a-question row', r.input === true, r);
    /* PAIRED WITH THE ROW ON PURPOSE. "rows === 0" and "askQs === undefined" are both true of a
       build where none of this exists at all, so on their own they are free passes. Anchored to
       the add row and to the chips, they can only be true of a list that is present and empty. */
    ok('the list starts empty', r.rows === 0 && r.input === true, r);
    /* THE ONE DELIBERATE DIFFERENCE FROM THE PREGNANCY LIST. That one seeds six questions on open
       because the journey belongs to one person. The care team is shared, so seeding here would
       let a partner merely opening this sheet write six questions nobody asked into the household
       blob, and they would print at the top of a clinical page as the family's own words. */
    ok('and opening the sheet wrote nothing at all', r.stored === true && r.input === true, r);
    ok('suggestions are offered instead, as taps', r.chips.length === 3, r);
  }

  console.log('\n2. a question typed in the box survives a reload, and a tapped suggestion is the family\'s');
  {
    const r = await page.evaluate(() => {
      openDoctor();
      document.getElementById('aqNew').value = '  Why is she   pulling at her ear?  ';
      addAskQ();
      addAskSuggestion(0);
      const b = state.babies[0];
      return { texts: (b.askQs || []).map((q) => q.text), done: (b.askQs || []).map((q) => q.done),
        rows: document.querySelectorAll('#sheet .bag-row').length,
        cleared: document.getElementById('aqNew').value };
    });
    ok('the typed question is stored, whitespace tidied', r.texts[0] === 'Why is she pulling at her ear?', r);
    ok('the tapped suggestion is stored beside it', r.texts.length === 2 && /vaccines|growth|feeding|sooner/i.test(r.texts[1]), r);
    ok('both start unticked', r.done.length === 2 && r.done.every((d) => d === false), r);
    ok('and both are on screen', r.rows === 2, r);
    ok('the box is empty again', r.cleared === '', r);
    // The whole point of writing it down is that it is still there at the appointment next week.
    await page.reload({ waitUntil: 'networkidle2' }); await sleep(1200);
    const after = await page.evaluate(() => (state.babies[0].askQs || []).map((q) => q.text));
    ok('and they survive a reload', after.length === 2 && after[0] === 'Why is she pulling at her ear?', after);
    // A second save must not lose the first: this list is a whole-field write into the shared blob.
    const three = await page.evaluate(() => { openDoctor(); addAskSuggestion(1); return (state.babies[0].askQs || []).map((q) => q.text); });
    ok('a second save keeps the first two', three.length === 3, three);
  }

  console.log('\n3. an empty box, and a suggestion already on the list');
  {
    const r = await page.evaluate(() => {
      openDoctor();
      const before = (state.babies[0].askQs || []).length;
      document.getElementById('aqNew').value = '     ';
      addAskQ();
      const afterBlank = (state.babies[0].askQs || []).length;
      // addAskSuggestion(1) was tapped in section 2, so its chip must be gone rather than offering
      // a duplicate of a question already on the list.
      const chips = [].map.call(document.querySelectorAll('#sheet .chip-row .chip'), (c) => c.textContent.trim());
      const taken = (state.babies[0].askQs || []).map((q) => q.text);
      return { before: before, afterBlank: afterBlank, chips: chips, dupes: chips.filter((c) => taken.indexOf(c) >= 0) };
    });
    ok('a blank box writes nothing', r.afterBlank === r.before, r);
    ok('there are still suggestions left to offer', r.chips.length > 0, r);
    ok('and none of them is already on the list', r.chips.length > 0 && r.dupes.length === 0, r);
  }

  console.log('\n4. ticking one off is a real tick, and does not strand her behind back arrows');
  {
    const r = await page.evaluate(() => {
      openDoctor();
      const before = _sheetStack.length;
      const ids = state.babies[0].askQs.map((q) => q.id);
      document.getElementById('aqNew').value = 'half typed, not finished';
      document.querySelector('#aq-' + ids[0] + ' .bg-tick').click();
      document.querySelector('#aq-' + ids[1] + ' .bg-tick').click();
      document.querySelector('#aq-' + ids[1] + ' .bg-tick').click();
      const q = state.babies[0].askQs.find((x) => x.id === ids[0]);
      return { done: q.done, others: state.babies[0].askQs.filter((x) => x.id !== ids[0]).map((x) => x.done),
        still: state.babies[0].askQs.length,
        rowDone: !!document.querySelector('#aq-' + ids[0]).classList.contains('done'),
        ticked: (document.querySelector('#aq-' + ids[0] + ' .bg-tick').innerHTML || '').length > 0,
        rows: document.querySelectorAll('#sheet .bag-row').length,
        typed: document.getElementById('aqNew').value,
        before: before, after: _sheetStack.length };
    });
    ok('the question is ticked', r.done === true, r);
    ok('and only that one', r.others.length === 2 && r.others.every((d) => d === false), r);
    ok('the row shows it, so the sheet really repainted', r.rowDone === true && r.ticked === true, r);
    ok('ticking did not remove anything', r.still === 3 && r.rows === 3, r);
    /* THREE TICKS, NO NEW BACK ARROWS. openDoctor renders an identity strip rather than an h2, so
       openSheet has no title to compare and files every one of its repaints as a forward step. A
       tick that went through openDoctor would leave a parent who ticked four things off in the
       room pressing back four times to get out of a sheet she never left. Measured as a DELTA
       across the ticks, because openDoctor has that wart already and this is about not feeding it.
       (Pre-existing: saveDoctorEntry and openVisit push a step each. Out of scope here.) */
    ok('and the three ticks left no new back steps behind them', r.after === r.before, r);
    // A whole-sheet repaint threw this away mid-sentence, at the exact moment she was writing down
    // the thing she was afraid of forgetting.
    ok('a half-typed question survives a tick', r.typed === 'half typed, not finished', r);
  }

  console.log('\n5. a ticked question is spent: the summary prints only what is still to ask');
  {
    const r = await page.evaluate(() => {
      const qs = state.babies[0].askQs;
      const t = visitSummary(7);
      return { text: t, ticked: qs.filter((q) => q.done).map((q) => q.text), open: qs.filter((q) => !q.done).map((q) => q.text) };
    });
    ok('the heading is there', /Things to ask:/.test(r.text), r.text.split('\n').slice(0, 8));
    ok('every open question is printed', r.open.length === 2 && r.open.every((q) => r.text.indexOf('• ' + q) >= 0), r);
    ok('the ticked one is not', r.ticked.length === 1 && r.text.indexOf(r.ticked[0]) < 0, r);
    // Above the counting. A clinician reads top-down and the agenda is not a footnote to the feeds.
    const iAsk = r.text.indexOf('Things to ask:'), iFeed = r.text.indexOf('Feeds:');
    ok('and it sits above the feed averages', iAsk >= 0 && iFeed > iAsk, { iAsk: iAsk, iFeed: iFeed });
  }

  console.log('\n6. tick them all and the section disappears rather than printing an empty heading');
  {
    const r = await page.evaluate(() => {
      state.babies[0].askQs.forEach((q) => { q.done = true; });
      persist();
      const t = visitSummary(7);
      return { has: /Things to ask/.test(t), n: state.babies[0].askQs.length };
    });
    ok('all three are still stored', r.n === 3, r);
    ok('and the summary says nothing about them', r.has === false, r);
    // Unticking all of them is the "next visit" gesture and must bring the whole list back.
    const back = await page.evaluate(() => { openDoctor(); resetAskQsDone(); return { text: visitSummary(7), open: state.babies[0].askQs.filter((q) => !q.done).length }; });
    ok('uncheck all brings every question back', back.open === 3, back.open);
    ok('and the section returns with them', /Things to ask:/.test(back.text), back.text.slice(0, 200));
  }

  console.log('\n7. a baby with no questions at all');
  {
    await load(seed());
    const r = await page.evaluate(() => ({ text: visitSummary(7), n: (state.babies[0].askQs || []).length }));
    ok('nothing is stored', r.n === 0, r);
    ok('and no empty heading is printed', /Things to ask/.test(r.text) === false, r.text.slice(0, 200));
    /* The absence above is true of a build with no feature in it at all. Paired with the same baby
       one question later, it says what it means: the heading is suppressed by emptiness, not by
       the block being missing. */
    const withOne = await page.evaluate(() => { openDoctor(); addAskQ('Does she need vitamin drops?'); return visitSummary(7); });
    ok('one question later the heading is there', /Things to ask:/.test(withOne), withOne.slice(0, 300));
  }

  console.log('\n8. someone else\'s baby: questions belong to the baby they were written for');
  {
    await load(seed({
      babies: [
        { id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', routines: [], doctors: [], allergies: [], askQs: [{ id: 'q1', text: 'Robin question', done: false }] },
        { id: 'b2', name: 'Wren', birth: now - 20 * DAY, sex: 'M', routines: [], doctors: [], allergies: [], askQs: [{ id: 'q2', text: 'Wren question', done: false }] },
      ], activeBabyId: 'b2',
    }));
    const r = await page.evaluate(() => {
      openDoctor();
      return { rows: [].map.call(document.querySelectorAll('#sheet .bag-row .bg-t'), (n) => n.textContent.trim()), text: visitSummary(7) };
    });
    ok('the sheet shows only the active baby\'s question', r.rows.length === 1 && r.rows[0] === 'Wren question', r.rows);
    ok('the summary prints it', r.text.indexOf('Wren question') >= 0, r.text.slice(0, 300));
    ok('and never the sibling\'s', r.text.indexOf('Robin question') < 0, r.text.slice(0, 300));
  }

  console.log('\n9. the birth history: a baby born at 33 + 4 no longer reads like a term baby');
  {
    const birth = now - 60 * DAY;
    await load(seed({
      babies: [{ id: 'b1', name: 'Robin', birth: birth, sex: 'F', gestWeeks: 33, gestDays: 4, routines: [], doctors: [], allergies: [] }],
      events: [bwEvent(birth, 1.9)],
    }));
    const r = await page.evaluate(() => ({ text: visitSummary(7), lines: birthHistoryLines(state.babies[0]) }));
    ok('the gestation is on the page', /Born at 33 weeks \+ 4 days/.test(r.text), r.lines);
    ok('the birth weight is on the page', /Birth weight: 1\.9 kg/.test(r.text), r.lines);
    /* THE NUMBER ITSELF, NOT THE SHAPE OF THE SENTENCE. A wildcard here passed just as green with
       the correction added instead of subtracted: 60 days old at 33 + 4 printed "3 months old",
       aged UP by six weeks, the clinical opposite of what the line is for. 60 days minus the 45
       days of correction is 15, and 15 days is two weeks. */
    ok('the corrected age is the corrected age, to the word',
      r.text.indexOf('Corrected age today: 2 weeks old, counted from the due date') >= 0, r.lines);
    // And it must read younger than the age printed four lines above it, never older.
    ok('and it is younger than the age at the top of the same page', r.text.indexOf('Robin (1 month old)') >= 0, r.text.slice(0, 200));
    // Context, not an event in the window: it belongs with the date of birth, above the counting.
    const iB = r.text.indexOf('Born at 33'), iW = r.text.indexOf('Window:');
    ok('and it sits with the date of birth, above the window', iB >= 0 && iW > iB, { iB: iB, iW: iW });
  }

  console.log('\n10. a term baby is never aged down, and an unknown gestation says nothing');
  {
    const birth = now - 60 * DAY;
    await load(seed({
      babies: [{ id: 'b1', name: 'Robin', birth: birth, sex: 'F', gestWeeks: 41, gestDays: 2, routines: [], doctors: [], allergies: [] }],
      events: [bwEvent(birth, 3.6)],
    }));
    let r = await page.evaluate(() => ({ text: visitSummary(7), lines: birthHistoryLines(state.babies[0]) }));
    ok('a 41 + 2 baby still gets the gestation', /Born at 41 weeks \+ 2 days/.test(r.text), r.lines);
    ok('and is never given a corrected age', /Corrected age/.test(r.text) === false, r.lines);
    // 37 + 0 is the line the whole app draws, and it is the one worth pinning: a baby two days
    // early must not be told her chart counts from a due date nought weeks after she arrived.
    await load(seed({ babies: [{ id: 'b1', name: 'Robin', birth: birth, sex: 'F', gestWeeks: 37, gestDays: 0, routines: [], doctors: [], allergies: [] }] }));
    r = await page.evaluate(() => ({ text: visitSummary(7), lines: birthHistoryLines(state.babies[0]) }));
    ok('37 + 0 is term and gets no correction', /Corrected age/.test(r.text) === false, r.lines);
    ok('but the gestation is still stated', /Born at 37 weeks$/m.test(r.text), r.lines);
    await load(seed());
    r = await page.evaluate(() => ({ text: visitSummary(7), lines: birthHistoryLines(state.babies[0]) }));
    ok('with nothing recorded, the block is silent', r.lines.length === 0, r.lines);
    ok('and the summary invents no birth line', /Born at|Birth weight|Corrected age/.test(r.text) === false, r.text.slice(0, 300));
  }

  console.log('\n11. the free line is one line, survives being closed on, and an emptied one is a deletion');
  {
    const birth = now - 60 * DAY;
    await load(seed({ babies: [{ id: 'b1', name: 'Robin', birth: birth, sex: 'F', gestWeeks: 33, gestDays: 4, routines: [], doctors: [], allergies: [] }] }));
    let r = await page.evaluate(() => {
      openDoctor();
      const el = document.getElementById('bhNote');
      el.value = ' Emergency section,\n nine days in special care. ';
      el.dispatchEvent(new Event('input'));
      return { stored: state.babies[0].birthNote, text: visitSummary(7) };
    });
    ok('the note is stored on one line', r.stored === 'Emergency section, nine days in special care.', r.stored);
    ok('and it prints under the birth', r.text.indexOf('Emergency section, nine days in special care.') >= 0, r.text.slice(0, 400));
    // The write is coalesced, so give it its moment before pulling the page out from under it.
    await sleep(500);
    const onDisk = await page.evaluate(() => (JSON.parse(localStorage.getItem('little-log-v1') || '{}').babies || [{}])[0].birthNote);
    ok('and it reached the disk without a blur', onDisk === 'Emergency section, nine days in special care.', onDisk);
    await page.reload({ waitUntil: 'networkidle2' }); await sleep(1200);
    r = await page.evaluate(() => {
      openDoctor();
      const el = document.getElementById('bhNote');
      const kept = el.value;
      el.value = '   ';
      el.dispatchEvent(new Event('input'));
      return { kept: kept, stored: state.babies[0].birthNote, lines: birthHistoryLines(state.babies[0]) };
    });
    ok('it survived the reload and came back into the box', r.kept === 'Emergency section, nine days in special care.', r.kept);
    ok('emptying it deletes it rather than storing a space', r.stored === undefined, r.stored);
    ok('the block keeps its two derived lines', r.lines.length === 2 && r.lines[0].indexOf('Born at') === 0, r.lines);
    ok('the deleted note is gone from it', r.lines.some((l) => /Emergency/.test(l)) === false, r.lines);
    ok('and no blank line is left behind', r.lines.filter((l) => !String(l).trim()).length === 0, r.lines);
    /* THE X, THE SCRIM AND THE DRAG-DOWN. closeSheet hides the sheet without blurring anything, so
       a note saved on change alone was thrown away by every dismissal that is not a tap on another
       field. This is the one field in the app with no Save button under it, and the sentence it
       holds is the one a mother types about the fortnight her baby spent on oxygen. Typed with a
       real keystroke, then closed, then reloaded: nothing here is a synthetic event. */
    await page.evaluate(() => { delete state.babies[0].birthNote; persist(); openDoctor(); });
    /* The sheet animates in, and a node with no layout box yet has no clickable point, so a bare
       page.click here dies with "not clickable" and takes the whole run with it. Wait for the field
       to exist AND scroll it into view: Cubby scrolls inside its own container, so a field below
       the fold is present in the DOM and still unclickable. */
    await tapEl('#bhNote');
    await page.keyboard.type('Two nights in special care');
    await page.evaluate(() => closeSheet());
    const afterClose = await page.evaluate(() => ({ inMem: state.babies[0].birthNote, focus: document.activeElement.id }));
    ok('a note typed and then closed on is still held', afterClose.inMem === 'Two nights in special care', afterClose);
    await sleep(500);
    await page.reload({ waitUntil: 'networkidle2' }); await sleep(1200);
    const afterReload = await page.evaluate(() => { openDoctor(); return { stored: state.babies[0].birthNote, box: document.getElementById('bhNote').value, lines: birthHistoryLines(state.babies[0]) }; });
    ok('and it is still there tomorrow', afterReload.stored === 'Two nights in special care', afterReload);
    ok('back in its box where she left it', afterReload.box === 'Two nights in special care', afterReload);
    ok('and on the page the doctor reads', afterReload.lines.indexOf('Two nights in special care') >= 0, afterReload.lines);
    /* The note lives in an input, so it is never ALSO printed as read-only text above the box.
       Counted rather than merely labelled: innerText carries no input values, so the number that
       proves it is zero, and the box must hold it at the same time. */
    const twice = await page.evaluate(() => {
      state.babies[0].birthNote = 'Home on oxygen for a fortnight.'; persist(); openDoctor();
      const s = document.getElementById('sheet');
      const shown = (s.innerText.match(/Home on oxygen for a fortnight\./g) || []).length;
      return { shown: shown, inBox: document.getElementById('bhNote').value };
    });
    ok('the note is in its box', twice.inBox === 'Home on oxygen for a fortnight.', twice);
    ok('and is not repeated as read-only text above it', twice.shown === 0 && twice.inBox.length > 0, twice);
  }

  console.log('\n12. the printed report: the agenda first, the birth next, and nothing said twice');
  {
    const birth = now - 60 * DAY;
    await load(seed({
      babies: [{ id: 'b1', name: 'Robin', birth: birth, sex: 'F', gestWeeks: 33, gestDays: 4, routines: [], doctors: [], allergies: [],
        birthNote: 'Home on oxygen for a fortnight.',
        askQs: [{ id: 'q1', text: 'Why is she pulling at her ear?', done: false }, { id: 'q2', text: 'Already asked last time', done: true }] }],
      events: [bwEvent(birth, 1.9), { id: 'f1', type: 'feed', babyId: 'b1', method: 'bottle', amount: 120, unit: 'ml', time: now - 2 * HOUR }],
      illnesses: [{ id: 'i1', babyId: 'b1', name: 'Chest cold', startedAt: now - 3 * DAY }],
    }));
    /* openDoctorReport hands the page to a new tab (or, natively, to the share sheet), so the html
       is intercepted here rather than chased across a window. The taste gate is stepped over the
       same way the Pro user steps over it: this is a test of what the page SAYS. */
    const html = await page.evaluate(() => {
      let out = null;
      const realPrintable = window.openPrintable, realTaste = window.useTaste;
      window.openPrintable = (h) => { out = h; };
      window.useTaste = () => true;
      try { openDoctorReport(); } finally { window.openPrintable = realPrintable; window.useTaste = realTaste; }
      return out;
    });
    const strip = (h) => (h || '').replace(/<[^>]+>/g, '\n');
    const txt = strip(html);
    ok('the report was generated', !!html && html.length > 400, (html || '').slice(0, 120));
    ok('it has a Things to ask heading', /Things to ask/.test(txt), txt.slice(0, 300));
    ok('with the open question in it', txt.indexOf('Why is she pulling at her ear?') >= 0, txt.slice(0, 600));
    // Counted, not merely absent: "nothing happened" is not proof a rule fired.
    const nTicked = (txt.match(/Already asked last time/g) || []).length;
    ok('and the question already asked left off entirely', nTicked === 0, nTicked);
    const nQ = (txt.match(/Why is she pulling at her ear\?/g) || []).length;
    ok('the open question appears exactly once on the whole page', nQ === 1, nQ);
    ok('there is a Birth history heading', /Birth history/.test(txt), txt.slice(0, 400));
    const nBw = (txt.match(/Birth weight: 1\.9 kg/g) || []).length;
    ok('the birth weight is printed exactly once', nBw === 1, nBw);
    const nGest = (txt.match(/Born at 33 weeks \+ 4 days/g) || []).length;
    ok('the gestation exactly once', nGest === 1, nGest);
    const nNote = (txt.match(/Home on oxygen for a fortnight\./g) || []).length;
    ok('the family\'s own birth line exactly once', nNote === 1, nNote);
    // Reading order: agenda, then the birth it is all read through, then the episode, then the
    // fortnight. Each of these was argued for in the file; this is the assertion that keeps them.
    const iAsk = txt.indexOf('Things to ask'), iBirth = txt.indexOf('Birth history'),
      iIll = txt.indexOf('Illness'), iF = txt.indexOf('Last 14 days');
    ok('the agenda is above the birth history', iAsk >= 0 && iBirth > iAsk, { iAsk: iAsk, iBirth: iBirth });
    ok('the birth history is above the illness', iIll > iBirth, { iBirth: iBirth, iIll: iIll });
    ok('and the illness is still above the fortnight', iF > iIll, { iIll: iIll, iF: iF });
    ok('the fortnight itself still has its numbers', /Feeds: 1 total/.test(txt), txt.slice(-800));
  }

  console.log('\n13. the report for a baby with neither questions nor a birth on file');
  {
    await load(seed({ events: [{ id: 'f1', type: 'feed', babyId: 'b1', method: 'bottle', amount: 120, unit: 'ml', time: now - 2 * HOUR }] }));
    const html = await page.evaluate(() => {
      let out = null;
      const realPrintable = window.openPrintable, realTaste = window.useTaste;
      window.openPrintable = (h) => { out = h; };
      window.useTaste = () => true;
      try { openDoctorReport(); } finally { window.openPrintable = realPrintable; window.useTaste = realTaste; }
      return out;
    });
    const txt = (html || '').replace(/<[^>]+>/g, '\n');
    ok('the report still generates', !!html && html.length > 400, (html || '').slice(0, 120));
    ok('with no empty Things to ask heading', /Things to ask/.test(txt) === false, txt.slice(0, 400));
    ok('and no empty Birth history heading', /Birth history/.test(txt) === false, txt.slice(0, 400));
    ok('the fortnight is still there', /Last 14 days/.test(txt) && /Feeds: 1 total/.test(txt), txt.slice(0, 400));
    /* Both absences above are true of a build with neither block in it. Give the same baby one
       question and one gestation and ask again: now the absences mean "suppressed when empty"
       rather than "never built". */
    const txt2 = await page.evaluate(() => {
      openDoctor(); addAskQ('Is the cough worth a look?');
      state.babies[0].gestWeeks = 33; state.babies[0].gestDays = 4; persist();
      let out = null;
      const rp = window.openPrintable, rt = window.useTaste;
      window.openPrintable = (h) => { out = h; }; window.useTaste = () => true;
      try { openDoctorReport(); } finally { window.openPrintable = rp; window.useTaste = rt; }
      return (out || '').replace(/<[^>]+>/g, '\n');
    });
    ok('one question and one gestation later, both headings are back', /Things to ask/.test(txt2) && /Birth history/.test(txt2), txt2.slice(0, 500));
  }

  console.log('\n14. the sheet reads calmly at 390px');
  {
    await load(seed({
      babies: [{ id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', gestWeeks: 33, gestDays: 4, routines: [], doctors: [], allergies: [],
        birthNote: 'Home on oxygen for a fortnight.', askQs: [{ id: 'q1', text: 'Why is she pulling at her ear?', done: false }] }],
      events: [bwEvent(now - 60 * DAY, 1.9)],
    }));
    await page.evaluate(() => openDoctor());
    await sleep(400);
    const t = await sheetText();
    ok('the section is titled Things to ask', /Things to ask/i.test(t), t.slice(0, 400));
    ok('and Birth history', /Birth history/i.test(t), t.slice(0, 600));
    // No verdict, no target, no colour-coded number anywhere near a birth weight of 1.9 kg.
    ok('nothing on it scores or ranks the baby', /low|small|below average|concern|risk|abnormal/i.test(t) === false, t.slice(0, 900));
    const wide = await page.evaluate(() => {
      const s = document.getElementById('sheet');
      return { over: s.scrollWidth - s.clientWidth, doc: document.documentElement.scrollWidth - 390 };
    });
    ok('the sheet does not scroll sideways', wide.over <= 1, wide);
    ok('and neither does the page', wide.doc <= 1, wide);
  }

  console.log('\n15. before the due date, a born baby is never told she is due soon');
  {
    /* THE HOLE THE 60-DAY FIXTURE ABOVE SITS PAST. ageString answers a future timestamp with the
       literal string "due soon", written for the pregnancy side, and the corrected timestamp is in
       the future for the whole of the first (280 minus gestation) days of life: six and a half
       weeks for a 33 + 4, twelve for a 28-weeker, sixteen for a 24-weeker. That window is the NICU
       stay and the first paediatric follow-ups, which is the entire population this block exists
       for. Unguarded, the page told the mother of a living ten-day-old that she was due soon, four
       lines under "1 week old", on the sheet AND on the printed report AND in the copyable text. */
    const cases = [
      { g: 24, d: 0, age: 7, cd: 112 },
      { g: 28, d: 0, age: 30, cd: 84 },
      { g: 31, d: 2, age: 3, cd: 61 },
      { g: 33, d: 4, age: 20, cd: 45 },
      { g: 33, d: 4, age: 44, cd: 45 },   // one day short of the due date: the last day it can bite
    ];
    for (const c of cases) {
      const birth = now - c.age * DAY;
      await load(seed({
        babies: [{ id: 'b1', name: 'Robin', birth: birth, sex: 'F', gestWeeks: c.g, gestDays: c.d, routines: [], doctors: [], allergies: [] }],
        events: [bwEvent(birth, 1.1)],
      }));
      const r = await page.evaluate((cd) => {
        openDoctor();
        let out = null;
        const rp = window.openPrintable, rt = window.useTaste;
        window.openPrintable = (h) => { out = h; }; window.useTaste = () => true;
        try { openDoctorReport(); } finally { window.openPrintable = rp; window.useTaste = rt; }
        const due = state.babies[0].birth + cd * 86400000;
        return { lines: birthHistoryLines(state.babies[0]), text: visitSummary(7),
          sheet: document.getElementById('sheet').innerText,
          report: (out || '').replace(/<[^>]+>/g, '\n'),
          dueStr: new Date(due).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) };
      }, c.cd);
      const tag = c.age + 'd old, born ' + c.g + ' + ' + c.d;
      // Four surfaces at once, because the string reached every one of them.
      const anywhere = /due soon/i.test(r.lines.join(' ')) || /due soon/i.test(r.text) || /due soon/i.test(r.sheet) || /due soon/i.test(r.report);
      ok(tag + ': nothing anywhere says due soon', anywhere === false, r.lines);
      ok(tag + ': the due date is named instead', r.lines.some((l) => l.indexOf('Due date: ' + r.dueStr + '. Corrected age counts from there.') === 0), r.lines);
      ok(tag + ': and it is on the page the doctor reads', r.report.indexOf('Due date: ' + r.dueStr) >= 0, r.report.slice(0, 500));
      // Still a born baby with a gestation and a birth weight: the guard suppresses one line, not the block.
      ok(tag + ': the gestation and the birth weight still print', /Born at /.test(r.lines[0]) && r.lines.some((l) => /Birth weight: 1\.1 kg/.test(l)), r.lines);
    }
    // And the day the due date arrives, it flips to the corrected age and stays there.
    {
      const birth = now - 45 * DAY;
      await load(seed({ babies: [{ id: 'b1', name: 'Robin', birth: birth, sex: 'F', gestWeeks: 33, gestDays: 4, routines: [], doctors: [], allergies: [] }] }));
      const r = await page.evaluate(() => birthHistoryLines(state.babies[0]));
      ok('on the due date itself it is a corrected age, not a due date', r.indexOf('Corrected age today: 0 days old, counted from the due date') >= 0, r);
      ok('and the due date line is gone', r.some((l) => l.indexOf('Due date:') === 0) === false, r);
    }
  }

  console.log('\n16. real fingers: a keystroke, a chip, the Add button and the trash');
  {
    await load(seed());
    await page.evaluate(() => openDoctor());
    /* ENTER DESTROYS THE BOX IT WAS PRESSED IN. paintAskBlock rewrites the block's innerHTML, so
       focus landed on BODY and the mobile keyboard dropped: the second question of a run was typed
       into nothing. Setting .value directly, which is all the sections above do, cannot see this. */
    await tapEl('#aqNew');
    await page.keyboard.type('Why is she pulling at her ear?');
    await page.keyboard.press('Enter');
    let r = await page.evaluate(() => ({ stored: (state.babies[0].askQs || []).map((q) => q.text), focus: document.activeElement.id, box: (document.getElementById('aqNew') || {}).value }));
    ok('a question typed with real keys and Enter is stored', r.stored.length === 1 && r.stored[0] === 'Why is she pulling at her ear?', r);
    ok('the box is still the thing she is typing in', r.focus === 'aqNew', r);
    ok('and it is empty, ready for the next one', r.box === '', r);
    // Straight on to the second one without touching the screen again. This is what went nowhere.
    await page.keyboard.type('Is the rash worth a look?');
    await page.keyboard.press('Enter');
    r = await page.evaluate(() => ({ stored: (state.babies[0].askQs || []).map((q) => q.text) }));
    ok('the second question, typed straight after, lands too', r.stored.length === 2 && r.stored[1] === 'Is the rash worth a look?', r);
    // The Add button, for the parent who never learns that Enter was the gesture.
    await tapEl('#aqNew');
    await page.keyboard.type('Does she need the vitamin drops?');
    await tapEl('#aqAdd');
    r = await page.evaluate(() => ({ stored: (state.babies[0].askQs || []).map((q) => q.text), box: document.getElementById('aqNew').value }));
    ok('the Add button adds it too', r.stored.length === 3 && r.stored[2] === 'Does she need the vitamin drops?', r);
    ok('and clears the box behind it', r.box === '', r);
    // A chip is a tap, not a function call: section 3 reads their text and never presses one.
    const chipText = await page.evaluate(() => document.querySelector('#sheet .chip-row .chip').textContent.trim());
    await tapEl('#sheet .chip-row .chip');
    r = await page.evaluate(() => ({ stored: (state.babies[0].askQs || []).map((q) => q.text), rows: document.querySelectorAll('#sheet .bag-row').length }));
    ok('tapping a chip puts its exact words on the list', r.stored.length === 4 && r.stored[3] === chipText, { chipText: chipText, stored: r.stored });
    ok('and the row is on screen', r.rows === 4, r);
    /* THE ONLY DESTRUCTIVE CONTROL IN THE NEW UI, and nothing had ever pressed it. */
    const doomed = await page.evaluate(() => state.babies[0].askQs[1].id);
    await tapEl('#aq-' + doomed + ' .bg-x');
    r = await page.evaluate(() => ({ stored: (state.babies[0].askQs || []).map((q) => q.text), rows: document.querySelectorAll('#sheet .bag-row').length, text: visitSummary(7) }));
    ok('the trash removes exactly one question', r.stored.length === 3 && r.stored.indexOf('Is the rash worth a look?') < 0, r.stored);
    ok('the other three are untouched', r.stored[0] === 'Why is she pulling at her ear?' && r.rows === 3, r);
    ok('and the deleted one stops printing', r.text.indexOf('Is the rash worth a look?') < 0, r.text.slice(0, 400));
    /* THE SHARED LIST. app.babies is a whole-array field write, so a snapshot arriving from the
       other parent while this sheet is open must not be flattened by the next thing typed here.
       The list is re-read from state at write time rather than closed over at render time. */
    const merged = await page.evaluate(() => {
      openDoctor();
      state.babies[0].askQs = state.babies[0].askQs.concat([{ id: 'remote1', text: 'Added by her partner', done: false }]);
      addAskQ('Typed here a moment later');
      return (state.babies[0].askQs || []).map((q) => q.text);
    });
    ok('a question arriving from the other parent is not overwritten by the next one typed here',
      merged.indexOf('Added by her partner') >= 0 && merged.indexOf('Typed here a moment later') >= 0 && merged.length === 5, merged);
  }

  console.log('\n17. the words: her baby has a name, and the page promises only what it does');
  {
    await load(seed({ babies: [{ id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', gestWeeks: 33, gestDays: 4, routines: [], doctors: [], allergies: [] }] }));
    const r = await page.evaluate(() => {
      openDoctor();
      return { text: document.getElementById('sheet').innerText.replace(/\s+/g, ' ').trim(),
        chips: [].map.call(document.querySelectorAll('#sheet .chip-row .chip'), (c) => c.textContent.trim()),
        nameless: askSuggestions({ name: '' }) };
    });
    /* SHE IS NOT "THEM". The strip two inches up says "Robin's care team" and the question the
       mother types herself says Robin; a canned chip that says "them" reads as somebody else's
       baby, on the one list she reads out loud in the room. */
    ok('every suggestion says her name', r.chips.length === 3 && r.chips.every((c) => /Robin/.test(c) || /vaccines/i.test(c)), r.chips);
    ok('and none of them calls her they, them or their', r.chips.every((c) => /\b(they|them|their)\b/i.test(c) === false), r.chips);
    ok('with no name yet, it falls back to their and them', /their/.test(r.nameless[0]) && /they/.test(r.nameless[2]) && /them/.test(r.nameless[3]), r.nameless);
    /* The old third sentence promised that questions "go at the top of the doctor report", which
       the code breaks the second one is ticked, and its "they" read first as the circle members. */
    ok('the intro says the list is shared before it invites her to write on it', /Everyone in your circle sees the same list and can add to it/.test(r.text), r.text.slice(0, 700));
    ok('and promises only the unticked ones reach the report', /anything still unticked goes at the top of the doctor report/.test(r.text), r.text.slice(0, 700));
    ok('the broken promise is gone', /they go at the top of the doctor report/.test(r.text) === false, r.text.slice(0, 700));
    // "Tick them off as you go" three lines up. One gesture, one verb, and Cubby is en-GB.
    const reset = await page.evaluate(() => { openDoctor(); toggleAskQ((addAskQ('Which vaccines are next?'), state.babies[0].askQs[0].id)); return document.getElementById('sheet').innerText; });
    ok('the reset button says untick, matching tick them off', /Untick all for next visit/.test(reset), reset.slice(0, 900));
    ok('and never uncheck', /Uncheck/i.test(reset) === false, reset.slice(0, 900));
    // The pregnancy list shares this string. Two lists, one word, or they disagree in the same app.
    const src = await page.evaluate(async () => (await fetch('/app/index.html')).text());
    ok('the pregnancy list says the same word', src.indexOf('Uncheck all') < 0 && (src.match(/Untick all for next visit/g) || []).length === 2, (src.match(/Untick all for next visit/g) || []).length);
    // "you have already given" is addressed to whoever filled the profile, and a partner did not.
    ok('the birth block is described without accusing the reader of filling it in', /Built from the birth details already in Robin's profile/.test(r.text), r.text.slice(0, 1200));
    ok('and the old second-person version is gone', /you have already given/.test(r.text) === false, r.text.slice(0, 1200));
    // The report's provenance claim: four of these can be Cubby's own chips, tapped once.
    const rep = await page.evaluate(() => {
      openDoctor(); addAskQ('Why is she pulling at her ear?');
      let out = null; const rp = window.openPrintable, rt = window.useTaste;
      window.openPrintable = (h) => { out = h; }; window.useTaste = () => true;
      try { openDoctorReport(); } finally { window.openPrintable = rp; window.useTaste = rt; }
      return (out || '').replace(/<[^>]+>/g, '\n');
    });
    ok('the report claims only that the family wrote the questions down', /Written down by the family before this visit\./.test(rep), rep.slice(0, 600));
    ok('not that the words are their own', /in their own words/.test(rep) === false, rep.slice(0, 600));
  }

  console.log('\n18. the empty birth block is a door, not an instruction, and 320px still reads');
  {
    await load(seed());
    let r = await page.evaluate(() => {
      openDoctor();
      const t = document.getElementById('sheet').innerText.replace(/\s+/g, ' ').trim();
      const add = document.getElementById('bhAdd');
      const chip = document.querySelector('#sheet .chip-row'), box = document.getElementById('aqNew');
      return { text: t, hasAdd: !!add, addText: add ? add.innerText.replace(/\s+/g, ' ').trim() : '',
        // 4 === DOCUMENT_POSITION_FOLLOWING: the chips come before the blank box, not under it.
        chipsFirst: !!(chip && box) && (chip.compareDocumentPosition(box) & 4) > 0 };
    });
    /* It used to describe a thing that did not exist, with no way to make it exist, and said
       "anything ELSE" when there was nothing yet. */
    ok('the empty block offers the sheet that fills it', r.hasAdd === true, r);
    ok('and names it in her baby\'s terms', /Add Robin's birth details/.test(r.addText) && /Weeks at birth and birth weight/.test(r.addText), r.addText);
    ok('the old dead-end instruction is gone', /on their profile/.test(r.text) === false, r.text.slice(0, 1400));
    // With nothing on the list yet, the offer sits above the blank box rather than under it.
    ok('and the suggestion chips come before the empty box', r.chipsFirst === true, r);
    // The door actually opens: gestation and birth weight are both in openBirthDetails.
    await tapEl('#bhAdd');
    await sleep(300);
    r = await page.evaluate(() => ({ gest: !!document.getElementById('dGw'), wt: !!document.getElementById('dWt'), back: !!document.querySelector('#sheet .sheet-back') }));
    ok('tapping it opens the sheet holding the weeks at birth', r.gest === true, r);
    ok('and the birth weight beside it', r.wt === true, r);
    ok('with a way back to the care team', r.back === true, r);
    /* 320px WAS EYEBALLED IN SCREENSHOTS AND NEVER ASSERTED. The report claimed it; the file had
       one setViewport, at 390. The Add button and the name-carrying chips are both new width. */
    await page.setViewport({ width: 320, height: 720 });
    await load(seed({
      babies: [{ id: 'b1', name: 'Anneliese', birth: now - 20 * DAY, sex: 'F', gestWeeks: 28, gestDays: 0, routines: [], doctors: [], allergies: [],
        birthNote: 'Home on oxygen for a fortnight.', askQs: [{ id: 'q1', text: 'Why is she pulling at her ear?', done: false }] }],
      events: [bwEvent(now - 20 * DAY, 1.1)],
    }));
    await page.evaluate(() => openDoctor());
    await sleep(400);
    const w = await page.evaluate(() => {
      const s = document.getElementById('sheet');
      return { over: s.scrollWidth - s.clientWidth, doc: document.documentElement.scrollWidth - 320,
        row: Math.max.apply(null, [].map.call(s.querySelectorAll('.bag-row, .chip, .set-item, #aqNew'), (n) => n.getBoundingClientRect().right)) };
    });
    ok('at 320px the sheet does not scroll sideways', w.over <= 1, w);
    ok('nor does the page', w.doc <= 1, w);
    ok('and nothing on it reaches past the right edge', w.row <= 320.5, w);
    await page.setViewport({ width: 390, height: 844 });
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'THINGS-TO-ASK: FAIL' : 'THINGS-TO-ASK: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
