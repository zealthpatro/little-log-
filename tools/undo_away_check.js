#!/usr/bin/env node
/* Two things Cubby used to forget.
 *
 * UNDO. The charter's own law is "forgiving by design: everything editable, backdatable, undoable",
 * and undoable did not exist. Correcting a 3am mis-tap meant four taps in another tab, and
 * correcting rather than deleting stamps editedBy and leaves "edited by Maya" on a row the whole
 * circle reads forever. Undo hard-removes, so a slip leaves no trace at all.
 *
 * AWAY RECAP. The one card built to reward coming back filtered by CALENDAR DAY, so a mother waking
 * at 6am saw nothing about the 2am bottle her partner gave: 2am is filed under yesterday, and the
 * night shift is exactly the shift a second person covers.
 *
 *   PORT=8123 node tools/serve.js &
 *   node tools/undo_away_check.js http://localhost:8123
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8123';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, HOUR = 3600000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

// 06:00, so "the 2am bottle" is genuinely on the previous calendar day.
const CLOCK = (() => { const d = new Date(); d.setHours(6, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

const seed = (over) => Object.assign({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
  activeBabyId: 'b1', events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
}, over || {});

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
  const load = async (s, extra) => {
    await page.evaluate((x, ex) => {
      localStorage.setItem('little-log-v1', JSON.stringify(x));
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
    }, s, extra || {});
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1400);
    /* Seeded AFTER the reload and then re-anchored, because a reload fires visibilitychange on the
       way out and the app stamps its leaving time there. This reproduces a fresh boot whose stored
       "last left" is the value under test, which is what a parent's morning actually is. */
    await page.evaluate((ex) => {
      if (ex && ex.lastOpen) localStorage.setItem('cubby-last-open:local', String(ex.lastOpen));
      else localStorage.removeItem('cubby-last-open:local');
      try { initAwayAnchor(); } catch (e) {}
    }, extra || {});
    await sleep(200);
  };

  console.log('\n1. a mis-tapped nappy can be taken straight back');
  {
    await load(seed());
    const r = await page.evaluate(() => {
      saveDiaper('wet');
      const t = document.getElementById('toast');
      const act = t.querySelector('.toast-act');
      return { n: state.events.filter((e) => e.type === 'diaper').length,
        toast: (t.textContent || '').replace(/\s+/g, ' ').trim(), hasUndo: !!act, label: act ? act.textContent : null };
    });
    ok('the nappy is written', r.n === 1, r);
    ok('the toast offers Undo', r.hasUndo === true, r);
    ok('and it is labelled Undo', /undo/i.test(r.label || ''), r);
    const r2 = await page.evaluate(() => {
      document.querySelector('#toast .toast-act').click();
      return { n: state.events.filter((e) => e.type === 'diaper').length,
        deleted: state.events.filter((e) => e.deleted).length };
    });
    ok('tapping it removes the entry', r2.n === 0, r2);
    ok('and leaves NOTHING in Recently deleted, because a slip is not a decision', r2.deleted === 0, r2);
  }

  console.log('\n2. undo never reaches back past where she moved on');
  {
    await load(seed());
    const r = await page.evaluate(() => {
      saveDiaper('wet');
      go('log');                       // she moved on
      undoLast();
      return state.events.filter((e) => e.type === 'diaper').length;
    });
    ok('a tab change clears it', r === 1, r);

    /* Its own load, because the block above already logged a wet nappy milliseconds ago in this
       same page and the double-tap guard would correctly suppress a repeat. Two evaluate calls are
       not two taps by a parent, and a test that ignores that measures the guard rather than undo. */
    await load(seed());
    const r2 = await page.evaluate(() => {
      saveDiaper('wet');
      saveDiaper('dirty');             // a second, genuinely different write
      undoLast();
      return state.events.filter((e) => e.type === 'diaper').map((e) => e.kind);
    });
    ok('undo only ever takes back the LAST write', r2.length === 1 && r2[0] === 'wet', r2);
  }

  console.log('\n3. stopping a timer can be undone too');
  {
    await load(seed({ timers: { b1: { sleep: { start: now - 40 * 60000 } } } }));
    const r = await page.evaluate(() => {
      stopSleep('b1');
      const had = state.events.filter((e) => e.type === 'sleep').length;
      undoLast();
      return { had, now: state.events.filter((e) => e.type === 'sleep').length };
    });
    ok('the nap is written on stop', r.had === 1, r);
    ok('and undo takes it back', r.now === 0, r);
  }

  console.log('\n4. the away recap sees the night shift');
  {
    // It is 06:00. Papa gave a bottle at 02:00, which is YESTERDAY by calendar day.
    const evs = [
      { id: 'f1', type: 'feed', babyId: 'b1', method: 'bottle', amount: 120, unit: 'ml', time: now - 4 * HOUR, authorId: 'uidPapa' },
      { id: 'd1', type: 'diaper', babyId: 'b1', kind: 'wet', time: now - 3.5 * HOUR, authorId: 'uidPapa' },
    ];
    await load(seed({ events: evs }), { lastOpen: now - 8 * HOUR });
    const r = await page.evaluate(() => {
      window.LL = window.LL || {};
      window.LL.auth = { currentUser: { uid: 'local' } };
      window.LL.members = { local: 'owner', uidPapa: 'caregiver' };
      window.LL.memberInfo = { local: { name: 'Maya', relationship: 'Mama Bear' }, uidPapa: { name: 'Sam', relationship: 'Papa Bear' } };
      const html = awayRecap();
      return { html, txt: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() };
    });
    ok('the card appears at all', r.html.length > 0, r.txt);
    ok('it counts the 2am bottle, which yesterday-filtering missed', /1 feed/.test(r.txt), r.txt);
    ok('it is headed as time away, not as today', /while you were away/i.test(r.txt), r.txt);
    ok('it names who did it', /Sam|Papa/.test(r.txt), r.txt);
    ok('and it says what window it is talking about', /last \d+ hours|last day/i.test(r.txt), r.txt);
  }

  console.log('\n5. it stays silent when there is nothing of somebody else\'s');
  {
    await load(seed({ events: [{ id: 'f1', type: 'feed', babyId: 'b1', method: 'bottle', amount: 120, unit: 'ml', time: now - 2 * HOUR, authorId: 'local' }] }),
      { lastOpen: now - 8 * HOUR });
    const r = await page.evaluate(() => {
      window.LL = { auth: { currentUser: { uid: 'local' } }, members: { local: 'owner' }, memberInfo: { local: { name: 'Maya' } } };
      return awayRecap();
    });
    ok('my own logs do not get recapped back to me', r === '', r.slice(0, 120));
  }

  console.log('\n6. a week away does not produce a wall');
  {
    const evs = [];
    for (let d = 0; d < 7; d++) evs.push({ id: 'f' + d, type: 'feed', babyId: 'b1', method: 'bottle', amount: 120, unit: 'ml', time: now - d * DAY - HOUR, authorId: 'uidPapa' });
    await load(seed({ events: evs }), { lastOpen: now - 7 * DAY });
    const r = await page.evaluate(() => {
      window.LL = { auth: { currentUser: { uid: 'local' } }, members: { local: 'owner', uidPapa: 'caregiver' },
        memberInfo: { local: { name: 'Maya' }, uidPapa: { name: 'Sam' } } };
      return awayRecap().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    });
    ok('it caps at a day rather than recapping the week', /1 feed\b/.test(r), r);
    ok('and says so', /last day/i.test(r), r);
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'UNDO-AWAY: FAIL' : 'UNDO-AWAY: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
