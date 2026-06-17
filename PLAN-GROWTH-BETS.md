# Growth bets: the leap from 8.3 to 9 and 10

Derived from the June 2026 in-app audits, validated against the live code (service worker v83, commit 1721927), then specced as plans only (no build yet). Dated 2026-06-17.

The small frictions the audits scored against are now mostly closed (the v83 deploy: Home quick-add, crafted date picker, region foods, country fallback, keepsake caption edit; plus a header switcher, country-derived growth standard, and a print-to-PDF that already existed). What remains is not bugs, it is five product bets. They fall into three clusters.

- Reliability: Push reminders.
- Keepsakes: Milestone library, then Auto-magic memories, then the Animated studio.
- Retention: the Child stage.

Cross-cutting principles: everything stays on the free Firebase Spark tier where possible; generation stays client-side (privacy-max, no third-party trackers); every surface passes the Anxiety Test (calm, opt-in, never guilt); deploy from main; bump the service worker CACHE on any app-asset change.

---

## 1. Push reminders (FCM) — effort L

Make "never miss a dose, a due vaccine, or your turn on a routine" true even when the app is closed. Today there is only an in-page `Notification('Medicine due')` that fires while the tab is open (useless at 3am with the phone in a pocket).

The unlock (the key finding): this ships on the FREE tier with NO Blaze. The Cloudflare Worker already mints Google service-account OAuth tokens (for the magic-link send). The same `getAccessToken(sa)` flow, with the scope swapped to `firebase.messaging`, sends via FCM HTTP v1 from a Worker cron. No Cloud Functions needed.

Scope (deliberately narrow, charter-driven):
- Medicine due (the one reminder users asked for), with Snooze and Log-dose actions in the notification.
- Confirmed-missed vaccine only (reuses the existing calm 5-state model; never fires on un-recorded "to confirm").
- Assigned-routine nudge to the right caregiver (the `assignee` uid already exists).
- Hard non-goal: no feed reminders. That is the anxiety machine we refuse to build.

Architecture:
- New `app/firebase-messaging-sw.js` (separate from the precache `sw.js`) with `onBackgroundMessage` and `notificationclick` routing into `/app/`.
- Tokens stored private in `users/{uid}.push` (rules already restrict that doc to the user). Per-device token map, pruned on 404/410. Quiet hours and opt-in are per-caregiver, never circle-shared (so NOT in the synced app blob).
- Worker `scheduled()` cron reads a small denormalized "due index" the client writes on persist (so the Worker only reads, never recomputes), then POSTs to FCM per token with quiet-hours suppression and a `lastNotified` dedupe.

The real later cost is NOT Blaze. It is Workers Paid (about 5 USD per month, 30s CPU) once active families exceed the free 10ms-CPU-per-invocation budget. Mitigate first by caching the signed OAuth token across the run and reading a due-index rather than scanning.

Phasing: P1 token capture + opt-in UX + push handler (M). P2 the Worker cron sender (L). P3 notification actions + per-type toggles + optional off-by-default "due soon" (M).

Charter and privacy: opt-in (off by default, earned via a one-line explainer), snoozeable, quiet hours default 9pm to 7am, copy never guilt-inducing. FCM is Google/Firebase (already our auth and DB provider), not an ad tracker, but disclose it in the privacy copy so "no third-party trackers" stays literally true.

Open decisions:
- iOS reach: web push only works for home-screen-installed PWAs on iOS 16.4+, silently absent in Safari tabs. Gate the opt-in on install state and be honest in copy; the App Store wrapper is the real fix.
- Cron cadence: hourly (a dose due at 8:20 could fire up to 40 min late) vs 15-minute for tighter dosing windows.
- May an overnight medicine override quiet hours (a 4-hourly antibiotic) versus "never wake her".
- When to flip to Workers Paid.

---

## 2. Milestone library — effort M (the data layer under the keepsake cluster)

Today: a 34-entry `MILESTONES` array, already month-indexed and category-grouped, already powering the "Around now, lots of babies are working on X" nudge, logging, and keepsake cards. The structure is right; the library is thin.

Honest reframe of "1000+": clinically-validated milestones (CDC 2022, WHO motor) total well under 100 across 0 to 5 years, and padding them is a YMYL anxiety risk. Delight or "firsts" milestones are open-ended and can reach several hundred. Target ~150 to 300 curated entries, split:
- CLINICAL: sourced (CDC/WHO), reassurance-only framing ("every baby in their own time"), never "behind", a gentle "when to check in" only where CDC has one.
- DELIGHT / FIRSTS: keepsake, no clinical weight, the emotional payoff.

The "1000 feel" comes from a generative firsts engine and context packs, not 1000 on-screen rows (which would be a chore and fail the Anxiety Test).

Context packs (from founder input): gate themed firsts on a tiny profile signal so each family sees only what is relevant.
- Pet pack, unlocked by a "Do you have a pet?" toggle plus optional pet name and type. Not a one-off: keep an ongoing "[Baby] and [Pet]" moment strand in the Album, personalised copy ("Mira and Rocky's first nap together"), feeding the auto-memories. Build this pack first; it is the most loved and most personal.
- Travel pack: first flight, first airport, first road trip, first holiday, first time at the sea.
- People pack (from the care circle): first met grandparents, first cousin meetup, first playdate.
- Seasonal/cultural pack, from the baby's country (we already do this for foods): first snow, first Diwali, first Christmas.

Data and architecture:
- Move the array to `app/milestone-data.js` (mirroring `growth-data.js` and `pregnancy-data.js`); add the script tag; precache it in `sw.js` and bump CACHE.
- Extend `{key, title, cat, mo}` additively with `type` (clinical|delight), `domain`, `band` ([minMo,maxMo] for clinical), `source`, `doctorNote`, `region`/`context` (for packs), `emoji`. No key changes, so existing logged records need no migration. Keep a `MILESTONES.md` source doc.
- UX: browse-by-age grouped view (auto-expand the baby's current band), default to delight with clinical kept lighter/opt-in, richer "around now" nudge, type-to-filter search (required past 7 items), a "firsts" keepsake feed, add-your-own.

Bug to fix while here: `unMilestone(key)` removes the moment from EVERY baby sharing that key; it must also match `babyId === state.activeBabyId`.

Powers all three keepsake/retention threads: richer nudges, auto-memories (a logged milestone becomes a card), and Child-stage retention (the library must reach 0 to 5 years, which is the whole retention point).

Phasing: P1 extract to data file + re-tag the 34 + fix the bug (S). P2 author the 150 to 300 set + browse-by-age + search (M, mostly content + sourcing). P3 the generative firsts engine + context packs (pet first) + the firsts feed (L).

Open decisions: target count (recommend 150 to 300), clinical-to-delight balance (recommend delight-forward), hand-curate vs license (recommend hand-curate from public CDC/WHO), keep capturing free (recommend yes), confirm 0 to 5 scope.

---

## 3. Auto-magic memories — effort L (glue over existing renderers)

Hand the mother a finished keepsake card instead of asking her to build one, using renderers that already exist (`composeMemoryCard`, `composePoster`, `drawThenNow`, `drawCollage`).

How it works: a pure `memoryCandidates()` reads state (events, milestones, photos, pregnancy moments) and returns typed suggestions. Surfaced in three existing places: a "Ready for you" rail at the top of the Memories tab; the month-iversary home pill upgraded to "your X-month card is ready" (auto-picks the photo); a "Make the card" action on the milestone nudge. Every card is a suggestion she accepts, tweaks, or ignores; dismissals persist via the existing `seen` flags so it never re-nags.

v1 ships with NO push (compute-on-open detection): zero infra, calmest default, free. A real monthly push is the Worker-cron + FCM path from bet 1, deferred.

Privacy honesty guardrail: do NOT claim "photos never leave your device". They already sync to the family's private Firestore. The honest line is "made on your device, kept in your family's private space".

Phasing: P1 detection + Memories rail (M). P2 gentle in-app surfacing + bump-to-baby Then and Now (M). P3 print hook (waitlist, per-order photo-leaves-device disclosure) + Pro/watermark split (M).

Open decisions: confirm no-push v1; the truthful privacy line; print CTA as waitlist for now; whether auto-cards are free-with-watermark or a Pro anchor.

---

## 4. Animated keepsake studio — effort: S is the bulk of value, M carries the hard part

Your latest ask (amazing templates, characters, fonts, balloons, animation). The studio (`composeShareCard`) is already a template engine (format + palette + font + template + stickers), so this extends, never rebuilds.

- Templates: add Birthday/Year-in-review, Announcement, and Seasonal-as-data (a `SEASONAL` config table, not code per holiday). Each template ships tasteful defaults with a hard decoration cap.
- Characters: reuse the existing `cubbyBear` SVG generator. The card features the baby's OWN chosen bear (a Cubby-only differentiator). Add accessories (party hat, balloon-in-paw, seasonal) by extending the existing `ACCS` set, no new illustration.
- Fonts: add 1 or 2 lazy-loaded display faces (cap at 2, subset). Hygiene item to do regardless: self-host the existing fonts (currently a Google CDN call) to honour "nothing leaves the device".
- Decorations: a composable SVG overlay (`drawDecor`) beside the existing emoji sticker layer: balloons drift, confetti falls, stars twinkle, deterministic from a seed so preview, video, and the printable still all match.

Animation, the honest split:
- (a) Animated in-app preview: cheap, ship for everyone. A `requestAnimationFrame` loop over the existing composer at preview resolution, capped ~30fps, paused when hidden, honours `prefers-reduced-motion`. This satisfies "make the images animate" with near-zero risk and is a free taste of delight.
- (b) Shareable animated artifact: the real cost. Sharing motion needs a video or GIF file. Recommended primary: MP4/WebM via `MediaRecorder` on `canvas.captureStream` (built-in, on-device, no library). iOS Safari is the risk (recent, flaky `MediaRecorder`, MP4-vs-WebM, share-sheet preview), so feature-detect and always fall back to a still. GIF only as a last-resort fallback (self-hosted encoder, large, banded). The static export stays the default share; video export is the headline Pro feature.

Phasing: P1 richer static studio + animated preview + characters + decorations + 1 font (S, most of the visible value). P2 shareable video via MediaRecorder behind feature-detect, with still fallback, Pro-gated, real-device iOS QA (M). P3 GIF fallback + extras (L, defer).

Monetisation: generous free taste (animated preview for all, a few watermarked stills, the baby's own bear); Pro unlocks the full template/character/font/decoration set, watermark-free, and the video export. A static "hero frame" of an animated card is still printable, so the parked merch stream is unaffected.

Open decisions: WebM-where-no-MP4 vs MP4-only; self-host fonts now (recommend yes); ship GIF fallback at all (recommend skip v1); free-taste count; clip length/fps (propose 6s/30fps); which seasons seed the table.

---

## 5. Child stage (retention) — effort L (the strategic one)

The baby tracker's value decays after about 12 months. Fix it with an age-derived Baby-to-Child MODE over the existing surfaces, not a new app.

- Derive `stageOf(baby)` from `babyMonths()` (Baby 0 to ~18-24mo, Child beyond). Persist only a tiny per-baby `childAck` and optional `stageOverride` in the existing app blob, so zero rules or schema change.
- Calm transition: when the baby crosses the threshold, a one-time dismissible, reversible card ("[Name] is growing up. Cubby is growing with them."). No setup wall.
- What shifts in Child mode: Quick-log reshapes (Feed/Diaper/Pump recede behind "more", never deleted, so a regression or illness still finds them; Measure (height-led), Milestone, Activity, Medicine, and a new Moment come forward); the today-strip calms to a weekly rhythm; milestones extend past 24 months (potty, dressing, counting, first day of nursery); a "School and care" card (childcare contacts, term notes, an allergy/emergency card to show a carer); the Health tab reframes as the lasting health record (the doctor PDF and vaccine history are the durable spine); the Album gains a yearly "Year in review" keepsake.
- Everything opt-in, editable, backdatable, reversible.

Child-stage reminders, if wanted, are a free Worker-cron + Resend opt-in EMAIL digest (a 4yr booster due, a gentle check-in), not Blaze, not assumed.

Phasing: P1 make the stage real (transition card + nav/copy/quick-log shift), which alone fixes the decay (M). P2 child content and surfaces (milestones past 24mo, school card, height-led growth) (M). P3 yearly keepsake + the optional email digest (M).

Open decisions: the Baby-to-Child threshold (recommend ~18 to 24 months); how far it reaches (preschool ~5 to 6yr vs "big kid"); ship with no notifications (recommend) vs the opt-in email digest; keep the stage free (recommend, keepsake and doctor PDF stay the Pro anchors); how much School-and-care is in v1.

---

## Recommended sequence

1. Milestone library P1 (extract to data file, fix the cross-baby bug) and start the curated set. It is the cheapest foundation, fixes a live bug, and everything else leans on it.
2. Auto-magic memories P1 to P2 (glue over existing renderers; high delight per effort).
3. Push reminders, in parallel as the reliability track (the free Worker-cron unlock).
4. Animated studio P1 (the visible wow at low risk), then P2 video as a Pro headline.
5. Child stage, the strategic retention play, once the milestone library reaches 0 to 5 years.

## Consolidated founder decisions

- Push: confirm free Worker-cron now; iOS reach (gate on install plus the wrapper); quiet-hours default and overnight-med override; Workers Paid trigger.
- Milestones: target count (~150 to 300), clinical-to-delight balance, hand-curate vs license, keep capturing free, confirm 0 to 5 scope, which context packs beyond Pet.
- Memories: no-push v1; the truthful privacy line; print CTA as waitlist; free-with-watermark vs Pro anchor.
- Animated studio: video format policy; self-host fonts now; GIF fallback yes/no; free-taste count; clip length; seasonal scope.
- Child stage: threshold age; reach; no-notifications vs email digest; keep stage free.

## Constraints honoured throughout

Free Spark tier (push and child-reminders run from the existing Cloudflare Worker, not Blaze); client-side generation (no image, video, or GIF leaves the device); no third-party trackers (self-host any encoder and the fonts); Privacy-Max (new fields sit in rules-governed docs; push tokens are per-user private; per-photo audience remains a separate, deferred decision); the Experience Charter Anxiety Test on every surface; YMYL care on all clinical content (sourced, reassurance-only, no diagnosis); deploy from main and bump the service worker CACHE on app-asset changes.
