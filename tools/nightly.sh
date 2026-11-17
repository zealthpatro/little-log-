#!/bin/sh
# The nightly bug-bash: the whole gate suite with the Firestore emulator tier, then half an hour of
# seeded chaos against the real app and rules, then both fuzzers, then a replay of every chaos finding
# still open, into a dated report and one line on the running bug board. A notification only when
# something is red or new.
#
#   sh tools/nightly.sh             what launchd runs at 02:30 (tools/launchd/com.cubby.nightly.plist)
#   sh tools/nightly.sh --dry-run   the same flow on THIS checkout, short: a few gates of each tier, a
#                                   2-minute chaos box, 1 minute per fuzzer, no notification, and every
#                                   file under <this checkout>/reports-dryrun/ (gitignored, assetsignored)
#
# WHY. "Keep a tab on it like a proper chaos test or bug-finding bashing flow" (the founder, 2026-11-13).
# The emulator tier ran on nothing automatic, the chaos and fuzz tools only find what they are given
# time to find, and a finding nobody re-checks is a finding nobody fixes. So every night the same tools
# run for real, every finding gets an id, a repro command and a first-seen date, and BOARD.md says each
# morning which are new and which are still open (tools/nightly_report.js keeps that ledger).
#
# WHERE IT RUNS. From the ops clone, ~/cubby-ops/little-log-pwa, NEVER from ~/Downloads: macOS denies a
# background job any read of ~/Downloads, and the weekly health check died on its first line for five
# weeks that way (tools/weekly_health.sh). The clone is moved to origin/main before each run (detached,
# the way the weekly job does it, so no branch moves); a clone with uncommitted changes is REPORTED and
# left alone, never reset over. Nobody works in it.
#
# WHERE THE BUGS GO. ~/cubby-reports only: nightly-<date>.md, BOARD.md, known-findings.json and the raw
# logs under runs/<date>/. Never the repo, which is public: an open bug with a repro is not published
# before it is fixed.
#
# NEVER PIPED THROUGH tail. Every step writes its whole output to a file and its exit code is taken
# from the step itself. A `| tail` swallows the exit code and, worse, hides the head of a log, which is
# where a gate names the tree and port it graded.

# launchd starts with a bare PATH, so resolve the toolchain explicitly.
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"; export PATH
# /usr/bin/git is Xcode's shim, and under launchd it has refused with the Xcode licence prompt
# (~/cubby-reports/launchd.log). The Command Line Tools' own git never asks.
GIT=git
[ -x /Library/Developer/CommandLineTools/usr/bin/git ] && GIT=/Library/Developer/CommandLineTools/usr/bin/git

DRY=0
for a in "$@"; do [ "$a" = "--dry-run" ] && DRY=1; done
HERE=$(cd "$(dirname "$0")/.." && pwd)
DAY=$(date +%F)
SEED=$(date +%Y%m%d)

if [ "$DRY" = 1 ]; then
  REPO="$HERE"
  OUT_DIR="${NIGHTLY_OUT:-$HERE/reports-dryrun}"
  CHAOS_MIN=2; FUZZ_S=60; REPLAY_S=300
  # One gate of each kind: the wiring gate (tree), the hook's range check (tree), a rules suite (emu).
  GATE_ARGS="--emulator --only=test-wiring,change-test,household-guard"
  # A dry run on a shared Mac stays inside the band its session was given.
  EMU_PORT_RANGE="${EMU_PORT_RANGE:-7627-7639}"; export EMU_PORT_RANGE
  STEP_BAND="$EMU_PORT_RANGE"
else
  REPO="${CUBBY_REPO:-$HOME/cubby-ops/little-log-pwa}"
  OUT_DIR="$HOME/cubby-reports"
  CHAOS_MIN=30; FUZZ_S=300; REPLAY_S=1800
  GATE_ARGS="--emulator"
  STEP_BAND=""
fi
mkdir -p "$OUT_DIR"

notify() {
  if [ "$DRY" = 1 ]; then echo "[dry run] would notify: $1: $2"; return; fi
  /usr/bin/osascript -e "display notification \"$2\" with title \"$1\"" 2>/dev/null
}
stop() {
  echo "$(date): $1" >> "$OUT_DIR/nightly-launchd.log"
  echo "$1"
  notify "Cubby nightly did not run" "$1"
  exit 1
}

case "$REPO" in
  "$HOME/Downloads"*) [ "$DRY" = 1 ] || stop "Refusing to run from $REPO: ~/Downloads is unreadable to launchd. Use ~/cubby-ops/little-log-pwa." ;;
esac
cd "$REPO" 2>/dev/null || stop "Could not open $REPO. Nothing was checked tonight."

if [ "$DRY" = 0 ]; then
  if [ -n "$($GIT status --porcelain --untracked-files=no 2>&1)" ]; then
    stop "$REPO has uncommitted changes, so it was not moved to origin/main and nothing was checked. Nobody should work in the ops clone."
  fi
  $GIT fetch -q origin 2>>"$OUT_DIR/nightly-launchd.log" || stop "git fetch failed in $REPO (see nightly-launchd.log)."
  $GIT checkout -q --detach origin/main 2>>"$OUT_DIR/nightly-launchd.log" || stop "Could not move $REPO to origin/main."
fi
HEAD_SHA=$($GIT rev-parse --short HEAD 2>/dev/null)

# node_modules are gitignored. The ops clone keeps its own copies; CUBBY_NODE_MODULES=<a checkout> links
# them from there if they are missing. Without them every browser gate and every emulator suite dies, so
# refuse rather than report a green night that ran nothing.
for d in tools test; do
  if [ ! -d "$REPO/$d/node_modules" ]; then
    if [ -n "$CUBBY_NODE_MODULES" ] && [ -d "$CUBBY_NODE_MODULES/$d/node_modules" ]; then
      ln -s "$CUBBY_NODE_MODULES/$d/node_modules" "$REPO/$d/node_modules"
    else
      stop "$REPO/$d/node_modules is missing, so nothing could run. Copy it in, or set CUBBY_NODE_MODULES."
    fi
  fi
done
if [ -z "$JAVA_HOME" ]; then
  for j in /Library/Java/JavaVirtualMachines/temurin-26.jdk/Contents/Home /Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home /opt/homebrew/opt/openjdk; do
    [ -x "$j/bin/java" ] && { JAVA_HOME="$j"; break; }
  done
fi
[ -n "$JAVA_HOME" ] || stop "No Java for the Firestore emulator (set JAVA_HOME)."
export JAVA_HOME

RUN="$OUT_DIR/runs/$DAY"
mkdir -p "$RUN/chaos" "$RUN/fuzz-worker" "$RUN/fuzz-rules"
: > "$RUN/timings.txt"
echo "nightly $DAY on $HEAD_SHA in $REPO (dry run: $DRY), seed $SEED" > "$RUN/about.txt"

# N free ports, inside STEP_BAND when there is one, as "A B C ...". gates.js's own picker: free means nothing
# listens there at any address (it used to ask 127.0.0.1 alone, which on macOS calls a port held by another
# session's serve.js on [::] free).
ports() {
  EMU_PORT_RANGE="$STEP_BAND" node tools/gates.js --free-ports="$1"
}
# step <name> <seconds allowed> <log> <command...>: run it under a watchdog, record seconds and exit.
step() {
  name=$1; limit=$2; log=$3; shift 3
  t0=$(date +%s)
  perl -e 'alarm shift; exec @ARGV or exit 127' "$limit" "$@" > "$log" 2>&1
  code=$?
  echo "$name $(( $(date +%s) - t0 )) $code" >> "$RUN/timings.txt"
  echo "  $name: exit $code in $(( $(date +%s) - t0 )) s"
}

echo "Cubby nightly $DAY on $HEAD_SHA ($REPO), seed $SEED, reports in $OUT_DIR"

# 1. Every gate, both tiers. tools/gates.js serves this tree on its own port and gives each emulator suite
#    its own free ports.
step gates 10800 "$RUN/gates.log" node tools/gates.js $GATE_ARGS

# 2. The one test excused from gates.js (tools/test_wiring_check.js ALLOW): tools/noteshome_test.js is red
#    for a product reason. Watched here every night; the report says when it passes, so it can be wired.
set -- $(ports 1)
NP=$1
env PORT=$NP node tools/serve.js > "$RUN/notes-server.log" 2>&1 &
SP=$!
i=0; while [ $i -lt 40 ] && ! curl -s -o /dev/null "http://127.0.0.1:$NP/app/"; do sleep 0.25; i=$((i + 1)); done
# Graded only if that server is ours and serves THIS tree (an answer alone could be another checkout's server).
if kill -0 $SP 2>/dev/null && node tools/gates.js --served-is-this-tree="http://127.0.0.1:$NP" > "$RUN/notes-tree.log" 2>&1; then
  step notes 600 "$RUN/notes.log" node tools/noteshome_test.js "http://127.0.0.1:$NP"
else
  { echo "notes: not run, the server on $NP is not this tree's (its serve.js exited, or another answers there)"; cat "$RUN/notes-tree.log"; } > "$RUN/notes.log"
  echo "notes 0 3" >> "$RUN/timings.txt"
  echo "  notes: not run (exit 3), the server on $NP is not this tree's"
fi
kill $SP 2>/dev/null; wait $SP 2>/dev/null   # wait, so the shell does not print "Terminated" into the log

# 3. Chaos: seeded family sessions against the real app, the real rules and the emulators.
set -- $(ports 6)
step chaos $(( (CHAOS_MIN + 25) * 60 )) "$RUN/chaos.log" \
  env FS_PORT=$1 AUTH_PORT=$2 WEB_PORT=$3 HUB_PORT=$4 LOG_PORT=$5 WS_PORT=$6 \
  node tools/chaos.js --seed="$SEED" --minutes="$CHAOS_MIN" --out="$RUN/chaos"

# 4. The Worker fuzzer (in-process, no ports) and the rules fuzzer (its own emulator).
step fuzz-worker $(( FUZZ_S + 600 )) "$RUN/fuzz-worker.log" node tools/fuzz_worker.js --seed="$SEED" --seconds="$FUZZ_S" --out="$RUN/fuzz-worker"
set -- $(ports 4)
step fuzz-rules $(( FUZZ_S + 600 )) "$RUN/fuzz-rules.log" \
  env FS_PORT=$1 HUB_PORT=$2 LOG_PORT=$3 WS_PORT=$4 \
  node tools/fuzz_rules.js --seed="$SEED" --seconds="$FUZZ_S" --out="$RUN/fuzz-rules"

# 5. Every open chaos finding tonight's hunt did not hit is replayed from its own saved list, up to three
#    times. Only three clean replays mark it fixed; "not hit tonight" never does (chaos draws new sessions
#    every night). Results go to $RUN/replays.json for the report.
set -- $(ports 6)
step replays $(( REPLAY_S + 1500 )) "$RUN/replays.log" \
  env FS_PORT=$1 AUTH_PORT=$2 WEB_PORT=$3 HUB_PORT=$4 LOG_PORT=$5 WS_PORT=$6 \
  node tools/nightly_report.js --replay-open --dir="$RUN" --out="$OUT_DIR" --budget="$REPLAY_S"

# 6. The report, the board line and the ledger of open findings.
DRYFLAG=""; [ "$DRY" = 1 ] && DRYFLAG="--dry-run"
node tools/nightly_report.js --dir="$RUN" --out="$OUT_DIR" --day="$DAY" $DRYFLAG > "$RUN/report.log" 2>&1
REPORT_CODE=$?
cat "$RUN/report.log"
VERDICT=$(grep '^VERDICT ' "$RUN/report.log" | sed 's/^VERDICT //')
COLOR=$(echo "$VERDICT" | cut -d' ' -f1)
NEW=$(echo "$VERDICT" | cut -d' ' -f3)
if [ "$REPORT_CODE" -ne 0 ] || [ -z "$VERDICT" ]; then
  notify "Cubby nightly: the report failed" "See $RUN/report.log"
  exit 1
fi
if [ "$COLOR" = "red" ] || [ "${NEW:-0}" != "0" ]; then
  notify "Cubby nightly: $COLOR, $NEW new" "Report: $OUT_DIR/nightly-$DAY.md"
fi
[ "$COLOR" = "green" ]
