/* Parent-chosen reminders (feeds, pumping, vaccine visits), judged on the REAL Worker functions.
 *
 * users/{uid}.push.due is written by its owner and firestore.rules does not validate it, so every
 * entry in it is a claim. The cron is the enforcement point: it decides, per entry, send / drop / wait.
 * This lifts that decision (pushEntryVerdict) and the planning around it (pushPlan, pushEventsSince)
 * out of worker.js by name, runs them in a sandbox, and asserts each rule the founder approved:
 *   - medicine (cat 'critical', or no cat from a pre-v301 client) behaves exactly as before
 *   - feed / pump / visit need EXPLICIT consent, a timezone, and respect quiet hours unless allowed
 *   - a feed someone else logged for the same baby cancels my nudge; a twin's feed does not
 *   - a pump cancels only when it is MINE; babyId is ignored for pumps
 *   - an events read that failed drops rather than risks a nudge for a feed that already happened
 *   - any other category in the client queue is dropped (marketing only ever comes via campaigns)
 *   - at most one send per (category, baby) per tick
 * The source asserts at the bottom keep the cron loop wired to these functions, so they cannot
 * become dead code that this file keeps on proving.
 *
 *   node test/push-reminder-cats.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

const SRC = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8');
// Same brace-matching lift as test/blob-merge.test.js: the whole `function name(...) {...}`.
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
const NAMES = ['_fsNum', '_fsStr', '_inQuiet', 'pushEntryVerdict', 'pushPlan', 'pushEventsSince', '_fsEventPlain'];
const parts = NAMES.map((n) => [n, lift(SRC, n)]);
const missing = parts.filter((p) => !p[1]).map((p) => p[0]);
ok('worker.js has every function this judges', !missing.length, missing);
if (missing.length) { console.log('\n' + pass + ' passed, ' + fail + ' failed\nPUSH-REMINDER-CATS: FAIL'); process.exit(1); }

const sb = {};
vm.createContext(sb);
vm.runInContext(parts.map((p) => p[1]).join('\n'), sb);
const { pushEntryVerdict: V, pushPlan, pushEventsSince, _fsEventPlain } = sb;

const NOW = 1786000000000;
const MIN = 60000, HR = 3600000;
const UID = 'me', OTHER = 'partner';
const DAY_HOUR = 14;   // 2pm, outside 21-7 quiet hours
const NIGHT_HOUR = 3;  // 3am, inside them
const prefs = (o) => Object.assign({
  allow: { critical: undefined, feed: true, pump: true, visit: true },
  quietStart: 21, quietEnd: 7, quietAllow: { critical: true }, tz: 'Asia/Dubai'
}, o || {});
const feed = (o) => Object.assign({ at: NOW - 5 * MIN, cat: 'feed', title: 'Feed', body: 'b', tag: 'feed-b1', babyId: 'b1', skipIfSince: NOW - 3 * HR }, o || {});
const pump = (o) => Object.assign({ at: NOW - 5 * MIN, cat: 'pump', title: 'Pump', body: 'b', tag: 'pump', skipIfSince: NOW - 3 * HR }, o || {});
const visit = (o) => Object.assign({ at: NOW - 5 * MIN, cat: 'visit', title: 'Visit', body: 'b', tag: 'visit-b1', babyId: 'b1' }, o || {});
const ev = (o) => Object.assign({ type: 'feed', babyId: 'b1', time: NOW - HR, authorId: OTHER, deleted: false }, o || {});

console.log('\n1. medicine (critical) is exactly what it was');
{
  const med = { at: NOW - 10 * MIN, due: NOW + 20 * MIN, cat: 'critical', medId: 'm1', babyId: 'b1' };
  ok('allow missing => send (every token minted before categories opted in)', V(med, prefs({ allow: {} }), NOW, DAY_HOUR, undefined, UID) === 'send');
  ok('no prefs object at all => send', V(med, {}, NOW, DAY_HOUR, undefined, UID) === 'send');
  ok('explicit false => drop', V(med, prefs({ allow: { critical: false } }), NOW, DAY_HOUR, undefined, UID) === 'drop');
  ok('past its dose time => drop', V(Object.assign({}, med, { due: NOW - MIN }), prefs(), NOW, DAY_HOUR, undefined, UID) === 'drop');
  ok('digest with no due, 25 min old => drop', V({ at: NOW - 25 * MIN, cat: 'critical' }, prefs(), NOW, DAY_HOUR, undefined, UID) === 'drop');
  ok('digest with no due, 10 min old => send', V({ at: NOW - 10 * MIN, cat: 'critical' }, prefs(), NOW, DAY_HOUR, undefined, UID) === 'send');
  ok('not yet due => wait', V(Object.assign({}, med, { at: NOW + MIN }), prefs(), NOW, DAY_HOUR, undefined, UID) === 'wait');
  ok('no tz does not silence medicine', V(med, prefs({ tz: '' }), NOW, null, undefined, UID) === 'send');
  ok('server quiet hours do not touch medicine (client filters it)', V(med, prefs({ quietAllow: {} }), NOW, NIGHT_HOUR, undefined, UID) === 'send');
  ok('a pre-v301 entry with NO cat is medicine', V({ at: NOW - 10 * MIN, due: NOW + 20 * MIN, medId: 'm1' }, prefs({ allow: {} }), NOW, DAY_HOUR, undefined, UID) === 'send');
  ok('and so is an empty cat string (what _fsStr gives for a missing field)', V({ at: NOW - 10 * MIN, cat: '' }, prefs(), NOW, DAY_HOUR, undefined, UID) === 'send');
}

console.log('\n2. consent for the new categories is explicit');
{
  ok('feed with allow missing => drop', V(feed(), prefs({ allow: {} }), NOW, DAY_HOUR, [], UID) === 'drop');
  ok('feed with allow.feed false => drop', V(feed(), prefs({ allow: { feed: false } }), NOW, DAY_HOUR, [], UID) === 'drop');
  ok('feed with a truthy non-boolean ("yes") => drop', V(feed(), prefs({ allow: { feed: 'yes' } }), NOW, DAY_HOUR, [], UID) === 'drop');
  ok('pump with allow missing => drop', V(pump(), prefs({ allow: {} }), NOW, DAY_HOUR, [], UID) === 'drop');
  ok('visit with allow missing => drop', V(visit(), prefs({ allow: {} }), NOW, DAY_HOUR, [], UID) === 'drop');
  ok('feed allowed, daytime, no newer feed => send', V(feed(), prefs(), NOW, DAY_HOUR, [], UID) === 'send');
  ok('visit allowed, daytime => send', V(visit(), prefs(), NOW, DAY_HOUR, undefined, UID) === 'send');
}

console.log('\n3. unknown categories in the client queue are dropped');
{
  ok("'marketing' from the queue => drop (marketing only via campaigns)", V(Object.assign(feed(), { cat: 'marketing' }), prefs({ allow: { marketing: true } }), NOW, DAY_HOUR, [], UID) === 'drop');
  ok("'feature' from the queue => drop", V(Object.assign(feed(), { cat: 'feature' }), prefs({ allow: { feature: true } }), NOW, DAY_HOUR, [], UID) === 'drop');
  ok("'xyz' => drop", V(Object.assign(feed(), { cat: 'xyz' }), prefs({ allow: { xyz: true } }), NOW, DAY_HOUR, [], UID) === 'drop');
  ok("'__proto__' => drop", V(Object.assign(feed(), { cat: '__proto__' }), prefs(), NOW, DAY_HOUR, [], UID) === 'drop');
  ok('a non-string cat => drop', V(Object.assign(feed(), { cat: 1 }), prefs(), NOW, DAY_HOUR, [], UID) === 'drop');
}

console.log('\n4. timezone and quiet hours');
{
  ok('no tz => drop (never guess)', V(feed(), prefs({ tz: '' }), NOW, DAY_HOUR, [], UID) === 'drop');
  ok('tz set but hour unreadable (bad tz string) => drop', V(feed(), prefs(), NOW, null, [], UID) === 'drop');
  ok('in quiet hours, quietAllow.feed absent => drop', V(feed(), prefs(), NOW, NIGHT_HOUR, [], UID) === 'drop');
  ok('in quiet hours, quietAllow.feed true => send', V(feed(), prefs({ quietAllow: { feed: true } }), NOW, NIGHT_HOUR, [], UID) === 'send');
  ok('in quiet hours, quietAllow.feed true does not let pump through', V(pump(), prefs({ quietAllow: { feed: true } }), NOW, NIGHT_HOUR, [], UID) === 'drop');
  ok('in quiet hours, visit without quietAllow.visit => drop', V(visit(), prefs(), NOW, NIGHT_HOUR, undefined, UID) === 'drop');
  ok('quietStart === quietEnd means no quiet hours => send', V(feed(), prefs({ quietStart: 0, quietEnd: 0 }), NOW, NIGHT_HOUR, [], UID) === 'send');
  ok('daytime window (9-17) holds 14:00 => drop', V(feed(), prefs({ quietStart: 9, quietEnd: 17 }), NOW, DAY_HOUR, [], UID) === 'drop');
}

console.log('\n5. stale and not yet due');
{
  ok('feed 21 min past its time => drop', V(feed({ at: NOW - 21 * MIN }), prefs(), NOW, DAY_HOUR, [], UID) === 'drop');
  ok('feed 19 min past its time => send', V(feed({ at: NOW - 19 * MIN }), prefs(), NOW, DAY_HOUR, [], UID) === 'send');
  ok('feed in the future => wait', V(feed({ at: NOW + MIN }), prefs(), NOW, DAY_HOUR, [], UID) === 'wait');
  ok('future wins over no-consent: wait, not drop (it is not ours to spend yet)', V(feed({ at: NOW + MIN }), prefs({ allow: {} }), NOW, DAY_HOUR, [], UID) === 'wait');
}

console.log('\n6. the skip rule for feeds');
{
  ok("another caregiver's newer feed for the same baby => drop", V(feed(), prefs(), NOW, DAY_HOUR, [ev({ authorId: OTHER })], UID) === 'drop');
  ok('my own newer feed => drop', V(feed(), prefs(), NOW, DAY_HOUR, [ev({ authorId: UID })], UID) === 'drop');
  ok("a newer feed for a DIFFERENT baby (twins) => send", V(feed(), prefs(), NOW, DAY_HOUR, [ev({ babyId: 'b2' })], UID) === 'send');
  ok('a feed older than skipIfSince => send', V(feed(), prefs(), NOW, DAY_HOUR, [ev({ time: NOW - 4 * HR })], UID) === 'send');
  ok('a feed exactly at skipIfSince => drop (>=)', V(feed(), prefs(), NOW, DAY_HOUR, [ev({ time: NOW - 3 * HR })], UID) === 'drop');
  ok('a DELETED newer feed does not count => send', V(feed(), prefs(), NOW, DAY_HOUR, [ev({ deleted: true })], UID) === 'send');
  ok('a newer non-feed event (diaper) => send', V(feed(), prefs(), NOW, DAY_HOUR, [ev({ type: 'diaper' })], UID) === 'send');
  ok('events read FAILED (null) => drop', V(feed(), prefs(), NOW, DAY_HOUR, null, UID) === 'drop');
  ok('events never read (undefined) => drop', V(feed(), prefs(), NOW, DAY_HOUR, undefined, UID) === 'drop');
  ok('no skipIfSince => drop (malformed entry)', V(feed({ skipIfSince: undefined }), prefs(), NOW, DAY_HOUR, [], UID) === 'drop');
  ok('skipIfSince after its own fire time => drop', V(feed({ skipIfSince: NOW }), prefs(), NOW, DAY_HOUR, [], UID) === 'drop');
  ok('skipIfSince more than a day before it => drop (bounds the read)', V(feed({ skipIfSince: NOW - 5 * MIN - 25 * HR }), prefs(), NOW, DAY_HOUR, [], UID) === 'drop');
}

console.log('\n7. the skip rule for pumps: hers only, any baby');
{
  const pev = (o) => ev(Object.assign({ type: 'pump' }, o));
  ok("someone else's newer pump => send", V(pump(), prefs(), NOW, DAY_HOUR, [pev({ authorId: OTHER })], UID) === 'send');
  ok('my own newer pump => drop', V(pump(), prefs(), NOW, DAY_HOUR, [pev({ authorId: UID })], UID) === 'drop');
  ok('my own newer pump logged against another baby => drop (babyId ignored)', V(pump({ babyId: 'b1' }), prefs(), NOW, DAY_HOUR, [pev({ authorId: UID, babyId: 'b2' })], UID) === 'drop');
  ok('my own pump with no babyId cancels an entry with one', V(pump({ babyId: 'b1' }), prefs(), NOW, DAY_HOUR, [pev({ authorId: UID, babyId: '' })], UID) === 'drop');
  ok('a pump with no authorId is not provably mine => send', V(pump(), prefs(), NOW, DAY_HOUR, [pev({ authorId: '' })], UID) === 'send');
  ok('my own newer FEED does not cancel a pump', V(pump(), prefs(), NOW, DAY_HOUR, [ev({ authorId: UID })], UID) === 'send');
  ok('pump events read failed => drop', V(pump(), prefs(), NOW, DAY_HOUR, null, UID) === 'drop');
}

console.log('\n8. one send per (category, baby) per tick, the latest wins');
{
  const entries = [
    feed({ at: NOW - 15 * MIN, tag: 'f-early' }), feed({ at: NOW - 2 * MIN, tag: 'f-late' }),
    feed({ at: NOW - 8 * MIN, tag: 'f-mid' }),
    feed({ at: NOW - 6 * MIN, tag: 'f-twin', babyId: 'b2' }),
    feed({ at: NOW - 7 * MIN, tag: 'f-nobaby', babyId: '' }), feed({ at: NOW - 3 * MIN, tag: 'f-nobaby2', babyId: '' }),
    pump({ at: NOW - 9 * MIN, tag: 'p1' }), pump({ at: NOW - 4 * MIN, tag: 'p2' }),
    visit({ at: NOW - 10 * MIN, tag: 'v1' }),
    { at: NOW - 12 * MIN, due: NOW + 20 * MIN, cat: 'critical', tag: 'med-1' },
    { at: NOW - 11 * MIN, due: NOW + 20 * MIN, cat: 'critical', tag: 'med-2' },
    feed({ at: NOW + 10 * MIN, tag: 'f-future' })
  ];
  const plan = pushPlan(entries, prefs(), NOW, DAY_HOUR, [], UID, 0);
  const sends = plan.filter((m) => !m.drop).map((m) => m.tag).sort();
  const drops = plan.filter((m) => m.drop).map((m) => m.tag).sort();
  ok('sends: latest feed per baby, latest per no-baby group, latest pump, the visit, both medicines',
     JSON.stringify(sends) === JSON.stringify(['f-late', 'f-nobaby2', 'f-twin', 'med-1', 'med-2', 'p2', 'v1']), sends);
  ok('the rest of the due ones are dropped (and so advance the cursor)',
     JSON.stringify(drops) === JSON.stringify(['f-early', 'f-mid', 'f-nobaby', 'p1']), drops);
  ok('a future entry is not in the plan at all (wait)', !plan.some((m) => m.tag === 'f-future'), plan.map((m) => m.tag));
  ok('the plan is in fire order', plan.every((m, i) => !i || plan[i - 1].at <= m.at));
  ok('entries at or below sentUpTo are not reconsidered', !pushPlan(entries, prefs(), NOW, DAY_HOUR, [], UID, NOW - 5 * MIN).some((m) => m.at <= NOW - 5 * MIN));
  // The slot goes to the latest SENDABLE entry. Here b1's newer feed cancels every b1 entry; the twin still goes.
  const plan2 = pushPlan(entries, prefs(), NOW, DAY_HOUR, [ev({ time: NOW - HR })], UID, 0);
  const s2 = plan2.filter((m) => !m.drop).map((m) => m.tag);
  ok('a logged feed for b1 drops every b1 feed and leaves the twin', !s2.some((t) => /^f-(early|mid|late)$/.test(t)) && s2.includes('f-twin'), s2);
}

console.log('\n9. the events read is only paid for when a feed or pump is live this tick');
{
  ok('nothing but medicine => no read', pushEventsSince([{ at: NOW - MIN, cat: 'critical' }], prefs(), NOW, DAY_HOUR, UID, 0) == null);
  ok('a feed with no consent => no read', pushEventsSince([feed()], prefs({ allow: {} }), NOW, DAY_HOUR, UID, 0) == null);
  ok('a feed in quiet hours => no read', pushEventsSince([feed()], prefs(), NOW, NIGHT_HOUR, UID, 0) == null);
  ok('a future feed => no read', pushEventsSince([feed({ at: NOW + MIN })], prefs(), NOW, DAY_HOUR, UID, 0) == null);
  ok('a visit never needs one', pushEventsSince([visit()], prefs(), NOW, DAY_HOUR, UID, 0) == null);
  ok('two live entries => one read from the earliest skipIfSince',
     pushEventsSince([feed({ skipIfSince: NOW - 2 * HR }), pump({ skipIfSince: NOW - 4 * HR })], prefs(), NOW, DAY_HOUR, UID, 0) === NOW - 4 * HR);
}

console.log('\n10. the Firestore event shape reads back as the verdict expects');
{
  const e = _fsEventPlain({ fields: { type: { stringValue: 'pump' }, babyId: { stringValue: 'b1' }, authorId: { stringValue: 'me' },
    time: { integerValue: String(NOW - HR) }, deleted: { booleanValue: true } } });
  ok('type, babyId, authorId, time and deleted', e.type === 'pump' && e.babyId === 'b1' && e.authorId === 'me' && e.time === NOW - HR && e.deleted === true, e);
  const e2 = _fsEventPlain({ fields: { type: { stringValue: 'feed' }, time: { doubleValue: NOW } } });
  ok('missing fields are empty, not undefined; deleted defaults false', e2.babyId === '' && e2.authorId === '' && e2.deleted === false && e2.time === NOW, e2);
}

console.log('\n11. the cron loop really runs these (source)');
{
  const loop = lift(SRC, 'sendPushReminders') || '';
  const plan = lift(SRC, 'pushPlan') || '';
  const since = lift(SRC, 'pushEventsSince') || '';
  const fre = lift(SRC, 'fsRecentEvents') || '';
  ok('sendPushReminders plans with pushPlan', /\bpushPlan\(/.test(loop));
  ok('sendPushReminders asks pushEventsSince before reading events', /\bpushEventsSince\(/.test(loop) && loop.indexOf('pushEventsSince(') < loop.indexOf('fsRecentEvents('));
  ok('and reads events only through the household gate', loop.indexOf('pushGate(') > -1 && loop.indexOf('pushGate(') < loop.indexOf('fsRecentEvents('));
  ok('pushPlan decides every entry with pushEntryVerdict', /\bpushEntryVerdict\(/.test(plan));
  ok('pushEventsSince asks the same verdict', /\bpushEntryVerdict\(/.test(since));
  ok('the old inline staleness rule is gone from the loop', !loop.includes('const stale = due != null'));
  ok('the events read selects authorId', /'authorId'/.test(fre));
  ok('only a medicine entry can mint a dose ticket', /isCrit && msg\.medId/.test(loop));
  ok('a parent who silenced medicine but chose feeds is still reached', /criticalOff && !optedIn/.test(loop));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
console.log(fail ? 'PUSH-REMINDER-CATS: FAIL' : 'PUSH-REMINDER-CATS: PASS');
process.exit(fail ? 1 : 0);
