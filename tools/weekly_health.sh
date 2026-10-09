#!/bin/sh
# Weekly Cubby health check — the numbers nobody was running.
#
# Eleven households were lost while tools/analytics.js sat unread, and the third-party
# gate once failed against production for weeks because nothing was required to look.
# This script is the "required to look": the full gate suite including the production
# checks, then the activation funnel, into a dated report plus a macOS notification.
#
# Runs on this Mac on purpose: tools/serviceAccountKey.json (gitignored, never leaves this
# machine) and tools/node_modules only exist here, so a cloud routine cannot do this job.
# Installed via launchd as com.cubby.weekly-health (Sundays 09:00 local; a missed fire runs
# on next wake). Run by hand any time:
#   sh tools/weekly_health.sh
#
# WHERE IT RUNS. launchd does not run it in the main checkout, because that lives in
# ~/Downloads and macOS denies a background job any read of ~/Downloads: every scheduled run
# from 2026-08-30 to 2026-10-04 died on its first line ("Unable to read current working
# directory: Operation not permitted") and nobody heard, because the failure never reached
# the notification below. The job runs from a dedicated clone, ~/cubby-ops/little-log-pwa,
# reset to origin/main before each run, and says so through CUBBY_REPO. By hand, with no
# CUBBY_REPO, it grades the main checkout as it always did.
#
# launchd starts with a bare PATH, so resolve the toolchain explicitly.
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"; export PATH

REPO="${CUBBY_REPO:-/Users/m1promax/Downloads/little-log-pwa}"
OUT_DIR="$HOME/cubby-reports"
mkdir -p "$OUT_DIR"
DAY=$(date +%F)
OUT="$OUT_DIR/weekly-$DAY.md"

# A run that cannot start must still say so, out loud: silence here is what hid five weeks.
if ! cd "$REPO" 2>/dev/null; then
  echo "$(date): cannot open $REPO" >> "$OUT_DIR/launchd.log"
  /usr/bin/osascript -e "display notification \"Could not open $REPO. Nothing was checked this week.\" with title \"Cubby weekly health did not run\"" 2>/dev/null
  exit 1
fi
git fetch origin -q 2>/dev/null
HEAD_SHA=$(git rev-parse --short HEAD)
BEHIND=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo "?")

{
  echo "# Cubby weekly health — $DAY"
  echo
  echo "Tree: $HEAD_SHA, behind origin/main by $BEHIND (no auto-pull: peers may be mid-work on this checkout)."
  echo
  echo "## Gates — full suite + production (--live)"
  echo '```'
} > "$OUT"
node tools/gates.js --live >> "$OUT" 2>&1
GATES=$?
{
  echo '```'
  echo
  echo "## Activation funnel — tools/analytics.js"
  echo '```'
} >> "$OUT"
node tools/analytics.js >> "$OUT" 2>&1
FUNNEL=$?
echo '```' >> "$OUT"

if [ "$GATES" -eq 0 ] && [ "$FUNNEL" -eq 0 ]; then
  VERDICT="green"
else
  VERDICT="RED (gates exit $GATES, funnel exit $FUNNEL)"
fi
printf '\nVerdict: %s\n' "$VERDICT" >> "$OUT"
/usr/bin/osascript -e "display notification \"$VERDICT — report in ~/cubby-reports/weekly-$DAY.md\" with title \"Cubby weekly health\"" 2>/dev/null

[ "$GATES" -eq 0 ] && [ "$FUNNEL" -eq 0 ]
