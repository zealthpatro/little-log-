# Mapping an illustration → catalogue card

Goal: given an illustration (one the founder made, or one we generated), decide which
catalogue card(s) it belongs to. The catalogue is `docs/journey-cards.json`; every card
carries fields that tell you what its picture is *supposed* to be — use them, don't eyeball.

## Why metadata beats vibe

Many cards look similar (lots of cream cubs; several couple-with-something pregnancy cards).
Matching on "cute bear → some baby card" produces wrong, low-quality mappings. Each card
instead gives you four disambiguating signals:

- **`illo`** — a sentence describing the intended picture (props, pose, who). This is the
  strongest signal; match the *content* of the image to it.
- **`bg`** — the assigned background palette (e.g. "muted sage", "dusty blush"). If the art's
  ground matches the card's `bg`, that's strong corroboration.
- **`who`** — `cub` / `mamapapa` / `family` / `mama_cub` / `papa_cub`. A two-adult-bears image
  can't be a solo-cub card.
- **`section`** + **`timing`** — narrows the life stage (pregnancy vs newborn vs a specific
  month vs anytime).

Match on the **intersection** of these, not any one alone.

## Procedure

1. **Describe the image objectively**: characters (how many bears, adult vs cub, any
   accessory), the key prop (ultrasound, glowing orb, spoon, party hat…), pose, mood, and the
   **background colour**. Note where the empty caption space is (should be the top third).
2. **Filter the catalogue** by the obvious facts: `who` (count the bears), `section`/`stage`
   (pregnancy vs baby), and roughly `timing`.
3. **Rank the survivors** by how well their `illo` text matches the prop/pose, then break ties
   with `bg` (does the ground colour match?) and `mood`.
4. **Assign confidence.** High = `illo` + `bg` + `who` all line up. Low = generic image that
   fits several cards equally. **Flag every low-confidence match for the founder to confirm** —
   never force a weak one.
5. **Shared illustrations are expected.** One good "any first" cub can back several "firsts"
   cards. Record one source file → several card slugs; the bake step copies it to each.
6. **Output a review table** before baking: `source file | what I see | card id + caption |
   section | bg match? | confidence`. Let the founder glance and correct.

## Worked example

**Image:** two cream bears sitting close, the left one with a small pink bow, cradling a soft
**glowing orb of light** between their paws. **Muted sage-green** ground, eucalyptus sprigs +
coral buds, sparkles, top ~45% empty.

- Objective read → 2 adult bears (a couple) + glowing orb, sage ground, tender mood.
- Filter → `who: mamapapa`, `section: "Before you arrived"` (pregnancy).
- Rank → `LC-001 "We found out"` whose `illo` is *"mama and papa bear sitting close together,
  looking at a tiny glowing star between their paws"* and whose `bg` is **"muted sage"**.
- Confidence: **high** — `illo` (glowing star between paws), `bg` (sage), and `who` (couple)
  all line up. A naïve matcher might call the glow a "heartbeat" card, but that card's `illo`
  and `timing` don't fit — the metadata rules it out.

**Contrast:** a similar couple image holding a black-and-white **ultrasound scan** is NOT
LC-001 — it maps to the **first-scan** beat (its `illo` references an ultrasound), even though
both are "couple + pregnancy". The prop in `illo` is what separates them.

## After mapping

Rename/copy each source PNG to the catalogue `file`/`slug` name in `art-src/`, then run
`tools/compose_cards.js` to bake captions and produce `app/journey-art/<slug>.webp`. Verify in
the app with `tools/probe_moments.js` at 390px (see SKILL.md Leg 3).
