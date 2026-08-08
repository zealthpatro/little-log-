# Cubby: what it is, what it does, and what it cannot do yet

**A handover document for the marketing team.** Written 8 August 2026, checked against the live code at commit `e80230a` (service worker version 262) and against the live site.

**How to read the code references.** Lines like `app/index.html:4540` are pointers so an engineer can confirm any claim in this document in under a minute. You do not need to understand them. You do need to know that every claim below was checked by opening that line. Where something could not be checked from the code, it is marked INFERRED and the reason is given.

**One correction to earlier drafts, made by recounting.** Two internal reports said 3,423 pages load fonts from Google and 4,606 pages carry the newsletter signup. Both numbers were inflated by a stale copy of the site sitting inside a development folder. The real live figures are **489 pages loading Google Fonts** and **658 pages carrying the newsletter widget**, out of 721 live pages. The finding stands; the scale was overstated by roughly seven times. Use the corrected numbers.

---

## 1. The one-paragraph truth

Cubby is a free, private baby and pregnancy log that several people share in real time. It runs in a browser, it installs to a phone home screen, and it is not in any app store. Its real customer is not one parent, it is a household: a mother, a partner who is out of the house, and often a nanny or a grandparent. The single promise it can keep today, in full, verified in code, is this: **you will not be the only one who knows what happened today.** Everything anyone logs appears on everyone else's phone within seconds, every entry carries the name of the person who made it, and that name survives even after that person is removed from the circle. Two more things are true and worth saying: **your country's real vaccine schedule appears with real dates the moment you type a birthday**, and **a mother's private notes are private by a rule on the server, not by a setting anyone can flip.** That is the honest product. It is narrower than the website currently implies, and the biggest gap is this: the promise above only comes true once a second person has joined, and the app has no way of reaching anybody once it is closed.

---

## 2. The full feature list

Four statuses:

- **LIVE** works today, verified in code
- **LIVE BUT NARROW** works, with a limit a customer would notice, stated
- **BUILT BUT DARK** the code exists, the user cannot reach or use it
- **PROMISED, NOT REAL** live copy claims it, the code does not deliver it

### 2.1 The three facts that constrain everything

| Fact | Verified at | What it means for you |
|---|---|---|
| **Push notifications do not deliver. At all.** | `app/index.html:4540` sets the delivery switch to off. The live health endpoint returns zero reminders due and zero sent. | Never write "reminder", "notification", "nudge" or "alert" about anything that reaches a closed phone. |
| **Nobody can buy Pro.** | `app/index.html:4189` has an empty checkout address. The launch date now says October 2026 (`:4196`). | No price-led campaign, no "upgrade", no trial messaging. Every Pro button ends at a waiting list. |
| **We have almost no user voice.** | The in-app feedback capture works (`app/store-firebase.js:2502`) but was effectively empty until days ago. | Never write "parents told us" or "parents asked for". The only genuine customer words we own are four testimonials on the homepage. |

### 2.2 All stages: account, sharing, privacy, platform

| Capability | Status and the honest limit |
|---|---|
| Sign in with Google, Apple, or a link sent to your email | **LIVE.** The email-link path depends on a live third-party sending key we cannot verify from the code. INFERRED working. |
| Real-time sync across every caregiver's phone | **LIVE.** This is the core of the product. |
| Works offline: the app opens and accepts entries with no signal, and syncs later | **LIVE.** |
| Opens fast even with years of history | **LIVE.** Loads the recent window first, fills in the rest in the background. |
| Invite someone to the circle | **LIVE BUT NARROW. Cubby does not send the invite.** It creates the invite and hands the parent a message to send themselves by WhatsApp, text or their own mail app (`app/store-firebase.js:2447`). The button literally says "Create invite". The recipient must then sign in with that exact email address or they land in a brand new empty household. |
| Two roles: owner and caregiver | **LIVE**, enforced on the server. There is **no view-only role.** Anyone you invite can write. |
| Every entry says who logged it | **LIVE**, enforced on the server. |
| That name survives after the person is removed | **LIVE.** The nanny who left keeps her credit; her access ends immediately. |
| Your own settings do not change anyone else's (theme, shortcuts, hints) | **LIVE**, with one exception, see the free-trial counter below. |
| Delete your account on your own, without anyone's permission | **LIVE.** |
| Thirty-day grace period if you are the last member | **LIVE BUT NARROW.** The countdown is written by the app; the final deletion depends on a scheduled job we did not verify running. |
| Export everything you have put in, as a file, including photos | **LIVE**, but the file is in a developer format, not a spreadsheet. |
| "Both guardians must agree" before a household export or erase | **BUILT BUT DARK in the way that matters.** The screen is real (`app/index.html:4975`) but there is **no rule on the server** enforcing it. We checked: the words "guardian" and "consent" appear in the server rules only inside comments about a different feature. This is a shared-decision screen, not a protection. The FAQ currently describes it as a guarantee. |
| Recently deleted, thirty days | **LIVE.** |
| Light, dark, or follow your phone, per person | **LIVE.** |
| Add to home screen, with a guided walkthrough on iPhone | **LIVE.** |
| Shared links open the right screen, even after signing in | **LIVE.** |
| Haptic feedback | **LIVE BUT NARROW.** Real only inside the TestFlight iPhone app. It does nothing at all on iPhone Safari or the installed home-screen version, which is where most people are. Do not describe tactile feedback as a product quality. |
| Push notifications | **BUILT BUT DARK.** Whole system exists, switched off. |
| Cubby Pro | **BUILT BUT DARK.** Collects a waiting-list registration instead. |
| Free tastes of Pro features before you buy | **LIVE BUT NARROW, and this matters for pricing copy.** Three free style exports, three enhances, three cutouts, one Then and Now, one doctor PDF, five voice logs. **The counters are shared across the whole household** (`app/store-firebase.js:698` does not separate them). Two parents share ONE free doctor report and ONE Then and Now, forever, with no way to buy more. |
| Send feedback from inside the app | **LIVE.** |
| Share Cubby, referral link | **LIVE.** |
| Reading room, 116 curated in-app reads, article cards on the home screen | **LIVE.** The website has 661 published articles. |
| "What to log, and why" guide | **LIVE.** Never opens on its own, always available in Settings. |
| Voice logging, "say it" | **LIVE BUT NARROW.** Uses a browser feature that **does not exist in the iPhone app wrapper or in Firefox.** Falls back to typing. Understands feeds, sleep, nappies and pumping only. Not offered during pregnancy. Free-form parsing is a Pro feature after five household-wide tries. |
| "Our Den": chores, shopping, meals, staff, household expenses | **BUILT BUT DARK.** Switched off behind a single setting (`app/index.html:1376`). Roughly 400 lines of working code nobody can reach. **Do not mention it.** |
| Native iPhone app | **BUILT BUT DARK for the public.** TestFlight only. The site correctly says there is no app store version. Keep that copy. |
| No ads, no advertising or analytics trackers **inside the app** | **LIVE and true.** The app loads nothing from a third party. See section 6 for the marketing site, where this is not true. |

### 2.3 Baby stage

| Capability | Status and the honest limit |
|---|---|
| Feeds: breast with a live timer and side, bottle with amount, solids with food tags and a photo, water | **LIVE.** |
| Sleep: live timer, start from a past time, log a nap that already happened | **LIVE.** |
| Nappy: wet, dirty, both. Two taps | **LIVE.** The fastest thing in the app. |
| Pumping: left, right, live timer | **LIVE.** |
| Activities: bath, play, tummy time, sun, notes, photo | **LIVE.** |
| Weight and height on official growth curves | **LIVE BUT NARROW.** You must set the baby's sex or no curves appear. Bands stop at 24 months (WHO) or 36 months (CDC). **There is no head circumference at all**, which is a measurement every paediatrician plots. |
| Milestones: 225 built in, plus your own, with a photo | **LIVE.** |
| Log anything retroactively | **LIVE.** The only way the working partner ever logs. |
| Edit an entry with a visible history, soft delete, recover | **LIVE.** |
| Twins and siblings, per-baby timers | **LIVE.** |
| Live timer banners on every phone | **LIVE.** The clearest proof two phones share one truth. |
| "Since" cards, ticking live: last feed 2h 14m ago | **LIVE.** |
| "Today so far" recap of what happened while you were out | **LIVE BUT NARROW, and this is the single most important limit in the document.** The card returns **nothing at all** unless a second person logged **today** (`app/index.html:2108`). For a solo parent it does not exist. It is the highest-value thing in the product and it is invisible until somebody else is in the app. |
| A page for any day: notes, photos, recap, scrub back | **LIVE.** |
| Notes addressed to everyone, one person, or nobody | **LIVE**, enforced per note on the server. |
| Pinned notes, one per person, all shown | **LIVE.** |
| Full timeline, grouped by day | **LIVE.** |
| Stats: seven-day bars with honest averages over the days actually logged | **LIVE.** |
| Activity heatmap by week or month | **LIVE.** |
| Rituals: a gentle "five of seven" rhythm, never a streak | **LIVE.** |
| Customisable floating quick-log button, per person | **LIVE.** |
| "Get started" checklist | **LIVE BUT NARROW.** It hides itself only once a baby, a log **and a photo** exist. A parent who never adds a photo keeps an unfinished checklist on her home screen forever unless she finds the small close button. |
| Photo album and a slideshow on the home screen | **LIVE BUT NARROW.** Photos are shrunk to about 1200 pixels and stored inside the database. Anything too large is **silently refused to the rest of the circle** and stays on one device behind a small message. **Cubby is not a photo backup and must never be sold as one.** |
| Photo crop and quick presets | **LIVE.** |
| Keepsake studio: templates, fonts, palettes, stickers, frames, animation | **LIVE BUT NARROW.** Free gets one square format, one font, one palette, one template and six stickers. Most of the rest is Pro, which cannot be bought. |
| Auto-enhance and background cutout, on the device | **LIVE BUT NARROW.** Three household-wide free tries each, then Pro. The cutout also **fails when offline**, because its model is not stored with the app. |
| Monthly photo grid, growth collage, memory cards with real stats, birth announcement poster | **LIVE.** |
| Then and Now, two photos side by side | **LIVE BUT NARROW.** **One** free try per household, ever. |
| Moments library: 299 guided prompt cards with painted bear art (245 baby, 54 pregnancy) | **LIVE.** Never show a first-timer 299 uncaptured cards. |
| Relationship captures, "with family" | **LIVE.** |
| Vaccines: 11 national schedules plus a WHO fallback, with real dates | **LIVE.** Verified: United States, United Kingdom, United Arab Emirates, Germany, Australia, India, Canada, Ireland, New Zealand, Saudi Arabia, Singapore, plus a general WHO schedule for everywhere else. **The correct public number is 11 countries.** Internal notes saying 13 are wrong. |
| Overdue vaccine warning | **LIVE, inside the app only.** |
| "Yes, all up to date" catch-up in one tap | **LIVE.** |
| Vaccine card photo import | **LIVE BUT NARROW. Read this before writing a word about it.** The automatic reading step uses a browser feature that **does not exist on any Apple device**: not Safari, not the installed home-screen app, not the iPhone app wrapper. On an iPhone it finds nothing, every time. What the parent actually gets is a good screen: the card photo pinned at the top with the whole schedule underneath, so they type the dates without switching apps. Nothing is saved unless the parent leaves a date on a row. The photo never leaves the phone. **Never write "scan", "reads it for you", "automatically" or "AI".** |
| Medicines: name, dose, three schedule patterns, next dose due, who gave the last one | **LIVE.** |
| In-app dose alert with three honest exits (log it, in 15 minutes, not now) | **LIVE, only while the app is open.** |
| Dose alerts now cover every baby, not just the one on screen | **LIVE**, shipped this week. Before it, with twins, a sibling's overdue antibiotic alerted nobody. |
| **Put a medicine course into your own phone's calendar** | **LIVE BUT NARROW, and it is the only thing in Cubby that can reach a parent with the app closed.** It writes a real calendar file with an alarm at each dose time, always with an end date, and can be taken back off. Three real limits: it only works for medicines set to fixed daily times, and a new medicine defaults to "every few hours", which is deliberately excluded; the button only appears when you **edit an already-saved** medicine, so it is invisible when you first add one; and Google Calendar handles imported alarms unreliably, so this is strong on iPhone and weak on Android (INFERRED, long-standing behaviour). |
| Illness episodes with a shared temperature trend | **LIVE.** |
| Fever guidance | **LIVE.** |
| **Free doctor visit summary: the last seven days, one tap, ready to read out loud** | **LIVE, and newly easy to find.** It now has a permanent door at the foot of every Health screen. It is free. Only the printable version costs a Pro try. |
| Printable doctor report | **LIVE BUT NARROW, with a real bug.** One free per **household**, ever. And the free try is spent **before** the report is made (`app/index.html:8441` versus `:8485`). If the browser blocks the pop-up, the parent sees "Allow pop-ups to create the report" and their only free try is gone, with no refund. The pregnancy and trying versions get this right. The baby one, which we lead on, does not. |
| Care team, allergies and diet, baby profile with a painted bear avatar | **LIVE.** |
| Health opens on Vaccines until there is a medicine | **LIVE**, shipped this week. Before it, a new parent told "your vaccine plan is waiting in Health" tapped Health and found an empty medicine list. |

### 2.4 Expecting

| Capability | Status and the honest limit |
|---|---|
| Week view with **no countdown**, ever | **LIVE.** The code refuses it and says why. Quiet mode removes the week number and keeps the gentler card. |
| "Baby this week" and "You this week" | **LIVE.** |
| Your country's antenatal appointment schedule, generated with real dates and a source link | **LIVE**, for 15 countries in the pregnancy data. |
| Next appointment card: "in about 2 weeks, 6 questions ready" | **LIVE.** The strongest single moment in the product for this stage. |
| Questions for your visit, saved between appointments | **LIVE.** |
| Antenatal record: blood group, Rh, GBS, fundal height trend, estimated weight, haemoglobin, blood pressure per visit | **LIVE.** |
| Add an appointment to your phone's calendar | **LIVE.** |
| Kick counter (from week 28), contraction timer with the 5-1-1 guide (from week 36) | **LIVE**, correctly gated by week. |
| Symptom log, weight log, blood pressure and urine, glucose with real target bands, nausea and hydration | **LIVE**, most gated on whether she has been asked to track them. |
| Supplements and medicines checklist | **LIVE BUT NARROW, and this is a real hole.** It is a tick box with no dose times, no alerts and no calendar export. **The full Medicine feature cannot be reached during pregnancy at all**: the pregnancy screen has three tabs (Home, Moments, Care) and no Health tab. A woman on low-dose aspirin or iron at 22 weeks has nowhere proper to put it. |
| Mood note, hers alone, **never shareable** | **LIVE, enforced by the server.** The database refuses any write that would share a mood note. This is one of very few privacy claims the database itself keeps. |
| The pregnancy is owned by her and shared only with people she names | **LIVE, enforced by the server.** |
| Per-category health sharing, off by default | **LIVE, enforced by the server.** |
| "Here is who can see this. Is that right?" visibility review | **LIVE BUT NARROW.** It **does nothing when she is the only person in the household**, which is the exact situation it was designed for. And when she later invites her partner, nothing prompts either of them. |
| After-loss softening, and quiet mode with no numbers | **LIVE.** |
| Urgent warning signs, from a national source | **LIVE.** |
| Hospital bag checklist and birth plan, from week 30 | **LIVE.** |
| Scans and bump photos paired with the week | **LIVE.** Pregnancy photos are stored separately from the shared album. |
| 54 pregnancy Moments prompts | **LIVE.** |
| Pregnancy doctor report | **LIVE BUT NARROW.** Shares the same single household free try. |
| Care team with one-tap call | **LIVE.** |
| "Baby has arrived": the pregnancy becomes a keepsake, not a deleted chapter | **LIVE.** |
| **Ending a pregnancy without cruelty, plus a calm holding screen** | **LIVE.** No chooser, no prompts, nothing to do until she is ready, and it is per person so it never announces itself to the household. **This is the largest single act of care in the product.** |
| A read-only view for the partner who is not carrying | **LIVE.** |

### 2.5 Trying to conceive

| Capability | Status and the honest limit |
|---|---|
| Cycle history: the range your cycles actually ran | **LIVE.** "Your last four cycles ran 27 to 31 days. Just what happened, not a forecast." |
| **The refusal to give a dated forecast** | **LIVE, and it is the position.** |
| A rough fertile window shown as a **range**, hideable per person | **LIVE. Be precise here.** Cubby **does** show a six-day range, worded honestly: "Even careful estimates pick the wrong day most of the time." What it refuses is a single dated day and a dated next-period prediction. **Do not escalate this to "Cubby never predicts."** A journalist who opens the app and finds a fertile-window card after we said that has caught us. |
| Look-back card after a completed cycle | **LIVE.** |
| Trying-since, with one kind next step at twelve months | **LIVE.** Fires once, in a year. |
| Two-week-wait card, with no day count | **LIVE.** |
| "Today I noticed" observation diary, no empty grid, no streaks | **LIVE.** |
| Preconception checklist | **LIVE.** |
| Doctor report for a fertility appointment | **LIVE BUT NARROW.** Same single household free try. |
| Partner view: the checklist only, her cycle details never appear | **LIVE.** |
| "I got a positive test", one button into pregnancy | **LIVE.** |

### 2.6 Child, 18 months and up

**LIVE BUT NARROW to the point where it is honest to call it absent.** The app derives a "child" stage from age, but **there is no child card in the setup chooser**: it offers exactly three, expecting, baby, trying. The only way in is to pick "our baby's here" and back-date a birthday. All the stage actually changes is which quick-log buttons appear by default, plus one label. **Nothing in Cubby is built for 18 months to five years** apart from the tail of the vaccine schedule and the older milestones. Do not target parents of toddlers.

### 2.7 The counts, all verified

11 national vaccine schedules plus a general WHO one. 15 countries with antenatal appointment schedules. 225 milestones. 299 Moments prompt cards. 116 in-app reads. 661 published articles. 13 painted bear illustrations. 2 roles. Four stages in the story, three with a door.

---

## 3. Painkillers and vitamins

### 3.1 How to read this table, and its one big weakness

The framework is Kunal Shah's Delta 4: score the way a parent solves this today out of 10, score the Cubby way out of 10, and a gap of 4 or more makes the new behaviour stick. A **painkiller** removes pain someone would pay to stop. A **vitamin** is nice and skippable on a bad day.

**The weakness you must know before you quote any of this.** These deltas come from an internal exercise on 8 August 2026 in which three invented characters scored every feature: a mother six days after birth and alone all day, a working partner who was invited into the circle, and a woman 22 weeks pregnant after a previous loss. They are careful, well-argued constructions. **They are not customers.** No parent has been interviewed. Never present a delta number to anyone outside the company as a research finding.

**A second caveat about the two score columns.** The internal exercise recorded the delta directly, not the pair of scores behind it. The "old way" and "Cubby way" columns below are my reconstruction, chosen to be consistent with the delta that was actually scored. Treat the delta as the number and the two components as illustrative.

### 3.2 The table, sorted by delta

| Feature | What a parent does today instead | Old | Cubby | Δ | Kind | Who it is for |
|---|---|---|---|---|---|---|
| Ending a pregnancy without cruelty, and the calm holding screen | Delete the app, or be shown bump updates for a baby who died | 1 | 8 | **7** | Painkiller | Anyone after a loss |
| "Today so far": what happened while you were out | Ask "how was she today" and hear it was the wrong question | 2 | 9 | **7** | Painkiller | The partner who was at work |
| "Since" cards, ticking live: last feed 2h 14m ago | Ask, or work it out from a group chat | 2 | 9 | **7** | Painkiller | Whoever just walked in |
| Live timer banners on every phone | Text "is she still asleep?" | 2 | 8 | **6** | Painkiller | Both parents |
| Medicine: last dose, who gave it, next due | A note on the fridge, or a guess at 3am | 2 | 8 | **6** | Painkiller | Two adults dosing one child |
| Gentler mode for a pregnancy after a loss | Endure the cheerful default | 2 | 7 | **5** | Painkiller | Pregnancy after loss |
| Illness episode with a shared temperature trend | Notes app, and disagreement about when the fever started | 3 | 7 | **4** | Painkiller | Both parents, about 8 days a year |
| **Free doctor visit summary** | Try to remember, in the room, on no sleep | 2 | 6 | **4** | Painkiller | The exhausted mother |
| Pregnancy visibility review: who can see this | Tell people and hope, or tell nobody | 2 | 6 | **4** | Painkiller | The carrier, sharpest after a loss |
| Who logged it, kept even after they leave | One shared login, so nobody knows who did what | 3 | 7 | **4** | Painkiller | Households with paid help |
| Log something that happened three hours ago | Do not log it | 3 | 7 | **4** | Painkiller | The partner logging at 9pm |
| Works offline, entries queue and sync later | Lose the entry | 3 | 7 | **4** | Painkiller | Commuters, weak signal |
| Refusing to give a dated ovulation forecast | Believe a date that was wrong | 2 | 6 | **4** | Painkiller | Anyone burned by a forecast |
| Two-week wait, with no day count | A countdown that makes it worse | 2 | 6 | **4** | Painkiller | The waiting |
| Trying-since, one kind card at twelve months | Nothing, or panic | 2 | 6 | **4** | Painkiller | Long-haul TTC |
| Pregnancy home with no countdown | An app that tells her how many days are left | 2 | 6 | **4** | Painkiller | The anxious mother |
| Urgent warning signs, from a national source | Search at 2am and find the worst answer | 3 | 7 | **4** | Painkiller | Everyone |
| Baby arrives, the pregnancy becomes a look-back | Two separate apps, one abandoned | 2 | 6 | **4** | Painkiller | New parents |
| The day as a page: notes, photos, recap | Scroll a group chat | 2 | 6 | **4** | Painkiller | Mostly the returning partner |
| Feeds logged by the second caregiver | She logs everything, he logs nothing | 2 | 6 | **4** | Painkiller | The circle |
| Real accounts per person, roles, removal | One shared password | 4 | 7 | **3** | Painkiller | Households with a nanny |
| Nappies, edit history, honest weekly averages | A free tracker that does the same | 5 | 8 | **3** | Painkiller | Everyone |
| Glucose tracker with real target bands | A paper diary from the clinic | 4 | 7 | **3** | Painkiller | Gestational diabetes |
| Antenatal schedule, visit prep, growth trend | A paper card from the midwife | 4 | 7 | **3** | Painkiller | The mother |
| Health sharing by category, off by default | All or nothing | 3 | 6 | **3** | Painkiller | The carrier |
| Export everything, delete your account alone | Trapped, or ask permission | 3 | 6 | **3** | Painkiller | The privacy buyer |
| **Vaccine schedules with real dates** | A paper card, or a country's PDF | 5 | 8 | **3** | Vitamin for most, **painkiller for expats and for anyone using private care** | Every parent, but sharpest abroad |
| "What to log, and why" guide | Guess | 3 | 5 | **2** | Vitamin | New parents and new caregivers |
| Night theme, growth charts, milestones, Moments, rituals, heatmap, keepsakes, bear avatars, deep links, install | Free apps do most of this | 5 | 6 | **0 to 2** | Vitamin | Everyone. Pleasant, not a reason to switch |
| Printable doctor report | Print nothing, talk it through | 4 | 5 | **1** | Painkiller, but blocked | Capped at one free try per household, behind a checkout that does not exist |
| Notes addressed to one person | WhatsApp, which reaches the lock screen | 7 | 6 | **-1** | Vitamin | Unanimously negative |
| Reading room and article cards | Google, which wins | 7 | 6 | **-1** | Vitamin | Unanimously negative |
| Photo album and storage | The camera roll and iCloud | 8 | 6 | **-2** | Vitamin | Unanimously negative |
| Voice logging | Type it, or do not log it | 5 | 3 | **-2** | Vitamin as shipped | Should be the best thing in the app, and is locked |
| Photo studio: cutout, enhance, formats, fonts | Any free editor | 7 | 5 | **-2** | Vitamin | Free tries then a dead end |
| "Both guardians must agree" | Nothing | 4 | 2 | **-2** | Vitamin | A promise the server does not keep |
| Dose alerts that only work while the app is open | A phone alarm | 6 | 3 | **-3** | Vitamin | Nobody is awake to see them |
| The Pro sheet, tastes and waiting list | Pay another app | 5 | 2 | **-3** | Vitamin | Being shown a price nobody can pay |
| Sign-in required before the first log | Free trackers that need no account | 7 | 3 | **-4** | Cost | The stranger deciding |
| Push reminders | Every competitor has them | 7 | 1 | **-6** | Painkiller, dark | Worst score on the panel |
| "Our Den" household features | A shared list app | 6 | 0 | **-6** | Vitamin, dark | Cannot be reached |

**Two things shipped this week that the exercise never scored.** The **medicine calendar course** is, in my judgement, the most valuable thing in the product per line of code, because it is the only mechanism that reaches a closed phone. But it is roughly a day old, no real parent has used it, and its behaviour on Android is INFERRED rather than tested. The **vaccine card photo import** is a good screen whose headline capability is inert on every Apple device.

### 3.3 In plain words

**How short the real list is.** Out of roughly forty scored capabilities, **nineteen clear Delta 4 for at least one persona, and not a single one clears Delta 4 for everybody.** Ten of the nineteen belong exclusively to the working partner. Six belong exclusively to the woman after a loss. The mother six days after birth, who is the person the whole brand is written for, named **exactly one**: the free doctor visit summary.

**The structural finding, and it is the single most important sentence in this document.** Sort the list and a pattern falls out with no exceptions: **every feature that clears Delta 4 requires a second person already logging, or a loss, or a medical appointment.** Cubby's Delta 4 is not a feature. It is a second person.

**Which means the campaign has a precondition.** The lead promise, "you will not be the only one who knows what happened today", is real, provable and beautiful, and on day one for a solo parent it is worth zero, because the recap card literally renders nothing until someone else logs something. We are marketing the second-person experience to an audience that arrives alone. That is not a reason to change the message. It is a reason to make the invite the campaign's call to action, and to know that the invite screen is currently the worst screen in the product (section 5).

**On privacy as the wedge, be honest with yourselves.** The internal panel scored the pregnancy visibility review 4, 0 and 0. The mother six days after birth scored it zero and said she wants her husband to see more, not less. The working partner scored it zero and read it as a list of things he had been excluded from. **Private-within-shared is a painkiller for the person carrying a pregnancy, sharpest after a loss. In the baby stage it is a tax on the second caregiver.** It is the reason to trust the shared parts. It is not the reason to arrive. Any campaign that leads on privacy is leading with a claim that two thirds of our own imagined audience scored at zero.

---

## 4. What takes away from the app

### 4.1 The things that scored negative, and why

**Photo storage. Cut the ambition, keep the thumbnail.** Photos are shrunk to about 1200 pixels and stored inside the database. Anything over the size limit is refused to the circle silently and stays on one device behind a small message. We are competing with iCloud, which is free, unlimited on a paid tier, searchable, and shoots at four times the resolution. All three personas scored this negative. There is also a cost problem: the app streams **every** photo in the household to every device on every cold start, with no limit set (`app/store-firebase.js:1473`). **Never position Cubby near Tinybeans, never say "backup", and cut "HD photos and cloud backup" from the Pro roadmap line, because the current design cannot deliver it.**

**The reading room and the article cards on the home screen.** Google is the incumbent for "is this normal", and Google wins. Serving an article to a woman who has not yet logged a nappy is us putting our own search-engine investment on her home screen at the moment she needs the product to do one thing. All three personas scored it negative. **Keep the articles as a way people find us. Do not sell them as a feature, and they should not be on a brand new user's first screen.**

**Notes addressed to one person.** The feature is correct and well built. It loses to WhatsApp, which reaches the lock screen, and Cubby reaches nothing. For a solo parent it is a gently pulsing button asking her to write a message to herself. Never call it messaging.

**Voice logging.** This should be the best thing in the app for a woman holding a baby at 3am. It is a browser feature absent from the iPhone app wrapper, and it is listed as the **first** item in the Pro sheet, behind a wall that opens onto nothing. One persona scored it minus three and said it should have been her favourite thing.

**The Pro sheet.** Every free-try wall in the app ends at a waiting list. Being shown a price nobody can pay is worse than being shown no price at all. One persona scored this minus five.

**In-app-only dose alerts.** Three beautifully honest exit options on an alert nobody is awake to see.

### 4.2 Clutter, in order of how much it hurts

- **The first screen after setup shows five separate "learn this, do this" surfaces at once**: a pulsing "leave a note" button, an "add a photo" hero, a five-row checklist, an install prompt, and an article card. It used to be seven; three were suppressed this week. It is still too many. The article card is a link out of the product on the screen where a parent has just arrived. **Suggest cutting it while the checklist is up.**
- **"Let's set up your den" is the first sentence of the product.** "Den" is our jargon, for a feature that is switched off. Use "family" or nothing.
- **The identity screen says "Last thing:" and it is not the last thing.** An invite screen follows it.
- **That same screen tells a brand new owner where to find the feedback form**, using a menu path with arrows in it. That is a note to ourselves, on the third screen, before she has logged anything.
- **Six unlabelled colour swatches** sit above the baby's name field with nothing explaining what they are.
- **The checklist can never be completed** by a parent who does not add a photo.
- **The signed-out `/app/` page sells Cubby a second time**, including a Pro price column shown to someone who has not signed in and cannot buy any of it.

### 4.3 The one thing that should be fixed before any campaign, because it makes a promise untrue

**The single free doctor report can be destroyed by a pop-up blocker.** The free try is spent before the report is created. If the browser blocks the window, the parent sees a message about pop-ups and their one free try is gone with no refund. The pregnancy and trying versions handle this correctly. The baby one, which we lead on, does not. "Try one free" is currently not true in a way a customer will notice and resent.

---

## 5. The step-by-step flow

### 5.1 A stranger on the website

The homepage first fold reads: "The calm baby tracker for the whole family" / "Every feed, nap and vaccine, **shared with everyone who helps.**" / a lede about logging in two taps / **Start free** / "No app store, no ads, we never sell your data" / and, newly shipped, "You sign in with Apple, Google or an email link. About ten seconds, no password to invent."

Beside it is a **drawn phone mock, not a screenshot.** That is defensible as marketing.

**What is not defensible.** The three images we declare to Google and to the phone's install sheet as "screenshots" of the app are **cream marketing posters**. I opened one. It is a headline reading "One calm place for your baby" over a designed card, with the website address at the bottom. It is not a picture of Cubby. A person tapping "add to home screen" is shown an advert at the exact moment the operating system promises them a preview of the app.

The sign-in disclosure line is now on five pages, but it is missing from every sticky navigation button and every bottom-of-page repeat button. Someone who reads the whole page and converts at the bottom still meets an undisclosed wall.

### 5.2 Signing in

Tapping "Start free" does not open the app. It opens a **second sales page** at `/app/`, with the Google button in the first fold, then eight feature rows, a three-step explainer, and a free-versus-Pro price table for a product that cannot be bought.

Then a full-screen sign-in wall. **There is no demo, no guest mode, no preview.** One hundred percent of the product is behind it. Everything the website promises about the care circle is unverifiable by a stranger.

### 5.3 First run, baby stage

**Screen 1, the stage chooser.** "Hi, I'm Cubby. Let's set up your den." Three cards: expecting, our baby's here, we're trying. There is no fourth card for an older child. There is also a "Log out" button, on setup, before she has an account worth leaving.

**Screen 2, add a baby.** This screen is good. Name required, birthday required, country detected automatically, sex optional and defaulted to "prefer not to say". The birthday opens a calendar. **Shipped this week: year buttons.** Back-dating a three-year-old used to cost 36 taps on a single arrow; it now costs roughly 3 to 9. This is the biggest friction fix of the week.

**One honest correction.** An internal plan claimed the year buttons also cut about five taps off a typical pregnancy signup. They do not. The year buttons jump twelve months at a time and a due date is never more than nine months away, so they overshoot. The year control helps the back-dated child and nothing else. Do not let anyone report it as a pregnancy win.

**Screen 3, who are you.** "Welcome to Cubby. Last thing: how should your family see you?" Your name, pre-filled from your Google or Apple account so most people type nothing. Relationship is a dropdown and is optional. Skipping it has a consequence nobody explains: entries will read "by Sarah" rather than "by Mama Bear".

**Screen 4, the setup climax.** "You're all set." It contains nine things: a line about inviting people, a card promising live sharing, a real generated line saying "their vaccine plan is already waiting in Health: 12 visits, on the United Kingdom schedule", an **Invite someone** button, a **See their vaccine plan** button (newly a real button this week, and it now lands on the right screen), add another baby, add to home screen, show me what to log, and Maybe later.

**Then the first log.** Tap the nappy tile, tap "wet". Two taps, always writes an entry. This was fixed this week; the checklist used to point at the feed screen, whose main button starts a timer that does not count as an entry, so the box stayed empty after the parent did exactly what she was told.

**Tap count: 9 to 11 taps plus typing the baby's name**, for a newborn. Elapsed roughly 90 to 120 seconds (INFERRED).

### 5.4 The worst screen in the product

The **Invite someone** button on the highest-emotion screen in the app opens the general "Family and sharing" screen. Its order, top to bottom, is: member list, pending invites, a paragraph about who can see whose email address, **your own profile form with your name, your relationship, save my profile, change my bear avatar and send feedback**, and only then the invite field.

**She has to scroll past her own account settings to do the thing the previous screen just asked her to do.** A focused one-field invite screen was designed and is not built. This is the single highest-leverage unshipped item in the company, because the ten highest-scoring features in the app all require a second person.

And then: **Cubby does not send the invite.** The button says "Create invite". Afterwards the parent gets a share button that opens WhatsApp, or a draft email. She sends it herself. The recipient must sign in with that exact address or they land in a brand new empty household.

### 5.5 First run, expecting

**Screen: "You're expecting."** Due date, or "how many weeks you are", or "your last period". Country picker. Start tracking. Deliberately written without gendered words, because at this point the app does not yet know whether the person holding the phone is the one carrying.

**Tap count: 7 taps if she is due this month, about 11 for a typical second-trimester signup.**

**What she gets immediately.** Her whole country's antenatal appointment list, dated, with a source. The home screen leads with the week and the fruit size and **no countdown at all**, then: **"Next: 24-week midwife appointment, in about 2 weeks, 6 questions ready."** That card is real, dated, sourced, and about her week rather than the baby's size. **This is the fastest honest payoff in the entire product: zero extra taps, day zero.**

**The friction, and it is the important one.** The visibility review, the sharpest thing Cubby does, **does nothing when she is the only person in the household**. It never runs during the flow it exists for, and when she later invites her partner nothing prompts either of them.

### 5.6 First run, trying to conceive

**Tap count: 4, everything optional and blank.** The lowest friction entrance in the app.

**The problem is the destination.** The home screen for a brand new person shows thirteen blocks, and **six of them are empty on day one**. The look-back card needs a completed cycle, roughly 28 days. The cycle range card needs two, roughly 56 days. The only thing with real content on day one is a generic preconception checklist available from any national health website.

**Say this plainly: the Trying stage has no day-one payoff.** Its whole position is a refusal, and both halves of the refusal need data she does not have yet. **Do not run acquisition into this stage promising anything the first screen delivers.**

There is also a live bug. A man who sets up the Trying stage for his household is the owner, so the app treats him as the person tracking, and asks him for the first day of his last period. The fix for invited partners shipped; the fix for founding owners did not.

### 5.7 An invited caregiver joining someone else's family

They receive a link and an email address, sent by the parent. They sign in with that address. They see three sentences and nothing else:

> "Priya asked you to join Amara's Cubby."
> "Anything you log shows up for them straight away, and anything they log shows up for you."
> "How they're feeling stays private to them, always. Their own health notes and their pregnancy stay theirs too, unless they choose to share them with you."

Then their name, pre-filled, and Save. **Three taps.** They land on a working app with no checklist, showing today's real activity and, if someone logged today, the "Today so far" recap.

**This is the best first run in the product, and it belongs to the person who did not install the app.** It is completely unmarketed. Do not touch it.

Two live dead ends, both verified: if they reload the page mid-setup, and the family has nothing visible to them yet, they can land permanently on a screen whose only button is "Log out", with no settings and no way to delete their account. And in a milder version they get the generic owner welcome copy instead of the invitee welcome, which turns the best onboarding in the product into the worst.

### 5.8 Day two, and what brings anyone back

**For a solo owner: honestly, nothing does.** There is no push, no email, no badge, no widget, no record of when she last opened it, and no re-engagement surface of any kind. This is a **deliberate written-down guardrail**, and one I would defend: no "we missed you", no streaks, no scarcity, ever, aimed at a woman six days after giving birth. But it means retention is entirely a function of whether the first week gave her something she cannot get from the notes app on her phone.

**For an invited caregiver: the app is the answer to a question he already has.** He opens it because he wants to know how the day went, and the recap is the first thing on the screen.

**Things that appear over the first week**, but only once someone opens the app: an overdue vaccine warning, a one-month card with a fourteen-day window so an exhausted parent does not miss it, illness and fever warnings, dose alerts, and the tips ticker once the checklist retires. This week the tips ticker was fixed to count **your own** entries rather than the household's, so a grandparent joining a busy circle is no longer judged to have already learned the app.

---

## 6. Where we are being optimistic

Everything in this section is live right now. **Do not repeat any of it.**

### 6.1 The four that would actually hurt us

**The newsletter promises an email that has no way of being sent.**
The button says "Get the guide". On success the message says "You're on the list. Watch your inbox in a couple of weeks." The signup writes the address to a database and returns success. **There is no sending code anywhere.** The comment in the code says so in its own words: capture only, no email is sent here. This widget is on **658 live pages**. It is the first promise Cubby makes to a stranger and everyone who has ever signed up is still waiting.
*Fix: build the send, or change two strings to "Join the list" and "You're on the list. We'll write when there's something worth reading."*

**"Privacy you can verify, not just trust" is the one claim a critic can disprove in ten seconds.**
The /why/ page says Cubby will "never show you ads or load third-party trackers. No pixels watching a new parent at their most vulnerable." The script side is clean; I checked, there is not a single third-party script on the marketing pages. **But 489 live pages load fonts from Google, and two of them are the privacy policy and the /why/ page itself.** Google Fonts is not a tracker, but it is a request that sends the reader's address to Google on every page view, it is not listed in our sub-processor list (which names only three companies), and a German court has ruled on exactly this. The app itself is clean; its fonts are served from our own servers. **So the product keeps the promise and the marketing site does not.** Because the copy explicitly dares the reader to check, this is the highest-risk mismatch in the audit.
*Fix: serve the marketing fonts ourselves. Two hours of work. Do not soften the vow.*

**The privacy policy does not say who Cubby is.**
It reads, live: "The service is operated by **[Legal entity, to be confirmed]**, [address/jurisdiction to be confirmed]." The terms say the same in two places. **A health product handling an infant's medical record and a woman's mental health notes, whose privacy policy has an unfilled bracket where the operator's name should be, cannot survive a journalist, a corporate buyer, or a careful parent.** This is a founder decision, not a build, and it blocks the entire privacy narrative.

**The features page states, in the present tense, a notification behaviour that does not exist.**
"The only notification Cubby ever pushes is a medicine dose, around the time it's due. Never a feed, never a streak, never guilt." The vow is beautiful and it will be true one day. Today Cubby pushes nothing.
*Fix: change "ever pushes" to "will ever push."*

### 6.2 The reminder cluster: six more places, one root cause

| Where | What it says | What is true |
|---|---|---|
| Homepage description, the text Google shows | "follows your baby's vaccine schedule **with reminders**" | A warning appears inside the app when you open it |
| Homepage feature card | "every due date and **a heads-up before each one, so a dose never slips**" | No heads-up is sent |
| Homepage free-tier list | "Your country's vaccine schedule **& reminders**" | Same |
| How it works page | "due dates **& gentle reminders**" | Same |
| Features page | "every due date marked, **so a dose never slips by**" | A reliability guarantee about a channel that only exists while the app is open |
| The phone's install sheet | "Your country's vaccine schedule **with gentle reminders**" | Same, and this one appears in the operating system's own install prompt |
| Inside the app, Settings | "Reminders: gentle nudges for medicine, **vaccines & rituals**" | Rituals produce no nudge of any kind |
| Inside the app, Health | "Regular medicines **with reminders**" | Only while the app is open |

**Note the pricing page already has the honest version**: "vaccine schedule and due dates **in the app**". Copy that line everywhere.

**The FAQ is not on this list, because it is honest.** It says push is "in final testing, off by default, medicine-only, with quiet hours, never for feeds. We switch it on only once we are sure a reminder always arrives." That is exactly the right shape. My one caution: it has said this for a while, and three named blockers are still open, including one where a failed send is recorded as a success. **Do not attach a date to "final testing" in any campaign.**

### 6.3 A contradiction the team must resolve before writing anything

**Is the medicine reminder free, or is it a Pro feature? The site says both.** The features page frames it as a free safety vow. The `/app/` landing page says push reminders are "on the Pro roadmap for later". The pricing page lists "push reminders" under "down the road for Pro". The FAQ says Pro adds "always-on push". An internal document goes further and advertises a Pro push including "time to log" alerts, which is exactly what the app's own code forbids.

My read, and it should be a founder decision: **a medicine dose alert is safety, our own policy says never paywall safety, so it should be free**, and the Pro mentions should be narrowed to insights and smart routines.

A smaller one: the `/app/` page sells "Rituals" as a future Pro feature. Rituals shipped free months ago. We are advertising a paywall around something we already gave away.

### 6.4 Overclaims of degree: true-ish, and they will produce disappointed customers

- **"Doctor visit reports (PDF)."** It is a web page you print or save as a PDF from the browser, and in the iPhone app it hands you a web file. No PDF is generated. Say "a doctor-ready summary you can print or save as a PDF."
- **"Every Pro treat comes with a few free tastes, so you can try before you decide."** The counters are shared across the household. A couple gets one doctor report, one Then and Now and three style exports **between them, forever.** And "before you decide" is not true, because there is nothing to decide.
- **"Both guardians must agree" before an export or erase.** No rule on the server enforces this. Describe it as a shared-decision flow, never as a protection.
- **"Invite your partner, grandparents and the nanny by email."** A reader hears "the app emails them". It does not. The FAQ answer is more careful; align the how-it-works page to the FAQ.
- **The keepsake studio sits in the free feature grid** with templates, fonts and palettes named, most of which are Pro.
- **"Where are my photos stored? Privately in Cubby's secure backend."** Omits that photos are shrunk and that oversized ones never sync at all. Anyone treating Cubby as a backup will lose originals. Add a sentence.
- **Growth charts "with a plain-language read."** The read is a percentile figure. It needs the baby's sex set and the bands stop at 24 or 36 months. There is no head circumference.
- **The three declared screenshots are posters.** There is no real screenshot library. Any campaign needing product shots needs them made first.

### 6.5 One number that is right. Protect it

The homepage structured data and the pricing page both say **"Vaccine schedules for 11 countries."** I counted: twelve entries, eleven of them countries and one a general WHO schedule. **11 is correct.** Older internal notes say 13. Do not let anyone round it up.

### 6.6 The prohibitions, as three sentences for the brief

1. **Never write "reminder", "notification", "nudge" or "alert" about anything reaching a closed phone.** The only exception is the medicine calendar, and only in the form "your phone reminds you, not us."
2. **Never write a price, a plan, "upgrade" or "trial" as something available today.**
3. **Never write "parents told us" or "parents asked for."** There is no user voice in this company yet beyond four homepage testimonials, and even those need their provenance confirmed before they go into paid media.

Four more, briefly: no "download on the App Store" (TestFlight only). No "scan your vaccine card". No user counts, ratings or "join N families" (we have no analytics and nothing supports a number). No attack on Flo's privacy record: the 2021 settlement is real and enormous, but Mozilla's 2026 review scored Flo 7 out of 10 and Flo now ships an award-winning open-source anonymity mode, so a 2021 attack in 2026 is stale and invites a comparison we lose while our own privacy policy has an unfilled bracket in it.

---

## 7. What users will genuinely love

The short, real list. Held to the same standard as everything above.

**1. Being seen at the worst moment.** Ending a pregnancy without cruelty, and the calm holding screen that replaces the upbeat setup chooser until she is ready to move on. Nothing to do, no prompts, and it is per person so it never announces itself to the household. **Evidence:** the largest score in the entire exercise, and the only feature where the disagreement was about how much it mattered rather than whether. Structurally, no growth-funded competitor will build a screen that converts nothing. **This is what people will tell their friends about, and it is the only thing here that earns unpaid word of mouth. It also cannot be advertised.**

**2. "Today so far": someone else's day, already on your phone.** **Evidence, and this is the strongest evidence in the document:** two of the four homepage testimonials describe exactly this behaviour, unprompted, in better words than our own headline. Fatima, mother of twins, UAE: "The nanny logs everything while I'm at work, and one glance gives me my children's whole day. It takes away the FOMO." That is a real person describing a real feature. **Caveat, and it is severe:** the card renders nothing until a second person logs. The precondition is the invite.

**3. "By Mama Bear", "by Nanny", and it survives them leaving.** Nobody will name this in a review and everybody would miss it if it went. **Evidence:** structurally impossible for any app that uses one shared household password, which is most of them. This is a claim about how the thing is built, not about a competitor's behaviour, so it cannot go stale.

**4. The vaccine plan that already exists at minute two.** Real dates on your country's schedule, from a national source, generated the moment you type a birthday, before you have done anything else. **Evidence:** it is the only payoff available two minutes after signup that costs the parent nothing. It is a nice-to-have for a British parent with an NHS appointment card. It is a genuine painkiller for **expats and for families using private care**, and we have never addressed those people in a single line of copy. That is a live, cheap, untaken market position.

**5. Refusing to guess.** No countdown on the pregnancy home. No day count in the two-week wait. A range for the fertile window, not a date, worded honestly, and hideable. **Evidence:** the only Delta 4 in the trying stage. It lands only after a wrong forecast has already hurt someone, which is a large and growing population. **Belongs in retention and referral copy, not acquisition**, because it is a very hard thing to sell to someone who has not been burned yet.

**6. The medicine course in your own phone's calendar.** **Evidence:** it is the only mechanism in the product that reaches a parent with the app closed, and it needed no key, no server, no permission prompt and no app store review. A parent whose phone shouts at 2am for the antibiotic will forgive this app a great deal. **Caveats:** fixed daily times only, invisible until you edit a saved medicine, strong on iPhone and weaker on Android, and no real parent has used it yet.

**7. The tone.** I went looking for saccharine and mostly did not find it. The sex field defaults to "prefer not to say". The weekly averages divide by the days you actually logged, not by seven. The reminders screen says out loud "we don't want to be the reason a dose is missed". The code is full of decisions made in the parent's favour against our own numbers. **That restraint is the real moat, and it is the only thing on this list a competitor cannot ship in a sprint, because it is not a feature. It is a hundred small refusals.**

---

## 8. Content the marketing team can build now

Only LIVE features. Every idea below names its honest limit, which must travel with it.

### 8.1 The one sentence to lead with

> **You will not be the only one who knows what happened today.**

The scoring forces this, not taste. The four highest-scoring things a stranger can be sold on before signing up are all the same promise stated four ways. The current headline, "Every feed, nap and vaccine, shared with everyone who helps", is already close and is already indexed by search engines. **Do not replace it. Put the sentence above underneath it as the lede, and put Fatima's testimonial in the first fold.** Both changes are additions, so there is no search risk and no removal to approve.

### 8.2 The pregnant woman

**Her pain:** "I'm carrying all of it. The scan date, the questions I meant to ask last time, the glucose numbers, who I've told and who I haven't. And every app I try wants to tell me how many days are left."

**The feature that answers it:** the next-appointment card, built from her country's real antenatal schedule the second she finishes setup, with her own questions attached to it.

**The honest limits, which the copy should carry:** Cubby holds the record, not the medicine. She can get the same schedule from her midwife on paper; what Cubby adds is that the question she wrote at 2am is on the same screen as the appointment. That is a small, real, honest benefit. Do not inflate it into "your pregnancy, managed". And **do not imply Cubby tracks her own medicines**, because the Health screen cannot be reached during pregnancy at all.

1. **"The questions you meant to ask, on the same screen as the appointment."** A 45-second screen recording, portrait, no voiceover, captions only. Write a question at night, see it waiting on the card. Show the source citation on screen. *This asset does not exist and must be captured.*
2. **"No days-to-go counter. On purpose."** Short post or five-slide carousel. The proof is that the code refuses it, and that quiet mode drops the week number and keeps the gentler card. **This is a product decision you can photograph, which is the rarest kind of proof.**
3. **"You choose who knows, one person at a time."** An explainer section on the pregnancy page, not a paid ad. **Ship the limit with it:** the review does not run when she is the only person in the household, so do not promise her a screen she will not be shown.

### 8.3 The mother in the first weeks

**Her pain:** "It's Friday, we're seeing the doctor, and he's going to ask how she's feeding, and I genuinely do not know. I know I have not slept. I don't know anything else."

**The feature that answers it:** the free doctor visit summary. The **only** Delta 4 this persona named in the entire product, and it finally got a permanent door this week.

**The honest limits:** it needs about a week of logging before it says anything useful, so it is not a day-one ad. **It is free, and the printable version is not, so say "free summary" and do not mention the PDF at all until checkout opens.** It is a summary of what she logged, not an assessment, so no clinical framing ever.

1. **"Walk into the appointment already knowing what to say."** Single image plus 80 words. Needs a real capture from a seeded demo family. *Does not exist.*
2. **"Six days in. What Cubby will not do to you."** Long-form, first person, honest. The proof is genuinely differentiated and verifiable: no streaks, no scarcity, no "we missed you", no re-engagement message for a solo parent, written down as a rule we hold ourselves to. **Do not turn this article into an email drip.** That would be the exact regression it describes.
3. **"Photograph the card instead of typing twelve dates."** Thirty-second capture. **The claim is: your card on screen, the whole schedule underneath, so you copy the dates without swapping apps, and nothing is saved until you have checked every line. The photo never leaves your phone.** Never "scan", never "reads it for you", never "AI".

### 8.4 The working partner

**This is the most important audience in the product and nobody is marketing to it.** Ten of the nineteen highest-scoring features belong to him alone, and he is the person who did not install the app.

**His pain:** "I get home at seven and I ask 'how was she today', and I can hear that it's the wrong question, because she's answered it in her head forty times already."

**The feature that answers it:** the "Today so far" card, at the top of his home screen, with the names of who logged it.

**The honest limits:** it shows **today only**, so never write "catch up on the days you missed". It needs someone else to have logged today. And **nothing in Cubby can reach him**, so the entire eleven and a half hours where his problem lives is silent.

All three ideas below are **referral** content, aimed at getting her to invite him, not at acquiring him cold. That is the correct funnel and the scoring says so.

1. **"Ask a better question when you get home."** Twenty-second vertical video, one screen, no narration. He unlocks his phone on a train and the card is already there. **This is the one capture that must exist first.**
2. **"Three taps and one typed word. That's his whole setup."** Side-by-side timing comparison. His first run really is three taps and he lands on a working app with no checklist. This is the best first run in the product and it is completely unadvertised.
3. **"It says who did it. Even after they've gone."** A short piece about shared logins. The claim is about how the product is built, and it is one no shared-password competitor can make.

### 8.5 The grandparent or the nanny

**Be honest with the team: this audience was never scored.** The internal exercise ran three characters and none of them was a grandparent or a nanny. Everything here is reasoning by analogy from the working partner. Treat these as hypotheses to test.

**Her pain:** "I look after her three days a week and every evening I stand in the hall reciting the day from memory while her mother is trying to get her coat off."

**The features:** the same recap, plus retroactive logging, because she was holding a baby at 11am and can only log it at 4pm.

**The honest limits, and one is a real gap.** **There is no view-only role.** Anyone you invite can write. If a family wants "Nana can look but not touch", Cubby does not do that. She also needs her own email address and her own sign-in, which for a grandparent is real friction, and the copy should own it rather than hide it.

1. **"The nanny logs it. You see it. Nobody has to remember the handover."** Paid social, single image, targeted at working mothers in the UAE, Singapore and India where paid childcare is common. **Use Fatima's testimonial word for word.** It is already on the site, it names the exact scenario, and it uses a phrase no copywriter would have dared write.
2. **"Log it at four o'clock for what happened at eleven."** Fifteen-second capture. *Does not exist.*
3. **"One circle. Everyone's name on everything."** A how-it-works section on the bear labels plus free-text custom roles for a driver, cook or ayah. A genuine cultural fit for the UAE and India, currently invisible in all marketing.

### 8.6 The woman trying to conceive

**Her pain:** "The app told me Tuesday. I built my week around Tuesday. It was not Tuesday, and I felt like an idiot, and then I felt like an idiot for feeling like an idiot."

**The feature that answers it:** the honest look-back. The range her own cycles actually ran, with no dated forecast.

**The honest limits.** **Be precise about the refusal:** a range, never a date; no dated next-period prediction. Not "we never predict". The FAQ already words this correctly; copy the FAQ. This stage has nothing to show on day one, so **do not run acquisition into it promising a screen that will be blank when she arrives.** And the doctor report is free to read; printing or sharing it spends the household's single Pro try.

1. **"A range, not a date. Because a date has been wrong before."** Long-form, the flagship piece for this stage. **Quote the app's own on-screen wording verbatim**, because it is better than anything a campaign will write.
2. **"Twelve months. One kind sentence."** A quiet static post with no call to action. One card, once, in a year. The restraint is the ad.
3. **"The two-week wait, without the countdown."** Carousel. Pair it with the fact that she can hide the fertile card and it stays hidden **only for her**, not for her partner.

### 8.7 The most under-sold thing in the product

**The medicine calendar course.** I searched every marketing page for the word "calendar". **Zero hits.**

The product's worst-scoring gap is the absence of a reminder that reaches a closed phone. This is the only thing in the entire product that does it, and it needs no key, no server, no permission prompt and no app store review. It converts a liability into an asset: right now our honest position is "our reminders don't work yet", which is a hole in every feature page. The calendar turns that into a claim.

**Copy written to be exactly true:**

> **Your phone reminds you, not us.**
> Set dose times go straight into your own calendar with an alert at each dose. It works with Cubby closed. It works with no signal. And when the course ends, the reminders end with it, because we always write an end date.

Every clause is verified. **The limits must ship in the same breath:** fixed daily times only, and it is strong on iPhone and weaker on Android. And it is one day old. **Get one real tester to confirm it on a physical iPhone before promoting it.** Until then, put it in the medicine story on the features page rather than building a campaign around it.

---

## 9. What we would need to build or prove before making bigger claims

Ranked by how much campaign money is wasted if it is left alone.

**1. Six real product screenshots.** There is not a single picture of the app anywhere on the site or in the repository. Every "product shot" is a drawing, and the three images declared to Google and to the phone install sheet are marketing posters. Without these, every idea in section 8 is an advert for a wireframe. The one that must exist first is a timeline showing "by Mama Bear" and "by Nanny" in the same day, because that single image is the lead sentence made visible. A shot list already exists and is unticked. Half a day of work from a seeded demo family.

**2. A focused invite screen.** One field, one button. Every feature above Delta 6 in the product is downstream of a second person logging, and today the invite hides beneath the user's own bear avatar picker. One day of work. **Do not spend acquisition budget on the lead sentence until this ships.**

**3. Fix the live reminder claims.** Eight surfaces, six of them public. These are already false in market, and every day they run is a bait-and-switch on the audience most sensitive to being misled. Copy the pricing page's honest wording across.

**4. Name the operator in the privacy policy and terms.** A privacy-led brand operating under "[Legal entity, to be confirmed]" cannot survive one sceptical reader, and it blocks any press or partnership push. This is a founder decision, not a build.

**5. Fix or retire the newsletter promise.** Either build the send or change two strings. It is on 658 live pages and it is the first promise Cubby makes to a stranger.

**6. Serve the marketing fonts ourselves.** Two hours, and it removes the sharpest available attack on the claim that carries the whole brand.

**7. Fix the doctor-report free try.** It is spent before the report is generated, so a pop-up blocker destroys a household's only free attempt with no refund. It makes "try one free" untrue in a way a customer will notice.

**8. Separate the free-try counters per person, or say out loud that they are per household.** As shipped, two parents share one doctor report and one Then and Now, forever.

**9. Close the invited-caregiver dead end.** A caregiver who reloads at the wrong moment can be stranded on a screen whose only button is "Log out", with no settings and no way to delete their account. That is also an app store review risk.

**10. Decide out loud whether the medicine reminder is free or a Pro feature**, and make all four surfaces agree.

**11. Decide out loud whether Cubby starts at birth**, or build a door and a payoff for the child stage. Right now the ecosystem story says four stages and the app has three.

**12. Decide whether Trying is a stage we market at all.** If yes, it needs something on day one.

**13. Confirm the four testimonials are genuine and consented**, and not friends and family, before any of them goes into paid media. They are the only real customer voice we own, and I recommend building the whole baby-stage campaign on one of them. If one turned out to be fabricated it would end the brand, because the brand is trustworthiness.

**14. Before "no third-party trackers" becomes a headline rather than a vow**, have someone open developer tools against the signed-in app and against the TestFlight build, not just the marketing pages. I verified the marketing pages and the app source. I did not audit the built iPhone app to the same standard.

**15. Before any push claim is ever made**, three known problems must be fixed, one of which records a failed delivery as a success. If the switch were flipped today, the system could drop every real medicine reminder while the health monitor stayed green. That has already happened once in this product's history, on the other side of the same pipeline.

---

### Where I am uncertain, stated rather than smoothed over

- **Email delivery** for the sign-in link and the invite depends on a live third-party key I cannot see from the code. INFERRED working, because sign-in works.
- **Browser support** claims (voice logging absent in the iPhone app wrapper, the vaccine card reader absent on all Apple devices, calendar alarms unreliable on Android) are INFERRED from well-established platform behaviour, not tested on devices in this session. All three are load-bearing for copy, and all three should be confirmed on a real iPhone and a real Android phone before any campaign runs.
- **The thirty-day account deletion grace period** ends in a scheduled job I did not verify running.
- **The medicine calendar** has never been used by a real parent on a real device.
- **The three personas behind every Delta number** are constructions. They are the best thinking we have and they are not evidence.
- **Competitive claims** about Pebbi, Huckleberry, Ovia and Flo come from public 2026 sources gathered by another lane and were not re-verified by me. Treat the specific prices and feature lists as needing a check before they go into a battlecard. The strategic point behind them does not depend on the exact numbers: our top-scoring cluster is being given away free by 2026 entrants, and the privacy attack on Flo we planned is out of date.