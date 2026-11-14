/* What the screens read, all from D1: the directory (cubby-admin), and read-only by code, the main
 * Worker's cubby-games (cron health, the digest) and cubby-newsletter (one row by email_hash).
 *
 * "Read-only by code" is a gate: no INSERT, UPDATE, DELETE, REPLACE or CREATE against GAMES_DB,
 * NEWSLETTER_DB or USAGE_DB anywhere under workers/admin/ (admin-access-log §5).
 */
import { utcDay } from './meter.mjs';
import { sha256hex } from './log.mjs';

const DAY = 86400000;
export const RANGE_DAYS = { today: 1, '7': 7, '30': 30, '90': 90 };

export async function allRows(db, sql, ...binds) {
  const st = db.prepare(sql);
  return ((await (binds.length ? st.bind(...binds) : st).all()).results) || [];
}

export async function directory(cfg) {
  const households = await allRows(cfg.db, 'SELECT * FROM dir_households ORDER BY display_no ASC');
  const people = await allRows(cfg.db, 'SELECT uid, hid, name, email, email_verified, relationship, role, joined_at, joined_source, signed_up_at, providers, '
    + 'acq_source, acq_content, referred, push_on, quiet, tz, team_notes, last_sign_in, last_refresh, entries_7d, is_internal FROM dir_people');
  const days = await allRows(cfg.db, 'SELECT day, hid, entries, authors FROM dir_household_days');
  const byHid = new Map(households.map((h) => [h.hid, Object.assign(h, { members: [], days: [] })]));
  for (const p of people) if (p.hid && byHid.has(p.hid)) byHid.get(p.hid).members.push(p);
  for (const d of days) if (byHid.has(d.hid)) byHid.get(d.hid).days.push(d);
  for (const h of households) {
    h.members.sort((a, b) => (a.role === 'owner' ? 0 : 1) - (b.role === 'owner' ? 0 : 1) || String(a.name).localeCompare(String(b.name)));
    try { h.invited = JSON.parse(h.invited_json || '[]'); } catch (e) { h.invited = []; }
  }
  const startedRow = await cfg.db.prepare("SELECT value FROM admin_meta WHERE key = 'directory_started'").first();
  return { households, people, byHid, started: startedRow ? startedRow.value : null };
}

export const visibleHousehold = (h, hideInternal) => !(hideInternal && h.is_internal);
export const visiblePerson = (p, byHid, hideInternal) => {
  if (!hideInternal) return true;
  if (p.is_internal) return false;
  const h = p.hid && byHid.get(p.hid);
  return !(h && h.is_internal);
};

export function rangeStart(range, now) {
  const n = RANGE_DAYS[range] || 7;
  return utcDay(now - (n - 1) * DAY);
}

/* The overview's record-based parts (phase 1). */
export function overviewNumbers(dir, now, range, hideInternal) {
  const from = rangeStart(range, now);
  const fromMs = Date.parse(from + 'T00:00:00Z');
  const live = dir.households.filter((h) => visibleHousehold(h, hideInternal) && !h.deletion_pending);
  const liveSet = new Set(live.map((h) => h.hid));
  const people = dir.people.filter((p) => p.hid && liveSet.has(p.hid) && visiblePerson(p, dir.byHid, hideInternal));
  const two = live.filter((h) => h.days.some((d) => d.day >= from && d.authors >= 2));
  const stages = { trying: 0, pregnant: 0, baby: 0, none: 0 };
  for (const h of live) stages[stages[h.stage] === undefined ? 'none' : h.stage]++;

  const signed = dir.people.filter((p) => p.signed_up_at && p.signed_up_at >= fromMs && visiblePerson(p, dir.byHid, hideInternal));
  const hh = (p) => (p.hid ? dir.byHid.get(p.hid) : null);
  const step = (fn) => signed.filter((p) => { const h = hh(p); return !!h && fn(h); }).length;
  const funnel = [
    ['Signed up', signed.length],
    ['Made a household', step(() => true)],
    ['First entry', step((h) => (h.entries_total || 0) > 0 || !!h.last_entry_day || h.days.length > 0)],
    ['Came back another day', step((h) => new Set(h.days.map((d) => d.day)).size >= 2)],
    ['Invited someone', step((h) => h.invited.length > 0 || h.members.length >= 2)],
    ['Second person joined', step((h) => h.members.length >= 2)],
    ['Two people logged on one day', step((h) => h.days.some((d) => d.authors >= 2))],
  ];
  const coveredFrom = dir.started && dir.started > from ? dir.started : null;
  return {
    from, coveredFrom,
    households: live.length,
    newHouseholds: live.filter((h) => h.created_at && h.created_at >= fromMs).length,
    people: people.length,
    twoLogging: two.length,
    stages, funnel,
  };
}

/* The three phase-1 system checks. Each answers {state: 'ok'|'bad'|'off', line}. */
export async function canaryCheck(cfg) {
  if (!cfg.main) return { state: 'off', line: 'Not connected yet' };
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    let r;
    try { r = await cfg.main.fetch(new Request('https://little-cubby.com/api/canary', { signal: ctl.signal })); }
    finally { clearTimeout(t); }
    const j = await r.json();
    const mins = Math.max(0, Math.round((Number(j && j.ageSeconds) || 0) / 60));
    const ago = mins <= 1 ? 'a minute ago' : mins + ' minutes ago';
    if (j && j.ok === true) return { state: 'ok', line: 'Working · test code ' + ago };
    const why = { stale: 'the test has not run for ' + mins + ' minutes', failing: 'the last test code failed', never_run: 'the test has never run', unavailable: 'the check could not be read' };
    return { state: 'bad', line: 'Not working · ' + (why[j && j.code] || 'the check failed') };
  } catch (e) { return { state: 'bad', line: 'Not working · the check could not be reached' }; }
}

export async function remindersCheck(cfg, now) {
  if (!cfg.games) return { state: 'off', line: 'Not connected yet' };
  try {
    const rows = await allRows(cfg.games, "SELECT key, value, updated_at FROM ops_state WHERE key IN ('push_last_run', 'push_daily')");
    const last = rows.find((r) => r.key === 'push_last_run');
    const daily = rows.find((r) => r.key === 'push_daily');
    if (!last) return { state: 'bad', line: 'Not running · no run recorded' };
    const mins = Math.round((now - Number(last.updated_at)) / 60000);
    let s = {}; try { s = JSON.parse(last.value || '{}'); } catch (e) {}
    let d = { sent: 0, failed: 0 }; try { const v = JSON.parse((daily && daily.value) || '{}'); if (v.day === utcDay(now)) d = v; } catch (e) {}
    if (mins > 60) return { state: 'bad', line: 'Not running · last run ' + mins + ' minutes ago' };
    if (s.queryError || s.fallback === 'failed') return { state: 'bad', line: 'Not working · the last run could not read reminders' };
    const tally = (d.sent || 0) + ' sent today, ' + (d.failed || 0) + ' failed';
    if ((s.failed || 0) > 0 && !(s.sent || 0)) return { state: 'bad', line: 'Not sending · ' + tally };
    return { state: 'ok', line: 'Working · ' + tally };
  } catch (e) { return { state: 'bad', line: 'Not working · could not read the cron record' }; }
}

export function lastMonday(now) {
  const d = new Date(utcDay(now) + 'T00:00:00Z');
  const back = (d.getUTCDay() + 6) % 7;
  return utcDay(d.getTime() - back * DAY);
}

export async function digestCheck(cfg, now, fmtDay) {
  if (!cfg.games) return { state: 'off', line: 'Not connected yet' };
  try {
    const sent = await cfg.games.prepare("SELECT value FROM funnel_meta WHERE key = 'digest_last'").first();
    const snap = await cfg.games.prepare('SELECT ok, attempts FROM funnel_snapshots WHERE day = ?').bind(utcDay(now)).first();
    const mon = lastMonday(now);
    const last = sent && /^\d{4}-\d{2}-\d{2}$/.test(sent.value) ? sent.value : null;
    const snapLine = snap && !snap.ok ? ' · today\'s snapshot failed (attempt ' + Number(snap.attempts) + ' of 3)' : '';
    if (last && last >= mon) return { state: snapLine ? 'bad' : 'ok', line: 'Working · sent ' + fmtDay(last) + snapLine };
    if (mon === utcDay(now)) return { state: snapLine ? 'bad' : 'ok', line: 'Due today' + snapLine };
    return { state: 'bad', line: 'Not sending · last good run ' + (last ? fmtDay(last) : 'never') + snapLine };
  } catch (e) { return { state: 'bad', line: 'Not working · could not read the digest record' }; }
}

/* cubby-newsletter: exactly `SELECT stage, status ... WHERE email_hash = ?` with the hash of the verified
   Auth address (spec §5.3). Never email, never unsub_token (a credential). */
export async function newsletterFor(cfg, email) {
  if (!cfg.newsletter || !email) return null;
  try {
    const h = await sha256hex(String(email).trim().toLowerCase());
    return await cfg.newsletter.prepare('SELECT stage, status FROM subscribers WHERE email_hash = ?').bind(h).first();
  } catch (e) { return null; }
}

/* A time zone, as a place a person would recognise. */
const TZ_PLACES = {
  'Asia/Dubai': ['Dubai', 'UAE'], 'Asia/Muscat': ['Muscat', 'Oman'], 'Asia/Riyadh': ['Riyadh', 'Saudi Arabia'],
  'Asia/Qatar': ['Doha', 'Qatar'], 'Asia/Kolkata': ['India', 'India'], 'Asia/Calcutta': ['India', 'India'],
  'Asia/Karachi': ['Karachi', 'Pakistan'], 'Asia/Singapore': ['Singapore', 'Singapore'], 'Europe/London': ['London', 'UK'],
  'Europe/Dublin': ['Dublin', 'Ireland'], 'Europe/Berlin': ['Berlin', 'Germany'], 'Europe/Paris': ['Paris', 'France'],
  'America/New_York': ['New York', 'US'], 'America/Chicago': ['Chicago', 'US'], 'America/Denver': ['Denver', 'US'],
  'America/Los_Angeles': ['Los Angeles', 'US'], 'America/Toronto': ['Toronto', 'Canada'], 'Australia/Sydney': ['Sydney', 'Australia'],
  'Africa/Lagos': ['Lagos', 'Nigeria'], 'Africa/Nairobi': ['Nairobi', 'Kenya'], UTC: ['UTC', ''],
};
export function place(tz) {
  if (!tz) return null;
  if (TZ_PLACES[tz]) return { city: TZ_PLACES[tz][0], country: TZ_PLACES[tz][1] };
  const city = tz.split('/').pop().replace(/_/g, ' ');
  return { city, country: '' };
}

const SOURCES = { instagram: 'Instagram', ig: 'Instagram', facebook: 'Facebook', fb: 'Facebook', google: 'Search', bing: 'Search',
  search: 'Search', newsletter: 'Newsletter', email: 'Email', tiktok: 'TikTok', whatsapp: 'WhatsApp', paid: 'Paid test', 'paid-test': 'Paid test',
  producthunt: 'Product Hunt', reddit: 'Reddit', friend: 'Friend', other: 'Somewhere else' };
export function cameFrom(p, h) {
  if (p.role === 'caregiver' && p.joined_source === 'member_info' && h && h.owner_first_name) return 'Invite from ' + h.owner_first_name;
  if (p.referred) return 'Invite';
  if (!p.acq_source) return 'Not recorded';
  return SOURCES[p.acq_source] || (p.acq_source.charAt(0).toUpperCase() + p.acq_source.slice(1));
}
export const PROVIDER_LABEL = { google: 'Google', apple: 'Apple', email: 'Email' };
export const signsInWith = (p) => (p.providers ? p.providers.split(',').filter(Boolean).map((x) => PROVIDER_LABEL[x] || 'Email').join(', ') : '');
