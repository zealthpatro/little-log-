# Component log

Every piece of UI goes through four stages. This file is the record of where each one is, so
nothing gets built that was never shown, and nothing that was approved gets quietly lost when a
session ends.

    1. RENDER    an HTML mockup of what is intended          -> design/components/*.html
    2. APPROVE   the founder reacts                          <- a real gate
    3. FIGMA     the component, with its description         -> deferred, see below
    4. BUILD     scalable, loveable, best in class, on brand -> code, behind the gates

**Stage 3 is deferred, deliberately.** Figma is connected and works
(`whoami` -> Saurav Patro), but the only writable seat on this account is on a team called
**Health passport** (`team::991585478486878876`, Full). The other, **Saurav's Starter team**
(`team::1564945629291242088`), is a **View** seat: nothing can be created there.

Rather than file Cubby's design system inside a team named after a different product, the specs
live in `design/components/cubby-components.html` in the exact shape Figma needs: component paths,
description strings, properties, variants, anatomy, and the variable each part binds to. When a
Cubby team exists, publishing is transcription. The order to publish in is the last section of
that file.

---

## Widgets — home screen

| Component | Render | Approved | Figma | Built |
|---|---|---|---|---|
| `Widget / Part / StatusCell` | 2026-09-28 | 2026-09-29 | waiting on a team | — |
| `Widget / Part / ActionButton` | 2026-09-28 | 2026-09-29 | waiting on a team | — |
| `Widget / Part / Header` | 2026-09-28 | 2026-09-29 | waiting on a team | — |
| `Widget / Post birth / Medium` | 2026-09-28 | 2026-09-29 | waiting on a team | blocked: after the first App Store submission |
| `Widget / Post birth / Small` | 2026-09-28 | 2026-09-29 | waiting on a team | blocked: same |
| `Widget / Post birth / Lock screen` | 2026-09-28 | 2026-09-29 | waiting on a team | blocked: same |
| `Widget / Pregnancy / Quiet` (default) | 2026-09-28 | 2026-09-29 | waiting on a team | blocked: same |
| `Widget / Pregnancy / Detailed` (opt-in) | 2026-09-28 | 2026-09-29 | waiting on a team | blocked: same |

Render: Design canvas, https://claude.ai/artifact/5uT24tX7nHpn1MSxGQKhWm (private).
Spec: `design/components/cubby-components.html`.

**What the build needs before it can start**, none of which exists yet:
- a tracked source directory for Swift, because `/ios/` is gitignored (`.gitignore:26`) and anything
  added in Xcode dies on the next `npx cap sync`
- an App Group, so a widget process can read what the app knows; there is no shared container today
- `tools/cap_ios_configure.rb` taught about a second target — line ~190 is
  `project.targets.find { |t| t.name == 'App' } or abort`
- `tools/cap_ios_build.sh` extended to inspect the `.appex`, not only `$APP`

---

## Rejected, with the reason kept

Recorded so the same idea does not arrive again in six months as a fresh suggestion. Full reasoning
in the Rejected section of the spec sheet.

| Idea | Why not |
|---|---|
| Pregnancy multi-status grid (kicks, BP, weight, contractions, mood) | Tells the room; medical dashboard on glass; four of five are `ownerOnly`; two are empty before 28 and 36 weeks |
| Streak, daily total or target on the post-birth widget | Fails the Anxiety Test; a streak punishes the night she could not log |
| A fourth statistic on the medium widget | Halves the number size, and the number is the reason to look |
| Pregnancy on the lock screen, in any form | A lock screen renders without unlocking |
| Pro gate on the glance widget, or on any widget or quick-action logging button | Breaks four published promises, e.g. pricing:68 "We'll never paywall logging or caregiver sharing" and how-it-works:156 "The things you reach for at 3am are the free ones". Rejected 2026-09-30 |
| Pro gate on widgets or quick actions in iOS before In-App Purchase exists | Apple 3.1.1: unlocking a feature inside the app requires IAP, and there is no StoreKit. Deferred, not rejected: see docs/plans/2026-09-30-pro-gating-widgets-verdict.md |
| "Widget looks" as the Pro element | Costs a picker, storage, a taste counter and lapse rules; palettes are invisible on lock screen, tinted and StandBy. Sells nothing. Rejected 2026-09-30 |
| A `go('home')` fallback for a wrong-stage deep link | Changed nothing visible: the pregnancy shell ignores `view`, so before and after were identical. Reverted 2026-09-26 |

---

## Shipped without a widget stage

Recorded for completeness: these were invisible changes, so there was nothing to draw.

| Change | Date | Note |
|---|---|---|
| Manifest `shortcuts` (Feed, Sleep, Nappy) | 2026-09-26 | Long-press an installed Cubby. Android and desktop today; iPhone needs the native half |
| `sw_cache_guard` derives the bump list from the service worker | 2026-09-26 | The old pattern missed 8 of 30 precached assets, including the manifest |
| `deploy-excl(live)` asks production instead of localhost | 2026-09-24 | Had never once checked production |
| App Review notes rewritten | 2026-09-29 | Text for Apple, not a screen. The August draft sent the reviewer to a "Care" tab that does not exist and promised a vaccine schedule in progress and a shared photo album the seeder never writes |
