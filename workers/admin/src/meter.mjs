/* The admin's Firestore read budget (spec §4.7, S37).
 *
 * The families' project runs on the free plan, about 50,000 reads a day for EVERYTHING, and the funnel
 * snapshot already takes up to 15,000. The admin may spend at most ADMIN_DAILY_READ_BUDGET (default
 * 8,000) in a UTC day, metered in cubby-admin.admin_meta. Every request reserves its worst case first and
 * is refused if that would pass the budget; afterwards the reservation settles to what Firestore actually
 * billed. Past the budget the refresh stops for the day and every page says so. It never borrows.
 *
 * Every change to the count is ONE atomic statement on the meter's row, never a read-modify-write of a total
 * kept in memory: a reservation lands only if, at that instant, today's count plus it fits the budget, and a
 * settlement adds or subtracts a difference. So twenty requests at once (twenty isolates, the cron among
 * them) cannot each see the same room and all spend it (S37: the budget is never exceeded).
 */
export const utcDay = (t) => new Date(t).toISOString().slice(0, 10);

const USED = "COALESCE(json_extract(admin_meta.value, '$.used'), 0)";
const TODAY = "json_extract(admin_meta.value, '$.day') IS ?1";
/* ?1 day, ?2 n, ?3 budget, ?4 now. Inserts the day's row, or adds n to today's count, or starts today's
   count at n over yesterday's row; in every case only while the result stays within the budget. RETURNING
   gives the row back only when it landed. */
const RESERVE = "INSERT INTO admin_meta (key, value, at) "
  + "SELECT 'reads', json_object('day', ?1, 'used', ?2, 'paused', json('false'), 'budget', ?3), ?4 WHERE ?2 <= ?3 "
  + 'ON CONFLICT(key) DO UPDATE SET '
  + 'value = CASE WHEN ' + TODAY + " THEN json_set(admin_meta.value, '$.used', " + USED + " + ?2, '$.budget', ?3) "
  + "ELSE json_object('day', ?1, 'used', ?2, 'paused', json('false'), 'budget', ?3) END, at = ?4 "
  + 'WHERE (CASE WHEN ' + TODAY + ' THEN ' + USED + ' ELSE 0 END) + ?2 <= ?3 '
  + 'RETURNING value';
const PAUSE = "INSERT INTO admin_meta (key, value, at) VALUES ('reads', json_object('day', ?1, 'used', 0, 'paused', json('true'), 'budget', ?2), ?3) "
  + 'ON CONFLICT(key) DO UPDATE SET value = CASE WHEN ' + TODAY + " THEN json_set(admin_meta.value, '$.paused', json('true')) "
  + "ELSE json_object('day', ?1, 'used', 0, 'paused', json('true'), 'budget', ?2) END, at = ?3";
const SETTLE = "UPDATE admin_meta SET value = json_set(value, '$.used', MAX(0, COALESCE(json_extract(value, '$.used'), 0) + ?2)), at = ?3 "
  + "WHERE key = 'reads' AND json_extract(value, '$.day') IS ?1";

export async function openMeter(db, opts) {
  const now = opts.now;
  const budget = opts.budget;
  const day = utcDay(now());
  /* What the row said when this request opened it, kept current by what the row says after each change. For
     reading only: no decision is ever made from it. */
  let used = 0, paused = false;
  const seen = (value) => {
    try { const v = JSON.parse(value); if (v && v.day === day) { used = Number(v.used) || 0; paused = !!v.paused; } } catch (e) {}
  };
  const row = await db.prepare("SELECT value FROM admin_meta WHERE key = 'reads'").first();
  if (row) seen(row.value);

  async function reserve(n) {
    n = Math.max(1, Math.ceil(n));
    const r = await db.prepare(RESERVE).bind(day, n, budget, now()).first();
    if (r) { seen(r.value); return true; }
    await db.prepare(PAUSE).bind(day, budget, now()).run();
    paused = true;
    return false;
  }
  return {
    get used() { return used; },
    get paused() { return paused; },
    budget,
    day,
    reserve,
    /* For a page whose size can shrink: grant up to n, never past the budget. 0 means paused. The grant is
       itself an atomic reservation; if another request took the room meanwhile, ask again with what is left. */
    async reserveUpTo(n) {
      for (let attempt = 0; attempt < 6; attempt++) {
        const r = await db.prepare("SELECT value FROM admin_meta WHERE key = 'reads'").first();
        let left = budget;
        try { const v = r ? JSON.parse(r.value) : null; if (v && v.day === day) left = budget - (Number(v.used) || 0); } catch (e) {}
        if (left < 1) { await db.prepare(PAUSE).bind(day, budget, now()).run(); paused = true; return 0; }
        const g = Math.max(1, Math.min(Math.ceil(n), left));
        const got = await db.prepare(RESERVE).bind(day, g, budget, now()).first();
        if (got) { seen(got.value); return g; }
      }
      return 0;
    },
    /* Afterwards, to what Firestore actually billed: a difference, added in one statement. */
    async settle(reserved, actual) {
      const delta = Math.ceil(actual) - Math.max(1, Math.ceil(reserved));
      if (!delta) return;
      await db.prepare(SETTLE).bind(day, delta, now()).run();
      used = Math.max(0, used + delta);
    },
  };
}

/* For the pages: is today's budget spent, and when were the numbers last refreshed? */
export async function budgetState(db, now) {
  const out = { paused: false, used: 0, budget: 0, lastRefreshAt: 0, lastFullPassAt: 0, unrefreshed: 0 };
  try {
    const rows = ((await db.prepare("SELECT key, value, at FROM admin_meta WHERE key IN ('reads', 'last_refresh', 'daily')").all()).results) || [];
    for (const r of rows) {
      let v = null; try { v = JSON.parse(r.value); } catch (e) {}
      if (r.key === 'reads' && v && v.day === utcDay(now)) { out.paused = !!v.paused; out.used = v.used || 0; out.budget = v.budget || 0; }
      if (r.key === 'last_refresh') out.lastRefreshAt = Number(r.at) || 0;
      if (r.key === 'daily' && v && v.finishedAt) out.lastFullPassAt = Number(v.finishedAt) || 0;
      if (r.key === 'daily' && v) out.unrefreshed = v.phase === 'done' ? Number(v.failed) || 0 : Math.max(Number(v.failed) || 0, Number(v.lastFailed) || 0);
    }
  } catch (e) {}
  return out;
}
