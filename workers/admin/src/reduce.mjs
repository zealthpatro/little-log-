/* Masked Firestore documents -> the few facts the dashboard may keep. Pure: no I/O, no clock but `now`.
 *
 * What survives these functions is the whole of what the team can ever see about a family (spec §3,
 * §5.1). Everything else dies here, in the function that read it:
 *   - a baby's name, sex, avatar, country and birthday (only a count and an age label survive);
 *   - an invitee's address (the KEYS of pendingInvites) and name, and a live invite token (the KEYS of
 *     pendingLinks) and the address it was sent to: only a relationship label and a sent day survive;
 *   - a member's photo;
 *   - an entry's own time (only its UTC day survives), and its raw type (only a coarse kind, and only as
 *     a 7-day count per household, never per day);
 *   - a pregnancy that is not shared with anyone else in the circle: treated EXACTLY as if it did not
 *     exist (A11, S41), so no stage, count or label can hint at it;
 *   - users/{uid}.email and .name, which the client can set to anything (S42): never read at all.
 * test/admin-no-content.test.js seeds every one of these with a recognisable string and proves none
 * reaches D1 or any page; its --self-test breaks each rule here and requires the gate to go red.
 */
import { field, rawField, mapValuesOnly, docId } from '../../shared/fs-values.mjs';
import { dayKey } from '../../funnel/core.mjs';

const DAY = 86400000;

/* User-written text that the dashboard does show (a member's name as the circle sees it, a relationship
   label): trimmed, control characters removed, bounded. Escaped again at render. */
export function cleanText(v, max) {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
export const firstName = (name) => cleanText(name, 60).split(' ')[0] || '';

const asMs = (v) => {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string' && /^\d{10,14}$/.test(v)) return Number(v);
  return 0;
};

/* Record types -> coarse kinds (spec §8.4, fixed). The raw type never reaches D1. */
export const KIND_OF = Object.freeze({ feed: 'feed', sleep: 'sleep', diaper: 'nappy', pump: 'pump', growth: 'growth',
  medicine: 'medicine', temperature: 'health_log', symptom: 'health_log', visit: 'health_log', vaccine: 'vaccines',
  milestone: 'moments', activity: 'moments' });
export const KINDS = Object.freeze(['feed', 'sleep', 'nappy', 'pump', 'growth', 'medicine', 'health_log', 'vaccines', 'moments', 'other']);
export const kindOf = (type) => (Object.prototype.hasOwnProperty.call(KIND_OF, type) ? KIND_OF[type] : 'other');

export function babyAgeLabel(birth, now) {
  if (!birth || birth > now) return 'Baby';
  const days = Math.floor((now - birth) / DAY);
  if (days < 14) return 'Baby · ' + days + (days === 1 ? ' day' : ' days');
  if (days < 56) return 'Baby · ' + Math.floor(days / 7) + ' weeks';
  const months = Math.floor(days / 30.44);
  if (months < 24) return 'Baby · ' + months + (months === 1 ? ' month' : ' months');
  return 'Baby · ' + Math.floor(months / 12) + ' years';
}

/* households/{hid}, masked to §5.1's household fields. */
export function reduceHousehold(doc, now) {
  const hid = docId(doc);
  const ownerUid = String(field(doc, 'ownerId') || '');
  const roles = field(doc, 'members') || {};
  const info = field(doc, 'memberInfo') || {};
  const createdAt = asMs(field(doc, 'createdAt'));
  const members = [];
  for (const uid of Object.keys(roles)) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) continue;
    const mi = (info && typeof info[uid] === 'object' && info[uid]) || {};
    const joined = asMs(mi.joinedAt);
    members.push({
      uid,
      role: roles[uid] === 'owner' || uid === ownerUid ? 'owner' : 'caregiver',
      name: cleanText(mi.name, 60),
      relationship: cleanText(mi.relationship, 40),
      joinedAt: joined || (uid === ownerUid && createdAt ? createdAt : 0),
      joinedSource: joined ? 'member_info' : (uid === ownerUid && createdAt ? 'household_created' : null),
    });
  }
  /* VALUES only. The keys (an invitee's address, a live link token) are never iterated. */
  const invited = [];
  for (const v of mapValuesOnly(rawField(doc, 'pendingInvites'))) {
    invited.push({ kind: 'email', relationship: cleanText(v && v.relationship, 40), sentDay: asMs(v && v.at) ? dayKey(asMs(v.at)) : null });
  }
  for (const v of mapValuesOnly(rawField(doc, 'pendingLinks'))) {
    invited.push({ kind: 'link', relationship: '', sentDay: asMs(v && v.at) ? dayKey(asMs(v.at)) : null });
  }
  invited.sort((a, b) => String(a.sentDay).localeCompare(String(b.sentDay)));
  const babiesRaw = field(doc, 'app.babies');
  const babies = Array.isArray(babiesRaw) ? babiesRaw : (babiesRaw && typeof babiesRaw === 'object' ? Object.values(babiesRaw) : []);
  let youngest = 0;
  for (const b of babies) { const t = asMs(b && b.birth); if (t > youngest) youngest = t; }
  const pro = field(doc, 'pro');
  const owner = members.find((m) => m.uid === ownerUid);
  return {
    hid, ownerUid, createdAt,
    ownerFirstName: owner ? firstName(owner.name) : '',
    plan: pro && typeof pro === 'object' && (pro.status === 'active' || pro.status === 'trialing') ? 'pro' : 'free',
    deletionPending: rawField(doc, 'deleteAfter') !== undefined && field(doc, 'deleteAfter') !== null,
    members, invited,
    babies: babies.length,
    babyDetail: babies.length ? babyAgeLabel(youngest, now) : null,
  };
}

/* households/{hid}/pregnancy, masked. A journey counts only when its sharedWith names at least one
   OTHER current member: anything else is treated as if the document did not exist. */
export function sharedJourney(docs, memberUids) {
  let best = null;
  const rank = { expecting: 3, born: 2, planning: 1 };
  for (const d of docs || []) {
    const carrier = docId(d);
    if (!memberUids.has(carrier)) continue;
    const sharedWith = field(d, 'sharedWith');
    const others = (Array.isArray(sharedWith) ? sharedWith : []).filter((u) => typeof u === 'string' && u !== carrier && memberUids.has(u));
    if (!others.length) continue;
    const born = !!field(d, 'data.bornBabyId');
    const stage = field(d, 'data.stage');
    const j = born ? 'born' : (stage === 'expecting' ? 'expecting' : (stage === 'planning' ? 'planning' : null));
    if (j && (!best || rank[j] > rank[best])) best = j;
  }
  return best;
}

/* The household's stage, current state only (no history anywhere, S13). "Trying" is kept as a stage so
   the overview can count it, and is NEVER the label shown beside a named household (F4, accepted). */
export function stageFrom({ journey, babies, babyDetail }) {
  if (journey === 'expecting') return { stage: 'pregnant', detail: 'Pregnant' };
  if (babies > 0) return { stage: 'baby', detail: babyDetail || 'Baby' };
  if (journey === 'born') return { stage: 'baby', detail: 'Baby' };
  if (journey === 'planning') return { stage: 'trying', detail: 'No stage shared' };
  return { stage: 'none', detail: 'No stage shared' };
}

/* households/{hid}/events, masked to time, authorId, type, last 7 days. Per UTC day: entries and distinct
   authors (no uid kept, no type, no time). Per household: coarse kinds over the 7 days and distinct
   authors. Days are UTC by core.mjs dayKey, the rule the Monday digest's sharedLoggingAt uses. */
export function reduceEvents(docs) {
  const byDay = new Map(), kinds = {}, authors = new Set();
  let last = null;
  for (const d of docs || []) {
    const t = asMs(field(d, 'time'));
    if (!t) continue;
    const day = dayKey(t);
    if (!byDay.has(day)) byDay.set(day, { entries: 0, authors: new Set() });
    const b = byDay.get(day);
    b.entries++;
    const a = field(d, 'authorId');
    if (typeof a === 'string' && a) { b.authors.add(a); authors.add(a); }
    const k = kindOf(field(d, 'type'));
    kinds[k] = (kinds[k] || 0) + 1;
    if (!last || day > last) last = day;
  }
  const days = [...byDay.entries()].map(([day, b]) => ({ day, entries: b.entries, authors: b.authors.size })).sort((x, y) => x.day.localeCompare(y.day));
  return { days, kinds, authors7: authors.size, lastDay: last };
}

const SAFE = /^[a-z0-9][a-z0-9_.-]{0,31}$/;
export const fold = (v) => { const s = String(v == null ? '' : v).trim().toLowerCase(); return s ? (SAFE.test(s) ? s : 'other') : null; };
const TZ = /^[A-Za-z]{2,14}(\/[A-Za-z0-9_+-]{2,30}){1,2}$|^UTC$/;

/* users/{uid}, masked. Never .email or .name (client-written). */
export function reduceUser(doc) {
  const acq = field(doc, 'acq');
  const quietStart = field(doc, 'push.quietStart'), quietEnd = field(doc, 'push.quietEnd');
  const qs = Number.isInteger(quietStart) && quietStart >= 0 && quietStart <= 23 ? quietStart : null;
  const qe = Number.isInteger(quietEnd) && quietEnd >= 0 && quietEnd <= 23 ? quietEnd : null;
  const tz = field(doc, 'push.tz');
  const hid = field(doc, 'householdId');
  return {
    householdId: typeof hid === 'string' && hid ? hid : null,
    acqSource: acq && typeof acq === 'object' ? fold(acq.source) : null,
    acqContent: acq && typeof acq === 'object' ? fold(acq.content) : null,
    referred: field(doc, 'referredBy') ? 1 : 0,
    pushOn: field(doc, 'push.enabled') === true ? 1 : 0,
    quiet: qs !== null && qe !== null && qs !== qe ? qs + '-' + qe : null,
    tz: typeof tz === 'string' && TZ.test(tz) ? tz : null,
    teamNotes: field(doc, 'teamNotes') === 'off' ? 'off' : 'on',
  };
}

/* pushLedger/{uid}.caps -> this month's feature and marketing counts. */
export function reduceCaps(doc, ym) {
  const caps = field(doc, 'caps');
  if (!caps || typeof caps !== 'object' || caps.ym !== ym) return { feature: 0, marketing: 0 };
  const n = (x) => (Number.isFinite(Number(x)) ? Math.max(0, Math.min(99, Math.floor(Number(x)))) : 0);
  return { feature: n(caps.feature), marketing: n(caps.marketing) };
}
