#!/usr/bin/env node
/* The round button was offering a pregnant woman the two tools her own home screen was hiding.
 *
 * renderPregHome withholds the kick counter until 28 weeks and the contraction timer until 36, and
 * its comment says why: a "count your baby's movements" shortcut at eight weeks only worries, and
 * 5-1-1 is a labour tool. But QUICK_DEFAULTS.pregnancy is ['kicks','contractions','symptom'] and
 * quickAvailable filtered on stage alone, so the floating button on that very screen offered both
 * from week one. A mother at nine weeks, on the day she is most frightened and least able to reason
 * about it, could tap "Kicks · count the movements" and sit there feeling nothing.
 *
 * Worse at the other end: the trying stage is quickStage()==='pregnancy' too, and p.lmp there is her
 * last PERIOD, so pregWeek() answers with a cycle length. A woman still trying to conceive who had
 * logged a period and left it was handed a kick counter for a baby that does not exist yet.
 *
 * One rule now, in QUICK_ACTIONS: minWeek 28 and 36, applied by quickAvailable, matching the home
 * tiles exactly. The customiser still lists both, because some mothers are asked to start counting
 * early, and turning one on there means now (quickPrefs().early), not in ten weeks. The gate holds
 * the parts that are easy to get wrong:
 *
 *   1. The week gate must never eat a choice she made. Editing the list at eight weeks must not
 *      silently drop kicks out of her saved picks so that 28 weeks arrives and nothing comes back.
 *   2. Turning a gated entry ON must actually put it on the button, or the row is a dead control.
 *   3. Turning it OFF after her week has come must stay off, and must not read as "too early".
 *   4. The baby and child stages carry no minWeek and must be untouched.
 *
 * Four more, every one of them a failure two reviewers reproduced in a browser against the first
 * cut of this change, all of which the gate was green on:
 *
 *   5. The override is a permission for ONE pregnancy. Stored per-uid with nothing to identify the
 *      pregnancy, "my midwife asked me to count from 26 weeks" survived a loss and met her again at
 *      seven weeks in the next one. It is stamped with the pregnancy id now (section 11).
 *   6. The stage is read before the override, never after. A leftover flag beat the trying-stage
 *      guard and handed a woman still trying a kick counter and a labour timer (section 12).
 *   7. On, then off again, is an undo. Taking the pick out as well deleted a default she cannot see,
 *      so 28 weeks arrived and nothing came back (section 13).
 *   8. A week gate emptying her surfaces is not the same answer as her emptying them. Turning ONE
 *      row off at ten weeks took the round button off every screen and told her she had chosen
 *      nothing (section 7).
 *
 *   PORT=9744 node tools/serve.js &
 *   node tools/quick_minweek_check.js http://localhost:9744
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:9744';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

// weeksPregnant -> a pregnancy record at that gestation. pregWeek() reads dueDate first.
const preg = (weeks, over) => Object.assign({
  id: 'p1', ownerUid: 'local', stage: 'expecting',
  dueDate: now + (40 - weeks) * 7 * DAY, lmp: now - weeks * 7 * DAY, cycleLen: 28, periods: [],
  country: 'us', precon: [], careTeam: [], appts: [], symptoms: [], weights: [], bp: [],
  kicks: [], contractions: [], birthPlan: '', bag: [], moments: [], conditions: {}, glucose: [],
  urine: [], supplements: [], supplementLog: [], nausea: [], glucoseUnit: 'mmol',
  bornBabyId: null, createdAt: now - weeks * 7 * DAY,
}, over || {});
const seed = (p, over) => Object.assign({
  babies: [], activeBabyId: null, events: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], notes: [], pregnancy: p,
}, over || {});
const baby = () => seed(null, {
  babies: [{ id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
  activeBabyId: 'b1',
});

(async () => {
  /* Twelve worktrees are running servers on this range and two of them already collided on a port
     picked at random. Prove the tree being graded is the one carrying the change before believing a
     single number below. */
  let src = '';
  try { src = await (await fetch(BASE + '/app/index.html')).text(); } catch (e) { src = ''; }
  ok('the tree served at ' + BASE + ' is the one carrying this change',
    /minWeek:28/.test(src) && /function quickTooEarly/.test(src), src ? src.length + ' bytes, no marker' : 'could not fetch');

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

  /* The per-user picks live in localStorage and several sections here depend on carrying them across
     a reseed on purpose (that is what "she comes back at 30 weeks" is), so clearing them is a
     separate, deliberate call rather than something load() does behind the test's back. */
  const clearPrefs = () => page.evaluate(() => { localStorage.removeItem('cubby-quick-local'); });
  const prefs = () => page.evaluate(() => JSON.parse(localStorage.getItem('cubby-quick-local') || '{}'));
  const load = async (s) => {
    await page.evaluate((x) => {
      localStorage.setItem('little-log-v1', JSON.stringify(x));
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
    }, s);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1400);
  };
  // A click that lands on nothing turns every assertion after it into a tautology, silently, in a run
  // that still reports PASS. A miss is a failure, at the point it happens.
  const click = async (sel) => {
    const hit = await page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.click(); return true; }, sel);
    if (!hit) ok('a real control exists to click for ' + sel, false);
    return hit;
  };
  const closeSheet = () => page.evaluate(() => { try { window.closeSheet(); } catch (e) {} });

  /* What the floating button ACTUALLY offers: the buttons rendered into the sheet, read back by the
     function each one would call. Counted, never sampled: [].every() is true of an empty sheet.
     It goes through the round button itself when there is one, because "on the button" is a claim
     about a door she can reach — calling openQuickLog() straight off describes a sheet behind a
     button that may not be on the screen at all. `qadd` records which of the two happened. */
  const fabTiles = async () => {
    const qadd = await page.evaluate(() => {
      const el = document.querySelector('.qadd');
      if (el) { el.click(); return true; }
      openQuickLog(); return false;
    });
    await sleep(260);
    const r = await page.evaluate(() => {
      const s = document.getElementById('sheet');
      const btns = [].slice.call(s ? s.querySelectorAll('.actions .action') : []);
      return { fns: btns.map((b) => (b.getAttribute('onclick') || '').trim()),
        labels: btns.map((b) => { const l = b.querySelector('.label'); return l ? l.textContent.trim() : ''; }) };
    });
    await closeSheet();
    r.qadd = qadd;
    return r;
  };
  // What the pregnancy home screen itself puts under "This week", from the live DOM inside #scroll.
  const homeTools = () => page.evaluate(() => {
    const sc = document.getElementById('scroll');
    return [].slice.call(sc ? sc.querySelectorAll('button.action') : []).map((b) => (b.getAttribute('onclick') || '').trim());
  });
  // The customiser, row by row: what is listed, what is ticked, what each row says.
  const rows = async () => {
    await page.evaluate(() => openQuickSettings());
    await sleep(260);
    return page.evaluate(() => {
      const s = document.getElementById('sheet');
      const out = {};
      [].slice.call(s ? s.querySelectorAll('.bag-row') : []).forEach((r) => {
        out[(r.id || '').replace('qs-', '')] = { on: r.classList.contains('done'), txt: (r.innerText || '').replace(/\s+/g, ' ').trim() };
      });
      return { out, n: Object.keys(out).length, sheet: ((s && s.innerText) || '').replace(/\s+/g, ' ').trim() };
    });
  };
  /* A throw skips the rest of its section, so the denominator shrinks and two runs stop being
     comparable — a reverted tree "lost" four assertions that way and looked less red than it was.
     Count the sections that finished and assert the number at the end. */
  let ran = 0;
  const section = async (name, fn) => {
    console.log('\n' + name);
    try { await fn(); ran++; } catch (e) { ok(name + ' ran to the end', false, String((e && e.message) || e)); }
  };

  await section('1. nine weeks: the button offers what the screen behind it offers', async () => {
    await clearPrefs();
    await load(seed(preg(9)));
    const wk = await page.evaluate(() => pregWeek());
    ok('the seeded record really is early', wk === 9, wk);
    const t = await fabTiles();
    ok('no kick counter', t.fns.indexOf('openKickCounter()') < 0, t.fns);
    ok('no contraction timer', t.fns.indexOf('openContractions()') < 0, t.fns);
    ok('and it is not empty either, it is her symptom logger', t.fns.length === 1 && t.fns[0] === 'openLogSymptom()', t.fns);
    const home = await homeTools();
    ok('the home screen agrees, it shows neither', home.indexOf('openKickCounter()') < 0 && home.indexOf('openContractions()') < 0, home);
    ok('the round button is still there to be tapped', await page.evaluate(() => !!document.querySelector('.qadd')), null);
  });

  await section('2. twenty-seven weeks, then twenty-eight: the boundary is the home tile boundary', async () => {
    await clearPrefs();
    await load(seed(preg(27)));
    ok('the seeded record is 27 weeks', await page.evaluate(() => pregWeek()) === 27, null);
    let t = await fabTiles(); let home = await homeTools();
    ok('27 weeks: no kicks on the button', t.fns.indexOf('openKickCounter()') < 0, t.fns);
    ok('27 weeks: no kicks on home either', home.indexOf('openKickCounter()') < 0, home);

    await load(seed(preg(28)));
    ok('the seeded record is 28 weeks', await page.evaluate(() => pregWeek()) === 28, null);
    t = await fabTiles(); home = await homeTools();
    ok('28 weeks: kicks arrive on the button', t.fns.indexOf('openKickCounter()') >= 0, t.fns);
    ok('28 weeks: and on home, the same week', home.indexOf('openKickCounter()') >= 0, home);
    ok('28 weeks: the labour timer is still not offered', t.fns.indexOf('openContractions()') < 0, t.fns);
    ok('28 weeks: two tiles, kicks and symptom, nothing else crept in', t.fns.length === 2, t.fns);
  });

  await section('3. thirty-six weeks: the labour timer, and only then', async () => {
    await clearPrefs();
    await load(seed(preg(35)));
    let t = await fabTiles();
    ok('35 weeks: no contraction timer', t.fns.indexOf('openContractions()') < 0, t.fns);
    ok('35 weeks: kicks are there, so this is the week gate and not a blanket hide', t.fns.indexOf('openKickCounter()') >= 0, t.fns);
    await load(seed(preg(36)));
    t = await fabTiles();
    const home = await homeTools();
    ok('36 weeks: the timer is offered', t.fns.indexOf('openContractions()') >= 0, t.fns);
    ok('36 weeks: home offers it too', home.indexOf('openContractions()') >= 0, home);
    ok('36 weeks: all three, kicks, contractions, symptom', t.fns.length === 3, t.fns);
  });

  await section('4. still trying to conceive: a stale period is not a gestation', async () => {
    await clearPrefs();
    // She logged a period 30 weeks ago and stopped using the cycle tracker. pregWeek() has no idea.
    await load(seed(preg(30, { stage: 'planning', dueDate: null, lmp: now - 30 * 7 * DAY })));
    const wk = await page.evaluate(() => pregWeek());
    ok('pregWeek() really does read this as 30 weeks, which is the trap', wk >= 28, wk);
    const r = await page.evaluate(() => quickChosen('pregnancy'));
    ok('she is offered no kick counter', r.indexOf('kicks') < 0, r);
    ok('and no contraction timer', r.indexOf('contractions') < 0, r);
    ok('her symptom logger is untouched', r.indexOf('symptom') >= 0 && r.length === 1, r);
  });

  await section('5. the customiser still lists both, and says which week', async () => {
    await clearPrefs();
    await load(seed(preg(10)));
    const r = await rows();
    ok('Kicks is still a row at ten weeks', !!r.out.kicks, Object.keys(r.out));
    ok('so is Contractions', !!r.out.contractions, Object.keys(r.out));
    ok('four rows in all: kicks, contractions, symptom, mood', r.n === 4, r.out);
    ok('Kicks is not ticked', r.out.kicks.on === false, r.out.kicks);
    ok('and the row says when it arrives', /usually from week 28/i.test(r.out.kicks.txt), r.out.kicks.txt);
    ok('the sheet says once that she can bring it forward', /asked to start sooner/i.test(r.sheet), r.sheet.slice(0, 400));
    ok('and says it ONCE, not on every row', (r.sheet.match(/asked to start sooner/gi) || []).length === 1, r.sheet.slice(0, 400));
    ok('Contractions names its own week, not the kick one', /usually from week 36/i.test(r.out.contractions.txt), r.out.contractions.txt);
    ok('Symptom, which has no week, says nothing about weeks', !/week/i.test(r.out.symptom.txt), r.out.symptom.txt);
    await closeSheet();
  });

  await section('6. asked to count early: turning it on means now', async () => {
    await clearPrefs();
    await load(seed(preg(26)));
    await rows();
    await click('#qs-kicks');
    await sleep(300);
    const r = await page.evaluate(() => {
      const el = document.getElementById('qs-kicks');
      return { on: !!(el && el.classList.contains('done')), txt: el ? (el.innerText || '').replace(/\s+/g, ' ').trim() : null };
    });
    ok('the row ticks', r.on === true, r);
    ok('and says it is early on purpose', /ahead of the usual week 28/i.test(r.txt || ''), r.txt);
    const p = await prefs();
    ok('the choice is recorded as "early", apart from the ordinary picks', !!(p.early && p.early.kicks), p);
    // Stamped with the pregnancy, not a bare 1: that stamp is what stops it crossing into the next.
    ok('and it is stamped with the pregnancy it was granted in', p.early.kicks === 'p1', p.early);
    await closeSheet();
    const t = await fabTiles();
    ok('the kick counter is genuinely on the button now', t.fns.indexOf('openKickCounter()') >= 0, t.fns);
    ok('and the timer she did not ask for is not', t.fns.indexOf('openContractions()') < 0, t.fns);

    // A reload is the real test of a preference: hers is per-user localStorage, not memory.
    await load(seed(preg(26)));
    const t2 = await fabTiles();
    ok('it survives closing and reopening Cubby', t2.fns.indexOf('openKickCounter()') >= 0, t2.fns);
  });

  await section('7. the week gate never eats a choice she made', async () => {
    await clearPrefs();
    await load(seed(preg(10)));
    await rows();
    await click('#qs-symptom');            // she tidies the list at ten weeks
    await sleep(300);
    const p = await prefs();
    ok('symptom comes off', (p.pick.pregnancy || []).indexOf('symptom') < 0, p.pick);
    ok('kicks stays in her saved list even though it is not showing', (p.pick.pregnancy || []).indexOf('kicks') >= 0, p.pick);
    ok('and so does the contraction timer', (p.pick.pregnancy || []).indexOf('contractions') >= 0, p.pick);
    // The early map is written and empty, which is a stronger claim than "no kicks key anywhere":
    // the latter is also true of a tree that has never heard of the feature.
    ok('tidying up did NOT read as "give me a kick counter at ten weeks"', !!p.early && !p.early.kicks, p.early);
    await closeSheet();
    const t = await fabTiles();
    ok('nothing appears early because of that edit', t.fns.indexOf('openKickCounter()') < 0 && t.fns.indexOf('openContractions()') < 0, t.fns);

    /* She turned ONE row off and everything she has left is week-gated. The round button must not
       quietly leave the app: she did not empty her list, the calendar did, and a button that
       vanishes from every screen after one tap is a bug she has no way to diagnose. */
    ok('the round button is still on the screen after that one edit', await page.evaluate(() => !!document.querySelector('.qadd')), null);
    ok('and it really was the round button the tiles came through', t.qadd === true, t.qadd);
    ok('the sheet behind it is a door, not a blank', t.fns.length === 1 && t.fns[0] === 'openQuickSettings()', t.fns);
    const doorTxt = await page.evaluate(async () => {
      openQuickLog();
      await new Promise((r) => setTimeout(r, 260));
      const s = document.getElementById('sheet');
      const txt = ((s && s.innerText) || '').replace(/\s+/g, ' ').trim();
      try { closeSheet(); } catch (e) {}
      return txt;
    });
    ok('and it says why, rather than "nothing showing here yet"', /arrives later on/i.test(doorTxt) && !/Nothing showing here yet/i.test(doorTxt), doorTxt);
    const rh = await rows();
    ok('the customiser does not tell her she chose nothing, because she did not', !/With none chosen/i.test(rh.sheet), rh.sheet.slice(0, 500));
    ok('it tells her they arrive later on', /Nothing is showing yet\. Some arrive later on\./i.test(rh.sheet), rh.sheet.slice(0, 500));
    ok('and says it once, in one paragraph, not two stacked ones', (rh.sheet.match(/arrive later on/gi) || []).length === 1, rh.sheet.slice(0, 500));
    await closeSheet();

    // Twenty weeks later, same phone, same prefs: the thing she never turned off comes back on time.
    await load(seed(preg(30)));
    const t2 = await fabTiles();
    ok('at 30 weeks the kick counter arrives on its own', t2.fns.indexOf('openKickCounter()') >= 0, t2.fns);
    ok('the timer she has not reached yet does not', t2.fns.indexOf('openContractions()') < 0, t2.fns);
    ok('and symptom is still off, because that was her decision', t2.fns.indexOf('openLogSymptom()') < 0, t2.fns);
  });

  await section('8. off after her week has come stays off, and does not read as too early', async () => {
    await clearPrefs();
    await load(seed(preg(38)));
    let t = await fabTiles();
    ok('at 38 weeks she starts with all three', t.fns.length === 3, t.fns);
    await rows();
    await click('#qs-contractions');
    await sleep(300);
    const r = await page.evaluate(() => {
      const el = document.getElementById('qs-contractions');
      return { on: el.classList.contains('done'), txt: (el.innerText || '').replace(/\s+/g, ' ').trim() };
    });
    ok('the row unticks', r.on === false, r);
    ok('and does NOT tell a woman at 38 weeks it starts at 36', !/usually from week/i.test(r.txt), r.txt);
    const rr = await rows();
    ok('nor does the sheet still talk about weeks she is past', !/asked to start sooner/i.test(rr.sheet), rr.sheet.slice(0, 400));
    await closeSheet();
    t = await fabTiles();
    ok('the timer is off the button', t.fns.indexOf('openContractions()') < 0, t.fns);
    await load(seed(preg(38)));
    t = await fabTiles();
    ok('and stays off across a reload', t.fns.indexOf('openContractions()') < 0, t.fns);
    ok('while kicks and symptom are untouched', t.fns.length === 2, t.fns);
    /* Every other check in this section is true of a tree with no week rule at all, because at 38
       weeks all the rules agree. Ask the rule itself, so this section can go red too. */
    const late = await page.evaluate(() => quickTooEarly(quickCatalog('pregnancy').filter((a) => a.k === 'contractions')[0]));
    ok('the rule itself says 38 weeks is not early for the labour timer', late === false, late);
  });

  await section('9. reset puts the usual weeks back too', async () => {
    await clearPrefs();
    await load(seed(preg(20)));
    await rows();
    await click('#qs-kicks');              // asked to count early
    await sleep(300);
    let t = await fabTiles();
    ok('kicks is on early', t.fns.indexOf('openKickCounter()') >= 0, t.fns);
    await rows();
    await click('.btn-ghost[onclick="resetQuickActions()"]');
    await sleep(300);
    const p = await prefs();
    ok('the early override is cleared, not left behind under the defaults', !!p.early && !p.early.kicks, p);
    await closeSheet();
    t = await fabTiles();
    ok('and at 20 weeks the kick counter is gone again', t.fns.indexOf('openKickCounter()') < 0, t.fns);
  });

  await section('10. the baby stage carries no weeks and is untouched', async () => {
    await clearPrefs();
    await load(baby());
    const r = await page.evaluate(() => ({
      stage: quickStage(),
      avail: quickAvailable().map((a) => a.k),
      cat: quickCatalog().map((a) => a.k),
      chosen: quickChosen(),
    }));
    ok('this is the baby stage', r.stage === 'baby', r.stage);
    ok('nothing is filtered out of it', r.avail.length === r.cat.length && r.avail.length === 8, r);
    ok('the usual five tiles plus voice are chosen', r.chosen.join(',') === 'feed,sleep,diaper,measure,activity,voice', r.chosen);
    const rr = await rows();
    ok('the customiser lists all eight, unchanged', rr.n === 8, rr.out);
    ok('and not one row talks about weeks', Object.keys(rr.out).every((k) => !/week/i.test(rr.out[k].txt)) && rr.n === 8, rr.out);
    await closeSheet();
  });

  await section('11. a permission from the pregnancy she lost does not follow her into the next one', async () => {
    await clearPrefs();
    await load(seed(preg(26)));                       // pregnancy p1, her midwife asked her to count
    await rows();
    await click('#qs-kicks');
    await sleep(300);
    let t = await fabTiles();
    ok('she has her kick counter at 26 weeks, because she asked for it', t.fns.indexOf('openKickCounter()') >= 0, t.fns);

    /* endPregnancy() clears state.pregnancy and a new record is created with a fresh uid(). The
       prefs blob is per-user and survives all of it, which is the whole hazard. */
    await load(seed(preg(7, { id: 'p2' })));
    const p = await prefs();
    ok('her preferences did survive, so this is not a test of a wipe', !!(p.early && p.early.kicks), p);
    t = await fabTiles();
    ok('but there is NO kick counter at seven weeks of the next pregnancy', t.fns.indexOf('openKickCounter()') < 0, t.fns);
    const home = await homeTools();
    ok('and the home screen behind it agrees, as it always did', home.indexOf('openKickCounter()') < 0, home);
    const r = await rows();
    ok('the row reads as not yet, not as showing now', /usually from week 28/i.test(r.out.kicks.txt) && !/ahead of the usual/i.test(r.out.kicks.txt), r.out.kicks.txt);
    await closeSheet();

    // Same prefs, back on the pregnancy it was granted for: her own word still stands there.
    await load(seed(preg(26)));
    t = await fabTiles();
    ok('and in the pregnancy she was actually asked about, it still stands', t.fns.indexOf('openKickCounter()') >= 0, t.fns);
  });

  await section('12. a leftover early flag does not hand a counter to a woman who is still trying', async () => {
    await clearPrefs();
    // She was counting kicks in a pregnancy that ended. Now she is trying again: no gestation at all.
    await page.evaluate(() => localStorage.setItem('cubby-quick-local', JSON.stringify({
      on: true, pick: { pregnancy: ['kicks', 'contractions', 'symptom'] }, early: { kicks: 'p1', contractions: 'p1' },
    })));
    await load(seed(preg(30, { stage: 'planning', dueDate: null, lmp: now - 30 * 7 * DAY })));
    ok('pregWeek() still reads this as 30 weeks, which is the trap', await page.evaluate(() => pregWeek()) >= 28, null);
    ok('and the flags really are still in storage', await page.evaluate(() => !!JSON.parse(localStorage.getItem('cubby-quick-local')).early.kicks), null);
    const t = await fabTiles();
    ok('no kick counter for a baby who is not there yet', t.fns.indexOf('openKickCounter()') < 0, t.fns);
    ok('and no contraction timer either', t.fns.indexOf('openContractions()') < 0, t.fns);
    ok('her symptom logger is untouched', t.fns.indexOf('openLogSymptom()') >= 0, t.fns);
    const r = await rows();
    ok('the customiser does not list a kick counter to her at all', !r.out.kicks, Object.keys(r.out));
    ok('nor a contraction timer', !r.out.contractions, Object.keys(r.out));
    ok('and not one row on that sheet mentions a week she does not have', !/week \d/i.test(r.sheet), r.sheet.slice(0, 400));
    await closeSheet();
  });

  await section('13. she taps it on, changes her mind, and 28 weeks still arrives', async () => {
    await clearPrefs();
    await load(seed(preg(10)));
    await rows();
    await click('#qs-kicks');                        // on, early
    await sleep(300);
    let p = await prefs();
    ok('the override is set by the first tap', !!(p.early && p.early.kicks), p);
    await click('#qs-kicks');                        // and off again, a second thought
    await sleep(300);
    p = await prefs();
    ok('the override is gone', !!p.early && !p.early.kicks, p.early);
    ok('and her saved list is exactly where it was: kicks still in it', (p.pick.pregnancy || []).indexOf('kicks') >= 0, p.pick);
    ok('with the other two untouched', (p.pick.pregnancy || []).indexOf('contractions') >= 0 && (p.pick.pregnancy || []).indexOf('symptom') >= 0, p.pick);
    const r = await page.evaluate(() => {
      const el = document.getElementById('qs-kicks');
      return { on: !!(el && el.classList.contains('done')), txt: el ? (el.innerText || '').replace(/\s+/g, ' ').trim() : null };
    });
    ok('the row is back to unticked and back to "usually from week 28"', r.on === false && /usually from week 28/i.test(r.txt || ''), r);
    await closeSheet();
    let t = await fabTiles();
    ok('nothing is on the button at ten weeks', t.fns.indexOf('openKickCounter()') < 0, t.fns);
    // The whole point: a tap and a second thought must not delete a default she cannot see.
    await load(seed(preg(30)));
    t = await fabTiles();
    ok('and at 30 weeks the kick counter arrives, as it would have all along', t.fns.indexOf('openKickCounter()') >= 0, t.fns);
  });

  await section('14. a second caregiver: the owner-only gate and the week rule both still hold', async () => {
    await clearPrefs();
    await load(seed(preg(10)));
    await page.evaluate(() => { window.LL = window.LL || {}; window.LL.matIsOwner = function () { return false; }; render(); });
    await sleep(300);
    let r = await page.evaluate(() => ({ cat: quickCatalog('pregnancy').map((a) => a.k), avail: quickAvailable('pregnancy').map((a) => a.k) }));
    ok('the private mood note is not his to see, at any week', r.cat.indexOf('mood') < 0, r.cat);
    ok('and the week rule still holds for him at ten weeks', r.avail.indexOf('kicks') < 0 && r.avail.indexOf('contractions') < 0, r.avail);
    await load(seed(preg(30)));
    await page.evaluate(() => { window.LL = window.LL || {}; window.LL.matIsOwner = function () { return false; }; render(); });
    await sleep(300);
    r = await page.evaluate(() => quickAvailable('pregnancy').map((a) => a.k));
    ok('at 30 weeks the kick counter is there for him too, mood is still not', r.indexOf('kicks') >= 0 && r.indexOf('mood') < 0, r);
    await page.evaluate(() => { try { delete window.LL.matIsOwner; } catch (e) {} });
  });

  ok('every section ran to the end, so these counts are comparable to another run', ran === 14, ran);
  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'QUICK-MINWEEK: FAIL' : 'QUICK-MINWEEK: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
