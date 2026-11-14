# Testing Cubby: gates, the push hook, CI, chaos, fuzz and the nightly run

A push to `main` is a deploy. Everything below exists so that the last honest place to stop a bad
change (the push) asks the right questions, and so that the questions nobody thought to ask are asked
every night by tools that throw random, seeded, realistic trouble at the real app.

```
 edit ──► pre-commit (.githooks/pre-commit: SW bump, JS syntax, page SEO)
   │
 git push ──► pre-push (.githooks/pre-push)
   │            1. tools/node_modules and test/node_modules present?  no → refused up front
   │            2. tools/change_test_check.js --stdin: product code changed with no test? → refused
   │               (unless a commit carries "Test-exempt: <why>")
   │            3. tier: range touches firestore.rules, storage.rules, worker.js, workers/,
   │               app/store-firebase.js, tools/gates.js, test/*emu*, test/*rules*, or any file
   │               an emulator gate runs (read from tools/gates.js) → node tools/gates.js --emulator
   │                                                     otherwise → node tools/gates.js
   ▼
 GitHub Actions (.github/workflows/gates.yml), every push to main and every PR
   gates     node tools/gates.js --no-browser          (Chrome-free tree gates)
   emulator  node tools/gates.js --emulator-only       (Java 21, firebase-tools, Chrome: the second net)
   live      production checks, after a push to main
   ▼
 02:30 every night, from ~/cubby-ops/little-log-pwa (tools/nightly.sh, launchd com.cubby.nightly)
   gates --emulator, 30 min of chaos, 5 min of each fuzzer
   → ~/cubby-reports/nightly-<date>.md, one line on ~/cubby-reports/BOARD.md, a notification if red or new
```

## The gate runner: tools/gates.js

| command | runs |
|---|---|
| `node tools/gates.js` | the tree tier: every gate that can judge this checkout (it serves THIS tree on its own port) |
| `node tools/gates.js --emulator` | the tree tier, then every Firestore emulator suite |
| `node tools/gates.js --emulator-only` | only the emulator suites (what CI's `emulator` job runs) |
| `node tools/gates.js --live` | also production |
| `--only=a,b` | only gates whose name contains `a` or `b`, in BOTH tiers (`--emulator --only=household-guard`) |
| `--no-browser` | drop the tree gates that need Chrome (CI's `gates` job) |

**The emulator tier picks its own ports.** Each suite gets seven ports nothing is listening on
(Firestore, Auth, web, static, hub, logging, websocket). A plain `emu` suite runs inside
`firebase emulators:exec` with a temp `firebase.json` naming them; a self-hosting suite gets them as
`FS_PORT AUTH_PORT WEB_PORT STATIC_PORT HUB_PORT LOG_PORT WS_PORT`. It used to bind the 8080 default,
which on this Mac is usually another session's server. `EMU_PORT_RANGE=7601-7639` confines the picks
to a band. The CLI is `test/node_modules/.bin/firebase`, so nothing is fetched at push time. Every
emulator suite needs `JAVA_HOME` (or java on PATH) and `test/node_modules`. The tree server takes its
port from the top of the same band when one is set.

**No gate inherits the hook's repository.** Inside a hook git exports `GIT_DIR`, and from a linked
worktree it names the SHARED repository. A gate that builds a throwaway repo with plain `git init`,
`git config` or `git reset --hard` then rewrites the real one (`core.bare`, `core.hooksPath`,
`user.email`, branch heads) for every worktree at once. `run()` drops `GIT_DIR`, `GIT_WORK_TREE`,
`GIT_INDEX_FILE`, `GIT_COMMON_DIR`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES` and
`GIT_PREFIX` from every child, and any test that makes a temp repo deletes `GIT_*` from its own
environment before its first git call. `test/prepush-worktree.test.js` pushes from a real linked
worktree through the real hook and compares the shared repository byte for byte.

## Adding a test so the wiring gate is happy

`tools/test_wiring_check.js` (gate `test-wiring`) fails any of these that nothing runs:
`test/*.js`, `tools/*_check.js`, `tools/*_gate.js`, `tools/*_test.js`.

1. Make it exit non-zero on failure and print one summary line (`NAME: PASS` / `NAME: FAIL`).
2. Watch it fail once: break the product on purpose, or give it a `--self-test` that plants the bug.
   A test that can only report an absence needs that companion.
3. Wire it in `tools/gates.js`:
   - tree tier: `{ name: 'my-thing', cmd: ['node', 'test/my-thing.test.js', 'url'] }` (`'url'` becomes
     the local server's address; leave it out if the test needs no server)
   - emulator tier, inside an emulator: `{ name: 'my-rules', emu: 'node my-rules.test.js' }` (runs from
     `test/`, reads `FIRESTORE_EMULATOR_HOST`)
   - emulator tier, self-hosting: `{ name: 'my-flow', self: ['node', 'test/my-flow.test.js'] }`; read the
     ports from the environment (`Number(process.env.FS_PORT) || <default>`) and launch Chrome with
     `downloadBehavior` from `tools/gate_downloads.js` (every browser AND every `createBrowserContext`)
4. Only if it truly cannot run there, add it to `ALLOW` in `tools/test_wiring_check.js` with a reason a
   stranger can check, and `ranBy:` the file that does run it. Today that list is five files: two
   production-only checks, the Android parity check (red by design until Android lands), the real push
   sender, and `tools/noteshome_test.js` (red for a product reason since 552f36fb; `tools/nightly.sh`
   runs it every night and the report says when it passes, so it can be wired).

## When a push is refused

- `product code changed and no test or gate did`: product code is `app/**/*.js`, `app/**/*.html`,
  `worker.js`, `workers/**`, `firestore.rules`, `storage.rules`. Change or add the test that proves the
  change (`test/**`, `tools/*check*`, `tools/*gate*`, `tools/*_test.js`, `tools/chaos*.js`,
  `tools/fuzz_*.js`), or add a trailer to one commit in the range, which every push then prints:

      Test-exempt: copy-only change to the privacy page, no behaviour

  By hand: `node tools/change_test_check.js origin/main..HEAD`. A new branch is judged from its
  merge-base with `origin/main`.
- `test/node_modules is missing` / `tools/node_modules is missing`: in a worktree,
  `ln -s "$(git rev-parse --git-common-dir)/../tools/node_modules" tools/node_modules` and the same for `test/`.
- `... does not run (no JDK, or a JAVA_HOME without one)`: an emulator-tier push asks the java the suites
  will use (`$JAVA_HOME/bin/java`, else `java` on PATH) to run `-version`. A Mac always has `/usr/bin/java`,
  Apple's stub, so merely finding one proves nothing. `export JAVA_HOME=$(/usr/libexec/java_home)`.
- A gate failed: fix it. `--no-verify` is for a failure you have decided to accept AND written down why.

## Chaos: tools/chaos.js

Seeded family sessions against the real app, the real `firestore.rules`, and the Firestore and Auth
emulators: Olive (owner), sometimes her second phone, newcomers who join by link or answer an email
invite. Then a seeded mix of feeds, sleeps, nappies, edits and deletes, medicines and milestones, the
sleep timer, going offline, a reload in the middle of a save, a phone whose clock is hours or days out,
two phones inside one 350 ms window, the owner removing someone, a member deleting her account, and a
tab at 320 px.

Invariants, after every step: no page error or unhandled rejection; no permission-denied for a legitimate
action; no loading overlay up more than 12 s online; nothing a person can pan sideways at 320 px (the
document only counts when its overflow is not clipped, which Cubby's `body{overflow:hidden}` does, and
`#scroll` counts unless it clips). At every checkpoint: every acknowledged edit is on the server and on
every member's phone (entries, the baby, medicines, milestones, the sleep timer keyed on that baby);
nothing one member wrote is lost by another's save; a removed member can read nothing.

The boot adds the baby and waits until the server holds it before Olive names herself; one boot in five
names her inside the same 350 ms window instead (`rushName`), so that order is exercised too and a
missing baby is reported as itself. Each phone's colour scheme is seeded (one in four dark, which turns
on the night theme), so a replay is the same whatever this Mac's own appearance is at that hour.

```
node tools/chaos.js --seed=20261113 --minutes=20      # hunt (needs JAVA_HOME, test/ and tools/node_modules)
node tools/chaos.js --replay=chaos-failures/<seed>.json   # reproduce one saved failure
node tools/chaos.js --self-test                        # gate: planted lost write must be caught
```

A failing session is re-run three more times and every new signature is counted in each re-run: seen
again in 2 of 3 it is **real**, and the session's earliest real violation is shrunk (delta debugging,
keeping each action's prerequisites) to the shortest list that still breaks the same invariant. Each is
saved as `chaos-failures/<seed>.json` with a one-line repro; otherwise it is **flaky** with its count,
or **unchecked** if the re-run budget (box + 15 min) ran out. A signature is what broke, not who it
happened to: names, ids and numbers are folded out, so the same broken invariant seen on another phone in
a re-run is one finding. Race gaps are seeded, so a replay races the same way.
`CHAOS_DEBUG=1` with `--replay` prints what the server and each phone hold at a failed checkpoint. `chaos-failures/` is gitignored and assetsignored: the repo is public. The generator promises
that between two checkpoints an item is touched only by the phone that made it; the self-test counts
that over 400 seeds, and against a generator with the lock removed, which must break it.

**To reproduce a chaos failure:** run the printed `--replay=` command on a checkout at the same commit.
It exits 1 `REPRODUCED` (the saved signature broke again), 2 `OTHER VIOLATIONS` (something else broke:
still a failed replay, never clean) or 0 `CLEAN`, and its last line is always `REPLAY: REPRODUCED|OTHER|CLEAN`.
The JSON is a plain action list; delete actions by hand to narrow it further. App bugs it finds are
reported, never fixed inside the harness.

## Fuzzing the Worker: tools/fuzz_worker.js

Loads the real `worker.js` in node (D1 is real SQLite, Firestore, Google and Resend are in-process
stubs, nothing leaves the process) and throws seeded malformed requests at every route: odd methods,
missing, huge, nested or broken JSON, values of the wrong type (an object where a string belongs, and
objects whose `toString` is not a function, which even `String()` cannot convert), bad headers and
Origins, unicode, long paths, injected upstream failures. Invariants: never throws out of the handler; never a 5xx except the declared `server_config`,
`db_error`, `store_failed` (and upstream codes only when an upstream failure was injected, and the
canary's own 503); never reflects input into HTML or an email unescaped; a limiter's "no" is a 429.

```
node tools/fuzz_worker.js --seed=N --seconds=300 --out=DIR
node tools/fuzz_worker.js --replay=DIR/fuzz-worker-<seed>-<id>.request.json
node tools/fuzz_worker.js --self-test --seconds=20     # gate: three planted bugs must all be found
```

In the gate, an HTML reflection always blocks; any other finding blocks only if it is not on
`~/cubby-reports/known-findings.json` (kept by the nightly run, outside the repo).

## Fuzzing the rules: tools/fuzz_rules.js

Every role (owner, co-owner, caregiver, removed member, invitee with a proven and an unproven
address, a stranger with a live link, anonymous) against every collection in `firestore.rules`, on the
emulator, each op on a freshly seeded household. Judged by an explicit allow-list model written from the
rules' intent (`test/rules-test.js`, `test/household-guard.test.js`), not transcribed from the rules.
Every collection is asked for a single read AND a list, by every role: household photos (members only),
member addresses (owners list them, nobody else), notes (only the filtered lists the app makes), every
deny-all collection, and a collection-group query over photos, events, notes, addresses and maternal
health, which nothing may run. A list is its own question: a planted photo hole that let any signed-in
account read every family's photos passed as AGREE over 3232 ops before the photo templates existed.

```
node tools/fuzz_rules.js --seed=N --seconds=300 --out=DIR
node tools/fuzz_rules.js --seed=N --op=K       # replay one op; prints the request and AGREES/DISAGREES
node tools/fuzz_rules.js --self-test           # gate: four planted rule bugs caught, real rules agree
```

A disagreement is either a rules bug or a model that no longer states the intent. Either way the
report names the op and the role; decide which, and fix that one.

## The nightly run: tools/nightly.sh

```
sh tools/nightly.sh --dry-run          # this checkout, a few gates of each tier, 2 min chaos, 1 min per
                                       # fuzzer, no notification, files under ./reports-dryrun/
sh tools/install_nightly.sh            # check only: lints the plist, checks the ops clone
sh tools/install_nightly.sh --install  # write ~/Library/LaunchAgents/com.cubby.nightly.plist and load it
```

It runs from `~/cubby-ops/little-log-pwa` (never `~/Downloads`, which launchd cannot read), moves it to
`origin/main` (detached; a dirty clone is reported, not reset), runs `gates.js --emulator`, the one
excused test, chaos for 30 minutes with the date as seed, and both fuzzers for 5 minutes, each under a
watchdog. `tools/nightly_report.js` then writes `~/cubby-reports/nightly-<date>.md` (what ran, every
gate, every finding with its repro, timings), appends one line to `~/cubby-reports/BOARD.md` (date,
red or green, new findings, still-open findings by id) and keeps `known-findings.json`. A night is red
when a gate failed, a tool died, or a finding is new; an old open finding stays on the board every
night but does not notify again. Bug details never enter the repo.

**Fixed means replayed clean, for chaos.** Chaos draws new sessions from the date each night and a box
fits a handful, so a race it did not stage tonight is not fixed. Before the report, `nightly_report.js
--replay-open` replays every open chaos finding tonight's hunt did not hit, from its own saved list, up to
three times (stopping at the first that is not clean) into `runs/<date>/replays.json`. Only three clean
replays in a row mark it fixed; a finding with no saved list, or out of time, stays open. The fuzzers sweep
every route and rule each night, so for them "the finished run did not see it" still means fixed. An id
that only a since-corrected harness produced can be closed as a harness artifact with its reason
(`ARTIFACTS` in `tools/nightly_report.js`), but only when no saved list brings its signature back on the
corrected harness. The list is empty: the two "timer stopped" ids of 14 Nov replay clean from their
short lists now, and a longer list still reproduces both, so they stay open.

## Known intermittent: loss-archive (closed 14 Nov 2026)

`test/loss-archive-reload.test.js` (emulator tier) used to fail on some runs of an unchanged tree, always on
the same lines: after `endPregnancy(true)` and a reload, the holding screen did not come back. It was a
product race, never excused: the suite exited 1 and said so in a `KNOWN INTERMITTENT PRODUCT RACE`
paragraph. It failed in 54 of 68 runs measured on 13-14 Nov. The change that keeps every edit when two
phones save the shared household close together closed it: 6 of 6 runs passed in the release
integration of 14 Nov, under normal load. The paragraph stays in the test so that if it ever comes back,
it reads as a regression of that fix and not as noise. Re-measure after any change to how the app
restores the holding screen, and update `FLAKE` in the test.

## Every gate here was watched red

| gate | how it was made to fail |
|---|---|
| test-wiring | `--self-test` plants an unwired test, a comment-only mention, a stale excuse, a missing file; on the base tree it named 12 orphans |
| change-test | `--self-test` builds a throwaway repo: code-only push red, code + test green, `Test-exempt` green |
| prepush-tier | `PREPUSH_HOOK=<old hook> node test/prepush-tier.test.js`: the hook before Nov 2026 fails 11 of 15; the 13 Nov hook fails the two java lines (a stub java that cannot run was waved through) |
| prepush-worktree | `PREPUSH_WT_FROM=<tree before the scrub>`: the shared config came back `bare = true`, `hooksPath = /dev/null`, a test `user.email`, moved heads. Built in: gates.js with its scrub line cut must let a planted leaky gate through, and each self-test with its own scrub cut goes red |
| hooks | `--self-test`, plus the old hook swapped in (a `command -v java` guard is caught) |
| fuzz-worker | three planted bugs in a temp copy of `worker.js`; the 14 Nov value generator, run on the `worker.js` before the sign-in code field was hardened, finds the throw in 60 s (the 13 Nov generator does not) |
| fuzz-rules | four planted rule bugs, each in its own demo project; the 13 Nov model let the planted photo-read hole through as AGREE |
| chaos | a planted lost write (nappies never leave the phone), a generator with its lock removed, the old name-bearing signature, a baby wiped from one phone's blob and saved, a planted 420 px row in the scroller (and the night wash that must NOT count), and a replay that breaks another invariant (exit 2) |
| loss-archive | pointed at another session's `:8080` it refuses by name instead of grading that tree |
| nightly-report | eight synthetic nights; mutants: "not hit tonight means fixed", "one clean replay is enough" and "no artifact list" each turn it red, as did the four of 13 Nov |
