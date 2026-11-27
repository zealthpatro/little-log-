/* Parent-chosen reminders: the push queue (founder, 27 Nov 2026: "parents should be able to check what
 * they need: feed reminders, medicine reminders etc"; canvas boards 8A and 8B approved the same day).
 *
 *   A. nothing new is on until she turns it on, and an old saved choice set never reads as consent
 *   B. feeds, about N hours after the last feed: one nudge per baby, from whoever logged it, and it moves
 *   C. feeds at set times: one nudge per time, skipped if a feed was logged in the half hour before
 *   D. the gap: 2h to 4h chips or Custom, 1h to 6h in 15 minute steps, nothing else
 *   E. pumping follows her own pumps only; F. vaccine visits, the evening before
 *   G. quiet hours let a feed nudge go unless she lets feeds through; medicine unchanged
 *   H. the server is told her choices, and only the ones this device made (one doc, many devices)
 *   J. a device that never chose takes the account's choice at sign-in; K. medicine keeps its queue slots
 *   I. a new feed rebuilds the queue at once, not on the 10 minute throttle
 *
 *   node test/parent-reminders.test.js <base url of this tree's server>
 * Fictional family (Bo, Ada, Sam). Seen red on a4c7795b, the commit before the feature.
 */
'use strict';
const puppeteer = require('puppeteer-core');
const { downloadBehavior } = require('../tools/gate_downloads.js');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8080';
const DAY = 86400000, H = 3600000, MIN = 60000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Pin the DAY as well as the hour: 10:10 on a fixed mid-month date, so no gate here crosses a month edge.
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
  events: [{ id: 'f1', type: 'feed', babyId: 'b1', time: now - 1 * H, method: 'bottle', amount: 90, unit: 'ml', authorId: 'local' }],
  settings: Object.assign({ unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', country: 'us' }, push ? { push } : {}),
  meds: [], timers: {}, milestones: [], photos: [], vaccines: {}, illnesses: [], notes: [], pregnancy: null,
});

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'], downloadBehavior: downloadBehavior() });
  const errs = [];
  const open = async (push) => {
    const p = await b.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await p.evaluateOnNewDocument(pin, TARGET);
    await p.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 60000 });
    const now = await p.evaluate(() => Date.now());
    await p.evaluate((s) => {
      localStorage.clear(); localStorage.setItem('little-log-v1', JSON.stringify(s)); localStorage.setItem('cubby-quick-uid', 'local');
      localStorage.setItem('cubby-seen-local', JSON.stringify({ tip_getstarted: 1, tip_logguide: 1 }));
    }, seed(now, push));
    await p.reload({ waitUntil: 'networkidle2' }); await sleep(1200);
    await p.evaluate(() => { window.LL = window.LL || {}; window.LL.members = { local: 'owner', u2: 'carer' }; window.LL.memberInfo = { u2: { name: 'Sam Lee' } }; });
    return p;
  };

  // An older saved choice set, from before this feature: no feed/pump/visit keys at all.
  const p = await open({ enabled: true, quietStart: 21, quietEnd: 7, allow: { critical: true, feature: true, marketing: false }, quietAllow: { critical: true } });
  const live = await p.evaluate(() => typeof remindEntries === 'function' && typeof pushPrefsShape === 'function');
  ok('the feature exists in this tree (the probe is live)', live);
  if (!live) { console.log(`\n${pass} passed, ${fail} failed`); await b.close(); process.exit(1); }

  console.log('A. off until she turns it on');
  const a = await p.evaluate(() => { const c = pushCfg(); return { allow: c.allow, qa: c.quietAllow, r: c.remind, n: remindEntries(c, Date.now(), Date.now() + 48 * 3600000).length }; });
  ok('feeds, pumping and visits are off for a parent who never chose them', a.allow.feed === false && a.allow.pump === false && a.allow.visit === false, a.allow);
  ok('medicine and product news keep their defaults', a.allow.critical === true && a.allow.feature === true && a.allow.marketing === false, a.allow);
  ok('feeds do not come through quiet hours by default', a.qa.feed === false && a.qa.pump === false && a.qa.visit === false && a.qa.critical === true, a.qa);
  ok('defaults: about 3 hours after the last feed, no set times', a.r.feedMode === 'after' && a.r.feedGap === 180 && a.r.pumpGap === 180 && Array.isArray(a.r.feedTimes) && a.r.feedTimes.length === 0, a.r);
  ok('and with all of them off, the queue gains nothing', a.n === 0, a.n);

  console.log('\nB. about N hours after the last feed');
  const bq = await p.evaluate(() => {
    const now = Date.now(), end = now + 48 * 3600000, c = pushCfg(); c.allow.feed = true;
    const f1 = state.events.find((e) => e.id === 'f1').time;
    const one = remindEntries(c, now, end);
    state.events.push({ id: 'f2', type: 'feed', babyId: 'b1', time: now - 20 * 60000, method: 'breast', authorId: 'u2' });
    const moved = remindEntries(c, now, end);
    state.events.push({ id: 'f3', type: 'feed', babyId: 'b1', time: now - 5 * 60000, method: 'bottle', authorId: 'u2', deleted: true });
    const delIgnored = remindEntries(c, now, end);
    state.babies.push({ id: 'b2', name: 'Ada', birth: now - 6 * 86400000 });
    state.events.push({ id: 'g1', type: 'feed', babyId: 'b2', time: now - 2 * 3600000, method: 'bottle', authorId: 'local' });
    state.babies.push({ id: 'b3', name: 'Old', birth: now - 900 * 86400000 });
    state.events.push({ id: 'h1', type: 'feed', babyId: 'b3', time: now - 4 * 86400000, method: 'bottle', authorId: 'local' });
    const twins = remindEntries(c, now, end);
    return { now, f1, one, moved, delIgnored, twins };
  });
  const e1 = bq.one[0] || {};
  ok('one feed nudge, three hours after the last feed', bq.one.length === 1 && e1.cat === 'feed' && e1.at === bq.f1 + 3 * H, bq.one);
  ok('it names the baby and says when, in the approved words', e1.title === 'About 3 hours since Bo’s last feed' && /^Last one was \d+:\d\d (AM|PM), logged by you\.$/.test(e1.body || ''), e1);
  ok('it carries the baby and the skip line the Worker checks', e1.babyId === 'b1' && e1.skipIfSince === bq.f1 + 1, e1);
  const m1 = bq.moved[0] || {};
  ok('a feed from Sam on another phone moves it', bq.moved.length === 1 && m1.at === bq.now - 20 * MIN + 3 * H && /logged by Sam\./.test(m1.body || ''), bq.moved);
  ok('a deleted feed moves nothing', bq.delIgnored.length === 1 && bq.delIgnored[0].at === m1.at, bq.delIgnored);
  const tw = bq.twins.map((e) => e.babyId).sort();
  ok('twins get one nudge each; a baby not logged in three days gets none', tw.join() === 'b1,b2', bq.twins);
  ok('nothing in the past is queued', bq.twins.every((e) => e.at > bq.now));

  console.log('\nC. at set times');
  const cq = await p.evaluate(() => {
    state.babies = state.babies.filter((b) => b.id === 'b1'); state.events = state.events.filter((e) => e.babyId === 'b1');
    const now = Date.now(), c = pushCfg(); c.allow.feed = true; c.remind.feedMode = 'times'; c.remind.feedTimes = ['06:00', '09:00', '12:00'];
    const list = remindEntries(c, now, now + 48 * 3600000);
    return { now, list };
  });
  const noon = new Date(TARGET); noon.setHours(12, 0, 0, 0);
  ok('one nudge per time over the next two days, none already past', cq.list.length === 4 && cq.list.every((e) => e.cat === 'feed' && e.at > cq.now), cq.list.map((e) => new Date(e.at).toString()));
  const n12 = cq.list.find((e) => e.at === noon.getTime()) || {};
  ok('the noon one, skipped by any feed in the half hour before it', n12.skipIfSince === noon.getTime() - 30 * MIN && n12.babyId === 'b1', n12);
  ok('and it reads as hers, not an order', n12.title === 'Bo’s 12:00 PM feed' && n12.body === 'One of the feed times you chose.', n12);

  console.log('\nD. the gap');
  const dq = await p.evaluate(() => [60, 165, 360, 45, 375, 170, '180', null].map((g) => remindGapOk(g)));
  ok('1h to 6h in 15 minute steps, and nothing else', JSON.stringify(dq) === JSON.stringify([true, true, true, false, false, false, false, false]), dq);
  const dq2 = await p.evaluate(() => { const c = state.settings.push; c.remind.feedGap = 30; c.remind.feedTimes = ['25:00', '09:00', '09:00', 'x']; const r = pushCfg().remind; return { gap: r.feedGap, times: r.feedTimes, words: [180, 150, 165, 60, 90].map(gapWords) }; });
  ok('a stored gap out of range falls back to 3 hours; bad or repeated times are dropped', dq2.gap === 180 && JSON.stringify(dq2.times) === '["09:00"]', dq2);
  ok('the gap in words', JSON.stringify(dq2.words) === JSON.stringify(['3 hours', '2½ hours', '2h 45m', '1 hour', '1½ hours']), dq2.words);

  console.log('\nE. pumping, F. vaccine visits');
  const ef = await p.evaluate(() => {
    const now = Date.now(), c = pushCfg(); c.allow.feed = false; c.allow.pump = true; c.allow.visit = false;
    state.events.push({ id: 'p1', type: 'pump', babyId: 'b1', time: now - 3600000, amount: 60, unit: 'ml', authorId: 'u2' });
    const othersOnly = remindEntries(c, now, now + 48 * 3600000);
    state.events.push({ id: 'p2', type: 'pump', babyId: 'b1', time: now - 2 * 3600000, amount: 60, unit: 'ml', authorId: 'local' });
    const mine = remindEntries(c, now, now + 48 * 3600000);
    c.allow.pump = false; c.allow.visit = true;
    const b = activeBaby(); const plan = scheduleFor(b).map((x) => ({ name: x[0], group: x[1], dueMonths: x[2], given: false }));
    state.vaccines = {};
    const noPlan = remindEntries(c, now, now + 120 * 86400000).length;
    state.vaccines = { b1: plan };
    const v = vaxUpcomingVisits(plan)[0];
    const visits = remindEntries(c, now, now + 120 * 86400000);
    const want = new Date(v.due); want.setHours(0, 0, 0, 0); want.setDate(want.getDate() - 1); want.setHours(18, 0, 0, 0);
    return { now, othersOnly, mine, noPlan, visits, want: want.getTime(), age: v.age };
  });
  ok('someone else pumping queues nothing for her', ef.othersOnly.length === 0, ef.othersOnly);
  const pe = ef.mine[0] || {};
  ok('her own pump: one nudge about 3 hours after it', ef.mine.length === 1 && pe.cat === 'pump' && pe.at === ef.now - 2 * H + 3 * H && pe.title === 'About 3 hours since you last pumped' && pe.skipIfSince === ef.now - 2 * H + 1, ef.mine);
  ok('no stored vaccine plan, no visit nudge (and none is generated from here)', ef.noPlan === 0, ef.noPlan);
  const ve = ef.visits[0] || {};
  ok('a vaccine visit: the evening before, at 6 PM', ve.cat === 'visit' && ve.at === ef.want && ve.babyId === 'b1', { ve, want: ef.want });
  ok('it names the check and stays calm', ve.title === 'Bo’s ' + ef.age + '-month check is tomorrow' && !/[—!]/.test(ve.title + ve.body), ve);

  console.log('\nG. quiet hours');
  const gq = await p.evaluate(() => {
    const at = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.getTime(); };
    const c = pushCfg(); c.quietAllow.feed = false;
    const out = { feedNight: quietDropsPush({ cat: 'feed', at: at(23) }, c), feedDay: quietDropsPush({ cat: 'feed', at: at(15) }, c), doseNight: quietDropsPush({ cat: 'critical', at: at(23) }, c), oddNight: quietDropsPush({ cat: 'xyz', at: at(23) }, c) };
    setQuietAllow('feed', true);
    out.feedNightAllowed = quietDropsPush({ cat: 'feed', at: at(23) }, pushCfg());
    out.pumpNight = quietDropsPush({ cat: 'pump', at: at(23) }, pushCfg());
    setQuietAllow('marketing', true);
    out.noSuchChoice = pushCfg().quietAllow.marketing;
    return out;
  });
  ok('a feed nudge at 23:00 is let go by default', gq.feedNight === true && gq.feedDay === false, gq);
  ok('medicine still comes through, as before', gq.doseNight === false, gq);
  ok('anything unknown is held', gq.oddNight === true, gq);
  ok('she can let feeds through at night, and only feeds', gq.feedNightAllowed === false && gq.pumpNight === true, gq);
  ok('quiet hours cannot be opened for news or offers', gq.noSuchChoice === undefined, gq);

  console.log('\nH. what the server is told, and only what this device chose');
  const hq = await p.evaluate(() => {
    const c = pushCfg(); c.remindChosen = {};
    const fresh = pushPrefsShape(c);
    setRemind('pump', false);
    const afterPump = pushPrefsShape(pushCfg());
    setRemindGap('feed', 150);
    const afterGap = pushPrefsShape(pushCfg());
    return { fresh, afterPump, afterGap };
  });
  ok('medicine, news and offers always travel, as explicit booleans', ['critical', 'feature', 'marketing'].every((k) => typeof hq.fresh.allow[k] === 'boolean'), hq.fresh.allow);
  ok('a device that never chose writes no feed, pump or visit key (so it cannot switch another phone off)',
    !['feed', 'pump', 'visit'].some((k) => k in hq.fresh.allow || k in hq.fresh.quietAllow) && !('remind' in hq.fresh), hq.fresh);
  ok('once she chooses here, that choice travels, and only that one',
    hq.afterPump.allow.pump === false && hq.afterPump.quietAllow.pump === false && !('feed' in hq.afterPump.allow), hq.afterPump);
  ok('her gap travels once she sets it', hq.afterGap.remind && hq.afterGap.remind.feedGap === 150 && hq.afterGap.remind.feedMode, hq.afterGap.remind);
  ok('timezone travels with it (no tz, no non-medicine send)', typeof hq.fresh.tz === 'string' && hq.fresh.tz.length > 0, hq.fresh.tz);

  console.log('\nJ. a second device takes the account\'s choice');
  const jq = await p.evaluate(() => {
    const c = pushCfg(); c.remindChosen = {}; c.allow.feed = false; c.allow.visit = false; c.quietAllow.feed = false; c.remind.feedGap = 180;
    const took = cubbyAdoptRemindPrefs({ allow: { feed: true, visit: true, critical: false }, quietAllow: { feed: true }, remind: { feedMode: 'after', feedGap: 210, feedTimes: ['25:00'] } });
    const a = pushCfg();
    const one = { took, feed: a.allow.feed, visit: a.allow.visit, qa: a.quietAllow.feed, gap: a.remind.feedGap, times: a.remind.feedTimes, critical: a.allow.critical };
    a.remindChosen.feed = true; a.allow.feed = false;
    cubbyAdoptRemindPrefs({ allow: { feed: true } });
    one.ownWins = pushCfg().allow.feed;
    return one;
  });
  ok('feeds and visits turned on elsewhere are on here too', jq.took === true && jq.feed === true && jq.visit === true && jq.qa === true, jq);
  ok('the account\'s gap is adopted, and a bad stored time is still refused', jq.gap === 210 && jq.times.length === 0, jq);
  ok('medicine is never touched by this', jq.critical === true, jq);
  ok('a choice made on this device wins over the account\'s', jq.ownWins === false, jq);

  console.log('\nK. medicine keeps its place in the queue');
  const kq = await p.evaluate(async () => {
    const now = Date.now(), c = pushCfg();
    c.enabled = true; c.remindChosen = {}; c.allow.feed = true; c.allow.pump = false; c.allow.visit = false; c.allow.critical = true; c.quietStart = 0; c.quietEnd = 0;
    c.remind.feedMode = 'times'; c.remind.feedTimes = ['07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00'];
    const times = []; for (let h = 0; h < 24; h++) times.push(String(h).padStart(2, '0') + ':45');
    state.meds = [{ id: 'm1', babyId: 'b1', name: 'Vitamin D drops', dose: '1', unit: 'drop', pattern: { type: 'daily', times }, remind: true, active: true, createdAt: now - 5 * 86400000 }];
    // Twins, so her feed times alone overflow what is left of the 60.
    if (!state.babies.some((b) => b.id === 'b2')) state.babies.push({ id: 'b2', name: 'Ada', birth: now - 6 * 86400000 });
    state.events.push({ id: 'k1', type: 'feed', babyId: 'b2', time: now - 3600000, method: 'bottle', authorId: 'local' });
    const feedsMade = remindEntries(c, now, now + 48 * 3600000).length;
    let wrote = null;
    const realLL = window.LL;
    window.LL = Object.assign({}, realLL, { db: { collection: () => ({ doc: () => ({ set: async (d) => { wrote = d; } }) }) } });
    await syncReminderIndex();
    window.LL = realLL;
    const due = (wrote && wrote.push && wrote.push.due) || [];
    const critMade = medFireTimes(state.meds[0], now, now + 48 * 3600000).filter((at) => at - 30 * 60000 > now).length;
    return { feedsMade, n: due.length, doses: due.filter((e) => /^med-/.test(e.tag || '')).length, crit: due.filter((e) => e.cat === 'critical').length, feed: due.filter((e) => e.cat === 'feed').length, critMade, sorted: due.every((e, i) => !i || due[i - 1].at <= e.at) };
  });
  ok('the probe overfills the queue (doses alone fit; doses plus feed times do not)', kq.critMade < 60 && kq.critMade + kq.feedsMade > 64 && kq.n === 60, kq);
  ok('every dose reminder made it in (the day\'s digests are medicine too); feeds took only the room left', kq.doses === kq.critMade && kq.crit >= kq.doses && kq.feed === 60 - kq.crit && kq.feed > 0, kq);
  ok('and the queue is still in time order for the Worker', kq.sorted, kq);

  console.log('\nI. a new feed rebuilds the queue at once');
  const iq = await p.evaluate(() => {
    let calls = 0; const real = window.syncReminderIndex; window.syncReminderIndex = () => { calls++; };
    const c = pushCfg(); c.enabled = true; c.allow.feed = true;
    maybeSyncReminders(); const first = calls;           // signature taken
    maybeSyncReminders(); const idle = calls;            // nothing changed, inside the throttle
    state.events.push({ id: 'f9', type: 'feed', babyId: 'b1', time: Date.now(), method: 'bottle', authorId: 'u2' });
    maybeSyncReminders(); const after = calls;
    window.syncReminderIndex = real;
    return { first, idle, after };
  });
  ok('unchanged feeds wait for the throttle', iq.idle === iq.first, iq);
  ok('a new feed (from anyone) syncs straight away', iq.after === iq.idle + 1, iq);

  console.log('\nL. every reminder row in the sheet is drawn whole');
  const lq = await p.evaluate(async () => {
    const c = pushCfg(); c.allow.feed = true; c.allow.pump = true; c.allow.visit = true;
    const b = activeBaby(); state.vaccines = { b1: scheduleFor(b).map((x) => ({ name: x[0], group: x[1], dueMonths: x[2], given: false })) };
    if (!state.events.some((e) => e.type === 'pump')) state.events.push({ id: 'p9', type: 'pump', babyId: 'b1', time: Date.now() - 3600000, authorId: 'local' });
    openReminders(); await new Promise((r) => setTimeout(r, 300));
    const rows = Array.from(document.querySelectorAll('#sheet .set-item')).filter((r) => /^(Medicine doses|Feeds|Pumping|Vaccine visits)$/.test(((r.querySelector('.si-body .a') || {}).textContent || '').trim()));
    return rows.map((r) => ({ t: r.querySelector('.si-body .a').textContent.trim(), icon: !!r.querySelector('.si-ico svg'), seg: r.querySelectorAll('.seg button').length }));
  });
  ok('all four choices are shown when each applies', lq.length === 4, lq);
  ok('each has its icon and its On/Off', lq.every((r) => r.icon && r.seg === 2), lq);

  ok('no page errors', errs.length === 0, errs);
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
