# Post-mortem: a relationship label decided who was pregnant

- **Date:** 2026-10-26
- **Severity:** P1 (privacy, latent). Any partner she shared her journey with, under any label but three,
  was shown her screens, including her cycle record in the trying stage. Production had **no** shared
  journeys when this was measured, so nobody was actually shown anything (see Impact).
- **Duration:** 2026-06-17 (85b36829, the label list) until this fix reaches production. The cycle-data
  half dates from 2026-08-04 (141b5102 and 9fef5abc), when the trying stage put her period history and
  her "Today I noticed" notes on the journey doc and gave the partner a home of his own.
- **Status:** RESOLVED in the tree (`viewerIsCarrier()`, gate `carrier-view`), shipping in sw v359.
- **Author:** Claude (Opus 5.5), for the founder

> Policy: **every breakage gets a documented, blameless 5-Whys post-mortem.** Blameless = focus on
> systems and decisions, not people. Be honest, including our own contributing actions. If a "why"
> is inferred rather than proven, say so.

## What happened
While capturing real screens against the Firestore emulator for the marketing reel, a partner whose
label was "Dad" landed on the pregnant person's home: "You and baby", "You this week", and the private
"How are you, in yourself?" card. The reel was re-staged with Sam as "Papa Bear" to get his real view.

`viewerIsCarrier()` in app/index.html decides whether the viewer is the person carrying the pregnancy.
It read the viewer's relationship label and treated only "Papa Bear", "Grandpa Bear" and "Uncle Bear"
as not pregnant. Everyone else was the carrier: a custom "Dad" or "Husband", and the presets Nana Bear,
Auntie Bear, Nanny, Caregiver and Other. It also ran the other way: a pregnant owner labelled
"Papa Bear" was shown the partner's view of her own pregnancy.

## Impact
What a mislabelled partner was shown, measured by `tools/carrier_view_check.js` on afbb4944:

| Stage | Shown to him | Her private data? |
|---|---|---|
| Expecting | "You and baby", "You this week" (library text), "How are you, in yourself?", Symptom and Weight tiles | **No.** `openMoodNote` returns early for a non-owner and the Symptom and Weight sheets refuse him (`pregHealthCanWrite`). Her mood is in `mhealth/{owner}/cat/mood`, which firestore.rules lets nobody else read, ever; her health readings are readable only if she shared that category with him. Prompts that went nowhere, not a read. |
| Trying | Her fertile-window dates ("You may be in your fertile window, somewhere around Oct 13 to Oct 19"), her cycle lengths, the late-period card, her two latest "Today I noticed" notes and the full list, the doctor summary built from them, and the Cycle details sheet prefilled with her last period date and cycle length | **Yes.** These live on `households/{hid}/pregnancy/{owner}`, which the rules let him read once she shares the journey with him. The only thing keeping them off his screen is `renderPlanningPartnerHome`, whose own copy promises "Cycle details stay with her unless she shares them". |

What he could not do: write any of it. Every save on her record runs `syncPregJourney`, which returns
for a non-owner, and the rules refuse a partner's write to anything but `data.precon`
(test/rules-test.js: "partner cannot write data.lmp", 172/172 passing on 2026-10-26).

**Production on 2026-10-26** (read-only aggregate query with the ops service account; counts only):
13 households, 7 pregnancy journeys, all in the expecting stage, **none shared with anyone**. So no real
partner has been shown a journey at all, and the trying-stage exposure has reached nobody. The same
query found that 3 of the 7 journeys are owned by someone labelled "Papa Bear" (two single-member
households, one with a Mama Bear member; last touched 30 to 90+ days ago). The old rule showed them the
partner view of the record they own. With this fix they get the carrier view, a choice the founder made
knowingly (see Corrective action 3).

Blind spot: the query reads labels as they are today. A label changed since a journey was shared cannot
be reconstructed.

## Root cause
Who is pregnant was answered from free text the circle writes about itself, instead of from the data
that already says who the journey belongs to (`pregnancy.ownerUid`, the field every other ownership
check reads through `LL.matIsOwner` and `LL.pregIsOwner`).

## 5 Whys
1. **Why did a partner see her fertile window?** `renderPlanningHome` sends anyone `viewerIsCarrier()`
   says yes to down the carrier path, and it said yes to him.
2. **Why did it say yes?** It read his relationship label and only three label strings counted as "not
   pregnant". "Dad" was not one of them.
3. **Why was a label being used for this at all?** When it was written (2026-06-17) the question was
   only "should we ask about periods?", and the preset list made a label check look like data. The
   journey had moved to an owner-owned doc three days earlier (1e859d57), so the right field already
   existed; the two changes were never connected.
4. **Why did the cost grow without anyone noticing?** On 2026-08-04 the trying stage started reading her
   period history and notes off the journey doc, and the partner home made a promise about them, both
   behind this one predicate. The gates that cover the partner view (`cycle-median` §10, `precon-shared`,
   `preg-canwrite`) all built their partner as "Papa Bear", the one label the rule handled, so every one
   of them was green by construction.
5. **Why did the gates pick that label?** Because it was the realistic default and nobody asked what the
   predicate would do for a label outside its list. The fixtures tested the rule's own assumption. **Root
   cause:** an identity question answered from free text, and tests whose fixtures shared that assumption.

## Contributing factors (blameless)
- Circle labels are deliberately free text (a real name, a bear label, any custom role), which is right
  for warmth and wrong for any decision.
- `matIsOwner` and `pregIsOwner` were already the source of truth for every write guard, and the empty-
  label fallback (df2015a2, 2026-08-08) already called one of them. The fix was one line away for months.
- There is no field that says who is carrying apart from who created the journey, and no way to hand a
  journey over. When a partner sets it up, the data calls him the pregnant person.

## What fixed it
`viewerIsCarrier()` now returns `pregIsOwner() && pregJourneyIsOwner()`: the journey's `ownerUid` against
the signed-in uid (the household owner for a legacy record with none), and both must agree. It never
reads a label. No cloud at all still means a solo mother on her own phone, and she is the carrier.

`tools/carrier_view_check.js` (gate `carrier-view`): owner labelled Mama Bear, none, Papa Bear and Dad
all get her screens; a shared partner labelled Dad, Nanny, Husband, Nana Bear, Auntie Bear, Caregiver,
Other, Papa Bear or nothing never does, in either stage, and never sees her note or her window. It plants
the old label rule into the page on every run and fails if that stops going red. On afbb4944: 60 passed,
88 failed. On the fix: 148 passed, 0 failed, with the planted rule still failing the same 88.
`cycle-median` §10 now makes its partner by uid, not by label, and goes red on afbb4944 too.

## Corrective actions
| # | Action | Type | Status |
|---|--------|------|--------|
| 1 | Carrier from data, not labels (`viewerIsCarrier`) | Fix | DONE |
| 2 | `carrier-view` gate, self-checking against the old rule; `cycle-median` §10 partner by uid | Prevent | DONE |
| 3 | Ask "who's carrying?" at setup and let a journey be handed to her, so a partner who sets Cubby up is not treated as pregnant | Fix | TODO, founder to schedule |
| 4 | The trying-stage partner home promises "Cycle details stay with her", yet the rules let him read them on the doc she shared. Move cycle data and notes off the shared journey doc, or say plainly what sharing the journey shares | Fix | TODO |
| 5 | Re-capture the marketing reel frames with Sam as "Dad" | Doc | TODO, founder |

## Lessons
- A label someone types about themselves is never an identity. If a decision needs to know who someone
  is, read the uid-keyed field that every write guard already trusts.
- A fixture that matches the rule's own assumption cannot catch the rule. Vary the input the rule reads.
