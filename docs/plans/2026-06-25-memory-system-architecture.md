# Cubby — "Little Cub Memory System" architecture

Design note · 2026-06-25 · supersedes the card-count scope in the earlier journey docs (engine + pipeline from [moments-journey-p1] still stand). Status: **proposed, for sign-off.**

## 1. The shift
Moments → Journey becomes a **scrapbook-first memory system**: a story across the whole journey (pregnancy → newborn → first year → toddler → family), not a folder of cute cards. ~265 cards organised into **chapters**, surfaced calmly in-app, and assembled into shareable **scrapbooks** (the Pro book/slideshow).

## 2. Two architectural keystones

### 2a. Modular illustration system (generate parts, compose cards)
Do **not** illustrate 265 cards from scratch. Generate a small **parts inventory** and recombine:
- **Characters/poses:** ~20 baby-cub poses, ~10 Mama Bear, ~10 Papa Bear, ~10 family/couple.
- **Accessories:** ~40 (star, moon, eucalyptus, rattle, blocks, party hat, crib, pram, suitcase, photo frame, ultrasound, booties, towel, speech bubble, hearts, lantern…).
- **Backgrounds:** ~12 muted grounds.
- **Text layer:** ~12 caption/journal layouts.

A card = **background + pose(s) + accessory + text layout + caption**. Full inventory: `docs/journey-parts.json`. This keeps style consistent, cost low, and makes new cards nearly free.

### 2b. One matrix is the spine
`docs/journey-cards.json` (the **production matrix**) is the single source of truth. Each card row = `key · caption · pack · chapter · who · pose · accessory · bg · layout · file`. It drives, simultaneously:
- the **in-app collapsible journey** (chapters → sections → cards),
- the **card composition** (which parts + text to stack),
- the **scrapbook / book export** (chapter order + page layouts).

### 2c. Text is a separate layer (confirmed)
AI illustration layer (text-free) + **app-overlaid caption** in the self-hosted script font. Clean spelling, localisation, the baby's name, free "Today I…" journaling, and illustration reuse. (See [feedback_illustration_quality_bar], [moments-journey-book-design].)

### Composition decision (recommended): **compose in-app from parts.**
Ship the ~100 parts; the app stacks background + pose + accessory + text per the matrix and renders the card on the fly. Alt = pre-flatten each card to a webp via the gen tool. In-app composition is the premium, scalable path (infinite cards, custom cards, perfect text); pre-flatten is simpler but rigid. **Going with in-app composition unless overridden.**

## 3. Packs (commercial split)
| Pack | Cards | Scrapbook |
|---|---|---|
| Pregnancy Journey | ~60 | "Before You Arrived" |
| Newborn & First Year | ~100 | "My First Year" |
| Toddler Year Two | ~50 | "My Second Year" |
| Family & Memory | ~55 | "Family Memories" |

Pro gates the **export** (book/slideshow) and premium packs; capturing + in-app viewing stays free (the "view free, take it Pro" rule from [moments-journey-book-design]).

## 4. Card categories (~265)
Pregnancy ~60 · Birth/Newborn ~35 · Monthly 0–24 ~30 · Developmental firsts ~50 · Personality/everyday ~35 · Family/relationships ~25 · Custom/journaling ~30. Full list in the matrix. Includes the **hard days** ("first fever", "I was brave today", "a hard day we got through") — handled with care: gentle, optional, never forced, loss-safe.

## 5. Scrapbooks → chapters → page layouts
- **Before You Arrived:** We Found Out · Growing You · Waiting for You · Welcome Little Cub.
- **My First Year:** Newborn Days · Months 1–3 · 4–6 · 7–9 · 10–12.
- **My Second Year:** Finding My Feet · My Voice · My World · Becoming Me · I Am Two.
- **Family Memories:** Mama & Me · Papa & Me · Grandparents · Festivals · Travel · Love Notes · Funny Moments.

**Page layouts (the book templates):**
- A — Full milestone (1 card + 1 big photo): monthly, birthdays, announcements.
- B — Story spread (1 card + 3 photos + journal box): first kick, bath, steps, word.
- C — Timeline (several small cards in a row): pregnancy months, newborn first days.
- D — Letter (large journal card + parent note): "A note from Mama", "Dear baby".
- E — Keepsake (photo + pocket): test, scan, hospital bracelet, first lock of hair.

## 6. Calm in-app, rich underneath (charter)
265 cards is a *library*, not a wall. The app stays calm via the IA already designed: a small **age/stage-aware "for now" row** + **collapsible, searchable chapter sections**. No streaks, no completion guilt; a skipped card is fine forever. Loss-safety unchanged (nothing guided during `lossHolding`; loss archives read-only). The scale lives in the catalog, not in the parent's face.

## 7. How it stitches to what's built
- **Engine (built, P1):** state, capture, prompts, manifest, SVG fallback, loss-safety — unchanged; it already reads cards by key with photo-replaces-on-add.
- **New:** `journey-parts.json` (inventory) + `journey-cards.json` upgraded to the full matrix + an **in-app card composer** (bg+pose+accessory+text) + the **collapsible chapter IA** + (P3) the **scrapbook export** using layouts A–E.

## 8. Phasing
- **P1 (done):** guided journey engine + manifest + fallback.
- **Content:** generate the ~100 parts (anchored to the two heroes) → `journey-parts.json`.
- **P2:** in-app card composer + collapsible chapter journey + journaling/blank cards (free).
- **P3 (Pro):** scrapbook/book + slideshow export (layouts A–E, chapter order), pack gating, physical "register interest".
- **P4:** Figma/Canva editable templates, physical print, premium packs.

## 9. Open decisions
1. **Composition:** in-app from parts (recommended) vs pre-flattened webps.
2. **Generate the full ~265 matrix now**, or refine the parts inventory first?
3. **Pack pricing/split** — confirm the four packs as the Pro structure.
4. **Custom cards** = prompted journaling (recommended) vs plain blank.
