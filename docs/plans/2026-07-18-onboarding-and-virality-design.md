# Onboarding across the journey, and the hook + virality audit

**Date:** 2026-07-18 · **Scope:** native iOS app (TestFlight build 7) first, PWA carry-over noted per item
**Method:** Product Board V2 (pods 2, 5, 6, 7, 10, 13, 14, 15 + Empty Chair system + mandatory Red Team)
**Anchors:** CUBBY-EXPERIENCE-CHARTER.md, DESIGN.md §A1/§A7, ONBOARDING.md, CUBBY-CUSTOMER-LENS-EXPERIENCE-MAP.md, PAYWALL.md

> Every recommendation carries an explicit charter check. Where the board wanted something the charter
> forbids, the charter won and the rejection is recorded. That is the point of writing it down.

> **Line-number caveat.** `app/index.html` was being edited by another process during this audit (it
> grew from 9242 to 9313 lines mid-session and `refCode()` moved from :3622 to :3697). Every citation
> below quotes an anchor — a function name or a string — so it stays findable if the numbers drift
> again. Re-verify before acting on an exact line.

---

## 0. The one-paragraph thesis

Cubby has one growth loop the charter actually permits, and it is the same object as its best
onboarding and its only honest retention hook: **the care circle**. An invited caregiver arrives into
a living household with a baby, a running nap timer and a day already logged, which is the best
first-run in the product and costs zero setup. A second logger is also the only thing that makes
"open the app and learn something you didn't know" true, which is the charter-safe alternative to
engagement push. And every invite seeds a household. So circle = onboarding = retention = virality, in
one object. It is also the most broken surface in the app: the invite is email-bound, the link is a
bare `/app/` URL identical for every family, the WhatsApp path fails **silently and destructively**,
the invitee lands on a cold marketing page, and once inside they get **no onboarding at all** because
the flags gating every coach mark are stored on the household rather than the person. Separately, and
just as cheaply fixable: in the shipped iOS build **every share button is invisible**, and the one link
designed to be pasted into a family WhatsApp group **has no unfurl preview**. Fix the circle and the
two native/link defects. Everything else is second.

---

## 1. Board session

### 1.1 Empty Chair personas (generated for this brief)

Seven product-specific personas, including one anti-user. These hold veto power.

| # | Persona | Situation | Propensity to pay | Deal-breaker |
|---|---|---|---|---|
| EC1 | **Meera, 31, Dubai** — first baby, 3 weeks post-partum, awake at 3am | Medium; would pay for the doctor PDF before a checkup | Being asked to learn anything at 3am. Any screen implying she is behind |
| EC2 | **Nadia's mother-in-law, 61, Kerala** — invited to the circle, WhatsApp only, low tech literacy | Never pays; her value is that she logs | An invite link landing her on a sign-in page with no idea who invited her or why |
| EC3 | **Tom, 34, Manchester** — non-carrying partner, opens the app twice a week | Low alone, high as a gift | Being treated as secondary. Copy assuming he is the mother |
| EC4 | **Priya, 29, Bengaluru** — 8 weeks pregnant, has told nobody, terrified | Low now, high at birth | Anything that shares, announces or counts down |
| EC5 | **Sam, 33, Toronto** — pregnancy after a loss, no journey opt-in | Medium | One celebratory card, one countdown, one "week 12!" push. A single breach and they delete the app |
| EC6 | **Ade, 27, Lagos** — arrived via a guest guessing-game link from a cousin | Unknown, never signed up | Being asked to make an account before seeing anything |
| EC7 | **ANTI-USER — Dr. Lin, 41, Singapore** — paediatrician, second child, uses a paper notebook | Would never install | Any app that feels like monitoring, or that pretends to give medical advice. Her rejection defines where Cubby must stay a *record*, not an oracle |

**Diversity check (Pod 13):** economic low/mid/high; tech literacy novice (EC2) to power (EC7);
emerging + developed geography; lifecycle first-time (EC4), returning (EC1), invited (EC2, EC3),
stranger (EC6), refuser (EC7); loss path (EC5); non-carrier (EC3). **Language and accessibility are
under-covered** and are flagged as an open gap (P2-5), not resolved here.

### 1.2 Pod critiques (only the parts with real tension)

**Pod 2 — Vision & Experience (Jobs, Chesky, Rams).**
Jobs: "You want onboarding at eight moments. That is eight chances to make her think. The answer is
one wizard and seven *reveals*." Rams: "A reveal you cannot dismiss forever is a dark pattern with
better manners." Chesky, on birth: "This is the 11-star moment in the entire product and you currently
ship a toast." **Accepted in full.**

**Pod 5 — Viral & Visualization (MrBeast, Yu-kai Chou, Tufte).**
MrBeast: "Where is the weekly shareable moment? Where is the streak?" Yu-kai Chou: "Core Drive 6
scarcity and Core Drive 8 loss-avoidance would double D7." **Rejected by the Moderator on charter
grounds.** Streaks are guilt with a progress bar; scarcity manufactures urgency at an anxious parent.
What survives: MrBeast's screenshot test applied to the *keepsake* (already the ambient engine), and
his simpler point that **a link with no preview card does not spread** — which turned out to be a real
live defect (V-11). Tufte: the away-recap is the highest information-per-pixel object in the app and is
below the fold.

**Pod 6 — Growth & Strategy (Lenny, Casey Winters).**
Lenny: "Your loop is: parent invites caregiver → caregiver logs → parent opens and feels relief →
parent invites again. It is real and it is severed at step one." Casey: "Supply side first. One
excellent invite beats five new share surfaces." **Accepted. This is the P0.**

**Pod 7 — Human Behavior (Eyal, Huberman).**
The Hook Model applied honestly: the trigger must stay *internal* ("did I already feed her?"), because
external triggers here are spam. Investment is the log. **Accepted with a constraint:** Cubby's
variable reward must never be variable *scarcity*; it is variable *content* (what did the circle do,
what does this week hold), which is calm.

**Pod 10 — Rockstar Design (Julie Zhuo, Jon Yablonski).**
Zhuo: "You cannot measure any of this. No third-party analytics by promise, and your own attribution
writes `referredBy` and never reads it — worse, it is a one-way hash with no reverse index, so it is
not merely unread, it is *unreadable*." Yablonski: "Four coach marks into one screen after birth is a
Miller's Law violation. Queue them." **Both accepted.**

**Pod 14 — Growth Intelligence (Elena Verna, Andrew Chen).**
Verna: "What first-session action predicts 30-day retention? For Cubby it is almost certainly *a second
member joins within 7 days*, not first-log. Instrument that one number and nothing else." Chen: "Your
atomic network is a household of two. Below two it is a notebook; above two it is a network with real
switching cost." **Accepted as the north-star activation metric.**

**Pod 15 — Red Team & Trust.** See §1.4.

### 1.3 Empty Chair scorecard (current build, as audited)

| Persona | Discover | Sign up | Onboard | Aha | Pay | Tell someone | Weighted |
|---|---|---|---|---|---|---|---|
| EC1 Meera | 7 | 8 | 7 | 8 | 6 | **4** | **6.6** |
| EC2 Mother-in-law | 5 | **2** | **1** | 6 | n/a | 3 | **3.2** |
| EC3 Tom (partner) | 6 | 7 | **3** | 6 | 4 | 5 | **5.1** |
| EC4 Priya (early preg) | 8 | 8 | 6 | 6 | 4 | **2** | **5.7** |
| EC5 Sam (after loss) | 6 | 7 | 7 | 7 | 5 | 3 | **6.0** |
| EC6 Ade (guest link) | **4** | **1** | **1** | 5 | 1 | 6 | **3.0** |
| EC7 Dr. Lin (anti) | 5 | 2 | 2 | 3 | 1 | 2 | 2.5 (expected) |

*EC1's "tell someone" dropped to 4 and EC6's "discover" to 4 once the native audit landed: on the
iOS build she cannot find a share button at all (V-9), and the link that would have reached him has no
preview card (V-11).*

**Threshold is 6.0. Three personas fail: the invited caregiver (3.2), the guest-link visitor (3.0),
and the non-carrying partner (5.1).** All three are *circle* personas. This is the quantitative form
of the thesis.

### 1.4 Red Team, three rounds

**Round 1 — Business kill.** A privacy-first app with no analytics that also cannot tell whether
onboarding worked. You will ship reveals and never know if they helped, and the one attribution field
you do write is an irreversible hash with no lookup table. *Mitigation:* P1-6 — one first-party,
user-owned activation counter plus a reverse index for referral codes. No third-party anything.

**Round 2 — Trust kill.** Three findings.
(a) **High.** `state.settings.seen` is written into the **circle-shared** household blob. Coach marks,
tips, the get-started checklist and memory dismissals are therefore shared. This is not only an
onboarding bug, it is a low-grade information leak between circle members (whether a given person has
dismissed a given hint), and it is the exact mistake `lossHolding` was deliberately restructured to
avoid. The quick-log preference code already documents the correct per-uid-in-localStorage pattern.
(b) **Medium.** The invite copy coaches the recipient out of Apple's privacy default ("with Apple,
choose Share My Email so it matches"). A privacy-max brand should not be talking users out of Hide My
Email. This is a *design* constraint, not a copy fix: the invite must stop keying on email.
(c) **Medium.** Voice logging opens the mic on the very first tap with no priming — on iOS this fires
the OS microphone permission dialog cold, with the explanation appearing only *after*. For an anxious
parent this is the worst possible ordering, and a denial is effectively permanent.

**Round 3 — System kill.** Two Critical findings.
(a) The WhatsApp invite path fails **silently and destructively**. The copy button yields only the bare
`/app/` URL, with no token and no instructions. A grandmother who signs in with any address other than
the one the owner typed does not get an error: she is provisioned a **brand-new empty household**. She
concludes Cubby is broken, the owner concludes she ignored it, and there is no recovery except
re-inviting the exact right address. This single defect is credibly suppressing the very metric Pod 14
wants to optimise.
(b) On the shipped iOS build, **`navigator.share` does not exist in WKWebView**, and every share button
in the app is conditionally rendered on it. So the App Store build hides its own primary share CTA —
even though the unified `saveFile()` path would land on the native share sheet perfectly. The comment
acknowledging WKWebView's lack of `navigator.share` sits a few hundred lines from the gates that
depend on it.

### 1.5 Decision log

**Validated**
- The circle is the loop. Onboarding, retention and virality are one problem.
- The existing cue toolkit (`coachMark`, `tipLine`, `dismissTip`, `state.settings.seen`) is the right
  substrate. Nothing new needs inventing; it needs scoping per-user and scheduling.
- Push staying medicine-only is correct, is enforced in code, and is *not* the retention answer.

**Nuked**
- "Onboarding wizards across the journey" read as *more wizards*. One wizard survives. Every other
  moment is a single dismissible reveal or one screen at a genuine threshold.
- Streaks, scarcity, FOMO, comparison, engagement push. Rejected on charter grounds, on the record.
- "Discovery is the problem." Voice is already a quick-log tile in all three stages; the reads engine,
  the milestone rails and the journey library are all live. The problem is **arrival and orientation**,
  not discovery.

**Low-propensity zones**
- EC4 (early, secret pregnancy) will never share. Do not build sharing prompts into early pregnancy.
- EC5 (after loss) must be excluded from every share, reveal and celebration surface.
- EC2 will never pay, correctly; her value is that she logs, which retains EC1, who pays.

---

## 2. Audit findings

Verdicts: **real** = confirmed live defect or gap · **partial** = works but incomplete ·
**stale** = previously reported, now fixed · **works** = no action.

### 2.1 Onboarding

**Framing correction:** `openFirstRun` is *not* the wizard — it is only the identity step. The actual
wizard is a four-part chain across two files: `renderOnboard` (stage picker) → per-stage setup sheet →
`collectIdentity` → `openOnboardInvite`. Plan changes against the chain, not the function.

| # | Finding | Evidence | Verdict |
|---|---|---|---|
| O-1 | **Onboarding state is circle-shared, not per-user.** `state.settings.seen` gates every coach mark, tip, the get-started checklist and the install nudge, and `state.settings` is written to and read from the shared household blob (only `theme` is per-device). The second, third and fourth caregiver receive **zero onboarding** — whoever arrives first burns it for everyone. | `app/index.html` `coachMark` / `tipLine` / `dismissTip` (`state.settings.seen[...]`); `app/store-firebase.js` blob write `settings: state.settings` and read-back with the `localTheme` exception. Correct per-uid pattern already exists at `myLossHolding()`; correct per-user-prefs pattern documented in the quick-log comment | **real (P0)** |
| O-2 | **The birth transition ships a toast.** `welcomeBaby()` pushes the baby, sets `view='home'`, persists, renders, toasts. The app changes shape underneath the parent — pregnancy's 3-tab nav (Home/Moments/Care) is replaced by the baby nav, quick-log tiles change, Health and Album appear — with no orientation, at the most exhausted moment in the journey. | `app/index.html` `welcomeBaby()`; pregnancy nav in `renderPregShell`; `QUICK_DEFAULTS` per stage | **real (P0)** |
| O-3 | **Post-birth, the app greets a nine-month user with "Welcome to Cubby 👋".** Coach marks are keyed by baby-tab name and never rendered during pregnancy, so the flag is unset. A parent who has used Cubby daily since week 6 is welcomed as a stranger, hours after giving birth. | `app/index.html` `coachMark('home','Welcome to Cubby 👋',…)` | **real (P0)** |
| O-4 | **Four coach marks plus the get-started checklist can fire in one post-birth session**, unqueued. Home suppresses its own mark when the checklist shows; Log, Album and Health coordinate with nothing. | `coachMark('home'…)` (`gsCard ? '' : …`), `coachMark('health'…)`, `coachMark('album'…)`, `coachMark('log'…)` | **real (P1)** |
| O-5 | **Expecting and Trying have no onboarding after setup.** `renderGetStarted` has exactly one call site — the baby home. `renderPregHome` and `renderPlanningHome` have no checklist, no coach marks, no first-use guidance on any of their three tabs. No coach mark exists for Den, Moments, Stats, or any pregnancy surface. | `renderGetStarted` (definition + sole call site in the baby home), `renderPregHome`, `renderPlanningHome`, `renderDenHub` | **real (P0)** |
| O-6 | **The tips ticker is baby-only, unscheduled and the only guidance surface with no "seen" state.** Five hardcoded tips cross-fading every 5.5s, gated on `activeBaby()`, never dismissible, never marked seen. It repeats the same five hints forever. | `tipsTicker()` (`const b=activeBaby()`, fixed array, `startTipCycle`) | **real (P1)** |
| O-7 | **Stats has no empty state.** `renderStats()` unconditionally computes 7-day averages. A brand-new parent with zero events sees `0.0 Avg feeds / day`, `0.0h Avg sleep / day`, `0.0 Avg diapers / day` and three flat charts. No guard, no copy. | `renderStats()` | **real (P1)** |
| O-8 | **Voice logging opens the mic before it explains itself.** `openVoiceLog()` immediately calls `beginListen()`. On iOS this triggers the OS mic permission prompt cold; the explanatory subtitle and examples render *after*. Denial is effectively permanent. | `app/voice-log.js` `openVoiceLog()` → `beginListen()`; subtitle "Just say what happened and Cubby writes the entry." | **real (P1)** |
| O-9 | **"Baby has arrived" is un-gated by gestational week.** The button renders identically at week 8 and week 41, and there is no proactive near-term or past-due prompt. | `app/index.html` pregnancy Week view and pregnancy settings ("🐻 Baby has arrived") | **real (P2)** |
| O-10 | **Re-engagement does not exist, and cannot.** No last-open timestamp is recorded anywhere — grep for `lastSeen`/`lastOpen`/`lastActive`/`daysSince` returns nothing relevant. There is no mechanism that *could* detect absence. `awayRecap` is the nearest thing and is same-day only. | `awayRecap()` (`dayKey(e.time)===todayK`, `others.length<1` guard) | **real (P1)** |
| O-11 | **The invitee gets one modal, and a cold landing page before it.** `landing.js` is completely invite-unaware: an invitee arriving from a partner's WhatsApp link sees the identical cold-acquisition marketing page as a stranger. After joining, `resolveHousehold()` silently joins them; the entire onboarding is the standalone locked welcome modal. Role permissions (owner-only mood, owner-only pregnancy actions) are never surfaced. Compounded by O-1. | `app/landing.js` `cubbyLanding()` (no invite branch), `app/store-firebase.js` `resolveHousehold()` (silent join), `openFirstRun` standalone variant | **real (P0)** |
| O-12 | **Invite `status:'pending'` is written and never read.** The inviter has no acceptance feedback and cannot tell a pending invite from an ignored one. | `submitInvite()` writes `status:'pending'`; no reader anywhere | **real (P2)** |
| O-13 | **Baby → Child is one dismissible pill** despite silently reshaping the quick-log grid from 7 actions to 5 (feed/diaper/pump move behind "More"). Calm and reversible, but the pill carries a lot of weight and surfaces no undo. | `app/index.html` child alert pill, `ackChild()`, `setStageOverride()`, `QUICK_DEFAULTS` | **partial** |
| O-14 | **The first-run wizard is correctly ordered.** Stage chooser over a blurred live preview → details → identity as a forward step (not a modal over the picker) → invite. Relationship label adapts by stage so it never asks "relationship to baby" before a baby exists. The G1 "nonsensical gate" is fixed. | `renderOnboard`, `obPreview`, `maybeFirstRun` (defers via `needsIdentity`), `collectIdentity`, `openOnboardInvite` | **stale (fixed)** |
| O-15 | **The loss-safe holding state is real and correctly per-uid.** `renderLossHolding` pre-empts the upbeat chooser; `myLossHolding()` is uid-scoped so one member's grief never broadcasts. Planning "stop tracking" is deliberately excluded from the bereavement screen as "a neutral pause, not a loss". | `renderLossHolding`, `myLossHolding`, `endPregnancy` | **works** |
| O-16 | **The guided install overlay is thorough.** Three correct branches (Android native prompt / in-app webview with host detection / iOS Safari step-by-step), and `canShowInstall()` vetoes on `isNativeApp()` first, so an installed app is never told to install itself. | `openInstall()`, `canShowInstall()`, `addToHomeScreen` alias | **works** |

### 2.2 Virality and sharing

| # | Finding | Evidence | Verdict |
|---|---|---|---|
| V-1 | **The invite is email-bound and the link carries nothing.** The invite doc is keyed on the lowercased recipient email; the link handed to the owner is `location.origin + '/app/'` — no token, no id, no ref, no deep-link param, **identical for every invitee of every family**. Matching happens purely by email at sign-in. | `submitInvite()` (`invites.doc(email)`, `var link = location.origin + '/app/'`), `resolveHousehold()` email lookup | **real (P0)** |
| V-2 | **The WhatsApp path fails silently and destructively.** `copyAppLink` copies only the bare URL — no instructions, no email requirement. A mismatched sign-in provisions a brand-new empty household rather than erroring. Apple's private relay breaks it by default. | `copyAppLink()` (copies `inp.value` only); new-household creation in `resolveHousehold()` | **real (P0)** |
| V-3 | **The invite has no native share sheet.** `submitInvite` offers only a `mailto:` handoff plus the bare copy — on a platform where the share sheet is the idiom and `mailto:` in WKWebView is the worst available option. | `submitInvite()` (no `navigator.share`; `mailto:` branch) | **real (P0)** |
| V-4 | **The invite copy coaches users out of Apple's privacy default** ("with Apple, choose Share My Email so it matches"). Off-brand, and a symptom of V-1. | `submitInvite()` mailto body | **real (P1)** |
| V-9 | **Every share button is invisible in the shipped iOS app.** All five share CTAs are gated `${navigator.share ? '<button…>' : ''}`, and `navigator.share` does not exist in WKWebView — the codebase says so itself in a nearby comment. Meanwhile `saveFile()` → `nativeSaveFile()` (Filesystem write + `Share.share`) works perfectly. **Native users see only "Download" and never see the primary viral action.** One predicate (`navigator.share \|\| isNativeApp()`) fixes it. | Share-button gates on the composed card, video export, keepsake, memory card and Then-vs-Now; `saveFile()`; `app/native-bridge.js` `nativeSaveFile()`; the WKWebView comment | **real (P0)** |
| V-11 | **The guest game link has no unfurl preview.** `/g/<code>` is explicitly designed to be pasted into family WhatsApp and iMessage groups, and the page carries `<meta name="robots" content="noindex">` with **zero `og:` or `twitter:` tags**. It renders as a bare URL with no title, no image, no description. The most viral artifact in the product does not look like anything. | `g/index.html` head (noindex, no og/twitter meta) | **real (P0)** |
| V-5 | **The guest page dead-ends.** It is Cubby's only surface a stranger can reach with no account, it now has native share (the old S2 gap is fixed), the D1 backing it is provisioned and the routing is live — and its entire conversion path is a 12px footer link reading "Made with Cubby" pointing at `/`, with no CTA and no ref code. | `g/index.html` footer; `worker.js` `/g/*` route; `wrangler.toml` `GAMES_DB` provisioned | **partial (P0 opportunity)** |
| V-6 | **`referredBy` is write-only, and structurally unreadable.** Capture works on both the marketing site and in-app and is stamped onto the new user's doc. Nothing reads it — not the app, not `firestore.rules`, not `tools/ops.js`, not `tools/analytics.js`. Worse, `refCode()` is a one-way djb2 hash of the uid with **no reverse index**, so a stored code cannot be mapped back to a referrer without recomputing the hash over every uid. | `refCode()`, `shareCubby()`, capture in `index.html` and `app/index.html`, write in `store-firebase.js`; repo-wide grep for `referredBy` returns only the write path | **real (P1)** |
| V-7 | **The referral ask has one caller, in Settings.** `shareCubby()` composes good, truthful, ref-tagged copy and is reachable from a single Settings row — absent from every pride moment. | `shareCubby()` definition and sole call site | **real (P1)** |
| V-12 | **No viral surface carries provenance.** None of the three loops (invite link, game link, watermark) emits a UTM or feeds `.acq`, so a referred signup appears in the funnel as organic. Invite conversion is measurable only in aggregate, by inferring household ids from the `invites` collection. | `submitInvite()` link, `gameLink()`, `drawCubbyFooter()`; `tools/analytics.js` reads `acq` but never `referredBy` | **real (P1)** |
| V-8 | **The keepsake watermark works.** Canvas-drawn "made with Cubby · little-cubby.com" across five call sites, all correctly gated on `!isPro()`, explained inline before the first share, and drawn rather than emoji so it renders identically everywhere. | `drawCubbyFooter()` + five gated call sites; the pre-share explanation | **works** |
| V-10 | **The watermark is pixels, not a path.** No hyperlink, no QR, no ref code. Someone who sees a card on Instagram must type the domain by hand. Note the asymmetry: the low-volume `shareCubby()` bothers to append `?ref=`; the high-volume watermark does not. | `drawCubbyFooter()` text | **partial (P2)** |
| V-13 | **Universal links, AASA and the deep-link router all work.** AASA is served with the correct app id and `/app/*` components; `appUrlOpen` routes into `runDeepLink`; the intent survives the sign-in redirect via `sessionStorage` and strips only its own keys. It is simply **unused** — nothing in the app or the ~600-page article library generates a link back into it. | `worker.js` AASA, `app/native-bridge.js` `appUrlOpen` → `routeDeepLink`, `stashDeepLink`/`runDeepLink` | **works, unused** |
| V-14 | **The Moments → Journey book is unbuilt.** Phase 1 (the free guided journey library) shipped; the shareable artifact — the whole point of the loop — does not exist. The doc's "view free, take it Pro" boundary is currently unenforceable because there is nothing to take. | `docs/plans/2026-06-24-moments-journey-book-design.md` status line; `renderJourneyLibrary()` exists, no book/slideshow export anywhere | **partial** |
| V-15 | **The doctor report is unbranded.** A printout handed to a paediatrician — a high-trust, high-intent moment — carries one prose mention and no link, logo or mark. | `openPrintable(...)` doctor-report composition | **partial (P2)** |
| V-16 | **Zero test coverage on any viral surface.** `test/`, `tools/smoke.js` and `tools/uitest.js` return no hits for `refCode`, `referredBy`, `cubby-ref`, `/g/` or `shareCubby`. | as stated | **real (P2)** |

### 2.3 Hooks and retention

| # | Finding | Evidence | Verdict |
|---|---|---|---|
| H-1 | **Push is live, server-side, and unusually careful.** A 15-minute cron reads a client-computed per-user due index and sends via FCM HTTP v1, advancing `sentUpTo` so nothing resends. Medicine only, in code and in copy ("never for feeds, naps or milestones"). Two independent quiet-hours filters (client, which knows the timezone; and server). **Staleness guards drop a dose reminder whose time has passed and a digest more than 20 minutes stale**, so a parent returning after a week never gets a burst of backlogged pings. Off means off: disabling clears the flag, deletes the token map and calls the native disable. | `wrangler.toml` crons; `worker.js` `scheduled()` → `sendPushReminders`; `app/index.html` `syncReminderIndex()`, `pushCfg()`, `disablePush()`; `/api/health` heartbeat | **works** |
| H-2 | **iOS push is dormant.** The APNs `.p8` upload is still listed as REMAINING in the native-wrapper runbook, and `ios/App/App/App.entitlements` has `aps-environment = development` (the sandbox value). Until the key is uploaded — and unless the distribution profile promotes the entitlement — **every iOS reminder is a no-op in release builds**. | `docs/plans/2026-07-15-native-wrapper-app-store.md` REMAINING section; `ios/App/App/App.entitlements`; `tools/cap_ios_configure.rb` | **real (P0 for the native release)** |
| H-3 | **The push payload is web-only.** The FCM message sets `webpush.fcmOptions.link` and no `apns` block. Taps on native open the app cold rather than the dose, even though the router could target it and `notificationActionPerformed` is already wired. | `worker.js` FCM message body; `app/native-bridge.js` notification-tap handler | **real (P1)** |
| H-4 | **Local notifications are absent entirely.** `@capacitor/local-notifications` is in neither `package.json` nor the SPM manifest. Every reminder is server-round-trip dependent, so an offline device with a due dose gets nothing — even though the client already computes exact fire times. Scheduling these locally would make medicine reminders work offline **and remove the APNs dependency for the on-device case**. Charter-safe: same medicine-only scope. | `medFireTimes()` computes the times; no local-notifications plugin anywhere | **real (P1), dormant capability** |
| H-5 | **Native push permission is correctly deferred.** The bridge only fetches a token when permission is *already* granted and exposes an explicit enable for the Reminders toggle. No cold-start prompt. | `app/native-bridge.js` `checkPermissions()` path, `cubbyEnableNativePush` | **works** |
| H-6 | **`awayRecap` is the best retention object in the app and it is same-day only.** It renders "Today so far 🐻" from other members' entries with a "logged by Mama Bear" byline, and suppresses the greeting sub and tips ticker when it fires. But it filters to today, so a parent back from a weekend sees nothing, and it only ever fires when a second member exists — the whole argument for the circle. **No weekly recap exists either.** | `awayRecap()`, `dayRecapText()`, `daySurfaceRecap()`; no `weekRecap` anywhere | **real (P1)** |
| H-7 | **Pregnancy has no week-turn moment.** The week silently increments. No stored "last week seen", no acknowledgement, no card. This is the highest-value, most obviously charter-safe hook that does not exist. | `renderPregHome`, `app/pregnancy-data.js` weeks 4-41; no `weekTurn`/`lastWeekSeen` anywhere | **real (P1)** |
| H-8 | **A guest guessing is invisible.** The one genuinely newsworthy, non-manufactured external event in the product produces no signal: `loadHubState()` only runs when the sheet is already open, and the home entry point's summary line counts only in-circle guesses, so it does not move when a guest plays. | `openGuessGame()`, `loadHubState()`, `guessSummaryLine()`, the pregnancy home games card | **real (P1)** |
| H-9 | **Rituals are best-in-class charter compliance.** `X of 7 🌿` over a rolling week, header copy "A gentle look back, never a streak to keep. A quiet day is always allowed, and a gap is a chapter, not a failure." No red anywhere; unfilled dots are `--surface-2`, today gets a ring not an alarm. History trimmed to ~14 days so there is no long streak to mourn. No notifications of any kind. | `renderRitualRhythm()`, `renderRoutines()`, `ensureRoutines()`, the ritual-dot CSS | **works** |
| H-10 | **The home changes less day to day than it appears.** The reliable daily-change elements are the quote of the day (30 entries, stable per date so the whole circle sees the same line) and the day surface. The good-read card is stable **per week for pregnancy and per month for baby** — a three-month-old's parent sees the same card for ~30 days. | `DAY_QUOTES`/`quoteOfDay()`, `daySurface()`, `goodReadCard()`/`readsPos()` | **partial (P2)** |
| H-11 | **The home nudge line is genuinely good, and baby-only.** Time-aware, warm, never guilt ("The 3am club 🐻, you've got this"). Returns empty with no active baby, so Expecting and Trying get no equivalent. | `homeNudgeLine()` (`if(!b) return ''`) | **partial (P1)** |
| H-12 | **The pregnancy home refuses countdowns on purpose**, leads with a qualitative week plus size, and has a no-numbers quiet mode and after-loss softening. Week-gated tools (kicks ≥28, contractions ≥36) are commented as deliberate because "a 'count movements' tile too early only worries". Exemplary; do not regress. | `renderPregHome()` no-countdown comment, `pregNoNumbers()`, `pregAfterLoss()`, tool gating | **works** |
| H-13 | **The monthiversary card waits 14 days for the parent** rather than flashing for 24 hours. Correct empathy; the reference pattern for every time-boxed reveal. | `monthiversary()` + the alert pill | **works** |
| H-14 | **Stats and growth charts are reassuring, not anxious.** Self-relative bars with no target overlay and no cross-baby comparison; percentiles clamped to `<5th`/`>95th` and hedged with a tilde; bands de-emphasised; empty heatmap days read "nothing logged"; footer says "A guide, not a diagnosis". **One flag:** a negative weight/height delta renders in `var(--med)`, the medicine/alert colour, so a normal fluctuation reads as a warning. | `renderStats()`, `renderHeatmap()`, `estPercentile()`, growth footer; `renderGrowthSection()` delta colouring | **works, one P2 flag** |
| H-15 | **Milestones are beautifully framed and passively surfaced.** 225 entries split clinical/delight; the nudge reads "Around now, lots of babies are working on 'X'. Every baby in their own time." Section headers say "{n} ideas", never "{n}/{total}". But a reached milestone only produces a home nudge for 3 days and only if it wins the priority chain, so milestones do not pull anyone back. | `app/milestone-data.js`, MILESTONES.md framing, `renderNudge()`, `glSuggested()`, `glMarkedList()` | **works, P2 opportunity** |
| H-16 | **Voice logging depends on the Web Speech API**, which WKWebView does not reliably expose, while Pro copy promises "hands-free voice logging". If absent in the shipped build, the headline Pro feature silently degrades to typing in the exact binary on the App Store. **Needs device verification before the next Pro copy review.** | `app/voice-log.js` `speechSupported()`; Pro sheet copy | **real (P1), unverified on device** |
| H-17 | **Two stale comments** that will mislead the next reader: the in-app note claiming the games D1 is unprovisioned (it is provisioned in `wrangler.toml`), and the retired baby-stage prompt-rail comment. Also `CUBBY-MASTER-HANDOFF.md` is referenced in the memory index but does not exist — the file is `HANDOFF.md`. | `app/index.html` games "dormant" comment; `wrangler.toml` `GAMES_DB`; repo root | **real (P2), doc drift** |

---

## 3. The onboarding system across the journey

### 3.1 Principles (extends ONBOARDING.md, does not replace it)

1. **One wizard, many reveals.** First run is the only multi-step flow.
2. **A threshold earns a screen; everything else earns a line.** Only two events change what the app
   *is*: joining a circle, and birth. Those get a screen. Nothing else does.
3. **Per-person, always.** Onboarding state is a property of a person, never of a household.
4. **One at a time, queued.** At most one reveal per session, ever.
5. **Dismissible forever, in one tap, no confirmation.**
6. **Never re-teach a returning user.** A parent nine months in is not new.
7. **Loss-safe and stage-gated.** Every reveal checks `myLossHolding()` and stage before rendering.
8. **Nothing is a prerequisite.** Skipping any reveal leaves the app fully usable.
9. **Explain before you ask the OS.** Any reveal that precedes a system permission prompt (mic, push,
   photos) must state the why *before* the dialog, never after.

### 3.2 The moment map

Each moment: trigger · surface · copy direction · how it ends · skippable · success signal · charter check.

---

**M1 · First run (owner) — SHIPPED, keep**

- **Trigger:** authenticated, no baby and no pregnancy.
- **Surface:** the four-part chain — stage chooser over the blurred live preview → stage details →
  identity step → invite finish.
- **Copy:** unchanged. "Where are you on the journey? Pick what fits today."
- **Ends:** on `setupDone`. **Skippable:** details are minimal, everything editable later. The identity
  modal is deliberately locked; that is defensible because a nameless member breaks circle attribution.
- **Success signal:** reaches home within 3 minutes.
- **Charter check:** passes. The blurred preview shows the destination before the setup, serving self
  #1 (celebrate quietly, not administratively).

---

**M2 · First run (invitee) — MISSING, P0**

- **Trigger:** invite accepted, this uid newly in `members`, no `setupDone`.
- **Surface:** an invite-aware landing *before* sign-in, then one screen after. Not a wizard.
- **Copy:** three things and nothing else. *Who* ("Meera asked you to join Aarav's Cubby"), *what
  you'll do* ("Anything you log shows up on her phone straight away"), *what you can't see* ("Meera's
  own health notes and how she's feeling stay private to her, always"). Then name + bear.
- **Ends:** on name saved. **Skippable:** the privacy line is informational.
- **Success signal:** invitee logs one entry within 24 hours.
- **Charter check:** passes, and actively serves the safe-space contract by stating the privacy
  boundary *to the person it constrains*, where it is most credible. Truthful-copy: verify the claim
  against `firestore.rules` before shipping, per the DESIGN.md "why we ask" precedent.

---

**M3 · The invite moment (inviter side) — BROKEN, P0**

- **Trigger:** owner taps invite, from first run or Settings.
- **Surface:** one tokenised link plus the native share sheet. Plus an acceptance state in the family
  list so the inviter knows whether it landed (O-12).
- **Copy:** the message must carry its own context, because a tired person will paste it into WhatsApp:
  "I've added you to Aarav's Cubby. Tap to join." Nothing about email addresses.
- **Ends:** share sheet dismissed. **Skippable:** yes, and it must be — first run must never block on
  inviting.
- **Success signal:** the Pod 14 north star — **share sheet opened → second member joined within 7 days**.
- **Charter check:** passes. Removing the email requirement also removes the Hide My Email coaching
  (V-4), strengthening the privacy promise rather than trading against it.

---

**M4 · First use of a major surface — PARTIAL, P1**

One coach mark per surface; built for four baby tabs, missing everywhere else.

- **Trigger:** first render of that surface *by this user*, and only if no other reveal fired this session.
- **Needed on:** pregnancy Home, Moments, Care; child-stage home; the keepsake studio; the games hub;
  Rituals; Stats.
- **Copy:** what this place is *for*, one sentence, second person. Never "tap the button". The existing
  four are the right voice and length.
- **Ends:** "Got it", persisted per-uid. **Skippable:** inherently.
- **Success signal:** dismissal rate above 80% within two sessions. A low rate means it is noise people
  scroll past.
- **Charter check:** passes only with the session queue. Four at once fails the Anxiety Test.

---

**M5 · Stage transition: Trying → Expecting — PARTIAL, P1**

The mechanics are already good (`openPositiveTest` seeds the antenatal schedule and hospital bag, and
frames a home test responsibly). What is missing is the landing.

- **Trigger:** `confirmPositiveTest` completes.
- **Surface:** one card on the new pregnancy home. Not a wizard.
- **Copy:** celebrate quietly, per self #1. One line, no task list. "Two lines. 🤍 Cubby has shifted to
  your pregnancy — everything you'd set up is still here, and your first visits are already pencilled in."
- **Ends:** dismissed. **Skippable:** yes.
- **Success signal:** returns within 48 hours.
- **Charter check:** must be *quiet*. No confetti, no "your journey begins", nothing that would read as
  cruel if the pregnancy later ends. Loss-safety here is prospective.

---

**M6 · Stage transition: Expecting → Baby (birth) — BROKEN, P0**

The single most important moment in the product.

- **Trigger:** `welcomeBaby()` completes.
- **Surface:** a full-screen arrival moment, then the baby home with **all coach marks pre-dismissed
  except one**.
- **Copy:** the screen says one thing and does one thing. Close to: *"Welcome to the world, Aarav. 🐻
  Your pregnancy is saved as part of his story."* Then one orienting sentence: *"Cubby has changed
  shape for him. Feeds, sleep and nappies are on your home screen now, and his vaccine plan is ready in
  Health."* Then one button: "Take me in."
- **The vaccine reveal is the payload.** Country and birthday are both known at this instant, so the
  full country-correct schedule with real dates exists the moment she taps through. Naming it here
  converts setup into proof at minute two instead of week two — the highest-value unshipped idea in
  CUBBY-CUSTOMER-LENS-EXPERIENCE-MAP.md §1.
- **Ends:** one tap. **Skippable:** one button, nothing to skip.
- **Success signal:** first post-birth log within 6 hours.
- **Charter check:** passes, and fixes three live breaches — the "Welcome to Cubby 👋" greeting to a
  nine-month user (O-3), the unqueued coach-mark pile-up (O-4), and an app that changes shape with no
  explanation at peak exhaustion (O-2). **Loss-safe:** reachable only from a live birth, never from
  `endPregnancy`.

---

**M7 · Stage transition: Baby → Child — SHIPPED, small gap**

The pill is calm, dismissible and reversible with an Auto default — the reference pattern for M5. The
one gap: it does not say the quick-log grid just changed, and surfaces no undo. One extra clause in
the existing copy closes it (P2-1).

---

**M8 · Re-engagement after absence — MISSING, P1**

The charter-legal alternative to engagement push: do nothing while they are away, and be *useful* when
they come back. Note this needs a last-open timestamp, which does not currently exist anywhere.

- **Trigger:** first open after 3+ days with no logs by this user, and only if someone else logged.
- **Surface:** extend `awayRecap` past its same-day filter into a "while you were away" card covering
  the gap.
- **Copy:** the frame is **relief, never accounting**. "While you were away, Nana logged 9 feeds and two
  long naps." Never "you haven't logged in 3 days." Never a gap in a chart. Never red.
- **Ends:** scrolls away; no dismissal needed. **Skippable:** passive by construction.
- **Success signal:** second session within 48 hours of a returning session.
- **Charter check:** passes **only** in the circle case. If nobody else logged, show nothing at all — a
  solo parent returning after five hard days must not be told what they missed. That silence is the
  feature. Explicitly: no "we missed you", no re-engagement push, ever.

---

**M9 · The pregnancy week turn — MISSING, P1**

The calmest possible hook: something genuinely new, on a schedule the parent already cares about, that
Cubby did not manufacture.

- **Trigger:** first open after the gestational week increments.
- **Surface:** the existing week hero, plus one line acknowledging the turn.
- **Copy:** qualitative, never a countdown, never a milestone check. "Week 24 today. Baby's about the
  size of a corn cob." Nothing about how long is left.
- **Ends:** passive. **Skippable:** it is a line, not a card.
- **Success signal:** weekly return rate during pregnancy.
- **Charter check:** passes only if it respects `pregNoNumbers()` (quiet mode drops the week entirely)
  and `pregAfterLoss()`, and if it never implies a schedule she is on or off.

---

**M10 · First use of the mic — P1, ordering fix**

- **Trigger:** first tap of "Say it" by this user.
- **Surface:** the voice sheet renders its explanation and example **before** `beginListen()` fires,
  with an explicit "Start" tap that owns the OS permission prompt.
- **Copy:** "Say it out loud and Cubby will fill in the form. You always confirm before anything saves."
- **Charter check:** passes, and the confirmation clause is load-bearing — the guarantee that Cubby
  never auto-commits a health entry *is* the calm. Fixes O-8 and stops burning an irrecoverable
  permission.

---

**M-queue · The session reveal queue — the mechanism all of the above depends on**

One shared queue checked before any reveal renders: at most one per session, ordered threshold-screens
→ transitions → coach marks → tips. Per-uid state. Loss-holding and quiet mode suppress everything
except M2 and M6.

---

## 4. Ranked recommendations

Effort: **S** ≤ 1 day · **M** 2-4 days · **L** 1-2 weeks.

### P0

**P0-0 · Un-hide the share buttons on native (V-9).** Change the render predicate from
`navigator.share` to `navigator.share || isNativeApp()` at all five gates, and route the native branch
through the existing `saveFile()`. This is a one-predicate change that restores the primary viral CTA
to the entire App Store user base.
*Trigger:* n/a. *Success signal:* share invocations from native sessions become non-zero.
*Charter check:* passes — restores a capability, adds no prompting. *Effort:* **S**. **Do this first;
it is the cheapest large win in the document.**

**P0-1 · Scope onboarding state per user.** Move `seen` out of the circle-shared blob into a per-uid
map (mirroring `myLossHolding`) or into the private `users/{uid}` doc. Migrate existing flags to the
owner so nobody is re-onboarded.
*Success signal:* a second caregiver sees a coach mark at all. *Charter check:* passes; also closes a
small cross-member leak. *Effort:* **M**. **Blocks P0-3, P1-1, P1-3.** Fixes O-1, O-11.

**P0-2 · Tokenised invite links + native share sheet + acceptance state.** Replace the email-keyed
invite with a random-token invite doc; the link carries the token; acceptance binds on first open
regardless of sign-in address. Add the share sheet. Keep `mailto:` as fallback only. Delete the "Share
My Email" instruction. Read `status` back into the family list.
*Copy:* "I've added you to Aarav's Cubby. Tap to join."
*Success signal:* share sheet opened → member joined within 7 days.
*Charter check:* passes and strengthens the privacy promise. *Effort:* **M**. Treat the
`firestore.rules` diff as the risky part — see §6.1. Fixes V-1, V-2, V-3, V-4, O-12.

**P0-3 · The birth arrival screen (M6), with the vaccine plan as its payload.**
*Effort:* **M**. Fixes O-2, O-3, and lands the highest-value unshipped idea in the customer-lens doc.

**P0-4 · The invitee path: invite-aware landing + first-run screen (M2).**
*Effort:* **M** (the landing branch is new work; the screen is **S** after P0-1). Fixes O-11 and moves
the worst Empty Chair score (EC2, 3.2) most.

**P0-5 · Give `/g/<code>` an unfurl and a CTA (V-11, V-5).** Add `og:title`, `og:description`,
`og:image` and `twitter:card` to the guest page so it renders as a card in WhatsApp and iMessage —
without lifting `noindex`, which should stay. Then add one warm CTA card under the game, ref-coded.
*Copy:* lead with product truth, not brand. "Cubby is where this family keeps the whole journey. Free,
private, no ads."
*Charter check:* passes; an offer on a page the visitor chose to open, not an interruption. The OG
image must be generic (bear + "Family games"), never the baby's name or photo — this link travels.
*Effort:* **S**. Fixes the two lowest Empty Chair scores at once.

**P0-6 · Resolve iOS push before the next release (H-2).** Upload the APNs `.p8` to Firebase and
confirm the distribution profile promotes `aps-environment` to `production`. Until then, do not
describe push as a native feature anywhere in App Store copy — truthful-copy applies to the listing.
*Effort:* **S** (configuration), but it is a founder-account task.

### P1

**P1-1 · The session reveal queue (M-queue).** *Effort:* **S** after P0-1. Fixes O-4.

**P1-2 · Extend `awayRecap` past same-day, and record a last-open timestamp (M8).** The timestamp is
per-uid and never shown to anyone else. *Effort:* **S-M**. Fixes O-10, H-6.

**P1-3 · Coach marks for pregnancy, child, studio, games, Rituals, Stats (M4).** Content work on an
existing component. *Effort:* **S-M**. Fixes O-5 in part.

**P1-4 · Stage-aware get-started card and nudge line for Expecting and Trying.** Generalise
`renderGetStarted` and `homeNudgeLine` past `activeBaby()`. Pregnancy's three steps are plausibly: due
date ✓ · add your doctor or midwife · invite your partner.
*Charter check:* **no health tasks**, and suppressed in quiet and after-loss mode. *Effort:* **M**.
Fixes O-5, H-11.

**P1-5 · The pregnancy week-turn line (M9).** *Effort:* **S**. Fixes H-7.

**P1-6 · Voice mic priming (M10).** *Effort:* **S**. Fixes O-8.

**P1-7 · Stats empty state (O-7).** A parent with no data should see an invitation, not `0.0`.
*Effort:* **S**.

**P1-8 · Surface that a guest guessed (H-8).** Refresh hub state when the pregnancy home renders and
let the games card's summary line reflect guest guesses.
*Charter check:* passes — it is real news the parent opted into by sharing the link, shown in place,
with no push and no badge. *Effort:* **S**.

**P1-9 · Move the referral ask to the pride moments (V-7).** `shareCubby()` already has the right
words; add call sites after a keepsake export and after a completed vaccine visit. One per moment,
dismissible, never repeated.
*Charter check:* passes only as a quiet line, never a modal, and never after a health event with a
worrying reading. *Effort:* **S**.

**P1-10 · Make referral and invite attribution readable (V-6, V-12).** Store the referrer's uid
alongside the code (or keep a code→uid index) so `referredBy` is resolvable, add UTM params to the
invite and game links, and report both in `tools/analytics.js` alongside the one activation number
("households reaching 2+ members within 7 days"). No new client tracking — this reads data users
already own.
*Charter check:* passes; nothing new is collected, so nothing new needs disclosing. *Effort:* **M**.
Answers Red Team Round 1.

**P1-11 · Add an `apns` block and a deep link to the medicine push (H-3).** Route the tap through the
existing `?go=` router to the dose. *Effort:* **S**. Native-only, and depends on P0-6.

**P1-12 · Schedule medicine reminders locally as well as via FCM (H-4).** Add
`@capacitor/local-notifications`, schedule from the fire times the client already computes, and
de-duplicate against the server send. This makes reminders work offline and removes the single point
of failure that P0-6 currently represents.
*Charter check:* passes — identical medicine-only scope, same quiet hours. *Effort:* **M**.

**P1-13 · Verify Web Speech in WKWebView on a real device (H-16).** If absent, fix the Pro copy or gate
the claim. A truthful-copy obligation, not an enhancement. *Effort:* **S** (investigation).

**P1-14 · Give the tips ticker a day-N schedule, a stage, and a dismiss (O-6).** Day 2 → the circle sees
this live. Day 5 → keepsakes. Day 10 → rituals. Two days before a scheduled visit → the doctor summary.
*Charter check:* one line in the existing slot, never a modal, suppressed in quiet and after-loss mode.
*Effort:* **M**.

### P2

**P2-1 · Say what changed in the Baby → Child pill, and offer the undo inline (O-13).** *S*.
**P2-2 · First-use lines for the studio and games (M4 tail).** *S*.
**P2-3 · Near-term "Baby has arrived" prominence (O-9).** *S*. Must stay gentle: a prompt, never a
countdown, and nothing at all past the due date that reads as impatience.
**P2-4 · Don't colour a negative growth delta with the alert hue (H-14).** *S*. Small, real anxiety win.
**P2-5 · Brand the doctor report (V-15).** One footer line with the domain. *S*.
**P2-6 · Rotate the baby good-read faster than monthly (H-10).** *S*.
**P2-7 · Smoke coverage for the viral surfaces (V-16).** *M*.
**P2-8 · Fix the stale comments and the `CUBBY-MASTER-HANDOFF.md` reference (H-17).** *S*.
**P2-9 · Consider a ref code in the watermark (V-10).** Weigh against visual cleanliness. Recommend
**no** unless attribution proves necessary after P1-10; the drawn footer is currently beautiful.
**P2-10 · Localisation and accessibility coverage for every new reveal.** Flagged by Pod 13 as
under-covered and not resolved by this document.

---

## 5. Native iOS first, PWA carry-over

The native app remote-loads `https://little-cubby.com/app/` (`capacitor.config.json` `server.url`), so
**almost everything here ships to iOS by shipping to the web** — no binary release needed. That is the
scoping advantage and it should be used deliberately.

| Item | Native-specific work | Carries to PWA |
|---|---|---|
| P0-0 share buttons | **native-only defect**; the PWA was never broken | no change needed |
| P0-1 per-uid state | none | fully, immediately |
| P0-2 invite + share sheet | the share sheet is the native idiom; `mailto:` in WKWebView is the weakest path, so native benefits most. Verify the token URL against the AASA components so the link opens Cubby, not Safari | fully; PWA keeps `navigator.share` with a copy fallback |
| P0-3 birth screen | add a haptic via the existing `cubbyHaptic` bridge | fully, minus haptic |
| P0-4 invitee path | none | fully |
| P0-5 guest OG + CTA | **PWA-first by nature** — a stranger opens this in a normal browser; the native app never renders it | it *is* the web surface |
| P0-6 APNs, P1-11 apns payload, P1-12 local notifications | native-only | web push already works and already links to `/app/` |
| P1-13 voice verification | native-only risk; Safari PWA unaffected | n/a |

**Binary-release items:** only P1-12 (new Capacitor plugin) and any haptics. P0-6 and P1-11 are
configuration and server-side respectively. Everything else is a web deploy — service-worker bump,
`main` → Cloudflare.

---

## 6. Open questions for the founder

1. **Invite tokens and `firestore.rules` (P0-2).** This needs a rules change so a token holder can join
   a household, on the surface a prior audit already found an invite-hijack hole in. It should get its
   own security review and an emulator run before it ships. Confirm you want it sequenced that way, and
   note it will be the second item this cycle blocked on the emulator suite.
2. **Does the invitee screen (M2) state the privacy boundary?** Recommended yes — it is most credible
   told to the constrained party. But it means every invitee learns the mother has private notes.
   Founder call.
3. **The activation metric.** Adopting "second member within 7 days" as the north star means a happy
   solo parent counts as unactivated. Correct for growth, arguably wrong for the charter. Recommend
   adopting it as an *internal* metric only, never surfaced to a user, and never used to trigger a
   nudge.
4. **Guest-page CTA ceiling (P0-5).** As specced it is one calm card and a generic OG image. Confirm
   that is the ceiling, and confirm the OG image must never carry the baby's name or photo.
5. **Day-N tips schedule (P1-14)** needs 8-10 lines written to the DESIGN.md §A7 voice. Founder or a
   copy pass?
6. **Concurrent edits.** `app/index.html` was being modified by another process throughout this audit.
   If another agent or session is working in this repo, sequence P0-1 and P0-3 against it — both touch
   the home render path.

---

*Charter note, recorded on purpose: this document declined streaks, scarcity, FOMO, comparison,
engagement push, "we missed you" messaging, badge counts, and any re-engagement surface for a solo
parent returning after a hard week. Each was proposed by a growth pod and each was rejected because the
charter beats growth. If a future version of this plan reintroduces any of them, that is the regression
to catch.*
