# Onboarding journeys, painkillers vs vitamins, and the Delta 4 — 2026-08-08

Founder ask: understand the best full-app onboarding journeys, what must happen before sign-in and
what must happen once signed in; list every painkiller and vitamin in the app and where we have a
Delta 4; and choose candidates for each stage of the journey so the app lands and users understand
it. Plan, then execute.

Method: six read-only audit lanes (pre-auth surfaces, post-auth journey, full feature inventory,
Delta-4 evidence, prior strategy docs, measurement reality) plus one synthesiser that re-verified
every citation against `main` rather than trusting the lanes. Delta 4 is Kunal Shah's framework:
score the old way and the new way 0-10 from the user's point of view; a delta of 4 or more makes a
product un-abandonable, and below it people drift back as soon as friction appears.

## What walking the real first run showed (first-hand, not from code reading)

Driven at 390px through `?e2e=onboard`, screen by screen:

1. **The wizard renders a working sample home behind it** — "Nap in progress, 1h 12m, by Mama Bear",
   "Bottle 120 ml, 5:30 PM, by Nanny". Show-don't-tell, already shipped, and it is showing exactly
   the Delta-4 painkiller this plan identifies as the aha. Nobody had written this down. Protect it.
2. **Mobbin punch-list items 2 and 3 are live**: "Hi, I'm Cubby. Let's set up your den." and
   "Private to your family. No ads. We never sell your data." on the stage chooser. Item 1, the
   empty-state door, was the only one outstanding and shipped today as sw v253.
3. **The first form in the product contradicts itself.** The add-baby sheet said "Just a name to get
   started" and then `saveBaby` refuses with "Add their birthday" (`app/index.html:3902`). The very
   first thing a new parent does is get told off for believing the copy. Fixed in this batch, with a
   gate asserting the sheet's promise matches its validation.
4. **Day-zero home, in render order**: greeting, tips ticker, Notes day-surface, photo hero,
   last-feed/sleep/nappy row, Get started. The three answers a 3am parent actually needs are the
   fifth thing down, under a photo prompt and a card a real user already told us did nothing.
   That is section 6 item 1.

Everything below is the synthesiser's plan, unedited.

---

# CUBBY ONBOARDING PLAN — synthesis of six audit lanes, resolved against the code

**Provenance note:** every line number below was re-verified by me against `/Users/m1promax/Downloads/little-log-pwa` (repo root, branch `main`). Several auditors read a stale checkout — their `app/index.html` numbers run ~16 lines low from ~line 2530 onward (they cited `REMINDERS_LIVE` at 4439, it is **4455**; `logDose` 7792 → **7808**; `healthTab` 7875 → **7891**; `renderCaregiverWaiting` 5082 → **5098**; `PRO_LAUNCH` 4103 → **4119**). Use the numbers here, not theirs. I am read-only; section 6 is written for a writer session.

---

## 1. THE ONE SENTENCE

**Cubby's onboarding exists to get a second person logging into the same household inside the first week — everything else in the first session is only there to make that ask credible.**

**The aha, named precisely:** *"Someone else logged it and I never had to ask."* Concretely: the away-recap card rendering "Today so far 🐻 · 4 feeds · 6.2h sleep · last feed 14:10 · logged by Nana Bear" (`app/index.html:2054-2072`).

Why that one and not the three rivals:

- **Not "I logged my first nappy."** Verified: one `commitEvent` re-renders five surfaces at once (`app/index.html:2495-2522`) and it feels good — but it proves Cubby *records*, which a note in iOS Notes also does. Δ≈+2.5. Below 4, so the first gram of friction wins.
- **Not the vaccine plan.** It is real and country-correct (12 schedules, `app/index.html:8482`) and it is the best *proof* available at minute two — but for a settled family the clinic already recalls them. It earns the invite; it does not replace the old way.
- **Not the privacy preview.** `firestore.rules` genuinely forbids mood ever being shared, and the app labels every note's audience — a positioning asset a competitor cannot copy in a sprint, but nobody wakes up needing it.

The away-recap is the only one where the old way (texting your partner, or waking them) is genuinely bad, the pain recurs several times a day, and the substitute cannot be reconstructed. **And it returns empty string until a second caregiver exists** (`app/index.html:2059`: `if(others.length<1) return '';`). That single line is the whole strategy.

---

## 2. THE PAINKILLER / VITAMIN / DELTA 4 TABLE

Scores: 0–10, from the parent's point of view. Sorted by delta descending.

| Capability | Old way | Old | New | Δ | P/V | Pain frequency | Ships today? |
|---|---|---|---|---|---|---|---|
| Loss-safe holding screen | Rival keeps saying "size of a plum" | 0 | 8 | **+8** | Painkiller | Once, or never | Yes `app/index.html:5117` (renderLossHolding) |
| Cross-phone running timer (nap/nursing) | Text "she went down at 1:40" | 2 | 8 | **+6** | Painkiller | Several × day | Yes `app/index.html:2504`, timers in shared blob |
| Shared live log + "logged by X" | WhatsApp to partner/nanny; asking | 2 | 8 | **+6** | Painkiller | Many × day | Yes `app/store-firebase.js:1429`, `app/index.html:2054` — **only with 2+ members** |
| Nappy record the doctor asks for | Nothing; nobody reconstructs a week | 1 | 7 | **+6** | Painkiller (delayed) | Log daily, payoff quarterly | Yes `app/index.html:3635` → `8083` |
| "When was the last feed?" at 3am | Memory; scroll WhatsApp; wake partner | 2 | 7 | **+5** | Painkiller | Many × day | Yes `app/index.html:2813`, rendered `2505-2509` — **10th element down** |
| Private-within-shared (mood never shareable, per-note audience) | A note you hope nobody opens; a second app | 3 | 8 | **+5** | Painkiller (mother) | Daily-ish | Yes, rules-enforced (`firestore.rules` mhealth) |
| Visit summary (free text) | Answering "wet nappies/day?" from memory | 2 | 7 | **+5** | Painkiller | 4–8 × year | Yes `app/index.html:8083` — **3 entry points, none permanent** |
| Vaccine schedule — migrant / lost card | Paper card left at your mother's house | 2 | 7 | **+5** | Painkiller | Once, then a handful | Yes `app/index.html:8482`, `8531` |
| Medicine, *if* push shipped + double-dose guard | iPhone Clock alarm | 4 | 8 | (+4) | Painkiller | Episodic, frightening | **No** — see negatives |
| Pregnancy record + report (US) | A folder of scan printouts you keep nothing of | 2 | 7 | +5 | Painkiller | 10–14 visits | Yes `app/index.html:6732` |
| Day recap text for the other parent | Typing it out yourself | 3 | 7 | +4 | Painkiller | Daily (2+ households) | Yes `app/index.html` dayRecapText |
| Doctor PDF report | Nothing portable | 2 | 6 | +4 | Painkiller | Rare | Yes but **burns the only free try on open**, `app/index.html:8097` |
| Gender/due-date guessing game | WhatsApp poll | 4 | 6 | +2 | Vitamin | Once | Yes — the only true viral loop |
| Moments catalogue (289 cards) | Paper baby book, Instagram | 4 | 6 | +2 | Vitamin | Occasional | Yes `app/journey-catalogue.js` |
| Reads library (116) | Googling at 3am into a forum | 3 | 5 | +2 | Vitamin | Occasional | Yes `app/reads-data.js` |
| Pregnancy record (NHS/AU handheld notes) | The clinic's own book | 5 | 7 | +2 | Vitamin | Per visit | Yes |
| Antenatal schedule + .ics | Clinic gives you the dates | 5 | 6 | +1 | Vitamin | Per visit | Yes |
| Growth curves | Red book; nurse plots the dot | 6 | 7 | +1 | Vitamin | Monthly at best | Yes, **hidden until sex is set** `app/index.html:8292`, `8361` |
| Vaccine schedule — settled family | Paper card + clinic recall SMS | 6 | 7 | +1 | Vitamin | Rare | Yes |
| Keepsake studio (largest code area) | Camera roll + Canva | 6 | 7 | +1 | Vitamin | Occasional | Yes, ~`app/index.html:9200-11050` |
| Rituals / rhythm | Nothing, or memory | 4 | 5 | +1 | Vitamin | Daily | Yes |
| Stats / heatmap | Nothing | 4 | 5 | +1 | Vitamin | Weekly | Yes |
| Trash / export / account deletion | Nothing | 4 | 5 | +1 | Vitamin (trust hygiene) | Once | Yes |
| Trying-stage cycle history | Flo/Clue (which forecast, wrongly but satisfyingly) | 6 | 5 | **−1** | Vitamin | Monthly | Yes — refusal is doctrine, cost is real |
| Voice logging ("Say it" ✨, Pro after 5) | Cubby's own two-tap tile | 7 | 6 | **−1** | Vitamin | — | Yes `app/voice-log.js` |
| Medicine reminders **as shipped** | iPhone Clock alarm | 4 | 3 | **−1** | — | Episodic | **No** `app/index.html:4455` |
| Photo library as a store | Camera roll / iCloud (free, unlimited, searchable) | 8 | 5 | **−3** | — | Daily | Yes — holds 1 of 4 nav tabs + top of home `2503` |

**Δ ≥ 4 painkillers (the whole product):** cross-phone timer · shared live log with attribution · "when was the last feed" · nappy record for the doctor · private-within-shared · visit summary · loss-safe holding. **Seven, out of ~126 catalogued capabilities.** Everything else is a vitamin or worse. Say this out loud: **the studio, the 289 moment cards, the 116 reads and the photo library are more code than all seven painkillers combined and none of them is why anyone stays.**

**High-frequency pains (many times a day — the only ones that compound):** last-feed answer · running timer · shared log/attribution. All three are the *same object* (the live circle log) seen from three angles. All three are dead below two members.

**Where Cubby is WORSE than the old way today:**
1. **Medicine reminders.** `const REMINDERS_LIVE=false` (`app/index.html:4455`); `enablePush` early-returns. Alerts only fire while the app is open and foregrounded. A parent who trusts Cubby over their alarm for a 2am antibiotic is worse off. Compounding it: `logDose` (`app/index.html:7808-7815`) writes the dose immediately with **no recency check, no confirm, no author check**, and the med row (`app/index.html:7706-7724`) shows "Next 14:00" but never "last dose 12:10 by Papa Bear". The most frightening recurring question in the domain — *did someone already give her the Calpol?* — is answerable only by leaving the screen.
2. **Photo library.** Δ−3, holds the top of home (`app/index.html:2503`) and a nav tab.
3. **Voice logging.** Δ−1, Pro-gated after five, absent in the WKWebView wrapper, and it sits in the quick-log registry with a sparkle.

---

## 3. BEFORE SIGN-IN

**Promise leads, proof follows, nothing is asked.** The promise is already written and it is good: `index.html:56` "So the details never live in one tired head." The proof is the product shot beside it.

| Step | Today | Target | Where |
|---|---|---|---|
| 1. SERP / share preview | Title leads "Baby Tracker, Vaccine Schedule & Keepsakes" — ends on a Δ+1 vitamin | Lead with the shared-circle pain | `index.html:9,15,21` — **needs a yes** |
| 2. Marketing first fold | Correct and strong; leave alone | unchanged | `index.html:55-72` |
| 3. `/app/` cold paint | Three screens: static SEO fallback → "Putting the kettle on…" spinner → landing. 1.6 MB JS, of which Firestore (341 KB) + Messaging (38 KB) are provably unusable signed-out and execute *before* `showSignIn()` | Two screens. Move Firestore + Messaging tags behind auth resolution | `app/index.html:72-73` (deferred), `11105-11106` (landing.js parser-blocking, store-firebase.js deferred). **Additive, no behaviour change** |
| 4. The landing itself | Full second marketing page: 8 feature cards, 3 steps, Pro table, and outbound links to `/features/ /articles/ /pricing/ /faq/` at the exact moment of commitment | Serve the compact one-viewport `appSignIn` when `document.referrer` is little-cubby.com — that screen already exists and works | `app/landing.js:68-93` (appSignIn), `:176-181` (router). **Needs a yes — changes a live surface** |
| 5. Sign-in buttons | Google + Apple + email magic link, consent + privacy link right there. Correct | unchanged | `app/store-firebase.js:374-388` |
| 6. Privacy link destination | `/privacy/` says the controller is **"[Legal entity — to be confirmed]"** | Real entity | `privacy/index.html:50-51` — **founder-only, blocking** |
| 7. Invite arrival | Best screen in the product: "Sign in with the email address they invited / That is how Cubby knows which family to let you into" | unchanged until the token ships | `app/landing.js:154-171` |

**Cut (pre-auth):**
- The 8 feature cards, 3-step how-it-works and Pro comparison table on `/app/` for referred visitors (step 4). **Needs a yes.**
- Firestore + Messaging from the pre-auth script chain (step 3). Additive.
- The dead `.ll-values` fallback card at `app/store-firebase.js:394` — unreachable, because `landing.js` is parser-blocking (`app/index.html:11106`) and `store-firebase.js` is deferred, so the `cubbyLanding` branch always returns first (`:376-388`). Either delete it or port its three bullets into `landing.js`. ONBOARDING.md documents it as shipped; it never has.

**Add (pre-auth):**
- Apple to the FAQ. `grep -ci apple faq/index.html` = **0**. Two answers (`faq/index.html:29,179`) tell iPhone parents there are two ways in. **Needs a yes — live marketing copy.**
- A `/terms/` link. The page exists (`terms/index.html`) but `grep -c terms sitemap.xml` = **0** — orphaned, and required for the App Store. Additive.

**Do NOT add:** an interstitial, a cookie banner, an email gate, a timed install prompt. `install.js` fires only on click — there is no `setTimeout`, no scroll trigger anywhere in it. That restraint is a differentiator; protect it.

**Live-marketing changes that need the founder's explicit yes (listed, not assumed):**
1. Title/og tags on `index.html:9,15,21`.
2. Serving the compact sign-in on `/app/` for referred visitors.
3. Apple in `faq/index.html:29,179`.
4. **Pro's date has passed.** `PRO_LAUNCH = 'August 2026'` (`app/index.html:4119`); today is 2026-08-08; and the claim is live on `index.html:248` and in **eight** places in `faq/index.html` (`:54,87,134,140,241,323,445,461`), while `pricing/index.html` promises "cancel before day 7 and you won't be charged" for a checkout that does not exist (`PRO_CFG.checkoutUrl` is `''`). Decide: new date, or "coming soon" with none.
5. **Newsletter.** `news-widget.js:18` `var ENABLED = true;` and the confirmation says "Watch your inbox in a couple of weeks." The Worker writes one D1 row and sends nothing. Either ship a send or flip that one line to `false`. Flipping it removes a live surface → yes required.
6. Google Fonts on 487 marketing pages, including `/privacy/` itself under the no-third-party-trackers line, while the app self-hosts deliberately.

---

## 4. AFTER SIGN-IN

### Time to first log — the number

- **Fastest path today: 10 taps + one typed name.** Stage card → type name → open birthday modal → pick day → Done → Add baby → Continue (locked identity) → Maybe later → Diaper tile → Wet (`app/index.html:5074` → `3897` → `3925` → `store-firebase.js:2286`/`2219` → `app/index.html:3943` → `3622` → `3635`).
- **The path the app itself points at: 12 taps, and it does not produce a log.** The Get started row says "Log your first entry · One tap below, feed, sleep or nappy" with `action='openFeed()'` (`app/index.html:2047`), the feed sheet's primary button is "Start nursing timer" (`app/index.html:3380`) which writes `timers`, not `state.events` — and the row's own completion test is `haveLog=(state.events||[]).length>0` (`app/index.html:2027`). **She does exactly what the app told her and the checkbox stays empty.**
- **Target: 8 taps, and both paths equal.** Point that row at `openDiaper()` (or count a running timer as a log), and let the finish sheet's dismissal land on the log rather than requiring a separate "Maybe later".

### First session — ordered moments

| # | Moment | Painkiller it must deliver | Today | Should |
|---|---|---|---|---|
| 1 | Stage picker | none — it is a fork | 3 equal cards, privacy line, correct (`app/index.html:5074`) | unchanged |
| 2 | Baby details | none | name + birthday required, country prefilled | unchanged |
| 3 | Identity (locked modal) | attribution | Only escapable surface in the app with no ×, no Log out; mitigated by a 6s optimistic exit (`app/store-firebase.js:2219`) | unchanged — a nameless member breaks "logged by" |
| 4 | **Setup climax** | *proof Cubby knew something she never typed* | `openOnboardInvite` (`app/index.html:3943`) says nothing about the vaccine plan. Only `showBirthArrival` (`:7118`) names it — reachable only from pregnancy→birth | Add one line to `openOnboardInvite`: "Their vaccine plan is already waiting in Health: N visits, on the X schedule." Same for the pregnancy branch (the national antenatal schedule is already seeded) |
| 5 | First log | records | 10 taps via nappy | 8, and fix the checklist's own CTA |
| 6 | First render after the log | *the app answers back* | Five surfaces flip at once. Strongest thing in the product. | unchanged |
| 7 | First visit to Health | proof, again | `let healthTab='meds'` (`app/index.html:7891`) — opens on an empty Medicine list, in front of the treasure | Default to `'vaccines'` until a medicine exists. **Nav-default change on a live surface → needs a yes** |

### First week (day 2–7)

**Today there is no out-of-app re-entry mechanism at all.** `REMINDERS_LIVE=false` (`app/index.html:4455`) kills the toggle, which kills `cfg.enabled`, which kills `syncReminderIndex`, which means the cron's Firestore index is never written. No lifecycle email exists (Resend is magic-link only). Day 2 depends entirely on her remembering Cubby exists — and solo, Cubby is a Δ+2.5 vitamin. That is precisely the case the framework says drifts back.

1. **Day 2, someone else logged** → away-recap fires. Correct today, but same-day only (`app/index.html:2055-2059`). Extend past `dayKey(e.time)===todayK` to "since you last opened", **keeping `others.length<1` unchanged** — that guard is what makes it safe: it only ever fires when the circle actually carried the load, never to tell a solo parent what she missed.
2. **Day 2, solo** → nothing should fire. Correct.
3. **Medicine course starts** → this is the one legitimate push. Flip the flag when `/api/health` reports `cronHealthy:true` **and** the APNs .p8 is up. Note `state.settings.push` is still the *shared* household blob (`pushCfg`), so quiet hours and enabled are circle-wide the moment it flips — fix that in the same change.
4. **Everything else** → stays pull. No streaks, no digest, no re-engagement.

### The second caregiver — the journey the company rests on

| # | Moment | Today | Should |
|---|---|---|---|
| 1 | Owner decides to invite | Finish sheet's primary CTA is "Invite someone" → `openFamily()` (`app/index.html:3951`, `store-firebase.js:2032`) — a mega-modal that renders the member list, the pending list, an explanatory paragraph and **the owner's own profile form** above the invite field | A focused invite sheet: one field, one button. No rules change, one session |
| 2 | Owner enters the invitee | Must type the other adult's **exact** sign-in email from memory, at 3am, one-handed | Same, until the token |
| 3 | Cubby sends the invite | **It doesn't.** `submitInvite` writes `invites/{email}` and hands back a share sheet or `mailto:` (`app/store-firebase.js:2425`, `:2460`). The link is `location.origin + '/app/?join=1'` — identical for every family, no token (`:2360`), so the pairing lives in prose: "It has to be that one" (`:2362`) | Tokenised link. Rules already published. Highest-leverage change in the audit |
| 4 | Invitee opens the link | Best screen in the product (`app/landing.js:154-171`); intent survives OAuth redirect and cold native launch | unchanged |
| 5 | Invitee signs in | Email must match exactly. **Apple's Hide My Email makes mismatch the default** for anyone invited to their real address — the code says so at `app/store-firebase.js:766-772`. Recovery screen is honest and well-built (`:1211`) but it is a recovery screen for a design flaw | Token removes the failure class entirely |
| 6 | Invitee's first paint — **baby household** | Alive: an existing log, per-person coach marks (the shared-`seen` bug is genuinely fixed), the "what to log" offer | unchanged — this is in good shape |
| 7 | Invitee's first paint — **expecting household** | **Dead end.** `renderCaregiverWaiting` (`app/index.html:5098-5113`) is a logo, "You're in 🐻", one paragraph, and `<button class="ob-logout">Log out</button>`. No nav, no settings, no theme, no bear picker. The most prominent action is leaving. And he sees "You're in 🐻" twice — once as the locked modal, once as the screen under it | Give it settings + bear picker at minimum. Better: prompt the owner when `members` grows and the pregnancy is shared with nobody — "X has joined. Ready to tell them?" The only place that question is ever asked is at pregnancy creation, when the circle is empty by definition |
| 8 | Second caregiver logs once | Owner's away-recap fires → **the aha** | This is the finish line. Everything above serves it |

---

## 5. STAGE CANDIDATES

| Journey stage | The ONE thing that must land | The one thing that must NOT compete |
|---|---|---|
| **Cold visitor** | "So the details never live in one tired head" + a product shot showing "by Mama Bear" (`index.html:55-72`) | Keepsakes. It is in the title tag (`index.html:9`) and it is a Δ+1 vitamin |
| **Sign-in moment** | Three doors, consent + privacy in the same glance, in one viewport (`app/landing.js:68-93`) | The second sales page below the fold, and its four outbound links (`app/landing.js:204-205, 244`) |
| **First session** | Proof: "your vaccine plan is already waiting — N visits, on the X schedule" | Photos. "Add a photo" is row 2 of the checklist (`app/index.html:2045`), above the first log and above the invite |
| **First log** | The instant answer-back — five surfaces flipping from one tap | A tips ticker above it (`app/index.html:2498`, retires only at 25 events) and a Notes card a real user already said did nothing for them (`:2500`) |
| **Day 2–7** | "Someone else logged it" — away-recap, extended to "since you last opened" | Any nudge, digest, streak or count. If nobody else logged, silence is the feature |
| **Second caregiver** | A link that works without the sender spelling an email correctly | The Family & sharing mega-modal, and the owner's own profile form sitting above the invite field |
| **Trying** | Be present, honest and unhurried when the positive test arrives (`openPositiveTest`) | A daily hook. The doctrine forbids one; do not score this stage on DAU |
| **Expecting** | The mother's private note ("How are you, in yourself?") — the Δ+5 nobody else offers | The 289-card Moments catalogue holding a whole nav tab of three. And `renderPregTools` (`app/index.html:6603`) is **unreachable** — `pregGo` rewrites `'tools'→'care'` (`:6089`) and nothing calls it, so before week 30 the birth plan and hospital bag have no entry point at all |
| **Baby** | The last-feed / last-sleep / last-nappy row, first on the screen | The photo hero above it (`:2503`) and the day-surface Notes card above that (`:2500`) |
| **Child** | The visit summary — a permanent "prepare for the doctor" button | More logging tiles |

---

## 6. THE EXECUTION PLAN

Ranked by (delta × frequency) / effort. **I am read-only — this is the brief for a writer session.** Every item bumps `sw.js` and needs `node tools/perf_check.js` to pass.

### SHIP NOW (one session, all additive, no live surface removed)

| # | Change | Files | Size | Gate |
|---|---|---|---|---|
| 1 | **Reorder `renderHome`**: move the since-row (`2505-2509`) above `daySurface()` (`2500`) and `renderHero()` (`2503`); move `${alerts}` (`2515`) above the Quick log section (`2512`). A due-medicine pill is the most important thing the app ever says and it currently renders under six tiles | `app/index.html:2495-2522` | ~10 lines moved | Screenshot at 390px, signed in, with a due medicine. Verify `#scroll` node survives (paintShell invariant) |
| 2 | **Double-dose guard.** Render `lastDose(m.id)` on the med row ("last dose 12:10 by Papa Bear") and interpose a confirm when `Dose` is tapped inside the schedule interval | `app/index.html:7706-7724`, `7808-7815` | ~25 lines | Log a dose, tap Dose again within the interval, confirm appears; outside the interval it does not |
| 3 | **Fix the checklist's own CTA**: row 4 → `openDiaper()`, and reorder rows to baby → first log → invite → photo | `app/index.html:2044-2048` | 4 lines | Follow the checklist end to end; every row you complete ticks |
| 4 | **Name the proof at the setup climax.** One line in both branches of `openOnboardInvite` reusing `showBirthArrival`'s computation (`app/index.html:7118`) | `app/index.html:3943-3962` | ~8 lines | Fresh baby-path signup shows the visit count and schedule name |
| 5 | **Focused invite sheet.** Own sheet: one email field, one button, the invitee-privacy sentence, then the share row. Reached from the finish sheet and from Family & sharing | `app/store-firebase.js:2032-2131`, `app/index.html:3951` | ~60 lines | Invite created in ≤3 interactions from the finish sheet |
| 6 | **Feedback dates.** Write field is `at` (`app/store-firebase.js:2499`); both readers sort on `createdAt` (`tools/analytics.js:154-155`, `tools/ops.js:94`), so `ms(undefined)=0` and the sort is a no-op | 2 files, one word each | 2 lines | `node tools/ops.js` shows dated notes, newest first |
| 7 | **`joinedAt` on join.** `memberUpdate` (`app/store-firebase.js:677-683`) writes `members.{uid}` and `memberInfo.{uid}` with no timestamp — so the adopted north-star metric is uncomputable. Both join paths call this one function | 1 line | 1 line | New member's `memberInfo` carries a server timestamp |
| 8 | **Carrier default.** `viewerIsCarrier` (`app/index.html:5514-5518`) returns `true` on an empty relationship, and relationship is optional at identity — so a father who skips the dropdown is shown "First day of your last period" and "You may be in your fertile window" | `app/index.html:5514`, or require relationship in the planning stage | ~5 lines | Skip relationship, land on the partner home |

### NEXT

9. **Tokenised invite** (`app/store-firebase.js:2360`, `:2425-2477`, `firestore.rules` invite branch). Removes the email-guessing failure class and the Hide My Email default. Needs its own emulator run — a prior audit found a hijack hole on this exact surface. Join through the honest confirm sheet that already exists (`app/store-firebase.js:1277-1281`), never silently: one account maps to one household with no switcher.
10. **Flip `REMINDERS_LIVE`** (`app/index.html:4455`) once `/api/health` reports `cronHealthy:true` **and** the APNs .p8 is uploaded. In the same change, move `push` out of the shared settings blob — quiet hours are per-person.
11. **Caregiver-waiting screen gets a shell** (`app/index.html:5098-5113`): settings, bear picker, theme. Plus: prompt the owner when `members` grows and the pregnancy is shared with nobody.
12. **Pre-auth payload**: move Firestore + Messaging behind auth resolution (`app/index.html:72-73`). Roughly halves the cold pre-auth JS.
13. **Get started + coach marks for expecting/planning.** `renderGetStarted` has exactly one call site (`app/index.html:2402`, inside `renderHome`); `log-guide.js` already has a pregnancy branch it can never reach.
14. **Permanent "prepare for the doctor" button** on the Health tab → `openVisitSummary()` (`app/index.html:8083`). Three entry points today, all conditional.
15. **Doctor-report taste consistency.** Baby report spends the single free PDF on **open** (`app/index.html:8097`); pregnancy and TTC spend it only on print/share. Move the baby charge to print/share.
16. **Away-recap past today** (`app/index.html:2055`), keeping `others.length<1`.
17. **Runaway-timer sanity prompt.** `stopSleep` (`app/index.html:3594`) writes any duration; a nap left running overnight books a 14h sleep into the data that feeds the doctor report.

### LATER

18. Stage label on the shared blob so the funnel can see Trying/Expecting (`tools/funnel.js:22-27` scores every expecting household 0% on "Added a baby" — the reported activation leak may be pure measurement artefact).
19. Date-bound the ops event scan (`tools/ops.js:45` and `tools/analytics.js:33` are unbounded `collectionGroup('events').get()`, polled every 30s against a 20s cache — the exact failure mode already fixed in the push cron).
20. Decide the pregnancy Tools tab: `renderPregTools` (`app/index.html:6603`) has zero call sites and `pregGo` (`:6089`) rewrites the route.
21. Block `?tab=den` — `go()` (`app/index.html:3099`) has no view whitelist, so a URL renders the flag-hidden Den module.
22. Read-only demo family pre-auth (also produces the App Store review demo account).

### NEEDS A FOUNDER YES (never assumed)

- **A.** Pro's date, live on `index.html:248` and eight places in `faq/index.html` — the date has passed and no checkout exists.
- **B.** Newsletter: ship a send, or set `news-widget.js:18` `ENABLED = false`.
- **C.** Legal entity for `privacy/index.html:50-51` — **blocking, founder-only, no engineering can fix it.** Every sign-in consent link points here.
- **D.** Health tab default → `'vaccines'` (`app/index.html:7891`) — a nav-default change on a live surface.
- **E.** Serving the compact `appSignIn` to referred visitors instead of the long `/app/` landing.
- **F.** Apple in `faq/index.html:29,179`; title/og on `index.html:9,15,21`.
- **G.** Demoting the photo hero / Album tab (item 1 relocates the hero below the since-row — that is a relocation on a live surface).
- **H.** Self-hosting fonts on the marketing site, or narrowing `index.html:147`'s blanket "No third-party trackers" to `privacy/index.html:46`'s more careful wording.

---

## 7. HOW WE WILL KNOW

Four numbers, all from data the app already writes, all first-party, all internal-only.

| # | Number | Source | Status |
|---|---|---|---|
| **N1** | **Second member joined within 7 days of household creation** | `memberInfo.{uid}.joinedAt` (new, item 7) vs `households.createdAt`. Interim proxy available today: `invites/{email}.createdAt` (written at `app/store-firebase.js:2463`, survives the join) vs `households.createdAt`, outcome from `members.length > 1` | Needs item 7; proxy works now |
| **N2** | **Invite → join conversion** | Already computed: `tools/analytics.js:103-104`, `tools/funnel.js:44-57`. Add nothing | Live |
| **N3** | **Multi-caregiver share of households** | `tools/analytics.js:82` — "key value prop", already labelled as such. **This is the single most valuable number in the business and nobody in six lanes could read it.** Run `node tools/ops.js` before shipping anything | Live |
| **N4** | **Dated free-text feedback** | `feedback` collection; fix the `at`/`createdAt` mismatch (item 6). At ~20 testers this outranks the entire quantitative funnel | One-word fix |

Report N1 and N3 with the excluded-household count alongside (`tools/funnel.js:39-41` silently drops any household whose first log was backdated — a survivorship bias in the exact number used to judge activation).

**Never surfaced to a user. Never used to trigger a nudge.** A happy solo parent is not a failure.

---

## 8. WHAT NOT TO DO

This plan's specific temptations, named:

1. **Do not turn the Get started card into a progress meter or a streak.** ONBOARDING.md already drew this line for the log guide — "no progress meter and no completion count". Reordering the rows (item 3) is fine; adding "3 of 5" is not. And the auto-hide must keep excluding `shared` (`app/index.html:2037`) — a solo parent must never carry a permanently unfinished checklist.
2. **Do not build a re-engagement push while fixing day 2.** The only push Cubby ships is medicine, per-dose. "Nobody has logged today" is exactly the notification this product exists to not send.
3. **Do not solve "no product before sign-in" with a modal, a timed prompt, or an email gate.** `install.js` currently fires only on click and there is no cookie banner anywhere on the site. That restraint is a differentiator a sceptical parent notices.
4. **Do not ask for notification permission before medicine exists.** The explain-then-ask order is already the rule; `enablePush` must stay behind a real schedule.
5. **Do not promise the tokenised invite, push, or Pro in copy before the code lands.** Cubby currently has three live overdue promises (Pro's date, the newsletter's "watch your inbox", "with reminders" unqualified in the app's own SEO fallback). On the one product whose wedge is trustworthiness, a fourth is the expensive kind of mistake.
6. **Do not optimise for signups.** N3 (multi-caregiver share) beats total households. A thousand solo signups is a thousand people at Δ+2.5, all of whom drift.
7. **Do not treat the Δ+8 loss-safe flow as a feature to measure.** It shows in no metric, buys no growth, and is the single most defensible thing in the product. Never trade it for a number.
8. **Anxiety Test, applied to this plan specifically:** the double-dose guard (item 2) must not become a scolding — it is one line of fact and one confirm, never "are you sure? you already gave a dose". The runaway-timer prompt (item 17) asks "this nap ran 14h — was it really?", not "you forgot to stop the timer". And the stats path still divides by a fixed 7 days, so a two-day-old household reads as an underfed baby — fix that before pointing any new user at Stats.