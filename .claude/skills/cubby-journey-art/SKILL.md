---
name: cubby-journey-art
description: >-
  Generate, ingest, map, and bake the Moments gentle-library card illustrations
  (the 289-card journey catalogue) for the Cubby / little-log-pwa app. Use this
  WHENEVER the task touches the journey/moments card ART: creating new bear-cub
  or Mama/Papa-Bear illustrations, dropping illustrations into art-src/, matching
  art to catalogue cards, regenerating app/journey-art, judging the art bar, or
  anything about Nano Banana / Gemini image / OpenAI image generation for these
  cards. Reach for it even if the user just says "the bear cards", "the journey
  art", "the moments illustrations", or pastes a sample illustration to match.
---

# Cubby journey-card art

This skill drives the **art pipeline** for the Moments gentle library — the 289-card
journey catalogue whose cards are soft watercolour bear illustrations with a caption
baked in by code. It covers generating art, ingesting art the founder already made,
mapping each illustration to the right catalogue card, and baking finished cards.

**North star:** these are *keepsakes*. The founder holds a **high illustration bar** —
hand-coded SVG/vector "kawaii" bears have been explicitly rejected as not good enough.
Only real painted/illustrated art (image model or designer) clears the bar. Never grind
out vector and pass it off as the finished look.

## The art bar (what "good" means here)

Soft hand-drawn **watercolour nursery** illustration. Cream-white **bear cub** (baby/toddler
cards) and a gentle **Mama / Papa Bear** (pregnancy cards). Fuzzy ears with dusty-rose inner
ears, soft rounded muzzle, calm minimal face, rosy blush cheeks; warm-grey airbrushed shading,
fine linework, subtle paper grain; a small eucalyptus sprig and a few delicate 4-point sparkles;
muted pastel ground. Flat 2D children's-book feel — not 3D, not photoreal, no harsh outlines.
The full brief + per-character style anchors + the de-duplicated card list live in
[`docs/journey-art-brief.md`](../../docs/journey-art-brief.md) — read it before generating.

**Hard art-direction rules (these make the set correct, not just pretty). Several are the
founder's own LOCKED production rules — honour them exactly:**
- **No clothes on the bears — EVER.** Locked rule, verbatim: *"The bears should not wear
  clothes, outfits, dresses, sweaters, cardigans, shirts, hats, or bows."* No bow on mama
  by default either (it became repetitive). Bare fur reads cleaner and more timeless.
- **Distinguish Mama / Papa / cub by POSE and SIZE, not clothes:** *Mama bear — slightly
  smaller, round pregnant belly when needed, gentle nurturing posture. Papa bear — slightly
  larger, protective posture. Baby cub — smaller, rounder, softer proportions.*
- **No text in the image** — no words, letters, numbers, or watermark. Captions are rendered
  later in code so one illustration can back many captions.
- **Leave the TOP third empty.** The compositor places the caption top-centre (verified in the
  app), so reserve clear background up top. (Note: the older brief says "lower third" — the
  app uses **top**; trust the app.)
- **No baked border or rounded corners** — the app rounds the card itself; a baked frame
  double-frames.
- **Pregnancy art stays sex-neutral.** No pink/blue cues on the universal pregnancy cards —
  the sex isn't known and the charter requires calm neutrality. Only the explicit reveal cards
  carry colour (and they include a team-green option).
- **One consistent character.** Generate ONE hero cub + ONE hero Mama/Papa first, get them
  approved, then anchor every other card to the hero so the whole set looks like one hand.

**Founder's production method (proven, in ChatGPT / gpt-image — match it for consistency with
the existing ~50 images):** generate in **batches of 10**, one batch per catalogue beat
(pregnancy discovery → newborn days → monthly growth → firsts → about me → with family →
special days → custom). Each image = one card concept with a short scene (e.g. *"First cuddle
with Mama — mama bear holding newborn cub"*). Name files by concept (`newborn_hello_world.png`,
`newborn_first_cuddle_mama.png`, …) so they map straight to catalogue rows. The existing set
was made in ChatGPT, so to EXTEND it seamlessly prefer the same engine; Gemini/Nano-Banana is
for fresh sets anchored by a reference image.

## The loop (four legs)

Work through these in order. Legs 2–3 work right now; leg 1 (generating) needs an engine
with credit — see Leg 0.

### Leg 0 — engine setup (do this once; it's the only blocker)

Image generation is **not free**, and this trips everyone up: the consumer subscriptions
(**Google AI Pro**, **ChatGPT Plus**) do **NOT** include API access. The API is billed
separately. So a valid key can still return `429 RESOURCE_EXHAUSTED / check billing`.

The key lives in a gitignored file (never in chat, never committed):
`art-src/gemini.key` or `art-src/openai.key`.

Check status cheaply before generating:
```
node tools/gen_art.js --check --engine gemini    # or --engine openai
```
- `✅ key valid AND quota available` → generate freely.
- `⚠️ valid but no quota` → the user must enable **Gemini API billing** (Google Cloud billing
  on the key's project) or add **OpenAI prepaid credit**. ~$0.04/image; the full set ≈ $4.
- `❌ invalid` → re-paste the key.

**Browser fallback (free, uses the subscriptions they already pay for):** the Gemini app
(gemini.google.com) and ChatGPT app DO include image generation. If the API has no credit and
the user prefers $0, drive the browser (Chrome MCP / computer-use) into the app, generate with
the prompts below, and download the PNGs into `art-src/`. Slower and hands-on, but free.

### Leg 1 — generate (when an engine is live)

Use `tools/gen_art.js`. **Gemini ("Nano Banana") is preferred** because it keeps the SAME
character across cards when you pass a reference image.

Heroes first (get sign-off before scaling — respect the art bar):
```
node tools/gen_art.js --engine gemini --prompt "<hero cub prompt from the brief>" --out art-src/hero-cub.png --aspect 4:5
node tools/gen_art.js --engine gemini --prompt "<hero mama prompt from the brief>" --out art-src/hero-mama.png --aspect 4:5
```
Then anchor the rest to a hero with `--ref` ("same exact character/style, change only the
pose/prop/background; keep the top third empty; no text"):
```
node tools/gen_art.js --engine gemini --ref art-src/hero-cub.png --prompt "...first smile, peeking, giggling..." --out art-src/bms-smile.png
```
Batch many at once with a job list:
```
node tools/gen_art.js --engine gemini --jobs art-src/jobs.json
# jobs.json = [ { "out":"art-src/124_baby_i_smiled.png", "prompt":"...", "ref":"art-src/hero-cub.png" }, ... ]
```
`--dry-run` prints the request and sends nothing (free preview of what will be generated).

**Don't generate 289 files** — many cards share one illustration (a generic "any first" cub
backs several "firsts"). Generate the ~100 de-duplicated illustrations from the brief, then map
several card ids to one file in Leg 2.

### Leg 1b — OR ingest art the founder already made

If the user drops illustrations into `art-src/` (any filenames), skip generation. Open and
**look at every image**, then go to Leg 2 to map them.

### Leg 2 — map illustrations to catalogue cards

Each catalogue card in [`docs/journey-cards.json`](../../docs/journey-cards.json) carries
`illo` (a text description of the intended picture), `bg` (palette), `who` (cub / mama+papa /
family), `section`, and `timing`. **Match by cross-referencing those fields, not by vibe** —
the metadata disambiguates lookalikes. Full methodology + a worked example:
[`references/mapping.md`](references/mapping.md). Flag low-confidence matches for the user to
confirm; never silently force a weak match.

The app reads art by filename: card `LC-xxx` shows `app/journey-art/<slug>.webp`, where `slug`
is in the catalogue. So mapping = giving each source PNG the right catalogue `file`/`slug`
name (or, for shared illustrations, copying one source to several slugs) in `art-src/` before
baking.

### Leg 3 — bake + verify

```
node tools/compose_cards.js          # art-src/*.png + captions -> app/journey-art/*.webp + manifest.json
node tools/serve.js &                 # serve the repo on :8080
node tools/probe_moments.js /tmp/moments.png 390   # seed a baby + screenshot the Moments tab at phone width
```
Then Read the screenshots and judge the cards in context (caption legible over the top third,
character consistent, no double-frame). `tools/compose_cards.js` needs `puppeteer-core`
(`npm i puppeteer-core`) and `NODE_PATH="$(pwd)/node_modules"`. Missing art falls back to a
pastel ground, so the set is always complete. Re-run after dropping new art — real cards swap
in by filename. Then ship per the repo's normal flow (SW bump → commit → main → confirm live).

## When to stop and ask

- The hero look — always get the founder's sign-off on the two heroes before generating the set.
- Low-confidence card matches — confirm rather than guess.
- Any spend — confirm before enabling billing / topping up credit.

## Key files
- `tools/gen_art.js` — the generator (Gemini + OpenAI, ref-image mode, batch, `--check`, `--dry-run`).
- `docs/journey-art-brief.md` — full brief, style anchors, de-dup card list, per-card prompts.
- `docs/journey-cards.json` — the 289-card catalogue (`illo`/`bg`/`who`/`timing` drive mapping).
- `tools/compose_cards.js` + `tools/journey-compose.html` — bake Layer-1 art + caption → webp.
- `tools/serve.js` + `tools/probe_moments.js` — local serve + 390px screenshot of the Moments tab.
- `references/mapping.md` — how to map an illustration to the right card.
- `docs/MOMENTS-HANDOFF.md` — the broader Moments feature context.
