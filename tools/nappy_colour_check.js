#!/usr/bin/env node
/* A DIRTY NAPPY WAS ONE UNDIFFERENTIATED BUTTON.
 *
 * What was concretely wrong for a real parent: a mother at three weeks opens a nappy that is pale,
 * putty-coloured, nothing like the others, and Cubby has nowhere for it. The day-five question every
 * midwife asks ("what colour are they by now?") could not be answered from the log either. So the
 * one observation whose value is entirely in its DATE, the pale or chalky stool that sends a newborn
 * for a liver check while the check is still worth most, lived only in a parent's memory of a week
 * she will not remember clearly.
 *
 * This gate holds the four things that make that real rather than decorative:
 *   the colour only ever rides on a nappy that had a stool in it, and only on one baby,
 *   the pale one is answered with a sentence and a named person to show it to, not a toast,
 *   the chips go at six weeks but everything recorded before then still prints for the doctor,
 *   and a colour is correctable, including back to nothing, without deleting the entry.
 *
 *   PORT=9437 node tools/serve.js &
 *   node tools/nappy_colour_check.js http://localhost:9437
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:9437';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, HOUR = 3600000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

// 10:00, so nothing in here depends on which side of midnight the gate is run.
const CLOCK = (() => { const d = new Date(); d.setHours(10, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

// Twenty days old: inside the six-week window every one of these tests lives in unless it says so.
const seed = (over) => Object.assign({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 20 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
  activeBabyId: 'b1', events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
}, over || {});

const twins = (over) => seed(Object.assign({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 20 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] },
    { id: 'b2', name: 'Wren', birth: now - 20 * DAY, sex: 'M', routines: [], doctors: [], allergies: [] }],
}, over || {}));

/* THE ORDINARY HOUSEHOLD, and the one this gate was blind to: a newborn and an older sibling. Twins
 * share a birthday, so with only the fixture above the baby on screen and the baby being logged for
 * can never be different ages and every window check passes for free. Ida is three; Wren is five
 * days old. `who` is who the app is sitting on, because that is the whole variable. */
const mixed = (whoId, over) => seed(Object.assign({
  babies: [{ id: 'b1', name: 'Ida', birth: now - 1100 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] },
    { id: 'b2', name: 'Wren', birth: now - 5 * DAY, sex: 'M', routines: [], doctors: [], allergies: [] }],
  activeBabyId: whoId,
}, over || {}));

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

  console.log('\n1. the sheet offers the colour, and it saves with the nappy she taps');
  {
    await load(seed());
    const r = await page.evaluate(() => {
      openDiaper();
      const s = document.getElementById('sheet');
      const chips = [...s.querySelectorAll('.chip[data-c]')];
      return { n: chips.length, keys: chips.map((c) => c.getAttribute('data-c')),
        words: chips.map((c) => c.textContent.trim()),
        hint: (s.innerText || '').replace(/\s+/g, ' ') };
    });
    ok('four colour chips, no more', r.n === 4, r);
    ok('dark, green, yellow and pale or chalky', JSON.stringify(r.keys) === JSON.stringify(['dark', 'green', 'yellow', 'pale']), r.keys);
    ok('the pale one is spelled out in the words a parent would use', /pale or chalky/i.test(r.words.join('|')), r.words);
    ok('the hint says which taps it rides on, because those taps are the save button', /dirty or both/i.test(r.hint), r.hint.slice(0, 220));
    // Plain second-person English is the house voice. "unpick" appears nowhere else in the codebase
    // and in British English is mostly about stitching.
    ok('and says how to take it back in the app\'s own words', /tap it again to clear it/i.test(r.hint) && !/unpick/i.test(r.hint), r.hint.slice(0, 220));
    const r2 = await page.evaluate(() => {
      document.querySelector('.chip[data-c="green"]').click();
      const sel = [...document.querySelectorAll('.chip[data-c]')].filter((c) => c.classList.contains('sel')).map((c) => c.getAttribute('data-c'));
      return { sel, draft: diaperDraft.colour };
    });
    ok('tapping green picks exactly one chip', r2.sel.length === 1 && r2.sel[0] === 'green', r2);
    const r3 = await page.evaluate(() => {
      saveDiaper('dirty');
      const d = state.events.filter((e) => e.type === 'diaper');
      return { n: d.length, colour: d[0] && d[0].colour, kind: d[0] && d[0].kind,
        toast: (document.getElementById('toast').textContent || '').replace(/\s+/g, ' ').trim(),
        sheetOpen: document.getElementById('sheet').classList.contains('show'), draft: diaperDraft.colour };
    });
    ok('one nappy is written', r3.n === 1, r3);
    ok('and it carries the colour', r3.colour === 'green', r3);
    ok('the toast says so, in the same word she tapped', /green/.test(r3.toast), r3.toast);
    ok('a green one gets a pill and nothing more', r3.sheetOpen === false, r3);
    ok('and the draft is cleared, so the next nappy starts blank', r3.draft === '', r3);
  }

  console.log('\n2. tapping the picked chip again unpicks it');
  {
    await load(seed());
    const r = await page.evaluate(() => {
      openDiaper();
      document.querySelector('.chip[data-c="yellow"]').click();
      const on = diaperDraft.colour;
      document.querySelector('.chip[data-c="yellow"]').click();
      const off = diaperDraft.colour;
      const sel = [...document.querySelectorAll('.chip[data-c]')].filter((c) => c.classList.contains('sel')).length;
      saveDiaper('dirty');
      const d = state.events.filter((e) => e.type === 'diaper');
      return { on, off, sel, has: 'colour' in (d[0] || {}), n: d.length };
    });
    ok('the second tap clears it', r.on === 'yellow' && r.off === '', r);
    ok('and no chip is left looking picked', r.sel === 0, r);
    ok('the saved nappy keeps the shape it always had, with no colour key at all', r.has === false && r.n === 1, r);
  }

  console.log('\n3. a pale or chalky one is answered with a sentence, not a pill');
  {
    await load(seed());
    const r = await page.evaluate(() => {
      openDiaper();
      document.querySelector('.chip[data-c="pale"]').click();
      saveDiaper('dirty');
      const s = document.getElementById('sheet');
      const t = (s.innerText || '').replace(/\s+/g, ' ');
      const d = state.events.filter((e) => e.type === 'diaper');
      return { open: s.classList.contains('show'), t, colour: d[0] && d[0].colour, n: d.length,
        buttons: [...s.querySelectorAll('button')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()) };
    });
    ok('the entry is written first, whatever happens next', r.n === 1 && r.colour === 'pale', r);
    ok('a sheet comes up instead of a four-word toast', r.open === true, r);
    ok('it names people who can look at it today', /midwife/i.test(r.t) && /health visitor/i.test(r.t) && /doctor/i.test(r.t), r.t.slice(0, 300));
    ok('and says today, so the timing is not left to her to judge', /today/i.test(r.t), r.t.slice(0, 300));
    ok('it tells her the practical thing: keep it or photograph it', /photo/i.test(r.t), r.t.slice(0, 300));
    ok('it opens the door to the doctor summary', r.buttons.some((b) => /summary for the doctor/i.test(b)), r.buttons);
    ok('it says outright it is not medical advice', /not medical advice/i.test(r.t), r.t.slice(0, 400));
    // The Anxiety Test, as a string search. No verdict, no score, no scare word, and the condition
    // being ruled out is never named at a parent who has not been told she has anything to rule out.
    ok('no alarm words anywhere on it', !/(urgent|emergency|immediately|serious|danger|abnormal|999|911)/i.test(r.t), r.t);
    ok('and it does not name a diagnosis at her', !/(biliary|atresia|liver|jaundice)/i.test(r.t), r.t);
    /* THE REASSURANCE MUST BE ABOUT THE ERRAND, NOT THE FINDING. The jaundice sheet may say
       "usually fades on its own" because that is true of the thing just logged. Pale or chalky is
       the one colour it is not true of, so a sentence like "most of it is nothing" opening this
       sheet reads at 3am as a verdict on her nappy, and it is the verdict that talks her out of the
       call. Any reassuring quantifier about how much of it turns out to be nothing is the failure. */
    ok('it never tells her this one is probably nothing',
      !/(most of it is nothing|usually nothing|probably nothing|nothing to worry|usually fine|nothing in it)/i.test(r.t), r.t);
    ok('the warmth is on how small the ask is, not on the finding', /quick for them to look at/i.test(r.t), r.t.slice(0, 400));
    ok('and it still carries the anti-guilt line', /much rather see it than not/i.test(r.t), r.t.slice(0, 400));
  }

  console.log('\n4. a colour never rides on a nappy that had no stool in it');
  {
    for (const kind of ['wet', 'dry']) {
      await load(seed());
      const r = await page.evaluate((k) => {
        openDiaper();
        document.querySelector('.chip[data-c="pale"]').click();
        const picked = diaperDraft.colour;
        saveDiaper(k);
        const d = state.events.filter((e) => e.type === 'diaper');
        return { picked, n: d.length, has: 'colour' in (d[0] || {}), kind: d[0] && d[0].kind,
          sheetOpen: document.getElementById('sheet').classList.contains('show') };
      }, kind);
      ok(kind + ': she really had picked one', r.picked === 'pale', r);
      ok(kind + ': the nappy is still written', r.n === 1 && r.kind === kind, r);
      ok(kind + ': and it carries no colour', r.has === false, r);
      ok(kind + ': and no pale sheet is raised over a nappy nobody said was pale', r.sheetOpen === false, r);
    }
  }

  console.log('\n5. with twins, a colour goes on one baby or on neither');
  {
    await load(twins());
    const r = await page.evaluate(() => {
      openDiaper();
      targetSetOne('b1'); renderDiaperSheet();
      document.querySelector('.chip[data-c="pale"]').click();
      const kept = diaperDraft.colour;
      targetSetAll(); renderDiaperSheet();
      const s = document.getElementById('sheet');
      return { kept, chips: s.querySelectorAll('.chip[data-c]').length,
        hint: (s.innerText || '').replace(/\s+/g, ' '), draft: diaperDraft.colour };
    });
    ok('picking Both takes the chips away', r.chips === 0, r);
    // The rule is one BABY. She is logging one nappy each, so "belongs to one nappy" is not the
    // reason for anything she is looking at.
    ok('and says why, naming the rule that is actually being applied', /one baby at a time/i.test(r.hint), r.hint.slice(0, 300));
    ok('what she picked is still held on the draft', r.kept === 'pale' && r.draft === 'pale', r);
    const r2 = await page.evaluate(() => {
      saveDiaper('dirty');
      const d = state.events.filter((e) => e.type === 'diaper');
      return { n: d.length, babies: d.map((e) => e.babyId).sort(), withColour: d.filter((e) => e.colour).length,
        sheetOpen: document.getElementById('sheet').classList.contains('show') };
    });
    ok('the nappy still lands on both twins', r2.n === 2 && JSON.stringify(r2.babies) === JSON.stringify(['b1', 'b2']), r2);
    ok('and NEITHER of them is marked pale, because it was one nappy', r2.withColour === 0, r2);
    ok('so no pale sheet is raised either', r2.sheetOpen === false, r2);
    const r3 = await page.evaluate(() => {
      openDiaper();
      targetSetOne('b2'); renderDiaperSheet();
      document.querySelector('.chip[data-c="green"]').click();
      saveDiaper('both');
      const d = state.events.filter((e) => e.type === 'diaper' && e.colour);
      return { n: d.length, baby: d[0] && d[0].babyId, colour: d[0] && d[0].colour };
    });
    ok('back on one name, the colour saves again', r3.n === 1 && r3.colour === 'green', r3);
    ok('on that twin only', r3.baby === 'b2', r3);
  }

  console.log('\n6. the chips are a newborn question and they stop being asked');
  {
    await load(seed({ babies: [{ id: 'b1', name: 'Robin', birth: now - 41 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }] }));
    const r = await page.evaluate(() => {
      openDiaper();
      const s = document.getElementById('sheet');
      return { chips: s.querySelectorAll('.chip[data-c]').length, label: /colour/i.test(s.innerText || '') };
    });
    ok('at 41 days they are still there', r.chips === 4 && r.label === true, r);

    await load(seed({ babies: [{ id: 'b1', name: 'Robin', birth: now - 43 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }] }));
    const r2 = await page.evaluate(() => {
      openDiaper();
      const s = document.getElementById('sheet');
      const before = s.querySelectorAll('.chip[data-c]').length;
      // Read while the nappy sheet is the sheet on screen. Taken after the save it would be reading
      // whatever came next, which is how a passing assertion gets faked.
      const colourWord = /colour/i.test(s.innerText || '');
      // A draft left over from a sheet opened before the line, which is a real six-week morning.
      diaperDraft.colour = 'pale';
      saveDiaper('dirty');
      const d = state.events.filter((e) => e.type === 'diaper');
      return { before, has: 'colour' in (d[0] || {}), n: d.length,
        colourWord, sheetOpen: document.getElementById('sheet').classList.contains('show') };
    });
    ok('at 43 days the chips are gone', r2.before === 0, r2);
    ok('and the word colour is not on the sheet at all', r2.colourWord === false, r2);
    ok('a stale draft cannot smuggle one through', r2.has === false && r2.n === 1, r2);
    ok('and cannot raise the pale sheet either', r2.sheetOpen === false, r2);

    await load(seed({ babies: [{ id: 'b1', name: 'Robin', sex: 'F', routines: [], doctors: [], allergies: [] }] }));
    const r3 = await page.evaluate(() => {
      openDiaper();
      return { chips: document.querySelectorAll('.chip[data-c]').length };
    });
    ok('no birth date means the question is not asked at all', r3.chips === 0, r3);
  }

  console.log('\n7. the timeline row says what was seen, in words');
  {
    await load(seed({ events: [
      { id: 'd1', type: 'diaper', babyId: 'b1', kind: 'dirty', colour: 'pale', time: now - 2 * HOUR, authorId: 'local' },
      { id: 'd2', type: 'diaper', babyId: 'b1', kind: 'dirty', colour: 'green', notes: 'a lot of it', time: now - 5 * HOUR, authorId: 'local' },
      { id: 'd3', type: 'diaper', babyId: 'b1', kind: 'wet', time: now - 6 * HOUR, authorId: 'local' },
    ] }));
    const r = await page.evaluate(() => {
      go('log');
      const rows = [...document.querySelectorAll('.tl-item')];
      return { rows: rows.length, lines: rows.map((x) => (x.querySelector('.t2') || {}).textContent || '') };
    });
    ok('all three nappies are on the timeline', r.rows === 3, r);
    ok('the pale one reads as an observation, not a bare adjective', r.lines.some((l) => /looked pale or chalky/.test(l)), r.lines);
    ok('the colour comes before her own words, and both survive', r.lines.some((l) => /^looked green · a lot of it$/.test(l.trim())), r.lines);
    ok('a plain wet nappy still says nothing at all', r.lines.filter((l) => l.trim() === '').length === 1, r.lines);
  }

  console.log('\n8. the doctor page carries the colour, counted honestly');
  {
    const evs = [
      { id: 'd1', type: 'diaper', babyId: 'b1', kind: 'dirty', colour: 'pale', time: now - 30 * HOUR, authorId: 'local' },
      { id: 'd2', type: 'diaper', babyId: 'b1', kind: 'dirty', colour: 'yellow', time: now - 28 * HOUR, authorId: 'local' },
      { id: 'd3', type: 'diaper', babyId: 'b1', kind: 'both', colour: 'yellow', time: now - 26 * HOUR, authorId: 'local' },
      { id: 'd4', type: 'diaper', babyId: 'b1', kind: 'dirty', time: now - 24 * HOUR, authorId: 'local' },
      { id: 'd5', type: 'diaper', babyId: 'b1', kind: 'wet', time: now - 22 * HOUR, authorId: 'local' },
      { id: 'd6', type: 'diaper', babyId: 'b1', kind: 'dirty', colour: 'pale', time: now - 3 * HOUR, authorId: 'local' },
    ];
    await load(seed({ events: evs }));
    const out = await page.evaluate((t1, t2) => ({ txt: visitSummary(7), first: fmtClock(t1), last: fmtClock(t2) }),
      now - 30 * HOUR, now - 3 * HOUR);
    const r = out.txt;
    const line = (r.split('\n').find((l) => /Dirty nappy colours/.test(l)) || '').trim();
    const paleLine = (r.split('\n').find((l) => /^\s*Pale or chalky/.test(l)) || '').trim();
    ok('there is a colour line under the nappy counts', !!line, r.slice(0, 600));
    ok('yellow is counted twice, across dirty AND both', /yellow 2/.test(line), line);
    ok('pale is counted twice', /pale or chalky 2/.test(line), line);
    ok('the colours nobody looked at are stated, not hidden', /1 not noted/.test(line), line);
    ok('a colour nobody used is left out rather than printed as zero', !/dark/.test(line) && !/green/.test(line), line);
    ok('the pale ones get their dates, because when is the next question', !!paleLine && (paleLine.match(/\d/g) || []).length >= 4, paleLine);
    ok('both pale times are printed, in the clock the rest of the page uses',
      paleLine.indexOf(out.first) > 0 && paleLine.indexOf(out.last) > 0, { paleLine, first: out.first, last: out.last });
    ok('and they are printed oldest first, the order they happened',
      paleLine.indexOf(out.first) < paleLine.indexOf(out.last), { paleLine, first: out.first, last: out.last });
    ok('the wet nappy is not counted as a colour that was missed', !/2 not noted/.test(line), line);

    // Past six weeks the chips are gone. What she recorded at three weeks is still the thing the
    // six-week check asks about, so the page must still carry it. This is where the proposal was
    // wrong: gating the report on the baby's age today would hide it on the day it matters most.
    await load(seed({ babies: [{ id: 'b1', name: 'Robin', birth: now - 56 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }], events: evs }));
    const r2 = await page.evaluate(() => visitSummary(7));
    ok('at eight weeks old the recorded colours still print', /Dirty nappy colours/.test(r2), r2.slice(0, 700));
    ok('including the pale dates', /Pale or chalky/.test(r2), r2.slice(0, 700));
  }

  console.log('\n9. a page with no colours on it says nothing about colour');
  {
    await load(seed({ events: [
      { id: 'd1', type: 'diaper', babyId: 'b1', kind: 'dirty', time: now - 5 * HOUR, authorId: 'local' },
      { id: 'd2', type: 'diaper', babyId: 'b1', kind: 'wet', time: now - 6 * HOUR, authorId: 'local' },
    ] }));
    const r = await page.evaluate(() => visitSummary(7));
    ok('the nappy counts are there as they always were', /Nappies: 2 total/.test(r), r.slice(0, 500));
    ok('and there is no colour line, no "0 noted", nothing', !/colour/i.test(r), r.slice(0, 500));
    // Nothing at all logged. The whole block has to be skipped, not print an empty header.
    await load(seed());
    const r2 = await page.evaluate(() => visitSummary(7));
    ok('an empty log still summarises to the honest sentence', /nothing to summarise/.test(r2), r2.slice(0, 400));
    ok('with no colour line', !/colour/i.test(r2), r2.slice(0, 400));
  }

  console.log('\n10. a mis-tapped colour is correctable, including back to nothing');
  {
    await load(seed({ events: [{ id: 'd1', type: 'diaper', babyId: 'b1', kind: 'dirty', colour: 'pale', time: now - 2 * HOUR, authorId: 'local' }] }));
    const r = await page.evaluate(() => {
      openEdit('d1');
      const row = document.getElementById('eCol');
      const btns = row ? [...row.querySelectorAll('button')] : [];
      return { has: !!row, keys: btns.map((b) => b.getAttribute('data-k')),
        on: btns.filter((b) => b.classList.contains('on')).map((b) => b.getAttribute('data-k')) };
    });
    ok('the edit sheet offers the colour', r.has === true, r);
    ok('with a real way back to nothing, first in the row', JSON.stringify(r.keys) === JSON.stringify(['', 'dark', 'green', 'yellow', 'pale']), r.keys);
    ok('and what was logged is showing as picked', JSON.stringify(r.on) === JSON.stringify(['pale']), r.on);
    const r2 = await page.evaluate(() => {
      document.querySelector('#eCol button[data-k="green"]').click();
      saveEdit('d1');
      const e = state.events.find((x) => x.id === 'd1');
      return { colour: e.colour, hist: (e.history || []).filter((h) => h.field === 'colour'), edited: !!e.editedBy };
    });
    ok('changing it sticks', r2.colour === 'green', r2);
    ok('and the change is on the record, from pale to green', r2.hist.length === 1 && r2.hist[0].from === 'pale' && r2.hist[0].to === 'green', r2);
    ok('the entry is stamped as edited, like every other correction', r2.edited === true, r2);
    const r3 = await page.evaluate(() => {
      openEdit('d1');
      document.querySelector('#eCol button[data-k=""]').click();
      saveEdit('d1');
      const e = state.events.find((x) => x.id === 'd1');
      return { has: 'colour' in e, hist: (e.history || []).filter((h) => h.field === 'colour').length,
        report: visitSummary(7) };
    });
    ok('a second save clears it back to nothing', r3.has === false, r3);
    ok('and that clearing is on the record too', r3.hist === 2, r3);
    ok('the doctor page stops claiming a colour the moment she takes it back', !/colour/i.test(r3.report), r3.report.slice(0, 500));
  }

  console.log('\n11. a nappy corrected to Wet cannot keep its stool colour');
  {
    await load(seed({ events: [{ id: 'd1', type: 'diaper', babyId: 'b1', kind: 'dirty', colour: 'pale', time: now - 2 * HOUR, authorId: 'local' }] }));
    const r = await page.evaluate(() => {
      openEdit('d1');
      document.querySelector('#eKind button[data-k="wet"]').click();
      saveEdit('d1');
      const e = state.events.find((x) => x.id === 'd1');
      // On the log tab, so there is a real row to read. Read from Home the query finds nothing and
      // "no pale on the row" would pass on an empty string for the rest of time.
      go('log');
      const rows = [...document.querySelectorAll('.tl-item')];
      return { kind: e.kind, has: 'colour' in e, hist: (e.history || []).map((h) => h.field).sort(),
        report: visitSummary(7), rows: rows.length,
        row: rows[0] ? ((rows[0].querySelector('.t2') || {}).textContent || '') : null };
    });
    ok('the kind changes as she asked', r.kind === 'wet', r);
    ok('and the pale goes with it, because she is saying there was no stool', r.has === false, r);
    ok('both changes are on the record', JSON.stringify(r.hist) === JSON.stringify(['colour', 'kind']), r.hist);
    ok('the doctor page drops it in the same breath', !/pale/i.test(r.report), r.report.slice(0, 500));
    ok('there is one row on the timeline to read', r.rows === 1, r);
    ok('and it says nothing about pale either', r.row === '', r);
  }

  console.log('\n12. someone else\'s nappy: readable, not editable, never an empty invitation');
  {
    await load(seed({ events: [
      { id: 'd1', type: 'diaper', babyId: 'b1', kind: 'dirty', colour: 'pale', time: now - 2 * HOUR, authorId: 'uidPapa' },
      { id: 'd2', type: 'diaper', babyId: 'b1', kind: 'dirty', time: now - 4 * HOUR, authorId: 'uidPapa' },
    ] }));
    const r = await page.evaluate(() => {
      window.LL = { auth: { currentUser: { uid: 'local' } }, members: { local: 'caregiver', uidPapa: 'caregiver' },
        memberInfo: { local: { name: 'Maya' }, uidPapa: { name: 'Sam' } } };
      openEdit('d1');
      const s = document.getElementById('sheet');
      const row = s.querySelector('#eCol');
      const live = [...s.querySelectorAll('button[data-k]')].filter((b) => !b.disabled);
      return { canEdit: canEditEvent(state.events.find((e) => e.id === 'd1')),
        editable: !!row, txt: (s.innerText || '').replace(/\s+/g, ' '), live: live.length };
    });
    ok('this is genuinely not hers to edit', r.canEdit === false, r);
    ok('what he saw is still on screen for her to read', /pale or chalky/i.test(r.txt), r.txt.slice(0, 300));
    ok('but there is no live toggle to change it with', r.editable === false && r.live === 0, r);
    const r2 = await page.evaluate(() => {
      openEdit('d2');
      const s = document.getElementById('sheet');
      return { colourWord: /colour/i.test(s.innerText || ''), row: !!s.querySelector('#eCol') };
    });
    ok('a nappy he logged with no colour shows no locked empty colour row', r2.row === false && r2.colourWord === false, r2);
  }

  console.log('\n13. it survives the reload, which is the only proof it was ever saved');
  {
    await load(seed());
    await page.evaluate(() => {
      openDiaper();
      document.querySelector('.chip[data-c="pale"]').click();
      saveDiaper('dirty');
    });
    await sleep(300);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1400);
    const r = await page.evaluate(() => {
      go('log');
      const d = state.events.filter((e) => e.type === 'diaper');
      return { n: d.length, colour: d[0] && d[0].colour,
        row: (document.querySelector('.tl-item .t2') || {}).textContent || '',
        report: visitSummary(7) };
    });
    ok('the nappy is still there after a reload', r.n === 1, r);
    ok('with its colour', r.colour === 'pale', r);
    ok('reading the same on the timeline', /looked pale or chalky/.test(r.row), r.row);
    ok('and still on the doctor page', /pale or chalky 1/.test(r.report), r.report.slice(0, 700));
  }

  /* A NEWBORN WITH AN OLDER SISTER. The window has to be measured on the baby the colour will land
   * on, and "Log for" is what decides that. Measured on whoever is on screen instead, this stamped
   * the strongest clinical flag Cubby holds onto a three-year-old, and hid the whole feature from
   * the five-day-old it exists for. Both halves below are taps only: the .tgt chip is clicked, no
   * target function is called, so nothing here depends on the order anything was tapped in. */
  console.log('\n14. the window follows the baby being logged for, not the baby on screen');
  {
    const tapName = (n) => `[...document.querySelectorAll('.tgt')].find(b=>b.textContent.trim()===${JSON.stringify(n)}).click()`;

    // Sitting on the newborn, which is where a family with a newborn leaves the app, and logging
    // the three-year-old's nappy.
    await load(mixed('b2'));
    const r = await page.evaluate(new Function(`
      openDiaper();
      const before = document.querySelectorAll('.chip[data-c]').length;
      document.querySelector('.chip[data-c="pale"]').click();
      const picked = diaperDraft.colour;
      ${tapName('Ida')};
      const s = document.getElementById('sheet');
      const after = s.querySelectorAll('.chip[data-c]').length;
      const colourWord = /colour/i.test(s.innerText || '');
      [...s.querySelectorAll('.opt')].find(o=>o.textContent.trim().indexOf('Dirty')===0).click();
      const d = state.events.filter(e => e.type === 'diaper');
      return { before, picked, after, colourWord, n: d.length, baby: d[0] && d[0].babyId,
        has: 'colour' in (d[0] || {}),
        h2: (document.querySelector('#sheet h2') || {}).textContent || '',
        sheetOpen: document.getElementById('sheet').classList.contains('show') };
    `));
    ok('on the newborn the chips are there', r.before === 4 && r.picked === 'pale', r);
    ok('picking her three-year-old sister takes them away', r.after === 0, r);
    ok('and the word colour goes with them', r.colourWord === false, r);
    ok('the nappy lands on the sister', r.n === 1 && r.baby === 'b1', r);
    ok('carrying NO colour, because she is three', r.has === false, r);
    ok('and no pale sheet is raised over a three-year-old', r.sheetOpen === false && !/Noted/.test(r.h2), r);
    const rRep = await page.evaluate(() => { state.activeBabyId = 'b1'; return visitSummary(14); });
    ok('and her doctor page says nothing about nappy colour', !/colour/i.test(rRep) && !/pale/i.test(rRep), rRep.slice(0, 600));

    // The mirror, same root: sitting on the older sister and logging the newborn.
    await load(mixed('b1'));
    const r2 = await page.evaluate(new Function(`
      openDiaper();
      const before = document.querySelectorAll('.chip[data-c]').length;
      ${tapName('Wren')};
      const after = document.querySelectorAll('.chip[data-c]').length;
      document.querySelector('.chip[data-c="pale"]').click();
      [...document.querySelectorAll('#sheet .opt')].find(o=>o.textContent.trim().indexOf('Dirty')===0).click();
      const d = state.events.filter(e => e.type === 'diaper');
      return { before, after, n: d.length, baby: d[0] && d[0].babyId, colour: d[0] && d[0].colour,
        h2: (document.querySelector('#sheet h2') || {}).textContent || '' };
    `));
    ok('sitting on the three-year-old there are no chips, correctly', r2.before === 0, r2);
    ok('tapping the five-day-old brings them out', r2.after === 4, r2);
    ok('the colour saves, on the newborn', r2.n === 1 && r2.baby === 'b2' && r2.colour === 'pale', r2);
    ok('and the pale sheet comes up for the baby it was written for', /Noted/.test(r2.h2), r2);

    // Same rule on the edit sheet: it is this entry's baby that decides, not the active one.
    await load(mixed('b2', { events: [
      { id: 'x1', type: 'diaper', babyId: 'b1', kind: 'dirty', time: now - 2 * HOUR, authorId: 'local' },
      { id: 'x2', type: 'diaper', babyId: 'b2', kind: 'dirty', time: now - 3 * HOUR, authorId: 'local' },
    ] }));
    const r3 = await page.evaluate(() => {
      openEdit('x1');
      const older = { row: !!document.querySelector('#eCol'), word: /colour/i.test(document.getElementById('sheet').innerText || '') };
      openEdit('x2');
      const baby = { row: !!document.querySelector('#eCol') };
      return { older, baby };
    });
    ok('the sister\'s nappy is not offered a colour to add three years late', r3.older.row === false && r3.older.word === false, r3);
    ok('the newborn\'s is', r3.baby.row === true, r3);
  }

  /* THE CORRECTION PATH. commitEvent drops a repeat of the same shape inside 900ms, and its
   * signature decides what "the same shape" means. Log a dirty nappy, look at it properly, log it
   * again with the colour: two different things a parent said, and the second is the one that
   * matters. Left out of the signature it was swallowed while the app said it had saved. */
  console.log('\n15. "I logged it, then I looked properly" is not a double tap');
  {
    await load(seed());
    const r = await page.evaluate(() => {
      openDiaper(); saveDiaper('dirty');
      const afterFirst = state.events.filter(e => e.type === 'diaper').length;
      openDiaper();
      document.querySelector('.chip[data-c="pale"]').click();
      saveDiaper('dirty');
      const d = state.events.filter(e => e.type === 'diaper');
      return { afterFirst, n: d.length, colours: d.map(e => e.colour || null),
        h2: (document.querySelector('#sheet h2') || {}).textContent || '' };
    });
    ok('the first, colourless one is written', r.afterFirst === 1, r);
    ok('and the corrected one is written too, not swallowed as a slip', r.n === 2, r);
    ok('with the colour on it', r.colours.filter((c) => c === 'pale').length === 1, r);
    ok('and the sheet she is told about it on is a real save', /Noted/.test(r.h2), r);

    // The other side of the same guard: a genuine double tap IS still one nappy, and a sheet saying
    // "Saved with this nappy" must not come up over a write that did not happen.
    await load(seed());
    const r2 = await page.evaluate(() => {
      openDiaper(); document.querySelector('.chip[data-c="pale"]').click(); saveDiaper('dirty');
      const first = { n: state.events.length, h2: (document.querySelector('#sheet h2') || {}).textContent || '' };
      closeSheet();
      openDiaper(); document.querySelector('.chip[data-c="pale"]').click(); saveDiaper('dirty');
      return { first, n: state.events.filter(e => e.type === 'diaper').length,
        open: document.getElementById('sheet').classList.contains('show'),
        h2: (document.querySelector('#sheet h2') || {}).textContent || '' };
    });
    ok('the real one raised the sheet', r2.first.n === 1 && /Noted/.test(r2.first.h2), r2);
    ok('the identical second tap inside the guard writes nothing', r2.n === 1, r2);
    ok('and is not answered with "saved" over a save that never happened', r2.open === false, r2);
  }

  console.log('\n16. the teaching copy says it in the app\'s own words');
  {
    await load(seed());
    const r = await page.evaluate(() => {
      const row = (window.CubbyTeachData && window.CubbyTeachData.rows || {}).openDiaper || {};
      return { how: (row.how || []).join(' | ') };
    });
    ok('the nappy row teaches the colour at all', /colour of a dirty one/i.test(r.how), r.how);
    // "chips" is designer vocabulary; a parent has never been told that word.
    ok('without naming a UI part at a parent', !/chip/i.test(r.how), r.how);
    // The nudge names three people so a family outside the UK community-midwife schedule is not
    // left with nobody. The teaching line should not narrow that back to one.
    ok('and names more than one person she could ask', /midwife or health visitor/i.test(r.how), r.how);
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'NAPPY-COLOUR: FAIL' : 'NAPPY-COLOUR: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
