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
one, `font-size` is written as a token **255** times and as a literal **0** times. Across the other
ten, **374** literals survive at **35** distinct values.

| Ratchet | Today | Held by |
|---|---|---|
| font-size literals outside the main stylesheet | 374 | `tools/type_scale_check.js` |
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
| Radius | `--r-xs`, `--r-ctl`, `--r-card`, `--r-lg`, `--r-tap` | 9 / 12 / 16 / 18 / 26. Five names, five numbers. |
| Type | the 13 `--fs-*`, plus `--font-display`, `--font-body` | |

### Derived at runtime, not declared

`--accent`, `--accent-soft`, `--accent-ink` and `--accent-tint-ink` are set on the open sheet by
`_sheetAccent()` (`app/index.html:4883`). They exist **only inside a sheet**. A `var(--accent, …)`
outside one silently takes its fallback, which is how the focus ring ended up amber everywhere. See
§3.

### Not authoritative, recorded so nobody adopts them

| Ratchet | Today | What |
|---|---|---|
| `:root` tokens referenced by nothing | 3 | `--ink-dim`, `--grid`, `--gutter`. `--gutter`'s own comment claims it is "the page inset every card already uses". It is referenced **0** times. |
| properties referenced but declared in no stylesheet | 12 | 3 of them (`--accent`, `--accent-soft`, `--accent-tint-ink`) are legitimate: `_sheetAccent` sets them at runtime. |
| properties referenced and declared nowhere at all | 9 | `--on-feed`, `--on-note`, `--on-diaper`, `--on-pump`, `--on-star`, `--on-preg`, `--on-danger`, `--on-med`, plus `--on-`, which is what `var(--on-${accent},…)` leaves behind when the template runs dry. |

Only `--on-sleep` was ever declared. The other eight are referenced **101** times as
`var(--on-X, …)`. Every one falls through to `--on-accent`. The call sites read as tuned. They are
inert. Either declare them or delete the escape hatch, but do not keep writing new ones.

**Radius encoded four names for one number, and no longer does.** `--radius`, `--radius-sm`,
`--r-card` and `--r-dense` were all **16px**: four names for one number is not a system, it is four
chances to guess wrong, and choosing between them changed nothing except the reader's belief that it
had. The scale now names the distinctions that are real: `--r-xs` **9px** for the smallest inner
tick, `--r-ctl` **12px** for a control inside a card, `--r-card` **16px** for the card itself and the
default, `--r-lg` **18px** for a block bigger than a card, and `--r-tap` **26px** for the quick-log
tiles. Every value was already in the file, so naming them moved zero pixels.

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
| `.chip` | 67.5 x 40 | **below the floor** |

The main stylesheet carries **6** `min-height:44px` rules. That is the whole enforcement, against
203 measured controls.

| Ratchet | Today | What |
|---|---|---|
| `.chip` height in px | 40 | 4 short. `padding:9px 15px` to `11px 15px` clears it with no layout change. |
| chips in the symptom sheet | 15 | every one of them 40px, and it is the picker a worried parent taps at 3am |
| controls under 44 on an axis | 53 of 203 | measured across 4 tabs and 12 sheets |
| controls under the 24px AA floor | 14 | worst is `.lg-i`, the explainer dot, **20 x 20** on 12 surfaces |

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

**The focus ring fails in light and this is the one open contrast defect.**
`:focus-visible{outline:2px solid var(--accent,var(--feed))}` at `app/index.html:670`. Outside a
sheet `--accent` does not exist, so the ring is always feed amber:

| Ring against | Light | Night |
|---|---|---|
| `--surface` | **2.35** | 7.47 |
| `--bg` | **2.04** | 8.35 |
| `--surface-2` | **2.20** | 6.82 |

Three fails against a 3:1 floor in light, three comfortable passes in night. The fix is a ring
colour that is not a category hue, because a category hue means "this is feed data" and a focus ring
means "you are here". Those are different jobs and they should never have shared a token.

### Motion

| Floor | Number | Source |
|---|---|---|
| A state change you tap | **150ms** | the app's own mode: 20 of 56 transition durations |
| A sheet arriving | **360ms** | measured on `#sheet` |
| Ceiling on the logging path | **360ms** | nothing a parent taps to record something may take longer than the sheet that carries it |
| `prefers-reduced-motion` blocks | **11** across the app, **3** in the main stylesheet | WCAG 2.2 SC 2.3.3 |

56 transition durations app-wide, and the distribution is already a scale: 150ms x20, 200ms x15,
140ms x5, 300ms x4. Pick 150 unless you can say why.

The ceiling is enforced against the logging path specifically, measured live: `.action` 140ms,
`.chip` 150ms, `.qadd` 150ms, `.icon-btn` 150ms, `.btn-primary` 150ms, `.nav-btn` 200ms, `#sheet`
360ms. The longest transition in the app is **900ms**, and it is `.hero-slide`, the crossfade on the
signed-out landing carousel. Ambient, and nowhere near a parent trying to record a feed.

---

## 4. Component vocabulary: one canonical name per job

**700** distinct class names carry a rule across the eleven stylesheets, **312** of them in the main
one. The component audit walked that vocabulary and found the same job built up to sixteen times
under sixteen names. The cost is not bytes. It is that a parent taps
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
| Stat tile | `.avg-box` | `.gx-box` (2px apart), `.since-card` |
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
| 24 x 24 absolute minimum | WCAG 2.2 SC 2.5.8 (AA) | Adopted. 14 controls currently fail it and are ratcheted in §3 |
| 4.5:1 text, 3:1 non-text | WCAG 2.2 SC 1.4.3 and 1.4.11 | Adopted, both themes, no exemptions |
| Respect `prefers-reduced-motion` | WCAG 2.2 SC 2.3.3 | Adopted, 11 blocks |
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

```bash
PORT=19417 node tools/serve.js &
node tools/design_doc_check.js http://localhost:19417   # this document, enforced
node tools/type_scale_check.js
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
| 2026-08-30 | 8 of the 9 per-accent ink escape hatches were never declared; 68 call sites fall through to `--on-accent`. |
| 2026-08-30 | `.chip.sel` hardcodes `--feed`, so a pump-accented sheet shows an amber selection next to a pink one. |
| 2026-08-30 | `--bg` `#F4EEE3` is 7/255 from the cream the `frontend-design` skill names as the current AI default. |
