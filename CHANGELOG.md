# Cubby — Changelog

## v0.18.0 — 2026-08-10 — the connectivity states get a picture, and stop promising things they cannot do

Service worker `little-log-v280` -> `little-log-v281`.

**A painted hot-air balloon now carries the states where a lost signal actually strands somebody.** It
started as a mistake: a prompt asking for a field of stars came back as a balloon, and the file shipped
for weeks with nothing loading it. It is the right picture for briefly out of reach and coming back
down, so it moved out of the poster set (`app/poster-art/poster_hotair.webp` ->
`app/spot-art/offline_balloon.webp`).

Moving it needed real surgery, and the reason generalises. Poster art is painted on **white**, because
the poster canvas composites with `multiply` and gets transparency for free. The app's spot
illustrations are **cut out**, because `--spot-paper` is a cream disc in Light and *transparent* in
Night. Dropped in as-is the balloon would have been a glaring white circle on every dark screen, which
is the "headlight" the existing code comments warn about. `tools/cutout_white.py` does the conversion:
a flood fill inwards from the border so enclosed pale areas and the scattered stars survive, and an
un-multiplied edge so the soft watercolour rim reads as paint rather than paint mixed with paper.

It is also **the only illustration in the service worker's precache**, because the moment it is needed
is the moment the network is gone: the fetch handler resolves an uncached non-HTML miss to nothing, so
an offline state would have tried to fetch its own artwork over the dead connection and shown a blank
box. The other thirteen spot cubs stay out; they decorate screens a parent reaches with a connection.

**Where it landed, out of 34 connectivity surfaces mapped.** Most are not errors at all: a feed logged
offline lands in the local cache and syncs itself, and dressing that up as a problem is the
alarm-about-nothing the charter forbids. Three places genuinely leave somebody with nothing to look at.

The **SDK-failed-to-load** card (`app/firebase-init.js`) was the only full-screen connectivity state
Cubby had. It carried a 40px bear emoji and hardcoded colours, which put its heading at roughly **1.1:1
in Night** — invisible, in the one state whose entire job is to explain itself to somebody at 3am. It
now uses the shell's own classes and theme tokens (the `<head>` style survives the body wipe), carries
the balloon, and is the app's first `role="status"` region, because until now every connectivity
message Cubby has ever shown was announced to nobody using a screen reader. Its guard also tests
`auth` and `firestore`, not just `initializeApp`: the four SDK files are four separate requests, and a
connection that dropped midway used to satisfy the old guard and then throw *outside* the try, leaving
a dead screen with no card at all.

**Signed in, but the household could not be read** used to fall through to the marketing landing, with
"Continue with Google" on top of a parent who is signed in. To her that reads as "you have been logged
out and your data is gone" — frightening, and untrue. The connectivity card takes that screen now.

**The guest games page** (`g/index.html`) is where a grandmother lands with no app and no service
worker, and every failure path there wiped the whole body. One blip during its 20-second poll replaced
her rendered game and her confirmed guess with a bare "Offline?" line and nothing to tap. Now a failed
*first* load gets the illustrated state with a real Try again button (this page had no retry control at
all), and a failed *refresh* keeps every word she was looking at and says so in a line that clears
itself.

**And the copy stopped over-promising.** `errText` mapped every offline failure to "Cubby will pick this
up when you're back". That is a guarantee backed by `enablePersistence` and it is true of a queued
write. It is false of sending a sign-in link, finishing sign-in, or loading your data: nothing is
queued, no link arrives when you are back, and nobody would ever tell her it had not. The promise is
now opt-in per call site and the default says what is actually true, following the truthful-copy
precedent that a claim gets weakened rather than kept.

Also: `.es-cta`, the door out of every cold screen, measured **39px** against the 44px touch target the
guardrails require, and no gate checked it. It does now.

**New blocking gate:** `tools/offline_gate.js` (32 assertions), plus the connectivity card added to
`tools/uitest.js`'s contrast walk so it is measured in both themes from here on. See OPERATIONS.md.

**Known limit, deliberately not fixed:** with no connection, a "good read" link gives you the browser's
own error page. The service worker registers from `/app/index.html`, so its scope is `/app/` and it
never sees `/articles/*`. Putting our own page there means moving the worker to root scope, which
changes caching for 661 article pages.

## v0.17.0 — 2026-08-10 — the birth poster becomes a keepsake, and home stops shouting about nothing

Service worker `little-log-v262` -> `little-log-v276`. All live on little-cubby.com (deploys from `main`).

**The birth poster was a receipt.** LABEL over value, seven times, down the middle, in the body face,
with a photo frame doing the warmth. It is now the thing every framed birth print actually does: the
name in a hand, four facts in quadrants split by a dotted cross, and a painted animal carrying the
page. Seven curated pairings (bear, bunny, fox, elephant, deer, panda, lamb), each with its own paper
and accent, and six pieces of furniture (bunting, balloons, cloud, stars, sprigs, little icons) that
can each be turned off. Defaults are chosen so a parent who touches nothing still gets something
worth putting on a wall, but choosing is the point: a keepsake you picked is one you show people.

Eleven optional facts now, each shown as a dashed rule in the preview when empty and omitted entirely
from the saved file: full name, time, weight, length, **head circumference**, hospital, **town or
city**, blood group, star sign, proud parents. The parent's own photo can replace the animal.

Two layout corrections worth recording. The quadrants stacked label over number over icon, three
things tall, while the space either side of a short number like "50" sat empty; icon, number and unit
are now measured together and centred as one row, which took a third off the grid height. And the
colour was inverted: the small caps shouted in the accent while the numbers sat in dark ink. The
numbers carry the colour now. That single swap is a large part of why the references read as posters
and ours read as a form. The date quadrant, the one of the four standing without an icon, has a
painted calendar; its day-and-year row now goes through the same helper as the other three rather
than a hand-rolled copy of it.

The furniture is painted in the journey library's hand (`art-src/poster_*.png` -> `app/poster-art/*.webp`)
and composited with `multiply` rather than as cut-outs, because gpt-image-2 refuses transparent
output: on white, multiply drops the white and warms the marks into the paper. Tinted per style with
the `color` blend, which keeps luminosity so white stays white and the multiply still keys it out.
Deliberately **not** in the service worker precache: they are only needed when somebody makes a
poster, and an offline launch should not carry 400KB of decoration.

**Notes moved to the bottom of home, and comes up only when something is actually waiting.** The lane
sat above the parent's own baby every day, and on most days it held a heading, a prompt to write
something and a quote of the day. Generic filler in a prominent slot teaches people to scroll past
that slot, which is the worst thing that could happen to the only place a second caregiver can reach
them: the day a real handoff appears there, the eye already skips it.

So the card lives at the bottom now and earns the top of the screen for exactly one reason — another
member has left something this member has not read, to the whole circle or to them by name. It goes
back down the moment they read it. The lane carries a count, and each unread card carries a dot, so
with three notes in the lane the parent can see which one is new instead of opening all three. Your
own note never lifts the card; it is not news to you. A note private to somebody else cannot lift it
either, and is never rendered.

Five properties that were each an easy bug to ship, and an adversarial review of the first cut found
two of them after the gate had already gone green.

The read-marker is **per member**, in `localStorage` keyed by uid and never in `state.settings` (that
blob is shared with the circle, so a personal marker filed there would travel to everybody, and one
caregiver reading a handoff would clear it for the other). Accepted consequence: it is therefore per
*device* too, so reading on the phone leaves the note marked new on the tablet. Following the person
would cost a document write per note opened.

It is a set of note **ids**, not a high-water timestamp: sync can deliver a note stamped 09:00 after
this member has read one stamped 10:00, and a timestamp marker swallows it silently, so nobody is ever
told it arrived.

Those ids are **scoped to a day** and dropped whole when the day turns. The first cut kept a
fixed-size list evicted by read order, which spent every slot on ids that were already dead and
eventually discarded a live one, bringing the card back up saying "1 new" about a note read months
earlier.

**A pin is not news.** The first cut counted any unread pin, and a pin stands on this screen every day
after it is left, so one pin from a co-parent promoted the card and printed "1 new" every single day
until somebody happened to tap a note they had already read — exactly the false nudge the change
exists to remove. Only what was left today can be unread. Pins from earlier days still stand in the
lane, which is what a pin is for.

And reading the last unread note takes the card's whole footprint out of the page **above where she is
reading** — 885px measured with six notes in the lane — so the scroll offset gives back exactly that
footprint and she closes the sheet looking at what she was looking at. Measured from the card's own
height, not from a landmark further down the page: an alert pill arriving on the same repaint moves the
landmark without moving the card, and that was worth 91px of error. `surfaceShift` likewise brings the
surface into view rather than jumping to the top, because the arrows live inside the card and the card
can be at the bottom. Position is decided by **today**, never by the day being browsed, so arrowing
back through earlier days cannot make the card leap around the page.

**New blocking gate:** `tools/noteshome_test.js` (45 assertions). See OPERATIONS.md.

## v0.16.0 — 2026-08-08 — the jitter is gone, the app explains itself, and reminders finally reach a closed phone

Service worker `little-log-v247` -> `little-log-v262`. All live on little-cubby.com (deploys from `main`).
The native wrapper remote-loads `/app/`, so every item below reached the iOS app with no new build.

**Performance: the app stopped rebuilding the world.** Every `render()` handed the whole shell to
`innerHTML`, and the Log tab built every event ever logged, every time. On a real four-month history
at 4x CPU throttle: Log render **498ms -> 11ms**, DOM nodes 27,570 -> 3,297, markup per repaint
1.5MB -> 180KB, the one-second tick 18.8ms -> 0.8ms. Four invariants now hold: paint through
`paintShell` (identical markup is a no-op, and the `#scroll` node always survives, because destroying
it destroys iOS inertial scroll mid-flick), the timeline is windowed and reveals on approach, network
repaints coalesce through `renderSoon()`, and nothing sweeps the document on a timer.
`node tools/perf_check.js` is the blocking gate.

**"What to log, and why"** (`app/log-guide.js`). A short reference sheet that leads with the logs that
earn their place at this baby's age and says what each one gives you back. Pull only: it never opens
itself, has no progress meter and no completion count, is offered on home once, and lives permanently
in Settings. ONBOARDING.md amended to record why that is a guide and not the tour it still rules out.

**The Notes lane keeps its promises.** With nothing logged it rendered only a quote of the day, set
like a real note, so the lane never looked empty or writable; it now says so in plain words, and the
quote stays. Under it, six real bugs: an offline save that hung forever, three taps making three
notes, a pin toast that said the opposite of what happened, a pin that was not actually pinned on
today, notes filed under yesterday by a phone left open overnight, and a note long enough to push the
home screen off the bottom. Pins are now per member rather than one per household.

**Reminders that reach a closed phone.** Dose times can be written into the parent's own calendar as
an `.ics`: no APNs key, no push cron, no server, no App Store review. Set times only (an
every-few-hours schedule moves each time you log a dose, and an `.ics` cannot be recalled), always
bounded by a `COUNT`, stable UIDs with a rising `SEQUENCE` so re-adding updates the same entries, and
a real `METHOD:CANCEL`. Push delivery is still off (`REMINDERS_LIVE=false`).

**Twins were getting no dose alert at all.** Alerts scanned only the baby on screen while the push
index scanned every baby. Fixing it needed six pieces, because the pill's own buttons resolved
through the same narrow lookup and `commitDose` stamped whichever child was on screen: a sibling's
dose could have been filed against the wrong child's health record.

**Photograph the vaccination card** instead of typing twelve dates (`app/vax-card.js`). On device
only: the photo never leaves the phone. The confirmation screen is the feature, and nothing is
written unless a date is left on a row.

**Onboarding, honestly.** Health opens on Vaccines rather than an empty Medicine list, so the
country-correct vaccine plan a parent was just told about is actually there. The free doctor visit
summary has a permanent door. A new parent met seven teaching surfaces at once and was asked for a
photo three times; the ticker and the photo nudge now stand down while Get started is up, and the
ticker retires on your own logs rather than the household's. The microphone no longer starts on open.
The date picker has year controls (36 taps to back-date a three-year-old, now three). Every "Start
free" now says an account is needed.

**Cubby Pro moved to October 2026.** August had arrived with `checkoutUrl` still empty.

**Accessibility:** switching the Health default made the contrast gate render the vaccine list for
the first time and it immediately failed "Due soon" at 1.99:1. Four status badges were using an
accent as ink on its own tint. `node tools/uitest.js` walks both themes on every ship.

**New blocking gates:** `tools/perf_check.js`, `tools/guide_test.js`, `tools/dosecal_test.js`,
`tools/vaxcard_test.js`. See OPERATIONS.md.

**Groundwork, not yet a feature:** medicines now carry a subject and the clinical reports name the
baby they are about, so an adult's own medicines can follow without a report ever widening by
accident. The private store itself is not built. See `docs/plans/2026-08-08-reminders-and-import.md`.

---

## v0.15.0 — 2026-06-22 — routines become "rituals" + a Rituals tab in the Log

- **Renamed "routines" to "rituals"** across all user-facing copy in the app (the day card, the manage/add/edit sheets, the Reminders copy) and the app landing Pro note. The warmer frame fits the calm brand. The persisted data key stays `b.routines` for data-compatibility (existing users keep their lists); internal function/class names are unchanged, with a note in `ROUTINES.md`.
- **New "Rituals" tab in the Log area** (Log | Rituals | Stats). The day's ritual checklist moved out of the cramped Log view into its own clean space.
- **Gentle weekly rhythm (view + measure):** under the checklist, each ritual shows the last 7 days as soft dots (filled = kept) with a calm "X of 7 🌿". Deliberately non-judgmental per the charter: no streaks to break, no red, "a quiet day is always allowed, and a gap is a chapter, not a failure." Tick history is now kept ~14 days (was today-only) to power the measure; the lasting record still lives in the log events.
- Service worker `little-log-v118` -> `little-log-v119`.

---

## v0.14.0 — 2026-06-21 — pregnancy + family games, the four audit fixes, retention features, marketing rebuild

A large span since v0.13.0 (service worker `little-log-v82` → `little-log-v118`, 81 commits). The pregnancy/expecting journey and a loss-safe family game shipped, all four architecture-audit fixes landed, several retention features went live, and the marketing site was rebuilt. All live on little-cubby.com (deploys from `main` via Cloudflare).

**Pregnancy & onboarding**
- Simpler 2-state onboarding (expecting / baby) with explicit stage tiles, a "We're trying" planning stage, and twins support. Affirm-then-offer for additional babies (loss-safe, no anxious prompt). Birthday is now mandatory (no silent default to today).
- A crafted in-sheet date picker (`datePicker()` in `app/index.html`): month grid, Today shortcut, local-correct (no UTC drift), future-disable via `opts.max`. Contrast fixed (v118): disabled dates are readable and "today" is a clear pink ring.
- The "We're trying" date is the last-period date (past-only, for the fertile-window estimate); a new "Already expecting? Set your due date →" CTA routes into the expecting setup, where the due date allows future dates.
- Tappable week pills; sheets no longer full-page-jump or zoom, fields persist, native pull-to-dismiss.
- Your own profile is now editable after first-run: name + relationship in Settings → "Your profile & family" (`openFamily`), writing `memberInfo.<uid>.name`/`.relationship` + the auth displayName (v118).

**Family games — "Boy or girl?" + due-date pool**
- A calm, loss-safe pre-birth guessing game: in-circle guesses plus a hosted Kahoot-style guest link (friends join with a nickname, no account). Real celebration on reveal, including twins ("one of each"). Owner-only reveal; never implies an expectation.
- Games hub (Phase 1): Firebase-auth ownership, an isolated `cubby-games` D1, `/api/hub/*` worker routes, guest relation + custom roles, a close-games teardown. The guest store holds only the host's public title + {nickname, guess, note}. See `GENDER-GAME-SPEC.md` / `GAMES-HUB-SPEC.md`.

**The four architecture-audit fixes** (see `HANDOFF.md`)
1. Ops wins: a pre-commit SW-bump hook (`.githooks/pre-commit` via `core.hooksPath`), cron observability (structured logs + a `GET /api/health` heartbeat in the games-D1 `ops_state` table), per-IP game rate-limits.
2. Games auth hardened + the hub (above).
3. Firestore rules hardened and **published live**: `onlyOwnMemberInfo()` (members edit only their own memberInfo) + `appBlobClean()` (no pregnancy/mhealth in the circle-shared blob) + the invitee-branch lock; an emulator cross-account test harness lives in `test/`.
4. Consent server-enforcement: closed — dual-guardian export/delete stays the in-app gate (no Cloud Functions on Spark); copy is truthful ("Cubby asks both guardians to agree").

**Retention & delight**
- Push reminders: opt-in, Worker 15-min cron + FCM. Medicine-dose only (per-dose ~30 min before + one daily digest), never feeds/milestones; quiet hours client-side.
- Auto-magic memories "Ready for you" rail + a month-iversary card CTA.
- Animated keepsake studio: decorations (balloons, confetti, stars), cubbyBear characters, a Birthday template, MediaRecorder video export (animated card → shareable clip).
- 225-entry milestone library (data file), browse-by-age + search + a pet pack.
- Child stage: the home grows up with the baby.

**Privacy**
- All app fonts self-hosted (dropped the Google Fonts CDN), completing the no-third-party-trackers promise for the app.

**Marketing site rebuild**
- FAQ rebuilt to 16 categories / 119 Q&As with FAQPage JSON-LD kept in lockstep with the visible copy; customer-first trust voice.
- Homepage: concrete proof (a privacy UI snippet showing item-by-item health sharing + the mood lock; a "Your country's schedule, built in" trust row of the real authorities).
- `/why/`: a rich narrative rewrite (the 3am story, two proof cards, the four vows, an unsigned founder note), then restructured with pull-quotes + air so it does not read as a wall of text.
- New `/how-it-works/` journey page (HowTo + Breadcrumb schema); `/pregnancy` + `/features` gained "live but unshown" feature blocks.
- Nav decluttered from 8 tabs to 4 (Pregnancy / Baby / Articles / Pricing) + a no-JS `<details>` "About" dropdown (Why Cubby / How it works / FAQ), across 395 pages.
- ~141 new articles (now ~398) + a hub with contextual sub-filters. No em-dashes in any customer copy.

**Monetization**
- Pro billing via Lemon Squeezy (merchant-of-record) worker, built-not-live, gated behind "Register for Pro" until Aug 2026. See `PRO.md` / `workers/pro-billing/LEMONSQUEEZY.md`.

**Platform**
- Service worker cache progressed `little-log-v82` → `little-log-v118` over the span.

---

## v0.13.0 — 2026-06-16 — contextual "why we ask" help, Sign in with Apple, brand-mark fix

A calmer data-entry experience with inline reasons for every sensitive field, Apple sign-in for the App Store, and a corrected brand wordmark on the sign-in surfaces. All live on little-cubby.com (deploys from `main` via Cloudflare Workers Builds).

**Contextual "Why we ask" help**
- New reusable inline expander in `app/index.html`: a `wwa(key)` helper, a WWA copy map, and `.wwa`/`.wwa-t`/`.wwa-n` styles. One calm tap reveals the reason under a field; it never navigates or opens a sheet.
- Wired into 22 fields where parents seek clarity: baby birthday (add + onboarding), baby name (onboarding), birth details (one consolidated note), blood group, doctor contacts (one note), pregnancy dating (due date / last period / cycle length / care country, across setup, positive-test, period-update and edit flows), maternal weight, glucose, blood pressure, growth weight + height (one note), and the boy/girl chart toggle.
- Allergies and the family-list email use an always-visible note instead of a hidden expander, because those facts should not be tucked away.
- Every privacy line was adversarially verified against `firestore.rules` so the claims are true. The family list now states plainly that everyone in the circle can see each other's name and email.
- Shipped commit `3365e4d`, service worker `little-log-v80`.

**Sign in with Apple (live)**
- Apple sign-in is live (App Store guideline 4.8). `app/firebase-init.js` adds `window.LL.appleProvider` (`OAuthProvider('apple.com')` with email + name scopes); `app/store-firebase.js` adds `appleBtnHtml()` + `signInApple()` using `signInWithPopup` with a `signInWithRedirect` fallback for webviews and blocked popups. A "Continue with Apple" button now appears on both the landing and auth-card sign-in screens.
- Apple config: App ID `com.littlecubby.app`, Services ID `com.littlecubby.web`, Team ID `F5NVQV7NVB`, Key ID `78HP3BF2S5` (the `.p8` lives only in the Firebase console, never in the repo). Firebase project `little-log-a9caa`; the edge worker already forwards Apple's POST callback on `/__/auth/*`, and no `.well-known` domain-association file was needed (Firebase does the server-side token exchange).
- Sign-in methods are now Google + Apple + email magic-link.
- Shipped commit `04ec7a7`, service worker `little-log-v81`.

**Brand-mark fix**
- The app sign-in/landing top-left nav now shows the "Cubby" wordmark instead of the bare domain "little-cubby.com", matching the marketing site (`app/landing.js`). The footer link to little-cubby.com is kept on purpose.
- Shipped commit `862df25`, service worker `little-log-v82`.

**Privacy-enforcement findings (known gaps)**
- The dual-guardian consent gate for export/delete is enforced only in client code (`index.html`), not in `firestore.rules`: any household member can write the shared app blob, and an owner can delete without a second approval. "Both guardians must agree" is a UI convention, not a security guarantee; help copy was softened to "Cubby asks both guardians to agree". To make it a real guarantee it must move into `firestore.rules`.
- Email is not private: it is written to `households/{hid}.memberInfo`, readable by every member and shown on the family list. Copy was corrected accordingly.

**Parked for later (not built)**
- A merchandise revenue stream: physical keepsakes printed from a baby's "moments" via print-on-demand (Printful/Gelato/Prodigi). Shipping address would come from checkout (Apple Pay payment sheet, or Stripe/Shopify), never from sign-in (Apple/Google return only name + email). Physical goods do not owe Apple's 15-30% cut, so it is a cleaner iOS revenue stream than the Pro subscription. Gating constraint: baby photos leaving to a third-party printer must be per-order explicit opt-in and disclosed.

**Platform**
- Service worker cache progressed `little-log-v78` -> `little-log-v82` over the session.

---

## v0.12.0 — 2026-06-14 — home day-surface, pregnancy privacy, routines, hardened sign-in

A warmer home screen, two more things moved off the circle-shared blob into owner-owned storage, gentle daily routines, and a tougher sign-in endpoint. All live on little-cubby.com (deploys from `main` via Cloudflare Workers Builds).

**Home day-surface (item 5)**
- The home screen now shows a per-day surface: today's notes, a gentle quote, and recent photos as polaroids. The old single shared "handoff" note was replaced by **per-day notes**.
- Notes are stored one-per-doc in `households/{hid}/notes/{noteId}` (no longer in the circle-shared app blob), each with an `audience`: `circle` (everyone in the household), a specific member uid (private to that one person), or the author. `firestore.rules` enforce read by audience/author; only the author can edit or delete. A one-time migration folds any legacy handoff note into a single `circle` note.

**Pregnancy journey privacy (item 7)**
- The pregnancy **journey** (stage, due date, weeks, appointments, kicks, contractions, birth plan, hospital bag, moments) moved out of the circle-shared app blob into an owner-owned doc `households/{hid}/pregnancy/{ownerUid}`, mirroring the maternal-health (mhealth) pattern. Readable by the owner plus the uids she lists in `sharedWith[]`, writable only by the owner; server-enforced in `firestore.rules` (`match /pregnancy/{owner}`).
- Maternal-private health stays separately owner-only in mhealth and is never swept into the journey. A legacy in-blob journey self-heals: the owner's client relocates it to the owner doc, then strips the blob on the next owner login. (The legacy blob journey was already circle-visible under the old design, so this is retroactive privatization, not a fresh leak.)

**Routines (item 8)**
- A gentle, per-baby, age-appropriate **routine list in the Log tab**. Tapping "done" writes a real log event (so it appears in the timeline/recap), authored by the person who taps it. No notifications, no server cron, no Blaze/Storage/Functions dependency: stays on the free tier.

**Sign-in & secrets**
- **Magic-link rate limiting in the Worker**: `POST /api/send-signin-link` is now rate-limited per IP (5 requests / 60s) via a Cloudflare Workers rate-limiting binding (`SIGNIN_RATE_LIMITER`), enforced right after the same-origin check, before any body or token work. Returns 429 + `Retry-After` when over budget, fails open if the binding is missing. Verified live. This replaces the previously-pending Cloudflare dashboard rate-limit TODO (now done in code, deploys on push) and complements the same-origin gate and per-email cooldown.
- **Resend API key rotated**; the new key lives only as the `RESEND_API_KEY` Worker secret, never in the repo.

**Rules & platform**
- `firestore.rules` published in the Firebase console, including the new notes + pregnancy blocks (mhealth + pro-lock rules unchanged).
- Service worker cache bumped to `little-log-v73`.

**Hardening**
- An adversarial review caught and fixed 4 defects before ship: (a) sign-out/teardown clears in-memory pregnancy + maternal-private health so it can't survive into the next account on an in-tab switch; (b) routine events are authored by the tapper and the un-tick is permission-guarded (no server-rejected "zombie" events); (c) the handoff->note migration is idempotent and authored by the writing owner.

**Still to do:** the founder's two-account cross-account privacy test; the deferred `app.pregnancy` rules guard (waiting ~a week for old v72 clients to drain); the deferred notes audience-immutability rule tweak.

---

## v0.11.0 — 2026-06-14 — one Cubby: pregnancy merged, mother-owned privacy, working email sign-in

The pregnancy track shipped into `main`, the brand consolidated to one lifecycle app, maternal health went private-by-design, and email sign-in actually delivers now. All live on little-cubby.com (deploys from `main` via Cloudflare Workers Builds).

**Lifecycle & brand**
- One Cubby across four stages (Trying -> Expecting -> Baby -> Child). "Mommy To Be" retired; the "Den" household hub parked (`FEATURES.den=false`).
- **Pregnancy tracker merged into `main` and live**: week-by-week, antenatal schedules (170-country coverage, verified UK/US/DE/UAE/CA/AU/NZ/IE + WHO-aligned fallback + a custom plan), opt-in health trackers (GDM/BP/supplements/nausea), kick counter, contraction timer, birth plan, hospital bag, Moments album, the birth transition, and a compassionate pregnancy-loss flow.
- Marketing: **Expecting/Baby audience framework** (pre-paint lifecycle-stage engine with entry-context routing, two-tab Features, Home "Expecting" section, Articles strip, Pregnancy nav). Lifecycle close "the only app you'll ever need, from two lines to big kid" on the home page and in the sign-in email.

**Privacy (Privacy Max 1.0, gate G1)**
- Maternal health moved **off the circle-shared blob** into `households/{hid}/mhealth/{ownerUid}/cat/{category}`: mother-owned, per-category consent, mood owner-only and never shareable. `firestore.rules` published in the Firebase console.

**Email sign-in (fixed)**
- Own Cloudflare Worker `POST /api/send-signin-link` mints the Firebase sign-in link (service-account JWT -> OAuth -> Identity Toolkit `returnOobLink`) and sends a branded email via **Resend** from `mail.little-cubby.com`. **Verified delivering to the Gmail inbox** (Firebase's built-in sender was being silently dropped). Hardened (same-origin Origin/Referer guard, normalized cooldown set after send); sign-in deeplinks rebranded to `little-cubby.com`.

**Vaccines & content**
- Vaccine catch-up (Phase 0.3): calm 5-state badges, no red "OVERDUE wall"; estimated catch-up dates tagged.
- ~180 articles live (baby + pregnancy clusters).

**Docs**
- `HANDOFF.md` now leads with a current-status + go-live section; `EMAIL.md`, `PRIVACY-MAX-1.0.md` updated.

**Still to do for full launch:** Cloudflare rate-limit rule on the sign-in endpoint; Pro billing go-live (Stripe, targeted Aug 2026); emulator cross-account test for the consent-sharing path; retire the merged `pregnancy-tracker` branch.

---

## v0.10.1 — 2026-06-12 — global content expansion + article naming policy

**Content**
- 15 new articles: India (5), Australia (5), Chinese parenting (3), global comparisons (2). Hub at 119 cards; sitemap at 125 URLs.
- **Article naming policy enforced**: titles use the practice name (maalish, zuo yuezi) or a universal topic (safe sleep, heatwave safety). No country qualifiers in h1/title/og:title. 12 existing articles renamed in place (slugs unchanged).
- Global expansion plan designed: 4 clusters (Common Ground, India+China, Australia+Japan, USA+Germany+Italy) covering ~125 more articles. Full queue in CONTENT-QUEUE.md.
- Cluster A (10 cross-cultural universals) established as the mandatory starting point so that all regional articles have a universal article to link up to.
- Deployment cadence design: pre-write full cluster, deploy at 4-hour intervals via cron; cron agent queue approach documented.

**Docs**
- CONTENT.md, CONTENT-QUEUE.md, CONTENT-RUNBOOK.md, SEO.md updated with current inventory, naming policy, global expansion plan, and international source hubs.

---

## v0.10.0 — early access (2026-06) — same-domain auth, growth loops, design system, content & Pro billing
Everything since the first close-group test build: a polished front door, a way to grow, a unified design language, a content engine, and the first paid tier wired end to end.

**Auth & accounts**
- Sign-in now runs on our **own domain**: `authDomain` to `little-cubby.com` via a `/__/auth` edge proxy (`worker.js` reverse-proxies the reserved Firebase `/__/*` namespace), so the Google popup says little-cubby.com, not firebaseapp.com.
- **Email magic-link sign-in** alongside Google (passwordless); auth-email domain state recorded in `EMAIL.md` (branded auth emails deferred to the ESP/Worker phase).

**Onboarding & first run**
- First-run polish: blurred home-preview backdrop behind a frosted setup card; **Log out** on onboarding + welcome modal; welcome modal is **non-dismissible** (no skipping setup); baby remains **mandatory**.
- **Welcome back**: returning members get Open Cubby CTAs + a welcome strip on the marketing home (no forced redirect).
- **Self-graduating copy**: welcome note + settings tag drop "beta" for "early access" automatically after 2026-07-27 (date-conditional, no manual edit).

**Growth**
- **Referral loop v1**: "Share Cubby" in Settings (native share + personal `?ref` link), ref capture on home + app, `referredBy` attribution on first sign-in (fresh households only); reward design lives in `PAYWALL.md`, no public promises.

**Design**
- Full **design pass** per `DESIGN.md` (the new design anchor): mobile nav fix (P0), unified SVG iconography, bottle-feed icon, type/breakpoint/token normalization, app framed on wide screens.
- **Wide-screen pass**: carousel v2 (consistent height, cropped in-use phone, slide bullets), mock glyphs emoji to house SVGs, wider containers at large widths, articles hub at 1060px; feature hierarchy + emoji policy documented.

**Content**
- **Articles hub** with search + topic/age filters, section headers, chip counts (chips wrap on desktop); **100+ articles** published (now 104+), plus editorial page, comparison rewrites (lead with Cubby's wins), and related links.

**SEO & accessibility**
- **BreadcrumbList** structured data everywhere, **per-page OG images**, and an a11y pass (focus rings, reduced-motion, `aria-hidden` mocks, contrast); E-E-A-T footer; iOS/Android install guide.

**Pro & billing**
- **Cubby Pro payment loop**: v1 Base pricing, entitlement + gated Base features, and a **Stripe billing Worker** (`workers/pro-billing`). Free-tier guardrails documented in `PAYWALL.md`/`PRO.md`.

**Docs**
- New `DESIGN.md` (design source of truth), refreshed `README.md`/`HANDOFF.md`, plus `PAYWALL.md`, `PRO.md`, and `EMAIL.md` updates.

## v0.9.0 — beta (2026-06) — first close-group test build
The full journey from a single-file local app to a shared, cloud-synced product.

**Platform**
- Cloud backend: Firebase Auth (Google sign-in) + Cloud Firestore real-time sync.
- One shared "household" per family; owner vs caregiver roles enforced by security rules.
- Hosted on Cloudflare (auto-deploys on push); installable PWA, offline-capable.

**Sharing & people**
- Invite by email (Copy link / mailto email button / relationship + co-owner).
- Remove member; first-run setup (pick your bear + relationship).
- Per-person and per-baby **bear avatars** (fur + accessory), changeable.
- Entry attribution — "logged by <relationship>" with the person's mini bear.

**Logging**
- Unified **time strip** across all flows (feed, diaper, sleep, pump, activity): one tap to set
  date + time via a custom warm picker.
- Sleep: live timer + past nap with "still sleeping (ongoing)" toggle; shared live timers.

**Health**
- Fever → see-doctor nudge (age-aware) + 24h home banner.
- Doctor-visit summary (last 7 days, copyable/shareable) + upcoming-appointment banner.
- **Growth charts**: WHO (0–24mo) + CDC (0–36mo) percentile bands with Boy/Girl selector and
  "latest ~Nth percentile" readout (data sourced from official CDC/WHO files).

**Beta**
- In-app **Send feedback** (Settings + 👨‍👩‍👧 menu) → Firestore `feedback` (read in console).
- New-user welcome/expectations note; version stamp (this file).

**Docs**
- `README.md` (architecture/data model/deploy), `HANDOFF.md` (resume guide), `EMAIL.md`
  (email scaling plan).

---
_Conventions: bump this file + `sw.js` CACHE on each release; see README §10._
