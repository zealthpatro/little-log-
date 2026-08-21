# Cubby user flows and edge cases, tested rather than listed

**2026-08-15.** Every claim here comes from driving the real app in a real browser. Two tools, both
runnable and both wired into `node tools/gates.js`:

```bash
PORT=8123 node tools/serve.js &
node tools/flow_walk.js  http://localhost:8123     # every reachable flow, every stage, 2 levels deep
node tools/edge_probe.js http://localhost:8123     # the boundary states a real family hits
```

---

## 1. The flow inventory is not a list somebody wrote once

`app/teach-data.js` already registers **123 user entry points**, each with the life stage it belongs
to, and `tools/teach_gate.js` keeps that registry honest against the code (5091 assertions). So the
walk drives the registry rather than a hand-written list that would rot in a fortnight.

| domain | entry points |
|---|---|
| pregnancy | 29 |
| log | 23 |
| health | 19 |
| memories | 17 |
| account | 17 |
| circle | 12 |
| trying | 6 |

Stage gating: 42 baby/child, 29 pregnancy, 6 planning, the rest ungated.

## 2. What the walk found: nothing broken

**362 flow openings** across four stages (planning, pregnancy, baby, child), each in a **furnished**
state and an **empty** one, two levels deep:

- 0 crashes
- 0 page errors
- 0 flows that open with no way back out
- 0 flows that open effectively empty

Coverage, stated honestly: **57 of the 123 registered entry points** were reachable and testable this
way. The other 66 are not defects. They are entry points that take a required argument and are only
ever reached by tapping a specific card (`openMilestone(key)`, `openPregMoment(id)`,
`openMemoryCard(month, photoId)`), sign-in and first-run screens that live in module scope rather
than on `window`, or screens deeper than two levels.

### The methodology error worth recording

The first version of this walk called **every** registered function directly and reported **72 broken
openings**. All of them were false:

- **40** were functions that exist but are not on `window` (`showSignIn`, `openFirstRun` and friends
  live in `store-firebase.js` module scope). Reachable in real use, invisible to a `window[name]()`
  call.
- **26** were functions that take a required argument, called bare. `openPregMoment(id)` does
  `id.indexOf('cust-')` on the first line.
- **4** were real throws in stages where **the UI never offers them**. `openBirthPoster()` reads
  `activeBaby().place` and throws during pregnancy, but the pregnancy shell renders
  `renderPregMoments()` and never shows that button, so no parent can reach it.

And one was my own seeding error, which nearly became a reported P0: I seeded the planning stage as
`pregnancy: null` plus a `state.trying` key **that has never existed in this app**. The trying stage
IS the pregnancy record (`state.pregnancy.stage === 'planning'`, `index.html:6634`). With the wrong
seed, `openPositiveTest()` threw on `p.lmp`, which would have been reported as "the trying to
pregnant transition is broken". With the correct seed it works perfectly.

**The rule this produces:** a flow test that invokes functions the interface withholds is measuring
nothing. Walk the screens a person can reach, harvest the handlers the app itself puts on them, and
test those.

---

## 3. Edge cases, with what Cubby actually says

Twelve boundary states driven against the real app. **No page errors in any of them.** The failure
mode here is never a crash, it is the app saying something confidently wrong on a page a parent
trusts about a baby.

### Handled well

| case | what Cubby does |
|---|---|
| Twins, two babies in one circle | Home names the active baby, the other is a switch away |
| A baby with no birth date | No age shown, no `NaN`, nothing broken |
| Exactly one feed | "1 Feed today", not "1 Feeds today" |
| A 32-character name | Renders, no overflow |
| 42 weeks, two weeks overdue | Says week 42 and uses overdue language, and refuses a countdown, which is the charter working |
| A toddler and a pregnancy at once | Both present, as the App Store listing promises |
| A thousand events | Renders, no jank, `perf_check` budgets hold |
| Six hours old, nothing logged | Offers a first log and a photo rather than an empty screen |

### Four that need a decision

**1. A nap running across midnight reads as zero.**
Banner: `SLEEPING 15:00:08`. Strip: `0m Sleep today`.
This is the case I deliberately left when fixing the same contradiction on 2026-08-14: `liveNapMs`
attributes a nap to the day it **started**, matching `todayEvs`, Stats and the doctor report, all of
which bucket by start. That consistency is right, but the visible result is a screen saying a baby
who has been asleep for fifteen hours has slept nothing today. Re-bucketing sleep across midnight is
a whole-app change and should be taken deliberately, in one move, or not at all.

**2. A timer left running for three days claims a 72 hour nap, and says nothing.**
Banner: `72:00:11`, no warning anywhere. A parent who fell asleep with the timer going gets a
nonsense number, and stopping it writes a 72-hour sleep into a health record that a doctor may read.
Nothing offers to fix it. This is the 3am case the product exists for.

**3. A pregnancy with no due date and no last period is told it is "Week 1".**
She knows she is pregnant and does not know her dates yet, which is the normal state for the first
few weeks. Cubby asserts week 1 rather than saying it does not know. For an app whose whole trying
stage is built on refusing to guess, asserting a week from no data is off-key.

**4. A future-dated entry says "just now", and keeps saying it.**
Mis-scroll AM to PM and the feed shows "just now" for twelve hours, shadowing the real last feed.
The sleep flow already guards this (`index.html:4121`); feed, nappy, pump and activity do not.

---

## 4. What is genuinely solid

Worth writing down so it is not traded away later:

- **Nothing crashes.** 362 flow openings, 12 hostile states, zero page errors. For a 12,000-line
  single-file app with four life stages, that is unusual.
- **Every sheet has a way out.** No screen in any stage traps a parent.
- **The empty state is never bare.** Not one flow opens with nothing in it.
- **The charter holds under pressure.** Two weeks overdue still refuses a countdown. The trying
  stage still refuses to predict. No streaks appeared anywhere in 362 openings.

---

## 5. The gates

Both tools are in `node tools/gates.js`, so this cannot silently rot:

- `flow_walk.js` fails if any reachable flow starts throwing, loses its way back, or opens empty.
- `edge_probe.js` prints what the app says in each boundary state, for a human to read after any
  change to timers, dates or the stage machine.
