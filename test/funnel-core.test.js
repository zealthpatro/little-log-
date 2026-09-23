/* The funnel core, against households shaped exactly like the real records.
 *
 *   node test/funnel-core.test.js
 *
 * Three things are proved here, in order of how badly they would hurt if wrong:
 *
 *   1. NOTHING IDENTIFYING LEAVES snapshot(). The fixtures use ids and a utm_source that are easy to
 *      spot, and the whole serialised output is searched for them. A snapshot is stored and mailed;
 *      one household id in it would move the App Store label from Not Linked to Linked.
 *   2. The allowlist on POST /api/step cannot be turned into a place to write text.
 *   3. The derivation is right: every stage counted, the wedge exactly as tools/funnel.js defines it,
 *      and a pregnancy household no longer falling out at "Added a baby".
 */
const path = require('path');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '\n         ' + JSON.stringify(detail) : '')); }
};

const DAY = 86400000, HOUR = 3600000, MIN = 60000;
const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);

/* Ids that look like nothing else in the output, so a leak cannot hide behind a coincidence. */
const ID = {
  hhBaby: 'HHID_BABY_zq81', hhPreg: 'HHID_PREG_zq82', hhTry: 'HHID_TRY_zq83', hhNone: 'HHID_NONE_zq84',
  hhSecond: 'HHID_SECOND_zq85', hhInternal: 'HHID_INTERNAL_zq86',
  owner1: 'UID_OWNER1_kk01', care1: 'UID_CARE1_kk02', owner2: 'UID_OWNER2_kk03', owner3: 'UID_OWNER3_kk04',
  owner4: 'UID_OWNER4_kk05', owner5: 'UID_OWNER5_kk06', care5: 'UID_CARE5_kk07', founder: 'UID_FOUNDER_kk08',
};

function fixture() {
  const t0 = NOW - 10 * DAY;
  return [
    { // A baby household that reached the wedge on day 1: owner and caregiver both logged on the same day.
      id: ID.hhBaby, ownerId: ID.owner1, createdAt: t0, isInternal: false,
      members: { [ID.owner1]: { role: 'owner', joinedAt: t0 }, [ID.care1]: { role: 'caregiver', joinedAt: t0 + 2 * HOUR } },
      babyCount: 1,
      entries: [
        { time: t0 + 3 * MIN, authorId: ID.owner1, type: 'feed' },
        { time: t0 + 5 * HOUR, authorId: ID.care1, type: 'diaper' },
        { time: t0 + 2 * DAY, authorId: ID.owner1, type: 'sleep' },
        { time: NOW - 1 * DAY, authorId: ID.care1, type: 'feed' },
      ],
      preg: null,
    },
    { // Pregnancy, logging kicks. Before this change the funnel dropped it at "Added a baby".
      id: ID.hhPreg, ownerId: ID.owner2, createdAt: t0, isInternal: false,
      members: { [ID.owner2]: { role: 'owner', joinedAt: t0 } },
      babyCount: 0, entries: [],
      preg: { stage: 'expecting', bornAt: 0, hadTrying: true, logTimes: [t0 + 30 * MIN, t0 + 1 * DAY] },
    },
    { // Trying to conceive, one observation.
      id: ID.hhTry, ownerId: ID.owner3, createdAt: t0, isInternal: false,
      members: { [ID.owner3]: { role: 'owner', joinedAt: t0 } },
      babyCount: 0, entries: [],
      preg: { stage: 'planning', bornAt: 0, hadTrying: true, logTimes: [t0 + 2 * DAY] },
    },
    { // Signed in, never chose a stage, never logged.
      id: ID.hhNone, ownerId: ID.owner4, createdAt: NOW - 2 * DAY, isInternal: false,
      members: { [ID.owner4]: { role: 'owner', joinedAt: 0 } }, babyCount: 0, entries: [], preg: null,
    },
    { // A baby born in Cubby, now expecting a second: the active pregnancy must win.
      id: ID.hhSecond, ownerId: ID.owner5, createdAt: t0, isInternal: false,
      members: { [ID.owner5]: { role: 'owner', joinedAt: t0 }, [ID.care5]: { role: 'caregiver', joinedAt: t0 + DAY } },
      babyCount: 1,
      // Two authors, but on DIFFERENT days. That is membership, not the wedge.
      entries: [{ time: t0 + DAY, authorId: ID.owner5, type: 'feed' }, { time: t0 + 2 * DAY, authorId: ID.care5, type: 'feed' }],
      preg: { stage: 'expecting', bornAt: 0, hadTrying: false, logTimes: [] },
    },
    { // The founder's own test household. Must not count anywhere.
      id: ID.hhInternal, ownerId: ID.founder, createdAt: t0, isInternal: true,
      members: { [ID.founder]: { role: 'owner', joinedAt: t0 } }, babyCount: 3,
      entries: [{ time: NOW - HOUR, authorId: ID.founder, type: 'feed' }], preg: null,
    },
  ];
}

(async () => {
  const core = await import('file://' + path.join(__dirname, '..', 'workers', 'funnel', 'core.mjs'));
  console.log('\nfunnel core: derived from records, identifying nothing\n');

  const snap = core.snapshot({
    now: NOW,
    households: fixture(),
    invitedHouseholdIds: [ID.hhBaby, ID.hhSecond],
    waitlistUids: [ID.owner1],
    users: {
      [ID.owner1]: { acq: { source: 'instagram', campaign: 'sept' }, referredBy: '' },
      [ID.owner2]: { acq: { source: 'LEAK_me@example.com' }, referredBy: 'abcd1234' },
      [ID.owner3]: {},
    },
  });
  const json = JSON.stringify(snap);

  console.log('1. nothing identifying leaves the snapshot');
  const leaked = Object.values(ID).filter((id) => json.indexOf(id) >= 0);
  ok('no household id or uid appears anywhere in the output', leaked.length === 0, leaked);
  ok('an email-shaped utm_source is folded, not stored as a key', json.indexOf('example.com') < 0 && json.indexOf('LEAK') < 0);
  ok('and it is counted under "other" rather than dropped', snap.acquisition.by_source.other === 1, snap.acquisition.by_source);
  ok('a clean utm_source survives as itself', snap.acquisition.by_source.instagram === 1, snap.acquisition.by_source);
  /* Paired, so the three lines above cannot pass on an output that is simply empty. */
  ok('and the snapshot is not trivially empty', snap.households.total === 5, snap.households);

  console.log('\n2. the founder is not a customer');
  ok('the internal household is excluded', snap.households.internal_excluded === 1, snap.households);
  /* The founder's feed is an hour old, well inside the 7-day window, so this line fails if exclusion
     breaks. An earlier version put it ten days back, where it was outside the window anyway and the
     assertion passed whether or not exclusion worked. */
  ok('and its recent feed counts nowhere', snap.care_entries_last_7d.total === 1, snap.care_entries_last_7d);
  const withFounder = core.snapshot({ now: NOW, households: fixture().map((h) => Object.assign({}, h, { isInternal: false })) });
  ok('proved by difference: counting the founder adds exactly their one feed',
     withFounder.care_entries_last_7d.total === snap.care_entries_last_7d.total + 1, withFounder.care_entries_last_7d);

  console.log('\n3. every stage is visible, which is the point of this change');
  ok('stages counted: 1 trying, 2 pregnancy, 1 baby, 1 none',
    JSON.stringify(snap.households.by_stage) === JSON.stringify({ trying: 1, pregnancy: 2, baby: 1, none: 1 }), snap.households.by_stage);
  const pm = core.milestones(fixture()[1]);
  ok('a pregnancy household that logs is ACTIVATED, not dropped at "Added a baby"', pm.stage === 'pregnancy' && pm.activated === true, pm);
  ok('both pregnancy-stage households that logged are counted', snap.funnel.pregnancy.activated === 2, snap.funnel.pregnancy);
  ok('a trying household that logs is activated too', snap.funnel.trying.activated === 1, snap.funnel.trying);
  ok('an active pregnancy wins over an older baby', core.stageOf(fixture()[4]) === 'pregnancy');
  ok('a birth moves the household to baby', core.stageOf({ babyCount: 0, preg: { stage: 'expecting', bornAt: NOW } }) === 'baby');
  ok('trying then pregnancy is recorded as a transition', snap.transitions.trying_to_pregnancy === 1, snap.transitions);

  console.log('\n4. the wedge, exactly as tools/funnel.js defines it');
  ok('two authors on the SAME day is the wedge', snap.funnel.baby.shared_logging === 1, snap.funnel.baby);
  ok('and within 7 days of signing up', snap.funnel.baby.shared_logging_within_7d === 1);
  ok('two authors on DIFFERENT days is membership, not the wedge', snap.funnel.pregnancy.shared_logging === 0, snap.funnel.pregnancy);
  ok('but the caregiver still counts as joined', snap.funnel.pregnancy.member_joined === 1);
  ok('a caregiver who logged is attributed as a caregiver', snap.care_entries_last_7d.by_author_role.caregiver === 1, snap.care_entries_last_7d.by_author_role);

  console.log('\n5. activation timing and the rest of the funnel');
  ok('first entry 3 minutes after sign-up lands in "<5"', snap.activation_buckets['<5'] === 1, snap.activation_buckets);
  ok('a first entry after 30 minutes lands in "5-60"', snap.activation_buckets['5-60'] === 1, snap.activation_buckets);
  ok('returned needs a second active day', snap.funnel.baby.returned === 1 && snap.funnel.trying.returned === 0);
  ok('invites are attributed to the right stage', snap.funnel.baby.invite_sent === 1 && snap.funnel.pregnancy.invite_sent === 1);
  ok('the Pro waitlist is attributed by owner', snap.funnel.baby.pro_waitlisted === 1);
  ok('the report says out loud what it cannot see', /loss/.test(snap.retention_note));

  console.log('\n6. POST /api/step cannot become a place to write text');
  ok('a valid step is accepted', core.stepKey('onboarding.step_reached', { step: 'invite_offered', stage: 'baby' }) === 'onboarding.step_reached|stage=baby|step=invite_offered');
  ok('a stage of none is accepted, because funnelStage() can return it', core.stepKey('pro.sheet_viewed', { stage: 'none', entry_point: 'settings' }) !== null);
  ok('a step the wizard does not have is refused', core.stepKey('onboarding.step_reached', { step: 'completed', stage: 'baby' }) === null);
  ok('property order does not change the key', core.stepKey('invite.sheet_opened', { entry_point: 'home', stage: 'baby' }) === core.stepKey('invite.sheet_opened', { stage: 'baby', entry_point: 'home' }));
  ok('an unknown event is rejected', core.stepKey('user.email_is', { step: 'completed', stage: 'baby' }) === null);
  ok('a value outside the enum is rejected', core.stepKey('pro.sheet_viewed', { stage: 'baby', entry_point: 'me@example.com' }) === null);
  ok('an extra property is rejected, not quietly dropped', core.stepKey('pro.sheet_viewed', { stage: 'baby', entry_point: 'home', uid: 'x' }) === null);
  ok('a missing property is rejected', core.stepKey('pro.sheet_viewed', { stage: 'baby' }) === null);
  ok('a non-string value is rejected', core.stepKey('pro.sheet_viewed', { stage: ['baby'], entry_point: 'home' }) === null);
  ok('an array body is rejected', core.stepKey('pro.sheet_viewed', ['baby', 'home']) === null);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('FUNNEL-CORE: ' + (fail ? 'FAIL' : 'PASS') + '\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('threw:', e); process.exit(1); });
