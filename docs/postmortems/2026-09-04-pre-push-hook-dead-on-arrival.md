# Post-mortem — the pre-push hook was dead on arrival

- **Date:** 2026-09-04
- **Severity:** P1 (process). No user-facing outage is proven; the safeguard against one was off.
- **Duration:** 2026-08-14 (hook installed) → 2026-09-04 (found and fixed). Three weeks.
- **Status:** RESOLVED (commit b50a13e; gate tools/hooks_check.js)
- **Author:** Claude (Fable 5.1), for the founder

> Policy: **every breakage gets a documented, blameless 5-Whys post-mortem.** Blameless = focus on
> systems and decisions, not people. Be honest, including our own contributing actions. If a "why"
> is inferred rather than proven, say so.

## What happened
On this repo a push to `main` is the deploy: Cloudflare builds from it and there is no staging step.
The pre-push hook that runs the full gate suite before a push existed, was executable, and had never
run. `git rev-parse --git-path hooks/pre-push` resolved to `.githooks/pre-push`, a file that did not
exist. The real hook sat in `.git/hooks/pre-push`, where git had not looked since June.

Found while answering "can all models eval all processes before pushing?" — the answer was no, and
the mechanism that was supposed to make it yes had never fired.

## Impact
- 94 commits landed on `main` between 2026-08-14 and 2026-09-04, taking the service worker from
  v307 to v350: **43 deploys reached parents with the full suite never run automatically.**
- CI ran the Chrome-free subset only: 20 of 102 gates. So the 81 browser gates, which are most of
  the suite, ran only when a person remembered to run them.
- Nothing about this was visible. A hook that is never invoked cannot report that it was not invoked.
- No user-facing incident has been traced to it. That is luck, not evidence the window was safe.

## Root cause
`tools/install_hooks.sh` wrote the pre-push hook into `.git/hooks`. But `core.hooksPath` had been set to
`.githooks` on 2026-06-19 (5cd1360, to make the pre-commit hook tracked), and git ignores `.git/hooks`
entirely when `hooksPath` is set. The installer was written on 2026-08-14 (683b0a6, "Make the gates
run, instead of merely existing") without checking `hooksPath`, into a location git had already
stopped reading two months earlier. The hook was never live for a single push. **Confirmed**, by
resolving the path git uses and by the file's absence there.

The order matters and was assumed wrong at first: this was not a hook that later broke, it was a hook
installed dead, by the commit whose purpose was to make gates run.

## 5 Whys
1. **Why did the full suite not run before pushes?** The pre-push hook was never invoked.
2. **Why was it never invoked?** It lived in `.git/hooks`, and `core.hooksPath` pointed git at `.githooks`.
3. **Why was it written to `.git/hooks`?** `install_hooks.sh` hard-coded that path and did not read
   `core.hooksPath`, which had been set two months earlier by a different change for a different hook.
4. **Why did nobody notice for three weeks?** "Installed" was inferred from the file existing and being
   executable. Nothing asserted the one fact that matters: the path git actually resolves.
5. **Why was there no such assertion?** The repo's gates checked the app, never the machinery that runs
   the gates. A safeguard that looks present and does nothing is worse than an absent one, because it
   is budgeted for. → **Root cause: the enforcement layer had no gate on itself.**

## Contributing factors (blameless)
- Two independent improvements (tracked pre-commit in June; full-suite pre-push in August) were each
  correct alone and silently incompatible together. Neither change's author could see the other's
  assumption.
- The same shape recurred three times in one week: an Android release that builds clean and cannot
  sign anybody in; a canary that runs every 15 minutes and mails an address nobody set; this hook.
  Each was a mechanism that appeared present and did nothing, and each was found by asking "what
  would this actually do right now?" rather than "does it exist?"
- Five incident tests (consent-blast, invite-join, loss-leak, preg-tick-race, ios-signin-code) were
  also wired into nothing. Same cause: existence was mistaken for enforcement.

## What fixed it
- b50a13e: `.githooks/pre-push`, tracked, so every clone and worktree gets it. It refuses to pass when
  `tools/node_modules` is missing (the worktree case where every browser gate dies silently).
- `tools/install_hooks.sh` rewritten: sets `hooksPath`, verifies both hooks resolve, names the stray
  copies rather than deleting anyone's files.
- `tools/hooks_check.js`, wired into the suite: asserts the resolved path exists, is executable, is the
  tracked one, invokes `tools/gates.js`, and stops the push on failure. Red-proved against the real
  broken state (3 passed, 4 failed), not a synthetic one.
- Proven end to end: the very next pushes were gated at 92, 93, then 94 gates, and one of them was
  **stopped** by the hook over a real gate failure (`illness-start`, a month-boundary flake), fixed,
  and re-pushed. First time this repo's suite has automatically refused a deploy.

## Corrective actions
| # | Action | Type | Status |
|---|--------|------|--------|
| 1 | Tracked `.githooks/pre-push` running the full suite | Fix | DONE b50a13e |
| 2 | `tools/hooks_check.js` gates the gate machinery itself | Prevent | DONE b50a13e |
| 3 | Rewire the four green orphaned tests into the suite | Fix | DONE b41d406 |
| 4 | CLAUDE.md states where hooks live and why `.git/hooks` is dead | Doc | DONE (this commit) |
| 5 | CI runs the browser gates via `CHROME_PATH` on ubuntu-latest (20/102 → all) | Prevent | TODO, unverifiable from a Mac |
| 6 | Run the `--emulator` tier somewhere automatic; `push-query` is red there and invisible | Prevent | TODO, after push-query is green |
| 7 | Triage `ios-signin-code.test.js` (3 of 8 red, uid null) under an isolated profile | Fix | TODO |

## Lessons
- **Assert what git resolves, never what exists.** `git rev-parse --git-path hooks/<name>` is the one
  path that matters. A file in `.git/hooks` proves nothing once `core.hooksPath` is set.
- **Gate the enforcement layer.** Hooks, CI coverage, and test wiring are code paths too, and they
  fail silently by construction. They need their own red-then-green gate.
- **"Does it exist?" is the wrong question. "What would it do right now?" is the right one.** This
  single substitution found the dead hook, the dead Android sign-in, the mute canary, and five
  orphaned tests in one week.
- **Two correct changes can be one incident.** When a config knob (here `hooksPath`) changes what a
  whole class of files means, the change should carry a check that the class still resolves.
