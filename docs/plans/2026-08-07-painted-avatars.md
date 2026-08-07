# Painted avatars: retiring the hand-coded SVG bear

**Date:** 2026-08-07
**Status:** shipped. The 18 portraits and the render path landed in `6161465` (sw v244). The least-used assignment in §2 did **not** land with them and was added afterwards (sw v246); §2 and §3 below are amended to describe what exists rather than what was proposed.
**Scope:** `cubbyBear()` / `memberAvatarSvg()` / `babyBearSvg()` / `journeyBearArt()` / `openBearPicker()` in `app/cubby-extras.js` and `app/index.html`.

---

## 1. What is there today (read, not assumed)

`app/cubby-extras.js:15-87` builds every avatar in the app from ellipses and paths:

```
FURS = ['#C4863F','#9C6B3D','#E0A96D','#6E4E36','#B8843A','#D7B27E','#8C8C8C','#46403A']
ACCS = ['none','glasses','bow','flower','cap','bowtie','headphones','crown']
variantFor(seed) -> { fur: FURS[h % 8], acc: ACCS[floor(h/8) % 8] }
```

Every place an avatar renders, with its box:

| px | selector | where | shape |
|---|---|---|---|
| 16 | `.tl-byav` | timeline "logged by" chip (`app/index.html:2674`) | circle |
| 38 | `.avatar` (inline override) | `app/index.html:3529` | circle |
| 40 | `.ll-mem-av` | circle members list (`app/store-firebase.js:2024`, css at `:168`) | circle |
| 42 | `.avatar` | baby pill in the home header (`app/index.html:360`, `:1759`) | circle + `box-shadow` |
| 54 | `.avatar-lg` | baby profile (`app/index.html:852`, `:3749`) | circle |
| 56 | `.jr-art` | journey relationship tiles (`app/index.html:965`, `journeyBearArt`) | 14px radius, `background:var(--surface-2)` |
| 84 | `#llFrBear` | first-run identity sheet (`app/store-firebase.js:2214`) | circle |
| 110 | `.cu-preview` | the bear picker (`app/cubby-extras.js:363`) | circle + shadow |
| 240 | rasterised, not CSS | keepsake photo canvas (`ensureCharImg`, `app/index.html:9755`) | square, unclipped |

### The two problems in the brief, confirmed

1. **Flat vector.** `cubbyBear()` is circles and paths with a `lighten(fur, .74)` disc behind. The skill's north star is explicit: hand-coded SVG kawaii bears were rejected, "only real painted/illustrated art clears the bar". Every other bear in the product (13 spot-art cubs, ~250 journey cards) is painted.
2. **Clothes.** 6 of the 8 accessories break the locked rule (`bow`, `cap`, `bowtie`, `headphones`, `crown`, and `flower` is borderline). `cap` is literally rendered as a beanie, `headphones` as a headband. The locked rule wants pose and size doing the work instead.

### Three more found while reading

3. **`RELATION_BEAR` breaks the same rule, on a second surface.** `app/index.html:3650-3656` hardcodes `sibling: cap`, `friend: headphones`, `uncle: bowtie`, `mama: bow`, `auntie: bow`. These render at 56px on the journey tiles for anyone who is not yet a circle member. Any fix that only touches `cubby-extras.js` leaves the rule broken here.
4. **Hash-only assignment collides badly, and no amount of art fixes it.** See §2.
5. **The keepsake canvas rasterises the avatar.** `ensureCharImg()` turns `babyBearSvg(b, 240)` into a `data:image/svg+xml` and `drawImage`s it onto the export canvas. Any replacement has to be raster-loadable and **same-origin**, or `toBlob()` on the export taints and keepsake download breaks.

### And one correction to the brief's premise

The brief says the library hand "spans cream through honey, cinnamon, cocoa, and a dusty grey". It does not. Sampling the body fur of ten library images (`046`, `114`, `210`, `211`, `212`, `213`, `214`, `056`, `178`, `hero-cub`) puts every bear in a single narrow band, `#E8D8C0` to `#F8F0E8`: cream-white with warm-grey shading. The only variation is a grey frosting on the grandmother bear's ear rims (`212`) and the fact that `hero-cub.png` is measurably whiter than the library (`#F8F8F0`), which is the known anchor trap.

The tonal range the brief describes is the range of the **existing avatar `FURS` array**, not the library. That distinction drives the whole design: to migrate people without changing their bear, the painted set has to carry tones the painted library has never had. That is a real extension of the hand and needs the founder's yes (§7).

---

## 2. (a) How many portraits: 18

**12 adult portraits + 6 cub portraits.**

### Why art count alone cannot solve collisions

With hash assignment, this is the birthday problem. Probability that a circle of *k* people contains at least one repeated bear, with *N* variants:

| N | k=2 | k=3 | k=4 | k=6 |
|---|---|---|---|---|
| 8 (today) | 12.5% | 34.4% | 58.0% | 89.5% |
| 12 | 8.3% | 23.6% | 42.7% | 77.7% |
| 24 | 4.2% | 12.2% | 23.4% | 49.3% |
| 142 | 0.7% | 2.1% | 4.2% | 10.1% |

Holding a six-person circle under a 10% collision rate needs about **142 distinct painted portraits**. That is unmanageable and it is not the right lever.

### The lever is assignment, not art

Replace the pure hash with **least-used-in-household**: when a member first needs a bear, pick the variant not already taken in `memberInfo`, falling back to the least-used when the set is exhausted. Then a circle of up to 12 adults **never** collides, and 13+ repeats a tone with a different pose. `variantFor(uid)` stays as the seed for tie-breaking and for the offline / no-household case, so the function keeps working before the household doc has loaded.

**Amended 2026-08-07: this was the part that got skipped, and it cost exactly what this section predicted it would.** v244 shipped the art with the hash still in charge, and it was worse than the arithmetic above suggests, because the two derived bits were not independent. `hashStr` is `h = h*31 + c`, so `hashStr(A + B) = hashStr(A) * 31^|B| + hashStr(B)`; 31 is odd, so `31^|B|` is odd, so `hashStr('pose:' + uid) & 1` is just `hashStr(uid) & 1` with a constant flip. The pose salt decorrelated nothing: pose was the parity of the fur index. Measured over 200,000 uids through the shipped `window.cubbyArtFor`, only **six** of the twelve slugs were ever produced, skewed 25 / 25 / 12.5 / 12.5 / 12.5 / 12.5, and two people in a circle matched 18.7% of the time, four people 76.3%, six people 99.0%. The eight flat SVG bears it replaced were 9.1% at four. The fix (sw v246) is the least-used assignment described here, plus one thing this section did not say: the assignment is **written down** the first time it is made, so a person cannot change bear when the circle grows. `tools/avatar_test.js` is the standing measurement.

### So why 12 and 6

- **12 adults** covers the realistic maximum circle with margin: two parents, four grandparents, an aunt or uncle, a nanny or ayah, a doula. There is no member cap in code or in `firestore.rules`, so the ladder has to wrap gracefully, and it does.
- **6 cubs**, one per fur tone. Babies per household is 1 to 3 (twins, siblings), and a baby usually shows a real photo anyway (`babyAvatarSrc` prefers the profile photo, then the first photo ever added; the bear is the fallback). Six is ample and every cub is tone-distinct with no pose axis needed.
- **18 files is the ceiling of what stays consistent.** Six painted fur tones is already the most that read as one hand; twelve would be mud at 40px. The pose axis doubles adults without adding a tone.

---

## 3. (b) How each stays distinct with no clothes

### Shared palette (all 18, taken from the library)

| element | value | note |
|---|---|---|
| linework | `#A08D79` warm grey, fine pencil | never black, never a hard outline |
| shading | warm-grey airbrush, 2 values below the fur | no black, no gloss |
| inner ear | `#C58F76` dusty rose (light tones), `#D2A18B` on Cocoa and Ash | |
| blush | `#E9A79C` at ~35% | both cheeks, soft edge |
| nose | `#4A3F35`; `#33291F` with a pale top highlight on Cocoa | the darkest note on the bear |
| paw pads | `#D9A896` | only where a paw enters frame |

**Banned in the avatar files** (they belong to cards, not to a 40px disc): eucalyptus sprig, sparkles, props, background, baked paper, border, text, and **all accessories including glasses**. Age is carried by fur, not by objects.

### The six fur tones

Chosen for separation in both value and warmth so they survive a 40px circle, and anchored on the existing `FURS` values so migration is near-identity.

| # | name | fur | shade | light tile | reads as |
|---|---|---|---|---|---|
| 1 | Cream | `#F1E4D2` | `#D8C6AE` | `#EDE3D2` | library-true, the default |
| 2 | Oat | `#DCBB8B` | `#BE9A69` | `#F2E7D3` | light tan |
| 3 | Honey | `#C4863F` | `#A66C2E` | `#F6E7CF` | mid amber |
| 4 | Cinnamon | `#9C6B3D` | `#7E5330` | `#F1E2D2` | warm mid brown |
| 5 | Cocoa | `#6B4B33` | `#523829` | `#EDE1D5` | deep brown |
| 6 | Ash | `#9A938C` | `#7E7771` | `#ECE8E2` | warm dusty grey |

A cream bear on a cream tile is exactly how the library already works (`213` is a cream bear on `#F6E8D2` paper and reads perfectly): the warm-grey linework and the cast shadow do the separating, not a colour step. The tile's job is to separate the disc from the white card, not the bear from the disc.

### Adult sculpt vs cub sculpt

**Adult:** head-and-shoulders bust, broader skull, squarer muzzle set lower, ears smaller relative to the head and set wide and low, eyes higher on the face, calm closed-mouth mouth, shoulders entering the bottom of the frame. This is the `211` / `213` big bear.

**Cub:** head fills more of the frame, ears large, round and set high, muzzle short and round, eyes larger and set lower, cheeks fuller with a stronger blush, tiny paws entering the bottom edge. This is the `114` / `212` cub.

### The 12 adults

**Amended 2026-08-07, after the art was generated and looked at. The head-tilt axis did not land.** The plan asked for six tilted B poses and gpt-image returned a bear square to camera every single time, on every retry. All twelve portraits are frontal. The table below is no longer the brief, it is a description of the files that exist in `app/avatars/`, read off them at 540px.

What actually separates A from B:

1. **The eyes, in five of the six pairs.** A has open round eyes, B closes them into crescents: a bear smiling with its eyes. This is the strongest axis in the set and it is doing the job the tilt was meant to do. Oat is the exception, where both are open.
2. **Muzzle-mask contrast.** How pale the muzzle is against the fur, and whether the pale runs up the bridge as a blaze. This is what separates the Oat pair, and it is the marking that survives smallest.
3. **Brow arcs.** Two fine pencil arcs above the eyes, present on most and absent on `av-oat-a` and `av-ash-b`.
4. **Framing.** B sits slightly smaller in the frame with more shoulder showing, and its ears are smaller and set higher. Reads as a different animal at 84px even before the face does.

| slug | tone | eyes | brows | muzzle | other |
|---|---|---|---|---|---|
| `av-cream-a` | Cream | open, round | fine arcs | soft, blends into the fur | ears wide and low, the default bear |
| `av-cream-b` | Cream | crescents | fine arcs | frosted, paler than the fur | stronger blush, ears narrower and higher |
| `av-oat-a` | Oat | open, round | none | soft blaze up the bridge | broad skull, ears wide and low |
| `av-oat-b` | Oat | open, round | fine arcs | pale high-contrast mask | ears smaller and set high, more shoulder |
| `av-honey-a` | Honey | open, round | fine arcs | cream mask | plain chest |
| `av-honey-b` | Honey | crescents | fine arcs | cream mask + blaze onto the forehead | plain chest |
| `av-cinnamon-a` | Cinnamon | open, round | fine arcs | cream mask, high contrast at 40px | cooler brown, ears wide and low |
| `av-cinnamon-b` | Cinnamon | crescents | fine arcs | cream mask, smaller | warmer red-brown, pinker inner ear |
| `av-cocoa-a` | Cocoa | open, round | pale brow dots | broad cream mask | the darkest bear, pale rim light on the silhouette |
| `av-cocoa-b` | Cocoa | crescents | fine arcs | cream mask | pale chest crescent at the bottom edge |
| `av-ash-a` | Ash | open, round | fine arcs | cream mask | warm grey |
| `av-ash-b` | Ash | crescents | none (the crescents carry the brow) | faint cream blaze | cooler, paler grey |

Four markings in the original brief did not land and are not in the files: `av-cream-b`'s silvered ear rims, `av-honey-a`'s chest crescent, `av-honey-b`'s folded ear, `av-cinnamon-b`'s frosted ear rims and `av-ash-b`'s darker ear tips. Cocoa's pale brow dots, `av-cocoa-b`'s chest crescent and the rim light on Cocoa did land, which is the part that mattered: a dark bear with no light marking loses its face at 40px and loses its edge entirely on a night tile (§6).

### The 6 cubs

One per tone. Expression rotates so twins and siblings differ even before the tone does.

| slug | tone | expression |
|---|---|---|
| `cub-cream` | Cream | sleepy, soft crescent eyes |
| `cub-oat` | Oat | open-eyed, curious, head straight |
| `cub-honey` | Honey | giggling, crescent eyes and an open smile |
| `cub-cinnamon` | Cinnamon | calm, closed-mouth smile |
| `cub-cocoa` | Cocoa | surprised, small round mouth, wide eyes |
| `cub-ash` | Ash | content, eyes open, slight tilt |

Distinctness at each size, honestly stated and now measured off the real files rather than predicted: at **84px and 110px** tone, eyes, expression, framing and marking all read. At **40px** tone and muzzle contrast read, and the open-vs-crescent eyes read as a change in the two darkest marks on the face rather than as an expression. At **16px** only tone reads, and that is fine: the 16px chip sits directly beside the person's name.

---

## 4. (c) Adults get adult portraits, the baby gets a cub

`memberAvatarSvg` serves circle members and takes the adult set. `babyBearSvg` serves the baby and takes the cub set.

Why not all cubs:

- Cubby already labels members Mama Bear, Papa Bear, Nana Bear. An all-cub circle contradicts the label the app prints next to it.
- The library already paints the two sculpts side by side (`211`, `212`, `213`) and they are visibly different animals. Using one sculpt for both would be less faithful to the hand, not more.
- A six-person circle of identical cubs reads as a litter, and the baby stops being the special one. The baby is the point.

**Edge case, and it matters:** `journeyBearArt(relation, uid, size)` falls back to `RELATION_BEAR` for relatives who are not circle members. Two of those relations are children. Mapping in §5.

---

## 5. (d) Migration: nobody wakes up as a different bear

### Mechanism

A **read-time** mapping, not a data migration. No Firestore write, no rules change, works offline, idempotent, and safe if an older client is still running (the service worker can serve the previous build for one launch after a deploy, per the comment in `app/sw.js:52-59`).

1. Resolve the person's **current** fur exactly as today: `stored.avatar.fur` if present, otherwise `variantFor(uid).fur`. Do **not** re-hash into the new set; that would change the bear of everyone who never opened the picker.
2. Map that fur to a tone with the table below.
3. Derive the pose from the same `hashStr(uid)`: bit 0 clear means A, set means B. Deterministic, stable, and two people who both map to Cream still differ.
4. When someone picks a new bear, write `avatar.art = '<slug>'` **alongside** the existing `fur` and `acc`. Do not delete the legacy keys until a release where no client can still be running the SVG build.

### The mapping table

| stored fur | today | new variant tone | drift |
|---|---|---|---|
| `#D7B27E` | light tan | **Oat** `#DCBB8B` | negligible, same family |
| `#E0A96D` | light honey | **Oat** `#DCBB8B` | small, slightly less saturated |
| `#C4863F` | mid amber | **Honey** `#C4863F` | none, exact |
| `#B8843A` | amber | **Honey** `#C4863F` | negligible, imperceptible at 40px |
| `#9C6B3D` | cinnamon | **Cinnamon** `#9C6B3D` | none, exact |
| `#6E4E36` | cocoa | **Cocoa** `#6B4B33` | negligible |
| `#46403A` | near-black charcoal | **Cocoa** `#6B4B33` | **noticeable lightening, see below** |
| `#8C8C8C` | neutral grey | **Ash** `#9A938C` | small, warmed to sit in the palette |
| absent or unrecognised | n/a | **Cream** `#F1E4D2`, pose from hash | new members and any unknown value |

Cream is a tone no existing person has. It is the default for new members and the fallback for unrecognised data, which is right: it is the library-true bear.

**The one deliberate change: `#46403A` lightens to Cocoa.** Near-black fur cannot carry this hand. The whole library is light fur with warm-grey pencil linework and no heavy dark masses, and a near-black 40px disc disappears against a night surface. Cocoa is the darkest tone the painted set can hold. Both read as "the dark bear", and the picker lets them change it. Flagging it rather than hiding it.

### Accessories are dropped, and that needs a yes

Anyone currently wearing a beanie, headphones, a bow tie, a crown, a bow or glasses loses it. Fur, and therefore the bear's identity, is preserved. This is the point of the work, but per the standing "no prod removals without OK" rule it is a **visible removal from live users** and needs the founder's explicit yes before it ships. Suggested picker line, house voice, no jargon: *"Bears don't wear things now. Yours is the same bear, just painted."*

### `RELATION_BEAR` remap

`app/index.html:3650-3656`, 56px journey tiles. No new art needed; these map onto the 18.

| relation | today | new slug |
|---|---|---|
| `mama` | `#C4863F` + bow | `av-honey-a` |
| `papa` | `#9C6B3D` + none | `av-cinnamon-a` |
| `nana` | `#D7B27E` + flower | `av-oat-b` (frosted rims read as elder) |
| `grandma` | `#D7B27E` + flower | `av-cream-b` (silvered rims + muzzle frost) |
| `grandpa` | `#8C8C8C` + glasses | `av-ash-a` |
| `auntie` | `#E0A96D` + bow | `av-oat-a` |
| `uncle` | `#6E4E36` + bowtie | `av-cocoa-a` |
| `sibling` | `#E0A96D` + cap | `cub-oat` (a sibling is a child) |
| `cousin` | falls through to `other` | `cub-honey` (a cousin is a child) |
| `friend` | `#B8843A` + headphones | `av-honey-b` |
| `other` | `#C4863F` + none | `av-cream-a` |

Note `cousin` has no key in `RELATION_BEAR` today even though `relKeyFromLabel` implies one. Add it while remapping.

---

## 6. (e) Rendering

### Asset spec

- **`384 x 384` px, square, transparent alpha, WebP quality 82, target 12 to 16KB each.**
- 384 covers every render size at 3x: 110px picker at 3x is 330, 84px at 3x is 252, 40px at 3x is 120, and the 240px keepsake raster draws at up to ~324px on a 1080px export. One size, no `srcset`, no second file to keep in sync.
- 18 files at ~14KB is roughly 250KB on disk, but a household only ever fetches the 2 to 8 it shows.
- **Transparent, not a cream tile.** This is settled by precedent, not preference. The spot-art cubs shipped as RGB with no alpha and rendered as a 132px disc of `#ECDBC5` on `#26201C`, about a **12:1 step with a hard edge**, a headlight rather than a picture (commit `5a13dd9`). A mask only rounds the glare into an orb and a filter fails the art bar, so the paper was cut out of the asset and light puts it back with `--spot-paper`. Avatars take the same shape: cut the paper out, let CSS supply the disc.
- Composition: bear centred inside a circle of **92% of the square**, so nothing clips in the five round frames. The corners must be fully transparent, because `.jr-art` is a 14px-radius square and shows them.

### Where the files live

`app/avatars/<slug>.webp`. The variant table (slug, label, tone hex, light tile hex, kind) lives as a constant in `app/cubby-extras.js`, not as a fetched manifest, so the picker needs no extra request.

**Do not add these to `ASSETS` in `app/sw.js`.** That array is precached atomically on install and the comment is explicit that an offline launch gets the whole build or none of it. Eighteen images would bloat that install for assets most users never see. The existing same-origin cache-first handler picks them up on first fetch and keeps them, which is the correct behaviour here.

### The disc, in both themes

Follow the `--spot-paper` pattern exactly. A per-variant tint set inline as a custom property, resolved by a theme-level token:

```
/* light */  :root{ --av-tile: var(--av-tint); }
/* night */  [data-theme="night"]{ --av-tile: var(--surface-2); }
.bear-av, .ll-mem-av, .tl-byav, .cu-preview { background: var(--av-tile); }
```

with `style="--av-tint:#F6E7CF"` on the element from the variant table. No `!important`, and it matches how the codebase already handles theme-dependent art backing.

**Night numbers.** The night tile `--surface-2` `#2E2722` against a card `--surface` `#26201C` measures **1.09:1**: a well, not a headlight, and the exact opposite of the ~12:1 failure `--spot-paper` was created to fix. A Cream bear `#F1E4D2` on that tile has plenty of separation. The weak case is Cocoa `#6B4B33` on the same tile at **1.87:1**, which is why the Cocoa and Ash files carry a pale rim light and a cream muzzle mask by spec, and why night rendering is a blocking verification item (§8) rather than an assumption.

**Never dim, never filter.** The standing rule applies: art and photos are shown at full brightness and saturation in night. The tile is the only thing that changes.

**Hairline.** Add the discs 40px and larger (`.ll-mem-av`, `.avatar.bear-av`, `.avatar-lg.bear-av`, `.cu-preview`) to the existing `[data-theme="night"]` `outline:1px solid var(--hairline)` list so the disc edge stays legible. Leave `.tl-byav` out: a hairline on a 16px chip is noise.

### The keepsake canvas

`ensureCharImg()` swaps from a `data:` SVG URI to `new Image()` on `/app/avatars/<slug>.webp`. Same-origin, so the canvas stays untainted and `toBlob` export keeps working. **Never serve these from a CDN or a different origin**, or keepsake download breaks silently.

One visible consequence to flag: `drawCharacter` draws the character square and unclipped onto the photo. Today it draws an opaque tinted disc. With a cutout the bear will sit on the photo with no disc behind it, which looks better but is a change to how exports look. Worth a look at the two side by side before shipping.

### Markup

`<img src="/app/avatars/av-honey-a.webp" width="40" height="40" alt="" aria-hidden="true" decoding="async">` inside the existing box. `alt=""` because the person's name is always adjacent, so the image is decorative and a name read twice is worse than a name read once. No `loading="lazy"` on the members list or the header pill: they are above the fold and lazy costs a flicker.

### Fallback

Keep `cubbyBear()` in the file as the last-resort fallback, exactly as the brief already says ("SVG bear is the last-resort fallback"). On `img.onerror`, or when the household is offline before the file was ever fetched, swap in the SVG for that variant's tone with `acc:'none'`. Nothing is ever blank, and the fallback never wears a hat.

### Picker

`openBearPicker` loses the accessory row entirely and becomes a grid of painted thumbnails: 12 for a member, 6 for a baby. Fur swatches go away, since the portrait is the swatch. Keep the 110px preview, keep the existing optimistic 6 second save (`app/cubby-extras.js:176`), keep the `llFrBear` refresh.

---

## 7. Sign-off gates, before any image is generated

1. **The tonal extension.** The painted library is all cream. Six tones from Cream to Cocoa to Ash is a real extension of the hand. It is required by the migration promise, but it is the founder's call.
2. **Dropping accessories from live avatars** (§5), per the no-prod-removals rule.
3. **Two heroes first.** Generate `av-cream-a` and `cub-cream`, get sign-off, then anchor the other 16. This is the skill's own rule and the set will not hang together without it.

---

## 8. Build steps, once the gates clear (not now)

1. Anchor on `art-src/213_baby_grandpa_and_me.png` (adult) and `art-src/114_baby_i_am_one.png` (cub). **Not `art-src/hero-cub.png`**: despite the name it is not the library hand, it measures visibly whiter than the library, and referencing it drifted 52 of 67 cards once already.
2. `art-src/avatar-jobs.json`, batches of 6, generated at 1024 square on the library's cream paper, one prompt per row in §3.
3. Cut the paper out to alpha and downscale to 384. The repo bakes WebP through puppeteer screenshots at quality 82 to 86 (`tools/bake_overlays.js:40`, `tools/compose_cards.js:112`); `omitBackground:true` gives the transparency. A new `tools/bake_avatars.js` following that shape is the least surprising route.
4. Code: variant table and `AVATARS` constant, `memberAvatarSvg` / `babyBearSvg` return `<img>`, least-used-in-household assignment, fur to tone mapping, `RELATION_BEAR` remap, picker rebuild, `--av-tile` tokens, night hairline list, `ensureCharImg` swap, `cubbyBear` demoted to fallback.
5. Bump `CACHE` in `app/sw.js` (currently `little-log-v240`).
6. **Verify, do not assume.** Screenshot at 390px in **both** themes at 16, 40, 56, 84 and 110px, with a six-person circle seeded so all six tones are on screen at once, plus one keepsake export. Cocoa and Ash in night are the shots that decide whether the set ships.
7. Three-surface sync: check the WKWebView wrapper renders the WebPs, and check whether any marketing copy describes the bear picker's accessories.

---

## 9. Open risks

- **Cocoa and Ash in night at 1.87:1.** Mitigated by rim light and cream muzzle in the art spec, but only a render proves it. If it fails, the fallback is to drop Cocoa and ship five tones, remapping `#6E4E36` and `#46403A` to Cinnamon.
- **Six tones may read as six different species** rather than one family. The two-hero gate exists to catch this early.
- **Assignment change alters bears for people who never opened the picker but whose household ordering shifts.** Avoid this by only using least-used assignment for members who have **no** resolvable current bear; everyone existing keeps their mapped tone (§5 step 1). *(Amended: as built, "resolvable" means a stored `avatar.art` or a stored `avatar.fur`, not a uid that happens to hash to something. Anyone who never opened the picker has neither, so they are assigned once and the assignment is persisted; from then on they are in the first group forever. The one-time change for those people is the cost of the fix and is accepted.)*
- **`art-src/` is gitignored and lives only in the main checkout.** Any generation work has to happen there, not in a worktree.
