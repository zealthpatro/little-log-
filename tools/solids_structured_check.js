#!/usr/bin/env node
/* What was wrong for a real parent.
 *
 * SOLID_FOODS tags every food with its allergen, and saveSolids threw the tags away: the whole
 * selection was collapsed to notes = foods.join(', '), a sentence. So the one question months six
 * to twelve is built around, "have we introduced egg yet, when was it, and did anything happen",
 * could not be answered by a log that had recorded the answer forty times. The tag's only job was
 * the other way round, a warning triangle on a food the family had ALREADY reacted to.
 *
 * And three of the nine allergens, peanut, tree nuts and shellfish, had no food carrying them at
 * all. A family watching for peanut got no warning, and peanut, the one most asked about in the
 * first year, could not be recorded as tried by any tap in the app.
 *
 * This gate holds the structural write (payload.foods), the read-only First tastes panel on the
 * Food and allergies sheet, the same block on the doctor page, and the honesty rules around them:
 * a typed sentence is never read as a food, a correction takes the date back, ANNOTATING an entry
 * keeps it, the earliest taste wins, another baby's plate is not this baby's history, a family
 * still on milk is never shown a list of nine, nothing is called "not yet" while the download is
 * still catching up or when the family has declared that allergy, and a taste from a previous year
 * carries its year.
 *
 *   PORT=9427 node tools/serve.js &
 *   node tools/solids_structured_check.js http://localhost:9427
 *
 * The base URL is REQUIRED and the served bytes are sha256'd against this checkout before a single
 * assertion runs: a default port grades whatever another agent happens to have running.
 *
 *   --self-test   run the pure helpers' expectations against known-bad inputs and exit
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const crypto = require('crypto');
const fs = require('fs');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, HOUR = 3600000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

// Midday, so a backdated taste never lands on the wrong side of a date boundary by an hour.
const CLOCK = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;
const YEAR_NOW = new Date(now).getFullYear();
// Sep 22, two calendar years back: a date the panel must print WITH its year.
const LONG_AGO = new Date(YEAR_NOW - 2, 8, 22, 12, 0, 0).getTime();

/* Dates are checked by shape, computed here, never by indexOf on a bare day number: "First tried
 * Sep 2" contains the digit 2 four times over once a year is printed, so a substring test on a
 * single-digit day passes for free on most of the calendar. This wants the month name, the day as
 * a whole number, and the year present or absent exactly as expected. */
const shortMonth = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short' });
const datedOk = (s, t, wantYear) => {
  s = String(s || '');
  const d = new Date(t);
  const dayRe = new RegExp('(^|\\D)' + d.getDate() + '(\\D|$)');
  const hasYear = /(^|\D)(19|20)\d{2}(\D|$)/.test(s);
  return s.indexOf(shortMonth(t)) >= 0 && dayRe.test(s) && hasYear === !!wantYear;
};

if (process.argv.indexOf('--self-test') >= 0) {
  const T = [];
  const t1 = new Date(YEAR_NOW, 8, 2, 12).getTime();   // Sep 2, this year
  T.push(['a right date passes', datedOk('First tried Sep 2', t1, false) === true]);
  T.push(['a wrong day fails', datedOk('First tried Sep 20', t1, false) === false]);
  T.push(['a wrong month fails', datedOk('First tried Oct 2', t1, false) === false]);
  T.push(['a stray year fails the no-year case', datedOk('First tried Sep 2, 2024', t1, false) === false]);
  T.push(['a missing year fails the year case', datedOk('Sep 22', LONG_AGO, true) === false]);
  T.push(['the year case passes with its year', datedOk('Sep 22, ' + (YEAR_NOW - 2), LONG_AGO, true) === true]);
  // The old assertion this replaces: indexOf of the day number, which cannot tell these apart.
  T.push(['the substring test it replaces would have passed the wrong day', 'First tried Sep 20'.indexOf('2') > 0]);
  T.forEach((t) => { if (t[1]) { pass++; console.log('  ok   ' + t[0]); } else { fail++; console.log('  FAIL ' + t[0]); } });
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'SOLIDS-STRUCTURED SELF-TEST: FAIL' : 'SOLIDS-STRUCTURED SELF-TEST: PASS');
  process.exit(fail ? 1 : 0);
}

const seed = (over) => {
  const babies = (over && over.babies) || [{ id: 'b1', name: 'Robin', birth: now - 240 * DAY, sex: 'F', solidsStarted: true, routines: [], doctors: [], allergies: [] }];
  return Object.assign({
    babies: babies, activeBabyId: babies[0].id, events: [], illnesses: [],
    settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
    timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
  }, over || {});
};
const solidEv = (id, over) => Object.assign({ id: id, type: 'feed', method: 'solids', babyId: 'b1', time: now - HOUR, notes: '' }, over || {});

(async () => {
  if (!BASE) {
    console.error('usage: node tools/solids_structured_check.js http://localhost:<port>   (no default: a default port grades another agent\'s tree)');
    process.exit(2);
  }
  // OWNERSHIP. Three agents on this project have graded a checkout that was not theirs, one of them
  // main. A port is not proof; the bytes are.
  const diskSha = crypto.createHash('sha256').update(fs.readFileSync(__dirname + '/../app/index.html')).digest('hex');
  const servedSha = crypto.createHash('sha256').update(Buffer.from(await (await fetch(BASE + '/app/index.html')).arrayBuffer())).digest('hex');
  if (diskSha !== servedSha) {
    console.error('SOLIDS-STRUCTURED: ABORT — ' + BASE + ' is not serving this checkout.\n  on disk ' + diskSha + '\n  served  ' + servedSha);
    process.exit(2);
  }
  console.log('serving this checkout (app/index.html sha256 ' + diskSha.slice(0, 12) + '…)');

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
  // Every row of the panel, read off the real sheet DOM. Never document.body.textContent: that
  // string contains the inline script's own source, so it "finds" anything the code mentions.
  const readPanel = () => page.evaluate(() => {
    const host = document.querySelector('#firstTastes');
    const empty = host ? host.querySelector('.ft-empty') : null;
    const chips = document.querySelectorAll('.sheet .chip, .sheet-wrap .chip');
    return {
      present: !!host,
      empty: empty ? empty.textContent.trim() : null,
      sheetRendered: document.querySelectorAll('.field label').length,
      chips: chips.length,
      rows: host ? [].slice.call(host.querySelectorAll('.ft-row')).map((r) => ({
        name: r.querySelector('.ft-name').textContent.trim(),
        when: r.querySelector('.ft-when').textContent.trim(),
      })) : [],
    };
  });
  const panel = async () => { await page.evaluate(() => openFoodPrefs()); return readPanel(); };
  const firstTried = (p) => p.rows.filter((x) => /^First tried/.test(x.when));
  const whenOf = (p, name) => (p.rows.filter((x) => x.name === name)[0] || {}).when || '';

  console.log('\n1. the selection is stored structurally, not only as a sentence');
  {
    await load(seed());
    const r = await page.evaluate(async () => {
      openFeed();
      toggleSolidFood('Egg'); toggleSolidFood('Banana');
      document.getElementById('solidNote').value = 'a little mango';
      await saveSolids();
      const ev = state.events.filter((e) => e.type === 'feed' && e.method === 'solids');
      return { n: ev.length, notes: ev[0] && ev[0].notes, foods: ev[0] && ev[0].foods };
    });
    ok('exactly one solids entry is written', r.n === 1, r);
    ok('the notes string is byte for byte what it always was', r.notes === 'Egg, Banana, a little mango', r);
    const F = r.foods || [];
    ok('and the entry now also carries the selection', Array.isArray(r.foods) && F.length === 3, r);
    ok('the tagged food keeps its allergen', F.length === 3 && F[0].n === 'Egg' && F[0].a === 'egg', r);
    ok('an untagged food carries no allergen', F.length === 3 && F[1].n === 'Banana' && F[1].a === undefined, r);
    ok('and the typed line is recorded without Cubby guessing what is in it',
      F.length === 3 && F[2].n === 'a little mango' && F[2].a === undefined, r);

    const p = await panel();
    ok('the panel lists all nine allergens', p.present && p.rows.length === 9, p);
    ok('exactly one of them reads as tried', firstTried(p).length === 1, p.rows);
    ok('and it is the egg', (firstTried(p)[0] || {}).name === 'Egg', p.rows);
    ok('the other eight say Not yet, with no count and nothing to tick',
      p.rows.filter((x) => x.when === 'Not yet').length === 8, p.rows);
    ok('a taste from this year prints without a year', datedOk(whenOf(p, 'Egg'), now, false), whenOf(p, 'Egg'));
  }

  console.log('\n2. it survives a reload, because it is on the entry and not in a variable');
  {
    await page.reload({ waitUntil: 'networkidle2' }); await sleep(1200);
    const r = await page.evaluate(() => {
      const ev = state.events.filter((e) => e.type === 'feed' && e.method === 'solids')[0];
      return { foods: ev && ev.foods, notes: ev && ev.notes };
    });
    ok('the stored selection is still there after a reload', !!r.foods && r.foods.length === 3 && r.foods[0].a === 'egg', r);
    const p = await panel();
    ok('and the panel still reads it', firstTried(p).length === 1, p.rows);
  }

  console.log('\n3. months of solids logged before this existed are not lost');
  {
    // No foods array at all: the shape every solids entry in every live household has today.
    await load(seed({ events: [solidEv('s1', { notes: 'Egg, Banana', time: now - 9 * DAY })] }));
    const p = await panel();
    ok('an old notes-only entry still answers the question', /^First tried/.test(whenOf(p, 'Egg')), p.rows);
    ok('and it is dated from the entry, not from today', datedOk(whenOf(p, 'Egg'), now - 9 * DAY, false), { got: whenOf(p, 'Egg'), expect: shortMonth(now - 9 * DAY) + ' ' + new Date(now - 9 * DAY).getDate() });
    ok('exactly one allergen comes out of it', firstTried(p).length === 1, p.rows);
  }

  console.log('\n4. a sentence about a food is not a food');
  {
    await load(seed({ events: [solidEv('s1', { notes: 'no egg today, she would not take it' })] }));
    const p = await panel();
    ok('"no egg today" does not become egg introduced', p.present && firstTried(p).length === 0, p.rows);
    ok('and with nothing recorded there are no rows to lose against',
      p.rows.length === 0 && /^Once you log a solid feed/.test(p.empty || ''), p);
  }

  console.log('\n5. the FIRST taste is the one that counts');
  {
    await load(seed({ events: [
      solidEv('s1', { notes: 'Egg', foods: [{ n: 'Egg', a: 'egg' }], time: now - 2 * DAY }),
      solidEv('s2', { notes: 'Egg', foods: [{ n: 'Egg', a: 'egg' }], time: now - 40 * DAY }),
    ] }));
    const p = await panel();
    // No self-neutralising disjunct: this is the old date, spelled out, or it is a failure.
    ok('a second helping does not overwrite the first date', datedOk(whenOf(p, 'Egg'), now - 40 * DAY, false), { got: whenOf(p, 'Egg'), expect: shortMonth(now - 40 * DAY) + ' ' + new Date(now - 40 * DAY).getDate() });
    ok('and it is not the recent one', !datedOk(whenOf(p, 'Egg'), now - 2 * DAY, false), whenOf(p, 'Egg'));
  }

  console.log('\n6. correcting the entry takes the date back with it');
  {
    await load(seed({ events: [solidEv('s1', { notes: 'Egg', foods: [{ n: 'Egg', a: 'egg' }] })] }));
    const before = await panel();
    ok('egg reads as tried before the correction', /^First tried/.test(whenOf(before, 'Egg')), before.rows);
    const r = await page.evaluate(() => {
      openEdit('s1');
      document.getElementById('eNote').value = 'Banana';
      saveEdit('s1');
      const e = state.events.filter((x) => x.id === 's1')[0];
      return { notes: e.notes, foods: e.foods };
    });
    ok('the stored selection follows the corrected words', r.notes === 'Banana' && !!r.foods && r.foods.length === 1 && r.foods[0].n === 'Banana' && !r.foods[0].a, r);
    const after = await panel();
    ok('and the panel no longer claims egg was ever tried', after.present && firstTried(after).length === 0, after);
  }

  console.log('\n7. but writing down what happened does NOT delete what happened');
  {
    // The box the app gives her is labelled "Food" and it is the only place to add anything to a
    // solids entry afterwards. So the sentence a frightened parent types into it is exactly this
    // one, and re-deriving alone turned the whole thing into one untagged blob: the first taste of
    // egg vanished from the panel AND the allergen block vanished off the doctor page entirely.
    await load(seed({ events: [solidEv('s1', { notes: 'Egg', foods: [{ n: 'Egg', a: 'egg' }], time: now - 30 * DAY })] }));
    const r = await page.evaluate(() => {
      openEdit('s1');
      document.getElementById('eNote').value = 'Egg - came out in a rash on her chin';
      saveEdit('s1');
      const e = state.events.filter((x) => x.id === 's1')[0];
      return { notes: e.notes, foods: e.foods, summary: visitSummary(14) };
    });
    ok('her words are stored exactly as she typed them', r.notes === 'Egg - came out in a rash on her chin', r);
    ok('and the egg is still tagged as egg', !!r.foods && r.foods.some((f) => f.a === 'egg'), r.foods);
    const p = await panel();
    ok('the panel still knows when egg was first tried', datedOk(whenOf(p, 'Egg'), now - 30 * DAY, false), { got: whenOf(p, 'Egg'), rows: p.rows });
    ok('and the doctor page still carries the allergen block', /Allergens introduced/.test(r.summary), r.summary.slice(-300));
    ok('with the egg named on it', /Allergens introduced[^\n]*Egg/.test(r.summary), (r.summary.split('\n').filter((l) => /Allergens introduced/.test(l))[0] || ''));

    // A parenthetical is the other half of the same edit and broke the same way.
    const r2 = await page.evaluate(() => {
      openEdit('s1');
      document.getElementById('eNote').value = 'Egg (2 tsp)';
      saveEdit('s1');
      const e = state.events.filter((x) => x.id === 's1')[0];
      return { foods: e.foods };
    });
    ok('adding the amount in brackets keeps the tag too', !!r2.foods && r2.foods.some((f) => f.a === 'egg'), r2.foods);

    // And a retraction is still a retraction, even though the word is still on the line.
    const r3 = await page.evaluate(() => {
      openEdit('s1');
      document.getElementById('eNote').value = 'no egg today, she would not take it';
      saveEdit('s1');
      const e = state.events.filter((x) => x.id === 's1')[0];
      return { foods: e.foods };
    });
    ok('but "no egg today" is read as taking it back, not as keeping it', !!r3.foods && !r3.foods.some((f) => f.a === 'egg'), r3.foods);
  }

  console.log('\n8. a family still on milk is never handed a list of nine');
  {
    await load(seed({ babies: [{ id: 'b1', name: 'Wren', birth: now - 21 * DAY, sex: 'M', routines: [], doctors: [], allergies: [] }] }));
    const p = await panel();
    ok('the sheet itself opens', p.sheetRendered > 3 && p.chips > 5, p);
    ok('and there is no First tastes panel on it at three weeks old', p.present === false, p);
  }

  console.log('\n9. and neither is a family who has just reached six months');
  {
    // solidsStarted never touched, so feedSolidsOn defaults to true at six months and the panel
    // DOES appear. It must not appear as nine rows of nothing under a line about following your
    // pediatrician's guidance on introducing allergens.
    await load(seed({ babies: [{ id: 'b1', name: 'Robin', birth: now - 183 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }] }));
    const p = await panel();
    ok('the panel is there', p.present === true, p);
    ok('but it is one sentence, not nine rows of Not yet', p.rows.length === 0, p.rows);
    ok('and the sentence says what it will hold, with nothing to tick',
      p.empty === 'Once you log a solid feed, the first time each food appeared shows up here.', p.empty);
  }

  console.log('\n10. history does not vanish when a switch is flicked');
  {
    await load(seed({
      babies: [{ id: 'b1', name: 'Robin', birth: now - 240 * DAY, sex: 'F', solidsStarted: false, routines: [], doctors: [], allergies: [] }],
      events: [solidEv('s1', { notes: 'Egg', foods: [{ n: 'Egg', a: 'egg' }], time: now - 5 * DAY })],
    }));
    const p = await panel();
    ok('solids turned off does not hide what was already logged', p.present && p.rows.length === 9, p);
    ok('and the date is still the one it was', datedOk(whenOf(p, 'Egg'), now - 5 * DAY, false), whenOf(p, 'Egg'));
  }

  console.log('\n11. the other baby\'s plate is not this baby\'s history');
  {
    await load(seed({
      babies: [{ id: 'b1', name: 'Robin', birth: now - 240 * DAY, solidsStarted: true, routines: [], doctors: [], allergies: [] },
        { id: 'b2', name: 'Wren', birth: now - 240 * DAY, solidsStarted: true, routines: [], doctors: [], allergies: [] }],
      events: [solidEv('s1', { babyId: 'b2', notes: 'Egg', foods: [{ n: 'Egg', a: 'egg' }] })],
    }));
    const p = await panel();
    ok('the twin who has not had egg is told nothing about egg', p.present && p.rows.length === 0, p);
    await page.evaluate(() => { state.activeBabyId = 'b2'; });
    const p2 = await panel();
    ok('and the one who has, reads tried on exactly one', firstTried(p2).length === 1 && p2.rows.length === 9, p2.rows);
  }

  console.log('\n12. a food the family already avoids is never an outstanding item');
  {
    await load(seed({
      babies: [{ id: 'b1', name: 'Robin', birth: now - 240 * DAY, solidsStarted: true, routines: [], doctors: [], allergies: ['peanut'] }],
      events: [solidEv('s1', { notes: 'Yogurt', foods: [{ n: 'Yogurt', a: 'dairy' }], time: now - 10 * DAY })],
    }));
    const p = await panel();
    ok('the declared allergy does not read as Not yet', whenOf(p, 'Peanut') !== 'Not yet', p.rows);
    ok('it reads as Avoiding', whenOf(p, 'Peanut') === 'Avoiding', p.rows);
    ok('and the ones simply not reached still read Not yet', whenOf(p, 'Soy') === 'Not yet', p.rows);
    const r = await page.evaluate(() => visitSummary(7));
    const notLine = r.split('\n').filter((l) => /Not recorded in Cubby:/.test(l))[0] || '';
    ok('the clinical page does not list it as not recorded either', notLine.length > 0 && !/Peanut/.test(notLine), notLine);
    ok('while it is still named as an allergy lower down', /Allergies:.*Peanut/i.test(r), r.split('\n').filter((l) => /^Allergies:/.test(l))[0]);
  }

  console.log('\n13. the same block reaches the page a clinician reads');
  {
    await load(seed({ events: [
      solidEv('s1', { notes: 'Egg', foods: [{ n: 'Egg', a: 'egg' }], time: now - 2 * DAY }),
      solidEv('s2', { notes: 'Yogurt', foods: [{ n: 'Yogurt', a: 'dairy' }], time: now - 60 * DAY }),
    ] }));
    const r = await page.evaluate(() => visitSummary(7));
    const line = r.split('\n').filter((l) => /^Allergens introduced/.test(l))[0] || '';
    const notLine = r.split('\n').filter((l) => /Not recorded in Cubby:/.test(l))[0] || '';
    ok('the summary names what has been introduced', line.length > 0, r.slice(0, 400));
    ok('and says the block is all time, not the window above it', /^Allergens introduced \(all time\):/.test(line), line);
    ok('including a taste far outside the seven day window, because the date is the answer',
      /Dairy \(/.test(line) && datedOk((line.match(/Dairy \(([^)]*)\)/) || [])[1], now - 60 * DAY, true), line);
    ok('and the recent one', /Egg \(/.test(line) && datedOk((line.match(/Egg \(([^)]*)\)/) || [])[1], now - 2 * DAY, true), line);
    ok('every date on this page carries its year, because somebody acts on it',
      (line.match(/\((19|20)\d{2}\)/g) || []).length === 0 && (line.match(/\([^)]*(19|20)\d{2}\)/g) || []).length === 2, line);
    ok('the rest are named as not RECORDED in Cubby, never as not given', /Not recorded in Cubby:/.test(notLine), notLine);
    ok('and that is the other seven of the nine', notLine.split(',').length === 7, notLine);
  }

  console.log('\n14. and it stays off that page when there is nothing to say');
  {
    await load(seed({ events: [{ id: 'f1', type: 'feed', method: 'bottle', babyId: 'b1', amount: 120, unit: 'ml', time: now - 2 * HOUR }] }));
    const r = await page.evaluate(() => visitSummary(7));
    ok('a baby on milk gets no allergen block at all', !/Allergens introduced/.test(r) && !/Not recorded in Cubby/.test(r), r.slice(0, 300));
    ok('while the rest of the summary is still printed', /Cubby summary/.test(r) && /Bottles?|Feeds/i.test(r), r.slice(0, 300));
  }

  console.log('\n15. a taste two years ago does not read as last month');
  {
    await load(seed({
      babies: [{ id: 'b1', name: 'Robin', birth: now - 1100 * DAY, solidsStarted: true, routines: [], doctors: [], allergies: [] }],
      events: [solidEv('s1', { notes: 'Peanut butter', foods: [{ n: 'Peanut butter', a: 'peanut' }], time: LONG_AGO })],
    }));
    const p = await panel();
    ok('the panel carries the year when the year is not this one', datedOk(whenOf(p, 'Peanut'), LONG_AGO, true), { got: whenOf(p, 'Peanut'), expect: shortMonth(LONG_AGO) + ' 22, ' + (YEAR_NOW - 2) });
    const r = await page.evaluate(() => visitSummary(7));
    const line = r.split('\n').filter((l) => /^Allergens introduced/.test(l))[0] || '';
    ok('and so does the clinical page', /Peanut \(/.test(line) && datedOk((line.match(/Peanut \(([^)]*)\)/) || [])[1], LONG_AGO, true), line);
  }

  console.log('\n16. while the rest of history is still downloading, nothing says never');
  {
    // Signed in, Cubby boots on a 120-day window. A peanut given at seven months is outside it, so
    // "Not yet" here is a fact about the download, not about the baby, and the sheet is built once.
    await load(seed({ events: [solidEv('s1', { notes: 'Yogurt', foods: [{ n: 'Yogurt', a: 'dairy' }], time: now - 3 * DAY })] }));
    await page.evaluate(() => { window.cubbyHistoryPending = true; });
    const p = await panel();
    ok('the panel prints no rows while it cannot answer', p.present && p.rows.length === 0, p);
    ok('it says so in one line', p.empty === 'Still catching up on older entries.', p.empty);
    const r = await page.evaluate(() => visitSummary(7));
    ok('and the clinical page does not print a not-recorded list it cannot stand behind',
      !/Not recorded in Cubby/.test(r), r.split('\n').filter((l) => /Allergens|recorded/.test(l)));
    ok('it says the list may be incomplete instead', /Still loading older entries/.test(r), r.split('\n').filter((l) => /Allergens|loading/.test(l)));

    // And it corrects itself under her, without her closing and reopening the sheet.
    await page.evaluate(() => { window.cubbyHistoryPending = false; });
    await sleep(1400);
    const p2 = await readPanel();
    ok('and the moment the rest lands, the open sheet redraws itself', p2.rows.length === 9 && !p2.empty, p2);
    ok('with the answer on it', firstTried(p2).length === 1 && firstTried(p2)[0].name === 'Dairy', p2.rows);
  }

  console.log('\n17. all nine allergens can actually be reached by a tap');
  {
    await load(seed());
    const r = await page.evaluate(() => {
      const cov = (d) => ALLERGENS.filter((a) => dietFoods(d).some((f) => f.a === a.toLowerCase()));
      const all = dietFoods('all');
      const vegan = dietFoods('vegan');
      return { total: all.length, covered: cov('all'), missing: ALLERGENS.filter((a) => cov('all').indexOf(a) < 0),
        veg: cov('veg'), vegan: cov('vegan'),
        veganHasPrawn: vegan.some((f) => f.n === 'Prawn'), veganHasPeanut: vegan.some((f) => f.a === 'peanut'),
        peanutFoods: all.filter((f) => f.a === 'peanut').map((f) => f.n) };
    });
    ok('every one of the nine has a food that carries it', r.covered.length === 9, r);
    ok('peanut, tree nuts and shellfish among them, which had none',
      ['Peanut', 'Tree nuts', 'Shellfish'].every((a) => r.covered.indexOf(a) >= 0) && r.covered.length === 9, r);
    ok('and peanut is reachable by name, not by luck', r.peanutFoods.length >= 1, r.peanutFoods);
    // Scoped honestly: a vegetarian family cannot reach fish or shellfish and a vegan family cannot
    // reach dairy or egg either, because those are the diets doing their job. The claim is about
    // 'all'. Pinned so a future food that quietly breaks a diet filter is caught.
    ok('a vegetarian family reaches seven of the nine, all but fish and shellfish',
      r.veg.length === 7 && r.veg.indexOf('Fish') < 0 && r.veg.indexOf('Shellfish') < 0, r.veg);
    ok('a vegan family reaches five, all but dairy, egg, fish and shellfish',
      r.vegan.length === 5 && ['Dairy', 'Egg', 'Fish', 'Shellfish'].every((a) => r.vegan.indexOf(a) < 0), r.vegan);
    ok('the new shellfish food still respects a vegan diet', r.veganHasPrawn === false, r);
    ok('and peanut butter is still offered to it', r.veganHasPeanut === true, r);
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'SOLIDS-STRUCTURED: FAIL' : 'SOLIDS-STRUCTURED: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
