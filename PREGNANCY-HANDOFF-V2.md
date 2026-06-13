# Pregnancy tracker (Mommy To Be) — handoff v2

**Version 2 · 2026-06-10 · supersedes `PREGNANCY-HANDOFF.md` (v1, the original build spec).**
v1 said "build Phases 2-5"; that is DONE, and much more. This doc is the single source of truth
for picking the pregnancy track back up. Read it cold and you know everything.

> **Scope rule:** pregnancy work happens on the `pregnancy-tracker` branch using THIS doc.
> Sessions on `main` are for little-cubby core jobs (marketing/SEO/content/baby app) only.

---

## 1. Where the work lives (nothing is on main yet)

- **Branch:** `pregnancy-tracker`, pushed to `origin/pregnancy-tracker`. **NOT merged to main.**
- **PR:** not yet opened; one-click create (title/body prefilled) via the compare link:
  `https://github.com/zealthpatro/little-log-/compare/main...pregnancy-tracker?quick_pull=1`
- **The 7 commits** (oldest first):
  1. `1dd3d39` Pregnancy tracker: pregnancy mode, logging, tools, birth transition (Phases 2-5)
  2. `e3577d5` Pregnancy health: opt-in condition trackers (GDM, BP/pre-eclampsia, supplements, nausea)
  3. `c3aea2d` Cubby Den: service brand + public /pregnancy/ sales page + ECOSYSTEM.md
  4. `04ed6ec` Naming round 2 record (Cubtale/Cub collision, expanded avoid list)
  5. `df03525` Our Den: household hub (chores/shopping/meals/staff/expenses/weights) + Den master plan
  6. `7828c0b` Consent governance: dual-guardian delete/export, attribution tombstones
  7. `11f3227` Mommy To Be: journey rebrand + planning ("we're trying") stage + Moments ultrasound album

## 2. What's built (inventory)

**Mommy To Be = the pregnancy flow, an independent brand.** Full journey:
- **Entry ("start wherever you are"):** We're trying (planning stage) · Just found out (weeks from
  LMP) · Already counting weeks (due date). Entry button on app onboarding.
- **Planning stage:** preconception checklist (NHS-based, editable), optional fertile-window
  estimate (LMP + cycle length, heavily disclaimed), "My period started" update, and
  "I got a positive test 🎉" which converts planning -> expecting (computes EDD, seeds appts).
- **Expecting:** Week view (trimester, progress, size/baby/you cards), 5 tabs:
  Week / Log / **Moments** / Tools / Care.
- **Log:** antenatal appointments seeded by country (NHS / ACOG / G-BA / WHO-aligned; tick,
  edit, add), symptoms, weight, blood pressure, care team.
- **Health trackers (opt-in per condition, Care tab > Manage health trackers):** gestational
  diabetes glucose (mmol/L + mg/dL, NICE NG3 / ACOG targets, above-target flags, % in range),
  BP / pre-eclampsia watch (NICE NG133 raised/severe thresholds, urine protein, symptom list),
  supplements daily adherence, nausea & hydration check-ins.
- **Tools:** kick counter (count to 10, history), contraction timer (frequency/duration + 5-1-1
  guidance), birth plan, hospital bag (seeded, editable).
- **Moments:** ultrasound / bump photos, each saved with its week + "size of" fruit comparison
  (`downscaleToData` -> `PhotoStore`); kept forever as pregnancy history.
- **Danger signs:** CDC Hear Her list, "seek care" framing, one tap from home.
- **Birth transition:** "Baby has arrived" -> warm sheet -> creates a real baby via the existing
  add-baby path (country + optional sex carry over), sets `bornBabyId`, pregnancy kept as history,
  app becomes the normal baby tracker.
- **Marketing:** `/pregnancy/` sales page (Mommy To Be brand, journey + Moments sections,
  JSON-LD), nav + footer links on home/features/pricing/faq, sitemap entry (0.9).

**Riding along on the branch:**
- **Consent governance (ships with this release):** household owns the data. Removing a member
  keeps their entries attributed (`formerMemberInfo` tombstone). Guardians (mama+papa, max 2,
  min 1, Settings > Data > Guardians) must ALL approve bulk delete (granular scopes) and export;
  decline is gentle; solo households complete instantly; small audit trail in the Data sheet.
  App-level enforcement only; server-side dual-consent needs Functions/rules later.
- **Our Den household hub (DARK):** chores, shopping, meal plan, home staff, expenses, adult
  weights. Fully built + verified, hidden behind **`FEATURES.den = false`** in `app/index.html`.
  Its later launch = flip the flag + bump SW cache. Do NOT enable it in the pregnancy release.

## 3. Brand state (decisions on record; detail in ECOSYSTEM.md on the branch)
- **Mommy To Be** = pregnancy service brand (independent identity). Generic phrase: available
  (no app collision; nearest Mommy+/HiMommy/Mommy Womb) but weakly protectable as a mark.
- **Den** = master household-OS brand (checked clean). **Cubby** = the baby flow.
- REJECTED names (verified collisions): Ember (Ember Baby app), Cub/Cubs (Cubtale, Cub Baby
  Sleep). Avoid: Glow, Bump, Sprout, Coconut, Nest, Hatch, Willow, Halo, Flutter, Luna, Acorn,
  Snug, Hearth. Best standalone fallback if ever needed: **Patter**.

## 4. Key code anchors (all on the branch)
- `app/index.html` sections (grep the banner comments):
  `PREGNANCY` (journey, week view, logging, tools, Moments, birth transition) ·
  `PREGNANCY HEALTH` (condition trackers) · `OUR DEN` (dark hub) · `CONSENT` (governance).
  Flags: `const FEATURES = { den:false }` near `CUBBY_VERSION`.
- `app/pregnancy-data.js`: `window.PREG` = weeks 4-41, antenatal schedules, dangerSigns,
  `conditions` (GDM/BP/supplements/nausea thresholds + sources). Re-verify sources yearly.
- `app/store-firebase.js`: household blob carries `pregnancy`, `den`, `consents`, `guardians`;
  household doc carries `formerMemberInfo`; loggerName/authorTag fall back to it.
- `app/sw.js`: `CACHE = little-log-v55` on the branch (main is at v48; resolve to the higher
  number + 1 on merge if main moved).
- `pregnancy/index.html`: the sales page.
- State shape: `state.pregnancy` includes `stage` ('planning'|'expecting'), `moments[]`,
  `precon[]`, `cycleLen`, plus everything from v1 (§3 of PREGNANCY-HANDOFF.md).
  `ensurePregFields()` migrates older pregnancies safely.

## 5. Rollout runbook (pregnancy release)
1. Review the PR (or `git diff main..pregnancy-tracker`).
2. Watch for merge conflicts in shared marketing files (`index.html` root, `sitemap.xml`,
   `faq/ pricing/ features/` navs) if main's SEO work touched them; and in `app/sw.js`
   (take highest CACHE + 1).
3. Merge -> push -> Cloudflare auto-deploys ~1 min.
4. Verify live in incognito: little-cubby.com/pregnancy/ renders; /app/ onboarding shows
   "Mommy To Be" entry; create a test pregnancy via each of the 3 journey paths; add a Moment;
   check a second signed-in device syncs.
5. Leave `FEATURES.den=false`. The Home/Den launch is a separate, later release.

## 6. Next-work queue for this track (rough priority)
- [ ] OG image for /pregnancy/ (currently reuses cubby-home.png).
- [ ] FAQ + pricing page mentions of the pregnancy flow (marketing consistency).
- [ ] Pregnancy SEO articles via the content engine (CONTENT-QUEUE.md), e.g. "pregnancy week by
      week", antenatal schedule explainers; they funnel to /pregnancy/.
- [ ] Pro candidates (PAYWALL.md): PDF antenatal/birth summary, birth-plan export, insights.
- [ ] Server-side consent hardening (needs Functions/Blaze or rules redesign; see ECOSYSTEM.md).
- [ ] Store distribution (Capacitor; Sign in with Apple, account deletion, push, IAP) per
      ECOSYSTEM.md distribution section.
- [ ] Our Den launch (flip FEATURES.den, SW bump, its own marketing moment) — explicitly later.

## 7. Ground rules (unchanged, apply to all pregnancy work)
- YMYL: every threshold cites its source in pregnancy-data.js; "seek care" never diagnosis;
  disclaimer wherever schedules/danger signs appear; no fabricated reviewers/stats.
- No em-dashes in user-facing copy. Warm, no-guilt tone (fertility + weight especially).
- Free tier only. Bump `app/sw.js` CACHE on any app-asset change. `node --check` + preview
  verify before commit. Don't break production.

## 8. How to resume work on this track
```bash
git checkout pregnancy-tracker
node tools/serve.js          # http://localhost:8080/app/ and /pregnancy/
# build, verify in preview, bump sw.js CACHE, commit to the branch
```
Everything verified as of v2: all journeys, trackers, tools, Moments, consent flows (simulated
two-guardian household), the FEATURES.den flag flip, and the birth transition. No console errors.
