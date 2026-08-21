#!/usr/bin/env node
/* Five things that were quietly wrong for a parent. From the tracking audit, ranked by what most
 * improves a real day per hour of work, and every one of them verified in the code first.
 *
 * 1. Setup ended by asking for an invite before she had logged anything. Median time to a first log
 *    is 282.6 hours and no household has reached a seventh day.
 * 2. "Last feed" measured from the START of a nursing session, so a feed that began 2h ago and ran
 *    55 minutes read "2h ago" when the baby came off 65 minutes back. Always wrong in the same
 *    direction, towards "she is overdue", on the charter's own 3am question.
 * 3. Tapping Feed while a nursing timer ran destroyed it. Eighteen minutes gone, nothing written.
 * 4. A double tap wrote two entries, and bottle volumes are SUMMED into the doctor report, so one
 *    shaky tap turned 120ml into 240ml on a clinical page.
 * 5. Logging "Fever" as a symptom was silent, so the sentence that protects a newborn was reachable
 *    only from the temperature path.
 *
 *   PORT=8123 node tools/serve.js &
 *   node tools/quality_check.js http://localhost:8123
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8123';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, HOUR = 3600000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
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
  const load = async (s) => {
    await page.evaluate((x) => {
      localStorage.setItem('little-log-v1', JSON.stringify(x));
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
    }, s);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1400);
    await page.evaluate(() => { try { window.__toasts = []; window.toast = function (m) { window.__toasts.push(m); }; } catch (e) {} });
    await sleep(200);
  };

  console.log('\n1. setup ends by asking for the first log, not the invite');
  {
    await load(seed());
    const r = await page.evaluate(() => {
      openOnboardInvite();
      const s = document.getElementById('sheet');
      const primary = s.querySelector('.btn-primary');
      const txt = (s.innerText || '').replace(/\s+/g, ' ');
      return { primary: primary ? primary.textContent.replace(/\s+/g, ' ').trim() : null,
        onclick: primary ? primary.getAttribute('onclick') : null,
        inviteIsGhost: !!s.querySelector('.btn-ghost[onclick*="openFamily"]'), txt };
    });
    ok('the primary action is the first log', /openFirstLog/.test(r.onclick || ''), r);
    ok('and it is labelled with a real verb', /log|start|count|add/i.test(r.primary || ''), r.primary);
    ok('the invite is still there, demoted', r.inviteIsGhost === true, r);
    ok('and it promises two taps, not a chore', /two taps/i.test(r.txt), r.txt.slice(0, 200));
  }

  console.log('\n2. "last feed" means when the feed ENDED');
  {
    // Began 2h ago, ran 55 minutes: she came off the breast 65 minutes ago.
    await load(seed({ events: [{ id: 'f1', type: 'feed', babyId: 'b1', method: 'breast', side: 'right',
      dur: 55 * 60000, time: now - 2 * HOUR }] }));
    const r = await page.evaluate(() => {
      go('home');
      const c = [...document.querySelectorAll('.since-card')].find((x) => /feed/i.test(x.textContent));
      return { v: (c.querySelector('.v') || {}).textContent, w: (c.querySelector('.w') || {}).textContent };
    });
    ok('it says about an hour, not two', /1h/.test(r.v || ''), r);
    ok('and NOT the old 2h answer', !/^2h/.test((r.v || '').trim()), r);
    ok('the clock time is shown too, which the charter names', /\d/.test(r.w || ''), r);
  }

  console.log('\n3. a running nursing timer is never silently destroyed');
  {
    await load(seed({ timers: { b1: { feed: { start: now - 18 * 60000, side: 'left' } } } }));
    const r = await page.evaluate(() => {
      const before = state.timers.b1.feed.start;
      openFeed(); startFeedTimer();
      const s = document.getElementById('sheet');
      return { txt: (s ? s.innerText : '').replace(/\s+/g, ' '),
        sameTimer: state.timers.b1.feed && state.timers.b1.feed.start === before,
        events: state.events.filter((e) => e.type === 'feed').length };
    });
    ok('it warns instead of overwriting', /already running/i.test(r.txt), r.txt.slice(0, 160));
    ok('it says how long that one has run', /18m|started/i.test(r.txt), r.txt.slice(0, 200));
    ok('the running timer is untouched', r.sameTimer === true, r);
    ok('and nothing was written behind her back', r.events === 0, r);
  }

  console.log('\n4. a fumbled double tap writes one entry, not two');
  {
    await load(seed());
    const r = await page.evaluate(() => {
      commitEvent({ type: 'diaper', kind: 'wet', time: now() });
      commitEvent({ type: 'diaper', kind: 'wet', time: now() });
      const n1 = state.events.filter((e) => e.type === 'diaper').length;
      commitEvent({ type: 'feed', method: 'bottle', amount: 120, unit: 'ml', time: now() });
      commitEvent({ type: 'feed', method: 'bottle', amount: 120, unit: 'ml', time: now() });
      const vol = state.events.filter((e) => e.type === 'feed').reduce((a, e) => a + (+e.amount || 0), 0);
      return { nappies: n1, bottleVol: vol };
    });
    ok('two taps on Wet write one nappy', r.nappies === 1, r);
    ok('and 120ml does not become 240ml on the doctor page', r.bottleVol === 120, r);
    const r2 = await page.evaluate(() => {
      const before = state.events.filter((e) => e.type === 'diaper').length;
      commitEvent({ type: 'diaper', kind: 'dirty', time: now() });   // a DIFFERENT entry
      return { before, after: state.events.filter((e) => e.type === 'diaper').length };
    });
    ok('but a genuinely different entry still writes', r2.after === r2.before + 1, r2);
  }

  console.log('\n5. the feed sheet opens on the side she used last');
  {
    await load(seed({ events: [{ id: 'f1', type: 'feed', babyId: 'b1', method: 'breast', side: 'right', dur: 15 * 60000, time: now - 3 * HOUR }] }));
    const side = await page.evaluate(() => { openFeed(); return feedDraft.side; });
    ok('it opens on right, because that was the last one', side === 'right', side);
  }

  console.log('\n6. logging Fever as a symptom is not silent');
  {
    await load(seed({ babies: [{ id: 'b1', name: 'Wren', birth: now - 40 * DAY, sex: 'M', routines: [], doctors: [], allergies: [] }] }));
    const r = await page.evaluate(() => {
      symptomDraft = { symptom: 'Fever', severity: 'moderate' };
      saveSymptom();
      const s = document.getElementById('sheet');
      return { open: !!(s && s.classList.contains('show')), txt: (s ? s.innerText : '').replace(/\s+/g, ' ') };
    });
    ok('it answers instead of just toasting', r.open === true, r);
    ok('and for a baby under three months it says any fever is worth a call', /under 3 months/i.test(r.txt), r.txt.slice(0, 240));
    ok('it offers to add the number', /add a temperature/i.test(r.txt));
    ok('it invents no reading of its own', !/\d+\s*°/.test(r.txt), r.txt.slice(0, 200));
    ok('and it still refuses to be medical advice', /not medical advice/i.test(r.txt));
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'QUALITY: FAIL' : 'QUALITY: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
