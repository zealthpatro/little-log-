#!/usr/bin/env node
/* App Store screenshots, 1290 x 2796, from the real app.
 *
 * 430 x 932 CSS at deviceScaleFactor 3 is exactly the 6.7" iPhone frame Apple wants, so these are
 * the product itself at the right pixel size, not a mockup of it.
 *
 * Fictional family throughout: "Bo Bear", per the fictional-baby rule. No real child's data or
 * photos ever goes in a store asset.
 *
 *   PORT=8123 node tools/serve.js &
 *   node tools/shoot_store.js http://localhost:8123
 *
 * Output: docs/store/shots/NN-name.png, plus a size check on every one.
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const fs = require('fs');
const path = require('path');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8123';
const OUT = path.join(__dirname, '..', 'docs', 'store', 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;

// 9:41 on the dot, the way Apple shoots their own. Also makes every run byte-comparable.
const CLOCK = (() => { const d = new Date(); d.setHours(9, 41, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

const ev = (id, type, hoursAgo, extra) => Object.assign({ id, type, babyId: 'b1', time: now - hoursAgo * 3600000 }, extra || {});

// A believable, entirely invented day.
const SEED = {
  babies: [{ id: 'b1', name: 'Bo', birth: now - 70 * DAY, sex: 'M', routines: [], allergies: [] }],
  activeBabyId: 'b1',
  events: [
    ev('f1', 'feed', 1.5, { method: 'bottle', amount: 120, unit: 'ml', authorId: 'uidNanny' }),
    ev('d1', 'diaper', 2.2, { kind: 'wet', authorId: 'uidNanny' }),
    ev('f2', 'feed', 4.5, { method: 'breast', side: 'left', dur: 17 * 60000 }),
    ev('s1', 'sleep', 7, { end: now - 5.5 * 3600000 }),
    ev('d2', 'diaper', 8, { kind: 'dirty' }),
    ev('f3', 'feed', 9.5, { method: 'bottle', amount: 110, unit: 'ml' }),
    ev('g1', 'growth', 26, { weight: 5.9, wUnit: 'kg', height: 59, hUnit: 'cm' }),
  ],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', country: 'us',
    seen: { home: 1, log: 1, growth: 1, album: 1, health: 1, welcome: 1 } },
  timers: { b1: { sleep: { start: now - 42 * 60000 } } },   // a nap running now, for the live timer
  milestones: [{ id: 'm1', babyId: 'b1', key: 'first-smile', name: 'First smile', date: now - 9 * DAY }],
  meds: [{ id: 'md1', babyId: 'b1', name: 'Vitamin D', dose: '1', unit: 'drops', active: true,
    pattern: { type: 'daily', times: ['09:00'] }, remind: true, createdAt: now - 20 * DAY }],
  photos: [], vaccines: {}, illnesses: [], pregnancy: null, notes: [],
};

/* Each shot declares a string that MUST be on screen. The first version of this file navigated with
   openFamily(), which returns early without a Firebase user, so it silently captured the home
   screen twice and the contact sheet would have gone to Apple with a duplicate. A screenshot
   harness that cannot tell you it took the wrong picture is worse than no harness. */
const SHOTS = [
  { file: '01-home-shared-day', why: 'the shared live day', must: 'TODAY SO FAR',
    go: async (p) => { await p.evaluate(() => go('home')); } },
  { file: '02-log-a-feed', why: 'one-thumb logging', must: 'Bottle',
    go: async (p) => { await p.evaluate(() => { go('home'); openFeed(); }); } },
  { file: '03-care-vaccines', why: 'official schedules', must: 'Vaccine',
    go: async (p) => { await p.evaluate(() => { go('health'); setHealthTab('vaccines'); }); } },
  /* The circle sheet would be the stronger privacy shot, but openFamily's first line returns on a
     missing Firebase user and e2e has none, so it cannot be reached from this harness. The data
     sheet sells the same promise from the side a shopper cares about: it is yours, take it or
     delete it. Shot on a real device with a real account, swap this back to the circle. */
  { file: '04-your-data', why: 'your data is yours', must: 'data',
    go: async (p) => { await p.evaluate(() => { go('home'); openDataSheet(); }); } },
  { file: '05-log-timeline', why: 'the whole day, told', must: 'Today',
    go: async (p) => { await p.evaluate(() => go('log')); } },
  /* Not go('growth'): there is no such tab, and go() paints an empty shell for an unknown view
     rather than falling back, so it produced a blank cream screen that only the assertion caught.
     The doctor summary is the stronger sell anyway, and it is the page Pro is meant to be anchored
     on. */
  { file: '06-doctor-summary', why: 'ready for the doctor', must: 'Visit summary',
    go: async (p) => { await p.evaluate(() => { go('health'); openVisitSummary(); }); } },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
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
  await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await page.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });
  await page.evaluate((s) => {
    localStorage.setItem('little-log-v1', JSON.stringify(s));
    localStorage.setItem('cubby-quick-uid', 'local');
    Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
  }, SEED);
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2000);
  // A circle of three, so "who did what" and the sharing controls have something true to show.
  await page.evaluate(() => {
    window.LL = window.LL || {};
    window.LL.role = 'owner';
    window.LL.members = { local: 'owner', uidPapa: 'caregiver', uidNanny: 'caregiver' };
    window.LL.memberInfo = {
      local: { name: 'Maya', relationship: 'Mama Bear', role: 'owner' },
      uidPapa: { name: 'Sam', relationship: 'Papa Bear', role: 'caregiver' },
      uidNanny: { name: 'Rosa', relationship: 'Nanny', role: 'caregiver' },
    };
    /* auth.currentUser is the real Firebase object and there is none in e2e, so openFamily bails on
       its first line. Stubbed with the same uid the local seed uses, which is enough for the circle
       sheet to render the roster it already has in LL.memberInfo. */
    try { if (window.LL && window.LL.auth && !window.LL.auth.currentUser) window.LL.auth.currentUser = { uid: 'local', email: 'maya@example.com' }; } catch (e) {}
    try { if (typeof auth !== 'undefined' && !auth.currentUser) auth.currentUser = { uid: 'local', email: 'maya@example.com' }; } catch (e) {}
    // The medicine nudge fires on a five-second timer and lands a black toast across the bottom of
    // whatever is being photographed.
    try { window.toast = function () {}; } catch (e) {}
    // The teaching card is for a first-run parent, not for the shop window.
    try { if (window.CubbyGuide && CubbyGuide.dismissCard) CubbyGuide.dismissCard(); } catch (e) {}
    try { if (window.CubbyTeach && CubbyTeach.dismissAll) CubbyTeach.dismissAll(); } catch (e) {}
    try { render(); } catch (e) {}
  });
  await sleep(600);

  const made = [];
  for (const s of SHOTS) {
    try { await page.evaluate(() => { try { closeSheet(); } catch (e) {} }); } catch (e) {}
    await sleep(250);
    await s.go(page);
    await sleep(1100);
    const seen = await page.evaluate(() => (document.body.innerText || ''));
    const hit = seen.toLowerCase().indexOf(String(s.must).toLowerCase()) >= 0;
    const f = path.join(OUT, s.file + '.png');
    await page.screenshot({ path: f });
    const { width, height } = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    const bytes = fs.statSync(f).size;
    made.push({ file: s.file, why: s.why, css: width + 'x' + height, kb: Math.round(bytes / 1024), hit, must: s.must });
  }
  await browser.close();

  console.log('\nfile                      sells                 on screen?  size');
  made.forEach((m) => console.log('  ' + m.file.padEnd(24) + m.why.padEnd(22)
    + (m.hit ? 'ok        ' : 'WRONG SCREEN (no "' + m.must + '") ') + m.kb + 'kb'));
  const wrong = made.filter((m) => !m.hit);
  // The only dimension Apple actually enforces.
  const { execFileSync } = require('child_process');
  let bad = 0;
  for (const m of made) {
    const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', path.join(OUT, m.file + '.png')], { encoding: 'utf8' });
    const w = +(out.match(/pixelWidth: (\d+)/) || [])[1], h = +(out.match(/pixelHeight: (\d+)/) || [])[1];
    const ok = w === 1290 && h === 2796;
    if (!ok) bad++;
    console.log('  ' + (ok ? 'ok  ' : 'BAD ') + m.file + '  ' + w + 'x' + h + (ok ? '' : '  (Apple wants 1290x2796)'));
  }
  console.log('\npage errors: ' + (errs.length ? errs.slice(0, 3).join(' | ') : 'none'));
  const fail = bad + wrong.length;
  console.log(fail ? '\nSHOTS: FAIL — ' + wrong.length + ' captured the wrong screen, ' + bad + ' the wrong size'
                   : '\nSHOTS: PASS — ' + made.length + ' at 1290x2796 in ' + OUT);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
