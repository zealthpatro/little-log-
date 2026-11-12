#!/usr/bin/env node
/* One-time cleanup for grants and flags left behind before the 2026-11-12 rules change.
 *
 * WHY. Before that change a join never spent its email invite, so invites/{email} outlived the
 * join. The new rules spend an invite in the join itself, but they cannot tell an old, already-used
 * invite from a fresh one. So a member the owner removed, whose invite still exists, can write
 * themselves back in, and with a lingering co-owner invite they come back as OWNER and can then
 * remove the original owner. The old rules also let anyone flag a household with deleteAfter; the
 * purge cron now refuses a family with people in it, but the flag still turns off that family's
 * dose reminders (pushGate, /api/dose) until it falls due.
 *
 * WHAT IT DOES, per invites/{email}:
 *   - household gone, no householdId, or genuinely flagged (deleteAfter set, nobody left in
 *     members): delete the invite. Nobody can be let into that family any more.
 *   - otherwise resolve the address to an account with Admin Auth getUserByEmail. NOT memberEmails:
 *     removeMember and deleteAccount delete that doc, so the removed member, the dangerous case,
 *     would be invisible there. If that uid is in members (the invite was used) or in
 *     formerMemberInfo (removed, or left), delete the invite and that address's pendingInvites row.
 *   - no account yet, or an account that was never in that household: keep. That is a real,
 *     still-pending invitation.
 * And per household: deleteAfter or deletionRequestedBy set while members is not empty is a flag
 * nobody legitimately sets (only the last one out may), so both fields are cleared.
 * A household with a bogus flag is unflagged, so its invites are judged as a live family's.
 *
 * Every write is conditioned on the document being unchanged since it was read, so an owner who
 * re-sends an invite (or anything else touching that doc) mid-run is left alone; it is counted.
 *
 * SAFE BY DEFAULT. A dry run unless --apply is passed. Prints COUNTS only, never an address, uid
 * or household id: the output may be pasted into a chat or a ticket.
 *
 * Credentials come only from the environment, never from a file this script names:
 *   production:  GOOGLE_APPLICATION_CREDENTIALS=<service-account json> node tools/invite_cleanup.js
 *   emulators:   FIRESTORE_EMULATOR_HOST=... FIREBASE_AUTH_EMULATOR_HOST=... GCLOUD_PROJECT=...
 * Run it right after the new firestore.rules are published (not before: under the old rules every
 * join still leaves its invite behind). Dry run first, read the counts, then --apply.
 * Gate: test/invite-cleanup.test.js.
 */
'use strict';

const APPLY = process.argv.includes('--apply');
const FS_EMU = process.env.FIRESTORE_EMULATOR_HOST;
const AUTH_EMU = process.env.FIREBASE_AUTH_EMULATOR_HOST;

// Half on an emulator is the dangerous mix: fake accounts deciding which REAL invites to delete, or
// the reverse. Both emulators, or neither and an explicit service account.
if (!!FS_EMU !== !!AUTH_EMU) {
  console.error('invite_cleanup: set BOTH FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST, or neither.');
  process.exit(2);
}
if (!FS_EMU && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('invite_cleanup: no credentials. Set GOOGLE_APPLICATION_CREDENTIALS (or the two emulator hosts).');
  process.exit(2);
}

const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldPath, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const app = FS_EMU
  ? initializeApp({ projectId: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'demo-cubby' })
  : initializeApp({ credential: applicationDefault() });
const db = getFirestore(app);
const auth = getAuth(app);

const has = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const size = (o) => (o && typeof o === 'object') ? Object.keys(o).length : 0;
const flagged = (d) => has(d, 'deleteAfter') || has(d, 'deletionRequestedBy');

// Errors are reported by code only: a message can carry a document path, and the path is an address.
const errCode = (e) => String((e && e.code) || 'error');
// A lastUpdateTime precondition that no longer holds (gRPC FAILED_PRECONDITION is code 9).
const changedSinceRead = (e) => errCode(e) === '9' || errCode(e) === 'failed-precondition';

(async () => {
  const n = {
    invites: 0, keptPending: 0, keptNoAccount: 0,
    goneHousehold: 0, flaggedHousehold: 0, usedByMember: 0, usedByFormerMember: 0, pendingRows: 0,
    households: 0, bogusFlags: 0, skippedChanged: 0, errors: 0
  };
  const hhCache = new Map();
  const readHousehold = async (hid) => {
    if (!hhCache.has(hid)) hhCache.set(hid, await db.collection('households').doc(hid).get());
    return hhCache.get(hid);
  };

  /* 1. Invites. */
  const invites = await db.collection('invites').get();
  for (const inv of invites.docs) {
    n.invites++;
    const email = inv.id;
    const hid = (inv.data() || {}).householdId;
    let hh = null;
    try { if (typeof hid === 'string' && hid) hh = await readHousehold(hid); } catch (e) { n.errors++; console.log('  read failed: ' + errCode(e)); continue; }
    const d = hh && hh.exists ? (hh.data() || {}) : null;

    let reason = null, clearRow = false;
    if (!d) reason = 'goneHousehold';
    else if (flagged(d) && size(d.members) === 0) reason = 'flaggedHousehold';
    else {
      let uid = null;
      try { uid = (await auth.getUserByEmail(email)).uid; }
      catch (e) {
        // An id that is not a valid address can never match a sign-in token: as good as no account.
        if (errCode(e) !== 'auth/user-not-found' && errCode(e) !== 'auth/invalid-email') { n.errors++; console.log('  account lookup failed: ' + errCode(e)); continue; }
      }
      if (!uid) { n.keptNoAccount++; continue; }
      if (has(d.members, uid)) reason = 'usedByMember';
      else if (has(d.formerMemberInfo, uid)) reason = 'usedByFormerMember';
      else { n.keptPending++; continue; }
      clearRow = has(d.pendingInvites, email);
    }

    if (APPLY) {
      try {
        const b = db.batch();
        b.delete(inv.ref, { lastUpdateTime: inv.updateTime });
        // FieldPath, because the address has dots a string path would split on. No precondition on
        // the household: it changes on every save, and the row is stale once the invite is gone.
        if (clearRow) b.update(hh.ref, new FieldPath('pendingInvites', email), FieldValue.delete());
        await b.commit();
      } catch (e) {
        if (changedSinceRead(e)) { n.skippedChanged++; continue; }
        n.errors++; console.log('  delete failed: ' + errCode(e)); continue;
      }
    }
    n[reason]++;
    if (clearRow) n.pendingRows++;
  }

  /* 2. Deletion flags on families that still have people in them. */
  const hhs = await db.collection('households').select('members', 'deleteAfter', 'deletionRequestedBy').get();
  for (const h of hhs.docs) {
    n.households++;
    const d = h.data() || {};
    if (!flagged(d) || size(d.members) === 0) continue;
    if (APPLY) {
      try {
        await h.ref.update({ deleteAfter: FieldValue.delete(), deletionRequestedBy: FieldValue.delete() }, { lastUpdateTime: h.updateTime });
      } catch (e) {
        if (changedSinceRead(e)) { n.skippedChanged++; continue; }
        n.errors++; console.log('  unflag failed: ' + errCode(e)); continue;
      }
    }
    n.bogusFlags++;
  }

  const verb = APPLY ? 'deleted' : 'would delete';
  console.log('\ninvite cleanup (' + (APPLY ? 'APPLIED' : 'dry run, nothing changed; pass --apply to change it') + ')' + (FS_EMU ? ' [emulators]' : ''));
  console.log('  invites read:                         ' + n.invites);
  console.log('  ' + verb + ', household gone:          ' + n.goneHousehold);
  console.log('  ' + verb + ', household being deleted: ' + n.flaggedHousehold);
  console.log('  ' + verb + ', already joined:          ' + n.usedByMember);
  console.log('  ' + verb + ', removed or left:         ' + n.usedByFormerMember);
  console.log('  pending-list rows ' + (APPLY ? 'cleared' : 'to clear') + ':              ' + n.pendingRows);
  console.log('  kept, still pending (account exists): ' + n.keptPending);
  console.log('  kept, still pending (no account yet): ' + n.keptNoAccount);
  console.log('  households read:                      ' + n.households);
  console.log('  ' + (APPLY ? 'unflagged' : 'would unflag') + ', flag on a family with people: ' + n.bogusFlags);
  console.log('  skipped, changed during the run:      ' + n.skippedChanged);
  console.log('  errors:                               ' + n.errors);
  process.exit(n.errors ? 1 : 0);
})().catch((e) => { console.error('invite_cleanup failed: ' + errCode(e)); process.exit(1); });
