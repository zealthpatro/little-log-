# "We say we send a code but we only send a link"

**Date:** 2026-08-21 · **Severity:** P2 as reported, and the P0 it was checked for did not exist
**Reported by:** the founder. **Status:** verified, fixed, gated.

## The question that had to be answered first

> Can the client show the "we sent you a 6-digit code" panel while the LINK email is what actually
> went out?

If yes, that is a live sign-in trap and a P0: a parent stares at a six-digit box waiting for a code
that is never coming.

**Answer: no.** Verified, not assumed. `showCodeEntry()` is reachable from exactly one place,
`sendCode()` (`app/store-firebase.js`), and `sendCode()` calls `/api/signin-code` with **no fallback**
of any kind. The link sender is a separate function with a separate endpoint. There was no path from
one panel to the other's email.

The three endpoints were probed live, with a malformed address so validation was reached and no mail
was sent:

| Probe | Result |
|---|---|
| `POST /api/signin-code`, no Origin | `403` — the same-origin guard works |
| `POST /api/signin-code`, real Origin, bad address | `400 invalid_email` — live, distinct, validating |
| `POST /api/send-signin-link`, real Origin, bad address | `400 invalid_email` |
| `POST /api/signin-verify`, real Origin, wrong code | `400 bad_code` |

## Which path ran where, before this change

`codeSignin()` was `isStandaloneApp() && isIOSDevice()`. That is the **only** surface that got a code.

| Surface | `codeSignin()` | Endpoint | Email sent |
|---|---|---|---|
| Installed iOS home-screen app | **true** | `/api/signin-code` | code only |
| iOS Safari, normal tab | false | `/api/send-signin-link` | link only |
| Android, desktop, any browser tab | false | `/api/send-signin-link` | link only |
| **Native iOS wrapper (Capacitor)** | **false** | `/api/send-signin-link` | link only |

The native-wrapper row is the one worth stating out loud. `isStandaloneApp()` reads
`display-mode: standalone` or `navigator.standalone`; in a Capacitor WKWebView the first is `browser`
and the second is a Safari-only property that does not exist. So the wrapper took the link path. That
was survivable — the worker registers `/__/auth/action` as a universal link so the mail taps back into
the wrapper — but it was true by accident of two negatives, not by decision.

**So the founder's report was right, just not in the way it was checked for.** Nothing lied about
which email it sent. The code path simply almost never ran: every surface except an installed iOS PWA
got a link and only a link, which from the outside is exactly "we never send a code."

While reading the same file, one stale claim: `app/landing.js:13` says email sign-in is hidden in the
native wrapper. It is not — `isNativeApp()` is never consulted by the email row.

## The real defect underneath

Choosing between a code and a link **client-side is choosing with the wrong information.** Which half
works does not depend on what kind of browser she opened, which is all the client can see. It depends
on **where she reads the mail**, which nothing on our side can know:

- Same phone, normal tab: the link is one tap.
- **Asked on the laptop, reads mail on the phone:** the link signs the *phone* in. The laptop she is
  sitting in front of never moves. Only a code finishes the session she actually started. This case
  is not iOS, not an install, and not rare, and the link-only path could not serve it at all.
- Installed iOS app: a link tapped in Mail opens Safari, whose storage jar the app cannot see
  (see `2026-08-19-installed-ios-pwa-cannot-sign-in.md`). Only the code lands in the right container.

A guess with three outcomes and no way to observe the deciding variable is not a guess worth making.

## What shipped

**One sign-in email, carrying both.** `signinEmailHtml(code, link)` in `worker.js`, in the existing
table-based template. Code first and largest because it works from any device; the link underneath as
the shortcut for the common case. Both senders now render that one template under one subject
(`Your Cubby sign-in code`), so the two routes cannot say different things again.

Each endpoint keeps the half it is named for as the hard requirement and treats the other as a bonus,
so a slow dependency costs the email a half rather than costing her the sign-in:

- `/api/signin-code`: no code stored → `502`, no email. Link generation failing → code-only email.
- `/api/send-signin-link`: link is required. Code storage failing → link-only email.

The template renders each half on its own terms, with no dangling furniture: no empty `href`, no
"tap instead" with nothing to tap, no empty code block.

**The code box is now on every sign-in surface**, not only installed iOS. A code in the inbox with
nowhere on screen to type it is the same broken promise as a code panel over a link-only email.

**Two smaller honesty fixes found on the way:**

1. The worker answers `{ok:true, cached:true}` when the per-address cooldown is armed, and on that
   answer **it sent nothing**. Both panels reported it as a fresh send, so she waited on an inbox
   nothing was coming to. They now say "we already sent one in the last minute" and point her at it.
   `sendLink()` was also discarding the worker's response body, so `cached` could not have been read
   even if someone had tried.
2. If our worker is down, `sendLink()` falls back to Firebase's own sender, which mails a **bare
   link**. Showing a code box over that email would be this exact bug wearing the other shoe, so the
   fallback is now labelled `{fallback:true}` and the code box is hidden when it fires.

**Nothing about the code got looser.** Adding the link touched none of it, and the gate holds each
property: HMAC'd with the address inside the MAC, plaintext never stored, single use, 10-minute TTL,
5 tries, the attempt spent *before* the compare, constant-time verify, both endpoints behind the
same-origin guard, and the issue PATCH still carrying **no updateMask** so a new code replaces the old
one instead of merging beside it. Minting moved into one shared `issueSigninCode()` precisely so those
invariants live in one place and cannot drift between two senders again.

Adding a code to the link email grants no capability the link did not already grant: both prove
control of an inbox and both are single-use.

## The gate

`node test/signin-email.test.js --self-test` — 60 assertions, wired into `tools/gates.js`.

It lifts the real template out of `worker.js` and evaluates it, so it grades the shipped code rather
than a copy of itself, and it holds the three things that must not drift apart: the template renders
both halves and degrades cleanly; both senders use that one template under one subject; and no screen
can promise a code the inbox does not carry.

`--self-test` re-runs the source-shaped assertions against six deliberately broken copies (link
dropped, subjects drifted, `updateMask` added, plaintext code stored, code box shown over the
fallback, cooldown reported as a fresh send) and requires each break to be caught. Every gate here
that never failed was a gate nobody had proved could.

## What is still open

- **The cooldown can still strand one narrow case.** Burn a code with 5 wrong guesses, then ask for a
  new one inside 60 seconds: the cooldown returns `cached:true`, no new code is minted, and the old
  one is already deleted. The panel is now honest about it ("try again in a moment") and the wait is
  under a minute, so this is no longer silent. It was left as-is deliberately: minting on that path
  would let anyone burn a code and immediately trigger another email, which is the mail-bomb the
  per-address cooldown exists to prevent. Fixing it properly needs a different anti-abuse shape, not
  a hole in this one.
- `app/landing.js:13` still claims email sign-in is hidden in the native wrapper. Comment only.
- `stuckSignInMsg()` still tells installed iOS users to "open little-cubby.com in Safari", which
  predates the code path and is no longer the best advice available to them.
- There is still **no sign-in telemetry**. The 2026-08-19 postmortem ended on that and it is still
  true: this report came from the founder, not from an alarm.
