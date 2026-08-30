# App design system (`/app/`)

The anchor for the **signed-in app**. Its tokens live in `app/index.html :root`.

`design/MARKETING-SYSTEM.md` is the anchor for the public site (`site.css` / `.homex`); its tokens
live under `.homex` and share names with these but not values. Do not mix them. `DESIGN.md` at the
repo root is the older, longer document: it holds the personality, the icon canon, the voice rules
and the audit history, and it stays. This file is the narrower thing DESIGN.md never was, which is a
list of numbers you can check.

**Enforced by `tools/design_doc_check.js`.** Every number below is either re-derived from
`app/index.html` or measured in a real browser at 390px in both themes on every run. If you change a
value in the code and not here, the gate goes red. If you change it here and not in the code, the
gate goes red. That is the whole point of the file: a design doc that nobody can check becomes
decoration in about eight weeks, and we have the receipts for that in `tools/type_scale_check.js`.

```bash
PORT=19417 node tools/serve.js &
node tools/design_doc_check.js http://localhost:19417
node tools/design_doc_check.js --self-test    # proves the gate can fail
```

Two kinds of number live here and they are enforced differently.

- **Fixed.** An exact value the gate asserts equality on. The type scale, the token hexes, the
  contrast ratios, the floors, the geometry of a named component.
- **Ratchet.** Today's true count of something we are still paying down. It may fall and it may not
  rise. Lower it when you migrate some; never raise it to make a run go green.

### How the gate reads this file, so you can rewrite the prose freely

The first version of the gate matched whole sentences, so the radius consolidation broke eleven
assertions by *correcting* the paragraph that described it. A gate that punishes you for fixing the
wording teaches you to leave the wording wrong, which is the exact failure the file exists to stop.
So the gate now reads only three shapes, and none of them is a sentence.

1. **A table row keyed by a backticked name.** `| `--token-name` | 16 | what it is for |`. The gate
   takes the list of names from `:root`, never from here, and demands a row for each one. Add a
   token to the stylesheet and the missing row is the failure. Reword the last column freely. Write
   the example with a made-up name, as here: an illustration that copies a live row is a second copy
   of a number, and a second copy is the thing this file exists to stop.
2. **A ratchet row, matched on one distinctive word in its label.** "half-pixel", "tokenised",
   "nowhere". Rewrite the rest of the label freely; keep the one word.
3. **A bolded number following a backticked name.** `` `.chip` `` … **44**. The anchor is the name
   and the bold. Everything between them is yours.

Everything else in this file is prose the gate does not read, and you should treat it as prose: if
it disagrees with a table, the table is what ships.

---

## 1. The type scale

Thirteen roles in `:root`, named for what they are **for**, so the next person picks by intent
rather than by eyeballing a pixel. Fixed.

| Token | px | What it is for |
|---|---|---|
| `--fs-micro` | 10 | badges and the smallest meta |
| `--fs-caption` | 11 | captions and field labels |
| `--fs-small` | 12 | secondary body, `.csub` |
| `--fs-body` | 13 | default body, the most used size in the app |
| `--fs-base` | 14 | comfortable body |
| `--fs-lead` | 15 | lead paragraphs and sheet subs |
| `--fs-input` | 16 | inputs and emphasis |
| `--fs-title` | 18 | card and sheet titles |
| `--fs-head` | 21 | section heads |
| `--fs-stat` | 24 | a number meant to be read at a glance |
| `--fs-display` | 30 | the week hero, a running timer |
| `--fs-brand` | 40 | the onboarding logo |
| `--fs-burst` | 54 | the kick count and the welcome burst |

**16 is a floor, not a preference.** Mobile Safari zooms the whole page when a field under 16px
takes focus. On a one-handed logging app that throws the layout every time she taps an input.
Measured live: the note field in the symptom sheet computes to **16px** and stands **52px** tall.

**Where the scale actually reaches.** The app has **11** stylesheets: 4 `<style>` blocks in
`app/index.html` and 7 injected at runtime from `app/*.js`. The scale governs one of them. In that
one, `font-size` is written as a token **257** times and as a literal **0** times. Across the other
ten, **373** literals survive at **35** distinct values.

| Ratchet | Today | Held by |
|---|---|---|
| font-size literals outside the main stylesheet | 373 | `tools/type_scale_check.js` |
| half-pixel literals anywhere | 29 | `tools/type_scale_check.js` |
| off-scale sizes reachable on the Home screen at rest | 1 | this gate |

That last one is `.greeting` at **19px**, from `app/cubby-extras.js:738`. It is the first line a
parent reads, "Good afternoon", it is set in the display face, and 19 is not on the scale. It
survives because it lives in a file the scale only ratchets. Fix it to `--fs-title` (18) and lower
the ratchet, or add a role and say what the role is for. Do not leave it at 19 and call it a choice.

---

## 2. Token groups, and which are authoritative

**98** custom properties are declared in `:root`. **54** of them are given a different value under
`[data-theme="night"]`. **115** distinct properties are referenced with `var()` across the app.

### Authoritative

These are the vocabulary. Every new rule picks from here.

| Group | Members | Rule |
|---|---|---|
| Surfaces | `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--surface-4` | A four-step elevation ramp: page, card, sheet or modal, menu or toast. In light the top two stay `#FFFFFF` because a shadow reads fine on cream. In night they climb in lightness, because a shadow on `#1A1614` is invisible and a sheet on a card would read as one flat plane. |
| Ink | `--ink`, `--ink-soft`, `--ink-faint` | Three rungs, always in that order. Never skip, never invert. |
| Category hue, as a **fill** | `--feed`, `--sleep`, `--diaper`, `--pump`, `--note`, `--preg`, `--danger`, `--star`, `--med` | The colour identifies the data type everywhere it appears: tile, timeline dot, chart line, sheet accent. Never repurpose one for decoration. |
| Category hue, as **ink** | `--feed-ink`, `--sleep-ink`, `--diaper-ink`, `--pump-ink`, `--note-ink`, `--preg-ink`, `--danger-ink` | Use whenever the accent is the colour of a word. See §3. |
| Ink **on** a fill | `--on-accent`, `--on-sleep` | See §3. |
| Space | `--gutter`, `--stack`, `--row`, `--pad-card`, `--pad-dense`, `--pad-tile`, `--pad-tap` | 20 / 16 / 8, then four component paddings. |
| Radius | the 7 `--r-*`, below | One name per corner that is really a different corner. |
| Elevation | the 6 `--elev-*`, below, over `--shadow` and `--shadow-strong` | How far off the page a thing sits. Pick the rung, never a triple. |
| Motion | the 7 `--mo-*` and 2 `--ease-*`, below | Named for the moment, not the milliseconds. |
| Type | the 13 `--fs-*`, plus `--font-display`, `--font-body` | |

### Derived at runtime, not declared

`--accent`, `--accent-soft`, `--accent-ink` and `--accent-tint-ink` are set on the open sheet by
`_sheetAccent()` (`app/index.html:4883`). They exist **only inside a sheet**. A `var(--accent, …)`
outside one silently takes its fallback, which is how the focus ring spent a year being feed amber
on every surface in the app. It no longer is; see §3. Treat a `var(--accent, …)` written outside a
sheet as a bug, because the fallback is what will ship.

### Not authoritative, recorded so nobody adopts them

| Ratchet | Today | What |
|---|---|---|
| `:root` tokens referenced by nothing | 5 | `--ink-dim`, `--grid`, `--mo-tap`, `--mo-dissolve`, `--mo-stagger`. The first two are old debt. The three motion ones are new and honest: the scale shipped, the sheet and the scrim moved onto it, and the per-declaration migration of the rest was deliberately not taken in the same pass as the radius rewrite, because both rewrite the same lines. |
| properties referenced but declared in no stylesheet | 12 | 3 of them (`--accent`, `--accent-soft`, `--accent-tint-ink`) are legitimate: `_sheetAccent` sets them at runtime. |
| properties referenced and declared nowhere at all | 9 | `--on-feed`, `--on-note`, `--on-diaper`, `--on-pump`, `--on-star`, `--on-preg`, `--on-danger`, `--on-med`, plus `--on-`, which is what `var(--on-${accent},…)` leaves behind when the template runs dry. |

Only `--on-sleep` was ever declared. The other eight are referenced **101** times as
`var(--on-X, …)`. Every one falls through to `--on-accent`. The call sites read as tuned. They are
inert. Either declare them or delete the escape hatch, but do not keep writing new ones.

### The radius scale

Four of the five radius tokens used to be 16px: `--radius`, `--radius-sm`, `--r-card` and
`--r-dense`. Four names for one number is not a system, it is four chances to guess wrong, and
choosing between them changed nothing except the reader's belief that it had. The scale names the
distinctions that are real, and every value on it was already somewhere in the file, so naming them
moved zero pixels.

| Token | px | What has this corner |
|---|---|---|
| `--r-xs` | 9 | the smallest inner tick, bar or frame |
| `--r-ctl` | 12 | a control or an icon square sitting inside a card |
| `--r-card` | 16 | the card, the row, the tile. the default |
| `--r-lg` | 18 | a block bigger than a card: nav buttons, method tiles, the primary button |
| `--r-tap` | 26 | the quick-log tiles, and only those |
| `--r-xl` | 30 | sheets and full-width overlay panels |
| `--r-pill` | 999 | anything meant to have fully round ends |

Literal `border-radius` values still in the main stylesheet: **63**, at **17** distinct sizes. They
are the smear between card and control, a ratchet held by `tools/surface_token_check.js`.

### The elevation scale

Two "shadow" tokens used to be colours only, so every offset and blur triple was hand-typed. Six
rungs now, and the colour steps with the height: near the page a shadow takes `--shadow`, and from
`--elev-float` up it takes `--shadow-strong`, because a thing that far off the page needs an edge.

| Token | Offset, blur | What sits here |
|---|---|---|
| `--elev-chip` | 0 2px 6px | rests ON a card: toggle knob, check dot, badge |
| `--elev-card` | 0 3px 9px | the resting card and list row. the default |
| `--elev-lift` | 0 5px 14px | a card standing off the page: tiles, stat cards |
| `--elev-float` | 0 8px 22px | floats over the scroll: nav bar, toast, hero |
| `--elev-over` | 0 12px 30px | lifted clear of it all: the FAB, the timer banner |
| `--elev-modal` | 0 24px 60px | a card sitting on a full-screen scrim |

The main stylesheet reaches for `var(--elev-*)` **64** times. Against that, hand-typed
`box-shadow` triples still left there: **11**, and that one is a ratchet.

### The motion scale

Seven durations and two curves. The roles are named for the **moment**, not the milliseconds: you
pick "this control is acknowledging her finger" and the number follows. Before this there were 20
distinct time literals in the main stylesheet and not one token, so `.12s`, `.14s` and `.15s` all
meant "quick" and nobody could say which was which.

| Token | ms | The moment |
|---|---|---|
| `--mo-stagger` | 40 | the step between siblings in a `.stagger` list |
| `--mo-tap` | 120 | a control acknowledging the finger that is on it |
| `--mo-quick` | 150 | a small state change: a chip selects, a check fills |
| `--mo-settle` | 200 | a control coming to rest: the switch knob, a colour swap |
| `--mo-enter` | 350 | something arriving: the sheet, the scrim, a screen |
| `--mo-cross` | 500 | a card rising in, a bar growing to its new height |
| `--mo-dissolve` | 900 | one photograph becoming another. the only slow thing in the app |

Two curves, because there are only two kinds of motion here. `--ease-out` is for anything that
MOVES, because it decelerates into a resting place. `--ease-fade` is for anything that only fades,
because a fade has no resting place to arrive at.

The one thing this buys that a type scale does not: reduced motion becomes one rule instead of a
hunt. §3 has the durations that are still literals.

---

## 3. The floors, with their numbers

### Touch

| Floor | Number | Source |
|---|---|---|
| Primary target, any control on the logging path | **44 x 44** | Apple HIG minimum tap target, and WCAG 2.2 SC 2.5.5 Target Size (Enhanced) |
| Absolute minimum, anything tappable | **24 x 24** | WCAG 2.2 SC 2.5.8 Target Size (Minimum), level AA |

Measured live at 390px, in both themes:

| Component | Measured | |
|---|---|---|
| `.icon-btn` | 44 x 44 | at the floor by design |
| `.qadd` | 56 x 56 | |
| `.nav-btn` | 85.5 x 58 | |
| `.action` | 168.5 x 145 | the quick-log tile |
| `.btn-primary` | 346 x 56 | |
| `.field input` | 346 x 52 | |
| `.chip` | 67.5 x 44 | was 40, and it is the picker a worried parent taps at 3am |
| `.lg-i` | 20 x 20 | **drawn** at 20 and **hit** at 44. See below |

The main stylesheet carries **6** `min-height:44px` rules. Count of `.chip` buttons in the symptom
sheet: **15**, and every one of them now clears the floor.

**The floor is a hit area, not a box.** `tools/touch_target_check.js` walks outward from each
control's centre with `document.elementFromPoint` instead of reading `getBoundingClientRect`, and
the two differ whenever something overlaps a control. Nothing in the app is under 44 on an axis by
that measure, and nothing is under 24. `.lg-i`, the explainer dot, is the case worth understanding:
it is still **drawn** 20 x 20, because growing the circle would move the type on twelve surfaces, and
it reaches 44 through a transparent `::after`. Both halves are asserted, so growing the box fails
the gate exactly as shrinking the hit area would.

### Contrast

| Floor | Number | Source |
|---|---|---|
| Body text | **4.5:1** | WCAG 2.2 SC 1.4.3, level AA |
| Non-text: focus rings, control boundaries, chart strokes | **3:1** | WCAG 2.2 SC 1.4.11 |

Computed from the shipped hexes. Fixed.

**Light, the ink ladder.** The cream page is the darkest background in the theme, so the page is
where a rung fails first.

| | on `--surface` | on `--surface-2` | on the page `--bg` |
|---|---|---|---|
| `--ink` | 15.07 | 14.10 | 13.05 |
| `--ink-soft` | 5.84 | 5.46 | 5.05 |
| `--ink-faint` | 5.20 | 4.87 | 4.51 |

**4.51 is the tightest number in the light theme.** `--ink-faint` on the page clears AA by 0.01. If
you darken the page background by anything at all, that cell fails. `--ink-faint` is the *quiet*
rung, not an unreadable one; the quiet is carried by type (11px, 800, uppercase, letter-spaced), and
it always was.

**Night, the ink ladder**, on all four elevation rungs:

| | `--surface` | `--surface-2` | `--surface-3` | `--surface-4` |
|---|---|---|---|---|
| `--ink` | 13.49 | 12.32 | 12.00 | 10.53 |
| `--ink-soft` | 8.26 | 7.55 | 7.36 | 6.45 |
| `--ink-faint` | 5.99 | 5.47 | 5.33 | 4.68 |

Night is the stronger theme. Its worst cell is 4.68, against light's 4.51.

**Fill is not ink.** A category hue is tuned to be seen as a fill. As text it fails.

| | as ink on white | via its `-ink` rung |
|---|---|---|
| `--feed` | **2.35** | 5.75 |
| `--danger` | **3.68** | 5.88 |

**Ink on a fill is `--on-accent`, never `#fff`.** In light:

| Fill | `--on-accent` | `#fff` |
|---|---|---|
| `--star` | 7.82 | 2.30 |
| `--feed` | 7.63 | 2.35 |
| `--pump` | 6.01 | 2.99 |
| `--diaper` | 5.83 | 3.08 |
| `--note` | 5.43 | 3.31 |
| `--danger` | 4.89 | 3.68 |
| `--preg` | **4.60** | 3.91 |

`--preg` at 4.60 is the tightest accent fill we ship. One exception exists and only one: light indigo
is dark enough that white wins, so `--on-sleep` is `#FFFFFF` at **5.12:1** where `--on-accent` would
be 3.51.

**The focus ring is two-tone, and that is not decoration.** It used to be
`outline:2px solid var(--accent,var(--feed))`, and outside a sheet `--accent` does not exist, so the
ring was feed amber everywhere: 2.35 on a card, 2.04 on the page, all of it under the 3:1 floor. A
category hue means "this is feed data" and a focus ring means "you are here". Those are different
jobs and they should never have shared a token.

The ring is the only thing a keyboard or a switch user navigates by, so it has to clear 3:1 against
whatever happens to be behind it, and what is behind it is not knowable from the rule: the
backgrounds include the accent-filled tiles. No single colour clears 3:1 against all of night's. So
the indicator carries its own contrast with it. `--focus-halo` sits in the 2px offset gap,
`--focus` sits outside it, and the pair always differ by a wide margin, which is the "focus
indicator with a contrasting outline" technique SC 1.4.11 is written to allow.

| | Light | Night |
|---|---|---|
| `--focus` on `--surface` | 15.07 | 13.49 |
| `--focus` on `--bg` | 13.05 | 15.07 |
| `--focus` on `--surface-2` | 14.10 | 12.32 |
| `--focus` against `--focus-halo` | 15.07 | 15.07 |

The rule is `:root:root :focus-visible:focus-visible` at `app/index.html:854`. The doubled
pseudo-class is a deliberate specificity bump and not a typo: night's raised surfaces are drawn with
`outline:1px solid var(--hairline)`, which is `[data-theme]` plus a class, and a plain
`:focus-visible` lost to it. Focusing the settings gear in night drew a 7%-alpha decoration instead
of a ring, which is no focus indicator at all.

### Motion

The durations themselves are the `--mo-*` scale in §2. These are the floors and the one ceiling.

| Floor | Number | Source |
|---|---|---|
| A state change you tap | **150ms** | `--mo-quick`, and it is what most of the app already did |
| A sheet arriving | **350ms** | `--mo-enter`, measured live on `#sheet` |
| Ceiling on the logging path | **350ms** | nothing a parent taps to record something may take longer than the sheet that carries it |
| `prefers-reduced-motion` blocks | **12** across the app, **4** in the main stylesheet | WCAG 2.2 SC 2.3.3 |

The ceiling is enforced against the logging path specifically, measured live: `.action` 140ms,
`.chip` 150ms, `.qadd` 150ms, `.icon-btn` 150ms, `.btn-primary` 150ms, `.nav-btn` 200ms, `#sheet`
350ms.

**The durations still typed as literals.** Migrating every `transition` onto the scale rewrites the
same lines the radius consolidation does, and a hand merge of twenty-eight one-line CSS conflicts is
how a stylesheet loses a rule, so it was deliberately left for a pass of its own.

| Ratchet | Today | What |
|---|---|---|
| `transition` declarations app-wide | 51 | the denominator, and it is a fixed count, not a ratchet |
| of those, already tokenised onto `--mo-*` | 17 | may rise, and should |
| of those, still carrying a literal | 33 | may fall and may not rise |

That is **37** literal durations, because a declaration can carry two, and they land at **8**
distinct values:

| ms | Uses |
|---|---|
| 120 | 3 |
| 140 | 5 |
| 150 | 11 |
| 180 | 2 |
| 200 | 11 |
| 300 | 3 |
| 350 | 1 |
| 900 | 1 |

The shape of that table is the argument for the scale: 150 and 200 are tied at the top, which is
another way of saying nobody was choosing. The longest is **900ms**, and it is `.hero-slide`, the
crossfade on the signed-out landing carousel. Ambient, and nowhere near a parent trying to record a
feed.

---

## 4. Component vocabulary: one canonical name per job

**693** distinct class names carry a rule across the eleven stylesheets, **315** of them in the main
one. A name that appears only inside a CSS comment is not counted, because it does not carry a rule.
The component audit walked that vocabulary and found the same job built up to sixteen times under
sixteen names. The cost is not bytes. It is that a parent taps
*Your profile and family*, a `.prof-card`, and lands on `.ll-mem` rows inside a `.ll-modal`:
different card, different type ramp, different sheet geometry, one tap apart. She does not read that
as two components. She reads it as the app changing under her hand.

Build with the canonical name. If it does not fit, extend it here first.

| Job | Canonical | Also exists, do not add to |
|---|---|---|
| The committing action in a sheet | `.btn-primary` | `.ll-modal-btn`, `.cu-btn` |
| The way out, or a secondary forward action | `.btn-ghost` | `.ll-ghost` |
| Destructive, as ink | `.btn-ghost.btn-danger` | `.btn-primary.btn-danger` (one site, terracotta ink on amber fill) |
| Selectable pill in a rail | `.chip` | `.tgt`, `.aud`, `.rel-chip`, `.cu-chip` |
| Two-up choice card in a sheet | `.opt` | |
| Quick-log tap tile | `.action` | |
| Round 44px topbar button | `.icon-btn` | |
| Tab bar item | `.nav-btn` | |
| Segmented control | `.seg` | `.unit-toggle` |
| Icon, title, subtitle row | `.set-item` | 15 others, listed in the component audit |
| Stat tile | `.stat-tile` in `.stat-tiles`, `.tiles-3` for a three-across row | `.since-card` |
| Full-screen overlay frame | `.ov-screen` | |
| Its header bar, and the close disc in it | `.ov-bar`, `.ov-x` | |
| A tappable row inside an overlay | `.ov-row` with `.ov-row-mid` / `-t` / `-s` / `-chev` | |
| Bottom sheet | `.sheet` | `.picker-ov-panel`, `.ll-modal`, `.cu-card` |
| Text input | `.field input` | 4 others, at 3 border widths and 4 radii |
| Switch | `.ds-pinsw` | `.sw` (reads `--line`, not `--switch-off`), `.nap-switch` (hardcoded knob) |
| Tick | `.ms-check` | 4 others |
| Toast | `.toast` | |

**Selected is spelled `.sel`.** Fixed. `.sel` carries 11 selector uses in the main stylesheet against
9 for `.on`, 2 for `.active` and 1 for `.icon-on`.

**Selection follows the sheet accent.** `.chip.sel` (`app/index.html:1033`) hardcodes
`var(--feed)`. Open the symptom sheet, which `_sheetAccent` paints `--pump`, and the selected
symptom chip is amber while the selected severity segment and the primary button are pink. One
screen, two answers to "this one". Screenshot it and you cannot unsee it.

| Ratchet | Today | What |
|---|---|---|
| non-canonical spellings of "selected" | 12 | `.on` x9, `.active` x2, `.icon-on` x1 |
| components whose selected state hardcodes a hue instead of `--accent` | 1 | `.chip.sel` |

Counted as `class="…"` occurrences in `app/index.html`: `.btn-ghost` **180**, `.btn-primary` **144**,
`.chip` **72**, `.set-item` **63**. The app's most-used button is the one with no visual chrome, and
it outnumbers the primary 1.25 to 1. That is not automatically wrong, but only 23 of those ghosts are
a bare `closeSheet()`. The rest carry forward actions, so "ghost means cancel" is not a rule you can
rely on when you are reading a screen you did not write.

---

## 5. What we mean by AI slop, and how each rule above prevents it

Slop is not ugliness. Slop is **a value nobody chose**.

Nobody sat down and picked 13.5px. It was the number that happened to be to hand when a rule was
written, and once it exists the next person matches it, and now the app has 35 distinct font sizes
covering a 12px range with six half-pixel steps between them. Nobody chose four names for 16px
either. Nobody chose to have sixteen ways to draw a row with an icon and a title. Every one of those
arrived the same way: locally reasonable, globally incoherent, and invisible at arm's length.

It is not invisible to the person we build for. She is holding a baby in one hand at 3am. She is not
auditing the type ramp. She is deciding, in about 400 milliseconds, whether this app is a thing that
has its act together, because that is the only evidence she has about whether it will still have her
data next week. Sixteen row treatments is not a style problem. It is a trust problem.

So each rule above is aimed at a specific way that happens.

| The rule | The slop it prevents |
|---|---|
| Roles named for intent, not size (§1) | You cannot pick `--fs-body` by accident. You have to say what the text is for, and that is a decision. |
| A gate that reads the scale from `:root` (§1) | The gate can never disagree with the stylesheet about what the scale is. A gate holding its own copy is one edit from asserting a world that does not exist. |
| A ratchet, not a rule, for the other ten stylesheets (§1) | 374 literals cannot migrate in one pass without a visual regression on every surface at once. A budget that starts at the real number survives contact with the file. A rule that starts at zero gets deleted on its first run. |
| Fill and ink are different tokens (§3) | Amber numerals on the stats card measured 2.35:1 and looked fine to everyone who shipped them, because the person picking a colour was picking a *brand* colour and the browser was rendering *text*. |
| Every floor has a number and a source (§3) | "Make sure it is tappable" is not checkable. 44 is. |
| One canonical name per job (§4) | The next component gets built from the vocabulary instead of from the nearest thing that looked right. |
| Two number kinds, fixed and ratchet (top) | Debt gets a count and a direction instead of a promise. |

### The uncomfortable one

The `frontend-design` skill
(`~/.claude/plugins/marketplaces/claude-plugins-official/plugins/frontend-design/skills/frontend-design/SKILL.md`)
names three looks that AI-generated design currently defaults to. The first is: *a warm cream
background near `#F4F1EA`, a high-contrast serif display face, and a terracotta accent.*

Cubby's `--bg` is `#F4EEE3`. That is **7/255** off the named default on its widest channel, a
contrast ratio of **1.02:1** between the two. Our display face is a serif. Our `--danger` and
`--med` are `#D2654E`, terracotta.

We are sitting on the coordinate. Saying "but ours came from the brand" is true and is not a
defence, because the defence has to be checkable and that one is not. What is checkable is that the
palette is not where our distinctiveness lives:

- The **ink ladder is derived from measurement**, not from taste. `--ink-faint` was `#A89C90` until
  it measured 2.68:1 on a card, and 76 consumers had inherited that.
- The **category hues carry meaning**. Amber is feed, everywhere, in every surface. A default cream
  palette has an accent. It does not have a semantics.
- The **fill/ink split** exists because we measured white on our own buttons at 1.79:1 in night.

Those three are ours and no default has them. The cream is not ours and we should stop treating it
as evidence of anything.

---

## 6. Borrowed rules, and where we diverge on purpose

| Rule | Borrowed from | Us |
|---|---|---|
| 44 x 44 primary target | Apple HIG | Adopted as the floor for anything on the logging path |
| 24 x 24 absolute minimum | WCAG 2.2 SC 2.5.8 (AA) | Adopted. Every measured hit area now clears it, and `tools/touch_target_check.js` holds that |
| 4.5:1 text, 3:1 non-text | WCAG 2.2 SC 1.4.3 and 1.4.11 | Adopted, both themes, no exemptions |
| Respect `prefers-reduced-motion` | WCAG 2.2 SC 2.3.3 | Adopted, 12 blocks |
| 48dp targets | Material Design | **Rejected.** 48 would push `.icon-btn` and the whole topbar into a redesign for 4px. 44 matches the platform we actually ship on. |
| "Spend your boldness in one place" | `frontend-design` skill | Adopted. `--fs-burst` at 54px is the whole budget, and it is spent on exactly two moments: the kick count and the welcome burst. |
| "Take one real aesthetic risk" | `frontend-design` skill | **Diverged.** That advice is written for a portfolio page a person visits once. This is a utility a frightened person opens at 3am on the worst night of her month. Our charter test is whether a screen makes that person feel worse, and a surprise is a way to fail it. Our risk budget goes into the keepsake surfaces, which she chooses to open, and nowhere near the logging path. |
| Serif display faces read as an AI default | `frontend-design` skill | **Diverged, deliberately.** Fraunces is the keepsake brand serif. It is the face on the birth poster and the memory card, and the app uses it so that the thing she prints and the thing she logs in are recognisably the same product. That is a considered choice with a job attached, not a default reached for. The check is discipline: Fraunces appears at **50** references across the app against **10** for `Caveat` and body-face everything else. If it starts showing up on labels and buttons, it has stopped being a signal. |
| Three faces mean three speakers | ours, from `DESIGN.md` §A3.1 | `Caveat` means a **person** wrote this. Cubby's own words never use it. Enforced by `tools/type_check.js`. |
| Flat page base under tinted bands | `design/MARKETING-SYSTEM.md` §2 | Site only. The app has no bands. |

---

## 7. Verify before you ship

Source is not evidence. Every defect in this document was invisible in the CSS and obvious in the
browser or in a contrast calculation.

`node tools/gates.js` runs all of these on a free port of its own, and `--only=design-doc` runs just
the first. Run them by hand when you want the detail:

```bash
PORT=19417 node tools/serve.js &
node tools/design_doc_check.js http://localhost:19417   # this document, enforced
node tools/design_doc_check.js --self-test              # and proof it can fail
node tools/type_scale_check.js
node tools/touch_target_check.js http://localhost:19417
node tools/contrast_check.js http://localhost:19417
node tools/motion_check.js http://localhost:19417
node tools/surface_token_check.js http://localhost:19417
node tools/stack_check.js
node tools/grid_check.js http://localhost:19417
node tools/pad_audit.js http://localhost:19417
node tools/uitest.js http://localhost:19417             # AA in both themes
```

Then look at the rendered app at **390px in both themes**, not at the file.

- **Pass an explicit base URL.** `tools/serve.js` defaults to `:8080`, which in a worktree is
  probably another checkout. Shasum the served `app/index.html` against disk before you believe a
  number.
- **Measure computed styles.** `getComputedStyle`, not a grep.
- **Both themes, always.** Night is the stronger theme here, so a light-only pass will miss nothing
  and prove nothing. A night-only pass will miss the focus ring.
- **`#scroll` is the scroll container**, so a full-page screenshot captures the viewport only. Walk
  the tabs.

## 8. Change log

| Date | Finding |
|---|---|
| 2026-08-30 | This file, and `tools/design_doc_check.js` with it. Measured at 390px on both themes against a worktree-local server, hash-verified. |
| 2026-08-30 | Five `:root` tokens are declared and never referenced: `--ink-dim`, `--grid`, `--mo-tap`, `--mo-dissolve`, `--mo-stagger`. The first two are old. The three motion ones are NEW and honest: the motion scale shipped with the sheet, the scrim and the tap feedback moved onto it, but the per-declaration migration of the remaining transitions was deliberately not taken in the same pass as the radius and elevation consolidation, because both rewrite the same lines and a twenty-eight-way hand merge of one-line CSS is how a stylesheet loses a rule. Migrating them is the follow-up that retires these three. |
| 2026-08-30 | 8 of the 9 per-accent ink escape hatches were never declared; 101 call sites fall through to `--on-accent`. |
| 2026-08-30 | `.chip.sel` hardcodes `--feed`, so a pump-accented sheet shows an amber selection next to a pink one. |
| 2026-08-30 | `--bg` `#F4EEE3` is 7/255 from the cream the `frontend-design` skill names as the current AI default. |
| 2026-08-30 | The gate parsed sentences, so *correcting* the radius paragraph broke eleven assertions and the file shipped unwired. It now reads token-keyed table rows and takes the list of tokens from `:root`, so the doc cannot omit a token the code declares and a rewrite of the prose around a number cannot fail a run. The convention is written at the top of this file. |
| 2026-08-30 | Component dedupe: six identical-body pairs folded to one rule each, so class names fell 700 to 694 while the main sheet gained 6, elevation uses fell 66 to 64 and font-size token uses rose 255 to 257. Eighteen of eighteen screenshot pairs differ by 0 pixels. |
| 2026-08-30 | `.csub` split: the treatment moved to the base class and only `margin-bottom` stayed scoped to `.stat-card`, so the class carries a rule outside a card for the first time and the vocabulary went 694 to 695, 314 to 315 in the main sheet. |
| 2026-08-30 | Reconciled against the merged tree: 13 red assertions, all of them the doc trailing the code. Radius is 7 tokens and not 5. Elevation and motion had no entry at all. The focus ring is fixed and two-tone, so the "one open contrast defect" paragraph was describing a defect that no longer exists, which is the worse direction for a doc to be wrong in. `.chip` is 44 and not 40. The sheet arrives in 350ms, not 360. Class vocabulary recounted with CSS comments stripped, because a name mentioned only in a comment carries no rule: 702 to 700 across the sheets and 314 to 308 in the main one. Literal transition durations 56 to 37, and reduced-motion blocks 11 to 12. |
