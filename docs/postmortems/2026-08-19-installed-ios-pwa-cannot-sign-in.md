# Installed iOS Cubby cannot sign in, by any method

**Date:** 2026-08-19 · **Severity:** P0 · **Status:** root cause confirmed, fix not yet shipped
**Reported by:** a real user, over WhatsApp, at 3:49am. Not by any alarm.

## What happened

A user could not sign in. Asked which method, they answered: **"All specific ways."** Apple, Google
and the email link all failed. Their words: *"I was ready to give my passport."*

## Who is affected

**iOS users who added Cubby to their home screen.** Not iOS Safari users in a normal tab. Not
Android. The screenshot proves the container: it shows the carousel card (`At 3am, you already
know` = `TILES[0]`) with Apple **above** Google, and `app/landing.js:270` renders that card only
when `isNative() || isStandalone()`, with Apple-first coming from `.lp-ios`, which is
`isStandalone() && /iPhone|iPad|iPod/` (`app/landing.js:21`).

Because an iOS home-screen PWA gets its **own storage container**, separate from Safari, this is
not a one-off: **every iOS install has to sign in again inside the installed app**, and that is the
sign-in that cannot complete. Every iOS install walks into it.

## Root cause

All three methods share one property: **they finish somewhere other than the installed app, and the
session lands in the wrong storage jar.**

| Layer | Fact | Where |
|---|---|---|
| Manifest scope | `"scope": "/app/"` — anything outside `/app/` exits the standalone window | `app/manifest.webmanifest` |
| authDomain | `little-log-a9caa.firebaseapp.com` — **cross-origin** to `little-cubby.com` | `app/firebase-init.js:64` |
| OAuth handler | `…firebaseapp.com/__/auth/handler` — cross-origin **and** outside scope | — |
| Email link | rewritten onto `little-cubby.com/__/auth/action` — also outside `/app/`, and tapped from Mail it opens Safari regardless | `worker.js:136` |
| Persistence | `Persistence.LOCAL` — correct, but LOCAL is **per browser container** | `app/firebase-init.js:104` |
| SDK | Firebase JS 10.12.2 — the version range where `signInWithRedirect` is defeated by Safari storage partitioning when authDomain is cross-origin | `app/index.html:71` |

So: Google/Apple `signInWithPopup` has no working opener channel in a standalone iOS webview, falls
through to `signInWithRedirect` (`store-firebase.js:633,647`), and the redirect both leaves the
container and is the mechanism Safari's partitioning breaks. The email link opens Safari from Mail.
In every case the user **does** sign in, in Safari, and the home-screen app remains signed out.

### Why nobody was told

Three independent silences, all in the same file:

1. `signInBusy()` (`store-firebase.js:615`) disables every sign-in button and is undone **only** by a
   `showSignIn()` re-render. If the popup promise never settles, the buttons stay greyed at
   "Signing in…" forever. There is no timeout and no recovery.
2. `auth.getRedirectResult().catch(function () {});` (`store-firebase.js:2991`) **swallows every
   redirect error**.
3. `maybeFinishEmailLink()` (`store-firebase.js:414-421`): in Safari the key
   `cubby-email-signin` is absent (it was written in the PWA's jar), so it prompts; dismiss the
   prompt and `if (!email) return;` exits **silently**, no message.

### Why they were in that container at all

We put them there. `canShowInstall()` (`app/index.html:12750`) is true for signed-out iOS Safari
users, and `installRowHtml()` injects "Or add Cubby to your home screen" **onto the sign-in card
itself** (`store-firebase.js:445,462`), shipped 2026-06-24 (`309f22d`). On 2026-08-07 (`d6ef790`)
installed PWAs were given the dedicated app sign-in screen. **We advertise the install at the exact
moment the install breaks sign-in.**

## Five whys

1. *Why couldn't they sign in?* Every method completed in Safari, not in the installed app.
2. *Why?* The OAuth handler is cross-origin and the email link is out of manifest scope, so both
   leave the standalone container; iOS gives that container its own storage.
3. *Why is the handler cross-origin?* `authDomain` was reverted to `firebaseapp.com` on 2026-07-13
   because our own `/__/*` proxy 404'd per-edge and broke Google + Apple.
4. *Why did that revert not get caught?* It was verified in a browser tab, where popup sign-in
   works. The installed-PWA case was never tested, and the standalone sign-in screen shipped
   three weeks later without re-testing auth.
5. *Why did it take a 3am WhatsApp to find it?* **There is no sign-in telemetry at all.** No event
   on attempt, success or failure. The July outage had the same observability gap and it was logged
   as a follow-up that was never built.

## What was ruled out, with the measurement

Cheap to re-check, and each was a plausible story that the evidence killed:

- **Web API key / authorized domains** — key live; `authorizedDomains` = localhost,
  firebaseapp.com, web.app, workers.dev, **little-cubby.com**. Fine.
- **`www.` not authorized** — real gap in the list, but `www.little-cubby.com` **301s** to apex for
  both `/` and `/app/`. Cannot be hit.
- **The `/__/*` proxy 404ing again (the July cause)** — `/__/auth/handler` and `/__/auth/action`
  both **200** from the DXB edge. Healthy.
- **Stale service worker serving an old `authDomain`** — prod serves the correct value, and the
  boot files are `max-age=0, must-revalidate`.
- **Worker lost its secrets (the push-cron failure mode)** — `wrangler secret list` shows
  **both** `FIREBASE_SERVICE_ACCOUNT` and `RESEND_API_KEY`. Email sending is configured.
- **A consent gate blocking the buttons** — `consentHtml()` is copy only, no gate.
- **In-app browser (WhatsApp webview)** — would render the marketing landing, not the carousel.
  The screenshot rules it out.

## Fix

**Stop the bleeding (hours, low risk):**
- Time out `signInBusy()` and restore the buttons with a real message. A permanently dead button is
  the worst state in the app.
- Stop swallowing `getRedirectResult()` — surface it via `errText`.
- Make `maybeFinishEmailLink()` say something when the prompt is dismissed instead of returning.
- Stop showing the install nudge to **signed-out** users. Sign in first, then offer the install.

**Real fix (the only one that holds):** sign-in must never leave the container. Mint a **one-time
code** server-side (the Worker already has `FIREBASE_SERVICE_ACCOUNT`), exchange it for a custom
token, and call `signInWithCustomToken` in-page. No navigation, no popup, no cross-origin handler,
no second storage jar. Same path works in the native wrapper.

Widening `scope` to `/` does **not** fix it — the OAuth handler is a different origin, so scope
cannot keep it in. Moving `authDomain` back to `little-cubby.com` would make it same-origin and is
what Firebase recommends for Safari, but it re-enters the July per-edge proxy risk and must not be
done without proving the proxy across regions first.

## Not yet verified

The exact branch on device (popup returns null → redirect → Safari, versus popup opens detached and
hangs) is inferred from the code plus documented iOS/Safari behaviour, not observed on an iPhone.
Sixty-second confirmation: on an iPhone with Cubby on the home screen, try Google; then open
`little-cubby.com/app/` in Safari and try the same account. Safari succeeding while the home-screen
app stays signed out confirms it exactly.

## Follow-ups

- [ ] Sign-in telemetry: attempt / success / failure, with method and `display-mode`. Second time
      this gap has been the reason a founder found an auth outage before we did.
- [ ] A gate that fails when the sign-in path depends on a cross-origin or out-of-scope navigation.
- [ ] Re-check the 11 churned households (`tools/analytics.js`: 282.6h median to first log, 0
      sticky) against iOS installs — some of that funnel may be this bug, not disinterest.

---

## Shipped 2026-08-19: the bleeding, stopped

The four "stop the bleeding" items above are live. The **real fix is still open** — sign-in still
leaves the container on an installed iOS app, and the one-time-code exchange has not been built.

| item | where | what changed |
|---|---|---|
| `signInBusy()` never recovered | `store-firebase.js` | a 25s timer restores the buttons and says something true. Nothing recovers a promise that never settles except a clock. `showSignIn()` cancels it, so backing out of a popup is not told 25 seconds later that it "did not come back" |
| `getRedirectResult().catch(function(){})` | `store-firebase.js` | surfaced through `errText`. An empty catch on the auth path is how a person gets a silent nothing |
| `maybeFinishEmailLink()` returned silently | `store-firebase.js` | says what it needs when the prompt is dismissed. The key is absent whenever the link opens in a different container, which on iOS is every time |
| the install nudge on the sign-in card | `store-firebase.js` | `installRowHtml()` now returns `''` unless `auth.currentUser`. Gated on the SESSION, not at the two call sites, so a future signed-in surface still gets it |
| **and the same trap in prose** | `landing.js` | the `.lp-pwa` line ("Add Cubby to your home screen…") is suppressed on iOS. It was talking signed-out iPhone users into the exact action that locks them out. Kept on Android and desktop, where it is true |

On an installed iOS app the stuck message now names the situation and gives the route that works
today — open little-cubby.com in Safari — instead of a dead grey button. That is a workaround on the
screen, not a fix, and it should be deleted the day the real fix lands.

**Still open:** the one-time-code exchange (`signInWithCustomToken`, no navigation, no popup, no
cross-origin handler), sign-in telemetry, and the gate that fails when the sign-in path depends on a
cross-origin or out-of-scope navigation.
