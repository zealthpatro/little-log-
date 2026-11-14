/* Which households have an email invite out, for the founder's local reports (tools/ops.js,
   tools/analytics.js). Two places hold one since November 2026: the address-keyed invites/{email},
   and each family's own invites/{email}/from/{hid} (one invite per family per address). The second
   usually has no parent document, so a list of /invites never sees it; it is read with a
   collection-group query and kept to the documents that really sit under /invites and name their
   own household, because 'from' is a plain word another collection could use one day.
   The live funnel snapshot does the same in worker.js (funnelFamilyInvites).
   Gate: test/invite-households.test.js. */
'use strict';

function underInvites(doc) {
  const inv = doc && doc.ref && doc.ref.parent && doc.ref.parent.parent;
  return !!(inv && inv.parent && inv.parent.id === 'invites' && !inv.parent.parent);
}

async function invitedHouseholdIds(db) {
  const out = new Set();
  const none = { docs: [] };
  const [legacy, fam] = await Promise.all([
    db.collection('invites').get().catch(() => none),
    db.collectionGroup('from').get().catch(() => none),
  ]);
  legacy.docs.forEach((d) => { const h = (d.data() || {}).householdId; if (h) out.add(h); });
  fam.docs.forEach((d) => {
    if (!underInvites(d)) return;
    const h = (d.data() || {}).householdId;
    if (h && h === d.id) out.add(h);
  });
  return out;
}

module.exports = { invitedHouseholdIds, underInvites };
