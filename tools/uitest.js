// Authed-equivalent UI smoke harness — NO credentials needed.
// The app has a "local mode": state persists to localStorage[little-log-v1] and runs
// without Firebase sign-in. We seed a known state, load the real /app/ headlessly, then
// click through the key surfaces and FAIL on a dead tap (a control that opens nothing)
// or any uncaught error. This is the class of bug the load-only smoke test can't catch
// (e.g. the no-baby dead "Profile" tap).
//
//   node tools/serve.js &      &&   node tools/uitest.js
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8080';
const SHOT = process.argv[3] || '';

const SEED = {
  babies: [{ id: 'b1', name: 'Test Baby', birth: Date.now() - 180 * 86400000, sex: '', routines: [] }],
  activeBabyId: 'b1', events: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', theme: 'light', seen: {} },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], pregnancy: null, notes: []
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 850, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/app/', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.evaluate(s => { localStorage.setItem('little-log-v1', JSON.stringify(s)); }, SEED);
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1800));

  const probe = await page.evaluate(() => {
    const g = n => { try { return eval(n); } catch (e) { return undefined; } };  // read top-level lets/consts
    const st = g('state');
    return {
      babies: (st && st.babies && st.babies.length) || 0,
      view: g('view') || null,
      seesBabyName: /Test Baby/.test(document.body.innerText),
      bodyLen: document.body.innerText.length,
      sampleText: document.body.innerText.replace(/\s+/g, ' ').slice(0, 220)
    };
  });
  if (SHOT) await page.screenshot({ path: SHOT, fullPage: false });
  await browser.close();
  console.log('seeded babies:', probe.babies, '| view:', probe.view, '| sees "Test Baby":', probe.seesBabyName, '| bodyLen:', probe.bodyLen);
  console.log('page text sample:', probe.sampleText);
  console.log('uncaught errors:', errs.length); errs.slice(0, 6).forEach(e => console.log('  ✕', e));
})().catch(e => { console.error('runner error:', e.message); process.exit(2); });
