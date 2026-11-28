/* "New in Cubby" is a separate opt in, as privacy/index.html promises, and the code now keeps it.
 *
 * Until 28 Nov 2026 pushCfg() defaulted allow.feature to true and every device that turned
 * notifications on wrote that true to users/{uid}.push. So what is stored cannot tell "she chose
 * news" from "she never chose". The decision (CEO, 28 Nov): the code follows the promise, and
 * anyone who never explicitly chose counts as off. A tap now also writes push.chosen.feature, and
 * the Worker sends a feature note only when BOTH allow.feature and chosen.feature are true.
 *
 *   1. the Worker: campaignConsent, lifted from worker.js by name and run for real
 *   2. the app: default off; an old stored true reads as off; a tap is a choice and is written;
 *      a device that never chose writes nothing for news; it adopts the account's real choice
 *
 *   node test/news-optin.test.js <base url of this tree's server>
 * Fictional family (Bo). Seen red on 01fafdae, the commit before the fix.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const puppeteer = require('puppeteer-core');
const { downloadBehavior } = require('../tools/gate_downloads.js');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8080';
const DAY = 86400000, H = 3600000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- 1. the Worker
const SRC = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8');
function lift(src, name) {
  const m = new RegExp('\\n\\s*(?:async\\s+)?function ' + name + '\\s*\\(').exec(src);
  if (!m) return null;
  let i = src.indexOf('{', m.index), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(m.index, j + 1);
  }
  return null;
}
console.log('\n1. the Worker sends news only to someone who chose it');
{
  const body = lift(SRC, 'campaignConsent');
  ok('worker.js has campaignConsent (the probe is live)', !!body);
  const sb = {};
  if (body) vm.runInNewContext(body + '\nthis.campaignConsent = campaignConsent;', sb);
  const C = sb.campaignConsent || (() => null);
  // Firestore REST shapes, as the cron reads users/{uid}.push.
  const b = (v) => ({ booleanValue: v });
  const map = (o) => ({ mapValue: { fields: o } });
  const push = (allow, chosen) => Object.assign({ allow: map(allow) }, chosen ? { chosen: map(chosen) } : {});
  ok('a stored feature:true with no choice recorded is NOT consent (every old device wrote that)',
     C(push({ feature: b(true) }), 'feature') === false);
  ok('feature:true and chosen.feature:true is consent', C(push({ feature: b(true) }, { feature: b(true) }), 'feature') === true);
  ok('she chose, and chose off', C(push({ feature: b(false) }, { feature: b(true) }), 'feature') === false);
  ok('a chosen flag alone is not consent', C(push({}, { feature: b(true) }), 'feature') === false);
  ok('a string "true" is not consent', C(push({ feature: { stringValue: 'true' } }, { feature: b(true) }), 'feature') === false);
  ok('offers keep their rule: an explicit true', C(push({ marketing: b(true) }), 'marketing') === true);
  ok('offers absent is not consent', C(push({}), 'marketing') === false);
  ok('no allow map at all is not consent', C({}, 'feature') === false && C(null, 'marketing') === false);
  ok('deliverCampaign asks campaignConsent', /if \(!campaignConsent\(push, camp\.cat\)\) return 'noConsent';/.test(lift(SRC, 'deliverCampaign') || ''));
}

// ---------------------------------------------------------------- 2. the app
function pin(target) {
  const R = Date, shift = target - R.now();
  function D(...a) { return a.length === 0 ? new R(R.now() + shift) : new R(...a); }
  D.prototype = R.prototype; D.now = () => R.now() + shift; D.parse = R.parse; D.UTC = R.UTC;
  window.Date = D;
}
const TARGET = new Date(2026, 10, 12, 10, 10, 0, 0).getTime();   // Thu 12 Nov 2026, 10:10 local
const seed = (now, push) => ({
  babies: [{ id: 'b1', name: 'Bo', birth: now - 6 * DAY, sex: 'M', routines: [], allergies: [], country: 'us' }],
  activeBabyId: 'b1',
  events: [{ id: 'f1', type: 'feed', babyId: 'b1', time: now - H, method: 'bottle', amount: 90, unit: 'ml', authorId: 'local' }],
  settings: Object.assign({ unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', country: 'us' }, push ? { push } : {}),
  meds: [], timers: {}, milestones: [], photos: [], vaccines: {}, illnesses: [], notes: [], pregnancy: null,
});

(async () => {
  const br = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'], downloadBehavior: downloadBehavior() });
  const errs = [];
  const open = async (push) => {
    const p = await br.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await p.evaluateOnNewDocument(pin, TARGET);
    await p.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 60000 });
    const now = await p.evaluate(() => Date.now());
    await p.evaluate((s) => {
      localStorage.clear(); localStorage.setItem('little-log-v1', JSON.stringify(s)); localStorage.setItem('cubby-quick-uid', 'local');
      localStorage.setItem('cubby-seen-local', JSON.stringify({ tip_getstarted: 1, tip_logguide: 1 }));
    }, seed(now, push));
    await p.reload({ waitUntil: 'networkidle2' }); await sleep(1200);
    return p;
  };
  // What the Reminders sheet shows on the "New in Cubby" row: the selected half of its On/Off pair.
  const newsRow = (p) => p.evaluate(() => {
    openReminders();
    const row = Array.from(document.querySelectorAll('#sheet .set-item')).find((r) => /New in Cubby/.test(r.textContent));
    if (!row) return null;
    const sel = Array.from(row.querySelectorAll('.seg button')).find((x) => x.classList.contains('on'));
    return sel ? sel.textContent.trim() : null;
  });

  console.log('\n2a. a fresh device: news starts off');
  {
    const p = await open(null);
    const r = await p.evaluate(() => { const c = pushCfg(); const s = pushPrefsShape(c); return { allow: c.allow.feature, shape: s.allow.feature, chosen: s.chosen || null }; });
    ok('news is off by default', r.allow === false, r);
    ok('and a device that never chose writes nothing about news', r.shape === undefined && r.chosen === null, r);
    ok('the sheet shows New in Cubby as Off', (await newsRow(p)) === 'Off');
    await p.close();
  }

  console.log('\n2b. an old device that stored feature:true without ever choosing');
  {
    const p = await open({ enabled: true, quietStart: 21, quietEnd: 7, allow: { critical: true, feature: true, marketing: false }, quietAllow: { critical: true } });
    const r = await p.evaluate(() => { const c = pushCfg(); const s = pushPrefsShape(c); return { allow: c.allow.feature, shape: s.allow.feature, crit: s.allow.critical }; });
    ok('the old true reads as off', r.allow === false, r);
    ok('it is not written back as a choice', r.shape === undefined, r);
    ok('medicine is untouched', r.crit === true, r);
    ok('the sheet shows New in Cubby as Off', (await newsRow(p)) === 'Off');

    console.log('\n2c. she taps On, then Off');
    const on = await p.evaluate(() => { setPushAllow('feature', true); const c = pushCfg(); const s = pushPrefsShape(c); return { allow: c.allow.feature, shape: s.allow.feature, chosen: s.chosen && s.chosen.feature }; });
    ok('a tap is a choice: allow.feature true', on.allow === true, on);
    ok('and both halves go to the server', on.shape === true && on.chosen === true, on);
    ok('the sheet shows On', (await newsRow(p)) === 'On');
    const off = await p.evaluate(() => { setPushAllow('feature', false); const s = pushPrefsShape(pushCfg()); return { shape: s.allow.feature, chosen: s.chosen && s.chosen.feature }; });
    ok('Off is a choice too, written as false', off.shape === false && off.chosen === true, off);
    const kept = await p.evaluate(() => { persist(); pushCfg(); return pushCfg().allow.feature; });
    ok('a chosen Off stays off (nothing re-defaults it)', kept === false);
    await p.close();
  }

  console.log('\n2d. a device that never chose, at sign-in');
  {
    const p = await open({ enabled: true, quietStart: 21, quietEnd: 7, allow: { critical: true, feature: true, marketing: false }, quietAllow: { critical: true } });
    const legacy = await p.evaluate(() => { window.cubbyAdoptRemindPrefs({ allow: { critical: true, feature: true } }); return pushCfg().allow.feature; });
    ok('an account true with no choice recorded is not adopted', legacy === false);
    const real = await p.evaluate(() => { window.cubbyAdoptRemindPrefs({ allow: { critical: true, feature: true }, chosen: { feature: true } }); const c = pushCfg(); const s = pushPrefsShape(c); return { allow: c.allow.feature, shape: s.allow.feature, persisted: JSON.parse(localStorage.getItem('little-log-v1')).settings.push.allow.feature }; });
    ok('the account\'s real choice is adopted', real.allow === true && real.persisted === true, real);
    ok('and this device still writes nothing about news (her phone\'s choice is left alone)', real.shape === undefined, real);
    await p.close();
  }

  ok('no page errors', errs.length === 0, errs);
  await br.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  console.log(fail ? 'NEWS-OPTIN: FAIL' : 'NEWS-OPTIN: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
