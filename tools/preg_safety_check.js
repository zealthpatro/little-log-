#!/usr/bin/env node
/* The two pregnancy screens where Cubby was quiet at the moment it should not be.
 *
 * 1. saveBP answered EVERY reading with toast('Saved'), including 165/115. The 140/90 and 160/110
 *    thresholds already existed in pregnancy-data.js and bpFlag had exactly one caller: a history
 *    list a mother only reaches if she had turned a tracker on. The Care tab's own Blood pressure
 *    tile goes straight to saveBP, so the common path was the silent one.
 * 2. contractionStats applies the 5-1-1 rule with no idea what week it is, so a woman timing
 *    tightenings at 30 weeks was told she had not reached the threshold. It also required
 *    freqMin>=3, so the card vanished once contractions came CLOSER than three minutes apart.
 *
 * Cubby still diagnoses nothing. These assert that it repeats her own number back, names whose
 * threshold it is, and puts the phone one tap away.
 *
 *   PORT=8123 node tools/serve.js &
 *   node tools/preg_safety_check.js http://localhost:8123
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

// weeksPregnant -> a pregnancy record at that gestation.
const preg = (weeks, over) => Object.assign({
  id: 'p1', ownerUid: 'local', stage: 'expecting',
  dueDate: now + (40 - weeks) * 7 * DAY, lmp: now - weeks * 7 * DAY, cycleLen: 28, periods: [],
  country: 'us', precon: [], careTeam: [{ id: 'c1', name: 'Midwife team', phone: '+44 20 7946 0000' }],
  appts: [], symptoms: [], weights: [], bp: [], kicks: [], contractions: [], birthPlan: '', bag: [],
  moments: [], conditions: {}, glucose: [], urine: [], supplements: [], supplementLog: [], nausea: [],
  glucoseUnit: 'mmol', bornBabyId: null, createdAt: now - weeks * 7 * DAY,
}, over || {});
const seed = (p) => ({ babies: [], activeBabyId: null, events: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], notes: [], pregnancy: p });

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
  // Drive the real sheet: open it, type the numbers, press save.
  const logBP = (sys, dia) => page.evaluate((s, d) => {
    openLogBP();
    document.getElementById('bpS').value = String(s);
    document.getElementById('bpD').value = String(d);
    saveBP();
    const sheet = document.getElementById('sheet');
    const open = !!(sheet && sheet.classList.contains('show'));
    const txt = open ? (sheet.innerText || '') : '';
    const tel = open ? sheet.querySelector('a[href^="tel:"]') : null;
    return { open, txt: txt.replace(/\s+/g, ' ').trim(), toasts: window.__toasts.slice(),
      tel: tel ? tel.getAttribute('href') : null, h2: open && sheet.querySelector('h2') ? sheet.querySelector('h2').textContent.trim() : null };
  }, sys, dia);

  console.log('\n1. a normal reading is still just saved');
  {
    await load(seed(preg(30)));
    const r = await logBP(118, 74);
    ok('no sheet, no alarm', r.open === false, r);
    ok('it says Saved', (r.toasts || []).join(' ').indexOf('Saved') >= 0, r.toasts);
  }

  console.log('\n2. a raised reading is answered, not filed silently');
  {
    await load(seed(preg(30)));
    const r = await logBP(145, 92);
    ok('a sheet opens instead of a toast', r.open === true, r.toasts);
    ok('it repeats her own numbers back', /145\s*\/\s*92/.test(r.h2 || ''), r.h2);
    ok('it names whose threshold it is, 140/90', /140\s*\/\s*90/.test(r.txt), r.txt.slice(0, 180));
    ok('it does not call it an emergency on its own', /not an emergency on its own/i.test(r.txt));
    ok('the pre-eclampsia signs are listed', /headache/i.test(r.txt) && /vision|flashing/i.test(r.txt));
    ok('and the number is reachable', /^tel:/.test(r.tel || ''), r.tel);
  }

  console.log('\n3. a severe reading leads with the call');
  {
    await load(seed(preg(30)));
    const r = await logBP(165, 115);
    ok('a sheet opens', r.open === true);
    ok('it names the severe threshold, 160/110', /160\s*\/\s*110/.test(r.txt), r.txt.slice(0, 200));
    ok('it says call now, today', /call now, today|straight away/i.test(r.txt), r.txt.slice(0, 220));
    ok('it says to call even feeling well', /even if you feel well/i.test(r.txt));
    ok('the call button is the maternity unit', /maternity unit/i.test(r.txt) && /^tel:/.test(r.tel || ''), r.tel);
    ok('it still refuses to diagnose', /not a diagnosis/i.test(r.txt));
    ok('and it is saved either way', /saved to your record/i.test(r.txt));
  }

  console.log('\n4. raised PLUS a pre-eclampsia symptom she logged is treated as urgent');
  {
    await load(seed(preg(30, { symptoms: [{ id: 's1', at: now - 4 * 3600000, kind: 'A bad headache that will not go away', note: '' }] })));
    const r = await logBP(144, 91);
    ok('it connects the two', /headache/i.test(r.txt) && /in the last day/i.test(r.txt), r.txt.slice(0, 240));
    ok('and escalates to calling now', /call now rather than at your next/i.test(r.txt), r.txt.slice(0, 260));
  }

  console.log('\n5. no care team saved: it still says who to ring');
  {
    await load(seed(preg(30, { careTeam: [] })));
    const r = await logBP(165, 115);
    ok('no dead tel: link', r.tel === null, r.tel);
    ok('it names midwife or maternity unit anyway', /midwife or maternity unit/i.test(r.txt), r.txt.slice(0, 200));
  }

  console.log('\n6. contractions before 37 weeks: 5-1-1 does not apply, calling does');
  {
    // 5 minutes apart, 50s long, 8 of them: squarely 5-1-1 IF the week allowed it.
    const c = []; for (let i = 0; i < 8; i++) { const st = now - (40 - i * 5) * 60000; c.push({ id: 'c' + i, start: st, end: st + 50000 }); }
    await load(seed(preg(30, { contractions: c })));
    const r = await page.evaluate(() => { openContractions(); const s = document.getElementById('sheet'); return (s.innerText || '').replace(/\s+/g, ' ').trim(); });
    ok('these WOULD be 5-1-1 at term, so the week is what suppresses it', /5\.0|Apart/.test(r), r.slice(0, 160));
    ok('it does NOT show the 5-1-1 card', !/5-1-1 mark/i.test(r), r.slice(0, 200));
    ok('it says call now whatever the timing says', /call now, whatever the timing says/i.test(r), r.slice(0, 240));
    ok('it names her week', /30 weeks/.test(r), r.slice(0, 240));
    ok('it says the rule does not apply this early', /does not apply this early/i.test(r));
    ok('it is warm about a false alarm', /rather hear from you/i.test(r));
  }

  console.log('\n7. at term the 5-1-1 guide is unchanged');
  {
    // 5 minutes apart, 50s long, 8 of them: squarely 5-1-1 IF the week allowed it.
    const c = []; for (let i = 0; i < 8; i++) { const st = now - (40 - i * 5) * 60000; c.push({ id: 'c' + i, start: st, end: st + 50000 }); }
    await load(seed(preg(38, { contractions: c })));
    const r = await page.evaluate(() => { openContractions(); const s = document.getElementById('sheet'); return (s.innerText || '').replace(/\s+/g, ' ').trim(); });
    ok('the 5-1-1 card is back', /5-1-1 mark/i.test(r), r.slice(0, 200));
    ok('no preterm message', !/does not apply this early/i.test(r));
  }

  console.log('\n8. the card no longer goes quiet as labour speeds up');
  {
    // Two minutes apart: closer than the old freqMin>=3 floor, which used to hide the card.
    const c = []; for (let i = 0; i < 8; i++) { const st = now - (30 - i * 2) * 60000; c.push({ id: 'c' + i, start: st, end: st + 60000 }); }
    await load(seed(preg(39, { contractions: c })));
    const r = await page.evaluate(() => { openContractions(); const s = document.getElementById('sheet'); return (s.innerText || '').replace(/\s+/g, ' ').trim(); });
    ok('two minutes apart still shows the call card', /5-1-1 mark/i.test(r), r.slice(0, 220));
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'PREG-SAFETY: FAIL' : 'PREG-SAFETY: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
