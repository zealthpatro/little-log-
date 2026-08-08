/* MEDICINE ALARM GATE — the P0 that must never ship twice.
 *
 * The founder's report, verbatim: "i added a medicine and i said every x hours it started. haptic
 * alarm that i couldnt dismiss is that expected it is is horrible". A schedule bug made a fresh
 * medicine permanently overdue, checkMedReminders runs on a 1s interval, and every toast fired a
 * Taptic tap on the wrapper. One line of arithmetic became an alarm beside a sleeping baby with no
 * off switch. No unit test could have caught it, because nothing wrong happens until real time
 * passes inside the real add flow.
 *
 * So this drives the ACTUAL UI (tap Add a medicine, type, tap Every few hours, tap Add medicine, tap
 * Dose), moves the clock by moving the data, and then watches the real 1s tick. It FAILS if a
 * single due event produces more than one alert, or if the parent has no one-tap way out.
 *
 * SECOND EDITION, after the founder read the fix: "having haptic is not the problem the problem is
 * we should be able to dismiss or snooze no?". The first fix stopped the storm by making every
 * automated alert silent on the haptic channel, which quietly broke the one job a medicine reminder
 * has: a dose alert at 3am has to be felt. So the gate now pins BOTH ends of the range. Zero haptics
 * on a due dose is a failure here, exactly like sixty of them:
 *
 *   - a never-dosed schedule        -> 0 alerts, 0 haptics   (the storm)
 *   - one genuine due event         -> 1 alert,  1 haptic    (the over-correction)
 *   - a snooze, before its window   -> 0 alerts, 0 haptics
 *   - a snooze, after its window    -> 1 alert,  1 haptic, once, and it survives a reload
 *   - a dismissal                   -> 0 alerts, forever
 *   - either way out                -> 0 dose records invented
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
const SNOOZE_MS = 8000;          // the real 15 min, shrunk through the app's own MED_SNOOZE_MS knob
const RELOAD_SNOOZE_MS = 16000;  // long enough that a page reload fits inside the window with room
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
  window.__spy = { toasts: [], alerts: [], haptics: 0, kinds: [], installedAt: Date.now() };
  var realToast = window.toast, realHaptic = window.cubbyHaptic;
  window.__spy.hadHaptic = typeof realHaptic === 'function';
  window.toast = function (msg, opts) {
    window.__spy.toasts.push(String(msg));
    if (String(msg).indexOf('⏰') === 0) window.__spy.alerts.push(String(msg));
    return realToast.apply(this, arguments);
  };
  window.cubbyHaptic = function (kind) {
    window.__spy.haptics++;
    window.__spy.kinds.push(String(kind));
    if (typeof realHaptic === 'function') return realHaptic.apply(this, arguments);
  };
  return true;
};

async function spy(page) { return page.evaluate(() => window.__spy); }
async function resetSpy(page) { await page.evaluate(() => { window.__spy.toasts = []; window.__spy.alerts = []; window.__spy.haptics = 0; window.__spy.kinds = []; }); }

/* The 60s storm floor in checkMedReminders is a BACKSTOP, not the guard any of the snooze
 * assertions are about, and leaving it armed would mask a snooze that re-fires every tick down to a
 * tidy-looking one alert a minute — the exact shape of bug this file exists to catch. Clearing it
 * removes the safety net so only the real guard (the ledger) is holding the line. Sections 1-3 never
 * touch it, so the storm assertions still run against both layers. */
async function clearStormFloor(page) { await page.evaluate(() => { window._medAlertFloorAt = 0; }); }

// The alert pill's actions, as a thumb would read them: label + the class that shapes them.
async function pillActions(page) {
  return page.evaluate(() => {
    var p = document.querySelector('.alert-pill');
    if (!p) return null;
    return {
      text: (p.textContent || '').replace(/\s+/g, ' ').trim(),
      buttons: [].slice.call(p.querySelectorAll('button')).map(b => ({
        label: (b.textContent || '').trim(), cls: b.className || ''
      }))
    };
  });
}
async function medEventCount(page) { return page.evaluate(() => state.events.filter(e => e.type === 'medicine').length); }
// The persisted snooze, read back the way a cold boot reads it: out of localStorage, not memory.
async function storedSnooze(page) {
  return page.evaluate(() => {
    var k = 'cubby-med-alerts:' + myUid(), raw = {};
    try { raw = JSON.parse(localStorage.getItem(k) || '{}'); } catch (e) { raw = {}; }
    var rows = Object.keys(raw).map(function (id) { return { id: id, s: raw[id].s || 0, a: raw[id].a || 0, d: raw[id].d || 0 }; });
    return { rows: rows, aheadOfNow: rows.filter(function (r) { return r.s > Date.now(); }).length };
  });
}

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
  /* Health no longer opens on Medicine for a family with no medicines: with an empty list it opens
     on Vaccines, because the country-correct schedule is the one thing worth showing at minute two.
     So the tab has to be chosen explicitly here. Choosing it is also the truer test: it exercises
     setHealthTab, which is the path a real parent takes to reach this screen. */
  await page.evaluate(() => { go('health'); setHealthTab('meds'); });
  await sleep(500);
  check(await tapText(page, '.add-row', 'Add a medicine'), 'tapped "Add a medicine"');
  await sleep(450);
  await page.type('#mName', 'Calpol');
  await page.type('#mDose', '2.5');
  check(await tapText(page, '.unit-toggle button', 'Every few hours'), 'tapped "Every few hours"');
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
  const backdated = await page.evaluate(async h => {
    var e = state.events.filter(x => x.type === 'medicine')[0];
    if (!e) return false;
    e.time -= (h + 1) * 3600000;               // moving the data is the only way to move this clock
    // Written to the local store, not just rendered: section 6 reloads the page and the medicine has
    // to still be overdue on the other side, or that whole section passes for the wrong reason.
    // Store.save and NOT persist(): store-firebase.js swaps persist() for a Firestore-only push
    // (store-firebase.js:1675), so in this offline harness persist() durably writes nothing.
    await Store.save(state);
    render();
    return typeof medNextDue === 'function' ? medNextDue(state.meds[0]) <= Date.now() : true;
  }, HOURS);
  check(backdated, 'the medicine is now genuinely overdue');

  await resetSpy(page);
  await sleep(WATCH_TICKS * 1000 + 400);
  s = await spy(page);
  check(s.alerts.length === 1, 'ONE due event raises exactly ONE alert', `(alerts: ${s.alerts.length} over ${WATCH_TICKS} ticks)`);
  // Both ends. A dose alert nobody can feel fails the one job it has, and this is the assertion that
  // would have caught the over-correction: the storm fix had left this at 0.
  check(s.haptics === 1, 'and it is FELT exactly once, not zero and not twice', `(haptics: ${s.haptics})`);
  check(s.kinds.length === 1 && (s.kinds[0] === 'medium' || s.kinds[0] === 'light'),
    'the dose buzz is firmer than a tap, and never an emergency siren', `(kinds: ${JSON.stringify(s.kinds)})`);
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

  // ---- 4. THE PARENT HAS TWO WAYS OUT, AND THEY ARE DIFFERENT PROMISES ------------------------
  console.log('\n4. the pill offers a snooze AND a dismiss, and they do not look the same');
  await page.evaluate(() => { go('home'); });
  await sleep(600);
  const pill = await pillActions(page);
  const labels = pill ? pill.buttons.map(b => b.label) : [];
  check(!!pill, 'the overdue dose shows an alert pill on home', pill ? '' : '(no pill)');
  check(labels.length > 1, 'the pill offers more than just "Log"', JSON.stringify(labels));
  check(labels.some(b => /not now/i.test(b)), 'there is a dismiss that is not "log a dose you did not give"', JSON.stringify(labels));
  // The founder's actual ask: "we should be able to dismiss or snooze no?"
  const snoozeBtn = (pill ? pill.buttons : []).filter(b => /\b15\b|snooze/i.test(b.label))[0];
  const dismissBtn = (pill ? pill.buttons : []).filter(b => /not now/i.test(b.label))[0];
  check(!!snoozeBtn, 'there is a SNOOZE, and it says how long', JSON.stringify(labels));
  check(!!snoozeBtn && !!dismissBtn && snoozeBtn.cls !== dismissBtn.cls,
    'snooze and dismiss are visibly different, not two identical grey words',
    snoozeBtn && dismissBtn ? `(${snoozeBtn.cls} vs ${dismissBtn.cls})` : '');

  // ---- 5. SNOOZE: silent inside its window, exactly one alert when it ends --------------------
  console.log(`\n5. snooze (shrunk to ${SNOOZE_MS / 1000}s): quiet before, exactly one alert after`);
  await page.evaluate(ms => { window.MED_SNOOZE_MS = ms; }, SNOOZE_MS);
  await resetSpy(page);
  check(await tapText(page, '.alert-pill button', snoozeBtn ? snoozeBtn.label : 'In 15 min'), 'tapped the snooze');
  await sleep(700);
  check(await page.evaluate(() => !document.querySelector('.alert-pill')), 'the alert steps aside');
  let ev = await medEventCount(page);
  check(ev === 1, 'snoozing did NOT fabricate a dose record', `(medicine events: ${ev})`);
  let led = await storedSnooze(page);
  check(led.aheadOfNow === 1, 'the snooze is written down, with a time to come back at', JSON.stringify(led.rows));

  await clearStormFloor(page);
  await sleep(SNOOZE_MS - 3500);                    // still inside the window
  s = await spy(page);
  check(s.alerts.length === 0 && s.haptics === 0, 'nothing fires BEFORE the snooze window ends',
    `(alerts: ${s.alerts.length}, haptics: ${s.haptics})`);

  await sleep(3500 + WATCH_TICKS * 1000 + 400);      // past the window, then keep watching
  s = await spy(page);
  check(s.alerts.length === 1, 'the snooze re-alerts EXACTLY ONCE when it ends', `(alerts: ${s.alerts.length})`);
  check(s.haptics === 1, 'and that one is felt, once', `(haptics: ${s.haptics})`);
  check(await page.evaluate(() => !!document.querySelector('.alert-pill')), 'and the pill comes back on its own, with no tap to prompt it');
  ev = await medEventCount(page);
  check(ev === 1, 'a snooze that ran out still invented no dose', `(medicine events: ${ev})`);
  if (s.alerts.length > 1) note.push(`snooze re-fire ≈ ${(s.alerts.length / WATCH_TICKS).toFixed(2)} alerts/sec`);

  // ---- 6. A SNOOZE SURVIVES A RELOAD ----------------------------------------------------------
  // The ledger is the only thing standing between a reload and a fresh alarm, so this closes the
  // loop the sync-wipe section opened from the other side: killing the tab must not reset the
  // parent's answer, and must not turn "come back in a bit" into "never speak again" either.
  console.log(`\n6. snooze again (${RELOAD_SNOOZE_MS / 1000}s), then reload the app mid-window`);
  await page.evaluate(ms => { window.MED_SNOOZE_MS = ms; }, RELOAD_SNOOZE_MS);
  const snoozedAt = Date.now();
  check(await tapText(page, '.alert-pill button', snoozeBtn ? snoozeBtn.label : 'In 15 min'), 'tapped the snooze again');
  await sleep(500);
  check(await page.evaluate(() => !document.querySelector('.alert-pill')), 'the alert steps aside again');

  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1600);
  await page.evaluate(INSTALL_SPY);
  await clearStormFloor(page);
  check(/__spy/.test(await page.evaluate(() => String(window.toast))), 'spy re-installed after the reload');
  const afterReload = await page.evaluate(() => ({
    stillOverdue: typeof medNextDue === 'function' && state.meds[0] ? medNextDue(state.meds[0]) <= Date.now() : false,
    pill: !!document.querySelector('.alert-pill'),
    view: typeof view !== 'undefined' ? view : '?'
  }));
  // Without this the next two checks would pass for the wrong reason (nothing due, so nothing shown).
  check(afterReload.stillOverdue, 'the medicine is STILL overdue after the reload (the test is not vacuous)');
  check(afterReload.view === 'home', 'the reloaded app is on home, where the pill lives', `(view: ${afterReload.view})`);
  check(!afterReload.pill, 'a fresh boot does NOT re-raise the alert the parent snoozed');
  led = await storedSnooze(page);
  check(led.aheadOfNow === 1, 'the snooze read back out of storage, not memory', JSON.stringify(led.rows));

  await resetSpy(page);
  await sleep(Math.max(1000, snoozedAt + RELOAD_SNOOZE_MS - Date.now() - 2500));
  s = await spy(page);
  check(s.alerts.length === 0 && s.haptics === 0, 'the reloaded app stays quiet for the rest of the window',
    `(alerts: ${s.alerts.length}, haptics: ${s.haptics})`);
  await sleep(2500 + WATCH_TICKS * 1000 + 400);
  s = await spy(page);
  check(s.alerts.length === 1, 'and it still comes back exactly once when the window ends', `(alerts: ${s.alerts.length})`);
  check(s.haptics === 1, 'felt once, across a reload', `(haptics: ${s.haptics})`);

  // ---- 7. THE PARENT CAN STOP IT IN ONE TAP, AND IT STAYS STOPPED -----------------------------
  console.log('\n7. one tap to stop it, and it stays stopped');
  check(await page.evaluate(() => !!document.querySelector('.alert-pill')), 'the pill is back and dismissable');
  await resetSpy(page);
  const dismissed = await tapText(page, '.alert-pill button', 'Not now');
  check(dismissed, 'tapped the dismiss');
  await sleep(700);
  check(await page.evaluate(() => !document.querySelector('.alert-pill')), 'the alert is gone');
  const eventsAfter = await medEventCount(page);
  check(eventsAfter === 1, 'dismissing did NOT fabricate a dose record', `(medicine events: ${eventsAfter})`);
  await page.evaluate(() => render());
  await sleep(400);
  check(await page.evaluate(() => !document.querySelector('.alert-pill')), 'it stays gone across a re-render');
  await clearStormFloor(page);
  await sleep(WATCH_TICKS * 1000 + 400);
  s = await spy(page);
  check(s.alerts.length === 0, `it stays gone across ${WATCH_TICKS} more ticks`, `(alerts: ${s.alerts.length})`);
  check(s.haptics === 0, 'and a dismissed dose is never felt again', `(haptics: ${s.haptics})`);
  led = await storedSnooze(page);
  check(led.rows.some(r => r.d > 0), 'the dismissal is written down too, so a reload cannot undo it', JSON.stringify(led.rows));

  // ---- 8. QUIET HOURS SOFTEN THE DOSE ALERT, THEY NEVER SILENCE IT ----------------------------
  // A pure function, so this costs no wall-clock time. Both branches are pinned against the CURRENT
  // hour, so the result does not depend on when the gate happens to run.
  console.log('\n8. quiet hours soften the buzz, they do not swallow the reminder');
  const quiet = await page.evaluate(() => {
    if (typeof medAlertHaptic !== 'function') return { missing: true };
    var h = new Date().getHours(), before = state.settings.push;
    state.settings.push = { enabled: false, quietStart: h, quietEnd: (h + 1) % 24 };
    var inside = medAlertHaptic();
    state.settings.push = { enabled: false, quietStart: (h + 2) % 24, quietEnd: (h + 3) % 24 };
    var outside = medAlertHaptic();
    state.settings.push = before;
    return { inside: inside, outside: outside };
  });
  check(quiet.inside === 'light', 'inside quiet hours the dose alert softens', `(got ${quiet.inside})`);
  check(quiet.outside === 'medium', 'outside them it is firmer than an ordinary tap', `(got ${quiet.outside})`);
  check(quiet.inside !== 'heavy' && quiet.outside !== 'heavy', 'and it is never an emergency siren');

  // ---- 9. THE GLOBAL OFF SWITCH IS REACHABLE ---------------------------------------------------
  console.log('\n9. a global off switch the parent can actually reach');
  const offSwitch = await page.evaluate(() => {
    if (typeof openReminders !== 'function') return 'no openReminders';
    openReminders();
    var sh = document.querySelector('.sheet');
    if (!sh) return 'no sheet';
    var txt = (sh.textContent || '').replace(/\s+/g, ' ');
    var offBtn = [].slice.call(sh.querySelectorAll('button')).filter(b => (b.textContent || '').trim() === 'Off');
    return {
      mentionsDoseAlerts: /[Dd]ose alerts/.test(txt), offButtons: offBtn.length,
      // Truthful-copy gate: this sheet promised a snoozeable reminder for months while the app had
      // no snooze in it at all. Now that it does, the sheet has to say so, and keep saying so.
      describesSnooze: /15 min/i.test(txt), describesDismiss: /[Nn]ot now/.test(txt),
      noEmDash: txt.indexOf('—') < 0
    };
  });
  check(offSwitch && offSwitch.offButtons > 0, 'Settings > Reminders offers an Off control', JSON.stringify(offSwitch));
  check(offSwitch && offSwitch.mentionsDoseAlerts, 'and it names the in-app dose alerts', '');
  check(offSwitch && offSwitch.describesSnooze && offSwitch.describesDismiss,
    'and the copy describes BOTH ways out, so it is not promising something the code cannot do', JSON.stringify(offSwitch));
  check(offSwitch && offSwitch.noEmDash, 'reminders copy carries no em-dashes (house voice)');

  // ---- 10. A MISSED DOSE ON THE "SET TIMES" SCHEDULE STAYS VISIBLE ----------------------------
  /* This gate had ZERO daily coverage (`grep -c daily tools/medalarm_test.js` returned 0), and the
     hole was exactly the shape of the bug it missed. medNextDue only ever returned a fixed time
     still ahead, or less than 60 seconds behind. Sixty-one seconds after 8am the dose was not late,
     it was gone, and the row said cheerfully that the next one was tonight. "Set times" is what a
     parent picks for an antibiotic course, so the schedule most likely to be safety-critical was
     the one that forgot.

     Everything below is pinned to '00:00' and '23:59' rather than to offsets from the current
     clock, so it reads identically whether the gate runs at 9am or 11pm. */
  console.log('\n10. a missed dose on "Set times" reads as overdue, it does not roll to tomorrow');
  const clockRoom = await page.evaluate(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); });
  check(clockRoom >= 2 && clockRoom <= 1437, 'the clock leaves room for a passed slot and a future one',
    `(minutes past midnight: ${clockRoom}; this gate is blind only between 00:00-00:01 and 23:58-23:59)`);

  const daily = await page.evaluate(() => {
    const DAY = 86400000;
    function slot(hhmm) { const p = hhmm.split(':').map(Number); const d = new Date(); d.setHours(p[0], p[1], 0, 0); return d.getTime(); }
    function mk(times, createdAt, doseAt) {
      const m = { id: 'dtest', babyId: state.activeBabyId, name: 'Amoxicillin', dose: '5', unit: 'ml',
        pattern: { type: 'daily', times: times.slice() }, remind: true, active: true, createdAt: createdAt };
      state.meds = (state.meds || []).filter(x => x.id !== 'dtest').concat([m]);
      state.events = (state.events || []).filter(e => e.medId !== 'dtest');
      if (doseAt) state.events.unshift({ id: 'ev-dtest', type: 'medicine', medId: 'dtest', babyId: state.activeBabyId, time: doseAt });
      return m;
    }
    const out = { slot0: slot('00:00'), slot1: slot('00:01'), slotEnd: slot('23:59') };
    const yesterday = Date.now() - DAY;

    // (a) due at 00:00, never given, on a medicine that already existed when the slot passed
    out.missed = medNextDue(mk(['00:00', '23:59'], yesterday, null));
    out.missedText = typeof fmtDue === 'function' ? fmtDue(out.missed - Date.now()) : '(no fmtDue)';
    // (b) the same medicine once the dose IS logged: it moves on to tonight
    out.afterDose = medNextDue(mk(['00:00', '23:59'], yesterday, out.slot0 + 300000));
    // (c) a medicine ADDED after the slot passed must never open on a retro-nag
    out.freshlyAdded = medNextDue(mk(['00:00', '23:59'], Date.now(), null));
    // (d) two passed slots: the newer supersedes the older, so one miss cannot nag all day
    out.superseded = medNextDue(mk(['00:00', '00:01'], yesterday, null));

    state.meds = (state.meds || []).filter(x => x.id !== 'dtest');
    state.events = (state.events || []).filter(e => e.medId !== 'dtest');
    return out;
  });

  const rolled = daily.missed === daily.slotEnd;
  check(daily.missed === daily.slot0, 'a missed dose is still the dose that is due',
    rolled ? '(it silently rolled forward to tonight — the exact regression)' : `(due ${new Date(daily.missed).toTimeString().slice(0, 5)})`);
  check(/^overdue/.test(String(daily.missedText)), 'and the parent reads it as overdue, not as a countdown',
    `(row says "${daily.missedText}")`);
  check(daily.afterDose === daily.slotEnd, 'once the dose is logged it moves on to the next time');
  check(daily.freshlyAdded === daily.slotEnd, 'a medicine added after the slot never opens on a retro-nag');
  check(daily.superseded === daily.slot1, 'a newer missed slot supersedes an older one, so one miss cannot nag all day');

  // ---- 11. THE DOUBLE-DOSE QUESTION ------------------------------------------------------------
  /* "Did someone already give her the Calpol?" is the most frightening recurring question in this
     domain, and the row answered a different one: it said when the NEXT dose was due and never once
     said when the last was given, or by whom. Tapping Dose wrote instantly, so two caregivers and
     one baby is all it took. The guard is one fact and one question, never a warning, and it uses
     the interval the PARENT's own schedule implies — "as needed" has none, so it is never asked. */
  console.log('\n11. a second dose inside the schedule asks one question, made of facts');
  const dbl = await page.evaluate(async () => {
    const HOUR = 3600000;
    function mk(pattern, id) {
      const m = { id: id, babyId: state.activeBabyId, name: 'Calpol', dose: '2.5', unit: 'ml',
        pattern: pattern, remind: true, active: true, createdAt: Date.now() - 48 * HOUR };
      state.meds = (state.meds || []).filter(x => x.id !== id).concat([m]);
      return m;
    }
    function dosedAgo(medId, ms, author) {
      state.events = [{ id: 'ev_' + medId, babyId: state.activeBabyId, type: 'medicine', medId: medId,
        medName: 'Calpol', time: Date.now() - ms, authorId: author || null }].concat(state.events || []);
    }
    const out = {};
    out.interval6h = medIntervalMs({ pattern: { type: 'everyX', hours: 6 } });
    out.intervalDaily = medIntervalMs({ pattern: { type: 'daily', times: ['08:00', '12:00', '20:00'] } });
    out.intervalAsNeeded = medIntervalMs({ pattern: { type: 'asNeeded' } });

    // the row now states the fact
    const m1 = mk({ type: 'everyX', hours: 6 }, 'dbl1');
    out.lineWhenNever = lastDoseLine(m1);
    dosedAgo('dbl1', 1 * HOUR);
    out.lineAfterDose = lastDoseLine(m1);
    out.rowShowsIt = /Last dose/.test(renderHomeMeds());

    // inside the interval -> one question, and nothing is written until it is answered
    const before = (state.events || []).length;
    logDose('dbl1');
    await new Promise(r => setTimeout(r, 250));
    out.askedInside = !!document.querySelector('#sheet.show');
    out.sheetText = (document.querySelector('#sheet.show') || {}).innerText || '';
    out.wroteBeforeAnswer = (state.events || []).length !== before;
    if (typeof closeSheet === 'function') closeSheet();
    await new Promise(r => setTimeout(r, 200));

    // outside the interval -> no question at all
    state.events = (state.events || []).filter(e => e.medId !== 'dbl1');
    dosedAgo('dbl1', 7 * HOUR);
    const before2 = (state.events || []).length;
    logDose('dbl1');
    await new Promise(r => setTimeout(r, 250));
    out.askedOutside = !!document.querySelector('#sheet.show');
    out.wroteOutside = (state.events || []).length > before2;
    if (typeof closeSheet === 'function') closeSheet();

    // "as needed" has no interval we could honestly claim, so it is never asked
    mk({ type: 'asNeeded' }, 'dbl2');
    dosedAgo('dbl2', 10 * 60000);
    logDose('dbl2');
    await new Promise(r => setTimeout(r, 250));
    out.askedAsNeeded = !!document.querySelector('#sheet.show');
    if (typeof closeSheet === 'function') closeSheet();

    state.meds = (state.meds || []).filter(x => x.id !== 'dbl1' && x.id !== 'dbl2');
    state.events = (state.events || []).filter(e => e.medId !== 'dbl1' && e.medId !== 'dbl2');
    return out;
  });

  check(dbl.interval6h === 6 * 3600000, 'an "every 6h" schedule implies a 6h interval', String(dbl.interval6h));
  check(dbl.intervalDaily === 4 * 3600000, 'set times imply the SMALLEST gap between them, not the average',
    `(08:00/12:00/20:00 -> ${dbl.intervalDaily / 3600000}h)`);
  check(dbl.intervalAsNeeded === 0, '"as needed" implies no interval, so no timing is ever invented');
  check(dbl.lineWhenNever === '', 'a never-dosed medicine claims no last dose');
  check(/^Last dose /.test(dbl.lineAfterDose), 'once dosed, the row says when', dbl.lineAfterDose);
  check(dbl.rowShowsIt, 'and that line is actually rendered on the medicine card');
  check(dbl.askedInside, 'a second dose inside the interval asks first');
  check(!dbl.wroteBeforeAnswer, 'and writes nothing until the question is answered');
  check(!/sure|already gave|careful|warning/i.test(dbl.sheetText),
    'the question is facts, not a telling-off', JSON.stringify(dbl.sheetText.slice(0, 90)));
  check(!dbl.askedOutside && dbl.wroteOutside, 'outside the interval it just logs, no question');
  check(!dbl.askedAsNeeded, 'an "as needed" medicine is never questioned');

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
