/* Pure, dependency-free funnel math for tools/analytics.js — kept separate so it can be unit-tested
   without Firebase. Given the already-loaded household rows (+ who registered for Pro / who invited a
   caregiver), it returns the activation "leaky bucket" plus the wedge/Pro conversions. */

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

// households: [{ id, ownerId, babies:[], events:N, activeDays:N, members:N, created:ms, firstLog:ms }]
// proOwnerUids: Set of owner uids that registered for Pro (the waitlist).
// invitedHhIds: Set of household ids that sent >=1 caregiver invite.
function leakyBucket(households, proOwnerUids, invitedHhIds) {
  const n = households.length;
  const countWhere = (f) => households.filter(f).length;

  // Activation funnel — these stages are genuinely NESTED (you must add a baby before you can log,
  // must log to have an active day, etc.), so `drop` = the relative % fall from the previous stage,
  // i.e. where the bucket leaks. The wedge/Pro outcomes are reported separately below because they
  // are not linear funnel stages (you can invite without being sticky).
  const defs = [
    ['Signed in (household created)', () => true],
    ['Added a baby', (h) => (h.babies || []).length > 0],
    ['Logged something (activated)', (h) => h.events > 0],
    ['Came back (day 2+)', (h) => h.activeDays >= 2],
    ['Sticky (7+ active days)', (h) => h.activeDays >= 7],
  ];
  let prev = n;
  const funnel = defs.map(([label, f], i) => {
    const count = countWhere(f);
    const pctTop = n ? Math.round((count / n) * 100) : 0;
    const drop = i === 0 ? 0 : (prev ? Math.round(((prev - count) / prev) * 100) : 0);
    prev = count;
    return { label, count, pctTop, drop };
  });

  // Time-to-activation: minutes from household creation to the first logged event.
  const ttfMins = households
    .filter((h) => h.events > 0 && h.created && h.firstLog && h.firstLog >= h.created)
    .map((h) => Math.round((h.firstLog - h.created) / 60000));
  const within = (mins) => ttfMins.filter((x) => x <= mins).length;

  // Key conversions (share of signed-in) — NOT funnel stages.
  const invitedHhs = households.filter((h) => invitedHhIds.has(h.id));
  const invitedAndJoined = invitedHhs.filter((h) => h.members > 1).length;

  return {
    n,
    funnel,
    activation: { medianMins: median(ttfMins), within1h: within(60), within24h: within(1440), n: ttfMins.length },
    conversions: {
      invited: invitedHhs.length,
      joined: countWhere((h) => h.members > 1),
      inviteToJoin: invitedHhs.length ? Math.round((invitedAndJoined / invitedHhs.length) * 100) : 0,
      pro: countWhere((h) => proOwnerUids.has(h.ownerId)),
    },
  };
}

/* RETENTION AND THE WEDGE.
 *
 * The leaky bucket above is a snapshot: it says how many households ever reached a stage, never
 * whether anyone came back. There is no time series anywhere in this repo, so "do parents stay"
 * has never been answerable, and it is the only question that decides whether Cubby works.
 *
 * Two things are computed here and they are deliberately different:
 *
 *   RETENTION is per household: did anyone log on a day inside the window after they signed up.
 *   Reported as D1/D7/D14/D30 over households old enough to have HAD that window, because counting
 *   a household that signed up yesterday as "failed D30" makes every cohort look worse the more
 *   recently you recruited.
 *
 *   THE WEDGE is stricter, and it is the actual product thesis: two DIFFERENT people logging into
 *   the same household on the same calendar day. Not "invited", not "joined", not "two members".
 *   A second caregiver who joins and never writes anything has not tested the idea. `joined` in
 *   the bucket above counts membership; this counts the thing membership was for.
 *
 * Takes rows carrying `evs: [{time, authorId}]`. A row without evs is skipped rather than counted
 * as a failure, so an older caller that does not supply them cannot silently deflate the numbers.
 */
function dayOf(ms) { const d = new Date(ms); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }

function retention(households, nowMs) {
  const now = nowMs || Date.now(), DAY = 86400000;
  const rows = households.filter((h) => Array.isArray(h.evs) && h.created);
  const windows = [1, 7, 14, 30];
  const out = windows.map((w) => {
    // Only households that have existed long enough for this window to have closed.
    const eligible = rows.filter((h) => now - h.created >= w * DAY);
    const kept = eligible.filter((h) => h.evs.some((e) => {
      const t = e.time; return t > h.created && t <= h.created + w * DAY;
    }));
    return { window: 'D' + w, eligible: eligible.length, kept: kept.length,
      pct: eligible.length ? Math.round((kept.length / eligible.length) * 100) : null };
  });
  return { windows: out, measurable: rows.length, skipped: households.length - rows.length };
}

function wedge(households, withinDays) {
  const DAY = 86400000, within = (withinDays == null ? 7 : withinDays) * DAY;
  const rows = households.filter((h) => Array.isArray(h.evs) && h.created);
  const hit = rows.filter((h) => {
    const byDay = new Map();
    for (const e of h.evs) {
      if (!e.authorId) continue;
      if (h.created && (e.time < h.created || e.time > h.created + within)) continue;
      const k = dayOf(e.time);
      if (!byDay.has(k)) byDay.set(k, new Set());
      byDay.get(k).add(e.authorId);
    }
    for (const s of byDay.values()) if (s.size >= 2) return true;
    return false;
  });
  // Also the looser lifetime version, so a household that took three weeks still shows up.
  const ever = rows.filter((h) => {
    const byDay = new Map();
    for (const e of h.evs) {
      if (!e.authorId) continue;
      const k = dayOf(e.time);
      if (!byDay.has(k)) byDay.set(k, new Set());
      byDay.get(k).add(e.authorId);
    }
    for (const s of byDay.values()) if (s.size >= 2) return true;
    return false;
  });
  return { measurable: rows.length, withinDays: withinDays == null ? 7 : withinDays,
    twoAuthorsSameDayInWindow: hit.length, twoAuthorsSameDayEver: ever.length };
}

module.exports = { leakyBucket, median, retention, wedge, dayOf };
