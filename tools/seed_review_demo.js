#!/usr/bin/env node
/* Seed the App Review demo household with a believable, entirely fictional week.
 *
 * Cuts the founder's part of §6 of the listing plan from "log twenty things by hand" to "create the
 * Google account and sign in once". Everything after that happens here.
 *
 * Fictional throughout, per the fictional-baby rule: no real child's data, no real photos, and the
 * second caregiver is invented too, so "who did what" has two names in it without exposing anybody.
 *
 *   1. Founder creates the review Google account and signs into Cubby with it, once.
 *   2. node tools/seed_review_demo.js <email>            show what it would write
 *   3. node tools/seed_review_demo.js <email> --write    write it
 *
 * Writes only into that one household. It refuses to run against an account that already has real
 * logs, so it can never be pointed at a family by mistake.
 */
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

let sa;
try { sa = require(path.join(__dirname, 'serviceAccountKey.json')); }
catch (e) { console.error('\nMissing tools/serviceAccountKey.json (gitignored). See ANALYTICS.md.\n'); process.exit(2); }

const EMAIL = process.argv[2];
const WRITE = process.argv.includes('--write');
if (!EMAIL || EMAIL.startsWith('--')) { console.error('usage: node tools/seed_review_demo.js <email> [--write]'); process.exit(2); }

const app = initializeApp({ credential: cert(sa) });
const db = getFirestore(app);
const auth = getAuth(app);

const DAY = 86400000;
// Fixed 9:41 anchor so a re-run produces the same week and the screenshots stay true.
const base = (() => { const d = new Date(); d.setHours(9, 41, 0, 0); return d.getTime(); })();
const id = (p, n) => p + '-' + n;
const NANNY = 'demo-caregiver-rosa';

/* One week of an invented ten-week-old. Eight feeds, six nappies and four sleeps a day is what the
   textbook says, which is also what makes the doctor summary read correctly. */
function week(babyId, ownerUid) {
  const evs = [];
  for (let d = 6; d >= 0; d--) {
    const day = base - d * DAY;
    for (let i = 0; i < 8; i++) {
      const t = day - (20 - i * 2.5) * 3600000;
      if (t > base) continue;
      const bottle = i % 3 === 0;
      evs.push(Object.assign({ id: id('f' + d, i), type: 'feed', babyId, time: Math.round(t),
        authorId: (i % 4 === 1) ? NANNY : ownerUid },
        bottle ? { method: 'bottle', amount: 110 + (i % 3) * 10, unit: 'ml' }
               : { method: 'breast', side: i % 2 ? 'left' : 'right', dur: (15 + (i % 4) * 2) * 60000 }));
    }
    for (let i = 0; i < 6; i++) {
      const t = day - (19 - i * 3) * 3600000;
      if (t > base) continue;
      evs.push({ id: id('n' + d, i), type: 'diaper', babyId, time: Math.round(t),
        kind: i % 3 === 0 ? 'dirty' : 'wet', authorId: (i % 3 === 2) ? NANNY : ownerUid });
    }
    for (let i = 0; i < 3; i++) {
      const st = day - (17 - i * 4) * 3600000, en = st + (70 + i * 15) * 60000;
      if (en > base) continue;
      evs.push({ id: id('s' + d, i), type: 'sleep', babyId, time: Math.round(st), end: Math.round(en), authorId: ownerUid });
    }
  }
  evs.push({ id: 'g1', type: 'growth', babyId, time: base - 5 * DAY, weight: 5.6, wUnit: 'kg', height: 58, hUnit: 'cm', authorId: ownerUid });
  evs.push({ id: 'g2', type: 'growth', babyId, time: base - 30 * DAY, weight: 4.4, wUnit: 'kg', height: 54, hUnit: 'cm', authorId: ownerUid });
  return evs.filter((e) => e.time <= base).sort((a, b) => a.time - b.time);
}

(async () => {
  let user;
  try { user = await auth.getUserByEmail(EMAIL); }
  catch (e) { console.error('\nNo Firebase user for ' + EMAIL + '.\nCreate the Google account and sign into Cubby with it once, then re-run.\n'); process.exit(1); }
  console.log('\nuser  ' + EMAIL + '  uid ' + user.uid);

  const udoc = await db.collection('users').doc(user.uid).get();
  const hid = (udoc.data() || {}).householdId;
  if (!hid) { console.error('That account has no household yet. Finish the first-run wizard once, then re-run.'); process.exit(1); }
  const hh = await db.collection('households').doc(hid).get();
  const cur = await db.collection('households').doc(hid).collection('events').limit(50).get();
  console.log('household ' + hid + ', ' + cur.size + ' existing events');

  /* A safety rail: this account is meant to be empty apart from what previous runs of this file
     put there. Anything else and we are pointed at a real family. */
  const foreign = cur.docs.filter((d) => !/^([fns]\d|g\d)/.test(d.id));
  if (foreign.length) {
    console.error('\nREFUSING: ' + foreign.length + ' events here were not written by this seeder.');
    console.error('That looks like a real household. Check the email.\n');
    process.exit(1);
  }

  const babyId = 'demo-bo';
  const evs = week(babyId, user.uid);
  const blob = {
    babies: [{ id: babyId, name: 'Bo', birth: base - 70 * DAY, sex: 'M', routines: [], doctors: [], allergies: [] }],
    settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', country: 'us' },
    milestones: [{ id: 'ms1', babyId, key: 'first-smile', name: 'First smile', date: base - 9 * DAY }],
    meds: [{ id: 'med1', babyId, subject: { kind: 'baby', id: babyId }, name: 'Vitamin D', dose: '1', unit: 'drops',
      active: true, pattern: { type: 'daily', times: ['09:00'] }, remind: true, createdAt: base - 20 * DAY }],
    vaccines: {}, illnesses: [], photos: [], den: null, consents: [], guardians: null,
    timers: { [babyId]: { sleep: { start: base - 42 * 60000 } } },   // a nap running, for the live timer
    journey: null, lossHolding: null, handoff: null,
  };

  console.log('\nwould write:');
  console.log('  baby        Bo, 10 weeks, US schedule');
  console.log('  events      ' + evs.length + ' across 7 days (' + evs.filter((e) => e.authorId === NANNY).length + ' by a second caregiver)');
  console.log('  medicine    Vitamin D, daily 09:00, reminders on');
  console.log('  milestone   First smile');
  console.log('  growth      2 measurements, so the curve draws');
  console.log('  timer       one nap running now');
  if (!WRITE) { console.log('\n(dry run. --write to seed it.)'); return; }

  await db.collection('households').doc(hid).set({
    app: blob,
    members: Object.assign({}, (hh.data() || {}).members || {}, { [user.uid]: 'owner', [NANNY]: 'caregiver' }),
    memberInfo: Object.assign({}, (hh.data() || {}).memberInfo || {}, {
      [user.uid]: { name: 'Maya', relationship: 'Mama Bear', role: 'owner' },
      [NANNY]: { name: 'Rosa', relationship: 'Nanny', role: 'caregiver' },
    }),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  let n = 0;
  for (let i = 0; i < evs.length; i += 400) {
    const b = db.batch();
    evs.slice(i, i + 400).forEach((e) => { b.set(db.collection('households').doc(hid).collection('events').doc(e.id), e); n++; });
    await b.commit();
  }
  console.log('\nseeded ' + n + ' events into ' + hid);
  console.log('Sign in on a clean device to confirm it loads, then put the credentials in App Review.');
})().catch((e) => { console.error('\n' + e.message + '\n'); process.exit(1); });
