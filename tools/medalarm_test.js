/* MEDICINE ALARM GATE — the P0 that must never ship twice.
 *
 * The founder's report, verbatim: "i added a medicine and i said every x hours it started. haptic
 * alarm that i couldnt dismiss is that expected it is is horrible". A schedule bug made a fresh
 * medicine permanently overdue, checkMedReminders runs on a 1s interval, and every toast fired a
 * Taptic tap on the wrapper. One line of arithmetic became an alarm beside a sleeping baby with no
 * off switch. No unit test could have caught it, because nothing wrong happens until real time
 * passes inside the real add flow.
 *
 * So this drives the ACTUAL UI (tap Add a medicine, type, tap Every X hrs, tap Add medicine, tap
 * Dose), moves the clock by moving the data, and then watches the real 1s tick. It FAILS if a
 * single due event produces more than one alert, if an automated alert buzzes at all, or if the
 * parent has no one-tap way out.
 *
 * It also guards ITSELF (see harness checks): an earlier attempt at this repro reported a clean
 * zero purely because native-bridge.js reinstalled window.cubbyHaptic over the counter and the tick
 * was never confirmed to be running. A silent no-op harness on a P0 is worse than no harness.
 *
 *   node tools/serve.js &   &&   node tools/medalarm_test.js [baseUrl]
 */
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8080';
const APP = BASE + '/app/?e2e=1';

const SEED = {
  babies: [{ id: 'b1', name: 'Test Baby', birth: Date.now() - 120 * 86400000, sex: 'F', routines: [] }],
  activeBabyId: 'b1', events: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', theme: 'light', seen: { home: 1, log: 1, growth: 1, album: 1, health: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], pregnancy: null, notes: []
};

const HOURS = 6;                 // "every x hours", the founder's input
const WATCH_TICKS = 9;           // the tick is 1s; 9 passes is plenty to see a 1Hz storm
const sleep = ms => new Promise(r => setTimeout(r, ms));

const fails = [];
const note = [];
function check(ok, label, detail) {
  console.log(`  ${ok ? '✓' : '✕'} ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) fails.push(label + (detail ? ' ' + detail : ''));
}

/* Counts alerts the app raised on its own. Installed AFTER the page has fully booted so that
 * native-bridge.js has already published window.cubbyHaptic and cannot clobber the spy. */
const INSTALL_SPY = function () {
  window.__spy = { toasts: [], alerts: [], haptics: 0, installedAt: Date.now() };
  var realToast = window.toast, realHaptic = window.cubbyHaptic;
  window.__spy.hadHaptic = typeof realHaptic === 'function';
  window.toast = function (msg, opts) {
    window.__spy.toasts.push(String(msg));
    if (String(msg).indexOf('⏰') === 0) window.__spy.alerts.push(String(msg));
    return realToast.apply(this, arguments);
  };
  window.cubbyHaptic = function () {
    window.__spy.haptics++;
    if (typeof realHaptic === 'function') return realHaptic.apply(this, arguments);
  };
  return true;
};

async function spy(page) { return page.evaluate(() => window.__spy); }
async function resetSpy(page) { await page.evaluate(() => { window.__spy.toasts = []; window.__spy.alerts = []; window.__spy.haptics = 0; }); }

// Click a real element by its visible text, the way a thumb would.
async function tapText(page, selector, text) {
  return page.evaluate((sel, t) => {
    var els = [].slice.call(document.querySelectorAll(sel));
    var el = els.filter(e => (e.textContent || '').trim().indexOf(t) >= 0)[0];
    if (!el) return false;
    el.click(); return true;
  }, selector, text);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 850, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  await page.goto(APP, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.evaluate(s => {
    localStorage.setItem('little-log-v1', JSON.stringify(s));
    localStorage.setItem('cubby-quick-uid', 'local');
    // start from a clean slate every run, or yesterday's ledger silences today's assertions
    Object.keys(localStorage).forEach(k => { if (k.indexOf('cubby-med-alerts') === 0) localStorage.removeItem(k); });
  }, SEED);
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1600);
  await page.evaluate(INSTALL_SPY);

  // ---- harness self-check: if any of this is false, every assertion below is meaningless -------
  console.log('\nharness');
  const boot = await page.evaluate(() => {
    var g = n => { try { return eval(n); } catch (e) { return undefined; } };
    return {
      babies: ((g('state') || {}).babies || []).length,
      tickLive: !!g('tickInterval'),
      spyOnToast: window.toast !== g('toast') || /__spy/.test(String(window.toast)),
      hasHaptic: window.__spy.hadHaptic
    };
  });
  check(boot.babies > 0, 'seeded app booted', `(babies: ${boot.babies})`);
  check(boot.tickLive, 'the real 1s tick is running', boot.tickLive ? '' : '(nothing to measure — fix the harness)');
  check(/__spy/.test(await page.evaluate(() => String(window.toast))), 'toast spy is installed and not overwritten');

  // ---- 1. THE FOUNDER'S EXACT INPUT: add a medicine, every X hours, and wait ------------------
  console.log('\n1. add a medicine "every 6 hours" through the real sheet, then watch 9 ticks');
  await page.evaluate(() => { go('health'); });
  await sleep(500);
  check(await tapText(page, '.add-row', 'Add a medicine'), 'tapped "Add a medicine"');
  await sleep(450);
  await page.type('#mName', 'Calpol');
  await page.type('#mDose', '2.5');
  check(await tapText(page, '.unit-toggle button', 'Every X hrs'), 'tapped "Every X hrs"');
  await sleep(300);
  await page.evaluate(h => { var i = document.querySelector('.stepper input'); i.value = h; i.dispatchEvent(new Event('change')); }, HOURS);
  await sleep(200);
  check(await tapText(page, '.btn-primary', 'Add medicine'), 'tapped "Add medicine"');
  await sleep(600);

  const saved = await page.evaluate(() => (state.meds || []).map(m => ({ n: m.name, t: m.pattern.type, h: m.pattern.hours, r: m.remind })));
  check(saved.length === 1 && saved[0].t === 'everyX', 'medicine saved as everyX', JSON.stringify(saved));

  await resetSpy(page);
  await sleep(WATCH_TICKS * 1000 + 400);
  let s = await spy(page);
  check(s.alerts.length === 0, 'a never-dosed medicine raises NO alert', `(alerts: ${s.alerts.length}, haptics: ${s.haptics})`);
  check(s.haptics === 0, 'and no haptic', `(haptics: ${s.haptics})`);
  if (s.alerts.length) note.push(`storm rate ≈ ${(s.alerts.length / WATCH_TICKS).toFixed(2)} alerts/sec`);

  // ---- 2. ONE GENUINE DUE EVENT -> EXACTLY ONE ALERT ------------------------------------------
  console.log(`\n2. log a dose, backdate it ${HOURS + 1}h so the dose is genuinely due, watch ${WATCH_TICKS} ticks`);
  check(await tapText(page, '.dose-btn', 'Dose'), 'tapped "Dose"');
  await sleep(600);
  const backdated = await page.evaluate(h => {
    var e = state.events.filter(x => x.type === 'medicine')[0];
    if (!e) return false;
    e.time -= (h + 1) * 3600000;               // moving the data is the only way to move this clock
    render();
    return typeof medNextDue === 'function' ? medNextDue(state.meds[0]) <= Date.now() : true;
  }, HOURS);
  check(backdated, 'the medicine is now genuinely overdue');

  await resetSpy(page);
  await sleep(WATCH_TICKS * 1000 + 400);
  s = await spy(page);
  check(s.alerts.length === 1, 'ONE due event raises exactly ONE alert', `(alerts: ${s.alerts.length} over ${WATCH_TICKS} ticks)`);
  check(s.haptics === 0, 'an automated alert never buzzes', `(haptics: ${s.haptics})`);
  if (s.alerts.length > 1) note.push(`storm rate ≈ ${(s.alerts.length / WATCH_TICKS).toFixed(2)} alerts/sec`);

  // ---- 3. HOSTILE SYNC: a remote snapshot keeps wiping the in-blob guard ----------------------
  // Exactly what applyAppBlob does (`state.meds = app.meds || []`) with a doc authored before this
  // device stamped lastNotified. The old guard lived in that blob, so this re-opened the firehose.
  console.log(`\n3. a remote snapshot replaces state.meds every second (the sync-wipe path)`);
  await resetSpy(page);
  await page.evaluate(() => {
    window.__wipe = setInterval(function () {
      state.meds = JSON.parse(JSON.stringify(state.meds)).map(function (m) { delete m.lastNotified; return m; });
    }, 1000);
  });
  await sleep(WATCH_TICKS * 1000 + 400);
  await page.evaluate(() => clearInterval(window.__wipe));
  s = await spy(page);
  check(s.alerts.length === 0, 'a wiped sync guard raises NO further alert for the same dose', `(alerts: ${s.alerts.length})`);
  check(s.haptics === 0, 'and still no haptic', `(haptics: ${s.haptics})`);
  if (s.alerts.length) note.push(`sync-wipe re-fire ≈ ${(s.alerts.length / WATCH_TICKS).toFixed(2)} alerts/sec`);

  // ---- 4. THE PARENT CAN STOP IT IN ONE TAP, AND IT STAYS STOPPED -----------------------------
  console.log('\n4. one tap to stop it, and it stays stopped');
  await page.evaluate(() => { go('home'); });
  await sleep(600);
  const pill = await page.evaluate(() => {
    var p = document.querySelector('.alert-pill');
    if (!p) return null;
    return { text: (p.textContent || '').replace(/\s+/g, ' ').trim(), buttons: [].slice.call(p.querySelectorAll('button')).map(b => (b.textContent || '').trim()) };
  });
  check(!!pill, 'the overdue dose shows an alert pill on home', pill ? '' : '(no pill)');
  check(!!pill && pill.buttons.length > 1, 'the pill offers more than just "Log"', pill ? JSON.stringify(pill.buttons) : '');
  check(!!pill && pill.buttons.some(b => /not now/i.test(b)), 'there is a dismiss that is not "log a dose you did not give"', pill ? JSON.stringify(pill.buttons) : '');

  await resetSpy(page);
  const dismissed = await tapText(page, '.alert-pill button', 'Not now');
  check(dismissed, 'tapped the dismiss');
  await sleep(700);
  check(await page.evaluate(() => !document.querySelector('.alert-pill')), 'the alert is gone');
  const eventsAfter = await page.evaluate(() => state.events.filter(e => e.type === 'medicine').length);
  check(eventsAfter === 1, 'dismissing did NOT fabricate a dose record', `(medicine events: ${eventsAfter})`);
  await page.evaluate(() => render());
  await sleep(400);
  check(await page.evaluate(() => !document.querySelector('.alert-pill')), 'it stays gone across a re-render');
  await sleep(WATCH_TICKS * 1000 + 400);
  s = await spy(page);
  check(s.alerts.length === 0, `it stays gone across ${WATCH_TICKS} more ticks`, `(alerts: ${s.alerts.length})`);

  // ---- 5. THE GLOBAL OFF SWITCH IS REACHABLE ---------------------------------------------------
  console.log('\n5. a global off switch the parent can actually reach');
  const offSwitch = await page.evaluate(() => {
    if (typeof openReminders !== 'function') return 'no openReminders';
    openReminders();
    var sh = document.querySelector('.sheet');
    if (!sh) return 'no sheet';
    var txt = (sh.textContent || '').replace(/\s+/g, ' ');
    var offBtn = [].slice.call(sh.querySelectorAll('button')).filter(b => (b.textContent || '').trim() === 'Off');
    return { mentionsDoseAlerts: /[Dd]ose alerts/.test(txt), offButtons: offBtn.length };
  });
  check(offSwitch && offSwitch.offButtons > 0, 'Settings > Reminders offers an Off control', JSON.stringify(offSwitch));
  check(offSwitch && offSwitch.mentionsDoseAlerts, 'and it names the in-app dose alerts', '');

  // ---- harness integrity, re-checked at the end ------------------------------------------------
  const stillSpied = await page.evaluate(() => /__spy/.test(String(window.toast)) && /__spy/.test(String(window.cubbyHaptic)));
  check(stillSpied, 'spies survived the whole run (nothing silently replaced them)');

  await browser.close();
  console.log('\nuncaught page errors:', errs.length); errs.slice(0, 6).forEach(e => console.log('  ✕', e));
  if (errs.length) fails.push(errs.length + ' uncaught page errors');
  note.forEach(n => console.log('note:', n));
  console.log(fails.length ? `\nMEDALARM: FAIL ❌  (${fails.length})\n  - ` + fails.join('\n  - ') : '\nMEDALARM: PASS ✅');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('runner error:', e.message); process.exit(2); });
