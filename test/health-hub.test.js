/* Health as one calm hub (27 Nov 2026 UX review, canvas board 2A).
 *
 * Health was three sub-tabs, each ending in the same footer (Ask a question, Doctors & allergies, Going to the
 * doctor), so the visit summary a parent wants in a waiting room sat at the bottom of all three, five screens
 * down on Vaccines. A running illness hid behind the third tab, and growth lived in Log, Stats.
 *
 *   A. the hub: "Right now" leads with the illness, a dose that is due and a visit that is close; the doctor
 *      summary is on the first screen; then every record as a row
 *   B. every row opens its view, every view comes back, and the Health nav button always returns to the hub
 *   C. nothing is said twice: no sub-tab bar, the Ask box and the care rows once, on the hub only
 *   D. "Given" records the dose and the row leaves "Right now"; a well baby has no "Right now" at all
 *   E. 320px: no row overflows
 *
 *   node test/health-hub.test.js [<base url of this tree's server>]
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

function seed(now, sick) {
  const hhmm = (t) => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const ev = (id, type, t, x) => Object.assign({ id, type, babyId: 'b1', time: t, authorId: 'local' }, x || {});
  return {
    babies: [{ id: 'b1', name: 'Bo', birth: now - 70 * DAY, sex: 'M', routines: [], allergies: [], country: 'us' }],
    activeBabyId: 'b1',
    events: [ev('g1', 'growth', now - 8 * DAY, { weight: 5.6, wUnit: 'kg', height: 59, hUnit: 'cm' }),
      ev('g0', 'growth', now - 40 * DAY, { weight: 4.5, wUnit: 'kg', height: 55, hUnit: 'cm' })]
      .concat(sick ? [ev('t1', 'temperature', now - 5 * 3600000, { temp: 37.6, unit: 'C', illnessId: 'i1' })] : []),
    settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', country: 'us' },
    meds: sick ? [{ id: 'm1', babyId: 'b1', name: 'Vitamin D drops', dose: '1', unit: 'drop', pattern: { type: 'daily', times: [hhmm(now - 41 * 60000)] },
      remind: true, active: true, createdAt: now - 60 * DAY }] : [],
    illnesses: sick ? [{ id: 'i1', babyId: 'b1', name: 'Cold', startedAt: now - 2 * DAY, endedAt: null, notes: '', by: 'local' }] : [],
    timers: {}, milestones: [], photos: [], vaccines: {}, notes: [], pregnancy: null,
  };
}

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'], downloadBehavior: downloadBehavior() });
  const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await p.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 60000 });
  const load = async (sick, given) => {
    const sec = await p.evaluate(() => new Date().getSeconds()); if (sec > 50) await sleep((61 - sec) * 1000);
    const now = await p.evaluate(() => Date.now());
    await p.evaluate((s) => {
      localStorage.clear();
      localStorage.setItem('little-log-v1', JSON.stringify(s));
      localStorage.setItem('cubby-quick-uid', 'local');
      localStorage.setItem('cubby-seen-local', JSON.stringify({ home: 1, log: 1, album: 1, health: 1, welcome: 1 }));
    }, seed(now, sick));
    await p.reload({ waitUntil: 'networkidle2' });
    await sleep(1200);
    await p.evaluate((g) => { const plan = vaccinePlan(); plan.slice(0, g).forEach((v) => { v.given = true; v.givenAt = Date.now() - 69 * 86400000; }); persist(); }, given);
  };
  const navHealth = () => p.evaluate(async () => {
    const btn = [...document.querySelectorAll('.nav .nav-btn')].find((x) => /Health/.test(x.textContent)); btn.click();
    await new Promise((r) => setTimeout(r, 400));
  });
  const hub = () => p.evaluate(() => {
    const sc = document.getElementById('scroll');
    const titles = [...sc.querySelectorAll('.sec-title')].map((e) => e.textContent.trim());
    const nowIdx = titles.findIndex((t) => /right now/i.test(t));
    const kids = [...sc.querySelector('.fade-in').children];
    const iNow = kids.findIndex((e) => /right now/i.test(e.textContent) && e.matches('.sec-title'));
    const iRec = kids.findIndex((e) => /records/i.test(e.textContent) && e.matches('.sec-title'));
    const nowItems = iNow < 0 ? [] : kids.slice(iNow + 1, iRec < 0 ? undefined : iRec).filter((e) => !/Going to the doctor/.test(e.textContent)).map((e) => e.innerText.replace(/\s+/g, ' ').trim());
    const doc = [...sc.querySelectorAll('.hub-row, .hub-visit')].find((e) => /Going to the doctor/.test(e.textContent));
    const nav = document.querySelector('.nav');
    return {
      text: sc.innerText, titles, hasNow: nowIdx >= 0, nowItems, iRec,
      seg: !!sc.querySelector('.seg-full, .seg'),
      docBottom: doc ? Math.round(doc.getBoundingClientRect().bottom) : null, navTop: Math.round(nav.getBoundingClientRect().top),
      rows: [...sc.querySelectorAll('.hub-list .hub-row .a')].map((e) => e.textContent.trim()),
      ask: sc.querySelectorAll('.ask-box, [onclick*="openAsk"]').length,
    };
  });

  console.log('A. the hub, on a day with a cold and a dose due');
  await load(true, 2);
  await p.evaluate(() => { healthTab = 'vaccines'; go('home'); });
  await navHealth();
  let h = await hub();
  ok('the Health button opens the hub, whatever sub-view was open last (the probe is live)', h.rows.length > 0, h.text.slice(0, 200));
  ok('"Right now" leads', h.hasNow && h.titles[0] && /right now/i.test(h.titles[0]), h.titles);
  ok('the running illness comes first', /^Cold, day 3/.test(h.nowItems[0] || ''), h.nowItems);
  ok('then the dose that is due, with "Given"', /Vitamin D drops .*due 41m ago Given/.test(h.nowItems[1] || ''), h.nowItems);
  ok('then the visit that is close', /2-month check due around now · 5 vaccines/.test(h.nowItems[2] || ''), h.nowItems);
  ok('"Going to the doctor?" is on the first screen', h.docBottom !== null && h.docBottom < h.navTop, h);
  ok('every record is a row', ['Medicines', 'Vaccines', 'Growth', 'Illnesses', 'Care team', 'Allergies and diet'].every((t) => h.rows.includes(t)), h.rows);
  ok('no sub-tab bar', !h.seg);

  console.log('\nB. every row opens its view and comes back');
  const views = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};
    for (const [label, want] of [['Medicines', /Vitamin D drops/], ['Vaccines', /2-month check, around/], ['Growth', /Latest weight/], ['Illnesses', /Mark recovered/]]) {
      const row = [...document.querySelectorAll('#scroll .hub-list .hub-row')].find((e) => e.querySelector('.a').textContent.trim() === label);
      row.click(); await wait(400);
      const t = document.getElementById('scroll').innerText;
      const back = document.querySelector('#scroll .hub-back');
      out[label] = { shows: want.test(t), back: !!back, ask: /Ask a question/.test(t), care: /Care team|Allergies/.test(t), seg: !!document.querySelector('#scroll .seg-full') };
      back.click(); await wait(300);
      out[label].home = !!document.querySelector('#scroll .hub-list');
    }
    return out;
  });
  Object.entries(views).forEach(([k, v]) => {
    ok(k + ' opens its view', v.shows, v);
    ok(k + ' has a way back to the hub, and it works', v.back && v.home, v);
    ok(k + ' does not repeat the hub footer (Ask, care rows, sub-tabs)', !v.ask && !v.care && !v.seg, v);
  });
  h = await hub();
  ok('the Ask box is on the hub, once', h.ask === 1, h.ask);

  console.log('\nD. "Given" from Right now, and a well day');
  const given = await p.evaluate(async () => {
    const before = state.events.filter((e) => e.type === 'medicine').length;
    const row = [...document.querySelectorAll('#scroll .hub-row')].find((e) => /Vitamin D drops/.test(e.textContent) && e.querySelector('.dose-btn'));
    row.querySelector('.dose-btn').click(); await new Promise((r) => setTimeout(r, 600));
    try { closeSheet(); } catch (e) {}
    healthTab = null; go('health'); await new Promise((r) => setTimeout(r, 400));
    const after = state.events.filter((e) => e.type === 'medicine').length;
    const still = [...document.querySelectorAll('#scroll .hub-row')].some((e) => /Vitamin D drops/.test(e.textContent) && e.querySelector('.dose-btn'));
    return { before, after, still };
  });
  ok('"Given" records the dose', given.after === given.before + 1, given);
  ok('and the dose leaves "Right now"', !given.still, given);
  await load(false, 25);
  await p.evaluate(() => { healthTab = null; go('health'); });
  await sleep(400);
  h = await hub();
  ok('a well baby with nothing due has no "Right now"', !h.hasNow && h.rows.length === 6, h.titles);
  ok('and the doctor summary still leads', /^Going to the doctor/.test((h.text.split('\n').find((l) => l.trim()) || '')), h.text.slice(0, 80));

  console.log('\nE. 320px');
  await load(true, 2);
  await p.setViewport({ width: 320, height: 640, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await p.evaluate(() => { healthTab = null; go('health'); });
  await sleep(500);
  const over = await p.evaluate(() => {
    const sc = document.getElementById('scroll').getBoundingClientRect();
    return [...document.querySelectorAll('#scroll .hub-row, #scroll .hub-ill, #scroll .hub-ill *')]
      .filter((e) => e.getBoundingClientRect().right > sc.right + 0.5 || e.scrollWidth > e.clientWidth + 1).map((e) => e.className || e.tagName);
  });
  ok('no hub row overflows at 320px', over.length === 0, over);

  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
