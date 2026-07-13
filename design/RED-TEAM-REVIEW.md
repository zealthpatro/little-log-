# Red Team & Trust Council — Cubby pre-launch security review

**Session date:** 2026-07-12 · **Framework:** Product Board V2, Pod 15 (Red Team & Trust) + Empty Chair
**Subject:** Is Cubby's security/privacy bar high enough for a customer-facing product that holds **infant health data and maternal mental-health data**?
**Verdict headline:** **NOT launch-ready as of today.** 4 P0 findings, one of them (SEC-3) live in production now. A clear, small fix list gets there. Trust Scorecard **6.1/10** (launch bar 7.0).

> Why this bar is non-negotiable: the data at stake is a baby's medical timeline and a mother's EPDS/mood notes. A breach here isn't churn — it's a family harmed and a headline. Treat every finding as if a journalist and a postpartum mother are both reading the result.

---

## Round 1 — Business Kill (Adversarial Strategist)
*"What kills this overnight?"*

| Threat | Assessment |
|---|---|
| **Trust/PR kill** | The single largest existential risk. The entire brand is "private, never sold, mother owns her health." One demonstrated cross-account leak of mood data or a baby's photo/health log ends the company. This makes the Red Team's Trust round the true gating function, not the growth metrics. |
| **Price-integrity kill** | DEP-1 (prod shows $15/mo, home shows $9/mo, FAQ says pregnancy "coming" though it's shipped) is a credibility leak at the moment of conversion. Not fatal, but it undercuts the "we're careful" promise on the exact page where money is asked for. |
| **Clone risk** | Low near-term. The moat is the free-forever caregiver wedge + privacy architecture, which is a values/positioning moat, not a tech one. Fine. |

**Round 1 finding:** the business's kill switch is trust, so the security bar *is* the business plan. Escalates SEC-3 and PRIV-1 above any growth work.

---

## Round 2 — Trust Kill (Privacy Guardian + Bias Auditor)
*"Why will users lose trust? What leaks?"*

**Privacy Guardian:**
- **Data minimization — PASS with one flag.** mhealth/pregnancy are correctly siloed out of the shared blob; mood is structurally unshareable. Good. Flag: **member emails are readable by every household member** (PRIV-2) — more than the minimum needed and contradicts "nobody's business but yours."
- **Breach blast radius — MEDIUM.** Photos are base64 in Firestore, rules-locked to members. A rules regression is the main breach path — which is exactly why the emulator suite must gate every rules change.
- **Export/delete honesty — FAIL (EXP-1).** The site says "export everything, anytime." The export omits photo binaries. Either fix the export or fix the sentence before launch. A privacy brand cannot ship a false data-rights claim.
- **Consent enforcement — FAIL (PRIV-1).** Dual-guardian consent for delete/export is UI-only. A hostile or careless co-owner can delete the child's entire record without the second guardian. For a "the baby's story is sacred" product, this must be server-enforced or the promise softened to exactly what the rules guarantee.

**Bias Auditor:**
- Growth/CDC percentile and vaccine-schedule logic is deterministic and country-sourced, not ML — low algorithmic-bias surface. **PASS.**
- One equity note: percentiles require a `sex` value and the schedule requires a country; ensure neither silently degrades for families who skip them. Non-blocking.

**Round 2 findings:** PRIV-1 (P0), EXP-1 (P1, launch-gating for the privacy claim), PRIV-2 (P2).

---

## Round 3 — System Kill (Chaos Engineer + User Advocate)
*"How does this break? What can be weaponized?"*

**Chaos Engineer — top abuse scenarios:**
1. **SEC-3 — invitee → owner (LIVE P0).** Caregiver-role invite can join writing `members[uid]='owner'`, then delete the household. The role limit is the trust boundary between "the nanny" and "the family" and it's currently open. **This is the finding that fails the whole review.**
2. **SEC-1 — billing /portal IDOR (P0-at-flip).** Format-checked, Origin-gated only; forged Origin + a valid `cus_…` reaches another subscriber's portal. Dormant until `checkoutUrl` is set — must be fixed before that switch.
3. **SEC-4 — authorId mutable on update (P2).** "By Nanny" can be re-forged after the fact. Undermines the who-did-what promise; low blast radius.
4. **PRIV-4 — invited email reads full household pre-join.** (Note: the repo `firestore.rules` already tightened household read to members-only + join-writes-self, so PRIV-4 is *fixed in repo* — but the **published console rules still had the `invitedHere()` read**. Publish the repo rules to close it live.)
5. Oversized/edge inputs (huge photo, malformed event) — handled: >990 kB photos are kept device-side; app tolerates missing fields. **PASS.**

**User Advocate (survivor panel — parents burned by other trackers):**
- *"I invited my mum and she accidentally became an admin and deleted a month of feeds"* — SEC-3 made real. Unacceptable for this audience.
- *"It told me I could export everything, then my photos weren't in the file"* — EXP-1, the exact complaint that kills trust in a privacy brand.
- *"The price on the pricing page wasn't the price"* — DEP-1.

---

## Empty Chair Scorecard (5 product-specific personas)

Personas generated for a baby/pregnancy tracker holding sensitive health data. Score = "Would I trust and pay for this?" 1–10.

| Persona | Profile | Score | Veto reason (if <6) |
|---|---|---|---|
| **Priya, anxious first-time mum (UK)** | Postpartum, logs mood/EPDS, invited her mother | **4** | "If my mum could accidentally delete everything (SEC-3), or my mood could ever leak, I'm out." Mood is structurally safe ✅ but SEC-3 scares her. |
| **Fatima, twins, employs a nanny (UAE)** | Nanny is a caregiver, not family | **3** | **VETO.** SEC-3 means her nanny can seize/delete the household. This is her exact threat model. |
| **Marcus, co-parent after separation** | Shares a child, trust is low | **4** | **VETO.** Client-only consent (PRIV-1) + SEC-3 = the other guardian can delete the child's record unilaterally. |
| **Zaid, privacy-driven dad** | Chose Cubby for the privacy promise | **5** | EXP-1 (export omits photos) + DEP-1 price mismatch read as "the careful claims aren't all true." |
| **Sofia, the anti-user (paper + iCloud)** | Would never trust an app with this | **2** | Defines the ceiling: only flawless, provable privacy would move her. Not a launch blocker, but the north star. |

**Weighted average: 3.6 / 10 — below the 6.0 Empty Chair pass line.** Two hard vetoes (Fatima, Marcus) both trace to SEC-3 + PRIV-1. Fixing those two lifts every persona above 6.

---

## Trust Scorecard (launch bar: 7.0 weighted)

| Dimension | Score | Weight | Note |
|---|---|---|---|
| Data minimization | 7/10 | 20% | Good siloing; emails over-shared (PRIV-2) |
| Transparency | 5/10 | 20% | EXP-1 false export claim; DEP-1 price mismatch |
| Bias audit passed | 9/10 | 20% | Deterministic, sourced; minimal ML surface |
| Abuse-scenario coverage | 4/10 | 15% | SEC-3 live, SEC-1 pending, SEC-4 open |
| Graceful failure | 8/10 | 15% | Offline/retry/failsafe solid |
| Survivor-panel approval | 3/10 | 10% | Two vetoes, both fixable |

**Weighted total ≈ 6.1 / 10 → below launch bar.** The gap is almost entirely SEC-3, PRIV-1, EXP-1, DEP-1.

---

## Severity classification & required response

| ID | Severity | Gate | Required action |
|---|---|---|---|
| SEC-3 | **Critical** | STOP | Publish the repo `firestore.rules` fix (pins joined role to the invite). Live now. |
| PRIV-1 | **Critical** | Before marketing "both guardians must agree" | Move consent into rules, or soften copy to what rules guarantee |
| DEP-1 | **Critical** | Before driving traffic to /pricing/ | Deploy branch `site`; re-sweep all top-level pages |
| SEC-1 | **Critical-at-flip** | Before setting `PRO_CFG.checkoutUrl` | Bind /portal + /checkout to a verified Firebase ID token |
| EXP-1 | **High** | Before "export anytime" marketing | Include photos in export or correct the claim |
| PRIV-4 | **High** | This week | Publish repo rules (already fixed there) to close live pre-join read |
| SEC-4 | **Medium** | 30 days | Publish repo rules (authorId immutable already added) |
| PRIV-2 | **Medium** | 30 days | Stop exposing member emails circle-wide |

---

## Board decision log

**Assumptions validated ✓**
- Mood/EPDS is genuinely unshareable, pregnancy is owner-owned, Pro is server-locked — all rule-enforced, not UI theater.
- The repo `firestore.rules` already fix SEC-3, SEC-4, and PRIV-4 — they simply need to be **published to the console** (the runtime source of truth) and gated by a green emulator run.

**Assumptions nuked ✗**
- "No more P0s." There are four; one (SEC-3) is live.
- "Export everything, anytime" — currently false (photos excluded).
- "The pricing page is fine" — production serves a stale, contradictory build.

**Low-trust zones 💰**
- Semi-trusted caregivers (nanny, daycare, estranged co-parent) — the exact wedge users — are the ones most exposed by SEC-3 + PRIV-1.

**Action items (owner: saurav)**
1. Run `cd test && npm run test:rules` → green, then publish `firestore.rules` to the Firebase console. Closes SEC-3, SEC-4, PRIV-4 live.
2. Deploy branch `site`; re-sweep top-level pages for stale builds (DEP-1).
3. Decide PRIV-1: rules-enforced consent vs. honest copy. Then align the marketing sentence.
4. Fix export to include photos, or change the "export everything" claim (EXP-1).
5. Before any billing flip: bind /portal + /checkout to Firebase ID token (SEC-1).

**Re-review trigger:** re-run this Red Team pass once items 1–4 are done; expected Trust Scorecard ≥ 7.5, Empty Chair ≥ 6.5, zero live P0.

**Unresolved for founder judgment**
- Whether to gate public launch on PRIV-1 rules-enforcement or ship with honest softened copy and harden post-launch. The board recommends **honest copy now + rules-enforcement on the roadmap**, since the copy claim is the actual liability.
