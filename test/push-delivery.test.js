/* The send cursor, proved rather than reasoned about.
 *
 * `push.sentUpTo` is a watermark: everything at or below it is finished and will never be sent
 * again. The bug this file exists to prevent is writing a watermark past a message that was never
 * delivered. It used to do exactly that: `maxAt` advanced while PLANNING, before any FCM call, and
 * sentUpTo was PATCHed regardless of what FCM returned, so a single transient 429/503 or a network
 * throw permanently consumed a dose reminder. No retry was possible, because from the cursor's point
 * of view the message had already gone out. Same shape as the fsDeleteAll bug in the purge path: a
 * failure read as "nothing to do".
 *
 * The rule now: the cursor may only pass a message we are DONE with, and done is two things.
 *   delivered - at least one token accepted it
 *   dropped   - we deliberately chose not to send it, because it is too late to be useful
 * Tried-and-failed is not done.
 *
 * This is a behavioural mirror of the loop in worker.js sendPushReminders, driven by a stub FCM so
 * every failure mode is reachable without a service account. The source assertions at the bottom are
 * what keep the mirror honest: if the real loop is rewritten, they fail and this file must be
 * revisited rather than quietly describing code that no longer exists.
 *
 *   node test/push-delivery.test.js
 */
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); } };

/* Mirrors the plan-then-send loop in worker.js. Kept in lockstep by the source assertions below.
   fcm(tag) -> true (accepted) | false (rejected/threw). */
function runTick({ due, sentUpTo, now, tokens, fcm }) {
  const plan = [];
  for (const f of due) {
    const at = f.at; if (at == null || at <= sentUpTo || at > now) continue;
    const stale = f.due != null ? (now > f.due) : (at < now - 20 * 60000);
    plan.push({ at, drop: stale, tag: f.tag });
  }
  plan.sort((a, b) => a.at - b.at);

  let maxAt = sentUpTo, stuck = false, sent = 0, failed = 0, dropped = 0;
  const attempted = [];
  for (const msg of plan) {
    if (msg.drop) { dropped++; if (!stuck) maxAt = msg.at; continue; }
    let anyOk = false;
    for (const tk of tokens) {
      attempted.push(msg.tag);
      if (fcm(msg.tag, tk)) { anyOk = true; sent++; }
    }
    if (anyOk) { if (!stuck) maxAt = msg.at; }
    else { failed++; stuck = true; }
  }
  return { sentUpTo: maxAt, sent, failed, dropped, attempted };
}

/* Fire times are relative to NOW so the fixtures are REALISTIC: a pre-dose reminder fires ~30 min
   ahead, so a live one has already fired (at < now) while its dose is still ahead (due > now). An
   earlier version of this file put `due` 30 min after `at` and `now` well beyond both, which made
   every fixture legitimately stale, and the drop path swallowed the cases it meant to test. */
const NOW = 1786000000000;   // a real epoch ms: small values make T(90) go negative, and a
                             // negative `at` is filtered as already-sent (at <= sentUpTo).
const T = (minsAgo) => NOW - minsAgo * 60000;
// fired `minsAgo` ago, dose still 20 minutes out: live, not stale. Bigger minsAgo = earlier.
const msg = (minsAgo, tag) => ({ at: T(minsAgo), due: NOW + 20 * 60000, tag });

(async () => {
  console.log('\n1. a failed send never advances the cursor');
  {
    const r = runTick({ due: [msg(10, 'med-a')], sentUpTo: 0, now: NOW, tokens: ['tk'], fcm: () => false });
    ok('cursor stays where it was', r.sentUpTo === 0, r);
    ok('the failure is counted', r.failed === 1 && r.sent === 0, r);
  }
  {
    const r = runTick({ due: [msg(10, 'med-a')], sentUpTo: 0, now: NOW, tokens: ['tk'], fcm: () => true });
    ok('a delivered message DOES advance it', r.sentUpTo === T(10), r);
  }

  console.log('\n2. the next tick retries the message that failed, and only that one');
  {
    const due = [msg(30, 'early'), msg(10, 'later')];   // early fires first
    const first = runTick({ due, sentUpTo: 0, now: NOW, tokens: ['tk'], fcm: (t) => t !== 'early' });
    ok('the failure freezes the cursor before it', first.sentUpTo === 0, first);
    ok('the later message is still attempted, not blocked behind it', first.attempted.includes('later'), first);
    const second = runTick({ due, sentUpTo: first.sentUpTo, now: NOW, tokens: ['tk'], fcm: () => true });
    ok('the retry re-sends the failed one', second.attempted.includes('early'), second);
    ok('and the cursor now clears both', second.sentUpTo === T(10), second);
  }

  console.log('\n3. a delivered message behind a failed one is not skipped forever');
  {
    // The trade we accept: the later message may repeat once. The FCM `tag` collapses a repeat in
    // the OS notification centre. Silently dropping a dose reminder is the worse of the two.
    const due = [msg(30, 'early'), msg(10, 'later')];
    const r = runTick({ due, sentUpTo: 0, now: NOW, tokens: ['tk'], fcm: (t) => t !== 'early' });
    ok('the later one went out even though the earlier failed', r.sent === 1, r);
    ok('but the cursor did not pass it either, so it stays retryable', r.sentUpTo < T(10), r);
  }

  console.log('\n4. a deliberate drop is done, and advances');
  {
    // Past its dose time: we choose not to nudge someone toward a dose they should no longer take.
    const stale = { at: T(90), due: NOW - 60 * 60000, tag: 'med-late' };   // dose time already gone
    const r = runTick({ due: [stale], sentUpTo: 0, now: NOW, tokens: ['tk'], fcm: () => { throw new Error('must not send'); } });
    ok('a late dose reminder is never sent', r.sent === 0, r);
    ok('it is counted as dropped, not silently consumed', r.dropped === 1, r);
    ok('and the cursor advances so it is not reconsidered forever', r.sentUpTo === T(90), r);
  }
  {
    const staleDigest = { at: NOW - 25 * 60000, due: null, tag: 'digest' };  // no due, >20 min old
    const r = runTick({ due: [staleDigest], sentUpTo: 0, now: NOW, tokens: ['tk'], fcm: () => { throw new Error('must not send'); } });
    ok('a stale digest is dropped too', r.dropped === 1 && r.sent === 0, r);
  }

  console.log('\n5. multi-token: one good token is enough to call it delivered');
  {
    const r = runTick({ due: [msg(10, 'm')], sentUpTo: 0, now: NOW, tokens: ['dead', 'live'], fcm: (t, tk) => tk === 'live' });
    ok('delivered when any token accepts', r.sentUpTo === T(10), r);
    ok('and it is not counted as a failure', r.failed === 0, r);
  }
  {
    const r = runTick({ due: [msg(10, 'm')], sentUpTo: 0, now: NOW, tokens: ['dead1', 'dead2'], fcm: () => false });
    ok('every token failing is a failure', r.failed === 1 && r.sentUpTo === 0, r);
  }

  console.log('\n6. fire order is respected regardless of array order');
  {
    // array order is deliberately scrambled; 'mid' fires between 'first' and 'last'
    const due = [msg(10, 'last'), msg(50, 'first'), msg(30, 'mid')];
    const r = runTick({ due, sentUpTo: 0, now: NOW, tokens: ['tk'], fcm: (t) => t !== 'mid' });
    ok('the cursor stops at the earliest failure, not the array position',
       r.sentUpTo === T(50), r);
  }

  console.log('\n7. THE GATE HAS TEETH — the old algorithm fails checks 1 and 2');
  {
    // Verbatim shape of the pre-fix loop: advance while planning, send afterwards, ignore the result.
    function oldTick({ due, sentUpTo, now, tokens, fcm }) {
      let maxAt = sentUpTo; const toSend = [];
      for (const f of due) {
        const at = f.at; if (at == null || at <= sentUpTo || at > now) continue;
        if (at > maxAt) maxAt = at;
        if (f.due != null) { if (now > f.due) continue; } else { if (at < now - 20 * 60000) continue; }
        toSend.push(f);
      }
      let sent = 0;
      for (const m of toSend) for (const tk of tokens) if (fcm(m.tag, tk)) sent++;
      return { sentUpTo: maxAt, sent };
    }
    const r = oldTick({ due: [msg(10, 'm')], sentUpTo: 0, now: NOW, tokens: ['tk'], fcm: () => false });
    ok('the old loop marks an undelivered message as sent (so this gate measures something)',
       r.sentUpTo === T(10) && r.sent === 0, r);
  }

  console.log('\n8. the real worker.js still works this way');
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8');
    ok('the cursor is frozen on an undelivered message', src.includes('else { failed++; stuck = true; }'));
    ok('only a delivered message advances it', src.includes('if (anyOk) { if (!stuck) maxAt = msg.at; }'));
    ok('a drop still advances it', src.includes('if (msg.drop) { dropped++; if (!stuck) maxAt = msg.at; continue; }'));
    ok('the plan is sorted into fire order before sending', src.includes('plan.sort((a, b) => a.at - b.at);'));
    ok('failures reach /api/health', src.includes('failed, dropped, userErrors'));
    ok('a run that delivered nothing is not reported healthy',
       src.includes('!(cron.failed > 0 && cron.sent === 0)'));
    ok('maxAt is no longer advanced during planning',
       !/if \(at > maxAt\) maxAt = at;[\s\S]{0,400}toSend\.push/.test(src));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'PUSH-DELIVERY: FAIL' : 'PUSH-DELIVERY: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
