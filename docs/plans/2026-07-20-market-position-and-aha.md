# Cubby vs Flo, Clue and the tracker category: where the aha actually is

**Date:** 2026-07-20
**Question asked:** "If I need to make this a market beater vs Flo, Clue and other period-tracking
and pregnancy-monitoring apps, what would make this an amazing aha?"

## Provenance, and what to distrust in this document

Produced by a workflow that ran 8 code-grounding agents over this repo, 7 competitor-research
agents over the live market, and 8 idea-generation lenses. **The adversarial kill stage did not
run** — the session hit its token limit after 21 of 217 agents. Four verification lenses
(already-built / charter-safe / feasible-on-this-stack / genuinely-differentiated) were designed
precisely because brainstorm output is usually worse than it looks, and none of them executed.

So: the **research and the code findings are verified** (file:line cited throughout, drawn from
agents that read the actual files). The **ideas are not**. Treat every idea below as a candidate
that still owes four verification passes. A prior audit on this codebase killed 36 of 50 findings
at roughly a 72% rate; assume a similar mortality here.

Also blocked: reddit.com was unreachable to the research agents, so user-voice claims come from
peer-reviewed review-mining studies, App Store review corpora, litigation records and privacy
audits instead. That is arguably a stronger source set, but it is not what was asked for.

---

## 1. The premise "beat Flo" is the wrong goal

| Company | Reality (researched 2026-07-20) |
| --- | --- |
| Tinybeans (ASX:TNY), purest "share with family" | A$4.82M FY25 revenue, **−10.95% YoY**; bought Qeepsake for ~$4.1M just to reach ~90k paid subs |
| Glow, Inc. | ~$8M revenue across ~25M users, ~24 employees |
| Huckleberry (baby category leader) | ~$8M/yr run rate on $16M raised |
| **Maven (employer-paid)** | **~$268M ARR, ~$2,300 per enrolled member vs ~$50 for Glow** |

Consumer family-sharing is a real but small and currently shrinking market. Flo has ~380M
downloads; Natural Cycles spent ~$100M on FDA clearance to be allowed to predict confidently. A
solo founder does not win that fight and should not want the prize.

The goal is to be **structurally incapable of the things every incumbent does that users hate**,
and to make that legible in under a minute.

## 2. The wedge: private-within-shared

Not "calm" — that is an unprovable claim, and every competitor asserts it. The defensible wedge is
architectural: **a household everyone can see, containing compartments only one person can open.**

Why the incumbents cannot copy it:

- **Flo and Clue are single-user.** There is no household to hide from, so a visibility badge would
  read "only you" on every screen and mean nothing.
- **Huckleberry's official support answer to "how do I share with my partner" is: log in with your
  account on your partner's phone.** Nighp's Baby Tracker (4.8★, 227k ratings) uses a sync group
  that is one shared email and password. Neither can attribute an entry or revoke a nanny.
- **Nara Baby's own FAQ says every caregiver gets "100% full access."**
- **Ovia's honest badge would read "you, and your employer's health plan."**

What Cubby already enforces, in rules and not in UI: `firestore.rules:200-233` is a per-subject ACL
inside a shared multi-caregiver household, with an inner category (`mood`) that has **no share
mechanism at all** — not a toggle that defaults off, an absent mechanism. A non-shared member's
listener gets `permission-denied` and silently ignores it (`app/store-firebase.js:702, :769`), so a
caregiver never learns a pregnancy doc exists.

**The decisive framing from the research: the market rewards *legible* privacy, not good privacy.**
Mozilla's 2026-07-16 review scored Euki 10/10 over Clue's 8 and Flo's 7 purely because Euki's story
fits in one sentence. Cubby's advantage is currently invisible to a new user. That is the gap to
close, and it is a *design* problem, not an engineering one.

Cautionary tale from the same review: Stardust scored 2 partly for marketing an "encrypted"
property it did not have. Do not overclaim. See §6 — three live defects currently contradict this
wedge.

## 3. What the category gets wrong (and users say so)

**Loss is the open wound.** Andalibi (2021, *New Media & Society*), a feature analysis of 166
pregnancy apps, found **72% do not account for pregnancy loss at all**; she names it "symbolic
annihilation through design." Roughly 1 in 4 pregnancies ends in loss. Reviewers describe opening
Ovia after a loss to a still-counting due date; Pregnancy+ reviewers report no way to start over
without the lost pregnancy resurfacing. Gillian Brockell's 2018 *Washington Post* open letter after
a stillbirth remains the canonical text on the advertising version of this harm.

Cubby, with no ad pixels and no third-party trackers, is **structurally incapable of the single
most-cited harm in the category.** The loss-holding screen is not a nice-to-have; it is the most
likely reason someone recommends the app to a friend.

**Anxiety is about tone, in both directions.** The 2025 PLOS One study (10 apps, 426 comments)
found users avoiding "scary" posts and resenting repeated weight-gain warnings. But a What to
Expect reviewer with an unplanned pregnancy described the app's constant toxic positivity —
assuming she was "so excited" — as actively harmful. Assumed-emotion copy fails the Anxiety Test
just as hard as fear-mongering does. This validates the existing charter voice rule exactly.

**The partner is the #1 unmet ask.** A 2024 MobileHCI study of 4,000+ reviews across 6 apps found
neglect of family and relatives among the top complaints. A father reviewing What to Expect
reported being emailed c-section recovery forums. Flo for Partners is a read-only view; **Clue
Connect is Plus-only, one-directional, and explicitly unavailable in Clue Pregnancy mode** — at the
exact moment a household most needs coordination.

**TTC is a distinct, more fragile state.** Broad/Biswakarma/Harper (2022, 330 UK women): only
**6.7%** said their app predicted correctly all the time; **72.1%** had periods arrive later than
predicted, and late predictions produced markedly worse emotional harm than early ones.

**Dark patterns are named and resented.** The 2025 CSCW paper is literally titled from a user
review: *"An Ad Posing as Medical Advice."* Mozilla found What to Expect passes signup emails to
Pottery Barn Kids and Huggies without verifying the address. Glow paywalled users' own historical
cycles; the California AG fined Glow $250,000 in 2020, driven substantially by Partner Connect
auto-granting a linking request without the other user's confirmation.

## 4. The strategic call on the trying stage: refuse to predict

**Ground truth (verified):** the TTC stage is a stub. Roughly 100 lines
(`app/index.html:4509-4611`); `lmp` is a **single scalar overwritten every period**, so the app has
no memory of any cycle ever; `cycleLen` is typed once at setup and editable nowhere; there is no
calendar, no cycle-day counter, no BBT, no LH/OPK log, no symptom log, no chart, no export. The
12 well-researched preconception long-reads in `app/reads-data.js:114-126` teach methods the app
cannot perform.

**Do not build ovulation prediction.** Competing there means competing on forecasting, where the
category's own numbers are damning (§3), where the failure mode *is* the harm, where Natural Cycles
spent ~$100M on clearance, and where Cubby's no-medical-advice constraint forbids the payoff. The
FAQ already says honestly: *"Cubby isn't a fertility or ovulation tracker."* No credibility has
been spent.

**Do instead: fix the record, refuse the forecast.** Ask for her last three period dates and show
her own numbers back — *"You've told us about three cycles: 29 days, 34 days, 27 days."* No flags,
no colours, never the word "irregular." Flo cannot ship this, because the forecast *is* the
product and the upsell.

The research thesis worth keeping: *every TTC app monetizes either a test or anxiety, and all
optimize the pre-ovulation half of the cycle — the half where the user has something to do. Nobody
serves the two-week wait, the month it doesn't work, or the partner.*

## 5. The aha moments

Ranked. Each leans on something already built. **None has passed adversarial verification.**

1. **Show her the locked door** *(all, S)* — during first-run she drags a slider labelled "Papa
   Bear" and watches her own home screen change in real time: the period card vanishes, her mood
   note goes grey with a padlock reading **"never, for anyone."** Converts the one uncopyable asset
   into a felt aha in ten seconds. **Blocked by §6.1.**
2. **Your care plan, already made** *(expecting, M)* — due date plus country instantly renders ten
   dated, named, source-cited appointments. Builds on **17 sourced national antenatal schedules**
   (`app/pregnancy-data.js:68-335`) plus the existing `.ics` generator (`app/index.html:4344`).
   Editorial labour no growth team funds.
3. **The page your midwife gets** *(expecting, S)* — on day one, show the actual report she will
   hand over, honestly blank where it is blank. Flo's doctor report is six months of cycle data,
   iOS-only, Premium.
4. **Who carried you** *(baby, S)* — *"2,940 feeds. 1,610 by Mama Bear. 902 by Papa Bear. The 2am
   ones were mostly Papa Bear."* Unrepresentable under a shared login. Ship counts only, never a
   derived judgement — this is one bad sentence from starting a marital argument.
5. **Tell us once** *(expecting, S)* — one tap stops everything everywhere: week counts, reads, the
   shared guest link. **Blocked by §6.3.**

### The full candidate list

Kept so the research is not lost. Effort is the generating agent's estimate, unverified.

| Idea | Stage | Effort | One line |
| --- | --- | --- | --- |
| The Privacy Receipt | all | S | Live self-generated list of every network destination, third-party count: zero |
| Only You (and the mirror) | all | S | Per-record visibility badge naming exactly who can read this screen |
| Her Album | expecting | M | Move scan/bump photo bytes to an owner-owned, consent-gated store |
| One Thread | all | M | One continuous scroll from first period through birth to last night's feed |
| Tell Us Once | expecting | S | One control that stops everything, everywhere, permanently |
| Never Behind a Wall | all | S | Your log/photos/notes are never Pro, export works after you cancel |
| Safety Tools Are Never Paid | expecting | S | Kick counter, contraction timer, danger signs marked "free, always" |
| Papa Bear's Page | expecting | M | A screen written *for* the non-carrying partner, not one with parts removed |
| The Appointment Card | expecting | M | Real dates + your three questions + your numbers since last visit |
| Ten Minutes Back | expecting | S | 40-second post-visit capture of what the clinician actually said |
| The Real Doctor Report | expecting | M | A genuine one-page antenatal summary with charts and provenance |
| Symptom Strip | expecting | S | Severity/duration as a dot strip across weeks, with no opinion attached |
| Results Wallet | all | L | Photograph lab results/scans into a mother-owned, printable folder |
| Your Usual | expecting | S | Kick counter that compares you only to you, and never gives a verdict |
| Carry Card | expecting | M | Printable standing record: due date, blood group, Rh, GBS, meds, care team |
| Something Doesn't Feel Right | expecting | S | One button: the words to say on the phone, and the number already dialled |
| Little Letters | all | S | Sealed dated letters to the child, opened years later |
| The Book | all | L | The pregnancy assembled unasked into a finished narrated slideshow |
| Something to Keep | expecting | M | After a loss, one private unwatermarked keepsake, only if she asks |
| The Arrival Card | baby | S | One-tap birth announcement on the arrival screen itself |
| Their Voice | all | M | 15-second voice notes attached to a moment |
| Who Carried You | baby | S | Year-end card built from authorship: who actually did the nights |
| Heirloom Export | all | M | One file that opens as an illustrated book, forever, with Cubby switched off |
| One Line | all | S | A single sentence a day that quietly becomes the text of the book |
| Week Turn | expecting | S | The pregnancy home opens once a week as a single quiet card |
| While You Were Away | baby | M | "What happened since I last looked", from a per-person last-open timestamp |
| Close the Day | all | M | One tap turns what is already logged into a small dated page |
| The Quiet Fortnight | trying | S | A two-week-wait mode that deliberately shows *less* |
| Tonight's Read, and Pass It On | all | S | One evening read as a story card, ending by sharing the read not the app |
| One Thing Today | all | M | A daily card written for the person who isn't pregnant |
| The Handover Line | baby | S | One shared sentence a day, with a face on it, replacing the WhatsApp thread |
| Your Care Plan, Already Made | expecting | M | Due date + country renders the whole dated antenatal schedule |
| The Whole Way From Here | expecting | M | Swipeable painted timeline from today to birth, before logging anything |
| The Page Your Midwife Gets | expecting | S | Show the real report on day one, honestly blank where blank |
| Sixty-Second Keepsake | expecting | M | First-run ends by producing one finished shareable painted card |
| Show Her The Locked Door | all | S | Live preview of exactly what the person she is inviting will see |
| Your Last Three Cycles | trying | M | Three period dates in, her own numbers back, no forecast |
| The First Year, Already Booked | baby | S | Birthday + country renders the first-year schedule as real dates |
| Grandmother Opens A Link | all | L | Tokenised no-account read-only view of the family's day |
| Handover | baby | M | A shift card: two lines instead of scrolling a timeline |
| Your week, together | expecting | M | A pregnancy week screen written for the partner, who can contribute |
| One thing that would help | all | S | A single open ask the circle can quietly claim |
| Caregiver link seat | all | L | Nana logs from a link, no app store, still attributed by name |
| Notes for the bear | all | M | No-account link for the circle to leave a note that lands in Moments |
| I was there too | all | S | When someone logs a first, others add their own line |
| Whose night | baby | S | Who did the last few nights, so nobody keeps score in their head |
| Day pass | all | M | Expiring read-only link to one day, for a GP or nursery |

## 6. What outranks all of it

Three findings make the above moot until addressed.

**6.1 — Hard scale ceiling at roughly 260 users.** `sendPushReminders` pages the **entire** `/users`
collection every run (`worker.js:230-236`, no filter, no watermark) and `purgeDeletedHouseholds`
full-scans `/households` (`worker.js:318-321`). That is 96 runs/day × (every user + every
household) in Firestore reads on an idle app, against Spark's 50k/day cap. This is arithmetic, not
an estimate, and it is the binding constraint on growth — not the app. **Treat as P0.**

**6.2 — The August Pro launch.** ~2 weeks out, published in 8+ places (pricing hero, `index.html:239/248`,
`faq:136/:445`, `refund:42`, `app/index.html:3200`, `landing.js:219/228`, JSON-LD), and blocked on a
UAE trade licence with no evidence in the repo it has been started. The "20-minute go-live" in
`HANDOFF.md:229` is fiction: every remaining step is out-of-repo and legally sequential. *(The
`plan`-field defect that made $9/month unbuyable is fixed as of commit 88511a8.)*

**6.3 — Three live defects contradict the wedge itself.**
- Pregnancy photo **bytes** are readable by every circle member (`firestore.rules:161`), even when
  the journey is not shared. Blocks "Show her the locked door", which would otherwise lie.
- `lossHolding` — the most sensitive fact in the product — rides in the circle-shared app blob
  (`app/store-firebase.js:631`).
- Any member can overwrite the shared blob wholesale (`firestore.rules:125-131`): a caregiver can
  null every baby, vaccine record and consent decision in one write. `consents` lives there too, so
  consent is client-only and fully bypassable.
- `privacy/index.html:50` still reads **"[Legal entity — to be confirmed]"** on a live, indexed
  page, under GDPR and UAE PDPL, on the exact page the wedge points at. *(Founder input needed:
  this requires the real registered entity and address.)*

## 7. Pricing implication

$90/yr sits at the **top** of the consumer band: Nara £0, Pebbi £19.99/yr, Baby Daybook $34.99
lifetime, Talli $39.99/yr, Baby Connect $49.99/yr, Huckleberry Plus $68.88/yr, Glow Family
$89.99/yr. The log alone will not carry it.

But OurFamilyWizard charges **~$110–300/yr per parent** and TalkingParents killed its free tier in
March 2026. People pay several hundred a year when the shared record has *consequences* — a doctor,
a handover, a court. **Anchor Pro on the doctor report and the record of truth, not on unlimited
logging.** Note the report is currently `openPrintable()`, a print window, while the Pro pitch
calls it a PDF: either build real PDF output or fix the copy before charging.

## 8. Do not build

- **Ovulation prediction** — regulated, unwinnable, contradicts our own published FAQ
- **A symptom checker** — Flo's is unavailable in the UK/EU because it trips MDR Rule 11, and the
  literature shows checkers unsettle exactly the anxious users who reach for them
- **Community forums** — unbounded moderation for a solo founder, and "scary posts" is the top
  cited reason users stop reading BabyCenter and What to Expect
- **A 3D fetus** — Philips does it better, and a stock model cannot be loss-safe or team-green by
  construction the way the painted bear art is

## 9. Suggested order

| # | What | Effort | Why now |
| --- | --- | --- | --- |
| 0 | Cron full-scan (§6.1) | M | Hard ceiling at ~260 users; blocks everything |
| 1 | ~~Due-date cycle fix~~ | — | **Done, commit 88511a8** |
| 2 | ~~Checkout `plan` field~~ | — | **Done, commit 88511a8** |
| 3 | Privacy policy controller (§6.3) | S | Needs founder's registered entity |
| 4 | Pregnancy photo bytes owner-private | M | Unblocks #5 and the pregnancy keepsake path |
| 5 | Show her the locked door | S | Makes the wedge visible |
| 6 | Your last three cycles | M | Fixes the scalar `lmp`; safe ground |
| 7 | Your care plan, already made | M | Best cold-start aha; data already exists |
| 8 | The real doctor report | M | The thing Pro should actually be sold on |

## 10. Open question the research raised and did not answer

Every idea here is consumer-priced. The one company in the adjacent space making real money is
**Maven, at ~$2,300 per enrolled member from employers**, versus ~$50 consumer ARPU. Cubby's
strongest assets — country-correct care schedules, a clinician-facing record, multi-caregiver
roles, a defensible privacy posture — are unusually well-suited to a B2B2C motion, and unusually
poorly suited to winning a consumer app-store fight against a $100M+ incumbent. That is a
positioning question, not a feature question, and nobody has looked at it.
