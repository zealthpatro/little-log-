# firestore.rules review — published rules vs privacy claims

Reviewed 2026-07-12 against the rules as published in the Firebase console (pasted by owner; snapshot in `design/firestore.published.rules`). This closes coverage-boundary item 2 in README.md (rules now read); the emulator cross-account test (PRIV-3) remains the final proof.

## Claims verified ✅

| Claim (source) | Rule | Verdict |
|---|---|---|
| Mood/EPDS owner-only forever, never shareable (PRIVACY-MAX) | `mhealth` read: `category != 'mood'` required for sharedWith path; write rejects mood docs with non-empty `sharedWith` | ✅ enforced |
| Pregnancy journey owner-owned + `sharedWith[]` (PRIVACY-MAX Item 7) | `pregnancy/{owner}`: read owner or listed uid (must also be member); write owner-only | ✅ enforced |
| `pro` written only by billing Worker (MONETIZATION §2) | `proUnchanged()` on every update; create requires `pro == null` | ✅ enforced |
| Entries authored by writer, "by Mama Bear" can't be forged at create (README §5) | events/photos create: `authorId == request.auth.uid` | ✅ at create (see SEC-4 for update) |
| Caregiver edits/deletes own entries only; owner all (README §4) | events/photos update/delete: owner or author | ✅ |
| Private notes readable only by audience/author; audience immutable (PRIVACY-MAX "deferred tweak") | notes read scoped; update pins `audience` + `createdBy` | ✅ **shipped — docs said deferred; close it** |
| App blob may never carry maternal keys (PRIVACY-MAX legacy guard, "deferred") | `appBlobClean()` blocks `pregnancy/mhealth/maternalHealth` keys on blob writes, legacy-tolerant | ✅ **shipped — close it** |
| No privilege escalation by caregivers | member-update branch pins `ownerId` + `members` map | ✅ for existing members |
| Outsiders fully blocked; newsletter unreadable; invites email-keyed and un-re-pointable | top-level matches as documented | ✅ |
| Emails circle-visible via memberInfo (PRIV-2) | household read exposes whole doc incl. memberInfo to all members | ✅ gap confirmed as known |
| Dual-guardian consent client-only (PRIV-1) | no consent logic in rules; owner deletes household solo; any member rewrites blob | ✅ gap confirmed as known |

## New findings from the rules themselves

| ID | Sev | Finding | Fix |
|---|---|---|---|
| **SEC-3** | 🔴 P0 (escalated 2026-07-12) | **Invitee role escalation at join — live in production.** The invitee branch allows `members.diff(...).affectedKeys().hasOnly([uid])` but never checks the *value*: a person invited as `caregiver` can join writing `members[uid] = 'owner'` — becoming full owner (delete household, manage members, guardian for consent). Insider-only (needs a valid invite), but it breaks the documented role model server-side. | Require `request.resource.data.members[request.auth.uid] == get(/invites/$(email)).data.role` (default `'caregiver'`) in the invitee branch |
| **SEC-4** | 🟡 P2 | **`authorId` mutable on update.** events/photos create pins authorship, but update doesn't pin `request.resource.data.authorId == resource.data.authorId` — an author (or owner) can re-attribute an entry after the fact, forging "by Nanny". | Add authorId-unchanged clause to update |
| **PRIV-4** | 🟡 P2 | **Invitee pre-join read of the household doc.** `allow read: if isMember() || invitedHere()` — an invited email that signs in can read the entire shared blob (babies, vaccines, meds, settings) *before* accepting/joining. Probably needed for the join UX, but it means "invited" ≈ "member" for read. | Accept & document, or narrow to the fields the join flow needs (move blob to subcollection — larger refactor) |
| note | ℹ️ | Household create allows pre-populating arbitrary uids as members (self-harm only — grants others access to the creator's new household). Notes `audience` value unvalidated at create (worst case: unreadable note). Owner cannot read pending invites they created (delete-only) — functional quirk, client tracks separately. | none required |

## Update 2026-07-12 (post-review hardening by owner)

Two further tightenings landed in the repo rules and are covered by the suite (now 90 checks):

| Area | Change | Closes |
|---|---|---|
| Invite create (line 39) | `role in ['owner','caregiver']` — the invite doc is the source of truth for the joined role (SEC-3), so constraining it at create means no malformed/elevated role can ever be minted | Defense-in-depth on SEC-3 |
| Household create (lines 93–96) | The maternal-key blob guard now runs at **create** too, not just update — a fresh household can no longer be born with `pregnancy`/`mhealth`/`maternalHealth` pre-seeded into the circle-shared blob (`appBlobClean()` only diffs on update) | New: create-path maternal leak |

The create-path maternal-blob hole was real and is now closed. Remaining open items are the ones rules can't cleanly own alone: **PRIV-1** (dual-guardian consent still app-level), **PRIV-2** (member emails circle-visible by design), and the low-risk notes (a creator may still seed other uids as members of their *own* new household; note `audience` value unvalidated at create).

## Verdict
The three marketing privacy promises — mood never shareable, pregnancy owner-owned, pro server-locked — are genuinely rule-enforced. Fix SEC-3 before inviting untrusted caregivers is marketed as safe; run PRIV-3 (emulator denial suite) before claiming "private to you" in launch copy.
