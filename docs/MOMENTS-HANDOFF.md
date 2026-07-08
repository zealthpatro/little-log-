# Little Cubby — Moments & Milestones · working handoff

**Purpose:** the single source of context for the Moments & Milestones work, so it can continue in a dedicated window. Open a Claude window scoped to the repo `/Users/sauravpatro/Downloads/little-log-pwa`, read this file first, and do only this feature here.

**Repo:** `/Users/sauravpatro/Downloads/little-log-pwa` · **Branch:** `feat/moments-journey-p1` (off `main`; NOT merged yet) · **Prod:** Cloudflare deploys from `main` push; verify on `/app/` (not `/app/index.html`).

---

## 1. What we're building
The **Moments & Milestones** section: a **gentle memory library**, not a checklist. Parents save little moments against beautifully illustrated cards (a 289-card catalogue spanning pregnancy → toddler). Each saved moment holds a photo / note / date / who; it assembles into a shareable scrapbook later (Pro).

**Emotional north star:** *"Here are gentle ideas for memories you may want to save."* NEVER *"milestones your baby should complete."*

---

## 2. Locked decisions
- **Gentle library, not a task board.** No completion bars.
- **Two-layer cards.** Layer 1 = illustration (text-free, 4:5, upper third clear). Layer 2 = caption, rendered as real type by the app/tool — never AI-painted. Founder supplies Layer 1; the compositor bakes Layer 2.
- **Caption type spec:** EB Garamond Medium (or Cormorant Garamond Medium), warm charcoal `#5F534A`, sentence case, British English, top-centre, one caption only. Numbers spelled out; baby's name never baked in. (Full spec: `docs/journey-text-guidelines.md`.)
- **Copy rules (hard):** counts as **"N saved" / "N ideas"**, never "N of M". Say **"Moments"** not "Milestones". **"Save / Capture / Add when ready"** not "Complete".
- **Hand-coded SVG art was rejected** (founder holds a high illustration bar). Real illustration comes from an image model / designer; it drops into the pipeline. Do NOT ship vector "kawaii" bears as the finished look.
- **Personality + custom cards are prompted in the journey too.** "Before you arrived" (pregnancy) shows **only when the baby has pregnancy history** (born-baby default = after birth, no toggle). Custom/journal cards stay blank for the parent to fill.
- **Background palette:** the matrix assigns one muted ground per template (14 palettes); hero ground = warm taupe.

---

## 3. The catalogue (289 cards) — pipeline
- **Source of truth:** `docs/journey-cards.tsv` (founder's production matrix; exported from a sheet — edit the sheet, re-export, re-run the parser).
- **Parser:** `node tools/build_cards.js` → `docs/journey-cards.json` (v2; the catalogue the app reads). Validates columns / unique ids / files.
- **Columns:** `id` (LC-001…) · stage · section · subsection · `caption` · timing · who · illo · mood · `bg` · `template` (T02-T14) · pack · `file`.
- **Sections (= the gentle-library IA):** Before you arrived 54 · Newborn days 35 · Monthly growth 34 · Firsts 51 · About me 35 · With family 25 · Special days 25 · Custom moments 30.
- Characters: Baby cub (203) · Mama + Papa (56) · Family bears (27) · Mama/Papa + cub (3).

---

## 4. Art render loop (Layer 1 → finished card)
1. Founder generates **Layer 1** (illustration only, text-free, 4:5) per the brief, and drops the PNGs into **`art-src/`** (repo root, gitignored), named per the catalogue `file` column (e.g. `095_baby_six_months_old.png`). Non-matching names get mapped/renamed.
2. Run **`node tools/compose_cards.js`** → composes Layer 1 + the caption → `app/journey-art/<slug>.webp` + `app/journey-art/manifest.json` (id → file/caption). Missing art → pastel-ground fallback, so the set is **always complete**.
3. Compositor template: `tools/journey-compose.html` (caption spec baked in). Tools need `puppeteer-core` (`npm i puppeteer-core`) and `NODE_PATH="$(pwd)/node_modules"`.
- **Current state:** all 289 composed as interim **pastel placeholders** (no real art yet). As art arrives, re-running swaps real cards in by filename.

### Art direction for Layer 1 (full brief: `docs/journey-art-brief.md`)
Soft hand-drawn watercolour nursery illustration. Baby **bear cub** (baby cards) + **Mama & Papa Bear** (pregnancy) + family/grandparent bears. Cream-white fur, soft warm-grey shading, fuzzy ears, dusty-rose inner ears/pads, big soft nose, calm minimal face, blush cheeks; small eucalyptus sprig + a few delicate 4-point sparkles; muted pastel ground; 4:5 portrait; flat 2D (not 3D/photoreal); **no text, letters, numbers, or watermark; upper third clear**. Consistency: make one hero cub + one hero Mama/Papa, anchor the rest (Midjourney `--sref`, or 4o "same character/style, change only X").

---

## 5. The section UI to build (gentle library)
Mockup direction (shown in chat; rebuild in `app/index.html`):
- **Header:** "Aanya's moments / Capture the little things, in your own time."
- **Search:** "Search moments, firsts, family…"
- **"Suggested for Aanya right now":** 3–5 age/stage-aware cards, tagged optional, + "Not happening yet? See more for this stage".
- **Browse groups (collapsible, searchable):** Before you arrived (conditional) · Monthly growth · Firsts · About me · With family · Special days · Custom moments. Counts: "N saved" / "N ideas".
- **Card states:** Saved (photo thumb + soft check) · Empty (illustration + "Add when ready") · Suggested (soft tag). No plus-icon overload.
- **Persistent "Create your own moment"** (journaling-style).
- **Tap → moment detail:** card preview · add photo · note · date · who's this from → "Saved to Aanya's scrapbook · View page / Add another".
- Warm/soft light palette (not dark). Loss-safe throughout.

---

## 6. App engine already built (P1, on this branch)
In `app/index.html` + `app/store-firebase.js` (do not rebuild; the simple rail will be **replaced** by the section above, bound to the 289-card catalogue):
- `state.journey` blob (titles, dismissed prompts, relationship captures). **Persistence split:** baby journey → shared app blob (`appBlobFromState`/`applyAppBlob`); pregnancy journey → owner-owned pregnancy doc (privacy). No firestore.rules change needed.
- Prompt generators, capture flow, never-blank rail, loss-safety guards, editable title, relationship capture sheet (`openRelCapture`/`saveRelMoment`) + "add someone" + Together grid.
- XSS-safe onclick (`jArg`), `done`-prompt filtering, relationship tiles gated on handler.
- SW cache bumped along the way (`app/sw.js`, ~v137). **Not merged to main.**

---

## 7. Next steps
**Gentle-library section — BUILT (2026-06-25, on this branch, SW v138). Verified, not yet merged to `main`.**
- New runtime catalogue `app/journey-catalogue.js` (`window.JOURNEY_CAT`), emitted by `tools/build_cards.js`, script-tagged + SW-precached.
- The **Album → "Moments"** tab (was "Milestones") now renders `renderJourneyLibrary()`: header, search, "Suggested for X right now" (age-aware via `glSuggested`/`cardAgeBand`), 7 collapsible baby-stage sections with **"N saved · N ideas"** counts (never "N of M"), card states (saved photo+check / empty "Add when ready" / suggested tag), "Create your own moment", and a moment-detail capture sheet (photo/note/date via the crafted in-sheet `datePicker`/who-chips).
- **Full cutover done:** the old progress ring + "N of M" milestone bands are retired (they broke "no completion bars"). Existing logged milestones are preserved in a gentle "Milestones you've marked" list (no ring); rel "Together" captures + "Add someone special" + pet-firsts toggle kept.
- **Store:** baby moments → `state.journey.saved[babyId][cardId]` → shared app blob (same privacy path as existing baby photos). Loss-safe guard in place.

Remaining:
1. **Art (founder, human task):** generate Layer 1 (hero first) → drop in `art-src/` → run `compose_cards.js`. Until then the 289 cards show pastel placeholders (caption baked in). **The library is live-shaped but should probably wait for real art before a prod merge** (high art bar).
2. **"Before you arrived" (pregnancy, 54 cards) — DEFERRED on purpose.** Its captures are owner-owned and must live in the pregnancy doc, NEVER the shared blob; pregnancy memories already have a home (the pregnancy Moments tab). Wiring it needs the cross-stage owner-owned storage worked out (active-preg `state.pregnancy.journey.saved` vs born-baby archive). Don't fold it into the baby blob.
3. **Prod merge decision (pending founder OK):** branch is committed + pushed but NOT merged to `main`. Don't push pastel placeholders live without a yes.
4. **Later (P2/P3):** scrapbook/book + slideshow export (Pro), packs.

Verify loop used: `node tools/serve.js` + `node tools/probe_moments.js` (seeds a baby, screenshots Moments at 390px) + `node tools/smoke.js`.

---

## 8. Guardrails (must follow)
- **Charter:** calm; run the Anxiety Test on every screen/flow/copy; never a checklist/guilt. (`CUBBY-EXPERIENCE-CHARTER.md`)
- **Loss-safety (charter-critical):** nothing guided while `state.lossHolding` is set; loss archives read-only; never % / streak / "behind".
- **Privacy split:** pregnancy data is owner-owned, never in the shared blob.
- **No third-party trackers; self-hosted fonts.**
- **Customer copy:** warm, brief, 2nd person, sentence case, no em-dashes, British English, numbers humanised.
- **Verify before "done"** (real DOM, computed styles, screenshots at 390px). **Ship to live** (verify → commit → merge `main` → push → confirm on `/app/`).
- **SW-bump hook:** any commit touching `app/*.{js,html,css}` must bump `app/sw.js` CACHE to HEAD+1 (`.githooks/pre-commit` enforces). Pattern: `head=$(git show HEAD:app/sw.js | grep -o "little-log-v[0-9]*" | head -1 | grep -o "[0-9]*"); next=$((head+1)); sed -i '' "s/little-log-v[0-9]*/little-log-v$next/" app/sw.js`.
- **e2e hooks:** `?e2e=1` (seeded) / `?e2e=onboard` (empty owner), localhost-only. In headless they boot empty — seed state in `page.evaluate`.

---

## 9. Key files
- `docs/MOMENTS-HANDOFF.md` — this file.
- `docs/journey-cards.tsv` — the 289-card matrix (source of truth).
- `tools/build_cards.js` → `docs/journey-cards.json` **+ `app/journey-catalogue.js`** — parser + catalogue (re-run after editing the TSV).
- `app/journey-catalogue.js` — runtime catalogue (`window.JOURNEY_CAT`) the gentle library reads.
- `tools/probe_moments.js` — local visual/functional probe for the Moments tab (seed + screenshot).
- `tools/journey-compose.html` + `tools/compose_cards.js` — Layer1+Layer2 → `app/journey-art/*.webp` + `manifest.json`.
- `art-src/` — drop Layer-1 PNGs here (gitignored).
- `docs/journey-art-brief.md` — illustration brief / prompts.
- `docs/journey-text-guidelines.md` — caption typography spec.
- `docs/plans/2026-06-25-memory-system-architecture.md` — broader system (packs, scrapbooks) reference.
- `docs/plans/2026-06-24-moments-journey-p1.md` — the P1 engine build plan.
- `docs/plans/2026-06-24-moments-journey-book-design.md` — original design doc.
- `app/index.html`, `app/store-firebase.js`, `app/sw.js` — the PWA.

---

## 10. Git
On branch `feat/moments-journey-p1`. Latest commit ~`3484816`. Not merged to `main`. When shipping, decide whether to fold the P1 engine in or jump straight to the gentle-library build, then merge to `main` and push (= prod).
