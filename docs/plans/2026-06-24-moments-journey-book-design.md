# Cubby — Moments → Journey: a guided memory journey + shareable slideshow / book

Design doc · 2026-06-24 · status: **approved in principle, refining before build**
Decisions locked with founder:
1. **Write the full spec first** (this doc), then build phase by phase.
2. **Pro boundary = view free, take it Pro.** Viewing a *watermarked / illustrated* preview is free; **download is Pro and share is Pro.** The preview is the taste (no per-export counter).
3. **Moments stays a tab** (no demote) — the guided journey means it is never blank.
4. **Slideshow + digital book first.** *Physical* book = a "register interest" form only (gauge demand; the merch print stream stays parked).
5. **Relationship photo genre** ("the one with Grandma / Grandpa / the aunt") is a first-class prompt type, with **custom bear placeholder art** shown until the real photo is added.
6. **Titles are auto-generated, user-editable.**
7. Build the artifact base **print-ready** so physical can be revived later if enough Pro members convert.

---

## 1. The idea
Turn the pregnancy/baby **Moments** surface from a blank tab into a **guided memory journey**. Cubby *prompts* the moments worth capturing so there is always a gentle next thing, and the captured moments assemble into a **shareable digital slideshow** and a **printable book** to share with family.

- **Pregnancy → "My pregnancy journey":** month-by-month + the bump + each scan + the nursery/kit, anchored to the week ("about the size of an aubergine").
- **Baby → "Baby's first year" (then on):** "Month 1" is a collage of that month's milestones + photos; Month 2, 3 … building a timeline.
- **The payoff (Pro):** the finished slideshow + printable book. Capturing and previewing is free; the assembled, watermark-free artifact is Pro.

This also resolves roadmap **PV1** (the blank Moments tab): the view is never blank because it is a guided journey with prompts.

## 2. Goals / non-goals
**Goals**
- A never-blank, gentle, guided Moments journey for pregnancy and baby.
- Reuse the existing keepsake/memory machinery (do not rebuild canvas/render).
- A clean "capture free, book Pro" boundary using the existing Pro plumbing.
- Loss-safe and charter-safe throughout.

**Non-goals (for now)**
- No physical print fulfilment / shipping (the merch print-on-demand stream is parked). "Book" = an exportable **multi-page PDF / image set**, not an ordered physical book yet.
- No AI image generation. Pages are composed from the family's real photos + logged data only.
- No new photo storage. Journey pages reference existing `photoId`s.

## 3. Reuse map (the build sits almost entirely on existing primitives)
Per-page **canvas composers** (each draws into a passed `<canvas>`, never exports — `composeAny()` dispatches):
- `composeShareCard(canvas,maxW)` (index.html:6156) — the flagship designed page (palette gradient + photo + template caption + stickers + bear). Page types via `MOMENT_TEMPLATES` (classic / big / birthday / stats, :6090).
- `composeMemoryCard(canvas,month,img)` (:7380) + `monthStats(i)` (:7228) — a real-data **monthly summary page** (avg feeds/sleep/nappies + that month's milestones).
- `composePoster` (birth poster), `drawThenNow` (:7500, bump→newborn spread), `drawCollage` (:7553, multi-photo collage) — more ready page types.
- Sizes: `FMT_DIMS` (:6113) — `portrait 1080×1350` = book page, `story 1080×1920` = slideshow slide. `scale = maxW/W` renders the same layout at preview + export res.
- Shared primitives: `paintImage` (treated photo, :6115), `roundRect`, `makeNoise` (grain), `MOMENT_PALETTES` (:6106) + fonts for one cohesive theme, `drawDecor`+`startAnim/stopAnim` (rAF) for an **animated** slideshow.
- Auto-curation: `memoryCandidates()` (:7250) already proposes finished pages (month recap, bump-to-baby, birth poster) — reuse to **auto-assemble a default journey** ("here's a book Cubby made").

Content spines:
- **Pregnancy:** `state.pregnancy.moments[]` = `{id,photoId,week,note,at}` (saveMoment :3791) + `momentSize(week)` from `PREG.weeks[w]` `{size,baby,mum,trimester}` (pregnancy-data.js).
- **Baby:** `MILESTONES` (~225, milestone-data.js) `{key,title,type,domain,cat,mo,band}` = the prompt bank; logged in `state.milestones[]` `{id,babyId,key,achievedAt,note,photoId}`; grouped by `MS_BANDS` (9 buckets) / `MONTH_SLOTS` (`[0,1..12,15,18,24]`); `monthlyMap()` = one-photo-per-month; `monthStats(i)` = the month's numbers + milestones.
- **Photos:** `PhotoStore` (id→dataURL); 4 pools all keyed by `photoId` (pregnancy moments, milestone photos, keepsake gallery + monthly slots, tagged event photos) — referenced, never copied.

## 4. Free → Pro boundary — "view free, take it Pro" (revised; zero entitlement plumbing)
Single truth check `isPro()` (index.html:2698; reads household-wide `window.LL.pro`). The taste is the **preview itself**, viewable unlimited; the gate moves to the two *take-away* actions.

- **Free (the hook):** the whole guided journey — every prompt, capturing photos, in-app month collages, and an **in-app preview of the finished slideshow / book**, rendered with the `drawCubbyFooter` "made with Cubby" **watermark**. You see exactly how lovely it is. Empty prompts show **bear placeholder art** so even an unstarted journey looks finished, not blank.
- **Pro (the take-away):** **Download** the slideshow/book, and **Share** it — both `isPro()`-gated. Pro also drops the watermark and unlocks premium page templates/themes and high-res / print-ready output.

Why this shape (founder's call): a memory book only earns its keep *after* some milestones exist — a "first-week book" is thin. So we never push an export early; we let the journey fill, surface a beautiful watermarked preview whenever the parent looks, and gate only the moment they want to *keep or send* it. Seeing-but-not-yet-having is the conversion loop.

Mechanics (simpler than a taste counter):
- No `PRO_TASTE` entry needed. Gate the two actions directly: `if(!isPro()) return openPro('download');` on Download, same on Share.
- Render the **preview** with `drawCubbyFooter` always-on when `!isPro()` (already the pattern at :6243/7440/7522/7701); render **clean** when Pro.
- Add the book/slideshow to the `openPro` feature list; the Download/Share buttons carry `proTag` (" · Pro ✨") until Pro.
- **Pro is waitlist-only today** (`PRO_CFG.checkoutUrl=''`, `PRO_LAUNCH='August 2026'`): so today Download/Share open "Register for Pro." The free **preview is fully live now** and does the desire-building; when checkout flips on it monetises with no code change.
- **Anxiety Test / charter:** the preview is a gift, never a guilt-trip — no "complete your book," no progress bar, no countdown. A skipped prompt is fine forever.

## 5. New data model (minimal, additive, loss-safe)
One new top-level array, mirroring `state.milestones`/`state.notes` (flat, scoped by id):
```
state.journey = {
  title: { pregnancy?: string, <babyId>?: string },  // auto-generated, user-editable
  pages: [ { id, scope: 'pregnancy' | <babyId>,
             kind: 'month'|'moment'|'milestone'|'relationship'|'cover'|'stats',
             promptKey, photoId, caption,
             relation?,            // for kind:'relationship' — e.g. 'nana' | 'papa' | 'aunt' (drives placeholder art)
             week?, month?, at } ],
  theme: { palette, font },        // one cohesive look per journey
  dismissed: [ promptKey ]         // prompts the user waved off (never nag)
}
```
- Lives in the synced app blob (allowed; not a forbidden key) so the whole circle sees the journey. Photos are referenced by `photoId` (no new storage).
- Prompt **completion** is derived from existing data where possible (a milestone with `achievedAt`, a moment for that week) so we store as little as possible.

## 6. Loss-safety (hard rules — ties to L1)
1. When `state.lossHolding` is set, the journey shows **nothing guided** — mirror `renderLossHolding` (no prompts, no "add the next page," no progress).
2. A `pregnancyArchive` entry with `loss:true` is **read-only keepsake** only — never a prompt, never progress/streaks, never resurfaced as a "continue your journey." (Reuse `openKeptMemories`' treatment.)
3. Never a completion %, streak, or "you're behind." Prompts are gentle invitations; a skipped prompt is fine forever.
4. Pregnancy prompts never assume an outcome ("when they arrive" framing only where already true).

## 7. The surfaces
**A. Moments view → guided journey (free; fixes PV1, stays a tab).** Replace the blank state with a journey grid: a gentle prompt strip + the filled pages so far + a "Preview the journey" button. Prompts come from three banks:
- **Timeline prompts** — pregnancy: "Capture the bump," "Your 20-week scan," month-by-month from `PREG.weeks`; baby: "Month 1," "Month 2"… from `MS_BANDS` / month collages.
- **Milestone prompts** — first smile, first steps… from `MILESTONES`.
- **Relationship prompts** (new, §7.1) — "A photo with Nana Bear," "with Papa Bear," "with your aunt."

Tapping any prompt opens the existing add-moment / add-milestone-photo flow, pre-filled. Moments stays a tab; it is simply never blank now.

### 7.1 Relationship photo genre + bear placeholder art (new)
A whole class of treasured photos is *who the baby is with*, not what they did — "the one with Grandma," "with Grandpa," "with the aunt." We make this a first-class prompt type:
- **Source the people from the real circle.** Each member already carries a warm bear relationship label (Mama/Papa/Nana/Dada Bear… see the circle naming model) — generate a prompt per member ("A photo with Nana Bear"). Offer a small set of common extras the parent can add even if that person isn't in the app (aunt, grandpa, sibling, friend).
- **Custom bear placeholder thumbnails.** Until the real photo exists, the prompt's tile shows a tailored **bear illustration for that relationship** (a Nana Bear, a Papa Bear…), so the grid looks warm and finished, not like empty slots. When the photo is added it replaces the placeholder. (Founder to share reference imagery from existing physical milestone keepsakes; P1 ships tasteful SVG/CSS bear placeholders, art can be upgraded to commissioned illustrations later without code change.)
- Loss-safe: relationship prompts follow the same rules — nothing surfaced while `lossHolding` is set; `loss:true` archives are read-only.

**B. Month collage (free).** Per month: `monthlyMap()[i]` hero photo + `monthStats(i)` milestones → a `composeMemoryCard`-style page, viewable in-app. A month with no real photo yet renders with the relevant placeholder art so the page still reads as designed.

**C. The journey artifact — slideshow first, then digital book.** Assemble an ordered page list (cover → month/scan/milestone/relationship pages → closing) and render each via the existing composers into `FMT_DIMS`. **Build order: slideshow, then digital book.**
- **Slideshow (lead)** = `story 1080×1920` slides + optional `drawDecor` animation. In-app preview is free (watermarked); **download / share are Pro** (§4).
- **Digital book** = `portrait 1080×1350` pages → multi-page **PDF** (Doctor-PDF `window.open`+`print` model, or stitched page images). In-app preview free (watermarked); **download / share Pro**.
- **Physical book = a "register interest" form, not fulfilment.** After a parent previews a book, offer a quiet "Want this printed and posted to you one day? Register interest." It captures demand only (lightweight, privacy-isolated — reuse the newsletter/waitlist capture pattern, not Firestore). This measures whether to revive the parked merch print stream; no shipping, no payment, no address collection now.

## 8. Phasing (build order)
- **P1 (free):** guided Moments journey — timeline + milestone + **relationship** prompts, never-blank with **bear placeholder art**, for pregnancy + baby, reusing add-moment/milestone flows. Resolves PV1. Auto-titled, user-editable.
- **P2 (free):** month collages + the in-app **watermarked preview** of the assembled journey (reuse `composeMemoryCard`/`monthlyMap`).
- **P3:** **slideshow first** (animated, `story` slides), then **digital book** (`portrait` PDF). Preview free + watermarked; **download Pro, share Pro** (`isPro()` gate). Add the **physical-book "register interest"** capture.
- **P4 (later):** premium templates/themes; commissioned relationship illustrations; physical print fulfilment (only if interest-capture justifies reviving the parked merch stream).

## 9. Decisions (locked) + small items still open
**Locked** (founder, 2026-06-24): Moments stays a tab · view-free / download-Pro / share-Pro (no taste counter) · slideshow then digital book · physical = register-interest form only · relationship prompts + bear placeholder art · auto title, user-editable · build print-ready base, physical parked.

**Small items, non-blocking:**
- **Placeholder art fidelity:** P1 ships SVG/CSS bear placeholders; founder to share physical-keepsake reference imagery to inform the P3 page-template look and any commissioned illustrations (P4). Not a blocker for P1.
- **Interest-capture store:** confirm reuse of the existing isolated newsletter/waitlist D1 (recommended) vs a new tiny table.

---
*Reuses: composeShareCard/composeAny/composeMemoryCard/composePoster/drawThenNow/drawCollage, FMT_DIMS, MOMENT_TEMPLATES/PALETTES, paintImage, monthlyMap/monthStats, memoryCandidates, MILESTONES/MS_BANDS, PREG.weeks/momentSize, PhotoStore, isPro/openPro/drawCubbyFooter, circle bear relationship labels. Loss-safe: lossHolding/pregnancyArchive/renderLossHolding/openKeptMemories.*
