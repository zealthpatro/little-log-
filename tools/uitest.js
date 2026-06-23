// Authed-equivalent UI harness — NO credentials. Uses the localhost-only ?e2e=1 boot hook
// (app/store-firebase.js) to skip Firebase + the sign-in gate and drive the logged-in UI from
// seeded localStorage. Catches dead taps (a control that opens nothing) + uncaught errors —
// the class of bug the load-only smoke test can't see.
//
//   node tools/serve.js &   &&   node tools/uitest.js [baseUrl] [out.png]
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8080';
const SHOT = process.argv[3] || '/tmp/uitest.png';
const APP = BASE + '/app/?e2e=1';

const SEED = {
  babies: [{ id: 'b1', name: 'Test Baby', birth: Date.now() - 120 * 86400000, sex: 'F', routines: [] }],
  activeBabyId: 'b1', events: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', theme: 'light', seen: { home: 1, log: 1, growth: 1, album: 1, health: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], pregnancy: null, notes: []
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 850, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  // boot once (hook runs), seed, reload so Store.load picks up the seed
  await page.goto(APP, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.evaluate(s => localStorage.setItem('little-log-v1', JSON.stringify(s)), SEED);
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1500));

  const booted = await page.evaluate(() => {
    const g = n => { try { return eval(n); } catch (e) { return undefined; } };
    const st = g('state');
    return { babies: (st && st.babies && st.babies.length) || 0, seesBaby: /Test Baby/.test(document.body.innerText), view: g('view') || null };
  });

  await page.screenshot({ path: SHOT });  // clean logged-in home, before any probing

  // dead-tap probe: call each sheet-opener and confirm a sheet actually opens (this is exactly
  // what would have caught the no-baby dead 'Profile' tap). Skips toggles/share/logout and the
  // auth-only Family modal (needs a real signed-in user the e2e mock doesn't provide).
  const OPENERS = ['openBabyProfile', 'openSettings', 'openBabySheet', 'openReminders', 'openDataSheet', 'openPro'];
  let deadTaps = [];
  for (const fn of OPENERS) {
    await page.evaluate(() => { if (typeof closeSheet === 'function') closeSheet(); });  // ensure clean before opening
    await new Promise(r => setTimeout(r, 500));
    const ran = await page.evaluate((f) => { try { var g = eval(f); if (typeof g === 'function') { g(); return true; } return 'no-fn'; } catch (e) { return 'threw:' + e.message; } }, fn);
    await new Promise(r => setTimeout(r, 450));                 // let the sheet's slide-in apply .show
    const opened = await page.evaluate(() => { var s = document.querySelector('.sheet.show'); return !!(s && (s.textContent || '').trim().length > 20); });
    if (ran !== true) deadTaps.push(fn + ' (' + ran + ')');
    else if (!opened) deadTaps.push(fn + ' (no sheet)');
  }

  await browser.close();
  console.log('booted logged-in UI:', booted.babies > 0 && booted.seesBaby, '| babies:', booted.babies, '| view:', booted.view);
  console.log('uncaught errors:', errs.length); errs.slice(0, 8).forEach(e => console.log('  ✕', e));
  console.log('dead taps (settings rows that opened nothing):', deadTaps.length ? deadTaps.join(', ') : 'none');
  const ok = booted.babies > 0 && booted.seesBaby && errs.length === 0 && deadTaps.length === 0;
  console.log(ok ? '\nUITEST: PASS ✅' : '\nUITEST: FAIL ❌');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('runner error:', e.message); process.exit(2); });
