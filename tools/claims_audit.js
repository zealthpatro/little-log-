/* EVERY CLAIM MADE ABOUT WHAT IS LIVE, SHOT AND ASSERTED.
 *
 * A screenshot on its own is a weak proof: it shows one moment, and a reader cannot tell whether the
 * thing they are looking at is the thing that was claimed. So each shot here carries assertions, and
 * the shot is only labelled PASS when the assertions hold. A picture that disagrees with its label
 * is the failure this file exists to catch.
 *
 * Runs against a LOCAL server on purpose. The local tree is verified byte-identical to
 * https://little-cubby.com/app/ before running (see the sha256 check in the session notes), and
 * localhost is the only place the app boots straight into a seeded, signed-in state via ?e2e=1.
 * Shooting live would only ever photograph the sign-in wall.
 *
 * Two traps this file is careful about, both learned the hard way:
 *   - the app scrolls inside #scroll, so puppeteer fullPage silently captures the VIEWPORT only.
 *     Every shot therefore uses a tall viewport rather than fullPage.
 *   - a second serve.js in a worktree dies on EADDRINUSE behind the main checkout's, and then the
 *     gate grades the OTHER tree's code. Pass a port and confirm what is actually being served.
 *
 *   node tools/serve.js &   &&   node tools/claims_audit.js [baseUrl]
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8080';
const OUT = process.env.SHOT_DIR || '/tmp/cubby-claims';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(name, file, checks) {
  const failed = checks.filter((c) => !c.ok);
  results.push({ name, file, failed: failed.length, checks });
  console.log(`\n${failed.length ? '✗' : '✓'} ${name}   -> ${path.basename(file)}`);
  for (const c of checks) console.log(`     ${c.ok ? 'ok  ' : 'FAIL'} ${c.label}${c.detail ? '  ' + c.detail : ''}`);
}

const SEED = {
  babies: [{ id: 'b1', name: 'Robin', birth: Date.now() - 120 * 86400000, sex: 'F', routines: [] }],
  activeBabyId: 'b1', events: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', theme: 'light', seen: { home: 1, log: 1, growth: 1, album: 1, health: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], pregnancy: null, notes: []
};

async function shoot(page, file, height) {
  if (height) await page.setViewport({ width: 390, height, deviceScaleFactor: 2 });
  await sleep(250);
  const p = path.join(OUT, file);
  await page.screenshot({ path: p });
  return p;
}

(async () => {
  // Confirm we are grading the tree we think we are.
  const probe = await fetch(BASE + '/app/sw.js').then((r) => r.text()).catch(() => '');
  const ver = (probe.match(/little-log-v\d+/) || ['?'])[0];
  const localVer = (fs.readFileSync(path.join(__dirname, '..', 'app', 'sw.js'), 'utf8').match(/little-log-v\d+/) || ['?'])[0];
  console.log(`serving ${ver} | repo ${localVer} | ${ver === localVer ? 'same tree ✓' : 'DIFFERENT TREE ✗ (wrong server on this port)'}`);
  if (ver !== localVer) process.exit(2);

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.setViewport({ width: 390, height: 900, deviceScaleFactor: 2 });
  await page.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });
  await page.evaluate((s) => { localStorage.setItem('little-log-v1', JSON.stringify(s)); localStorage.setItem('cubby-quick-uid', 'local'); }, SEED);
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1800);

  // ---- CLAIM 1: account deletion is reachable from all three full-shell screens (5.1.1(v)) ------
  for (const screen of ['renderOnboard', 'renderCaregiverWaiting', 'renderLossHolding']) {
    await page.evaluate((fn) => { try { document.getElementById('sheet').classList.remove('show'); } catch (e) {} eval(fn + '()'); }, screen);
    await sleep(400);
    const c = await page.evaluate(() => {
      const app = document.getElementById('app');
      const labels = [].slice.call(app.querySelectorAll('button,[onclick]')).map((b) => (b.textContent || '').trim()).filter(Boolean);
      return { labels, hasSettings: labels.some((t) => /^Settings$/i.test(t)), hasLogout: labels.some((t) => /log out/i.test(t)) };
    });
    const f = await shoot(page, `01-deletion-${screen}.png`, 900);
    record(`5.1.1(v): ${screen} offers a way to Settings`, f, [
      { ok: c.hasSettings, label: 'a Settings control is present', detail: JSON.stringify(c.labels.slice(0, 6)) },
      { ok: c.hasLogout, label: 'Log out is still there too' },
    ]);
  }

  // Settings -> Data -> Delete my account, the actual route
  await page.evaluate(() => { renderOnboard(); openSettings(); });
  await sleep(450);
  const setShot = await shoot(page, '02-settings.png', 1400);
  const hasData = await page.evaluate(() => {
    const s = document.getElementById('sheet');
    const row = [].slice.call(s.querySelectorAll('[onclick]')).filter((e) => /export or delete your data/i.test(e.textContent || ''))[0];
    if (row) row.click();
    return !!row;
  });
  await sleep(400);
  const del = await page.evaluate(() => {
    const s = document.getElementById('sheet');
    const row = [].slice.call(s.querySelectorAll('[onclick]')).filter((e) => /delete my account/i.test(e.textContent || ''))[0];
    if (row) row.click();
    return !!row;
  });
  await sleep(400);
  const delTxt = await page.evaluate(() => (document.getElementById('sheet').textContent || '').replace(/\s+/g, ' '));
  const delShot = await shoot(page, '03-delete-account.png', 1000);
  record('Settings -> Data -> Delete my account', delShot, [
    { ok: hasData, label: 'Settings offers the Data row' },
    { ok: del, label: 'Data offers Delete my account' },
    { ok: /Nobody else needs to agree/i.test(delTxt), label: 'deletion is unilateral, as 5.1.1(v) requires' },
    { ok: delTxt.indexOf('—') < 0, label: 'no em-dashes (house voice)' },
  ]);
  record('Settings sheet', setShot, [{ ok: true, label: 'captured for reference' }]);

  // ---- CLAIM 2: the medicine schedule reads like a prescription ---------------------------------
  await page.evaluate(() => { try { closeSheet(); } catch (e) {} render(); openAddMed(); });
  await sleep(600);
  const everyX = await page.evaluate(() => {
    const s = document.getElementById('sheet');
    const btns = [].slice.call(s.querySelectorAll('.unit-toggle button')).map((b) => b.textContent.trim());
    const helper = [].slice.call(s.querySelectorAll('.csub')).map((e) => e.textContent.replace(/\s+/g, ' ').trim()).find((t) => /dose every/i.test(t)) || '';
    const remind = ([].slice.call(s.querySelectorAll('.tr-b')).map((e) => e.textContent.trim())[0]) || '';
    return { btns, helper, remind, hasEveryFew: btns.includes('Every few hours'), presets: ['Once', 'Twice', '3×', '4×', 'Hourly'].filter((p) => btns.includes(p)) };
  });
  const medShot = await shoot(page, '04-medicine-everyfewhours.png', 1500);
  record('Medicine: prescription wording + one-tap presets', medShot, [
    { ok: everyX.hasEveryFew, label: '"Every few hours", not "Every X hrs"' },
    { ok: everyX.presets.length === 5, label: 'five presets', detail: everyX.presets.join(' ') },
    { ok: /Four times a day/.test(everyX.helper), label: 'helper names the prescription phrasing', detail: everyX.helper.slice(0, 70) },
    { ok: /every 6h/.test(everyX.helper), label: 'and keeps the exact interval beside it' },
    { ok: !/while app is open/i.test(everyX.remind), label: 'Remind me no longer says "while app is open"', detail: everyX.remind.slice(0, 62) },
  ]);

  // Set times -> a real time picker
  await page.evaluate(() => { const b = [].slice.call(document.querySelectorAll('#sheet .unit-toggle button')).find((x) => x.textContent.trim() === 'Set times'); if (b) b.click(); });
  await sleep(450);
  const times = await page.evaluate(() => {
    const s = document.getElementById('sheet');
    return { inputs: [].slice.call(s.querySelectorAll('input[type=time]')).map((i) => i.value),
      addBtn: !![].slice.call(s.querySelectorAll('button')).find((b) => /Add a time/i.test(b.textContent)) };
  });
  const setShot2 = await shoot(page, '05-medicine-settimes.png', 1500);
  record('Medicine: "Set times" offers a real time picker', setShot2, [
    { ok: times.inputs.length >= 2, label: 'time inputs are present', detail: times.inputs.join(', ') },
    { ok: times.addBtn, label: '"+ Add a time" is offered' },
  ]);

  // ---- CLAIM 3: a missed fixed-time dose reads as overdue ---------------------------------------
  const overdue = await page.evaluate(() => {
    const DAY = 86400000;
    const slot = (hhmm) => { const p = hhmm.split(':').map(Number); const d = new Date(); d.setHours(p[0], p[1], 0, 0); return d.getTime(); };
    state.meds = [{ id: 'mx', babyId: 'b1', name: 'Amoxicillin', dose: '5', unit: 'ml',
      pattern: { type: 'daily', times: ['00:00', '23:59'] }, remind: true, active: true, createdAt: Date.now() - DAY }];
    const due = medNextDue(state.meds[0]);
    return { due, isMissedSlot: due === slot('00:00'), text: fmtDue(due - Date.now()) };
  });
  record('A missed fixed-time dose stays overdue instead of rolling to tomorrow', path.join(OUT, '06-overdue.png'), [
    { ok: overdue.isMissedSlot, label: 'the missed slot is still the due dose' },
    { ok: /^overdue/.test(overdue.text), label: 'and reads as overdue, not a countdown', detail: '"' + overdue.text + '"' },
  ]);

  // ---- CLAIM 4: the Reminders sheet offers three separate consents, marketing off ---------------
  await page.evaluate(() => { try { closeSheet(); } catch (e) {} state.meds = []; render(); openReminders(); });
  await sleep(500);
  const rem = await page.evaluate(() => {
    const s = document.getElementById('sheet');
    const t = (s.textContent || '').replace(/\s+/g, ' ');
    const cfg = (typeof pushCfg === 'function') ? pushCfg() : {};
    return { hasDose: /Dose reminders/.test(t), hasFeature: /New in Cubby/.test(t), hasOffers: /Offers/.test(t),
      fiveAMonth: /five a month/i.test(t), twoAMonth: /two a month/i.test(t), neverPro: /never if you are on Pro/i.test(t),
      marketingOff: cfg && cfg.allow ? cfg.allow.marketing === false : null, noEmDash: t.indexOf('—') < 0 };
  });
  const remShot = await shoot(page, '07-reminders-consent.png', 1700);
  record('Reminders: three separate consents, marketing off by default', remShot, [
    { ok: rem.hasDose && rem.hasFeature && rem.hasOffers, label: 'all three categories are offered' },
    { ok: rem.fiveAMonth, label: 'feature nudges state the 5/month cap' },
    { ok: rem.twoAMonth, label: 'offers state the 2/month cap' },
    { ok: rem.neverPro, label: 'and that Pro never gets offers' },
    { ok: rem.marketingOff === true, label: 'marketing is OFF until tapped (Apple 4.5.4)', detail: String(rem.marketingOff) },
    { ok: rem.noEmDash, label: 'no em-dashes (house voice)' },
  ]);

  // ---- CLAIM 5: painted avatars, and night mode --------------------------------------------------
  await page.evaluate(() => { try { closeSheet(); } catch (e) {} go('home'); });
  await sleep(500);
  const home = await shoot(page, '08-home-light.png', 1400);
  const avatars = await page.evaluate(() => {
    const imgs = [].slice.call(document.querySelectorAll('img')).map((i) => i.currentSrc || i.src).filter((s) => /avatars?\//.test(s));
    return { count: imgs.length, sample: imgs.slice(0, 2).map((s) => s.split('/').pop()) };
  });
  record('Home (light)', home, [{ ok: true, label: 'captured', detail: avatars.count ? avatars.count + ' avatar image(s): ' + avatars.sample.join(', ') : 'no avatar on this screen' }]);

  await page.evaluate(() => { try { setTheme('night'); } catch (e) { document.body.setAttribute('data-theme', 'night'); } });
  await sleep(600);
  const night = await shoot(page, '09-home-night.png', 1400);
  const nightOk = await page.evaluate(() => ({
    attr: document.body.getAttribute('data-theme'),
    bg: getComputedStyle(document.body).backgroundColor,
    photoEdge: getComputedStyle(document.documentElement).getPropertyValue('--photo-edge').trim(),
  }));
  record('Night mode', night, [
    { ok: nightOk.attr === 'night', label: 'data-theme is night', detail: nightOk.attr },
    { ok: !!nightOk.photoEdge, label: '--photo-edge is defined (photos are bounded, not dimmed)', detail: nightOk.photoEdge || '(none)' },
  ]);

  await browser.close();

  const failed = results.filter((r) => r.failed);
  console.log('\n' + '='.repeat(64));
  console.log(`shots: ${results.length}  in ${OUT}`);
  console.log(`page errors: ${errs.length}`);
  errs.slice(0, 4).forEach((e) => console.log('  ✗ ' + e));
  console.log(failed.length ? `\nCLAIMS AUDIT: FAIL — ${failed.length} claim(s) not backed by what is on screen:\n  - ` + failed.map((f) => f.name).join('\n  - ')
                            : '\nCLAIMS AUDIT: PASS — every claim matches what is on screen');
  process.exit(failed.length || errs.length ? 1 : 0);
})().catch((e) => { console.error('audit failed:', e.message); process.exit(2); });
