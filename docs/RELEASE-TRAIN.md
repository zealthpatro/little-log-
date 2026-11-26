# Release train: many merges a day, one app build a week

**Why this exists.** A push to `main` is a deploy, and every push runs the full pre-push suite on one Mac,
which takes 45 to 60 minutes. On 26 Nov 2026 five chats each pushed their own work. The suites queued
behind each other, two at once overloaded the machine, and the push in front was stopped. The fix is to
batch: many PRs, one suite, one push.

## Daily: the merge train

**Each chat**
1. Works on its own branch and bumps `CACHE` in `app/sw.js` as usual (pre-commit still demands it).
2. Opens a PR into `main` instead of pushing to `main`. `.github/workflows/gates.yml` runs the
   Chrome-free gates and the emulator suites on the PR, on GitHub, in parallel.
3. Is done when the PR is green. It does not push `main`.

**The release root (one chat, today Cubbydesign), once or twice a day**
1. In a clean checkout: `node tools/train.js`. It lists the open PRs, cuts `train/<stamp>` from
   `origin/main`, merges every green, non-draft PR in number order, and ends with `CACHE` above
   production's. Nothing is pushed.
2. Reads the train's diff (`git diff origin/main...HEAD`). The root reads every diff that ships.
3. `node tools/train.js --go`, or `git push origin train/<stamp>:main`. The pre-push hook runs the
   suite once for the whole train (the emulator tier when any rider touches rules, Worker or store).
4. If the suite goes red: find the rider that broke it, drop it (rebuild the train without it), and
   push the rest. Tell that rider's chat what went red.
5. After it lands: `node tools/gates.js --live`, then check the live CACHE (`curl` `/app/sw.js`; the
   asset cache can lag about 3 minutes). GitHub marks every rider's PR merged on its own.

**What the train does and does not settle**
- Two PRs that both bumped `CACHE` conflict on that one line. The train keeps the higher number. It does
  this only when `app/sw.js` is the only conflicted file and the `CACHE` line is the only conflict.
- Any other conflict aborts that merge and skips that PR, with the reason printed. Its own chat rebases
  it onto `main` for the next train. The train never guesses at a real conflict.
- A PR with no checks, a pending check, or a red check waits. No checks is not green.

`tools/train.js --self-test` (the `train` gate) stages each of these in a temp repo with real git.

## Weekly: the app build (Thursdays, after that day's train is live)

The native app loads the live site, so most fixes reach phones on the daily train. The weekly build
carries native changes and keeps the store build fresh.

1. Confirm Thursday's train is live (`node tools/gates.js --live` green, live CACHE matches `main`).
2. `node tools/asc.js builds`: know the last build number before you make one.
3. `bash tools/cap_ios_build.sh`. It stamps the CalVer `year.week.release` and runs
   `tools/ios_launch_smoke.sh` on the NEWEST iOS simulator before it archives, and stops on red.
   TestFlight 2026.46.1 crashed at launch on every iPhone because nothing had opened it on the newest iOS.
4. After the upload, `bash tools/ios_launch_smoke.sh` against the live site, and open the build from
   TestFlight on a real phone if one is at hand.
5. The Android build, then `node tools/android_parity_check.js`.
6. One line on `~/cubby-reports/BOARD.md`: version, build number, what it carries.

App Store submission stays the founder's call, every time.

## Later: take the Mac out of the loop

The browser gates run only on the Mac (via pre-push). GitHub runners have Chrome. Moving those gates
into `gates.yml` would let every PR prove itself fully on GitHub, and the train's push would stop being
the slow step.
