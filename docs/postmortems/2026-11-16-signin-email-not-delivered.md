# Post-mortem — a sign-in email Resend accepted never arrived, and the app said "we just emailed you"

- **Date:** 2026-11-16
- **Severity:** P0. Resend shows the send as Suppressed, which is per address; it stays open until the
  suppression's origin is read (a 5.7.x policy bounce behind it would make it every Gmail parent)
- **Duration:** 2026-11-16 10:03 UTC (first send) → open. The app-side fix is built, not yet live.
- **Status:** OPEN. The founder read the send's status (Suppressed) on 16 Nov; the suppression's origin
  and date are still to be read on Resend's Suppressions page.
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
**Why the email did not arrive: the address was on Resend's suppression list.** The founder read the
send in Resend's dashboard on 16 Nov 2026: status `Suppressed`. Resend keeps one suppression list for
the whole team. An address goes on it after a hard bounce, a spam complaint, or a manual add, and from
then on Resend accepts every send to it (a 2xx, which is all the Worker ever saw) and never sends it.
So this was one address, not a Gmail-wide block. Still to read, on the Suppressions page
(resend.com/emails/suppressions): what put the address there, and when. A hard bounce with 550 5.1.1
(for example a first send before the new mailbox existed, or a mistyped address) means this address
only. A bounce with a 5.7.x policy reply would mean Gmail refused Cubby's mail, which reopens the
scope. A complaint or a manual add would each be their own story. No address is written here or
anywhere in the repo; the send is found by its Resend id (EMAIL.md §9d).

**Why the app said "we just emailed you" (certain, and fixed whatever the scope):** the Worker treated
Resend's acceptance as delivery. It kept no Resend message id, wrote no log line, had no read-back
and no webhook, and armed the cooldown on any 2xx, so nothing could ever learn that an accepted email
was suppressed, bounced or failed.

## 5 Whys
1. **Why did a parent wait for an email that would never come?** Because no email was ever sent, and the
   app told her "Check your inbox: we just emailed you" and offered only the code box. (Measured: the
   four 200s above.)
2. **Why was no email sent?** Because the address was on Resend's suppression list, so Resend accepted
   each request and skipped it. (Measured: the founder's reading, status `Suppressed`.)
3. **Why was the address on the suppression list?** Because something put it there: a hard bounce, a
   spam complaint, or a manual add. Which one, and when, is the reading still to take on the
   Suppressions page. (Inferred, most likely: an earlier send hard-bounced, for example before the new
   mailbox existed. Not proven.)
4. **Why did the app say "we just emailed" over a send that never left?** Because both senders turned
   any 2xx from Resend into `{ok:true, hasCode:true}` and armed the cooldown, and acceptance was the
   only signal Cubby ever looked at. Suppression is silent at the send call by Resend's design (the send
   is accepted; only the email's later status says `suppressed`), and Cubby threw away the id that
   would have let it ask.
5. **Why could nothing see past acceptance, and why was she given no way out?** Because every gate stubs
   Resend as `200 {id}`, the post-deploy live check sends to an `example.test` address and checks only
   acceptance, and each earlier email failure (Gmail dropping the shared Firebase sender on 2026-06-11,
   the Worker losing its secrets in early August, the wrong OAuth scope from 2026-08-19 to 08-23)
   happened before or at the provider's API, so the guards built after each one stop at that boundary
   too. And the panel was built on the premise that the email comes, so it never pointed back to Google
   or Apple. → **Root cause: the system treated "accepted by our email provider" as "delivered to her",
   had no way to learn otherwise, and gave a parent no way out while she waited; one address on the
   provider's suppression list was enough to show it.**

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
- 2026-11-16, evening: the founder reads the send in Resend: `Suppressed`. Production's Resend key is
  Sending access, so the status route answers `unknown` to every ask there.
- 2026-11-17: round 7 on fix6-M: the "it can take a few minutes" line that works with any key, every
  note above the iPhone keyboard, no "Resend email" under an undeliverable note, a cooldown answer that
  looks once itself. Not live yet.
- 2026-11-17: round 7's skeptic: the slow line was tied to the asking chain's 45-second step, so a parent
  who went to Mail to look for the code and came back a minute later got it 37 seconds after her return.
  Pass 2 times it from the send (and from the wall clock, for a phone that slept), proves a hung status
  ask is given up, and that a "codes paused" answer gets no slow line. Not live yet.

## Contributing factors (blameless)
- The test address was brand new. If the first send went out before the mailbox existed, a 5.1.1
  bounce would have put it on Resend's suppression list, and every later send would be accepted and
  dropped, which is what the dashboard shows for this send. (The origin is a hypothesis until the
  Suppressions page is read.)
- The status the app needed to read back is behind a Full-access Resend key, and production's key is
  Sending access, so round 6's watch alone would have changed nothing on her screen.
- In the installed app she waits in the code box with the keyboard up, and the note sat under the box,
  so under the keys (round-6 skeptic R6M2-1): even a correct note would not have been seen.
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
  could not come: the cooldown's answer carries what is settled about its email, and when nobody has
  asked yet (a reload before the panel's first ask) it looks once itself, inside the same bound; the
  panel keeps what it learned when she taps "Wrong email?" or types a wrong code.
- Whatever the key (round 7): if nothing is settled about 45 seconds after the email went, the line says
  once "It can take a few minutes to arrive. You can also continue with Google or Apple now." It is timed
  from the send, so it is there the moment she comes back from Mail, and a status ask that hangs is given
  up after 7 seconds so it cannot hold the line back. Every note
  is kept above the iPhone keyboard with the code box; an undeliverable note over an empty box lets go
  of it so the keys drop and the Google and Apple buttons show. "Resend email" is hidden under an
  undeliverable note; "Wrong email?" stays. At 320 px the email row has its right gutter back.
- The cooldown's cache key is an HMAC of the address, not the address.
- Gates: `signin-delivery` (Node, with eighteen mutants), `signin-delivery-workerd` (workerd's own Cache
  API, fetch, timeout, rate limiter and console) and the mail-status section of `ios-signin` (the real
  panel and the real Firebase SDK against the Auth emulator, twenty-four parents at once: undeliverable,
  delivered, unknown, an older Worker, a link-only email, "Wrong email?" then the same address, a
  reload, a wrong code, signing in before an answer, the panel leaving the screen, and from round 7 five
  parents with the stood-in keyboard up, a reload before any ask, a different address after "Wrong
  email?", a bounce that comes after the slow line, and six more in its second pass: back from Mail
  60 seconds on, with a sendRef and without, back at 30 seconds, a phone that slept, a status ask that
  never comes back, and codes paused while her newest still works).

**What she sees, by key.** With today's Sending-access key every status read is a 401, so `unknown`:
the panel says "Check your inbox" and, about 45 seconds later, "It can take a few minutes to arrive.
You can also continue with Google or Apple now." That is what a parent in the incident would see tonight,
and it is the way out she did not have. With a Full-access key (the founder's call: it can also read
every email and manage domains) the panel learns at the 8-second ask that a suppressed email is
undeliverable, says "We couldn’t get that email to <address>, so no code is on its way. Check the
address, or continue with Google or Apple.", hides "Resend email", and drops the keyboard if her code
box is empty; a reload's cooldown answer says the same. Neither key makes the email arrive: that is the
suppression, and the runbook (EMAIL.md §9d) is how it is cleared.

## Corrective actions
| # | Action | Type (Fix/Prevent/Process/Doc) | Status |
|---|--------|--------------------------------|--------|
| 1 | Log Resend's id per send; `/api/signin-status`; the panel's undeliverable and delivered notes | Fix | Built (fix6-M), not live |
| 2 | Hash the cooldown's cache key, both senders | Fix | Built (fix6-M), not live |
| 3 | Read Resend's dashboard for the three sends (first send first), and its suppression list | Process | Status read (Suppressed); the suppression's origin and date TODO (founder) |
| 4 | Send a code to a long-standing Gmail account; Show original: SPF, DKIM and DMARC pass | Process | TODO (founder) |
| 5 | Check the Resend key's permission; decide whether a Full-access key belongs in the Worker | Process | TODO (founder) |
| 6 | Decide on Workers Logs (`[observability]`, invocation logs off); first move the invite-peek token out of its URL | Process | TODO (founder) |
| 7 | Point `tools/signin_live_check.js` at a Resend test address instead of `example.test` | Prevent | TODO |
| 8 | A Resend webhook into D1, for bounces and suppressions after the status window closes | Prevent | TODO |
| 9 | The invite email's cooldown cache key holds the invite token (`cooldown.cubby.internal/inv/<token>`) | Fix | TODO |
| 10 | "It can take a few minutes" with Google and Apple, after 45 s with nothing settled, whatever the key | Fix | Built (fix6-M, round 7), not live |
| 11 | Every note above the iPhone keyboard; an empty code box lets go under "no code is on its way" | Fix | Built (fix6-M, round 7), not live |
| 12 | Remove the address from the suppression list only once its cause is fixed (EMAIL.md §9d) | Process | TODO (founder) |

## Lessons
- "The provider accepted it" is not "she has it". Any step whose success happens somewhere we cannot see
  needs a way to ask, and the screen must not claim more than the answer.
- A cache key is a URL, and URLs end up in analytics. Hash anything personal before it becomes one.
- A provider's suppression list fails one address silently and for good: the API keeps saying yes.
  Whatever the app cannot know, it must still leave her a way in.
- A note under the keyboard is a note not said. Check where a message lands on the device's real
  surface, keys up, before calling it shown.
- A wait built as a chain of steps drifts when the phone puts the app aside: she checks Mail, and the
  chain stops where it was. Time a promise ("about 45 seconds after the email went") from the event.
- A guard that stops at the API boundary cannot see a failure past it. The next delivery gate has to
  read a real outcome (Resend's test addresses, a real inbox), not an acceptance.
