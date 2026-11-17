/* What the dashboard reads from cubby-usage (spec §9.1), and the one rule about whose rows it may read.
 *
 * READ ONLY, BY CODE. The main Worker is cubby-usage's only writer (spec §4.5). The admin reaches it only
 * through readOnly() below, which config.mjs wraps around USAGE_DB: a handle with prepare() and nothing else,
 * whose prepare() refuses any statement that is not a plain SELECT. test/admin-access-log.test.js §5 also
 * scans this file: no SQL string here may write.
 *
 * THE PHASE-2 RULE (spec §17, §2 G4, S45). Families have not been told what our team can see, so no
 * per-person activity about them is shown. Every read of a table that names a person (usage_events,
 * usage_daily's per-person rows, devices) is limited by usageScope() to the uids in INTERNAL_UIDS: the
 * founder's own accounts. Phase 3 widens usageScope() for the rows that name a person. "Hide our own
 * accounts" (on by default, S28) empties it, so until families are told every usage panel waits unless the
 * founder asks to see his own. The one read that names no person is journeyTotals(): pregnancy and trying
 * tools are stored only as daily totals with no uid and no household (§8.4, JOURNEY_KEYS), so their USES
 * can only be counted whole, for everyone the server stored, and the overview says so beside them. They
 * appear only beside a scope that is not empty, as a total, never per person; the households and people
 * beside them are counted inside the scope.
 *
 * F5 (spec Questions): a visit that logged or edited medicine or a health entry shows the hour of its start
 * only, in every view and CSV. Whether a visit did is final only once it has ENDED (its visit.ended row is
 * the last it sends), so a visit that has not ended shows the hour only too: its first batch, sent before
 * the dose, never lists its minute, in a page or in a CSV kept from that moment. No time that could stand
 * in for a dose visit's minute is shown either: not a later event's own hour, not a device's batch
 * arrival, and not the overview's "Saving and sync" line, which is read only from writes whose visits all
 * finished clean at a CLOSED moment (CLEAN_MOMENT below), so no batch that carries any row of a dose
 * visit, or of a visit still open, moves its time or its wording. Nor may the ORDER of rows give it away:
 * every list sorts by the time it shows, and an hour-only row sits at the start of its hour, after every
 * row with minutes in that hour, wherever its own minute fell. F5 is decided over the whole visit, never
 * over the rows a time window or a page happens to hold ("a visit, read whole" below).
 *   What F5 does not yet cover (F5 by arrival): everything but the saving line still changes when ANY
 * batch of a dose visit lands, so an observer who refreshes learns the arrival of each one. Its first
 * batch adds a row (hour only) and steps the counts, tiles and a device's last seen; the dose's own batch,
 * sent about 5 s after the tap, adds "logged a dose" to its row and steps the Medicine or Health rows of
 * "What people use" and "Who uses what" and the Usage events count, so it times the dose itself to about
 * 5 s; its end's batch adds the visit's length, so that arrival minus the length gives its start to the
 * second. "Failed saves, 7 days" and "Sign-in problems, 7 days" step with the batch that carries them.
 * And a window keyed on arrival also moves one window after a batch, so someone who did not watch that
 * batch land can still time it. A window that counts ROWS steps back one window after each batch that
 * carried one: "Failed saves" and "Sign-in problems", 7 days after the batch carrying the failure (the
 * household page's c7). A window that counts households, people or devices moves one window after the
 * LAST batch that kept each of them in it: "Active this week" and "Went quiet" (COUNT DISTINCT hid, and
 * MAX(at)) 7 days after a household's newest visit start; the households and people beside a pregnancy
 * or trying tool (journeyTotals, COUNT DISTINCT) 30 days after that household's, or that person's, newest
 * use of it; and the newest version (the devices seen in the last 24 hours, `fresh`) a day after the
 * newest batch of the last device on it, and only if another device was seen in that day. So a dose
 * visit's batch is timed again later when it carried a failure, held its household's newest visit start,
 * held a household's or a person's newest use of a pregnancy or trying tool, or (a day on) was the newest
 * batch from any device on the newest version. A batch that carries only the dose can do only the
 * last of these: the Medicine and Health rows count usage_daily by the family's own day. The saving
 * line's hour of failures is keyed on arrival too, but only on closed moments of clean visits, which time
 * no dose. Any phase-3 cutoff must align these windows to whole UTC days too, or each still moves at a
 * batch's arrival plus one window. docs/ADMIN-DEPLOY.md, "Phase 3 checklist", carries all of it as an
 * open question.
 *   One exception to "the hour of its start": a visit cut from its head (its visit.started row gone, or
 * never stored) may have lost its dose, so it is shown as if it had one, at the hour of its EARLIEST
 * STORED row. That hour can be later than its true start, and is a later event's own hour. It gives no
 * minute away only because such a visit carries no length: one that kept its visit.ended row (its length)
 * is not shown at all, in any list, count or CSV. Cuts happen. The 90-day retention and the erasure of a
 * deleted person or household take a visit whole when they can, but a day's delete allowance or a
 * statement's row limit can run out partway through one, and the retention also cuts a visit whose rows
 * arrived more than a day apart (an offline phone's later batches). Before any other row of a visit they
 * take its head (retention, workers/usage/core.mjs LINKED_VISITS) or its head or its end (erasure,
 * CUT_ORDER and HEADS_OF_HID), so what is left lacks its head, its end or both until a later run. The one
 * shape that order misses, a visit whose head arrived after some of its other rows, is one Cubby's own
 * tracker never sends (core.mjs, above retentionSteps). And a visit can arrive without its start (events
 * sent from the background, a first batch over the daily cap, or an offline phone's queue past 500 events,
 * which drops its oldest: app/cubby-track.js save). The order only makes sure a cut visit has lost its
 * head or its end; what keeps a dose visit's minute hidden after that is the rule here, SHOWN and
 * HOUR_ONLY: a headless visit that kept its end is not shown, a headless one without it shows the hour of
 * its earliest stored row, and one that lost only its end shows the hour of its start, like a visit still
 * open.
 *
 * S41: per person, the screens a no-baby owner's home paints as (her journey when she has one, shared or
 * not, and Getting started when she has none) are never shown, so a private journey and none look alike.
 *
 * Nothing is composed from a stored string: every name, prop, platform, version and time zone is checked
 * against the allowlist in workers/usage/core.mjs (the same one the server checked) before it leaves here.
 */
import { USAGE_EVENTS, FORMATS, JOURNEY_KEYS, PLATFORMS, SCREENS, FEATURES, validTz, localParts } from '../../usage/core.mjs';
import { utcDay } from './meter.mjs';

const DAY = 86400000;
const HOUR = 3600000;
const MINUTE = 60000;
export const USAGE_PAGE = 50;

/* ---------- read only ---------- */

const READ = /^\s*SELECT\b/i;
const WRITE = /\b(INSERT|UPDATE|DELETE|REPLACE|UPSERT|CREATE|DROP|ALTER|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX)\b/i;
export function readOnly(db) {
  return Object.freeze({
    prepare(sql) {
      if (typeof sql !== 'string' || !READ.test(sql) || WRITE.test(sql)) throw new Error('usage_read_only');
      return db.prepare(sql);
    },
  });
}

/* ---------- whose rows ---------- */

const NOBODY = Object.freeze({ uids: Object.freeze([]), empty: true, has: () => false, where: () => '0' });

/* HOW MANY UIDS A SCOPE MAY HOLD. D1 refuses a statement that binds more than 100 parameters ("too many SQL
   variables"); node:sqlite, under the tests' D1 shim, takes over 30,000, so only the real engine shows it
   (test/usage-d1-engine.test.js). Every read here binds the scope's uids, and the most any binds is three
   times over and one more (the saving line's e, o and p, and its hour): 3 x 33 + 1 = 100. So a scope holds
   SCOPE_MAX uids at most. A longer INTERNAL_UIDS reads as 'error' ("could not be read") in every usage
   panel, on every engine, instead of D1 refusing only the reads that bind the most while the rest show
   numbers. */
export const D1_MAX_BOUND = 100;
export const SCOPE_MAX = Math.floor((D1_MAX_BOUND - 1) / 3);
const TOO_MANY = Object.freeze({ uids: Object.freeze([]), empty: true, tooMany: true, has: () => false, where: () => '0' });

/* THE helper. Returns the uids whose usage rows this request may read, and the SQL that limits a query to
   them: `scope.where('uid')` with `...scope.uids` bound. Phase 2: INTERNAL_UIDS only, whatever any table
   holds; and nobody at all while "Hide our own accounts" is ticked. More than SCOPE_MAX: TOO_MANY, which
   reads nobody and makes each panel say it could not be read. */
export function usageScope(cfg, hideInternal) {
  if (!cfg || !cfg.usage || hideInternal) return NOBODY;
  const uids = Object.freeze([...(cfg.internal || [])].filter((u) => /^[A-Za-z0-9_-]{1,128}$/.test(u)).sort());
  if (!uids.length) return NOBODY;
  if (uids.length > SCOPE_MAX) return TOO_MANY;
  return Object.freeze({
    uids, empty: false,
    has: (u) => uids.includes(u),
    where: (col) => col + ' IN (' + uids.map(() => '?').join(', ') + ')',
  });
}

/* ---------- what may be shown of a stored value ---------- */

const ph = (n) => Array.from({ length: n }, () => '?').join(', ');
/* S41. A no-baby owner's home paints as her journey (pregnancy week or cycle) when she has one, shared with
   anyone or not, and as Getting started when she has none (app/index.html usageScreen). Journey keys are
   never shown per person (§8.4), so Getting started is not either: a visit that looked at Getting started,
   beside one that looked at nothing, would tell a private journey from none. Overview totals are not
   per person and are unchanged. */
export const PERSON_HIDDEN = Object.freeze([...JOURNEY_KEYS, 'onboarding']);
const NOT_HIDDEN = (c) => 'COALESCE(json_extract(' + c + "props, '$.screen'), '') NOT IN (" + ph(PERSON_HIDDEN.length) + ') AND COALESCE(json_extract('
  + c + "props, '$.feature'), '') NOT IN (" + ph(PERSON_HIDDEN.length) + ')';
const NJ = () => PERSON_HIDDEN.concat(PERSON_HIDDEN);
/* F5 (spec Questions): a visit that logged or edited medicine or a health entry shows the hour only, everywhere. */
export const HEALTH_FEATURES = Object.freeze(['medicine', 'health_log']);
const HEALTH = "name = 'feature.used' AND json_extract(props, '$.action') IN ('logged', 'edited') AND json_extract(props, '$.feature') IN ('medicine', 'health_log')";

export const isJourney = (k) => JOURNEY_KEYS.includes(k);
const hiddenPerPerson = (k) => PERSON_HIDDEN.includes(k);
export const okPlatform = (p) => (PLATFORMS.includes(p) ? p : null);
export const okVersion = (v) => (typeof v === 'string' && FORMATS.version.test(v) ? v : null);
export const okNative = (v) => (typeof v === 'string' && /^\d{1,3}(\.\d{1,3}){0,3}$/.test(v) ? v : null);
export const okTz = (tz) => (typeof tz === 'string' && validTz(tz) ? tz : 'UTC');
export const okVisit = (v) => (typeof v === 'string' && /^v_[a-z0-9]{8}$/.test(v) ? v : null);
export const okOs = (s) => (typeof s === 'string' && /^(iOS \d{1,2}\.\d{1,2}|Android \d{1,2}|macOS|Windows|Linux)$/.test(s) ? s : 'Other');
export const okBrowser = (s) => (['Chrome', 'Safari', 'Firefox', 'Edge'].includes(s) ? s : 'Other');
export const okScreen = (s) => (SCREENS.includes(s) && !hiddenPerPerson(s) ? s : null);
export const okFeature = (s) => (FEATURES.includes(s) && !hiddenPerPerson(s) ? s : null);
const vnum = (v) => (okVersion(v) ? Number(v.slice(1)) : -1);

function propOk(spec, v) {
  if (spec.enum) return typeof v === 'string' && spec.enum.includes(v);
  if (spec.int) return Number.isInteger(v) && v >= spec.int[0] && v <= spec.int[1];
  if (spec.format) return typeof v === 'string' && FORMATS[spec.format].test(v);
  return false;
}
/* An event's stored props, as the allowlisted [key, value] pairs they are. A key the allowlist does not
   name, or a value outside its list, bound or format, is dropped, never shown. */
export function keptProps(name, propsJson) {
  const spec = Object.prototype.hasOwnProperty.call(USAGE_EVENTS, name) ? USAGE_EVENTS[name] : null;
  if (!spec) return null;
  let p = {};
  try { p = JSON.parse(propsJson || '{}'); } catch (e) { return []; }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return [];
  const out = [];
  for (const k of Object.keys(spec.props)) {
    if (Object.prototype.hasOwnProperty.call(p, k) && propOk(spec.props[k], p[k]) && !hiddenPerPerson(p[k])) out.push([k, p[k]]);
  }
  return out;
}
const propsOf = (name, json) => Object.fromEntries(keptProps(name, json) || []);

/* ---------- small reads ---------- */

async function rows(db, sql, binds) {
  return ((await db.prepare(sql).bind(...binds).all()).results) || [];
}
async function one(db, sql, binds) {
  return (await db.prepare(sql).bind(...binds).first()) || {};
}
/* Does this scope hold any usage row at all? Until it does, every panel says "Waiting for usage events". */
export async function anyRows(cfg, scope) {
  if (scope.empty) return false;
  const r = await one(cfg.usage, 'SELECT 1 AS y FROM usage_events WHERE ' + scope.where('uid') + ' LIMIT 1', scope.uids);
  return r.y === 1;
}
/* ---------- a visit, read whole (F5) ----------
 * The tracker sends a batch 5 s after each event (app/cubby-track.js), so one visit reaches the server in
 * several batches, each with its own arrival time `at`. F5 is therefore decided over EVERY stored row of a
 * visit, never over the share of it that a time window, a page or a cutoff holds: a window cut by arrival
 * can hold a visit's feed and miss its dose. Per visit:
 *   health  it logged or edited medicine or a health entry (any stored row);
 *   headed  its visit.started row is stored. Retention and erasure take a visit whole only when they can,
 *           and a visit they cut loses its head (or, to an erasure, its head or its end) before any other
 *           row, but for the one shape the header names, which Cubby's tracker never sends. So one
 *           without its head may have lost the row that logged a dose. F5 cannot be decided for it, so it
 *           shows the hour only, as if it had: the hour of its earliest stored row (HEAD), which may be
 *           later than its true start (see the header);
 *   ended   its visit.ended row is stored. Until it is, the visit may still log a dose (its rows arrive in
 *           the order they were queued, app/cubby-track.js, and the end is queued last), so it shows the
 *           hour of its start only, like a dose visit, and gains its minute when its end lands clean. An
 *           erasure that took its end and left its head leaves it at that hour too. A visit that has lost
 *           its head but kept its end is not shown at all, in any list, count or CSV: its length is known
 *           (the row says it, and so did every view of it while it was whole), its true start is gone, and
 *           any hour of its own would be a later event's hour, which with that length gives the minute
 *           away. A later run of the retention or the erasure takes the rest.
 * HEAD is the visit's earliest stored row in one string that sorts by time: the client time zero-padded to
 * 15 digits, then the local day and hour the server stored with that row (core.mjs localParts), then its
 * time zone. Rows sort by that local day and hour, which is exactly what they show.
 * So a visit is SHOWN unless it lost its head and kept its end, and HOUR_ONLY when it had a dose or has not
 * ended. A shown visit that lost its head has no end, so HOUR_ONLY covers it without naming `headed`. */
const HEAD = "MIN(printf('%015d|%s|%02d|%s', client_at, local_day, local_hour, tz))";
const HEALTH_OF = 'MAX(CASE WHEN ' + HEALTH + ' THEN 1 ELSE 0 END)';
const HEADED_OF = "MAX(CASE WHEN name = 'visit.started' THEN 1 ELSE 0 END)";
const ENDED_OF = "MAX(CASE WHEN name = 'visit.ended' THEN 1 ELSE 0 END)";
/* `v` is the alias prefix of the visit facts ('' or 'v.'). */
const SHOWN = (v) => 'NOT (' + v + 'headed = 0 AND ' + v + 'ended = 1)';
const HOUR_ONLY = (v) => '(' + v + 'health = 1 OR ' + v + 'ended = 0)';
const hourOnlyOf = (r) => r.health === 1 || r.ended !== 1;   // HOUR_ONLY, for a row read back
/* Every visit in the scope, with its facts, one row each. */
const visitFacts = (S) => '(SELECT uid, visit, MAX(device) AS device, ' + HEAD + ' AS head, ' + HEALTH_OF + ' AS health, ' + HEADED_OF + ' AS headed, '
  + ENDED_OF + ' AS ended FROM usage_events WHERE ' + S + ' GROUP BY uid, visit)';
const HEAD_RE = /^(\d{15})\|(\d{4}-\d{2}-\d{2})\|(\d{2})\|(.*)$/;
/* A HEAD string as { at, bucket: 'YYYY-MM-DD|HH' (local), tz }. */
function parseHead(s) {
  const m = HEAD_RE.exec(String(s || ''));
  return m ? { at: Number(m[1]), bucket: m[2] + '|' + m[3], tz: okTz(m[4]) } : { at: NaN, bucket: '', tz: 'UTC' };
}
const pad2 = (n) => String(n).padStart(2, '0');
const bucketOf = (ms, tz) => { const p = localParts(ms, tz); return p.local_day + '|' + pad2(p.local_hour); };
/* The start of the local hour holding `ms` in `tz` (offsets are whole minutes, so seconds are UTC's). */
function hourStart(ms, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return ms - (Number(p.minute) * MINUTE + Number(p.second) * 1000 + (((ms % 1000) + 1000) % 1000));
}
/* The one order every list uses, newest first, by what each row SHOWS: its local day and hour; inside an
   hour, the rows with minutes by their time, then the hour-only rows (each sits at the start of its hour,
   wherever its own minute fell), visit by visit. `a` and `b` are { bucket, hourOnly, at, tie }. The SQL
   twins are VISIT_ORDER and EVENT_ORDER. */
export function newestFirst(a, b) {
  return (a.bucket < b.bucket ? 1 : (a.bucket > b.bucket ? -1 : 0))
    || ((a.hourOnly ? 1 : 0) - (b.hourOnly ? 1 : 0))
    || (a.hourOnly ? 0 : b.at - a.at)
    || (a.tie < b.tie ? -1 : (a.tie > b.tie ? 1 : 0));
}
const VISIT_ORDER = ' ORDER BY substr(head, 17, 13) DESC, ' + HOUR_ONLY('') + " ASC, CASE WHEN " + HOUR_ONLY('') + " THEN '' ELSE substr(head, 1, 15) END DESC, uid, visit";
/* An event of an hour-only visit sorts, and shows, at its visit's start hour, never its own. */
const EVENT_BUCKET = 'CASE WHEN ' + HOUR_ONLY('v.') + " THEN substr(v.head, 17, 13) ELSE e.local_day || '|' || printf('%02d', e.local_hour) END";
const EVENT_ORDER = ' ORDER BY ' + EVENT_BUCKET + ' DESC, ' + HOUR_ONLY('v.') + ' ASC, CASE WHEN ' + HOUR_ONLY('v.') + ' THEN 0 ELSE e.client_at END DESC, '
  + 'e.uid, e.visit, e.client_at DESC, e.id';
/* The rows of the Usage events or Sign-ins tab, each joined to its visit's facts. */
function eventsFrom(tab, scope) {
  const where = tab === 'events' ? scope.where('e.uid') + ' AND ' + NOT_HIDDEN('e.') : "e.name = 'signin.attempted' AND " + scope.where('e.uid');
  return { sql: ' FROM usage_events e JOIN ' + visitFacts(scope.where('uid')) + ' v ON v.uid = e.uid AND v.visit = e.visit WHERE ' + where + ' AND ' + SHOWN('v.'),
    binds: [...scope.uids, ...scope.uids, ...(tab === 'events' ? NJ() : [])] };
}

/* "Saving and sync" (F5). Its time is a batch's ARRIVAL, as good as the minute of whatever came with it, and
   an observer can refresh the overview as often as she likes, so she learns both the time it shows and the
   moment it changes. Neither may be a moment when any row of a dose visit arrived. A visit's rows reach
   the server in the order they were queued (one queue per device, app/cubby-track.js), so its visit.ended
   row comes with or after every other row of it: a visit whose end is stored can no longer gain a dose.
   But that end is not always alone. When the keepalive flush on hide does not go (offline, a send already
   in flight, no token yet), the end waits in the queue and rides in the NEXT open's first batch, beside the
   next visit's start, and perhaps its dose.
     So a moment m is CLOSED when every scoped row that arrived at m belongs to a visit that kept its start,
   logged or edited no medicine or health entry, and had its visit.ended row stored at or before m: only
   finished, clean visits landed then. A row `e` is read for the line only when every scoped row that
   arrived with it (`o`, at e.at, every person's in the scope, so two batches in one millisecond cannot time
   a dose) has a visit.ended row (`x`) that arrived at a closed moment. A row becomes readable only when the
   last of those ends lands, at a closed moment, and stays so (later rows cannot arrive at a past moment,
   and a finished visit gains none), so the line moves only when nothing but finished clean visits arrived.
   An end that rode beside a visit still open, or a dose, leaves its visit's writes unread for good, and
   since a moment counts only the ends stored by then, no chain of held ends can carry a later batch onto
   the line either. A visit cut from its head may have lost its dose, so it is never clean. The line can
   therefore trail the newest save, or never show one, so views.mjs never words it as the last, the newest
   or none at all, and says under it what it reads.
     `e`, `o` and `p` (a row of a moment being checked) are read on ue_at (INDEXED BY): `e` newest first,
   so the newest readable row ends the walk, and `o` and `p` by one arrival time. Left to choose, SQLite
   checked every scoped write, each against every scoped uid, before sorting them (781 ms for the newest
   write at 1,000 people in node:sqlite, before this rule). Each visit fact, `x` (the end of o's visit)
   and the three VISIT_HAS lookups, is read on ue_visit (INDEXED BY) too: left to choose, SQLite read "an
   end stored by m" from ue_uid_at, every row of that person older than m: 1.8 s for the newest write at
   1,000 people, against 11.6 ms pinned, in a probe where 20 people share every arrival moment
   (docs/ADMIN-DEPLOY.md, phase 3); and with statistics that misjudge ue_visit, it scanned the whole table
   for `x`, once for every row it checked. Section 6 of test/admin-screens.test.js pins every one of these
   plans, with this database's own statistics and with skewed ones. Each read binds the scope three times
   (e, o, p). */
const VISIT_HAS = (a, what) => 'EXISTS (SELECT 1 FROM usage_events INDEXED BY ue_visit WHERE uid = ' + a + '.uid AND visit = ' + a + '.visit AND ' + what + ')';
const CLOSED = (scope, m) => 'NOT EXISTS (SELECT 1 FROM usage_events p INDEXED BY ue_at WHERE p.at = ' + m + ' AND ' + scope.where('p.uid') + ' AND NOT ('
  + VISIT_HAS('p', "name = 'visit.started'")
  + ' AND NOT ' + VISIT_HAS('p', HEALTH)
  + ' AND ' + VISIT_HAS('p', "name = 'visit.ended' AND at <= " + m) + '))';
const CLEAN_MOMENT = (scope) => 'NOT EXISTS (SELECT 1 FROM usage_events o INDEXED BY ue_at WHERE o.at = e.at AND ' + scope.where('o.uid')
  + " AND NOT EXISTS (SELECT 1 FROM usage_events x INDEXED BY ue_visit WHERE x.uid = o.uid AND x.visit = o.visit AND x.name = 'visit.ended' AND " + CLOSED(scope, 'x.at') + '))';

const median = (xs) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const dayMinus = (day, n) => utcDay(Date.parse(day + 'T00:00:00Z') - n * DAY);

/* ---------- the overview (spec §6.1) ---------- */

/* `from` is the range's first day (data.mjs rangeStart); days are the family's own (local_day). */
export async function usageOverview(cfg, now, from, rangeDays, hideInternal) {
  if (!cfg.usage) return { state: 'unbound' };
  const scope = usageScope(cfg, hideInternal);
  if (scope.tooMany) return { state: 'error' };
  if (scope.empty) return { state: hideInternal && cfg.internal && cfg.internal.size ? 'hidden' : 'empty' };
  try {
    if (!(await anyRows(cfg, scope))) return { state: 'empty' };
    const S = scope.where('uid'), U = scope.uids;
    const db = cfg.usage;

    /* Tiles. Active today: people with a visit on their OWN local today. */
    const recent = await rows(db, "SELECT DISTINCT uid, tz, local_day FROM usage_events WHERE name = 'visit.started' AND at >= ? AND " + S, [now - 2 * DAY, ...U]);
    const today = new Set(recent.filter((r) => localParts(now, okTz(r.tz)).local_day === r.local_day).map((r) => r.uid));
    const week = await one(db, "SELECT COUNT(DISTINCT hid) AS n FROM usage_events WHERE name = 'visit.started' AND hid IS NOT NULL AND at >= ? AND " + S, [now - 7 * DAY, ...U]);
    const measured = await one(db, 'SELECT COUNT(DISTINCT hid) AS n FROM usage_events WHERE hid IS NOT NULL AND ' + S, U);
    const quiet = await one(db, "SELECT COUNT(*) AS n FROM (SELECT hid FROM usage_events WHERE name = 'visit.started' AND hid IS NOT NULL AND " + S
      + ' GROUP BY hid HAVING MAX(at) < ?)', [...U, now - 7 * DAY]);

    /* Saving and sync: the newest save it may read, and whether saves are failing (builder's call on the
       threshold: failures it may read from three or more people in the hour, or the newest failure it may
       read, within the hour, has no save it may read after it; views.mjs savingCheck). Every input is
       read only once its visits finished clean at a closed moment (CLEAN_MOMENT, F5), so no batch that
       carries a row of a dose visit, or of a visit still open, changes anything on the line. */
    const Se = scope.where('e.uid'), clean = CLEAN_MOMENT(scope), E = 'FROM usage_events e INDEXED BY ue_at WHERE ';
    const lastSave = await one(db, "SELECT e.at " + E + "e.name = 'feature.used' AND json_extract(e.props, '$.action') = 'logged' AND " + Se
      + ' AND ' + clean + ' ORDER BY e.at DESC LIMIT 1', [...U, ...U, ...U]);
    const failed = await one(db, 'SELECT COUNT(DISTINCT e.uid) AS people ' + E + "e.name = 'save.failed' AND e.at >= ? AND " + Se
      + ' AND ' + clean, [now - HOUR, ...U, ...U, ...U]);
    const lastFail = await one(db, 'SELECT e.at ' + E + "e.name = 'save.failed' AND e.at >= ? AND " + Se
      + ' AND ' + clean + ' ORDER BY e.at DESC LIMIT 1', [now - HOUR, ...U, ...U, ...U]);
    const saving = { lastSaveAt: lastSave.at || null, failedPeople: Number(failed.people) || 0, lastFailedAt: lastFail.at || null };

    /* What people use: per-person daily rows (never JOURNEY_KEYS, which the server keeps only as totals). */
    const prevFrom = dayMinus(from, rangeDays);
    const cur = await rows(db, "SELECT key, COUNT(DISTINCT CASE WHEN hid != '' THEN hid END) AS households, COUNT(DISTINCT uid) AS people, SUM(n) AS uses FROM usage_daily "
      + "WHERE metric = 'feature' AND local_day >= ? AND " + S + ' GROUP BY key', [from, ...U]);
    const prev = new Map((await rows(db, "SELECT key, SUM(n) AS uses FROM usage_daily WHERE metric = 'feature' AND local_day >= ? AND local_day < ? AND " + S
      + ' GROUP BY key', [prevFrom, from, ...U])).map((r) => [r.key, Number(r.uses) || 0]));
    const features = [];
    for (const r of cur) {
      const k = okFeature(r.key);
      if (!k) continue;
      features.push({ key: k, households: Number(r.households) || 0, people: Number(r.people) || 0, uses: Number(r.uses) || 0, prev: prev.get(k) || 0, journey: false });
    }
    for (const j of await journeyTotals(cfg, scope, now, from, prevFrom)) features.push(j);
    features.sort((a, b) => b.uses - a.uses || String(a.key).localeCompare(String(b.key)));

    /* Time in Cubby. */
    const ended = await rows(db, "SELECT props FROM usage_events WHERE name = 'visit.ended' AND local_day >= ? AND " + S, [from, ...U]);
    const secs = ended.map((r) => propsOf('visit.ended', r.props).seconds).filter((n) => Number.isInteger(n));
    const daily = await one(db, "SELECT SUM(CASE WHEN metric = 'visits' THEN n ELSE 0 END) AS visits, SUM(CASE WHEN metric = 'seconds' THEN n ELSE 0 END) AS seconds, "
      + "COUNT(DISTINCT CASE WHEN metric = 'visits' AND n > 0 THEN uid || '|' || local_day END) AS personDays FROM usage_daily WHERE local_day >= ? AND " + S, [from, ...U]);
    const hours = Array(24).fill(0);
    for (const r of await rows(db, "SELECT local_hour AS h, COUNT(*) AS n FROM usage_events WHERE name = 'visit.started' AND local_day >= ? AND " + S + ' GROUP BY local_hour', [from, ...U])) {
      if (Number.isInteger(r.h) && r.h >= 0 && r.h < 24) hours[r.h] = Number(r.n) || 0;
    }
    const pd = Number(daily.personDays) || 0;
    const time = { typical: median(secs), visitsPerDay: pd ? (Number(daily.visits) || 0) / pd : null, secondsPerDay: pd ? (Number(daily.seconds) || 0) / pd : null, hours };

    /* Where they use it: active people this range by platform, and how many run the newest version. */
    const plat = await rows(db, "SELECT platform, COUNT(DISTINCT uid) AS people FROM usage_daily WHERE metric = 'visits' AND n > 0 AND local_day >= ? AND " + S + ' GROUP BY platform', [from, ...U]);
    const platforms = Object.fromEntries(PLATFORMS.map((p) => [p, 0]));
    for (const r of plat) if (okPlatform(r.platform)) platforms[r.platform] = Number(r.people) || 0;
    /* Versions, by device: one person runs Cubby on several, and each updates on its own. Newest is the
       highest version any device reported in the last 24 hours (builder's call, §18), else the highest seen. */
    const devs = await rows(db, 'SELECT uid, app_version, last_seen FROM devices WHERE ' + S, U);
    const fresh = devs.filter((d) => d.last_seen >= now - DAY);
    const newestN = Math.max(-1, ...(fresh.length ? fresh : devs).map((d) => vnum(d.app_version)));
    const seen = devs.filter((d) => d.last_seen >= Date.parse(from + 'T00:00:00Z'));
    const onNewest = seen.filter((d) => vnum(d.app_version) >= newestN).length;
    const versions = { newest: newestN >= 0 ? 'v' + newestN : null, onNewest, older: seen.length - onNewest, devices: seen.length };
    const active = new Set((await rows(db, "SELECT DISTINCT uid FROM usage_daily WHERE metric = 'visits' AND n > 0 AND local_day >= ? AND " + S, [from, ...U])).map((r) => r.uid));

    return {
      state: 'ok',
      tiles: { activeToday: today.size, activeWeek: Number(week.n) || 0, measured: Number(measured.n) || 0, quiet: Number(quiet.n) || 0 },
      saving, features, time, platforms, activePeople: active.size, versions,
    };
  } catch (e) {
    return { state: 'error' };
  }
}

/* Pregnancy and trying tools: uses from the daily TOTALS (uid = '' and hid = '': no person, no household),
   households and people from the 30 days of raw events the server keeps, inside the scope. Never per person. */
async function journeyTotals(cfg, scope, now, from, prevFrom) {
  const db = cfg.usage;
  const totals = await rows(db, "SELECT key, SUM(CASE WHEN local_day >= ? THEN n ELSE 0 END) AS uses, SUM(CASE WHEN local_day < ? THEN n ELSE 0 END) AS prev FROM usage_daily "
    + "WHERE uid = '' AND hid = '' AND metric = 'feature' AND local_day >= ? AND key IN (" + ph(JOURNEY_KEYS.length) + ') GROUP BY key', [from, from, prevFrom, ...JOURNEY_KEYS]);
  const out = [];
  for (const r of totals) {
    if (!isJourney(r.key) || !(Number(r.uses) > 0)) continue;
    const who = await one(db, "SELECT COUNT(DISTINCT hid) AS households, COUNT(DISTINCT uid) AS people FROM usage_events WHERE name = 'feature.used' AND at >= ? "
      + "AND json_extract(props, '$.feature') = ? AND " + scope.where('uid'), [now - 30 * DAY, r.key, ...scope.uids]);
    out.push({ key: r.key, households: Number(who.households) || 0, people: Number(who.people) || 0, uses: Number(r.uses) || 0, prev: Number(r.prev) || 0, journey: true });
  }
  return out;
}

/* ---------- one household (spec §6.2) ---------- */

/* Visits grouped from raw events, every stored row of each (see "a visit, read whole"): who, where, how
   long, which screens and tools, and the F5 facts. The caller adds the scope, any narrowing, and the GROUP BY. */
const VISIT_SELECT = 'SELECT uid, visit, ' + HEAD + ' AS head, MAX(hid) AS hid, MAX(platform) AS platform, MAX(app_version) AS app_version, '
  + "MAX(CASE WHEN name = 'visit.ended' THEN json_extract(props, '$.seconds') END) AS seconds, "
  + HEALTH_OF + ' AS health, ' + HEADED_OF + ' AS headed, ' + ENDED_OF + ' AS ended, '
  + "group_concat(CASE WHEN name = 'screen.viewed' THEN json_extract(props, '$.screen') END) AS screens, "
  + "group_concat(CASE WHEN name = 'feature.used' THEN json_extract(props, '$.action') || ':' || json_extract(props, '$.feature') END) AS uses "
  + 'FROM usage_events WHERE ';
function visitRow(r) {
  const screens = [...new Set(String(r.screens || '').split(',').map(okScreen).filter(Boolean))];
  const uses = [];
  for (const s of String(r.uses || '').split(',')) {
    const [a, f] = s.split(':');
    const feature = okFeature(f);
    if (feature && USAGE_EVENTS['feature.used'].props.action.enum.includes(a) && !uses.some((x) => x.action === a && x.feature === feature)) uses.push({ action: a, feature });
  }
  const head = parseHead(r.head);
  return { uid: r.uid, visit: okVisit(r.visit), start: head.at, hid: r.hid || null, tz: head.tz, platform: okPlatform(r.platform),
    version: okVersion(r.app_version), seconds: Number.isInteger(r.seconds) && r.seconds >= 0 && r.seconds <= 86400 ? r.seconds : null,
    hourOnly: hourOnlyOf(r), screens, uses, bucket: head.bucket };
}
/* "Visits, last 48 hours": a visit is listed while what it shows is inside the 48 hours, so it leaves the
   list at a moment that says no more than its row did. A visit with minutes leaves 48 hours after it
   started; an hour-only one 48 hours after the start of its hour, never at a moment set by its dose. */
const listedSince = (v, now) => (v.hourOnly ? hourStart(v.start, v.tz) : v.start) >= now - 48 * HOUR;

export async function usageHousehold(cfg, h, now) {
  if (!cfg.usage) return { state: 'unbound' };
  const scope = usageScope(cfg, false);
  if (scope.tooMany) return { state: 'error' };
  const members = h.members.map((p) => p.uid).filter((u) => scope.has(u));
  if (!members.length) return { state: 'empty' };
  try {
    const db = cfg.usage, S = scope.where('uid'), U = scope.uids;
    const any = await one(db, 'SELECT 1 AS y FROM usage_events WHERE hid = ? AND ' + S + ' LIMIT 1', [h.hid, ...U]);
    if (any.y !== 1) return { state: 'empty' };
    const c7 = await one(db, "SELECT SUM(CASE WHEN name = 'save.failed' THEN 1 ELSE 0 END) AS saves, "
      + "SUM(CASE WHEN name = 'signin.attempted' AND json_extract(props, '$.outcome') = 'failed' THEN 1 ELSE 0 END) AS signins "
      + 'FROM usage_events WHERE hid = ? AND at >= ? AND ' + S, [h.hid, now - 7 * DAY, ...U]);
    const since = utcDay(now - 29 * DAY);
    const grid = (await rows(db, "SELECT uid, key, SUM(n) AS n FROM usage_daily WHERE metric = 'feature' AND hid = ? AND local_day >= ? AND " + S + ' GROUP BY uid, key',
      [h.hid, since, ...U])).filter((r) => scope.has(r.uid) && okFeature(r.key)).map((r) => ({ uid: r.uid, key: r.key, n: Number(r.n) || 0 }));
    /* Which visits: any of this household's rows that arrived in the last 49 hours (an hour of slack for a
       phone clock ahead of the server). Then each of those visits is read WHOLE, older rows included, so
       its dose is seen wherever its batches landed; then listed, ordered and cut to 50 by what it shows. */
    const visits = (await rows(db, 'SELECT * FROM (' + VISIT_SELECT + S + ' AND (uid, visit) IN (SELECT uid, visit FROM usage_events WHERE hid = ? AND at >= ? AND ' + S
      + ') GROUP BY uid, visit) WHERE ' + SHOWN(''), [...U, h.hid, now - 49 * HOUR, ...U]))
      .filter((r) => scope.has(r.uid)).map(visitRow).filter((v) => Number.isFinite(v.start) && listedSince(v, now))
      .sort((a, b) => newestFirst({ ...a, at: a.start, tie: a.uid + '\u0000' + a.visit }, { ...b, at: b.start, tie: b.uid + '\u0000' + b.visit })).slice(0, 50);
    return { state: 'ok', failedSaves: Number(c7.saves) || 0, signinProblems: Number(c7.signins) || 0, grid, visits };
  } catch (e) {
    return { state: 'error' };
  }
}

/* ---------- Every record: Visits, Usage events, Sign-ins, Devices (spec §6.3) ---------- */

export const USAGE_TABS = Object.freeze(['visits', 'events', 'signins', 'devices']);

/* Each tab's count, over exactly the rows its list shows: a visit that is not shown (see "a visit, read
   whole") is in no count either. Returns { sql, binds }. */
const COUNT_OF = {
  visits: (scope) => ({ sql: 'SELECT COUNT(*) AS n FROM ' + visitFacts(scope.where('uid')) + ' WHERE ' + SHOWN(''), binds: scope.uids }),
  events: (scope) => { const f = eventsFrom('events', scope); return { sql: 'SELECT COUNT(*) AS n' + f.sql, binds: f.binds }; },
  signins: (scope) => { const f = eventsFrom('signins', scope); return { sql: 'SELECT COUNT(*) AS n' + f.sql, binds: f.binds }; },
  devices: (scope) => ({ sql: 'SELECT COUNT(*) AS n FROM devices WHERE ' + scope.where('uid'), binds: scope.uids }),
};

/* The four tabs' counts, or null each when there is nothing this request may read. */
export async function usageCounts(cfg, hideInternal) {
  const scope = usageScope(cfg, hideInternal);
  const out = { visits: null, events: null, signins: null, devices: null };
  if (scope.empty) return out;
  try {
    for (const tab of USAGE_TABS) { const c = COUNT_OF[tab](scope); out[tab] = Number((await one(cfg.usage, c.sql, c.binds)).n) || 0; }
  } catch (e) { /* a count that cannot be read shows a dash */ }
  return out;
}

/* One page (or, for a CSV, every row) of a usage tab, as plain records the views turn into cells. Every tab
   is ordered by what each row shows (newestFirst), so an hour-only row's place says no more than its hour. */
export async function usageTab(cfg, tab, hideInternal, pageNo, all) {
  if (!cfg.usage) return { state: 'unbound', total: 0, rows: [] };
  const scope = usageScope(cfg, hideInternal);
  if (scope.tooMany) return { state: 'error', total: 0, rows: [] };
  if (scope.empty) return { state: hideInternal && cfg.internal && cfg.internal.size ? 'hidden' : 'empty', total: 0, rows: [] };
  const db = cfg.usage, S = scope.where('uid'), U = scope.uids;
  const c = COUNT_OF[tab](scope);
  const total = Number((await one(db, c.sql, c.binds)).n) || 0;
  if (!total) return { state: 'empty', total: 0, rows: [] };
  const lim = all ? [] : [USAGE_PAGE, (pageNo - 1) * USAGE_PAGE];
  const tail = all ? '' : ' LIMIT ? OFFSET ?';
  let list;
  if (tab === 'visits') {
    list = (await rows(db, 'SELECT * FROM (' + VISIT_SELECT + S + ' GROUP BY uid, visit) WHERE ' + SHOWN('') + VISIT_ORDER + tail, [...U, ...lim])).map(visitRow);
  } else if (tab === 'events' || tab === 'signins') {
    /* An event of an hour-only visit is shown at that visit's start hour, never its own: a visit that crosses
       an hour would otherwise give the minute away (its end hour and its length). */
    const f = eventsFrom(tab, scope);
    list = (await rows(db, 'SELECT e.uid, e.hid, e.client_at, e.tz, e.platform, e.app_version, e.visit, e.name, e.props, v.head, v.health, v.ended' + f.sql
      + EVENT_ORDER + tail, [...f.binds, ...lim])).map((r) => {
      const props = keptProps(r.name, r.props);
      const hourOnly = hourOnlyOf(r);
      const head = hourOnly ? parseHead(r.head) : null;
      return { uid: r.uid, hid: r.hid || null, at: head ? head.at : Number(r.client_at), tz: head ? head.tz : okTz(r.tz), platform: okPlatform(r.platform), version: okVersion(r.app_version),
        visit: okVisit(r.visit), name: props ? r.name : null, props: props || [], hourOnly };
    });
  } else {
    /* First and last seen are the start of the device's first and newest visit, exactly as that visit's own
       row shows it: the hour only for an hour-only visit (F5). Which visit is "first" and "newest" is chosen
       by the same order every list uses, so an hour-only visit stands at the start of its hour: whether it
       or a visit with minutes in that hour is picked never turns on its own minute. The devices table's own
       times are batch ARRIVALS, as good as the minute a dose was logged, so they are never shown to the
       minute; once a device's visits are past the 90 days, the day alone. */
    const ends = new Map();
    const KEY = "CASE WHEN ho = 1 THEN '' ELSE substr(head, 1, 15) END";
    for (const v of await rows(db, 'SELECT device, uid, head, ho, rf, rl FROM (SELECT device, uid, head, ho, '
      + 'ROW_NUMBER() OVER (PARTITION BY device, uid ORDER BY substr(head, 17, 13), ho DESC, ' + KEY + ', visit) AS rf, '
      + 'ROW_NUMBER() OVER (PARTITION BY device, uid ORDER BY substr(head, 17, 13) DESC, ho, ' + KEY + ' DESC, visit) AS rl FROM '
      + '(SELECT device, uid, visit, head, CASE WHEN ' + HOUR_ONLY('') + ' THEN 1 ELSE 0 END AS ho FROM ' + visitFacts(S) + ' WHERE ' + SHOWN('') + ')) WHERE rf = 1 OR rl = 1', U)) {
      const k = v.device + '|' + v.uid;
      const e = ends.get(k) || {};
      const head = parseHead(v.head);
      const when = { at: head.at, tz: head.tz, hourOnly: v.ho === 1, bucket: head.bucket };
      if (v.rf === 1) e.first = when;
      if (v.rl === 1) e.last = when;
      ends.set(k, e);
    }
    /* Every device is read (a person has a few), then ordered by the last seen it shows and paged here. */
    const devs = (await rows(db, 'SELECT d.device, d.uid, d.platform, d.os, d.browser, d.app_version, d.native_version, d.push, d.first_seen, d.last_seen, '
      + '(SELECT e.tz FROM usage_events e WHERE e.device = d.device AND e.uid = d.uid ORDER BY e.at DESC LIMIT 1) AS tz FROM devices d WHERE ' + scope.where('d.uid'), U)).map((r) => {
      const e = ends.get(r.device + '|' + r.uid) || {};
      const tz = okTz(r.tz);
      const firstAt = Number(r.first_seen) || null, lastAt = Number(r.last_seen) || null;
      const dayOnly = (at) => ({ at, tz, dayOnly: true, bucket: localParts(at, tz).local_day + '|' });
      /* The oldest visit kept is the device's first only if it started before the device was first seen:
         to the minute for a visit with minutes, to the hour for an hour-only one (what it shows). */
      const firstKept = e.first && firstAt && (e.first.hourOnly ? e.first.bucket <= bucketOf(firstAt, e.first.tz) : e.first.at <= firstAt);
      return {
        uid: r.uid, device: r.device, platform: okPlatform(r.platform), os: okOs(r.os), browser: okBrowser(r.browser), version: okVersion(r.app_version),
        native: okNative(r.native_version), push: ['granted', 'denied', 'asked', 'revoked'].includes(r.push) ? r.push : null,
        firstSeen: firstKept ? e.first : (firstAt ? dayOnly(firstAt) : null),
        lastSeen: e.last || (lastAt ? dayOnly(lastAt) : null),
      };
    }).filter((r) => scope.has(r.uid));
    /* A day-only last seen sits after every hour of its day; a device with none, last. */
    const key = (d) => (d.lastSeen ? { bucket: d.lastSeen.bucket, hourOnly: !!(d.lastSeen.hourOnly || d.lastSeen.dayOnly), at: d.lastSeen.at, tie: d.device }
      : { bucket: '', hourOnly: true, at: 0, tie: d.device });
    devs.sort((a, b) => newestFirst(key(a), key(b)));
    list = all ? devs : devs.slice((pageNo - 1) * USAGE_PAGE, pageNo * USAGE_PAGE);
  }
  /* The rule, once more at the door: a row whose uid is outside the scope never leaves this module. */
  return { state: 'ok', total, rows: list.filter((r) => scope.has(r.uid)) };
}
