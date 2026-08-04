# App Store submission package (paste-ready)

**Date:** 2026-08-04. **App:** Cubby, `com.littlecubby.app`, ASC app id `6791454709`, TestFlight build 9 (VALID).
**Sources:** `docs/plans/2026-07-15-native-wrapper-app-store.md` §9, live marketing copy (`index.html`, `features/index.html`, `faq/index.html`), `LAUNCH-PRIVACY-WEDGE.md` honest-claims guardrail, `ANALYTICS.md` (no third-party analytics), truthful-copy + customer-voice rules.

**Ground rules baked into every block below:**
- No over-claiming. There is NO in-app purchase yet (Pro is register-interest), so nothing here mentions buying Pro. Push has not delivered yet (APNs key pending), so reminders are worded as a capability Cubby *supports*, never as "you will get a notification".
- No end-to-end / zero-knowledge claims. It is strict access control plus no ads, no trackers, never sold.
- Customer-facing blocks: warm, second person, sentence case, no em-dashes.
- Apple 4.2 defense: the copy sells the app experience (offline, native sign-in, shared live circle), never "our website in an app".

---

## 1. Name and subtitle

| Field | Value | Chars (max 30) |
|---|---|---|
| Name | `Cubby - Baby & Pregnancy` | 24 |
| Subtitle | `The calm, shared tracker` | 24 |

Notes: hyphen, not an em-dash (voice rule). The subtitle carries the wedge (calm + shared) without repeating name words, which would waste ASO weight.

---

## 2. Description (2,505 chars, limit 4,000)

```
Cubby is the calm way to run a baby's day together. Log a feed, a nap or a nappy in two taps and it appears instantly on every phone in your family. Your partner, the grandparents and the nanny all see the same day, live, with who did what on every entry. The details stop living in one tired head.

What you can do

- One-thumb logging: feeds, sleep, nappies, pumping and solids, with live timers on every phone, even at 3am.
- Your care circle: invite the people who help. Every entry shows who did it, and a while-you-were-away recap catches you up after work.
- Vaccine schedule: your country's official schedule (NHS, CDC, STIKO, IAP and more), every due date marked, each source cited and linked.
- Growth charts: weight and height on WHO and CDC curves, with the trend over time in plain language.
- Health hub: medicine courses with countdowns shared across caregivers, illness notes, allergies, and a one-tap summary to show the doctor. Cubby supports medicine reminders with quiet hours, and it never nags you about feeds.
- Moments: photos in one shared family album, milestones from a big library, and keepsake cards made from what you already logged.
- Pregnancy: week by week, your country's antenatal schedule, kick counter, contraction timer and a private scan album. The day your baby arrives, the same Cubby becomes your baby tracker. One story, no restarts.
- Trying: an honest cycle history built from your own logged periods, a private diary and a gentle preparation checklist. Cubby refuses to predict your fertile days, because forecasts pick the wrong day most of the time. It tells you the truth about the past instead.

Privacy is the point

- No ads, no third-party trackers, and your family's data is never sold.
- A mother owns her health. She chooses, item by item, who in her circle sees what. Mood notes can never be shared with anyone, because that lock lives in the security rules, not in a setting.
- Encrypted in transit and at rest, and locked to the people you invite by server-side rules.
- Export or delete your data anytime.

Built for real life

- Works offline. Log through the night and it syncs when you're back.
- Sign in with Apple or Google in seconds. No password to remember.
- Twins, siblings, and a pregnancy and a baby in the same account.
- No streaks, no guilt, no clutter. Turn on only what matters to you.

The essentials are free. Cubby is made for the 3am you: warm, quick and quiet, so your hands stay free for the parts you'll want to remember.
```

Optional promotional text (143 chars, limit 170, editable without review):

```
The calm, private tracker the whole family shares. Feeds, sleep, vaccines and memories, live on every phone, with no ads and nothing sold.
```

---

## 3. Keywords (100 chars exactly, limit 100)

```
newborn,feeding,sleep,diaper,vaccine,growth,milestones,breastfeeding,nanny,family,shared,private,log
```

No spaces, no duplicates of name or subtitle words (Apple indexes those already). `diaper` over `nappy` for the en-US locale; add `nappy` in the en-GB locale keywords instead if we localise later.

---

## 4. App Privacy questionnaire (Apple nutrition label)

Honest answers from real practice: health data lives in Firebase (Google Cloud Firestore + Storage) as a processor, sign-in via Firebase Auth, and there is deliberately no analytics SDK, no ads SDK, and no tracking of any kind (`ANALYTICS.md`; the Meta SDK is stripped from the binary by `tools/cap_strip_facebook.js`).

**Do you or your third-party partners collect data from this app?** Yes (accounts and logs are collected; "no data collected" would be false).

**Data used to track you: NONE.** No data is used to track users across apps or websites. No App Tracking Transparency prompt is needed because nothing tracks.

**Data linked to you** (everything below is tied to the signed-in account, that is the product):

| Data type | Collected? | Purpose | Justification |
|---|---|---|---|
| Contact info: email address | Yes | App functionality | Sign-in (Apple, Google or email link), circle invites, account notices. Never marketing lists, never sold. |
| Contact info: name | Yes | App functionality | Shown to the user's own circle as a warm label (Mama Bear). Required at first run. |
| Health & fitness: health data | Yes | App functionality | The product itself: feeds, sleep, growth, vaccines, medicines, pregnancy and cycle logs. Visible only to the circle per server-side rules; mood notes shareable with no one. |
| User content: photos or videos | Yes | App functionality | The family album and keepsakes, visible only to the invited circle. On-device enhance uploads nothing extra. |
| User content: other user content | Yes | App functionality | Notes, diary entries, milestones, checklists. Same circle-only rules. |
| Identifiers: user ID | Yes | App functionality | Firebase Auth UID, needed to enforce the security rules that keep each family's data theirs. |

**Data NOT collected (answer No):** precise or coarse location (the user picks a country by hand for schedules; the device's location is never read), contacts, browsing history, search history, purchase history (no IAP exists), financial info, usage data (no analytics SDK, first-party stance), diagnostics (no crash SDK), sensitive info categories beyond the health data declared above, surroundings, body data beyond the declared health logs.

**Third parties:** Google Firebase (auth, Firestore, storage, FCM) and Cloudflare (serving) act as processors under our instructions; the email delivery provider processes addresses only to send sign-in links and invites. None of them may use the data for their own purposes. No advertising or analytics partners exist.

**Privacy policy URL:** `https://little-cubby.com/privacy/`

Do NOT tick anything speculative "to be safe". Over-declaring (for example claiming we collect location or usage data) is as untruthful as under-declaring, and it wrongly worsens the label our privacy wedge depends on.

---

## 5. Age rating and category

**Age rating questionnaire, answer None / No to all:** cartoon or fantasy violence, realistic violence, prolonged graphic violence, profanity or crude humor, mature or suggestive themes, horror or fear themes, sexual content or nudity, graphic sexual content, alcohol, tobacco, or drug use or references, simulated gambling, real gambling, contests, unrestricted web access, Kids Category (this is an app for parents, not children).

Result: **4+**.

Honesty note on "Medical/treatment information": Cubby shows official immunisation and antenatal schedules with sources cited and lets parents note medicines their doctor prescribed. It gives no dosage advice, no diagnosis and no treatment recommendations, and it says plainly that it does not replace a doctor, so "None" is the accurate answer (peer baby trackers rated 4+ answer the same). If App Review disagrees, accept "Infrequent/Mild" and the 12+ rating rather than argue; never misdescribe the content to hold a rating.

**Category:** Primary Health & Fitness, Secondary Lifestyle.
**Made for Kids:** No. **Price:** Free, no in-app purchases (Pro is register-interest only; add IAP in a later submission when it is real).

---

## 6. Beta App Review notes (TestFlight external testing)

Paste into TestFlight > Test Information > Beta App Review notes, and fill the sign-in fields with the demo account below.

### Demo account, founder setup first (never strip auth, see the wrapper plan §3c)

Sign-in is required by design and the rules return nothing without it, so review gets a dedicated, seeded demo account. Exact steps:

1. Create a fresh Google account, suggested `cubby.review.demo@gmail.com`, with a strong password you are happy to hand Apple. Do not reuse any personal account.
2. On any device, sign in to Cubby with it (Continue with Google) and run the first-run wizard: stage Baby, child "Bo Bear", birthday about 10 weeks ago, country United States.
3. Seed a believable week, all fictional (fictional-baby rule, no real child's data or photos): 8 to 10 feeds, a few naps including one left running, nappies, one pumping session, weight and height entries so the growth chart draws, the 2-month vaccines marked given with the 4-month ones upcoming, one medicine course with doses remaining, one milestone, and 3 or 4 photos from our own bear art or stock, never a real baby.
4. Create a second throwaway account, invite it as a caregiver, accept, and log two entries from it so "who did what" shows two people.
5. Sign out and back in on a clean device to confirm the seeded family loads, then put the email and password in the ASC demo-account fields.
6. Do not delete or reset this account while any review is pending.

### Notes text for the reviewer (paste as-is)

```
Thank you for reviewing Cubby.

Sign-in is required because Cubby is a private, shared family health log: feeds, sleep, growth, vaccines and pregnancy records synced live between invited caregivers. Server-side security rules key everything to the signed-in account, so there is no meaningful signed-out state; without an account there is no data to show and no circle to share it with.

Please use the demo account provided (Continue with Google). It contains a seeded fictional family: baby "Bo Bear" with a week of feeds, naps and nappies, a vaccine schedule in progress, a medicine course, growth charts and a shared photo album with a second caregiver's entries.

Suggested walk-through: sign in, see today's shared log on Home (one nap is still running with a live timer), log a feed in two taps, open Care for the US immunisation schedule with sources cited, open the growth chart, open Moments for photos and milestones, and check Settings > Family & sharing to see the two-person circle and the item-by-item privacy controls.

Notes: the app is free with no in-app purchases. It works offline and syncs on reconnect. Notifications are off by default and the app never requires them. No ads, no third-party analytics and no tracking SDKs are present, which matches the App Privacy answers.
```

---

## 7. External tester welcome text (the WhatsApp crew)

Send with the TestFlight public or email invite link. Also fits TestFlight's "What to test" field (trim to the first two paragraphs there).

```
Hi! Cubby is ready to try on iPhone, and you're one of the first. It takes about two minutes to start.

First, please try these four things:
1. Install: tap the TestFlight link, install TestFlight if asked, then install Cubby.
2. Sign in with Apple or Google (if you already use Cubby in the browser, use the same account and everything will just be there).
3. Log something real: a feed, a nap or a nappy. Two taps is the promise, tell us if it's more.
4. Invite one person from Settings > Family & sharing, and check their entry shows up on your phone.

Then just live with it for a few days and be brutally honest. If anything is confusing, slow, ugly or broken, we want to know.

Found a problem? Either use Send feedback inside the app (Settings > Family & sharing), or send a screenshot here on WhatsApp with one line on what you expected. In TestFlight you can also screenshot and tap Share Beta Feedback, which sends it straight to us with the details attached.

One honest note: it's a beta. Reminders and notifications aren't switched on yet, so don't rely on Cubby for medicine timing this week. Your data is real though, private to your family, no ads, never sold.

Thank you for helping us build this.
```

---

## 8. Screenshot shot-list (iPhone 6.7", 1290 x 2796, capture from the real app on the demo family)

Order sells the story: shared calm first, privacy in the middle, lifecycle last. Reuse the demo account's seeded state from §6; add state where noted. Captions are the marketing headline for each shot, keep them short and sentence case if we overlay text.

| # | Screen to capture | Seeded state it needs | Feature it sells / caption |
|---|---|---|---|
| 1 | Home, "Today, together" feed | Nap in progress with live timer, a bottle feed and a nappy logged by "Nanny", next vaccine card visible | The shared live day. "Every feed, nap and vaccine, on every phone." |
| 2 | Quick-log sheet mid-entry (feed) | Open the log sheet with a bottle amount selected, one tap from done | One-thumb logging. "Two taps, even at 3am." |
| 3 | Care: vaccine schedule | US schedule with 2-month doses marked done, 4-month due with a date, source citation visible | Official schedules. "Your country's schedule, cited and linked." |
| 4 | Family & sharing: the circle plus item-by-item privacy controls | Mama Bear (owner), Papa Bear, Nanny; the mother's health-sharing list showing weight shared, glucose "just you", mood "only ever you" | The privacy wedge. "You choose who sees what. Mood notes are never shareable." |
| 5 | Pregnancy week view | Switch the demo family's second profile to an active pregnancy around week 24: week card, antenatal schedule, kick counter entry | The lifecycle. "From two lines to first steps, one app, no restarts." |
| 6 | Moments: album and milestones | The 3 or 4 seeded photos, the "first smile" milestone logged, a monthly recap card generated | Memories. "Every photo and every first, kept beautifully." |

Rules while shooting: fictional data only (no real children), status bar clean (9:41, full battery), light mode, English US locale, no debug UI, and capture on a real device or the correct simulator so the safe areas are true. The same six shots re-shot on the 6.5" size satisfies the second required slot; iPad is optional and can wait.

---

## Submission checklist (from plan §9, updated)

- [ ] Name, subtitle, description, keywords pasted from this file, char counts verified in ASC.
- [ ] Promotional text pasted (optional, editable later without review).
- [ ] Privacy policy URL `https://little-cubby.com/privacy/`, support URL `https://little-cubby.com/faq/`.
- [ ] App Privacy answered exactly as §4, nothing speculative.
- [ ] Age rating answered as §5, 4+, Health & Fitness + Lifestyle.
- [ ] Demo account seeded and verified from a clean device (§6), credentials in the review fields.
- [ ] Beta App Review notes pasted, external group added, WhatsApp welcome sent (§7).
- [ ] Six 6.7" screenshots captured per §8 and uploaded (6.5" set derived from the same shots).
- [ ] Web deployed from `main` BEFORE submitting, since build 9 remote-loads the live app.
- [ ] No IAP configured, no Pro purchase language anywhere in the listing.
