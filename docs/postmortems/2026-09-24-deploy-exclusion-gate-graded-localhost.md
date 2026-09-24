# Post-mortem — the gate that guards production never asked production

- **Date:** 2026-09-24
- **Severity:** P1 (process). No exposure occurred. The check that would have detected one had been
  pointed at localhost since birth, and a false production-exposure report reached the founder.
- **Duration:** 2026-09-07 (a0443c1f, the gate's own creation) → 2026-09-24. Seventeen days.
- **Status:** RESOLVED (commit "The gate that guards production had never once asked production"; proven red-then-green against both hosts)
- **Author:** Claude (Opus 5), for the founder

> Policy: **every breakage gets a documented, blameless 5-Whys post-mortem.** Blameless = focus on
> systems and decisions, not people. Be honest, including our own contributing actions. If a "why"
> is inferred rather than proven, say so.

## What happened
`tools/deploy_exclusion_check.js` exists to assert that production does not serve the repo's internals
— `firestore.rules`, `worker.js`, `CLAUDE.md`, `.claude/settings.json`, the hooks, the CI config, the
tests, the native project files. Run through `tools/gates.js --live` it asked `http://127.0.0.1:<port>`
instead: the local `serve.js` that `gates.js` spawns over the repo root.

A local static server serves every file in the repo. So all fourteen internal paths returned 200, and
the gate reported — correctly, for the host it was actually given — that production was wide open.

That report was believed and escalated to the founder as a production exposure before it was traced.

## Impact
- **No user-facing impact, and no exposure.** Production returned 404 for every one of those paths on
  every direct check.
- The exclusion guard has never once verified production. From 2026-09-07 it could not pass through
  `gates.js --live`, because localhost always serves the repo. Every `--live` run since then has shown
  fourteen red lines.
- Roughly forty minutes of two sessions' time went to chasing a deploy-window hypothesis that did not
  exist, during a window in which an iOS submission was being sequenced around it.
- A false security report reached the founder. That is the real cost here: the next one is now slightly
  less likely to be believed.

## Root cause
`a0443c1f` (2026-09-07) was the commit that **fixed a real production exposure** — production genuinely
was serving the hooks, the CI config, the tests and `firebase.json`. It added `.assetsignore` entries,
created `tools/deploy_exclusion_check.js`, and registered it:

    { name: 'deploy-excl(live)', cmd: ['node', 'tools/deploy_exclusion_check.js', 'url'] }

`'url'` is `gates.js`'s placeholder for the **local** server (`tools/gates.js:207`, `const base =
'http://127.0.0.1:' + port`), substituted at `tools/gates.js:219`. Every other gate in the suite grades
the tree, so local is right for all of them. This one gate needed the opposite and got the default.

**Confirmed**, by reading the substitution, by line 3 of the audit output naming the local server, and
by running the same gate by hand against `https://little-cubby.com`: 17 passed, 0 failed.

The fix for an exposure shipped with its own verification aimed at the wrong host.

## Why it survived seventeen days
Two mechanisms, both of which made a permanent red look like a non-event.

1. **Live gates do not block.** `gates.js` computes `blocking = failed.filter(r => !r.live)` and exits 0
   when only live gates failed, printing *"Only production checks failed. Nothing is wrong with this
   code: something that is already deployed, or a dashboard setting, does not match what the repo
   promises."* That design is defensible — a live failure genuinely is not a code failure — but it
   means a gate that can never pass produces a reassuring paragraph and a final line reading
   **`GATES: PASS`**. Fourteen red assertions sat above it.
2. **The failing assertion asserted its own context.** The label was the literal string
   `'production does NOT serve ' + u`, regardless of which host was asked. The gate did print a
   `live, <BASE>` header that would have exposed it instantly — but `gates.js:257` prints only
   `f.out.split('\n').slice(-25)` of a failing gate, and with fourteen failures the header was exactly
   what fell off the top.

So the one line that identified the host was truncated away, while fourteen surviving lines each
falsely claimed the host.

## Our own contributing actions
- I read the 200s, confirmed by hand that the paths were 404, watched them disagree, and concluded
  "real but transient, cause unknown" rather than "one of these two measurements is instrumented
  wrong." A disagreement between two measurements of the same thing is a fact about the instruments
  first.
- I escalated to the founder before tracing the measurement to its source, using the words "production
  served `firestore.rules` and `worker.js`".
- Line 3 of the output I was reading said `serving THIS tree (/Users/m1promax/Downloads/little-log-pwa)
  at http://127.0.0.1:49424`. I had already read that line. It did not land because I was reading the
  failures, not the setup.
- Earlier the same session I made the same class of error twice more: a style probe injected before the
  **last** `</head>`, which in `app/index.html` is inside an `openPrintable` template literal, returning
  a confident wrong verdict; and a reported v348 sign-in regression that came from two sessions sharing
  one browser profile. Three instrument failures in one session, all read as findings.

## What fixed it
- **"The gate that guards production had never once asked production"**: `deploy-excl(live)` now takes a distinct `'liveurl'` placeholder resolving to
  `CUBBY_LIVE_URL` or `https://little-cubby.com`. `'url'` still means local everywhere else, and
  `claims(live)` deliberately keeps it — its header explains that the seeded `?e2e=1` shell is
  hostname-guarded to localhost and that shooting live would only photograph the sign-in wall.
- **The assertion now names the host it asked.** `BASE + ' does NOT serve ' + u` instead of the word
  "production". A wrong host is now visible in every line, truncated or not.
- Proven both ways before committing:

      against 127.0.0.1   FAIL   "http://127.0.0.1:8097 does NOT serve .githooks/pre-push (200)"
      against production  PASS   "https://little-cubby.com does NOT serve .githooks/pre-push (404)"

- Independently disproved the exposure it had alleged: a loop against the real host across a real
  deploy (2.6s on the three most sensitive paths, all eighteen every 26s, from before the ref moved
  until well after the service worker flipped v352 → v353) saw zero 200s with the control green
  throughout. A second session probing production directly agreed.

## Corrective actions
| # | Action | Type | Status |
|---|--------|------|--------|
| 1 | `deploy-excl(live)` resolves the production URL, not the local base | Fix | DONE |
| 2 | Live assertions name the host they asked instead of claiming "production" | Prevent | DONE |
| 3 | Audit the other `(live)` gates for the same wiring | Prevent | DONE — `claims(live)` is local *by design*, documented in its header; `thirdparty(live)` takes no url and defaults to the real host |
| 4 | Keep the first 10 lines of a failing gate, not only its last 25 | Prevent | DONE — the `live, <BASE>` header now survives truncation |
| 5 | Make a permanently-red live gate visible rather than restful | Prevent | TODO — the summary should name how many live assertions are red, not only that nothing blocking failed |
| 6 | Four orphaned `serve.js` processes (19, 18, 18 days and 1 hour old) still listening on this Mac | Cleanup | TODO — founder's call, one already caused a wrong-tree grading today |

## Lessons
- **A check must name what it checked.** Any assertion whose text states its own context — "production",
  "the live site", "the installed build" — can lie when the context is wrong, and it lies most
  convincingly at exactly the moment the context is wrong. Print the host, the path, the version.
- **Two measurements that disagree are a fact about the instruments, not about the world.** The moment
  `curl` said 404 and the gate said 200, the question stopped being "is production exposed?" and became
  "which of these is lying, and why?" Answering the first question cost forty minutes and a false alarm.
- **A guard that cannot pass is not a guard.** `deploy-excl(live)` could never go green through
  `gates.js`. Seventeen days of that read as "known noise" because the suite's verdict stayed PASS. Any
  assertion that has never been green since it was written is broken, not strict.
- **The fix for an incident needs its own verification verified.** `a0443c1f` closed a real exposure and
  shipped a check aimed at the wrong host. The remediation is where confidence is highest and scrutiny
  is lowest.
- **Escalate the trace, not the reading.** The rule that would have prevented the false alarm: before
  reporting a security finding, state which host, which process and which line produced the number.
