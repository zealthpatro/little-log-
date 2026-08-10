# The teaching layer

**Status: SHIPPED 2026-08-10, sw v279–v296, live on little-cubby.com.** The iOS wrapper
remote-loads the same `/app/`, so TestFlight has it without a build.

Cubby has built far more than it has ever explained. 148 entry points exist across the shell and the
runtime modules; 122 of them are real capabilities; about 20 have ever had a word written about them.
This is the layer that closes that, and the budget that stops it becoming noise.

---

## 1. The doctrine change

ONBOARDING.md said, as of 2026-08-08:

> Pull, never push. If anything ever makes it open on its own, it has become the tour this line rules out.

That line was right about the failure mode and wrong about the remedy. Banning the push also banned
the only way a parent hears about a feature they have never seen. It is replaced by:

> **Cubby may speak first, but only once, only when the parent's own data has earned it, and never
> while something is wrong.**

The distinction the old line was protecting is preserved in full: no chained tour, no blocking
dialog, nothing between a parent and the log. What changes is that a rationed, data-earned cue is now
permitted where a pushed tour is still not.

## 2. Two guards, doing different jobs

The first draft of this design said "one token per session" and also "ten opens in a night is still
one token". Those cannot both be true. Untangling them produced the model that survives, and the
separation is load-bearing:

| Guard | Limits | Mechanism |
|---|---|---|
| **The allowance** | volume, on a good day | 3/day to day 14, 2/day to day 60, 1/day after. Max one per session. 90-minute cooldown. |
| **The ranking** | inappropriateness, on a bad day | value score decides which eligible cue wins. Hard refusals run *before* scoring. |

**Raising the allowance does not weaken the bad-day protection.** On a fever morning the keepsake cue
still loses to the visit summary because of the ranking, at any budget. Conflating the two is what
produced a system that was quiet for the wrong reason.

**Hard refusals, checked before anything is scored:**

1. `lossHolding` is in effect — nothing renders, ever. The holding screen is the whole screen on purpose.
2. A sheet or overlay is already open.
3. The cue has been seen. Pull and push share one `seen` key, so asking a question via the info dot
   can never be punished with an unsolicited lecture about it later.
4. The trigger has gone stale.

*Held* is not *denied*. A held cue keeps its eligibility and competes again another day. Only
**seen**, **stale** and **refused** are permanent — which is what stops a rationed system quietly
becoming a mute one.

## 3. Reach comes from triggers, not from budget

78 of the 122 rows carry an `earn` trigger, across 43 distinct events. The other 44 have no mechanism
to push at all — by construction, not by discipline.

This is the correction that mattered most during design. An early model reached only ~8 cues in a
parent's first month; the cap was barely binding, because only 25 rows had been given a trigger.
**Trigger coverage is reach.** The budget only shapes how it is spread.

Every trigger is an event Cubby already detects from data it already holds. Nothing is inferred and
nothing is predicted — the standing rule is *refuse to predict where the parent cannot check the
answer*, and a teaching cue is not an exception to it.

## 4. Six surfaces, three of which can spend

| Surface | Who starts it | Cost |
|---|---|---|
| Info dot | the parent | free, always |
| How-to index + search (Settings) | the parent | free, always |
| Ambient (empty states, per-tab "more here") | nobody — it is furniture | free, not a cue |
| First-open mark | the app, once per surface | spends |
| Earned nudge | the parent's own data | spends |
| Monthly door | the app, once a month | spends once, teaches 6–8 |

The **monthly door** is the long-tail answer: one card opening one screen that carries six to eight
unmet capabilities ranked by the parent's data. A destination someone chose to open is a place where
density is welcome.

**Ambient is not a cue and must never ask the ledger for anything.** An empty Stats screen explaining
what Stats is for is simply what an empty screen should say.

## 5. The registry

One row per capability in `app/teach-data.js`. Every surface renders from it; the marketing FAQ
section generates from it.

```js
vaccineCountry: {
  label:'Vaccine schedule', fn:'openVaccineCountry()', where:'care',
  one:'The schedule for where you are, already filled in.',   // dot · search · FAQ
  what:'…', get:'…',                                          // chapter: mechanic, honest return
  who:{ stage:['baby','child'], role:'any', months:[0,null] },
  earn:{ on:'birthday-set', fresh:'7d' },                     // absent = can never push
  faq:['what-vaccines-does-cubby-track'], read:'vaccines-explained'
}
```

**Depth is a property of the row, and it decides the frame as well as the words.** Every row carries
`one` and toasts (56). Rows that also carry `what`/`get` open a compact dialog (48). Rows that also
carry `why`/`matters`/`how`/`payoff` take the full screen (18). Rows that carry `earn` may compete
for the allowance (78). Nothing is padded to earn its container: *Recently deleted* gets a sentence,
not a three-screen story.

Writing this content twice is what guarantees drift, and drifted teaching copy is worse than none: it
tells a parent something the app no longer does. The FAQ/JSON-LD lockstep and the Pro launch date
that had to be chased through 22 places are the same lesson, already paid for once.

## 6. The classification (frozen)

148 entry points, extracted from `app/index.html` **and every runtime module**, then reconciled back
against the extraction with zero missing and zero invented.

| Bucket | Count | Why |
|---|---|---|
| **Taught** | **122** | 18 pages, 48 chapters, 56 one-liners, 78 with triggers |
| Plumbing | 14 | `openSheet` (131 call sites — it *is* the sheet), pickers, loader, read renderers, and `openNote` which is a dead alias with zero callers |
| Dormant | 6 | `FEATURES = { den: false }`. An answer for a door that will not open is a lie with a shelf life |
| Already a cue | 6 | `openFeverNudge`, `openKeepsakeNudge`, `openInstall`, `showBirthArrival`, and the two first-run screens |

By domain: Pregnancy 29 · Everyday logging 23 · Health 19 · Memories 17 · Account 16 · Circle 12 ·
Trying 6.

**The count was wrong twice before it was right**, and both errors are the argument for the coverage
gate. A grep of the shell alone misses `openVoiceLog` (`voice-log.js`), `openFamily` and
`openFirstRun` (`store-firebase.js`) and the pickers (`cubby-extras.js`); and four entry points are
`window.X = function` assignments that no `function open*` pattern catches. `openFamily` is the circle
screen — the single biggest differentiator in the product — and it was missing from the first audit.

## 7. Three blocking gates

Every guardrail needs an owner and a blocking check. These live beside `tools/guide_test.js`.

1. **Coverage** — enumerate every entry point across the shell and all modules, including
   `window.X = function` forms. Each is in the registry or on `NO_TEACH` **with a written reason**.
2. **Voice** — mechanical, so quality does not sag at entry ninety: no em-dashes, sentence case,
   length caps, and a banned list for guilt (*you haven't*, *don't forget*, *you should*) and jargon.
3. **Ledger** — assert two cues cannot fire in one session; assert nothing fires under `lossHolding`.
   Simulated, not reasoned about. A check that only passes in the morning is not a check.

## 8. Hard rules

- **Loss safety is absolute.** No cue, dot, mark or toast over the holding screen. Checked before scoring.
- **Mood is owner-only, in the answer search too.** Gating the dot but leaving the row findable would
  leak the existence of a private record to a caregiver.
- **Pro copy cannot imply it is buyable.** Registration only until October 2026, gated at the row.
- **Every overlay mounts on `document.body`.** Touching the shell invalidates `paintShell`'s diff
  cache and kills iOS scroll momentum. Same pattern `log-guide.js` already follows.
- **`teach-data.js` joins the `sw.js` precache list** and the version bumps, or an offline launch gets
  a shell whose teaching layer is missing.
- **Delete `openNote`.** A dead alias with zero callers should not survive the audit that found it.

## 9. Build order (all done)

1. ~~Freeze the classification as a gate fixture.~~ 148 entry points, 122 taught, 26 excluded.
2. ~~Registry schema, ledger, and the three gates.~~ Gates before content, and it paid: the very
   first run found mood ungated and a dose calendar outranking a fever.
3. ~~Port the existing 20.~~ Six chapters came across verbatim from `log-guide.js` rather than
   being rewritten, because rewriting reviewed copy is how voice drifts.
4. ~~Write the rest.~~ 18 pages, 48 chapters, 56 one-liners. Every row has an answer.
5. ~~Wire the surfaces.~~ All six, plus a teaching dot on 33 of 33 bottom sheets, injected from the
   one `openSheet` primitive rather than 131 call sites.
6. **Not done: generate the marketing FAQ section from the registry.** Every row carries the copy it
   needs, so this is wiring rather than writing, but until it exists the drift the registry was
   built to remove is still possible on the marketing side.

## 9a. What changed from this plan, and why

- **A third depth appeared.** The plan had `one` and `chapter`. Four capabilities whose benefit is
  not obvious from the button (nappies, illness, the visit summary, your circle) needed more, and
  that became `page`, then 18 of them.
- **Depth decides the frame, not just the words.** Chapters first opened a toast, then briefly the
  full screen a page uses, which read as 60 per cent empty. Inflating 48 chapters to fill a screen
  would have meant inventing content, so the presentation shrinks to fit instead: a toast for a
  one-liner, a dialog for a chapter, the screen for a page.
- **The allowance replaced "one token per session".** The original wording also said ten opens in a
  night is one token, and those cannot both be true. Untangling them separated *volume* (the
  allowance) from *inappropriateness* (the ranking), which are different jobs.
- **Reach came from triggers, not budget.** An early model reached 8 cues in a parent's first month.
  The cap was barely binding; only 25 rows had a trigger. At 78 it reaches ~34.
- **No answer search or monthly door in the first pass**, both shipped later at v287.
- **The guide card outranks the earned cue rather than taking its turn.** Routing it through the
  ledger broke two `guide_test` assertions, and the test was right: a second caregiver joining a
  household with 400 logged feeds is exactly who needs "what to log, and why" before they need a tip.

## 10. Open

- **The marketing FAQ is still hand-maintained.** See step 6 above.
- **No real-parent evidence.** Every number here comes from simulation and a headless browser. The
  allowance constants (3/2/1, 90 minutes) live in one place and should be tuned against testers
  rather than argued in advance.
- **Which capabilities deserve a page rather than a dialog** is a judgement call. The 18 were chosen
  because their benefit is not obvious from the button; that list is worth a founder review.
- **Two inline tip lines stay ungoverned** (growth, heatmap), on the judgement that furniture is not
  an interruption. Reversible in one line.
