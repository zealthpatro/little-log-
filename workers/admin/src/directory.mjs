/* The directory refresh: every 15 minutes, in this order (spec §4.7).
 *
 *   1. The Auth check. Identity Toolkit lists every account (no Firestore read). A uid Auth no longer has
 *      loses its dir_people row on this tick, and a household with nobody left loses every dir_* row,
 *      whatever the read budget says. A listing that fails part-way deletes NOTHING: a lookup failure
 *      never reads as "gone".
 *   2. The 15-minute pass: households whose updatedAt moved, masked. A freshness aid only: joins and
 *      departures do not stamp updatedAt, which is why 1 and 3 exist.
 *   3. The daily pass, in chunks. A cursor in admin_meta advances across ticks, each spending at most a
 *      fixed number of Google requests, so it fits Workers Free (50 subrequests a run; F10: the account
 *      is on Free) and finishes within a few hours of 00:00 UTC.
 *
 * Every Firestore read goes through the masked reader and the daily meter. When the meter says the
 * budget is spent, the refresh stops for the day and the pages say so.
 */
import { createReader, BudgetPaused, HH_FIELDS, DOC_ID } from '../../shared/fs-read.mjs';
import { listAccounts } from '../../shared/auth-read.mjs';
import { field, rawField } from '../../shared/fs-values.mjs';
import { dayKey } from '../../funnel/core.mjs';
import { openMeter, utcDay } from './meter.mjs';
import { reduceHousehold, sharedJourney, stageFrom, reduceEvents, reduceUser, reduceCaps } from './reduce.mjs';

const DAY = 86400000;
export const LIMITS = Object.freeze({ fetchesPerTick: 30, householdsPageSize: 50, incrementalLimit: 50, perHousehold: 7, keepDays: 90 });
export const PREG_FIELDS = ['ownerUid', 'sharedWith', 'data.stage', 'data.bornBabyId', 'data.birthAt'];
export const EVENT_FIELDS = ['time', 'authorId', 'type'];
export const USER_FIELDS = ['householdId', 'acq', 'referredBy', 'push.enabled', 'push.tz', 'push.quietStart', 'push.quietEnd', 'teamNotes'];

const code = (e) => String((e && (e.code || e.message)) || e).slice(0, 60);

async function getMeta(db, key) {
  const r = await db.prepare('SELECT value FROM admin_meta WHERE key = ?').bind(key).first();
  return r ? r.value : null;
}
const metaStmt = (db, key, value, at) => db.prepare('INSERT INTO admin_meta (key, value, at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, at = excluded.at').bind(key, value, at);

export function makeReader(cfg, deps, meter, counter) {
  return createReader({
    projectId: cfg.sa.project_id, getToken: deps.getToken, meter, base: deps.firestoreBase,
    fetchImpl: (...a) => { if (counter) counter.n++; return deps.fetchImpl(...a); },
  });
}

/* Statements that remove one household from the directory entirely (its number goes with it; the
   high-water mark in admin_meta means it is never handed out again). */
function dropHousehold(db, hid) {
  return [
    db.prepare('DELETE FROM dir_household_days WHERE hid = ?').bind(hid),
    db.prepare('UPDATE dir_people SET hid = NULL, name = NULL, relationship = NULL, role = NULL, joined_at = NULL, joined_source = NULL WHERE hid = ?').bind(hid),
    db.prepare('DELETE FROM dir_households WHERE hid = ?').bind(hid),
  ];
}

/* Each person's own side of membership: users/{uid}.householdId, masked to that one field (§5.1). The owner
   of a household may write ANY uid into its members map; the person's own users document is theirs alone.
   uid -> householdId, or null when the document or the field is missing. */
export async function readClaims(reader, uids) {
  const out = new Map();
  const list = [...new Set(uids)].filter((u) => DOC_ID.test(u));
  for (let i = 0; i < list.length; i += 100) {
    const docs = await reader.batchGet('user', list.slice(i, i + 100).map((u) => 'users/' + u), ['householdId']);
    for (const u of list.slice(i, i + 100)) {
      const v = field(docs.get('users/' + u), 'householdId');
      out.set(u, typeof v === 'string' && v ? v : null);
    }
  }
  return out;
}

/* One reduced household -> the statements that bring its directory rows to current state. A member is
   listed only when Auth has them (when this tick's listing succeeded) AND their own users/{uid}.householdId
   names this household: the members map alone is the owner's word. A household with nobody so listed is
   dropped rather than kept with nobody in it. */
export async function householdStatements(db, h, cfg, t, authUids, claims) {
  const members = h.members.filter((m) => (!authUids || authUids.has(m.uid)) && claims && claims.get(m.uid) === h.hid);
  if (!h.hid || !members.length) return { kept: false, stmts: h.hid ? dropHousehold(db, h.hid) : [] };
  const prev = await db.prepare('SELECT journey FROM dir_households WHERE hid = ?').bind(h.hid).first();
  const st = stageFrom({ journey: prev ? prev.journey : null, babies: h.babies, babyDetail: h.babyDetail });
  const internal = cfg.internal.has(h.ownerUid) ? 1 : 0;
  const stmts = [
    db.prepare('INSERT INTO dir_households (hid, display_no, owner_uid, owner_first_name, stage, stage_detail, babies, baby_detail, created_at, plan, deletion_pending, invited_json, is_internal, refreshed_at) '
      + "VALUES (?, (SELECT CAST(value AS INTEGER) FROM admin_meta WHERE key = 'display_no_next'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
      + 'ON CONFLICT(hid) DO UPDATE SET owner_uid = excluded.owner_uid, owner_first_name = excluded.owner_first_name, stage = excluded.stage, '
      + 'stage_detail = excluded.stage_detail, babies = excluded.babies, baby_detail = excluded.baby_detail, created_at = excluded.created_at, '
      + 'plan = excluded.plan, deletion_pending = excluded.deletion_pending, invited_json = excluded.invited_json, is_internal = excluded.is_internal, '
      + 'refreshed_at = excluded.refreshed_at')
      .bind(h.hid, h.ownerUid, h.ownerFirstName, st.stage, st.detail, h.babies, h.babyDetail, h.createdAt || null, h.plan,
        h.deletionPending ? 1 : 0, JSON.stringify(h.invited), internal, t),
    db.prepare("UPDATE admin_meta SET value = CAST((SELECT MAX(display_no) FROM dir_households) + 1 AS TEXT), at = ? "
      + "WHERE key = 'display_no_next' AND CAST(value AS INTEGER) <= (SELECT MAX(display_no) FROM dir_households)").bind(t),
  ];
  for (const m of members) {
    stmts.push(db.prepare('INSERT INTO dir_people (uid, hid, name, relationship, role, joined_at, joined_source, is_internal, refreshed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) '
      + 'ON CONFLICT(uid) DO UPDATE SET hid = excluded.hid, name = excluded.name, relationship = excluded.relationship, role = excluded.role, '
      + 'joined_at = excluded.joined_at, joined_source = excluded.joined_source, is_internal = excluded.is_internal, refreshed_at = excluded.refreshed_at')
      .bind(m.uid, h.hid, m.name, m.relationship, m.role, m.joinedAt || null, m.joinedSource, cfg.internal.has(m.uid) ? 1 : 0, t));
  }
  const keep = members.map((m) => m.uid);
  stmts.push(db.prepare('UPDATE dir_people SET hid = NULL, name = NULL, relationship = NULL, role = NULL, joined_at = NULL, joined_source = NULL '
    + 'WHERE hid = ? AND uid NOT IN (' + keep.map(() => '?').join(', ') + ')').bind(h.hid, ...keep));
  return { kept: true, stmts };
}

/* 1. The Auth check. */
export async function applyAuth(db, accounts, cfg, t) {
  const have = (((await db.prepare('SELECT uid FROM dir_people').all()).results) || []).map((r) => r.uid);
  const gone = have.filter((u) => !accounts.has(u));
  const stmts = [];
  for (const a of accounts.values()) {
    stmts.push(db.prepare('INSERT INTO dir_people (uid, email, email_verified, signed_up_at, providers, is_internal, refreshed_at) VALUES (?, ?, ?, ?, ?, ?, ?) '
      + 'ON CONFLICT(uid) DO UPDATE SET email = excluded.email, email_verified = excluded.email_verified, signed_up_at = excluded.signed_up_at, '
      + 'providers = excluded.providers, is_internal = excluded.is_internal, refreshed_at = excluded.refreshed_at')
      .bind(a.uid, a.email || null, a.emailVerified ? 1 : 0, a.createdAt || null, a.providers.join(','), cfg.internal.has(a.uid) ? 1 : 0, t));
  }
  for (let i = 0; i < gone.length; i += 90) {
    const chunk = gone.slice(i, i + 90);
    stmts.push(db.prepare('DELETE FROM dir_people WHERE uid IN (' + chunk.map(() => '?').join(', ') + ')').bind(...chunk));
  }
  const orphan = 'SELECT hid FROM dir_households WHERE hid NOT IN (SELECT DISTINCT hid FROM dir_people WHERE hid IS NOT NULL)';
  stmts.push(db.prepare('DELETE FROM dir_household_days WHERE hid IN (' + orphan + ')'));
  stmts.push(db.prepare('DELETE FROM dir_households WHERE hid IN (' + orphan + ')'));
  for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));
  return { accounts: accounts.size, removed: gone.length };
}

/* 2. The 15-minute pass. */
async function incremental(db, reader, cfg, t, authUids, room) {
  const cur = Number(await getMeta(db, 'cursor_updated')) || 0;
  if (!cur) { await metaStmt(db, 'cursor_updated', String(t), t).run(); return 0; }
  if (!room(3)) return 0;
  const docs = await reader.query('households', 'households', HH_FIELDS, {
    where: [{ field: 'updatedAt', op: 'GREATER_THAN', value: { timestampValue: new Date(cur).toISOString() } }],
    orderBy: [{ field: 'updatedAt', direction: 'ASCENDING' }], limit: LIMITS.incrementalLimit,
  });
  const reduced = docs.map((d) => reduceHousehold(d, t));
  const claims = await readClaims(reader, reduced.flatMap((h) => h.members.map((m) => m.uid)).filter((u) => !authUids || authUids.has(u)));
  /* A short page because the budget granted fewer: the cursor stops at what was read; the rest waits. */
  let max = cur;
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i], h = reduced[i];
    const { stmts } = await householdStatements(db, h, cfg, t, authUids, claims);
    if (stmts.length) await db.batch(stmts);
    const u = Number(field(d, 'updatedAt')) || 0;
    if (u > max) max = u;
  }
  await metaStmt(db, 'cursor_updated', String(max), t).run();
  return docs.length;
}

/* 3b. One household's detail: the shared journey, the last 7 days of entries (masked to time, authorId,
   type; reduced on the spot), a count, and its members' settings. */
async function detailOne(db, reader, cfg, t, hid) {
  const row = await db.prepare('SELECT hid, babies, baby_detail FROM dir_households WHERE hid = ?').bind(hid).first();
  if (!row) return;
  const members = (((await db.prepare('SELECT uid FROM dir_people WHERE hid = ?').bind(hid).all()).results) || []).map((r) => r.uid);
  const memberSet = new Set(members);
  const preg = await reader.list('pregnancy', 'households/' + hid + '/pregnancy', PREG_FIELDS, { pageSize: 20 });
  const journey = sharedJourney(preg.docs, memberSet);
  const since = Date.parse(utcDay(t - 6 * DAY));
  const docs = [];
  let after = null;
  for (let i = 0; i < 5; i++) {
    const page = await reader.query('events', 'households/' + hid + '/events', EVENT_FIELDS, {
      where: [{ field: 'time', op: 'GREATER_THAN_OR_EQUAL', value: { integerValue: String(since) } }],
      orderBy: [{ field: 'time', direction: 'ASCENDING' }], limit: 200, startAfter: after,
    });
    docs.push(...page);
    if (page.length < page.limit) break;
    after = [rawField(page[page.length - 1], 'time')];
  }
  const ev = reduceEvents(docs);
  docs.length = 0;
  const total = await reader.count('tally', 'households/' + hid + '/events');
  let lastDay = ev.lastDay;
  if (!lastDay && total > 0) {
    const q = await reader.query('events', 'households/' + hid + '/events', ['time'], { orderBy: [{ field: 'time', direction: 'DESCENDING' }], limit: 1 });
    const tm = q[0] ? Number(field(q[0], 'time')) : 0;
    if (tm) lastDay = dayKey(tm);
  }
  const users = await reader.batchGet('user', members.map((u) => 'users/' + u), USER_FIELDS);
  const wl = await reader.batchGet('waitlist', members.map((u) => 'waitlist/' + u), ['uid']);
  const st = stageFrom({ journey, babies: row.babies, babyDetail: row.baby_detail });
  const sinceDay = utcDay(since);
  const stmts = [
    db.prepare('UPDATE dir_households SET journey = ?, stage = ?, stage_detail = ?, last_entry_day = CASE WHEN ? IS NOT NULL AND (last_entry_day IS NULL OR last_entry_day < ?) THEN ? ELSE last_entry_day END, '
      + 'entries_total = ?, authors_7d = ?, kinds_7d = ?, waitlisted = ?, refreshed_at = ? WHERE hid = ?')
      .bind(journey, st.stage, st.detail, lastDay, lastDay, lastDay, total, ev.authors7, JSON.stringify(ev.kinds),
        [...wl.values()].some(Boolean) ? 1 : 0, t, hid),
    db.prepare('DELETE FROM dir_household_days WHERE hid = ? AND day >= ?').bind(hid, sinceDay),
  ];
  for (const d of ev.days) stmts.push(db.prepare('INSERT INTO dir_household_days (day, hid, entries, authors) VALUES (?, ?, ?, ?)').bind(d.day, hid, d.entries, d.authors));
  for (const uid of members) {
    const doc = users.get('users/' + uid);
    if (!doc) continue;
    const u = reduceUser(doc);
    stmts.push(db.prepare('UPDATE dir_people SET acq_source = ?, acq_content = ?, referred = ?, push_on = ?, quiet = ?, tz = ?, team_notes = ?, refreshed_at = ? WHERE uid = ?')
      .bind(u.acqSource, u.acqContent, u.referred, u.pushOn, u.quiet, u.tz, u.teamNotes, t, uid));
  }
  await db.batch(stmts);
}

/* 3. The daily pass, one chunk. */
async function dailyChunk(db, reader, cfg, t, authUids, room) {
  const today = utcDay(t);
  let st = null;
  try { st = JSON.parse(await getMeta(db, 'daily')); } catch (e) {}
  if (!st || (st.phase === 'done' && st.day !== today) || st.day < utcDay(t - 2 * DAY)) {
    /* `failed`: households this pass could not refresh. The last finished pass's count stays on the pages
       until this one passes it, so the warning does not blink off each midnight. */
    const lastFailed = st ? (st.phase === 'done' ? st.failed || 0 : st.lastFailed || 0) : 0;
    st = { day: today, phase: 'households', pageToken: '', seen: [], queue: [], failed: 0, lastFailed, startedAt: t, finishedAt: st && st.finishedAt || 0 };
  }
  const save = () => metaStmt(db, 'daily', JSON.stringify(st), t).run();
  if (st.phase === 'done') return { phase: 'done' };
  while (st.phase === 'households') {
    if (!room(3)) { await save(); return { phase: st.phase, partial: true }; }
    const page = await reader.list('households', 'households', HH_FIELDS, { pageSize: LIMITS.householdsPageSize, pageToken: st.pageToken });
    const reduced = page.docs.map((d) => reduceHousehold(d, t)).sort((a, b) => (a.createdAt || 9e15) - (b.createdAt || 9e15));
    const claims = await readClaims(reader, reduced.flatMap((h) => h.members.map((m) => m.uid)).filter((u) => !authUids || authUids.has(u)));
    for (const h of reduced) {
      const { kept, stmts } = await householdStatements(db, h, cfg, t, authUids, claims);
      if (stmts.length) await db.batch(stmts);
      if (kept) {
        st.seen.push(h.hid);
        /* An id the masked reader refuses by path can never be read in detail: count it, do not queue it. */
        if (DOC_ID.test(h.hid)) st.queue.push(h.hid); else st.failed = (st.failed || 0) + 1;
      }
    }
    st.pageToken = page.nextPageToken;
    if (!st.pageToken) {
      /* The full listing finished: a household the directory holds that Firestore no longer has is gone. */
      const seen = new Set(st.seen);
      const have = (((await db.prepare('SELECT hid FROM dir_households').all()).results) || []).map((r) => r.hid);
      const stmts = [];
      for (const hid of have) if (!seen.has(hid)) stmts.push(...dropHousehold(db, hid));
      if (stmts.length) await db.batch(stmts);
      st.phase = 'detail'; st.seen = [];
    }
    await save();
  }
  while (st.phase === 'detail') {
    if (!st.queue.length) { st.phase = 'done'; st.finishedAt = t; await save(); break; }
    if (!room(LIMITS.perHousehold)) { await save(); return { phase: st.phase, partial: true, left: st.queue.length }; }
    /* One household's failure is that household's: it is taken off the queue and counted, and the pass goes
       on for everyone else. A spent read budget is not a failure: it propagates, and the household stays
       first in the queue for when there is budget again. */
    try { await detailOne(db, reader, cfg, t, st.queue[0]); }
    catch (e) {
      if (e instanceof BudgetPaused) throw e;
      st.failed = (st.failed || 0) + 1;
      console.error('admin_detail_fail', code(e));
    }
    st.queue.shift();
    await save();
  }
  return { phase: st.phase };
}

export async function runTick(cfg, deps) {
  const t = deps.now();
  const db = cfg.db;
  const counter = { n: 0 };
  const limit = (deps.limits && deps.limits.fetchesPerTick) || LIMITS.fetchesPerTick;
  const room = (n) => counter.n + n <= limit;
  const report = { auth: null, incremental: 0, daily: null, paused: false };
  const meter = await openMeter(db, { budget: cfg.budget, now: deps.now });
  const reader = makeReader(cfg, deps, meter, counter);

  let authUids = null;
  try {
    const accounts = await listAccounts({ projectId: cfg.sa.project_id, getToken: deps.getToken, base: deps.authBase,
      fetchImpl: (...a) => { counter.n++; return deps.fetchImpl(...a); } });
    authUids = new Set(accounts.keys());
    report.auth = await applyAuth(db, accounts, cfg, t);
  } catch (e) { report.auth = { error: code(e) }; }

  try { report.incremental = await incremental(db, reader, cfg, t, authUids, room); }
  catch (e) { if (e instanceof BudgetPaused) report.paused = true; else report.incrementalError = code(e); }

  if (!report.paused) {
    try { report.daily = await dailyChunk(db, reader, cfg, t, authUids, room); }
    catch (e) { if (e instanceof BudgetPaused) report.paused = true; else report.dailyError = code(e); }
  }

  await db.prepare('DELETE FROM dir_household_days WHERE day < ?').bind(utcDay(t - LIMITS.keepDays * DAY)).run();
  const progressed = !report.auth.error || report.incremental || (report.daily && !report.dailyError);
  if (progressed) await metaStmt(db, 'last_refresh', JSON.stringify({ paused: report.paused }), t).run();
  if (!(await getMeta(db, 'directory_started'))) await metaStmt(db, 'directory_started', utcDay(t), t).run();
  report.fetches = counter.n;
  return report;
}

/* On demand: opening a household reads it fresh (1 + its members, plus two counts), inside the same
   budget. Returns what it could; a paused budget or an error falls back to the directory. */
export async function readHouseholdFresh(cfg, deps, hid, ym) {
  const meter = await openMeter(cfg.db, { budget: cfg.budget, now: deps.now });
  const reader = makeReader(cfg, deps, meter, null);
  const out = { household: null, users: new Map(), caps: new Map(), entries: null, photos: null, paused: false, failed: false };
  try {
    const doc = await reader.getDoc('household', 'households/' + hid, HH_FIELDS);
    if (!doc) return out;
    out.household = reduceHousehold(doc, deps.now());
    const uids = out.household.members.map((m) => m.uid);
    const users = await reader.batchGet('user', uids.map((u) => 'users/' + u), USER_FIELDS);
    for (const u of uids) { const d = users.get('users/' + u); if (d) out.users.set(u, reduceUser(d)); }
    const caps = await reader.batchGet('pushLedger', uids.map((u) => 'pushLedger/' + u), ['caps']);
    for (const u of uids) { const d = caps.get('pushLedger/' + u); out.caps.set(u, reduceCaps(d, ym)); }
    out.entries = await reader.count('tally', 'households/' + hid + '/events');
    out.photos = await reader.count('tally', 'households/' + hid + '/photos');
  } catch (e) {
    if (e instanceof BudgetPaused) out.paused = true; else out.failed = true;
  }
  return out;
}
