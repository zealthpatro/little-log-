# Cubby Ops: the admin dashboard, build spec

**Date:** 13 November 2026. Revised the same day after a builder's check against `866851ac`.
**Status:** Design approved by the founder on 13 November 2026: "approve the design, only me for now".
This file is the build spec. Nothing in it is built yet, and it changes nothing on its own. The
questions just below wait for the founder; everything else is settled.
**Host:** `admin.little-cubby.com` (the zone is on Cloudflare; the subdomain is not in DNS yet).
**Who may sign in:** exactly one person, the founder ("only me for now"). His address lives only in
the Cloudflare Access policy and in one Worker secret, and nothing this build adds may contain it.
The tree is not clean today: one tool (`tools/asc_submit.js`, its defaults) and four documents already
carry personal addresses, and git history keeps them even after they are removed. Phase 1 removes
them from the tree and gates it (§13 S34). Rewriting the public history is not part of this build.

---

## Questions for the founder

Most important first. Each has the answer I recommend. Nothing that depends on one is built until
you answer it; where the spec needs a default meanwhile, it takes the safer side and says so.

- **F1. Who must ask before a household is erased?** §12's "Delete household" would delete every
  member's account on one person's request. In the app, each person deletes only their own account,
  and deleting the shared record asks both guardians (`index.html` 8906-8920). *Recommended:* every
  guardian must ask before the shared record goes, and nobody's account is deleted unless that
  person asked. Until you answer, phase 5 builds only the one-person erase.
- **F2. Are round 5's rules published?** This spec branches from `866851ac`, which carries the round-5
  security fixes and their Firestore rules. The builder's check found `origin/main` at `1a6df125`
  (26 Oct), so the first admin push would have published round 5. Checked again while revising: the
  local repo's reflog shows `866851ac` pushed to `origin/main` on 13 Nov at 10:34 (+04:00), so round
  5's code is already public. Its rules must go live in the same sitting, because the repo is public
  and the fixes are now readable. Were they published? *Recommended:* if not, publish them now, before
  anything else in this spec; phase 1 then starts from the current main.
- **F3. The loss hold.** To keep "never during a hard time" true, the system reads one bit (is any
  holding screen active in this household) when a note is suggested and again when it is sent, and
  never stores or shows it. The tracking plan's rule 4 says any job that reads `lossHolding` "would
  break a promise the product made to her". Is the one-bit read acceptable? Should the hold last some
  days after she leaves the holding screen, which means storing a date? *Recommended:* yes to the
  read; yes to 30 days after, with the date kept in her own entry of the family's own record (the app
  writes a cleared date there), never in any team database.
- **F4. How much of a pregnancy does the dashboard show?** It now shows a stage only when her journey
  is shared with someone in her circle (§5.1). Within that: show weeks ("Pregnant · 24 weeks") and
  reword the card's "anything about your pregnancy" line, or "Pregnant" only? Should "Trying" be shown
  at all? *Recommended:* "Pregnant" without weeks, keeping the approved card line; "Trying" only as a
  number in the overview's stage bars, never beside a named household. Until you answer, no weeks
  are read and "Trying" is never shown beside a name.
- **F5. Visit times beside health actions.** The canvas shows "Yesterday 9:40pm · opened doses" and the
  Explorer shows times to the second. When people log as it happens, the visit time *is* the entry's
  time, which A1 forbids. Keep exact times, or round? *Recommended:* round to the hour any visit that
  logged medicine or a health entry, in every admin view and in the CSV; other visits keep minutes.
  Until you answer, those visits show the hour only.
- **F6. Who receives a household-level data-request export?** §12 would bundle every member's usage,
  devices and notes into one file. Should each person only ever receive their own section?
  *Recommended:* yes. A household request makes one file per person, each sent only to that person.
  Built that way until you answer.
- **F7. Free text in the access log.** The manual-access form and the erase confirmation let you type a
  reference of up to 120 characters. The log is append-only, kept 24 months after erasure, and shown
  in families' downloads. Allow it, or reason codes only? *Recommended:* reason codes only, plus an
  optional request number in a fixed shape (`R-0001`) that you match to your own notes outside Cubby.
  Built that way until you answer.
- **F8. Data requests from outside the app.** How does a family's log reach someone who cannot use the
  app, and how is a requester's identity checked before an export or erasure (step 20)?
  *Recommended:* restore their sign-in first and let them export in the app, so the team never
  handles the log; to check identity, the request must come from the account's verified address and
  be confirmed with a one-time code sent to it. (Also on the lawyer list.)
- **F9. Invitees.** The canvas shows "Email to Arjun · Invite resent"; the spec sends notes to members
  only, so Maya resends it herself. Which gets built? *Recommended:* members only.
- **F10. Workers Free or Paid?** Step 1 asked only about D1 writes, but the plan also sets subrequests
  per run (50 on Free), CPU time and the number of cron triggers. *Recommended:* tell us at step 1.
  The spec builds the daily refresh in chunks across 15-minute ticks, which works on either.
- **F11. The keys, in the policy.** As project owner you can open any record in the Firebase console.
  Should the policy say plainly that you hold the keys, do not open family records, and log any
  exception made at a family's request? *Recommended:* yes.
- **F12. App Store answers.** Declare Diagnostics and Device ID as linked, as well as Usage Data, or
  take it to the advisor first? *Recommended:* declare both now; under-declaring is the costlier
  mistake.
- **F13. EU and UK visitors, and the legal entity.** Usage measurement is on for everyone with no
  opt-out (decided). Will the advisor confirm that for EU and UK visitors before phase 3, and what is
  the legal entity's name for the policy? *Recommended:* ask before phase 3; phase 3 waits for both.
- **F14. One more bullet in the app?** The dashboard shows time zone, how someone found Cubby, the Pro
  waitlist, reminder settings and newsletter status, which the in-app list does not name. Add "Your
  settings, like reminders and newsletter, and how you found Cubby" to "What our team can see"?
  *Recommended:* yes; the app should not say less than the policy.
- **F15. Build order.** Confirm both changes in §17: the access log ships in phase 1, and families are
  measured only at the end of phase 3? *Recommended:* confirm.
- **F16. Is the Android app live on Google Play?** *Recommended:* if not, step 16 waits, and the
  dashboard's "Android app" row will be nearly empty; nothing else changes.
- **F17. Mockups.** These wait for your yes before they are built: the share row and sheet, the note
  card, the Privacy "shared" row and the email stop page (step 13), the composer templates (step 19),
  and the erasure flow (step 20). *Recommended:* approve each as its mockup arrives; none is built
  before.

---

## 0. How to read this

- **Decided** means the founder already made the call (11 to 13 November 2026). Do not reopen it.
- **My call** marks a decision this spec makes that the founder has not yet seen. Each one says why,
  so he can check it in a minute. All of them are listed again in §19.
- **F1 to F17** are the founder's questions at the top. Text that waits on one names it.
- Line numbers cited from `worker.js`, `app/index.html` and `app/store-firebase.js` are at `866851ac`.
- **Builder's call** marks something the builder settles while building, inside the rule written
  next to it. The builder does not need to go back to the founder for these.
- Every name and number in an example is sample data from the canvas (Household 12, Maya, Rosa,
  Usha, Arjun). No real person, address or uid appears here, and none may appear in anything built
  from it: fixtures use `example.com` addresses and ids shaped like `UID_sample_q1`.
- The approved canvas, "Admin dashboard and what families see", has six boards: the overview, one
  household in full, every record, what families see, instrumentation, and the version I would not
  build. Everything a builder needs from it is transcribed in §6 to §8, so this file stands alone.
  The canvas's orange "Sample data" chips are mockup labels and are **not** built.
- Before you start: read `CLAUDE.md`, `.claude/rules/ways-of-working.md` and `DESIGN.md` (§A1
  Personality and §A7 Voice are the law for every string a family reads). In a fresh worktree, link
  `tools/node_modules` first (CLAUDE.md shows the one command), or every browser gate dies.

Prior art this builds on, read before planning:

| What | Why it matters here |
|---|---|
| `docs/plans/2026-06-28-cubby-ops-admin-console-design.md` | The first, local-only design: roles, DSAR, erasure semantics, audit log. This spec supersedes its "never remote" rule, by the founder's decision. |
| `tools/ops.js`, `tools/analytics.js` | The localhost console and report. `ops.js` stays as the fallback (decided). Both read full event documents and print baby names today; §15.7 brings them inside the line. |
| `tools/funnel.js`, `tools/funnel_report.js`, `workers/funnel/core.mjs` | The derived funnel and the wedge: `sharedLoggingAt`, two different `authorId`s in one household on one UTC day, from the shared `events` only. Reuse it so "two people logging" equals the Monday digest exactly. Other funnel steps also count pregnancy and trying logs the admin may not read, so they can differ; the digest wins (§6.1). |
| `.telemetry/tracking-plan.yaml`, `tools/tracking_plan_check.js` | Today's plan is anonymous by rule ("measure households, not people", "no event may carry a uid"). This build changes that rule on purpose (§15.5). |
| `worker.js` | Reuse, do not rewrite: `verifyFirebaseToken` (2354); `fsGetStrict`, which keeps a 404 apart from an error (1431); the `_isCarer` and `pushGate` membership check (1452-1468); `fsRecentEvents` (1505), which shows a range on `time` needs no composite index while adding `type ==` would, so filter type in memory; `doseTicketKey` and its constant-time verify (2300-2345); `PUSH_CAP` and the push path (1394-1600); `signinCanaryProbe` behind `/api/canary` (634-840); `recordCronRun` (2082); `purgeAccountData` behind `/api/account/purge` (2094); `purgeDeletedHouseholds` with `HH_SUBCOLLECTIONS` and `HH_NESTED` (1914-2070); `funnelInput` and `funnelReadPreg` (2623 on), the masked-read pattern; `/api/step` (`recordStep`); `getAccessToken`. |
| `app/store-firebase.js`, `app/index.html` | `deleteAccount` (2722-2860), the order the server-side erase copies; every client write to `users/{uid}` already merges (1161, 1234, 1697, 1849, 2062, 2117; `index.html` 7848, 7954, 8011); `resolveHousehold` reads `users/{uid}` once at open (1071), which the notice and the team note ride. In `index.html`: `cubbyStep` and its test hook `window.__cubbyStepTest` (6908); `myLossHolding` (9168); Settings' "Your data & account" section, the export rows (8314-8318) and `openDeleteAccount`. |
| `wrangler.toml`, `.assetsignore`, `tools/deploy_exclusion_check.js` | The whole repo root is served as public static assets; `.assetsignore` is the only fence. `workers` is already fenced. |
| `privacy/index.html` | The policy gains "What our team can see" (§15.4). |
| `docs/plans/2026-08-04-app-store-listing.md` §4 and its "PRIVACY" review note, `docs/plans/2026-08-15-submit-runbook.md` §3 | The submission package says "usage data: not collected" and "no user id". Both become untrue in this build (§15.1). |
| `test/funnel-worker.test.js`, `test/worker-routes.test.js` | The test pattern to copy: D1 is real SQLite (`node:sqlite` `DatabaseSync`, line 11; CI runs Node 22), and Firestore is a recorder that logs every URL it was asked for, so a test proves what was fetched rather than what the code appears to do. |

---

## 1. Intent, and why

The founder's words: "a full admin dashboard ... users, logins, all data ... a learning and rollout
platform." And: "we need internal things to be fully transparent so that we can help and nudge the
right user for the right thing", together with "make sure we are transparent about what we are
doing, what we collect and what we will not share."

**Why.** Today Cubby can count, but it cannot see. The funnel snapshot and the Monday digest are
anonymous aggregates by design, so they can say "0 of 11 households reached two people logging" but
not *which* family is stuck, on which phone, at which step, and what would help. The second
caregiver is the wedge, and the moment a household stalls short of it is a moment a short, human
note could rescue. The dashboard turns "how many" into "who, and what would help".

**The line that makes it safe.** The team sees **who** uses Cubby and **how**, never **what** they
logged. That line is the whole design:

- It keeps the families' promise true ("We never see what you write").
- One leak of a child's fever or a mother's "not coping" would end the company. A dashboard that
  never holds those things cannot leak them.
- It does not cost the help: who is stuck, quiet or ready for the next step shows in *how* people
  use Cubby, not in what they wrote (canvas, "The version I would not build").
- Staff reading health details tied to a name needs a far heavier legal basis in the UAE and under
  the App Store's health data rules.

**Transparency both ways.** The internal view is not anonymous (decided). In exchange, families are
told plainly, before any of it starts, what the team sees, cannot see and never does; they can
switch notes off; they can share one entry for 7 days when they want help; and every look the team
takes is written to a log that cannot be edited.

**Learning and rollout, in this build,** means: which version of Cubby each person runs, whether a
new feature is used after a push and by whom, and where people get stuck. *My call:* editing remote
config (`config/app`) or rollout switches from the dashboard is out of scope. It is a write that
reaches every family and deserves its own design.

---

## 2. Goals, non-goals, anti-goals

### Goals

- **G1.** One private page that answers, in under a minute: is Cubby working right now, who uses it,
  how, on what, and who needs help next.
- **G2.** Every person and household identifiable to the founder: name, email, circle, roles, stage
  (decided: not anonymous).
- **G3.** Usage measured on all four ways in (iPhone app, Android app, home-screen app, browser tab)
  by one first-party tracker that never carries content.
- **G4.** Families told plainly, in the app and in the policy, before any linked measurement of them
  starts, and no linked event of a person stored before that person has seen the card for the current
  notice (§8.1, §8.7). Until families are told (phase 3), the dashboard shows per-person facts (name,
  email, role, sign-up) but no per-person activity: activity is per household (§17).
- **G5.** Help that stays human: the founder writes or approves every note, nothing is sent on its
  own, at most one note per household per week, never in the pregnancy loss path, and families can
  switch notes off.
- **G6.** Every view, export, note and deletion is written to an access log nobody can edit without
  it showing.
- **G7.** Erasure stays complete: deleting an account deletes its usage events, totals, devices,
  notes, shared entries and the feedback it sent in the same purge, and the admin's copy of the person
  is gone within one 15-minute tick.
- **G8.** The dashboard never spends more than a fixed share of the families' Firestore quota.

### Non-goals (this build)

- Log contents of any kind, except the one entry a family chooses to share for 7 days.
- Session replay, heatmaps, screen recording, keystroke capture.
- Third-party analytics, SDKs, pixels, tag managers, fonts or scripts, on the dashboard or in the
  tracker.
- Automatic nudges, drip sequences, or experiments run on families.
- Any second sign-in. "Only me for now" (decided). The June design's roles wait.
- Editing families' records from the dashboard, except the note field the nudge path writes (phase
  4) and erasure on request (phase 5).
- Remote-config or rollout editing (my call, §1).
- Replacing the anonymous `/api/step` counters or the Monday digest. Both keep running (my call:
  no regression risk to a working pipeline; folding them in later is a separate change).
- Scoring or ranking families by a model. *My call:* "Who to help next" is a short list of plain
  rules, each readable in one sentence, because automated profiling is on the lawyer list (§15.8).

### Anti-goals: a failure even if every screen works

- **A1.** Any log content visible to the team: an amount, dose, temperature, symptom, note, photo,
  mood, blood pressure, weight, the time written on an entry, or anything about a pregnancy loss.
- **A2.** A family's personal data reachable without the founder's Access sign-in: a public page, a
  `workers.dev` or preview URL, a cached response, a shareable CSV link, a search-engine copy, or the
  main site serving the admin Worker's code.
- **A3.** The founder's address, or any personal address, in anything this build adds (a commit, a
  test fixture, a log line, a client bundle), or in any tracked file once phase 1's cleanup lands.
  Git history already holds some; that is stated, not hidden (header).
- **A4.** Any third-party analytics or tracking anywhere in this work.
- **A5.** A note to anyone in the pregnancy loss path, to anyone who switched notes off, a second
  note to a household inside 7 days, or a note that sells (Pro, prices, offers).
- **A6.** Linked measurement of any family before the in-app screen, the privacy policy and the App
  Store answers say so.
- **A7.** A view of a household that is not in the access log, or an access log edited without the
  chain breaking.
- **A8.** The dashboard spending the families' quota so that saving a feed fails.
- **A9.** A loss marker stored anywhere; a stage history in any team table ("pregnant last week, not
  now"); or a per-person record of pregnancy and trying tools kept longer than 30 days, rolled into
  per-person totals, or shown while her journey is not shared and current (§8.4, §10).
- **A10.** The team contacting someone who never joined Cubby, such as an invitee (my call, §11.2;
  F9).
- **A11.** The team seeing a pregnancy, or a stage, that her own circle cannot see (§5.1).
- **A12.** An entry's own time, a dated health type, or a live invite token in any team table, page or
  file (§5.1, §9.2).

---

## 3. The line, exactly

| The team can see | The team never sees |
|---|---|
| Name as the circle sees it, and the verified sign-in email | Any value in any entry: amounts, doses, temperatures, symptoms, notes, photos, mood |
| Who is in the circle, their role (owner, caregiver, invited) and relationship label | The time written on an entry (when a feed happened). When someone *used* Cubby is visible; what they recorded is not |
| Stage: pregnant, baby with age, and trying only as an overview count; a pregnancy only when her circle can see it (§5.1; weeks and "Trying" wait for F4) | Baby names (my call: not on the canvas, not in the families' list); a pregnancy she has not shared with anyone |
| Sign-up date, sign-in methods; last sign-in and last seen from phase 3 | Anything in her private health (`mhealth`), the pregnancy journal's contents, private notes |
| Which features each person uses, how often, for how long, at what local hour (from phase 3 for families) | Anything about a pregnancy loss, including the loss archive and the holding state |
| Phone or browser (coarse), OS (coarse), which version of Cubby | Invitees' addresses (my call: the team never contacts people who have not joined) |
| Whether signing in or saving failed, with an error code | Push tokens, the due-reminder queue (it names medicines), raw IP, raw user agent |
| Time zone; how they found Cubby (first-touch tag, referral yes or no) | Location, contacts, advertising ids (none are collected) |
| Pro waitlist or plan; reminders on or off and quiet hours; notification permission; newsletter yes or no | Search text the founder typed into the dashboard (it is not logged either, §13 S18) |
| Notes the team sent and whether they were seen and acted on | |
| Counts only: entries per household per day (no type, no time), entries per person in the last 7 days, coarse kinds of entry over the last 7 days (§8.4), entries and photos in total | Which kind of entry was made on which day (a dated "temperature" reads as "the baby had a fever on 12 Nov") |

**The one exception:** a single entry a family chooses to share, visible to the team for 7 days, then
gone (§7.4).

**Two honest limits, written down so nobody overclaims.**

1. *The keys.* The founder owns the Google project and holds the master service account. He can, in
   principle, open any family's records in the Firebase console. The promise holds by rule, not by
   impossibility: the team's tools never show contents, nobody opens family records in the console,
   and the only exception is a family's own written request, recorded with "Record a manual access"
   (§6.4). *My call;* F11 asks whether the policy should say this in plain words.
2. *Inference.* The dashboard never states a loss, never stores a reason or a stage history, and the
   tracker falls silent for a person while her own holding screen is active (§8.5). It cannot stop a
   human noticing that a pregnancy is no longer shown. F3.

---

## 4. Architecture

```
 Families' devices: iPhone app, Android app, home-screen app, browser tab
   (all load the same web code from little-cubby.com/app/)
     |  cubbyTrack()  -> POST /api/usage  (Firebase ID token)
     |  share one entry, download what we keep, stop notes from email
     v
 Main Worker "cubby"  (worker.js, existing; master service account, existing secret)
   - /api/usage ingestion            -> D1 cubby-usage   (the only writer)
   - /api/share-entry, /api/me/kept, POST /api/notes/stop
   - cron (the existing */15 trigger): rollups, retention, shared-entry sweep, orphan sweep
   - /api/account/purge and purgeDeletedHouseholds also erase usage rows
   - AdminWrites, an RPC entrypoint with no URL: sendNudge, eraseAccount (eraseHousehold waits for F1)
          ^
          |  service bindings: MAIN (default fetch, for /api/canary, phase 1)
          |                    WRITES (entrypoint AdminWrites, phase 4; its only caller)
          |
 Admin Worker "cubby-admin"  (workers/admin/, new)  at admin.little-cubby.com
   - Cloudflare Access in front: email one-time PIN, allowlist of one
   - re-verifies the Access JWT on every request: signature, aud, team domain, email
   - read-only Google service account: Firestore viewer + Auth viewer, masked reads only
   - D1 cubby-admin (the only writer): access log, directory cache, read-budget meter
   - reads cubby-usage, cubby-games (snapshots, digest, cron health), cubby-newsletter (one row by
     email_hash)
   - cron every 15 minutes: Auth check of every directory uid, then the directory refresh in chunks
     inside a Firestore read budget
```

### 4.1 Two Workers, and the admin code never reaches the public site (decided)

- The admin is a **separate Worker**, `cubby-admin`, with its own `workers/admin/wrangler.toml`, the
  same pattern as `workers/pro-billing/`. It never shares a hostname with the main site.
- `workers` is already in `.assetsignore`, so nothing under `workers/admin/` is served by the main
  Worker. The same file already fences `schema`, `docs`, `tools`, `test` and `*.md`. The main
  `[assets]` directory is `./` with no `run_worker_first`, so a matching file is served without the
  Worker and anything unmatched, `/api/*` included, still reaches `worker.js` (`wrangler.toml`).
  *My call:* add an explicit `workers/admin` line as well, so deleting the broader line one
  day cannot expose it, and extend `tools/deploy_exclusion_check.js` so it (a) asks git, with the
  existing `coverage()` function, whether every file under `workers/admin/` is fenced, and (b) adds
  the admin entry file to `MUST_404` so the live check asks production for it.
- Shared pure code (Google token minting, the masked Firestore reader, the usage allowlist) lives in
  `workers/shared/` and `workers/usage/core.mjs`, imported by both Workers and by tests. Both
  folders are fenced by the same `workers` line.
- `workers_dev = false` and `preview_urls = false` in the admin's wrangler file (my call: the
  JWT re-check would already refuse those hosts, but a second hostname is a second front door).
- *My call:* the admin Worker has **no `[assets]` directory**. It serves its own handful of files
  (HTML, one script, one stylesheet, the two font families) from modules it imports, after the JWT
  check. If the builder prefers an assets folder, it must set `run_worker_first = true` so no byte
  is served before the check (builder's call between the two; the gate in §14 asks a static path
  without a token and expects 403 either way).
- Deploy: Cloudflare Workers Builds connected to the same repo with root directory `workers/admin`
  and watch paths `workers/admin/**`, `workers/shared/**`, `workers/usage/**`, so it deploys on push
  like the site (founder step 8). A manual `npx wrangler deploy -c workers/admin/wrangler.toml` from a
  clean clone outside `~/Downloads` is the fallback.

### 4.2 Cloudflare Access, then the Worker checks again (decided)

- **Access** is a self-hosted application on the whole hostname `admin.little-cubby.com`, login
  method "One-time PIN" only, one policy: Allow, Include, Emails, exactly one address. No bypass
  rules, no service tokens, no other identity providers.
- **The Worker re-verifies on every request**, including static files and errors:
  1. Read `Cf-Access-Jwt-Assertion`. Missing: 403.
  2. Header `alg` must be `RS256`; anything else (including `none` and `HS256`): 403.
  3. Signature checked against the keys at `https://<ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs`,
     cached per the response's `Cache-Control`. An unknown `kid` triggers a refetch at most once a
     minute per isolate; inside that minute it is simply refused, so junk tokens cannot hammer the
     certs endpoint (my call).
  4. `aud` contains `ACCESS_AUD`; `iss` equals `https://<ACCESS_TEAM_DOMAIN>`; `exp` is in the
     future and `iat`/`nbf` are not, with 60 seconds of skew.
  5. `email` is present, and lowercased equals the single address in `ADMIN_PEOPLE`. A token with
     `common_name` (a service token) or no `email`: 403.
  6. `Host` equals `admin.little-cubby.com`: otherwise 403.
- **Fail closed.** If `ACCESS_AUD`, `ACCESS_TEAM_DOMAIN`, `ADMIN_PEOPLE` or `FIREBASE_READER_SA` is
  missing or malformed, every request answers 503 "Not configured" with no data.
- **"Only me for now", in code (decided).** Only the founder may sign in. If `ADMIN_PEOPLE` holds
  anything other than exactly one entry, the Worker answers 503 to everyone. Adding a teammate then
  takes a code change and a review, not a dashboard edit, which matches the founder's words. Roles
  come with that change.
- Every refused request writes one `denied` row to the access log (reason code and ray id only),
  throttled to one row per minute per reason so a scanner cannot flood it.

### 4.3 Reads: a separate read-only service account, masked (decided)

- A new Google service account, created by the founder (step 4), with exactly two roles: **Cloud
  Datastore Viewer** and **Firebase Authentication Viewer**. Its JSON key exists only as the admin
  Worker secret `FIREBASE_READER_SA`. The admin Worker holds no write-capable Google credential.
- Firestore IAM is database-wide, so the viewer role *can* read every collection. The "no contents"
  guarantee is therefore enforced in code, three ways:
  1. One masked reader, `workers/shared/fs-read.mjs`, is the only function in the admin Worker that
     calls `firestore.googleapis.com`. It takes `(path pattern, fields)` and throws, before any
     fetch, unless the pair is in the allowlist in §5.1. Every request carries `mask.fieldPaths` (or
     a `select` in a structured query).
  2. Values are reduced on the spot: a baby's record becomes an age in weeks or months; an invite
     becomes a relationship label and a sent date; an entry becomes a day and a coarse kind. Names of
     babies, invitee addresses, invite-link tokens (the keys of `pendingLinks`) and entry times never
     leave the function that read them.
  3. A gate drives the real refresh against a Firestore recorder seeded with recognisable strings
     and proves none of them reaches D1 or any response (§14, `admin-no-content`).
- Auth reads use Identity Toolkit `accounts:batchGet` with the same account. Fields kept: `localId`,
  `email`, `emailVerified`, `createdAt`, `lastLoginAt`, `lastRefreshAt`, `providerUserInfo[].providerId`,
  `disabled`. Anything else returned, including any password hash or salt, is dropped on the spot.

### 4.4 Writes: one distinct, logged path (decided)

- *My call:* the path is a **named RPC entrypoint in the main Worker**, `AdminWrites`, reachable only
  through a service binding (`WRITES`) from the admin Worker. It has no URL. Its methods are
  `sendNudge`, `eraseAccount`, and `eraseHousehold` once F1 is answered (and nothing that writes
  arbitrary documents). The target Worker is `cubby` (`wrangler.toml` `name`); its
  `compatibility_date`, 2025-06-01, already supports `WorkerEntrypoint` RPC.
- Why there and not a second "writer" key in the admin Worker: no new write-capable credential is
  created; the write code sits beside the purge and push code that is already proven against the
  emulator; and the admin can only ask for named acts, never compose a write.
- `AdminWrites` **re-checks every premise itself** with a fresh masked read (membership, hold,
  deletion pending, consent, caps, spacing). It never trusts what the admin page showed. The same
  rule the purge follows: a server job that changes data re-checks its own premise.
- The admin Worker writes an access-log row *before* the call (the intent) and another after it (the
  outcome). Builder's trap: `import { WorkerEntrypoint } from 'cloudflare:workers'` in `worker.js`
  will break the node tests that import `worker.js` today; give the tests a stub for that module
  (builder's call how), and deploy the main Worker with the entrypoint before the admin Worker that
  binds it.

### 4.5 Databases: one writer each (my call)

| D1 database | Written by | Read by | Holds |
|---|---|---|---|
| `cubby-usage` (new) | main Worker only | admin Worker; main Worker | usage events, daily totals, devices, membership cache, the nudge ledger, shared entries, refusal counts |
| `cubby-admin` (new) | admin Worker only | admin Worker; main Worker for exactly two reads: a person's own "times the team opened your household" (§7.5, filtered to rows about the caller), and the chain head with the week's counts for the Monday digest (S19) | access log, directory cache, read-budget meter |
| `cubby-games` (existing, `GAMES_DB`) | main Worker | admin Worker, read-only by code | funnel snapshots (`ok`, `reason`), `funnel_meta` (`digest_last`), `ops_state` (`push_last_run`, and the new daily sent and failed tally, §6.1) |
| `cubby-newsletter` (existing, `NEWSLETTER_DB`) | main Worker | admin Worker, read-only by code, one row by `email_hash` | newsletter opt-in and stage |

Why a new database for usage rather than `cubby-games`: usage rows are linked to people, and
`cubby-games` takes anonymous writes from strangers under shared daily ceilings. Keeping linked data
apart makes erasure and access easy to reason about. Why not Workers Analytics Engine: it cannot
delete one person's rows, so erasure would be a lie (my call). Why never Firestore: decided, and the
families' write quota must not be spent on telemetry (the same reason `/api/step` moved to D1).

"Read-only by code" is a gate: no `INSERT`, `UPDATE`, `DELETE`, `REPLACE` or `CREATE` against
`USAGE_DB`, `GAMES_DB` or `NEWSLETTER_DB` anywhere under `workers/admin/`, and the main Worker's only
uses of `ADMIN_DB` are those two `SELECT`s, each in its own named function.

### 4.6 Bindings, variables and secrets

Admin Worker, `workers/admin/wrangler.toml` (sketch; the database ids are pasted by the founder
after he creates them, and the blocks stay commented until then, as `wrangler.toml` already does):

```toml
name = "cubby-admin"
main = "src/index.js"
compatibility_date = "2026-11-01"
workers_dev = false
preview_urls = false
routes = [ { pattern = "admin.little-cubby.com", custom_domain = true } ]

[triggers]
crons = ["*/15 * * * *"]

[vars]
ADMIN_HOST = "admin.little-cubby.com"
ADMIN_DAILY_READ_BUDGET = "8000"

# [[d1_databases]]  ADMIN_DB      -> cubby-admin        (written here only)
# [[d1_databases]]  USAGE_DB      -> cubby-usage        (read only, by code)
# [[d1_databases]]  GAMES_DB      -> cubby-games        (read only, by code; id already in the main wrangler.toml)
# [[d1_databases]]  NEWSLETTER_DB -> cubby-newsletter   (read only, by code; id already in the main wrangler.toml)

# Phase 1: the sign-in canary, through the main Worker's own fetch handler (no same-zone fetch).
# [[services]]  binding = "MAIN"    service = "cubby"
# Phase 4:
# [[services]]  binding = "WRITES"  service = "cubby"  entrypoint = "AdminWrites"

# Secrets, set with `npx wrangler secret put <NAME>`, never in this file:
#   ACCESS_AUD, ACCESS_TEAM_DOMAIN, ADMIN_PEOPLE, FIREBASE_READER_SA, INTERNAL_UIDS
```

The `routes` entry with `custom_domain = true` creates the hostname and its DNS record at the first
deploy (step 8), not at a later dashboard step. That is harmless because Access exists from step 3,
and step 9 is worded to match (my call).

**Why `MAIN` from phase 1 (my call).** `wrangler.toml` declares no route for `little-cubby.com`. If
the dashboard serves the site through a route rather than a Custom Domain, a fetch from the admin
Worker to `https://little-cubby.com/api/canary` is a same-zone Worker-to-Worker fetch and fails with
error 1042. A service binding avoids the question. Cron health and the digest are read straight from
`GAMES_DB` (§5.3), so they need no call at all.

Main Worker, additions to `wrangler.toml`. *My call:* the two values go **into the existing `[vars]`
table**, which already holds `MAIL_FROM`. A second `[vars]` header is invalid TOML and fails the
deploy.

```toml
[vars]
MAIL_FROM = "Cubby <noreply@mail.little-cubby.com>"   # existing line, unchanged
USAGE_MODE = "off"          # off | internal | on. "on" needs the founder's yes (phase 3).
USAGE_DAILY_CAP = "50000"   # events a UTC day across everyone; past it, accepted and not stored

# [[d1_databases]]  USAGE_DB -> cubby-usage
# [[d1_databases]]  ADMIN_DB -> cubby-admin   (two SELECTs: a person's own access-log rows; the digest's chain head)

# [[unsafe.bindings]]  name = "USAGE_RATE_LIMITER", type = "ratelimit", namespace_id = "1007",
#                      simple = { limit = 120, period = 60 }   (1001 to 1006 are taken)
```

| Secret | Worker | What it is | Set by |
|---|---|---|---|
| `ACCESS_AUD` | admin | the Access application's audience tag | founder |
| `ACCESS_TEAM_DOMAIN` | admin | `<team>.cloudflareaccess.com` (a secret so the public repo carries no account identifiers; my call) | founder |
| `ADMIN_PEOPLE` | admin | JSON, exactly one entry: `[{"email":"<address>","name":"<first name>"}]` | founder |
| `FIREBASE_READER_SA` | admin | the read-only service account's JSON key | founder |
| `INTERNAL_UIDS` | admin **and** main | the founder's own account uids, comma-separated | founder |
| existing `FIREBASE_SERVICE_ACCOUNT`, `RESEND_API_KEY`, `ALERT_EMAIL` | main | unchanged | already set |

### 4.7 The Firestore read budget (my call)

The families' project runs on the free plan: about 50,000 reads a day for everything. The existing
funnel snapshot already takes up to 15,000 on its daily run. So:

- `ADMIN_DAILY_READ_BUDGET` defaults to **8,000** reads per UTC day, metered in `cubby-admin`
  (`admin_meta`). Past it, the refresh stops for the day and every page says "Numbers from 14:30.
  Paused to protect families' quota." It never borrows.
- **Every 15 minutes, first:** Auth `accounts:batchGet` over every uid in the directory (it costs no
  Firestore reads). A uid Auth no longer has loses its `dir_people` row on that tick, and a household
  with no remaining member loses its `dir_*` rows, without waiting for any Firestore read (my call).
  This is what makes "gone at the next refresh" true even when the read budget pauses the daily pass.
  A lookup *failure* never counts as "gone".
- **Every 15 minutes, then:** `households` where `updatedAt > cursor`, masked. Usually a handful of
  reads. `updatedAt` is stamped only by blob pushes: a join writes `members` and `memberInfo` without
  it, and leaving a household (in-app `deleteAccount`) sets none. So the 15-minute pass is a freshness
  aid, not the source of truth: the Auth check above and the daily pass catch the rest, and opening a
  household always reads it fresh.
- **Once a day:** a full masked page of `households` and `users`; the last 7 days of each household's
  events masked to `time, authorId, type` (the same query `funnelInput` uses, with `type` filtered in
  memory); `pushLedger` caps; `waitlist` existence; each household's `pregnancy` collection, masked
  (§5.1).
- **In chunks (my call; F10).** The daily pass is a cursor in `admin_meta` that advances across the
  15-minute ticks, each tick spending at most 40 subrequests and a bounded CPU slice, so it works on
  Workers Free (50 subrequests a run, a small cron allowance) and on Paid alike. A full pass usually
  finishes within a few hours of 00:00 UTC; the pages say when the last full pass finished.
- **On demand:** opening a household reads that household and its members' `users` docs fresh (at
  most 1 + members reads, kept in memory for 5 minutes), plus two COUNT aggregations for "entries in
  total" and "photos" (one read per thousand entries).
- Usage numbers come from D1, which has its own quota, so the busiest panels cost Firestore nothing.
- Builder's call: whether to later share one masked daily read between the funnel snapshot and the
  admin refresh. Not required now.

### 4.8 Every admin response carries

`Cache-Control: no-store`; `X-Robots-Tag: noindex, nofollow, noarchive`; `Referrer-Policy:
no-referrer`; `X-Content-Type-Options: nosniff`; `Strict-Transport-Security: max-age=31536000`;
`Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'
data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action
'self'`. HTML pages also carry `<meta name="robots" content="noindex">`. No CORS headers, ever. The
same headers go on 403, 404, 500 and 503.

### 4.9 `tools/ops.js` stays (decided)

The localhost console remains the fallback for when the hosted admin is down or being changed. It
keeps binding to 127.0.0.1 only. In phase 3 it comes inside the line (§15.7).

---

## 5. Data sources

### 5.0 The records, as they are at `866851ac`

Settled from the code, so the builder does not have to rediscover them.

| What | As it is | Source |
|---|---|---|
| The household document | `ownerId`; `members` as `{uid: 'owner' \| 'caregiver'}`; `memberInfo` (`{uid: {name, photoURL, role, relationship, joinedAt?}}`); `createdAt` (a `timestampValue`); `updatedAt`, stamped only by blob pushes; `deleteAfter`; `pendingInvites`, keyed by the invitee's email; `pendingLinks`, keyed by the `inviteLinks` token; `pro`; and `app.<key>`, written as field paths | `worker.js` `purgeDeletedHouseholds`, `funnelInput`; `store-firebase.js` 2540-2560 |
| Join dates | `memberInfo.<uid>.joinedAt` (a server timestamp) **is** stamped on every join by invite or link, by `memberUpdate` (`store-firebase.js` 1022-1031), since `df2015a2` on 8 Aug 2026. The household's creator has none (her `memberInfo` is written by `memberInfoMap`); her join date is the household's `createdAt`. Joins before 8 Aug have none. `funnelInput` sets `joinedAt: 0` because it never reads the field, and `pickHeir`'s comment "We do not record a join date anywhere" is out of date. A member may edit their own `memberInfo` entry (`firestore.rules` 240-245), so the date is a fair hint, not proof | as cited |
| The loss hold | `households/{hid}.app.lossHolding`, a per-uid map `{uid: {at}}`, seeded for the carrier and everyone the journey was shared with. The legacy shape `{at}` means the owner. Held means the map is not empty. Every blob push writes the key, as `null` when empty (`store-firebase.js` 1285) | `store-firebase.js` 1285; `index.html` `myLossHolding` 9168, `endPregnancy` 13546 |
| The pregnancy journey | `households/{hid}/pregnancy/{carrierUid}` = `{ownerUid, data, sharedWith, updatedAt}`. The id is the **carrier's** uid, often not `households.ownerId` (Papa-Bear-owned journeys). The app reads `data.dueDate` and `data.lmp`. `data.stage` is `'planning'` (trying) or `'expecting'`. A birth is `data.bornBabyId` plus `data.birthAt`. The document is deleted when a pregnancy ends. It is readable only by the carrier and the uids in `sharedWith` (`firestore.rules` 508) | `index.html`; `worker.js` `funnelReadPreg` 2623; `core.mjs` `stageOf` |
| Push settings | `users/{uid}.push` holds `enabled`, `allow.{critical,feature,marketing}`, `tz`, `quietStart`, `quietEnd`, `tokens`, `due`. `PUSH_CAP` is `{marketing: 2, feature: 5}` per calendar month in the person's own time zone. Missing consent means no. With no `tz` the send waits. A cap is consumed only after a real FCM delivery | `worker.js` 1394-1600 |
| Writes to `users/{uid}` | Every client write merges (call sites in the prior-art table). `firestore.rules` line 11 gives the owner blanket read and write, so `teamNotes`, `privacyNoticeSeen` and `teamNote.seenAt` need **no rules change**. It also means a person can forge a `teamNote` to themselves; that is harmless, because it is rendered as text and only they see it. `users/{uid}.email` and `.name` are client-written too, so the admin never shows them (§5.2) | as cited |
| Photo bytes | In Firestore as data URLs (`photos/{id}.data` and `pregnancy/{uid}/photos`). There is no Firebase Storage, so a Firestore erasure covers them | `store-firebase.js` 2888-2925 |
| Record types | `feed`, `sleep`, `diaper`, `pump`, `growth`, `medicine`, `temperature`, `symptom`, `vaccine`, `milestone`, `activity`, `visit`. Folded to coarse kinds before anything is stored (§8.4) | `index.html` |
| Internal households | A household is internal when its `ownerId` is in `INTERNAL_UIDS`; the admin uses the same rule | `worker.js` 2066, 2647 |
| Feedback | `feedback/{id}` holds `text`, `uid`, `email`, `name`, `householdId`, `version`, a raw `userAgent` and dates. Rules deny every client read, update and delete, so the in-app deletion cannot reach it today | `store-firebase.js` 3800; `firestore.rules` 16 |
| Who may export or delete today | Taking a copy is each person's right and never waits for anyone, but the family-log export row is guardian-only. Deleting the shared record asks both guardians. Account deletion is each person's own act | `index.html` 8314-8318, 8906-8920 |

### 5.1 Firestore: the complete read allowlist

Anything not in this table is refused by the masked reader before a request is made.

| Path | Fields (mask) | When | Kept as |
|---|---|---|---|
| `households` (query `updatedAt > cursor`; daily full page) | `ownerId`, `members`, `memberInfo`, `createdAt`, `updatedAt`, `pro`, `deleteAfter`, `pendingInvites`, `pendingLinks`, `app.babies` | 15 min and daily | owner, members with role, name, relationship label and join date (§5.0; photo URL dropped); invited rows as relationship label plus sent date; baby count and the youngest baby's age (names, sex, avatar, country dropped); plan; "deletion pending" yes or no. **The keys of `pendingInvites` are invitee addresses and the keys of `pendingLinks` are live invite tokens** (the `inviteLinks` ids, which `firestore.rules` line 143 calls "the whole security model"). The reducer iterates over values only and drops both maps the moment it has read them; no key ever reaches a variable that outlives the function, D1, a log line or a response |
| `households/{hid}/pregnancy` (list, the `funnelReadPreg` pattern) | `ownerUid`, `sharedWith`, `data.stage`, `data.bornBabyId`, `data.birthAt`. `data.dueDate` and `data.lmp` join the mask only if F4 says weeks | daily, and on demand | **Only when `sharedWith` includes at least one other current member of the household** (my call, A11): stage (trying, pregnant, born). A journey shared with nobody is treated exactly as if it did not exist: the household's stage is worked out from the shared record alone, and no label hints that a private journey exists. Nothing else from these documents, ever. The document id names the carrier; the admin keeps it only to know whose journey it is |
| `households/{hid}/events` | `time`, `authorId`, `type`, read for the last 7 days | daily | per household per day: entries and distinct authors (`dir_household_days`, no type, no uid); per household: coarse kinds over the last 7 days (§8.4); per person: entries in the last 7 days, as current state, from phase 3 (§17). The entry `time` itself is never stored. Never another field |
| `households/{hid}/events`, `households/{hid}/photos` | COUNT aggregation only | on demand | "412, plus 38 photos" |
| `users/{uid}` | `householdId`, `acq`, `referredBy`, `push.enabled`, `push.allow`, `push.tz`, `push.quietStart`, `push.quietEnd`, `teamNotes`, `privacyNoticeSeen` | daily, and on demand | as shown. Never `name` or `email` (client-written; §5.2), never `pregnancyArchive`, never `push.tokens`, never `push.due` |
| `pushLedger/{uid}` | `caps` | daily, and on demand | "feature 3 of 5, marketing 0 of 2 this month" |
| `waitlist/{uid}` | `uid` | daily | on the Pro waitlist, yes or no |
| **Hold reader only:** `households/{hid}` | `app.lossHolding` | at view time for "Who to help next" candidates; separately in `AdminWrites` at send time | one boolean, `held`, in memory for that request only |

Never read by the admin, in any form: `households/{hid}/mhealth/**`, `households/{hid}/notes/**`,
photo documents (beyond the count), `households/{hid}/pregnancy/*/photos/**`, any field of a pregnancy
document beyond the mask above, `households/{hid}/memberEmails/**`, any other field of `app`,
`invites`, `inviteLinks`, `feedback` (it stays in `ops.js`; my call), `signinCodes`, `campaigns`, the
legacy Firestore `newsletter` and `pageStats` collections.

**The hold reader** is the single place the string `lossHolding` may appear in admin or `AdminWrites`
code. It returns `true` or `false`. The value is never written to D1, never logged, never sent to the
page, and never shown as a reason (§11.2). It exists only to make "never during a hard time" true.

**It fails closed (my call).** Held is `true` unless the read succeeded and the field is present
with a shape it knows to be empty:

| What the read returns | `held` |
|---|---|
| `app.lossHolding` present and `null`, or an empty map | false |
| a map with one or more uid entries, or the legacy `{at}` shape | true |
| the field absent, a different type, an unknown shape, a 404 on the household, any read error or timeout | **true** |

The tracking plan calls the circle-shared `lossHolding` "an open privacy defect", so the field may
move one day. Under this rule a move switches notes *off* for everyone until the reader follows, never
silently on. The builder confirms that every household-creation path writes `app.lossHolding` (as
`null`); any that does not is fixed in the app in phase 4, so a new household is not held forever. A
held household and a household whose field is missing show the same refusal (§11.5), so neither is
distinguishable on screen.

### 5.2 Firebase Auth

`accounts:batchGet` (paged), kept fields listed in §4.3.

- **Email** shown anywhere in the admin is the Auth `email`, with its `emailVerified` flag (my call).
  `users/{uid}.email` and `.name` can be set to anything by the client (`firestore.rules` line 11).
  The **name** shown is the person's `memberInfo` name, the one their circle sees.
- **"Signs in with"** shows Google, Apple or Email (my call). Auth cannot tell an email link from an
  email code: custom-token sign-ins carry no provider. One "Email" label is the truthful one.
- **"Signed up"** is `createdAt`. **"Last sign-in"** (`lastLoginAt`) and **"Last seen"** (`lastRefreshAt`,
  which moves when a signed-in app refreshes its token, about hourly while open) are per-person
  activity, so they are shown only from phase 3 (§17).

### 5.3 D1

The new schemas are in §9. Existing tables the admin reads, straight from D1 (my call; no HTTP call):

- `GAMES_DB`: `ops_state` key `push_last_run` (written by `recordCronRun`, `worker.js` 2082, and also
  what `/api/health` returns) and the new key `push_daily` (§6.1); `funnel_meta` key `digest_last`;
  `funnel_snapshots` (`ok`, `reason`) (`worker.js` 2555-2860).
- `NEWSLETTER_DB`: `subscribers` is keyed by `email_hash` = sha256 of the lowercased email; `stage` is
  `'expecting'`, `'baby'` or `'unknown'` (`schema/newsletter.sql`). The admin runs exactly
  `SELECT stage, status FROM subscribers WHERE email_hash = ?` with the hash of the verified Auth
  email (my call). It never reads `email` or `unsub_token`, which is a credential.

### 5.4 The one main-Worker endpoint the admin calls

`/api/canary`, through the `MAIN` service binding (§4.6). It proves **only the email-code path**:
`signinCanaryProbe` writes and reads `signinCodes` (`worker.js` 634-840). It returns no family data.

---

## 6. The admin screens

Common to every screen: Cubby's own tokens and type (cream `#F4EEE3` page, white cards with radius
26px, Fraunces for headings, Nunito Sans for everything else, the category colours meaning what they
mean in the app). Fonts are served by the admin Worker itself, never from Google Fonts (the canvas
loads Google Fonts only because it is a mockup). Light only in this build (builder's call to add
dark later). Works from 1440px down to 320px: tables scroll sideways inside their card, never the
page; touch targets at least 44px. Times are shown in the family's own time zone wherever a family is
in view, and say so. The admin has a fixture mode for tests and local preview (my call). It refuses
to start when the host is `admin.little-cubby.com`, **or** when any production secret or binding is
present: `ACCESS_AUD`, `ACCESS_TEAM_DOMAIN`, `ADMIN_PEOPLE`, `FIREBASE_READER_SA`, `INTERNAL_UIDS`,
`MAIN`, `WRITES`, or a D1 binding whose id is not a local one (my call; `admin-access` stages each).

Every element below lists its source and the phase that switches it on. Before its phase, a usage
panel shows "Waiting for usage events" rather than a zero (a zero would read as "nobody uses
Cubby", which is the mistake the funnel's first live run made).

### 6.1 Overview, `/`

**Header.** Title "Cubby Ops". Line: "Every family, every person, and how Cubby is really used.
Updated every 15 minutes. Only you can open this." Range switch: Today, 7 days (default), 30 days,
90 days. Checkbox "Hide our own accounts", on by default. If `INTERNAL_UIDS` is empty, a warning
band: "Your own accounts are not tagged, so every number here includes you." (my call).

`dir_household_days` is empty at the first deploy and fills one day per daily pass (plus the 7 days
the first pass reads). *My call:* no backfill, which would spend the families' read quota on history.
Until the table holds the whole range, the 30 and 90 day choices read "30 days (since 14 Nov)" and
so on, with the real start date.

| Element | What it shows (canvas sample) | Source | Phase |
|---|---|---|---|
| System check: Saving and sync | "Working · last write 40 seconds ago"; red when saves fail | last `feature.used` with action `logged`; red when `save.failed` comes from 3 or more people in an hour (builder's call on the threshold) | 2 |
| System check: Sign-in codes | "Working · test code 6 minutes ago" | `/api/canary` through `MAIN`: `ok`, `ageSeconds`. The canvas says "all three ways", but the canary proves only the email-code path, so the label is "Sign-in codes" (answered) | 1 |
| System check: Reminders sending | "Working · 31 sent today, 0 failed" | `GAMES_DB` `ops_state` `push_last_run`, plus a new key `push_daily` that `recordCronRun` keeps: the day's sent and failed tally (my call: in `ops_state` for the admin to read; **not** added to the public `/api/health`) | 1 |
| System check: Weekly report email | "Not sending · last good run 30 Aug" (red outline) | `GAMES_DB` `funnel_meta.digest_last` against the last Monday, and today's `funnel_snapshots` (`ok`, `reason`) | 1 |
| Tile: Households | "48", "+6 in this range" | `dir_households`, excluding internal and deletion pending | 1 |
| Tile: People | "97", "2.0 per household" | members across those households | 1 |
| Tile: Active today | "21", "opened Cubby since midnight" | distinct people with `visit.started` on their own local today. No Auth fallback: per-person activity waits for families to be told (§17) | 2 (internal accounts only), 3 |
| Tile: Active this week | "36", "75% of households" | households with any member's visit in 7 days | 2 (internal only), 3 |
| Tile: Two people logging | "14", "29% of households" | households where two different people logged on one day in the range: `dir_household_days.authors >= 2`, by the same rule as `core.mjs` `sharedLoggingAt` (UTC days, shared `events` only), so it **equals** the digest | 1 |
| Tile: Went quiet | "5", "no visit in 7 days" | households with earlier visits and none in the last 7 days | 2 (internal only), 3 |
| Where families are | "Households by stage, right now": Trying, Pregnant, Baby, and *my call* "No stage shared" in place of the canvas's "Not started yet", as bars | `dir_households.stage`, current state only. A journey shared with nobody counts as no journey (§5.1), so "No stage shared" covers both a household that has not started and one whose journey is private, and the bar never singles out a private pregnancy. A solo carrier's journey is therefore not counted as pregnant either: the safe side | 1 |
| Getting started | "Everyone who signed up in this range, and how far they got. The last step is the one that matters most: two people logging on the same day." Steps: Signed up, Made a household, First entry, Came back another day, Invited someone, Second person joined, Two people logged on one day. Under it, *my call*: "First entry and coming back count the shared log only. The Monday digest also counts pregnancy and trying logs, so where the two differ, the digest is right." | Auth `createdAt` in range, then `dir_households`, `dir_household_days`, pending invites or links or a caregiver ever present, `members`, the wedge. `core.mjs` also counts `data.kicks`, `contractions`, `observations` and `periods`, which §5.1 forbids the admin to read, so a household that only logs its pregnancy shows no first entry here. **The Monday digest is the number of record** for every funnel step; the admin's "Two people logging" is the one step guaranteed to match it | 1 |
| What people use | "Most used first. Counts what was used, never what was written." Columns: Feature, Households, People, Uses, Time spent, Vs last range. Link "See every event" | `usage_daily` (`feature`, `screen`, `seconds`) for the range and the one before it; "New" when the previous range had none. Pregnancy and trying tools (§8.4 `JOURNEY_KEYS`) come from aggregate rows only, so their Households and People columns count the last 30 days whatever the range, and say so | 2 |
| Time in Cubby | "A visit starts when the app comes to the front and ends when it goes away, on every platform." Typical visit (median), visits a day per active person, time a day per active person, and "When people open Cubby, by local hour" (24 bars) | `visit.ended.seconds`, `usage_daily` visits and seconds, `visit.started.local_hour` | 2 |
| Where they use it | "Active people this range, by how they open Cubby": iPhone app, Home-screen app (installed from Safari), Android app, In a browser tab. Line: "88% are on the newest version. 6 people have not updated in over 2 weeks." | `usage_daily.platform`, `devices.app_version`. Newest = the highest version reported in the last 24 hours (builder's call) | 2 |
| Who to help next | "People who look stuck or ready for the next step, with a suggestion. You decide what gets sent; nothing goes out on its own." Up to 10 rows: why, who (household, name, role, stage, platform), "Suggested: ...", button "Open household". Under it: "Never suggested: anyone in the pregnancy loss path, anyone who turned nudges off, or anyone nudged in the last 7 days." | rules in §11.1 over the directory, usage and the nudge ledger; the hold reader at view time | list in 3 (it names people, so it waits for families to be told), sending in 4 |
| Footer | "Built from Cubby's own records and its own usage events. No third-party trackers. Every time you open a household, it is written to the access log." | static | 1 |

### 6.2 One household, `/household/<n>`

`<n>` is the household's display number ("Household 12"). *My call:* numbers are assigned once, in
order of `createdAt`, stored in `dir_households`, and never reused, so a number in a note or the log
always means the same family. "Never reused" is kept by a high-water counter, `display_no_next` in
`admin_meta` (my call), not by tombstone rows: a deleted household's row and id go entirely. The
Firestore id never appears in a URL.

| Element | What it shows (canvas sample) | Source | Phase |
|---|---|---|---|
| Back link | "Back to all households" | | 1 |
| Title | "Household 12 · Maya's family" (owner's first name; "Household 12" alone if there is none) | directory | 1 |
| Chips | "Baby · 2 months" (or "Pregnant", "No stage shared"; weeks and a named "Trying" wait for F4); "Started 3 Sep 2026"; "Dubai · UAE time"; "Free · on the Pro waitlist"; "Came from Instagram · "3am feed" post" | stage by the §5.1 rule; `createdAt`; the owner's latest usage time zone, else `push.tz` (builder's call on the city label); `pro` and `waitlist`; owner's `acq` | 1 (time zone from 3) |
| Buttons | "Draft a nudge"; "Export everything for a data request" (per person, F6); "Delete household" (outlined in red; waits for F1, and until then the button is "Delete one person's account", on that person's own request) | §11, §12 | not rendered until phase 4 and phase 5 respectively (my call: hidden, not disabled) |
| Access banner | "You opened this household at 10:42 today. That is now in the access log, with your name." | the `access_log` row this very view wrote; the time shown is that row's time, as proof | 1 |
| Nudge composer | §11.3 | | 4 |
| People in this household | Columns: Person (name, relationship), Role, Email, Joined, Last seen, Opens Cubby on (platform; "iOS 26.1 · newest version"), Visits 7 days, Time 7 days, Entries 7 days, Reminders. An invited row reads "Arjun · Dad · Invited · Invite sent 29 Oct, not accepted" with no email (my call). **Email** is the verified Auth address (§5.2). **Joined** is `memberInfo.<uid>.joinedAt` where it exists, the household's `createdAt` for its creator, otherwise "Not recorded" (§5.0) | directory, Auth, `devices`, `usage_daily`, `dir_people.entries_7d`, `push.enabled` | name, role, email, joined, reminders: 1. Last seen, entries, platform and usage: 3 (internal accounts from 2) |
| Who uses what, last 30 days | "Number of times each person used each feature": person by feature grid (canvas: Feeds, Nappies, Sleep, Doses, Timeline, Photos, Invite), shaded by share of the column's highest | `usage_daily` feature and screen counts; builder picks the household's top 7. Pregnancy and trying tools appear here only while the household's stage shows a shared, current journey (§8.4) | 3 (internal from 2) |
| Visits, last 48 hours | "What each person did, never what they wrote. Times are in the family's own time zone." Rows: "Today 3:12am · Rosa · Android app · logged a feed, read the timeline · 1m 10s". A visit that logged medicine or a health entry shows the hour only ("Yesterday, 9pm") until F5 is answered | `usage_events`, grouped by visit, summarised from `feature.used` and `screen.viewed` ("looked at 3 photos"); pregnancy and trying tools only under the same rule as above | 3 (internal from 2) |
| Nudges sent | "29 Oct · Note in Cubby to Maya · Invite reminder · Not opened yet"; "15 Oct · ... · Seen the same day · Rosa joined 2 days later" | `nudges` | 4 |
| Choices they made | "Notes and nudges from the team: Allowed" (one row per person when they differ; my call); "Reminders (Maya): On · quiet 10pm to 7am"; "Newsletter: Yes, baby stage"; "Push this month: feature 3 of 5, marketing 0 of 2" (the canvas's "3 of 8" is sample; the real caps are `PUSH_CAP` in `worker.js`) | `users.teamNotes`, `users.push`, `NEWSLETTER_DB`, `pushLedger.caps` | 1 |
| Health of their record | "Last saved: today, from Rosa's phone" (*my call:* at day level, like the Households tab; a clock time here would be the time written on an entry, A1); "Failed saves, 7 days: None"; "Sign-in problems, 7 days: None"; "Entries in total: 412, plus 38 photos" | phase 1: the household's last entry day from `dir_household_days`, with no person ("Last entry: 3 days ago"); from phase 3, the last `feature.used` logged (person and platform); `save.failed`; `signin.attempted` failures linked to members; COUNT aggregations | 1, per-person rows from 3 |
| Not shown here, on purpose | Verbatim: "What anyone actually logged: amounts, times of each feed, doses, temperatures, symptoms, notes, photos, mood, and anything about a pregnancy loss. You can see that Maya logs doses, not what the doses were." and "If a family needs help with an entry, they can share it with you from the app. Then it shows here for 7 days." | static | 1 |
| Shared with you | Only while a share is active: the one entry, read-only, who shared it, "Visible until 20 Nov". Opening it writes `view_shared_entry` to the access log. Not on the canvas; implied by the panel above (my call on placement: directly under the access banner) | `shared_entries` where not stopped and not expired | 3 |

### 6.3 Every record, `/records`

Header: back link "Back to overview"; title "Every record"; line "Search, filter and export anything
Cubby keeps about people and how they use it."; button "Export this view (CSV)".

Tabs, each with its count: People, Households, Visits, Usage events, Sign-ins, Devices, Nudges,
Access log. Filters: Search ("Name, email or household"), Stage (Any, Trying, Pregnant, Baby), Opens
Cubby on (Any, iPhone app, Home-screen app, Android app, Browser tab), Last seen (Any time, Today,
This week, Quiet for 7 days or more). Saved views: "No first entry after 2 days", "Only one person
logging", "Invite sent, never joined", "On an old version", "Sign-in failures". 50 rows a page with a
cursor (builder's call on size).

| Tab | Columns or content (canvas) | Source | Phase |
|---|---|---|---|
| People | Person (name, email), Household (link), Role, Stage, Signed up, Signs in with, Last seen, Opens Cubby on, Visits 30 days, Top feature, Came from ("Instagram", "Invite from Maya", "Search", "Paid test"). Footer: "Showing 8 of 97 people. Our own accounts are hidden." Email is the verified Auth address; "Signs in with" is Google, Apple or Email (§5.2) | directory, Auth, usage | 1; Last seen and usage columns from 3 (internal from 2) |
| Households | "One row per household: stage, size, created, country, plan, last entry, people logging this week, nudges sent." Country is the time zone's country (my call: not the baby's schedule country, which sits beside the baby's name). *My call:* "last entry" is day level ("3 days ago"); a clock time from `events.time` would be exactly A1's "time written on an entry". "People logging this week" is `dir_households.authors_7d`, a count | directory, usage, ledger | 1 |
| Visits | "One row per visit: who, platform, version, start, length, and which screens it touched." Start is the hour only for a visit that logged medicine or a health entry (F5) | `usage_events` | 3 (internal from 2) |
| Usage events | When (their time), Person, Event (monospace name), Details kept ("feature: feed · action: logged"), Platform, Version, Visit. Footer: "Usage events are kept for 90 days, then only the daily totals stay. Deleting an account removes its events too." *My call:* stored events only. The canvas Explorer lists `invite.sent`, which is derived from records and never stored in `usage_events`; derived events (`invite.sent`, `member.joined`, `entry.logged`) are not merged in, and show where they already live (the Households tab and the household page). Times follow F5 | `usage_events` | 3 (internal from 2) |
| Sign-ins | "Every sign-in attempt: method (Google, Apple, email), platform, success or the exact step it failed at." Attempts that never reached an account show as "Not signed in yet" (*my call:* a separate group, never joined to a person, never suggested, never emailed) | `signin.attempted` | 3 (internal from 2) |
| Devices | "Every device a person has used: platform, OS, app version, installed or browser, reminders on, last seen." | `devices` | 3 (internal from 2) |
| Nudges | "Every note, email and push the team sent: to whom, why, by whom, and whether it was seen and acted on." Refused attempts too, with the plain reason | `nudges` | 4 |
| Access log | "Every time anyone on the team opened a household, exported data or deleted something. It cannot be edited." Plus a line showing the chain check: "Chain verified to entry 208" or, in red, where it breaks | `access_log` | 1 |

**CSV export.** Exactly the visible columns of the current tab and filter, all pages. Cells that begin
with `=`, `+`, `-`, `@`, a tab or a carriage return get a leading apostrophe (formula injection).
Served with `Content-Disposition: attachment` and `no-store`. Logged as `export_csv` with the tab, the
row count and **every household in the file** (§9.2 `access_log_hids`), so a family's download shows
that it was in an export. There is no stored file and no link to share.

### 6.4 Record a manual access (my call)

A small form at the foot of the Access log tab: "Record a manual access", with a household, the
person it concerns when it concerns one person, a reason from a short list ("Family asked me to look
at their record", "Data recovery they asked for", "Legal request") and, optionally, a request number
in the fixed shape `R-0001` (`^R-\d{4}$`). **No free text** until F7 is answered: the founder keeps
his own notes outside Cubby and matches them by number. It writes a `manual_access` row with
`target_uid` set whenever it concerns one person, so it reaches only that person's download (§7.5).
This is how the break-glass in §3 stays visible: if the founder ever opens a family's records outside
the dashboard, at their request, the log says so.

---

## 7. What families see

Everything here is customer-facing. DESIGN.md §A1 and §A7 apply: warm, brief, second person,
sentence case, no em-dashes, no guilt. The strings below are the approved canvas copy and are used
**verbatim**. Anything marked "proposed" is not on the canvas: the builder mocks it on a Design canvas
in Cubby's real tokens and gets the founder's yes before building it (standing rule).

### 7.1 The first-run card

Shown once per person, after first sign-in and after any change to what Cubby sees (canvas label:
"Shown once, after first sign-in and after any change").

- Shield icon on a soft indigo square.
- Heading: **"Before you start, here is what Cubby sees"**
- Lead: "Your log stays inside your circle. Our small team can see who you are and how you use Cubby,
  so we can help when something isn't working."
- Card 1, eye icon: **"We see"** / "Your name, email, who's in your circle, and which parts of Cubby
  you use and when."
- Card 2, lock icon: **"We never see what you write"** / "Feeds, doses, notes, photos and anything
  about your pregnancy stay with your circle." (See F4: the admin shows a pregnancy only when her
  circle can see it, and no weeks until F4 is answered; if F4 says weeks, this line is reworded.)
- Card 3, crossed-circle icon: **"We never sell or share it"** / "No ads, no data brokers, no
  tracking companies."
- Primary button: "Got it". Link: "See everything we keep" (opens §7.2).

Behaviour (my calls):

- A constant `PRIVACY_NOTICE` (a date, for example `2026-11-20`) names the current version. "Got it"
  writes `users/{uid}.privacyNoticeSeen = PRIVACY_NOTICE` with a merge, so it follows the person to
  every device rather than showing again on each (the canvas says "shown once"). No rules change is
  needed (§5.0). The app reads the value on the `users/{uid}` read `resolveHousehold` already makes at
  open (`store-firebase.js` 1071), so it costs no extra read.
- **Until the card for the current notice has been seen, no linked event is sent** (G4). With the
  mode on, sign-in events and the first visit would otherwise go out under the new token before the
  card shows, and an existing person's first visit would come before their card. The tracker keeps
  them queued until `privacyNoticeSeen` equals `PRIVACY_NOTICE`, and the server refuses them as well
  (§8.7).
- New people see it after sign-in and before the first-run wizard. A caregiver joining by invite sees
  it after the join, before Home. Existing people see it at their next open after phase 3 ships,
  because that release *is* a change.
- Never shown over the loss holding screen, the sign-in flow or an open sheet. If the person's own
  holding state is active, it waits for an open after it clears.
- Bumping `PRIVACY_NOTICE` is how "If this ever changes, we'll show you before it does" stays true.
  A gate fails if the Privacy screen's copy changes without the constant moving.

### 7.2 Settings, then Privacy

A new row "Privacy" under the existing "Your data & account" section in Settings opens a full screen
(builder's call: a view or a full-height sheet, whichever matches Settings' existing pattern).
Verbatim:

- Back link "Settings". Heading: **"What Cubby sees and keeps"**
- **"What your circle sees"**: "Everything you log, and only the people you invite. Anything you mark
  private stays with you alone."
- **"What our team can see"**, a list:
  - "Your name and email"
  - "Who is in your circle, and their role"
  - "Your stage: trying, pregnant or baby"
  - "Which features you use, how often and for how long"
  - "Your phone or browser, and which version of Cubby"
  - "Whether signing in or saving ran into trouble"
- **"What our team can't see"**: "What you log: amounts, doses, temperatures, notes, photos, mood, and
  anything about a pregnancy loss. If you want help with an entry, you can share that one entry with
  us, and only for 7 days."
- **"What we never do"**, a list:
  - "Sell your data, or show you ads"
  - "Use tracking companies or ad pixels"
  - "Share anything with employers, insurers or data brokers"
  - "Read your log to decide what to sell you"
- **"Why we look"**: "To fix problems before you notice them, and to send a short note if you seem
  stuck. Never more than one note a week, and never during a hard time."
- Rows: "Notes from the Cubby team" with a switch, on by default (§7.3); "Download everything we keep"
  (§7.5); "Read the full privacy policy" (opens `/privacy/`; in the native shell through the system
  browser as other external links do); "Delete my account" in the danger colour (opens the existing
  `openDeleteAccount`).
- Footer: "Last changed 11 Nov 2026. If this ever changes, we'll show you before it does." The date
  is rendered from `PRIVACY_NOTICE`, so it is the date the notice actually changed (my call: never
  hand-typed). *My call:* the verbatim gate (S39) compares this line with the date masked out, since
  the canvas hand-types "11 Nov 2026" and the real date is whatever `PRIVACY_NOTICE` says.
- Proposed, needs a mockup: while a share is active, one more row "Shared with the team: 1 entry, until
  20 Nov" with "Stop sharing".

*My call, on a label collision.* "Download everything we keep" (canvas, verbatim) would sit near the
existing Settings row "Export data · Download everything as a JSON file, yours whenever you want it"
(`index.html` 8314), and both would promise "everything". The canvas row stays as it is. The existing
row's second line, which is not canvas copy, becomes "Your family's log as a JSON file, yours whenever
you want it", so one is plainly the log and the other plainly what the team keeps. The caregiver's
variant at 8318 already names the family record and does not change.

The admin shows a few things this list does not name: time zone, how someone found Cubby, the Pro
waitlist, reminder settings, newsletter status. The privacy policy section (§15.4) names all of them.
F14 asks whether to add one bullet in the app as well.

### 7.3 The notes switch

- "Notes from the Cubby team" writes `users/{uid}.teamNotes = 'on' | 'off'` (merge). Missing means on,
  as the canvas shows the switch on. It is per person, not per household.
- It ships with the Privacy screen in phase 3. No note can be sent before phase 4, so the switch is
  honest from day one.
- The send path reads it fresh at send time (§11.5). Every email note carries a stop link that opens
  a small confirm page and sets it to off without signing in (§11.7). Opening the link alone changes
  nothing.

### 7.4 Share one entry with the team, for 7 days

The only way any content reaches the team. Not drawn on the canvas beyond the copy that promises it,
so the UI is **proposed** and needs a mockup.

- **Where:** a quiet row on an entry's detail sheet in the shared log: proposed "Ask the Cubby team
  about this entry". Confirm sheet, proposed: heading "Share this entry with the Cubby team?", text
  "They'll see this one entry, and only for 7 days. You can stop sharing any time in Settings, then
  Privacy.", buttons "Share it" and "Not now".
- **What can be shared (my call):** one document from `households/{hid}/events`, by any current member
  who can see it. Not her private health, not the pregnancy journal, nothing in the loss path, and
  never photo bytes (the copy drops `photoId` data). Those surfaces have no share row in this build.
- **How:** `POST /api/share-entry {hid, entryId}` with the ID token. The main Worker re-checks
  membership with a fresh masked read (the `pushGate` pattern), refuses a household with `deleteAfter`,
  reads that one event document, strips photo data and `authorId`, and stores a copy in
  `cubby-usage.shared_entries` with `expires_at = now + 7 days`. A copy, not a pointer, so the admin
  never needs to read event contents itself (my call).
- **Stopping:** `POST /api/share-entry/stop {id}` deletes the row at once. The sweep deletes expired
  rows every cron tick, and the admin read path also filters `expires_at > now`, so an unswept row is
  never shown.
- **When the family deletes the source entry (my call):** the copy goes too. On each tick the sweep
  checks that every active share's source event still exists, with the master service account and a
  read masked to the document name only (`mask.fieldPaths=__name__`, so no field of the entry is read
  again), and deletes the copy on a 404. A read *error* is not a 404 (`fsGetStrict` keeps them apart):
  the copy stays until a later tick or its expiry.
- **Who may stop:** the person who shared it, or a guardian of the household (builder's call to
  narrow to the sharer only if the mockup review prefers).

### 7.5 Download everything we keep

- `GET /api/me/kept` with the ID token returns one JSON file, `cubby-what-we-keep.json`, holding
  everything Cubby keeps **about the caller**: account (email, name, sign-in methods, created, last
  sign-in), circle (household and role), usage events from the last 90 days, daily totals, devices,
  notes the team sent them, entries they shared that are still active, and "times the team looked"
  (when, by whom (first name), what). Plus one sentence on what is not in it and why: their family log
  is downloaded from Data, Export data, by a guardian, as today.
- **Which access-log rows (fixes a leak between members).** Only rows that are about the caller:
  - rows whose `target_uid` is the caller;
  - rows with **no** `target_uid` whose `target_hid` is the caller's current household (opening the
    household, viewing a shared entry);
  - rows that list the caller's household in `access_log_hids` (a list or export it appeared in), shown
    as "Your household appeared in a list the team viewed" or "in a file the team exported".

  A row aimed at another member (an `export_request`, an `erase_dry_run` or a `manual_access` about
  them) never appears in a caregiver's file, or in anyone's but that person's. Admin actions that
  concern one person always set `target_uid` (§9.2).
- It is per person and open to every member, caregivers included: it is their own data. It never
  contains another member's events or rows.
- Rate limited (builder's call; five an hour is plenty). Ships in phase 3, because the Privacy screen
  links to it.

### 7.6 A note from the team, inside Cubby (proposed, needs a mockup)

A calm card on Home: "From <first name> at Cubby", the note's text, an optional button to the screen
it suggests (from the fixed list in §11.4), and "Thanks" to dismiss. Never over the loss holding
screen, the first-run flow or an open sheet. Shown until dismissed; showing it fires `nudge.seen`;
"Thanks" writes `teamNote.seenAt` with a merge (no rules change, §5.0). Text is rendered as text, never
as HTML.

*My call, on how the app learns of a note:* there is no listener on `users/{uid}` today, and none is
added. `teamNote` rides the read `resolveHousehold` already makes when the app opens
(`store-firebase.js` 1071), so a note appears at the next open, which matches the composer's "she
sees it next visit".

### 7.7 Copy rules for everything a family reads

No em-dashes; sentence case; second person; warm and brief; no guilt; numbers humanised. Every note,
template and email is held to the same rules, and the send path refuses a body with an em-dash
(§11.5). A gate checks every string in §7.1 and §7.2 against the canvas text exactly.

---

## 8. Instrumentation

### 8.1 One tracker, in the web code

The iPhone and Android apps load the same web code as the website, so one tracker covers all four
ways in; native code only adds what a browser cannot see (canvas). A push to the website updates the
installed app too, so instrumentation ships without an App Store review: the shell already carries
the Capacitor `App` and `FirebaseMessaging` plugins (`app/native-bridge.js`: `App.getInfo` at 262,
`notificationActionPerformed` at 245). `appStateChange` is not listened to yet; adding the listener is
JavaScript only and needs no store review.

- `cubbyTrack(event, details)` in a new `app/cubby-track.js`, loaded by `app/index.html`, added to
  the service worker's precache, with the SW cache bumped (the pre-commit hook guards the bump).
- It adds the envelope (§8.2), checks the event and every detail against the allowlist **before it
  leaves the phone**, and queues it.
- **The allowlist on the phone (my call).** `app/cubby-track.js` cannot import
  `workers/usage/core.mjs`, because `workers/` is not served. A generated copy, `app/usage-allowlist.js`,
  is committed beside it (written by a small `tools/` script from `core.mjs`), and the `tracking-plan`
  gate fails when the two differ.
- It holds events while offline, up to 500 (oldest dropped first), and sends them in batches of at
  most 50. The last batch goes out as the app goes away, with `fetch(..., {keepalive: true})` and the
  ID token header; builder's call on a `sendBeacon` fallback carrying the token in the body.
- *My call:* `pagehide` cannot wait for `getIdToken()`. The tracker caches the last token it was
  given (refreshed on every send and on `onIdTokenChanged`) and uses that for the keepalive batch. A
  token that has expired by then gets a 401 and the batch stays queued for the next open.
- Fire-and-forget: never awaited on a tap, never throws, never shows an error. Telemetry must never
  cost a parent a tap.
- It is silent (sends nothing) when: the server's mode is off (§8.8); the host is not
  `little-cubby.com` (tests use a hook, `window.__cubbyTrackTest`, copied from `cubbyStep`'s
  `window.__cubbyStepTest` at `index.html` 6908); the person's own loss holding is active (§8.5); an
  account deletion is running.
- **It holds linked sends until the notice is seen (G4).** Events recorded under a uid stay queued
  until that person's `privacyNoticeSeen` equals the current `PRIVACY_NOTICE` (§7.1). The queue's 500
  cap still applies; if the card is never seen, nothing linked is ever sent.
- **Each queued event remembers the uid it was recorded under.** A batch is only ever sent with that
  same person's token. On sign-out, or a different person signing in, the other person's queue is
  dropped. One person's events never travel under another's identity (my call).
- Pre-sign-in events (a sign-in attempt, the install prompt) wait in the queue. When sign-in succeeds,
  they go with the new token, once the notice has been seen. If no sign-in happens on that device
  within 24 hours, they are sent without a token and stored with no uid (§8.7).

### 8.2 The envelope

Every event carries who, which household, the platform, the app version and the visit (canvas). Who
and which household are **added by the server**, never trusted from the phone.

```json
{
  "v": 1,
  "tz": "Asia/Dubai",
  "device": "d_k3j9x2m7q1aa",
  "platform": "ios_app",
  "app_version": "v412",
  "native_version": "1.4.0",
  "events": [
    { "id": "6f1c0b8e-0000-4000-8000-000000000001", "t": 1763000000000, "visit": "v_8f2c11aa",
      "name": "feature.used", "props": { "feature": "feed", "action": "logged" } }
  ]
}
```

| Field | Set by | Rule |
|---|---|---|
| `uid` | server | from the verified Firebase ID token only. A body carrying `uid` or `hid` is refused whole (400): it means a client bug |
| `hid`, `role` | server | from the membership cache (§8.7), never from the client |
| `id` (per event) | client | a random v4 uuid, `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`; anything else drops the event. Stored keyed by `(who, id)` (§8.7), so one client cannot claim ids another person will later send |
| `device` | client | random install id, `^d_[a-z0-9]{12}$`, kept in local storage, renewed on sign-out. Not a fingerprint |
| `visit` | client | random per visit, `^v_[a-z0-9]{8}$` |
| `platform` | client | `ios_app`, `android_app`, `home_screen`, `browser`: Capacitor native platform first, then standalone display mode, then browser |
| `app_version` | client | `^v\d{1,5}$`: the number in the `little-log-vNNN` cache of the service worker actually running (builder's call how the page learns it) |
| `native_version` | client | wrapper version from `App.getInfo()` (already read in `native-bridge.js` 262); apps only; `^\d{1,3}(\.\d{1,3}){0,3}$`, anything else is stored as null. The two fields with no format rule before, `id` and this one, were the only envelope fields that could have carried text |
| `tz` | client | IANA name, validated server-side; unknown becomes `UTC` |
| `os`, `browser` | server | coarse, from the user agent header ("iOS 26.1", "Android 15", "Chrome"); the raw user agent is never stored |
| `local_day`, `local_hour` | server | from the event time in `tz`, so a 3am feed counts as 3am in Dubai |
| `t` | client | device time, clamped to between 7 days before and 5 minutes after receipt |

### 8.3 The event catalogue

Every property is a value from a fixed list, a bounded integer, or one of the id or version formats.
**No property can hold free text, so no property can hold content.** "Derived" events are worked out
from records Cubby already keeps; nothing new is collected for them.

| Event | Source | Fires when | Properties | iPhone and Android app | Home-screen app | Browser tab |
|---|---|---|---|---|---|---|
| `visit.started` | new | Cubby comes to the front, from cold or from the background | `opened_from`: icon, notification, link, other; `start`: cold, warm | Capacitor `App` `appStateChange` active, and launch; `appUrlOpen` gives link; a tapped notification gives notification | page becomes visible, or `pageshow` | same as home-screen app |
| `visit.ended` | new | Cubby goes away, or 30 minutes with no interaction | `seconds`: 0 to 86400; `reason`: hidden, idle | `appStateChange` inactive | `visibilitychange` hidden or `pagehide`, sent with keepalive so it survives closing | same |
| `screen.viewed` | new | a tab or sheet opens | `screen`: from the screen list (§8.4) | same web code | same | same |
| `feature.used` | new | a control that does something is used | `feature`: from the feature list; `action`: logged, edited, deleted, shared, opened | same web code | same | same |
| `entry.logged` | derived, already recorded | an entry is saved to the family record | none sent. Type, who wrote it and when come from the masked record read | from the record | from the record | from the record |
| `signin.attempted` | new | each step of signing in | `method`: google, apple, email_link, email_code; `step`: started, provider_returned, verified, signed_in; `outcome`: succeeded, failed, abandoned; `error`: from the error list, or other; `attempt`: 1 to 20; `storage`: app, browser (whether the step ran in the same storage that will use the session, the iPhone home-screen trap) | native Apple and Google sheets | web popup or redirect, the email link or code | same |
| `save.failed` | new | an entry did not reach the server after retries | `error`: from the error list, or other; `retries`: 0 to 50; `offline`: yes, no | same web code | same | same |
| `app.updated` | new | a new version of Cubby starts running | `from_version`, `to_version`: version format | same web code | same | same |
| `push.permission` | new | notification permission is asked, given or taken away | `state`: asked, granted, denied, revoked | `FirebaseMessaging` plugin | Web Push (on iPhone, only in the home-screen app) | Web Push where the browser has it |
| `push.opened` | new | a notification is tapped | `kind`: from the notification-kind list | `FirebaseMessaging` `notificationActionPerformed` | service worker `notificationclick`; the opened page records it from a marker on its URL (builder's call) | same |
| `invite.sent` | derived, already recorded | an invite goes out | `channel`: email, link (from the record) | from the record | from the record | from the record |
| `member.joined` | derived, already recorded | someone joins | `role`: owner, caregiver (from the record) | from the record | from the record | from the record |
| `nudge.sent` | server | the team sends a note | written to the nudge ledger by the send path: id, channel, template, who on the team sent it | not sent by a device | | |
| `nudge.seen` | new | the person sees the note: card shown, push tapped, or the email's link opened | `nudge_id`: `^n_[a-z0-9]{8}$`; `channel`: note, email, push | same web code | same | same |
| `nudge.acted` | derived | the suggested thing happens within 14 days | none sent; worked out per template (§11.6) | | | |
| `install.prompted` | new | Cubby offers to be added to the home screen, and the answer | `outcome`: shown, accepted, dismissed; `prompt`: android_chrome, ios_instructions | not needed | Android Chrome's install prompt; the iPhone instructions sheet | same |

The canvas's Explorer sample shows `signin.failed` and `signin.succeeded`. *My call:* the catalogue
board wins, so it is one event, `signin.attempted`, with `outcome`; the Explorer shows it as
"signin.attempted · failed".

The anonymous counters already in the plan keep running unchanged on `/api/step` and in the Worker:
`onboarding.step_reached`, `invite.sheet_opened`, `pro.sheet_viewed`, `visit.landed`, `account.deleted`.

### 8.4 The vocabularies (builder's call, inside these rules)

The builder writes the final lists in `workers/usage/core.mjs` and the tracking plan, in one commit,
held equal by the gate. Rules:

- **Screens** name places in Cubby: for example home, timeline, log_feed, log_sleep, log_nappy,
  log_pump, log_growth, log_medicine, log_health, log_note, pregnancy_week, kicks, contractions,
  cycle, appointments, vaccines, photos, moments, circle, invite, settings, privacy, reminders, report,
  guide, games, pro.
- **Features** name the tool, never the condition or the value: `medicine`, not a drug name;
  `health_log` for temperature, illness and symptoms together, not "fever". The canvas's table maps
  onto them (Feeds, Reading the timeline, Nappies, Sleep, Medicine and doses, Pregnancy week view,
  Kick counts, Contraction timer, Cycle and observations, Invite someone, Moments and photos, Doctor
  report, Voice logging, Reminders to calendar).
- **Never instrumented** (no screen name, no feature name, no event): her private health ("How you
  are, in yourself", blood pressure, mood), the loss holding screen, the kept-after-loss archive, and
  anything owner-private. The gate rejects any screen or feature matching
  `loss|mood|mhealth|wellbeing|bp|blood|archive|private`.
- **Error lists** are short fixed lists mapped from Firebase and network codes (for sign-in, for
  example popup_closed, popup_blocked, network, no_session, invalid_link, expired_code, wrong_code,
  too_many, cancelled; for saving, permission_denied, unavailable, deadline, quota, too_large), with
  `other` for anything unmapped. Never the error's message text.
- **Notification kinds**: for example medicine, feed, sleep, appointment, vaccine, feature,
  marketing, team_note, other.
- **Record kinds (my call, fixed here).** The admin folds each record `type` to a coarse kind before
  anything is stored, and stores kinds only as 7-day counts per household, never per day:
  `feed` → feed; `sleep` → sleep; `diaper` → nappy; `pump` → pump; `growth` → growth;
  `medicine` → medicine; `temperature`, `symptom`, `visit` → health_log; `vaccine` → vaccines;
  `milestone`, `activity` → moments; anything else → other. The raw type never reaches D1.
- **Pregnancy and trying tools, `JOURNEY_KEYS` (my call; A9).** The screens and features that exist
  only on the pregnancy or trying path (pregnancy_week, kicks, contractions, cycle, and any other the
  builder adds there) are listed once in `core.mjs`. For them:
  - raw `usage_events` are kept **30 days**, not 90;
  - `usage_daily` never holds a per-person or per-household row for them, only aggregate rows (`uid` and
    `hid` empty) per day, platform and key, so no per-person history of a pregnancy exists past 30 days;
  - per-person views (the household page, Visits, Usage events) show them only while that household's
    stage shows a shared, current journey (§5.1). After a journey ends or if it is private, they are
    hidden there, and only the overview's aggregate counts them.

### 8.5 Nothing that carries content, enforced four times

1. **The plan:** every property in `.telemetry/tracking-plan.yaml` declares an `enum`, a bounded
   integer, or one of three formats (version, nudge id, the yes or no flag). Free strings are not
   expressible.
2. **The phone:** the tracker checks the same allowlist (generated from `core.mjs`) and drops anything
   else before it is queued.
3. **The server:** `/api/usage` validates every event again and drops anything not allowlisted. A
   dropped event's content is never stored; only a count by reason goes to `usage_refused`.
4. **The gate:** `tools/tracking_plan_check.js` fails on any property name that could hold what
   someone logged (§14), and on any plan property without an enum or bound.

Plus two rules that are about kindness as much as data:

- **No loss event.** Unchanged from today's plan, and the gate keeps enforcing it for the new events.
- **Silence in the holding screen.** While a person's own loss holding is active (the app's
  `myLossHolding()`), `cubbyTrack` is a no-op for that person: no visits, no screens. Nothing that
  could become a loss signal is created (my call).

### 8.6 Platform notes (canvas, with the details)

- **iPhone app:** a push to the website updates the installed app too, so instrumentation ships
  without an App Store review.
- **Home-screen app on iPhone:** it keeps its own storage, apart from Safari, so one person can look
  like two devices. Visits join up by account once they sign in.
- **Visits:** the apps use the native "came to the front" and "went away" signals; the web uses the
  page becoming visible or hidden. A visit also ends after 30 minutes idle (no input while visible);
  the next interaction starts a new one with `opened_from: other`, `start: warm`.
- **Time zones:** every event stores the family's local hour, so a 3am feed counts as 3am in Dubai.
- **App Store privacy answers:** usage data becomes "linked to you, used for app functionality and
  analytics". The submission package must change before review (§15.1).

### 8.7 Ingestion: `POST /api/usage` on the main Worker

- Same-origin only (the app and the native shell both load from `https://little-cubby.com`), the
  `recordStep` pattern. Body at most 32 KB and 50 events.
- `Authorization: Bearer <Firebase ID token>`, verified with the existing `verifyFirebaseToken`.
- **Without a token**, only `signin.attempted`, `install.prompted`, `app.updated`, `visit.started`,
  `visit.ended` and `screen.viewed` (for the sign-in screen) are accepted, stored with no uid, per-IP
  limited, under their own ceiling, and kept 30 days (my call).
- **Membership stamping (my call):** the server keeps `membership(uid, hid, role, notice, checked_at)`
  in `cubby-usage`. When a uid has no row or a row older than 6 hours, it does one fresh masked read of
  `users/{uid}` (`householdId`, a claim, and `privacyNoticeSeen`, in the same read) and confirms the
  household against `households/{hid}.members[uid]` (the `_isCarer` rule, `fsGetStrict` so a 404 and an
  error stay apart). Two Firestore reads per person per 6 hours at most. Until confirmed, `hid` is
  null, and the next confirmation backfills that person's null rows from the last 24 hours.
- **The notice, checked on the server too (G4).** A linked event from a uid whose cached `notice` is
  not the current `PRIVACY_NOTICE` is refused and counted as `notice`. A stale cache is re-read at most
  once every 10 minutes for that uid, so a person who has just tapped "Got it" is measured from their
  next batch, not 6 hours later. The check applies in mode `on`; in `internal` (phase 2, before the
  card exists) only the founder's own accounts are stored, and he is the one who decided.
- Each event: validated; `INSERT OR IGNORE` keyed by `(who, id)`, where `who` is the uid, or
  `anon_<device>` before sign-in (my call), so retries never double-count and one client cannot claim
  ids that another person will later send; refused events counted in `usage_refused(day, reason)`.
- **Log lines (S15):** `/api/usage`, `/api/share-entry`, `/api/me/kept` and `/api/notes/stop` log
  codes and ray ids only, never a uid, an email, a name or a body.
- Limits: `USAGE_RATE_LIMITER` per uid (120 a minute, namespace 1007), a per-IP limit for anonymous
  batches, and
  `USAGE_DAILY_CAP` across everyone. Past the ceiling, events are accepted and not stored, and the
  isolate remembers the full day so D1 is not touched again (the `recordStep` pattern). A D1 error is
  caught: telemetry never fails a request.
- Answer: `200 {"mode": "on", "accepted": 12, "refused": 0}`; 400 bad shape; 401 bad token; 403 bad
  origin; 413 too large; 429 limited.
- **D1 write allowance:** each event is one row plus one per index (§9). The founder's step 1 confirms
  the account's D1 allowance; the builder sizes `USAGE_DAILY_CAP` so usage plus every other D1 writer
  stays under half of it.

### 8.8 The switch: `USAGE_MODE`

A `[vars]` value in `wrangler.toml`, so every change is a reviewed commit (my call).

- `off` (default): the endpoint stores nothing and answers `{"mode": "off"}`. The tracker asks once a
  day with an empty batch and otherwise sends nothing.
- `internal`: stored only for uids in `INTERNAL_UIDS`; everyone else gets `{"mode": "off"}`. This is
  how the founder proves the whole pipeline on his own accounts before any family is measured.
- `on`: everyone. Flipped only as the last step of phase 3, after the screens, the policy and the
  store answers are live (§17). This is what makes anti-goal A6 impossible by construction.

---

## 9. D1 schemas

`schema/usage.sql` and `schema/admin.sql` (the `schema` folder is already fenced from the public
site). Column names are builder's call where marked; the shape and the rules are not.

### 9.1 `cubby-usage`

```sql
-- One row per accepted event. Raw rows live 90 days (30 when uid is NULL, 30 for JOURNEY_KEYS).
CREATE TABLE IF NOT EXISTS usage_events (
  who            TEXT NOT NULL,      -- uid, or 'anon_' || device before sign-in
  id             TEXT NOT NULL,      -- client v4 uuid, validated; INSERT OR IGNORE makes retries harmless
  at             INTEGER NOT NULL,   -- server receive time, ms UTC
  client_at      INTEGER NOT NULL,   -- device time, clamped
  local_day      TEXT NOT NULL,      -- YYYY-MM-DD in the person's time zone
  local_hour     INTEGER NOT NULL,   -- 0 to 23 in the person's time zone
  tz             TEXT NOT NULL,
  uid            TEXT,               -- from the verified token; NULL only before sign-in
  hid            TEXT,               -- stamped from the membership cache; never from the client
  role           TEXT,               -- owner | caregiver
  device         TEXT NOT NULL,
  visit          TEXT NOT NULL,
  platform       TEXT NOT NULL CHECK (platform IN ('ios_app','android_app','home_screen','browser')),
  os             TEXT NOT NULL,      -- coarse, server-derived
  browser        TEXT NOT NULL,      -- coarse, server-derived
  app_version    TEXT NOT NULL,
  native_version TEXT,
  name           TEXT NOT NULL,      -- from the allowlist
  props          TEXT NOT NULL,      -- canonical JSON, sorted keys, allowlisted keys and values only
  PRIMARY KEY (who, id)
);
CREATE INDEX IF NOT EXISTS ue_uid_at ON usage_events(uid, at);
CREATE INDEX IF NOT EXISTS ue_hid_at ON usage_events(hid, at);
CREATE INDEX IF NOT EXISTS ue_at     ON usage_events(at);

-- Daily totals, per person, platform and day. Kept until the account is deleted.
-- JOURNEY_KEYS (8.4) are stored here only as aggregate rows: uid = '' and hid = '' (kept 13 months).
CREATE TABLE IF NOT EXISTS usage_daily (
  local_day TEXT NOT NULL,
  uid       TEXT NOT NULL,
  hid       TEXT NOT NULL DEFAULT '',
  platform  TEXT NOT NULL,
  metric    TEXT NOT NULL CHECK (metric IN ('visits','seconds','screen','feature','signin_failed','save_failed')),
  key       TEXT NOT NULL DEFAULT '',   -- screen or feature name for those metrics
  n         INTEGER NOT NULL,
  PRIMARY KEY (local_day, uid, platform, metric, key)
);
CREATE INDEX IF NOT EXISTS ud_uid     ON usage_daily(uid);
CREATE INDEX IF NOT EXISTS ud_hid_day ON usage_daily(hid, local_day);

CREATE TABLE IF NOT EXISTS devices (
  device TEXT PRIMARY KEY, uid TEXT, platform TEXT NOT NULL, os TEXT NOT NULL, browser TEXT NOT NULL,
  app_version TEXT NOT NULL, native_version TEXT, push TEXT,
  first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dev_uid ON devices(uid);

CREATE TABLE IF NOT EXISTS membership (
  uid TEXT PRIMARY KEY, hid TEXT, role TEXT,
  notice TEXT,                          -- the person's privacyNoticeSeen at the last read (8.7)
  checked_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS nudges (
  id          TEXT PRIMARY KEY,                 -- n_ + 8 random
  hid         TEXT NOT NULL,
  uid         TEXT NOT NULL,                    -- the member it went to
  channel     TEXT NOT NULL CHECK (channel IN ('note','email','push')),
  template    TEXT NOT NULL,                    -- from the template list, or 'own'
  signal      TEXT,                             -- the "who to help" rule that suggested it, or NULL
  body        TEXT NOT NULL,                    -- the words the team sent
  link        TEXT,                             -- a screen from the fixed list, never a token
  sent_by     TEXT NOT NULL,                    -- the sender's first name
  state       TEXT NOT NULL CHECK (state IN ('sent','refused','failed')),
  refused_why TEXT,                             -- fixed vocabulary (11.5)
  at          INTEGER NOT NULL,
  seen_at     INTEGER,
  acted_at    INTEGER
);
CREATE INDEX IF NOT EXISTS nudge_hid_at ON nudges(hid, at);
CREATE INDEX IF NOT EXISTS nudge_uid    ON nudges(uid);

CREATE TABLE IF NOT EXISTS shared_entries (
  id TEXT PRIMARY KEY, hid TEXT NOT NULL, shared_by TEXT NOT NULL, entry_id TEXT NOT NULL,
  entry TEXT NOT NULL,                  -- JSON copy of the one entry, photo data and authorId removed
  at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS se_hid ON shared_entries(hid, expires_at);
CREATE INDEX IF NOT EXISTS se_by  ON shared_entries(shared_by);

CREATE TABLE IF NOT EXISTS usage_refused (day TEXT NOT NULL, reason TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, reason));
CREATE TABLE IF NOT EXISTS usage_meta    (key TEXT PRIMARY KEY, value TEXT, at INTEGER);  -- ceilings, cursors
```

Builder's call: drop `ue_hid_at` if the write allowance is tight, and erase by uid via `membership`
instead. Keep the rule that erasing a household removes its events.

### 9.2 `cubby-admin`

```sql
-- Append-only. No UPDATE or DELETE exists anywhere in code. Each row chains to the one before.
CREATE TABLE IF NOT EXISTS access_log (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  at         INTEGER NOT NULL,
  actor      TEXT NOT NULL,     -- first name from ADMIN_PEOPLE ('unknown' for a refused request)
  actor_id   TEXT NOT NULL,     -- first 16 hex of sha256(lowercased address); never the address
  action     TEXT NOT NULL,     -- fixed list below
  target_hid TEXT,
  target_uid TEXT,              -- set whenever the action concerns one person (7.5)
  detail     TEXT NOT NULL DEFAULT '{}',  -- fixed keys and fixed-vocabulary values only: tab, filter names,
                                          -- row count, outcome, reason code, request number (^R-\d{4}$)
  country    TEXT,              -- cf-ipcountry; never the IP
  ray        TEXT,
  prev_hash  TEXT NOT NULL,
  hash       TEXT NOT NULL      -- sha256(prev_hash + canonical JSON of this row's other columns
                                --        + the sorted hids this row lists in access_log_hids)
);
CREATE INDEX IF NOT EXISTS al_hid ON access_log(target_hid, at);
CREATE INDEX IF NOT EXISTS al_uid ON access_log(target_uid, at);

-- The households a list view or an export showed (view_overview's "Who to help next" rows,
-- view_records' page, every household in export_csv). Written in the same batch as its row.
CREATE TABLE IF NOT EXISTS access_log_hids (
  seq INTEGER NOT NULL, hid TEXT NOT NULL, PRIMARY KEY (seq, hid)
);
CREATE INDEX IF NOT EXISTS alh_hid ON access_log_hids(hid);

-- Directory cache: CURRENT state only. No history, so no "was pregnant last week" can exist.
CREATE TABLE IF NOT EXISTS dir_households (
  hid TEXT PRIMARY KEY, display_no INTEGER UNIQUE NOT NULL, owner_uid TEXT, owner_first_name TEXT,
  stage TEXT, stage_detail TEXT,          -- by the 5.1 rule: 'Baby · 2 months', 'Pregnant'; no weeks until F4
  created_at INTEGER, plan TEXT, waitlisted INTEGER, deletion_pending INTEGER, invited_json TEXT,
  last_entry_day TEXT,                    -- YYYY-MM-DD, day level only
  authors_7d INTEGER, kinds_7d TEXT,      -- distinct authors, and coarse kind counts (8.4), last 7 days
  is_internal INTEGER NOT NULL DEFAULT 0, refreshed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS dir_people (
  uid TEXT PRIMARY KEY, hid TEXT, name TEXT, email TEXT, email_verified INTEGER, relationship TEXT,
  role TEXT, joined_at INTEGER, joined_source TEXT,   -- 'member_info' | 'household_created' | NULL
  signed_up_at INTEGER, providers TEXT,               -- 'google' | 'apple' | 'email', comma-separated
  acq_source TEXT, acq_content TEXT, referred INTEGER, push_on INTEGER, quiet TEXT, tz TEXT,
  team_notes TEXT,
  -- Per-person activity: written only from phase 3 (17), NULL before.
  last_sign_in INTEGER, last_refresh INTEGER, entries_7d INTEGER,
  is_internal INTEGER NOT NULL DEFAULT 0, refreshed_at INTEGER NOT NULL
);
-- Per household per day, for the ranges and the wedge. No uid, no type, no time. Kept 90 days.
CREATE TABLE IF NOT EXISTS dir_household_days (
  day TEXT NOT NULL, hid TEXT NOT NULL, entries INTEGER NOT NULL, authors INTEGER NOT NULL,
  PRIMARY KEY (day, hid)
);
CREATE TABLE IF NOT EXISTS admin_meta (key TEXT PRIMARY KEY, value TEXT, at INTEGER);
-- keys: refresh cursors, the read meter, display_no_next (the high-water mark), certs cache
```

*My call, replacing `dir_entries_daily`:* the first draft stored raw record types per named person per
day, which reads as "Maya's baby had a temperature on 12 Nov" and was a per-person history with no
retention. Now the per-day table has no person and no type, kinds are coarse and only a 7-day count,
and per-person entries are one current number.

Display numbers are never reused: `display_no_next` in `admin_meta` only ever grows. When a household
goes, all its directory rows go with it, including its number; no tombstone keeps its id.

**Access-log actions (fixed list):** `view_overview` (hids of the "Who to help next" rows),
`view_household`, `view_records` (detail: tab; hids of the page), `view_shared_entry`, `export_csv`
(tab, rows; every hid in the file), `export_request` (rows; always a `target_uid`), `nudge_intent`,
`nudge_outcome` (channel, template, outcome), `erase_dry_run`, `erase_intent`, `erase_outcome` (each
with a `target_uid`), `manual_access` (reason code, request number; `target_uid` when it concerns one
person), `denied` (reason code). Search text, names and free text are never written (§13 S18; F7).

**Writing a row (builder's call on the mechanics, my call on the rule):** read the last `(seq, hash)`,
compute the new hash, insert guarded so it only lands if the last `seq` is still the one read; retry up
to five times. The chain must never fork. A verifier walks it from the first row.

---

## 10. Retention and erasure

| Data | Kept | Removed by |
|---|---|---|
| `usage_events` with a uid | 90 days | daily retention run (main cron), in chunks |
| `usage_events` with no uid, and every `JOURNEY_KEYS` event | 30 days | the same run |
| `usage_daily` per-person rows, `devices`, `membership` | until the account is deleted | account purge; household purge; weekly orphan sweep |
| `usage_daily` aggregate rows (`uid` empty) | 13 months | daily run |
| `nudges` | until the account is deleted | same |
| `shared_entries` | 7 days at most; less if stopped, or if the family deletes the source entry | every cron tick; stop deletes at once; the read path ignores expired rows |
| `usage_refused` | 90 days | daily run |
| `dir_people` | current state; a person Auth no longer has is gone on the next 15-minute tick | the Auth check at the start of every tick (§4.7), whatever the read budget |
| `dir_households`, `dir_household_days` | current state; day rows 90 days; a household with no remaining member, or gone from Firestore, loses every row | the Auth check, the 15-minute and daily refresh, and the admin's own delete after an erasure (§12) |
| `feedback/{id}` (Firestore, today kept forever) | until the account is deleted | *my call:* `/api/account/purge` and `eraseAccount` delete the caller's `feedback` documents (query on `uid`, master service account). They hold the person's email, name and a raw user agent, and families wrote them to the team, so they go with the account |
| `access_log`, `access_log_hids` | 24 months (lawyer list) | a yearly job deletes rows older than 24 months and starts the chain from a recorded checkpoint (builder's call how; the checkpoint hash goes in the digest) |

**Account deletion (phase 2, before any event exists in production):**

- `purgeAccountData` (`/api/account/purge`, already called by `deleteAccount` in
  `app/store-firebase.js`) also deletes the caller's rows from `usage_events`, `usage_daily`,
  `devices`, `membership`, `nudges`, and `shared_entries` they shared, and their `feedback`
  documents. The uid comes from the verified token, as it does today. It keeps deleting the `GAMES_DB`
  `hubs`, `hub_games` and `hub_guesses` rows it deletes today.
- `purgeDeletedHouseholds` also deletes `usage_events`, `usage_daily`, `nudges` and `shared_entries`
  for that `hid`, after the household document is gone (and keeps counting `account.deleted` as now).
- **The backstop:** the app's purge call is best-effort (a network drop skips it). So a weekly orphan
  sweep in the main cron takes the distinct uids in the usage tables, asks Auth (`accounts:lookup`, 100
  at a time, master service account) which still exist, and deletes every row for the ones that do
  not. Builder's trap: a lookup *failure* must never read as "does not exist".
- The admin directory loses the person on the next 15-minute tick, through the Auth check, not the
  Firestore read (leaving a household stamps no `updatedAt`, and the read budget can pause the daily
  pass). The `dir_*` rows are rebuilt from the live records, but the gate still checks they go.
- The access log keeps its rows (it records what the team did, and holds only opaque ids, a first name
  and fixed codes). Lawyer list.

---

## 11. Nudges

### 11.1 Who to help next (the rules, my call on thresholds)

| Signal | Rule | Suggested (canvas) | Default channel |
|---|---|---|---|
| Signed up, no first entry | household created 48 hours or more ago, no entry in the shared record | "a short note showing the one-tap feed button" | note |
| Only one person logging | 2 or more members, or a pending invite or link, and `authors_7d` is 1 (a household count, no person stored), household 14 days old or more | "resend the invite, or offer a link for the nanny" (to the owner, §11.2) | note |
| Daily use, then quiet | visits on 5 of 7 days, then none for 6 days | "a gentle check-in, no pressure" | note |
| Sign-in trouble | 3 or more failed `signin.attempted` **linked to a person** on their local day | "a personal message offering help to sign in" | email (they may not be able to open the app) |
| Birth recorded, still on the pregnancy view | birth recorded 3 days ago or more, pregnancy week still the most viewed screen since, no baby logging. Only while her journey is shared (§5.1), and only ever suggested to her, the carrier | "help switching to baby logging, when she is ready" | note |

*My call, on sign-in trouble.* The rule only sees attempts that were later linked to an account.
Attempts that never reached one (no sign-in within 24 hours, §8.1) are shown in the Sign-ins tab as
"Not signed in yet", are never joined to a person, and are never suggested or emailed: there is no
verified address to write to, and guessing one would be contacting a stranger.

Order: sign-in trouble first (that one is our failure), then by how recent. At most 10 rows.
Each row says why in one plain sentence. Builder's call to tune numbers; any new signal is a plain rule,
written down here, not a score.

### 11.2 Who is never suggested and never sent to

- **Held:** any household in the pregnancy loss path (the hold reader, §5.1, which fails closed) and
  any household with deletion pending. *My call:* the whole household is held, not only the person,
  because a note to her partner about inviting the nanny that week is just as wrong. F3 asks whether a
  hold should continue for some time after she leaves the holding screen.
- **A note never carries her pregnancy to anyone else (my call; A11).** A template or a suggestion
  that names or hints at a pregnancy goes only to the carrier, and only while her journey is shared.
  The composer refuses a body with pregnancy words (pregnant, pregnancy, due, weeks, bump, baby on the
  way; builder's list) to anyone but her.
- Anyone whose `teamNotes` is off.
- Any household that had a sent note in the last 7 days. *My call:* per household, which satisfies both
  "Saved on this household so nobody is nudged twice in 7 days" and "Never more than one note a week".
- **Anyone who has not joined.** *My call:* notes go only to members. The canvas sample shows "29 Oct ·
  Email to Arjun · Invite resent", an email to an invitee. This spec does not do that: Arjun never
  agreed to hear from Cubby, so the note goes to Maya, who resends it herself. F9.
- Internal accounts appear only when "Hide our own accounts" is off, so the founder can test on himself.

### 11.3 The composer (canvas)

Heading "Draft a nudge for Maya". "Send it as": "A note inside Cubby (she sees it next visit)",
"Email", "Push notification (counts toward her monthly limit)". "Start from": the templates. "Message":
an editable text area. Footer: "Sent from Cubby, signed with your first name. Saved on this household
so nobody is nudged twice in 7 days." Buttons "Cancel" and "Send to Maya". The canvas sample message,
in voice:

> Hi Maya, Arjun's invite to your circle is still waiting. If it got lost, you can send him this link
> instead, and he'll see every feed the moment you log it.

Here "this link" opens Maya's own invite sheet in Cubby (§11.4); it is not an invite link the team made.

### 11.4 Templates and links

Starting templates (wording is builder's call within §7.7, shown to the founder in the phase 4
mockup): resend the invite (to the owner), offer a link for the nanny, a gentle check-in, the one-tap
feed button, help to sign in (email only), switching to baby logging, write my own.

Links come from a fixed list of in-app screens: invite sheet, quick log, reminders, sign-in help,
pregnancy-to-baby switch, Privacy. **A note never carries an invite token, a sign-in link or any
credential, and the team never creates an invite into a family's household** (my call: an invite
created by the team would be a new way into a family).

### 11.5 The send path: `AdminWrites.sendNudge`

Called by the admin with `{hid, uid, channel, template, body, link, signal, actor}`. It checks, in
this order, with fresh reads, and stops at the first refusal:

1. The target is a current member of `hid` (masked `members`, `fsGetStrict`), and not an invitee.
2. Not held: the hold reader returns false (it fails closed, §5.1) and `deleteAfter` is absent.
3. `users/{uid}.teamNotes` is not `off`.
4. No sent note for this household in the last 7 days (`nudges`).
5. The body is 1 to 600 characters, contains no em-dash, and does not sell: no Pro, price, plan,
   subscribe, upgrade, discount, offer, trial or currency words (builder's call on the exact list, my
   call that the check exists). Notes from the team never sell. A body with pregnancy words goes only
   to the carrier, while her journey is shared (§11.2).
6. The link is from the fixed list.
7. Channel rules, from the push fields in §5.0. **Push:** `push.enabled`, a token,
   `push.allow.feature` true (missing consent means no), a known `push.tz` (with none, the send waits),
   not inside their quiet hours, under the monthly `feature` cap in `pushLedger` (`PUSH_CAP`,
   `{marketing: 2, feature: 5}` per calendar month in their own time zone), with the cap consumed only
   after a real FCM delivery, exactly as `deliverCampaign` does (`worker.js` 1394-1600). **Email:** the
   address is verified in Auth; not inside their quiet hours, or between 9pm and 8am their time when
   they have none (my call). **Note:** none beyond the above.

Then it sends, writes the `nudges` row (`sent`, `refused` with a reason, or `failed`), and returns.
The admin writes `nudge_outcome` to the access log.

Refusals the founder sees (fixed wording, my call):

| Reason | Shown |
|---|---|
| notes off | "Notes are off for Maya." |
| spacing | "This household had a note on 29 Oct. The next one can go on 5 Nov." |
| **held or deletion pending** | "Not sent. Cubby is holding notes for this family right now." (identical for both, so the words never point at a loss) |
| quiet hours | "It is 2:10am for Maya. Try again after 7am her time." |
| no time zone | "We don't know Maya's local time yet, so this waits. Try a note inside Cubby instead." |
| push off or no consent | "Push is off for Maya." |
| pregnancy words to someone else | "This mentions a pregnancy, so it can only go to the person who shared it." |
| cap | "Maya has had 5 of 5 feature notifications this month." |
| sells | "This reads like selling. Notes from the team never sell." |
| not a member | "Arjun has not joined Cubby, so the team does not contact him." |

### 11.6 Seen and acted

`seen`: the card was shown (`nudge.seen` from the app), the push was tapped, or the email's link was
opened in Cubby (the nudge id rides in the URL fragment, and the app records `nudge.seen` once it has
loaded, so a mail scanner's or link prefetcher's GET marks nothing; there is no pixel). `acted`, worked out by the admin, within 14
days: invite templates, a member joined; first-entry template, a first entry; sign-in help, a successful
sign-in; switch template, baby logging began; check-in, any visit within 7 days.

### 11.7 Email notes

From `MAIL_FROM` through the existing Resend key, reply-to `support@little-cubby.com` (a role address,
never the founder's), signed with the sender's first name. Plain words, simple HTML, **no tracking
pixel and no click-tracking redirect** (my call: either would be a tracker). Every email ends with a
"Stop notes from the Cubby team" link. Fixed after the builder's check, because a GET that changes
state is switched by mail scanners and link prefetchers, and a token in the query string lands in
request logs:

- **The link** is `https://little-cubby.com/notes-stop/#t=<token>`. The token rides in the fragment,
  which no browser sends to any server, so it never reaches a request log.
- **The page** `/notes-stop/` is a small static page (proposed copy, needs a mockup; F17): "Stop notes
  from the Cubby team?" with one button. Loading it changes nothing. It is `noindex`, and the
  pre-commit SEO check is told it is a utility page.
- **The button** sends `POST /api/notes/stop {t}` (same-origin, JSON). That is the only thing that
  sets `teamNotes` to off, and the page then says so in one plain line, with how to switch notes back
  on in Settings, then Privacy.
- **The token** copies `doseTicketKey` (`worker.js` 2300-2345): HKDF over the service account's
  `private_key` with a new info string (`cubby-notes-stop-v1`), shaped `v1.<body>.<sig>`, checked
  with a constant-time compare. No new secret.
- **No expiry (my call).** The body holds the uid and a key version, not an expiry: stopping notes is
  harmless to the person, so a link in an old email keeps working. If the key ever changes (a new
  service-account key), an old link fails verification and the page explains how to switch notes off
  in Settings, then Privacy, instead of showing an error.
- **The write** is a Firestore `documents:commit` with `updateMask` `teamNotes` and
  `currentDocument: {exists: true}` **in the commit body**, never the query string (the trap
  catalogue). A deleted person's `users` document is therefore never recreated by a stop link.

### 11.8 Push notes and in-app notes

Push: FCM with the existing token map, title "Cubby", the body, data `{tag: "nudge-<id>", cat:
"feature", url: <deep link>}`. In-app: `users/{uid}.teamNote = {id, body, from, link, at}`, written
with `documents:commit`, an `updateMask` of `teamNote` only, so nothing else in the document is
touched, and `currentDocument: {exists: true}` in the commit body. Without that precondition a commit
update *creates* `users/{uid}`, which would bring back a person deleted between the check and the
write; with it, the write fails and the outcome is `failed`. Every client write to `users/{uid}`
already uses a merge (§5.0); a gate keeps it that way, so a client save can never wipe the team
fields.

---

## 12. Data requests and erasure from the dashboard (phase 5)

What families can do today, which this section must not widen (§5.0): taking a copy is each person's
right and never waits for anyone, but the family-log export is guardian-only; deleting the shared
record asks both guardians; account deletion is each person's own act.

**Export everything for a data request.** For one person: the same content as §7.5, plus the
directory fields the dashboard shows about them. A household request makes one file per person, each
sent only to that person (F6; built that way until it is answered). **Never the family log.** The
export says, in one line, that the family downloads its own log from Data, Export data, so the team
never handles its contents (my call). Logged as `export_request` with counts and the person's
`target_uid`. F8 covers someone who cannot use the app, and how a requester's identity is checked.

**Delete one person's account, on their own request.** (Deleting a household waits for F1. As first
drafted, `eraseHousehold` deleted every member's account on one person's word, which contradicts
per-person deletion and the two-guardian rule. Until F1 is answered it is not built, and whatever it
becomes, it never deletes the account of anyone who did not ask.)

1. **Dry run:** what would go, as counts (entries they wrote stay with the family, as in the app;
   their usage rows, shares, notes, feedback), and who inherits ownership if they leave a shared
   household. Writes nothing except `erase_dry_run`.
2. **Confirm:** the founder types the household's name as shown ("Household 12"), picks a reason code
   and, optionally, a request number (`R-0001`; no free text, F7). `erase_intent` is logged with the
   person's `target_uid`.
3. **`AdminWrites.eraseAccount`:** the server-side twin of the in-app `deleteAccount`
   (`store-firebase.js` 2722-2860), in the same order:
   1. private records first: `mhealth/{uid}/cat`, `pregnancy/{uid}` and its photos, `memberEmails/{uid}`,
      and her own private notes (`audience == uid` and `createdBy == uid`);
   2. leave the household: `pickHeir`, `formerMemberInfo`, and, for the last one out, `deleteAfter` 30
      days ahead and withdrawing `pendingInvites` and `pendingLinks`;
   3. `invites/{email}`, `waitlist/{uid}`, `users/{uid}`, and the person's `feedback` documents;
   4. the `/api/account/purge` work: `USAGE_DB` rows (§10) and the `GAMES_DB` `hubs`, `hub_games` and
      `hub_guesses` rows `purgeAccountData` deletes today;
   5. the `NEWSLETTER_DB` row whose `email_hash` is the hash of their verified email (it holds the
      email and a stage);
   6. the Auth account, last.

   Photo bytes are data URLs inside Firestore, so these deletes cover them; there is no Storage
   bucket to forget. When the household empties, it goes through the existing
   `purgeDeletedHouseholds` after its 30 days (`HH_SUBCOLLECTIONS`, `HH_NESTED`), the same grace the
   policy already promises (my call: the grace protects against the wrong household).
4. **Then the admin deletes its own rows.** The main Worker cannot write `ADMIN_DB`, so after
   `erase_outcome` the admin deletes the person's `dir_people` row, and their household's `dir_*` rows
   if it emptied. (The Auth check would remove them on the next tick anyway; this makes it immediate.)
   The access log keeps its rows (§10).
5. Every step re-checks its premise; a partial failure stops and leaves the rest for a retry, the
   purge's own rule; `erase_outcome` is logged with what finished.
6. During the 30 days an emptied household shows "Deletion pending, erased on 13 Dec", and it is held
   for notes.

This is proven against the Firestore emulator **and** the Auth emulator (the trap catalogue: a REST
write that passed a stub has erased the wrong thing before).

---

## 13. Security and privacy requirements, as testable statements

Each one has a gate in §14 that can be watched going red.

**Access**
- **S1.** Every admin response, on every path and status, is produced only after a valid Access JWT
  is verified by the Worker. Without one: 403, no family data, one throttled `denied` row.
- **S2.** A JWT is valid only with an RS256 signature from the team's certs, `aud` containing
  `ACCESS_AUD`, `iss` equal to the team domain, live `exp`, `iat` and `nbf` not in the future (60s
  skew), and an `email` that, lowercased, equals the one `ADMIN_PEOPLE` address. Service tokens and
  other algorithms are refused.
- **S3.** A missing or malformed `ACCESS_AUD`, `ACCESS_TEAM_DOMAIN`, `ADMIN_PEOPLE` or
  `FIREBASE_READER_SA` gives 503 on every request.
- **S4.** `ADMIN_PEOPLE` with other than exactly one entry gives 503 on every request.
- **S5.** `workers_dev = false`, `preview_urls = false`; a request whose `Host` is not
  `admin.little-cubby.com` gives 403.
- **S6.** Static files (script, styles, fonts) are covered by S1.
- **S7.** Every state change is a POST with `Origin: https://admin.little-cubby.com` and a JSON body;
  anything else gives 403.

**Headers**
- **S8.** Every response, error responses included, carries the headers in §4.8; HTML carries the
  robots meta; no response carries CORS headers.
- **S9.** An admin page makes no request to any origin other than the admin host.

**No contents**
- **S10.** The admin reaches Firestore only through the masked reader; every request carries a mask
  from §5.1; any other path or field throws before a request is made.
- **S11.** No admin response, D1 row or log line contains any entry value, an entry's own time, a
  record type tied to a day, baby name, invitee address, invite-link token, push token, due-reminder
  text, or anything from `mhealth`, notes, photos, the pregnancy journal or the loss archive.
- **S12.** `lossHolding` appears in exactly one admin function and one `AdminWrites` function, each
  returning a boolean that is never stored, logged or rendered, and each **failing closed**: a read
  error, a 404, a missing field, a moved field or an unknown shape returns held.
- **S13.** No stage history is stored: `dir_households` holds current state only; `JOURNEY_KEYS` are
  kept per person only as raw events for 30 days and never in per-person totals.
- **S14.** Every user-controlled string is rendered as text; a hostile name renders inert under the
  CSP; CSV cells are formula-safe.
- **S15.** Admin, `AdminWrites` and the new main-Worker routes (`/api/usage`, `/api/share-entry`,
  `/api/me/kept`, `/api/notes/stop`) log codes and ray ids only: no uids, names, emails or content.
- **S41.** A pregnancy's stage is shown only when its `sharedWith` includes another current member; a
  journey shared with nobody leaves no trace in any admin table, page or file.
- **S42.** The admin shows the verified Auth email, never `users/{uid}.email` or `.name`.

**The access log**
- **S16.** Every admin route that returns family data writes its access-log row before it builds the
  response; if the write fails, the route answers 503 with no data.
- **S17.** No `UPDATE` or `DELETE` on `access_log` or `access_log_hids` exists outside the yearly
  retention job; the chain verifies from the first row, including each row's household list; editing
  or removing any row, or any household in a row's list, makes verification fail at that row.
- **S18.** The log stores a first name and a 16-hex actor id, never the address; `detail` holds fixed
  keys with fixed-vocabulary values only (no search text, no names, no free text; a request number
  only in the shape `^R-\d{4}$`).
- **S43.** `/api/me/kept` returns only access-log rows about the caller (§7.5): never a row whose
  `target_uid` is another person. List views and exports record the households they showed.
- **S19.** The Monday digest carries the chain head hash and the week's counts of views, exports, notes
  and deletions, so a copy of the chain's state exists outside the database.

**Usage**
- **S20.** Usage events are written only to `cubby-usage`; no usage code path writes Firestore.
- **S21.** The uid comes only from a verified ID token; a body with `uid` or `hid` is refused; an
  event `id` that is not a v4 uuid, or a `native_version` outside its pattern, is not stored as sent;
  events are keyed by `(who, id)`.
- **S22.** `hid` is stamped from a membership read confirmed against `members`, at most 6 hours old;
  never from the client.
- **S23.** Every stored property is an allowlisted enum value, a bounded integer, or an allowlisted
  format; anything else is dropped and only counted.
- **S24.** The tracker sends nothing when the mode is off, during the person's own loss holding,
  during account deletion, or off the production host; queued events never travel under another
  person's token; linked events wait until the person has seen the card for the current notice, and
  the server refuses them otherwise (in mode `on`).
- **S25.** After the daily run, no usage event older than 90 days (30 with no uid) remains.
- **S26.** Account deletion removes the person's rows from every usage table in the same purge; the
  household purge removes that household's rows; the weekly sweep removes rows for uids Auth no longer
  has, and treats a lookup failure as "unknown", never "gone".
- **S27.** `/api/usage` enforces 32 KB, 50 events, per-uid and per-IP limits and a daily ceiling, and
  never fails a request the app depends on.
- **S28.** Internal uids are excluded from every number by default; the overview warns when
  `INTERNAL_UIDS` is empty.

**Notes**
- **S29.** Only `AdminWrites` sends a note, and it re-checks membership, hold, deletion pending, the
  switch, 7-day household spacing, push consent, caps and quiet hours, em-dashes and selling words.
- **S30.** The refusal for a held household and for deletion pending is the same text.
- **S31.** A note carries no credential or invite token; links come from the fixed list.
- **S32.** Note emails carry no pixel and no redirecting links, and every one has a working stop link.
  Opening a stop link, or any email link, changes nothing on the server; only the confirm page's POST
  stops notes, and the token never appears in a URL a server sees.
- **S44.** No team write (`teamNote`, the stop switch) can create a `users/{uid}` document: each
  carries `currentDocument: {exists: true}` in the commit body.

**Sharing**
- **S33.** Only a current member can share, only a document from `households/{hid}/events`, never
  photo data; the admin cannot read it after 7 days; stopping deletes it at once; deleting the source
  entry deletes the copy at the next tick.

**Secrets and the public repo**
- **S34.** After phase 1's cleanup, no tracked file contains a personal email address. The cleanup:
  `tools/asc_submit.js` stops hard-coding the App Store Connect account holder's name and address as
  defaults and reads them from the environment or a local file outside the repo (builder's call on
  the name, for example under `~/.appstore-keys/`); the four documents that name personal addresses
  (`docs/plans/2026-08-04-app-store-listing.md`, `docs/plans/2026-08-15-submit-runbook.md`,
  `docs/plans/2026-08-03-ux-simplify-audit.md`, `CUBBY-LIVE-FIRST-RUN-WALK.md`) are redacted to "the
  account holder's address". `*.md` keeps them off the site, not off GitHub, and git history keeps the
  old text; rewriting history is not in this build. The allowlist, so the gate can go green on the real
  tree: role addresses at `little-cubby.com` and `mail.little-cubby.com`; `example.com`, `example.org`,
  `example.net`; the reserved names `.test`, `.invalid`, `.example`, `.localhost`;
  `*.gserviceaccount.com` (the real service account's `client_email` appears in tools and tests); and,
  named one by one as legacy fixtures, `x.com`, `y.com` and `else.com` (about 170 uses in tests today;
  new fixtures use `example.com` or a reserved name). Image names such as `icon@2x.png` are not
  addresses. Commit authorship is already clean: every commit (785 at the check) is authored under a
  `users.noreply.github.com` address.
- **S35.** No key-shaped file exists under `workers/admin/`; `.assetsignore` covers every file under
  it; production answers 404 for the admin entry file.
- **S36.** The admin Worker contains no Firestore or Auth write call (no PATCH, DELETE, `:commit`,
  `:batchWrite`, `accounts:update` or `accounts:delete` against Google APIs under `workers/admin/`).

**Quota**
- **S37.** The admin's Firestore reads in a UTC day never exceed `ADMIN_DAILY_READ_BUDGET`.

**Families**
- **S38.** The first-run card shows once per person per notice version, and never over the loss
  holding screen.
- **S39.** Every string in §7.1 and §7.2 equals the canvas text and contains no em-dash; the policy's
  section says the same things. The one exemption is the date in the Privacy footer, which is masked
  before comparing because it is rendered from `PRIVACY_NOTICE` (my call).
- **S40.** Non-internal people are stored only when `USAGE_MODE = "on"`, and that value ships only in
  phase 3's last step.
- **S45.** Before phase 3 ships, no per-person activity about a family is stored or shown: no
  `last_sign_in`, `last_refresh` or `entries_7d` for a non-internal person, and no per-person rows in
  `dir_household_days` (it has no uid column at all).

---

## 14. Gates

Every gate below is wired into `tools/gates.js` in the tier shown, watched going red before it is
trusted (by its `--self-test` or by the mutation named), and has a paired staging when it can only
report an absence. Clock-pinned tests pin the day and the hour.

| Gate (name in gates.js) | File | Tier | Proves | Goes red when |
|---|---|---|---|---|
| `admin-access` | `test/admin-access.test.js` | tree | S1 to S8 | the verifier skips `aud`, or `iss`, or the email check; a second `ADMIN_PEOPLE` entry is allowed; a missing secret serves data; any status lacks `no-store` or `noindex`; a burst of tokens with unknown `kid`s fetches the certs more than once a minute; fixture mode starts with any production secret or binding present (each staged). Uses a locally generated RSA key and a stubbed certs endpoint, with tokens for every refusal in S2 |
| `admin-access-log` | `test/admin-access-log.test.js` | tree | S16 to S19 | a data route answers before its log row; a failed log write is swallowed and data is served; a row is edited, or a household is removed from a row's list (the verifier must point at it); a list view or CSV export does not record the households it showed; a `detail` carries a key outside the fixed list or a free string (staged: a request number of `"owner's email"`); a static scan finds `UPDATE` or `DELETE` on `access_log` or `access_log_hids` outside the one named retention function |
| `admin-no-content` | `test/admin-no-content.test.js` | tree | S10 to S15, S36, S37, S41, S42, S45 | the full refresh and every page, run against a Firestore recorder seeded with recognisable strings (`ZZ-BABYNAME-7731`, `ZZ-NOTE-...`, `ZZ-DOSE-...`, an invitee `zz-invitee@example.com` as a `pendingInvites` key, a live-shaped token `ZZLINKTOKEN7731` as a `pendingLinks` key, a forged `users.email` and `users.name`, an entry `time` of a recognisable minute, a hostile name `<img src=x onerror=...>`), lets one reach D1, a response or a log line; a pregnancy document with `sharedWith: []` (and one keyed by a carrier who is not `ownerId`) changes any stored or shown stage, count or label compared with no document at all; a raw record type or a dated kind reaches D1; a request goes out without a mask or outside §5.1; `lossHolding` appears in a second function; the read meter lets a refresh pass the budget; before phase 3, a non-internal person gets an activity column. Mutations: make the reducer keep the baby's name; keep the `pendingLinks` keys; drop the `sharedWith` check |
| `admin-hold` | `test/admin-hold.test.js` | tree | S12, §5.1 | the hold reader, in the admin and in `AdminWrites`, returns not-held for any of: the field absent, the field moved (staged as `app.loss.holding`), a non-map value, an unknown shape, a 404, a read error, a timeout. Companion stagings prove the same matcher returns not-held for `null` and `{}` and held for `{uid: {at}}` and the legacy `{at}`, so the gate is not green for free |
| `dir-erasure` | `test/admin-dir-erasure.test.js` | tree | §4.7, §10, §12 | a uid Auth no longer returns keeps its `dir_people` row past the next tick while the Firestore budget is exhausted; an Auth *failure* drops a row; a household with no remaining member keeps its rows; a `dir_household_days` row older than 90 days survives the pinned-clock run; after `erase_outcome` the admin leaves a row for that uid |
| `tracking-plan` (extended) | `tools/tracking_plan_check.js` | tree | §8.3 to §8.5, §15.1 | the linked events in the plan and the allowlist in `workers/usage/core.mjs` differ; a property has no enum or bound; a property name matches the content pattern (amount, ml, oz, dose, temp, weight, height, note, text, body, comment, message, mood, symptom, name, email, phone, address, value, reading, pressure, caption, photo, query, search, url), matched as whole tokens split on `_` the way the existing `IDENT` check does, so `template` is not `temp` and `screen` is not `screen_name`; a screen or feature matches the never-instrumented pattern; a loss event appears; `app/usage-allowlist.js` differs from what `core.mjs` generates; `JOURNEY_KEYS` is empty or misses a pregnancy-only screen; the allowlist is non-empty while the App Store listing §4, its review note or the runbook still says usage data is not collected or "no user id". Self-test stages each in a temporary copy |
| `usage-ingest` | `test/usage-ingest.test.js` | tree | S15 (main routes), S20 to S23, S27, S40 | a body uid or hid is accepted; an unknown event, unknown property or free string is stored; an `id` that is not a v4 uuid, or a `native_version` like `"1.4 Maya"`, is stored as sent; the same `id` from two people collides; `hid` comes from the client; a retry double-counts; limits or the ceiling are skipped; mode `off` or `internal` stores a non-internal person; in mode `on`, a linked event is stored for a uid whose notice is not current; `JOURNEY_KEYS` reach a per-person `usage_daily` row; any of the four new routes logs a uid, email, name or body (console recorder). D1 is `node:sqlite` `DatabaseSync` |
| `usage-erasure` | `test/usage-erasure.test.js` | tree | S25, S26 | any usage table keeps a deleted person's row (mutation: comment out one DELETE); the account purge keeps their `feedback` documents or their `GAMES_DB` hub rows; the household purge keeps its rows; the orphan sweep deletes a uid when Auth *failed* to answer; a 91-day-old row, or a 31-day-old `JOURNEY_KEYS` event, survives the pinned-clock retention run |
| `usage-tracker` | `tools/usage_tracker_check.js` | tree (browser, `url`) | S24, §8.1 | in the seeded app: no `visit.started` on load, no `screen.viewed` on a tab change, a logged feed's payload contains the typed amount (it must not), events flow while loss holding is staged with `evaluateOnNewDocument`, a linked event leaves before the card for the current notice is seen (staged both ways: unseen holds, seen sends), user A's queued event leaves under user B's token, the `pagehide` batch goes without a token, the queue passes 500 |
| `deploy-excl` (extended) | `tools/deploy_exclusion_check.js` | tree and live | S35, S5 | a file under `workers/admin/` is not fenced; the admin wrangler file lacks `workers_dev = false` or `preview_urls = false`, or has `[assets]` without `run_worker_first`; live: production serves the admin entry file |
| `no-personal-address` | `tools/address_check.js` | tree | S34, A3 | an address outside the S34 allowlist appears in **any tracked file** (self-test stages one, and stages `icon@2x.png` to prove it is not matched); when a local, untracked file outside the repo names the founder's address, any tracked file containing it fails (the pre-push hook runs this). Red on day one by design: it goes green only with phase 1's cleanup of `tools/asc_submit.js` and the four documents, which is how it is watched going red |
| `users-merge` | inside `tools/address_check.js` or its own small check (builder's call) | tree | §11.8 | a client write to `users/{uid}` without `merge` or `update` appears |
| `privacy-screens` | `tools/privacy_screens_check.js` | tree (browser, `url`) | S38, S39, §7 | the card shows twice for one notice version, fails to show after a bump, or shows over a staged loss holding; any string differs from §7.1 or §7.2 (the footer date masked, S39) or has an em-dash; the Privacy screen scrolls sideways at 320px; the switch does not write `teamNotes`; the copy changed without `PRIVACY_NOTICE` moving; the policy page lacks "What our team can see" |
| `share-entry` | `test/share-entry.test.js` | tree | S33 | a non-member shares; a path outside `events` is accepted; photo data is copied; the admin read path shows a row at 7 days plus one second (pinned day and hour); stop leaves the row; the sweep keeps a copy whose source returned 404, or deletes one whose source read *errored* |
| `me-kept` | `test/me-kept.test.js` | tree | §7.5, S43 | the download includes another member's events; a caregiver's file includes a row whose `target_uid` is another member (staged: an `export_request`, an `erase_dry_run` and a `manual_access` about the owner); it misses a household view or a list or export that included the household; it answers without a valid token |
| `nudge-guard` | `test/nudge-guard.test.js` | tree | S29 to S32, A5, A10, A11 | any refusal in §11.5 is skipped (each staged, including no time zone and pregnancy words to a partner); the held and deletion-pending texts differ; a push consumes the cap on a failed send; a body with a link outside the list, an em-dash or a selling word goes; an email has a pixel or lacks the stop link; a GET of `/notes-stop/` or of `/api/notes/stop` changes `teamNotes`; the email's stop URL carries the token outside the fragment; a stop token from an old key is accepted |
| `nudge-note-emu` | `test/nudge-note-emulator.test.js` | emulator | §11.7, §11.8, S44 | the REST write of `teamNote` or of the stop switch touches another field, recreates a deleted `users/{uid}` (staged: delete the document, then send), or fails against the real emulator (the trap catalogue: preconditions in the commit body, never the query string) |
| `admin-erase-emu` | `test/admin-erase-emulator.test.js` | emulator (Firestore and Auth) | §12 | a private record survives, the heir rule differs from the app's, the Auth account goes before the records, the person's `feedback` documents, newsletter row or `GAMES_DB` hub rows survive, another member's account is touched, or the dry run writes anything |
| `admin(live)` | `tools/admin_live_check.js` | live (`liveurl`) | S1, S5, S8 | an unauthenticated request to the admin host gets anything but a redirect to Access or a 401/403; a Worker-produced response lacks the headers; the admin answers on another hostname |
| `thirdparty(live)` | existing | live | A4 | unchanged; it must be green before phase 3 ships (Cloudflare Web Analytics is still on: founder step 14) |

The `--emulator` tier is not run by the hook or CI, so a red there is invisible: the builder runs
`node tools/gates.js --emulator` before every phase that touches Firestore writes, and records it.

---

## 15. Consequences elsewhere

### 15.1 App Store privacy answers

The package says otherwise today, in three places: `docs/plans/2026-08-04-app-store-listing.md` §4
("Data NOT collected ... usage data (no analytics SDK, first-party stance)"), the same file's review
note ("PRIVACY ... anonymous product events ... with no user id, no household id"), and
`docs/plans/2026-08-15-submit-runbook.md` §3 ("Answer No to everything else ... usage data and
diagnostics"). `.telemetry/tracking-plan.yaml` `privacy_label` already found the old answer wrong and
proposed "Not Linked to You"; this build makes it Linked. The new answers:

- **Usage Data, Product Interaction: Linked to You.** Purposes: App Functionality, Analytics. Not used
  for tracking. (Decided.)
- **Diagnostics, Other Diagnostic Data: Linked to You.** Purpose: App Functionality. *My call, F12:*
  sign-in and save error codes are diagnostics in Apple's terms; leaving them out would be
  under-declaring.
- **Identifiers, Device ID: Linked to You.** Purposes: App Functionality, Analytics. *My call, F12:*
  the random install id exists to tell one person's devices apart. User ID (already declared) gains
  the Analytics purpose.
- Contact info (name, email) stays App Functionality: notes from the team are customer support, which
  is why they must never sell.
- **Tracking: still none.** No App Tracking Transparency prompt is needed.
- App Privacy answers can be changed in App Store Connect without a new build; they must be published
  before `USAGE_MODE` goes to `on` (founder step 15).
- The review note's PRIVACY paragraph, proposed: "No advertising, no third-party analytics and no
  tracking SDK is present. Cubby measures how its own features are used (which screens and buttons,
  never what anyone types or logs), linked to the signed-in account and kept on Cubby's own servers, so
  its small team can fix problems and help people who get stuck. Nothing is used to track anyone across
  apps or websites." (`tools/asc_submit.js` reads the first fenced block after its heading, so the
  block itself must change.)

### 15.2 Google Play Data safety

Same truth: App activity, App interactions (collected, not shared, Analytics and App functionality,
not optional); App info and performance, Diagnostics (collected); Device or other IDs (collected).
Founder step 16, if the Android app is live on Google Play (F16); if it is not, the step waits for
the first Play submission.

### 15.3 The tracking plan

`.telemetry/tracking-plan.yaml` version 2, in the same commit as the allowlist: a new `linked_usage`
section with every event in §8.3; `meta.pii_policy` changes from `none` to `linked_envelope_only`
(identity rides only in the server-set envelope, never in a property), with the founder's decision and
dates written under `decisions`; rule 1 ("measure households, not people") is rewritten to say what is
now true and why; `privacy_label` updated to §15.1; the "No loss event" decision kept, now covering the
linked events too. `tools/tracking_plan_check.js` changes its no-uid rule **deliberately**: the
identifier check stays for properties, and a new check confirms the envelope is the only place a uid or
household can appear (§14).

### 15.4 The privacy policy

`privacy/index.html` gains a plain section **"What our team can see"**, mirroring the in-app screen
word for word, then naming everything else the dashboard shows: time zone, how you found Cubby, the Pro
waitlist, reminder settings and quiet hours, newsletter status, notes we sent you, and the times our
team opened your household. It also says: usage measurement is on for everyone and stated plainly (the
founder's call, no opt-out drawn; F13); raw usage events are kept 90 days (30 for pregnancy and trying
tools) and daily totals until the account is deleted; one shared entry is visible for 7 days; every
time our team opens your household, or it appears in a list or a file the team views, is logged, and
you can download those times (the first draft's "every look is logged" overclaimed: a household
seen in a list left no row until the lists started recording the households they showed, §9.2); notes
from the team can be switched off; deleting your account deletes all of it, including messages you
sent us from the app. If F11 says yes, it also says plainly that the founder holds the keys to the
families' database, does not open family records, and logs any exception made at a family's request.
The
"Basic technical and referral data" paragraph is rewritten, because "minimal first-party signals" no
longer describes it. The sub-processor list names Cloudflare's databases for usage and the access log.
"Last updated" moves. The legal entity is still a placeholder (founder step 17; F13). The
`privacy-screens` gate holds the section and the app screen equal.

### 15.5 Customer-facing promises already live

Five public pages promise no third-party trackers; `tools/thirdparty_gate.js` checks them, and it is
red while Cloudflare Web Analytics injects its beacon. The new screen says "Use tracking companies or ad
pixels" under "What we never do". Phase 3 cannot ship until the live gate is green.

### 15.6 `INTERNAL_UIDS`

Set on both Workers (founder steps 6 and 7). Without it, the founder's own accounts (five of the first
thirteen) become the customers and every rate is wrong. The overview warns when it is empty. The
`cubby-internal` local-storage flag keeps working for `/api/step`. A household is internal when its
`ownerId` is in `INTERNAL_UIDS`, the rule the main Worker already uses (`worker.js` 2066, 2647); a
person is internal when their own uid is in it.

### 15.7 The team's other tools, inside the line (my call)

The promise is about the team, not one tool. In phase 3, `tools/ops.js` and `tools/analytics.js` stop
printing baby names and read events with the `time, authorId, type` mask instead of whole documents.
`ops.js` keeps showing feedback text (families wrote it to the team). Builder's call: read the key from
a path outside the repo folder when set, falling back to today's path.

### 15.8 The lawyer list (for the UAE advisor, not for the builder)

- PDPL: profiling and the "who to help next" rules; the lawful basis for usage measurement on by
  default with no opt-out; the record of processing.
- EU and UK visitors: whether storing a random install id in local storage for measurement needs
  consent under ePrivacy rules.
- Residency: the new D1 databases' location (pick a location hint at creation only if the advisor says
  so), beside Firestore's US region.
- Retention: 90 days raw, totals until deletion, access log 24 months.
- Whether email notes count as marketing anywhere Cubby is used.
- A data request from someone who cannot use the in-app export, and how a requester's identity is
  checked (F8).
- Whether a household erase needs every guardian's request (F1).
- The legal entity named as controller (F13).

---

## 16. The founder's own steps, in order

No secret, address or key appears below or anywhere in the repo. Run commands from a clean clone
outside `~/Downloads` (for example `~/cubby-ops/little-log-pwa`), never from a worktree.

**Before phase 1**

0. **Round 5's rules (F2).** Its code reached `origin/main` on 13 Nov. If its Firestore rules are not
   published yet, publish them now, in this sitting, before anything below.
1. **Check the plan (F10).** Cloudflare dashboard: is the account on Workers Free or Paid, and what is
   its D1 daily write allowance? Tell the builder. The plan also sets subrequests per run (50 on
   Free), CPU time and the number of cron triggers; the spec's chunked refresh works on either, and
   the D1 allowance sizes the usage ceiling.
2. **Zero Trust team.** Zero Trust dashboard: create the team if none exists (its name becomes
   `<team>.cloudflareaccess.com`). Settings, Authentication, Login methods: add One-time PIN. Add no
   other method.
3. **The Access application.** Access, Applications, Add, Self-hosted. Name "Cubby Ops". Domain
   `admin.little-cubby.com`, no path. Session 12 hours (my call). Cookie settings: SameSite Strict,
   HTTP only on, binding cookie on. Hidden from the App Launcher. Login methods: One-time PIN only,
   instant auth on. One policy, "Founder only": Action Allow, Include, Emails, your address. Nothing
   else: no Everyone, no Bypass, no Service Auth. Save, then copy the **Application Audience (AUD)
   tag** from the overview.
4. **The read-only service account.** Google Cloud console, the Cubby project, IAM, Service accounts,
   Create: name it `cubby-admin-reader`. Grant exactly **Cloud Datastore Viewer** and **Firebase
   Authentication Viewer**. Keys, Add key, JSON. Keep the file out of the repo folder.
5. **Create the admin database.** `npx wrangler d1 create cubby-admin`, then
   `npx wrangler d1 execute cubby-admin --remote --file=./schema/admin.sql`. Paste the database id
   into `workers/admin/wrangler.toml` and uncomment the block (ids are not secrets; the main file
   already carries its own). Do the same for the existing `cubby-games` and `cubby-newsletter` blocks
   in the admin file, with the ids from the main `wrangler.toml`.
6. **Admin secrets.** From `workers/admin/`:
   `npx wrangler secret put ACCESS_AUD` (paste the tag),
   `npx wrangler secret put ACCESS_TEAM_DOMAIN` (`<team>.cloudflareaccess.com`),
   `npx wrangler secret put ADMIN_PEOPLE` (`[{"email":"<your address>","name":"<your first name>"}]`),
   `npx wrangler secret put FIREBASE_READER_SA < <path to the key file>`,
   `npx wrangler secret put INTERNAL_UIDS` (your own account uids, comma-separated).
   Then remove the downloaded key file from your machine: the Worker secret is now the only copy, and a
   new key can always be made.
7. **Main secret.** From the repo root: `npx wrangler secret put INTERNAL_UIDS` with the same list,
   unless it is already set (its state has been unknown since October).
8. **First deploy.** Workers and Pages, Create, connect the repository with Workers Builds: root
   directory `workers/admin`, watch paths `workers/admin/**`, `workers/shared/**`, `workers/usage/**`.
   Or once, by hand: `npx wrangler deploy -c workers/admin/wrangler.toml`. In the Worker's Settings,
   Domains and Routes, confirm workers.dev and preview URLs are disabled. This deploy also creates
   `admin.little-cubby.com` and its DNS record, because the wrangler file's route has
   `custom_domain = true`. Access (step 3) is already in front, so the name is never reachable
   without it, and the Worker's own check refuses anything that slips past.
9. **Confirm the hostname.** In the same place, check that `admin.little-cubby.com` is listed as a
   Custom domain on `cubby-admin` and on nothing else. (Rewritten: the first draft had you add it here,
   but step 8 already did.)
10. **Check it.** In a private window, open `https://admin.little-cubby.com`: the PIN page appears;
    your address gets a code and the dashboard; any other address gets nothing. Untick "Hide our own
    accounts" to see your own households: they are hidden by default. Then ask the builder to run
    `node tools/gates.js --live`. Turn on two-step sign-in for the mailbox that receives the PINs, if
    it is not on already: that mailbox is now the key to the dashboard.
11. **Every 90 days:** make a new reader key, `secret put` it, delete the old key in Google Cloud.

Also in phase 1, once: **the App Store Connect defaults.** Phase 1 takes the account holder's name
and address out of `tools/asc_submit.js` (S34). Put them in the local file the builder names, outside
the repo folder, so submissions keep working.

**Phase 2**

12. `npx wrangler d1 create cubby-usage`, apply `schema/usage.sql`, paste the id into both wrangler
    files. Approve the one-line change of `USAGE_MODE` from `off` to `internal`.

**Phase 3, before anyone is measured**

13. Approve the mockups (F17): the share row and sheet, the note card, the Privacy "shared" row, and
    the email stop page (`/notes-stop/`).
14. Cloudflare dashboard: switch **Cloudflare Web Analytics off** for the site, so `thirdparty(live)`
    goes green.
15. App Store Connect, App Privacy: change the answers to §15.1 (F12) and publish.
16. Google Play Console, Data safety: change to §15.2, if the app is live there (F16).
17. Give the builder the legal entity name for the policy, and the advisor's answer on EU and UK
    visitors (F13).
18. Say yes to `USAGE_MODE = "on"`, the last commit of phase 3.

**Phase 4**

19. Approve the note templates and the composer's final words (F17). No new keys: the email and push
    keys already exist on the main Worker.

**Phase 5**

20. Approve the erasure mockup (F17), answer F1 (who must ask before a household goes) and F8 (how a
    requester's identity is checked, and how someone who cannot use the app gets their log).

---

## 17. Build order: shippable at every step

The founder's example order was: 1 admin Worker read-only behind Access, 2 access log, 3 events in D1
and app instrumentation, 4 families' privacy screens, policy and App Store answers, 5 nudges, 6 erasure.
Two changes, both my calls (F15):

- **The access log ships with the first page, not after it.** A dashboard that shows names and emails
  without logging the look would contradict its own footer from the first day.
- **Families are told before they are measured.** Phase 2 builds the whole pipeline but stores nothing
  (`off`), then only the founder's own accounts (`internal`). Linked measurement of families begins as
  the *last* step of phase 3, after the screens, the policy and the store answers are live. Building
  events before the screens, as numbered, would have measured families under a label and a policy that
  said otherwise.

One more rule follows from the second change (my call, fixing the first draft): **until families are
told, the dashboard keeps activity per household.** Phases 1 and 2 show who is in each family (names,
emails, roles, sign-up), but no per-person activity trail about a family: no "last seen", no "last
sign-in", no per-person entries, no "active today" from Auth. The tracking plan v1 still says
"measure households, not people" until phase 3 rewrites it, and the dashboard does not get ahead of
it. The per-person columns and "Who to help next" switch on in phase 3, with the notice.

**Before phase 1:** F2. Round 5's code is on `origin/main` since 13 Nov; its rules must be live
before this work adds more to the public repo.

### Phase 1: the dashboard behind Access, read-only, every look logged

- `workers/admin/` and `workers/shared/`: JWT re-check, fail-closed config, headers, the access log
  with its chain and `access_log_hids`, the masked Firestore and Auth reader, the per-tick Auth check,
  the chunked 15-minute and daily refresh inside the read budget, the fixture mode, the `MAIN`
  binding for the canary.
- Screens: the overview's record-based parts (system checks, households, people, stages, getting
  started, two people logging), the household page (header, chips, banner, people without activity
  columns, choices, record health at household level, "not shown here"), Every record's People,
  Households and Access log tabs, CSV export, "Record a manual access". Usage panels say "Waiting for
  usage events".
- `recordCronRun` keeps the daily `push_daily` tally in `ops_state`.
- `.assetsignore` line, deploy-exclusion additions, `schema/admin.sql`; the address gate **and the
  cleanup it needs** (`tools/asc_submit.js` defaults out, the four documents redacted, S34).
- Gates: `admin-access`, `admin-access-log`, `admin-no-content`, `admin-hold`, `dir-erasure`,
  `deploy-excl`, `no-personal-address`, `admin(live)`.
- Founder: steps 0 to 11, and the App Store Connect defaults.
- **The app does not change.** Exit: all gates green, having each been seen red; the founder signs in
  from a private window, unticks "Hide our own accounts" (it is on by default) and sees his own
  households; another address cannot.

### Phase 2: the usage pipeline, dark, then on the founder's own accounts

- `cubby-usage`, `workers/usage/core.mjs`, `/api/usage`, membership stamping, the tracker
  (`app/cubby-track.js`, SW precache and bump), native hooks in `app/native-bridge.js`, rollups,
  retention, and **the erasure additions** to `/api/account/purge`, `purgeDeletedHouseholds` and the
  orphan sweep (shipped before any event can exist in production).
- The tracking plan v2 and the extended `tracking-plan` gate, with the store-answer check in place:
  the docs and the code must agree before the allowlist can be non-empty.
- The admin's usage panels, Visits, Usage events, Sign-ins and Devices tabs, showing the founder's
  own (internal) accounts only, since nobody else is stored.
- `feedback` documents join the account purge (§10).
- `USAGE_MODE`: ships `off`; after a day of nothing stored, `internal`.
- Gates: `usage-ingest`, `usage-erasure`, `usage-tracker`, `tracking-plan`.
- Founder: step 12.
- **Families see no change and are not measured.** Exit: on `internal`, the founder's own visits,
  screens and features appear correctly from all four ways in; deleting a test account removes its
  rows.

### Phase 3: families are told, then measured

- The first-run card, Settings then Privacy, the notes switch (stored; nothing sends yet), share one
  entry, Download everything we keep, the household page's "Shared with you" panel, the existing
  export row's new second line (§7.2), the tracker's hold until the notice is seen.
- With the notice live: the per-person activity columns (`last_sign_in`, `last_refresh`,
  `entries_7d`), the people-level usage views for families, and "Who to help next" as a read-only list.
- The policy section, the App Store and Play answers, the review note, the tracking plan's final words,
  `ops.js` and `analytics.js` inside the line.
- Gates: `privacy-screens`, `share-entry`, `me-kept`; `thirdparty(live)` green.
- Founder: steps 13 to 18.
- **The last commit flips `USAGE_MODE` to `on`.** Exit: a new test account sees the card once; an
  existing one sees it on next open; the live store answers match; the gates are green.

### Phase 4: notes from the team

- `AdminWrites.sendNudge` in the main Worker (deploy first), the `WRITES` binding, the composer, the
  three channels, the ledger, the email stop page and its POST, the in-app card (read at open), seen
  and acted, the Nudges tab; `app.lossHolding` written as `null` on every household-creation path that
  does not write it yet (§5.1).
- Gates: `nudge-guard`, `nudge-note-emu`.
- Founder: step 19.
- Exit: on the founder's own accounts, each channel delivers once; every refusal in §11.5 is seen;
  a family's switch turned off stops them.

### Phase 5: data requests and erasure from the dashboard

- Export for a data request, one file per person (F6); delete one person's account on their own
  request, with dry run, typed confirmation and the 30-day grace; `AdminWrites.eraseAccount`; the
  admin's own `dir_*` delete after `erase_outcome`. `eraseHousehold` only after F1 is answered.
- Gates: `admin-erase-emu` (Firestore and Auth emulators).
- Founder: step 20.
- Exit: a fixture person is erased end to end on the emulators (every Firestore and D1 row in §12,
  Auth last), another member of the same household is untouched, and the dry run wrote nothing.

Every phase ends the way the repo ships: verify here, commit, push main, confirm on the live site, keep
the PWA, native wrapper and marketing site in step (the policy page is the marketing surface here).

---

## 18. Left to the builder

- The final screen, feature, error and notification-kind lists, inside §8.4's rules.
- Thresholds: the saving check, "who to help next" numbers, "newest version", "N versions behind".
- How the page learns its running SW version; the `sendBeacon` fallback; how a notification tap is
  recorded on the web.
- The admin's page structure (server-rendered pages or one small script calling JSON routes), routes'
  exact names, pagination size, the city label for a time zone.
- The final `JOURNEY_KEYS` list and the pregnancy-word list for notes, inside §8.4 and §11.2.
- The name and place of the local file that holds the App Store Connect defaults (S34).
- How fonts are bundled into the admin Worker (or assets with `run_worker_first`).
- How "time spent per feature" is computed (screen dwell between events in a visit, capped at 10
  minutes per screen is a sensible default), done on the server.
- The access-log insert mechanics and the yearly checkpoint, inside §9.2's rule.
- The test stub for `cloudflare:workers`; whether D1 tests use `node:sqlite` (the existing pattern) or
  Miniflare. Real SQLite either way, never a fake that ignores the SQL.
- Template wording, inside §7.7, for the founder's approval.
- Whether a stop-sharing right belongs to the sharer only, after the mockup review.
- Dropping the `hid` index if the write allowance is tight.
- Whether to later share one daily masked read between the funnel snapshot and the admin refresh.

---

## 19. My calls, for the founder to check

1. Access log ships in phase 1, with the first page.
2. Linked measurement waits behind `USAGE_MODE` until phase 3's screens, policy and store answers are
   live; `internal` mode proves it on your own accounts first.
3. Exactly one entry in `ADMIN_PEOPLE` or the dashboard refuses everyone; a second person is a code
   change.
4. Writes go through an RPC entrypoint in the main Worker (`AdminWrites`), so no new write-capable key
   exists.
5. Two new D1 databases, one writer each; never Workers Analytics Engine (it cannot erase one person).
6. The admin reads Firestore under a daily budget of 8,000 reads and pauses rather than borrow.
7. A one-bit hold check (`app.lossHolding`) is the only loss-related read; it is never stored, logged
   or shown, and the refusal wording is shared with "deletion pending".
8. The whole household is held, not only the person.
9. The tracker is silent for a person while her own holding screen is active.
10. Notes go to members only; the team never contacts invitees and never creates invite links.
11. At most one note per household per 7 days.
12. Email notes have no pixel and no click tracking; "seen" comes from opening the link.
13. Push notes count against the existing `feature` cap (5 a month).
14. Notes never sell, checked in code; no em-dash, checked in code.
15. The admin export for a data request never contains the family log; families export it themselves.
16. Shares are copies made by the main Worker, so the admin never reads entry contents itself; photos
    are never shared.
17. "Download everything we keep" is per person, open to caregivers, and includes the times the team
    opened the household.
18. Baby names and invitee addresses are never shown.
19. The first-run card's "seen" is stored per person in `users/{uid}`, and the Privacy footer date
    comes from the notice constant.
20. "Record a manual access" exists for break-glass.
21. App Store answers also declare Diagnostics and Device ID, both linked.
22. `ops.js` and `analytics.js` come inside the line in phase 3.
23. Household display numbers are assigned once and never reused.
24. No stage history anywhere; the directory holds current state only.
25. Pre-sign-in events wait on the device and are only sent anonymously after 24 hours.
26. `USAGE_MODE` is a `[vars]` value, so every change to it is a reviewed commit.
27. The access log is kept 24 months and survives erasure, holding only opaque ids, a first name and
    codes; its chain head is mailed weekly.
28. Usage panels say "Waiting for usage events" instead of showing zeros.
29. The `/api/step` counters and the Monday digest stay as they are.
30. Access sessions last 12 hours, with a SameSite Strict, HTTP-only, bound cookie; the admin
    Worker has no workers.dev or preview URL and no static assets served before its check.

Added in the revision after the builder's check:

31. Email shown is the verified Auth email; the name shown is the circle's `memberInfo` name. Never
    `users/{uid}.email` or `.name`, which the client can set to anything.
32. "Signs in with" is Google, Apple or Email; Auth cannot tell an email link from an email code.
33. "Last entry" and "Last saved" are shown at day level, never as a clock time.
34. The newsletter lookup is `SELECT stage, status` by `email_hash` only; never `email` or
    `unsub_token`.
35. The phone's allowlist is a generated, committed copy, `app/usage-allowlist.js`, held equal to
    `core.mjs` by the gate.
36. The `pagehide` batch uses the last cached ID token.
37. Event ids must be v4 uuids, and events are keyed by `(who, id)`.
38. The Privacy footer's date is masked out of the verbatim gate.
39. `USAGE_MODE` and `USAGE_DAILY_CAP` go into the main Worker's existing `[vars]` table.
40. Step 9 confirms the hostname that step 8's deploy created.
41. The canary is called through a `MAIN` service binding from phase 1; cron health and the digest
    are read from `GAMES_DB` directly.
42. No history backfill for `dir_household_days`; 30 and 90 day ranges say "since <date>" until full.
43. Display numbers are kept unique by a high-water counter, not tombstone rows.
44. Stop links never expire; after a key change they land on a page that explains Settings, then
    Privacy.
45. Anonymous sign-in failures are labelled, never joined to a person, never suggested or emailed.
46. A shared entry's copy goes when the family deletes the source entry.
47. Phase 1's exit check unticks "Hide our own accounts".
48. The existing "Export data" row's second line becomes "Your family's log as a JSON file, yours
    whenever you want it", so it no longer collides with "Download everything we keep".
49. The daily reminders tally lives in `ops_state`, not in the public `/api/health`.
50. Unknown `kid`s refetch the Access certs at most once a minute.
51. Fixture mode refuses to start when any production secret or binding is present, and a gate
    proves it.
52. The Usage events tab shows stored events only; derived ones such as `invite.sent` stay where they
    already live.
53. The in-app note rides the `users/{uid}` read the app already makes at open; no new listener.
54. `feedback` documents are deleted with the account, in the app's purge and in the admin erase.
55. A pregnancy is shown only when shared with another member, and "No stage shared" replaces "Not
    started yet" so a private journey leaves no trace.
56. Activity is per household until families are told in phase 3; "Who to help next" moves to
    phase 3.
57. The hold reader fails closed: absent, moved, unknown or unreadable means held.
58. `dir_entries_daily` is replaced by a per-household day table with no uid and no type, coarse kinds
    as a 7-day count, and per-person entries as one current number.
59. Pregnancy and trying tools are kept per person only as raw events for 30 days.
60. "Getting started" counts the shared log only; where it differs from the Monday digest, the digest
    is the number of record.
61. List views and exports record the households they showed, so a family's download is complete.
62. The manual-access form and erase confirmation take reason codes and an optional `R-0001` number,
    no free text, until F7 is answered.
63. A note with pregnancy words goes only to the carrier.

### Questions for the founder

They are at the top of this file, F1 to F17, most important first.
