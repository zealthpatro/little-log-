# Post-mortem: the rate limits were far looser than their numbers, and the code could not say so

- **Date:** 2026-10-27
- **Severity:** P2 (defence in depth). No breach found or implied. Every limited route has a stronger
  check behind its limiter, but the per-IP volume caps the code and `wrangler.toml` describe as "5 a
  minute" or "10 a minute" were never that, and when they were seen not to work nobody could tell why.
- **Duration:** 2026-06-14 (8e47d466, the first limiter) to now. The looseness is Cloudflare's design and
  stays. What is fixed is that a limiter failure is now visible and the comments now tell the truth.
- **Status:** RESOLVED for visibility and docs (commit "The rate limits were far looser than their
  numbers, and nothing said so"). OPEN as a product decision: whether any route needs a strict limit
  (action 4).
- **Author:** Claude (Opus 5.5), for the founder

> Policy: **every breakage gets a documented, blameless 5-Whys post-mortem.** Blameless = focus on
> systems and decisions, not people. Be honest, including our own contributing actions. If a "why"
> is inferred rather than proven, say so.

## What happened
While proving the dose fix live on 2026-10-26, a check that sent invalid tickets to `/api/dose` until
the new 10-a-minute limiter answered 429 never got one. A calibration against `/api/invite-peek`, whose
5-a-minute sign-in limiter had been live since June, never got one either.

## What we measured (2026-10-27, one IP, invalid inputs only, nothing written or sent)
| Probe | Configured | Sent | Refused | A strict limit would refuse |
|---|---|---|---|---|
| `/api/dose`, one a second, 73 of 75 in LHR | 10 / 60s | 75 over about 90s | 0 | about 60 |
| `/api/invite-peek`, one a second | 5 / 60s | 15 over 15s | 0 | 10 |
| `/api/dose`, burst, 10 in flight | 10 / 60s | 100 in 5s | 6 | 90 |
| `/api/invite-peek`, burst, 10 in flight | 5 / 60s | 60 in 6s | 9 | 55 |
| Same bindings in local workerd (`getPlatformProxy`), both `[[unsafe.bindings]]` and `[[ratelimits]]` | 5 / 60s | 12 | 7 | 7 |

So the limiters work: they do refuse, locally exactly and in production under a burst. In production
they are approximate by design. Cloudflare's docs say counts are "eventually consistent" and that
"requests can exceed your configured limit while counts update in the background"; each machine checks
a locally cached count, so requests spread across one location's machines barely add up. An
independent test (Classmethod) saw 100 requests in 10s against 10/60s refused only "a few" times. A
steady trickle is never refused at all.

## Impact
- No route depended on its limiter alone. Sign-in codes carry a per-code `tries` count spent before the
  compare; sign-in mail has a per-email cooldown; invite peeks need a secret token; invites need a
  Firebase ID token; dose writes need a signed ticket and, since 6ea571dd, a membership.
- What the looseness leaves open: one IP can send sign-in mail to many DIFFERENT addresses well above
  "5 a minute" (Resend quota, sender reputation), sign up many newsletter addresses, inflate the
  anonymous funnel counter, and spam the guessing game, at tens of requests a minute.
- Not affected: any family's data.

## Root cause
The code was written against the limiter's number, not its behaviour. Comments said "caps one IP to 5
calls per 60s", and the call sites were built to fail open silently, so the only evidence that could
have corrected that belief (a limiter that never refuses, or one that throws) was discarded at nine
places.

## 5 Whys
1. **Why did no probe get a 429?** Cloudflare's limiter is approximate; at one request a second it never
   refused, and in a burst it refused 6 to 15 percent where a strict count would refuse about 90.
2. **Why did that surprise us?** `wrangler.toml` and the code described each limit as an exact cap
   ("caps one IP to 5 ... calls per 60s"). The docs' "approximate" was read as "within a little".
3. **Why was the belief never corrected in four months?** Nothing ever exercised a limiter in production,
   and no test could: every test stubbed `limit()` and checked our code, not Cloudflare's behaviour.
4. **Why could the first real observation not be explained?** Nine call sites each caught the error and
   discarded it, so "throws every time", "always allows" and "allows a trickle" looked identical. A reply
   without a boolean `success` was even read as a DENIAL, which would have failed closed on every route.
5. **Why were they written that way?** Fail-open was a deliberate, correct choice (an outage must never
   block a parent signing in), and silence came along with it. Nobody separated "let the request
   through" from "say nothing". **Root cause:** fail-open without telemetry, plus documentation of a
   configured number as an enforced one.

## What fixed it
- `rateLimited(limiter, key, where, opts)` in `worker.js` is now the only code that calls `.limit()`.
  On a throw or a malformed reply it logs (`ratelimit_throw`, `ratelimit_shape`) and fails open, except
  the 404 page-view counter, which passes `{ failClosed: true }` because a lost count costs nothing (its
  policy before this change too). It logs every denial (`ratelimit_deny`); an allow logs nothing. All
  ten call sites use it, keys unchanged (including the 2026-11 security release's `clientIpKey`, which
  buckets IPv6 by network). Rebased onto that release (866851ac) on 2026-11-13.
- A limiter line says the reason and the route, nothing else: never the key, the error text or the
  reply, because each key carries the client's IP or network and a limiter's error or reply may repeat
  it (a review point from the security session; the first version did log the error text). At most 5
  lines a minute per reason and route in an isolate, then one `ratelimit_dropped` count, so a flood
  cannot drive log volume.
- `wrangler.toml` and the code comments now state the measured behaviour instead of the configured
  number.
- `test/ratelimit.test.js` drives the real fetch handler on 11 limited routes and the 404 counter with
  a limiter that denies, throws, answers nonsense and allows, and checks that `.limit(` appears exactly
  once. Its limiters echo the key in their error text and reply, so a leak would show, and a pinned
  clock checks the cap. Red on the old `worker.js`: 48 of 92 failed (2026-10-27); on the security
  release's `worker.js`, 53 of 140 (2026-11-13). Green on the fix: 140 of 140, and `--self-test` breaks
  it 11 ways, each caught. Wired into `tools/gates.js` as `ratelimit`.

## Corrective actions
| # | Action | Type | Status |
|---|--------|------|--------|
| 1 | One helper for every limiter call; log throw, malformed reply and denial | Fix | DONE (deploy pending) |
| 2 | Comments and `wrangler.toml` describe measured behaviour | Doc | DONE (deploy pending) |
| 3 | `test/ratelimit.test.js`, 11-mutant self-test, wired into `tools/gates.js` | Prevent | DONE |
| 4 | Decide whether sign-in mail needs a STRICT per-IP limit (a Durable Object or D1 counter; Cloudflare recommends Durable Objects for exact limits) | Product | OPEN (founder) |
| 5 | After deploy, `wrangler tail` during a burst should show `ratelimit_deny` lines and no `ratelimit_throw` | Verify | TODO |
| 6 | Optionally move `[[unsafe.bindings]]` to the documented `[[ratelimits]]` form (Wrangler 4.36+). Locally identical; only worth doing with a deploy that proves the bindings survive | Fix | OPEN |

## Lessons
- Fail open, but never silently. "Let the request through" and "say nothing" are two decisions.
- A configured number is not an enforced one. Write down what was measured, and when.
- A probe that cannot fail is not a check: the planned "wait for a 429" proof of the dose deploy could
  not have gone red or green at one request a second. Calibrate a probe against something known first.
