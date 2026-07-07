# Moments & Milestones — Plan & Status

The single source of truth for the Moments content + structure. Sprint-agnostic: we plan
from here, not batch-to-batch. (Build context lives in `MOMENTS-HANDOFF.md`; tiers in
`journey-tiers.json`.)

_Last organized: 2026-07-02. Live: gentle library + 91 real watercolour cards, Caveat-700 captions
+ arch card shape, and the **best-in-class utility ladder v150–v155**: iOS filter bake fixed
(colour-matrix; presets/B&W were dead on iPhone), 43 filler cards hidden + custom prompts
collapsed + art-alias variants, saved moments bridge into the keepsake studio ("Make a keepsake"),
photo-prep step (crop/pan/pinch + Warm film / Soft matte / Gentle B&W presets) at the moments /
bump / relationship uploads, watercolour bear-art overlay tiles in the studio, photo-orphan GC +
1MiB sync guard + video export gate + collage watermark + fully self-hosted background cutout._

**Designed follow-ups (not yet built):**
- **Pregnancy keepsakes**: pregnancy moments deliberately have NO "Make a keepsake" — the studio's
  save-to-gallery writes the SHARED household gallery and would leak an owner-private photo. Needs
  an owner-private save path first.
- **Pregnancy photo bytes**: the pregnancy journey RECORD is owner-owned, but its photo BYTES live
  in the shared `photos` collection (circle-readable via rules; no UI shows them). Real fix needs a
  `priv` flag + rules + a query-side split (rules aren't filters — the unbounded photos listener
  would error). Do together with the rules pass.

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

---

## 8. The keepsake OUTPUT — frameable collection boards (the payoff)

The journey doesn't end at captured cards — it **assembles into frameable, name-personalised
boards**, in the spirit of the physical "My First Year" milestone frames (the wooden/acrylic
month-grid boards, "One Year of Anaya"). This is the emotional payoff + the Pro/merch hook.

**Themed frameable collections** (each = a collection that auto-renders into a poster in the
watercolour-bear style, with the baby's name in script + soft motifs):
- **My First Year** — Newborn + the 1–12 month photos in a grid + name (the canonical board).
- **My First Expressions** — first smile, laugh, surprised, giggle, sleepy.
- **My First Actions** — first steps, crawl, wave, clap, peekaboo.
- **My Firsts** — the milestone firsts.
- **Before You Arrived** — the pregnancy countdown rendered as a board.

**Engine already exists:** the canvas composers (`composePoster` / `composeMemoryCard`, portrait
`FMT_DIMS`, `MOMENT_PALETTES`, `drawDecor`) + the monthly cards render these from pieces we have.

**Flow + gating (existing model):** capture moments → they assemble into the board → **view free**
(watermarked preview) → **download + share = Pro** → **physical print = the delighter** (print-on-
demand the board as a real frame, shipped — the parked merch stream; build the artifact print-ready
now, ship later; address from checkout, photos-to-printer per-order opt-in for privacy).

**Dependency order (locked):** collections → frameable boards → physical print. A board IS a
collection rendered — you can't frame what you can't collect.

### 8a. Pages → Scrapbook (the full model)

Each keepsake is a **page**; the pages assemble into a **growing scrapbook** (the digital book —
the artifact that doesn't exist yet). Page types:

- **Birth collage / birth stats** — hero baby photo + parents photo + name (script) + the stats
  (date, time, weight, length, blood group, hospital, place). **Auto-assembles** from data Cubby
  already holds (birth date, weight/length from growth, the newborn photo); the parent just confirms
  + adds a couple of fields. This is the strongest page because it's *almost no work* — the Charter.
  (Engine: `composePoster` already exists for the birth poster.)
- **My First Year** — Newborn + 1–12 month grid + name.
- **My First [X]** — open-ended themed pages: First trip · First activity · First foods · First
  holiday · First costumes · expressions · actions · **My First Travels** (the travel-firsts set:
  car ride · car seat · pram · carrier · train · bus · auto-rickshaw · taxi · boat · bicycle,
  LC-290–299 added 2026-07-03; ferry folded into boat, metro into train) · etc. Each = a
  collection rendered as a page.
- **People / "Meet…" collections** (the baby's *village* — who loves me): Meet the family · Meet
  Mama's friends · Meet Papa's friends · Meet my friends. Each = a growing album of the people in
  the baby's world. Seeds from the existing relationship-photo feature ("a photo with Nana Bear")
  and the circle members; multi-capture is essential here (many faces over time).

So the scrapbook = a book of these pages, each auto/assembled from moments + logged data, in the
watercolour-bear style. **Build order:** collections → page templates (Birth collage first — it
auto-fills) → the scrapbook container → share/download (Pro) → physical print (delighter).

### 8b. Caption type + card shape (fixed)

Card captions are baked in **Caveat 700** (warm handwriting, **bolder + bigger** — base ~66–70px,
scales down for long captions), self-hosted + injected as base64 by `compose_cards.js` and awaited
before screenshot — the old CDN `@import` raced the render and baked a plain fallback (it "killed
the vibe"). Handwriting matches the keepsake references (names always hand-lettered). #5F534A,
top-centre. The thinner 600/52 was "off character, just plain text" — 700/bigger reads present.

**Card shape = arch top** (the keepsake-frame look, like the "My First Year" boards). Applied in
app CSS on `.gl-card` (`border-radius:50% 50% 16px 16px / 16% 16% 5px 5px`) — the illustration domes,
the caption footer stays flat. Badges (saved-tick, "optional" tag) live at the **bottom** corners so
the dome never clips them. This shape carries into the keepsake boards / scrapbook pages.

---

## 9. Experience review (2026-07-03) — keepsake list ✓, payoff loop is the gap

Two-agent review (UX walkthrough + keepsake completeness vs market): **the keepsake TYPE list has
no wrong bets** — all 8 live outputs are table stakes done well or genuine differentiators (the
data-fused memory card and auto-filled birth poster are the moat), and §8/8a's order (collections →
boards → birth collage → scrapbook → print) matches the market's winning "auto, zero-work" pattern.

**Fixed same day (v163):** dead "Add someone special" flow (capture now opens on pick; pending
people = tappable tiles; finished tiles get view/keepsake/replace/remove); keepsake nudge at save
time; gallery newest-first; prep "Keep it exactly as it is".

**The build list that falls out (priority order):**
1. **Keep the originals** (HIGH): every upload discards the full-res file — 1200px q0.8 is the ONLY
   copy; monthly slots destructively bake text at 800px. Boards/scrapbook/print need clean, bigger
   sources. Fix = store an `orig` copy (bounded ~2000px) alongside the display copy + stop baking
   text into stored monthlies (compose at render).
   **PARTIAL v168:** monthly slots now NON-DESTRUCTIVE (clean 1440px stored, `clean:true` flag,
   stamp composed at view/download; prep step wired, old baked entries grandfathered). Poster
   exports 3360×4704 (~213 DPI at 40×60, iOS-cap-safe) + Share button + honest copy. Watercolour
   hero cub fills poster slot when no photo + memory-card panel. Monthiversary card waits 14 days.
   Remaining for full #1: orig copies on the OTHER upload paths (moments/bump/rel/studio).
2. **"What you've captured" view + collections**: no aggregate saved-moments view exists; nothing
   composes moments together. This is the assemble stage of the loop — collections (multi-capture)
   then the first board (My First Year) then Birth collage (auto-fills).
3. **Owner-private keepsake path for pregnancy** (also unblocks bump-photo download — today a
   mother cannot get her own bump photos out at all).
4. **Home surfacing**: saved moments never reach the home hero or the circle's attention; a gentle
   "recently tucked in" cue closes the family-delight half of the loop.
5. **Poster print-res** (truthful-copy: "scales to 40x60" is ~85 DPI today; export at 4-5x scale).
6. **Letters/audio to the future child** — missing keepsake type, most charter-aligned delighter.
7. Later: grandparent no-app web view per keepsake; monthiversary card should wait, not expire in
   24h; stats share template review (comparison-anxiety risk on social).
