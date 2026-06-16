# Cubby — $100 Meta message test

> **Status (June 2026):** Instrumentation shipped. This is a **learning** test, not a customer-buying
> campaign. A $100 budget at a realistic $20–80 CAC buys ~3–10 paying customers, not 300. What it
> *does* buy is the single most valuable unknown: **which message makes a mother click and sign up.**
> Get that right and the 119 articles + future organic + future paid all get sharper.

---

## 1. What we're measuring (and why it's first-party)

The conversion event isn't a purchase — billing isn't live until Aug 2026 (`MONETIZATION-HANDOFF.md`).
The events we attribute are:

1. **Signup** — a brand-new family is created (the real top-of-funnel signal).
2. **Pro intent** — they tap "Register for Pro" (`waitlist` doc; the deeper signal).

**No Meta Pixel.** Cubby's brand promise is *"No ads, no third-party trackers"* (`index.html`,
`LAUNCH-PRIVACY-WEDGE.md`). A Facebook tracker would make that line false on the landing page the
ads point to — and privacy-minded mothers are the *most* likely to notice. Instead we use
**first-party UTM attribution**: the `utm_*` tag is remembered on-device (first-touch) and stamped
onto the user's own Firestore record at signup and at Pro registration. Meta tells us spend + clicks
per ad; our own Firestore tells us signups per angle. We divide.

> **The honest trade:** without a pixel, Meta's algorithm optimizes toward *clicks*, not signups, and
> can't retarget. On a $100 test we'd use neither anyway, so we lose nothing that matters — and keep
> the brand's soul. The Firestore read corrects for click-vs-signup after the fact.

---

## 2. The four message angles (each = one ad = one `utm_content`)

Hold everything constant (audience, budget, landing) and vary **only the message**, so the test is clean.

| Ad | `utm_content` | Hook (headline) | Primary text |
|----|---------------|-----------------|--------------|
| **A — Privacy wedge** | `angle_privacy` | *Your baby's data shouldn't belong to a corporation.* | Most baby trackers sell your data or trap it in their cloud. Cubby is different — your pregnancy and your baby's logs belong to **you**. No ads. No selling. One calm, private place for feeds, naps, nappies and milestones. |
| **B — Calm / relief** | `angle_calm` | *One calm place, for the one carrying it all.* | New-parent brain is loud enough. Cubby keeps feeds, naps, nappies and milestones in one gentle place — so you can stop holding it all in your head. Free to start, private to your family. |
| **C — Practical** | `angle_practical` | *Log a feed, nap or nappy in 2 taps — even one-handed at 3am.* | See patterns, not chaos. Everyone who cares for your baby — partner, grandparents, the nanny — sees the same log, live. Cubby grows with you from trying → expecting → baby → big kid. |
| **D — Doctor-ready** | `angle_doctor` | *Walk into every pediatrician visit ready.* | Cubby turns your daily logs into a clean summary your doctor actually wants — feeds, weight, sleep, milestones. No more "um, I think it was Tuesday?" Free to start, no ads. |

**Destination URL for each ad** (paste into the ad's Website URL — note the matching `utm_content`):

```
A  https://little-cubby.com/?utm_source=meta&utm_medium=paid_social&utm_campaign=msgtest_jun2026&utm_content=angle_privacy
B  https://little-cubby.com/?utm_source=meta&utm_medium=paid_social&utm_campaign=msgtest_jun2026&utm_content=angle_calm
C  https://little-cubby.com/?utm_source=meta&utm_medium=paid_social&utm_campaign=msgtest_jun2026&utm_content=angle_practical
D  https://little-cubby.com/?utm_source=meta&utm_medium=paid_social&utm_campaign=msgtest_jun2026&utm_content=angle_doctor
```

> The campaign name `msgtest_jun2026` and the four `angle_*` values are what the report keys on —
> keep them **exactly** as written or the breakdown won't line up.

**Creative direction:** warm and real, never stocky. Use Cubby's palette (cream/soft pink), a real
app screenshot or a tender tired-parent moment. Honest, calm, no fake reviews or numbers (matches the
trust section already on the site). Reuse assets in `og/` and app screenshots. One image per ad is fine.

---

## 3. Campaign setup in Meta Ads Manager (your steps — I can't log in for you)

1. **Objective:** **Traffic**. (Not Sales/Leads — those need a pixel we deliberately don't have.)
2. **Optimization & delivery:** optimize for **Link clicks** (NOT "Landing page views" — LPV is a
   pixel event, and we have no pixel).
3. **Budget:** **Lifetime budget $100**, schedule **7 days**. (One ad set; let Meta spread the 4 ads.)
4. **Audience (one ad set, held constant):**
   - Women, **25–44**.
   - Geo: **US, UK, Canada, Australia, Ireland** (English-speaking, can plausibly pay $9/mo). Keep
     UAE / India / etc. *out* of this ad set — mixing low-CPM geos skews the test toward cheap clicks,
     not representative payers. Run a separate small home-market ad set later if you want that signal.
   - Detailed targeting (light, optional): *Pregnancy, Parenting, Motherhood, BabyCenter, New parents.*
     Or leave broad and let the creative do the work — fine on $100.
5. **Placements:** **Advantage+ (automatic)** — IG + FB feeds, Reels, Stories. Most efficient on a small budget.
6. **Ads:** create **4 separate ads** in this one ad set (A–D above). **Do NOT use Dynamic/Advantage+
   creative** that blends them — we need clean per-ad data. Turn off text "enhancements" that rewrite copy.
7. **Billing:** add your own payment method (this is yours to do — I won't enter card details).

Let it run the full 7 days without edits (editing resets Meta's learning).

---

## 4. Reading the results

**From Meta Ads Manager** (per ad A–D): Amount spent, Link clicks, CPC, CTR.

**From your own data** — run the existing report (needs `tools/serviceAccountKey.json`, see `ANALYTICS.md`):

```
node tools/analytics.js
```

It now prints an **Acquisition (UTM, first-party)** block:

```
── Acquisition (UTM, first-party) ──
Signups w/ campaign:    37   ·   Pro-registered w/ campaign: 9
  angle (utm_content)         signups   pro-reg
  angle_privacy                   14       4
  angle_calm                      11       3
  angle_practical                  8       1
  angle_doctor                     4       1
  by campaign:  msgtest_jun2026:37
  by source:    meta:37
```

**Cost per signup, per angle = (Meta spend on that ad) ÷ (its signups from the report).**
That's the number that decides everything.

---

## 5. The decision rule (so the $100 means something)

- **Winning angle** → becomes the message everywhere: the article CTAs (your 119-article engine),
  the hero copy, organic social. This is the real leverage — the $100 buys a message you reuse for free.
- **Best cost-per-signup < ~$3–5** → paid scaling is viable; consider a larger budget on the winner.
- **Best cost-per-signup > ~$15–20** → paid isn't your channel. Pour everything into the free article
  engine + communities instead. (Still a win — you stop guessing.)
- **Watch the deeper signal too:** which angle drove the most *Pro registrations*, not just signups.
  A cheaper signup that never registers for Pro is worth less than a pricier one that does.

---

## 6. Honest caveats

- $100 yields **directional** signal, not statistical significance. Treat a clear winner as a strong
  hypothesis, not proof.
- Without a pixel, Meta optimizes for clicks, not signups — so a "cheap click" angle may not be the
  "cheap signup" angle. **Trust the Firestore signup numbers over Meta's click numbers.**
- Cold Meta traffic converts worse than your warm article/SEO traffic. Don't judge the product by this
  number — judge the *message*.

---

## 7. What's wired (code, all on `main`)

- **Capture:** `index.html` (`?ref=` block) + `app/index.html` (`<head>`) remember first-touch `utm_*`
  into `localStorage['cubby-acq']`. First-party only; never sent to a third party.
- **Stamp at signup:** `app/store-firebase.js` writes `userDoc.acq` on new-family creation.
- **Stamp at Pro intent:** `app/index.html` `joinProWaitlist()` attaches `acq` to the `waitlist` doc.
- **Report:** `tools/analytics.js` → "Acquisition (UTM, first-party)" block.
- Firestore rules already allow these (`users/{uid}` and `waitlist/{uid}` are owner-writable; no field lock).
