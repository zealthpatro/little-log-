# Cubby cards — text & typography guidelines

The caption on every card is a **text layer**, not painted by the image model. Generate the illustration text-free (leave the caption zone clear), then set the caption from the catalogue's `caption` column with the rules below. This guarantees correct spelling, identical type across all 289 cards, and lets you localise or personalise later.

## To the image model (before it generates)
> Leave the caption area clear and **do not draw any text, letters, numbers, or watermark.** Keep the illustration to the lower / central area so the upper third stays open for a caption.

## Typeface
- **Caption face:** one soft classic serif, one weight, on every card. Recommended: **Cormorant Garamond (Medium)** or **EB Garamond (Medium)** — EB Garamond is sturdier at small sizes. Matches the keepsake/wordmark feel.
- **Brand wordmark** ("Little Cubby") may use a higher-contrast display serif (e.g. Playfair Display) — captions do **not**.
- Do **not** use a script/handwriting font for captions — it's hard to read small. (Script is fine only for the wordmark.)

## Case & spelling
- **Sentence case** always: first word capitalised, rest lower — except proper nouns (Mama, Papa, Nana, Diwali, Eid, Holi, Onam, Rakhi, Christmas…). Never Title Case, never ALL CAPS on a card caption.
- **British English:** favourite, colour, etc.
- Keep apostrophes exactly ("It's a boy", "Today's little story"). Use the catalogue text **verbatim** — don't paraphrase.

## Numbers
- **Spell numbers out:** "Six months old", "One year old", "100 days to go" stays as written in the catalogue. Never bake digits into the art, and no dates/weights/measurements baked in — those are journaling fields the parent fills.

## Size, colour, placement
- **Colour:** warm charcoal-brown ink `#5F534A` (or `#6B5E51`). Never pure black. Check it stays legible (AA contrast) on each pastel ground.
- **Size:** caption ≈ 7–9% of card height; same size for all cards in a template so a stack reads as a set. A 1-word caption may be a touch larger.
- **Placement:** centred, in a consistent zone (top-centre, as in the board), illustration below — **never overlapping** the art. Keep ≥8% margin from every edge.
- **Line-breaking:** break on natural phrase boundaries into balanced lines, max ~3 ("We heard / your heartbeat"). No hyphenation, no single-word orphan lines.

## Do / don't
- **One caption only** per card — no subtitles, taglines, dates, page numbers, or watermark.
- **Never bake the baby's name** into a card — the name is personal and added in-app.
- **Journaling cards (Custom & Journal, "Today I…", notes):** caption at top, keep the writing area **blank** (soft guide lines only) so parents fill it.
- Keep margins and the caption baseline identical card-to-card.

## Easiest way to stay consistent
Build one **Figma/Canva master** with the caption as an editable **paragraph style** (face, size, colour, leading set once), then duplicate per card and paste the `caption` value from the catalogue. (Or let the Cubby app overlay it from the catalogue — same `caption` string, self-hosted serif.) Either way the letters are real type, never AI-approximated.
