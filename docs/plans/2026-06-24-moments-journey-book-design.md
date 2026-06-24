# Cubby — Moments → Journey: a guided memory journey + shareable slideshow / book

Design doc · 2026-06-24 · status: **proposed, awaiting approval (no build yet)**
Decisions locked with founder: **(1) write the full spec first**, **(2) Pro boundary = capture free, the assembled book/slideshow is Pro.**

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

## 4. Free → Pro boundary (zero entitlement plumbing needed)
Single truth check `isPro()` (index.html:2698; reads household-wide `window.LL.pro`). Gate **at export only**, never at create/view (Cubby's "try before you buy" rule).

- **Free:** the whole guided journey — prompts, capturing, in-app month collages, an in-app flip-through preview, and **one free book/slideshow export** (a "taste"), which carries the `drawCubbyFooter` "made with Cubby" watermark (the referral loop).
- **Pro:** unlimited exports, **watermark-free** pages, premium page templates/themes, and the printable/high-res book.

Mechanics (mirror the Doctor-PDF / Then&Now precedents):
- Add `book:1` to `PRO_TASTE` (:2708). Gate the export with `if(!useTaste('book','Memory book')) return;`; `refundTaste('book')` in the catch on render failure.
- Per page, call `drawCubbyFooter` inside `if(!isPro())` (already the pattern at :6243/7440/7522/7701).
- Add the book to the `openPro` feature list; label the entry with `proTag('book')` (" · 1 free" → " · Pro ✨").
- **Pro is waitlist-only today** (`PRO_CFG.checkoutUrl=''`, `PRO_LAUNCH='August 2026'`): a Pro book ships now as a *tease* — the free taste works immediately, then exhausted users hit "Register for Pro." When checkout goes live it monetises with no code change.

## 5. New data model (minimal, additive, loss-safe)
One new top-level array, mirroring `state.milestones`/`state.notes` (flat, scoped by id):
```
state.journey = {
  pages: [ { id, scope: 'pregnancy' | <babyId>, kind: 'month'|'moment'|'milestone'|'cover'|'stats',
             promptKey, photoId, caption, week?, month?, at } ],
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
**A. Moments view → guided journey (free; fixes PV1).** Replace the blank state with a journey grid: a gentle prompt strip ("Capture the bump," "Month 1," "Your 20-week scan") + the filled pages so far + a "Preview the journey" button. Pregnancy prompts from `PREG.weeks`; baby prompts from `MS_BANDS`/month collages. Tapping a prompt opens the existing add-moment / add-milestone-photo flow, pre-filled from the prompt.
*(PV1 nav decision: keep Moments reachable but it is no longer ever blank. Whether it stays a 5th tab or becomes a Week-home card is a small sub-decision — see Open Questions.)*

**B. Month collage (free).** Per month: `monthlyMap()[i]` hero photo + `monthStats(i)` milestones → a `composeMemoryCard`-style page, viewable in-app.

**C. The journey artifact (Pro export).** Assemble an ordered page list (cover → month/scan/milestone pages → closing) and render each via the existing composers into `FMT_DIMS`:
- **Slideshow** = `story 1080×1920` slides, optional `drawDecor` animation, an in-app flip-through (free preview) and an exported reel/image set (Pro / free-taste).
- **Book** = `portrait 1080×1350` pages exported as a multi-page **PDF** (follow the Doctor-PDF `window.open`+`print` model, or stitch page images). Watermark-free for Pro.

## 8. Phasing (build order, once approved)
- **P1 (free):** guided Moments journey (prompts + never-blank) for pregnancy + baby, reusing add-moment/milestone flows. Resolves PV1.
- **P2 (free):** month collages + the in-app flip-through preview (reuse `composeMemoryCard`/`monthlyMap`).
- **P3 (Pro):** the export — slideshow (animated) + book (PDF), gated `book:1` taste → Pro, watermark on free.
- **P4 (later):** premium templates/themes; physical print fulfilment (only if the parked merch stream is revived).

## 9. Open questions for sign-off
1. **PV1 nav:** keep Moments as a tab (now never blank) **or** demote to a Week-home card + 4-tab nav? (Founder originally said demote; this feature makes "never blank" the better fix — confirm which.)
2. **Slideshow vs book first** in P3 — slideshow is lighter (canvas + rAF, share a reel); the book is the PDF. Which leads?
3. **Free-taste size:** `book:1` (one free export) vs `book:2`. One matches Then&Now; two is more generous pre-launch.
4. **Cover/title:** auto ("Aanya's first year") vs user-titled.
5. Confirm "book" = exportable **PDF/image set** for now (no physical shipping) is acceptable.

---
*Reuses: composeShareCard/composeAny/composeMemoryCard/composePoster/drawThenNow/drawCollage, FMT_DIMS, MOMENT_TEMPLATES/PALETTES, paintImage, monthlyMap/monthStats, memoryCandidates, MILESTONES/MS_BANDS, PREG.weeks/momentSize, PhotoStore, isPro/PRO_TASTE/useTaste/openPro/drawCubbyFooter. Loss-safe: lossHolding/pregnancyArchive/renderLossHolding/openKeptMemories.*
