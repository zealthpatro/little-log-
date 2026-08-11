// App smoke test: loads /app/ in the real (headless) Chrome and fails if the page
// throws on load or any critical global function is missing. A first regression net
// so a broken push (undefined function, syntax error, load-time exception) is caught
// before it ships. Run before every app push:
//
//   node tools/serve.js &           # serve the repo on :8080
//   node tools/smoke.js             # exit 0 = pass, non-zero = fail
//
// One-time: npm i puppeteer-core (drives the installed Chrome; see tools/shot.js).
//
// NOTE on coverage: this catches JS errors + undefined functions (a big class of
// regressions). It does NOT log in, so it can't catch state-dependent UX bugs
// (e.g. an onclick that's defined but returns early in some state). Those still
// need manual/founder testing or a fuller authed harness.
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/* Every OTHER gate takes a BASE url and appends /app/ itself. This one wanted the full app url, so
   passing it a base loaded the marketing landing page instead and it reported the app's entire critical
   surface missing — a convincing false P0 that reads exactly like a broken push. Accept either form. */
const ARG = process.argv[2] || 'http://localhost:8080/app/';
const URL = /\/app\/?$/.test(ARG) ? ARG.replace(/\/?$/, '/') : ARG.replace(/\/?$/, '/') + 'app/';

// Critical globals that must always be defined for the app to function.
const MUST = ['render', 'openSettings', 'openBabyProfile', 'openReminders', 'datePicker',
  'renderLogTab', 'ensureRoutines', 'toast', 'activeBaby', 'persist', 'openFamily',
  // The guide is a separate module wired into home, Settings, first run and ?go=guide. If it fails
  // to load, all four go quiet rather than erroring, so nothing else here would notice.
  'cubbyOpenGuide', 'cubbyGuideCtx'];

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  const pageErrors = [], consoleErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));            // uncaught exceptions = real regressions
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 }).catch(e => pageErrors.push('goto: ' + e.message));
  await new Promise(r => setTimeout(r, 1800));
  const missing = await page.evaluate(fns => fns.filter(f => typeof window[f] !== 'function'), MUST);
  await browser.close();

  console.log('URL:', URL);
  console.log('missing critical globals:', missing.length ? missing.join(', ') : 'none');
  console.log('uncaught page errors:', pageErrors.length);
  pageErrors.slice(0, 15).forEach(e => console.log('  ✕', e));
  // console errors are noisy (Firebase/3rd-party in headless) — list for info only, don't fail on them
  console.log('console errors (info only):', consoleErrors.length);
  consoleErrors.slice(0, 8).forEach(e => console.log('  ·', e.slice(0, 160)));

  const ok = missing.length === 0 && pageErrors.length === 0;
  console.log(ok ? '\nSMOKE: PASS ✅' : '\nSMOKE: FAIL ❌');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('smoke runner error:', e.message); process.exit(2); });
