# Den: the family ecosystem (master plan)

> **Status (June 2026):** The shipped master brand is ONE Cubby across four lifecycle stages (Trying -> Expecting -> Baby -> Child); the "Den" household-OS in this doc is PARKED (`FEATURES.den=false`) and "Mommy To Be" is RETIRED in favour of the "Expecting" stage. Full current state + go-live plan: HANDOFF.md.

**Den is the master brand: a warm household OS.** One family account ("the den") that runs the
whole home: the people in it, the life events moving through it, and the day-to-day machinery
that keeps it going. Individual experiences (pregnancy, baby, home management, weight, health)
are **flows inside Den**, not separate apps.

```
                                ┌──────────────────────────────┐
                                │            DEN               │
                                │   one household, one account │
                                └──────────────┬───────────────┘
        ┌───────────────┬──────────────┬───────┴───────┬───────────────┬──────────────┐
        ▼               ▼              ▼               ▼               ▼              ▼
   PREGNANCY        BABY (Cubby)    HOME            WEIGHT &        MOMENTS        HEALTH
   week view,       feeds, sleep,   chores, things  WELLNESS        photos,        family meds,
   antenatal,       vaccines,       to buy, staff,  mom & dad       keepsakes,     records,
   GDM/BP, birth    growth, meds    meal plan,      weight trends,  milestones     visits
   tools            keepsakes       expenses        goals
        └───────────────┴──────────────┴───────────────┴───────────────┴──────────────┘
                                       later: SMART HOME (device management),
                                       nutrition intelligence, school-age flows
```

## Brand architecture
- **Den** = the master brand and (eventually) the app name. Short, neutral, affable; checked
  June 2026: no family-organizer app owns "Den" (closest is "ZenDen", a different name).
- **Cubby** = the baby flow's friendly face (the bear, the cub). The bear world survives as the
  warmth layer: the family is the den, the baby is the cub.
- **Mommy To Be** = the pregnancy service's INDEPENDENT brand (decided June 2026, replacing the
  earlier "Cubby Den" service branding; page at /pregnancy/, in-app identity). It covers the whole
  journey: trying ("we're trying" planning stage), just found out, week-by-week, birth. Honest
  trademark note: it is a generic descriptive phrase, available (no app collision found; nearest
  are Mommy+, HiMommy, Mommy Womb) but weakly protectable; the defensible equity stays in Den and
  Cubby, with Mommy To Be as the approachable consumer-facing flow name.
- Future sub-flows get plain descriptive names inside Den (Home, Weight, Meals), not new brands.

## Why Den wins (competitive positioning, June 2026)
The family-organizer category is crowded but shallow: Cozi (the incumbent), FamilyWall, Maple,
TimeTree, Homsy, Nori (AI input), OurHome (chore gamification), Fami, Pairently (two-household).
They are calendars with lists. **None of them owns the family's health spine** : pregnancy ->
birth -> baby -> growth -> vaccines -> family health. Den enters with that spine already built
and trusted (YMYL discipline, cited sources, no ads, private), then surrounds it with the
day-to-day home machinery the category competes on. The data compounds: the longer a family
lives in their Den, the more their story (and switching cost) grows.

## The flows

### Shipped (merged into `main` + live)
1. **Pregnancy (the "Expecting" stage of Cubby)** : the full journey. A "we're trying" planning stage
   (preconception checklist per NHS, optional fertile-window estimate, "I got a positive test"
   celebration that converts to tracking), week view, antenatal schedules (170-country coverage:
   verified NHS/ACOG/G-BA/WHO and others, WHO-aligned fallback elsewhere),
   danger signs (CDC), appointments, symptoms/weight/BP, opt-in condition trackers (GDM glucose
   with NICE/ACOG targets, pre-eclampsia watch, supplements, nausea), kick counter, contraction
   timer (5-1-1), birth plan, hospital bag, a **Moments** album (ultrasounds and bump photos
   paired with the week's "size of" comparison), and the birth transition into the baby flow.
2. **Baby (Cubby)** : the existing shipped product: logging, multi-caregiver sync, vaccines,
   growth charts, medicine, illness, keepsakes, family sharing.
3. **Home (v1, "Our Den" hub)** : household chores (assignable, tickable), things to buy
   (shared shopping list), home staff (nanny/cleaner/cook contacts and notes), meal plan for the
   week, expenses with a monthly view, and adult weight tracking for mom and dad. Lives in the
   same household blob; every member sees the same Den.
   **Rollout status: built and tested, PARKED behind `FEATURES.den=false` in
   `app/index.html`. The pregnancy tracker is now merged into `main` and live; the Home flow stays
   parked, and flipping that flag (plus an SW cache bump) is the whole Home launch.**

### Next (rough order)
4. **Weight & wellness, deeper** : goals and trends per adult, postpartum-aware (links from the
   pregnancy weights), gentle and no-guilt; never diet advice (YMYL care applies).
5. **Meals & nutrition intelligence** : meal plan -> shopping list in one tap; baby meal logs and
   family meals converge; the existing Pro "nutrition tracker" candidate grows up into a family
   nutrition view.
6. **Family health** : the baby health pattern (meds, visits, records) extended to every member.
7. **Moments** : the keepsakes engine becomes family-wide (not just baby photos).
8. **Expenses, deeper** : budgets, staff payroll reminders, recurring bills.
9. **Smart home (exploratory)** : device management is a natural "home OS" extension but a
   different engineering world (integrations, hubs). Revisit when the core flows have traction.

## Monetisation sketch
- The health spine stays free (trust core: pregnancy, vaccines, danger signs, basic logging).
- Den Pro (one subscription across all flows) gates: advanced insights (nutrition, weight
  trends, sleep patterns), PDF exports (doctor summaries, expense reports), premium keepsakes,
  push notifications, smart routines. One price, whole-family value. (Details: PAYWALL.md, PRO.md.)

## Architecture note (why this is cheap to build)
The Firestore data model is already a household: `households/{hid}` with a shared `app` blob and
real-time member sync. Every new flow is more keys on the same blob (`state.pregnancy`,
`state.den`, ...) and more sheets in the same single-file PWA. No new infra, free tier holds.
Distribution plan (Capacitor wrap, store requirements) unchanged; the master app ships to the
stores as Den when the shell is ready.

## Naming decisions (June 2026)
- **"Den" chosen as master brand** after three naming rounds. Checked: no family-organizer or
  household app owns "Den" (ZenDen is the closest, different name).
- Pregnancy sub-brand history: "Ember" REJECTED (Ember Technologies ships an "Ember Baby"
  feeding/growth tracking app; "Ember Cycle Train" also exists). "Cub/Cubs" REJECTED (Cubtale
  pregnancy+baby app uses "Cubs" as its core metaphor; Cub Baby Sleep exists). Standalone round
  explored Patter ("pitter-patter", clean, best standalone fallback), Fern (clean), Burrow
  (furniture brand, different class).
- Avoid for future names (verified existing brands in or near our categories): Glow, Bump,
  Sprout, Coconut, Nest, Hatch, Willow (breast pumps), Halo (bassinets), Flutter, Luna, Lumen,
  Aura, Bloom/Blossom, Acorn, Snug (rides SNOO/Snuz), Hearth (Hearth Display family organizer).

## Data governance: the household owns the story (June 2026)
Principles, implemented in-app and merged into `main` (live):
- **The data belongs to the household (the baby's story), not to any one member.** Removing a
  caregiver or partner revokes their ACCESS only; everything they ever logged stays, and a
  `formerMemberInfo` tombstone keeps their entries attributed by name forever.
- **Guardians** (usually mama + papa, max two): derived automatically (owner + the first member
  whose relationship is Mother/Father/etc.), overridable in Settings -> Data -> Guardians. Only a
  current guardian can change guardianship; the family always keeps at least one.
- **Big, irreversible actions go through consent**: "Delete data" (granular: pick babies+logs /
  photos / pregnancy / Our Den) and "Export data" create a consent request that EVERY guardian
  must approve. Requests show as banners on every home surface; either guardian can decline
  (nothing changes) and the requester is told gently. Exports unlock only on the requester's
  device. A solo-guardian household completes immediately (with the same scope picker).
- **Everyday corrections stay lightweight**: deleting a single mis-logged feed is not gated
  (Firestore rules already limit caregivers to deleting only their own entries; the owner can
  edit anyone's). The consent route covers bulk/irreversible actions.
- **Enforcement level, honestly:** the consent route is app-level (UI) governance plus the
  existing Firestore rules (members can't change membership, caregivers can't delete others'
  entries, only the owner can delete the household). True server-side dual-consent on blob
  writes would need Cloud Functions (Blaze) or a consent-doc rules design: noted as a later
  hardening step when infra allows.

## Ground rules (ecosystem-wide, unchanged)
- Free-tier infra only (no Blaze/Functions/Storage); one household blob syncs everything.
- YMYL discipline on anything health: cited official sources, "seek care" never "diagnose",
  visible disclaimers, no fabricated stats or reviewers.
- No em-dashes in user-facing copy. Warm, no-guilt tone everywhere: chores and weight especially
  (these flows shame people in other apps; Den never does).
- Don't break production: node --check, preview verify, bump app/sw.js CACHE on app changes.
