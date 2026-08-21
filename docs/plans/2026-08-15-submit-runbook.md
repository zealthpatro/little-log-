# Submitting Cubby: what is done, and the three things only you can do

**State as of this file:** version `2026.33.1` is in `PREPARE_FOR_SUBMISSION` with the build attached
and every field I can write already written. Check it any time:

```bash
node tools/asc.js state
```

Green already: description, keywords, promotional text, name, subtitle, support URL, marketing URL,
privacy policy URL, categories (Health & Fitness / Lifestyle), age rating (**4+**), six screenshots
at 1290x2796 all processed, build `2026.33.1` attached, export compliance answered.

---

## 1. Phone number (10 seconds)

Apple requires a reachable number for App Review and rejects anything not in `+<country code>` form.
I did not invent one. Just tell me the number, or run the last command yourself with it.

## 2. Demo account (about 3 minutes of your time)

App Review has to be able to sign in. Two honest options.

**Option A, a seeded demo family. Better review, slightly more work.**

1. Create a fresh Google account, for example `cubby.review.demo@gmail.com`. Use a password you are
   willing to hand Apple. Do not reuse anything personal.
2. Sign into Cubby once with it and finish the first-run wizard: stage Baby, name **Bo**, birthday
   about ten weeks ago, country United States.
3. Tell me the address and password, and I run:

```bash
node tools/seed_review_demo.js cubby.review.demo@gmail.com --write
```

That writes a fictional week: eight feeds and six nappies a day across seven days, three naps a day,
a nap running right now so the live timer shows, two growth measurements so the curve draws, a
Vitamin D course, a first-smile milestone, and a second caregiver called Rosa so "who did what"
shows two names. It refuses to run against a household holding events it did not write, so it
cannot be pointed at a real family by mistake.

**Option B, no demo account.** Cubby offers Sign in with Apple, and any Apple ID creates a working
account, so "does review need credentials from us" is honestly no. The reviewer then sees a fresh
first run rather than a full family, which is a weaker review of a product whose whole point is a
week of shared history. Use this only if you want it submitted before you can make the account.

## 3. App Privacy answers (about 10 minutes, you must be signed in)

**Apple exposes no API for these at all.** I checked four endpoint shapes; they do not exist. It has
to be the web UI, and your Chrome has no App Store Connect session, so it has to be you.

App Store Connect > Cubby > App Privacy > Edit. Answers are already decided in
`docs/plans/2026-08-04-app-store-listing.md` section 4. In short:

- "Do you collect data from this app?" **Yes.** ("No" would be false: accounts and logs are collected.)
- **Data used to track you: nothing.** No ATT prompt is needed, because nothing tracks.
- **Linked to the user, all "App Functionality" only:** email address, name, health data, photos or
  videos, other user content, user ID.
- **Answer No to everything else**, in particular location, contacts, browsing history, search
  history, purchase history, financial info, usage data and diagnostics. There is no analytics SDK
  and no crash SDK, so declaring them would be untrue.

Do not tick anything speculative "to be safe". Over-declaring is as untruthful as under-declaring,
and it damages the exact label the privacy wedge depends on.

---

## Then submit

With a demo account:

```bash
node tools/asc_submit.js --phone "+971 50 123 4567" --demo "cubby.review.demo@gmail.com:THEPASSWORD" --submit
```

Without one:

```bash
node tools/asc_submit.js --phone "+971 50 123 4567" --no-demo --submit
```

It preflights everything readable first and writes nothing if something is missing. It then creates
the review detail, opens a submission, adds the version and submits it. If the App Privacy answers
are unfinished, Apple rejects the call and you will see Apple's own words rather than a guess.

Review is typically 24 to 48 hours, so **submitted today does not mean live today**. That part is
Apple's.

## One thing worth deciding on purpose

The product board's kill criterion was: do not spend the App Store launch until a cohort holds to
day fourteen, because a launch is one-time and a public listing on a zero-retention curve is an
unknown converted into a public negative. You have decided to go, and everything is ready to go.

Worth knowing only that the cheap half keeps: the metadata, the screenshots and the build all sit
here for as long as you want. Submitting is the irreversible half.
