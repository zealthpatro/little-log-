/* ACCOUNT DELETION MUST BE REACHABLE FROM EVERY SIGNED-IN SCREEN.
 *
 * App Store Guideline 5.1.1(v): an app that supports account creation must let the person delete
 * their account from inside the app. Not by email, not by asking someone else.
 *
 * Cubby has three screens that replace the WHOLE app shell, nav included:
 *   renderOnboard           - the stage picker, where a brand-new account lands
 *   renderCaregiverWaiting  - an invited caregiver whose family has nothing to show yet
 *   renderLossHolding       - a parent after a loss
 * All three shipped with exactly one control, "Log out". So the single most likely reviewer path
 * (make a fresh test account, look for delete) landed on the stage picker and found no way to
 * delete. That is a rejection, and for the caregiver it is worse than a rejection: her ability to
 * delete her own account depended on another person inviting her into a family with data in it.
 *
 * This gate walks the real DOM on each screen: find the control, tap it, tap through to the delete
 * sheet, and confirm the destructive button is really there. It fails if any screen loses the route.
 *
 *   node tools/serve.js &   &&   node tools/deletion_reachable_test.js [baseUrl]
 */
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8080';
const APP = BASE + '/app/?e2e=1';

const SEED = {
  babies: [], activeBabyId: null, events: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', theme: 'light', seen: {} },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], pregnancy: null, notes: []
};

const SCREENS = ['renderOnboard', 'renderCaregiverWaiting', 'renderLossHolding'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
function check(ok, label, detail) {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) fails.push(label + (detail ? ' ' + detail : ''));
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 850, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  await page.goto(APP, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.evaluate((s) => {
    localStorage.setItem('little-log-v1', JSON.stringify(s));
    localStorage.setItem('cubby-quick-uid', 'local');
  }, SEED);
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1600);

  console.log('\nharness');
  const boot = await page.evaluate(() => ({
    fns: ['renderOnboard', 'renderCaregiverWaiting', 'renderLossHolding', 'openSettings', 'openDeleteAccount']
      .filter((n) => { try { return typeof eval(n) === 'function'; } catch (e) { return false; } }),
    // #sheet must be a SIBLING of #app: these screens overwrite app().innerHTML, so a sheet host
    // living inside it would be destroyed and every Settings tap would silently do nothing.
    sheetOutsideApp: !!(document.getElementById('sheet') && !document.getElementById('app').contains(document.getElementById('sheet'))),
  }));
  check(boot.fns.length === 5, 'all five functions exist', boot.fns.join(','));
  check(boot.sheetOutsideApp, 'the sheet host survives a full-shell repaint (#sheet is not inside #app)');

  for (const screen of SCREENS) {
    console.log(`\n${screen}`);
    const painted = await page.evaluate((fn) => {
      try { document.getElementById('sheet').classList.remove('show'); } catch (e) {}
      // eslint-disable-next-line no-eval
      eval(fn + '()');
      const app = document.getElementById('app');
      const btns = [].slice.call(app.querySelectorAll('button,a[href],[onclick]'))
        .map((b) => (b.textContent || '').trim()).filter(Boolean);
      return { controls: btns };
    }, screen);
    check(painted.controls.length > 0, 'the screen paints controls', JSON.stringify(painted.controls));

    // 1. A route off this screen that is not just "Log out".
    const hasSettings = await page.evaluate(() => {
      const app = document.getElementById('app');
      const el = [].slice.call(app.querySelectorAll('button,[onclick]'))
        .filter((b) => /settings/i.test(b.textContent || ''))[0];
      if (!el) return false;
      el.click(); return true;
    });
    check(hasSettings, 'offers a Settings control, not only Log out');
    await sleep(350);

    // 2. Settings really opened, over a screen that replaced the shell.
    const sheetOpen = await page.evaluate(() => {
      const s = document.getElementById('sheet');
      return { shown: s.classList.contains('show'), text: (s.textContent || '').replace(/\s+/g, ' ').slice(0, 120) };
    });
    check(sheetOpen.shown, 'Settings actually opens here', JSON.stringify(sheetOpen.text.slice(0, 60)));

    // 3. Settings -> Data. The delete row does not sit on the Settings sheet itself; it lives one
    //    hop down, behind "Data / Export or delete your data". Walk the real route a person walks.
    const reachedData = await page.evaluate(() => {
      const s = document.getElementById('sheet');
      const row = [].slice.call(s.querySelectorAll('[onclick]'))
        .filter((e) => /export or delete your data/i.test(e.textContent || ''))[0];
      if (!row) return false;
      row.click(); return true;
    });
    check(reachedData, 'Settings offers the Data row that leads to deletion');
    await sleep(350);

    // 4. ...and "Delete my account" is on it.
    const reachedDelete = await page.evaluate(() => {
      const s = document.getElementById('sheet');
      const row = [].slice.call(s.querySelectorAll('[onclick]'))
        .filter((e) => /delete my account/i.test(e.textContent || ''))[0];
      if (!row) return { found: false };
      row.click();
      return { found: true };
    });
    check(reachedDelete.found, 'Data offers "Delete my account"');
    await sleep(350);

    const canConfirm = await page.evaluate(() => {
      const s = document.getElementById('sheet');
      const txt = (s.textContent || '').replace(/\s+/g, ' ');
      const btn = [].slice.call(s.querySelectorAll('button'))
        .filter((b) => /delete my account/i.test(b.textContent || ''))[0];
      return {
        unilateral: /Nobody else needs to agree/i.test(txt),
        hasConfirmButton: !!btn,
        noEmDash: txt.indexOf('—') < 0,
      };
    });
    check(canConfirm.hasConfirmButton, 'and the delete sheet carries a real confirm button');
    check(canConfirm.unilateral, 'and it says deletion is theirs alone to do (5.1.1(v) is not a group decision)');
    check(canConfirm.noEmDash, 'deletion copy carries no em-dashes (house voice)');

    await page.evaluate(() => { try { closeSheet(); } catch (e) {} });
    await sleep(200);
  }

  await browser.close();
  console.log('\nuncaught page errors:', errs.length);
  errs.slice(0, 6).forEach((e) => console.log('  ✗', e));
  if (errs.length) fails.push(errs.length + ' uncaught page errors');
  console.log(fails.length ? `\nDELETION-REACHABLE: FAIL ❌  (${fails.length})\n  - ` + fails.join('\n  - ')
                           : '\nDELETION-REACHABLE: PASS ✅');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('runner error:', e.message); process.exit(2); });
