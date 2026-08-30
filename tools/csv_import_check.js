#!/usr/bin/env node
/* What was concretely wrong for a real parent.
 *
 * Cubby could hand a family every byte of their record back and could not take a single row IN.
 * Every match for "import" in app/ was an internal schema migration. So a mother with nine months
 * of feeds, sleeps and nappies in Nara or Huckleberry was being asked to abandon all of it to
 * switch, and her first year is exactly the part she cannot recreate. Switching cost is the whole
 * fight for a challenger and Cubby was charging the maximum.
 *
 * The other half of the wrong is what a careless importer would have done to her instead. A CSV
 * that says 03/04/2026 means March in one app and April in another, and an app that picks one
 * silently moves a baby's whole history by weeks while looking exactly like the truth. A row it
 * cannot map is not allowed to just vanish either, and a row it DOES bring in must never claim
 * that somebody in this circle logged it, because "logged by Mama Bear" on a feed she never gave
 * is a false record on a page a doctor may read.
 *
 * So this gate holds the four promises: nothing is written before she has seen the counts; the
 * counts are true; nothing that could not be read is dropped in silence; and nothing that came in
 * from another app is ever attributed to a person here.
 *
 *   PORT=9613 node tools/serve.js &
 *   node tools/csv_import_check.js http://localhost:9613
 *
 * The base URL is REQUIRED and has no default on purpose. A default port grades whichever checkout
 * happens to own it, which in this repo has repeatedly meant a worktree grading main and reporting
 * a clean pass on code it never loaded.
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const fs = require('fs');
const os = require('os');
const path = require('path');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2];
if (!BASE) { console.error('usage: node tools/csv_import_check.js http://localhost:<port>   (no default: a default port grades the wrong tree)'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, HOUR = 3600000, MIN = 60000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

// Midday, seconds zeroed, so every generated timestamp round-trips through the CSV exactly.
const CLOCK = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;
const YR = new Date(CLOCK).getFullYear() - 1;   // a year that is unambiguously in the past

const seed = (over) => Object.assign({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 200 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
  activeBabyId: 'b1', events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
}, over || {});

/* ---- the CSV files, written to a real temp dir and handed to a real <input type=file> ---- */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-csv-'));
const p2 = (n) => String(n).padStart(2, '0');
const local = (t) => { const d = new Date(t); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':00'; };
const put = (name, text) => { const f = path.join(TMP, name); fs.writeFileSync(f, text); return f; };

// One nursing, one bottle, one plain feed, one sleep, two readable nappies, and four rows that
// must be refused out loud: pumping, tummy time, a sleep with no end, a nappy with no kind.
const T = {
  nurse: now - 3 * HOUR, bottle: now - 5 * HOUR, sleep: now - 9 * HOUR,
  wet: now - 2 * HOUR, dirty: now - 26 * HOUR, pump: now - 7 * HOUR,
  tummy: now - 8 * HOUR, badSleep: now - 30 * HOUR, feed: now - 11 * HOUR, badNappy: now - 12 * HOUR,
};
const MAIN = put('nara.csv', [
  'Type,Start,End,Duration,Amount,Notes',
  'Nursing,' + local(T.nurse) + ',,12,,left',
  'Bottle,' + local(T.bottle) + ',,,120 ml,formula',
  'Sleep,' + local(T.sleep) + ',' + local(T.sleep + 2 * HOUR) + ',,,',
  'Diaper,' + local(T.wet) + ',,,,wet',
  'Diaper,' + local(T.dirty) + ',,,,dirty',
  'Pumping,' + local(T.pump) + ',,,90 ml,',
  'Tummy time,' + local(T.tummy) + ',,10,,',
  'Sleep,' + local(T.badSleep) + ',,,,',
  'Feed,' + local(T.feed) + ',,,,',
  'Diaper,' + local(T.badNappy) + ',,,,',
].join('\n') + '\n');

// The day in one column and the clock in the next: ordinary in real exports, and the shape that
// used to put a whole history at midnight without one word on screen.
const dOnly = (t) => { const d = new Date(t); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
const cOnly = (t) => { const d = new Date(t); return p2(d.getHours()) + ':' + p2(d.getMinutes()); };
const SPLIT = put('split.csv', ['Date,Time,Type,Amount',
  dOnly(T.bottle) + ',' + cOnly(T.bottle) + ',Bottle,120 ml',
  dOnly(T.nurse) + ',' + cOnly(T.nurse) + ',Nursing,'].join('\n') + '\n');
// A day and nothing else. There is no hour to be had, so both rows have to be refused OUT LOUD.
const DATEONLY = put('dateonly.csv', ['Date,Type',
  dOnly(T.bottle) + ',Bottle', dOnly(T.nurse) + ',Nursing'].join('\n') + '\n');
// Ordinary notes that name a different kind of entry than the row is.
const NOTES = put('notes.csv', ['Type,Start,Notes',
  'Nursing,' + local(T.nurse) + ',"dirty nappy right after"',
  'Bottle,' + local(T.bottle) + ',"fell asleep halfway"'].join('\n') + '\n');
// A zoned stamp with milliseconds, which is what a great many exports actually emit.
const ISOMS = put('isoms.csv', 'Type,Start\nNursing,' + new Date(T.nurse).toISOString() + '\n');
const AMBIG = put('ambiguous.csv', 'Type,Time\nNursing,03/04/' + YR + ' 08:30\nNursing,05/06/' + YR + ' 09:30\n');
const DAYFIRST = put('dayfirst.csv', 'Type,Time\nNursing,03/04/' + YR + ' 08:30\nNursing,25/04/' + YR + ' 09:30\n');
const FUTURE = put('future.csv', 'Type,Start\nNursing,' + local(now + 2 * DAY) + '\n');
const JUNK = put('junk.csv', 'hello world\nnothing here at all\n');
const SEMI = put('semi.csv', 'Type;Time;Notes\nDiaper;' + local(now - 4 * HOUR) + ';"wet; and a bit dirty"\n');
// Two years of nappies: more than one tap should ever write, so the cap has to say so out loud.
const HUGE = put('huge.csv', ['Type,Start,Notes'].concat(
  Array.from({ length: 5002 }, (_, i) => 'Diaper,' + local(now - (i + 1) * 10 * 60000) + ',wet')).join('\n') + '\n');

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
    // A real circle, so "logged by Sam" is a thing the timeline can actually say.
    await page.evaluate(() => {
      window.LL = { auth: { currentUser: { uid: 'local' } }, role: 'owner',
        members: { local: 'owner', uidSam: 'caregiver' },
        memberInfo: { local: { name: 'Maya', relationship: 'Mama' }, uidSam: { name: 'Sam', relationship: 'Papa' } } };
    });
  };
  const sheetText = () => page.evaluate(() => (document.getElementById('sheet').innerText || '').replace(/\s+/g, ' ').trim());
  const upload = async (file) => {
    const inp = await page.$('#impFile');
    if (!inp) return false;
    await inp.uploadFile(file);
    await sleep(500);
    return true;
  };
  // The whole path a parent walks: Settings -> Your data -> the row -> the picker.
  const openViaSettings = async () => {
    await page.evaluate(() => { closeSheet(); openDataSheet(); });
    await sleep(200);
    const clicked = await page.evaluate(() => {
      const row = [...document.querySelectorAll('#sheet .set-item')].find((el) => /bring in old logs/i.test(el.textContent || ''));
      if (!row) return false;
      row.click(); return true;
    });
    await sleep(250);
    return clicked;
  };

  console.log('\n1. the import door is on the same sheet as Export, and it opens');
  {
    await load(seed());
    const clicked = await openViaSettings();
    ok('Your data offers a "Bring in old logs" row', clicked === true);
    const t = await sheetText();
    ok('and tapping it opens the import sheet', /bring in old logs/i.test(t), t.slice(0, 140));
    const hasInput = await page.evaluate(() => !!document.getElementById('impFile'));
    ok('with a real file picker behind the button', hasInput === true);
    ok('and it names what comes across', /feeds, sleeps and nappies/i.test(t), t.slice(0, 240));
  }

  console.log('\n2. the preview counts what it found, and writes NOTHING yet');
  {
    ok('a file can be handed to the picker', (await upload(MAIN)) === true);
    const t = await sheetText();
    const st = await page.evaluate(() => ({ n: state.events.length, sheet: !!document.querySelector('#sheet .btn-primary') }));
    ok('not one row has been saved before she agrees', st.n === 0, st);
    ok('the sheet is the preview', /what cubby found/i.test(t), t.slice(0, 120));
    ok('1 nursing feed, as a noun a person would say', /\b1 nursing feed\b/.test(t) && !/\b1 nursing with\b/.test(t), t);
    ok('1 bottle', /\b1 bottle\b/.test(t), t);
    ok('1 sleep', /\b1 sleep\b/.test(t), t);
    ok('2 nappies', /\b2 nappies\b/.test(t), t);
    ok('1 feed the file never named a method for', /\b1 feed\b/.test(t) && /did not say breast or bottle/i.test(t), t);
    ok('the save button carries the real number', /add 6 entries/i.test(t), t);
    /* The counts alone cannot show her a file has been read at the wrong hour: nine months landing
       at midnight looks exactly like nine months landing correctly. The span, with real clock
       times, is the only thing on this screen that can. */
    ok('the preview shows real clock times, not just counts', /\d{1,2}:\d{2}/.test(t), t);
    ok('and says the span it is about to write', /the earliest is yesterday at \d{1,2}:\d{2}/i.test(t) && /the latest is today at \d{1,2}:\d{2}/i.test(t), t);
    ok('it no longer claims times are shown "above"', !/with the times above/i.test(t), t);
    ok('the nursing row is not drawn as a bottle', await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#sheet .log-list-item')];
      const nur = rows.find((r) => /nursing/i.test(r.textContent || ''));
      const bot = rows.find((r) => /bottle/i.test(r.textContent || ''));
      return !!nur && !!bot && nur.querySelector('.lli-ico').innerHTML !== bot.querySelector('.lli-ico').innerHTML;
    }), 'nursing and bottle share a glyph');
  }

  console.log('\n3. everything it could not map is counted and NAMED, not dropped in silence');
  {
    const t = await sheetText();
    ok('there is a "staying behind" section at all', /staying behind/i.test(t), t);
    ok('the two off-scope rows are counted', /2 rows that are not feeds, sleeps or nappies/i.test(t), t);
    ok('and named, so she knows exactly what stayed', /pumping/i.test(t) && /tummy time/i.test(t), t);
    ok('the list of them reads as a sentence, not a comma splice', /those were pumping and tummy time\./i.test(t), t);
    ok('the sleep with no end is counted', /1 sleep with no end time/i.test(t), t);
    ok('the nappy with no kind is counted', /1 nappy the file never says was wet or dirty/i.test(t), t);
    const sums = await page.evaluate(() => {
      const p = importDraft; let s = 0; Object.keys(p.skip).forEach((k) => { s += p.skip[k]; });
      return { total: p.total, took: p.take.length, skipped: s };
    });
    ok('every row in the file is either taken or accounted for', sums.took + sums.skipped === sums.total && sums.total === 10, sums);
  }

  console.log('\n4. saving keeps the original times, the real shapes, and the truth about who logged it');
  {
    await page.evaluate(() => document.querySelector('#sheet .btn-primary').click());
    await sleep(500);
    const r = await page.evaluate((t) => {
      const e = state.events;
      const nurse = e.find((x) => x.method === 'breast');
      const bot = e.find((x) => x.method === 'bottle');
      const sl = e.find((x) => x.type === 'sleep');
      const nap = e.filter((x) => x.type === 'diaper');
      const plain = e.find((x) => x.type === 'feed' && !x.method);
      return { n: e.length, nurseTime: nurse && nurse.time, nurseDur: nurse && nurse.dur,
        botAmt: bot && bot.amount, botUnit: bot && bot.unit, slTime: sl && sl.time, slEnd: sl && sl.end,
        kinds: nap.map((x) => x.kind).sort(), plainTime: plain && plain.time,
        allImported: e.length > 0 && e.every((x) => x.imported === true),
        nImported: e.filter((x) => x.imported === true).length,
        authors: [...new Set(e.map((x) => x.authorId))] };
    }, T);
    ok('six entries are on the record', r.n === 6, r);
    ok('the nursing kept its exact original minute', r.nurseTime === T.nurse, { got: r.nurseTime, want: T.nurse });
    ok('and its 12 minutes', r.nurseDur === 12 * MIN, r);
    ok('the bottle kept 120 ml', r.botAmt === 120 && r.botUnit === 'ml', r);
    ok('the sleep kept both ends', r.slTime === T.sleep && r.slEnd === T.sleep + 2 * HOUR, r);
    ok('the plain feed kept its time', r.plainTime === T.feed, r);
    ok('both nappies kept their kind', JSON.stringify(r.kinds) === JSON.stringify(['dirty', 'wet']), r);
    ok('every saved row is flagged as brought in (and there are six of them)', r.allImported && r.nImported === 6, r);
    /* The proposal asked for a synthetic author here. firestore.rules refuses an event whose
       authorId is not the writer, so the honest author is the real one and the FLAG carries the
       rest. This assertion is the one that would have caught a synthetic uid shipping. */
    ok('the author is the real signed-in person, not a synthetic uid', JSON.stringify(r.authors) === JSON.stringify(['local']), r);
  }

  console.log('\n5. the timeline never says a person here logged them');
  {
    await page.evaluate(() => go('log'));
    await sleep(600);
    const r = await page.evaluate(() => {
      const list = document.getElementById('tlList');
      const bys = [...list.querySelectorAll('.tl-by')].map((n) => (n.textContent || '').trim());
      return { rows: list.querySelectorAll('.tl-item').length, bys,
        avatars: list.querySelectorAll('.tl-byav').length };
    });
    ok('the imported rows are on the timeline', r.rows >= 5, r);
    ok('every by-line says it was brought in (and there are some)', r.bys.length >= 5 && r.bys.every((s) => /brought in from another app/i.test(s)), r);
    ok('not one of them says "logged by"', r.bys.filter((s) => /logged by/i.test(s)).length === 0, r);
    ok('and no member face is attached to an imported row', r.avatars === 0, r);
    const ed = await page.evaluate(() => {
      const id = state.events.find((e) => e.type === 'diaper').id;
      openEdit(id);
      return (document.querySelector('#sheet .sub').textContent || '').trim();
    });
    ok('the entry sheet says the same thing', /brought in from another app/i.test(ed) && !/logged by/i.test(ed), ed);
  }

  console.log('\n6. a partner\'s own entry still says his name, so the flag has not leaked');
  {
    await load(seed({ events: [
      { id: 'x1', type: 'diaper', kind: 'wet', babyId: 'b1', time: now - HOUR, authorId: 'uidSam' },
      { id: 'x2', type: 'feed', method: 'bottle', amount: 90, unit: 'ml', babyId: 'b1', time: now - 2 * HOUR, authorId: 'local', imported: true },
    ] }));
    await page.evaluate(() => go('log'));
    await sleep(500);
    const r = await page.evaluate(() => [...document.querySelectorAll('#tlList .tl-by')].map((n) => (n.textContent || '').trim()));
    ok('two by-lines, and they say different things', r.length === 2 && new Set(r).size === 2, r);
    ok('the partner keeps his name', r.some((s) => /logged by papa/i.test(s)), r);
    ok('the imported one does not', r.filter((s) => /brought in from another app/i.test(s)).length === 1, r);
  }

  console.log('\n7. a second import of the same file adds nothing and says why');
  {
    await load(seed());
    await openViaSettings(); await upload(MAIN);
    await page.evaluate(() => document.querySelector('#sheet .btn-primary').click());
    await sleep(400);
    const first = await page.evaluate(() => state.events.length);
    await openViaSettings(); await upload(MAIN);
    const t = await sheetText();
    const after = await page.evaluate(() => ({ n: state.events.length, take: importDraft.take.length }));
    ok('the first run wrote six', first === 6, first);
    ok('the second run has nothing to add', after.take === 0, after);
    ok('and says they are already here (all six)', /6 rows already in cubby/i.test(t), t);
    ok('so no save button is offered', !/add \d+ entr/i.test(t), t);
    ok('and the record did not grow', after.n === 6, after);
  }

  console.log('\n8. 03/04 is never guessed at');
  {
    await load(seed());
    await openViaSettings(); await upload(AMBIG);
    const t = await sheetText();
    const r = await page.evaluate(() => ({ take: importDraft.take.length, day: importDraft.dayFirst, skip: importDraft.skip }));
    ok('a file that never settles day-vs-month brings in nothing', r.take === 0, r);
    ok('the order is left undecided rather than assumed', r.day === null, r);
    ok('and Cubby says so in those words', /never says which number is the day/i.test(t), t);
    ok('both rows are counted as left behind, in the skip line itself', /2 rows dated like 03\/04/i.test(t), t);
    ok('no save button is offered', !/add \d+ entr/i.test(t), t);
    ok('nothing was written', (await page.evaluate(() => state.events.length)) === 0);
    /* This is the one refusal she can actually act on, and "choose a different file" cannot help
       her: the same app exports the same format again. So the screen has to say what export DOES
       come in, and why Cubby will not just pick one. */
    ok('she is told which export would come straight in', /export dates as \d{4}-03-04/i.test(t), t);
    ok('and why Cubby will not guess for her', /moves a whole history by months/i.test(t), t);
    ok('the dead-end line is gone', !/mapped cleanly/i.test(t), t);
    ok('and what is left says plainly that nothing was saved', /nothing in this file was a feed, sleep or nappy cubby could read/i.test(t), t);
  }

  console.log('\n9. but a file that DOES settle it is read correctly');
  {
    await load(seed());
    await openViaSettings(); await upload(DAYFIRST);
    await page.evaluate(() => document.querySelector('#sheet .btn-primary').click());
    await sleep(400);
    const r = await page.evaluate(() => state.events.slice().sort((a, b) => a.time - b.time)
      .map((e) => { const d = new Date(e.time); return [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]; }));
    ok('both rows came in', r.length === 2, r);
    ok('25/04 proved the file is day first, so 03/04 is the 3rd of April', JSON.stringify(r[0]) === JSON.stringify([YR, 3, 3, 8]), r);
    ok('and the other is the 25th of April', JSON.stringify(r[1]) === JSON.stringify([YR, 3, 25, 9]), r);
  }

  console.log('\n10. a row dated in the future is refused');
  {
    await load(seed());
    await openViaSettings(); await upload(FUTURE);
    const t = await sheetText();
    ok('it is counted, not written', /1 row dated in the future/i.test(t), t);
    ok('and there is nothing to save', !/add \d+ entr/i.test(t), t);
  }

  console.log('\n11. a file Cubby cannot read is said so, plainly, and changes nothing');
  {
    await load(seed());
    await openViaSettings(); await upload(JUNK);
    const t = await sheetText();
    const n = await page.evaluate(() => state.events.length);
    ok('it does not pretend to have found anything', /could not read that file/i.test(t), t);
    ok('it points at the right export instead of blaming her', /plain csv/i.test(t), t);
    ok('and nothing was written', n === 0, n);
  }

  console.log('\n12. semicolon files and quoted cells (the European export) still parse');
  {
    await load(seed());
    await openViaSettings(); await upload(SEMI);
    await page.evaluate(() => document.querySelector('#sheet .btn-primary').click());
    await sleep(400);
    const r = await page.evaluate(() => state.events.map((e) => e.type + ':' + e.kind));
    ok('the one row came through', r.length === 1, r);
    ok('and "wet; and a bit dirty" inside quotes read as both', r[0] === 'diaper:both', r);
  }

  console.log('\n13. the second baby has her own history, not her sister\'s');
  {
    const mine = [{ id: 'y1', type: 'feed', method: 'breast', dur: 12 * MIN, babyId: 'b1', time: T.nurse, authorId: 'local' }];
    await load(seed({ babies: [
      { id: 'b1', name: 'Robin', birth: now - 200 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] },
      { id: 'b2', name: 'Wren', birth: now - 200 * DAY, sex: 'M', routines: [], doctors: [], allergies: [] }],
      activeBabyId: 'b2', events: mine }));
    await openViaSettings(); await upload(MAIN);
    const t = await sheetText();
    await page.evaluate(() => document.querySelector('#sheet .btn-primary').click());
    await sleep(400);
    const r = await page.evaluate(() => ({
      b2: state.events.filter((e) => e.babyId === 'b2').length,
      b1: state.events.filter((e) => e.babyId === 'b1').length,
      b2imported: state.events.filter((e) => e.babyId === 'b2' && e.imported).length }));
    ok('Robin\'s identical feed does not swallow Wren\'s row', /add 6 entries/i.test(t), t);
    ok('all six land on the active baby', r.b2 === 6 && r.b2imported === 6, r);
    ok('and Robin\'s own entry is untouched', r.b1 === 1, r);
  }

  console.log('\n14. it survives a reload, and it can all be taken back out in one tap');
  {
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1200);
    await page.evaluate(() => { window.LL = { auth: { currentUser: { uid: 'local' } }, role: 'owner', members: { local: 'owner' }, memberInfo: { local: { name: 'Maya', relationship: 'Mama' } } }; go('log'); });
    await sleep(500);
    const after = await page.evaluate(() => ({ n: state.events.filter((e) => e.imported).length,
      bys: [...document.querySelectorAll('#tlList .tl-by')].map((x) => (x.textContent || '').trim()) }));
    ok('the six are still there after a reload', after.n === 6, after);
    ok('and still say where they came from (and there are some)', after.bys.length >= 5 && after.bys.every((s) => /brought in/i.test(s)), after);

    await openViaSettings();
    const t = await sheetText();
    ok('the sheet offers to take them back out', /remove everything i brought in/i.test(t), t);
    await page.evaluate(() => [...document.querySelectorAll('#sheet button')].find((b) => /remove everything/i.test(b.textContent)).click());
    await sleep(250);
    const warn = await sheetText();
    ok('and asks first, saying what stays', /everything logged in cubby stays/i.test(warn), warn);
    await page.evaluate(() => document.querySelector('#sheet .btn-primary').click());
    await sleep(500);
    const gone = await page.evaluate(() => ({ imported: state.events.filter((e) => e.imported).length,
      kept: state.events.filter((e) => !e.imported).length }));
    ok('every imported row is gone', gone.imported === 0, gone);
    ok('and the one she logged herself is still there', gone.kept === 1, gone);
  }

  console.log('\n15. with no baby on the record the row is not offered at all');
  {
    /* Settings > Your data is a very plausible place to be three days after a loss: she is looking
       at export, or at delete. The row must not be sitting there offering to bring in old baby logs
       and then answering her tap with a chore. */
    await load(seed({ babies: [], activeBabyId: null }));
    const clicked = await openViaSettings();
    const dt = await sheetText();
    ok('Your data does not offer to bring in baby logs', clicked === false, dt.slice(0, 200));
    ok('but the sheet she asked for is still the one on screen', /your data/i.test(dt), dt.slice(0, 120));
    ok('and export and delete are still there', /export data/i.test(dt) && /delete data/i.test(dt), dt.slice(0, 240));
    await page.evaluate(() => { closeSheet(); openImport(); });
    await sleep(200);
    const t = await sheetText();
    const hasInput = await page.evaluate(() => !!document.getElementById('impFile'));
    ok('reached directly, there is still no picker', hasInput === false);
    ok('and it states why rather than handing her a task', /waits until there is a baby/i.test(t) && !/add a baby first/i.test(t), t);

    await load(seed());
    await openViaSettings(); await upload(HUGE);
    const t2 = await sheetText();
    const r = await page.evaluate(() => ({ total: importDraft.total, cap: importDraft.cap, take: importDraft.take.length,
      written: state.events.length }));
    ok('it reads the first 5000 and stops', r.total === 5000 && r.cap === 5002, r);
    ok('and says exactly that on screen', /read the first 5000 rows of 5002/i.test(t2), t2.slice(0, 400));
    ok('the 5000 are all still only a preview', r.take === 5000 && r.written === 0, r);
  }

  console.log('\n16. the day in one column and the clock in the next is not read as midnight');
  {
    await load(seed());
    await openViaSettings(); await upload(SPLIT);
    const t = await sheetText();
    const pre = await page.evaluate(() => ({ clock: importDraft.col.clock, take: importDraft.take.length,
      times: importDraft.take.map((e) => e.time).sort((a, b) => a - b) }));
    ok('the clock column is found even though no role asked for it', pre.clock === 1, pre);
    ok('both rows come in', pre.take === 2, pre);
    ok('the bottle keeps the hour the file gave it, not 00:00',
      pre.times[0] === T.bottle, { got: new Date(pre.times[0]).toString(), want: new Date(T.bottle).toString() });
    ok('and so does the nursing', pre.times[1] === T.nurse, { got: new Date(pre.times[1]).toString(), want: new Date(T.nurse).toString() });
    ok('not one row landed in the middle of the night',
      pre.times.every((x) => new Date(x).getHours() !== 0), pre.times.map((x) => new Date(x).getHours()));
    ok('and the preview shows her the hour before she agrees', /at \d{1,2}:\d{2}\s?(am|pm)/i.test(t), t);
    await page.evaluate(() => document.querySelector('#sheet .btn-primary').click());
    await sleep(400);
    const w = await page.evaluate(() => state.events.map((e) => e.time).sort((a, b) => a - b));
    ok('and that is what was written', w.length === 2 && w[0] === T.bottle && w[1] === T.nurse, w.map((x) => new Date(x).toString()));
  }

  console.log('\n17. a day with no hour anywhere is refused out loud, never invented');
  {
    await load(seed());
    await openViaSettings(); await upload(DATEONLY);
    const t = await sheetText();
    const r = await page.evaluate(() => ({ take: importDraft.take.length, n: state.events.length }));
    ok('nothing is brought in', r.take === 0 && r.n === 0, r);
    ok('and both rows are counted and named', /2 rows where the file gave the day but not the time/i.test(t), t);
    ok('with no save button', !/add \d+ entr/i.test(t), t);
  }

  console.log('\n18. a note beside a row cannot change what the row IS');
  {
    await load(seed());
    await openViaSettings(); await upload(NOTES);
    const t = await sheetText();
    await page.evaluate(() => document.querySelector('#sheet .btn-primary').click());
    await sleep(400);
    const r = await page.evaluate(() => state.events.map((e) => e.type + ':' + (e.method || e.kind || '')).sort());
    ok('"dirty nappy right after" on a nursing row is still a nursing feed', /1 nursing feed/i.test(t) && /1 bottle/i.test(t), t);
    ok('and no nappy that never happened is invented', !/napp/i.test(t), t);
    ok('both feeds are on the record, with nothing else', JSON.stringify(r) === JSON.stringify(['feed:bottle', 'feed:breast']), r);
    ok('"fell asleep halfway" did not turn the bottle into a sleep', r.indexOf('sleep:') < 0, r);
  }

  console.log('\n19. a zoned stamp carrying milliseconds is an ordinary export, not an unreadable file');
  {
    await load(seed());
    await openViaSettings(); await upload(ISOMS);
    const t = await sheetText();
    await page.evaluate(() => { const b = document.querySelector('#sheet .btn-primary'); if (b) b.click(); });
    await sleep(400);
    const r = await page.evaluate(() => state.events.map((e) => e.time));
    ok('it is not thrown away as undated', !/no date cubby could read/i.test(t), t);
    ok('and the instant survives exactly', r.length === 1 && r[0] === T.nurse, { got: r, want: T.nurse });
  }

  console.log('\n20. taking an import back out is scoped to this baby and to what she may delete');
  {
    const twins = [
      { id: 'r1', type: 'feed', method: 'bottle', babyId: 'b1', time: now - 3 * HOUR, authorId: 'local', imported: true },
      { id: 'r2', type: 'diaper', kind: 'wet', babyId: 'b1', time: now - 4 * HOUR, authorId: 'local', imported: true },
      { id: 'w1', type: 'feed', method: 'bottle', babyId: 'b2', time: now - 5 * HOUR, authorId: 'local', imported: true },
      { id: 'w2', type: 'diaper', kind: 'dirty', babyId: 'b2', time: now - 6 * HOUR, authorId: 'local', imported: true },
    ];
    await load(seed({ babies: [
      { id: 'b1', name: 'Robin', birth: now - 200 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] },
      { id: 'b2', name: 'Wren', birth: now - 200 * DAY, sex: 'M', routines: [], doctors: [], allergies: [] }],
      activeBabyId: 'b2', events: twins }));
    await openViaSettings();
    const t = await sheetText();
    ok('the sheet counts only this baby\'s brought-in rows', /2 entries on wren's timeline came from another app/i.test(t), t);
    await page.evaluate(() => [...document.querySelectorAll('#sheet button')].find((b) => /remove everything/i.test(b.textContent)).click());
    await sleep(250);
    const warn = await sheetText();
    ok('and the confirm names the baby and the real number', /removes the 2 entries you brought in for wren/i.test(warn), warn);
    await page.evaluate(() => document.querySelector('#sheet .btn-primary').click());
    await sleep(500);
    const g = await page.evaluate(() => ({ b1: state.events.filter((e) => e.babyId === 'b1').length,
      b2: state.events.filter((e) => e.babyId === 'b2').length }));
    ok('Wren\'s import is gone', g.b2 === 0, g);
    ok('and her sister\'s history is untouched', g.b1 === 2, g);
  }

  console.log('\n21. a caregiver cannot take out rows the rules will not let her delete');
  {
    /* firestore.rules allows a delete only from the owner or the row's own author. Removing the
       owner's rows locally would look like it worked, then be refused on every push, which is the
       "Cubby wasn't allowed to save that" retry loop. So they are never offered. */
    await load(seed({ events: [
      { id: 'm1', type: 'feed', method: 'bottle', babyId: 'b1', time: now - 3 * HOUR, authorId: 'local', imported: true },
      { id: 'm2', type: 'diaper', kind: 'wet', babyId: 'b1', time: now - 4 * HOUR, authorId: 'local', imported: true },
      { id: 's1', type: 'feed', method: 'breast', babyId: 'b1', time: now - 5 * HOUR, authorId: 'uidSam', imported: true },
    ] }));
    await page.evaluate(() => { window.LL = { auth: { currentUser: { uid: 'uidSam' } }, role: 'caregiver',
      members: { local: 'owner', uidSam: 'caregiver' },
      memberInfo: { local: { name: 'Maya', relationship: 'Mama' }, uidSam: { name: 'Sam', relationship: 'Papa' } } }; });
    await page.evaluate(() => { closeSheet(); openImport(); });
    await sleep(250);
    const t = await sheetText();
    ok('Sam is offered only his own brought-in row', /1 entry on robin's timeline came from another app/i.test(t), t);
    await page.evaluate(() => [...document.querySelectorAll('#sheet button')].find((b) => /remove everything/i.test(b.textContent)).click());
    await sleep(250);
    const warn = await sheetText();
    ok('and the confirm says one, not three', /removes the 1 entry you brought in for robin/i.test(warn), warn);
    await page.evaluate(() => document.querySelector('#sheet .btn-primary').click());
    await sleep(500);
    const g = await page.evaluate(() => state.events.map((e) => e.id).sort());
    ok('the owner\'s two rows are still there', JSON.stringify(g) === JSON.stringify(['m1', 'm2']), g);
  }

  console.log('\n22. no surface anywhere signs a brought-in row with a person\'s name');
  {
    const mkImported = () => [
      { id: 'i1', type: 'feed', method: 'bottle', amount: 90, unit: 'ml', babyId: 'b1', time: now - 2 * HOUR, authorId: 'uidSam', imported: true },
      { id: 'i2', type: 'feed', method: 'breast', dur: 10 * MIN, babyId: 'b1', time: now - 3 * HOUR, authorId: 'uidSam', imported: true },
      { id: 'i3', type: 'sleep', babyId: 'b1', time: now - 5 * HOUR, end: now - 4 * HOUR, authorId: 'uidSam', imported: true },
      { id: 'i4', type: 'diaper', kind: 'wet', babyId: 'b1', time: now - 90 * MIN, authorId: 'uidSam', imported: true },
    ];
    await load(seed({ events: mkImported() }));
    // The away window is anchored on a per-uid stamp that earlier sections in this run have already
    // moved. Reset it, or the card is empty for a reason that has nothing to do with imports.
    const surfaces = () => page.evaluate(() => { _awaySince = 0;
      return { day: daySurfaceRecap(now()), txt: dayRecapText(), away: awayRecap() }; });
    const r = await surfaces();
    ok('the day card counts them but credits nobody', /feed/i.test(r.day) && !/logged by/i.test(r.day), r.day);
    ok('and says where they came from instead', /brought in from another app/i.test(r.day), r.day);
    /* This one is the serious one: that text is copied out of Cubby to a partner or a doctor. */
    ok('the shareable recap does not say "Logged by: Papa"', !/logged by/i.test(r.txt), r.txt.slice(0, 400));
    ok('it says they were brought in', /brought in from another app/i.test(r.txt), r.txt.slice(0, 400));
    ok('and it still carries the real counts', /feeds: 2/i.test(r.txt) && /nappies: 1/i.test(r.txt), r.txt.slice(0, 400));
    ok('"while you were away" does not report an import as somebody logging', r.away === '', r.away.slice(0, 200));

    // The control: a real entry by a real person must still say his name on all three.
    await load(seed({ events: mkImported().concat([
      { id: 'real', type: 'diaper', kind: 'dirty', babyId: 'b1', time: now - HOUR, authorId: 'uidSam' }]) }));
    const r2 = await surfaces();
    ok('a genuine entry is still credited on the day card', /logged by papa/i.test(r2.day), r2.day);
    ok('and in the shareable recap', /logged by: papa/i.test(r2.txt), r2.txt.slice(0, 400));
    ok('and the away card comes back for it', /logged by papa/i.test(r2.away), r2.away.slice(0, 300));
    ok('the away card counts every nappy, imported or not', /2 nappy changes/i.test(r2.away), r2.away.slice(0, 300));
  }

  console.log('\n23. the chapter that explains this sheet is actually reachable from it');
  {
    await load(seed());
    await openViaSettings();
    const dot = await page.evaluate(() => {
      const h = document.querySelector('#sheet h2');
      return { h2: (h.textContent || '').replace(/i$/, '').trim(), hasDot: !!h.querySelector('.lg-i') };
    });
    ok('the heading echoes the row she just tapped', /^bring in old logs$/i.test(dot.h2), dot);
    ok('and it carries its "i", so the explainer is not orphaned', dot.hasDot === true, dot);
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'CSV-IMPORT: FAIL' : 'CSV-IMPORT: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
