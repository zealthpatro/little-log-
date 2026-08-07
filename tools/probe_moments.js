// Local visual probe for the Moments gentle library. Seeds a baby + a couple of saved
// moments via ?e2e=1, opens Album -> Moments, screenshots at phone width.
//   node tools/serve.js &   then   node tools/probe_moments.js [out.png] [width] [light|night]
//
// Verifying journey ART needs two things this probe now does for you, because without them
// most of the illustrated cards simply are not on screen:
//   1. AGE — Monthly growth only lists months the baby has reached, so an 18-23 month card
//      needs an older baby. PROBE_AGE_MONTHS=19 seeds one (default 6).
//   2. TIER 3 — app/journey-catalogue.js marks the "About me" and "Custom moments" prompt
//      cards t:3, and glGroupHtml() hides tier-3 cards unless they are ALREADY SAVED. So the
//      probe pre-saves a spread of them (PROBE_SAVE, or the built-in art-check set below).
// Theme comes from localStorage cubby-theme:<uid>, per-person, so it is set before a reload.
//
//   node tools/probe_moments.js /tmp/m-light.png 390 light
//   PROBE_AGE_MONTHS=19 PROBE_SAVE=art node tools/probe_moments.js /tmp/m-night.png 390 night
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.argv[2] || '/tmp/moments.png';
const WIDTH = parseInt(process.argv[3], 10) || 390;
const THEME = (process.argv[4] || 'light').toLowerCase();
const AGE_MONTHS = parseFloat(process.env.PROBE_AGE_MONTHS || '6');

// PROBE_SAVE=art pre-saves this spread, which is the cheapest way to get one card from every
// illustrated family on screen at once: the six About-me traits, four monthly-growth toddler
// months, the newborn-days run, and the journaling prompts that share one design.
const ART_SET = ['LC-190', 'LC-191', 'LC-192', 'LC-193', 'LC-194', 'LC-195',
                 'LC-107', 'LC-108', 'LC-109', 'LC-112',
                 'LC-076', 'LC-077', 'LC-080',
                 'LC-202', 'LC-204', 'LC-260', 'LC-264', 'LC-267', 'LC-275', 'LC-278'];
const rawSave = process.env.PROBE_SAVE || '';
const EXTRA_SAVE = rawSave === 'art' ? ART_SET : rawSave.split(',').map(s => s.trim()).filter(Boolean);

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: 900, deviceScaleFactor: 2 });
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto('http://localhost:8080/app/?e2e=1', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 600));
  // theme is per-person (cubby-theme:<uid>) and read at boot, so set it and reload
  await page.evaluate((t) => {
    localStorage.setItem('cubby-quick-uid', 'local');
    localStorage.setItem('cubby-theme:local', t);
  }, THEME);
  await page.reload({ waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 900));

  const info = await page.evaluate((cfg) => {
    const born = Date.now() - Math.round(cfg.ageMonths * 30.4 * 86400000);
    state.babies = [{ id: 'b1', name: 'Aanya', birth: born, sex: '' }];
    state.activeBabyId = 'b1';
    window.LL.memberInfo = {
      local: { name: 'Test Parent', relationship: 'Mama Bear', role: 'owner' },
      u2: { name: 'Nani', relationship: 'Nana Bear', role: 'caregiver' }
    };
    // seed saved moments: a Firsts card (no photo -> illustration + check) and a custom moment
    const saved = {
      'LC-124': { photoId: null, note: 'first proper gummy grin', date: '2026-05-02', who: 'Mama Bear', at: Date.now() },
      'cust-abc': { custom: true, title: 'First splash in the bath', section: 'Custom moments', photoId: null, note: '', date: '2026-06-10', who: '', at: Date.now() }
    };
    // tier-3 prompt cards are hidden until saved, so force them visible when asked
    cfg.extraSave.forEach((id) => {
      saved[id] = { photoId: null, note: '', date: '2026-08-01', who: 'Mama Bear', at: Date.now() };
    });
    state.journey = { saved: { b1: saved } };
    go('album'); setAlbumTab('milestones');
    const root = document.getElementById('glRoot');
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      ageMonths: cfg.ageMonths,
      forcedSaved: cfg.extraSave.length,
      hasRoot: !!root,
      groups: document.querySelectorAll('#glGroups .gl-group').length,
      cards: document.querySelectorAll('#glGroups .gl-card').length,
      saved: document.querySelectorAll('#glGroups .gl-card.saved').length,
      suggested: document.querySelectorAll('.gl-suggest .gl-card').length,
      header: (document.querySelector('.gl-head .a') || {}).textContent || '',
      firstGroupOpen: (document.querySelector('#glGroups .gl-group[open] .gt') || {}).textContent || '',
      // capture every visible count chip to confirm "N saved / N ideas" copy, never "N of M"
      counts: Array.from(document.querySelectorAll('#glGroups .gl-group > summary .gc')).map(e => e.textContent)
    };
  }, { ageMonths: AGE_MONTHS, extraSave: EXTRA_SAVE });

  // open every group and wait for the art to decode, so a broken card cannot hide behind
  // lazy loading and pass as "fine" in the screenshot
  const art = await page.evaluate(async () => {
    document.querySelectorAll('#glGroups .gl-group').forEach(g => { g.open = true; });
    await new Promise(r => setTimeout(r, 1200));
    const imgs = Array.from(document.querySelectorAll('#glGroups img'));
    imgs.forEach(i => { i.loading = 'eager'; });
    await Promise.all(imgs.map(i => i.complete ? 1 : Promise.race([
      new Promise(r => { i.onload = i.onerror = r; }), new Promise(r => setTimeout(r, 5000))
    ])));
    return {
      imgs: imgs.length,
      broken: imgs.filter(i => i.complete && i.naturalWidth === 0).map(i => i.src.split('/').pop()).slice(0, 10)
    };
  });
  console.log('probe[' + THEME + ']:', JSON.stringify(Object.assign(info, art), null, 2));
  if (errs.length) console.log('CONSOLE ERRORS:\n' + errs.join('\n'));

  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: OUT, fullPage: true });
  console.log('shot ->', OUT);

  // open the Firsts group (holds the saved LC-124) and screenshot the card states
  await page.evaluate(() => {
    document.querySelectorAll('#glGroups .gl-group').forEach(g => { if (g.querySelector('.gt') && g.querySelector('.gt').textContent === 'Firsts') g.open = true; });
    const g = Array.from(document.querySelectorAll('#glGroups .gl-group')).find(x => x.querySelector('.gt') && x.querySelector('.gt').textContent === 'Firsts');
    if (g) g.scrollIntoView();
  });
  await new Promise(r => setTimeout(r, 250));
  await page.screenshot({ path: OUT.replace('.png', '_firsts.png') });
  console.log('shot ->', OUT.replace('.png', '_firsts.png'));

  // open a moment-detail sheet for an empty card
  const sheet = await page.evaluate(() => {
    openMomentDetail('LC-090');           // Monthly growth: "One month old"
    const sh = document.querySelector('.sheet, .cu-sheet, #sheet, .sheet-card');
    return { hasH2: !!document.querySelector('h2'), h2: (document.querySelector('h2') || {}).textContent || '', whoChips: document.querySelectorAll('#glWho .rel-chip').length, hasDate: !!document.getElementById('glDate') };
  });
  console.log('detail sheet:', JSON.stringify(sheet));
  await new Promise(r => setTimeout(r, 250));
  await page.screenshot({ path: OUT.replace('.png', '_detail.png'), fullPage: true });
  console.log('shot ->', OUT.replace('.png', '_detail.png'));

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
