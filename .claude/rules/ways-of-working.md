# Ways of working: the traps this repo has already paid for

Loaded for every session (no `paths` frontmatter). CLAUDE.md is the 60-line front desk; this is the
catalogue behind it. Each rule below cost real time in Aug-Sep 2026 and each has a gate or a hook.

## Verify against the tree you changed
- `tools/serve.js` serves the repo that CONTAINS it (root from `__dirname`). Run a scratch tree's OWN
  copy, then `curl` the served file for the string you changed before believing any verdict. Four
  tests in one session graded the wrong tree this way.
- A worktree can be the STALE one. Print the version of the tree you are about to serve
  (`grep -o "little-log-v[0-9]*" app/sw.js`) and confirm your change is in it.
- Prefer `git commit -o <paths>` in the shared checkout; never `git add -A`. Re-read `app/sw.js` before
  bumping CACHE: another session may have bumped it first.

## A gate must be able to go red
- Red-then-green: watch every new assertion fail on a real or mutated tree before trusting it.
- An assertion that can only report an ABSENCE ("no X found") needs a companion that stages X and
  makes the same matcher find it. Three such lines were green while broken in one week.
- When a test has two load-bearing halves, mutate each separately (`test/two-caregiver-journey.test.js`
  is the pattern: break the join, then break the recap).
- Match whole tokens, not substrings: "Sep 1" is inside "Sep 14" (`tools/cycle_median_check.js`).
- Clock-pinned gates pin the DAY as well as the hour. Two gates flaked on month boundaries.
- Browser state that must exist BEFORE boot goes in via `page.evaluateOnNewDocument`; a reload's
  teardown fires `visibilitychange` and re-stamps anything written into the old document.
- After the second failed fix of one assertion, stop and print every input it depends on. Two
  rewrites blamed a correct product before one dump read the anchor back as "now".

## Enforcement is code too
- Hooks are tracked in `.githooks/` and `core.hooksPath` points there; `.git/hooks` is never read.
  `tools/hooks_check.js` asserts what git resolves. `tools/harness_check.js` asserts the same for
  `.claude/settings.json`, `.claude/hooks/` and this file.
- A test not in `tools/gates.js` does not exist: wire it or delete it. The `--emulator` tier is not
  run by the hook or CI; a red there is invisible.
- "Does it exist?" is the wrong question. "What would it do right now?" is the right one. It found a
  dead pre-push hook, a mute canary, an Android build that cannot sign anyone in, and five orphaned tests.

## Never delete; check the live sessions
- Never delete anything, local included, without a yes: worktrees, branches, stash entries, dirs.
  `.claude/hooks/guard-bash.sh` blocks the usual commands; the rule is wider than the hook.
- `ListAgents` first, then message each live session. Worktree names are recycled by the harness; a
  familiar name can be someone's live desk. 52 of 63 worktrees held uncommitted edits when checked.
- Removals from production need the founder's explicit OK, every time.

## When something breaks
- Every P0 or P1 gets a blameless 5-Whys in `docs/postmortems/` (template there). Date the timeline
  with `git log` BEFORE writing the whys: one root cause inverted once the dates were checked.
- Codify the finding twice: a doc AND a gate that can go red.
