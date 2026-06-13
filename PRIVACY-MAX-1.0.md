# Privacy Max 1.0 — maternal health, mother-controlled & consent-gated (gate G1)

Branch: `pregnancy-tracker`. Blocks 2.4 / 2.5 / 4.2 (no maternal surface ships until this is done +
the rules are published in the Firebase console). Authored 2026-06-13.

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

**Stays in the circle-shared `app` blob (about the cub-to-be, fine for the circle):** week/stage,
size, appts schedule, kicks, contractions, birth plan, hospital bag, Moments, due date/lmp
(due date drives the shared week view; founder may later lock it down too).

## Rules (DONE — in `firestore.rules`, publish in console to enforce)
Added `match /households/{hid}/mhealth/{owner}/cat/{category}`:
- **read**: household member AND (you are the owner OR (category≠mood AND your uid ∈ sharedWith)).
- **write**: only the owner, as a member; `ownerUid` must match; for `mood`, `sharedWith` must be empty/absent.
- **delete**: owner only.
This is the literal G1 enforcement. It is additive (new path) — it does not change any existing rule,
so current flows are untouched. **It enforces nothing until the client writes data there (next chunk).**

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

## Acceptance (G1) — STILL PENDING the emulator (cannot run in the build env)
A non-permitted circle member **cannot** read another member's `mhealth/*` via the API/rules — must be
proven with the Firestore emulator test suite (or a manual two-account cross-read). `mood` unreadable by
anyone but the owner even if mis-added to a share list. ✔ verified by code: no maternal category appears
in `appBlobFromState()` output (`sharedPregnancy` strips them). Do **not** market "private to you" until
the emulator cross-account denial passes.

## To publish the rules (console is the runtime source of truth) — PENDING founder action
Firebase Console → Firestore → Rules → paste `firestore.rules` → Publish. The new `mhealth` block is
additive (no existing rule changed), so publishing it does not affect current flows. Then run the
emulator suite (or a manual cross-account read test) to confirm a second member is denied.
