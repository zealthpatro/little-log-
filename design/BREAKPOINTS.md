# Responsive breakpoints — full map (2026-07-12)

## App (`/app/`) — mobile-first, single column by design
No tablet/desktop reflow; the one wide-screen rule frames the mobile UI as a centered "phone card".

| Where | Query | Effect |
|---|---|---|
| app/index.html:935 | `min-width: 900px` | Body 28px vertical padding; `#app` becomes centered phone-frame card (rounded 34px, shadow, `height:calc(100dvh-56px)`); bottom sheets float (bottom 28px, radius 30px). **No content reflow.** |
| app/index.html:202 | `prefers-reduced-motion` | Ticker roll animation disabled |
| app/index.html:5663 | `print` | `.noprint` hidden (doctor report) |
| store-firebase.js:82 | `min-width: 480px` | Modals center instead of bottom-sheet; fully rounded |
| cubby-extras.js:330 | `min-width: 480px` | Time/date picker centers; fully rounded |
| landing.js:112 | `max-width: 520px` | Pro comparison grid → 1 column |
| landing.js:116 | `max-width: 480px` | Landing feature grid → 1 col; hero name 40→34px |

## Marketing (`site.css`)
| Query | Effect |
|---|---|
| `min-width: 1200px` | Wide-desktop layout bump (L192) |
| `max-width: 900px` | `.proof` grid → 2 cols |
| `max-width: 860px` | `.hx-split` → 1 col, phone above copy; hero split centers |
| `max-width: 820px` | `.hx-cap-grid` → 2 cols |
| `max-width: 760px` | `.hx-twocol` → 1 col |
| `max-width: 680px` | `.hx-price-grid` → 1 col |
| `min-width: 641px` | Larger-screen slide layout |
| `max-width: 640px` | Global small-screen: hero, `.slide` stacks (phone first), `.feats`/`.quotes`/`.cmp` → 1 col, folds stack/reorder, install band |
| `max-width: 620px` | Lifecycle journey dots/labels shrink |
| `max-width: 600px` | `.exp-strip` stacks, full-width CTA |
| `max-width: 560px` | `.hx-rev-grid` → 1 col |
| `max-width: 540px` | `.hx-cap-grid` → 1 col; rail cards 78vw |
| `hover:hover + pointer:fine` | Rail arrow hover styling |
| `hover:none / pointer:coarse` | Rail arrows hidden on touch |
| `prefers-reduced-motion` | Rail smooth-scroll/transitions off |

## Articles & vaccine pages (`vax.css`)
| Query | Effect |
|---|---|
| `max-width: 640px` | h1/lede shrink; table cell padding/font shrink |

## Gaps
- No true tablet/desktop app layout (accepted: phone-frame approach).
- A11y roadmap items intersecting breakpoints: A2 date-picker disabled-date contrast, A3 sheet close targets <44px (WCAG 2.5.5), A1 `:focus-visible` missing (2.4.7).
