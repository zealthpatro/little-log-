#!/usr/bin/env node
/* A ritual is the baby's day, so the setup has to feel like building a day.
 *
 * What it used to be: one flat time-sorted list, and an add sheet that asked "What is it" into a
 * blank field and then made a parent choose an abstract "Logs as" type from five chips. Nobody
 * thinks "I want a thing that logs as a feed". They think "she has a bottle around seven".
 *
 * What it is now: the list is grouped into morning, afternoon, evening and night so the shape of
 * the day is visible and the gaps are too; the add sheet asks the KIND first and names itself from
 * it; there are one-tap starters so an empty day is never a blank field; and a medicine ritual
 * points at a real medicine instead of holding a second copy of its name.
 *
 *   PORT=8123 node tools/serve.js &
 *   node tools/ritual_flow_check.js http://localhost:8123
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8123';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

const seed = (over) => Object.assign({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 150 * DAY, sex: 'F', routines: null, doctors: [], allergies: [] }],
  activeBabyId: 'b1', events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, welcome: 1 } },
  timers: {}, milestones: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
  meds: [{ id: 'md1', babyId: 'b1', subject: { kind: 'baby', id: 'b1' }, name: 'Vitamin D', dose: '1', unit: 'drops',
    active: true, pattern: { type: 'daily', times: ['09:00'] }, createdAt: now - 20 * DAY }],
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

  const load = async (s) => {
    await page.evaluate((x) => {
      localStorage.setItem('little-log-v1', JSON.stringify(x));
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
    }, s);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1400);
    await page.evaluate(() => { try { window.toast = function () {}; } catch (e) {} });
    await sleep(200);
  };
  const sheetText = () => page.evaluate(() => {
    const s = document.getElementById('sheet');
    return s ? (s.innerText || '').replace(/\s+/g, ' ').trim() : '';
  });

  console.log('\n1. the list reads as a day, not a flat list');
  {
    await load(seed());
    const t = await page.evaluate(() => { openRoutinesEdit(); const s = document.getElementById('sheet'); return (s.innerText || ''); });
    ok('it is titled as the baby\'s day', /Robin's day/.test(t), t.slice(0, 80));
    const heads = await page.evaluate(() => [...document.querySelectorAll('#sheet .sec-title')].map((e) => (e.textContent || '').trim().toLowerCase()));
    ok('morning is a section heading', heads.some((h) => h.startsWith('morning')), heads);
    ok('afternoon is a section heading', heads.some((h) => h.startsWith('afternoon')), heads);
    ok('evening is a section heading', heads.some((h) => h.startsWith('evening')), heads);
    ok('a part with nothing in it says so, because the gap is the information', /nothing yet/i.test(t), t.slice(0, 400));
    ok('items sit under the right part', t.indexOf('Morning') < t.indexOf('Midday nap'), { m: t.indexOf('Morning'), n: t.indexOf('Midday nap') });
  }

  console.log('\n2. an empty day is never a blank field');
  {
    await load(seed({ babies: [{ id: 'b1', name: 'Robin', birth: now - 150 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }] }));
    const t = await page.evaluate(() => { openRoutinesEdit(); const s = document.getElementById('sheet'); return (s.innerText || ''); });
    ok('it offers common ones to tap', /common ones/i.test(t), t.slice(0, 300));
    ok('with real suggestions in them', /Bath|Morning feed|Midday nap/.test(t), t.slice(0, 400));
    const r = await page.evaluate(() => {
      const before = (activeBaby().routines || []).length;
      addRitualSuggestion(0);
      const list = activeBaby().routines || [];
      return { before, after: list.length, added: list[list.length - 1] };
    });
    ok('tapping one adds it', r.after === r.before + 1, r);
    ok('with a sensible time already on it', /^\d\d:\d\d$/.test((r.added || {}).time || ''), r.added);
    ok('and the right kind', !!(r.added || {}).evType, r.added);
  }

  console.log('\n3. adding asks the KIND first, and it names itself');
  {
    await load(seed());
    const t = await page.evaluate(() => { openRoutineItem(); const s = document.getElementById('sheet'); return (s.innerText || ''); });
    ok('the first question is what kind', t.indexOf('What kind') < t.indexOf('Around when'), { k: t.indexOf('What kind'), w: t.indexOf('Around when') });
    ok('the old abstract "Logs as" wording is gone', !/Logs as/.test(t), t.slice(0, 300));
    ok('the kinds are the things a parent already does', /Feed/.test(t) && /Nap/.test(t) && /Medicine/.test(t) && /Moment/.test(t));
    const r = await page.evaluate(() => {
      routineSetType('feed');
      return { title: routineDraft.title, time: routineDraft.time };
    });
    ok('picking Feed names it Feed', r.title === 'Feed', r);
    ok('and gives it a plausible time', /^\d\d:\d\d$/.test(r.time), r);
    const r2 = await page.evaluate(() => { routineSetType('sleep'); return { title: routineDraft.title, time: routineDraft.time }; });
    ok('switching kind updates the suggestion', r2.title === 'Nap', r2);
    const r3 = await page.evaluate(() => {
      document.getElementById('rtTitle').value = 'Bath with grandad';
      routineSetType('activity');
      return routineDraft.title;
    });
    ok('but it NEVER overwrites something she typed', r3 === 'Bath with grandad', r3);
  }

  console.log('\n4. saving with no name is fine, because the kind knows what it is');
  {
    await load(seed({ babies: [{ id: 'b1', name: 'Robin', birth: now - 150 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }] }));
    const r = await page.evaluate(() => {
      openRoutineItem(); routineSetType('feed');
      document.getElementById('rtTitle').value = '';
      saveRoutineItem();
      const l = activeBaby().routines || [];
      return { n: l.length, title: (l[0] || {}).title, type: (l[0] || {}).evType };
    });
    ok('it saves', r.n === 1, r);
    ok('and calls it what it is', r.title === 'Feed', r);
    ok('with the right kind', r.type === 'feed', r);
  }

  console.log('\n5. a medicine ritual points at a real medicine');
  {
    await load(seed({ babies: [{ id: 'b1', name: 'Robin', birth: now - 150 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }] }));
    const t = await page.evaluate(() => { openRoutineItem(); routineSetType('medicine'); const s = document.getElementById('sheet'); return (s.innerText || ''); });
    ok('it asks which medicine', /which medicine/i.test(t), t.slice(0, 300));
    const opts = await page.evaluate(() => {
      const el = document.getElementById('rtMed');
      const wrap = el && el.closest('.field');
      return { values: el ? [...(el.options || [])].map((o) => o.value) : null,
        text: wrap ? (wrap.innerHTML.match(/Vitamin D/) ? 'has Vitamin D' : 'no Vitamin D') : 'no field' };
    });
    ok('and the real medicine is one of the options', /Vitamin D/.test(opts.text) || (opts.values || []).indexOf('md1') >= 0, opts);
    const r = await page.evaluate(() => {
      const el = document.getElementById('rtMed'); if (el) el.value = 'md1';
      saveRoutineItem();
      const rit = (activeBaby().routines || [])[0] || {};
      const payload = routinePayload(rit);
      return { title: rit.title, medId: rit.medId, payload };
    });
    ok('the ritual is named from the medicine, so they cannot drift apart', r.title === 'Vitamin D', r);
    ok('and it stores the link, not just a matching string', r.medId === 'md1', r);
    ok('ticking it logs a dose against THAT medicine', r.payload.medId === 'md1', r.payload);
    ok('carrying the real dose and unit', r.payload.dose === '1' && r.payload.unit === 'drops', r.payload);
  }

  console.log('\n6. no medicines saved: it says so rather than offering an empty picker');
  {
    await load(seed({ meds: [], babies: [{ id: 'b1', name: 'Robin', birth: now - 150 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }] }));
    const t = await page.evaluate(() => { openRoutineItem(); routineSetType('medicine'); const s = document.getElementById('sheet'); return (s.innerText || ''); });
    ok('it explains rather than showing an empty list', /no medicines saved/i.test(t), t.slice(0, 300));
    ok('and points at where to add one', /under Health/i.test(t));
  }

  console.log('\n7. the promise on the sheet matches what the app does');
  {
    await load(seed());
    const t = await page.evaluate(() => { openRoutinesEdit(); const s = document.getElementById('sheet'); return (s.innerText || ''); });
    ok('it does not promise reminders it cannot send', /does not send reminders for these yet/i.test(t), t.slice(-260));
    ok('and it says what marking one done actually does', /writes the matching entry to the log/i.test(t), t.slice(-260));
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'RITUAL-FLOW: FAIL' : 'RITUAL-FLOW: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
