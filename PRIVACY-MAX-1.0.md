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

## Client rewire — the remaining work (sizable; do with the Firestore emulator)
`state.pregnancy` is read in ~79 places in `app/index.html`, not centralized. Plan:
1. **Centralize first.** Add accessors `matGet(cat, key)` / `matSet(cat, key, val)` and route all
   maternal reads/writes through them. Keep cub-to-be journey fields on `state.pregnancy` (shared).
2. **New sync path** in `store-firebase.js`: write the owner's `mhealth/{uid}/cat/*` docs on her edits;
   subscribe (onSnapshot) to the cat docs the current user is permitted to read (own + shared-to-me).
   Never put maternal-private categories into `appBlobFromState()` again.
3. **Consent UI** ("Your private health · who can see it"): per category, pick guardian(s) to share
   with from the circle; `mood` shows "Only you", locked. Writes `sharedWith`.
4. **Subject switcher** hides the mum subject's health from non-permitted viewers (honor the rules client-side too, for UX; the rules are the real guarantee).
5. **Migration:** branch is unmerged → assume no production maternal data. Add a one-time guard: if a
   legacy `app.pregnancy` carries maternal categories, move them to the protected docs on first load,
   then strip them from the blob. Verify nothing maternal remains in any `app` blob.

## Acceptance (G1)
A non-permitted circle member **cannot** read another member's `mhealth/*` via the API/rules —
proven with the Firestore emulator test suite. `mood` is unreadable by anyone but the owner even if
mis-added to a share list. No maternal category appears in `appBlobFromState()`. Do not market
"private to you" until this passes below the client.

## To publish the rules (console is the runtime source of truth)
Firebase Console → Firestore → Rules → paste `firestore.rules` → Publish. Then run the emulator
suite (or a manual cross-account read test) to confirm a second member is denied.
