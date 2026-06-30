# Moments & Milestones — Plan & Status

The single source of truth for the Moments content + structure. Sprint-agnostic: we plan
from here, not batch-to-batch. (Build context lives in `MOMENTS-HANDOFF.md`; tiers in
`journey-tiers.json`.)

_Last organized: 2026-06-30. Live: gentle library + 71 real watercolour cub cards, SW v145._

---

## 1. The card model — TWO types

- **SINGLE moment** — one photo / note / date, captured once. The default.
  _First tooth, First steps, Hello world, One month old._  ✅ works today.
- **COLLECTION** — one card that holds **many** captures over time and grows into a little
  album (shows a count + a stacked-photo look). For relationships and anything **recurring**.
  _With Mama, Diwali, Birthdays._  🔧 **needs build** (small: a `collection` flag + multi-capture in the moment sheet; the relationship-photo feature already does multi-capture today).

**Why this matters (less-is-more):** collections collapse ~40 thin, arbitrary cards into a
handful of meaningful ones that *deepen for years*. Fewer cards, more capturing.

---

## 2. Status by section

| Section | total | core / nice / filler | single / collection | art done |
|---|---|---|---|---|
| Before you arrived (pregnancy) | 54 | 46 / 0 / 8 | 54 / — | 1* |
| Newborn days | 35 | 30 / 0 / 5 | 35 / — | 8 |
| Monthly growth | 34 | 23 / 0 / 11 | 30 / 4 | 24 ← **year 1–12 done** |
| Firsts (the heart) | 51 | 49 / 2 / 0 | 51 / — | 31 |
| About me | 35 | 16 / 0 / 19 | 35 / — | 6 |
| With family | 25 | 25 / 0 / 0 | → **6 collections** | 0 |
| Special days | 25 | 22 / 3 / 0 | 14 / 11 | 1 |
| Custom moments | 30 | — | — / 30 | 0 |
| **TOTAL** | **289** | **211 core** | | **71 done** |

\*We also have ~20 pregnancy couple illustrations made (not yet mapped/baked to cards).

---

## 3. Decisions locked

- **Skip the 43 filler — never generate, hide from the live library:** months 13–23, daily
  newborn (1–5 days old), and the vague About-me ("I am brave", "I had a grumpy day", "Today
  I surprised everyone"). Keeps it calm (Charter / Anxiety Test).
- **Teething = one "First tooth".** Don't track all 4 teeth — the *moment* is celebrated, the
  *count* isn't (same trap as the 13–23 months).
- **With family 25 → 6 collections:** With Mama · With Papa · With Grandma · With Grandpa ·
  With siblings · Our whole family. Keep the true one-time events as singles: First family
  photo, First sibling moment, First time meeting Grandma/Grandpa, First video call.
- **Recurring = collections:** festivals (Diwali, Christmas, Eid, Holi, Onam, Rakhi,
  Thanksgiving, Halloween, New Year) and birthdays — capture every year, the card grows.
- **Gap to add:** **First potty** (genuinely celebrated, currently missing).
- **Pregnancy "Before you arrived"** is deferred from the live baby tab (owner-owned privacy);
  surface it on the pregnancy Moments tab — separate wiring pass.

---

## 4. Generation roadmap (in journey order, core only)

Done ✅: pregnancy hero (We found out) · first year 1–12 · the iconic firsts.

Next, by track:
1. **Cub solo — remaining Firsts** (~20): I ran · climbed · first kiss · made a friend ·
   first book · first shoes · first beach · first road trip · first flight · first daycare ·
   first artwork · first medicine · first vaccine · first fever · **first potty (new)**.
2. **Cub solo — About-me "I love"** (~10): love bath · story · nap · music · being outside ·
   my blanket · my teddy · Mama · Papa.
3. **Parent + cub** (~10, parent bear in frame): first cuddle with Mama · with Papa ·
   first family photo · going home · + the 6 relationship collection illustrations.
4. **Recurring collections** (~10 illos): the festivals + birthdays.
5. **Pregnancy couples** (~25): map the ~20 already made, then the rest (kicks, scans, bump,
   telling family, countdown).

Effective remaining unique illustrations ≈ **120–130** (collections + skipping filler cut it
well below the 218 placeholders).

---

## 5. Build tasks (code)

- [ ] **Multi-capture** — `collection` flag; collection cards hold many moments (count + stack).
- [ ] **Catalogue restructure** — collapse With-family → 6 collections; tag festivals/birthdays
      as collections; add **First potty**; mark the 43 filler hidden from the live library.
- [ ] **Pregnancy surface** — wire "Before you arrived" onto the owner-owned pregnancy tab.
- [ ] (done) tiering, single-card bake (`JOURNEY_ONLY`), `gen_art.js`, the skill.

---

## 6. How we work (the loop)

I hand you a **detailed batch** (master style block + per-card scenes, in order) → you generate
10 in ChatGPT and **download in order** → say **"done"** → I pull from Downloads, map, bake, and
ship. Skip filler. Collections get one illustration each, not one per moment.

---

## 7. Pregnancy countdown — "Before you arrived" (LIVE)

Pregnancy is **anchored to the due date** and reads as a **countdown** (unlike baby, which counts
up from birth). Built on the **owner-owned** pregnancy Moments tab (`state.pregnancy.journey.saved`,
synced via the pregnancy doc — never the shared baby blob). `renderPregLibrary()` mirrors the baby
library but: catalogue `stage=Pregnancy`, suggested-now = cards near the current gestational week
(`pregWeek()`), groups = the three phases, current phase open. "For you right now · N weeks to go."

**Three phases (≈46 moments + a bump collection):**
- **The secret** (1st tri, wk 5–13): We found out · Two little lines · First doctor visit · First
  ultrasound · We heard your heartbeat · We told Mama / Papa · And then there were three.
- **Telling & feeling** (2nd tri, wk 14–27): We announced you · First bump photo · First kick ·
  Halfway there · Gender reveal (boy / girl / team green) · You kicked for Mama/Papa · 100 days to go.
- **The countdown** (3rd tri, wk 28–40) — *the most emotional stretch*: We chose your name · Baby
  shower · Maternity shoot · Nursery is ready · 50/30/10 days to go · Hospital bag · Last bump photo ·
  **Our final days as two · Ready to meet you · Due date**.

**Bump = a collection** (capture each month) → replaces the 9 "N months pregnant" cards (needs the
multi-capture build; placeholder singles for now).

**Status:** library live + due-date countdown wired; **20 couple illustrations baked** (discovery →
shower → nursery → countdown); ~25 remaining to generate (kicks, scans, telling family, the final
countdown), in week order.
