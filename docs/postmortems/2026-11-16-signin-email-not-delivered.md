# Post-mortem — a sign-in email Resend accepted never arrived, and the app said "we just emailed you"

- **Date:** 2026-11-16
- **Severity:** P0 (open until its scope is known: one address, or every Gmail parent)
- **Duration:** 2026-11-16 10:03 UTC (first send) → open. The app-side fix is built, not yet live.
- **Status:** OPEN. DRAFT: the root cause of the non-delivery awaits the founder's reading of Resend's dashboard.
- **Author:** Claude (lane M), from the read-only investigation of 16 Nov 2026

> Policy: **every breakage gets a documented, blameless 5-Whys post-mortem.** Blameless = focus on
> systems and decisions, not people. Be honest, including our own contributing actions. If a "why"
> is inferred rather than proven, say so.

## What happened
During the founder's device test on the TestFlight app, a new Gmail test account asked for a sign-in
code. The app said "Check your inbox: we just emailed <address>" and showed the code box. No email
arrived in any folder, Spam included. A Resend a minute later got "We already sent an email to
<address> in the last minute, so use that one", and two more tries two hours later got the same
"we just emailed" panel. Nothing ever arrived.

Measured (read-only, the same day): Cloudflare zone analytics show four POSTs to `/api/signin-code`,
all 200, from the TestFlight web view: 10:03:51, 10:04:27, 12:18:49 and 12:21:42 UTC. Three made the
full send path (token, Firestore read and commit, link mint, Resend), and their cooldown cache writes
are logged after Resend's answer, which in `worker.js` can only follow a 2xx. 10:04:27 was the
cooldown reply. So Resend's API accepted all three emails, to one and the same normalised address.
DNS (SPF, DKIM, the return path, DMARC `p=none`) matches Resend's guide; there was no Resend incident;
the day's release did not touch the send path.

## Impact
- One test account could not sign in by email. Google and Apple sign-in were unaffected.
- Unknown, and the reason this stays P0: whether every Gmail parent is affected. None of production
  Auth's 17 accounts was created by email (a deleted one would not show), and no real parent called a
  sign-in endpoint in the 30 days before this, so email sign-in is unproven rather than disproven.
- Certain, for every parent: the app tells her "we just emailed you" on any 2xx from Resend, whether or
  not the email can ever arrive, and gives her no hint to use Google or Apple instead.
- Found alongside: the per-address cooldown's Cache API key held the plaintext address, and Cloudflare's
  zone analytics list each cache read and write as a subrequest path, so every address that asked for a
  sign-in email was visible there to anyone with access to the Cloudflare account.

## Root cause
**Why the email did not arrive: not known yet.** It awaits the founder's reading of Resend's dashboard
for the three sends, and above all the first one (10:03 UTC). What each reading would mean:
- `Suppressed`, after an earlier `Bounced` with SMTP 550 5.1.1 (for example, the first send went out
  before the new Gmail account existed): this address only.
- `Bounced` with a 5.7.x policy reply from Gmail, or `Delivery delayed` with 421 4.7.x: every Gmail
  parent. A later `Suppressed` would follow from that first bounce, so `Suppressed` alone does not
  settle the scope.
- `Delivered`: Gmail accepted it. This product's mail has been silently dropped by Gmail before
  (EMAIL.md, 2026-06-11), so a positive delivery to a long-standing Gmail account is still needed.

**Why the app said "we just emailed you" (certain, and fixed whatever the scope):** the Worker treated
Resend's acceptance as delivery. It kept no Resend message id, wrote no log line, had no read-back
and no webhook, and armed the cooldown on any 2xx, so nothing could ever learn that an accepted email
was suppressed, bounced or failed.

## 5 Whys
1. **Why did a parent wait for an email that would never come?** Because the app told her "Check your
   inbox: we just emailed you" and offered only the code box. (Measured: the four 200s above.)
2. **Why did the app say that?** Because both senders turned any 2xx from Resend into
   `{ok:true, hasCode:true}` and armed the cooldown, and the panel draws "we just emailed" from that.
3. **Why was a 2xx taken to mean delivered?** Because acceptance was the only signal Cubby ever
   looked at. Resend accepts an email for a suppressed address with a 2xx and then never sends it (its
   own email events: "suppressed: the email was not sent"), and a bounce comes after acceptance; Cubby
   threw away the id that would have let it ask.
4. **Why could nothing see past acceptance?** Because every gate stubs Resend as `200 {id}`, and the
   post-deploy live check sends to an `example.test` address (which can never be delivered) and checks
   only that Resend accepted it. Delivery was last confirmed by a person with an inbox on 2026-06-14.
5. **Why was delivery never measured?** Because each earlier email failure (Gmail dropping the shared
   Firebase sender on 2026-06-11, the Worker losing its secrets in early August, the wrong OAuth scope
   from 2026-08-19 to 08-23) happened before or at the provider's API, and the guards built after each
   one stop at that boundary too. → **Root cause (of the false "we just emailed"): the system treated
   "accepted by our email provider" as "delivered to her", with no way to learn otherwise.**

## Timeline (dates from `git log`; times from Cloudflare analytics, UTC)
- 2026-06-14 (5bb85290): the Worker sends sign-in mail through Resend; the last documented delivery to
  an inbox is the same day.
- 2026-08-21 (2e4b391d): one email carries both the code and the link.
- 2026-08-23 (c1e2057c): the wrong-OAuth-scope outage (every code request 502 since 08-19) is fixed.
- 2026-08-30 (13cf826c): the code is the way in. The Resend request and the "a 2xx means sent" rule are
  unchanged from here to 16 Nov.
- 2026-11-13 (5e6d0d54, round 5): the cooldown's VALUE records a hash of the exact address; its KEY
  stays the plaintext normalised address.
- 2026-11-16 07:48: release v369 (Worker version 1bb51101) is deployed; it does not touch the send path.
- 2026-11-16 10:03:51, 10:04:27, 12:18:49, 12:21:42: the four requests above. No email arrives.
- 2026-11-16, afternoon: read-only investigation (DNS, code, production, history, a skeptic).
- 2026-11-16, evening: the app-side fix is built on branch fix6-M (below). Not live yet.

## Contributing factors (blameless)
- The test address was brand new. If the first send went out before the mailbox existed, a 5.1.1
  bounce would put it on Resend's suppression list, and every later send would be accepted and dropped.
  (Hypothesis; the dashboard decides.)
- The free plan's sending volume is near zero, so `mail.little-cubby.com` has little reputation with
  Gmail. (Hypothesis.)
- Workers Logs is off and no log line existed, so production kept no record of Resend's replies.
- `tools/signin_live_check.js` sends a real email to an `example.test` address on every run, which can
  only fail delivery and counts against the sending domain. (Measured that it does so; its effect on
  reputation is inferred.)

## What fixed it
Built on fix6-M, waiting for the root session to integrate and push (EMAIL.md §9c):
- Each send writes one log line with Resend's message id, kind and status (never the address, the code,
  the link or a token), and returns a `sendRef` behind which the Worker keeps the id for an hour.
- `POST /api/signin-status` reads the email back from Resend and answers one coarse word (sent,
  delivered, delayed, undeliverable, unknown); same origin, its own limiter bucket, at most six reads
  per email, a 5-second timeout, never the body, the recipient or the subject.
- The panel asks at about 8, 20, 45 and 90 seconds. On undeliverable it stops saying "check your inbox"
  and says the email could not reach that address, pointing to the address and to Google or Apple. On
  delivered it says so and mentions Spam and Promotions. The code box is never touched.
- A second ask for the same address inside the minute never says "use that one" over an email that
  could not come: the cooldown's answer carries what the status route has already found (so a reload is
  covered), and the panel keeps what it learned when she taps "Wrong email?" or types a wrong code.
- The cooldown's cache key is an HMAC of the address, not the address.
- Gates: `signin-delivery` (Node, with fifteen mutants), `signin-delivery-workerd` (workerd's own Cache
  API, timeout, rate limiter and console) and the mail-status section of `ios-signin` (the real panel and
  the real Firebase SDK against the Auth emulator, ten parents at once: undeliverable, delivered,
  unknown, an older Worker, a link-only email, "Wrong email?" then the same address, a reload, a wrong
  code, signing in before an answer, and the panel leaving the screen).

This makes the app truthful. It does not make the email arrive: that depends on the root cause above.
It answers only with a Full-access Resend key; with a Sending-access key every answer is `unknown` and
the panel shows exactly what it showed before.

## Corrective actions
| # | Action | Type (Fix/Prevent/Process/Doc) | Status |
|---|--------|--------------------------------|--------|
| 1 | Log Resend's id per send; `/api/signin-status`; the panel's undeliverable and delivered notes | Fix | Built (fix6-M), not live |
| 2 | Hash the cooldown's cache key, both senders | Fix | Built (fix6-M), not live |
| 3 | Read Resend's dashboard for the three sends (first send first), and its suppression list | Process | TODO (founder) |
| 4 | Send a code to a long-standing Gmail account; Show original: SPF, DKIM and DMARC pass | Process | TODO (founder) |
| 5 | Check the Resend key's permission; decide whether a Full-access key belongs in the Worker | Process | TODO (founder) |
| 6 | Decide on Workers Logs (`[observability]`, invocation logs off); first move the invite-peek token out of its URL | Process | TODO (founder) |
| 7 | Point `tools/signin_live_check.js` at a Resend test address instead of `example.test` | Prevent | TODO |
| 8 | A Resend webhook into D1, for bounces and suppressions after the status window closes | Prevent | TODO |
| 9 | The invite email's cooldown cache key holds the invite token (`cooldown.cubby.internal/inv/<token>`) | Fix | TODO |

## Lessons
- "The provider accepted it" is not "she has it". Any step whose success happens somewhere we cannot see
  needs a way to ask, and the screen must not claim more than the answer.
- A cache key is a URL, and URLs end up in analytics. Hash anything personal before it becomes one.
- A guard that stops at the API boundary cannot see a failure past it. The next delivery gate has to
  read a real outcome (Resend's test addresses, a real inbox), not an acceptance.
