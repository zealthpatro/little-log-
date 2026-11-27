/* A first log in under a minute, then the invite (27 Nov 2026 UX review, canvas boards 5A and 4A).
 *
 * Live funnel on 27 Nov: 17 signed in, 11 added a baby, 7 ever logged; median time to a first log 283 hours.
 * The path was nine screens: a six-field baby sheet (birthday required, no "today"), a "Welcome to Cubby"
 * identity step that said "Last thing", then a nine-choice sheet. Now, after sign-in and the stage:
 * name + "Today" + Continue, "What just happened?", Nappy, Wet. Five taps in the app (seven from the
 * landing page). Who she is to the baby and the invite come after the first log, and once something is
 * logged the invite leads that sheet.
 *
 *   A. the short form: name and Born; country one line; colour, sex and weight folded
 *   B. five taps to a logged nappy, with first_log_offered counted
 *   C. then identity, then the invite leads; everything else folded under one line
 *   D. "Nothing yet": identity, then the log-first sheet (no invite pushed before there is a log)
 *   E. a feed from the step carries the wizard on too
 *   F. adding a second baby later keeps the full form
 *   G. 320px: the tiles fit
 *
 *   node test/first-log-path.test.js [<base url of this tree's server>]
 * Fictional baby (Bo). Seen red on main 747bfdfe.
 */
'use strict';
const puppeteer = require('puppeteer-core');
const { downloadBehavior } = require('../tools/gate_downloads.js');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8080';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EMPTY = { babies: [], activeBabyId: null, events: [], settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', country: 'us' },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], notes: [], pregnancy: null };

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'], downloadBehavior: downloadBehavior() });
  const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await p.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 60000 });
  const fresh = async () => {
    await p.evaluate((s) => { localStorage.clear(); localStorage.setItem('little-log-v1', JSON.stringify(s)); localStorage.setItem('cubby-quick-uid', 'local'); }, EMPTY);
    await p.reload({ waitUntil: 'networkidle2' });
    await sleep(1500);
    await p.evaluate(() => {
      window.__steps = []; const real = window.cubbyStep;
      window.cubbyStep = function (ev, props) { window.__steps.push((props && props.step) || ev); try { return real && real.apply(this, arguments); } catch (e) {} };
      window.LL = window.LL || {}; window.LL.needsIdentity = true;   // a new owner, as in production
    });
  };
  // a real click on the visible element whose text starts with `t`, counted
  let taps = 0;
  const tap = async (t, root) => {
    const hit = await p.evaluate((t, root) => {
      const scope = root ? document.querySelector(root) : document;
      const els = [...scope.querySelectorAll('button, a, [onclick], .prof-card, summary')].filter((e) => e.getClientRects().length && !e.closest('details:not([open]) > :not(summary)'));
      const el = els.find((e) => (e.innerText || '').trim().replace(/\s+/g, ' ').startsWith(t));
      if (!el) return false; el.click(); return true;
    }, t, root || null);
    if (hit) taps++;
    await sleep(500);
    return hit;
  };
  const sheet = () => p.evaluate(() => {
    const s = document.getElementById('sheet');
    const vis = (e) => e.getClientRects().length > 0 && !e.closest('details:not([open]) > :not(summary)') && !e.closest('[hidden]');
    return {
      open: s.classList.contains('show'),
      h2: (s.querySelector('h2') || {}).textContent || '',
      text: s.innerText,
      fields: [...s.querySelectorAll('.field')].filter(vis).map((f) => ((f.querySelector('label') || {}).textContent || '').trim()),
      primary: ((s.querySelector('.btn-primary') || {}).textContent || '').trim(),
      folded: [...s.querySelectorAll('details:not([open]) > summary')].map((x) => x.textContent.trim()),
    };
  });

  console.log('A. the short form');
  await fresh();
  await tap("Our baby's here");
  let sh = await sheet();
  ok('the first-run baby sheet asks who we are looking after (the probe is live)', /Who are we looking after/.test(sh.h2), sh.h2);
  ok('it shows only the name and when they were born', JSON.stringify(sh.fields) === JSON.stringify(['Their name', 'Born']), sh.fields);
  ok('the country is one line with a Change', /Their vaccine plan follows the .+ schedule\. Change/.test(sh.text), sh.text.slice(0, 300));
  ok('colour, sex and birth weight fold under "More details"', sh.folded.includes('More details, optional'), sh.folded);
  ok('the button says Continue', sh.primary === 'Continue', sh.primary);

  console.log('\nB. five taps to the first log');
  taps = 1;   // "Our baby's here"
  await p.type('#bName', 'Bo');
  await tap('Today', '#sheet');
  const bd = await p.evaluate(() => document.getElementById('bDate').value);
  const today = await p.evaluate(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
  ok('"Today" sets the birthday to today', bd === today, { bd, today });
  await tap('Continue', '#sheet');
  sh = await sheet();
  ok('the next screen is "What just happened?"', /What just happened/.test(sh.h2), sh.h2);
  await tap('Nappy', '#sheet');
  await tap('Wet', '#sheet');
  const logged = await p.evaluate(() => state.events.filter((e) => e.type === 'diaper').map((e) => ({ kind: e.kind, ago: Date.now() - e.time, baby: e.babyId === state.activeBabyId })));
  ok('a wet nappy is logged, now, for this baby', logged.length === 1 && logged[0].kind === 'wet' && logged[0].ago < 60000 && logged[0].baby, logged);
  ok('in five taps from the stage choice', taps === 5, taps);
  const steps = await p.evaluate(() => window.__steps);
  ok('the first-log step is counted, between details and the invite', steps.indexOf('first_log_offered') > steps.indexOf('details_entered') && steps.indexOf('details_entered') >= 0, steps);

  console.log('\nC. then who she is, then the invite leads');
  await sleep(500);
  const idn = await p.evaluate(() => { const n = document.getElementById('llFrName'); return !!(n && n.getClientRects().length); });
  ok('the identity step follows the first log', idn);
  await p.evaluate(() => { document.getElementById('llFrName').value = 'Maya'; const r = document.getElementById('llFrRel'); r.selectedIndex = 1; r.dispatchEvent(new Event('change', { bubbles: true })); document.getElementById('llFrSave').click(); });
  await sleep(1500);
  sh = await sheet();
  ok('the invite sheet is up', /Get home, and the day is already there/.test(sh.h2), sh.h2);
  ok('"Invite someone" is the one primary action', sh.primary === 'Invite someone', sh.primary);
  ok('"Maybe later" is right under it', /Invite someone\s*\n?\s*Maybe later/.test(sh.text), sh.text.slice(0, 600));
  ok('everything else folds under "More you can set up"', sh.folded.includes('More you can set up') && !/Show me what to log/.test(sh.text.split('More you can set up')[0]), sh.folded);
  ok('invite_offered is counted after the first log', (await p.evaluate(() => window.__steps)).slice(-1)[0] === 'invite_offered');

  console.log('\nD. "Nothing yet"');
  await fresh(); taps = 0;
  await tap("Our baby's here"); await p.type('#bName', 'Bo'); await tap('Today', '#sheet'); await tap('Continue', '#sheet');
  await tap('Nothing yet', '#sheet');
  await p.evaluate(() => { document.getElementById('llFrName').value = 'Maya'; const r = document.getElementById('llFrRel'); r.selectedIndex = 1; r.dispatchEvent(new Event('change', { bubbles: true })); document.getElementById('llFrSave').click(); });
  await sleep(1500);
  sh = await sheet();
  ok('nothing is logged', (await p.evaluate(() => state.events.length)) === 0);
  ok('the sheet leads with the first log, not the invite', sh.open && sh.primary !== 'Invite someone' && /^Log|first/i.test(sh.primary), sh.primary);

  console.log('\nE. a feed from the step');
  await fresh();
  await tap("Our baby's here"); await p.type('#bName', 'Bo'); await tap('Today', '#sheet'); await tap('Continue', '#sheet');
  await tap('Feed', '#sheet'); await tap('Bottle', '#sheet'); await tap('Log bottle feed', '#sheet');
  await sleep(900);
  const feed = await p.evaluate(() => ({ feeds: state.events.filter((e) => e.type === 'feed').length, idn: !!(document.getElementById('llFrName') && document.getElementById('llFrName').getClientRects().length) }));
  ok('the feed is logged', feed.feeds === 1, feed);
  ok('and the wizard carries on to who she is', feed.idn, feed);

  console.log('\nE2. closing the feed sheet without logging');
  await fresh();
  await tap("Our baby's here"); await p.type('#bName', 'Bo'); await tap('Today', '#sheet'); await tap('Continue', '#sheet');
  await tap('Feed', '#sheet');
  await p.evaluate(() => closeSheet()); await sleep(1300);
  const closed = await p.evaluate(() => ({ events: state.events.length, idn: !!(document.getElementById('llFrName') && document.getElementById('llFrName').getClientRects().length), waiting: obAwaitFirstLog }));
  ok('nothing is logged', closed.events === 0, closed);
  ok('and the wizard carries on to who she is, instead of waiting for her next log', closed.idn && closed.waiting === false, closed);

  console.log('\nF. a second baby later keeps the full form');
  const full = await p.evaluate(async () => {
    document.querySelectorAll('.ll-modal, .ll-overlay, #llFirstRun').forEach((e) => e.remove());
    closeSheet(); openAddBaby({}); await new Promise((r) => setTimeout(r, 400));
    const s = document.getElementById('sheet');
    return { h2: s.querySelector('h2').textContent, sex: /Sex \(optional/i.test(s.innerText), country: !!s.querySelector('#bCountry'), btn: s.querySelector('.btn-primary').textContent.trim() };
  });
  ok('"Add a baby" with every field, as before', /^Add a baby/.test(full.h2) && full.sex && full.country && full.btn === 'Add baby', full);

  console.log('\nG. 320px');
  await p.setViewport({ width: 320, height: 640, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const fit = await p.evaluate(async () => {
    closeSheet(); openFirstLogStep(); await new Promise((r) => setTimeout(r, 400));
    const sr = document.getElementById('sheet').getBoundingClientRect();
    return [...document.querySelectorAll('#sheet .fl-tile, #sheet .fl-tile *')].filter((e) => e.getBoundingClientRect().right > sr.right + 0.5 || e.scrollWidth > e.clientWidth + 1).map((e) => e.className || e.tagName);
  });
  ok('the first-log tiles fit at 320px', fit.length === 0, fit);

  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
