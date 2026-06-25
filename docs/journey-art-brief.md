# Cubby journey cards — illustration brief (for an image model / illustrator)

**Goal:** a consistent set of soft, hand-illustrated "baby milestone card" artworks for Cubby's Moments journey, in the spirit of the reference koala milestone cards (soft character, muted pastels, eucalyptus + sparkle accents).

**Critical rule — NO TEXT in the image.** Do not render any words, letters, numbers, or watermark. Captions are added later in code with a crisp script font. **Leave the lower third of the card empty** (just background) so the caption has a clean home.

**Format:** vertical portrait card, **4:5** aspect, ≥1024px on the short side. The pastel background colour fills the whole card (it *is* the card) — no border, no rounded corners (the app rounds them). Flat 2D illustration.

---

## Master style prompt (use as the anchor for every card)

> Soft hand-drawn nursery illustration of a cuddly baby **bear cub**, in the style of a premium baby "milestone card". Rounded fluffy ears with soft fuzzy edges and dusty-rose inner ears, a large soft rounded muzzle and nose, small calm eyes, tiny rosy blush cheeks — a sweet, gentle, minimal face. Cream-white fur with delicate warm-grey soft airbrushed shading for gentle volume, fine soft warm-grey linework, subtle paper-grain texture. The cub is centred in the upper two-thirds; the **lower third is empty background** for a caption. Flat single-colour **muted pastel background**. A small delicate hand-painted eucalyptus sprig and two or three thin four-point sparkle twinkles as light accents. Calm, tender, wholesome, desaturated palette. Flat 2D children's-book illustration — not 3D, not photoreal, no harsh black outlines, no gloss. **No text, letters, numbers, or watermark.** Vertical 4:5.

*(Swap "bear cub" for "koala" if you'd rather match the reference exactly — Cubby's mascot is a bear, so bear keeps brand, but the soft style is the same either way.)*

**Negative prompt (Midjourney):** `--no text letters numbers words watermark 3d photoreal "harsh outline" neon clutter glossy busy`

**Consistency (do this or the set won't match):**
- **Midjourney:** generate one hero card you love, then append `--ar 4:5 --sref <URL of that hero image> --sw 90` to every other prompt. Keep the same `--style` and the same wording; only change the variation tokens below.
- **ChatGPT / 4o images:** generate the hero, then for each new card paste the hero and say *"Same exact character, line weight, shading and palette family as this image. Change only: <pose / expression / accessory / background colour>. Keep the lower third empty. No text."*
- **Firefly/Ideogram:** use the hero as a style reference / structure reference at high strength.

---

## Variation tokens (swap these per card)

- **Pose:** peeking over a ledge (just head + two little paws) · sitting upright · lying down sleeping · reaching up
- **Expression:** calm · giggling (closed upturned eyes, small smile) · sleeping (closed eyes) · surprised (wide eyes, small round open mouth)
- **Accessory:** none · small party hat · tiny flower behind one ear
- **Background colour (muted):** sage green · dusty blush pink · warm cream · soft terracotta-coral · dusty rose · soft slate blue · pale butter yellow
- **Accent motif:** eucalyptus sprig in two corners · a scatter of sparkle twinkles · both

**Relationship cards = two cubs together:** the baby cub beside a second cub that reads as the relative — *grandmother bear (round glasses + soft grey bun)*, *grandfather bear (round glasses)*, *auntie bear (flower)*, *uncle bear*, *older sibling cub*. Affectionate, same style, lower third empty.

---

## The set to generate (filename → recipe)

Name each export by its key so it drops straight into the app (`app/journey-art/<name>.png`; I convert to WebP). Palettes are suggestions — keep them muted and varied.

| filename | what it's for | pose / expression | accessory | bg |
|---|---|---|---|---|
| `bmonth-0`  | Newborn        | lying, sleeping        | none   | cream |
| `bmonth-1`  | 1 month        | peeking, calm          | none   | sage |
| `bmonth-2`  | 2 months       | sitting, calm          | none   | blush |
| `bmonth-3`  | 3 months       | peeking, giggling      | none   | butter |
| `bmonth-4`  | 4 months       | sitting, surprised     | none   | rose |
| `bmonth-5`  | 5 months       | peeking, calm          | none   | slate |
| `bmonth-6`  | 6 months       | sitting, giggling      | none   | sage |
| `bmonth-7`  | 7 months       | peeking, calm          | none   | blush |
| `bmonth-8`  | 8 months       | sitting, surprised     | none   | cream |
| `bmonth-9`  | 9 months       | peeking, giggling      | none   | butter |
| `bmonth-10` | 10 months      | sitting, calm          | none   | rose |
| `bmonth-11` | 11 months      | peeking, calm          | none   | slate |
| `bmonth-12` | 1 year         | sitting, giggling      | party hat | coral |
| `bmonth-15` | 15 months      | reaching, calm         | none   | sage |
| `bmonth-18` | 18 months      | sitting, giggling      | none   | blush |
| `bmonth-24` | 2 years        | sitting, giggling      | party hat | butter |
| `bms-smile`    | first smile    | peeking, giggling      | none   | butter |
| `bms-tooth`    | first tooth    | giggling (show one tooth) | none | blush |
| `bms-sit`      | sat up         | sitting, surprised     | none   | sage |
| `bms-steps`    | first steps    | reaching/standing, surprised | none | coral |
| `bms-words`    | first words    | giggling               | none   | slate |
| `bms-rollover` | rolled over    | lying, giggling        | none   | rose |
| `bms-default`  | any first      | sitting, giggling      | none   | butter |
| `bmonth-default` | any month    | peeking, calm          | none   | cream |
| `rel-nana`     | with grandma   | baby + grandma bear    | flower | rose |
| `rel-grandma`  | with grandma   | baby + grandma bear    | flower | rose |
| `rel-papa`     | with papa      | baby + adult bear      | none   | slate |
| `rel-grandpa`  | with grandpa   | baby + grandpa bear (glasses) | none | sage |
| `rel-auntie`   | with auntie    | baby + auntie bear     | flower | blush |
| `rel-uncle`    | with uncle     | baby + uncle bear      | none   | butter |
| `rel-sibling`  | with sibling   | baby + older sibling cub | none | cream |
| `rel-other`    | with someone   | two cubs hugging       | none   | sage |
| `bday`         | birthday       | sitting, giggling      | party hat + confetti | coral |

That's 33 cards (the full current journey set). If you only want to start with a few, do the hero + `bmonth-0/1/6/12`, `bms-smile`, `rel-nana`, `bday` — enough to see the set hang together.

---

## What I do once you send art / specs back
- Drop the files into `app/journey-art/` (I convert PNG→WebP, ~16KB each).
- Overlay the caption in-app with the self-hosted script font, positioned in the empty lower third (so text is crisp and every card can carry any caption).
- Wire the manifest + map each journey prompt to its card, photo replaces the card once added, SVG bear as last-resort fallback.
- Tell me your final specs (exact bg hex palette, caption font + size + colour, card aspect, whether captions go on a soft band) and I'll match them precisely.
