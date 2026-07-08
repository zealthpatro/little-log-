# Cubby Through the Customer's Eyes

**July 2, 2026 · Grounded in the code-verified walk (CUBBY-CRITIQUE-VERIFIED-VERDICTS.md), the Experience Charter, and PAYWALL.md.** Four questions: what does she see and feel, why does she come, why does she pay, why does she refer — and how do we make exploring Cubby effortless.

---

## 1. What she sees and feels, stage by stage

### Minute 0 — arrival
She lands from one of four doors, and each door shapes her first feeling:

- **A vaccine-schedule page** ("India baby vaccine schedule") → taps through with `?c=in` and the app is *already localized to IAP* before she signs in (index.html:5838). Feeling: "it already knows my country." Quietly excellent — this is the best pre-auth personalization in the product and nobody would ever notice it was deliberate.
- **A referral link** (`?ref=`) → same as organic but attributed. She feels nothing different. (Opportunity: she should — "Priya invited you" would warm the door.)
- **An invite from her partner** → she signs in and *lands inside a living household*: the baby exists, feeds are logged, a nap timer might be running. **This is the best first-run in the product** — instant proof, zero setup.
- **Organic/homepage** → the sign-in page: "A warm, private baby log you can share" + three value lines (store-firebase.js:228-229). Honest, calm, on-charter.

**The asymmetry to internalize: the *owner's* first-run is empty; the *invitee's* first-run is alive.** Every growth mechanic should push toward creating more invitees, because they get the magic for free.

### Minutes 1–3 — first-run (owner)
Stage chooser over a blurred preview of the real app ("Nap in progress · by Mama Bear") (index.html:3574-3601) → add baby (name; everything else optional; country prefilled) → "You're all set 🐻 … Invite someone." The preview backdrop is doing real work: she sees the *destination* before the setup. Feels: fast, warm, not administrative — charter self #1 ("celebrate quietly") is honored. A loss-safe holding state exists for the hardest path (index.html:3606).

### Day 1 — the empty-home problem
Home: greeting, "Add a photo" card, Get-started checklist, log tiles, tips ticker. Solo value is real (verified), but the *feeling* at this stage is "a nice empty notebook." The first true emotional payoffs are all hours-to-days away:

| Aha | When it fires | Self it serves |
|---|---|---|
| **The 3am glance** — "last feed 2:10, you're doing fine" | first night | #3 anxious-in-the-loop |
| **The away-recap** — "while you were away: 3 feeds, 2h nap, by Nanny" (index.html:1409) | first time someone else logs | #4 depleted, #7 in-control |
| **"Ready for you"** — a finished monthly card from her real data (index.html:7564) | first monthiversary | #6 elated |
| **Vaccine plan, her country, with dates** | the moment birthday is set | #7 in-control |

The vaccine one is the only aha available in minute two — and it's currently silent. After birthday+country are set, the plan just *exists* in Health. **Fix: surface it as the setup climax** — "Here's Aarav's vaccine plan, all 12 IAP visits with dates. We'll remind you." That's a visible "Cubby carries the load" moment at minute two, not week two.

### Week 1 — the habit forms (or doesn't)
What she explores: log tiles daily; the Log timeline; maybe Stats. What she *feels* if the circle is live: relief — the who-did-what attribution, live nap timer on every phone, handoff notes. What she feels if solo: a decent tracker. **The circle is the moat and the mood.** Everything in week one should conspire to get person #2 in.

### Month 1+ — the reflective loop
Monthiversary card, milestone nudges → keepsakes, growth curve filling in, Rituals rhythm ("a quiet day is allowed"). Self #8 is well served. This is also — not coincidentally — where the money is.

---

## 2. Why she comes (and the words she'd use)

1. **"Did I already feed her?"** — the anxiety loop. One glance answers it.
2. **"I'm the only one who knows everything."** — mental-load transfer to the circle: nanny logs, grandparents see, papa gets the recap. This is the category reframe in customer words.
3. **"Which vaccines, when, *here*?"** — country-correct schedule + reminders. In India/UAE this is the sharpest acquisition hook (and the SEO door already funnels it).
4. **"I don't want Meta knowing my cycle/baby."** — privacy as sanctuary. Post-Flo, this converts a vocal minority and reassures the rest.
5. **"I want to keep this."** — the keepsake pull; comes *after* arrival, powers retention and referral more than acquisition.

---

## 3. Why she pays for Pro

The taster system as built (PAYWALL.md, index.html:2848-2930) is genuinely good psychology: premium styles apply freely on the canvas (golden ✨, no interrupt), the gate sits at *export*, quotas of 3/3/3/1/1, and the wall says "You've enjoyed your free tastes of X." She converts at the moment of *finished pride*, not at a feature list.

**The three conversion moments, mapped to selves:**

1. **The proud export** (self #6): month card or milestone done, looks beautiful, she's about to post it — watermark removal + premium format is worth $9 *right now*. Peak emotion, peak willingness.
2. **The checkup** (self #7): first pediatric visit lands in week 1–2 — the doctor PDF (1 free taste, then Pro) hits exactly then. **This is a clock you control: nudge the taste 2 days before the vaccine-plan due date** ("Aarav's 6-week visit is Friday — want the summary ready?"). Utility conversion for the mother who'll never buy fonts.
3. **The 3am arms-full moment** (self #4): voice logging. Weakest as a *trigger* (she discovers it after paying) but strongest as a *retention* justification.

**Gaps between her and payment:**

- **The Pro sheet sells features; she buys moments.** Reorder the pitch per entry point: from the studio → lead keepsakes; from Health → lead doctor PDF. The `lockedFeature` context already exists in code (index.html:2904) — use it to reorder, not just to name.
- **"Insights" is promised in the FAQ copy and doesn't exist** (verified). Before Aug: cut the word, or ship one honest on-device insight (e.g., "usual longest stretch") — anything less breaks trust at the exact moment she's evaluating whether to pay.
- **The waitlist gate is an asset:** "Register for Pro" is intent data. At go-live, the waitlist email should land the day her next taste-quota resets — "your keepsake studio is open."
- **Never violate the free-forever core** (logging, sync, vaccines, growth, pregnancy) — PAYWALL.md has this right; it's the trust that makes the $9 feel fair rather than extractive.

---

## 4. Why she refers

People refer when it makes **them** look good, feel generous, or get relief. Cubby has four referral surfaces; three are built:

1. **The watermarked keepsake** (built) — every free share carries "made with Cubby 🐻 · little-cubby.com". Beautiful cards in mum WhatsApp groups and IG stories are the ambient engine. She refers by *showing off her baby*, which she was going to do anyway. Zero ask.
2. **The circle invite** (built, throttled) — every invite creates a fully-activated user inside a live household. But it's email-bound with no WhatsApp path (verified gap). **Fixing this is the referral-factor lever**: an invite *link* she can drop in the family WhatsApp group ("Nana, tap this") converts her strongest relationships at zero friction.
3. **The share note** (built) — `shareCubby()`: "We've been using Cubby to keep track of Aarav's feeds, naps and vaccines together. It's free, private, no ads" + ref link, via native share (index.html:3358). Right words, but buried in Settings. **Move the ask to the pride moments**: after a keepsake export, after a completed vaccine visit, after the first full circle week — "Know another tired parent? Send them Cubby."
4. **The guess game** (built) — the pregnancy gender-game share link pulls whole families in pre-birth (index.html:4222). Under-leveraged: every guesser is a warm lead for the circle after the birth.

**And the answer she gives in the mum group** — "which app do you use?" is the highest-intent referral moment in the category, and it's answered with words, not links. Give her the words: the share note per country ("it has the actual IAP schedule with reminders") is more repeatable than any reward.

**Rewards:** plumbing is shipped, nothing promised (PAYWALL.md §referral). Right call — but at Pro launch, "1 free month per family still active" turns the existing `referredBy` data retroactively into gratitude. Announce only when redeemable, as specced.

---

## 5. Making explore-and-learn effortless

**What exists (verified):** one coach mark per tab — Home, Log, Album, Health (index.html:1821, 6957, 6640, 5285); the Get-started checklist; the rotating tips ticker (4–5 tips); "why we ask" privacy explainers on every profile field; the blurred onboarding preview. All on-charter: teach in place, never a manual.

**Where discovery fails her (the buried treasure problem):** voice logging, the doctor report, Then & Now, the birth poster, the guess game, rituals, the handoff note — each is a delight she finds only by wandering. The charter forbids a feature tour (noise), so the answer is **revealing at the moment of relevance**:

1. **Day-N quiet reveals** (one line, in the existing tips slot, never a modal): day 2 → "your partner can see this live"; day 5 → keepsake; day 10 → rituals; 2 days pre-checkup → doctor summary. One new thing per moment, exactly when it's usable. The tips ticker already has the surface; give it a schedule instead of a loop.
2. **Event-triggered teaching**: fever logged → the fever article; first solid logged → starting-solids article; second caregiver joins → "leave them a handoff note." The 394-article library is the best learning asset Cubby owns and the app barely points into it — contextual one-link surfacing turns SEO content into product depth without adding a single screen.
3. **Make the checklist the map**: after the core four, Get-started can gracefully hand off to a "This week with Cubby" line (not a list) that rotates the next relevant capability.
4. **Answer "what can this do?" in one place**: a single calm "Everything Cubby does" sheet under Profile — not a tour, a reference. For the self #7 mother who *wants* the map, on demand only.
5. **First-minute vaccine reveal** (from §1) — the single highest-value discoverability fix: it converts setup into proof.

**The test for all of it stays the Anxiety Test:** each reveal must make the next minute easier, arrive one at a time, and be dismissible forever. Discovery that behaves like marketing is noise; discovery that behaves like a kind friend saying "oh — you can also just say it out loud" is the product.

---

## The one-paragraph version

She comes for relief from the 3am question and the mental load; she stays because the circle logs the day for her; she pays at two moments — the proud export and the pre-checkup PDF — both of which have clocks you can see coming; she refers by showing off (watermark), by needing help (invite), and by answering "which app?" in the group chat. The build already contains almost all of this. What's missing is timing: surface the vaccine plan at minute two, the invite as a WhatsApp link at the first aha, the Pro taste two days before the checkup, and the share ask at the pride peak — and cut the word "insights" until it's true.
