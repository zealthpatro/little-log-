/* The caps, proved rather than trusted.
 *
 * Policy (founder, 2026-08-13): every intended push must arrive; marketing is capped at 2 a month
 * and only for non-paying users; feature nudges at 5 a month; critical (a medicine dose) is never
 * capped at all. The cap is enforced in the Worker because a cap the user can edit is not a cap:
 * firestore.rules grants a signed-in user blanket write over their own users/{uid}, so a counter
 * kept there could simply be reset. pushLedger/{uid} and campaigns/{id} are therefore denied to
 * every client and only the service account can move them.
 *
 * This is a behavioural mirror of deliverCampaign in worker.js, driven by stubs so every branch is
 * reachable without a service account or a real FCM. The source assertions at the bottom keep the
 * mirror honest: rewrite the real function and they fail rather than letting this file quietly
 * describe code that no longer exists.
 *
 *   node test/push-caps.test.js
 */
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); } };

const PUSH_CAP = { marketing: 2, feature: 5 };
const inQuiet = (hr, qs, qe) => (qs == null || qe == null || qs === qe) ? false : (qs < qe ? (hr >= qs && hr < qe) : (hr >= qs || hr < qe));
function ymFor(tz, now) {
  const d = new Date(now);
  if (tz) { try {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).formatToParts(d);
    const y = p.find(x => x.type === 'year'), m = p.find(x => x.type === 'month');
    if (y && m) return y.value + '-' + m.value;
  } catch (e) {} }
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}
function hourIn(tz, now) {
  if (!tz) return null;
  try { const n = parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date(now)), 10); return isNaN(n) ? null : n; }
  catch (e) { return null; }
}

/* Mirrors worker.js deliverCampaign. `world` carries the user, their ledger, household Pro state
   and whether FCM accepts. Returns the same verdict strings the Worker counts. */
function deliver({ camp, user, ledger, pro, fcmOk = true, now }) {
  const push = user.push;
  if (!push || !push.enabled) return 'off';
  const tokens = Object.keys(push.tokens || {});
  if (!tokens.length) return 'off';
  if (!(push.allow && push.allow[camp.cat] === true)) return 'noConsent';

  const tz = push.tz || '';
  const hr = hourIn(tz, now);
  if (hr != null && inQuiet(hr, push.quietStart, push.quietEnd)) return 'quiet';
  if (hr == null && camp.cat !== 'critical') return 'quiet';

  if (camp.nonPayingOnly && pro) return 'paying';

  if (ledger.sends && ledger.sends[camp.id]) return 'already';
  const ym = ymFor(tz, now);
  const used = (ledger.caps && ledger.caps.ym === ym && ledger.caps[camp.cat]) || 0;
  const limit = PUSH_CAP[camp.cat];
  if (limit != null && used >= limit) return 'capped';

  if (!fcmOk) return 'failed';

  const prev = (ledger.caps && ledger.caps.ym === ym) ? ledger.caps : { ym };
  ledger.caps = Object.assign({}, prev, { ym });
  ledger.caps[camp.cat] = ((prev[camp.cat] || 0) + 1);
  ledger.sends = Object.assign({}, ledger.sends, { [camp.id]: { at: now } });
  return 'sent';
}

const TZ = 'Asia/Dubai';
const NOW = Date.UTC(2026, 7, 13, 10, 0, 0);          // 13 Aug 2026, 14:00 in Dubai: well awake
const NIGHT = Date.UTC(2026, 7, 13, 22, 0, 0);        // 02:00 in Dubai
const user = (over) => Object.assign({
  householdId: 'hh1',
  push: { enabled: true, tokens: { tk: {} }, tz: TZ, quietStart: 21, quietEnd: 7,
          allow: { critical: true, feature: true, marketing: true } }
}, over || {});
// mirrors the Worker: marketing always excludes Pro; a feature nudge goes to everyone.
const camp = (cat, id, over) => Object.assign({ id: id || (cat + '1'), cat, title: 't', body: 'b', nonPayingOnly: cat === 'marketing' }, over || {});

(async () => {
  console.log('\n1. marketing stops at 2 a month');
  {
    const led = {}; const u = user(); const out = [];
    for (let i = 1; i <= 4; i++) out.push(deliver({ camp: camp('marketing', 'm' + i), user: u, ledger: led, pro: false, now: NOW }));
    ok('the first two go', out[0] === 'sent' && out[1] === 'sent', out);
    ok('the third is capped', out[2] === 'capped', out);
    ok('and so is the fourth', out[3] === 'capped', out);
    ok('the counter reads exactly 2', led.caps.marketing === 2, led.caps);
  }

  console.log('\n2. feature nudges stop at 5 a month');
  {
    const led = {}; const u = user(); const out = [];
    for (let i = 1; i <= 6; i++) out.push(deliver({ camp: camp('feature', 'f' + i), user: u, ledger: led, pro: false, now: NOW }));
    ok('five go', out.slice(0, 5).every(x => x === 'sent'), out);
    ok('the sixth is capped', out[5] === 'capped', out);
    ok('the counter reads exactly 5', led.caps.feature === 5, led.caps);
  }

  console.log('\n3. the two budgets are independent');
  {
    const led = {}; const u = user();
    for (let i = 1; i <= 2; i++) deliver({ camp: camp('marketing', 'm' + i), user: u, ledger: led, pro: false, now: NOW });
    const f = deliver({ camp: camp('feature', 'f1'), user: u, ledger: led, pro: false, now: NOW });
    ok('a spent marketing budget does not block a feature nudge', f === 'sent', { f, caps: led.caps });
  }

  console.log('\n4. a paying user never gets marketing');
  {
    const led = {}; const u = user();
    ok('Pro is refused', deliver({ camp: camp('marketing'), user: u, ledger: led, pro: true, now: NOW }) === 'paying');
    ok('and it costs them nothing from the budget', !led.caps || !led.caps.marketing, led.caps);
    ok('but Pro still receives a feature nudge',
       deliver({ camp: camp('feature'), user: u, ledger: led, pro: true, now: NOW }) === 'sent');
  }

  console.log('\n5. consent is required, per category, and silence is not consent');
  {
    const led = {};
    const noMkt = user({ push: Object.assign({}, user().push, { allow: { critical: true, feature: true, marketing: false } }) });
    ok('marketing off means nothing is sent', deliver({ camp: camp('marketing'), user: noMkt, ledger: led, pro: false, now: NOW }) === 'noConsent');
    const silent = user({ push: Object.assign({}, user().push, { allow: { critical: true } }) });
    ok('an absent category is NOT consent', deliver({ camp: camp('marketing'), user: silent, ledger: led, pro: false, now: NOW }) === 'noConsent');
    ok('nothing was counted against them', !led.caps, led.caps);
  }

  console.log('\n6. critical is never capped');
  {
    const led = { caps: { ym: ymFor(TZ, NOW), marketing: 99, feature: 99 } };
    const u = user();
    // A dose reminder does not travel this path at all (it is the client-authored queue), but the
    // cap table must have no entry for it, or a future refactor could quietly start capping doses.
    ok('there is no cap defined for critical', PUSH_CAP.critical === undefined, PUSH_CAP);
    const src = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8');
    ok('campaigns can never be critical', src.includes("if (cat !== 'marketing' && cat !== 'feature') continue;"));
  }

  console.log('\n7. quiet hours defer, and do NOT spend the slot');
  {
    const led = {}; const u = user();
    ok('a 2am marketing push is refused', deliver({ camp: camp('marketing'), user: u, ledger: led, pro: false, now: NIGHT }) === 'quiet');
    ok('the budget is untouched, so it still goes later', !led.caps, led.caps);
    ok('and the same campaign sends in the morning',
       deliver({ camp: camp('marketing'), user: u, ledger: led, pro: false, now: NOW }) === 'sent');
  }
  {
    const led = {};
    const noTz = user({ push: Object.assign({}, user().push, { tz: '' }) });
    ok('no timezone means defer, never guess', deliver({ camp: camp('marketing'), user: noTz, ledger: led, pro: false, now: NOW }) === 'quiet');
  }

  console.log('\n8. a campaign reaches a user at most once, ever');
  {
    const led = {}; const u = user();
    ok('first delivery', deliver({ camp: camp('feature', 'launch'), user: u, ledger: led, pro: false, now: NOW }) === 'sent');
    ok('a resumed fan-out does not send it twice',
       deliver({ camp: camp('feature', 'launch'), user: u, ledger: led, pro: false, now: NOW }) === 'already');
    ok('and the second attempt did not consume a second slot', led.caps.feature === 1, led.caps);
  }

  console.log('\n9. a failed send costs nothing, so the retry still has its slot');
  {
    const led = {}; const u = user();
    ok('FCM refusing is reported', deliver({ camp: camp('marketing'), user: u, ledger: led, pro: false, fcmOk: false, now: NOW }) === 'failed');
    ok('no slot spent', !led.caps, led.caps);
    ok('no send recorded, so it is retryable', !led.sends, led.sends);
    ok('the retry lands', deliver({ camp: camp('marketing'), user: u, ledger: led, pro: false, now: NOW }) === 'sent');
  }

  console.log('\n10. the month rolls over in the USER\'s timezone');
  {
    const led = {}; const u = user();
    for (let i = 1; i <= 2; i++) deliver({ camp: camp('marketing', 'm' + i), user: u, ledger: led, pro: false, now: NOW });
    ok('capped inside the month', deliver({ camp: camp('marketing', 'm3'), user: u, ledger: led, pro: false, now: NOW }) === 'capped');
    const nextMonth = Date.UTC(2026, 8, 2, 10, 0, 0);
    ok('a new month restores the budget', deliver({ camp: camp('marketing', 'm3'), user: u, ledger: led, pro: false, now: nextMonth }) === 'sent');
    ok('and the counter restarted at 1', led.caps.marketing === 1 && led.caps.ym === '2026-09', led.caps);
  }
  {
    // 31 Aug 22:00 UTC is already 1 Sep in Dubai. Their month, not ours.
    const edge = Date.UTC(2026, 7, 31, 22, 0, 0);
    ok('the month key follows the user, not UTC', ymFor('Asia/Dubai', edge) === '2026-09' && ymFor('UTC', edge) === '2026-08',
       { dubai: ymFor('Asia/Dubai', edge), utc: ymFor('UTC', edge) });
  }

  console.log('\n11. a user with reminders off, or no token, gets nothing');
  {
    const led = {};
    ok('off', deliver({ camp: camp('marketing'), user: user({ push: Object.assign({}, user().push, { enabled: false }) }), ledger: led, pro: false, now: NOW }) === 'off');
    ok('no token', deliver({ camp: camp('marketing'), user: user({ push: Object.assign({}, user().push, { tokens: {} }) }), ledger: led, pro: false, now: NOW }) === 'off');
  }

  console.log('\n12. the real worker.js and rules still work this way');
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8');
    ok('the caps are the founder\'s numbers', src.includes('const PUSH_CAP = { marketing: 2, feature: 5 };'));
    ok('consent is required and absence is not consent', src.includes("allow[camp.cat].booleanValue === true"));
    ok('the counter is only written after a real delivery', src.indexOf("if (!anyOk) return 'failed';") < src.indexOf('const newCaps'));
    ok('a campaign is idempotent per user', src.includes("if (sends && sends[camp.id]) return 'already';"));
    ok('quiet hours are evaluated in the user timezone', src.includes('_hourIn(tz, now)'));
    ok('a missing timezone defers rather than guessing', src.includes("if (hr == null && camp.cat !== 'critical') return 'quiet';"));
    ok('Pro is read from the household, not the user', src.includes("'/households/' + encodeURIComponent(hid)"));
    ok('marketing excludes Pro by policy, not by an operator toggle', src.includes("cat === 'marketing' ? true :"));
    // the CALL, not the definition: indexOf found `async function sendCampaigns(...)` at the top
    ok('campaigns run after the critical queue', src.indexOf('await sendCampaigns(env, base, token, now);') > src.indexOf('push_run'));
    ok('a broken campaign cannot take the medicine path down', src.includes("catch (e) { console.error('campaign_cron_fail'"));
    ok('critical respects an explicit opt-out only', src.includes("allowF.critical.booleanValue === false"));

    const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
    ok('no client may touch the cap ledger', /match \/pushLedger\/\{uid\} \{ allow read, write: if false; \}/.test(rules));
    ok('no client may touch campaigns', /match \/campaigns\/\{id\}\s+\{ allow read, write: if false; \}/.test(rules));

    const app = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
    ok('the client stamps its own queue as critical', app.includes("cat:'critical'"));
    ok('marketing is off until it is tapped', app.includes('c.allow[k]=(k!==\'marketing\')'));
    ok('the client sends its timezone', app.includes('tz:cfg.tz||\'\''));
    ok('opting out really deletes the tokens', app.includes('tokens:firebase.firestore.FieldValue.delete()'));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'PUSH-CAPS: FAIL' : 'PUSH-CAPS: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
