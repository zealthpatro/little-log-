/* Quiet hours, chosen by the parent (founder, 27 Nov 2026).
 *
 * "Quiet hours are controlled by parents. Give a caution saying that during quiet hours we will not trouble
 * you with notifications and stuff, so they know they might be missing out, and we will remind you only on
 * medications." Then: "parents should be able to check what they need."
 *
 *   A. Reminders shows the setting, the hours, what may still reach her, and the caution
 *   B. the push queue: a dose in quiet hours comes through by default, and not once she turns that off
 *   C. Home in her quiet hours: no suggestion card, live state still shows; off means the clock moves nothing
 *   D. the hours and On/Off are hers to change, and Off then On brings her hours back
 *
 *   node test/quiet-hours.test.js [<base url of this tree's server>]
 * Fictional baby (Bo). Seen red on the previous commit (7058d033).
 */
'use strict';
const puppeteer = require('puppeteer-core');
const { downloadBehavior } = require('../tools/gate_downloads.js');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8080';
const DAY = 86400000, H = 3600000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function pin(shift) {
  const R = Date;
  function D(...a) { return a.length === 0 ? new R(R.now() + shift) : new R(...a); }
  D.prototype = R.prototype; D.now = () => R.now() + shift; D.parse = R.parse; D.UTC = R.UTC;
  window.Date = D;
}
const offsetTo = (hour) => { const d = new Date(); d.setHours(hour, 10, 0, 0); return d.getTime() - Date.now(); };
const seed = (now, push) => {
  const hhmm = (t) => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  return {
    babies: [{ id: 'b1', name: 'Bo', birth: now - 6 * DAY, sex: 'M', routines: [], allergies: [], country: 'us' }],
    activeBabyId: 'b1',
    events: [{ id: 'f1', type: 'feed', babyId: 'b1', time: now - 1 * H, method: 'bottle', amount: 90, unit: 'ml', authorId: 'local' }],
    settings: Object.assign({ unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', country: 'us' }, push ? { push } : {}),
    meds: [{ id: 'm1', babyId: 'b1', name: 'Vitamin D drops', dose: '1', unit: 'drop', pattern: { type: 'daily', times: [hhmm(now - 30 * 60000)] }, remind: true, active: true, createdAt: now - 5 * DAY }],
    timers: {}, milestones: [], photos: [], vaccines: {}, illnesses: [], notes: [], pregnancy: null,
  };
};

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'], downloadBehavior: downloadBehavior() });
  const errs = [];
  const open = async (hour, push) => {
    const p = await b.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await p.evaluateOnNewDocument(pin, offsetTo(hour));
    await p.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 60000 });
    const now = await p.evaluate(() => Date.now());
    await p.evaluate((s) => {
      localStorage.clear(); localStorage.setItem('little-log-v1', JSON.stringify(s)); localStorage.setItem('cubby-quick-uid', 'local');
      localStorage.setItem('cubby-seen-local', JSON.stringify({ tip_getstarted: 1, tip_logguide: 1 }));
    }, seed(now, push));
    await p.reload({ waitUntil: 'networkidle2' }); await sleep(1200);
    await p.evaluate(() => { window.LL = window.LL || {}; window.LL.members = { local: 'owner' }; go('home'); });
    await sleep(500);
    return p;
  };
  const home = (p) => p.evaluate(() => ({ one: window.__homeOneCard || null, prompt: (document.querySelector('#scroll .home-prompt') || { getAttribute: () => null }).getAttribute('data-prompt'), text: document.getElementById('scroll').innerText }));

  console.log('A. the setting, in Reminders');
  let p = await open(10);
  const sheet = await p.evaluate(async () => { openReminders(); await new Promise((r) => setTimeout(r, 400)); const s = document.getElementById('sheet'); return { text: s.innerText, from: (s.querySelector('#qhFrom') || {}).value, to: (s.querySelector('#qhTo') || {}).value }; });
  ok('Reminders has quiet hours (the probe is live)', /Quiet hours/i.test(sheet.text), sheet.text.slice(0, 200));
  ok('on by default, 21:00 to 07:00, as before', sheet.from === '21' && sheet.to === '7' && /From 21:00 to 07:00 on this phone/.test(sheet.text), sheet);
  ok('she chooses what may still reach her: medicine reminders', /What can still reach you in quiet hours/.test(sheet.text) && /Medicine reminders/.test(sheet.text), sheet.text.slice(0, 900));
  ok('the caution says she may miss suggestions and news', /we won't disturb you with tips, suggestions or news from Cubby, so you might miss a few until the morning/.test(sheet.text));
  ok('and that medicine reminders still come through', /Medicine reminders still come through/.test(sheet.text));

  console.log('\nB. the push queue');
  const q = await p.evaluate(() => {
    const at = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.getTime(); };
    const cfg = pushCfg();
    const out = { doseNight: quietDropsPush({ cat: 'critical', at: at(3) }, cfg), doseDay: quietDropsPush({ cat: 'critical', at: at(15) }, cfg), newsNight: quietDropsPush({ cat: 'feature', at: at(3) }, cfg) };
    setQuietAllow('critical', false);
    out.doseNightOff = quietDropsPush({ cat: 'critical', at: at(3) }, pushCfg());
    out.doseDayOff = quietDropsPush({ cat: 'critical', at: at(15) }, pushCfg());
    setQuietAllow('critical', true);
    return out;
  });
  ok('a dose at 03:00 comes through by default', q.doseNight === false, q);
  ok('news at 03:00 waits', q.newsNight === true, q);
  ok('a dose at 03:00 waits once she turns medicine reminders off for quiet hours', q.doseNightOff === true, q);
  ok('a dose by day always comes through', q.doseDay === false && q.doseDayOff === false, q);
  await p.close();

  console.log('\nC. Home in her quiet hours');
  p = await open(10);
  let h = await home(p);
  ok('by day a prompt holds the place (the probe is live)', h.prompt === 'first_log_invite', h.one);
  await p.close();
  p = await open(3);
  h = await home(p);
  ok('at 03:00 in her quiet hours no suggestion shows', h.prompt === null && h.one && h.one.quiet === true && h.one.kept === null, h.one);
  ok('the dose that is due still shows', /Vitamin D drops due/.test(h.text), h.text.slice(0, 300));
  await p.close();
  p = await open(3, { enabled: false, quietStart: 0, quietEnd: 0 });
  h = await home(p);
  ok('with quiet hours off, 03:00 is the same as day', h.prompt === 'first_log_invite' && h.one && h.one.quiet === false, h.one);
  await p.close();

  console.log('\nD. hers to change');
  p = await open(10);
  const ch = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    openReminders(); await wait(300);
    const f = document.getElementById('qhFrom'); f.value = '22'; f.dispatchEvent(new Event('change')); await wait(300);
    const a = [pushCfg().quietStart, pushCfg().quietEnd];
    setQuietHours(false); await wait(200);
    const b = [pushCfg().quietStart, pushCfg().quietEnd, inQuietHours(new Date().setHours(23, 0, 0, 0))];
    setQuietHours(true); await wait(200);
    const c = [pushCfg().quietStart, pushCfg().quietEnd];
    return { a, b, c, saved: JSON.parse(localStorage.getItem('little-log-v1')).settings.push };
  });
  ok('she can move the start', ch.a[0] === 22 && ch.a[1] === 7, ch);
  ok('Off means no quiet hours at all', ch.b[0] === ch.b[1] && ch.b[2] === false, ch);
  ok('On again brings her hours back', ch.c[0] === 22 && ch.c[1] === 7, ch);
  ok('saved on this phone', ch.saved && ch.saved.quietStart === 22, ch.saved);
  await p.close();

  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
