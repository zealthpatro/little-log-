#!/bin/sh
# Weekly Cubby health check — the numbers nobody was running.
#
# Eleven households were lost while tools/analytics.js sat unread, and the third-party
# gate once failed against production for weeks because nothing was required to look.
# This script is the "required to look": the full gate suite including the production
# checks, then the activation funnel, into a dated report plus a macOS notification.
#
# Runs from the MAIN checkout on this Mac on purpose: tools/serviceAccountKey.json
# (gitignored, never leaves this machine) and tools/node_modules only exist here, so a
# cloud routine cannot do this job. Installed via launchd as com.cubby.weekly-health
# (Sundays 09:00 local; a missed fire runs on next wake). Run by hand any time:
#   sh tools/weekly_health.sh
#
# launchd starts with a bare PATH, so resolve the toolchain explicitly.
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"; export PATH

REPO="/Users/m1promax/Downloads/little-log-pwa"
OUT_DIR="$HOME/cubby-reports"
mkdir -p "$OUT_DIR"
DAY=$(date +%F)
OUT="$OUT_DIR/weekly-$DAY.md"

cd "$REPO" || exit 1
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
