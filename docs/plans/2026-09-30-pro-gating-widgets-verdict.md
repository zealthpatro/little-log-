# Pro on widgets and quick actions: can we, and should we

**2026-09-30.** The founder asked to "gate these with pro features in some format where the pro is paywall gated", *these* being the home-screen widgets and the app-icon quick actions.

**Short answer.** Not on iOS until Pro can be bought through In-App Purchase, and never on the glance or on any logging button, because Cubby has published that it will not paywall logging. The compliant shape, once StoreKit exists, is *Pro behind these buttons, never on them*.

**The more urgent finding.** The build about to be submitted already shows a price for a subscription that cannot be bought in the app (`app/index.html:6819`, `PRO_CFG.priceLine`, no native guard), and the review notes written on 2026-09-29 told Apple the Pro screen "shows no prices". That sentence was false; it was corrected on 2026-09-30. See the section *What was wrong in the notes* below.

Produced by a 6-agent workflow (three grounding reports, one proposal, two adversarial reviews). The load-bearing claim, the price line, was re-verified by hand.


## What was wrong in the notes, and whose error it was

The notes said: *"A Cubby Pro screen exists and registers interest only: it shows no prices, takes no payment and links to no store."* Before writing that I read `openPro`'s `canBuy` branch, found the two price buttons inside it, saw `canBuy` is false, and concluded no price renders. I did not read the other side of the ternary, where the waitlist branch prints `priceLine` — "Cubby Pro · $9/month, or $90/year (save 17%) · 7-day free trial" — to anyone who has not registered, which is every reviewer on a fresh device. `app/landing.js` hides pricing on native for 3.1.1; the in-app sheet was never given the same guard.

A false statement in review notes is a worse position than the thing it misdescribes: it risks the account, not only the build. The paragraph now describes the app as it is.


---

## Grounding 1 — the Pro machinery that already exists

1. How the app decides someone is Pro

- **Where it lives.** Pro is a single map at `households/{hid}.pro` on the household document. The shape is `{active, plan:'base', status, until(ms), customer, updatedAt}`, and the Lemon Squeezy worker also writes `subId` and `portalUrl` (`workers/pro-billing/worker-lemonsqueezy.js:139-148`, `worker.js:137-144`). Nothing about Pro is stored in `users/{uid}`.
- **Reading it.** The household listener sets `window.LL.pro = d.pro || null` (`app/store-firebase.js:1888`). `d.pro` is part of the re-render signature (`:1918`), so a change reaches every open device live.
- **The check.** `isPro()` is at `app/index.html:6763-6769`:
  - It returns true if `localStorage['cubby-pro-dev']==='1'`. This is a developer override in production code, and anyone with browser devtools can use it. It is cleared on account deletion (`store-firebase.js:2493`) and a test uses it (`tools/birthplan_summary_check.js:133`).
  - Otherwise it needs `p.active` and either no `until` or `until` plus a 3-day grace still in the future.
- **Who can write it.** Only the billing Worker, using service-account credentials. `firestore.rules:164-168` defines `proUnchanged()`, and every client update must pass it (`:222`). Household create requires `pro == null` (`:213`). Owners cannot change it either.
- **Who can read it.** Every member, because `allow read: if isMember()` (`:210`) covers the whole document.
- **Worker status.** Two worker versions exist and neither is known to be deployed (unverified). `wrangler.toml` has `main = "worker.js"`, which is the Stripe version. The Lemon Squeezy version is described in its own header as "built, not live".
- **Server copy.** The site worker has its own idea of "paying": `worker.js:1060-1061` treats any `pro` map as paying, including cancelled ones.

2. The free tastes mechanism

- **How many.** `PRO_TASTE` at `index.html:6773`:
  - styles: 3
  - enhance: 3
  - cutout: 3
  - thennow: 1
  - pdf: 1
  - voice: 5
- **Where they are counted.** In `state.settings.proTaste[k]` (`:6774-6785`). `useTaste` adds one and saves. `refundTaste` takes one back when an action fails.
  - `settings` goes into the circle-shared blob at `households/{hid}.app.settings`. `sharedSettings()` strips only `seen`, `push` and `theme` (`store-firebase.js:956-960`, `:1151`).
  - So the count is per household, not per person. One member's use spends the count for everyone.
  - For a signed-out user the count sits in `little-log-v1` in localStorage, and it is carried into a new household at first sign-in (`:970`).
- **When tastes run out.** `useTaste` calls `openPro(featureName, true)`, which shows "You've enjoyed your free tastes of X" (`:6778`, `:6809`). Then & Now checks before it starts (`:18897`).
- **Tamper resistance: none.**
  - The rules let any caregiver rewrite `app` (`firestore.rules:223-226`), so the count can be reset from the console.
  - The `cubby-pro-dev` flag skips everything.
  - All Pro features run on the device, so every gate is enforced only in the app's own code.
  - Saves are diffed per top-level key (`store-firebase.js:2240`), so any member saving a stale `settings` object can undo a spent taste by accident.
- **Other points.**
  - One `pdf` taste covers three different reports: the baby doctor PDF, the pregnancy report and the TTC report.
  - Because the counter is in the shared blob, a caregiver can see `proTaste.pdf` go from 0 to 1 in a trying-stage household. That shows she exported her TTC notes.

3. Everything gated or labelled Pro

`requirePro()` (`:6770`) has no callers. **No feature is locked outright. Everything is either limited by tastes or only cosmetic.**

| Feature | Rule | Where |
|---|---|---|
| Voice logging, structured save | voice ×5; "Save it as a note" stays free | `voice-log.js:205-209`, `:262-275`; "Say it" quick action `index.html:4217`, in the default baby and child sets `:4225-4226` |
| Baby doctor PDF | pdf ×1, charged when the report opens | `:15422`, `:15430` |
| Pregnancy doctor report | pdf ×1, charged on Print or Share | `:12864-12870`, `:12894-12896`, buttons `:9324`, `:12911`, `:12852-12853` |
| TTC report | pdf ×1, charged on Print or Share; free when opened from an archive or from the stop-tracking screen | `:10495-10563`, `:10747`, `:13190` |
| Studio premium styles | styles ×3, charged on export (download, share, video) | `PRO_LOCK` `:17112-17120`, `exportGate` `:18437-18455`, `:18411`; pill `:17954` |
| Auto-enhance | enhance ×3 | `:18047`, label `:17926` |
| Background cutout | cutout ×3, refunded on failure | `:18013-18042`, `:17927` |
| Then & Now | thennow ×1 | `:18897`, `:18914`, `:18635` |
| No "made with Cubby" mark | `isPro()` only | studio `:17325`, Then & Now `:18947`, collage `:19000`, poster `:19282`, `:19343` |
| Settings row "Cubby Pro" | label only | `:7802-7804` |
| `?go=pro` deep link | opens the sheet | `:2702` |

- Data export is guarded by whether you are a guardian, not by Pro (`:8023`).
- The FAQ at `:43` says "Pro adds extras like insights and exports". Neither of those is gated, so the copy has drifted.

4. Per person or per household

**Per household.** The entitlement lives on the household document, which every member reads, and the sheet says "One plan covers your whole family" (`:6815`). So if Mama pays, Papa's `isPro()` becomes true live, and any widget fed from his device would unlock too.

The tastes are per household too. Only the waitlist is per person: `waitlist/{uid}` (`:6859`) plus a per-device localStorage flag.

5. What a native widget would need to read, and whether any path exists today

- **What it needs.** `pro.active`, `pro.until` and the current time, to reproduce the 3-day grace. A stored true/false would leave a lapsed plan unlocked until the next app open, so `until` has to travel with it. It should not copy the `cubby-pro-dev` override.
- **Is there a path today? No.**
  - There is no App Group in `ios/App/App/App.entitlements`, which holds only Sign in with Apple, push and associated domains.
  - No shared UserDefaults and no custom Capacitor plugin exist. There is no Preferences plugin either (`ios/App/CapApp-SPM/Package.swift`, `capacitor.config.json` `packageClassList`).
  - `native-bridge.js` only sends things from the web layer to native: haptics, file save, share text, status bar theme and push.
  - `skipNativeAuth: true` means the native Firebase SDK holds no user, so native code cannot read Firestore itself.
- **What building one takes.** A new bridge that writes Pro state (and the widget's status data) from the web layer into App Group storage. That needs a new binary and an App Review.
- **Open question (unverified).** Whether an iOS widget may unlock from a subscription bought outside In-App Purchase is an App Review policy question I have not confirmed.

6. What is broken, half-built, or would misbehave if `checkoutUrl` were set tomorrow

1. **No platform check before selling.** `canBuy = !!PRO_CFG.checkoutUrl` (`:6798`) never checks `isNativeApp()`, and no gate stops `checkoutUrl` being set. Both app wrappers would start selling at once, which contradicts the App Store reviewer notes.
2. **Monthly would be charged as annual.** `wrangler.toml` points at the Stripe worker, which reads only `{hid, email}` and always charges `STRIPE_PRICE_ID` (`worker.js:76-81`). The "Or pay $9 a month" button would sell the annual plan. The comment at `:6821-6823` describes the Lemon Squeezy worker.
3. **Manage subscription fails on Lemon Squeezy.** The client sends `{customer, origin}` (`:6843`) but the LS `/portal` expects `{subId}` (`worker-lemonsqueezy.js:96-97`). The result is a 400 and the toast "Could not open the portal". The `pro.portalUrl` and `subId` the worker stores are never read by the client.
4. **Cancelling removes Pro at once.** LS `cancelled` maps to `canceled`, which sets `active:false` (`worker-lemonsqueezy.js:124-128`). `isPro()` returns false straight away, and the grace period only applies when `active` is true. My understanding (unverified) is that a cancelled LS subscription stays valid until `ends_at`, so paid-for time would be lost.
5. **One map, last write wins.** Each household has one `pro` map and every webhook overwrites it. If two members subscribe, cancelling either one switches the household off. `updatedAt` is the worker's clock, not the event's time, so there is no ordering guard.
6. **Webhooks can recreate deleted households.** The workers use PATCH with `updateMask` and no existence check. By standard Firestore REST behaviour (not tested here), a webhook for a deleted household recreates `households/{hid}` holding only `pro`. Account deletion (`store-firebase.js` ~2440-2500) neither cancels nor mentions a subscription.
7. **`/checkout` does not check who is calling.** It accepts any `hid` that matches the regex, and the Origin check only holds for browsers. Anyone can start a checkout for any household, and no record says which person paid.
8. **Returning from checkout in the iOS app is uncertain.** Checkout navigates away from `little-cubby.com`, the only app-bound domain (`Info.plist:71-74`). What the WKWebView and Capacitor do with that is unverified. It may open Safari, which would return to the web app in Safari rather than the wrapper.
9. **Lapsed subscribers are never marketed to.** The site worker's "paying" check counts cancelled plans as paying (`worker.js:1060`), so they are permanently left out of non-paying-only campaigns.
10. **Caregiver waitlist sign-ups are invisible.** The funnel counts `pro_waitlisted` only when the household owner is on the waitlist (`workers/funnel/core.mjs:179`).
11. **"Registered" state lives on one device.** It comes from localStorage (`:6799`, `:6864`) and is never read back from `waitlist/{uid}`. A second device, or the co-parent, sees "Register for Pro" again.
12. **The baby doctor PDF charges on open** (`:15430`). This breaks the charge-on-delivery rule that the pregnancy and TTC reports follow.
13. **Dead code.** `requirePro()` has no callers.


---

## Grounding 2 — store rules

Pro-gating the iOS widgets and app-icon quick actions is not compliant until Pro can be bought through Apple In-App Purchase. Separately, the Pro screen in the app already shows prices today, which contradicts the reviewer notes.

Tags: **[RULE]** is quoted from the live Apple guidelines or Google policy page, fetched 2026-09-30. **[INFERENCE]** is my reading. **[UNVERIFIED]** is not confirmed.

## 0. A "verified fact" is wrong: the in-app Pro screen shows prices today

- `app/index.html:6757` sets `priceLine` to "$9/month, or $90/year (save 17%) · 7-day free trial".
- `app/index.html:6819` prints it inside the waitlist branch, not the `canBuy` branch. It shows whenever the device has not registered for Pro, which is the case on a reviewer's fresh device.
- `openPro` never checks `isNativeApp()`. Nothing uses the `data-native` attribute to hide it. Settings, Cubby Pro opens it (`:7802`), and so does every used-up free taste (`:6778`, `:18897`).
- `app/landing.js` does hide the pricing block on native "for 3.1.1". The in-app sheet has no such guard.
- `docs/plans/2026-08-04-app-store-listing.md:161` tells Apple the Pro screen "shows no prices". That is false for the build about to be submitted.
- Checked by reading the code, not run on a device.
- Also live now: once the free tastes are used up, the doctor PDF, voice, Then & Now and studio styles lock with "X is a Pro treat" and no way to buy in the app. **[INFERENCE]** A reviewer can hit this.

## 1. Apple 3.1.1: must Pro-gated widgets and quick actions use In-App Purchase?

- **[RULE]** "If you want to unlock features or functionality within your app, (by way of example: subscriptions, …) you must use in-app purchase. Apps may not use their own mechanisms to unlock content or functionality, such as license keys…"
- **[INFERENCE, strong]** Both count as features within the app:
  - A widget is an app extension shipped inside the app bundle, and 2.5.16 treats widgets as part of the app's functionality.
  - Quick actions are declared in the app's Info.plist or set by the app at runtime.
  - Apple has no widget-specific paywall rule that I found, so 3.1.1 governs.
- **[INFERENCE]** The `households/{hid}.pro` flag, set by the web billing Worker, is "their own mechanism to unlock". It is only permitted through 3.1.3(b), below.
- **Firm structural point:** iOS web apps get neither widgets nor app-icon shortcuts. Those two surfaces exist only in the App Store binary, so there is no web-only way to Pro-gate them on iPhone. **[UNVERIFIED]** that iOS Safari ignores manifest `shortcuts`.

## 2. Apple 3.1.3 exceptions: can someone who bought Pro on the web use it in the iOS app?

- **[RULE]** 3.1.3(b) Multiplatform Services allows access to things bought on your website "provided those items are also available as in-app purchases within the app". So web buyers can use Pro on iOS only once Pro is also sold through In-App Purchase.
- **[RULE]** The 3.1.3 intro says apps in this section "cannot, within the app, encourage users to use a purchasing method other than in-app purchase". The exceptions are the US storefront, 3.1.1(a) and 3.1.3(a).
- **[RULE]** Reader apps (3.1.3(a)) are limited to magazines, newspapers, books, audio, music and video. Cubby does not qualify.
- **[RULE]** 3.1.3(f) Free Stand-alone Apps covers "a stand-alone companion to a paid web based tool (i.e. VoIP, Cloud Storage, Email Services, Web Hosting)", provided there is "no purchasing inside the app, or calls to action for purchase outside of the app".
  - **[INFERENCE, UNVERIFIED]** Unlikely to fit Cubby, because the iOS app is the whole product rather than a companion.
  - Even if it did fit, it requires zero Pro calls to action in the app.

## 3. Paywall, "Pro" lock, prices or a link-out without In-App Purchase

**Outside the US storefront**
- **[RULE]** "apps and their metadata may not include buttons, external links, or other calls to action that direct customers to purchasing mechanisms other than in-app purchase" (3.1.1(a)).
- **[INFERENCE]** A web-only price, a "Start trial" button, or a lock whose only way out is the web all read as such calls to action.
- **[INFERENCE]** A bare lock with no way to buy at all risks 3.1.1 or 2.1 (incompleteness).
- **[RULE]** Emailing your user base outside the app about other ways to pay is allowed.
- **[INFERENCE]** The music-streaming entitlement explicitly grants the right to "invite users to provide their email address for the express purpose of sending them a link" to buy. That implies an in-app "register to buy on the web" form is otherwise not allowed outside the US. "Register for Pro" plus a price is close to that line.

**US storefront**
- **[RULE]** Since May 2025 there is no prohibition on buttons, links or calls to action to other purchase methods, and no entitlement is needed.
- Ninth Circuit, December 2025: upheld the contempt finding. Apple may charge a cost-based commission, with the rate to be set on remand. Apple may stop external links being more prominent than its in-app purchase option.
- Supreme Court: refused to stay the case in May 2026, and granted review on 2026-06-30 on the narrow contempt question.
- Apple proposed commissions of up to 15% in August 2026. **[UNVERIFIED]** What rate applies today (reported as 0%) and the final outcome.
- **[UNVERIFIED]** Whether a US app may sell the unlock only on the web with no In-App Purchase at all. The injunction wording contemplated links "in addition to" In-App Purchase.
- **[INFERENCE]** Applying the US exception needs the user's storefront, which is the Apple ID country, not their IP or locale. Reading it needs StoreKit (`Storefront.current`). Cubby has no StoreKit, so a web-side geo check could show the link to a UK-storefront user who happens to be in the US.

**UAE, India, UK**
- **[UNVERIFIED]** I found no Apple link-out allowance for UAE or India.
- UK: the CMA designated Apple and Google in October 2025 and proposed steering rules, with consultation closing 2026-07-28. **Proposed, not found in force.**
- For all three, treat the non-US rule as binding.

## 4. First submission says "no purchases", then a remote web change adds a paywall

- **[RULE]** 2.3.1(a): "Don't include any hidden, dormant, or undocumented features… All new features, functionality, and product changes must be described with specificity in the Notes for Review". It also covers "promoting a false price", with removal and account termination as possible outcomes.
- **[RULE]** Introduction: "If you attempt to cheat the system (for example, by trying to trick the review process…) your apps will be removed…"
- **[RULE, section number UNVERIFIED]** The Developer Program License Agreement lets an app download interpreted code only if it "does not change the primary purpose of the Application…". **[INFERENCE]** A paywall is weaker grounds under this clause than under 3.1.1 plus 2.3.1.
- **[INFERENCE] Realistic risk:**
  - Detection is not instant. It comes through user or competitor reports, or the next binary review.
  - For widgets, the next binary review is guaranteed. A widget build is a new binary, and the reviewer loads the live site that day.
  - A widget gate driven by a web flag is also a "dormant" feature under 2.3.1(a).
  - Likeliest outcome: the update is rejected under 3.1.1 and 2.3.1, and In-App Purchase or removal of the calls to action is demanded.
  - Removal of the live app is possible if it is reported.
  - Account termination is reserved for "egregious or repeated" cases, so the probability is low. The blast radius would be large: Sign in with Apple on the web depends on the same team **[UNVERIFIED]**.
- The live exposure is the section 0 mismatch in the imminent submission, not a future widget.

## 5. Google Play (Android wrapper, not yet on Play)

- **[RULE]** Play Billing is required for "subscription services" and "app functionality or content… new features not available in the free version".
- **[RULE]** Apps may not lead users to another payment method through "in-app promotions related to purchasable content", or through "webviews, buttons, links, messaging… or other calls to action", or through sign-up flows. Exceptions are Sections 3, 8 and 9.
- **[RULE]** Consumption-only is allowed. A user can "log in… and access content paid for somewhere else", provided nothing "can be purchased from within the app". Communicating outside the app is allowed.
- So on Play, web-bought Pro can unlock widgets and shortcuts with no Play Billing. This differs from Apple, which requires an In-App Purchase alongside. The app must not show prices, a web checkout or promotional Pro calls to action. **[INFERENCE]** A neutral lock is a grey area; hiding the Pro-only items is safest.
- **[RULE]** US: while the court order stands, developers enrolled in the US programs may lead US users to external content. **[UNVERIFIED]** The fees.
- **[RULE]** India and South Korea: alternative billing alongside Play Billing, with enrollment. EEA: alternative billing.
- **[UNVERIFIED]** Nothing found for UAE; the UK is proposed only.
- The live manifest shortcuts (Feed, Sleep, Nappy) belong to browser-installed PWAs, which are outside Play. **[INFERENCE, UNVERIFIED]** The Capacitor WebView ignores manifest shortcuts, so the Android wrapper would need native `ShortcutManager` / `shortcuts.xml`.

## 6. Safest shape now, and the minimum StoreKit work for paid widgets

**Safest with no StoreKit**
1. On iOS, ship widgets and quick actions free for everyone. Put no Pro badge and no entitlement check in the widget code, so nothing is dormant under 2.3.1(a). This also fits the existing Pro copy that "the essentials… stay free, always".
2. Before this submission, add a native guard. Hide the price line and web-sale calls to action when `isNativeApp()`, or correct the notes. Decide whether used-up tastes on native unlock the feature or make it absent. A lock with no way out should not remain.
3. The native guard plus a gate that is shown going red must land before `checkoutUrl` is set. Pro is due in October, which is tomorrow; commit 539fb00e already flags this.
4. Keep Pro gating on the web and PWA, where no store rules apply.
5. On Play later, use consumption-only (web Pro unlocks) with no in-app calls to action.

**Minimum to make paid widgets compliant on iOS**
- Paid Applications Agreement in App Store Connect, with banking and tax details. **[UNVERIFIED]** Whether this depends on the UAE licence or on the account being individual versus organisation.
- A subscription group with monthly and annual products. The 7-day trial set up as an introductory offer.
- **[UNVERIFIED]** Whether In-App Purchase needs a key in `App.entitlements`. This matters because `cap_ios_configure.rb` rewrites that file wholesale.
- A StoreKit 2 bridge for Capacitor (custom plugin or RevenueCat):
  - load products, purchase with `appAccountToken` mapped to the household
  - listen to `Transaction.updates`
  - a restore button (3.1.1)
- Billing Worker: App Store Server Notifications V2, writing `households/{hid}.pro`, including refunds and revocations.
- The app writes the entitlement to the App Group, and the widget reads it. The locked state deep-links into the in-app purchase paywall, never the web.
- Native paywall meeting 3.1.2(c) and Schedule 2: what you get, price, term, auto-renew terms, Terms and Privacy links. The subscription must work on all the user's devices (3.1.2(a)).
- Web checkout never shown on iOS outside the US.
- Notes for Review describing Pro and the widget gating, with In-App Purchase visible to the reviewer (2.1(b)). **[UNVERIFIED]** That the first In-App Purchase must be submitted with a new app version.
- **[UNVERIFIED]** Whether a household-wide entitlement from one person's In-App Purchase, granted server-side to circle members, is acceptable.
- Minor: `isPro()` honours `localStorage['cubby-pro-dev']` in production (`:6764`), an undocumented unlock.

Sources:
- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Apple guidelines update, May 2025](https://developer.apple.com/news/?id=9txfddzf)
- [Ninth Circuit opinion](https://law.justia.com/cases/federal/appellate-courts/ca9/25-2935/25-2935-2025-12-11.html)
- [Courthouse News, Aug 2026](https://www.courthousenews.com/apples-fight-over-commissions-for-linked-out-app-store-purchases-continues-in-federal-court/)
- [9to5Mac, 15% proposal](https://9to5mac.com/2026/08/13/apple-proposes-commissions-of-up-to-15-for-off-app-store-purchases-in-the-us/)
- [9to5Mac, Supreme Court stay denied](https://9to5mac.com/2026/05/06/supreme-court-rejects-apples-stay-request-epic-games-case-to-head-back-to-district-court/)
- [MacRumors, UK CMA](https://www.macrumors.com/2026/06/30/uk-apple-loosen-app-store-payment-rules/)
- [Play Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738)
- [Understanding Play Payments](https://support.google.com/googleplay/android-developer/answer/10281818?hl=en)
- [DPLA interpreted-code text](https://news.ycombinator.com/item?id=18431247)

Files: `/Users/m1promax/Downloads/little-log-pwa/app/index.html` (6752-6848, 7802, 18897), `/Users/m1promax/Downloads/little-log-pwa/app/landing.js` (12, 321), `/Users/m1promax/Downloads/little-log-pwa/docs/plans/2026-08-04-app-store-listing.md` (161), `/Users/m1promax/Downloads/little-log-pwa/docs/plans/2026-08-31-multiplatform-launch-readiness.md` (60-82), `/Users/m1promax/Downloads/little-log-pwa/capacitor.config.json`


---

## Grounding 3 — promises already made

**Promises Cubby has already made, and which widget or quick-action features could go behind Pro without breaking them (read-only, main checkout, HEAD a64b7244)**

**0. One of the "verified facts" is wrong.** The Pro screen does show prices today. When `checkoutUrl` is empty and the person has not registered yet, the sheet prints `PRO_CFG.priceLine` in full at app/index.html:6819: "Cubby Pro · $9/month, or $90/year (save 17%) · 7-day free trial ... No charge today". That text comes from line 6757. There is no `isNativeApp()` guard on it. The Settings row that opens it (app/index.html:7802) is also not hidden in native.
- This contradicts the review notes at docs/plans/2026-08-04-app-store-listing.md:161, which say "it shows no prices".
- The team already removed the Pro and pricing block from landing.js on native "for App Review 3.1.1" (docs/plans/2026-07-15-native-wrapper-app-store.md:167). The in-app sheet was missed.
- I have not checked this on a device, and I have not checked the exact wording of rule 3.1.1.

**1. What Cubby has publicly promised is free forever**
- index.html:186: "We will never paywall logging or sharing." / "The core stays free, forever. Pro is a little extra delight, never a wall around the basics."
- index.html:289: "The core stays free, forever." The free list starts at :292 with "Unlimited logging: feeds, sleep, nappies, pumping".
- pricing/index.html:38–39: "Free forever, with Pro for the extras" / "The things that matter most, logging, caregiver sharing, schedules and your privacy, are free and always will be."
  - :47–55: "$0, forever, for the essentials". The list covers unlimited logging, real-time sharing, attribution and handoff notes, the vaccine schedule, growth charts, health nudges and the one-tap summary, photos, cards and poster, and privacy.
  - :68: "We'll never paywall logging or caregiver sharing. Pro is for the extras."
  - :91: "Free plan stays free forever."
- **how-it-works/index.html:156: "The things you reach for at 3am are the free ones. Everything you've read so far is free."** The list at :158–165 includes logging, unlimited sharing, vaccines, growth, "The health hub, routines & family games", keepsake basics and the one-tap summary.
- why/index.html:145: "Never paywall logging or caregiver sharing ... stays free, forever." And :157: "Logging, sharing, your country's vaccine schedule, growth and health, free, always."
- faq/index.html:
  - :253: "Unlimited family and caregivers, free forever. We never paywall sharing."
  - :463: "No. The core stays free forever."
  - :465: "Everything you log is yours on the free plan, forever."
  - :275 (twins): "Add as many as you like, switch between them, or log for more than one at once."
- refund/index.html:39: "Cubby is free for the essentials, always. Logging, caregiver sharing, vaccine schedules and growth charts cost nothing."
- terms/index.html:87–88: "the core of Cubby — logging, sharing with your care circle, vaccine schedules, growth charts, and basic keepsakes — is free."
- In the app, app/index.html:6809: "The essentials, your data and your privacy stay free, always."
- Also llms.txt:11, and the meta descriptions at pregnancy/index.html:8 and features/index.html:8 ("Free, private, no ads.").
- Internal guardrail, not public: PAYWALL.md:41–49. The pregnancy core is free forever, including the kick counter, contraction timer, and the antenatal schedule plus appointment reminders.

**2. What Cubby has publicly said Pro includes**
- pricing/index.html:57–64:
  - hands-free voice logging
  - doctor PDF reports
  - watermark-free shares
  - Then & Now
  - "The full keepsake studio: every template, font & palette"
  - Story and Portrait formats plus stickers
  - auto-enhance and cutout
- pricing :66, "Down the road for Pro": "smart routines, push reminders, HD photos & cloud backup, nutrition tracking and sleep & feed insights."
- index.html:298–305 lists the keepsake studio, watermark-free shares, enhance and cutout, Then & Now, doctor PDF, and "A few free tastes of every treat".
- faq/index.html:461 lists "keepsake studio, clean shares, adaptive routines, always-on push, doctor PDF reports and insights".
- how-it-works:167–174 adds adaptive routines, nutrition view, and HD backup and insights.
- In the app (app/index.html:6791–6796, :6809) the Pro list is voice logging (sold as "Hands-free for the arms-full, 3am moments"), the doctor report, Then & Now plus watermark-free, the full studio, and enhance and cutout. :6811 says "Every treat comes with a free taste or two, so try before you decide". :6816 says "One plan covers your whole family".
- The same "free tastes" promise is public at pricing:68 and index.html:305.
- **How free tastes work:**
  - `PRO_TASTE={styles:3,enhance:3,cutout:3,thennow:1,pdf:1,voice:5}` (app/index.html:6773).
  - Counts are kept in `state.settings.proTaste`, which is shared across the household and never resets.
  - `useTaste` (:6776) spends one taste, or opens `openPro(name, true)`, which shows the "You've enjoyed your free tastes" text.
  - `refundTaste` gives a taste back when an action fails.
  - There are carve-outs where nothing is charged: archived records and the trying-stage stop sheet (app/index.html:10500, :10540). Gates enforce them in tools/loss_keepsake_check.js:29–33 and tools/trying_survivor_check.js:536–544.

**3. Where the site describes pricing, and whether it mentions widgets or quick actions**
- Pricing appears on pricing/, the index.html pricing band (:285–311), how-it-works:153–177, faq:458–466, refund/, terms §5, llms.txt:11, and app/landing.js:321–340 (web only, dropped in native).
- **None of them mentions widgets, quick actions, long-press or shortcuts.** CHANGELOG and the in-app guides don't either.
- "Home screen" does appear in a few places, but it always means the app's own Home tab or installing the PWA, never an OS widget:
  - index.html:135 ("waiting on your home screen" is the in-app "While you were away" card)
  - pregnancy:117
  - faq:171–173
- Existing inconsistencies that Pro gating would make worse:
  - Push is "always-on push" as Pro (faq:461) and "down the road" (pricing:66), yet the FAQ also describes free reminders (faq:351). MARKETING-HANDOVER.md:398–402 already flags this.
  - llms.txt:11 says "launching August 2026".
  - Routines are listed as free (how-it-works:164) and "Adaptive routines" as Pro (:171).
  - The app sells voice logging as Pro for "3am moments", while how-it-works:156 says the 3am things are free.

**4. Is anything already promised free that covers widgets or quick actions?**
- Nothing names them.
- By implication, the promised free thing is the 3am glance:
  - index.html:56: "At 3am, you already know when the last feed was."
  - index.html:316 and features:261: "The next 3am, the answer is already on the screen. Free to start."
  - how-it-works:156, quoted above.
  - The "log in two taps" promise: features:42–44, how-it-works:36.
- Quick actions are also free in practice: the Feed / Sleep / Nappy shortcuts have shipped to every Android and desktop install since 2026-09-26 (commit 4d0b09d9).

**5. What the Experience Charter and Anxiety Test say about paywalls, upsells and interrupting a parent**
- The charter never mentions paywalls, upsells or Pro directly.
- CUBBY-GUARDRAILS-AND-GOVERNANCE.md:26–27 lists "how to write ... a paywall" as guidance still to be written.
- The applicable lines:
  - CUBBY-EXPERIENCE-CHARTER.md:5: "When a spec and this charter conflict, the charter wins."
  - :40–43, the anxious self at 3am: "answer in one glance, one tap ... Never: make her hunt, count, or interpret."
  - :44–46, the depleted self: "one-thumb everything ... Never: demand input, nag."
  - :80–81: "No one profits from her fear ... Cubby is paid for by Cubby, not by her anxiety."
  - :89–91, the Anxiety Test: "If any state ends more anxious than it began, it does not ship."
- Supporting rules elsewhere:
  - design/DESIGN-SYSTEM.md:481: "Our risk budget goes into the keepsake surfaces, which she chooses to open, and nowhere near the logging path."
  - docs/plans/2026-09-26-ios-widgets-verdict.md:168: "Do not sell one-tap-at-3am."
  - The same verdict at :256 says a widget "amplifies a logging habit" and advises holding off.
  - privacy/index.html:87–89: news about Pro "is a separate opt in, and we cap those at five and two a month." A locked widget sitting on the home screen would be a permanent Pro advert outside that cap.

**6. Ranking, safest first**
1. **(h) Widget theming: safe.** It breaks no promise and matches the existing "every template, font & palette" Pro item. Conditions:
   - Day/night and StandBy night legibility stay free, because "Light, dark, or follow your phone" is already free (MARKETING-HANDOVER.md:52).
   - It still needs a free taste to honour pricing:68, for example a free preview in the in-app picker.
2. **(g) Pinning a widget to a specific baby, or a twin view: borderline.** No public text promises it. The free widget can follow the active baby. PRO.md:58 only lists a multi-baby cap as "consider later". But the FAQ at :275 says "add as many as you like", and a twins parent seeing only one child at 3am fails the Anxiety Test.
3. **(c) Logging in place from the widget: price-defensible, blocked on honesty.** Voice logging sets the precedent: a hands-free accelerator is Pro (pricing:58) while logging itself is free (voice-log.js:6–7). But the team's own verdict says:
   - The queued version "is not a shared log" (verdict:164).
   - The write-immediately version bypasses `firestore.rules` and is marked "do not build" (verdict:178–180).
   - Lock screen buttons don't work until the phone is unlocked (:168: "Do not sell one-tap-at-3am").
   - It also runs into how-it-works:156.
4. **(a) Post-birth glance widget: not safe.** Its content is "last feed", which is the exact thing the homepage promises at 3am (index.html:56, :316), and it is charter state 3 word for word. Gating it contradicts how-it-works:156 and would make Cubby "profit from her anxiety" (charter :80).
5. **(d) Lock screen widget: not safe.** Same reasons as (a), and the verdict calls it "the night-feed scenario exactly" (verdict:134). Its "hide details" control is a privacy setting, and privacy is promised free (pricing:39, app :6809).
6. **(b) Widget quick-action buttons: not safe.** They are a door into logging. A locked button opens a Pro sheet where the feed sheet should be, which puts a paywall in the logging path. That breaks index.html:186, pricing:68, and the two-taps promise.
7. **(f) App-icon quick actions: not safe.** They already ship free on Android and desktop. The manifest is static, so they can't be gated per person, only by locking where they lead, which is (b) again. iOS-only gating would treat platforms differently.
8. **(e) Pregnancy widget: least safe.** It carries the kick counter (from 28 weeks) and contractions (from 36 weeks), which PAYWALL.md:47 lists as free safety tools. It shows the week and next visit, which is the antenatal schedule. It also sits on the loss path, where the code already bans any charge (tools/loss_keepsake_check.js:29–33).

**Constraints on any option**
- The public promise that "every Pro treat comes with a few free tastes" (pricing:68, index.html:305) needs a taste model for widgets. `useTaste` writes to the shared household state, and a widget extension has no native identity to write with (`skipNativeAuth: true`, verdict:174).
- Nobody can buy Pro until October 2026. The iOS app has no in-app purchase. The review notes say "Cubby is free ... no subscription". So a Pro lock in the first iOS binary would contradict the submission notes and be a lock with no key. Whether 3.1.1 applies to a locked native feature is unverified.


---

## The proposal

**Pro on widgets and quick actions: one gating model (proposal, read-only)**

Checked against main at a64b7244. Nothing was edited. Every code claim below comes from reading the code, not from running it on a device.

## The model in one line

**The widgets and quick actions themselves are free. Pro can only change how the widget looks, and only inside the app.** No home screen, lock screen or long-press menu ever shows a lock, a price or the word "Pro". On iOS even the widget looks wait for In-App Purchase.

## 0. Two findings that change the starting point

1. **The iOS app shows a price today.** The "verified fact" that it does not is wrong.
   - `app/index.html:6819` prints `PRO_CFG.priceLine` (`:6757`, "$9/month, or $90/year (save 17%) · 7-day free trial") in the waitlist branch. There is no `isNativeApp()` guard.
   - The Settings row at `:7803` reads "Doctor reports, keepsake studio & more · launching October 2026".
   - Both contradict `docs/plans/2026-08-04-app-store-listing.md:161`: "it shows no prices, takes no payment and links to no store."
2. **The one Pro gate reachable from a logging button already interrupts a log.**
   - When voice tastes are used up, the preview still shows "Save this" as the main button.
   - Tapping it calls `useTaste` (`voice-log.js:207-208`), which calls `openPro` (`index.html:6778`). The Pro sheet, which on iOS includes the price, stacks over what she just said.
   - She can only get her words back with the small back arrow. Closing with × loses them.
   - "Say it" is in the default baby and child quick-action sets (`:4225-4226`). It must not go onto a widget or a quick action until this is fixed.

## 1. Free or Pro, surface by surface

| Surface | Decision | Why |
|---|---|---|
| Glance widget (last feed, nap and nappy; medium and small) | **FREE** | index.html:56 "At 3am, you already know when the last feed was." how-it-works:156 "The things you reach for at 3am are the free ones." Charter :80 "No one profits from her fear." |
| Widget action buttons (Feed, Sleep, Nappy) | **FREE** | pricing:68 "We'll never paywall logging or caregiver sharing." A locked button would open a Pro sheet where the feed sheet should be. |
| Log-in-place (iOS 17 interactive button) | **FREE if ever built. Not building it now.** | It is logging with fewer taps, and features:42-44 promise two-tap logging. The widgets verdict (docs/plans/2026-09-26-ios-widgets-verdict.md) already rules it out: the queued version "is not a shared log" (:164) and the direct-write version is "do not build" (:178). |
| Lock screen, StandBy, and the "Hide details" setting | **FREE** | The verdict calls the lock screen "the night-feed scenario exactly" (:134). "Hide details" is a privacy control, and pricing:39 promises privacy is "free and always will be". |
| Pregnancy widget (opt-in, owner only) | **FREE** | PAYWALL.md:41-49 keeps the pregnancy core free forever, including the kick counter, contraction timer and appointments. The widget sits on the loss path, where `tools/loss_keepsake_check.js` bans any charge. |
| iOS app-icon quick actions (not built yet) | **FREE** | They have shipped free on Android and desktop since 2026-09-26 (4d0b09d9). They are doors into logging (pricing:68). A lock on iOS is an in-app unlock, and 3.1.1 requires In-App Purchase for that [RULE]. |
| Manifest shortcuts (live) | **FREE, no change** | The manifest is static, so it cannot know who is holding the phone. Gating them now would take back something shipped free four days ago. |
| One widget per baby, twins view | **FREE** | faq:275 "Add as many as you like, switch between them, or log for more than one at once." The widget spec already configures one widget per baby. A twins parent who sees one child at 3am fails the Anxiety Test. |
| Widget look: Cubby's own colours, day and night, StandBy night, iOS tinted and clear | **FREE** | "Light, dark, or follow your phone" is already free (MARKETING-HANDOVER.md:52). Being readable at night is a safety matter, not a finishing touch. |
| Widget look: the studio's Pro palettes (Sage, Sky, Ink; `PRO_LOCK.palettes`, `:17113`) | **PRO, with one free Pro look that stays. On iOS only once In-App Purchase exists.** | pricing:62 already sells "The full keepsake studio: every template, font & palette". index.html:186 "Pro is a little extra delight, never a wall around the basics." pricing:68 promises "a few free tastes". DESIGN-SYSTEM.md:481 puts the risk budget on surfaces she chooses to open. |
| Links from a widget or quick action to an existing Pro feature (for example a "Say it" button) | **The button is FREE. The feature keeps its in-app tastes.** | Only after the voice fix in section 2, so that the free path at the other end still finishes the log. |

## 2. What the gate looks like

**Three rules**

1. **Nothing about Pro on the home screen, lock screen or long-press menu.**
   - No lock icon, no greyed-out widget, no Pro-only widget type in the gallery, no "Get Pro" quick action.
   - The widget code never checks for Pro, and the data passed to the widget carries no Pro field.
   - Why:
     - A widget stays on screen all the time. privacy:87-89 caps Pro news at "five and two a month".
     - 2.3.1(a) forbids "hidden, dormant" features [RULE].
     - The charter's 3am state.
2. **The gate lives in one place: the "How your widget looks" picker in Settings.** It is built in the web layer, so its wording can change without an app update. Previewing is free and unlimited, as on the studio canvas. The gate sits on "Use this look".
3. **Nothing opened from a widget or quick action ever opens the Pro sheet.** When tastes run out, the button changes. No sheet takes over.

**The free taste for looks**
- One Pro look per person, kept for good.
- The widget never changes back on its own, including after Pro lapses. The existing quick-action defaults follow the same idea (`index.html:4219`: "so nobody's button changes under them").
- This is also why the widget never needs to know about Pro.

**Copy** (sentence case, no em-dashes)

- **Settings row:** "How it looks". It shows the current look's name, for example "Cubby" or "Sage".
- **Picker:**
  - Title: "How your widget looks"
  - Subtitle: "Choose the colours for Cubby on your home screen. Day and night follow your phone."
  - Chips: "Cubby", "Sage ✨", "Sky ✨", "Ink ✨"
  - Under the preview: "This is how it will look on your home screen."
- **Free, first Pro look not used yet:**
  - Button: "Use this look"
  - Helper: "Your first Pro look is on us, and it stays."
  - Toast after applying: "Your widget has its new look 🐻"
- **Free, first Pro look already used:**
  - The preview still works.
  - Button: "Keep this look with Pro". It opens the In-App Purchase paywall, never the web.
  - Second button: "Stay with Sage", using the current look's name.
  - Helper: "The look you have stays yours. Pro adds all the others."
- **Pro:** "Use this look", with no helper.
- **Lapsed:** "Your widget keeps the look it has. The other looks come back with Pro."
- **iOS before In-App Purchase, and Android on Play for free users:** Pro chips do not appear at all. Only "Cubby" shows.
- **New Pro sheet item** (iOS only, once In-App Purchase exists): "Widget looks" / "Dress your home screen widget in any keepsake palette. The widget itself is free for everyone."

**Voice fix, when tastes are used up** (this sits in the logging path)
- The main button becomes "Check it and save". It opens the matching log sheet already filled in, which `voiceEditManually` does today.
- Helper: "Cubby has filled this in from what you said. Saving it here is always free."
- "Save it as a note instead" stays as it is.
- The Pro sheet is never opened from here.

## 3. Entitlement: per household, decided

**Why per household**
- It already lives on `households/{hid}.pro`. Every member reads it live, and only the billing worker can write it (`firestore.rules:164-168`).
- The app promises "One plan covers your whole family" (`:6816`).
- The second caregiver is the wedge. Making Papa pay separately for a widget look would punish the behaviour Cubby needs most.
- It costs nothing on the device, because under this model the widget never reads Pro status.

**What is per person**
- The chosen look and its free taste are stored per person (`users/{uid}` or localStorage by uid), never in `state.settings`, which is the shared blob. The look is personal, like the theme.
- A per-household taste would tell Papa he had used a look that Mama chose. The existing tastes already have this flaw: "You've enjoyed your free tastes of X" is untrue for a partner who never tried it. That is outside this proposal.

**[UNVERIFIED]** Whether Apple accepts one Apple ID's subscription giving Pro to circle members on other Apple IDs. The fallback is Family Sharing, which covers the Apple family, not the circle. This must be decided before the In-App Purchase build. Also record which person bought.

## 4. Sequencing against the first submission

**Before pressing Submit** (web only, reaches the app over the air, no new build)
- Make the app match the reviewer notes. Recommended option A: Pro goes quiet inside the iOS app until it can be bought there.
  - Remove: the Settings Pro row, the Pro sheet, the price, "Register for Pro", the taste toasts, and the "· Pro ✨" tags.
  - On iOS, treats neither lock nor count down.
  - Change the notes to: "Cubby has no paid features in this version."
- Option B keeps a Pro screen with no price, but free tastes still run out into a lock with no way to buy. My reading is that this risks 2.1 or 3.1.1 [INFERENCE].
- Option A costs nothing: 12 households, none active in the last 7 days, and nothing can be bought until October anyway.
- Make `canBuy` require `!isNativeApp()`. This must land before `checkoutUrl` is ever set (539fb00e).
- No widgets or quick actions in this build. That matches the verdict's "submit first".

**After approval, second build, still no StoreKit**
- Web: the voice fix from section 2.
- Build 2:
  - iOS app-icon quick actions: stage-aware, pregnancy owner-only, free.
  - Widgets only if the verdict's demand bar is met. If they are built: Cubby's own look only, no palette or Pro code, and review notes saying they are free.
- **Cannot ship at this stage:** any Pro look, lock or Pro wording on these surfaces. Switching one on later by a web flag would be the 2.3.1(a) dormant-feature case and a 3.1.1 breach [RULE].

**StoreKit build** (needs the Paid Applications Agreement; whether that depends on the UAE licence is [UNVERIFIED])
- In-App Purchase subscription group: $9 monthly and $90 annual, with a 7-day introductory offer.
- A paywall inside the iOS app that meets 3.1.2, plus a Restore button.
- App Store Server Notifications V2 writing `households/{hid}.pro`. Before a second billing source can write that map, fix two bugs:
  - cancelling currently removes Pro immediately instead of at the end of the paid period;
  - the map is last-write-wins, so either subscriber cancelling switches Pro off for the household.
- Widget looks ship in this same build, with day and night values for each look, and are described in the review notes.
- Tastes resume on iOS.
- Never show the web checkout inside the iOS app. Skip the US-only link-out: detecting the storefront needs StoreKit, and the fee is still unsettled [UNVERIFIED].

**Play, later:** use consumption only. Pro bought on the web unlocks the Pro looks. Free users see only "Cubby", with no Pro prompts anywhere.

## 5. What not to gate, and what not to build

- **Do not gate:**
  - anything that answers "when was the last one";
  - any tap that starts a log;
  - privacy controls;
  - anything pregnancy-related;
  - a second baby;
  - night legibility.
- **Do not build:**
  - A Pro-only widget type. The widget gallery shows every type to everyone, so a free user could place a locked widget. Whether a bundle can hide a type per user is [UNVERIFIED].
  - A Pro-only widget size.
  - An insights or trend widget. The charter says "never feed the loop with charts", and the widget spec bans streaks, totals and targets.
  - Pro messages delivered through a widget.
- **Honest note on value:** widget looks will not sell Pro. The widget's commercial job is keeping people coming back. A paywalled glance would cost the retention that Pro depends on.
- **Existing wording drift:** the Pro sheet sells voice for "3am moments" (`:6792`), while how-it-works:156 says the 3am things are free. Putting "Say it" on a widget would make that contradiction visible.

## 6. Checks to add, each shown going red before it goes green

1. **The app pretending to be native shows no Pro sales copy.** No "$", "a year", "Register for Pro" or "Pro treat". This would fail on today's main at `:6819`.
2. **`canBuy` is false inside the app wrapper** even with `checkoutUrl` set. Fails today.
3. **The voice save never opens the Pro sheet**, even with voice tastes used up. Fails today at `voice-log.js:207-208`.
4. **Widget code and the widget data format contain no Pro wording or Pro field.** Prove it with a planted string.
5. **The looks picker offers no Pro chips on iOS until In-App Purchase exists.**

## 7. Still unverified

- Apple's view on sharing an In-App Purchase subscription with circle members.
- Whether a widget type can be hidden per user.
- Whether the Paid Applications Agreement depends on the UAE licence.
- Whether In-App Purchase needs a key in `App.entitlements`, which `cap_ios_configure.rb` rewrites wholesale.
- The US link-out outcome and fee.
- Whether iOS Safari ignores manifest shortcuts.

Files:
- /Users/m1promax/Downloads/little-log-pwa/app/index.html
- /Users/m1promax/Downloads/little-log-pwa/app/voice-log.js
- /Users/m1promax/Downloads/little-log-pwa/app/manifest.webmanifest
- /Users/m1promax/Downloads/little-log-pwa/docs/plans/2026-08-04-app-store-listing.md
- /Users/m1promax/Downloads/little-log-pwa/docs/plans/2026-09-26-ios-widgets-verdict.md
- /Users/m1promax/Downloads/little-log-pwa/design/components/cubby-components.html
- /Users/m1promax/Downloads/little-log-pwa/PAYWALL.md
- /Users/m1promax/Downloads/little-log-pwa/CUBBY-EXPERIENCE-CHARTER.md
- /Users/m1promax/Downloads/little-log-pwa/pricing/index.html
- /Users/m1promax/Downloads/little-log-pwa/how-it-works/index.html


---

## Adversarial review A — the product

**Adversarial review: Pro gating on widgets and quick actions (read-only, main at a64b7244)**

**Verdict**
- Put no Pro gate on the glance or on any log button, now or later.
- Drop the proposal's one Pro element, "widget looks". Do not schedule it for later either.
- The proposal's free/Pro table is right about everything else. Its compromise costs real work and earns nothing, and its own §5 says so: widget looks "will not sell Pro."
- The honest way to say yes to the founder: **Pro sits behind these buttons, never on them.** One free button, "Say it", leads into the voice logging treat that already exists, and only once four preconditions hold (see "The one element").

## 1. Would gating reduce logging? Widgets and quick actions give different answers

- **Quick actions: yes.** They reach every install with no setup. The widgets verdict (docs/plans/2026-09-26-ios-widgets-verdict.md:324-330) says they are the only home-screen feature that survives the first-log steelman. Gating them would hit the only home-screen surface that reaches people in their first week.
- **Widgets: no for the first log, yes for retention.**
  - Verdict §1 (:277-279): widget adoption is "strictly downstream" of a logging habit. A gate there cannot stop anyone's first log.
  - It does hit the only people who have formed a habit. Staying active is the next thing Cubby has to prove once people log at all.
- **Neither effect can be measured today.**
  - The app sends only two funnel event names: `onboarding.step_reached` and `pro.sheet_viewed`.
  - The manifest shortcuts (app/manifest.webmanifest:37-56) link to `?go=feed|sleep|diaper` with no source tag.
  - Quick actions have been live since 09-26, and no one can tell whether a single log came from them. Any gate decision here would be made blind.

## 2. Does it break "the essentials stay free, always"?

The live promises:
- /index.html:56: "At 3am, you already know when the last feed was."
- /index.html:186: "We will never paywall logging or sharing… never a wall around the basics."
- pricing/index.html:68: "We'll never paywall logging or caregiver sharing."
- how-it-works/index.html:156: "The things you reach for at 3am are the free ones."
- app/index.html:6809, on the Pro sheet: "The essentials, your data and your privacy stay free, always."
- CUBBY-EXPERIENCE-CHARTER.md:40-43 (anxious 3am mode): "answer in one glance, one tap."

What each gate would do:
- **Gating the glance** breaks the homepage headline directly.
- **Gating Feed/Sleep/Nappy** does not breach "never paywall logging" word for word, because the Feed button inside the app still works. But a lock on the word "Feed" reads as a paywall on logging. Android and desktop already get the same shortcuts free, so gating the iOS version would make iOS the only platform that pays.
- **Gating looks** breaks no promise. That is the only reason it survived into the proposal.

**Is logging from the home screen essential?** Split it three ways:
- The glance (last feed, nap, nappy) is essential, by the product's own published copy and charter.
- The log buttons are a convenience that users will see as essential.
- The widget's look is not essential.

## 3. Problems with the proposal itself

1. **Widget looks cost real work and earn nothing. Kill them.**
   - What it takes: a Settings picker, per-person storage, a taste counter, rules for lapsed Pro, day and night colours for each palette, and new strings through App Review.
   - What it sells: the ability to switch between three colours. Every free user also keeps one Pro look for good, which removes most of what is left to sell.
   - From my knowledge of WidgetKit (unverified): a palette only shows in full-colour mode on the home screen. Lock screen widgets are monochrome, tinted and clear modes recolour the widget, and StandBy at night is red. So the Pro look would be invisible on most of the surfaces the proposal lists.
2. **The proposal misses the Pro launch date.**
   - `PRO_LAUNCH='October 2026'` (app/index.html:6761) becomes the current month tomorrow. The date shows at :6819 and in the Settings row at :7803.
   - `checkoutUrl` is still `''`.
   - The launch already slipped once, from August. docs/plans/2026-07-20-market-position-and-aha.md:224-228 found "no evidence in the repo" that the UAE licence had been started.
   - If Apple reviews the app in October while it says "Cubby Pro arrives October 2026" and offers no in-app purchase, the reviewer will ask where the purchase is. On 1 November the line becomes false everywhere.
   - This is more urgent than anything about widgets. Fix it together with the proposal's Option A.
3. **Option A takes something away later.**
   - Under Option A, voice and the doctor PDF are unlimited on iOS until In-App Purchase ships. When it does, iOS users hit a lock on something they had free.
   - The code already avoids this for quick actions: `index.html:4219`, "so nobody's button changes under them."
   - The StoreKit build should reset iOS tastes to full, not lock straight away.
   - Tastes are shared per household (`state.settings.proTaste`, comment at :6771-6772). A partner on the web still counts down while the iOS partner does not.
4. **"Costs nothing: 12 households" is right for the wrong reason.** The native app has zero users because it has never shipped. The 12 households are on the web or the installed web app.
5. **The proposal never cites the Pro demand evidence that exists.**
   - `tools/analytics.js:87` prints the waitlist size.
   - `pro.sheet_viewed{entry_point:'feature_gate'}` counts how many people ever hit a Pro wall.
   - I did not run either.
6. **Rule 3 is the most valuable line in the proposal. Make it a check.** "Nothing opened from a widget or quick action ever opens the Pro sheet" should be its check #3, shown going red before it goes green.

## 4. Steelman: the founder's best case

1. **It comes from the repo's own verdict.** Widgets only reach people who already log, so a widget gate cannot cost a first log. And people who place a widget are the most engaged users, so the most likely to pay.
2. **Pro has nothing people use every day.** Keepsakes are monthly and the doctor PDF is once per visit. A subscription that is only useful now and then tends to lapse, and the widget is the only daily surface on offer.
3. **There is already a precedent.** Voice is a way of logging that costs Cubby nothing per use: voice-log.js has no fetch, so it runs on the device. It is still Pro with 5 tastes, and nobody called that a paywall on logging, because the free path to the same record stays open.
4. **The fixed cost is high.** 8 to 9 days of Swift, a second target, and copy that can only change through App Review. Paying users would justify that.

**Rebuttals**
1. It is true for the first log and false for retention, and retention comes next.
   - Revenue is capped at (households with a widget) × (conversion), which is about zero with 0 active users.
   - The costs are real today: three live marketing lines, the charter's Anxiety Test, and App Review.
   - On iOS a gate needs In-App Purchase. "Gate now" on iOS therefore means "remove it for everyone."
2. Pro's missing daily value is real. The fix is to make Pro's daily value real (for example, the smart routines on the roadmap), not to move a free thing behind the paywall. Monthly cards also line up with monthly billing, and the annual plan is the default.
3. The voice precedent is the inconsistency, not the rule.
   - The Pro sheet sells voice for "3am moments" (:6792), while how-it-works:156 says the 3am things are free.
   - Voice keeps a free way out in the same sheet ("Save it as a note instead · free"). A locked widget has no free way out in place.
4. A high fixed cost is an argument for not building the widget, and the verdict already says don't build it this cycle. It is not an argument for gating it.

## 5. The one element, if any

**"Say it" as a free button into the existing voice treat. No new gate.** It is the only link between these surfaces and Pro that matches what Pro already sells: arms full, a long-press on the icon. Conditions, all required:
1. The voice save no longer opens the Pro sheet (voice-log.js:207-208 → index.html:6778).
2. iOS can sell through StoreKit, or iOS tastes do not lock.
3. One side of the 3am contradiction is rewritten. I would drop "3am" from the voice pitch.
4. The button is stage-aware and never shown in pregnancy. Voice is deliberately not offered there (index.html:4212-4216), and anything she says would be dropped into a note no screen shows.
   - So "Say it" must **not** be added to the static manifest shortcuts: a static manifest cannot hide it from a pregnant user.

## 6. What would change my mind

- **On gating the glance or log buttons:** nothing available at this stage. At minimum I would need all of these:
  - 25 or more households on the post-09-24 build, with D1 and D7 measured.
  - A source tag on `?go=` links showing that home-screen users do not stay any longer than others.
  - A test showing materially higher Pro conversion under a gate.
  - The three marketing lines rewritten first.
- **On killing the "Say it" button as well:** web data showing that people who hit the voice wall (`pro.sheet_viewed{feature_gate}`) log less over the following 48 hours.
- **On widget looks:** Pro buyers naming home-screen personalisation as a reason to buy, or unverified competitor evidence of paid widget themes that people actually buy.
- **On Pro needing daily value:** high month-2 churn among monthly subscribers after launch. Answer that with new Pro value, not by taking back free surfaces.

## 7. Unverified

- WidgetKit rendering modes overriding custom palettes: my knowledge, not checked.
- Whether competitors gate widgets: not checked.
- Whether Apple treats a "coming soon" Pro screen with no In-App Purchase as a 2.1 or 2.3 problem.
- Whether a web purchase can unlock iOS features without In-App Purchase also being offered. My reading of 3.1.3(b) is no, from memory; verify the current text.
- Waitlist size and the count of feature-gate sheet views: exist, not run.

Files: /Users/m1promax/Downloads/little-log-pwa/app/index.html, /Users/m1promax/Downloads/little-log-pwa/app/voice-log.js, /Users/m1promax/Downloads/little-log-pwa/app/manifest.webmanifest, /Users/m1promax/Downloads/little-log-pwa/docs/plans/2026-09-26-ios-widgets-verdict.md, /Users/m1promax/Downloads/little-log-pwa/docs/plans/2026-07-20-market-position-and-aha.md, /Users/m1promax/Downloads/little-log-pwa/docs/plans/2026-08-04-app-store-listing.md, /Users/m1promax/Downloads/little-log-pwa/PAYWALL.md, /Users/m1promax/Downloads/little-log-pwa/CUBBY-EXPERIENCE-CHARTER.md, /Users/m1promax/Downloads/little-log-pwa/tools/analytics.js


---

## Adversarial review B — compliance

**Adversarial review: Pro gating on widgets and quick actions (read-only, main at a64b7244)**

## Verdict

**The founder's question: no.** Until StoreKit exists, there is no compliant way to put Pro on the widgets or quick actions in the iOS app. After StoreKit, Pro can only be an unlock bought through In-App Purchase inside the app. The widget itself can never carry an upsell. Guideline 4.4 (Extensions) says extensions may not include marketing, advertising or in-app purchases [RULE, wording from memory, check it]. The model never cites 4.4, and 4.4 is its strongest basis.

**The model's core idea is right.** Widgets and quick actions stay free, and Pro is only an In-App Purchase unlock of widget looks inside the app. That is the only shape that complies.

**The model is not safe to carry out as written, for four reasons:**
1. Its fix before Submit (option A) is a list of places to remove Pro, not one chokepoint. It misses more than 12 Pro surfaces and 2 deep-link entry points.
2. It does not say what `isPro()` means inside the app. A household that pays on the web in October would get Pro features in the iOS app, which has no In-App Purchase. That breaks 3.1.3(b).
3. Every later switch is keyed on "iOS" or `isNativeApp()`, not on whether the running binary has StoreKit. The web is shared by every approved binary. So the StoreKit launch itself would push locks and paywalls into builds 1 and 2, with no review.
4. Its check #1 would pass while Pro copy is still on screen.

Section 0 of the model is **correct** in the code: `index.html:6819` shows `priceLine` in the waitlist branch with no native guard. The "verified fact" given in the task, that the Pro screen shows no prices, is wrong.

## First submission: what gets it rejected or contradicts the notes

**1. The reviewer's likely path reaches Pro, and the notes deny it exists.** [VERIFIED in code]
- **Voice.** The notes list voice logging as native functionality (`docs/plans/2026-08-04-app-store-listing.md:155`), so a reviewer is likely to try it.
  - "Say it" is a default tile on Home (`index.html:4217`, `:4225`).
  - The preview shows "5 free tries left ✨" (`voice-log.js:263`).
  - The first save shows the toast "✨ Pro taster · 4 free tries left" (`index.html:6782`).
- **Doctor report.** The Visit summary sheet shows "📄 Doctor PDF report · ✨ try one free" (`:15422`).
  - The PDF has one free use, shared by the whole household (`PRO_TASTE`, `:6773`, `:6774`).
  - If anyone opened a report on the demo family while seeding it, the reviewer's first tap opens the Pro sheet with "$9/month, or $90/year".
- **Why it matters.**
  - The notes say "Cubby is free… it shows no prices" (`listing:161`). A false statement in review notes is 2.3.1 / 5.6 territory. It risks the developer account, not only the build [RULE, exact subsection unverified].
  - The listing description promises "keepsake cards made from what you already logged" (`listing:33`). That is the Monthly stats template, which is Pro-locked (`PRO_LOCK.templates`, `:17113`). 2.3.2 requires the description to say when a featured item needs a purchase [RULE from memory], and there is nothing to purchase.

**2. Option A's removal list is incomplete. Missed surfaces:**
- `voice-log.js:263` "Voice logging is a Pro treat ✨" and `:275` "Save it as a note instead · free".
- `:17954` "Pro styles on this card · N free shares left".
- `:17961` "Pro shares are clean ✨" and `:18957` "Pro shares come without the Cubby mark ✨".
- `proTag` at `:17926-7` and `:18635`.
- "· ✨ try one free" / "· Pro ✨" at `:9324`, `:10747`, `:12911`, `:15422`.
- The " ✨" suffix on the report buttons at `:10523-4` and `:12852-3`.
- The golden ✨ chips in the studio from `proLocked` (`:17114`).
- A direct `openPro('Then & Now',true)` at `:18897` that bypasses `useTaste`.
- The in-app guide chapter "Cubby Pro", which calls `openPro()` and says "You can register now…", plus "Manage Pro", which calls `openProPortal` (`teach-data.js:985-993`).
- The Pro branch of the sheet: "Renews…" plus "Manage subscription". `openProPortal` sends the app's own web view to the Lemon Squeezy portal (`:6842-6846`).
- **Deep link `?go=pro`** (`:2702`). `pricing/index.html:90` "Register for Pro" links to `/app/?…&go=pro`. Universal links cover `/app/*` (`worker.js:2253`), so on an iPhone with Cubby installed that tap opens the app straight onto the Pro sheet.
- **`?pro=success`** (`:6851`) shows the toast "Welcome to Cubby Pro 🎉 Your trial has started" inside the app if a checkout return link or receipt link opens the app [INFERENCE on how Lemon Squeezy's return link behaves].
- **Fix:** one chokepoint, for example `proSurfaces() = !isNativeApp() || iapAvailable()`. `openPro`, `startProCheckout`, `openProPortal` and both deep-link handlers return early. `useTaste` returns true without counting. `tasteLeft`, `proTag`, `proLocked` and the ✨ suffixes return nothing or false.

**3. The App Privacy answers are wrong while "Register for Pro" can be reached.** `joinProWaitlist` (`:6854-6862`) writes email, name and acquisition data to `waitlist` so Cubby can email launch news. That is a marketing use. The privacy answers say email is collected for app functionality only and "Never marketing lists" (`listing:88`) [INFERENCE on Apple's purpose categories]. Option A fixes this. It is one more reason option B is not viable.

**4. The notes need more than one changed line.**
- Delete "A Cubby Pro screen exists and registers interest only". Commit a64b7244 shows what happens when the reviewer is pointed at something that does not exist.
- Also update `listing:7`, `:114` and `:240`, which all describe register-interest.
- "The essentials are free." (`listing:55`) implies paid extras that cannot be bought. Consider "Cubby is free." [INFERENCE]

## Approved app pulled later (the wrapper loads the web, so a web change skips review)

**5. The model does not say what `isPro()` means in the app, which breaks 3.1.3(b) from October.** `PRO_LAUNCH` is 'October 2026', which is tomorrow.
- 3.1.3(b) allows a web purchase to unlock things in the app only if the same item is also sold through In-App Purchase in the app [RULE from memory, check the wording].
- The watermark branches on `isPro()` at `:17961`, `:18957`, `:19000`, `:19282` and `:19343`. A household that pays on the web would get clean shares in the iOS app with no In-App Purchase.
- "Pro chips do not appear… iOS before In-App Purchase, and Android on Play for free users" is ambiguous about households that have paid. It must apply to **everyone**.
- **Fix:** before StoreKit, `isPro()` reads false inside the app, and the watermark policy is the same for every household in the app.

**6. Every switch is keyed on the platform, not the binary.** "Tastes resume on iOS", "Pro chips… until In-App Purchase exists" and "`canBuy` requires `!isNativeApp()`" all look at the platform. On StoreKit day, 2026.33.1 and build 2 (no StoreKit) get the same web:
- tastes lock again;
- Pro chips appear;
- "Keep this look with Pro" calls a plugin that does not exist.

That breaks 3.1.1 on binaries approved as having no paid features, and Apple does not force users to update.
- **Fix:** key on the binary's capability, for example `Capacitor.isPluginAvailable(<IAP plugin>)` and a successful product fetch. Never on a date, never on `isNativeApp()` alone, never on `ROLLOUT`.
- `ROLLOUT 'native'` (`:1917-1934`) exists precisely to release features to app users without review. Ban it for anything Pro or purchase-related. Adjacent point: `FEATURES {den:false}` is a built, hidden feature that could be switched on the same way (2.3.1 / 2.5.2 [INFERENCE]).

**7. Widget data and dynamic quick actions must have fixed formats.**
- "The widget never checks for Pro" is not enough. If the App Group data carries any free-text field (a label, a title, a status line), a web deploy can later put "Try Pro" on the Home Screen or Lock Screen of an approved binary.
- The same applies to dynamic quick actions set from JavaScript through a plugin that accepts any title or URL.
- **Fix:** the widget renders only typed fields (kind as a fixed list, timestamps, display name, a version number) and refuses a version it does not know (the verdict already asks for this at `:126`). Quick actions come from a fixed list compiled into the app. No text from the web.
- 4.4 also asks for extensions to be disclosed in the **marketing text** (the description), not only in the review notes [RULE from memory].

**8. Build 2 would contradict the notes on loss.** The notes say "If a loss is recorded the app becomes a quiet holding screen and stops its prompts."
- Dynamic pregnancy quick actions and the opt-in pregnancy widget only update when the app runs on that phone.
- A loss recorded on another device leaves "Count kicks" on the long-press menu and "Week 24" on the Home Screen.
- `tools/loss_keepsake_check.js` does not cover native surfaces.
- **Fix:** clear both on loss, sign-out and account switch, or leave pregnancy out of build 2 [INFERENCE].

## Checks

**9. Check #1 would pass while Pro copy is on screen.**
- It looks for "$", "a year", "Register for Pro" and "Pro treat". It would pass while "Pro taster", "free tries left", "Pro styles", "Pro shares", "· Pro ✨" and the guide chapter all render.
- "a year" wrongly fails on ordinary copy (`log-guide.js:92`, `:94`, `teach-data.js:172`).
- **Fix:** match whole-word `Pro`, `free tr(y|ies)`, `free share`, `taste` and the ✨ suffixes, in the page and in every toast.
  - Run it with a native stub that has no In-App Purchase plugin (`tools/support_reach_check.js:20` already stubs Capacitor).
  - Use up every taste first (styles 3, enhance 3, cutout 3, thennow 1, pdf 1, voice 5), then load `?go=pro` and `?pro=success`.
  - It must fail on today's main before it passes.
- The guard gate that 539fb00e asked for was never built. No file in `tools/` mentions `checkoutUrl`, `canBuy` or `priceLine`. Keep `checkoutUrl` empty until the guard and its gate are on main and confirmed in the installed app.

## Needs StoreKit or Play Billing that does not exist, or is missing from the StoreKit plan

**10. Missing from the StoreKit build plan:**
- **Prices from StoreKit.** Show StoreKit's localised price, not the hard-coded USD `priceLine`. A $9 label in a non-US storefront misstates the price [INFERENCE].
- **First In-App Purchase needs a new version.** Apple's first In-App Purchase has to go in with a new app version [documented practice, check].
- **Terms of Use link.** Put a Terms of Use (EULA) link in the paywall and in the metadata [commonly enforced; the clause is unverified].
- **Account deletion.** It must tell someone subscribed through Apple that Apple keeps billing until they cancel [UNVERIFIED wording].
- **Cancel and last-write bugs: confirmed in code.** Lemon Squeezy's `cancelled` becomes `active:false` at once (`worker-lemonsqueezy.js:124-128`). The `pro` map is replaced whole on every write, so the last write wins (`:133-148`).
- **Payer leaves the circle.** Nobody owns the entitlement. If the payer is removed, Pro stays with the household while their Apple ID keeps paying. The entitlement needs an owner uid.
- **No steering.** No mention of web pricing inside the app.
- **Widget build signing.** `cap_ios_build.sh:72` signs only `$APP`, and `cap_ios_configure.rb` rewrites `App.entitlements` wholesale, which would drop `application-groups`. In-App Purchase probably needs no entitlements key; the in-app-payments key is for Apple Pay [UNVERIFIED].

**11. Paid looks may not show.** In iOS tinted and clear Home Screen modes and in StandBy night mode, the system recolours widgets. A paid palette may look the same as the free one [INFERENCE]. The picker must preview in her actual mode or say so.

**12. Play.**
- The Android app is not on Play yet (`docs/plans/2026-08-31-multiplatform-launch-readiness.md:39-49`).
- `isNativeApp()` is true in both wrappers, so the chokepoint should cover both.
- There is no Android widget in this plan, so "Pro bought on the web unlocks the Pro looks" on Play has nothing to unlock.
- Whether Play allows an app that only honours web purchases [UNVERIFIED].

**13. Developer switch in production.** `isPro()` returns true when localStorage `cubby-pro-dev` is '1' (`:6764`), and this ships inside the wrapper. No in-app setter was found. It is low risk, but the chokepoint should ignore it inside the app (3.1.1 bans unlock mechanisms of the developer's own [RULE]).

**14. Pregnancy is already partly gated.** The model's "do not gate anything pregnancy-related" does not match shipped code. The pregnancy and trying-stage doctor reports spend the PDF taste (`:12869`, `:10549`). `loss_keepsake_check.js` section 9 asserts the live trying report is still a Pro treat. Separately, the static Feed/Sleep/Nappy manifest shortcuts show to pregnancy-only and post-loss installs (Android and desktop, a charter risk).

## Safe interim

1. **Before Submit (web only).**
   - Build the chokepoint, keyed on "native and no In-App Purchase plugin": no Pro surface, every treat unlimited and uncounted, `isPro()` ignored, one watermark policy for the whole app.
   - Make `?go=pro` and `?pro=` do nothing inside the app. Make `canBuy`, `startProCheckout` and `openProPortal` refuse inside the app.
   - Add the check, failing first and then passing.
   - Rewrite the notes: no paid features, no purchase, no registration.
2. **Keep `checkoutUrl` empty** until step 1 is on main and confirmed in the installed app.
3. **Build 2.** Widgets and quick actions with no Pro and fixed formats, disclosed in the description, cleared on loss and sign-out.
4. **StoreKit build.** The first point where any paywall appears in the app, keyed on the plugin being present. Widget looks become the In-App Purchase unlock; the rest follows the model.

## Still unverified

- The exact wording of 4.4, 3.1.3(b), 2.3.1 and 2.3.2.
- Apple sharing one In-App Purchase subscription with circle members on other Apple IDs.
- Whether a widget type can be hidden per user.
- Whether the Paid Applications Agreement depends on the UAE licence.
- The US link-out rules and fee.
- Play's rules for apps that only honour web purchases.
- How Lemon Squeezy's return link and universal links interact.
- How tinted and clear modes render custom widget colours.

Files cited:
- /Users/m1promax/Downloads/little-log-pwa/app/index.html
- /Users/m1promax/Downloads/little-log-pwa/app/voice-log.js
- /Users/m1promax/Downloads/little-log-pwa/app/teach-data.js
- /Users/m1promax/Downloads/little-log-pwa/app/landing.js
- /Users/m1promax/Downloads/little-log-pwa/pricing/index.html
- /Users/m1promax/Downloads/little-log-pwa/worker.js
- /Users/m1promax/Downloads/little-log-pwa/workers/pro-billing/worker-lemonsqueezy.js
- /Users/m1promax/Downloads/little-log-pwa/docs/plans/2026-08-04-app-store-listing.md
- /Users/m1promax/Downloads/little-log-pwa/docs/plans/2026-09-26-ios-widgets-verdict.md
- /Users/m1promax/Downloads/little-log-pwa/docs/plans/2026-08-31-multiplatform-launch-readiness.md
- /Users/m1promax/Downloads/little-log-pwa/tools/cap_ios_build.sh
- /Users/m1promax/Downloads/little-log-pwa/tools/cap_ios_configure.rb
- /Users/m1promax/Downloads/little-log-pwa/tools/loss_keepsake_check.js
- /Users/m1promax/Downloads/little-log-pwa/tools/support_reach_check.js