// Local visual probe for the Moments gentle library. Seeds a baby + a couple of saved
// moments via ?e2e=1, opens Album -> Moments, screenshots at phone width.
//   node tools/serve.js &   then   node tools/probe_moments.js [out.png] [width]
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.argv[2] || '/tmp/moments.png';
const WIDTH = parseInt(process.argv[3], 10) || 390;

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: 900, deviceScaleFactor: 2 });
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto('http://localhost:8080/app/?e2e=1', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 600));

  const info = await page.evaluate(() => {
    const sixMo = Date.now() - Math.round(6 * 30.4 * 86400000);
    state.babies = [{ id: 'b1', name: 'Aanya', birth: sixMo, sex: '' }];
    state.activeBabyId = 'b1';
    window.LL.memberInfo = {
      local: { name: 'Test Parent', relationship: 'Mama Bear', role: 'owner' },
      u2: { name: 'Nani', relationship: 'Nana Bear', role: 'caregiver' }
    };
    // seed saved moments: a Firsts card (no photo -> illustration + check) and a custom moment
    state.journey = { saved: { b1: {
      'LC-124': { photoId: null, note: 'first proper gummy grin', date: '2026-05-02', who: 'Mama Bear', at: Date.now() },
      'cust-abc': { custom: true, title: 'First splash in the bath', section: 'Custom moments', photoId: null, note: '', date: '2026-06-10', who: '', at: Date.now() }
    } } };
    go('album'); setAlbumTab('milestones');
    const root = document.getElementById('glRoot');
    return {
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
  });
  console.log('probe:', JSON.stringify(info, null, 2));
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
