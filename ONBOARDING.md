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

## The teaching layer (shipped 2026-08-10, sw v279–v296)

One registry, `app/teach-data.js`, carries every capability the app has: **148 entry points across
the shell and the runtime modules, of which 122 are real capabilities** and 26 are excluded with a
written reason each (plumbing, dormant behind `FEATURES.den`, or already a cue). Every teaching
surface renders from it, so the content cannot drift from itself.

**Depth is a property of the row, and it decides the frame as well as the words.** Nothing is padded
to earn its container:

| Depth | Count | What it opens |
|---|---|---|
| `one` | 56 | a toast. One sentence does not deserve a screen |
| `chapter` | 48 | a compact dialog, sized to two paragraphs and an action |
| `page` | 18 | the full screen: why it is worth doing, what matters, how it works, the payoff |

**Six surfaces, and only three can interrupt.** Info dot (every capability, free), how-to index with
search (Settings, free), ambient empty states (free), first-open coach mark (spends), earned nudge
(spends), monthly door (spends once, teaches eight). 78 of the 122 rows carry a trigger; the other
44 **cannot push at all**, by construction rather than discipline.

Three blocking gates in CI (`tools/teach_gate.js`, 4,813 checks): coverage — every entry point is
taught or excluded with a reason, across the shell *and* the modules; voice — no em-dashes, no
guilt words, sentence case, length caps; ledger — simulated against a fixed clock, so nothing fires
under `lossHolding` and two cues cannot fire in one session.

## Cue toolkit (mechanisms we have)
| Mechanism | Best for |
|---|---|
| Sign-in value strip | First impression / why Cubby (pre-login) |
| First-run setup | Identity (bear + relationship) |
| Home "Get started" checklist | Tier-1 activation, with progress. **Shipped** |
| Greeting + personal line | Warmth, daily re-engagement |
| Coach marks (per tab) | One-time "what is this tab". **Now rationed by the ledger**, so four cannot fire in one session |
| Inline tips (per feature, dismissible) | Tier-2 just-in-time. Deliberately left ungoverned: they sit inside the section they describe and cover nothing, which is furniture rather than an interruption |
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

## Recommended minimal build (superseded 2026-08-10 by the teaching layer above; kept for the reasoning)
1. **Home "Get started" checklist** — for brand-new accounts only, a small card with 2–3 steps:
   `Add your baby ✓` · `Log your first feed` · `Invite a co-parent`. Each row checks off as
   it's done; the whole card **auto-disappears once complete or dismissed**. This is the single
   best activation tool — teaches the top value props with progress, zero tour.
2. **Sign-in value strip** — 3 short bullets under the logo: *Log in seconds · Share with family,
   live · Private to you*. Sets the "why" before the sign-in buttons (Google, Apple, email magic-link).
3. Keep the just-in-time tips already shipped; add new ones **only where testers show confusion**
   (let feedback drive this, don't pre-add).

## Explicitly NOT building (avoid over-commitment)
- Multi-screen carousel tour / video walkthrough — meaning one that is **pushed**: auto-opened,
  blocking, or standing between a parent and the thing they came to do.
  **Amended 2026-08-08**, after a real user reported that the Notes card on the home screen did
  nothing for them and asked instead for something they could go back to that explained what each
  log is for. A user-initiated reference guide is now in scope and shipped
  (`app/log-guide.js`, "What to log, and why"). It is not a tour, and the distinction is the whole
  point: it never opens itself, never blocks, has no progress meter and no completion count, is
  offered on the home screen exactly once, and lives permanently in Settings so it is still there
  the week after, when the question actually arrives.

  **Amended again 2026-08-10, and this one reverses a line rather than widening it.** That line
  said *"Pull, never push. If anything ever makes it open on its own, it has become the tour this
  line rules out."* It was right about the failure mode and wrong about the remedy: banning the
  push also banned the only way a parent hears about a feature they have never seen. Measured, a
  fresh profile tapping through four tabs was already being shown **five cues in one session** —
  the chained tour this file rules out, live, because the rule had no mechanism behind it. The rule
  now reads:

  > **Cubby may speak first, but only once, only when the parent's own data has earned it, and
  > never while something is wrong.**

  What protects it is a budget rather than a promise (`app/teach.js`): an allowance of 3 cues a day
  to day 14, 2 to day 60, then 1, never more than one per session, with a 90-minute cooldown; a
  ranking so a keepsake can never outrank a fever; and hard refusals checked *before* scoring, so
  `lossHolding` can never be out-argued by a high-value cue. Pull surfaces stay unmetered and
  unlimited. Full design: `docs/plans/2026-08-10-teaching-layer.md`.
- A heavy public marketing landing page — that's a **growth-phase** task for `little-cubby.com`
  (hero, screenshots, testimonials, CTA). For the 20 close testers, the sign-in value strip is
  enough; they're invited and already trust the sender.

## Success signal
A new caregiver should reach **first log** and **first invite** in their first session without
reading anything they didn't want to. If testers miss a feature, add ONE targeted tip — not a tour.
