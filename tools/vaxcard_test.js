// Gate for the vaccine-card import (app/vax-card.js).
//
// This feature writes into a medical record from a photograph, so the assertions here are mostly
// about what it must REFUSE to do:
//   - never create a schedule row (an unreadable scribble must not be able to invent a dose)
//   - never set v.missed (the only path to amber, earned only by a parent saying so)
//   - never call addEvent (twelve backdated doses stamped with today's author is not a log)
//   - never accept a date in the future or before the child was born
//   - never write a row the parent left blank
// Plus the matcher: dd/mm versus mm/dd is not guessed, both readings are offered and the schedule
// picks, which is the whole reason this is a matching problem rather than a parsing one.
//
// The photograph never leaves the device (founder decision, 2026-08-08), so there is no network
// assertion to make here; the absence of one is the point.
//
//   node tools/serve.js &   &&   node tools/vaxcard_test.js [baseUrl]
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP = (process.argv[2] || 'http://localhost:8080') + '/app/?e2e=1';
const DAY = 86400000;

let fails = 0, passes = 0;
const ck = (ok, what, d) => { ok ? (passes++, console.log('  ok   ' + what)) : (fails++, console.log('  FAIL ' + what + (d ? '  ' + d : ''))); };

const SEED = {
  babies: [{ id: 'b1', name: 'Aria', birth: Date.now() - 400 * DAY, sex: 'F', country: 'uk', routines: [] }],
  activeBabyId: 'b1', events: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', theme: 'light', seen: {} },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], pregnancy: null, notes: []
};

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.setViewport({ width: 390, height: 850, deviceScaleFactor: 1 });
  await p.goto(APP, { waitUntil: 'networkidle2' });
  await p.evaluate(s => {
    localStorage.setItem('little-log-v1', JSON.stringify(s));
    localStorage.setItem('cubby-quick-uid', 'local');
    localStorage.setItem('cubby-theme:local', 'light');
    localStorage.removeItem('cubby-seen-local');
  }, SEED);
  await p.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1700));

  console.log('\n1. it loads and leaves the app shell alone');
  const load = await p.evaluate(() => ({
    api: typeof CubbyVaxCard === 'object',
    open: typeof cubbyOpenVaxCard === 'function',
    ctx: typeof cubbyVaxCtx === 'function',
    commit: typeof cubbyVaxCommit === 'function'
  }));
  ck(load.api && load.open && load.ctx && load.commit, 'CubbyVaxCard, cubbyOpenVaxCard, cubbyVaxCtx and cubbyVaxCommit are defined', JSON.stringify(load));

  const shell = await p.evaluate(() => {
    const before = document.getElementById('scroll');
    CubbyVaxCard.open();
    const o = document.getElementById('vaxCard');
    const r = { onBody: !!(o && o.parentNode === document.body), survived: document.getElementById('scroll') === before };
    CubbyVaxCard.close();
    r.gone = !document.getElementById('vaxCard');
    return r;
  });
  ck(shell.onBody, 'the overlay is appended to document.body, not into the shell');
  ck(shell.survived, 'the #scroll node survives, so iOS scroll momentum does');
  ck(shell.gone, 'closing removes it entirely');

  console.log('\n2. the schedule is offered as a table, one row per dose');
  const table = await p.evaluate(() => {
    CubbyVaxCard.begin(false);                       // the manual path, no photo
    const o = document.getElementById('vaxCard');
    const rows = o.querySelectorAll('.vc-row').length;
    const dates = o.querySelectorAll('input[type="date"]').length;
    const maxes = [...o.querySelectorAll('input[type="date"]')].every(i => i.getAttribute('max'));
    const planLen = cubbyVaxCtx().rows.length;
    const noPhoto = !o.querySelector('.vc-shot');
    CubbyVaxCard.close();
    return { rows, dates, maxes, planLen, noPhoto };
  });
  ck(table.rows === table.planLen && table.rows > 5, 'a row for every dose in the schedule', 'rows=' + table.rows + ' plan=' + table.planLen);
  ck(table.dates === table.rows, 'every row has its own date field');
  ck(table.maxes, 'no date field will accept a day in the future');
  ck(table.noPhoto, 'the manual path shows no photo frame');

  console.log('\n3. the writer patches, and refuses everything else');
  const w = await p.evaluate(() => {
    const birth = state.babies[0].birth;
    const before = JSON.parse(JSON.stringify(state.vaccines[state.activeBabyId] || []));
    const n0 = before.length;
    const evBefore = (state.events || []).length;
    const good = birth + 60 * 86400000;
    const out = {};
    out.wrote = cubbyVaxCommit([{ i: 0, at: good }]);
    const plan = state.vaccines[state.activeBabyId];
    out.rowCount = plan.length;
    out.given = !!plan[0].given;
    out.date = plan[0].givenAt === good;
    out.notEstimated = plan[0].estimated === false;
    out.source = plan[0].source === 'card';
    out.noMissed = !plan[0].missed;
    out.noEvents = (state.events || []).length === evBefore;
    // refusals
    out.future = cubbyVaxCommit([{ i: 1, at: Date.now() + 10 * 86400000 }]);
    out.preBirth = cubbyVaxCommit([{ i: 2, at: birth - 30 * 86400000 }]);
    out.badIndex = cubbyVaxCommit([{ i: 9999, at: good }]);
    out.noDate = cubbyVaxCommit([{ i: 3, at: 0 }]);
    out.stillSameRows = state.vaccines[state.activeBabyId].length === n0;
    out.untouched = !plan[1].given && !plan[2].given && !plan[3].given;
    return out;
  });
  ck(w.wrote === 1 && w.given && w.date, 'a confirmed row is marked given at the stated date');
  ck(w.notEstimated && w.source, 'and it is a real date, tagged as coming from the card');
  ck(w.noMissed, 'it never sets the missed flag, which is the only path to amber');
  ck(w.noEvents, 'it writes no timeline events: backdated history is not a log entry');
  ck(w.future === 0, 'a date in the future is refused');
  ck(w.preBirth === 0, 'a date before the child was born is refused');
  ck(w.badIndex === 0, 'an unknown row is refused');
  ck(w.noDate === 0, 'a row with no date is refused');
  ck(w.stillSameRows, 'the schedule never grows: it cannot invent a dose');
  ck(w.untouched, 'and every refused row is left exactly as it was');

  console.log('\n4. reading dates: both readings offered, the schedule decides');
  const m = await p.evaluate(() => {
    const c = dateCandidatesProbe('BCG 03/04/2025');
    return {
      both: c.length === 2,
      monthName: dateCandidatesProbe('MMR 12 Mar 2026').length >= 1,
      junk: dateCandidatesProbe('batch 99/99/9999').length === 0
    };
    function dateCandidatesProbe(s) { return CubbyVaxCard._dateCandidates(s); }
  });
  ck(m.both, 'an ambiguous 03/04 yields BOTH the day-first and month-first reading, unjudged');
  ck(m.monthName, 'a written month name is read too');
  ck(m.junk, 'an impossible date yields nothing');

  const match = await p.evaluate(() => {
    const c = cubbyVaxCtx(), birth = c.birth;
    const row = c.rows.find(r => !r.given && r.dueMonths >= 2) || c.rows[1];
    const d = new Date(row.dueAt);
    const p2 = n => String(n).padStart(2, '0');
    const near = p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear();
    const before = p2(1) + '/' + p2(1) + '/' + (new Date(birth).getFullYear() - 2);
    const good = CubbyVaxCard._matchRows([row.name + ' ' + near], c.rows, birth);
    const bad = CubbyVaxCard._matchRows([row.name + ' ' + before], c.rows, birth);
    const unnamed = CubbyVaxCard._matchRows(['clinic stamp ' + near], c.rows, birth);
    return { hit: good[row.i] != null, rejectedPreBirth: bad[row.i] == null, needsName: unnamed[row.i] == null };
  });
  ck(match.hit, 'a date on the same line as the vaccine name, at about the right age, is picked up');
  ck(match.rejectedPreBirth, 'a date from before the birth is discarded even next to the right name');
  ck(match.needsName, 'a loose date with no vaccine name near it is not attached to anything');

  console.log('\n5. nothing saves without a date, and the entry points exist');
  const save = await p.evaluate(() => {
    let said = ''; const rt = window.toast; window.toast = t => { said = t; };
    CubbyVaxCard.begin(false);
    const evBefore = (state.events || []).length;
    CubbyVaxCard.save();                      // every field blank
    const stillOpen = !!document.getElementById('vaxCard');
    window.toast = rt;
    const r = { said, stillOpen, noEvents: (state.events || []).length === evBefore };
    CubbyVaxCard.close();
    go('health'); setHealthTab('vaccines');
    r.doorOnTab = /from their card/i.test(document.getElementById('scroll').textContent);
    return r;
  });
  ck(/date/i.test(save.said), 'saving with every row blank says so instead of silently doing nothing', save.said);
  ck(save.stillOpen, 'and it keeps the screen open rather than throwing the work away');
  ck(save.noEvents, 'still no events written');
  ck(save.doorOnTab, 'the Vaccines tab carries a permanent door to it');

  console.log('\n6. clean console');
  ck(errs.length === 0, 'no uncaught page errors', errs.join(' | '));

  console.log('\n' + (fails ? 'FAIL' : 'PASS') + ' — ' + passes + ' passed, ' + fails + ' failed');
  await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
