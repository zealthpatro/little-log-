/* The Cubby funnel, derived. Pure functions: no I/O, no clock except the `now` passed in.
 *
 * The Worker's daily snapshot (worker.js) and the founder's local report (tools/funnel_report.js)
 * both call snapshot() here, so the number in the Monday mail and the number on the laptop cannot
 * disagree. The tracking plan these implement is .telemetry/tracking-plan.yaml.
 *
 * PRIVACY, BY CONSTRUCTION
 * The input carries uids and household ids, because joining a care log to a household needs them.
 * THE OUTPUT NEVER DOES. snapshot() returns counts keyed only by stage and by enum values, and every
 * free-text key that could reach it (a utm_source, an entry type) is folded to a fixed vocabulary
 * first. test/funnel-core.test.js feeds it recognisable ids and asserts not one survives.
 *
 * WHAT THE READER MUST NEVER PASS IN
 *   - households/{hid}/mhealth/{owner}: her private health (BP, weights, symptoms, mood). The rules
 *     keep it from the circle; an analytics job must not be the one reader that ignores that.
 *   - users/{uid}.pregnancyArchive: her kept-after-loss record, documented in store-firebase.js as
 *     "the one doc only she can ever read or write". This is why there is no loss event in the plan.
 *     A household that goes quiet after a loss is counted as not retained, and the report says so.
 *
 * Normalized household, as the reader builds it:
 *   { id, ownerId, createdAt: ms, isInternal: bool,
 *     members: { [uid]: { role: 'owner'|'caregiver', joinedAt: ms|0 } },
 *     babyCount: n,
 *     entries: [{ time: ms, authorId, type }],      // care logs, read with a field mask of exactly these
 *     preg: null | { stage: 'planning'|'expecting'|null, bornAt: ms|0, hadTrying: bool, logTimes: [ms] } }
 */

export const STAGES = ['trying', 'pregnancy', 'baby', 'none'];
export const ACTIVATION_BUCKETS = ['<5', '5-60', '1-24h', '1-7d', '>7d'];
export const RETAINED_DAYS = 7;
export const WEDGE_WINDOW_DAYS = 7;
const DAY = 86400000;

/* Days are UTC calendar days. tools/funnel.js used the laptop's local day, which moved a 23:30 feed
   in the Gulf into the next day; the Worker has no local timezone to lean on, so both now use UTC. */
export const dayKey = (t) => new Date(t).toISOString().slice(0, 10);

/* A household's stage is the most recent thing it is doing. An active pregnancy wins over an older
   baby, because a parent expecting a second child is, right now, in pregnancy. */
export function stageOf(h) {
  const p = h.preg;
  if (p && p.stage === 'expecting' && !p.bornAt) return 'pregnancy';
  if (h.babyCount > 0 || (p && p.bornAt)) return 'baby';
  if (p && p.stage === 'planning') return 'trying';
  return 'none';
}

export function activationBucket(mins) {
  if (mins < 5) return '<5';
  if (mins < 60) return '5-60';
  if (mins < 1440) return '1-24h';
  if (mins < 10080) return '1-7d';
  return '>7d';
}

/* Anything that could carry text a stranger typed is folded to a small safe vocabulary before it can
   become a key in stored output. utm_source arrives from any URL on the internet; it is capped at 64
   characters on capture, but a key in a snapshot must not be able to hold an address or a name. */
const SAFE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export function safeKey(v, fallback) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return SAFE.test(s) ? s : (fallback || 'other');
}

function roleOf(h, uid) {
  const m = h.members && h.members[uid];
  if (!m) return 'former';            // wrote logs, has since left the household
  return m.role === 'owner' || uid === h.ownerId ? 'owner' : 'caregiver';
}

/* The wedge, strictly, exactly as tools/funnel.js wedge() defines it: two DIFFERENT people writing into
   the same household on the same calendar day. Returns the moment the second author appeared on the
   earliest such day, or 0. Membership is not the outcome; this is. */
export function sharedLoggingAt(h) {
  const byDay = new Map();
  for (const e of h.entries || []) {
    if (!e || !e.time || !e.authorId) continue;
    const k = dayKey(e.time);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(e);
  }
  let best = 0;
  for (const list of byDay.values()) {
    list.sort((a, b) => a.time - b.time);
    const seen = new Set();
    for (const e of list) {
      seen.add(e.authorId);
      if (seen.size >= 2) { if (!best || e.time < best) best = e.time; break; }
    }
  }
  return best;
}

export function milestones(h) {
  const stage = stageOf(h);
  const times = [];
  for (const e of h.entries || []) if (e && e.time) times.push(e.time);
  if (h.preg) for (const t of h.preg.logTimes || []) if (t) times.push(t);
  times.sort((a, b) => a - b);
  const firstEntry = times.length ? times[0] : 0;
  const activeDays = new Set(times.map(dayKey)).size;
  const caregivers = Object.keys(h.members || {}).filter((u) => roleOf(h, u) === 'caregiver');
  const joinedAts = caregivers.map((u) => (h.members[u] && h.members[u].joinedAt) || 0).filter(Boolean);
  const wedgeAt = sharedLoggingAt(h);
  const created = h.createdAt || 0;
  const firstType = (() => {
    let best = null;
    for (const e of h.entries || []) if (e && e.time && (!best || e.time < best.time)) best = e;
    if (best && best.time === firstEntry) return safeKey(best.type, 'other');
    return h.preg ? 'pregnancy_log' : 'other';
  })();
  return {
    stage,
    created,
    activated: firstEntry > 0,
    firstEntry,
    firstType,
    activationMins: firstEntry && created && firstEntry >= created ? Math.round((firstEntry - created) / 60000) : null,
    activeDays,
    returned: activeDays >= 2,
    retained: activeDays >= RETAINED_DAYS,
    memberJoined: caregivers.length > 0,
    memberJoinedAt: joinedAts.length ? Math.min(...joinedAts) : 0,
    sharedLogging: wedgeAt > 0,
    sharedLoggingWithin7d: wedgeAt > 0 && created > 0 && wedgeAt - created <= WEDGE_WINDOW_DAYS * DAY,
    birthRecorded: !!(h.preg && h.preg.bornAt),
    triedFirst: !!(h.preg && h.preg.hadTrying),
  };
}

const zeroStage = () => ({
  created: 0, activated: 0, returned: 0, retained: 0,
  member_joined: 0, shared_logging: 0, shared_logging_within_7d: 0,
  invite_sent: 0, pro_waitlisted: 0,
});

/* The daily aggregate. Every value is a count; every key is a stage, an enum from the tracking plan,
   or a folded safe key. Nothing that identifies a person or a household leaves this function. */
export function snapshot(input) {
  const now = input.now;
  const households = input.households || [];
  const invitedHh = new Set(input.invitedHouseholdIds || []);
  const waitlistUids = new Set(input.waitlistUids || []);
  const users = input.users || {};

  const out = {
    schema: 2,
    day: dayKey(now),
    households: { total: 0, internal_excluded: 0, by_stage: { trying: 0, pregnancy: 0, baby: 0, none: 0 } },
    funnel: { trying: zeroStage(), pregnancy: zeroStage(), baby: zeroStage(), none: zeroStage() },
    created_last_7d: { trying: 0, pregnancy: 0, baby: 0, none: 0 },
    activation_buckets: Object.fromEntries(ACTIVATION_BUCKETS.map((b) => [b, 0])),
    activation_first_type: {},
    transitions: { pregnancy_to_baby: 0, trying_to_pregnancy: 0 },
    acquisition: { attributed: 0, referred: 0, by_source: {} },
    retention_note: 'Households that went quiet after a pregnancy loss are counted as not retained. ' +
      'The only records of a loss are her private archive and lossHolding, and this report reads neither.',
  };

  for (const h of households) {
    if (h.isInternal) { out.households.internal_excluded++; continue; }
    const m = milestones(h);
    const f = out.funnel[m.stage];
    out.households.total++;
    out.households.by_stage[m.stage]++;
    f.created++;
    if (m.created && now - m.created <= 7 * DAY) out.created_last_7d[m.stage]++;
    if (m.activated) {
      f.activated++;
      if (m.activationMins != null) out.activation_buckets[activationBucket(m.activationMins)]++;
      out.activation_first_type[m.firstType] = (out.activation_first_type[m.firstType] || 0) + 1;
    }
    if (m.returned) f.returned++;
    if (m.retained) f.retained++;
    if (m.memberJoined) f.member_joined++;
    if (m.sharedLogging) f.shared_logging++;
    if (m.sharedLoggingWithin7d) f.shared_logging_within_7d++;
    if (invitedHh.has(h.id)) f.invite_sent++;
    if (waitlistUids.has(h.ownerId)) f.pro_waitlisted++;
    if (m.birthRecorded) out.transitions.pregnancy_to_baby++;
    if (m.triedFirst && (m.stage === 'pregnancy' || m.stage === 'baby')) out.transitions.trying_to_pregnancy++;


    const u = users[h.ownerId];
    if (u && u.acq && (u.acq.source || u.acq.campaign || u.acq.content)) {
      out.acquisition.attributed++;
      const s = safeKey(u.acq.source, 'other');
      out.acquisition.by_source[s] = (out.acquisition.by_source[s] || 0) + 1;
    }
    if (u && u.referredBy) out.acquisition.referred++;
  }
  return out;
}

/* WHAT EVERYONE DID THIS WEEK, the second scope.
   The cohort funnel above only sees households that signed up in the window, so on the day this first
   ran, with no sign-up for 36 days, it saw nobody, and its "care entries in the last 7 days" read as
   "no one uses Cubby" while twelve older households were invisible to it. This scope takes EVERY
   household, bounded by time rather than by sign-up date: the reader passes each one's entries from the
   last 7 days only. Counts only, same privacy guarantee as snapshot().
   Input: { now, households: [{ id, ownerId, isInternal, members, entries: [{time, authorId, type}] }] } */
export function activity(input) {
  const now = input.now;
  const out = {
    window_days: 7,
    households_total: 0,
    internal_excluded: 0,
    active_households: 0,
    households_two_loggers: 0,
    care_entries: { total: 0, by_type: {}, by_author_role: { owner: 0, caregiver: 0, former: 0 } },
  };
  for (const h of input.households || []) {
    if (h.isInternal) { out.internal_excluded++; continue; }
    out.households_total++;
    /* Journey logs count too. Half the base on the day this was written was expecting, and kicks,
       contractions and cycle observations live in the shared pregnancy record, not in events, so a
       count over events alone showed every pregnancy household as inactive whatever it did. They carry
       no author, so they are attributed to the owner, and cannot on their own show two people logging. */
    const journey = (h.preg && h.preg.logTimes || []).map((t) => ({ time: t, authorId: h.ownerId,
      type: h.preg.stage === 'planning' ? 'trying_log' : 'pregnancy_log' }));
    const recent = (h.entries || []).concat(journey).filter((e) => e && e.time && e.time <= now && now - e.time <= 7 * DAY);
    if (!recent.length) continue;
    out.active_households++;
    if (new Set(recent.map((e) => e.authorId).filter(Boolean)).size >= 2) out.households_two_loggers++;
    for (const e of recent) {
      const t = safeKey(e.type, 'other');
      out.care_entries.total++;
      out.care_entries.by_type[t] = (out.care_entries.by_type[t] || 0) + 1;
      out.care_entries.by_author_role[roleOf(h, e.authorId)]++;
    }
  }
  return out;
}

/* Emitted events: the allowlist the Worker enforces on POST /api/step. An event or a property value
   not in here is rejected and never stored, so the counter cannot be turned into a place to write
   arbitrary text. Mirrors .telemetry/tracking-plan.yaml; tools/tracking_plan_check.js holds them equal. */
export const STEP_EVENTS = {
  /* Three steps, because that is how many the wizard has. All three stages converge on
     openOnboardInvite, which carries the invite AND the first-log button, so "invite offered" and
     "first entry offered" are one moment. Completion is household.activated, derived. */
  'onboarding.step_reached': {
    step: ['stage_chosen', 'details_entered', 'invite_offered'],
    stage: ['trying', 'pregnancy', 'baby', 'none'],
  },
  'invite.sheet_opened': {
    stage: ['trying', 'pregnancy', 'baby', 'none'],
    entry_point: ['home', 'settings', 'onboarding', 'nudge', 'other'],
  },
  'pro.sheet_viewed': {
    stage: ['trying', 'pregnancy', 'baby', 'none'],
    entry_point: ['settings', 'feature_gate', 'other'],
  },
};

/* Validates one emitted step. Returns the canonical counter key or null. Every property the event
   declares is REQUIRED, and an unknown property is a rejection, not something quietly dropped:
   a caller sending extra fields is a caller who has misunderstood what this is for. */
export function stepKey(event, props) {
  const spec = STEP_EVENTS[event];
  if (!spec || !props || typeof props !== 'object' || Array.isArray(props)) return null;
  const keys = Object.keys(props);
  const want = Object.keys(spec);
  if (keys.length !== want.length) return null;
  const parts = [];
  for (const k of want.slice().sort()) {
    const v = props[k];
    if (typeof v !== 'string' || spec[k].indexOf(v) < 0) return null;
    parts.push(k + '=' + v);
  }
  return event + '|' + parts.join('|');
}
