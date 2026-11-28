# Testing Cubby: gates, the push hook, CI, chaos, fuzz and the nightly run

A merge to `main` is a deploy, and `main` takes merges only through a PR whose required checks passed
(`gates`, `emulator`, `seo-guard`, `teach-guard`; strict, so the PR is up to date with `main` and its run
is a run of the tree that merges; enforce_admins). Everything below exists so that the PR asks the right
questions once, and so that the questions nobody thought to ask are asked every night by tools that throw
random, seeded, realistic trouble at the real app.

```
 edit ──► pre-commit (.githooks/pre-commit: SW bump, JS syntax, page SEO)
   │
 git push ──► pre-push (.githooks/pre-push), seconds, no gates
   │            1. a main ref (push, or delete)? → refused up front: open a PR (node tools/train.js --go)
   │            2. the machine push lock: one push at a time on this Mac
   │            3. tools/change_test_check.js --stdin: product code changed with no test? → refused
   │               (unless a commit carries "Test-exempt: <why>")
   ▼
 GitHub Actions on the PR (.github/workflows/gates.yml, seo.yml, teach.yml), the one gating run
   gates     node tools/gates.js --no-browser --mutants   (Chrome-free tree gates)
   emulator  node tools/gates.js --emulator-only --mutants (Java 21, firebase-tools, Chrome)
   tree (1/8 .. 8/8)      gates.js --shard=i/8 --mutants: the WHOLE tree tier, browser gates included, on Linux
     └► tree-complete     tools/shard.js --complete: every leg passed, every shard's results file is
                          there, and the union is exactly gates.js --list with the same flags (20 gates at least)
   emulator (1/4 .. 4/4)  gates.js --emulator-only --shard=i/4 --mutants, one VM each
     └► emulator-complete the same proof for the emulator tier
   seo-guard, teach-guard
   (every mutation pass runs here, for now: plan item 14 is held on CI; see "Mutation passes")
   ▼
 merge = deploy. GitHub Actions on the push to main: only these, nothing that re-grades the tree
   live      production checks, after the deploy;  seo-guard's IndexNow ping
   ▼
 02:30 every night, from ~/cubby-ops/little-log-pwa (tools/nightly.sh, launchd com.cubby.nightly)
   gates --emulator --mutants (every mutation pass), 30 min of chaos, 5 min of each fuzzer
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
| `--browser-only` | only the tree gates that need Chrome (the complement of `--no-browser`; both together exit 2) |
| `--shard=i/N` | only shard `i` of `N` (1-based) of whatever the other flags chose, split longest first by `tools/gate-times.json` (`tools/shard.js`); a gate with no time counts 60 s. An invalid `i/N` exits 2 and runs nothing |
| `--list` | print the names the other flags choose (shard and mutation plan applied), one per line, and exit: no tree server, no gate |
| `--record-times=<f>` | write the shard, the flags and each gate's verdict and time to `<f>` (JSON), however the run went |
| `--mutants` | every mutation pass (nightly, and every CI job for now). Without it, only the passes this change touched (below) |
| `--changed=<rev>` | the base the change is measured from (once item 14 is on CI: `HEAD^1`, `main` under the PR's merge commit); default: the merge-base with `origin/main` |

On CI (`CI` set) the runner refuses to start, exit 2, when there is no `~/Downloads`: the downloads guard would be
off without a word. Every gates.js job in gates.yml makes one first (`--self-test-downloads` stages the refusal).

**Where each check runs (28 Nov 2026).** The same suite used to run up to seven times per change, mostly on
the Mac: the branch push ran `--no-browser` (23 min), the PR's CI ran the identical command, the train ran
the full suite, the train's push ran `--no-browser` again, and the push to `main` re-ran `gates` and
`emulator` after Cloudflare had already deployed it. Now:
- **A branch push runs no gates.** The hook asks change-needs-test and takes the push lock, then stops. A
  red result shows on the PR minutes later, and a red PR cannot merge (`test/prepush-tier.test.js`).
- **A push to `main` is refused by the hook up front.** GitHub refuses it anyway (required checks, strict),
  and the old hook found that out after 104-140 min of suite. `node tools/train.js --go` pushes
  `train/<stamp>` and opens its PR; that PR's CI is the train's run.
- **CI on a push to `main` runs only `live` and the IndexNow ping.** `tools/ci_tier_check.js` (gate
  `ci-tier`) reads the three workflows and fails if `gates`, `emulator`, the seo guard or `teach-guard`
  runs on that push, or if any required check stops running on a PR (it would never report). This is only
  safe while strict=true; re-check whenever protection changes:
  `gh api repos/zealthpatro/little-log-/branches/main/protection/required_status_checks --jq .strict`.
- **The browser tier runs on CI, not yet as a required check** (test-speed plan items 4-7, 28 Nov 2026).
  The `tree` matrix runs the whole tree tier in 8 shards on Linux (`CHROME_PATH=/usr/bin/google-chrome`,
  `TZ=Asia/Dubai`, puppeteer-core@25.2.1, a `~/Downloads` so the downloads guard is on), and the emulator
  tier runs in 4 (`emulator-shard`). Neither matrix is what protection requires: `tree-complete` and
  `emulator-complete` are, once switched on, because a leg that is skipped, cancelled or refused never
  fails by itself. Each aggregator runs `always()`, reads the matrix result, demands one results file per
  shard and compares the union with `gates.js --list` run with the legs' own flags, each gate exactly once.
  `ci-tier` holds the workflow to all of that; `shard` stages each way the split or the proof can go wrong.
  `ci-tier` also pins each gates.js job's tier exactly (`TIER` in `tools/ci_tier_check.js`: `--only=type` on
  the legs and their check together, or `--no-browser` for `--emulator-only` on both, agreed with itself and
  was green), and refuses anything that turns a failure into a pass on the six jobs or the step doing their work:
  `continue-on-error`, a step `if:`, `shell:`, `defaults:`, or any text before or after the one command.
  `shard.js --complete` refuses a list of fewer than 20 gates (a filter that leaves nothing was COMPLETE).
  The switch, once three PRs in a row are green on both (the founder runs it; `strict` and `enforce_admins`
  are untouched, `gates` and `emulator` stay required until their jobs are removed in the same step):

  ```
  gh api -X PATCH repos/zealthpatro/little-log-/branches/main/protection/required_status_checks --input - <<'JSON'
  {"strict":true,"checks":[{"context":"gates","app_id":15368},{"context":"emulator","app_id":15368},{"context":"seo-guard","app_id":15368},{"context":"teach-guard","app_id":15368},{"context":"tree-complete","app_id":15368},{"context":"emulator-complete","app_id":15368}]}
  JSON
  ```

  Until then the train's manual full run (docs/RELEASE-TRAIN.md) stays the browser tier's only enforced net.
- **Shard times** live in `tools/gate-times.json` (from `~/cubby-work/suite-times.txt`, the serial run of
  28 Nov 2026, plus four emulator suites timed on 16 Nov). Refresh from CI's results with
  `node tools/shard.js --times-from=<shard-*.json,...>` (the `tree-shard-*` artifacts); a stale time only
  unbalances the shards, it can never drop a gate.

**Mutation passes: nightly every one, on a PR only what it touched** (the founder's call, 28 Nov 2026), **held
on CI for now.** Every CI job passes `--mutants`, and `ci-tier` fails the workflow if one does not. The PR half
is only safe once (a) branch protection requires `tree-complete` and `emulator-complete` (the command above),
and (b) plan item 15 traces each pass's inputs instead of the hand-declared lists below. Turning it on before
both would leave chaos, fuzz-rules, the usage and admin self-tests, usage-tracker(-emu) and usage-d1 with the
nightly run as their only net on any PR that misses a declared input. The switch, once (a) and (b) hold, is
`--mutants` to `--changed=HEAD^1` in gates.yml and in `TIER` together. Locally, a run without `--mutants`
already selects. A mutation pass breaks the code in a temp copy and requires the suite to go red; it proves the suite can still
see. In `tools/gates.js` such a gate carries `mut: [inputs]` (a trailing `/` is a directory), and
`mutOnly: true` when the gate is nothing but mutants. `tools/mut_select.js` decides per run:
- runs: `--mutants`; or the gate is new, or its entry line changed; or a changed file is one of its inputs;
  or the change set is unknown (no base, git fails), the runner part of `tools/gates.js` changed, or
  `tools/mut_select.js` changed: then every pass runs. Unknown never means skip.
- off: a suite + mutants gate runs as its suite alone (`--self-test` dropped); a `mutOnly` gate does not run.
  The run prints which passes are off.
Today: usage-ingest-mut, usage-route-mut, usage-erasure-mut, the seven admin gates, usage-tracker,
fuzz-rules, chaos, usage-tracker-emu and usage-d1. The inputs are declared by hand, wide on purpose, until the
traced input sets of plan item 15 exist; `mut-select`'s self-test reads each gate's script, follows its
relative requires, and fails any repo path they name that the inputs leave out (it found
`docs/ADMIN-DEPLOY.md` and `firebase.json` missing on its first run). A missed input means a loosened
assertion is found by the nightly run, within 24 hours, instead of before merge.
`test/mutants-tier.test.js` (gate `mutants-tier`) proves it through a real runner in a throwaway repo, and that
`tools/nightly.sh` passes `--mutants`.

**The tree server is THIS tree's, or the run refuses.** On 16 Nov 2026 a run graded another checkout while
its banner said it served this one: another session's orphaned `serve.js` held `[::]:7739`, the port check
asked only `127.0.0.1` (macOS lets a socket bind there beside a wildcard listener), this run's own `serve.js`
died on `EADDRINUSE` unseen, and the orphan answered every gate. Now a port is free only if a test bind
succeeds at the wildcard address, `0.0.0.0`, `127.0.0.1` and `::1` alike (on macOS each of the four is the
only one that sees one kind of listener: an IPv6-only wildcard, `0.0.0.0`, `127.0.0.1`, `::1`); the run waits
for its own `serve.js` to say it is listening, then fetches `app/index.html`, `app/store-firebase.js` and
`app/sw.js` from it and compares them byte for byte with the tree (a file the tree lacks must be a 404), and
refuses before any gate if any of that fails. If the server exits during the run no further gate starts, and
after the last gate it must still be up and serving those bytes (`served-tree` FAIL otherwise): a stranger that
takes `127.0.0.1` at the run's port mid-run (macOS lets that bind sit beside the run's wildcard `serve.js`, and
`127.0.0.1` is what the gates ask) answers every gate after it, and that last check is what sees it. The banner
names the server's pid. A browser gate grades the URL it is given. The two tree gates that start their own
emulator, `test/preg-tick-race.test.js` and `test/two-caregiver-journey.test.js`, used to ignore it and drive
whatever answered `localhost:8097` and `localhost:8380`; through `test/helpers/tree-base.js` they now take the
runner's URL (alone, they serve this tree themselves on a port from `--free-ports`, as every port they bind
is), and ask `--served-is-this-tree` before they grade anything.

**The tree server never outlives its run.** The orphans on 7729 and 7739 were `node tools/serve.js`, by the
relative path the runner of 72d7c68f used, with PPID 1: a runner ended by a signal left its server listening
for good. Now `serve.js` runs inside a small wrapper that exits when its stdin closes, and that stdin is a pipe
only the runner holds, which the OS closes however the runner ends, a SIGKILL included. A SIGTERM or SIGHUP to
the runner is also passed to the gate running then, and so is a SIGALRM, as a SIGTERM: SIGALRM is what
`tools/nightly.sh`'s watchdog (`perl -e 'alarm ...; exec'`) sends a step that runs out of time, and before
this it left the night's `serve.js` and the running gate behind (seen 16 Nov 2026: `*:7879` held with PPID 1
after the alarm). The runner still exits 142 then, which `tools/nightly_report.js` reads as the watchdog.
`tools/nightly.sh` takes its ports from the same picker (`node tools/gates.js --free-ports=N`) and runs its
notes check only if `node tools/gates.js --served-is-this-tree=<url>` says yes. `tree-server`
(`--self-test-tree-server`) stages each case against a real runner in a temp tree.

**The emulator tier picks its own ports.** Each suite gets seven ports nothing is listening on
(Firestore, Auth, web, static, hub, logging, websocket). A plain `emu` suite runs inside
`firebase emulators:exec` with a temp `firebase.json` naming them; a self-hosting suite gets them as
`FS_PORT AUTH_PORT WEB_PORT STATIC_PORT HUB_PORT LOG_PORT WS_PORT`. It used to bind the 8080 default,
which on this Mac is usually another session's server. `EMU_PORT_RANGE=7601-7639` confines the picks
to a band. The CLI is `test/node_modules/.bin/firebase`, so nothing is fetched at push time. Every
emulator suite needs `JAVA_HOME` (or java on PATH) and `test/node_modules`. The tree server takes its
port from the top of the same band when one is set.

**The tree tier needs no java.** A gate that starts a Firestore emulator belongs in the emulator tier,
however it starts it. The usage tracker is split that way: `usage-tracker` (tree tier, S0-S19 with S8b,
and their mutants) needs only Chrome, and `usage-tracker-emu` (`tools/usage_tracker_check.js <url> --emulator
--self-test`, S20-S24 and their mutants) runs the app's real sync layer on a Firestore emulator it starts
from the jar firebase-tools caches in `~/.cache/firebase/emulators` (or `$FIRESTORE_EMULATOR_JAR`), on the
`FS_PORT`/`WS_PORT` it is handed. S20-S22 run it with open rules; S23, S23b and S24 put this tree's own
`firestore.rules` in force for their run (the page's Firestore calls carry her identity as an emulator mock
token), because what they prove turns on the rule that a family refuses the read of someone who has left it:
the household listener losing her after a deletion stopped at the login (S23b), and a leave whose answer was
lost, which Firestore runs again and the rules then refuse (S24). A fresh machine gets that jar from any CLI-run suite (`rules` runs first in
a full emulator run; alone: `node tools/gates.js --emulator-only --only=rules`). A `self` suite that names
`'url'` gets the tree server's address, as a tree gate does. Proof that the tree tier stays java-free:
`env -u JAVA_HOME PATH=<a dir with only node>:/bin FIRESTORE_EMULATOR_JAR=/nonexistent node tools/gates.js --only=usage-tracker`
passes.

**Which push runs which half of account deletion.** The emulator tier runs before a push only when the range
touches its triggers (the diagram above), so a push that changes only `app/index.html` or `app/cubby-track.js`
runs the tree tier. Each half is placed so that push still meets it: what the app SAYS when a deletion stops
(`doDeleteAccount`'s message for every stage, S8b) and every mutant of `app/cubby-track.js` are judged in the
tree tier; how far a deletion really got (the stage `app/store-firebase.js` stamps) and the end-to-end paths
(S21-S24) are judged in the emulator tier, which any push touching `app/store-firebase.js`, `tools/gates.js` or
`tools/usage_tracker_check.js` runs. What is left to CI's `emulator` job alone, after the deploy: an
`app/index.html` change that breaks deletion only in a way the real sync layer shows, with the message table
intact.

**The usage SQL runs on the real D1 too.** Every usage test drives D1 through the node:sqlite shim
(`workers/admin/dev/d1-sqlite.mjs`). `usage-d1` (`test/usage-d1-engine.test.js`, emulator tier) runs the same
code on workerd's own D1 through Miniflare, locally and offline, and compares every answer with the shim's.
Offline is enforced: Miniflare starts with `cf: false` (without it, it fetches `workers.cloudflare.com/cf.json`,
this machine's city, postcode and coordinates, and caches it under the working directory), and the thread
that runs it refuses and records every socket beyond loopback, so any attempt fails the gate and none leaves
the machine. A SIGTERM, SIGINT, SIGHUP or SIGALRM (nightly.sh's watchdog) sent to a process holding a D1
stops its workerd before the process dies of it (Node gives the worker thread that owns Miniflare no signals,
so a SIGTERM used to leave workerd running with PPID 1, holding its port); section 0 checks all four on every
run. A signal the harness does not catch still leaves workerd running: a SIGKILL cannot be caught, and a
SIGQUIT is not (measured 16 Nov 2026). The `--hold` child section 0 starts for those checks is
tied to the test by its stdin, a pipe only the test holds: it exits, disposing its workerd, however the test
ends, so a signal passed on by the runner between that child's start and the check's own signal no longer
strands it (section 0 SIGKILLs a parent to check this).
Any test written against the shim runs on D1 unchanged with `CUBBY_D1_ENGINE=miniflare` (add
`CUBBY_D1_SHADOW=1` to have every statement checked against node:sqlite as well). What D1 does that the shim
does not, each measured there on 16 Nov 2026 (miniflare 5.20261113.0-beta, workerd 1.20261113.1): it refuses
`BEGIN` and `SAVEPOINT`, a bound `undefined` (the shim stores NULL), more than 100 bound parameters (the shim
takes over 30,000), a compound `SELECT` of more than 5 terms (`orphanSweep`'s `UNION` has 4) and a `LIKE`
pattern over 50 bytes (retention's journey patterns are 18 at most); its `meta.changes` counts the rows a
trigger wrote too; and its `rows_written` bills an insert one
row per index entry (13 for a stored event, as `wrangler.toml` states) but a delete one row, whatever the
indexes. Miniflare is pinned in `workers/admin/dev/d1-miniflare.mjs`; it is found in `tools/node_modules`
(CI installs it there), in npx's cache, or at `MINIFLARE_PATH`, and the gate fails, never skips, without it.
`MINIFLARE_PATH` is held to the same pin; `MINIFLARE_ANY_VERSION=1` runs another build on purpose, and such a
run cannot pass. A push that changes only `wrangler.toml` or `schema/usage.sql` runs the emulator tier, so
`usage-d1`'s checks of the meter sentence and the rows an event bills run before that push deploys.

**A deletion that stops at the login signs her out (16 Nov 2026).** By then she has left her family, her private
records are gone and her usage purge is asked; only the login is left. Kept signed in, she was left on this
phone's copy of the family she had left, where anything she logged was refused, and the same-page retry needed a
ledger of what earlier attempts had done. Now the stop signs her out, the sign-in screen says "Sign in again, then
delete it to finish", and every retry is one path: a fresh sign-in, a new Cubby of her own (her user record went in
step 3, so she has no family to come back to), then a deletion that finishes. S23 drives that path end to end under
the real rules, and `chaos --self-test` drives it on the real Firebase SDK and Auth emulator, with a reload after the
stop; S23b the stop landing inside the household listener's re-check; S22 the stop's message and, with a
stand-in Capacitor, the iPhone app's own Apple sheet at the door; S21(b) a sign-out that fails, where the tracker
stays silent until she signs out herself. A leave refused every round is asked of the server once more: a family
that refuses her read means she is already out (her own leave landed and only its answer was lost, or an owner
removed her meanwhile), so her own records there go and the deletion carries on (S24). Nothing of the family she
left travels into her next Cubby: not its entries, not its name (in memory, on the server, or in Family & sharing),
not its Pro taste counts; only her units (S23).

**A deletion that finishes ends on the goodbye (16 Nov 2026).** Firebase's `user.delete()` signs her out as it
deletes the login, so the sign-in screen (z-index 99999) is up before `doDeleteAccount` draws the goodbye. From
July to November 2026 the goodbye sat at 4000, under it: every family that deleted saw a plain sign-in screen with
no word that the account had gone. The tracker's stand-in now signs her out on a delete as Firebase does, and
S8b, S22, S23, S23b and S24 read the element at the centre of the screen, which must be the goodbye; `chaos
--self-test` reads the same on the real SDK and Auth emulator. Her other phone, still signed in when she leaves
the family, writes her pointer (`showAccessLost`) as an update, which Firestore refuses for a user record that
is not there, so an account deleted on one phone stays deleted from the other; chaos drives that with Olive on
two phones, and checks that a removed member's own record says she has no family.

**No gate inherits the hook's repository.** Inside a hook git exports `GIT_DIR`, and from a linked
worktree it names the SHARED repository. A gate that builds a throwaway repo with plain `git init`,
`git config` or `git reset --hard` then rewrites the real one (`core.bare`, `core.hooksPath`,
`user.email`, branch heads) for every worktree at once. `run()` drops `GIT_DIR`, `GIT_WORK_TREE`,
`GIT_INDEX_FILE`, `GIT_COMMON_DIR`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES` and
`GIT_PREFIX` from every child, and any test that makes a temp repo deletes `GIT_*` from its own
environment before its first git call. `test/prepush-worktree.test.js` pushes from a real linked
worktree through the real hook (which runs no gates now) and, through a two-line test hook that adds
`gates.js --no-browser` after it, through the runner too, and compares the shared repository byte for byte.

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
     `downloadBehavior` from `tools/gate_downloads.js` (every browser AND every `createBrowserContext`).
     Add `'url'` to the command to be given the tree server instead of serving the app yourself.
   - anything that needs java or an emulator goes in the emulator tier, never the tree tier: CI's `gates`
     job has no java
   - a gate whose `--self-test` is a mutation pass gets `mut: [what it reads]` (see "Mutation passes";
     `mut-select` names any path its file reads that the list leaves out)
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
- `This push targets main`: main takes merges only through a PR with green checks. Push your branch and
  `gh pr create --base main`; the daily train is `node tools/train.js --go`. `--no-verify` does not help:
  GitHub refuses the push itself.
- `Waiting for another push on this machine to finish`: another push holds the lock; its holder is named. A
  holder whose pid is gone is taken over by itself.
- A gate failed on the PR: fix it on the branch and push again. Nothing gates a branch push locally any more;
  run what you touched first with `node tools/gates.js --only=<name>`.

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
nothing one member wrote is lost by another's save; a removed member can read nothing, and her own user record
says she has no family and remembers the one she lost. A member whose account deletion resolved (through the
app's own Delete) is no longer in the family on the server, sees the goodbye (the element at the centre of her
screen), and her user record is gone, and stays gone once her other phones have reacted.

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
`origin/main` (detached; a dirty clone is reported, not reset), runs `gates.js --emulator --mutants` (every
mutation pass, the ones a PR left off included), the one
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
| tree-server | `GATES_SELF_TEST_SOURCE=<72d7c68f's gates.js> node tools/gates.js --self-test-tree-server`: 15 of 24 red. That runner took a planted older checkout's answers when it listened on the wildcard address or on `0.0.0.0`, saying "serving THIS tree" each time, started beside one on `::1` (where a `localhost` URL reaches it), took the planted top port of a two-port band, accepted a `serve.js` serving other bytes, did not notice its server dying mid-run or a stranger answering on `127.0.0.1` mid-run, and a SIGTERM, a SIGALRM or a SIGKILL left its `serve.js` behind (the first two the running gate too). Against the runner of de27b1c7 (the first round of this fix): 2 of 25 red, nightly.sh's SIGALRM and a SIGKILL each left `serve.js` listening with PPID 1. Mutants of the new runner (16 Nov 2026), each turning its own line red: every `PORT_HOSTS` entry removed in turn (stage 1 only: stage 3 now swaps the runner's own `PORT_HOSTS` declaration; it used to swap the first match of that line's text, which in such a mutant is a string inside the self-test, so stage 3 graded the mutant's picker and went red too), the wait for its own `serve.js` to listen (stage 3), the byte comparison (4, 5b and 7), each half of the after-the-last-gate check on its own: the server gone (5) and the bytes compared (5b; before 5b, a mutant that dropped the byte half passed every stage), the stop after the server has gone (5), the watch on its exit (3 and 5), the SIGTERM handler and passing the SIGTERM on (6), the SIGALRM handler and passing the SIGALRM on (6b), the wrapper left out and the wrapper not exiting when its stdin closes (6c) |
| test-wiring | `--self-test` plants an unwired test, a comment-only mention, a stale excuse, a missing file; on the base tree it named 12 orphans |
| change-test | `--self-test` builds a throwaway repo: code-only push red, code + test green, `Test-exempt` green |
| prepush-tier | 28 Nov 2026 rewrite: `PREPUSH_HOOK=<old hook> node test/prepush-tier.test.js`, the hook of 4e50b5e6 and the push-lock hook after it each fail 16 of 23 (main not refused, gates on a branch push, node_modules demanded); the new hook passes 23 of 23. Before that: the hook before Nov 2026 failed 11 of 15; the 13 Nov hook failed the two java lines (a stub java that cannot run was waved through) |
| prepush-worktree | `PREPUSH_WT_FROM=<tree before the scrub>`: the shared config came back `bare = true`, `hooksPath = /dev/null`, a test `user.email`, moved heads. Built in: gates.js with its scrub line cut must let a planted leaky gate through, and each self-test with its own scrub cut goes red |
| prepush-worktree (28 Nov) | `PREPUSH_WT_FROM=<the push-lock tree>`: A red twice (the hook ran gates on a branch push, and the push did not land); A2-D, the runner under a test hook, stay green on both |
| hooks | `--self-test`, plus the old hook swapped in (a `command -v java` guard is caught). 28 Nov 2026: the push-lock hook swapped in fails "refuses a push to main up front" and "runs no gates on a branch push"; the self-test stages the mkdir lock and a flock the check runs outside, and both fail "runs that check under the machine push lock, a kernel flock" |
| push-lock | 28 Nov 2026, the flock lock around change_test_check (claude/efficiency): `PREPUSH_HOOK=<fix/concurrent-runs hook, 7c7657d4>` 17 of 25 red (it runs gates.js under the lock on a branch push and the check outside it); `PREPUSH_HOOK=<test-speed mkdir hook, 2f13d368>` 4 of 25 red (3b a nameless lock waited on, 6 three at once behind a SIGKILLed holder, 7 an unmakeable lock path, 9 a push inside a lock holder); this hook 25 of 25 |
| shard | 28 Nov 2026: run against the runner before `--list` existed, section 3 went red ("--list is understood": the old runner printed a run banner, not a list). Built in: five one-line mutants of the partition (shard `i` read 0-based, the last bin never chosen, the tie-break dropped, one gate dropped from every shard, the load never added) and `0/8` accepted each turn a property red for N=1..12; the aggregator is red on a failed or cancelled leg, a missing shard file, a gate dropped from every shard, a gate run twice, a failed gate, a failed served-tree, a gate the list does not name, a shard run with other flags, a file from another split and no results at all |
| chrome-path | 28 Nov 2026, before the fix: 20 FAILs, two for each of the ten files that named the Mac Chrome bare (household_name, support_reach, family_portrait, vax_calendar, report_truth, invite_arrival, home_truth, marketing_type, duedate-cycle, fab-quicklog). `--self-test` stages a bare constant, a bare path in the launch, a path built elsewhere and a bare path beside a CHROME_PATH read |
| chrome-path (its own lines) | 28 Nov 2026, PR #16's first CI run and the Mac alike: the checker flagged its own lines 25 and 58, which named the Mac path as data (6 passed, 1 failed). The path is now built from parts in the checker; no file is exempt by name. Built in: a bare path planted in a file called `tools/chrome_path_check.js` in the walk's scratch repo must be found; with a name exemption mutated into `judge()` that case is red |
| design-doc (the cited skill, on CI) | PR #16's first CI run: "the skill the doc cites is a file that exists on this machine", red on every Linux runner (no `~/.claude` there). The file is looked for only on the Mac (darwin); elsewhere the run prints a note saying so. Everywhere: exactly one `SKILL.md` path, shaped as a plugin skill path, whose skill folder is the skill the sentence names (the repo keeps no index of skills). Built in: three companions on section 5 (no path, a non-plugin path, another skill's folder) must be refused; `--self-test` case "the cited skill path is moved to a skill the sentence does not name" is RED |
| brand-images (CI's Linux) | PR #16's first CI run: "the web icons are exactly what the painted master gives", DIFFERS `icons/icon-maskable-512.png` and `cap-web/logo.png`, the same encoder bytes as brand-py's (above). `gen_brand_icons.py --check` now takes its mode from `tools/brand.py`'s `ENCODER_FINGERPRINT`, never from the tree: byte for byte where it matches (the Mac), else the same PNG mode, size and decoded pixels, named in the line and on `BRAND ICONS:`. Pixel mode on an encoder that makes every icon's own bytes fails as a stale fingerprint. Built in: `--self-test-check`, run by brand-images' `--self-test`, stages 6 cases in both modes (12 judgements): other bytes for the same pixels (byte mode red, pixel mode green), one pixel, one palette index, a lost palette and a missing icon (red in both). Mutants: pixel mode accepting everything, 4 of 12 red; byte mode comparing pixels, 1 of 12 red; the Mac forced into pixel mode, the real check red ("STALE"). Proven on CI only by brand-py: its pixel-mode way back regenerates every from-master icon there and matches the committed pixels Round 2 (PR #16, second CI run): brand-py red on Linux, 75 passed, 12 failed, all from `set --yes`'s "gen_brand_icons.py --check: BRAND ICONS: FAIL". The STALE guard read the files on disk, which `set` had just written with this encoder, so after any `set` off the Mac every icon was "this encoder's own bytes". The icons are still graded on disk in both modes (byte mode reads nothing else, unchanged); the guard now asks whether this encoder makes every icon git HEAD holds (the disk only outside a git tree). Reproduced on the Mac with `CUBBY_BRAND_SIM_ENCODER=rle`: 75 passed, 12 failed, as on CI. Built in: `--self-test-check` adds R1-R5 on scratch git trees (22 judgements, brand-images asks for at least 22), and its "other bytes" case gets a text chunk, since Z_RLE made the maskable icon's compress_level=1 re-save the same bytes and brand-images was red under the simulation. Mutants: the guard reading the disk, brand-py red under the simulation (75 passed, 12 failed, the CI failure) and R1 and R4 red; grading what HEAD holds, R1, R3 and R4 red (5 judgements). Green: brand-py and brand-images in both byte mode and the simulation. |
| manifest-shots (CI's Linux) | PR #16's first CI run: "the shipped PNG is this screen (mean grey diff 8.18, limit 6)": Chrome on Linux rasterises the same screen differently from the Mac Chrome that made the PNGs. The limit 6 is graded only on the Mac (darwin), unchanged; elsewhere an absolute ceiling of 10 (`LIMITS` in the checker): above the 8.18 CI's Linux measured on 01-two-names (02 and 03 passed under 6 there), below the 16.4 a wrong scene sits at on the Mac. Section 1b grades both renderers' limits on every run, whatever the OS (Linux 8.18 green, 12 and 10 red; the Mac at 8.18 red, at 1.37 green). On every platform, section 2b: each shipped PNG must be strictly nearest the live render of its own scene of the three (measured on the Mac: own 0.00 to 1.37, another scene 16.4 to 31.7). Built in: the same measured numbers with the PNGs declared for each other's scenes must be refused. Also built in (2b): the ceiling in force is under every PNG's distance to another scene. Mutant: the shipped PNGs mapped in reverse order, red ("01-two-names.png is 16.44 from its own scene and 0.00 from another"). 28 Nov 2026, the ceiling's own reds, each in a scratch copy through gates.js on the Mac: `LIMITS.darwin` 20, red on 1b and on the 2b companion ("the ceiling 20 is under every PNG's distance to another scene (nearest 16.44)"); 01-two-names.png moved up one timeline row (180 px, a stale shot of the right screen), red at 16.39, above the Linux ceiling too. Proven only by the next CI run: the Linux numbers of 02, 03 and the 2b companion; if Linux's nearest other scene is under 10, the companion goes red and says so |
| tree legs (test/ dependencies) | PR #16's first CI run: preg-tick-race and two-caregivers died at `spawn test/node_modules/.bin/firebase ENOENT`, fab-quicklog and duedate-cycle at `Cannot find module 'puppeteer-core'`, before any assertion. The two emulator suites are tree-tier by design (`test/helpers/tree-base.js`: every push runs them on the Mac), so they stay there: each `tree` leg now installs test/, Java 21 and a cached Firestore emulator jar, as the emulator jobs do. 28 Nov 2026 (review nit, a cache miss could resolve newer in-range versions than the Mac): `test/package-lock.json` is tracked, the Mac's own lock (721 packages, each the version installed there, devDependencies equal to `test/package.json`'s); every test/ install in gates.yml is `npm ci --prefix test`, and the test/node_modules and emulator-jar caches key on the lockfile. ci-tier asserts all of it (judgeTestDeps, judgeLock): `--dir=` the workflows of ca30ec6b, red five times (three `npm install`, two caches keyed on package.json); nine staged cases each red (npm install on a tree leg and on the emulator job, `npm ci && npm update`, either cache on package.json, the lock missing, package.json moved on without it, either .gitignore ignoring it), the real files staged unaltered green. Proven only by the next CI run: `npm ci` from a Mac-made lock on Linux, setup-java and the cached jar |
| flow-walk (CI's runner) | PR #16's first CI run: `Runtime.callFunctionOn timed out` at 193 s, the 180 s default. protocolTimeout is 600 s; no assertion changed. Mac: PASS in 56.8 s |
| ci-tier (splits) | 28 Nov 2026: the workflow before the split is red (no `tree`, `tree-complete`, `emulator-shard`, `emulator-complete`). `--self-test` stages tree-complete without `always()`, `--of=7` of 8, shard 8 left out of the matrix, fail-fast on, other list flags than the legs, `--legs` dropped, no `--record-times`, emulator-complete `--of=3` and renamed |
| ci-tier (tier, swallowing) | 28 Nov 2026: the 15 new staged cases were each red on the checker before `TIER` and `judgeWork` (20 passed, 15 failed), among them `--only=type` on the tree legs and tree-complete together, `--no-browser` for `--emulator-only` on both emulator jobs, `--changed=HEAD^1` on the tree pair, `gates` and `emulator` without `--mutants`, `continue-on-error` on the tree-complete step, on the tree-complete, emulator-complete and gates jobs and on a leg's step, `\|\| true` after and `true;` before shard.js, a step `if:`, a step `shell:` and a workflow `defaults:`. With them: 35 of 35. `--dir=` the workflows of 45c121ec: red on all six jobs running `--changed=HEAD^1` |
| shard (floor) | 28 Nov 2026: on `complete()` with no floor, a list of 0 gates with four empty results files, a list of 5, and a 1-gate run at the default floor each came back COMPLETE (3 red); with `MIN_EXPECTED` = 20 all three are refused |
| downloads-guard (CI) | 28 Nov 2026: on the runner before the CI refusal, `CI=true` with `HOME` at a folder with no `Downloads` started the tree server and exited 0 (1 red); now exit 2, "REFUSED: on CI with no ...Downloads", no tree server. Companions: CI with a Downloads folder watches it, off CI it says there is nothing to watch, `CI=false` is not CI |
| ci-tier | `--dir=<4e50b5e6's .github/workflows>`: red on gates, emulator, the seo guard step and teach-guard running on the push to main. `--self-test` stages each one back, a required check that stops running on a PR, an unreadable `if`, the IndexNow ping gone and `live` on a PR |
| mut-select | `--self-test`: the selection rules (unrelated change off, `--mutants` all, input dir on, whole paths only, new gate, changed entry, runner change, unknown base, a git-show base without its last newline); its input check found two real gaps on its first run and flags admin-access declared as only its own file |
| mutants-tier | `GATES_FROM=<the push-lock gates.js>`: 8 of 14 red (it ignores `mut`, so every pass runs on every PR), and F red on the nightly.sh without `--mutants`. A runner with `--mutants` cut out: B red ("the weakened assertion turns the run RED" never happens). A selector that never runs a pass: 6 red |
| train (--go) | the old `--go` put back in a temp copy (push `train/<stamp>:main`, no `gh pr create`): 5 of 20 red, origin main moved |
| fuzz-worker | three planted bugs in a temp copy of `worker.js`; the 14 Nov value generator, run on the `worker.js` before the sign-in code field was hardened, finds the throw in 60 s (the 13 Nov generator does not) |
| fuzz-rules | four planted rule bugs, each in its own demo project; the 13 Nov model let the planted photo-read hole through as AGREE |
| chaos | a planted lost write (nappies never leave the phone), a generator with its lock removed, the old name-bearing signature, a baby wiped from one phone's blob and saved, a planted 420 px row in the scroller (and the night wash that must NOT count), and a replay that breaks another invariant (exit 2). A member whose sign-in is ten minutes old (the Auth emulator's `lastLoginAt` moved back, read from her phone) deletes her account; with the action's sign-in again taken out, the same deletion must be refused (`reauth_unsupported`), and planted to skip the leave it must break the new invariant (a resolved deletion with her still in the family). And a deletion that stops at the login on the real SDK (its account delete failing on the wire), then a reload, then signing in again and deleting: against `app/store-firebase.js` of 93730af1 she was left signed in on the family she had left, and after a reload she was still signed in ("not left signed out on the sign-in screen", "not still signed out ... after a reload"). And a family's exit (Olive on two phones removes Nina, then deletes her account): against the app files of 72d7c68f, "the goodbye is not what she sees: the centre of her screen is signin" and "her user record is on the server again (her other phone wrote it back)"; both are planted in the self-test (the goodbye at z-index 4000, the pointer as a merge). With the pointer write taken out, "nina was removed and her own record does not say so" (a replay of the same script, not a standing plant) |
| loss-archive | pointed at another session's `:8080` it refuses by name instead of grading that tree |
| nightly-report | synthetic nights in a temp dir; mutants: "not hit tonight means fixed", "one clean replay is enough" and "no artifact list" each turn it red, as did the four of 13 Nov. Before 16 Nov 2026 a notes step nightly.sh never ran (exit 3: the server it started was not this tree's) was reported "still red (exit 3)", and a gate line whose name fills gates.js's 18 columns (`removed-records-uiFAIL`), or the served-tree line (no seconds), was not read, so a red one was never named on the board: 3 of 29 checks red on the old reader. On a real log of 14 gates with 3 failures, the old reader found 13 gates and named 2 failures (`feedback-purge-emu` missing) |
| preg-tick-race, two-caregivers | before 16 Nov 2026 each ignored the URL the runner passed and graded whatever answered on its fixed port (`localhost:8097`, `localhost:8380`); two-caregivers' "the static server is serving this checkout" asked only for a 200. Each, with its ports moved into a band and given the URL of a tree with no app while a server for another checkout listened on the wildcard address of its web port, passed: preg-tick-race 8 of 8 (that server answered 36 requests), two-caregivers 26 of 26 (139 requests). The same tree under each new test: given its own URL, red on the app's first boot (the right verdict for a tree with no app, and the stranger was never asked); given the stranger's URL, refused before the emulator started ('app/index.html differs'); alone, each served the tree itself on a free port and graded that. Their companion (`test/helpers/tree-base.js`) plants a server whose `app/index.html` has one comment more, and the check must say no. preg-tick-race's product half, re-run through the new plumbing: with the 2026-08-20 fix reverted in `applyPregJourney` (the snapshot's `appts` and signature adopted while a tick is unsaved), 3 checks red (the tick gone from the page and from the database). And each printed "the app server is THIS tree's" before checking it, so a refused run claimed THIS tree on one line and refused on the next: given a server whose `app/index.html` had one comment more, both printed that line once (16 Nov 2026). Now they print "checking that the app server at <base> is THIS tree's" first, and the THIS-tree line only once both checks pass: on the same server, 0 such lines; on this tree's own server, 1, after the checks |
| usage-tracker | `--self-test` serves each tree-tier mutant of the tracker and its hooks from a temp tree. Before the split (16 Nov 2026) it started a Firestore emulator itself, and with java off PATH it failed `spawn java ENOENT`, with the jar hidden "no Firestore emulator jar"; it now passes with both hidden. Its temp-tree port picker asked only the wildcard address and 127.0.0.1: with a server on `0.0.0.0` at the bottom of the band (16 Nov 2026), `--only=S7 --self-test --mutants=cap-removed` graded its control on that server ("failing S0.tracker") and called cap-removed "not serving the mutant", the stranger answering 39 requests. It now asks the four addresses gates.js asks: control ok, cap-removed caught by S7.cap, 0 requests |
| usage-tracker-emu | `--self-test`: the S20-S24 mutants, including teardown keeping the family record seen (NEW-2), the recent sign-in asked for only at the end, the old message, and a stop part-way said as "nothing" (S21.early-says). S22 against the app before the fix: a Google sheet she closed, or a stale email-code session, still took her out of her family, deleted her records and asked for her usage purge (6 checks red), and a cancel at the end read "Nothing was deleted". Against the app of 412d78a5 (16 Nov 2026), under the real rules: after a stop at the login the same-page retry was refused at the leave five times ("Could not finish deleting") and switched the tracker back on under the purged account (5 checks red then). Against the app of 93730af1 (the sign-out round, same day): a stop at the login left her signed in on the family she had left, where a log was refused with "Cubby wasn't allowed to save that", the sign-in screen never said what was left, signing in again never reached a Cubby of her own, and a leave whose answer was lost stopped the deletion (11 checks red across S21-S24, S21's being its staging, which needs the sign-out). Mutants added then: kept signed in, the family kept in memory, the listener's re-check let loose on the sign-in screen, the note left as a toast, the leave refusal taken as final, and the iPhone app's door asking with a web popup. Against the app files of 72d7c68f (the goodbye round, same day), with the stand-in signing her out on a delete as Firebase does: every finished deletion's goodbye lay under the sign-in screen (S22.door-companion, S22.native-companion, S23.retry-finishes, S23b.fast-finishes, S24.finishes), and her next Cubby after a stop was named after the family she left and counted its Pro tastes as used (S23.settings-forgotten, S23.new-settings, and S23.new-name-shown, where Family & sharing called it "The Rivers"; its companion S23.name-shown reads that name while she is still in that family): 8 checks red. Mutants added then: the goodbye under the sign-in screen, the family's settings kept whole, its entries kept in memory (S23.events-forgotten, S23.new-no-entries), and the stop's note kept after she signs in again (S23.finished-no-note). Mutant added 16 Nov 2026 (P5V-2): teardown clearing the deletion flag on every sign-out, the one a finished deletion ends with included (`deleting-cleared-on-finish`), caught by S23.silent-after |
| usage-d1 | `--self-test`, each break in a temp tree, run on both engines: seven only D1 can see are red on D1 and green on the shim (the scope bound past 100 parameters, a household bound as `undefined`, the orphan sweep in one 300-parameter statement, a fifth index on `usage_events` billing 14 rows an event, `wrangler.toml` stating another worst day on D1's meter, the orphan sweep's `UNION` grown to 6 terms, a journey key whose `LIKE` pattern is 51 bytes), and two more are red on both (no `WITHOUT ROWID`, an erase step's deletes outside one batch). The harness of a copy started without `cf: false` is caught reaching for `workers.cloudflare.com:443`, refused before DNS; before that fix (16 Nov 2026) a run with no copy younger than 30 days fetched it and wrote `.wrangler/cache/cf.json` (or `node_modules/.mf/cf.json`) under its working directory. A fifth `UNION` term still runs on D1 (that mutant was green), so the sweep has room for one more table. Before the scope bound, 34 internal uids made the overview's saving line fail on D1 alone. On the base tree, `usage-ingest` was red on D1 (1 of 96: a `changes` read under a metering trigger) until that check read the rows back. The signal checks of section 0, on the harness of 72d7c68f: SIGTERM, SIGINT and SIGHUP each left workerd listening on its port (`"gone":false,"free":false`); built in, a copy with no signal handlers must leave workerd after a SIGTERM, and the check kills what it leaves. The `--hold` child's tether, with 7a0f15fb's `hold()` (no tether): its parent SIGKILLed after it held a D1 left it and its workerd listening (`"gone":false,"free":false`, 1 of 16 red with `--checks-only`); built in, a copy of the test without the tether must be caught the same way. SIGALRM (nightly.sh's watchdog), checked in section 0 since 16 Nov 2026: on the harness before it was handled, the process died of it and left workerd listening (`"gone":false,"free":false`, 1 of 18 red with `--checks-only`) |
| usage-tracker (S8b) | the message table read off `doDeleteAccount` for each stage. Against `app/index.html` of 90de0d15 (before DELETE-TRUTH): 7 of 14 checks red, among them a stop at the login, and one that does not say how far it got, both called "Nothing was deleted". Against `app/index.html` of 93730af1: a stop at the login that signs her out left its message as a toast under the sign-in screen (S8b.login-signed-out red, 1 of 15). Against `app/index.html` of 72d7c68f: a finished deletion's goodbye under the sign-in screen (S8b.goodbye red, the centre of the screen "signin"); mutant goodbye-under-signin |
| admin-sdk | `--self-test` reads main's `tools/ops.js` from before 16 Nov 2026 (or, at CI's depth 1, the same three lines) and must catch the namespace `require`, `admin.credential` and `admin.firestore()`; five staged legacy lines are caught and five modular or comment lines are left alone. 20 Nov 2026: a token-level comment stripper; 5 staged legacy shapes are wrong on the 8f3508b9 matcher; each of 13 stripper branches broken in memory turns a staged line wrong; with firebase-admin ABSENT (CI static job) it skips, but a present package missing an entry point or failing to load fails |
| ops-admin | `tools/ops.js` with its old `admin.credential.cert` / `admin.firestore()` lines put back: `/api/data` answered 500 "reading 'cert'" and 12 of 14 checks failed, the crash Cubby Ops had on firebase-admin 14. 20 Nov 2026: the old namespace client, a throwing cert(sa) line (driven with an in-memory throwaway key), a dropped credential and a misspelt key path each fail it |
| next-account-cache-emu | `app/store-firebase.js` put back to v370 (909bd480), real client on the Firestore + Auth emulators, re-measured 24 Nov 2026 with the 106-check test: 73 passed, 33 failed, `NEXT-ACCOUNT-CACHE: FAIL`. After Ann logged signed out, signed in and signed out, the next account to sign in on that browser profile got Ann's baby, entry and photo in its own new family (after a reload and in the same tab); when the next person logged first, her sign-in never finished and a household she owns held the previous person's baby; an entry unsent at a sign-out from elsewhere reached the next account's family; an older build's copy reached the next account; and H, H2 and H3 were red too. Put back to 1a488e43's (the fix before its history-read guard): 97 passed, 9 failed, all in H, H2 and H3: a full history read that landed after Nora signed out put her two older entries back into memory, the next signed-out save wrote them into the phone's record with her uid, and Pam's sign-in was refused and never finished; a late failure of that read told Sue's family its history was in; and in H3, a read Olive left out that landed after Quinn's family was attached put Olive's two older entries into memory under Quinn and told Quinn's family its history was in while her own read was still out. H lands its read with nobody signed in, so a weaker guard passes it: `if (!eventsRef) return` or `if (!auth.currentUser) return` in place of `histRef !== eventsRef` gives 103 passed, 3 failed, all three in H3, with H and H2 green; a guard that drops every answer turns H3's own-read companion red. Each part of the fix reverted on its own (nine mutants, listed in docs/postmortems/2026-11-19-pre-sign-in-data-reaches-next-account.md) turns its own cases red, and the guard's two halves (M8, M9) each only its own. Its "booted" first passed on the PREVIOUS family's id (`window.LL.householdId` survives a sign-out); it now requires the family the server's `users/{uid}` names. With the fix, as the release ships (CACHE v379): 106 passed, 0 failed (the counts first recorded here, 24 passed and 13 failed on 909bd480 and 68 passed with the fix, then 59 passed and 30 failed on 909bd480, 83 passed and 6 failed on 1a488e43 and 89 passed with the fix, came from shorter versions of this test) |
| nav-links, nav-links(live) | production on 17 Nov 2026, asked as a browser asks (`Sec-Fetch-Mode: navigate`): the sign-in link `/__/auth/action` and a game link `/g/<code>` both answered the 404 page with status 404 (0 of 2), while a plain request got Firebase's handler and the game page. Its first version asked with `fetch()`, whose `sec-fetch-mode` is always `cors`, and PASSED against that same production (2 of 2); the self-test now fails a live half that uses `fetch()` (seen red by putting it back). The matcher is red on this repo's 404 page at status 404 and at 200, and on the wrong page at 200 |
| design-doc (class vocabulary) | 17 Nov 2026: red on every tree since the iPhone keyboard fix ("doc says 696, code says 698") with no CSS changed: a script that injects a `<style>` was read whole, so `r.bottom >` and `a.closest ?` counted as classes, as 157 JavaScript words already had. It now reads only such a script's strings, and a planted script must give its two CSS classes and none of `bottom`, `closest`, a comment's or a lone `'.row'`'s. Put back to whole-source reading: 698 against the doc's 536, red; with comments kept, the planted check is red |
| local-author-sync-emu | `app/store-firebase.js` put back to 909bd480 (v370), real client on the Firestore + Auth emulators, 19 Nov 2026: 24 passed, 11 failed, `LOCAL-AUTHOR-SYNC: FAIL`. Red: the first sign-in of a parent whose phone holds an entry or birth weight stamped `'local'` (she never boots), a signed-in push of a `'local'` entry from a direct write and from a ticked ritual (never reaches the server, and it leaves her phone), and an owner's edit of a caregiver's entry from a copy that lost `authorId`. With the fix: 35 passed, 0 failed |
| preg-week | 17 Nov 2026 a full run on a loaded machine failed "every pregWeekStart(n) is the exact instant pregWeek() first answers n": two clock reads raced. Under a page clock that ticks on every read the old check is red on every week and the new one (clock pinned to 18 Nov 2026 1 pm, instants frozen with window.__clockPin, both branches, midnight, month end and year end) green; half-week, local-day and rounded product mutants are red |
| ios-signin | the v370 pre-push of 17 Nov 2026 failed "the email row offers a CODE" (toggle null): on an iPhone user agent Firebase Auth waits for apis.google.com before the first auth state, and the test read after a fixed 3.5 s; holding that script 6 s reproduces the exact line. Now Chrome resolves no host but localhost (the test cannot reach Google), every read waits for its condition and settled states are re-read after 400 ms; product mutants (no card, no code request, no room above the keys, room left behind, no sign-in, the lift undone after 250 ms, the padding back after 200 ms, the card 40 s late) are each red |
| getstarted | a full run of 17 Nov 2026 failed "with nothing logged the card is up" (null): store-firebase.js had not run in that document (a lost boot file reproduces it line for line). load() now waits for a booted, signed-out app, then dwells 1400 ms to keep the old reading window, and a lost file fails by name instead of being retried; K1, K2 and K5 (the card auto-dismissed 1.2 s after load) are red |
| dose-membership, dose-button, dose-emu | 20 Nov 2026 on 909bd480's own worker.js and sw.js: dose-membership 17 of 75 red, dose-button 20 of 39 red, dose-emu 7 of 9 red with zero writes (an on-schedule "Log it" tap answered already:true and saved nothing). Then the release review's stale every-X schedule (the previous slot tapped 5 min after its due, and a partner's in-app dose 8 min late) was red on 55876b99 (76/2, 10/1) and green on 344f8725, with a control that a dose in THIS slot is still reported |
| brand-py (CI's Linux) | red on GitHub's `gates` job since 16 Nov 2026 (run 43826307386; again 45308977908, 24 Nov), "79 passed, 2 failed", green on the Mac: the same pinned Pillow on Linux writes other PNG bytes, and two checks compared the committed, Mac-made icons byte for byte with files made on the runner (the miniature tree's 60pt@3x AppIcon against the committed apple-touch icon, and `set --frame`'s way back, "files not back": cap-web/logo.png and five icons). Reproduced on the Mac with `CUBBY_BRAND_SIM_ENCODER=rle` (every brand writer deflates with zlib's Z_RLE: same pixels, other bytes; `tools/brand_style.py`): brand.py of 0428c528 under it fails exactly those two, 79 passed, 2 failed, as on CI. The mode is decided by the encoder alone, never by the committed tree: `ENCODER_FINGERPRINT` in `tools/brand.py` is the sha256 of three 1024px images made in code (ramps, SHAKE-256 noise, stripes, a checkerboard, a ring of alpha, and a palette image with transparency) saved as the generators save PNGs, recorded on the founder's Mac with the pinned Pillow (`python3 tools/brand.py --encoder-fingerprint` prints this machine's). It matches: round trips byte for byte, and every committed icon and card made from the master must also be this encoder's own bytes, or the run FAILS naming it as tree drift. It differs (CI; the simulation): the same mode, size and decoded RGBA pixels, with the registry's files, the logo URLs and app/sw.js exact. The mode is named in those checks and on the last line (`BRAND-PY: PASS (round trips ...)`). Round 1 let the tree pick the mode, and the review of 24 Nov showed the hole: `og/faq.png` re-saved at compress_level=1 (same pixels, 37415 -> 64508 bytes) with its pin replaced, or the same for `icons/icon-192.png`, moved the Mac to pixel mode and brand-py passed. Both are now red on the Mac in byte mode (86 passed, 2 failed each: "tree drift: og/faq.png" or "icons/icon-192.png", and the way back's "files not back"; brand-images still PASSes the card one, so brand-py is the gate that holds its bytes). Mutants: one pixel of a round-tripped `icons/icon-192.png` one level off, red in both modes ("files not back: icons/icon-192.png"); `ENCODER_FINGERPRINT` one digit wrong, red on the Mac (the run drops to pixel mode and "the recorded fingerprint is not stale" fails, since this encoder makes every committed icon's bytes); `set`/`native`'s refusal removed, red ("refused ... naming the switch"). Built in: the fingerprint and the drift probe must both see Z_RLE as another encoder; the drift probe must name exactly `icons/icon-192.png` and `og/faq.png` when both are re-saved at compress_level=1 in a scratch copy pinned to this encoder's own bytes (byte mode only); and a one-level change to one pixel of `icons/apple-touch-icon.png` must be found, and only it, in either mode. `set` and `native` refuse to run while `CUBBY_BRAND_SIM_ENCODER` is set, except in the self-test's own scratch trees. Not proven until CI runs: that Linux's fingerprint differs (if it matched, brand-py would fail there naming every icon as drift, never pass falsely) |
| signin-delivery | 92 checks. `SIGNIN_DELIVERY_WORKER=<worker.js of 274848d4>`: 66 red (no sendRef, no `signin_send` line, no `/api/signin-status`, and cooldown keys of the form `cooldown.cubby.internal/code/<the normalised address>` holding the address). Against `worker.js` of fe9edbda: 7 red, all in section 6b (a cooldown answer inside the minute carried no state, so the panel said "use that one" over an email the status route had found undeliverable). Against `worker.js` of 24c349f5 (round 7, R6M2-2): 3 red, `cooldown-looks-itself`, `cooldown-look-kept` and `cooldown-look-bounded` (nothing had asked the status route yet, so a reload's cooldown answer carried no state over a suppressed email). `--self-test` breaks this tree's `worker.js` eighteen ways in memory (the log line carrying the address, a refusal logging Resend's message, a debug line or the answer carrying Resend's email, a 403 read as an answer, suppressed read as sent, the cooldown keyed by the address, no same-origin guard, polls in the code bucket, no lookup bound, a settled answer asked again, no timeout, the cooldown forgetting what the status route learned, passing on a state that is not settled, passing on whatever its own look said, looking before it checks the address, never looking itself, keeping the sendRef itself) and each turns its own named check red; the lookup-bound and settled-asked-again mutants also turn the cooldown's own `cooldown-look-bounded` and `cooldown-look-kept` red. The absence checks (no address in a line, a key or an answer; no Resend read for another exact address) have `leak-matcher-works`, `cache-matcher-works` and `cooldown-looks-itself` (the same read count seeing the one read); `cooldown-unasked-no-state` and `cooldown-sent-no-state` are the companions to the state checks |
| signin-delivery-workerd | 15 checks. `SIGNIN_DELIVERY_WORKER=<worker.js of 274848d4>`: 10 red on workerd, among them "asked with the key the old Worker used (the address), the cache has nothing": workerd's own Cache API held `{"hasCode":true,"hasLink":true,"who":...}` under `cooldown.cubby.internal/code/<the normalised address>`. Against `worker.js` of fe9edbda: 2 red, the cooldown answers carried no `state`. Against `worker.js` of 24c349f5: 1 red, a reload before any status ask got a cooldown answer with no state over a suppressed email (round 7: the cooldown now looks once itself) |
| ios-signin (whether the email went) | against `app/store-firebase.js` of 274848d4 (a copy of the tree): 12 of 40 red, the undeliverable and delivered notes, the asking itself, and "We already sent an email ... so use that one" after a Resend inside the minute. The companions were seen red on mutants of this tree's client, in copies of the tree: 'unknown' read as delivered (the unknown parent's panel changed, 3 checks), the note closing the code box (the undeliverable parent could not type her code, 2 checks), asking with no sendRef (the older-Worker parent was asked about, 1 check), a delivered answer clearing her digits (1 check), the note promising a code in an email that had none (1 check), and the watch dropped on a cooldown answer ("use that one" came back over the undeliverable note, 1 check). Round 6 (the skeptic's M-S1, M-S2, M-S4, M-S8; ten parents, 65 checks, the schedule-only parents on a page clock 4 times fast): against the client of fe9edbda, 9 of 65 red ("Wrong email?" then the same address inside the minute said "use that one", cached and not cached; a reload inside the minute said it too; a wrong code wiped the note, an undeliverable answer after it had nowhere to go, and Resend and "Wrong email?" went with it; the status line was hidden until its words came, and a redrawn one arrived with its words). Mutants of this tree's client, each red: "Wrong email?" dropping the watch (2), a cooldown answer's state ignored (1), Firebase's fallback sender keeping the old note (1), a code error wiping the note (4), the line hidden until it has words (1), the words put in with a redrawn line (1), no stop at all (2: the parent who signs in and the parent whose panel is removed), a stop on being signed in alone (1: the removed panel), and asks every few real seconds (4, among them the waits the panel asked for). Round 7 (the founder's reading: Suppressed; R6M2-1 to R6M2-5 and M7-3, M7-4; eighteen parents, 118 checks, the stood-in keyboard dropping when focus leaves a field, as on an iPhone): against the client of 24c349f5 in a tree copy, 28 of 118 red (the undeliverable, delivered and slow lines under the keys at 375 and 320 px, the empty code box kept focused under "no code is on its way", a wrong code's error under the keys, no "it can take a few minutes" line with an unknown answer, with no sendRef, after a reload's cooldown answer, or before a late bounce, "Resend email" offered under an undeliverable note, and the 320 px email and code rows running to the screen's edge, 22 px left and 0 right). Mutants of this tree's client, in tree copies, each red: the round-6 skeptic's `else if (!(mailWatch && !res.fallback)) stopMailWatch();` (1: another address inherited the first one's note), no blur (2), a typed box let go (2), any line letting go of the box (2), the fit ignoring the note (8), a code error not refitted (1), the slow line drawn before the 45-second ask came back (1, its answer held 400 ms so the gap is measurable; without the hold this mutant passed once on a 2 ms margin), the slow line kept over a later bounce (2), no slow line without a sendRef (2), "Resend email" kept (4), the row without `width:100%` (2), and the note scrolled to the top with the buttons above it (2: the Google and Apple check, which the 24c349f5 client passes because its buttons sit above a fitted box). Round 7, pass 2 (the skeptic's R7M-1 and R7M-2; twenty-four parents, 140 checks): against the client of 275876d1 in a tree copy, 4 of the six new parents' 22 checks red: back from Mail 60 seconds after the send (the page frozen with CDP's `Page.setWebLifecycleState`, as iOS suspends an app off screen) she had the slow line 9 real seconds (37 on the page's clock) after her return, at the asking chain's 45-second step; back at 30 seconds it came at 67 seconds; with the page's `Date.now()` a minute ahead of its timers (a phone that slept) it came at the third ask, not the first; a status route that never answers held it to 32 real seconds. The parent with no sendRef (the companion, one 45-second timer) and the liveCode parent were green there. Mutants of this tree's client, in tree copies, each red: the slow line after a liveCode answer (1, with `old` as its companion), no give-up on a hung ask (1), an ask already on its way not counted as due (1), no ask made at once when the 45 seconds come (1), the line drawn by the timer without an answer (1), the timer acting after a settled answer (1), no wall-clock half (1) and the wall clock alone (4) |
| mail-delivery-self | the checker's `--self-test` against a stand-in Worker on 127.0.0.1 (a port in `EMU_PORT_RANGE` when one is set), on a clock of its own so nothing waits. When it had 6 checks, a checker that always says ok failed 4 of them (a suppressed address answered delivered, every answer unknown, no sendRef, a status that never settles), and a live mode that starts on `--live` alone failed the refusal check. Round 6 (skeptic M-S7): fe9edbda's `check()` (all three emails asked at 8, 12, 20, 30 and 45 s, a 429 read as unknown), run under this self-test, fails 2 of 8: the world with the status route's own 5-a-minute limit where two emails settle only on their third ask (it ended unknown, unknown, 6 asks refused) and the every-ask-refused world (it blamed the key); the new round-robin with a 2-second gap instead of 15 still gets the answers but fails that world's "no ask refused" half (25 asks refused); and a 429 read as unknown on the new schedule fails the every-ask-refused world. The live run (`--live --yes-send-real-email`) sends three real emails to Resend's test addresses and has never been run; it needs the founder's yes |
