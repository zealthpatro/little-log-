# Marketing site design system (`site.css` / `.homex`)

The anchor for **little-cubby.com's public pages**. `DESIGN.md` covers the app (`/app/`), and its
tokens are a different set living in `app/index.html :root` — do not mix the two.

Scope: the four pages that carry the `.homex` band system.

| Page | Class |
|---|---|
| `/` | `<main class="homex">` |
| `/pregnancy/` | `<main class="homex">` |
| `/features/` | `<main class="homex">` |
| `/how-it-works/` | `<div class="homex">` (older `.section`/`.lead2` markup inside) |

Everything else (`/why/`, `/pricing/`, `/faq/`, `/articles/`, `/about/`, …) uses the shared nav plus
`vax.css`, keeps the site gradient, and has no folds.

**Enforced by `tools/marketing_type_check.js`.** Anything in this document that can be checked, is.
Run it before you ship a site change:

```bash
node tools/serve.js & node tools/marketing_type_check.js http://localhost:8080
```

---

## 1. Tokens

Declared on `.homex` in `site.css`. Two groups, and the split matters.

### Page-level (the bands you see when you scroll)

| Token | Value | Role |
|---|---|---|
| `--h-page` | `#FDFBF6` | flat page base for `.homex` pages |
| `--h-band` | `#F4EBD9` | `.hx-tint` band |
| `--h-band-rose` | `#F7ECEF` | `.hx-tint-rose` band (the close) |
| `--h-band-line` | `#E9DFCA` | 1px hairline on every band edge |

### Component-level (used INSIDE the phone mockups)

| Token | Value | Role |
|---|---|---|
| `--h-cream` | `#FBF5E9` | phone screen background |
| `--h-cream2` | `#F4EBD9` | `.hx-seg`, `.hx-rhythm` inside a mock |
| `--h-cream3` | `#EFE3CC` | icon chips, `.hx-apphead .b` |
| `--h-card` | `#fff` | `.lift-sm` cards |

> **These two groups look interchangeable and are not.** `--h-band` and `--h-cream2` currently hold
> the *same* hex. They are separate tokens because the page bands and the mock internals must be
> able to move independently — changing the fold tint must never restyle the inside of a phone.

### Ink

| Token | Value | Role |
|---|---|---|
| `--h-ink` | `#2B2620` | headings |
| `--h-mid` | `#443D34` | **subtitles only** |
| `--h-soft` | `#5C544A` | body |
| `--h-faint` | `#8A8073` | fineprint |
| `--h-accent` | `#C97FA0` | eyebrows, CTA |

Four ink levels, in that order. A subtitle at `--h-ink` reads as a second heading; that is a real
bug we shipped, not a preference.

---

## 2. The fold model

**The page base is flat. This is load-bearing.**

```css
html:has(.homex) body { background: #FDFBF6; }
.homex .hx-tint,
.homex .hx-tint-rose { border-top:1px solid var(--h-band-line);
                       border-bottom:1px solid var(--h-band-line); }
```

### Why flat, and why this is not a preference

`vax.css` sets the site background to a **fixed vertical gradient**, `--bg1 #FBF5E9` → `--bg2
#F1E4CF`, with `background-attachment: fixed`. On a page with tinted bands that means *the thing a
band is contrasted against is not a colour* — it is whatever the gradient happens to be at your
current scroll position. Measured on production, one boundary, two scroll positions:

| Boundary at | page lum | band lum | delta |
|---|---|---|---|
| viewport bottom | 229.2 | 221.0 | **8.2** |
| viewport top | 245.4 | 221.0 | 24.4 |

The fold appeared, faded and inverted as you scrolled. Two earlier attempts to fix this by
**darkening the band** both failed, because the direction was never the problem — the varying base
was. On a flat base the original `#F4EBD9` gives a constant **15.5**.

### Rules

- A band tone is only meaningful next to a **flat** base. Never tune a band against a gradient.
- Sample the **effective** background by walking ancestors until one actually paints. A transparent
  `body` over a gradient reports nothing, which is how this hid.
- Measure at **two scroll positions** and require the delta to be constant. One sample passes a
  broken page.
- Minimums, enforced: **≥12 luminance** separation, **≤1.5 drift** across scroll.
- Keep the hairline. Tone alone is fragile; a 1px line reads at any tone.
- `:has()` scoping is deliberate — articles and the app keep the gradient. If a browser lacks
  `:has()` the rule drops and the old gradient returns, which is the previous behaviour rather than
  a broken one.

---

## 3. The type ladder

Three tiers, always in this order, per section shape. Live computed values:

| Section | Tier | 390px | 1440px | Face | Weight | Colour |
|---|---|---|---|---|---|---|
| **hero** | title `h1` | 30 | 47 | Fraunces | 600 | ink |
| | subtitle `.hx-kick` | 18 | 19 | Fraunces | 600 | mid |
| | lede `.hx-lede` | 16 | 16 | Fraunces | 500 | soft |
| | fineprint | 13.5 | 13.5 | Nunito Sans | 500 | faint |
| **split** (`.hx-copy`) | title `h2` | 24 | 33 | Fraunces | 600 | ink |
| | subtitle `.hx-kick` | 17 | 18 | **Nunito Sans** | 700 | mid |
| | body `p` | 15 | 16 | Nunito Sans | 500 | soft |
| **two-col** (`.hx-tcol`) | title `h2` | 19 | 24 | Fraunces | 600 | ink |
| | subtitle `.hx-kick` | 17 | 18 | **Nunito Sans** | 700 | mid |
| | body `p` | 15 | 15.5 | Nunito Sans | 500 | soft |

### Rules

- **Serif is for headings.** Section subtitles are sans. A serif subtitle above sans body at the
  same size reads as *"there are multiple fonts on this card"*, not as a hierarchy — that is the
  founder's exact wording when he caught it.
- **The hero subtitle keeps the serif.** It sits under a 47px H1 doing a subtitle's job, not a
  lead-in's. It is the one exception and it is deliberate.
- **A subtitle must clear its body by ≥1.5px.** Weight and colour alone are not enough; if the sizes
  match, people see two fonts. Enforced.
- Four ink levels descend with the size: ink → mid → soft → faint. Never skip or invert.

---

## 4. The specificity trap (read this before adding any class)

**`.homex .hx-copy p` is `(0,2,1)`. A bare `.homex .hx-yourclass` on a `<p>` inside `.hx-copy` is
`(0,2,0)` and loses.** The class silently does nothing. The source says one size; the browser
renders another.

Three classes shipped to production broken this way:

| Class | Declared | Actually rendered |
|---|---|---|
| `.hx-lede` | 21px | body size, for months |
| `.hx-fineprint` | 13.5px | body size — this is why the hero fineprint ate the first screen |
| `.hx-kick` | its own size | body size — the "why is the subtitle the same size as the text" report |

**Write it as `p.that-class`:**

```css
.homex .hx-copy p.hx-lede { font-size:16px; }
.homex .hx-copy p.hx-fineprint { font-size:13.5px; color:var(--h-faint); }
.homex .hx-twocol .hx-tcol p.hx-kick { … }
```

Never rely on source order to win a tie — a later rule at equal specificity works until someone
reorders the file.

### Related traps, all found the same way

- **`var()` on an element where the token is not declared does not fall back.** `background:
  var(--h-page)` on `body` — where `--h-page` is declared on `.homex` — makes the declaration
  invalid at computed-value time, which resets `background` to its *initial* value. It cleared the
  gradient and gave a plain white page. Use a literal outside the token's scope.
- **`padding: X 0` on an element that IS the `.hx-wide`** zeroes the 26px horizontal inset it
  inherits. `.hx-twocol` did this and ran edge to edge on phones while every other block sat at 26.
  Use `padding-top`/`padding-bottom`.
- **Grid `1fr` tracks carry `min-width:auto`.** Long words overflow. `.hx-split > * { min-width:0 }`.
- **`text-align:center` on a hero container cascades into the phone mock**, centring the app rows so
  they wrap mid-name and look broken. Scope centring to `.hx-copy`, never the whole split.

---

## 5. Heading register

The rule that replaced *"every heading should state an outcome"*, which was applied uniformly and
stripped the page of feeling.

**The heading's register matches the section's job.**

| Section job | Heading | Example |
|---|---|---|
| belonging, promise, stance, permission | the **felt** line | *Caring for a baby was never meant to be carried alone.* |
| utility, coverage, mechanism | the **concrete moment** | *The six-week check, already written down.* |
| both fit | felt line as title, moment as subtitle | ↑ stacked |

Notes:

- **Punchy means shorter.** If a rewrite makes headings longer, it is not punchier however concrete
  it is. Six words beat twelve.
- **Don't apply one fix to all eight headings.** An audit finding tells you what a page is missing,
  not that the missing thing should replace what is there. Uniformity removes the contrast that made
  the good instances good.
- Check for **within-page duplication** after writing: a benefit line once repeated the eyebrow of
  the section directly below it, verbatim.
- Voice constraints are unchanged and still binding: `DESIGN.md` §A7 — warm, brief, second person,
  no jargon, no guilt, **no em-dashes**, sentence case.

---

## 6. Verify before shipping

Source is not evidence. Every bug in this document was invisible in the CSS and obvious in the
browser.

```bash
node tools/serve.js &                                    # or PORT=8099 in a worktree
node tools/marketing_type_check.js http://localhost:8080  # this document, enforced
node tools/grid_check.js http://localhost:8080
node tools/home_truth_check.js http://localhost:8080
python3 tools/seo_check.py
```

Then **look at the rendered page** at 320, 390 and 1440. Not the file.

- **Measure computed styles, not declared ones.** `getComputedStyle`, not a grep of `site.css`.
- **320px is not optional.** A 6px overflow only appears there, and puppeteer's `isMobile:true`
  skews the viewport to ~326px and hides it. Set an explicit width.
- **`.hx-rail` is a false positive** in any overflow sweep: it is `overflow-x:auto` and its cards
  are *meant* to extend past the viewport. Check `document.documentElement.scrollWidth`, and walk
  ancestors for a scroll container before reporting an element as spilling.
- In a shared checkout, **pass an explicit base URL**. `tools/serve.js` defaults to `:8080`, which
  may be another worktree's server, and you will grade code that is not yours.

---

## 7. Change log of findings

| Date | Finding |
|---|---|
| 2026-08-15 | Heading register rule replaces "every heading is an outcome"; 20 original titles restored with moments as subtitles |
| 2026-08-15 | `.hx-hero-split` centring cascaded into the phone mock; scoped to `.hx-copy` |
| 2026-08-15 | `.hx-twocol` `padding:6px 0` zeroed the page inset on phones |
| 2026-08-16 | Fixed body gradient made fold contrast vary with scroll (8.2–24.4); page base flattened, constant 15.5 |
| 2026-08-16 | `var()` outside a token's scope resets rather than falls back; white-page incident |
| 2026-08-16 | `.hx-copy p` specificity had silently disabled `.hx-lede`, `.hx-fineprint` and `.hx-kick` |
| 2026-08-16 | `tools/marketing_type_check.js` added so none of the above can regress |
