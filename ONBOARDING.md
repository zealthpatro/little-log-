# Cubby — Onboarding & education plan

> **Status (June 2026):** This in-app onboarding plan still stands; it now spans the full Cubby lifecycle (Trying → Expecting → Baby → Child) with the pregnancy track merged + live, so first-run education should cover whichever stage a caregiver starts in. Full current state + go-live plan: HANDOFF.md.
>
> **Update (2026-06-17):** Sign-in now offers three methods — **Continue with Google**, **Continue with Apple**, and **email magic-link**. "Continue with Apple" appears on both the landing and auth-card sign-in screens. First-run education and the sign-in value strip should reflect all three.

How we teach Cubby's value without a tour, a wall of tips, or added complexity.

## Principles
1. **Just-in-time, in context** — teach each thing at the moment it's relevant, not upfront.
2. **One cue at a time**, always **dismissible** and **non-blocking**.
3. **Value-first wording** — the benefit, not the button ("Both of you see the same log live",
   not "tap Invite").
4. **Earned disclosure** — get the core loop working first; reveal advanced features later.
5. **Wellbeing-first** — encouraging, never guilt or pressure (no "you haven't logged" nags).
6. **Don't overbuild** — no multi-screen tour, no video. Reuse the cue toolkit we already have.

## What needs to be educated (inventory, tiered)

**Tier 1 — Activation (actively guide in the first session):**
- Add your baby (and twins).
- Log your first entry (the one-tap Quick Log).
- Invite a co-parent (the core differentiator: shared, live log).

**Tier 2 — Just-in-time (cue only at the relevant moment):**
- The time strip — "log something that happened earlier."
- Live timers — start/stop a nap or feed.
- Growth percentiles — pick Boy/Girl to see WHO/CDC curves.
- Heatmap — week/month "at a glance".
- Fever → doctor: prepare a visit summary.
- Set baby's profile photo / customise bear.
- "logged by" attribution (self-explains once a 2nd caregiver joins).

**Tier 3 — Passive discovery (available; light or no cue):**
- Keepsakes (memory card, birth poster, milestones), photo slideshow.
- Stats charts, vaccine schedule, illness tracking.
- Themes (light/night), remove member, export data, send feedback.

## Cue toolkit (mechanisms we have)
| Mechanism | Best for |
|---|---|
| Sign-in value strip | First impression / why Cubby (pre-login) |
| First-run setup | Identity (bear + relationship) |
| Home "Get started" checklist *(proposed)* | Tier-1 activation, with progress |
| Greeting + personal line | Warmth, daily re-engagement |
| Coach marks (per tab) | One-time "what is this tab" |
| Inline tips (per feature, dismissible) | Tier-2 just-in-time |
| Banners (fever / appt / meds / month-iversary) | Time-sensitive value |
| Empty states | Teach the first action of an empty screen |
| Toasts | Confirm + occasional delight |
| Post-photo prompt | "Use as profile?" |

## Feature → cue → status
| Educate | Cue | Status |
|---|---|---|
| Log first entry | Empty states + Quick Log + checklist | mostly there |
| Invite co-parent | Home checklist + share tip | tip shipped; checklist proposed |
| Time strip | Inline tip in a log sheet | shipped (Log) — add 1 in a sheet |
| Growth Boy/Girl | Inline tip on Growth | shipped |
| Heatmap | Inline tip on Log | shipped |
| Fever summary | Auto nudge + banner | shipped |
| Bears/relationships | First-run + family menu | shipped |
| Profile photo | Post-photo prompt | shipped |
| Keepsakes/stats/themes | Passive (let them find) | intentionally no cue |

## Recommended minimal build (highest leverage, lowest complexity)
1. **Home "Get started" checklist** — for brand-new accounts only, a small card with 2–3 steps:
   `Add your baby ✓` · `Log your first feed` · `Invite a co-parent`. Each row checks off as
   it's done; the whole card **auto-disappears once complete or dismissed**. This is the single
   best activation tool — teaches the top value props with progress, zero tour.
2. **Sign-in value strip** — 3 short bullets under the logo: *Log in seconds · Share with family,
   live · Private to you*. Sets the "why" before the sign-in buttons (Google, Apple, email magic-link).
3. Keep the just-in-time tips already shipped; add new ones **only where testers show confusion**
   (let feedback drive this, don't pre-add).

## Explicitly NOT building (avoid over-commitment)
- Multi-screen carousel tour / video walkthrough.
- A heavy public marketing landing page — that's a **growth-phase** task for `little-cubby.com`
  (hero, screenshots, testimonials, CTA). For the 20 close testers, the sign-in value strip is
  enough; they're invited and already trust the sender.

## Success signal
A new caregiver should reach **first log** and **first invite** in their first session without
reading anything they didn't want to. If testers miss a feature, add ONE targeted tip — not a tour.
