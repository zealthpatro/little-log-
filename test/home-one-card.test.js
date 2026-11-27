/* One card at a time on Home, and prompts that arrive when her data makes them useful
 * (27 Nov 2026 UX review, canvas boards 6 and 7A).
 *
 * The teach ledger rationed its own cues, but tips, Get started, good reads, keepsakes and nudges did not
 * share that allowance, so the Home after a first log carried six suggestions at once and none of them was
 * the invite. Now everything that speaks first is ranked and one shows; live state (a dose due, an
 * illness, a fever) is never rationed.
 *
 *   A. after a first log, solo: one card, and it is the invite prompt; the dose alert still shows
 *   B. one new prompt a day; "Not now" snoozes, twice is never again
 *   C. nothing new at 03:00, nothing on a fever day
 *   D. a visit a week out offers the calendar; a visit just passed offers to mark it done
 *   E. the first nap; every prompt is counted shown and answered (prompt.shown, prompt.acted)
 *
 *   node test/home-one-card.test.js [<base url of this tree's server>]
 * Fictional baby (Bo). Seen red on main 747bfdfe.
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
// a clock at the given local hour today (or `days` days on), whatever the real time is
const offsetTo = (hour, days) => { const d = new Date(); d.setHours(hour, 10, 0, 0); return d.getTime() + (days || 0) * DAY - Date.now(); };

function seed(now, o) {
  const ev = (id, type, t, x) => Object.assign({ id, type, babyId: 'b1', time: t, authorId: 'local' }, x || {});
  const hhmm = (t) => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  return {
    babies: [{ id: 'b1', name: 'Bo', birth: now - (o.age || 6) * DAY, sex: 'M', routines: [], allergies: [], country: 'us' }],
    activeBabyId: 'b1',
    events: [ev('f1', 'feed', now - 1 * H, { method: 'bottle', amount: 90, unit: 'ml' })]
      .concat(o.nap ? [ev('s1', 'sleep', now - 3 * H, { end: now - 2 * H })] : [])
      .concat(o.fever ? [ev('t1', 'temperature', now - 2 * H, { temp: 38.4, unit: 'C' })] : []),
    settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', country: 'us' },
    meds: o.dose ? [{ id: 'm1', babyId: 'b1', name: 'Vitamin D drops', dose: '1', unit: 'drop', pattern: { type: 'daily', times: [hhmm(now - 30 * 60000)] }, remind: true, active: true, createdAt: now - 5 * DAY }] : [],
    timers: {}, milestones: [], photos: [], vaccines: {}, illnesses: [], notes: [], pregnancy: null,
  };
}

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'], downloadBehavior: downloadBehavior() });
  const errs = [];
  const open = async (hour, o, keepPrompts, days) => {
    const p = await b.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await p.evaluateOnNewDocument(pin, offsetTo(hour, days));
    await p.evaluateOnNewDocument(() => { window.__track = []; Object.defineProperty(window, 'cubbyTrack', { configurable: true, get() { return (n, pr) => window.__track.push([n, pr]); }, set() {} }); });
    await p.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 60000 });
    const now = await p.evaluate(() => Date.now());
    await p.evaluate((s, keep) => {
      const prompts = localStorage.getItem('cubby-prompts:local');
      localStorage.clear(); localStorage.setItem('little-log-v1', JSON.stringify(s)); localStorage.setItem('cubby-quick-uid', 'local');
      if (keep && prompts) localStorage.setItem('cubby-prompts:local', prompts);
      if (keep && keep !== true) localStorage.setItem('cubby-prompts:local', keep);
    }, seed(now, o), keepPrompts);
    await p.reload({ waitUntil: 'networkidle2' }); await sleep(1300);
    // the member list as production loads it: just her, or her and a partner
    await p.evaluate((two) => { window.LL = window.LL || {}; window.LL.members = two ? { local: 'owner', uidSam: 'caregiver' } : { local: 'owner' }; }, !!o.two);
    if (o.ill) await p.evaluate(() => { state.illnesses = [{ id: 'i1', babyId: 'b1', name: 'Cold', startedAt: Date.now() - 86400000, endedAt: null, notes: '', by: 'local' }]; persist(); });
    if (o.given) await p.evaluate((g) => { const plan = vaccinePlan(); plan.forEach((v) => { if (v.dueMonths === 0) { v.given = true; v.givenAt = activeBaby().birth; } }); persist(); }, o.given);
    await p.evaluate(() => { go('home'); }); await sleep(500);
    return p;
  };
  const home = (p) => p.evaluate(() => {
    const sc = document.getElementById('scroll');
    const card = sc.querySelector('.home-prompt');
    return { one: window.__homeOneCard || null, prompt: card ? card.getAttribute('data-prompt') : null, promptText: card ? card.innerText.replace(/\s+/g, ' ') : '',
      text: sc.innerText, track: window.__track.slice() };
  });

  console.log('A. after a first log, on her own');
  let p = await open(10, { dose: true });
  let h = await home(p);
  ok('Home reports what it offered and kept (the probe is live)', !!h.one, h.one);
  ok('more than one card wanted the place', h.one && h.one.offered.length >= 2, h.one);
  ok('one is kept, and it is the invite prompt', h.one && h.one.kept === 'prompt' && h.prompt === 'first_log_invite', h);
  ok('it says what the review promised', /That's the first one\. Who's on the next\?/.test(h.promptText) && /Invite someone/.test(h.promptText), h.promptText);
  ok('none of the others is on the screen', !/Get started|See what to log|A GOOD READ FOR YOU/i.test(h.text), h.text.slice(0, 500));
  ok('the dose that is due is not rationed', /Vitamin D drops due/.test(h.text), h.text.slice(0, 300));
  ok('the prompt is counted shown, once', h.track.filter((t) => t[0] === 'prompt.shown' && t[1].prompt === 'first_log_invite').length === 1, h.track);

  console.log('\nB. one a day, and "Not now"');
  const nn = await p.evaluate(async () => {
    document.querySelector('.home-prompt .btn-ghost:last-child').click(); await new Promise((r) => setTimeout(r, 400));
    return { gone: !document.querySelector('.home-prompt'), track: window.__track.filter((t) => t[0] === 'prompt.acted'), store: JSON.parse(localStorage.getItem('cubby-prompts:local')) };
  });
  ok('"Not now" puts it away', nn.gone, nn);
  ok('and is counted', nn.track.length === 1 && nn.track[0][1].action === 'not_now' && nn.track[0][1].prompt === 'first_log_invite', nn.track);
  const store1 = JSON.stringify(nn.store); await p.close();
  p = await open(10, { nap: true }, store1);
  h = await home(p);
  ok('no other prompt starts the same day, even with a first nap', h.prompt === null, h);
  await p.close();
  p = await open(10, {}, store1, 4);
  h = await home(p);
  ok('after the snooze it may come back once', h.prompt === 'first_log_invite', h);
  await p.evaluate(async () => { document.querySelector('.home-prompt .btn-ghost:last-child').click(); await new Promise((r) => setTimeout(r, 300)); });
  const store2 = await p.evaluate(() => localStorage.getItem('cubby-prompts:local')); await p.close();
  p = await open(10, {}, store2, 9);
  h = await home(p);
  ok('"Not now" twice is never again', h.prompt !== 'first_log_invite', h);
  await p.close();

  console.log('\nC. quiet hours, and a fever day');
  p = await open(3, {});
  h = await home(p);
  ok('at 03:00 there is no prompt', h.prompt === null, h);
  ok('and no teach cue either', !(h.one && (h.one.offered || []).includes('teach')), h.one);
  await p.close();
  p = await open(10, { fever: true });
  h = await home(p);
  ok('on a fever day there is no prompt', h.prompt === null, h);
  ok('the fever is still on the screen', /Fever logged/.test(h.text), h.text.slice(0, 400));
  await p.close();

  p = await open(10, { two: true });
  h = await home(p);
  ok('with a partner already in the circle, no invite prompt', h.prompt !== 'first_log_invite', h.prompt);
  await p.close();
  p = await open(10, { ill: true });
  h = await home(p);
  ok('with an illness running, no prompt at all', h.prompt === null, h.prompt);
  await p.close();

  console.log('\nD. the vaccine visit');
  const done = JSON.stringify({ first_log_invite: { done: 1, day: 'x' }, solo_night_invite: { done: 1, day: 'x' } });
  p = await open(10, { age: 55, given: true }, done);
  h = await home(p);
  ok('a week before the 2-month check, it offers the calendar', h.prompt === 'visit_week_ahead' && /2-month check is coming up/.test(h.promptText) && /Put it in my calendar/.test(h.promptText), h);
  const cal = await p.evaluate(async () => { let n = 0; const real = window.exportVaccineSchedule; window.exportVaccineSchedule = () => { n++; }; document.querySelector('.home-prompt .btn-primary').click(); await new Promise((r) => setTimeout(r, 300)); window.exportVaccineSchedule = real; return { n, acted: window.__track.filter((t) => t[0] === 'prompt.acted').pop() }; });
  ok('and the button exports the visits', cal.n === 1 && cal.acted && cal.acted[1].action === 'primary', cal);
  await p.close();
  p = await open(10, { age: 64, given: true }, done);
  h = await home(p);
  ok('just after the visit date, it asks if she is back', h.prompt === 'visit_passed' && /Back from the 2-month check\?/.test(h.promptText), h);
  const mark = await p.evaluate(async () => { document.querySelector('.home-prompt .btn-primary').click(); await new Promise((r) => setTimeout(r, 400)); return document.getElementById('sheet').innerText; });
  ok('"Mark the visit done" opens the visit sheet', /2-month check/.test(mark) && /Untick any that were not given/.test(mark), mark.slice(0, 160));
  await p.close();

  console.log('\nE. the first nap');
  p = await open(10, { nap: true }, done);
  h = await home(p);
  ok('after the first nap: "Naps add up on their own"', h.prompt === 'first_nap' && /Naps add up on their own/.test(h.promptText), h);
  const got = await p.evaluate(async () => { document.querySelector('.home-prompt .btn-ghost:last-child').click(); await new Promise((r) => setTimeout(r, 300)); return JSON.parse(localStorage.getItem('cubby-prompts:local')).first_nap; });
  ok('"Got it" is an answer, not a snooze', got && got.done === 1 && !got.snooze, got);
  await p.close();

  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
