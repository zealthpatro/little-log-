# Cubby journey cards — illustration brief (~100 cards, for an image model / illustrator)

**Goal:** a large, consistent set of soft, hand-illustrated "milestone card" artworks for Cubby's Moments journey — covering the **whole story: pregnancy → baby → toddler**, in the spirit of the reference koala milestone cards (soft character, muted pastels, eucalyptus + sparkle accents).

**Two characters, one style:**
- **Baby cub** — a cuddly baby bear, for the baby/toddler cards.
- **Mama Bear** — a soft, gentle, *expecting* mama bear with a round baby bump, for the pregnancy cards. Same fur, palette, linework and softness as the cub; warm, calm, glowing; often with a hand resting on the bump.

**Critical rules:**
1. **NO TEXT in the image** — no words, letters, numbers, or watermark. Captions are added later in code with a crisp script font. **Leave the lower third of the card empty** (just background) for the caption.
2. **Consistency** — generate one hero of each character first, then anchor every other card to it.
3. **Inclusive & gentle** — pregnancy art never assumes the baby's sex (except the explicit reveal cards, which also include a "team green" option). Calm, tender, never anxious.

**Format:** vertical portrait card, **4:5**, ≥1024px short side. The muted pastel background fills the whole card (no border/rounded corners — the app handles those). Flat 2D illustration.

---

## Style anchor A — the baby cub (use for all baby/toddler + relationship cards)

> Soft hand-drawn nursery illustration of a cuddly baby **bear cub**, in the style of a premium baby "milestone card". Rounded fluffy ears with soft fuzzy edges and dusty-rose inner ears, a large soft rounded muzzle and nose, small calm eyes, tiny rosy blush cheeks — a sweet, gentle, minimal face. Cream-white fur with delicate warm-grey soft airbrushed shading for gentle volume, fine soft warm-grey linework, subtle paper-grain texture. The cub is centred in the upper two-thirds; the **lower third is empty background** for a caption. Flat single-colour muted pastel background. A small delicate hand-painted eucalyptus sprig and two or three thin four-point sparkle twinkles as light accents. Calm, tender, wholesome, desaturated palette. Flat 2D children's-book illustration — not 3D, not photoreal, no harsh black outlines, no gloss. **No text, letters, numbers, or watermark.** Vertical 4:5.

## Style anchor B — Mama Bear (use for all pregnancy cards)

> Soft hand-drawn nursery illustration of a gentle **expecting mama bear** with a round pregnant belly, in the same premium "milestone card" style as the baby cub: cream-white fur, soft warm-grey airbrushed shading, fine warm-grey linework, subtle paper-grain, rosy blush cheeks, calm tender face. She is warm and glowing, often with one paw resting softly on her bump. Centred in the upper two-thirds; **lower third empty** for a caption. Flat single-colour muted pastel background, a small eucalyptus sprig and a few delicate four-point sparkles. Desaturated, wholesome, peaceful. Flat 2D children's-book illustration — not 3D, not photoreal, no harsh outlines, no gloss. **No text, letters, numbers, or watermark.** Vertical 4:5.

**Negative prompt (Midjourney):** `--no text letters numbers words watermark 3d photoreal "harsh outline" neon clutter glossy busy`

**Consistency (do this or the set won't match):**
- **Midjourney:** make one hero cub + one hero mama you love, then append `--ar 4:5 --sref <hero URL> --sw 90` to every card of that character. Only change the variation tokens.
- **ChatGPT / 4o:** paste the relevant hero, say *"Same exact character, line weight, shading and palette family. Change only: <pose / expression / accessory / background>. Keep the lower third empty. No text."*
- **Firefly / Ideogram:** use the hero as a high-strength style reference.

---

## Variation tokens

**Baby cub** — pose: peeking over a ledge (head + two paws) · sitting upright · lying sleeping · reaching/standing · crawling. expression: calm · giggling (closed upturned eyes, small smile) · sleeping · surprised (wide eyes, small round mouth). accessory: none · party hat · tiny flower behind ear.

**Mama Bear** — bump size: small (early) · medium (mid) · large (late). pose: hands cradling bump · side profile showing bump · resting/cosy · holding tiny baby shoes · looking at an ultrasound card · packing a little bag · knitting. expression: calm · happy · serene.

**Background (muted, rotate):** sage green · dusty blush pink · warm cream · soft terracotta-coral · dusty rose · soft slate blue · pale butter yellow · soft lilac.
**Accents:** eucalyptus sprig in two corners · scatter of sparkle twinkles · both.
**Relationship cards = two cubs together:** baby cub beside a second bear that reads as the relative (grandmother bear: round glasses + grey bun; grandfather bear: round glasses; auntie: flower; uncle; older sibling cub; cousin cub).

---

## The set (filename → recipe). Name exports by key → drops straight into `app/journey-art/<name>.png`.

### Pregnancy — Mama Bear (~29)
| file | for | pose / bump | bg |
|---|---|---|---|
| `preg-bfp` | we're expecting | holding a tiny pair of shoes, small bump | butter |
| `preg-tri1` | first trimester | cosy resting, small bump | sage |
| `preg-tri2` | second trimester | hands on medium bump, happy | blush |
| `preg-tri3` | third trimester | side profile, large bump | rose |
| `preg-m1` | month 1 | cradling, tiny bump | cream |
| `preg-m2` | month 2 | cradling, tiny bump | sage |
| `preg-m3` | month 3 | hands on small bump | blush |
| `preg-m4` | month 4 | hands on small bump | butter |
| `preg-m5` | month 5 | side profile, medium bump | slate |
| `preg-m6` | month 6 | hands on medium bump | rose |
| `preg-m7` | month 7 | side profile, large bump | sage |
| `preg-m8` | month 8 | cosy resting, large bump | lilac |
| `preg-m9` | month 9 | side profile, very large bump | blush |
| `preg-scan-8` | dating scan | looking at an ultrasound card | slate |
| `preg-scan-12` | 12-week scan | looking at an ultrasound card | sage |
| `preg-scan-20` | 20-week scan | looking at an ultrasound card | blush |
| `preg-heartbeat` | heard the heartbeat | hand on bump, small heart sparkle | rose |
| `preg-kick` | first kick | surprised-happy, hand on bump | butter |
| `preg-bump` | the bump | proud side profile, medium bump | sage |
| `preg-shower` | baby shower | bump + a little bunting/balloon | coral |
| `preg-nursery` | nursery ready | beside a tiny crib | cream |
| `preg-bag` | hospital bag packed | packing a small bag | slate |
| `preg-maternity` | maternity shoot | serene, flowers around bump | rose |
| `preg-names` | choosing a name | thoughtful, holding a little tag (blank) | lilac |
| `preg-reveal-blue` | reveal (boy) | bump + soft blue accents | slate |
| `preg-reveal-pink` | reveal (girl) | bump + soft pink accents | blush |
| `preg-greenteam` | team green | bump + green/yellow accents | sage |
| `preg-countdown` | almost here | cosy, very large bump, calendar-free | butter |
| `preg-overdue` | any day now | resting, very large bump | cream |

### Baby months (~16) — baby cub
`bmonth-0` Newborn (lying, sleeping, cream) · `bmonth-1`..`bmonth-12` (rotate pose/expr/bg; `bmonth-12` sitting giggling + party hat, coral) · `bmonth-15` · `bmonth-18` · `bmonth-24` (party hat). Keep palettes varied and muted.

### Baby firsts / milestones (~32) — baby cub
| file | first | pose / expression |
|---|---|---|
| `bms-smile` | first smile | peeking, giggling |
| `bms-laugh` | first laugh | giggling |
| `bms-babble` | first babbles | calm, open mouth |
| `bms-rollover` | rolled over | lying, giggling |
| `bms-sit` | sat up | sitting, surprised |
| `bms-crawl` | crawling | crawling pose |
| `bms-standhold` | pulled to stand | standing holding a ledge |
| `bms-cruise` | cruising | standing, reaching |
| `bms-steps` | first steps | standing, surprised |
| `bms-words` | first words | giggling |
| `bms-wave` | first wave | one paw up |
| `bms-clap` | first clap | paws together, giggling |
| `bms-peekaboo` | peekaboo | paws at face |
| `bms-tooth` | first tooth | giggling, one tooth |
| `bms-foods` | first foods | sitting, little bowl/spoon |
| `bms-selffeed` | self-feeding | holding a spoon |
| `bms-cup` | first cup | holding a sippy cup |
| `bms-bath` | first bath | in a little tub with bubbles |
| `bms-haircut` | first haircut | calm, tiny scissors motif |
| `bms-swim` | first swim | in a float ring |
| `bms-shoes` | first shoes | looking at little shoes |
| `bms-point` | first point | one paw pointing |
| `bms-blowkiss` | blows a kiss | paw to mouth |
| `bms-dance` | first dance | arms up, joyful |
| `bms-climb` | first climb | climbing pose |
| `bms-run` | first run | mid-stride |
| `bms-scribble` | first scribble | holding a crayon |
| `bms-blocks` | stacks blocks | with little blocks |
| `bms-hug` | first hug | hugging a soft toy |
| `bms-sleepthrough` | slept through | sleeping peacefully |
| `bms-potty` | potty | proud, calm |
| `bms-default` | any first | sitting, giggling |

### Relationships (~11) — two bears together
`rel-mama`, `rel-papa`, `rel-nana`, `rel-grandma`, `rel-grandpa`, `rel-auntie`, `rel-uncle`, `rel-sibling`, `rel-cousin`, `rel-friend`, `rel-other` (baby cub beside the relative bear; affectionate; lower third empty).

### Special / seasons / holidays (~12)
`bday` (party hat + confetti, coral) · `bday-half` (half birthday) · `first-festival` (warm lanterns/lights, generic) · `first-holiday` (little suitcase) · `first-winter` (cosy scarf, snow dots) · `first-summer` (sun hat) · `first-rains` (tiny umbrella) · `welcome-home` (cub in a basket) · `family` (mama + papa + cub) · `firsttooth-fairy`? skip · `bmonth-default` (peeking, calm, cream) · `journey-cover` (cub + mama together, for the journey cover).

**Total ≈ 100 cards.** Start, if you like, with the heroes (one cub, one mama) + `preg-tri2`, `preg-bump`, `bmonth-0`, `bmonth-6`, `bmonth-12`, `bms-smile`, `rel-nana`, `bday` to confirm the set hangs together before doing the rest.

---

## What I do when you send art / specs back
- Drop files into `app/journey-art/` (PNG→WebP, ~16KB each).
- Overlay captions in-app in the empty lower third with the self-hosted script font (crisp; any caption on any card).
- Wire the manifest; map every journey prompt → its card (pregnancy prompts get expanded to use the monthly/bump/scan set; baby prompts map to month/milestone/relationship cards); a real photo replaces the card once added; SVG bear is the last-resort fallback.
- Send me your final specs (exact bg hex palette, caption font + size + colour, aspect, band vs no-band) and I'll match them precisely.

---

## Related: the birth poster

The poster's own furniture and its seven animals are a separate, smaller set in the same hand, and
they have different constraints (square, one isolated object, pure white ground so `multiply` can
key it out, no numerals). Brief and prompts: [`docs/poster-art-brief.md`](poster-art-brief.md) and
the runnable [`docs/poster-art-jobs.json`](poster-art-jobs.json).
