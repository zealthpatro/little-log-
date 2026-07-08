# Cubby — Live First-Run Walk (Verified on the Deployed App)

**July 3, 2026 · little-cubby.com/app · fresh account (saurav@zealth.club, email-link sign-in) · Cubby v0.9.0 beta.**
This is the live-walk companion to CUBBY-CRITIQUE-VERIFIED-VERDICTS.md (code) and CUBBY-CUSTOMER-LENS-EXPERIENCE-MAP.md (analysis). Everything below was seen on screen, not read from source. Walk: sign-in → chooser → add baby (Aarav, b. 2 Apr 2026, India) → invite sheet → home → first log → Health/Vaccines → Album/Memories → keepsake studio → Stats/Growth → Settings → Pro sheet.

---

## What's confirmed working, live

1. **First-run is fast and warm.** Chooser → add-baby → "You're all set 🐻" in ~90 seconds. The blurred real-app preview behind the chooser, minimal fields ("Just a name to get started"), country prefilled from device (UK/NHS on this machine), optional-everything. On-charter throughout.
2. **The solo aha loop works.** First bottle logged: toast "Bottle logged · 120ml", greeting flips to "1 feed logged today 🍼", LAST FEED reads "just now", THE DAY updates, checklist ticks itself. Tap-to-reflected-state is instant. The app answers back.
3. **India/IAP vaccine schedule: fully correct.** "Aarav is on track 🌿 · 0 of 34 recorded", BCG/HepB/OPV due on his birth date, DTwP at 6 weeks due 14 May 2026, source labelled "India (IAP/ACVIP) as a starting template" with Change country. Catch-up flow copy: **"No guilt, just a tidy record."** Past-due items say TO CONFIRM — no red wall. §5 verify item closed: country respected, live.
4. **Auto-magic memories fire on a minutes-old account.** "Ready for you" rail: "3 months recap · ready to share" + Birth poster. The memory card pre-fills real stats; the empty-data caption is *"Every quiet day counts too."* Watermark live: "🐻 made with Cubby · little-cubby.com". Taster quotas visible in-line ("Then vs Now · 1 free").
5. **Invite-at-the-aha exists.** Post-setup sheet's primary CTA is "Invite someone" with "They see everything, live."
6. **Pro sheet is moments-led** (voice logging "for the arms-full, 3am moments", doctor PDF, keepsake studio) with "every treat comes with a free taste or two." No "insights" over-claim in-app.
7. **Referral present in Settings:** "Share Cubby with a friend — Know another tired parent? Send them your link."
8. Confirmed absent, live (matching code): head circumference (Growth = "Add weight & height" only) and any insight/prediction layer (Stats = descriptive bars).

## The findings that should change the build

### F1 — The "Mama Bear" assumption (new, live-only find)
The app **assigned "Mama Bear" without ever asking.** Greeting: "Good morning, Mama Bear 🐻"; the first log is permanently attributed "logged by Mama Bear (you)". The identity-collection step (`collectIdentity`) never fired on this email-link path. Every father, grandparent or nanny who signs up first is mislabelled at hello — and their log attributions bake it in. The charter's first law is "never ask her to be someone she isn't"; this *tells* them they're someone they aren't. **Fix: one gentle chip-question at the all-set moment ("And you are…? Mama · Papa · Nana · …"), or at minimum default to a neutral bear until asked.**

### F2 — The invite CTA lands on bureaucracy (the aha is built, then dropped)
"Invite someone" (peak emotional beat) opens the **Family & sharing settings sheet**: her own profile form (name, relationship, avatar, feedback button) sits *above* the invite form. The moment says "bring in Papa"; the screen says "confirm your account details."
And the flow itself, live: placeholder `their-google-email@gmail.com` → Create invite → **"Cubby doesn't send emails. Send this link yourself (text / WhatsApp)"** → the link is the **generic homepage URL** (the email does the matching) → invitee must sign in with exactly that address. Four failure points at the single highest-value growth action. **Fix: a dedicated invite moment-sheet (not settings) issuing a tokenized link with a one-tap WhatsApp share — no email guessing.**

### F3 — The minute-two aha is silent (confirmed live)
The IAP plan — 34 doses, correct dates, beautiful — exists the moment birthday+country are set, and nothing announces it. Worse: the Health tab **defaults to Medicine (empty)**, so day-one exploration hits a blank before the treasure. **Fixes: (a) surface the plan as the setup climax ("Aarav's vaccine plan is ready — all 34 doses, IAP, with dates. We'll remind you."); (b) default Health to Vaccines until a medicine exists.**

### F4 — Small polish, live
- Two coach marks stack on the Log tab (tab explainer + strips explainer) — mild noise on first visit.
- Empty LAST FEED/SLEEP/DIAPER tiles show "·" — could invite ("tap Feed below") instead of sitting blank.
- Waitlist flag lives in localStorage: this browser showed "✅ You're registered for Pro" on a brand-new account (carryover from prior use). Any shared/tester device masks the Register CTA; consider keying the banner to the signed-in uid.

## Still unverified (needs a second human)
Invite acceptance end-to-end (does Nana survive "sign in with THIS email"?), reminders/notification behavior over days, voice logging and doctor-PDF taste flows (Pro), and multi-caregiver live sync/recap. These need a second account joining the household — the founder's original Gmail can accept an invite to test the full loop.

## Priority order (unchanged by the walk, sharpened by it)
1. **F2** — tokenized WhatsApp-native invite at the aha (referral engine's main bearing).
2. **F3** — vaccine-plan reveal at setup + Health defaults to Vaccines (the minute-two aha).
3. **F1** — ask the relationship; stop defaulting to Mama Bear.
4. Head circumference; `detectCountry` `'us'`→`'who'` last-resort; cut "insights" from FAQ schema; F4 polish.
