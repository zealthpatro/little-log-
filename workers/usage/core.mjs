/* Cubby usage events: the allowlist, the envelope and every rule a stored row must pass.
 *
 * ONE SOURCE. The phone's copy (app/usage-allowlist.js) is generated from this file by
 * tools/gen_usage_allowlist.js; the tracking plan (.telemetry/tracking-plan.yaml) lists the same events;
 * tools/tracking_plan_check.js fails when any of the three differ. Spec:
 * docs/superpowers/specs/2026-11-13-admin-dashboard-design.md §8 and §9.1.
 *
 * NOTHING THAT CARRIES CONTENT. Every property is a value from a fixed list, a bounded integer, or one
 * fixed format. There is no free-text property, so no event can hold what a family logged, a name, a
 * dose or a temperature. The server re-checks everything the phone checked (§8.5).
 *
 * Pure: no I/O, no clock except the `now` passed in. ingest() takes its database and its lookups as
 * arguments, so test/usage-ingest.test.js runs the real thing over real SQLite.
 */

export const SCHEMA_VERSION = 1;

/* §8.4. Places in Cubby. Never her private health, the loss holding screen or the kept archive. */
export const SCREENS = [
  'signin', 'landing', 'home', 'timeline', 'log_feed', 'log_sleep', 'log_nappy', 'log_pump', 'log_growth',
  'log_medicine', 'log_health', 'log_note', 'pregnancy_week', 'kicks', 'contractions', 'cycle',
  'appointments', 'vaccines', 'photos', 'moments', 'circle', 'invite', 'settings', 'privacy', 'reminders',
  'report', 'guide', 'games', 'pro', 'health', 'den', 'onboarding',
];
/* Tools, never the condition or the value: medicine, not a drug; health_log, not "fever". */
export const FEATURES = [
  'feed', 'sleep', 'nappy', 'pump', 'growth', 'medicine', 'health_log', 'note', 'timeline', 'pregnancy_week',
  'kicks', 'contractions', 'cycle', 'appointments', 'vaccines', 'invite', 'moments', 'photos', 'report',
  'voice', 'reminders', 'export', 'games', 'pro', 'theme',
];
export const ACTIONS = ['logged', 'edited', 'deleted', 'shared', 'opened'];
/* Screens and features that exist only on the pregnancy or trying path. 30-day raw rows, and only
   aggregate daily rows (no person, no household), so no per-person pregnancy history outlives a month. */
export const JOURNEY_KEYS = ['pregnancy_week', 'kicks', 'contractions', 'cycle'];
/* Never a screen or feature name, whatever a future builder adds (§8.4). */
export const NEVER_INSTRUMENTED = /loss|mood|mhealth|wellbeing|(^|_)bp($|_)|blood|archive|private/;
export const SIGNIN_ERRORS = ['popup_closed', 'popup_blocked', 'network', 'no_session', 'invalid_link', 'expired_code',
  'wrong_code', 'too_many', 'cancelled', 'other'];
export const SAVE_ERRORS = ['permission_denied', 'unavailable', 'deadline', 'quota', 'too_large', 'other'];
export const NOTIFICATION_KINDS = ['medicine', 'feed', 'sleep', 'appointment', 'vaccine', 'feature', 'marketing', 'team_note', 'other'];
export const PLATFORMS = ['ios_app', 'android_app', 'home_screen', 'browser'];

const e = (...v) => ({ enum: v });
const int = (min, max) => ({ int: [min, max] });
const fmt = (f) => ({ format: f });

/* §8.3. Every property of every event, and whether it may arrive before sign-in. */
export const USAGE_EVENTS = {
  'visit.started': { anon: true, props: { opened_from: e('icon', 'notification', 'link', 'other'), start: e('cold', 'warm') } },
  'visit.ended': { anon: true, props: { seconds: int(0, 86400), reason: e('hidden', 'idle') } },
  'screen.viewed': { anon: true, anonScreens: ['signin', 'landing'], props: { screen: e(...SCREENS) } },
  'feature.used': { anon: false, props: { feature: e(...FEATURES), action: e(...ACTIONS) } },
  'signin.attempted': { anon: true, props: {
    method: e('google', 'apple', 'email_link', 'email_code'), step: e('started', 'provider_returned', 'verified', 'signed_in'),
    outcome: e('succeeded', 'failed', 'abandoned'), error: e(...SIGNIN_ERRORS, 'none'), attempt: int(1, 20), storage: e('app', 'browser'),
  } },
  'save.failed': { anon: false, props: { error: e(...SAVE_ERRORS), retries: int(0, 50), offline: e('yes', 'no') } },
  'app.updated': { anon: true, props: { from_version: fmt('version'), to_version: fmt('version') } },
  'push.permission': { anon: false, props: { state: e('asked', 'granted', 'denied', 'revoked') } },
  'push.opened': { anon: false, props: { kind: e(...NOTIFICATION_KINDS) } },
  'nudge.seen': { anon: false, props: { nudge_id: fmt('nudge_id'), channel: e('note', 'email', 'push') } },
  'install.prompted': { anon: true, props: { outcome: e('shown', 'accepted', 'dismissed'), prompt: e('android_chrome', 'ios_instructions') } },
};

export const FORMATS = {
  version: /^v\d{1,5}$/,
  nudge_id: /^n_[a-z0-9]{8}$/,
};
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DEVICE = /^d_[a-z0-9]{12}$/;
const VISIT = /^v_[a-z0-9]{8}$/;
const NATIVE = /^\d{1,3}(\.\d{1,3}){0,3}$/;
const DAY = 86400000;

export const LIMITS = { maxBytes: 32 * 1024, maxEvents: 50, pastMs: 7 * DAY, futureMs: 5 * 60000 };
export const RETENTION = { eventsDays: 90, anonDays: 30, journeyDays: 30, aggregateDays: 396, refusedDays: 90 };
/* The fixed reasons a refused event is counted under. Its content is never stored. */
export const REFUSED = ['bad_event', 'bad_prop', 'bad_id', 'bad_visit', 'bad_time', 'anon_not_allowed', 'notice', 'mode', 'ceiling'];

/* ---------- one event ---------- */

function propOk(spec, v) {
  if (spec.enum) return typeof v === 'string' && spec.enum.includes(v);
  if (spec.int) return Number.isInteger(v) && v >= spec.int[0] && v <= spec.int[1];
  if (spec.format) return typeof v === 'string' && FORMATS[spec.format].test(v);
  return false;
}

/* Sorted keys, allowlisted keys and values only: the exact text stored in usage_events.props. */
export function canonicalProps(props) {
  const out = {};
  for (const k of Object.keys(props).sort()) out[k] = props[k];
  return JSON.stringify(out);
}

/* Returns { ok: true, ev } or { ok: false, reason }. `signedIn` decides which events are allowed. */
export function checkEvent(raw, now, signedIn) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'bad_event' };
  const spec = Object.prototype.hasOwnProperty.call(USAGE_EVENTS, raw.name) ? USAGE_EVENTS[raw.name] : null;
  if (!spec) return { ok: false, reason: 'bad_event' };
  if (typeof raw.id !== 'string' || !UUID4.test(raw.id)) return { ok: false, reason: 'bad_id' };
  if (typeof raw.visit !== 'string' || !VISIT.test(raw.visit)) return { ok: false, reason: 'bad_visit' };
  if (typeof raw.t !== 'number' || !Number.isFinite(raw.t)) return { ok: false, reason: 'bad_time' };
  const props = raw.props && typeof raw.props === 'object' && !Array.isArray(raw.props) ? raw.props : {};
  const want = Object.keys(spec.props);
  const got = Object.keys(props);
  if (got.length !== want.length || got.some((k) => !want.includes(k))) return { ok: false, reason: 'bad_prop' };
  for (const k of want) if (!propOk(spec.props[k], props[k])) return { ok: false, reason: 'bad_prop' };
  if (!signedIn) {
    if (!spec.anon) return { ok: false, reason: 'anon_not_allowed' };
    if (spec.anonScreens && !spec.anonScreens.includes(props.screen)) return { ok: false, reason: 'anon_not_allowed' };
  }
  const t = Math.min(Math.max(raw.t, now - LIMITS.pastMs), now + LIMITS.futureMs);
  return { ok: true, ev: { id: raw.id, visit: raw.visit, t, name: raw.name, props: canonicalProps(props), p: props } };
}

/* ---------- the envelope ---------- */

export function validTz(tz) {
  if (typeof tz !== 'string' || tz.length > 64 || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(tz)) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; }
}

/* A body naming uid or hid is refused whole: who and which household come from the server only. */
export function checkEnvelope(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'bad_shape' };
  for (const k of ['uid', 'hid', 'role', 'householdId', 'userId']) if (Object.prototype.hasOwnProperty.call(body, k)) return { ok: false, error: 'bad_shape' };
  if (body.v !== SCHEMA_VERSION) return { ok: false, error: 'bad_shape' };
  if (!Array.isArray(body.events) || body.events.length > LIMITS.maxEvents) return { ok: false, error: 'bad_shape' };
  if (typeof body.device !== 'string' || !DEVICE.test(body.device)) return { ok: false, error: 'bad_shape' };
  if (!PLATFORMS.includes(body.platform)) return { ok: false, error: 'bad_shape' };
  if (typeof body.app_version !== 'string' || !FORMATS.version.test(body.app_version)) return { ok: false, error: 'bad_shape' };
  return {
    ok: true,
    env: {
      tz: validTz(body.tz) ? body.tz : 'UTC',
      device: body.device,
      platform: body.platform,
      app_version: body.app_version,
      // A native version that is not a plain dotted number is stored as null, never as sent.
      native_version: typeof body.native_version === 'string' && NATIVE.test(body.native_version) ? body.native_version : null,
    },
  };
}

/* The family's local day and hour for an event time, so a 3am feed counts as 3am in Dubai. */
export function localParts(t, tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  const parts = Object.fromEntries(f.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  return { local_day: parts.year + '-' + parts.month + '-' + parts.day, local_hour: Number(parts.hour) % 24 };
}

/* Coarse, from the user agent; the raw header is never stored. */
export function coarseUA(ua) {
  const s = String(ua || '');
  let os = 'other', m;
  if ((m = s.match(/(?:iPhone|iPad|iPod).*? OS (\d+)[._](\d+)/))) os = 'iOS ' + m[1] + '.' + m[2];
  else if ((m = s.match(/Android (\d+)/))) os = 'Android ' + m[1];
  else if (/Mac OS X/.test(s)) os = 'macOS';
  else if (/Windows/.test(s)) os = 'Windows';
  else if (/Linux/.test(s)) os = 'Linux';
  let browser = 'other';
  if (/EdgiOS|Edg\//.test(s)) browser = 'Edge';
  else if (/CriOS|Chrome\//.test(s)) browser = 'Chrome';
  else if (/FxiOS|Firefox\//.test(s)) browser = 'Firefox';
  else if (/Safari\//.test(s) || /AppleWebKit/.test(s)) browser = 'Safari';
  return { os, browser };
}

/* §8.8. off: nothing stored. internal: only INTERNAL_UIDS. on: everyone (the notice rule still applies). */
export function modeOf(env) {
  const m = String((env && env.USAGE_MODE) || 'off').trim();
  return m === 'internal' || m === 'on' ? m : 'off';
}
export function internalSet(env) {
  return new Set(String((env && env.INTERNAL_UIDS) || '').split(',').map((s) => s.trim()).filter(Boolean));
}

/* ---------- daily totals ---------- */

/* What one accepted event adds to usage_daily. JOURNEY_KEYS go only to aggregate rows (uid = hid = ''). */
export function dailyAdds(row) {
  const p = row.p || {};
  const out = [];
  const personal = (metric, key, n) => out.push({ metric, key: key || '', n, aggregate: false });
  if (row.name === 'visit.started') personal('visits', '', 1);
  else if (row.name === 'visit.ended') personal('seconds', '', p.seconds || 0);
  else if (row.name === 'screen.viewed' || row.name === 'feature.used') {
    const key = row.name === 'screen.viewed' ? p.screen : p.feature;
    const metric = row.name === 'screen.viewed' ? 'screen' : 'feature';
    out.push({ metric, key, n: 1, aggregate: JOURNEY_KEYS.includes(key) });
  } else if (row.name === 'signin.attempted' && p.outcome === 'failed') personal('signin_failed', '', 1);
  else if (row.name === 'save.failed') personal('save_failed', '', 1);
  return out;
}
export function isJourney(row) {
  const p = row.p || {};
  return JOURNEY_KEYS.includes(p.screen) || JOURNEY_KEYS.includes(p.feature);
}

/* ---------- ingest ---------- */

/* §8.7. The day's ceilings, each one atomic counter row in usage_meta, and what this isolate remembers.
 *
 * USAGE_DAILY_CAP is the events stored per UTC day across everyone, split in two (W2): a quarter of it is
 * the share for batches with no sign-in, under its own counter, and the rest is the families' share. A
 * script with no token can fill only its quarter; a family's events are never refused because of it.
 *
 * Refusal counting has its own small ceiling (W1), in rows: at most REFUSED_DAILY_ROWS reason rows a UTC
 * day go to usage_refused, each moved by one counter write. So a stream of refused or past-the-ceiling
 * requests writes at most 2 x REFUSED_DAILY_ROWS rows a day, whatever its volume; past that the counts
 * stop for the day (losing a count costs nothing). Chosen over holding counts in the isolate and flushing
 * them once a minute because that one is bounded per isolate, and the number of isolates is not.
 *
 * The membership cache has a ceiling of its own, in rows: worker.js usageMembership writes at most
 * MEMBERSHIP_DAILY_ROWS membership rows a UTC day across everyone, each moved by one counter write. Its
 * writes scale with the number of signed-in people, not with events, so without it no daily figure could
 * hold whatever the traffic. Past it the row is not refreshed and the fresh Firestore answer still serves
 * that request (usageMembership).
 *
 * And the isolate remembers (the recordStep pattern): once a counter refuses, ctx.isolate keeps that UTC
 * day for that ceiling, and until the day turns this isolate answers those requests without touching D1
 * again: no membership read, no counter, no refusal row. worker.js keeps one isolate state at module
 * level; a test makes one per simulated isolate. Without one nothing is remembered, and each request
 * asks the counters (still bounded by them). The last few slots of a day can go unused: a batch bigger
 * than what is left marks that share full.
 *
 * The D1 write arithmetic behind these numbers (rows billed, index entries included) is beside
 * USAGE_DAILY_CAP in wrangler.toml, and test/usage-erasure.test.js recomputes it from the real schema. */
export const REFUSED_DAILY_ROWS = 500;
export const MEMBERSHIP_DAILY_ROWS = 1000;
/* The cap when USAGE_DAILY_CAP is not set: the value wrangler.toml ships, so a missing line never lifts it. */
export const DEFAULT_DAILY_CAP = 1500;
export function newIsolate() { return { full: new Map() }; }
export function ceilingsOf(env) {
  const capRaw = parseInt(env && env.USAGE_DAILY_CAP, 10);
  const cap = Number.isFinite(capRaw) && capRaw >= 0 ? capRaw : DEFAULT_DAILY_CAP;
  const anon = Math.floor(cap / 4);
  return { cap, linked: cap - anon, anon, refused: REFUSED_DAILY_ROWS, membership: MEMBERSHIP_DAILY_ROWS };
}
/* The counters' keys. All five sort under 'events_<day>' (the families' share keeps that key exactly), so
   one by-day range delete, key >= 'events_' AND key < 'events_<cutoff day>', retires every counter of a
   past day and none of a later day's, and no counter outlives its day (VI-3). 'erase' is the rows the
   day's erasures have taken of the daily delete allowance (eraseStep, below). */
const CEILING_SUFFIX = { linked: '', anon: '_anon', refused: '_refused', membership: '_membership', erase: '_erase' };
export function ceilingKey(kind, day) {
  return 'events_' + day + CEILING_SUFFIX[kind];
}

/* One atomic statement moves the day's counter by n only while it stays within cap; RETURNING gives no row
   once it would not (and then nothing is written). The day's FIRST statement inserts the counter without
   that comparison, so a batch bigger than the whole cap is refused here, before SQL. Exported for
   worker.js usageMembership's ceiling. */
export async function takeSlots(db, kind, day, n, cap, now) {
  if (n > cap) return false;
  const row = await db.prepare('INSERT INTO usage_meta (key, value, at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE '
    + 'SET value = CAST(usage_meta.value AS INTEGER) + ?, at = excluded.at WHERE CAST(usage_meta.value AS INTEGER) + ? <= ? RETURNING value')
    .bind(ceilingKey(kind, day), String(n), now, n, n, cap).first();
  return !!row;
}

/* Accepts one validated batch. `ctx`:
 *   db          a D1 database (cubby-usage), or null (answers mode off and stores nothing)
 *   env         for USAGE_MODE, INTERNAL_UIDS, USAGE_DAILY_CAP
 *   uid         from the VERIFIED token, or null before sign-in
 *   membership  async (uid) => { hid, role, notice } | null, the server's own cached Firestore read
 *   notice      the current PRIVACY_NOTICE id, or '' while families have not been told (phases 1-2)
 *   isolate     newIsolate(), kept across requests by the caller (the full days it has seen)
 *   ua, now
 * Never throws: a database error is logged by code only, and telemetry never fails a request. */
export async function ingest(body, ctx) {
  const env = checkEnvelope(body);
  if (!env.ok) return { status: 400, body: { error: env.error } };
  const mode = modeOf(ctx.env);
  const uid = ctx.uid || null;
  if (!ctx.db || mode === 'off') return { status: 200, body: { mode: 'off' } };
  if (uid && mode === 'internal' && !internalSet(ctx.env).has(uid)) return { status: 200, body: { mode: 'off' } };
  // Before sign-in nothing is stored until families are measured at all (§8.8: in internal, everyone
  // outside INTERNAL_UIDS, a request with no sign-in included, is answered off).
  if (!uid && mode !== 'on') return { status: 200, body: { mode: 'off' } };
  const now = ctx.now;
  const day = new Date(now).toISOString().slice(0, 10);
  const iso = ctx.isolate || newIsolate();
  const kind = uid ? 'linked' : 'anon';
  const limits = ceilingsOf(ctx.env);
  const refused = {};
  const count = (r) => { refused[r] = (refused[r] || 0) + 1; };
  const accepted = [];
  for (const raw of body.events) {
    const r = checkEvent(raw, now, !!uid);
    if (r.ok) accepted.push(r.ev); else count(r.reason);
  }
  // Nothing to store (the tracker's daily empty ask, or every event refused): nothing is written, not
  // even a device row, so a person who has not seen the notice is never linked to a device (G4).
  if (!accepted.length) return finish(ctx, iso, refused, 0, mode);
  // This isolate already saw this share of the day fill: answered without touching D1 at all.
  if (iso.full.get(kind) === day) {
    for (let i = 0; i < accepted.length; i++) count('ceiling');
    return answer(mode, 0, refused);
  }
  let mem = null;
  if (uid) {
    try { mem = ctx.membership ? await ctx.membership(uid) : null; } catch (e) { mem = null; }
    // In mode on, a linked event waits for the person to have seen the current notice (G4).
    if (mode === 'on' && (!ctx.notice || !mem || mem.notice !== ctx.notice)) {
      for (let i = 0; i < accepted.length; i++) count('notice');
      return finish(ctx, iso, refused, 0, mode);
    }
  }
  const { os, browser } = coarseUA(ctx.ua);
  const who = uid || 'anon_' + env.env.device;
  let stored = 0;
  try {
    /* The ceiling for this batch's share. Past it, events are counted as refused and not stored, and D1's
       daily write allowance stays safe for everything else in the account. */
    const n = accepted.length;
    if (!(await takeSlots(ctx.db, kind, day, n, limits[kind], now))) {
      iso.full.set(kind, day);
      for (let i = 0; i < n; i++) count('ceiling');
      return finish(ctx, iso, refused, 0, mode);
    }
    const stmts = [];
    const lps = accepted.map((ev) => localParts(ev.t, env.env.tz));
    accepted.forEach((ev, i) => {
      const lp = lps[i];
      stmts.push(ctx.db.prepare('INSERT OR IGNORE INTO usage_events (who, id, at, client_at, local_day, local_hour, tz, uid, hid, role, device, visit, platform, os, browser, app_version, native_version, name, props) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(who, ev.id, now, ev.t, lp.local_day, lp.local_hour, env.env.tz, uid, mem ? mem.hid || null : null, mem ? mem.role || null : null,
          env.env.device, ev.visit, env.env.platform, os, browser, env.env.app_version, env.env.native_version, ev.name, ev.props));
    });
    const res = stmts.length ? await ctx.db.batch(stmts) : [];
    // Daily totals only for rows that were NEW (a retry inserts nothing and adds nothing).
    const adds = [];
    res.forEach((r, i) => {
      if (!(r && r.meta && r.meta.changes > 0)) return;
      stored++;
      const ev = accepted[i];
      const lp = lps[i];
      for (const a of dailyAdds(ev)) {
        const u = a.aggregate || !uid ? '' : uid;
        const h = a.aggregate || !uid ? '' : (mem && mem.hid) || '';
        adds.push(ctx.db.prepare('INSERT INTO usage_daily (local_day, uid, hid, platform, metric, key, n) VALUES (?, ?, ?, ?, ?, ?, ?) '
          + 'ON CONFLICT(local_day, uid, platform, metric, key) DO UPDATE SET n = n + excluded.n').bind(lp.local_day, u, h, env.env.platform, a.metric, a.key, a.n));
      }
    });
    /* This phone's notification answer (the admin's Devices "Reminders"). The newest push.permission in the
       batch wins, an answer beating 'asked' at the same moment; a bare 'asked' never replaces an answer
       already stored, so a late retry of an older batch cannot turn On back into Asked. */
    let push = null, pushAt = -Infinity;
    for (const ev of accepted) {
      if (ev.name !== 'push.permission') continue;
      const s = ev.p.state;
      if (ev.t > pushAt || (ev.t === pushAt && push === 'asked' && s !== 'asked')) { push = s; pushAt = ev.t; }
    }
    adds.push(ctx.db.prepare('INSERT INTO devices (device, uid, platform, os, browser, app_version, native_version, push, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) '
      + 'ON CONFLICT(device) DO UPDATE SET uid = COALESCE(excluded.uid, devices.uid), platform = excluded.platform, os = excluded.os, browser = excluded.browser, '
      + 'app_version = excluded.app_version, native_version = excluded.native_version, last_seen = excluded.last_seen, '
      + "push = CASE WHEN excluded.push IS NULL THEN devices.push WHEN excluded.push = 'asked' AND devices.push IS NOT NULL THEN devices.push ELSE excluded.push END")
      .bind(env.env.device, uid, env.env.platform, os, browser, env.env.app_version, env.env.native_version, push, now, now));
    if (adds.length) await ctx.db.batch(adds);
  } catch (e) {
    if (ctx.log) ctx.log('usage_store_fail');
  }
  return finish(ctx, iso, refused, stored, mode);
}

function answer(mode, stored, refused) {
  return { status: 200, body: { mode, accepted: stored, refused: Object.values(refused).reduce((a, b) => a + b, 0) } };
}

/* Refusals are counted by fixed reason, under their own daily ceiling (above), and only until this isolate
   has seen that ceiling full. */
async function finish(ctx, iso, refused, stored, mode) {
  const day = new Date(ctx.now).toISOString().slice(0, 10);
  const reasons = Object.keys(refused);
  if (reasons.length && ctx.db && iso.full.get('refused') !== day) {
    try {
      if (await takeSlots(ctx.db, 'refused', day, reasons.length, REFUSED_DAILY_ROWS, ctx.now)) {
        await ctx.db.batch(reasons.map((reason) => ctx.db.prepare('INSERT INTO usage_refused (day, reason, n) VALUES (?, ?, ?) ON CONFLICT(day, reason) DO UPDATE SET n = n + excluded.n').bind(day, reason, refused[reason])));
      } else iso.full.set('refused', day);
    } catch (e) { if (ctx.log) ctx.log('usage_refused_fail'); }
  }
  return answer(mode, stored, refused);
}

/* ---------- retention and erasure (§10) ---------- */

export function retentionCutoffs(now) {
  return {
    events: now - RETENTION.eventsDays * DAY,
    anon: now - RETENTION.anonDays * DAY,
    journey: now - RETENTION.journeyDays * DAY,
    aggregateDay: new Date(now - RETENTION.aggregateDays * DAY).toISOString().slice(0, 10),
    refusedDay: new Date(now - RETENTION.refusedDays * DAY).toISOString().slice(0, 10),
  };
}
/* Each pattern is '%"<key>"%'. D1 refuses a LIKE pattern over 50 bytes (the node:sqlite shim takes 51 and
   more), so a key stays within 46; usage-d1 checks the longest on D1. */
const JOURNEY_LIKE = JOURNEY_KEYS.map((k) => "props LIKE '%\"" + k + "\"%'").join(' OR ');

/* One retention call's bounds. `rows`: the most rows one statement deletes. `statements`: statements one
   call runs at most, so a cron tick spends a known number of D1 calls whatever the backlog. */
export const RETENTION_CHUNK = { rows: 2000, statements: 10 };

/* The classes, in order, person-linked first: the shared daily allowance (worker.js retentionDailyRows)
   goes to signed-in rows past 90 days, then pregnancy-only rows past 30, before any anonymous row, so a
   surge of anonymous rows can only ever make anonymous rows wait (ERA-SK-2). Each class is repeated until
   a statement deletes fewer rows than it may, which means nothing past its cutoff is left.

   The linked class deletes by VISIT. A statement picks the people's visits that hold an expired row, then
   deletes rows of those visits, at most `n` of them, in this order: every expired row before any row that
   has not expired, and within each of the two, visit.started rows first and then the oldest. A row that
   has not expired goes with its visit only if it ARRIVED within VISIT_SPAN_MS (a day) after the cutoff.
   `at` is when a row arrived, not when it happened: a visit lasts a day at most (visit.ended's seconds stop
   at 86400), but a phone offline for days keeps up to 500 events queued (app/cubby-track.js) and sends a
   visit's later batches when it is back. So a visit whose rows all arrived within a day of its first goes
   whole when it can (when what is left of the statement holds it, below), and a visit whose rows arrived
   further apart (that phone, or a visit id reused for longer) is cut: its rows that arrived later wait
   until they expire themselves, and it loses its head first, as any cut visit below. So a row that has not
   expired, a visit.started row included, never takes an expired row's place in the day's allowance, and on
   any one day the class deletes at most what expired plus what would expire the next day (RE-SK-1: heads
   first across the whole pick let one visit id with thousands of young visit.started rows use up the day
   while other families' rows waited past 90 days and pregnancy rows past 30).
   Whole when it can, head first when it cannot. A visit whose rows all fit in what is left of the statement
   goes whole, so no tail survives it (F5: a dose visit's leftover rows would show their own minutes). When
   a statement's row limit or the day's allowance cuts a visit, it loses its head before any other row of
   it: a visit longer than one statement (only a client reusing one visit id makes one), the visits at a
   chunk boundary when the picked visits hold more than `n` rows, and any visit the day's allowance runs
   out inside (runRetention passes `n` = what is left of it, so an ordinary five-row visit can be cut
   too). What is left of a cut visit stays headless until a later statement takes it: the next one in this
   run, the next tick, or the next UTC day, at the latest when its own rows expire. While it is headless
   the admin shows it by the hour of its earliest stored row only, or not at all if its visit.ended row is
   still there (workers/admin/src/usage.mjs, SHOWN and HOUR_ONLY).
   One exception, which only a client other than Cubby's tracker makes: a visit whose visit.started row
   arrived AFTER some of its other rows, by seconds or by days. Those rows expire before its head does, and
   every expired row goes before any row that has not expired, so the visit loses those expired rows and
   keeps its head when the head arrived a day or more after the cutoff (a statement takes no row that
   arrived that late), or when a statement's `n` (the row chunk, or what is left of the day's allowance)
   runs out between them and the head, as it can when they straddle the cutoff by seconds. What is left is
   then read like any visit that kept its head: a dose among the expired rows is gone with them and no
   longer hides the visit's minutes, which show once its end is stored; a dose among the young rows still
   makes it hour-only. The tracker sends a visit's head in its first batch and its batches in the order it
   queued them (and ingest stamps every row of a batch with the same `at`, its `now`), so no visit from
   Cubby itself is shaped like that.
   Either way no row older than 90 days remains once the class drains (S25), and no statement deletes
   more than `n` rows, so the day's allowance is a true bound: a whole-visit delete with no limit let one
   long-lived visit id spend D1's daily writes in a single statement.
   Anonymous rows (uid NULL) never hold a dose or a health entry (feature.used needs sign-in), and a
   JOURNEY_KEYS row is never one either, so those classes go row by row.
   INDEXED BY ue_at is a pin, not a measured fix: on SQLite 3.53 the planner already reads ue_at for this
   pick, with or without ANALYZE (ERA-SK-4). The hint keeps that plan whatever statistics D1 holds, and a
   statement naming a dropped index fails loudly instead of scanning the table. INDEXED BY ue_visit on the
   visits' rows is measured: with the `at < cutoff + VISIT_SPAN_MS` bound, SQLite 3.53 reads each picked
   visit through ue_uid_at (all of that person's rows up to the bound) instead of ue_visit (that visit's
   rows), which is what the statement read before the bound. ue_visit has no `at`, so every row of a picked
   visit is read, whatever its arrival, before the bound applies: on D1, a retention run with one visit id
   reused across 20,000 rows read 40,017 rows to delete its one expired row (an open question for phase 3,
   docs/ADMIN-DEPLOY.md).
   Every statement here is bound (cutoff, n); this one names them ?1 and ?2 because it uses each more than
   once. */
export const VISIT_SPAN_MS = 86400000;
const LINKED_VISITS = 'DELETE FROM usage_events WHERE (who, id) IN (SELECT who, id FROM usage_events INDEXED BY ue_visit WHERE (uid, visit) IN '
  + '(SELECT uid, visit FROM usage_events INDEXED BY ue_at WHERE at < ?1 AND uid IS NOT NULL LIMIT ?2) '
  + 'AND at < ?1 + ' + VISIT_SPAN_MS + " ORDER BY at < ?1 DESC, name = 'visit.started' DESC, at LIMIT ?2)";
function retentionSteps(c) {
  return [
    ['events', LINKED_VISITS, c.events],
    ['journey', 'DELETE FROM usage_events WHERE (who, id) IN (SELECT who, id FROM usage_events WHERE at < ? AND (' + JOURNEY_LIKE + ') LIMIT ?)', c.journey],
    ['anon', 'DELETE FROM usage_events WHERE (who, id) IN (SELECT who, id FROM usage_events WHERE uid IS NULL AND at < ? LIMIT ?)', c.anon],
    /* A phone never signed in: its devices row goes with its anonymous events, 30 days after it was last seen. */
    ['devices', 'DELETE FROM devices WHERE rowid IN (SELECT rowid FROM devices WHERE uid IS NULL AND last_seen < ? LIMIT ?)', c.anon],
    ['aggregate', "DELETE FROM usage_daily WHERE rowid IN (SELECT rowid FROM usage_daily WHERE uid = '' AND local_day < ? LIMIT ?)", c.aggregateDay],
    ['refused', 'DELETE FROM usage_refused WHERE rowid IN (SELECT rowid FROM usage_refused WHERE day < ? LIMIT ?)', c.refusedDay],
    /* The day ceilings' counters (events_YYYY-MM-DD and its _anon, _refused and _membership), kept as long
       as the refusal counts. */
    ['meta', "DELETE FROM usage_meta WHERE key IN (SELECT key FROM usage_meta WHERE key >= 'events_' AND key < ? LIMIT ?)", 'events_' + c.refusedDay],
  ];
}

/* The daily run (§10), in bounded chunks. Returns the rows each class lost, `total`, `statements`, and
   `drained`: true only when EVERY class reached a statement that deleted fewer rows than it could, so
   nothing past its cutoff remains. The cron records the day as done only then; until it does, every later
   tick carries on where this one stopped. `opts.maxRows` is the most rows the call deletes (the daily
   delete allowance; see usageMaintenance): no statement may delete more than what is left of it. A number
   as `opts` is the old row chunk. */
export async function runRetention(db, now, opts) {
  const o = typeof opts === 'number' ? { rows: opts } : (opts || {});
  const lim = o.rows || RETENTION_CHUNK.rows;
  let left = o.statements || RETENTION_CHUNK.statements;
  let rowsLeft = Number.isFinite(o.maxRows) ? o.maxRows : Infinity;
  const out = { events: 0, journey: 0, anon: 0, devices: 0, aggregate: 0, refused: 0, meta: 0, total: 0, statements: 0, drained: false };
  for (const [k, sql, cut] of retentionSteps(retentionCutoffs(now))) {
    for (;;) {
      if (left <= 0 || rowsLeft <= 0) return out;
      left--; out.statements++;
      const n = Math.min(lim, rowsLeft);
      const r = await db.prepare(sql).bind(cut, n).run();
      const gone = (r && r.meta && r.meta.changes) || 0;
      out[k] += gone; out.total += gone; rowsLeft -= gone;
      /* Fewer rows gone than `n`: the statement found fewer than `n` rows to delete, so it found them all,
         and the class is drained. A row class deletes every row it picks, so a full pick deletes `n`. In the
         linked class, a pick of `n` expired rows names visits holding at least those `n` rows, so it too
         deletes `n` and goes round again (or stops at the bounds above). */
      if (gone < n) break;
    }
  }
  out.drained = true;
  return out;
}

/* ---------- erasure (§10), in bounded steps ---------- */

/* An erasure deletes what one person (the account purge, the weekly orphan sweep) or one household (the
   household purge) stored, and nothing else bounds that: an active parent's year of daily totals and 90 days
   of events is about 10,000 rows, and a client that filled the families' share every day stores far more.
   One batch for all of it could pass what D1 allows one statement, would bill 4 or 5 rows for each row it
   deletes against the account's D1 day, and a batch too big to pass would fail on every retry
   (ERASE-CHUNK). So an erasure goes in STEPS:
   - A step deletes at most ERASE_CHUNK rows in all, every statement LIMITed, in one D1 batch (one
     transaction: a step that fails changes nothing).
   - A step takes its rows, before it runs and atomically (takeSlots, the day's 'erase' counter), from the
     SAME daily delete allowance as retention (worker.js retentionDailyRows). The allowance has two parts:
     retention's, `budget.dayMax` (the most a UTC day at the cap can expire, worker.js retentionDayMax), and
     the erasure FLOOR, the rest (a quarter of the cap less 100: 275 rows at the shipped 1,500). Until
     retention has finished the UTC day, erasures take only from the floor and retention only from its part,
     so neither can starve the other: before, a retention backlog took the whole allowance at midnight and an
     erasure asked for that day got nothing, not even her membership row, until the backlog drained, which
     at the cap is weeks (SE-V2). Once retention has finished the day an erasure may take all that is left;
     if it has not by the day's last cron tick, retention takes what the erasures left of the floor, through
     the erasures' own counter (worker.js usageRetention), so a backlog still drains at the whole allowance.
     Each side is held by a fixed part or an atomic counter, never by a figure read earlier, so retention
     and erasure together never delete more than the allowance in a UTC day, and wrangler.toml's figure
     holds with every erasure in it (SE-V3). So erasures get the floor every UTC day at least, all of them
     together, backlog or not, and once retention has run, all it left: on an ordinary day at the cap, where
     retention takes about two caps, about 375 rows (373 measured, less each step's own two); on a quiet
     day nearly all of the allowance.
   - An erasure is on record as a MARKER in usage_meta, erase_uid:<uid> or erase_hid:<hid>: `value` the time
     it was first written, `at` when the cron should next run a step for it. The household purge writes its
     marker before the household document goes (markHidErase). The account purge writes hers whenever she
     has any row at all, before the first of them goes (eraseUid): a row stored between a step's count and
     its batch is then found by a later step, where before the step that finished wrote no marker and the
     row stayed with nothing to find it but the weekly sweep (SE-V5). Every cron tick runs a step for the
     oldest markers that are due (erasePending). A step that finds nothing left clears its marker in the
     same transaction as the last rows, and only if no row of the target remains, so a row stored meanwhile
     keeps it.
   - A person's marker is HELD for ERASE_HOLD_MS after it was first written, the lifetime of the membership
     memory (MEMBERSHIP_TTL_MS): a step that finds nothing left before then moves the marker's `at` to the
     end of the hold instead of clearing it. While her marker is there worker.js usageMembership links
     nothing to her and remembers nothing of her, and by the time it goes, whatever any isolate remembered
     of her before her purge has expired (RE-SK-3). That is per person: before, the purge moved one shared
     epoch that made every isolate forget every person with no stored membership row, so any signed-in
     account calling her own purge every ten minutes sent all of them back to Firestore (SE-V8). A purge
     that finds nothing of hers writes nothing at all.
   - A step that fails changes nothing and leaves its marker, and what it took of the day stays taken: D1
     may bill the writes of a batch that then rolled back (not proven either way), so giving it back could
     let a step that fails every tick bill more rows in a day than wrangler.toml's figure holds. Instead the
     cron moves the failed marker to the back of the queue (erasePending, its `at` to now, paid from the
     step's own two rows), so an erasure that keeps failing runs after every other one that is due and takes
     only what they leave of the day. Before, it kept the oldest slot, ran first every tick and used up the
     day before any other erasure could start, every day (SE-V4). Now every other erasure goes ahead of it
     within a tick and finishes, at the latest a UTC day later, and a step that failed once is retried on
     the next tick.
   A step starts a target only once every target before it is empty: a person's membership row goes first,
   so nothing links her to a household after her first step, then the small tables, then her events.
   WHICH ROWS FIRST (F5, SE-V1). A step's limit can stop inside a visit, and what is left of the visit must
   never show a dose visit's minute. The admin shows a visit's minute only while it holds its head
   (visit.started) AND its end (visit.ended) and no dose (workers/admin/src/usage.mjs, SHOWN and HOUR_ONLY),
   so no step may take a visit's dose while its head and its end both stay. Every events statement takes
   heads and ends before any other row (CUT_ORDER): a visit cut by a step has lost its head or its end, and
   shows its hour only, or not at all. Before, the account purge's events statement had no order and SQLite
   read her rows visit by visit, in id order, so a cut could take a dose and leave the head and the end.
   Every row of a person's visit is hers, so that order is enough for the account purge, a batch of her
   visits at a time (VISITS_OF_UID, below). A household's visit can also hold rows of another family (she
   moved part-way), and its rows that do NOT carry the household go before the ones that do, because those
   are how a later step finds the visit again. So a household goes a batch of its visits at a time
   (VISITS_OF_HID, below), each batch in this order: first the heads of its visits (HEADS_OF_HID), except a
   head that is its visit's way back; then the rows of its visits that do not carry the household, ends
   first; then the batch's rows that do. A visit whose way back is a row that is not its head loses every
   head first; a visit whose way back is its head keeps that head until its other rows are gone, ends first,
   so it loses its end before its dose and shows its hour only. test/usage-erasure.test.js asks the admin's
   real Visits tab after every step of a household erasure taken one row at a time, and after every step of
   a 14,745-row household with a visit of every shape. */
export const ERASE_CHUNK = 1000;
/* The markers a cron tick runs a step for, at most (three D1 calls each, four for one that fails), so a tick
   spends a known number. */
export const ERASE_STEPS_PER_TICK = 3;
export const PENDING_UID = 'erase_uid:';
export const PENDING_HID = 'erase_hid:';
/* How long an isolate may answer a person's household from memory (worker.js usageMembership), and so how
   long her erasure marker is held after it is first written. One number, so the two can never drift. */
export const MEMBERSHIP_TTL_MS = 6 * 3600000;
export const ERASE_HOLD_MS = MEMBERSHIP_TTL_MS;
/* What the day can expire beyond two caps, at the most: aggregate daily rows for one local day (4 platforms
   x 13 keys: visits, seconds, signin_failed, two pre-sign-in screens, four pregnancy screens, four pregnancy
   features), 9 refusal reasons, and 5 day counters, which is 66. test/usage-erasure.test.js recounts it from
   dailyAdds, PLATFORMS, REFUSED and the counters, and fails if it passes this. */
export const RETENTION_DAY_EXTRA = 100;

/* The rows retention has deleted on `day`, from its 'retention_rows' record ('YYYY-MM-DD:n', written by
   worker.js usageRetention). */
export function retentionSpent(value, day) {
  const [d, n] = String(value || '').split(':');
  return d === day ? Number(n) || 0 : 0;
}

/* What erasure may still take of `day`'s delete allowance. `state` is { rday, rrows, spent }: the day
   retention last finished, its rows on record, and the erase counter. Until retention has finished the day,
   retention's part (at least budget.dayMax) is not erasure's to take, so erasure has the floor at most. */
export function eraseRoom(state, day, budget) {
  const ret = retentionSpent(state.rrows, day);
  const reserved = state.rday === day ? ret : Math.max(ret, budget.dayMax);
  const cap = Math.max(0, budget.allowance - reserved);
  return { cap, left: Math.max(0, cap - (Number(state.spent) || 0)) };
}

/* Each target: [table, which rows, the bounded statement], bound (?1 the uid or hid, ?2 at most this many).
   Every statement names the table it reads `e`. */
const CUT_ORDER = " ORDER BY name IN ('visit.started', 'visit.ended') DESC";
const rowsOf = (t, where) => 'DELETE FROM ' + t + ' WHERE rowid IN (SELECT rowid FROM ' + t + ' e WHERE ' + where + ' LIMIT ?2)';
const eventsOf = (where, order) => 'DELETE FROM usage_events WHERE (who, id) IN (SELECT who, id FROM usage_events e WHERE ' + where + (order || '') + ' LIMIT ?2)';
/* A household's visits go a BATCH at a time (SK2-2): the visits of its next ERASE_CHUNK + 1 rows, oldest
   first (pinned to ue_hid_at, so every statement of a step reads the same rows in the same order), counting
   only the rows that are a visit's WAY BACK: a row carrying the household that is not the visit's head, or
   a head carrying it whose visit has no other kind of row carrying it (that head is then how a later step
   finds the visit's other rows). Whether a head is one is read from its own visit's rows (ue_visit), so the
   batch reads about its own rows and the heads it skips on the way to them: heads that arrived before the
   batch's rows and whose visits' other rows arrived later. For visits as Cubby's tracker sends them (a
   visit's head arrives with its first other rows, or shortly before them, not ahead of a batch's worth of
   the household's other rows) those are about the batch's own heads, whatever the
   household holds. A client that sends many visits' heads first and their other rows later is not bounded
   this way: every evaluation of the batch re-reads all of those heads, on every step, until their other
   rows go. On D1, a household step with 10,000 such visits read up to 116,014 rows, against up to 36,014
   for the same 10,000 visits sent head with body, and with 30,000 up to 316,014 (an open question for phase
   3, docs/ADMIN-DEPLOY.md). Nor is one visit id reused across many rows: the batch's own rows are every row
   of its visits, so on D1 a household step read 89,037 rows for one visit of 20,000 (and a person's step,
   through VISITS_OF_UID below, 45,006). A household step also scans the membership table, which has no
   index on hid (see ERASE_TARGETS). Taking a head that is not a way back never changes which rows those
   are, and neither does taking a row that does not carry the household, so the batch is the same for the
   step's plan and for each of its statements until the batch's own rows go, last. The batch's own rows are
   found through its visits (`+hid` keeps that statement off the household's index, which would read every
   row it has).
   Before, every count and every delete listed every visit the household had, so each step read all of its
   rows several times over, and a household's erasure read in all about the square of its size: on D1, 75,000
   to 100,000 rows a step for a household of 12,000, and 465,000 for one of 100,000 (SK2-2). A first batch
   that counted only rows that are not heads, and read the household's heads to learn whether any other row
   was left, still read every head-only visit on every statement: 90,000 rows a step for a household with
   6,000 of them, 258,000 with 20,000 (a phone in a crash loop sends a head and nothing else). */
const WAY_BACK = (a) => '(' + a + ".name <> 'visit.started' OR NOT EXISTS (SELECT 1 FROM usage_events k INDEXED BY ue_visit WHERE k.uid = " + a
  + '.uid AND k.visit = ' + a + ".visit AND k.hid = ?1 AND k.name <> 'visit.started'))";
const VISITS_OF_HID = '(uid, visit) IN (SELECT uid, visit FROM usage_events w INDEXED BY ue_hid_at WHERE hid = ?1 AND uid IS NOT NULL AND '
  + WAY_BACK('w') + ' ORDER BY at LIMIT ' + (ERASE_CHUNK + 1) + ')';
/* The heads of the batch's visits, but never a head that is its visit's way back. */
const HEADS_OF_HID = "name = 'visit.started' AND " + VISITS_OF_HID + ' AND (hid IS NOT ?1 OR NOT ' + WAY_BACK('e') + ')';
/* A person's events go a batch at a time too: the visits of her next ERASE_CHUNK + 1 rows, oldest first
   (ue_uid_at), each statement taking those visits' heads and ends first (CUT_ORDER). Every row of her visit is
   hers, so a visit in the batch is in it whole, and a step takes no other row of a visit before its head and
   its end. Before, the statement sorted every row she has to find the heads and the ends, on every step: on
   D1 up to 24,234 rows a step for a person of 10,000 rows and 204,234 for one of 100,000 (SK2-2). The
   batch's visits hold at least as many rows as a step may take (ERASE_CHUNK), so a step takes what its plan
   counted. */
const VISITS_OF_UID = '(uid, visit) IN (SELECT uid, visit FROM usage_events INDEXED BY ue_uid_at WHERE uid = ?1 ORDER BY at LIMIT ' + (ERASE_CHUNK + 1) + ')';
/* A row carrying the household that no visit reaches (one with no uid: none is stored that way), once no
   row with a uid carries it. The household is the index key, NULL until then, so until then this reads
   nothing. */
const STRAYS_OF_HID = 'hid = (SELECT ?1 WHERE NOT EXISTS (SELECT 1 FROM usage_events INDEXED BY ue_hid_at WHERE hid = ?1 AND uid IS NOT NULL))';
const ERASE_TARGETS = {
  uid: [
    ['membership', 'uid = ?1', rowsOf('membership', 'uid = ?1')],
    ['devices', 'uid = ?1', rowsOf('devices', 'uid = ?1')],
    ['nudges', 'uid = ?1', rowsOf('nudges', 'uid = ?1')],
    ['shared_entries', 'shared_by = ?1', rowsOf('shared_entries', 'shared_by = ?1')],
    ['usage_daily', 'uid = ?1', rowsOf('usage_daily', 'uid = ?1')],
    ['usage_events', 'uid = ?1', eventsOf(VISITS_OF_UID, CUT_ORDER)],
    /* No target for a row filed under her who but another uid: ingest stores who = uid for every signed-in
       row and 'anon_' + device before sign-in, and nothing rewrites either, so none exists. It matched
       nothing and still cost a read of every row she has (the primary key's who), in every plan and in the
       last step's check, which is what a heavy erasure re-read on every tick (SK2-2). */
  ],
  hid: [
    /* membership has no index on hid (schema/usage.sql), so this target is found by scanning the table:
       whole in every step's plan, up to whole in the UPDATE of the step that unlinks the members (it stops
       once it has them all), and whole again in CLEAR.hid's check on the step that clears the marker; a
       household small enough to go in one step can do all three. On D1, with 10,000 other people's rows,
       that adds 10,000 to 30,000 rows read a step (33,579 against 3,579 for a 200-row household's one
       step). An index on membership(hid) makes all three searches, but a new membership row then bills 4
       written rows, not 3, so wrangler.toml's write arithmetic changes with it (45,086 to 46,086 at the
       shipped cap): a phase-3 decision (docs/ADMIN-DEPLOY.md, phase 3). */
    ['membership', 'hid = ?1', 'UPDATE membership SET hid = NULL, role = NULL WHERE rowid IN (SELECT rowid FROM membership WHERE hid = ?1 LIMIT ?2)'],
    ['usage_events', HEADS_OF_HID, eventsOf(HEADS_OF_HID)],
    ['usage_events', VISITS_OF_HID + ' AND hid IS NOT ?1', eventsOf(VISITS_OF_HID + ' AND hid IS NOT ?1', CUT_ORDER)],
    ['usage_events', VISITS_OF_HID + ' AND +hid = ?1', eventsOf(VISITS_OF_HID + ' AND +hid = ?1', CUT_ORDER)],
    ['usage_events', STRAYS_OF_HID, eventsOf(STRAYS_OF_HID)],
    ['usage_daily', 'hid = ?1', rowsOf('usage_daily', 'hid = ?1')],
    ['nudges', 'hid = ?1', rowsOf('nudges', 'hid = ?1')],
    ['shared_entries', 'hid = ?1', rowsOf('shared_entries', 'hid = ?1')],
  ],
};
/* Where the day's allowance stands, as eraseRoom reads it: the day retention last finished, its rows on
   record, and the erasures' counter (bound ?7 in DUE below, ?3 in planSql). */
const COUNTERS_AT = (k) => "(SELECT value FROM usage_meta WHERE key = 'retention_day') AS rday, (SELECT value FROM usage_meta WHERE key = 'retention_rows') AS rrows,"
  + ' (SELECT value FROM usage_meta WHERE key = ' + k + ') AS spent';
const COUNTERS = COUNTERS_AT('?7');
/* One read: each target's rows, counted up to ?2, and where the day's allowance stands. */
const planSql = (kind) => 'SELECT ' + ERASE_TARGETS[kind].map(([t, where], i) => '(SELECT COUNT(*) FROM (SELECT 1 FROM ' + t + ' e WHERE ' + where + ' LIMIT ?2)) AS c' + i).join(', ')
  + ', ' + COUNTERS_AT('?3');
/* The marker goes only with the last of the rows, bound (?1 the target, ?2 the marker's key), and a
   person's only once its hold is over (?3, the time a marker must have been written by). */
const NONE_LEFT = (kind) => ERASE_TARGETS[kind].map(([t, where]) => ' AND NOT EXISTS (SELECT 1 FROM ' + t + ' e WHERE ' + where + ')').join('');
const CLEAR = {
  hid: 'DELETE FROM usage_meta WHERE key = ?2' + NONE_LEFT('hid'),
  uid: 'DELETE FROM usage_meta WHERE key = ?2 AND CAST(value AS INTEGER) <= ?3' + NONE_LEFT('uid'),
};
/* A person's marker whose hold is not over yet, with nothing of hers left, waits for the end of the hold:
   bound as CLEAR.uid. With a row of hers stored meanwhile it stays due, so the next tick takes that row. */
const HOLD = 'UPDATE usage_meta SET at = CAST(value AS INTEGER) + ' + ERASE_HOLD_MS + ' WHERE key = ?2 AND CAST(value AS INTEGER) > ?3' + NONE_LEFT('uid');
/* A new marker: written once (a later purge leaves it as it is), `value` when, `at` when it is next due. */
const MARK = 'INSERT INTO usage_meta (key, value, at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING';

/* One step for one target. `budget` is { allowance, dayMax } (worker.js usageDeleteBudget).
   `opts.mark`: the account purge, which puts the erasure on record before any of her rows goes, held when
   this step takes all of them. `opts.clear`: a marker is there already (the household purge and the cron),
   and a step that finds nothing left clears it, or holds it.
   Returns { done, erased, ran }: `ran` is false when today's allowance left no room for it. A cron step
   (`opts.clear`) also returns `left`, what the erasures may still take of the day after it, where
   erasePending stops. A step whose batch fails throws, and what it took of the day stays taken. */
async function eraseStep(db, kind, id, now, budget, opts) {
  if (!budget || !Number.isFinite(budget.allowance) || !Number.isFinite(budget.dayMax)) throw new Error('erase_budget');
  const day = new Date(now).toISOString().slice(0, 10);
  const marker = (kind === 'uid' ? PENDING_UID : PENDING_HID) + id;
  const targets = ERASE_TARGETS[kind];
  const plan = (await db.prepare(planSql(kind)).bind(id, ERASE_CHUNK + 1, ceilingKey('erase', day)).first()) || {};
  const room = eraseRoom(plan, day, budget);
  // Two rows of every step are its own: the counter's write, and the marker's (written, held or cleared).
  let left = Math.min(ERASE_CHUNK, room.left - 2);
  const takes = [];
  let done = true, any = false;
  targets.forEach((x, i) => {
    const c = Number(plan['c' + i]) || 0;
    if (c) any = true;
    const t = done ? Math.max(0, Math.min(c, left)) : 0;
    takes.push(t); left -= t;
    if (c > t) done = false;
  });
  const rows = takes.reduce((a, b) => a + b, 0);
  const mark = (due) => db.prepare(MARK).bind(marker, String(now), due).run();
  const deletes = [];
  targets.forEach(([, , sql], i) => { if (takes[i] > 0) deletes.push(db.prepare(sql).bind(id, takes[i])); });
  if (opts.mark) {
    // Nothing of hers is stored: nothing is written, not even a marker (SE-V8).
    if (!any) return { done: true, erased: 0, ran: true };
    // No room today: on record only, so she is linked to nobody and the cron takes her rows when there is.
    if (!rows || !(await takeSlots(db, 'erase', day, rows + 2, room.cap, now))) { await mark(now); return { done: false, erased: 0, ran: false }; }
    // On record before any row goes; due now if rows remain, else at the end of its hold.
    await mark(done ? now + ERASE_HOLD_MS : now);
    let res;
    try { res = await db.batch(deletes); }
    catch (e) {
      // Due at once again, so the cron's next tick retries it rather than the end of the hold.
      if (done) { try { await db.prepare('UPDATE usage_meta SET at = ? WHERE key = ?').bind(now, marker).run(); } catch (e2) { /* then at the end of the hold */ } }
      throw e;
    }
    return { done, erased: res.reduce((a, r) => a + ((r && r.meta && r.meta.changes) || 0), 0), ran: true };
  }
  if (!rows && !done) return { done: false, erased: 0, ran: false, left: room.left };
  if (!(await takeSlots(db, 'erase', day, rows + 2, room.cap, now))) return { done: false, erased: 0, ran: false, left: room.left };
  const stmts = deletes.slice();
  if (done && kind === 'hid') stmts.push(db.prepare(CLEAR.hid).bind(id, marker));
  if (done && kind === 'uid') stmts.push(db.prepare(CLEAR.uid).bind(id, marker, now - ERASE_HOLD_MS), db.prepare(HOLD).bind(id, marker, now - ERASE_HOLD_MS));
  const res = await db.batch(stmts);
  const erased = res.slice(0, deletes.length).reduce((a, r) => a + ((r && r.meta && r.meta.changes) || 0), 0);
  /* A household's plan sees one batch of its visits, so whether the step finished it is what its CLEAR
     found: nothing left, and the marker gone. */
  if (done && kind === 'hid') done = !!(res[deletes.length] && res[deletes.length].meta && res[deletes.length].meta.changes > 0);
  return { done, erased, ran: true, left: room.left - rows - 2 };
}

/* One person's every usage row: called by the account purge with the VERIFIED uid. The first step runs at
   once; what it cannot finish is on record and goes on the next cron ticks. */
export async function eraseUid(db, uid, now, budget) {
  if (!uid) return { done: true, erased: 0, ran: true };
  return eraseStep(db, 'uid', uid, now, budget, { mark: true });
}

/* A household purge that has not finished its usage rows yet. The purge writes this marker BEFORE the
   household document goes, so an erasure that fails after the document is gone is still on record and the
   cron carries it on (erasePending). */
export async function markHidErase(db, hid, now) {
  if (!hid) throw new Error('no_hid');
  await db.prepare('INSERT INTO usage_meta (key, value, at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at')
    .bind(PENDING_HID + hid, String(now), now).run();
}

/* A deleted household's rows, after its document is gone: one step, under the marker markHidErase wrote. */
export async function eraseHid(db, hid, now, budget) {
  if (!hid) return { done: true, erased: 0, ran: true };
  return eraseStep(db, 'hid', hid, now, budget, { clear: true });
}

/* The cron: one step for each of the oldest DUE markers, at most `steps` a call, people and households
   alike. The same read that lists them reads where the day's allowance stands (retention's record and the
   erasures' counter), and a step runs only while the erasures have room for a row of it beyond the step's
   own two. So a tick with no room left runs no plan at all: one statement, a few rows read (SK2-2). Before,
   every due marker's step ran its counts first and only then found no room, every tick, all day: on D1 a
   12,000-row household's pending erasure read about 53,000 rows a tick that way, over five million a UTC day,
   which is all D1 Free allows the whole account. A marker whose step finds nothing left needs only its own
   two rows, so on a day that leaves exactly two it waits for the next UTC day.
   A step that fails is moved to the back of the queue (its `at` to now: one row, from the two the failed
   step took for its own; if D1 refuses that too, it stays where it is, and nothing was deleted), and the
   call then throws so the cron logs it. Returns how many steps took all that their plan counted: a
   household's only when its marker went with those rows, a person's whether her marker was then cleared,
   held, or left due by a row of hers that landed between the step's count and its deletes. */
const DUE = 'SELECT key, ' + COUNTERS + ' FROM usage_meta WHERE ((key >= ?1 AND key < ?2) OR (key >= ?3 AND key < ?4)) AND at <= ?5 ORDER BY at LIMIT ?6';
export async function erasePending(db, now, budget, steps) {
  if (!budget || !Number.isFinite(budget.allowance) || !Number.isFinite(budget.dayMax)) throw new Error('erase_budget');
  const day = new Date(now).toISOString().slice(0, 10);
  const rows = ((await db.prepare(DUE).bind(PENDING_HID, PENDING_HID.slice(0, -1) + ';', PENDING_UID, PENDING_UID.slice(0, -1) + ';', now,
    steps || ERASE_STEPS_PER_TICK, ceilingKey('erase', day)).all()).results) || [];
  if (!rows.length) return 0;
  let left = eraseRoom(rows[0], day, budget).left;
  let finished = 0, failed = 0;
  for (const r of rows) {
    // No room for a row beyond the step's own two: no plan, no step, until there is.
    if (left <= 2) break;
    const kind = r.key.startsWith(PENDING_UID) ? 'uid' : 'hid';
    const id = r.key.slice((kind === 'uid' ? PENDING_UID : PENDING_HID).length);
    if (!id) continue;
    try {
      const s = await eraseStep(db, kind, id, now, budget, { clear: true });
      left = s.left;
      if (!s.ran) break;
      if (s.done) finished++;
    } catch (e) {
      failed++;
      try { await db.prepare('UPDATE usage_meta SET at = ? WHERE key = ?').bind(now, r.key).run(); }
      catch (e2) { /* D1 refusing: the marker keeps its place, and the step deleted nothing */ }
    }
  }
  if (failed) throw new Error('pending_erase_failed');
  return finished;
}

/* The weekly backstop. `exists(uids)` answers { known: Set } for the ones Auth still has, or throws.
   A lookup FAILURE never reads as "does not exist": a throw stops the sweep and marks nobody. Each uid Auth
   no longer has is put on record (a pending marker, held like any person's), and erasePending erases it in
   steps. Returns how many were marked. */
export async function orphanSweep(db, exists, now, batchSize) {
  /* Four terms. D1 refuses a compound SELECT of more than 5 (the node:sqlite shim takes 6 and more): one more
     table fits here, a sixth needs a second query. usage-d1 runs this on D1, with six terms as a mutant. */
  const rows = ((await db.prepare("SELECT DISTINCT uid FROM (SELECT uid FROM usage_events WHERE uid IS NOT NULL UNION SELECT uid FROM usage_daily WHERE uid != '' UNION SELECT uid FROM devices WHERE uid IS NOT NULL UNION SELECT uid FROM membership)").all()).results) || [];
  const uids = rows.map((r) => r.uid).filter(Boolean);
  const size = batchSize || 100;
  let marked = 0;
  for (let i = 0; i < uids.length; i += size) {
    const part = uids.slice(i, i + size);
    const ans = await exists(part);             // throws on failure: nothing below runs
    if (!ans || !(ans.known instanceof Set)) throw new Error('lookup_unusable');
    const gone = part.filter((u) => !ans.known.has(u));
    if (!gone.length) continue;
    await db.batch(gone.map((u) => db.prepare(MARK).bind(PENDING_UID + u, String(now), now)));
    marked += gone.length;
  }
  return marked;
}

/* ---------- the phone's copy ---------- */

/* The exact text of app/usage-allowlist.js. tools/gen_usage_allowlist.js writes it; the tracking-plan
   gate fails when the committed file differs. */
export function allowlistSource() {
  const events = {};
  for (const [name, spec] of Object.entries(USAGE_EVENTS)) {
    const props = {};
    for (const [k, p] of Object.entries(spec.props)) props[k] = p.enum ? { enum: p.enum } : p.int ? { int: p.int } : { format: p.format };
    events[name] = { anon: !!spec.anon, props };
    if (spec.anonScreens) events[name].anonScreens = spec.anonScreens;
  }
  const formats = {};
  for (const [k, re] of Object.entries(FORMATS)) formats[k] = re.source;
  return '/* GENERATED by tools/gen_usage_allowlist.js from workers/usage/core.mjs. Do not edit: the tracking-plan gate\n'
    + ' * fails when this file and core.mjs differ. The tracker drops anything not listed here before it is queued. */\n'
    + 'window.CUBBY_USAGE_ALLOWLIST = ' + JSON.stringify({ v: SCHEMA_VERSION, events, formats, journey: JOURNEY_KEYS }, null, 1) + ';\n';
}
