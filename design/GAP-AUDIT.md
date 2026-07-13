# Gap audit — expected vs actual (2026-07-12)

Every divergence found by the full code trace + doc sweep + live check. IDs are stable; close by striking through with a date + commit.

## 🔴 P0 — fix before next launch step

| ID | Flow | Finding | Action |
|---|---|---|---|
| SEC-1 | 06 | **Billing `/portal` IDOR** (both workers): caller-supplied `customer`/`subId`, no ownership proof; Origin header forgeable outside browsers → anyone with a valid `cus_…` id gets another family's billing portal | Bind portal (and `/checkout` `hid`) to a verified Firebase ID token, like `/api/hub/*` already does. Must land **before** `PRO_CFG.checkoutUrl` is set |
| DEP-1 | 10 | **Production is a mix of two builds** (verified 2026-07-12, extended sweep): `/pricing/` AND `/faq/` are stale — old 5-tab nav, **$15/mo·$179/yr / "$15–19/mo"** pricing, and FAQ says pregnancy tracking "is on the way" while the live homepage/pregnancy page sell it as shipped. Home, /features/, /pregnancy/, vaccine pages = current. Users see two prices and a false "coming soon" today. Local branch is `site` — unpushed/partial deploy | Deploy current pricing + faq pages; add the curl drift check (README) to routine ops; after deploy, re-sweep all top-level pages |
| PRIV-1 | 08 | **Dual-guardian consent is client-only** — not enforced in firestore.rules; any member can write the shared blob, owner can delete without second approval | Move gate into rules; until then keep the softened copy |
| SEC-3 | 05 | **Invitee role escalation — live in production now.** Rules' join branch checks *which* member key changes, never its *value*: anyone invited as `caregiver` can join as `owner`, then delete the whole household, remove members, or act as consent guardian. The role limit is the product's trust boundary and it is open for every outstanding invite today. (Escalated from P1 2026-07-12: "insider-only" is not a mitigation when inviting semi-trusted caregivers is the core feature.) | One-line rules fix: pin joined role to the invite doc's `role` (default `caregiver`). Publish immediately — no client change needed |

## 🟠 P1 — UX-ROADMAP open items confirmed still relevant

| ID | Flow | Finding |
|---|---|---|
| G1 | 02 | First-run identity modal can fire over the stage question — collapse into one ordered wizard (roadmap "DO FIRST"; v0.14.0 may have partly fixed — verify) |
| G2/G3 | 01 | No privacy line at sign-in; Apple/email methods visually second-class |
| C1 | 03 | Nav tab switch leaves open sheet on top (`go()` never `closeSheet()`) |
| C2 | 03 | Scrim tap silently discards unsaved draft (the "3am case") |
| L1 | 07 | Roadmap calls loss flow "toasts + drops back — charter violation", but code has a real `renderLossHolding` holding screen → **verify which is true, then close or fix**. Highest moral priority |
| S1/S2 | 05 | Guess-game link clipboard-only; guest `/g/` page has no share → viral loop dead-ends |
| A1–A3 | all | `:focus-visible` missing; date-picker disabled-date contrast; sheet close buttons <44px |
| M1 | 10 | Marketing home speaks baby-only; pregnant visitors get fine print, no stage bridge |
| PV1/PV2 | 07 | Pregnancy nav: demote Moments tab (empty most of pregnancy) → 4 tabs; move games card to Tools |
| EXP-1 | 08 | Export = `state` JSON only — **photo binaries excluded**; weakens "export anytime" before the privacy-wedge launch |

## 🟡 P2 — drift, contradictions, debt

| ID | Flow | Finding |
|---|---|---|
| DOC-1 | 06 | Billing provider: newest decision = **Lemon Squeezy MoR** (LEMONSQUEEZY.md, v0.14.0); README/HANDOFF/PRO/MONETIZATION + pro-billing README still describe Stripe. Decide, then retire stale text |
| DOC-2 | 06 | PRO.md + MONETIZATION-HANDOFF still print the retired Base $5 / Pro-Plus $15–19 ladder in-body |
| DOC-3 | 10 | README/HANDOFF say "5-tab nav", "180+ articles"; reality = 4-tab + About, ~398 articles |
| DOC-4 | 04 | README §9 "push is in-app only" vs shipped medicine-dose FCM push (v0.14.0) |
| DOC-5 | 03 | "Routines" naming in README/HANDOFF/ROUTINES body vs shipped "Rituals" UI |
| DOC-6 | 10 | news-widget.js header says newsletter → "Firestore"; worker writes to D1 |
| DOC-7 | — | SW version drift across docs (README v73 · HANDOFF v82 · CHANGELOG v119) — README/HANDOFF ~2 releases stale |
| SEC-2 | 06 | `/checkout` accepts unauthenticated `hid` (griefing/mis-attribution); `corsHeaders` falls back to `allowed[0]` instead of denying |
| PRIV-2 | 05 | Member emails circle-visible via `memberInfo` (copy corrected; rules fix open) |
| PRIV-3 | 08 | Cross-account rules denial test (emulator suite) still pending — blocker for marketing "private to you". Published rules now reviewed line-by-line (RULES-REVIEW.md): mood/pregnancy/pro promises ARE enforced; two doc-listed "deferred" guards (notes audience immutability, legacy blob key ban) are actually shipped |
| SEC-4 | 03/04 | `authorId` mutable on event/photo *update* — attribution forgeable after create (create is pinned). Add authorId-unchanged clause (RULES-REVIEW.md) |
| PRIV-4 | 05 | Invited-but-not-joined email can read the full household doc (`invitedHere()` read) — pre-join blob exposure; accept & document or narrow (RULES-REVIEW.md) |
| SYNC-1 | 09 | App-blob last-write-wins; charter calls LWW "wrong for a baby log" (events per-doc mitigates) |
| DEAD-1 | app | "Our Den" module fully built, shipped disabled (`FEATURES.den=false`, ~150 lines) — keep or cut |
| COPY-1 | 08 | Push "coming soon" shown when the truth is "unsupported on this browser" |
| POL-1 | app | `window.prompt/confirm/alert` in email-confirm, remove-member, guardian errors — inconsistent with sheet UI |
| SEO-1 | 10 | Pricing JSON-LD lists only Free + annual; monthly $9 missing from structured data |
| REF-1 | 05 | Referral reward designed but not redeemable/announced |
| VER-1 | 05/07 | Verify `/api/hub` games backend is deployed (client has "coming soon" fallback) |

## ⚠️ Repo-ahead-of-production divergence (found 2026-07-12)

The `firestore.rules` **in the repo already fix SEC-3, SEC-4, and PRIV-4** (invitee role pinned to invite, `authorId` immutable on update, household read restricted to members). But the **rules pasted from the live Firebase console do NOT** — production is running the older, vulnerable version. So these aren't "to be written" — they're **written and unpublished**. Action is a single publish, gated on a green emulator run:

```
cd test && npm run test:rules      # must print "0 failed" (82 checks)
npx firebase deploy --only firestore:rules --project little-log-a9caa
```

Then re-snapshot `design/firestore.published.rules`. The emulator suite (`test/rules-test.js`) was expanded to 82 cross-account assertions and syntax-validated on 2026-07-12, but must be *run* on a dev machine (the sandbox can't download the emulator JAR). See `design/RED-TEAM-REVIEW.md` for the full launch verdict.

## Verification checklist (how each was established)
- Code claims: file:line refs in each flow spec (traced 2026-07-12).
- Live claims: fetched `little-cubby.com` home ✅ current, `/pricing/` ❌ stale, `/vaccination-schedule/uk/` ✅ current, `/api/health` ✅ `cronHealthy:true, ageMin:14`.
- Doc claims: source doc named per row; freshest sources = CHANGELOG + UX-ROADMAP (2026-06-22).
