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

module.exports = { leakyBucket, median };
