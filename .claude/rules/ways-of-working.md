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
- A Firestore REST write is proven against the emulator, never only a stubbed `fetch`. The query-string
  precondition (`?currentDocument.updateTime=`) is refused by Firestore; a stub passed it twice in Nov
  2026 (sign-in spend, purge unflag). Send preconditions in a `documents:commit` body
  (`test/purge-unflag-emulator.test.js`, `test/signin-code-emulator.test.js`). The same for Identity
  Toolkit: `deleteProvider:['password']` passed a stub and erased the account's email on the real Auth
  emulator, forking a parent into two accounts (`test/signin-claim-auth-emu.test.js`).
- A server job that destroys data re-checks its own premise (the purge reads `members` before deleting),
  whatever the rules above it promise. Rules list what each role MAY write, never what it may not.
- A limit keyed only on what a stranger can know (an email address) is a lockout lever. The first
  sign-in guess ceiling let one laptop lock a parent out for an hour; split it by network and keep a
  per-address total (`test/signin-code-budget.test.js` section 2a stages the attack).
- A rule that makes two writes one atomic act must refuse the FIRST write alone, or an older cached
  build spends half the act and strands it (a link claimed, nobody joined). Test old client shapes
  against the new rules, not only the new client against the old (`test/household-guard.test.js` 4b).
- After the second failed fix of one assertion, stop and print every input it depends on. Two
  rewrites blamed a correct product before one dump read the anchor back as "now".

## Enforcement is code too
- A gate's Chrome saves every `<a download>` into the real Downloads folder unless it is launched with
  `downloadBehavior` from `tools/gate_downloads.js`, and each `createBrowserContext()` needs it again.
  223 calendar files piled up before `tools/gates.js` started failing any gate that adds to that folder.
- Inside a hook git exports `GIT_DIR`; from a linked worktree it names the SHARED repo. A gate that
  runs git init, config or reset in a temp dir with it inherited rewrites the real one for every
  worktree. Delete `GIT_*` before any git in a test (`test/prepush-worktree.test.js` pushes from one).
- A manual `npx wrangler deploy` uploads the FOLDER, gitignored keys included; only `.assetsignore`
  fences them. `tools/deploy_exclusion_check.js` walks for key-shaped files and fails any it misses.
- Hooks are tracked in `.githooks/` and `core.hooksPath` points there; `.git/hooks` is never read.
  `tools/hooks_check.js` asserts what git resolves. `tools/harness_check.js` asserts the same for
  `.claude/settings.json`, `.claude/hooks/` and this file.
- A test not in `tools/gates.js` does not exist: wire it or delete it. `tools/test_wiring_check.js` now
  fails any test file that nothing runs (12 were orphaned on 13 Nov 2026, two of them red).
- Merge = deploy, and main takes merges only through a PR with green required checks (strict). So the PR's
  CI is the one gating run. pre-push refuses a main ref up front and runs no gates on a branch push: it
  asks one question, product code with no test changed is refused unless a commit says `Test-exempt: <why>`
  (`tools/change_test_check.js`). A push to main runs only `live` and IndexNow in CI (`tools/ci_tier_check.js`).
  Mutation passes run nightly and on a PR that touched what they guard (`tools/mut_select.js`). Chaos and
  both fuzzers run nightly (`tools/nightly.sh`); see `docs/TESTING.md`.
- Two suites on one Mac clash on ports and load (27 Nov 2026, a tree-server FAIL neither run had alone).
  Port runs come from 20000-32000, outside every ephemeral range, never from listen(0) plus one. The push
  lock in `.githooks/pre-push` (a kernel flock on push.flock in the user cache) serializes pushes against
  pushes only: a suite started any other way does not take it. A machine lock is a kernel flock, never a
  mkdir with a pid in it: six waiters behind a dead mkdir holder all took it over (`test/push-lock.test.js`).
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

## The root system: how a release is run (founder, Nov 2026)
- One primary root, the main session, owns the outcome. Subagents are roots for one use case each,
  file-disjoint, each re-checked by a fresh skeptic. The root reads every diff that ships and can say why
  it is right; it never relays a summary as fact. If something breaks for a family anywhere, the plant dies.
- Aim diligence by exposure: the app opening, sign-in, saving, deletion first, then whatever is about to be
  switched on. The 2026.46.1 beta crashed at launch on every iPhone while review rounds went into analytics
  code that was switched off; nothing had ever opened the build on the newest iOS.
- Fix the cause, not the list. When a review finds a cluster, find what they share and prefer the simpler
  design: patching one finding per lane added the complexity that produced the next round's findings.
- Prove on the real surface: `tools/ios_launch_smoke.sh` before any upload and against the live site after a
  push that changes what the native app loads, the live site itself, and real engines (the Firestore and
  Auth emulators, Miniflare's D1) rather than stubs.
