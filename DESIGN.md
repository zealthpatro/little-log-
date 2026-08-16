# Cubby design guide & audit (the design anchor)

> **Status (June 2026):** This design system is live across the merged, shipped Cubby (one app spanning Trying → Expecting → Baby → Child); the tokens, type ramp, icon language and the audit's shipped fixes are all in production. Full current state + go-live plan: HANDOFF.md.

> **Scope: this document is the APP (`/app/`).** Its tokens live in `app/index.html :root`. The
> public marketing site is a separate system with its own tokens in `site.css` under `.homex`, and
> its own anchor: **`design/MARKETING-SYSTEM.md`**. Do not mix the two palettes or type ramps; they
> share names (`--ink`, `--h-ink`) and different values.

This is the single source of truth for how Cubby looks and feels, in three parts:
**Part A** the design system as it should be (the anchor), **Part B** the audit of what's right
and wrong today (10 June 2026, audited at 375/600/768/1280px), **Part C** the recommended
changes, prioritized, awaiting a go/no-go per item.

---

# Part A — The design system (anchor)

## A1. Personality
Cubby is a **warm den**: calm, soft, private, never clinical, never gamified. Cream and
honey tones, a bear motif, rounded everything, gentle copy (no guilt, no alarm, no em-dashes).
Every screen should feel like a tidy nursery at golden hour, not a medical dashboard.

## A2. Color tokens (canon, already implemented in `app/index.html` `:root`)
The app's token set is the canonical palette. Light / dark:

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F4EEE3` | `#1A1614` | page background (with grad-1/grad-2 wash) |
| `--surface` | `#FFFFFF` | `#26201C` | cards, sheets |
| `--surface-2` | `#FBF7EF` | `#2E2722` | nested/secondary surfaces |
| `--ink` | `#2C2521` | `#F0E7DB` | primary text |
| `--ink-soft` | `#6E635B` | `#B7A99A` | secondary text |
| `--ink-faint` | `#A89C90` | `#7C7064` | hints, timestamps |
| `--line` | `#E7DECF` | `#3A312A` | hairlines, borders |
| `--danger` | `#D2654E` | same | destructive only |

**Category colors** (each with a `-soft` tint for chips/backgrounds): `--feed` amber `#E29A3B`,
`--sleep` indigo `#5E6AA8`, `--diaper` teal `#56A08E`, `--pump` rose `#C97FA0`, `--note` khaki
`#9A8C6E`, `--med` terracotta `#D2654E`, `--star` gold `#D9A21B`. Rule: **the category color
identifies the data type everywhere it appears** (tile, timeline dot, chart line, sheet accent).
Never repurpose a category color for decoration.

Marketing uses the same family via `vax.css :root` (`--pink` = pump rose as the CTA color,
`--green`, `--amber`, `--bg1/2`, `--soft`, `--faint`). See B-7 for the naming drift to fix.

## A3. Typography
- **Display**: `Fraunces` (serif, weights 400/600) for greetings, sheet titles, heroes, numerals
  with feeling (timer readouts).
- **Body/UI**: `Nunito Sans` (600-800) for everything else.
- **Handwriting**: `Caveat`. **Reserved. See the type contract below.**

### A3.1 The type contract (enforced by `tools/type_check.js`)

The three faces are not decoration, they are a signal about **who is speaking**, and a parent reads
that signal before she reads a word. Two rules, both blocking:

**1. The handwriting face means a person wrote this.** `Caveat` is only ever used for content a member
authored, or the byline that says who authored it. Cubby's own words never use it. In the DOM there is
currently exactly one rule that qualifies: `.note-card .nt-by`. Canvas keepsakes are outside this rule
by design — a birth poster sets the baby's name in a hand because it is the parent's keepsake, and the
memory card lets her pick the face herself.

**2. In a block where Cubby is speaking, its heading is the largest thing in it.** Supporting text
(hints, quotes, subtitles, bylines) may never out-rank the heading it sits under, and "larger" is
measured in **cap height**, not in `px`: the three faces have different cap heights at the same size,
so comparing `font-size` across faces is not a comparison at all.

**Why these two exist, in one paragraph, because the failure is not obvious.** The Notes lane's empty
state opened with a quote of the day set in the display face at 17px with a `Caveat` byline, under a
14px body-face heading. It was 21% larger than the heading it supported and signed in handwriting, so
a parent opening an empty lane read it as a note somebody had left her, and the lane never looked
writable. It was fixed once by centring the quote, which held the two apart without anybody recording
that it was the thing holding them apart — so when the lane later became one left-aligned column, for
a perfectly good reason, the bug came straight back. A rule that lives only in a layout choice is not
a rule. Hence a gate.
- **Type ramp (the only sizes to use)** — replaces today's 20 ad-hoc sizes:
  `40 / 30 / 24 / 20 / 17 / 15 / 13 / 12 / 11` px.
  40 hero (marketing 46 desktop → clamp), 30 page titles, 24 sheet titles/timer, 20 card titles,
  17 lede, 15 body, 13 secondary, 12 labels/meta, 11 fine print. **No half-pixel sizes.**
- Line-height: 1.1 display, 1.45-1.6 body. Letterspacing: -0.01em on big serif only.

### A3.2 The stack contract (enforced by `tools/stack_check.js`)

Vertical space is four values and nothing else. All four are measured on the **rendered** page, because
this is the rule that keeps breaking in ways CSS review cannot see.

| gap | between | token |
|---|---|---|
| **16** | one block and the next block | `--stack` |
| **12** | a section heading and the content it labels | (in `.sec-title`) |
| **8** | one row and the next row *inside a single list* | `--row` |
| **2** | a thing and its own caption or link, which are one unit | declared pair |

**Three traps, each of which produced a real bug:**

**`gap` is not a margin.** `.actions` (the quick-log tile grid) had `gap:13px` and no `margin-bottom`, so
the grid spaced its own tiles beautifully and then butted into the next card with **0px**. That is the
"padding" a founder photographed twice.

**Adjacent margins collapse to the larger of the two.** A list's 8px row rhythm beat `.sec-title`'s 6px
top margin, so on Health five section headings began 8px after the previous list instead of 16 — the page
read as one undifferentiated run of rows. Hence the explicit `row + .sec-title` rule.

**A token nothing points at is not a system.** `--stack` existed for months while four rules set 18px by
hand and three different values (8, 9, and nothing) did the row rhythm's job.

**There is no exception list any more.** All eight listed offenders were closed on 2026-08-11 and `KNOWN`
in `tools/stack_check.js` is `[]`. Keep it that way: an entry there is a debt with a date on it, not a
permission. Two of those eight were the ones that had survived longest, and neither was what the list said
it was — see below.

**Two things to know before you go looking for a wrong number:**

*The CSS has two homes.* Most of it is the inline `<style>` in `app/index.html`. The rest is **injected as
JavaScript string concatenation** in `app/cubby-extras.js` (`+ '.hm{margin-bottom:18px;}'`). Grepping
`index.html` for an 18 you can plainly see on screen finds nothing, which is exactly why `.hm` and
`.tip-line` outlived every other offender. Search both.

*Prefer a structural rule to a list of selectors.* `.ms-row + .sec-title, .add-row + .sec-title, …` has to
be extended by hand every time a new kind of element lands above a heading, and it silently missed
`.btn-primary` — which put the Illness tab's "Past illnesses" heading 6px under the Mark recovered button.
The rule that actually holds is scoped to the tab wrapper and names no components:

```css
#scroll > .fade-in > *:not(.sec-title):not(.set-label):not(.greeting-sub) + .sec-title{margin-top:var(--stack);}
```

Inline `style="margin:…"` on a block is outside the system **only when it carries a number**. A token
inline — `style="margin-top:var(--stack)"` — is reachable, survives a change to the token, and is the
right answer where no rule can select the node (a one-off element inside a template literal). It is also
the *safer* answer where the preceding sibling varies: the Health heading follows a different last element
on each of the three sub-tabs, so a sibling rule would have landed 16 on one and 6 on another.

## A4. Spacing & layout
- **4px base scale**: 4 / 8 / 12 / 16 / 20 / 24 / 32 / 48. Pick from the scale; no 13px/9px/7px gaps.
- App shell: single column, `max-width:480px` centered, `100dvh` flex column, safe-area insets
  respected (already done). Content padding: 20px sides.
- Marketing: `.page` max 1040px, sections max 760px for prose, 20px side padding.
- **Breakpoints (the only three)**: `640px` (phone), `900px` (tablet), `1200px` (wide).
  Today's 560/680/720/760 zoo collapses into these.

## A5. Shape & elevation
- Radius tokens only: `--radius` 26px (cards, tiles, sheets), `--radius-sm` 16px (buttons,
  inputs, chips), plus `--radius-xs` 10px (small chips, tags — to be added) and `50%` (round).
- Two shadow levels only: resting `0 5px 14px var(--shadow)` and raised/sheet
  `0 14px 36px var(--shadow-strong)`. No other shadows.

## A6. Iconography (the rules)
- **One icon language: the `I.*` line-SVG set** in `app/index.html` (~45 icons):
  24px grid, `stroke-width:2`, round caps/joins, `currentColor`, no fills. All UI glyphs
  (tiles, buttons, list markers, nav, feature cards) come from this set, tinted by the
  category/ink color and sat on a `-soft` squircle chip (the `.ico` pattern: 46px, radius 15).
- **Emoji are content, not chrome.** Allowed: inside user-facing *moments* (milestone
  celebration, greeting line, toast flourish, tips ticker, share cards). Not allowed: as
  functional icons in tiles, feature lists, settings rows, marketing feature cards.
- New icons must match the set (24 grid / stroke 2 / round). Add to `I` in one place.
- **Per-category glyph canon**: feed = baby bottle, sleep = crescent moon, diaper = peachy bum
  (current diaper glyph), pump = pump flask, growth = scale/ruler, medicine = pill, temp =
  thermometer, vaccine = syringe, note = note card, photo = camera, family = bear.

## A7. Voice
Warm, brief, second person, no jargon, no guilt ("rough nights happen"), no em-dashes,
sentence case everywhere (no SHOUTING buttons). Numbers humanized ("1h 12m", "3 feeds").

---

# Part B — Audit findings (10 June 2026)

## What's genuinely right (keep, don't touch)
- **The palette and category-color system** is excellent: semantic, soft+strong pairs, full
  dark-theme coverage, consistent across tiles/timeline/charts. This is the strongest asset.
- **Fraunces + Nunito pairing** gives the brand its warmth; hierarchy on desktop hero and the
  app landing page is genuinely good.
- The **card language** (white surface, hairline, big radius, soft shadow) is consistent.
- **App landing page** (`/app/` signed out) scales beautifully 375→1280.
- Safe-area insets, `100dvh`, and `prefers-reduced-motion` are all handled.
- The **`I.*` SVG icon set** itself is well-drawn and coherent (one style, one grid).

## What's wrong / improvable

**B-1 (P0) Marketing nav is broken on phones.**
At ≤ ~620px the 5 tabs wrap into a vertical stack; `.nav-in` grows to **216px tall at 375px**,
and because the nav is sticky it permanently covers the top third of the screen, including the
hero headline. Root cause: `.nav-tabs{flex-wrap:wrap}` + a 640px media query that only shrinks
padding. This is the single worst defect on the site and it's on every marketing page.
_Resolved (C-1, then v0.14.0): the marketing nav is now 4 tabs (Pregnancy / Baby / Articles / Pricing) + a no-JS `<details>` "About" dropdown (Why Cubby / How it works / FAQ); on mobile it's a clean wrapped row with a full-width dropdown panel, not a scroll strip. See CHANGELOG v0.14.0._

**B-2 (P1) The Feed icon reads as a tuning fork.**
`I.feed` is a U-shape on a stem with a base bar — it scans as a tuning fork (or a sad whisk).
Feed is the most-used tile in the app; its glyph should be instantly readable. A proper baby
bottle already exists in the set (`I.bottle`, used for bottle feeds inside the sheet).

**B-3 (P1) Two icon languages are mixed.**
Marketing home + features use raw emoji as feature icons (💉 📈 📷 📋), `app/landing.js` feature
cards use emoji (⚡ 🐻 📈 🔒 📋), and in-app lists sometimes use emoji where the SVG set has the
glyph (e.g. Pro feature list `🥑`). Inside the app proper, tiles use the SVG set. Emoji render
differently per OS, clash with the line style, and dilute the brand. (Per A6: emoji = content,
SVG = chrome.)

**B-4 (P1) The signed-in app on tablet/desktop is a bare 480px strip.**
`#app{max-width:480px}` centered on the page background, with no frame, on a 1280px screen ≈
60% empty beige. We *market* "works on every device" with a tablet/laptop section. The column
itself is the right call for v1 (one-hand layout, no re-flow risk); it just needs a presentation
treatment at width (see C-4), and a real ≥900px layout later.

**B-5 (P2) No type scale: 20 distinct font sizes in the app** (incl. 10.5/11.5/12.5/14.5px),
similar spread in site.css/vax.css. Spacing is ad hoc (15 different gap values, 3-18px) and 17
hard-coded border-radius values bypass the radius tokens (9/10/11/12/13/14/15/18/20/22/24px...).
None of this is visible as a defect at arm's length, but it makes every new screen drift a
little, and it's why sheets feel subtly different from each other.

**B-6 (P2) Breakpoint zoo on marketing**: media queries at 480/560/640/680/720/760px across
site.css/vax.css, and 15 different container max-widths (430→1040px). Sections breathe
differently as you resize; the 46→34px hero jump at 640 is abrupt (no fluid step).

**B-7 (P2) Token vocabulary drift between app and site.**
The marketing tokens live in `vax.css :root` (so the *vaccine* stylesheet is the site's design
foundation) and use different names for the same concepts: app `--ink-soft`/`--ink-faint`/
`--surface-2` vs site `--soft`/`--faint`/`--surface2`; app `--pump` vs site `--pink`. Same hues,
two dialects — easy to misuse, hard to theme.

**B-8 (P3) Carousel slide balance.** On desktop the slide text column reads top-heavy against
the 512px phone, and several phone mocks fill only the top half of their screen, leaving a dead
lower third inside the device. Whitespace elsewhere on desktop is good.

**B-9 (P3) Minor copy/labels**: a few uppercase-ish/tight spots and `13.5px`-style one-off type
in nav tabs; star ratings hard-code `#E5B84B` instead of `--star`.

---

# Part C — Recommended changes (pick what to do)

| # | Fix | What exactly | Effort | Risk |
|---|---|---|---|---|
| C-1 | **P0 nav** | Mobile nav ≤640px: brand + Start free on row 1, tabs as a non-wrapping horizontal scroll row beneath (or 5 compact labels in one row); cap nav height ~96px. One CSS block in site.css, all pages inherit. | S | none (CSS only) |
| C-2 | **Feed icon** | Replace `I.feed` glyph with a baby bottle (reuse/adapt `I.bottle` at tile weight). Inside the Feed sheet keep specific glyphs per mode (nursing/bottle/solids/water). Bottle = "feeding" is the universal app convention. | S | sw bump |
| C-3 | **One icon language** | Swap emoji→`I.*` SVGs in: marketing home `.feat` cards, features page fold icons, `app/landing.js` cards, Pro list, settings rows. Emoji stay only in moments/greetings/ticker per A6. | M | low |
| C-4 | **App at width** | ≥900px: keep the 480px column but give it a den: soft elevated card frame around `#app` (radius 30, shadow-strong, 24px top/bottom margin) so it reads as a deliberate "phone in a room", not a stretched page. (A true 2-pane layout is a separate, later project.) | S-M | sw bump |
| C-5 | **Type & spacing scale** | Adopt A3 ramp + A4 scale: sweep app+site CSS mapping each off-scale value to nearest step (12.5→12, 14.5→15, 13.5→13, gaps to 4px steps, radii to tokens + new `--radius-xs`). Pure normalization, no redesign. | M | visual diffs are subtle; test light+dark |
| C-6 | **Breakpoints + fluid hero** | Collapse marketing queries to 640/900/1200; hero h1 `clamp(32px, 6vw, 46px)`; rationalize container max-widths to 1040/760/620. | S-M | low |
| C-7 | **One token sheet** | Create `tokens.css` (`:root` light+dark) as the single vocabulary (app names win: `--ink-soft` etc.); site.css/vax.css consume it; alias old names during transition; move `--star` into ratings. | M | low, mechanical |
| C-8 | **Carousel polish** | Vertically center slide text against the phone; fill mock lower halves (one more card or a soft footer chip in each mock). | S | none |

**Suggested order:** C-1 first (live defect, pure win), then C-2+C-3 together (one "iconography"
commit + sw bump), C-4, then the system passes C-5→C-7 as one normalization branch, C-8 last.

## Shipped 11 June 2026
- **C-1 done** — compact two-row mobile nav (brand+CTA / scrollable tabs), ~96px tall, verified at 375px.
- **C-2 done** — `I.feed` is now the baby bottle; nursing uses the heart glyph inside the Feed sheet.
- **C-3 done** — emoji→line-SVG chips on: home `.feat` + `.proof` cards, `app/landing.js` cards
  (new glyphs added in the house style: zap, bear face, two-person care circle, padlock).
- **C-4 done** — ≥900px the app gets a framed-card treatment (radius 34, hairline, deep shadow,
  28px breathing room); sheets float to match.
- **C-5 partial** — all half-pixel font sizes normalized to the ramp (63 replacements across
  app/site/vax/landing). Radius + gap full sweep still TODO.
- **C-6 done** — marketing breakpoints collapsed to 640/900; hero h1 is `clamp(32px,6vw,46px)`.
- **C-7 partial** — canonical app token names + category colors + radius tokens now live in
  `vax.css :root` for all static pages; star ratings use `--star`. A standalone `tokens.css` and
  retiring the legacy alias names is still TODO.
- **C-8 done** — every phone mock gets a bottom app-chrome pill via `.pscr::after`.
- New TODO noticed: phone-mock *interiors* still use emoji tiles; the real app now uses SVG
  chips, so mocks slightly misrepresent the product. Update mock markup to match someday.

## Shipped 12 June 2026 (wide-screen + mock-fidelity pass)
- **Mock fidelity done** — all emoji glyphs inside phone mocks and slide pills (home + features,
  39 glyphs) replaced with the house line-SVG set via `svg.mi{width:1em;height:1em}` (inherits
  text size/color). Mocks now show what the app actually renders, and look identical on
  iOS/Android/Windows (emoji previously rendered in each platform's own style).
- **Carousel v2** — consistent slide height (`min-height:420px`); the phone mock anchors to the
  card bottom with `margin-bottom:-140px` so only the in-use top of the device shows (clipped by
  `.cwin`); text column enriched with 3 check bullets per slide (`.sl-points`, hidden on mobile).
- **Wide screens (≥1200px)** — carousel 1100px, folds 1140px with bigger type, feats 1000px,
  proof 1080px, quotes 960px; articles hub `.wrap` widened to 1060px (3-col card grid fills it).
  Side margins are now proportionate instead of half the screen.

## Shipped 16 June 2026 ("Why we ask" inline-expander pattern)
- **New reusable component: `wwa` ("why we ask").** A calm, one-tap inline help expander placed
  directly UNDER a field. It expands in place and never navigates, never opens a sheet. Built once
  in `app/index.html` as the `wwa(key)` helper plus a `WWA` copy map and `.wwa`/`.wwa-t`/`.wwa-n`
  CSS, then reused everywhere a parent might pause and wonder why a fact is being asked for.
- **When to use it:** sensitive, identity, health or privacy fields where a short, honest reason
  reduces anxiety. Wired into 22 such fields including baby birthday (add + onboarding), baby name
  (onboarding), birth details, blood group, doctor contacts, pregnancy dating (due date / last
  period / cycle length / care country across setup, positive-test, period-update and edit flows),
  maternal weight, glucose, blood pressure, growth weight+height, and the boy/girl chart toggle.
- **Always-visible variant:** allergies and the family-list email use an always-visible note
  instead of a hidden expander, because those facts should not be tucked away.
- **Truthful copy rule:** every privacy line was checked against `firestore.rules` so no claim
  over-promises. The family list now states plainly that everyone in the circle can see each
  other's name and email. (Open gap: the dual-guardian consent gate is a client-only UI
  convention, not enforced in `firestore.rules`; copy says Cubby "asks" both guardians to agree.)

## Shipped 17 June 2026 (brand mark)
- **App landing/sign-in brand mark is the "Cubby" wordmark.** The top-left nav on the app landing
  shows "Cubby" (the brand wordmark), matching the marketing site, not the bare domain. The footer
  link to little-cubby.com is kept on purpose.

## Feature promotion hierarchy (what gets the spotlight, in order)
1. **One-thumb logging** — the core daily action; product truth first.
2. **Care-circle sync (who-did-what, live)** — the differentiator vs Huckleberry/Glow; unlimited
   caregivers free is the wedge.
3. **Working-parent recap** — the emotional story for the paying demographic.
4. **Meal photos + food tags (→ Pro nutrition)** — unique feature, monetization on-ramp.
5. **Vaccine schedules + reminders** — the SEO wedge and trust anchor (official sources).
6. **Growth charts (WHO/CDC)** — expected; table stakes, presented honestly.
7. **Keepsakes/moments** — retention + share loop, closes the carousel on warmth.
Rule: marketing surfaces (carousel order, features folds, feature cards) follow this order, and
every mock must render the same iconography/layout the live app does (no emoji chrome).

## Emoji policy (cross-platform note)
Emoji render in each platform's own font: Apple style on iOS/macOS, Google style on Android,
Segoe on Windows. They are *available* everywhere (ours are old, universally-supported code
points), but they look different per device and can't be brand-controlled. Hence: **SVG for
anything functional or brand-bearing** (tiles, pills, mocks, feature cards); emoji only in
celebratory copy (greetings, milestones, toasts, tips) where platform-native styling is fine.

**Explicitly NOT recommended now:** a desktop two-pane app layout (big re-flow risk pre-beta),
any palette change (it's the brand's best asset), icon style change (set is good — the usage is
the issue), CSS framework adoption (vanilla is fine at this size).

---

## Colour roles: fill vs ink (read this before picking a colour)

The category colours (`--feed` amber, `--sleep` indigo, `--diaper` sage, `--pump` pink, `--preg`
plum, plus `--star`, `--med`, `--danger`) are tuned to be seen as a **fill**: a dot, a chip, a
progress bar, a tint. They are not text colours. As ink on a light surface they measured 2.15–4.43:1
— amber numerals on the stats card were 2.35:1, gold links 2.15:1. So each has a second rung:

- **`--<name>`** — the brand hue. Fills, borders, dots, chart strokes. Never changes.
- **`--<name>-ink`** — the same hue carried down to a text-safe depth. Use this **whenever the
  accent is the colour of a word.** Clears 4.6:1 on white, on the page gradient and on its own
  `-soft` tint. In Night these alias straight back to the accent, which already reads on a dark
  surface, so a call site never has to know which theme it is in.

The mirror of that, for ink sitting **on** an accent fill:

- **`--on-accent`** — the deep warm near-black that clears AA on every accent in both themes.
  This is the answer to `color:#fff` on a coloured button; white on the light accents ran
  2.30–3.91:1 and got worse in Night, down to 1.79:1.
- **`--on-<accent>`** — the escape hatch for an accent where the polarity flips. Only `--on-sleep`
  exists: light indigo is dark enough that white wins (5.12:1 vs 3.51:1). `.btn-primary` and the
  running-timer banner read `var(--accent-ink, var(--on-accent))`, and `_sheetAccent()` sets
  `--accent-ink` from the sheet's accent, so the ink always follows the fill.

Ink ladder: `--ink` → `--ink-soft` → `--ink-faint`. All three clear AA on a card in both themes.
`--ink-faint` is the *quiet* rung, not an unreadable one — the quiet is carried by type (11px/800
uppercase, letter-spaced), not by fading the colour out. Light's cream page is the darkest
background in the theme, so the handful of `--ink-faint` consumers that sit **directly on the page**
(`.sec-title`, the day-surface labels, `.nav-btn`, inline `.btn-ghost` overrides) use `--ink-soft`.

Both themes are a blocking check: `node tools/uitest.js` walks the app twice and fails on any
settled, readable text below AA. See the Definition of Done in CUBBY-GUARDRAILS-AND-GOVERNANCE.md.

---

*Process note: any new UI must pick from Part A (tokens, ramp, scale, icon rules). If a needed
value isn't in the system, extend the system here first, then use it. This file is the anchor;
update it when a Part C item ships.*
