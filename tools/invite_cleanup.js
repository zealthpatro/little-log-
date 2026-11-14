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
 *   - nobody has joined with it yet (no account, or an account that was never in that household):
 *     keep it ONLY when it is a caregiver invite into a family nobody has left (formerMemberInfo
 *     empty). A co-owner invite, or any invite into a family someone has left, is deleted with its
 *     pendingInvites row, and the owner may need to re-send it. WHY: a removed member can delete his
 *     own Auth account with one call and his own token (skipping the app's deleteAccount, which
 *     would delete the invite), so at cleanup time he looks like "no account yet". Signing up again
 *     gives him a new uid that is in no tombstone, before or after the cleanup, so he looks like a
 *     stranger. Either way he could come back in after --apply, as owner with a co-owner invite, and
 *     remove the original owner. Re-sending a genuine invite is a small, one-time cost.
 *   - an invite under the NAME of someone removed (formerMemberInfo keeps the name on a removal) is
 *     that person's invite to another address: she joined by link with Hide My Email, say, while the
 *     owner's invite to her real address was still waiting, and it lets her back in. Deleted, with its
 *     row, whatever the rest of this list would say, and counted on its own line. Whole name, trimmed,
 *     any case, read off the invite or its pending row. A deletion's tombstone has no name, so it never
 *     matches. (The app cancels these at removal now; this closes the ones left from before.)
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
// Names are compared whole, trimmed and in any case (removeMember in app/store-firebase.js does the same).
const nameKey = (v) => String(v == null ? '' : v).trim().replace(/\s+/g, ' ').toLowerCase();
const removedNames = (d) => new Set(Object.values((d && d.formerMemberInfo) || {}).map((t) => nameKey(t && t.name)).filter(Boolean));
const inviteName = (inv, d, email) => nameKey((inv && inv.name) || ((((d && d.pendingInvites) || {})[email]) || {}).name);
// The rules join with the invite's role, missing meaning caregiver. Anything else counts as co-owner.
const isCaregiverInvite = (inv) => { const r = (inv || {}).role; return r === undefined || r === null || r === 'caregiver'; };

// Errors are reported by code only: a message can carry a document path, and the path is an address.
const errCode = (e) => String((e && e.code) || 'error');
// A lastUpdateTime precondition that no longer holds (gRPC FAILED_PRECONDITION is code 9).
const changedSinceRead = (e) => errCode(e) === '9' || errCode(e) === 'failed-precondition';

(async () => {
  const n = {
    invites: 0, keptPending: 0, keptNoAccount: 0, keptCaregiver: 0, keptOwner: 0,
    notJoinedNoAccount: 0, notJoinedHasAccount: 0, namedLikeRemoved: 0,
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
    const invData = inv.data() || {};
    const hid = invData.householdId;
    let hh = null;
    try { if (typeof hid === 'string' && hid) hh = await readHousehold(hid); } catch (e) { n.errors++; console.log('  read failed: ' + errCode(e)); continue; }
    const d = hh && hh.exists ? (hh.data() || {}) : null;

    let reason = null, clearRow = false, namesake = false;
    if (!d) reason = 'goneHousehold';
    else if (flagged(d) && size(d.members) === 0) reason = 'flaggedHousehold';
    else {
      let uid = null;
      try { uid = (await auth.getUserByEmail(email)).uid; }
      catch (e) {
        // An id that is not a valid address can never match a sign-in token: as good as no account.
        if (errCode(e) !== 'auth/user-not-found' && errCode(e) !== 'auth/invalid-email') { n.errors++; console.log('  account lookup failed: ' + errCode(e)); continue; }
      }
      if (uid && has(d.members, uid)) reason = 'usedByMember';
      else if (uid && has(d.formerMemberInfo, uid)) reason = 'usedByFormerMember';
      // Nobody has joined with it. Keep only a caregiver invite into a family nobody has left, and
      // never one under the name of someone removed from it (her invite to another address).
      else if ((namesake = removedNames(d).has(inviteName(invData, d, email)))
        || !isCaregiverInvite(invData) || size(d.formerMemberInfo) > 0) reason = uid ? 'notJoinedHasAccount' : 'notJoinedNoAccount';
      else {
        if (uid) n.keptPending++; else n.keptNoAccount++;
        // keptOwner stays 0 under the rule above; it is counted from the invite itself, not assumed,
        // so the dry run shows the founder that no co-owner invite survives.
        if (isCaregiverInvite(invData)) n.keptCaregiver++; else n.keptOwner++;
        continue;
      }
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
    if (namesake) n.namedLikeRemoved++;
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
  console.log('  ' + verb + ', not joined, no account (the owner may need to re-send it): ' + n.notJoinedNoAccount);
  console.log('  ' + verb + ', not joined, has an account (the owner may need to re-send it): ' + n.notJoinedHasAccount);
  console.log('    (an invite nobody has joined with is kept only if it is a caregiver invite into a family nobody has left)');
  console.log('    of those, under the name of someone removed (her invite to another address): ' + n.namedLikeRemoved);
  console.log('  pending-list rows ' + (APPLY ? 'cleared' : 'to clear') + ':              ' + n.pendingRows);
  console.log('  kept, still pending (account exists): ' + n.keptPending);
  console.log('  kept, still pending (no account yet): ' + n.keptNoAccount);
  console.log('  kept, caregiver invites:              ' + n.keptCaregiver);
  console.log('  kept, co-owner invites:               ' + n.keptOwner);
  console.log('  households read:                      ' + n.households);
  console.log('  ' + (APPLY ? 'unflagged' : 'would unflag') + ', flag on a family with people: ' + n.bogusFlags);
  console.log('  skipped, changed during the run:      ' + n.skippedChanged);
  console.log('  errors:                               ' + n.errors);
  process.exit(n.errors ? 1 : 0);
})().catch((e) => { console.error('invite_cleanup failed: ' + errCode(e)); process.exit(1); });
