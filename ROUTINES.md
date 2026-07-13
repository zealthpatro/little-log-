# Cubby Pro — Ritual Manager (spec)

> **Naming (June 2026):** the product term is now **"ritual"** (warmer than "routine"; see CHANGELOG v0.15.0). The shipped free daily checklist is the **Rituals** tab in the Log area; this spec is the deeper Pro **Ritual Manager**. The persisted data key stays `b.routines` for data-compatibility, so code/comments still say `routine*` even though the UI says "ritual".

> **Status (June 2026):** Still a planned Cubby Pro feature, not yet built; it lands once Pro billing goes live (targeted Aug 2026) within the one Cubby that spans Trying, Expecting, Baby and Child. Full current state + go-live plan: HANDOFF.md.

Status: **planned Pro feature, on the waitlist.** Not built. This is the design + content spec
so it's ready to build once Pro demand is validated.

## What it is
Age-aware daily **ritual suggestions** that adapt to your baby as they grow (day 0 to 365) and
re-flow when real life happens. Cubby already *logs* what happened; the Ritual Manager gently
suggests *what tends to come next* (next feed window, nap window, tummy time, etc.) and nudges
for it (push = Pro).

## The golden rule (non-negotiable framing)
Pediatric guidance is **responsive feeding and following your baby's cues**, especially for
newborns — never a rigid clock. So the Ritual Manager is:
- **Suggestions, not alarms.** Soft "nap window opening soon", never "FEED NOW".
- **Cue-first.** Always "watch your baby, not the clock"; the schedule yields to hunger/sleepy cues.
- **Wake-window based** (age-appropriate awake time), which is gentler and more accurate than fixed
  feed/nap intervals.
- **Disclaimered.** "General guidance, not medical advice. Follow your pediatrician." Never restrict
  feeding by clock. This stays true to Cubby's wellbeing-first, no-guilt voice.

## Lifecycle stages (general guidance — varies per baby; sources differ)
| Stage | Wake window | Feeds/day | Day sleep | Nappies/day | Activities to surface |
|---|---|---|---|---|---|
| Newborn (0–6 wk) | 45–60 min | ~8–12 (on demand) | many naps, 14–17h total | 8–12 | skin-to-skin, tiny tummy-time bursts, vitamin D (ask ped) |
| 6 wk–3 mo | 60–90 min | ~7–9 | 4–5 naps | 6–10 | tummy time, gentle play, fresh air (shade) |
| 3–4 mo | 75–120 min | ~6–8 | 3–4 naps | 6–8 | tummy time, reach/grasp play, outdoors |
| 4–6 mo | 2–2.5 h | ~5–6 (+ solids ~6mo) | 3 naps | 5–7 | solids intro, sitting practice, bath routine |
| 6–9 mo | 2.5–3 h | milk + 2–3 solid meals | 2–3 naps | 5–6 | self-feeding, crawling play, books |
| 9–12 mo | 3–4 h | milk + 3 meals | 2 naps | 4–6 | walking practice, social play, routine wind-down |

Notes: ranges are typical, not targets. Sun: avoid direct sun under ~6 months; shade + cover; brief
vitamin-D-friendly exposure only per pediatric advice (region-dependent).

## Activities across the lifecycle (the "more than feed/sleep" part)
Skin-to-skin (newborn ++), tummy time (from week 1, growing), time outdoors / fresh air (shade for
infants), reading aloud, infant massage, bath as a wind-down anchor, sensory/play by stage. Each
surfaced when age-appropriate.

## Adaptive logic
1. **Pick a style** at setup: *Responsive* (cue-led, loose) or *Rhythm* (more structured). Default
   Responsive.
2. Cubby builds an **age-appropriate template** (wake windows + typical feed cadence + activities).
3. **It anchors off real logs, not the clock.** Last feed/nap (already logged) → "next feed window
   ~X:XX", "awake since 9:10, nap window ~10:10–10:40".
4. **Re-flows on change.** Log a feed early/late, or a long nap → all downstream suggestions shift
   automatically. No "you're behind schedule" guilt — it just rebases.
5. **Stage transitions.** As the baby ages, wake windows/feeds auto-advance to the next stage
   (with a gentle "your ritual is growing 🐻" note).
6. **Pro nudges.** Optional push when a window opens ("nap window opening soon"). In-app always.

## Data model (when built)
```
households/{hid}.app.routine = {
  style: 'responsive'|'rhythm',
  enabled: bool,
  custom: { wakeWindowMin?, feedEveryMin?, activities?:[...] }   // user overrides
}
```
Suggestions are computed live from `events` + baby age; no per-day storage needed.

## Build phases (later)
1. Read-only "what's next" card on Home (wake-window + next-feed suggestion from logs). No push.
2. Stage templates + activity suggestions + the Responsive/Rhythm toggle + overrides.
3. Pro push reminders for opening windows (needs Blaze, see EMAIL.md).
4. (Stretch) personalization from the baby's own logged patterns — the Huckleberry-style moat.

## Why it's a strong Pro anchor
Research (PRO.md): data-driven sleep/routine guidance is the clearest feature parents pay for.
This is Cubby's version — warm and cue-first, not a drill sergeant.
