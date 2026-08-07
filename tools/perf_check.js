// Jitter gate. Seeds a REAL history (four months of logging, 2,500+ events) through the
// localhost-only ?e2e=1 boot, then measures the render path at 4x CPU throttle — roughly a
// mid-range phone against this Mac. Fails if any of the budgets below are blown.
//
//   node tools/serve.js &   &&   node tools/perf_check.js [baseUrl]
//
// Why it exists: the app shipped for months rebuilding its entire shell on every render, and the
// Log timeline built every event ever logged, every time. Nobody noticed because nothing looked
// at it — 498ms of frozen phone per repaint doesn't show up in a screenshot. It does in here.
//
// Budgets are deliberately loose (about 4x the measured numbers) so this fails on a regression in
// KIND — a full-shell rebuild, an unwindowed list, a per-second document sweep — not on the noise
// of a busy laptop.
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8080';
const DAYS = 120;

const BUDGET = {
  logRenderThrottled4xMs: 60,    // measured 11
  homeRenderThrottled4xMs: 40,   // measured 7
  deepChangeThrottled4xMs: 220,  // measured 74 (a sync landing with the whole history revealed)
  tickMs: 6,                     // measured 2.5 (this runs every second, on every screen)
  logDomNodes: 8000,             // measured 3,297 (27,570 before the list was windowed)
  logMarkupKB: 400               // measured 180 (1,501 before)
};

function seed(days) {
  const DAY = 86400000, t0 = Date.now(), babyId = 'b1', events = [];
  let n = 0;
  for (let d = 0; d < days; d++) {
    const b = t0 - d * DAY;
    for (let i = 0; i < 8; i++) events.push({ id: 'f' + (n++), babyId, type: 'feed', time: b - i * 3 * 3600000, method: 'bottle', amount: 90 });
    for (let i = 0; i < 8; i++) events.push({ id: 'd' + (n++), babyId, type: 'diaper', time: b - i * 3 * 3600000 - 6e5, kind: 'wet' });
    for (let i = 0; i < 5; i++) events.push({ id: 's' + (n++), babyId, type: 'sleep', time: b - i * 4 * 3600000, end: b - i * 4 * 3600000 + 54e5 });
  }
  events.sort((a, b) => b.time - a.time);
  return {
    babies: [{ id: babyId, name: 'Test Baby', birth: t0 - days * DAY, sex: 'F', routines: [] }],
    activeBabyId: babyId, events,
    settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', theme: 'light', seen: { home: 1, log: 1, growth: 1, album: 1, health: 1 } },
    timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], pregnancy: null, notes: []
  };
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return +s[s.length >> 1].toFixed(1); };

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));

  await page.goto(BASE + '/app/', { waitUntil: 'domcontentloaded' });
  await page.evaluate((s) => { localStorage.setItem('little-log-v1', JSON.stringify(s)); localStorage.setItem('cubby-quick-uid', 'local'); localStorage.setItem('cubby-theme:local', 'light'); }, seed(DAYS));
  await page.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2' });
  await page.waitForFunction("document.querySelector('.nav-btn')", { timeout: 20000 });

  const size = await page.evaluate(() => {
    window.go('log');
    return { nodes: document.getElementById('app').getElementsByTagName('*').length, kb: Math.round(document.getElementById('app').innerHTML.length / 1024), events: window.babyEvents().length };
  });

  // Every day she logged has to be reachable by scrolling — a window that loses history is a bug,
  // not an optimisation.
  const reveal = await page.evaluate(async () => {
    const sc = document.getElementById('scroll');
    let r = 0;
    while (document.getElementById('tlMore') && r < 300) { sc.scrollTop = sc.scrollHeight; await new Promise((x) => setTimeout(x, 50)); r++; }
    const days = {}; window.babyEvents().forEach((e) => { days[window.dayKey(e.time)] = 1; });
    return { built: document.querySelectorAll('.day-group').length, expected: Object.keys(days).length, items: document.querySelectorAll('.tl-item').length, events: window.babyEvents().length };
  });

  const cdp = await page.target().createCDPSession();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const deep = await page.evaluate(() => {
    const a = [];
    for (let i = 0; i < 5; i++) {
      state.events.unshift({ id: 'pc' + i, babyId: state.activeBabyId, type: 'feed', time: Date.now() - i * 900, method: 'bottle', amount: 60 + i });
      const t = performance.now(); window.render(); void document.getElementById('scroll').scrollHeight; a.push(performance.now() - t);
    }
    return a;
  });
  const views = await page.evaluate(() => {
    const r = {};
    ['home', 'log'].forEach((v) => {
      window.go(v); tlResetReveal(); const a = [];
      for (let i = 0; i < 6; i++) { state.settings.__bump = i; const t = performance.now(); window.render(); void document.getElementById('scroll').scrollHeight; a.push(performance.now() - t); }
      r[v] = a;
    });
    delete state.settings.__bump;
    return r;
  });
  const tick = await page.evaluate(() => {
    window.go('log');
    const a = [];
    for (let i = 0; i < 15; i++) {
      const t = performance.now();
      refreshTickTargets();
      _tickTimers.concat(_tickSince, _tickDue).forEach((el) => { if (el.isConnected) void el.dataset; });
      if (typeof checkMedReminders === 'function') checkMedReminders();
      a.push(performance.now() - t);
    }
    return a;
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await browser.close();

  const got = {
    logRenderThrottled4xMs: med(views.log),
    homeRenderThrottled4xMs: med(views.home),
    deepChangeThrottled4xMs: med(deep),
    tickMs: med(tick),
    logDomNodes: size.nodes,
    logMarkupKB: size.kb
  };
  const fails = Object.keys(BUDGET).filter((k) => got[k] > BUDGET[k]);
  if (reveal.built !== reveal.expected) fails.push('reveal built ' + reveal.built + ' of ' + reveal.expected + ' days');
  if (reveal.items !== reveal.events) fails.push('reveal shows ' + reveal.items + ' of ' + reveal.events + ' entries');
  if (errs.length) fails.push('page errors: ' + errs.length);

  console.log('seeded: ' + size.events + ' events over ' + DAYS + ' days\n');
  Object.keys(BUDGET).forEach((k) => console.log((got[k] > BUDGET[k] ? '  ✕ ' : '  ✓ ') + k + ': ' + got[k] + '  (budget ' + BUDGET[k] + ')'));
  console.log('  ' + (reveal.built === reveal.expected ? '✓' : '✕') + ' every day reachable: ' + reveal.built + '/' + reveal.expected + ' days, ' + reveal.items + '/' + reveal.events + ' entries');
  console.log('  ' + (errs.length ? '✕' : '✓') + ' page errors: ' + errs.length);
  errs.slice(0, 5).forEach((e) => console.log('    ·', e));
  console.log('\nPERF: ' + (fails.length ? 'FAIL ❌ (' + fails.join('; ') + ')' : 'PASS ✅'));
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('PERF PROBE CRASHED', e); process.exit(1); });
