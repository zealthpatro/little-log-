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
 * And the isolate remembers (the recordStep pattern): once a counter refuses, ctx.isolate keeps that UTC
 * day for that ceiling, and until the day turns this isolate answers those requests without touching D1
 * again: no membership read, no counter, no refusal row. worker.js keeps one isolate state at module
 * level; a test makes one per simulated isolate. Without one nothing is remembered, and each request
 * asks the counters (still bounded by them). The last few slots of a day can go unused: a batch bigger
 * than what is left marks that share full. */
export const REFUSED_DAILY_ROWS = 500;
export function newIsolate() { return { full: new Map() }; }
export function ceilingsOf(env) {
  const capRaw = parseInt(env && env.USAGE_DAILY_CAP, 10);
  const cap = Number.isFinite(capRaw) && capRaw >= 0 ? capRaw : 20000;
  const anon = Math.floor(cap / 4);
  return { cap, linked: cap - anon, anon, refused: REFUSED_DAILY_ROWS };
}
/* The counters' keys. All three sort under 'events_<day>' (the families' share keeps that key exactly), so
   one by-day range delete, key >= 'events_' AND key < 'events_<cutoff day>', retires every counter of a
   past day and none of a later day's, and no counter outlives its day (VI-3). */
const CEILING_SUFFIX = { linked: '', anon: '_anon', refused: '_refused' };
export function ceilingKey(kind, day) {
  return 'events_' + day + CEILING_SUFFIX[kind];
}

/* One atomic statement moves the day's counter by n only while it stays within cap; RETURNING gives no row
   once it would not (and then nothing is written). The day's FIRST statement inserts the counter without
   that comparison, so a batch bigger than the whole cap is refused here, before SQL. */
async function takeSlots(db, kind, day, n, cap, now) {
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
const JOURNEY_LIKE = JOURNEY_KEYS.map((k) => "props LIKE '%\"" + k + "\"%'").join(' OR ');

/* One retention call's bounds. `rows`: the expired rows one statement picks (in the linked class, every
   row of each picked row's visit goes with it). `statements`: statements one call runs at most, so a cron
   tick spends a known number of D1 calls whatever the backlog. */
export const RETENTION_CHUNK = { rows: 2000, statements: 10 };

/* The classes, in order. Each is repeated until a statement deletes less than a full chunk, which means
   nothing past its cutoff is left. A row class deletes rows; the linked class deletes VISITS: once the
   oldest row of a person's visit is past 90 days, every row of that visit goes in the same statement, so
   no visit is ever split into a surviving tail (F5: a dose visit's leftover rows would show their own
   minutes and, without the dose row, no longer read as a dose visit). A visit only ever goes EARLY,
   never late, so "no event older than 90 days remains" (S25) holds for every row of it.
   Anonymous rows (uid NULL) never hold a dose or a health entry (feature.used needs sign-in), and a
   JOURNEY_KEYS row is never one either, so those two classes go row by row.
   INDEXED BY ue_at: without table statistics SQLite would walk the whole of ue_visit to find old rows;
   this way a statement reads the expired rows and stops at its limit. */
function retentionSteps(c, lim) {
  return [
    ['anon', 'DELETE FROM usage_events WHERE (who, id) IN (SELECT who, id FROM usage_events WHERE uid IS NULL AND at < ? LIMIT ?)', c.anon],
    ['events', 'DELETE FROM usage_events WHERE (uid, visit) IN (SELECT uid, visit FROM usage_events INDEXED BY ue_at WHERE at < ? AND uid IS NOT NULL LIMIT ?)', c.events],
    ['journey', 'DELETE FROM usage_events WHERE (who, id) IN (SELECT who, id FROM usage_events WHERE at < ? AND (' + JOURNEY_LIKE + ') LIMIT ?)', c.journey],
    ['aggregate', "DELETE FROM usage_daily WHERE rowid IN (SELECT rowid FROM usage_daily WHERE uid = '' AND local_day < ? LIMIT ?)", c.aggregateDay],
    ['refused', 'DELETE FROM usage_refused WHERE rowid IN (SELECT rowid FROM usage_refused WHERE day < ? LIMIT ?)', c.refusedDay],
    /* A phone never signed in: its devices row goes with its anonymous events, 30 days after it was last seen. */
    ['devices', 'DELETE FROM devices WHERE rowid IN (SELECT rowid FROM devices WHERE uid IS NULL AND last_seen < ? LIMIT ?)', c.anon],
    /* The day ceiling's counters (events_YYYY-MM-DD), kept as long as the refusal counts. */
    ['meta', "DELETE FROM usage_meta WHERE key IN (SELECT key FROM usage_meta WHERE key >= 'events_' AND key < ? LIMIT ?)", 'events_' + c.refusedDay],
  ];
}

/* The daily run (§10), in bounded chunks. Returns the rows each class lost, `total`, `statements`, and
   `drained`: true only when EVERY class reached a statement that found less than a full chunk, so nothing
   past its cutoff remains. The cron records the day as done only then; until it does, every later tick
   carries on where this one stopped. `opts.maxRows` stops early once that many rows are gone (the daily
   delete allowance; see usageMaintenance). A number as `opts` is the old row chunk. */
export async function runRetention(db, now, opts) {
  const o = typeof opts === 'number' ? { rows: opts } : (opts || {});
  const lim = o.rows || RETENTION_CHUNK.rows;
  let left = o.statements || RETENTION_CHUNK.statements;
  let rowsLeft = Number.isFinite(o.maxRows) ? o.maxRows : Infinity;
  const out = { anon: 0, events: 0, journey: 0, aggregate: 0, refused: 0, devices: 0, meta: 0, total: 0, statements: 0, drained: false };
  for (const [k, sql, cut] of retentionSteps(retentionCutoffs(now), lim)) {
    for (;;) {
      if (left <= 0 || rowsLeft <= 0) return out;
      left--; out.statements++;
      const n = Math.min(lim, rowsLeft);
      const r = await db.prepare(sql).bind(cut, n).run();
      const gone = (r && r.meta && r.meta.changes) || 0;
      out[k] += gone; out.total += gone; rowsLeft -= gone;
      /* Fewer rows gone than the pick: the statement found fewer than `n` expired rows, so it found them
         all, and the class is drained. Every picked row is itself deleted, so a full pick always deletes
         at least `n` rows and goes round again (or stops at the bounds above). In the linked class the
         rest of each picked visit goes too, so one statement can pass `maxRows` by those rows only. */
      if (gone < n) break;
    }
  }
  out.drained = true;
  return out;
}

/* One person's every usage row: called by the account purge with the VERIFIED uid. */
export async function eraseUid(db, uid) {
  if (!uid) return 0;
  const sqls = [
    'DELETE FROM usage_events WHERE uid = ?', 'DELETE FROM usage_events WHERE who = ?', 'DELETE FROM usage_daily WHERE uid = ?',
    'DELETE FROM devices WHERE uid = ?', 'DELETE FROM membership WHERE uid = ?', 'DELETE FROM nudges WHERE uid = ?',
    'DELETE FROM shared_entries WHERE shared_by = ?',
  ];
  const res = await db.batch(sqls.map((s) => db.prepare(s).bind(uid)));
  return res.reduce((a, r) => a + ((r && r.meta && r.meta.changes) || 0), 0);
}

/* A household purge that has not finished its usage rows yet. The purge writes this marker BEFORE the
   household document goes, and eraseHid removes it in the same transaction as the rows, so an erasure
   that fails after the document is gone is still on record and the cron retries it (usageMaintenance). */
export const PENDING_HID = 'erase_hid:';
export async function markHidErase(db, hid, now) {
  if (!hid) throw new Error('no_hid');
  await db.prepare('INSERT INTO usage_meta (key, value, at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at')
    .bind(PENDING_HID + hid, hid, now).run();
}

/* A deleted household's rows, after its document is gone. Whole visits: every row of a visit that carried
   this household goes, so a visit that straddled a move between families is never left half there. Its
   pending marker goes in the same batch, so it clears only if the rows went. */
export async function eraseHid(db, hid) {
  if (!hid) return 0;
  const stmts = [
    db.prepare('DELETE FROM usage_events WHERE (uid, visit) IN (SELECT uid, visit FROM usage_events WHERE hid = ? AND uid IS NOT NULL)').bind(hid),
    ...['DELETE FROM usage_events WHERE hid = ?', 'DELETE FROM usage_daily WHERE hid = ?', 'DELETE FROM nudges WHERE hid = ?',
      'DELETE FROM shared_entries WHERE hid = ?', 'UPDATE membership SET hid = NULL, role = NULL WHERE hid = ?'].map((s) => db.prepare(s).bind(hid)),
    db.prepare('DELETE FROM usage_meta WHERE key = ?').bind(PENDING_HID + hid),
  ];
  const res = await db.batch(stmts);
  return res.slice(0, -1).reduce((a, r) => a + ((r && r.meta && r.meta.changes) || 0), 0);
}

/* The retry: households still marked pending, at most `max` a call, oldest first. Each is tried on its
   own; one that fails keeps its marker for the next tick, and the call then throws so the cron logs it.
   Returns how many households were finished. */
export async function erasePendingHids(db, max) {
  const rows = ((await db.prepare('SELECT value FROM usage_meta WHERE key >= ? AND key < ? ORDER BY at LIMIT ?')
    .bind(PENDING_HID, PENDING_HID.slice(0, -1) + ';', max || 5).all()).results) || [];
  let n = 0, failed = 0;
  for (const r of rows) {
    if (!r.value) continue;
    try { await eraseHid(db, r.value); n++; } catch (e) { failed++; }
  }
  if (failed) throw new Error('pending_hid_erase_failed');
  return n;
}

/* The weekly backstop. `exists(uids)` answers { known: Set } for the ones Auth still has, or throws.
   A lookup FAILURE never reads as "does not exist": a throw stops the sweep and deletes nothing. */
export async function orphanSweep(db, exists, batchSize) {
  const rows = ((await db.prepare("SELECT DISTINCT uid FROM (SELECT uid FROM usage_events WHERE uid IS NOT NULL UNION SELECT uid FROM usage_daily WHERE uid != '' UNION SELECT uid FROM devices WHERE uid IS NOT NULL UNION SELECT uid FROM membership)").all()).results) || [];
  const uids = rows.map((r) => r.uid).filter(Boolean);
  const size = batchSize || 100;
  let erased = 0;
  for (let i = 0; i < uids.length; i += size) {
    const part = uids.slice(i, i + size);
    const ans = await exists(part);             // throws on failure: nothing below runs
    if (!ans || !(ans.known instanceof Set)) throw new Error('lookup_unusable');
    for (const u of part) if (!ans.known.has(u)) erased += await eraseUid(db, u);
  }
  return erased;
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
