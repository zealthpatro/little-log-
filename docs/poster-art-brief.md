# Birth poster art — brief and prompts

Every painted piece on the birth poster: the seven animals a parent can choose between, the five
bits of furniture they can turn on and off, and the four stat icons. Sixteen pieces.

The prompts live next door in **`docs/poster-art-jobs.json`**, which is a runnable jobs file, not a
transcript. It is here and not in `art-src/` because that whole directory is gitignored (it holds
the API keys), so until now the only record of how this art was made was the art itself.

```sh
node tools/gen_art.js --jobs docs/poster-art-jobs.json --engine openai   # regenerate all sixteen
node tools/gen_art.js --prompt "..." --out art-src/poster_x.png --engine openai --aspect 1:1
```

Generation costs real money on both engines and is not covered by any consumer plan. Regenerate one
piece, look at it, then decide — do not re-run the whole file to fix one thing.

Bake the raw PNG down to what actually ships:

```sh
cwebp -q 82 -resize 640 640 art-src/poster_x.png -o app/poster-art/poster_x.webp
```

Raw PNGs stay in `art-src/` and out of the repo (~1MB each). Only the 640px webp ships, and the
whole set is about 400KB.

---

## The style spine

Every prompt in the set carries the same closing instructions, and they are doing real work:

> Soft hand-drawn watercolour nursery illustration in a calm children's picture-book hand. Warm muted
> palette. Fine delicate linework, soft airbrushed shading, subtle paper grain. Flat 2D, not 3D, not
> photorealistic, no harsh black outlines, no heavy saturation, no gloss. One isolated object,
> centred, with generous empty margin. **Set on a plain pure white background**, no ground shadow, no
> vignette, no coloured backdrop. **No text, no letters, no numbers**, no watermark, no border, no frame.

Three of those clauses are not stylistic preference and must survive any edit:

**Pure white background.** gpt-image-2 **refuses transparent output** (400, "Transparent background is
not supported for this model", checked 2026-08-09). The poster composites these with `multiply`
instead, which drops white entirely and warms the marks into whatever the paper is doing underneath.
That is also why they sit on the gradient without banding. A piece generated on cream, or with a
drop shadow, or with any backdrop, arrives on the poster as a visible pasted rectangle. The one
exception in the codebase is the original hero cub, which is painted on its own cream and therefore
needs the feathering path in `composePoster` — that path exists because of this, not by choice.

**No numerals.** The scale shows tick marks and no dial numbers, the clock has tick marks and no
numerals, the calendar is a blank grid with a small heart on one cell. Painted numbers would sit
next to the parent's real numbers and read as a contradiction.

**Generous empty margin.** `art()` draws each piece to a given width and derives its height from the
image's own aspect. A subject that fills its frame draws far larger than the layout expects.

## Per-style tinting

The pieces are painted once in warm neutrals and tinted per poster style at draw time, using the
`color` blend at 0.55 alpha — **not** a colour wash. `color` keeps each pixel's luminosity and takes
only hue and saturation, so white stays exactly white and the `multiply` still keys it out
completely. Partial alpha so a bunting keeps some of its own variety instead of going monochrome.
Cached per piece per style, because the preview redraws on every tap.

Before this, warm pink bunting on the cool papers (elephant, panda) read as a clash rather than an
accent.

## The sixteen pieces

| Key | File | Role |
|---|---|---|
| `animal_bear` | `poster_animal_bear.webp` | default; it is Cubby |
| `animal_bunny` `animal_fox` `animal_elephant` `animal_deer` `animal_panda` `animal_lamb` | `poster_animal_*.webp` | the other six choices |
| `garland` | `poster_garland.webp` | bunting across the top |
| `balloons` | `poster_balloons.webp` | top right |
| `cloud` | `poster_cloud.webp` | top left |
| `stars` | `poster_stars.webp` | full-width scatter behind the middle |
| `sprig` | `poster_sprig.webp` | two eucalyptus sprigs, lower corners |
| `icon_cal` | `poster_icon_cal.webp` | the date |
| `icon_clock` | `poster_icon_clock.webp` | the time |
| `icon_scale` | `poster_icon_scale.webp` | the weight |
| `icon_tape` | `poster_icon_tape.webp` | the length |

The animals sit upright, facing forward, full body, **with no clothes, hat, bow or collar** — that
negative is explicit in every animal prompt because the model reaches for a party hat unprompted, and
a poster that already carries bunting and balloons does not need one more.

## Two things learned the hard way

**Ask for a scatter and you may get a subject.** The first "stars" prompt ("a loose scatter of about
seven tiny sparkles") came back as a single hot-air balloon, centred, filling the frame. The reroll
that shipped names a count, spreads it across the whole square, and spends a whole sentence on
negatives: *"ONLY stars and sparkles. Absolutely no balloon, no hot air balloon, no animal, no plant,
no object of any kind, no central subject, nothing in the middle of the frame."* When a piece is
meant to be texture rather than a thing, say that it has no centre.

**`app/poster-art/poster_hotair.webp` is that mistake, kept.** It is a genuinely nice painted balloon,
it ships, and nothing loads it — it is not in `POSTER_ART`. There is deliberately no prompt for it in
the jobs file, because the prompt that made it asked for stars and recording it would be a lie about
how to reproduce it. Either place it as furniture or drop the file; do not leave it half-alive
indefinitely.

## Do not

- **Do not add these to the service worker precache.** They are only needed the moment somebody makes
  a poster, and an offline launch should not carry 400KB of decoration. `loadPosterArt()` is lazy and
  fail-soft: a missing piece means less furniture, never a broken poster.
- **Do not anchor these to `art-src/hero-cub.png`.** Despite the name it is *not* the journey
  library's hand (see the journey-art notes) and referencing it drifts the whole set. If you need a
  reference for a new poster animal, use `poster_animal_bear.png`.
- **Do not judge drift at thumbnail size.** The cream ground flatters everything small. Zoom in.
