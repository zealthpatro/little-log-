/* One set of "since" rules for the home-screen widgets, shared by the app (as the generated
   app/since-rules.js) and the Worker. Pure: no I/O, no clock of its own, no storage.
   RULES, DEFAULTS and SNAPSHOT_VERSIONS come from docs/widgets/widget-copy.json through the generated
   ./widget-rules.mjs. Edit this file, then run: node tools/widget_gen.js */
import { RULES, DEFAULTS, SNAPSHOT_VERSIONS } from './widget-rules.mjs';
export { RULES, DEFAULTS, SNAPSHOT_VERSIONS };

const DAY_MS = 86400000;

/* app/index.html sinceAnchor, to the letter: when did this last END, not when did it start. */
export function sinceAnchor(type, ev) {
  if (!ev) return null;
  if (type === 'sleep' && ev.end) return ev.end;
  if (type === 'feed' && ev.dur > 0) return ev.time + ev.dur;
  return ev.time;
}

/* The newest live feed, ended sleep and nappy of one baby, newest by `time` as Home orders them. */
export function babyAnchors(events, babyId) {
  const mine = (events || [])
    .filter((e) => e && e.babyId === babyId && !e.deleted)
    .sort((a, b) => b.time - a.time);
  return {
    feed: mine.find((e) => e.type === 'feed') || null,
    sleep: mine.find((e) => e.type === 'sleep' && e.end) || null,
    nappy: mine.find((e) => e.type === 'diaper') || null,
  };
}

/* Health shows while an illness is open and something was entered for it inside healthReturnMs. */
export function healthOpen(illnesses, events, babyId, now) {
  const cutoff = now - RULES.healthReturnMs;
  let latest = 0;
  for (const e of events || []) {
    if (e && e.babyId === babyId && !e.deleted
        && (e.type === 'temperature' || e.type === 'symptom' || e.type === 'medicine')
        && Number.isFinite(e.time) && e.time > latest) latest = e.time;
  }
  return (illnesses || []).some((i) => {
    if (!i || i.babyId !== babyId || i.endedAt) return false;
    const started = Number.isFinite(i.startedAt) ? i.startedAt : 0;
    return Math.max(started, latest) > cutoff;
  });
}

export function isTwins(babies) {
  if (!Array.isArray(babies) || babies.length !== 2) return false;
  const [a, b] = babies;
  if (!a || !b || !Number.isFinite(a.birth) || !Number.isFinite(b.birth)) return false;
  return Math.abs(a.birth - b.birth) <= RULES.twinsToleranceMs;
}

/* app/index.html ageString, as a unit and a number. */
export function ageOf(birth, now) {
  if (!birth) return null;
  const days = Math.floor((now - birth) / DAY_MS);
  if (!(days >= 0)) return null;
  if (days < 14) return { unit: 'day', n: days };
  if (days < 60) return { unit: 'week', n: Math.floor(days / 7) };
  if (days < 730) return { unit: 'month', n: Math.floor(days / 30.44) };
  return { unit: 'year', n: Math.floor(days / 365) };
}

/* The next `count` month days at or after now's local midnight (today counts): monthiversary's
   arithmetic, setMonth overflow included. Month 12 reads as 1 year, 24, 36... as years; the rest
   from 25 on are skipped. */
export function monthMoments(birthTs, now, count = 2) {
  if (!Number.isFinite(birthTs) || !Number.isFinite(now) || !(count >= 1)) return [];
  const bd = new Date(birthTs), t = new Date(now);
  let m0 = (t.getFullYear() - bd.getFullYear()) * 12 + (t.getMonth() - bd.getMonth());
  if (t.getDate() < bd.getDate()) m0--;
  const today = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  const out = [];
  const last = Math.max(1, m0 - 1) + 12 * (count + 3);
  for (let m = Math.max(1, m0 - 1); m <= last && out.length < count; m++) {
    const mark = new Date(birthTs);
    mark.setMonth(new Date(birthTs).getMonth() + m);
    const at = new Date(mark.getFullYear(), mark.getMonth(), mark.getDate()).getTime();
    if (at < today) continue;
    if (m <= 11 || (m >= 13 && m <= 23)) out.push({ at, unit: 'month', n: m });
    else if (m % 12 === 0) out.push({ at, unit: 'year', n: m / 12 });
  }
  return out;
}

export function sleepEventId(babyId, start) {
  return 'sleep-' + babyId + '-' + start;
}

/* One baby of the app snapshot, keys in the order of the shared-container contract. */
export function snapshotBaby({ baby, events, illnesses, nap, now, label }) {
  const a = babyAnchors(events, baby.id);
  const at = { feed: sinceAnchor('feed', a.feed), sleep: sinceAnchor('sleep', a.sleep), nappy: sinceAnchor('diaper', a.nappy) };
  const by = (ev) => (ev && label ? label(ev.authorId) || null : null);
  return {
    id: baby.id,
    name: Array.from(String(baby.name == null ? '' : baby.name).trim()).slice(0, RULES.nameMax).join(''),
    age: ageOf(baby.birth, now),
    last: { feed: at.feed, sleep: at.sleep, nappy: at.nappy },
    by: { feed: by(a.feed), sleep: by(a.sleep), nappy: by(a.nappy) },
    nap: nap && Number.isFinite(nap.start) ? { start: nap.start, ack: Number.isFinite(nap.ack) ? nap.ack : null } : null,
    healthOpen: healthOpen(illnesses, events, baby.id, now),
    moments: monthMoments(baby.birth, now),
  };
}
