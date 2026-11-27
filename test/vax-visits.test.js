/* Vaccines as visits (27 Nov 2026 UX review, canvas board 1A).
 *
 * The tab opened on a ring reading "0 of 25 done" over 25 dose rows (five screens, eight at 320px), all
 * "Upcoming", and a dose nine days past its date still read "Due soon". A parent asks "what's next and
 * when". So the tab now opens on the next VISIT (the doses given together, when, one tap to record it),
 * with later and recorded visits folded away and every dose still one tap inside them.
 *
 *   A. a 10-day-old: the birth dose leads, no score, the calendar sits under the card, nothing else to scroll
 *   B. recording a visit: every ticked dose is recorded on the chosen date, an unticked one stays owed
 *   C. a 2-month-old: "due around now", and a past date never says "Due soon"
 *   D. 320px: the card and its chips fit
 *
 *   node test/vax-visits.test.js [<base url of this tree's server>]
 * Fictional baby (Bo). Seen red on main 747bfdfe.
 */
'use strict';
const puppeteer = require('puppeteer-core');
const { downloadBehavior } = require('../tools/gate_downloads.js');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8080';
const DAY = 86400000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const seed = (now, ageDays) => ({
  babies: [{ id: 'b1', name: 'Bo', birth: now - ageDays * DAY, sex: 'M', routines: [], allergies: [], country: 'us' }],
  activeBabyId: 'b1', events: [], settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', country: 'us' },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], notes: [], pregnancy: null,
});

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'], downloadBehavior: downloadBehavior() });
  const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await p.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 60000 });
  const load = async (ageDays, given) => {
    const now = await p.evaluate(() => Date.now());
    await p.evaluate((s) => {
      localStorage.clear();
      localStorage.setItem('little-log-v1', JSON.stringify(s));
      localStorage.setItem('cubby-quick-uid', 'local');
      localStorage.setItem('cubby-seen-local', JSON.stringify({ home: 1, log: 1, album: 1, health: 1, welcome: 1 }));
    }, seed(now, ageDays));
    await p.reload({ waitUntil: 'networkidle2' });
    await sleep(1200);
    await p.evaluate((g) => {
      const plan = vaccinePlan(); plan.slice(0, g).forEach((v) => { v.given = true; v.givenAt = Date.now() - 69 * 86400000; });
      persist(); go('health'); setHealthTab('vaccines');
    }, given);
    await sleep(500);
  };
  const read = () => p.evaluate(() => {
    const sc = document.getElementById('scroll'); const card = sc.querySelector('.vx-next');
    const vis = (e) => !e.closest('details:not([open])') && e.getBoundingClientRect().height > 0;
    const nav = document.querySelector('.nav');
    return {
      text: sc.innerText,
      ring: !!sc.querySelector('.ring svg circle'),
      card: card ? card.innerText.replace(/\s+/g, ' ').trim() : null,
      cardBtn: card && card.querySelector('button') ? card.querySelector('button').textContent.trim() : null,
      chips: card ? card.querySelectorAll('.vx-chip').length : 0,
      calAfterCard: !!(card && card.nextElementSibling && /in my calendar/.test(card.nextElementSibling.textContent)),
      visibleDoseRows: [...sc.querySelectorAll('.ms-row')].filter(vis).length,
      allDoseRows: sc.querySelectorAll('.ms-row').length,
      folds: [...sc.querySelectorAll('details.vx-visit')].map((d) => d.querySelector('summary').innerText.replace(/\s+/g, ' ').trim()),
      disclaimer: !!sc.querySelector('.disclaimer') && /Always follow your doctor and local health authority/.test(sc.querySelector('.disclaimer').textContent),
      cardBottom: card ? Math.round(card.getBoundingClientRect().bottom) : null,
      navTop: nav ? Math.round(nav.getBoundingClientRect().top) : 844,
    };
  });

  console.log('A. a 10-day-old');
  await load(10, 0);
  let r = await read();
  ok('the tab shows a next-visit card (the probe is live)', !!r.card, r.text.slice(0, 200));
  ok('no "0 of 25" score and no completion ring', !r.ring && !/\b\d+ of \d+ (done|recorded)\b/.test(r.text), r.text.slice(0, 200));
  ok('the birth dose leads, asking if it was given before they came home', /Birth dose/.test(r.card || '') && /before you came home/.test(r.card || ''), r.card);
  ok('it is one tap to say it was given', r.cardBtn === 'Yes, it was given', r.cardBtn);
  ok('the calendar row sits straight under the card', r.calAfterCard, r);
  ok('the card is on the first screen', r.cardBottom !== null && r.cardBottom < r.navTop, r);
  ok('no dose row is laid out before she asks for one', r.visibleDoseRows === 0, r.visibleDoseRows);
  ok('every dose is still on the page, folded', r.allDoseRows >= 25, r.allDoseRows);
  ok('later visits fold into one row each', r.folds.some((f) => /^2-month check around .+ · 6 vaccines$/.test(f)), r.folds);
  ok('the disclaimer keeps its wording', r.disclaimer);

  console.log('\nB. recording a visit');
  const rec = await p.evaluate(async () => {
    const wait = (ms) => new Promise((x) => setTimeout(x, ms));
    const birth = activeBaby().birth;
    document.querySelector('#scroll .vx-next button').click(); await wait(400);
    const sheet = document.getElementById('sheet').innerText;
    const dv = document.getElementById('vxvDate') ? document.getElementById('vxvDate').value : null;
    document.querySelector('#sheet .btn-primary').click(); await wait(500);
    const v = vaccinePlan().find((x) => x.group === 'Birth' || x.group === 'At birth');
    const birthDay = new Date(birth).toISOString().slice(0, 10);
    const card = document.querySelector('#scroll .vx-next').innerText.replace(/\s+/g, ' ');
    // the 2-month visit: untick one dose and record the rest on a chosen date
    const g = vaccinePlan().find((x) => x.group === '2 months').group;
    openVisitDone(g); await wait(400);
    const boxes = [...document.querySelectorAll('#sheet .vxv')];
    const keep = boxes.find((x) => /Rotavirus/.test(x.parentElement.textContent)); keep.checked = false;
    document.getElementById('vxvDate').value = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    markVisit(g); await wait(500);
    const two = vaccinePlan().filter((x) => x.group === '2 months');
    const evs = state.events.filter((e) => e.type === 'vaccine').length;
    return { sheet, dv, birthDay, birthGiven: !!(v && v.given), birthAt: v && new Date(v.givenAt).toISOString().slice(0, 10), card,
      twoGiven: two.filter((x) => x.given).length, twoTotal: two.length,
      rotaOwed: !two.find((x) => /Rotavirus/.test(x.name)).given,
      twoDates: [...new Set(two.filter((x) => x.given).map((x) => new Date(x.givenAt).toISOString().slice(0, 10)))], evs,
      after: document.querySelector('#scroll .vx-next').innerText.replace(/\s+/g, ' ') };
  });
  ok('the sheet lets her untick and change the date', /Untick any that were not given/.test(rec.sheet), rec.sheet.slice(0, 120));
  ok('the birth dose date defaults to the birthday', rec.dv === rec.birthDay, rec);
  ok('and is recorded on that day', rec.birthGiven && rec.birthAt === rec.birthDay, rec);
  ok('the card moves on to the 2-month check', /2-month check, around/.test(rec.card), rec.card);
  ok('every ticked dose of the visit is recorded', rec.twoGiven === rec.twoTotal - 1, rec);
  ok('the unticked one is still owed', rec.rotaOwed, rec);
  ok('all on the one chosen date', rec.twoDates.length === 1, rec.twoDates);
  ok('each dose is its own timeline entry', rec.evs === 1 + rec.twoGiven, rec.evs);
  ok('the visit stays next while a dose is owed', /2-month check/.test(rec.after) && /1 vaccine,/.test(rec.after), rec.after);

  console.log('\nC. a 2-month-old');
  await load(70, 2);
  r = await read();
  ok('the next visit is the 2-month check, due around now', /2-month check, around/.test(r.card || '') && /due around now/.test(r.card || ''), r.card);
  ok('it names the five vaccines left', r.chips === 5 && /5 vaccines, usually given at one appointment/.test(r.card || ''), r);
  ok('and records them in one tap', r.cardBtn === 'Mark the visit done', r.cardBtn);
  ok('the birth visit folds under Recorded', r.folds.some((f) => /^Birth dose 1 vaccine recorded$/.test(f)), r.folds);
  const labels = await p.evaluate(() => {
    document.querySelectorAll('#scroll details').forEach((d) => { d.open = true; });
    return [...document.querySelectorAll('#scroll .ms-row')].map((row) => ({ due: row.querySelector('.b').textContent, label: row.querySelector('.vx-status').textContent }))
      .filter((x) => /^due /.test(x.due)).map((x) => ({ past: new Date(x.due.slice(4)).getTime() < Date.now(), label: x.label }));
  });
  ok('some open dose rows are already past their date (the probe is live)', labels.some((x) => x.past), labels.slice(0, 4));
  ok('a past date never reads "Due soon"', !labels.some((x) => x.past && x.label === 'Due soon'), labels.filter((x) => x.past));

  console.log('\nC2. a birth dose nobody recorded');
  await load(70, 0);
  r = await read();
  ok('the 2-month check leads, not a birth dose ten weeks old', /2-month check, around/.test(r.card || ''), r.card);
  ok('the unrecorded birth dose waits under "Not recorded yet"', /Not recorded yet/i.test(r.text) && r.folds.some((f) => /^Birth dose 1 vaccine to record$/.test(f)), r.folds);

  console.log('\nD. 320px');
  await p.setViewport({ width: 320, height: 640, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await sleep(300);
  const fit = await p.evaluate(() => {
    go('health'); setHealthTab('vaccines');
    const c = document.querySelector('#scroll .vx-next'); const sc = document.getElementById('scroll').getBoundingClientRect();
    const over = [c, ...c.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > sc.right + 0.5 || e.scrollWidth > e.clientWidth + 1).map((e) => e.className || e.tagName);
    const sums = [...document.querySelectorAll('#scroll .vx-visit > summary')].filter((s) => s.scrollWidth > s.clientWidth + 1).length;
    return { over, sums };
  });
  ok('the next-visit card fits at 320px', fit.over.length === 0, fit.over);
  ok('no folded visit row overflows', fit.sums === 0, fit.sums);

  console.log('\nE. half past midnight, local time');
  {
    const q = await b.newPage(); q.on('pageerror', (x) => errs.push(x.message));
    const d = new Date(); d.setHours(0, 30, 0, 0); const shift = d.getTime() - Date.now();
    await q.evaluateOnNewDocument((sh) => { const R = Date; function D(...a) { return a.length === 0 ? new R(R.now() + sh) : new R(...a); } D.prototype = R.prototype; D.now = () => R.now() + sh; D.parse = R.parse; D.UTC = R.UTC; window.Date = D; }, shift);
    await q.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 60000 });
    const nowq = await q.evaluate(() => Date.now());
    await q.evaluate((s) => { localStorage.clear(); localStorage.setItem('little-log-v1', JSON.stringify(s)); localStorage.setItem('cubby-quick-uid', 'local'); }, seed(nowq, 70));
    await q.reload({ waitUntil: 'networkidle2' }); await sleep(1200);
    const dd = await q.evaluate(async () => {
      openVisitDone('2 months'); await new Promise((x) => setTimeout(x, 400));
      const t = new Date(); const local = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
      return { picked: document.getElementById('vxvDate').value, local };
    });
    ok('the default date is today on her calendar, not the UTC date', dd.picked === dd.local, dd);
    await q.close();
  }

  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
