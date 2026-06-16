# Privacy Max 1.0 — maternal health, mother-controlled & consent-gated (gate G1)

Ships from `main` (production deploys from `main`: push = live via Cloudflare Workers Builds). Blocks
2.4 / 2.5 / 4.2 (no maternal surface ships until this is done + the rules are published in the Firebase
console). Authored 2026-06-13. Updated 2026-06-14: rules now published; pregnancy journey + per-day
notes privatized (see below).

## Core tenet (do not lose this)
Privacy is **server-enforced** in `firestore.rules`. Hiding something in the client UI is **NOT**
privacy: anyone with the API can read what the rules allow. Every "private" claim in this doc means a
rule denies the read, not that a tab is hidden. Client gating is only a courtesy layer on top of the
rules.

## The problem this fixes (found in live audit)
Today `state.pregnancy` holds the mother's health data — **bp, glucose, weights, urine, nausea,
symptoms, supplements, careTeam, mood/conditions** — and it is serialized into the **circle-shared
`app` blob** (`households/{hid}.app.pregnancy`, `store-firebase.js`). The household rule is
`allow read: if isMember()`, and there is **no `visibility` check anywhere**. So every invited circle
member (nanny, grandparent, anyone) can currently read the mother's clinical data. This violates
Privacy Max (B5) and D2. Not yet live (branch unmerged), so we fix it before launch.

## The model (founder-confirmed): mother owns it, shares per item, by consent
The mother decides **what** to share and **with whom** — e.g. share BP + glucose with her husband,
nothing with the rest of the circle, mood with no one. Granular, consent-gated, limited.

- **Default = private to the mother.** Nothing maternal is shared until she opts in.
- **Per-category consent.** Each category has its own `sharedWith` allowlist of guardian uid(s) she chooses.
- **Mental health (`mood`/EPDS) is owner-only, forever.** It can never be added to a share list (enforced in rules).
- **Role-agnostic.** `sharedWith` is any uid she picks (husband, her mother, a co-mum) — not hardcoded papa/mama. (Folds in 1.3; also fix the existing `guardians` papa+mama assumption.)

## Storage (out of the shared blob)
Move maternal-private categories from `app.pregnancy` into a protected subcollection:

```
households/{hid}/mhealth/{ownerUid}/cat/{category}
  { ownerUid, category, sharedWith: [uid...], updatedAt, ...categoryData }
```
Categories (each its own doc, so sharing is per-category and reads are doc-level clean):
- `health`   — weights, bp, glucose, urine, nausea, symptoms, supplements
- `careteam` — care team contacts
- `conditions` — GDM/pre-eclampsia/etc. trackers (opt-in)
- `mood`     — mood / EPDS. **owner-only, never in sharedWith.**

**The pregnancy journey is now owner-owned too (2026-06-14, item 7), NOT in the circle-shared blob.**
The journey (stage, due date, weeks, appointments, kicks, contractions, birth plan, hospital bag,
Moments) was moved OUT of `app.pregnancy` into an owner-owned doc, mirroring the `mhealth` pattern:

```
households/{hid}/pregnancy/{ownerUid}
  { ownerUid, sharedWith: [uid...], ...journey }
```
- **read**: the owner, plus any uid she lists in `sharedWith[]`.
- **write**: only the owner.
Server-enforced in `firestore.rules` (`match /pregnancy/{owner}`). Maternal-private HEALTH stays
**separate and owner-only** in `mhealth` (above) and is never swept into the journey. A legacy
in-blob journey self-heals: the owner's client relocates it to the owner doc, then strips it from the
blob on the next owner login. Note: under the OLD design the in-blob journey was already visible to the
whole circle, so this is retroactive privatization, not a fresh secret leak.

## Rules (DONE, in `firestore.rules`, PUBLISHED in the Firebase console 2026-06-14)
Added `match /households/{hid}/mhealth/{owner}/cat/{category}`:
- **read**: household member AND (you are the owner OR (category≠mood AND your uid ∈ sharedWith)).
- **write**: only the owner, as a member; `ownerUid` must match; for `mood`, `sharedWith` must be empty/absent.
- **delete**: owner only.
This is the literal G1 enforcement. It is additive (new path), so it does not change any existing rule,
and current flows are untouched.

The same publish (2026-06-14) also enforces the new **pregnancy journey** block
(`match /pregnancy/{owner}`: read by owner or `sharedWith[]`, write by owner only) and the new
**per-day notes** block (see below). The `mhealth` and Pro-lock rules are unchanged. The rules are now
the live runtime source of truth, so these privacy claims are server-enforced, not client-hidden.

## Per-day notes (2026-06-14, item 5): per-doc, audience-based, enforced by rules
The old single shared "handoff" note was replaced by per-day notes on the home day-surface. Each note
is stored one-per-doc (NOT in the circle-shared `app` blob):

```
households/{hid}/notes/{noteId}
  { author: uid, audience, ... }
```
`audience` is one of:
- `'circle'`: readable by everyone in the household.
- a specific member uid: private to that one person (plus the author).
- the author: private to the author.

`firestore.rules` enforce read by audience/author; only the author can edit or delete. This is
rules-enforced privacy, not client hiding: a member the note is not addressed to cannot read it via the
API at all. A one-time, idempotent migration moves any legacy handoff note into a single `'circle'`
note, authored by the writing owner.

## Client rewire — DONE (2026-06-13). Approach changed: enforce at the boundary, not 79 accessors.
The original plan was to centralize ~79 `state.pregnancy` call sites behind `matGet`/`matSet`. We did
**not** do that — it was the riskiest possible change for "don't break flows". Instead the privacy
boundary is enforced at the **two serialization functions plus a new sync path**, leaving all 79
in-memory call sites byte-for-byte untouched. `state.pregnancy` stays the unified in-memory working
object; private fields simply never cross into the shared blob, and travel via the protected docs.

Implemented in `app/store-firebase.js`:
- `MAT_CATS` / `MAT_PRIVATE_KEYS` — the category→field map (single source of truth for what is private).
- `sharedPregnancy(p)` — strips every private field; called by `appBlobFromState()` so the blob can
  never carry maternal data. `mergeSharedPreg(shared)` — on hydrate, copies only shared journey fields,
  **preserving** private fields already loaded from the mhealth listener (and drops stale ones if the
  pregnancy id changed).
- `syncMaternal(uid)` — **owner-only** write of changed category docs (data + current `sharedWith`),
  diffed via `knownMat`. Called at the end of `pushNow`.
- `ensureMaternalListeners(uid)` — owner uses a **collection** listen on her own `cat/` (all docs match
  the rule); a non-owner uses **per-doc** listens (a collection query can't be satisfied when only some
  docs match). `applyMatDoc` folds permitted category data back into `state.pregnancy`.
- Ownership: set at creation (`ownerUid: myUid()` in `index.html`), and repaired for legacy/offline
  pregnancies in `pushNow` (household-owner only). **One-time migration** in `maybeBoot`: if a legacy
  blob still carries private fields and the user is the household owner, it force-pushes once to relocate
  them out of the blob and into the protected docs.
- Consent API on `window.LL`: `matIsOwner` / `matCanRead(cat)` / `matShared(cat)` / `matSetShared(cat,uids)`
  / `matClear()`. While a pregnancy is unassigned, **only the household owner** is treated as owner — a
  caregiver can never see, claim, or write the mother's health (closes the ownership-claim defect found
  in review; `matSetShared`'s claim is role-gated to mirror `pushNow`). `mood` is rejected client-side.

In `app/index.html`: consent sheet `openMaternalPrivacy()` (owner-only, per-category member toggles,
mood shown locked "Only you"); non-owner gating on the care tab, week-home health cards, and the
Symptom/Weight quick-actions (Kicks/Contractions stay shared); `doEndPregnancy` calls `matClear`.

**Reviewed** by an adversarial 4-dimension workflow (leak / data-loss / consent / brand): the leak and
data-loss dimensions found nothing real; two issues were confirmed and fixed (the role-gated ownership
claim above; a leftover brand toast).

## Account-switch teardown (2026-06-14 fix)
Sign-out / teardown now clears the in-memory **pregnancy journey** and **maternal-private health** so
neither can survive into the next account during an in-tab account switch. Previously the in-memory
`state.pregnancy` (which carries both the journey and the owner-private health fields hydrated from the
mhealth listener) could linger after sign-out and be briefly visible to whoever signed in next. The
rules already deny cross-account reads at the server; this fix closes the client-memory residue so the
two layers agree.

## Acceptance (G1) — STILL PENDING the emulator (cannot run in the build env)
A non-permitted circle member **cannot** read another member's `mhealth/*` via the API/rules — must be
proven with the Firestore emulator test suite (or a manual two-account cross-read). `mood` unreadable by
anyone but the owner even if mis-added to a share list. ✔ verified by code: no maternal category appears
in `appBlobFromState()` output (`sharedPregnancy` strips them). Do **not** market "private to you" until
the emulator cross-account denial passes.

## "Why we ask" transparency (2026-06-16): make every privacy claim truthful to the user
Contextual one-tap "Why we ask" help was wired across the data-entry flows so a parent can see, at the
point of entry, what a field is for and who can see it. Two privacy-load-bearing surfaces were verified
against `firestore.rules` so the in-app copy does not over-promise:
- **Privacy-verified field help.** Each "Why we ask" line that touches privacy was adversarially checked
  against the published rules before shipping, so the on-screen claim matches what the server actually
  enforces (no "private" wording where the rules allow the read).
- **Family list discloses email visibility.** The family/circle list now states plainly that everyone
  in the circle can see each other's name and email. This is an always-visible note (not a hidden
  expander) because that fact should not be tucked away. It is the truthful counterpart to the
  memberInfo gap below.

Shipped on `main` (commit 3365e4d, service worker v80).

## Known enforcement gaps (2026-06-17 audit): client-only guards that are NOT yet rules-enforced
Per the Core tenet above (hiding in the client is NOT privacy), two findings are documented here as
gaps, not guarantees:
- **Dual-guardian consent gate is client-only.** The "both guardians must agree" gate for export/delete
  is enforced ONLY in `index.html`, NOT in `firestore.rules`. Any household member can write the shared
  `app` blob, and an owner can delete without a second approval. So it is a UI convention, not a security
  guarantee. Help copy was softened to "Cubby asks both guardians to agree". **To make the guardian gate
  a real guarantee it must move into `firestore.rules`.**
- **Email is circle-visible via memberInfo.** Email is NOT private: it is written to
  `households/{hid}.memberInfo` and is readable by every member, and shown on the family list. Copy was
  corrected accordingly (see the family-list disclosure above).

## Rules publication (console is the runtime source of truth): DONE 2026-06-14
The founder pasted `firestore.rules` into Firebase Console → Firestore → Rules → Publish on 2026-06-14,
including the new `mhealth`, pregnancy journey, and per-day notes blocks. These blocks are additive (no
existing rule changed), so publishing did not affect current flows. They are now the live source of
truth.

**Still pending:** the founder's two-account cross-account read test (or the emulator suite) to confirm
a non-permitted member is denied; the deferred `app.pregnancy` rules guard (waiting ~a week for old v72
clients to drain before locking the legacy blob path); and the deferred notes audience-immutability
rule tweak.
