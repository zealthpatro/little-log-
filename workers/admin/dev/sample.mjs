/* SAMPLE families, for the tests and the local preview. Every name and number is sample data from the
 * approved canvas (Maya, Rosa, Usha, Arjun, Priya, Leena, Sam, Aisha, Nora); every address is at
 * example.com; every id is shaped UID_sample_* or HHID_sample_*. No real person, address or uid. Every member
 * has users/{uid}.householdId naming their household, as the app writes it on create and on every join
 * (app/store-firebase.js): the admin lists a person under a household only when that agrees.
 *
 * sampleWorld({ content: true }) also plants CONTENT the dashboard must never show, each a recognisable
 * string: a baby's name, notes, doses, a mood, a photo, the pregnancy journal, an invitee's address and
 * name (as a pendingInvites key), a live link token (as a pendingLinks key) and the address it was sent
 * to, a forged users.email and users.name, push tokens, the due-reminder queue, the loss archive, an
 * Auth password hash, and an entry time at a recognisable minute. test/admin-no-content.test.js greps
 * every response, every D1 row and every log line for them.
 */
export const DAY = 86400000;
/* Pinned: Friday 13 November 2026, 10:42 UTC. Clock-pinned tests pin the day AND the hour. */
export const NOW = Date.UTC(2026, 10, 13, 10, 42, 0);
export const PROJECT = 'cubby-sample';
export const FOUNDER_UID = 'UID_sample_founder';

/* An entry time no other number on any page can equal: 12 Nov 2026, 03:17:29.731 UTC. */
export const ZZ_TIME = Date.UTC(2026, 10, 12, 3, 17, 29, 731);
export const ZZ = ['ZZ-BABYNAME-7731', 'ZZ-NOTE-7731', 'ZZ-DOSE-7731', 'ZZ-MOOD-7731', 'ZZ-PHOTO-7731', 'ZZ-JOURNAL-7731',
  'zz-invitee@example.com', 'ZZ-INVITEE-NAME', 'ZZLINKTOKEN7731', 'zz-linksent@example.com', 'zz-forged@example.com',
  'ZZ-FORGED-NAME', 'ZZPUSHTOKEN7731', 'ZZ-DUE-MEDICINE', 'ZZ-ARCHIVE-7731', 'ZZHASH7731', 'ZZPHOTOURL7731',
  'ZZ-FEEDBACK-7731', 'ZZ-MHEALTH-7731', 'ZZ-KICKS-7731', String(ZZ_TIME), new Date(ZZ_TIME).toISOString(), 'ZZ-AMOUNT-7731',
  'ZZ-SYMPTOM-7731', 'ZZ-TEMPERATURE-7731', 'ZZUNSUBTOKEN7731'];
export const HOSTILE = '<img src=x onerror="window.__pwned=1">"><script>window.__pwned=2</script>';

const ago = (d, h) => NOW - d * DAY - (h || 0) * 3600000;
const dayAt = (d, hour, min) => { const t = new Date(NOW - d * DAY); t.setUTCHours(hour, min || 0, 0, 0); return t.getTime(); };

export function sampleWorld(opts) {
  opts = opts || {};
  const C = !!opts.content;
  const docs = new Map();
  const put = (p, f) => docs.set(p, f);
  const accounts = [];
  const acct = (uid, email, created, providers) => accounts.push({
    localId: uid, email, emailVerified: true, createdAt: String(created), lastLoginAt: String(NOW - 3600000),
    lastRefreshAt: new Date(NOW - 1800000).toISOString(), providerUserInfo: providers.map((p) => ({ providerId: p, email })),
    passwordHash: C ? 'ZZHASH7731' : 'x', salt: 'y', displayName: C ? 'ZZ-FORGED-NAME' : 'n',
  });
  const mi = (name, relationship, role, joinedAt) => Object.assign({ name, relationship, role, photoURL: C ? 'data:image/png;base64,ZZPHOTOURL7731' : '' }, joinedAt ? { joinedAt: new Date(joinedAt) } : {});
  const ev = (hid, id, time, authorId, type, extra) => put('households/' + hid + '/events/' + id, Object.assign({ time, authorId, type }, extra || {}));

  /* Household 1: Maya's family. Three in the circle, Arjun invited, two people logging. */
  const H1 = 'HHID_sample_maya';
  put('households/' + H1, {
    ownerId: 'UID_sample_maya', createdAt: new Date(ago(71)), updatedAt: new Date(ago(0, 2)),
    members: { UID_sample_maya: 'owner', UID_sample_rosa: 'caregiver', UID_sample_usha: 'caregiver' },
    memberInfo: { UID_sample_maya: mi('Maya', 'Mum', 'owner'), UID_sample_rosa: mi('Rosa', 'Nanny', 'caregiver', ago(27)), UID_sample_usha: mi('Usha', 'Grandmother, in India', 'caregiver', ago(69)) },
    pendingInvites: { [C ? 'zz-invitee@example.com' : 'arjun@example.com']: { name: C ? 'ZZ-INVITEE-NAME' : 'Arjun', relationship: 'Dad', role: 'caregiver', at: ago(15) } },
    pendingLinks: C ? { ZZLINKTOKEN7731: { at: ago(3), expiresAt: ago(-4), sentTo: 'zz-linksent@example.com' } } : {},
    app: { babies: [{ id: 'b1', name: C ? 'ZZ-BABYNAME-7731' : 'Noor', birth: ago(62), country: 'ae', sex: 'f', color: '#fff' }],
      lossHolding: null, settings: { units: C ? 'ZZ-NOTE-7731' : 'ml' } },
  });
  let n = 0;
  for (let d = 0; d < 7; d++) {
    ev(H1, 'e' + (++n), dayAt(d, 3, 10), 'UID_sample_rosa', 'feed', { amount: C ? 'ZZ-AMOUNT-7731' : 120, note: C ? 'ZZ-NOTE-7731' : '' });
    ev(H1, 'e' + (++n), dayAt(d, 7, 40), 'UID_sample_maya', d % 2 ? 'diaper' : 'sleep');
  }
  ev(H1, 'e' + (++n), dayAt(2, 21, 0), 'UID_sample_maya', 'medicine', { dose: C ? 'ZZ-DOSE-7731' : '2.5ml', name: C ? 'ZZ-DOSE-7731' : 'x' });
  ev(H1, 'e' + (++n), dayAt(3, 9, 0), 'UID_sample_maya', 'temperature', { value: C ? 'ZZ-TEMPERATURE-7731' : 37.2 });
  ev(H1, 'e' + (++n), dayAt(4, 9, 30), 'UID_sample_rosa', 'symptom', { text: C ? 'ZZ-SYMPTOM-7731' : '' });
  if (C) ev(H1, 'e_zz_time', ZZ_TIME, 'UID_sample_rosa', 'feed', { note: 'ZZ-NOTE-7731' });
  for (let d = 20; d < 40; d += 3) ev(H1, 'e' + (++n), dayAt(d, 8, 0), 'UID_sample_maya', 'feed');
  put('households/' + H1 + '/photos/p1', { data: C ? 'ZZ-PHOTO-7731' : 'jpeg', authorId: 'UID_sample_maya' });
  put('households/' + H1 + '/notes/n1', { text: C ? 'ZZ-NOTE-7731' : 'a note', authorId: 'UID_sample_maya' });
  put('households/' + H1 + '/mhealth/UID_sample_maya/cat/mood', { mood: C ? 'ZZ-MHEALTH-7731' : 'ok' });
  put('users/UID_sample_maya', { householdId: H1, acq: { source: 'instagram', content: '3am-feed-reel' },
    push: { enabled: true, tz: 'Asia/Dubai', quietStart: 22, quietEnd: 7, allow: { feature: true }, tokens: { [C ? 'ZZPUSHTOKEN7731' : 't1']: true }, due: C ? 'ZZ-DUE-MEDICINE' : '' },
    email: C ? 'zz-forged@example.com' : 'maya@example.com', name: C ? 'ZZ-FORGED-NAME' : 'Maya', pregnancyArchive: C ? 'ZZ-ARCHIVE-7731' : '' });
  put('users/UID_sample_rosa', { householdId: H1, push: { enabled: true, tz: 'Asia/Dubai' }, referredBy: 'UID_sample_maya' });
  put('users/UID_sample_usha', { householdId: H1, push: { enabled: false, tz: 'Asia/Kolkata' } });
  put('pushLedger/UID_sample_maya', { caps: { ym: '2026-11', feature: 3, marketing: 0 }, sends: { x: C ? 'ZZ-NOTE-7731' : 1 } });
  put('waitlist/UID_sample_maya', { uid: 'UID_sample_maya', email: C ? 'zz-forged@example.com' : 'maya@example.com' });
  if (C) put('feedback/f1', { text: 'ZZ-FEEDBACK-7731', uid: 'UID_sample_maya', email: 'zz-forged@example.com' });
  acct('UID_sample_maya', 'maya@example.com', ago(71), ['apple.com']);
  acct('UID_sample_rosa', 'rosa@example.com', ago(27), []);
  acct('UID_sample_usha', 'usha@example.com', ago(69), []);

  /* Household 2: Priya, signed up two days ago, no first entry yet. */
  const H2 = 'HHID_sample_priya';
  put('households/' + H2, { ownerId: 'UID_sample_priya', createdAt: new Date(ago(2, 12)), members: { UID_sample_priya: 'owner' },
    memberInfo: { UID_sample_priya: mi('Priya', 'Mum', 'owner') }, app: { babies: [{ name: C ? 'ZZ-BABYNAME-7731' : 'Ira', birth: ago(21) }] } });
  put('users/UID_sample_priya', { householdId: H2, acq: { source: 'google' }, push: { enabled: false } });
  acct('UID_sample_priya', 'priya@example.com', ago(2, 12), ['google.com']);

  /* Household 3: Leena, pregnant, her journey shared with Omar. */
  const H3 = 'HHID_sample_leena';
  put('households/' + H3, { ownerId: 'UID_sample_leena', createdAt: new Date(ago(24)), members: { UID_sample_leena: 'owner', UID_sample_omar: 'caregiver' },
    memberInfo: { UID_sample_leena: mi('Leena', 'Mum-to-be', 'owner'), UID_sample_omar: mi('Omar', 'Partner', 'caregiver', ago(20)) }, app: {} });
  put('households/' + H3 + '/pregnancy/UID_sample_leena', { ownerUid: 'UID_sample_leena', sharedWith: ['UID_sample_omar'],
    data: { stage: 'expecting', dueDate: '2027-02-20', lmp: '2026-05-16', journal: C ? 'ZZ-JOURNAL-7731' : 'j', kicks: [{ at: ago(1), n: C ? 'ZZ-KICKS-7731' : 10 }] } });
  ev(H3, 'l1', dayAt(1, 18, 0), 'UID_sample_leena', 'visit', { note: C ? 'ZZ-NOTE-7731' : '' });
  put('users/UID_sample_leena', { householdId: H3, acq: { source: 'friend' }, push: { enabled: true, tz: 'Europe/London' } });
  put('users/UID_sample_omar', { householdId: H3 });
  acct('UID_sample_leena', 'leena@example.com', ago(24), ['apple.com']);
  acct('UID_sample_omar', 'omar@example.com', ago(20), ['google.com']);

  /* Household 4: Dana and Sam, a baby of five months, quiet for a while. */
  const H4 = 'HHID_sample_dana';
  put('households/' + H4, { ownerId: 'UID_sample_dana', createdAt: new Date(ago(150)), members: { UID_sample_dana: 'owner', UID_sample_sam: 'caregiver' },
    memberInfo: { UID_sample_dana: mi('Dana', 'Mum', 'owner'), UID_sample_sam: mi('Sam', 'Dad', 'caregiver', ago(140)) },
    app: { babies: [{ name: C ? 'ZZ-BABYNAME-7731' : 'Leo', birth: ago(152) }] }, pro: { plan: 'base', status: 'active' } });
  for (let d = 10; d < 30; d++) ev(H4, 'd' + d, dayAt(d, 6, 0), d % 2 ? 'UID_sample_sam' : 'UID_sample_dana', 'feed');
  put('users/UID_sample_dana', { householdId: H4, acq: { source: 'newsletter' }, push: { enabled: true, tz: 'America/New_York' }, teamNotes: 'off' });
  put('users/UID_sample_sam', { householdId: H4, push: { enabled: true, tz: 'America/New_York' } });
  acct('UID_sample_dana', 'dana@example.com', ago(150), ['google.com']);
  acct('UID_sample_sam', 'sam@example.com', ago(140), ['google.com']);

  /* Household 5: Aisha, her baby born four days ago; the journey records the birth and is shared. */
  const H5 = 'HHID_sample_aisha';
  put('households/' + H5, { ownerId: 'UID_sample_aisha', createdAt: new Date(ago(120)), members: { UID_sample_aisha: 'owner', UID_sample_yusuf: 'caregiver' },
    memberInfo: { UID_sample_aisha: mi('Aisha', 'Mum', 'owner'), UID_sample_yusuf: mi('Yusuf', 'Dad', 'caregiver') },
    app: { babies: [{ name: C ? 'ZZ-BABYNAME-7731' : 'Sara', birth: ago(4) }] } });
  put('households/' + H5 + '/pregnancy/UID_sample_aisha', { ownerUid: 'UID_sample_aisha', sharedWith: ['UID_sample_yusuf'],
    data: { stage: 'expecting', bornBabyId: 'b9', birthAt: ago(4) } });
  ev(H5, 'a1', dayAt(0, 4, 0), 'UID_sample_aisha', 'feed');
  ev(H5, 'a2', dayAt(0, 5, 0), 'UID_sample_yusuf', 'diaper');
  put('users/UID_sample_aisha', { householdId: H5, acq: { source: 'paid-test' }, push: { enabled: true, tz: 'Asia/Dubai' } });
  put('users/UID_sample_yusuf', { householdId: H5 });
  acct('UID_sample_aisha', 'aisha@example.com', ago(120), []);
  acct('UID_sample_yusuf', 'yusuf@example.com', ago(119), ['apple.com']);

  /* Household 6: Nora, trying, the journey shared with Kai. Counted in the overview only. */
  const H6 = 'HHID_sample_nora';
  put('households/' + H6, { ownerId: 'UID_sample_nora', createdAt: new Date(ago(12)), members: { UID_sample_nora: 'owner', UID_sample_kai: 'caregiver' },
    memberInfo: { UID_sample_nora: mi('Nora', '', 'owner'), UID_sample_kai: mi('Kai', 'Partner', 'caregiver', ago(11)) }, app: {} });
  put('households/' + H6 + '/pregnancy/UID_sample_nora', { ownerUid: 'UID_sample_nora', sharedWith: ['UID_sample_kai'], data: { stage: 'planning', periods: [{ at: ago(9) }] } });
  put('users/UID_sample_nora', { householdId: H6, acq: { source: 'tiktok' } });
  put('users/UID_sample_kai', { householdId: H6 });
  acct('UID_sample_nora', 'nora@example.com', ago(12), ['google.com']);
  acct('UID_sample_kai', 'kai@example.com', ago(11), ['google.com']);

  /* Household 7: Zara, pregnant, her journey shared with NOBODY. The dashboard must not know. */
  const H7 = 'HHID_sample_zara';
  put('households/' + H7, { ownerId: 'UID_sample_zara', createdAt: new Date(ago(30)), members: { UID_sample_zara: 'owner', UID_sample_ben: 'caregiver' },
    memberInfo: { UID_sample_zara: mi('Zara', '', 'owner'), UID_sample_ben: mi('Ben', 'Partner', 'caregiver', ago(29)) }, app: {} });
  if (!opts.noPrivateJourney) {
    put('households/' + H7 + '/pregnancy/UID_sample_zara', { ownerUid: 'UID_sample_zara', sharedWith: [], data: { stage: 'expecting', dueDate: '2027-03-01', journal: C ? 'ZZ-JOURNAL-7731' : 'j' } });
    /* And one keyed by a carrier who is not the owner, shared with nobody else in the circle. */
    put('households/' + H7 + '/pregnancy/UID_sample_ben', { ownerUid: 'UID_sample_ben', sharedWith: ['UID_sample_ben', 'UID_sample_stranger'], data: { stage: 'expecting' } });
  }
  put('users/UID_sample_zara', { householdId: H7 });
  put('users/UID_sample_ben', { householdId: H7 });
  acct('UID_sample_zara', 'zara@example.com', ago(30), ['apple.com']);
  acct('UID_sample_ben', 'ben@example.com', ago(29), ['apple.com']);

  /* Household 8: the founder's own test household (INTERNAL_UIDS). Hidden by default. */
  const H8 = 'HHID_sample_founder';
  put('households/' + H8, { ownerId: FOUNDER_UID, createdAt: new Date(ago(200)), members: { [FOUNDER_UID]: 'owner' },
    memberInfo: { [FOUNDER_UID]: mi('Sam', 'Dad', 'owner') }, app: { babies: [{ name: 'Test', birth: ago(300) }] } });
  ev(H8, 'f1', dayAt(0, 9, 0), FOUNDER_UID, 'feed');
  put('users/' + FOUNDER_UID, { householdId: H8 });
  acct(FOUNDER_UID, 'founder-test@example.com', ago(200), ['google.com']);

  if (opts.hostile) {
    const H9 = 'HHID_sample_hostile';
    put('households/' + H9, { ownerId: 'UID_sample_hostile', createdAt: new Date(ago(5)), members: { UID_sample_hostile: 'owner', UID_sample_hostile2: 'caregiver' },
      memberInfo: { UID_sample_hostile: mi(HOSTILE, HOSTILE, 'owner'), UID_sample_hostile2: mi('=HYPERLINK("http://x")', '+1', 'caregiver') },
      pendingInvites: { 'h@example.com': { relationship: HOSTILE, at: ago(1) } }, app: {} });
    put('users/UID_sample_hostile', { householdId: H9, acq: { source: HOSTILE, content: HOSTILE }, push: { tz: HOSTILE } });
    put('users/UID_sample_hostile2', { householdId: H9 });
    acct('UID_sample_hostile', 'hostile@example.com', ago(5), []);
    acct('UID_sample_hostile2', 'hostile2@example.com', ago(5), []);
  }

  /* Signed up yesterday, no household yet. */
  acct('UID_sample_jo', 'jo@example.com', ago(1), []);
  return { docs, accounts, projectId: opts.projectId || PROJECT };
}

/* cubby-games, as the main Worker writes it: the push cron's record and the digest's. */
export function seedGames(d1, opts) {
  opts = opts || {};
  d1.raw.exec('CREATE TABLE IF NOT EXISTS ops_state (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER);'
    + 'CREATE TABLE IF NOT EXISTS funnel_meta (key TEXT PRIMARY KEY, value TEXT, at INTEGER);'
    + 'CREATE TABLE IF NOT EXISTS funnel_snapshots (day TEXT PRIMARY KEY, ok INTEGER NOT NULL, reason TEXT, reads INTEGER, attempts INTEGER NOT NULL DEFAULT 0, body TEXT, at INTEGER NOT NULL);');
  const ins = d1.raw.prepare('INSERT OR REPLACE INTO ops_state (key, value, updated_at) VALUES (?, ?, ?)');
  ins.run('push_last_run', JSON.stringify({ due: 4, sent: 4, failed: 0, dropped: 0, userErrors: 0 }), NOW - 6 * 60000);
  ins.run('push_daily', JSON.stringify({ day: '2026-11-13', sent: 31, failed: 0 }), NOW - 6 * 60000);
  d1.raw.prepare('INSERT OR REPLACE INTO funnel_meta (key, value, at) VALUES (?, ?, ?)').run('digest_last', opts.digestLast || '2026-08-31', NOW - 74 * DAY);
  d1.raw.prepare('INSERT OR REPLACE INTO funnel_snapshots (day, ok, reason, reads, attempts, body, at) VALUES (?, 1, NULL, 900, 1, ?, ?)').run('2026-11-13', '{}', NOW - 3600000);
  return d1;
}

/* cubby-newsletter: Maya subscribed, at the baby stage. Keyed by sha256 of the address, as the main Worker keys it. */
export async function seedNewsletter(d1, schemaSql) {
  d1.raw.exec(schemaSql);
  const h = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  d1.raw.prepare('INSERT INTO subscribers (email_hash, email, stage, status, unsub_token, consent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(await h('maya@example.com'), 'maya@example.com', 'baby', 'subscribed', 'ZZUNSUBTOKEN7731', '2026-09-03T00:00:00Z', '2026-09-03T00:00:00Z');
  return d1;
}
